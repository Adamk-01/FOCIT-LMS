/**
 * FOCIT LMS - Unified Transactional Integration Outbox Worker
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces:
 * 1. Non-Blocking Atomic Row Acquisition: SELECT ... FOR UPDATE SKIP LOCKED
 * 2. Dead-Worker Lease Recovery (locked_until < NOW())
 * 3. Poison Pill Quarantine (delivery_attempts >= MAX_ATTEMPTS marked as FAILED)
 * 4. Deterministic Moodle Upstream Sync for:
 *    - USER_PROVISION_REQUESTED -> core_user_create_users -> moodle_user_mappings
 *    - ENROLLMENT_SYNC          -> enrol_manual_enrol_users
 *    - ACTIVITY_COMPLETED       -> core_completion_override_activity_completion_status
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { createMoodleUser, getMoodleUserByField } from '../integrations/moodle/moodle.users.js';
import { enrolUserInCourse } from '../integrations/moodle/moodle.enrolments.js';
import { callMoodleAPI } from '../integrations/moodle/moodle.client.js';
import { syncFocitQuizToMoodle } from '../integrations/moodle/moodle.quizzes.js';
import { matchStudentLine } from '../services/ocrAttendanceMatcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = path.join(__dirname, '../../.cache/sheets');

const BATCH_SIZE = 20;
const LEASE_DURATION_SECONDS = 30;
const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 5000;

export class UnifiedOutboxWorker {
  constructor(workerId = `unified_worker_${process.pid}`) {
    this.workerId = workerId;
    this.isRunning = false;
    this.timerId = null;
    this.currentBatchPromise = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info({ workerId: this.workerId }, '[UnifiedOutbox] Worker process started');
    this.scheduleNext();
  }

  async stop() {
    this.isRunning = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    logger.info({ workerId: this.workerId }, '[UnifiedOutbox] Worker process stop initiated, awaiting active in-flight batch...');
    if (this.currentBatchPromise) {
      await this.currentBatchPromise.catch(() => {});
    }
    logger.info({ workerId: this.workerId }, '[UnifiedOutbox] Worker process stopped cleanly');
  }

  scheduleNext() {
    if (!this.isRunning) return;
    this.timerId = setTimeout(async () => {
      this.timerId = null;
      if (!this.isRunning) return;
      this.currentBatchPromise = this.sweepBatch();
      try {
        await this.currentBatchPromise;
      } catch (err) {
        logger.error({ err: err?.message || err }, '[UnifiedOutbox] Unexpected sweep error');
      } finally {
        this.currentBatchPromise = null;
        if (this.isRunning) {
          this.scheduleNext();
        }
      }
    }, POLL_INTERVAL_MS);
  }

  /**
   * Atomically claims and processes a batch of claimable integration events.
   */
  async sweepBatch() {
    const client = await pool.connect();
    let events = [];

    try {
      await client.query('BEGIN');

      const claimResult = await client.query(`
        WITH claimable_events AS (
          SELECT event_id
          FROM integration_outbox_events
          WHERE 
            -- Case A: Newly committed pending events (or unexpired backoff elapsed)
            (status = 'PENDING' AND (locked_until IS NULL OR locked_until <= NOW()))
            OR 
            -- Case B: Stranded events from crashed workers (lease expired)
            (status = 'PROCESSING' AND locked_until < NOW() AND delivery_attempts < $1)
          ORDER BY created_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE integration_outbox_events e
        SET 
          status = 'PROCESSING',
          locked_until = NOW() + make_interval(secs => $3::int),
          delivery_attempts = e.delivery_attempts + 1,
          worker_id = $4,
          updated_at = NOW()
        FROM claimable_events ce
        WHERE e.event_id = ce.event_id
        RETURNING 
          e.event_id, 
          e.aggregate_type, 
          e.aggregate_id, 
          e.event_type, 
          e.payload, 
          e.delivery_attempts,
          e.idempotency_key;
      `, [MAX_ATTEMPTS, BATCH_SIZE, LEASE_DURATION_SECONDS, this.workerId]);

      events = claimResult.rows;
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err: err?.message || err }, '[UnifiedOutbox] Failed to claim batch');
      return;
    } finally {
      client.release();
    }

    if (events.length === 0) return;

    logger.info({ count: events.length }, '[UnifiedOutbox] Claimed batch of outbox events');

    for (const ev of events) {
      await this.processEvent(ev);
    }
  }

  /**
   * Dispatches event to its authoritative integration sink.
   */
  async processEvent(ev) {
    const { event_id, event_type, aggregate_id, payload } = ev;

    try {
      switch (event_type) {
        case 'USER_PROVISION_REQUESTED': {
          const studentId = payload.student_id || aggregate_id;

          // Guard against orphaned events where the student record was deleted from FOCIT
          const studentCheck = await pool.query(
            `SELECT student_id FROM students WHERE student_id = $1`,
            [studentId]
          );
          if (studentCheck.rows.length === 0) {
            const orphanError = new Error(`Student ${studentId} does not exist in FOCIT database (orphaned event)`);
            orphanError.isRetryable = false;
            throw orphanError;
          }

          const { matric_number, full_name, email } = payload;
          const canonicalUsername = (matric_number || studentId).toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
          
          let moodleUserId;
          const existingUser = await getMoodleUserByField('username', canonicalUsername);
          if (existingUser?.id) {
            moodleUserId = existingUser.id;
          } else {
            const parts = (full_name || 'Student User').split(' ');
            moodleUserId = await createMoodleUser({
              username: canonicalUsername,
              firstname: parts[0] || 'Student',
              lastname: parts.slice(1).join(' ') || 'User',
              email: email || `${canonicalUsername}@focit.uniosun.edu.ng`,
            });
          }

          // Guard: If moodleUserId was previously mapped to a stale/different FOCIT identity, purge the obsolete mapping
          await pool.query(
            `DELETE FROM moodle_user_mappings WHERE moodle_user_id = $1 AND focit_user_id != $2`,
            [moodleUserId, aggregate_id]
          );

          // Persist mapping
          await pool.query(`
            INSERT INTO moodle_user_mappings (focit_user_id, moodle_user_id, sync_status, last_synced_at)
            VALUES ($1, $2, 'SYNCED', NOW())
            ON CONFLICT (focit_user_id) DO UPDATE SET
              moodle_user_id = EXCLUDED.moodle_user_id,
              sync_status = 'SYNCED',
              last_synced_at = NOW();
          `, [aggregate_id, moodleUserId]);

          break;
        }

        case 'ENROLLMENT_SYNC': {
          const studentId = payload.student_id || aggregate_id;
          const courseId = payload.course_id;
          let semesterId = payload.semester_id;

          if (!semesterId) {
            const activeTermRes = await pool.query(
              `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
            );
            semesterId = activeTermRes.rows[0]?.id || '2026_RAIN';
          }

          // 1. Resolve Moodle User ID
          const userMapRes = await pool.query(
            `SELECT moodle_user_id FROM moodle_user_mappings WHERE focit_user_id = $1`,
            [studentId]
          );
          if (userMapRes.rows.length === 0) {
            throw new Error(`Missing Moodle user mapping for student ${studentId}. User must be provisioned first.`);
          }
          const moodleUserId = userMapRes.rows[0].moodle_user_id;

          // 2. Resolve Moodle Course ID scoped by course and semester
          const courseMapRes = await pool.query(
            `SELECT moodle_course_id FROM moodle_course_mappings WHERE focit_course_id = $1 AND semester_id = $2`,
            [courseId, semesterId]
          );
          if (courseMapRes.rows.length === 0) {
            throw new Error(`Missing Moodle course mapping for course ${courseId} in semester ${semesterId}.`);
          }
          const moodleCourseId = courseMapRes.rows[0].moodle_course_id;

          // 3. Execute Enrolment via Moodle Web Services
          await enrolUserInCourse({
            moodleUserId,
            moodleCourseId,
            roleId: 5, // Student
          });

          break;
        }

        case 'ACTIVITY_COMPLETED': {
          const cmid = payload.cmid || payload.moodle_module_id;
          const newstate = payload.newstate !== undefined ? payload.newstate : 1;
          const userid = payload.moodle_user_id || payload.userid;

          const query = {
            cmid,
            newstate,
          };
          if (userid) query.userid = userid;

          await callMoodleAPI('core_completion_override_activity_completion_status', query, 'POST');
          break;
        }

        case 'UPDATE_USER_PROFILE': {
          const studentId = payload.student_id || aggregate_id;
          const userMapRes = await pool.query(
            `SELECT moodle_user_id FROM moodle_user_mappings WHERE focit_user_id = $1`,
            [studentId]
          );
          if (userMapRes.rows.length > 0) {
            const moodleUserId = userMapRes.rows[0].moodle_user_id;
            const updatePayload = {
              users: [
                {
                  id: moodleUserId,
                  email: payload.email,
                  description: payload.description,
                  phone1: payload.phone1,
                },
              ],
            };
            try {
              await callMoodleAPI('core_user_update_users', updatePayload, 'POST');
            } catch (err) {
              logger.warn({ studentId, moodleUserId, err: err?.message }, '[UnifiedOutbox] Moodle profile update warning');
            }
          }
          break;
        }

        case 'MOODLE_QUIZ_SYNC':
        case 'MOODLE_QUESTION_SYNC': {
          let quizId = payload?.quizId || payload?.quiz_id;
          if (!quizId && ev.aggregate_type === 'QUIZ') {
            quizId = aggregate_id;
          }
          if (!quizId) {
            // Authoritative fallback: Look up parent quiz_id from quiz_questions table
            const questionIdentifier = payload?.questionId || payload?.question_id || (ev.aggregate_type === 'QUESTION' ? aggregate_id : null);
            if (questionIdentifier) {
              const qLookup = await pool.query(
                `SELECT quiz_id FROM quiz_questions WHERE question_id = $1 LIMIT 1`,
                [questionIdentifier]
              );
              if (qLookup.rows[0]?.quiz_id) {
                quizId = qLookup.rows[0].quiz_id;
              }
            }
          }

          if (!quizId) {
            const err = new Error(`Cannot sync Moodle quiz: missing quizId in payload for event ${event_id}`);
            err.isRetryable = false;
            throw err;
          }
          await syncFocitQuizToMoodle(quizId);
          break;
        }

        case 'PROCESS_ATTENDANCE_SHEET_OCR': {
          const { sessionId, courseId, semesterId, sheetImageUrls } = payload;
          if (!sessionId || !courseId) {
            const err = new Error(`Cannot process sheet OCR: missing sessionId or courseId in event ${event_id}`);
            err.isRetryable = false;
            throw err;
          }

          // 1. Session Existence & Lock Guard: Do not mutate an already sealed session
          const sessionCheck = await pool.query(
            `SELECT session_id, is_locked FROM attendance_sessions WHERE session_id = $1`,
            [sessionId]
          );
          if (sessionCheck.rows.length === 0) {
            const err = new Error(`Attendance session ${sessionId} does not exist (orphaned event)`);
            err.isRetryable = false;
            throw err;
          }
          if (sessionCheck.rows[0].is_locked) {
            logger.warn({ sessionId }, '[UnifiedOutbox] Attendance session already sealed/locked; skipping OCR mutation');
            break;
          }

          // 2. Query enrolled cohort in strict deterministic order
          const studentsRes = await pool.query(`
            SELECT s.student_id, s.matric_number, s.full_name
            FROM enrollments e
            JOIN students s ON s.student_id = e.student_id
            WHERE e.course_id = $1 
              AND (e.semester_id = $2 OR e.semester_id IS NULL)
              AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
            ORDER BY s.student_id ASC;
          `, [courseId, semesterId]);

          if (studentsRes.rows.length === 0) {
            logger.warn({ courseId, sessionId }, '[UnifiedOutbox] No enrolled students found for session OCR');
            break;
          }

          // 3. Extract OCR lines from physical stored sheet images or companion OCR files
          const ocrLines = [];
          for (const imgKey of (sheetImageUrls || [])) {
            if (typeof imgKey !== 'string') continue;
            const sanitized = imgKey.replace(/[^a-zA-Z0-9_.-]/g, '_');
            const txtPath = path.join(SHEETS_DIR, `${sanitized}.ocr.txt`);
            try {
              const text = await fs.readFile(txtPath, 'utf8');
              const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
              ocrLines.push(...lines);
            } catch (_) {
              // Companion OCR file not found yet on disk
            }
          }

          // 4. Line-by-line homoglyph and surname corroboration
          const matchedUpdates = [];
          for (const student of studentsRes.rows) {
            let bestMatch = { isMatch: false, confidence: 0.000 };
            for (const line of ocrLines) {
              const match = matchStudentLine(line, student);
              if (match.confidence > bestMatch.confidence) {
                bestMatch = match;
              }
            }

            if (bestMatch.isMatch && bestMatch.confidence >= 0.700) {
              matchedUpdates.push({
                studentId: student.student_id,
                status: 'PRESENT',
                confidence: bestMatch.confidence,
              });
            } else if (bestMatch.confidence >= 0.400) {
              matchedUpdates.push({
                studentId: student.student_id,
                status: 'ABSENT',
                confidence: bestMatch.confidence,
              });
            }
          }

          // 5. Invariant 3 & Defect 2: Dijkstra-Ordered Atomic Batch Update Guarded by Lock & Unverified Baseline
          if (matchedUpdates.length > 0) {
            matchedUpdates.sort((a, b) => String(a.studentId).localeCompare(String(b.studentId)));
            const studentIds = matchedUpdates.map((u) => u.studentId);
            const newStatuses = matchedUpdates.map((u) => u.status);
            const confidences = matchedUpdates.map((u) => u.confidence);

            const updateRes = await pool.query(`
              UPDATE attendance_records ar
              SET status = v.new_status,
                  confidence_score = v.confidence,
                  verification_method = 'SHEET_SCAN',
                  marked_at = NOW()
              FROM unnest($2::varchar[], $3::varchar[], $4::numeric[]) AS v(student_id, new_status, confidence)
              JOIN attendance_sessions s ON s.session_id = $1
              WHERE ar.session_id = $1
                AND ar.student_id = v.student_id
                AND s.is_locked = FALSE
                AND ar.confidence_score = 0.000;
            `, [sessionId, studentIds, newStatuses, confidences]);

            logger.info(
              { sessionId, matchedCount: matchedUpdates.length, rowsUpdated: updateRes.rowCount },
              '[UnifiedOutbox] Batch OCR attendance matching applied'
            );
          }

          break;
        }

        default:
          logger.warn({ event_type, event_id }, '[UnifiedOutbox] Unknown event type; marking complete');
      }

      // Mark COMPLETED upon success and clear any previous transient error
      await pool.query(`
        UPDATE integration_outbox_events
        SET 
          status = 'COMPLETED',
          locked_until = NULL,
          last_error = NULL,
          updated_at = NOW()
        WHERE event_id = $1;
      `, [event_id]);

      logger.info({ event_id, event_type }, '[UnifiedOutbox] Event processed successfully');

    } catch (err) {
      const isRetryable = err?.isRetryable !== false;
      const errorMessage = err?.message || String(err);

      logger.warn(
        { event_id, attempts: ev.delivery_attempts, isRetryable, err: errorMessage },
        '[UnifiedOutbox] Upstream sync attempt failed'
      );

      // Quarantine as FAILED if non-retryable error (e.g. invalidparameter) OR max attempts exceeded
      if (!isRetryable || ev.delivery_attempts >= MAX_ATTEMPTS) {
        logger.error(
          { event_id, event_type, isRetryable, attempts: ev.delivery_attempts, err: errorMessage },
          '[UnifiedOutbox] Poison pill quarantined: marking event as FAILED'
        );
        await pool.query(`
          UPDATE integration_outbox_events
          SET status = 'FAILED', locked_until = NULL, last_error = $2, updated_at = NOW()
          WHERE event_id = $1;
        `, [event_id, errorMessage]);
      } else {
        // Exponential backoff for retryable errors
        const backoffSeconds = Math.min(300, Math.pow(2, ev.delivery_attempts) * 5);
        await pool.query(`
          UPDATE integration_outbox_events
          SET status = 'PENDING', locked_until = NOW() + make_interval(secs => $2::int), last_error = $3, updated_at = NOW()
          WHERE event_id = $1;
        `, [event_id, backoffSeconds, errorMessage]);
      }
    }
  }
}

export const unifiedOutboxWorker = new UnifiedOutboxWorker();
