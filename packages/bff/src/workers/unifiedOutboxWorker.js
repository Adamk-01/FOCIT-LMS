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

import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { createMoodleUser, getMoodleUserByField } from '../integrations/moodle/moodle.users.js';
import { enrolUserInCourse } from '../integrations/moodle/moodle.enrolments.js';
import { callMoodleAPI } from '../integrations/moodle/moodle.client.js';
import { syncFocitQuizToMoodle } from '../integrations/moodle/moodle.quizzes.js';
import { createNotification } from '../routes/notifications.js';

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

          // 0. Check if mapping already exists in local database (avoids redundant provisioning on retry)
          const existingMap = await pool.query(
            `SELECT moodle_user_id FROM moodle_user_mappings WHERE focit_user_id = $1`,
            [aggregate_id]
          );
          if (existingMap.rows.length > 0) {
            moodleUserId = existingMap.rows[0].moodle_user_id;
            break;
          }

          let existingUser = null;
          try {
            existingUser = await getMoodleUserByField('username', canonicalUsername);
          } catch (lookupErr) {
            if (lookupErr?.errorCode === 'accessexception' || lookupErr?.errorCode === 'webservice_access_exception') {
              logger.warn({ err: lookupErr.message, canonicalUsername }, '[UnifiedOutbox] User lookup access restricted, attempting direct provisioning');
            } else {
              throw lookupErr;
            }
          }

          if (existingUser?.id) {
            moodleUserId = existingUser.id;
          } else {
            const parts = (full_name || 'Student User').split(' ');
            try {
              moodleUserId = await createMoodleUser({
                username: canonicalUsername,
                firstname: parts[0] || 'Student',
                lastname: parts.slice(1).join(' ') || 'User',
                email: email || `${canonicalUsername}@focit.uniosun.edu.ng`,
              });
            } catch (createErr) {
              const errMsg = String(createErr?.message || '').toLowerCase();
              if (errMsg.includes('already exists') || createErr?.errorCode === 'usernamealreadyexists') {
                // Reconcile concurrent creation: Another worker or retry may have just created the user in Moodle
                try {
                  const reconciledUser = await getMoodleUserByField('username', canonicalUsername);
                  if (reconciledUser?.id) {
                    moodleUserId = reconciledUser.id;
                    logger.info({ canonicalUsername, moodleUserId }, '[UnifiedOutbox] Successfully reconciled existing Moodle user ID on duplicate collision');
                  } else {
                    const configErr = new Error(`Moodle user "${canonicalUsername}" already exists, but reconciliation lookup returned null.`);
                    configErr.isRetryable = false;
                    throw configErr;
                  }
                } catch (reconcileErr) {
                  if (reconcileErr?.errorCode === 'accessexception' || reconcileErr?.errorCode === 'webservice_access_exception') {
                    const configErr = new Error(`Moodle user "${canonicalUsername}" already exists, but web service token lacks read capabilities (core_user_get_users_by_field) to retrieve user ID.`);
                    configErr.isRetryable = false;
                    throw configErr;
                  }
                  throw reconcileErr;
                }
              } else {
                throw createErr;
              }
            }
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

          // Guard: Check if student exists in database (auto-quarantine orphaned events)
          const studentCheck = await pool.query('SELECT 1 FROM students WHERE student_id = $1', [studentId]);
          if (studentCheck.rows.length === 0) {
            const orphanError = new Error(`Student ${studentId} does not exist in FOCIT database (orphaned event)`);
            orphanError.isRetryable = false;
            throw orphanError;
          }
          let semesterId = payload.semester_id;

          if (!semesterId) {
            const activeTermRes = await pool.query(
              `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
            );
            semesterId = activeTermRes.rows[0]?.id || '2026_RAIN';
          }

          // Guard: Verify authoritative registration clearance and active enrollment status
          const ACTIVE_ENROLLMENT_STATUSES = ['ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS', 'COMPLETED'];
          const batchId = payload.batch_id || (ev.aggregate_type === 'COURSE_REGISTRATION' ? ev.aggregate_id : null);

          // 1. Check registration item status first (authoritative clearance by lecturer)
          // Chronology rule: When no specific batch_id is provided, newest batch submission takes precedence
          const itemCheck = await pool.query(
            `SELECT cri.status, cri.created_at, b.id AS batch_id, b.status AS batch_status
             FROM course_registration_items cri
             JOIN course_registration_batches b ON b.id = cri.batch_id
             WHERE b.student_id = $1 AND cri.course_id = $2 AND b.semester_id = $3
             ORDER BY 
               CASE WHEN $4::text IS NOT NULL AND b.id::text = $4::text THEN 0 ELSE 1 END,
               b.created_at DESC, 
               cri.created_at DESC
             LIMIT 1`,
            [studentId, courseId, semesterId, batchId]
          );
          const itemStatus = itemCheck.rows[0]?.status;

          if (itemStatus === 'REJECTED') {
            logger.info(
              { studentId, courseId, semesterId },
              '[UnifiedOutbox] Course item was explicitly rejected by lecturer in current batch. Discarding Moodle synchronization event.'
            );
            break; // Discard event permanently as COMPLETED
          }

          if (itemStatus === 'PENDING_LECTURER') {
            // If item is still awaiting lecturer clearance, do NOT mark complete!
            // Crucial: Decrement delivery_attempts back so waiting for human clearance does not consume the failure budget!
            logger.info(
              { studentId, courseId, semesterId, itemStatus },
              '[UnifiedOutbox] Enrollment pending lecturer clearance. Postponing outbox synchronization without consuming failure budget.'
            );
            await pool.query(
              `UPDATE integration_outbox_events 
               SET status = 'PENDING',
                   delivery_attempts = GREATEST(0, delivery_attempts - 1),
                   locked_until = NOW() + INTERVAL '60 seconds',
                   worker_id = NULL,
                   updated_at = NOW()
               WHERE event_id = $1 AND status = 'PROCESSING' AND worker_id = $2`,
              [event_id, this.workerId]
            );
            return; // Exit turn without marking COMPLETED
          }

          // 2. Verify authoritative enrollment status in ledger
          // Doctrine: PostgreSQL enrollments table is the authoritative ledger. If no active enrollment exists, do not sync.
          const enrollmentCheck = await pool.query(
            `SELECT status FROM enrollments 
             WHERE student_id = $1 AND course_id = $2 AND semester_id = $3`,
            [studentId, courseId, semesterId]
          );
          const currentStatus = enrollmentCheck.rows[0]?.status;

          // If no active enrollment exists in the authoritative ledger, discard event
          if (!currentStatus || !ACTIVE_ENROLLMENT_STATUSES.includes(currentStatus)) {
            logger.info(
              { studentId, courseId, semesterId, currentStatus, itemStatus },
              '[UnifiedOutbox] No active authoritative enrollment found in ledger. Discarding Moodle synchronization event.'
            );
            break;
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

        default:
          logger.warn({ event_type, event_id }, '[UnifiedOutbox] Unknown event type; marking complete');
      }

      // Mark COMPLETED upon success and clear any previous transient error
      // Guard against race conditions: Only update if the event is still in PROCESSING status assigned to this worker.
      // If a concurrent thread (e.g. lecturer approval) re-armed the event to PENDING, do not overwrite it with COMPLETED!
      const updateResult = await pool.query(`
        UPDATE integration_outbox_events
        SET 
          status = 'COMPLETED',
          locked_until = NULL,
          last_error = NULL,
          worker_id = NULL,
          updated_at = NOW()
        WHERE event_id = $1 AND status = 'PROCESSING' AND worker_id = $2;
      `, [event_id, this.workerId]);

      if (updateResult.rowCount === 0) {
        logger.info(
          { event_id, event_type },
          '[UnifiedOutbox] Event was reactivated or lease was reclaimed concurrently; leaving status untouched'
        );
      } else {
        logger.info({ event_id, event_type }, '[UnifiedOutbox] Event processed successfully');
      }

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
        const quarantineResult = await pool.query(`
          UPDATE integration_outbox_events
          SET status = 'FAILED', locked_until = NULL, last_error = $2, worker_id = NULL, updated_at = NOW()
          WHERE event_id = $1 AND status = 'PROCESSING' AND worker_id = $3;
        `, [event_id, errorMessage, this.workerId]);

        // Post-quarantine alert to Administrator ONLY when this worker's quarantine update took effect
        if (quarantineResult.rowCount > 0) {
          (async () => {
            try {
              const adminRes = await pool.query(
                `SELECT advisor_id FROM staff_advisors 
                 WHERE role IN ('ADMIN', 'SYSTEM_ADMIN') AND account_status = 'ACTIVE' 
                 ORDER BY (role = 'SYSTEM_ADMIN') DESC, created_at ASC 
                 LIMIT 3`
              );
              const targetAdmins = adminRes.rows.length > 0 ? adminRes.rows.map(r => r.advisor_id) : ['admin1'];
              for (const adminId of targetAdmins) {
                await createNotification({
                  userId: adminId,
                  category: 'SYSTEM',
                  priority: 'URGENT',
                  title: `Outbox Sync Failure: ${event_type}`,
                  body: `Moodle background provisioning failed for ${ev.aggregate_type || 'OUTBOX'} (${ev.aggregate_id || event_id}): ${errorMessage.slice(0, 150)}`,
                  actionUrl: '/admin/outbox',
                  metadata: { eventId: event_id, eventType: event_type, attempts: ev.delivery_attempts },
                }).catch((err) => logger.warn({ err: err?.message, adminId }, '[UnifiedOutbox] Admin notification failed'));
              }
            } catch (adminNotifErr) {
              logger.warn({ err: adminNotifErr?.message }, '[UnifiedOutbox] Failed to alert admin of outbox quarantine');
            }
          })();
        }
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
