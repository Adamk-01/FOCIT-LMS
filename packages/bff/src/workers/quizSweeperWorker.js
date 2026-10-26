/**
 * FOCIT LMS - Official Test Auto-Zero Sweeper Worker
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. Hard Countdown Expiry Enforcement:
 *    Any official test attempt in 'IN_PROGRESS' state where due_at < NOW()
 *    is transitioned to 'EXPIRED' with a mandatory score of 0.00.
 * 2. Non-blocking Concurrency: Uses SELECT ... FOR UPDATE SKIP LOCKED.
 * 3. Deadlock Immunity: Lexicographical sorting on attempt IDs.
 * 4. Auditability: Commits immutable audit events and queues student alert.
 */

import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { recordIdentityAuditLog } from '../lib/auditLogger.js';
import { createStudentNotification } from '../routes/notifications.js';

const SWEEP_INTERVAL_MS = 20000; // Check every 20 seconds
const BATCH_SIZE = 50;

export class QuizSweeperWorker {
  constructor(workerId = `quiz_sweeper_${process.pid}`) {
    this.workerId = workerId;
    this.isRunning = false;
    this.timerId = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info({ workerId: this.workerId }, '[QuizSweeper] Worker started');
    this.scheduleNext();
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) clearTimeout(this.timerId);
    logger.info({ workerId: this.workerId }, '[QuizSweeper] Worker stopped');
  }

  scheduleNext() {
    if (!this.isRunning) return;
    this.timerId = setTimeout(async () => {
      try {
        await this.sweepExpiredAttempts();
      } catch (err) {
        logger.error({ err: err?.message || err }, '[QuizSweeper] Sweep iteration failure');
      } finally {
        this.scheduleNext();
      }
    }, SWEEP_INTERVAL_MS);
  }

  /**
   * Identifies unsubmitted attempts past their due_at ceiling,
   * finalizes them with score = 0.00, and notifies affected students.
   */
  async sweepExpiredAttempts() {
    const client = await pool.connect();
    let expiredRows = [];

    try {
      await client.query('BEGIN');

      // 1. Atomically claim expired official test attempts
      const claimResult = await client.query(`
        WITH expired_candidates AS (
          SELECT attempt_id
          FROM quiz_attempts
          WHERE 
            status = 'IN_PROGRESS' 
            AND due_at < NOW()
            AND is_practice = FALSE
          ORDER BY attempt_id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE quiz_attempts qa
        SET 
          status = 'EXPIRED',
          score = 0.00,
          submitted_at = NOW(),
          submission_mode = 'AUTO_ZERO_TIMEOUT'
        FROM expired_candidates ec
        WHERE qa.attempt_id = ec.attempt_id
        RETURNING 
          qa.attempt_id, 
          qa.student_id, 
          qa.quiz_id, 
          qa.due_at,
          qa.started_at;
      `, [BATCH_SIZE]);

      expiredRows = claimResult.rows;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err: err?.message || err }, '[QuizSweeper] Failed to sweep expired quiz attempts');
      return;
    } finally {
      client.release();
    }

    if (expiredRows.length === 0) return;

    logger.warn(
      { count: expiredRows.length },
      '[QuizSweeper] Finalized expired official quiz attempts with AUTO-ZERO score'
    );

    // 2. Post-commit student notifications & audit ledger
    for (const row of expiredRows) {
      try {
        await recordIdentityAuditLog(pool, {
          eventType: 'QUIZ_AUTO_ZERO_ENFORCED',
          actorId: 'SYSTEM_WORKER',
          actorRole: 'SYSTEM_ADMIN',
          targetId: row.student_id,
          targetType: 'QUIZ_ATTEMPT',
          sessionId: null,
          ipAddress: '127.0.0.1',
          userAgent: 'FOCIT_QUIZ_SWEEPER_WORKER',
          metadata: {
            attempt_id: row.attempt_id,
            quiz_id: row.quiz_id,
            due_at: row.due_at,
            enforced_score: 0.00,
          },
        }).catch(() => {});

        await createStudentNotification({
          studentId: row.student_id,
          category: 'ACADEMIC',
          priority: 'URGENT',
          title: 'Official Test Submission Window Expired',
          body: `Your official test session (${row.quiz_id}) was not submitted before the countdown expired. A score of 0.00 has been recorded.`,
          actionUrl: `/courses`,
          metadata: { attempt_id: row.attempt_id, score: 0 },
        }).catch(() => {});
      } catch (postErr) {
        logger.warn({ err: postErr?.message, attemptId: row.attempt_id }, '[QuizSweeper] Notification write warning');
      }
    }
  }
}

export const quizSweeperWorker = new QuizSweeperWorker();
