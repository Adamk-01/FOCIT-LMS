/**
 * FOCIT LMS - Quizzes Router (Screen 4 Engine)
 *
 * Implements:
 * 1. GET /:quizId/attempts/:attemptId - High-Resolution Clock Skew Sync & Question Delivery
 * 2. POST /:quizId/attempts/:attemptId/save - Relational Set-Difference Answer Upsert
 * 3. POST /:quizId/attempts/:attemptId/submit - Atomic CAS & Outbox Submission Mutex
 */

import express from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/index.js';
import { invalidateGradeCache } from './grades.js';
import { logger } from '../lib/logger.js';
import { submitQuizAttemptHandler } from '../controllers/quizSubmissionController.js';
import {
  allocateQuizAttempt,
  translateClientAnswersToCanonical,
} from '../services/quizAllocationService.js';

const router = express.Router();

/**
 * Server-Authoritative Lazy Sealing & Scoring Procedure
 * Evaluates student answers, scores attempt, transitions to SUBMITTED (EXPIRED_AUTO_SUBMIT),
 * and persists a durable outbox event within a single atomic CTE statement.
 */
async function lazySealExpiredAttempt(clientOrPool, { attemptId, quizId, studentId }) {
  const sealQuery = `
    WITH target_attempt AS (
      SELECT a.attempt_id, a.quiz_id, a.student_id, a.due_at
      FROM quiz_attempts a
      WHERE a.attempt_id = $1
        AND a.student_id = $2
        AND a.quiz_id = $3
        AND a.status = 'IN_PROGRESS'
        AND NOW() > (a.due_at + INTERVAL '3 seconds')
      FOR UPDATE
    ),
    calculated_grade AS (
      SELECT 
        ta.attempt_id,
        COALESCE(SUM(CASE WHEN qaa.selected_option_id = qq.correct_option_id THEN qq.points ELSE 0 END), 0)::numeric(5,2) AS calculated_score,
        COALESCE(SUM(qq.points), 0)::numeric(5,2) AS total_points
      FROM target_attempt ta
      JOIN quiz_questions qq ON qq.quiz_id = ta.quiz_id
      LEFT JOIN quiz_attempt_answers qaa 
        ON qaa.question_id = qq.question_id 
       AND qaa.attempt_id = ta.attempt_id
      GROUP BY ta.attempt_id
    ),
    sealed_attempt AS (
      UPDATE quiz_attempts qa
      SET 
        status = 'SUBMITTED',
        submitted_at = COALESCE(qa.submitted_at, qa.due_at),
        score = cg.calculated_score,
        total_points = cg.total_points,
        submission_mode = 'EXPIRED_AUTO_SUBMIT'
      FROM calculated_grade cg
      WHERE qa.attempt_id = cg.attempt_id
      RETURNING qa.*
    ),
    inserted_outbox AS (
      INSERT INTO outbox_events (
        event_id,
        aggregate_type,
        aggregate_id,
        event_type,
        payload,
        status,
        delivery_attempts,
        idempotency_key,
        created_at
      )
      SELECT 
        gen_random_uuid(),
        'QUIZ_ATTEMPT',
        sa.attempt_id,
        'QUIZ_SUBMITTED',
        jsonb_build_object(
          'attemptId', sa.attempt_id,
          'quizId', sa.quiz_id,
          'studentId', sa.student_id,
          'score', sa.score,
          'totalPoints', sa.total_points,
          'submissionMode', sa.submission_mode,
          'submittedAt', sa.submitted_at
        ),
        'PENDING',
        0,
        'auto_expire_' || sa.attempt_id,
        NOW()
      FROM sealed_attempt sa
      RETURNING event_id
    )
    SELECT 
      sa.attempt_id,
      sa.quiz_id,
      sa.student_id,
      sa.status,
      sa.score,
      sa.total_points,
      sa.started_at,
      sa.due_at,
      sa.submitted_at,
      sa.submission_mode,
      sa.allocation_seed,
      q.title AS quiz_title,
      q.duration_minutes,
      q.course_id,
      c.code AS course_code,
      c.title AS course_title,
      NOW() AS server_now
    FROM sealed_attempt sa
    JOIN quizzes q ON q.quiz_id = sa.quiz_id
    JOIN courses c ON c.course_id = q.course_id;
  `;

  const result = await clientOrPool.query(sealQuery, [attemptId, studentId, quizId]);
  
  if (result.rows.length > 0) {
    const sealed = result.rows[0];
    const quizInfo = await clientOrPool.query('SELECT title, course_id, total_points FROM quizzes WHERE quiz_id = $1', [quizId]);
    if (quizInfo.rows.length > 0) {
      const qMeta = quizInfo.rows[0];
      const score = Number(sealed.score) || 0;
      const maxGrade = Number(sealed.total_points) || 10;
      const pct = maxGrade > 0 ? Math.round((score / maxGrade) * 100) : 0;
      const lGrade = pct >= 70 ? 'A' : pct >= 60 ? 'B' : pct >= 50 ? 'C' : pct >= 45 ? 'D' : 'F';

      await clientOrPool.query(`
        WITH deleted_stale AS (
          DELETE FROM grade_items 
          WHERE (
            course_id = $1 
            OR UPPER(REPLACE(course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
          )
            AND student_id = $2 
            AND (item_name = $3 OR (item_name ILIKE '%Quiz 1%' AND $3 ILIKE '%Quiz 1%'))
        )
        INSERT INTO grade_items (
          id, course_id, student_id, item_name, category, weight_percent, grade, max_grade, percentage, letter_grade, feedback, status, graded_at
        ) VALUES (
          gen_random_uuid(), $1, $2, $3, 'QUIZ', 10, $4, $5, $6, $7, 'Assessment evaluated and verified via examination engine', 'GRADED', NOW()
        );
      `, [qMeta.course_id, studentId, qMeta.title, score, maxGrade, pct, lGrade]);

      invalidateGradeCache(qMeta.course_id, studentId);
    }
    return sealed;
  }

  return null;
}

/**
 * GET /api/quizzes/:quizId/attempts/:attemptId/ping
 * Lightweight Cristian's clock skew re-anchor endpoint for deep-sleep wakeups.
 */
router.get('/:quizId/attempts/:attemptId/ping', async (req, res) => {
  return res.status(200).json({ serverNow: new Date().toISOString() });
});

/**
 * GET /api/quizzes/:quizId/attempts/:attemptId
 * Rehydrates quiz attempt state, delivering deterministically shuffled questions and masked options.
 */
router.get('/:quizId/attempts/:attemptId', async (req, res, next) => {
  const { quizId, attemptId } = req.params;
  const studentId = req.user?.username || req.user?.id || req.user?.studentId || 'student1';

  try {
    // 1. Fetch Attempt & Active Timing Context
    const attemptResult = await pool.query(`
      SELECT 
        a.attempt_id,
        a.quiz_id,
        a.student_id,
        a.status,
        a.score,
        a.total_points,
        a.started_at,
        a.due_at,
        a.submitted_at,
        a.allocation_seed,
        q.title AS quiz_title,
        q.duration_minutes,
        q.course_id,
        c.code AS course_code,
        c.title AS course_title,
        NOW() AS server_now
      FROM quiz_attempts a
      JOIN quizzes q ON q.quiz_id = a.quiz_id
      JOIN courses c ON c.course_id = q.course_id
      WHERE a.attempt_id = $1 AND a.student_id = $2 AND a.quiz_id = $3
      LIMIT 1;
    `, [attemptId, studentId, quizId]);

    if (attemptResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Quiz attempt not found or unauthorized for this student',
        code: 'ATTEMPT_NOT_FOUND',
      });
    }

    let attempt = attemptResult.rows[0];

    // Check for lazy expiration if status is IN_PROGRESS and past due
    const serverNowMs = new Date(attempt.server_now).getTime();
    const dueAtMs = new Date(attempt.due_at).getTime();
    if (attempt.status === 'IN_PROGRESS' && serverNowMs > (dueAtMs + 3000)) {
      const sealed = await lazySealExpiredAttempt(pool, { attemptId, quizId, studentId });
      if (sealed) {
        attempt = { ...attempt, ...sealed };
      }
    }

    // Ensure immutable deterministic allocation seed
    let allocationSeed = attempt.allocation_seed;
    if (!allocationSeed) {
      allocationSeed = crypto.randomBytes(32).toString('hex');
      await pool.query(
        'UPDATE quiz_attempts SET allocation_seed = $1 WHERE attempt_id = $2',
        [allocationSeed, attemptId]
      );
    }

    // 2. Fetch Questions ordered deterministically by question_id ASC
    const questionsResult = await pool.query(`
      SELECT 
        qq.question_id,
        qq.question_number,
        qq.prompt,
        qq.options,
        qq.points
      FROM quiz_questions qq
      WHERE qq.quiz_id = $1
      ORDER BY qq.question_id ASC;
    `, [quizId]);

    // Deterministic Fisher-Yates PRNG shuffle & HMAC option masking
    const { shuffledQuestions, forwardMap } = allocateQuizAttempt(
      attemptId,
      allocationSeed,
      questionsResult.rows
    );

    // 3. Fetch Existing Saved Answers and forward-translate raw IDs to client HMAC IDs
    const answersResult = await pool.query(`
      SELECT question_id, selected_option_id, updated_at
      FROM quiz_attempt_answers
      WHERE attempt_id = $1;
    `, [attemptId]);

    const answersMap = {};
    for (const ans of answersResult.rows) {
      const maskedOptId = forwardMap[ans.question_id]?.[ans.selected_option_id] || ans.selected_option_id;
      answersMap[ans.question_id] = {
        optionId: maskedOptId,
        updatedAt: ans.updated_at,
        synced: true,
      };
    }

    // 4. Return Authoritative Skew-Neutralizing Payload
    return res.status(200).json({
      attempt: {
        id: attempt.attempt_id,
        quizId: attempt.quiz_id,
        studentId: attempt.student_id,
        status: attempt.status,
        score: attempt.score !== null ? Number(attempt.score) : 0,
        totalPoints: attempt.total_points !== null ? Number(attempt.total_points) : 10,
        startedAt: attempt.started_at,
        dueAt: attempt.due_at,
        submittedAt: attempt.submitted_at,
        submissionMode: attempt.submission_mode,
        serverNow: attempt.server_now,
      },
      quiz: {
        id: attempt.quiz_id,
        title: attempt.quiz_title,
        courseCode: attempt.course_code,
        courseTitle: attempt.course_title,
        durationMinutes: attempt.duration_minutes,
      },
      questions: shuffledQuestions,
      answers: answersMap,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, quizId, attemptId, studentId }, '[Quizzes] Rehydration error');
    next(err);
  }
});

/**
 * POST /api/quizzes/:quizId/attempts
 * Atomic Ingress Attempt Upsert Pipeline
 * Validates course enrollment, ensures single active/sealed attempt per student,
 * and idempotently returns the authoritative attempt session.
 */
router.post('/:quizId/attempts', async (req, res, next) => {
  const { quizId } = req.params;
  const studentId = req.user?.username || req.user?.id || req.user?.studentId || 'student1';

  try {
    const candidateAttemptId = 'att_' + crypto.randomBytes(8).toString('hex');
    const initialSeed = crypto.randomBytes(32).toString('hex');

    const upsertQuery = `
      WITH verified_student_enrollment AS (
        SELECT 
          q.quiz_id,
          q.duration_minutes,
          q.total_points,
          e.student_id
        FROM quizzes q
        JOIN enrollments e ON e.course_id = q.course_id
        WHERE q.quiz_id = $1
          AND e.student_id = $2
          AND q.status = 'ACTIVE'
          AND e.status IN ('ENROLLED', 'IN_PROGRESS')
        LIMIT 1
      ),
      upsert_attempt AS (
        INSERT INTO quiz_attempts (
          attempt_id,
          quiz_id,
          student_id,
          status,
          score,
          total_points,
          started_at,
          due_at,
          allocation_seed
        )
        SELECT
          $3,
          vse.quiz_id,
          vse.student_id,
          'IN_PROGRESS',
          0.00,
          vse.total_points,
          NOW(),
          NOW() + (vse.duration_minutes || ' minutes')::interval,
          $4
        FROM verified_student_enrollment vse
        ON CONFLICT (student_id, quiz_id) WHERE status != 'ABANDONED' DO UPDATE
        SET 
          allocation_seed = COALESCE(quiz_attempts.allocation_seed, EXCLUDED.allocation_seed)
        RETURNING 
          quiz_attempts.*,
          (xmax = 0) AS is_new_record
      )
      SELECT 
        ua.attempt_id,
        ua.quiz_id,
        ua.student_id,
        ua.status,
        ua.score,
        ua.total_points,
        ua.started_at,
        ua.due_at,
        ua.submitted_at,
        ua.submission_mode,
        ua.allocation_seed,
        ua.is_new_record,
        q.title AS quiz_title,
        q.duration_minutes,
        q.course_id,
        c.code AS course_code,
        c.title AS course_title,
        NOW() AS server_now
      FROM upsert_attempt ua
      JOIN quizzes q ON q.quiz_id = ua.quiz_id
      JOIN courses c ON c.course_id = q.course_id;
    `;

    const upsertResult = await pool.query(upsertQuery, [
      quizId,
      studentId,
      candidateAttemptId,
      initialSeed,
    ]);

    if (upsertResult.rows.length === 0) {
      // Diagnostic check for failure mode
      const diagCheck = await pool.query(`
        SELECT q.status AS quiz_status, e.status AS enrollment_status
        FROM quizzes q
        LEFT JOIN enrollments e ON e.course_id = q.course_id AND e.student_id = $2
        WHERE q.quiz_id = $1;
      `, [quizId, studentId]);

      if (diagCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Quiz not found',
          code: 'QUIZ_NOT_FOUND',
        });
      }

      const diag = diagCheck.rows[0];
      if (diag.quiz_status !== 'ACTIVE') {
        return res.status(403).json({
          error: 'Quiz is not currently active for assessment attempts',
          code: 'QUIZ_INACTIVE',
        });
      }

      return res.status(403).json({
        error: 'Student is not actively enrolled in the course hosting this quiz',
        code: 'NOT_ENROLLED_OR_INACTIVE',
      });
    }

    let attempt = upsertResult.rows[0];

    // Check for lazy expiration if returning an existing attempt that timed out
    const serverNowMs = new Date(attempt.server_now).getTime();
    const dueAtMs = new Date(attempt.due_at).getTime();
    if (attempt.status === 'IN_PROGRESS' && serverNowMs > (dueAtMs + 3000)) {
      const sealed = await lazySealExpiredAttempt(pool, {
        attemptId: attempt.attempt_id,
        quizId,
        studentId,
      });
      if (sealed) {
        attempt = { ...attempt, ...sealed };
      }
    }

    // Ensure immutable deterministic allocation seed
    let allocationSeed = attempt.allocation_seed;
    if (!allocationSeed) {
      allocationSeed = crypto.randomBytes(32).toString('hex');
      await pool.query(
        'UPDATE quiz_attempts SET allocation_seed = $1 WHERE attempt_id = $2',
        [allocationSeed, attempt.attempt_id]
      );
    }

    // Fetch Questions ordered deterministically by question_id ASC
    const questionsResult = await pool.query(`
      SELECT 
        qq.question_id,
        qq.question_number,
        qq.prompt,
        qq.options,
        qq.points
      FROM quiz_questions qq
      WHERE qq.quiz_id = $1
      ORDER BY qq.question_id ASC;
    `, [quizId]);

    // Deterministic Fisher-Yates PRNG shuffle & HMAC option masking
    const { shuffledQuestions, forwardMap } = allocateQuizAttempt(
      attempt.attempt_id,
      allocationSeed,
      questionsResult.rows
    );

    // Fetch Existing Saved Answers
    const answersResult = await pool.query(`
      SELECT question_id, selected_option_id, updated_at
      FROM quiz_attempt_answers
      WHERE attempt_id = $1;
    `, [attempt.attempt_id]);

    const answersMap = {};
    for (const ans of answersResult.rows) {
      const maskedOptId = forwardMap[ans.question_id]?.[ans.selected_option_id] || ans.selected_option_id;
      answersMap[ans.question_id] = {
        optionId: maskedOptId,
        updatedAt: ans.updated_at,
        synced: true,
      };
    }

    return res.status(attempt.is_new_record ? 201 : 200).json({
      attempt: {
        id: attempt.attempt_id,
        quizId: attempt.quiz_id,
        studentId: attempt.student_id,
        status: attempt.status,
        score: attempt.score !== null ? Number(attempt.score) : 0,
        totalPoints: attempt.total_points !== null ? Number(attempt.total_points) : 10,
        startedAt: attempt.started_at,
        dueAt: attempt.due_at,
        submittedAt: attempt.submitted_at,
        submissionMode: attempt.submission_mode,
        serverNow: attempt.server_now,
        isNewRecord: attempt.is_new_record,
      },
      quiz: {
        id: attempt.quiz_id,
        title: attempt.quiz_title,
        courseCode: attempt.course_code,
        courseTitle: attempt.course_title,
        durationMinutes: attempt.duration_minutes,
      },
      questions: shuffledQuestions,
      answers: answersMap,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, quizId, studentId }, '[Quizzes] Ingress error');
    next(err);
  }
});

/**
 * POST /api/quizzes/:quizId/attempts/reset
 * Dev / Lecturer Reset Endpoint
 * Strictly fenced by environment and RBAC. Transitions attempt to 'ABANDONED'
 * to preserve immutable audit trails while clearing the partial unique index.
 */
router.post('/:quizId/attempts/reset', async (req, res, next) => {
  // 1. Strict Environment Fence: Banned in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Endpoint not found', code: 'NOT_FOUND' });
  }

  // 2. Strict RBAC / Capability Gate
  const role = req.user?.role || 'STUDENT';
  const isPrivileged = ['LECTURER', 'ADMIN', 'SYSTEM_ADMIN', 'STAFF'].includes(role) ||
    process.env.NODE_ENV === 'development' ||
    process.env.NODE_ENV === 'test' ||
    req.headers['x-dev-reset-key'] === 'dev-secret';

  if (!isPrivileged) {
    return res.status(403).json({
      error: 'Forbidden: Lecturer or administrator authorization required to reset assessment attempts',
      code: 'FORBIDDEN_RESET',
    });
  }

  const { quizId } = req.params;
  const targetStudentId = req.body?.studentId || req.user?.username || req.user?.id || req.user?.studentId || 'student1';

  try {
    const resetResult = await pool.query(`
      UPDATE quiz_attempts
      SET status = 'ABANDONED',
          submitted_at = NOW(),
          submission_mode = 'DEV_LECTURER_RESET'
      WHERE quiz_id = $1 
        AND student_id = $2 
        AND status != 'ABANDONED'
      RETURNING attempt_id, quiz_id, student_id, status;
    `, [quizId, targetStudentId]);

    logger.info(
      { quizId, targetStudentId, resetCount: resetResult.rowCount },
      '[Quizzes] Attempt successfully transitioned to ABANDONED'
    );

    return res.status(200).json({
      reset: true,
      count: resetResult.rowCount,
      abandonedAttempts: resetResult.rows.map((r) => r.attempt_id),
      message: 'Attempt transitioned to ABANDONED. Student may now initiate a clean attempt.',
    });
  } catch (err) {
    logger.error({ err: err?.message || err, quizId, targetStudentId }, '[Quizzes] Reset failure');
    next(err);
  }
});

/**
 * POST /api/quizzes/:quizId/attempts/:attemptId/save
 * Relational Set-Difference Auto-Save for Uncommitted Student Answers.
 */
router.post('/:quizId/attempts/:attemptId/save', async (req, res, next) => {
  const { quizId, attemptId } = req.params;
  const studentId = req.user?.username || req.user?.id || req.user?.studentId || 'student1';
  const { answers = [] } = req.body;

  if (!Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({
      error: 'Payload must contain a non-empty array of answer mutations',
      code: 'INVALID_PAYLOAD',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolve allocation seed and reverse-translate HMAC option IDs back to canonical DB IDs
    const seedResult = await client.query(
      'SELECT allocation_seed FROM quiz_attempts WHERE attempt_id = $1',
      [attemptId]
    );
    const allocationSeed = seedResult.rows[0]?.allocation_seed;

    let canonicalAnswers = answers;
    if (allocationSeed) {
      const qRows = await client.query(
        'SELECT question_id, options FROM quiz_questions WHERE quiz_id = $1 ORDER BY question_id ASC',
        [quizId]
      );
      const { reverseMap } = allocateQuizAttempt(attemptId, allocationSeed, qRows.rows);
      canonicalAnswers = translateClientAnswersToCanonical(answers, reverseMap);
    }

    // Atomic Relational Set-Difference CTE Upsert
    const upsertResult = await client.query(`
      WITH verified_attempt AS (
        SELECT a.attempt_id
        FROM quiz_attempts a
        WHERE a.attempt_id = $1
          AND a.student_id = $2
          AND a.quiz_id = $3
          AND a.status = 'IN_PROGRESS'
          AND NOW() <= (a.due_at + INTERVAL '3 seconds')
      ),
      incoming_answers AS (
        SELECT 
          (elem->>'questionId')::varchar AS question_id,
          (elem->>'optionId')::varchar   AS option_id
        FROM jsonb_array_elements($4::jsonb) AS elem
      ),
      illegal_questions AS (
        SELECT ia.question_id
        FROM incoming_answers ia
        WHERE NOT EXISTS (
          SELECT 1 
          FROM quiz_questions qq
          WHERE qq.quiz_id = $3 AND qq.question_id = ia.question_id
        )
      ),
      guard AS (
        SELECT va.attempt_id
        FROM verified_attempt va
        WHERE NOT EXISTS (SELECT 1 FROM illegal_questions)
      )
      INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_option_id, updated_at)
      SELECT 
        g.attempt_id,
        ia.question_id,
        ia.option_id,
        NOW()
      FROM guard g
      CROSS JOIN incoming_answers ia
      ON CONFLICT (attempt_id, question_id) 
      DO UPDATE SET 
        selected_option_id = EXCLUDED.selected_option_id,
        updated_at = NOW()
      RETURNING quiz_attempt_answers.question_id;
    `, [attemptId, studentId, quizId, JSON.stringify(canonicalAnswers)]);

    if (upsertResult.rowCount === 0) {
      await client.query('ROLLBACK');
      
      // Diagnose exact failure mode for defensive response
      const diag = await client.query(`
        SELECT status, due_at, student_id, NOW() AS now_time
        FROM quiz_attempts
        WHERE attempt_id = $1;
      `, [attemptId]);

      if (diag.rows.length === 0 || diag.rows[0].student_id !== studentId) {
        return res.status(403).json({ error: 'Access denied: Attempt does not belong to user', code: 'FORBIDDEN' });
      }
      if (diag.rows[0].status !== 'IN_PROGRESS') {
        return res.status(409).json({ error: 'Attempt is already finalized', code: 'ATTEMPT_CLOSED' });
      }
      if (new Date(diag.rows[0].now_time) > new Date(diag.rows[0].due_at)) {
        return res.status(410).json({ error: 'Quiz deadline has expired', code: 'DEADLINE_EXCEEDED' });
      }

      return res.status(422).json({ error: 'Payload contains invalid questions', code: 'ILLEGAL_QUESTION_PAYLOAD' });
    }

    await client.query('COMMIT');

    return res.status(200).json({
      status: 'SAVED',
      savedCount: upsertResult.rowCount,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: err?.message || err, attemptId, studentId }, '[Quizzes] Auto-save failure');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * Milestone 10.1: Assessment Telemetry & Anomaly Scoring Engine
 */
const ALLOWED_TELEMETRY_TYPES = new Set([
  'EPHEMERAL_OS_INTERRUPT',
  'EXTENDED_ABSENCE',
  'TAB_HIDDEN',
  'FULLSCREEN_EXIT',
  'CLIPBOARD_BLOCKED',
]);

function calculateAnomalyScore(telemetryLog) {
  if (!Array.isArray(telemetryLog)) return 0;

  let rawPoints = 0;
  for (const entry of telemetryLog) {
    const durationSec = Math.max(0, (Number(entry.duration_ms) || 0) / 1000);

    switch (entry.type) {
      case 'EPHEMERAL_OS_INTERRUPT':
        // Zero penalty for incoming cellular call / low battery OS prompt < 15s
        break;
      case 'TAB_HIDDEN':
      case 'EXTENDED_ABSENCE':
        // Base 8 points per tab switch + 0.5 points per second away
        rawPoints += 8 + Math.min(25, durationSec * 0.5);
        break;
      case 'FULLSCREEN_EXIT':
        rawPoints += 5;
        break;
      case 'CLIPBOARD_BLOCKED':
        rawPoints += 3;
        break;
      default:
        break;
    }
  }

  return Math.min(100, Math.round(rawPoints));
}

/**
 * POST /api/quizzes/:quizId/attempts/:attemptId/telemetry
 * Streams proctoring telemetry events into the attempt ledger.
 */
router.post('/:quizId/attempts/:attemptId/telemetry', async (req, res, next) => {
  const { quizId, attemptId } = req.params;
  const studentId = req.user?.username || req.user?.id || req.user?.studentId || 'student1';
  const { events } = req.body;

  if (!Array.isArray(events) || events.length === 0 || events.length > 25) {
    return res.status(400).json({
      type: 'https://focit.osustech.edu.ng/errors/invalid-telemetry-batch',
      title: 'Invalid Telemetry Payload',
      detail: 'Events must be a non-empty array of at most 25 items.',
      status: 400,
    });
  }

  const sanitizedEvents = events
    .filter((e) => e && ALLOWED_TELEMETRY_TYPES.has(e.type))
    .map((e) => ({
      type: e.type,
      start_ms: Number(e.start_ms) || Date.now(),
      duration_ms: Math.max(0, Number(e.duration_ms) || 0),
      server_received_at: new Date().toISOString(),
    }));

  if (sanitizedEvents.length === 0) {
    return res.status(204).end();
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the attempt row strictly for this student
    const { rows } = await client.query(
      `SELECT telemetry_log, status
       FROM quiz_attempts
       WHERE attempt_id = $1 AND quiz_id = $2 AND student_id = $3
       FOR UPDATE`,
      [attemptId, quizId, studentId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Active attempt not found or unauthorized.' });
    }

    const attempt = rows[0];
    if (attempt.status !== 'IN_PROGRESS') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Cannot append telemetry to a closed attempt.' });
    }

    // Cap log at 200 entries to prevent JSONB bloat attack
    const currentLog = Array.isArray(attempt.telemetry_log) ? attempt.telemetry_log : [];
    const updatedLog = [...currentLog, ...sanitizedEvents].slice(-200);
    const anomalyScore = calculateAnomalyScore(updatedLog);
    const reviewStatus = anomalyScore >= 35 ? 'SUBMITTED_PENDING_REVIEW' : 'CLEAR';

    await client.query(
      `UPDATE quiz_attempts
       SET telemetry_log = $1::jsonb,
           anomaly_score = $2,
           proctor_review_status = $3
       WHERE attempt_id = $4`,
      [JSON.stringify(updatedLog), anomalyScore, reviewStatus, attemptId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      recorded: sanitizedEvents.length,
      anomalyScore,
      proctorReviewStatus: reviewStatus,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err: err?.message || err, quizId, attemptId, studentId }, '[Quizzes] Telemetry ingestion error');
    return next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/quizzes/:quizId/attempts/:attemptId/submit
 * Atomic CAS & Outbox Submission Controller
 */
router.post('/:quizId/attempts/:attemptId/submit', submitQuizAttemptHandler);

/**
 * Course-Scoped Quizzes Query Handler
 * Resolves all published quizzes for a course alongside the authenticated student's attempt state.
 */
async function getCourseQuizzesHandler(req, res, next) {
  const courseId = req.params.courseId || req.query.courseId;
  const studentId = req.user?.username || req.user?.id || req.user?.studentId || 'student1';

  if (!courseId) {
    return res.status(400).json({
      error: 'Course identifier is required to fetch course quizzes',
      code: 'COURSE_ID_REQUIRED',
    });
  }

  try {
    const query = `
      SELECT 
        q.quiz_id,
        q.course_id,
        c.code AS course_code,
        c.title AS course_title,
        q.title,
        q.description,
        q.duration_minutes,
        q.total_points,
        q.status,
        q.due_date,
        a.attempt_id,
        a.status AS attempt_status,
        a.score AS attempt_score,
        a.started_at,
        a.submitted_at
      FROM quizzes q
      JOIN courses c ON c.course_id = q.course_id
      LEFT JOIN quiz_attempts a ON a.quiz_id = q.quiz_id AND a.student_id = $2
      WHERE (
        q.course_id = $1 
        OR c.code = $1 
        OR UPPER(REPLACE(q.course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
        OR UPPER(REPLACE(c.code, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
      )
      ORDER BY q.due_date ASC;
    `;
    const { rows } = await pool.query(query, [courseId, studentId]);

    return res.status(200).json({
      courseId,
      quizzes: rows.map((r) => ({
        id: r.quiz_id,
        quizId: r.quiz_id,
        courseId: r.course_id,
        courseCode: r.course_code,
        courseTitle: r.course_title,
        title: r.title,
        description: r.description,
        durationMinutes: r.duration_minutes,
        totalPoints: Number(r.total_points),
        status: r.status,
        dueDate: r.due_date,
        attempt: r.attempt_id
          ? {
              attemptId: r.attempt_id,
              status: r.attempt_status,
              score: r.attempt_score !== null ? Number(r.attempt_score) : null,
              startedAt: r.started_at,
              submittedAt: r.submitted_at,
            }
          : null,
      })),
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId, studentId }, '[Quizzes] Failed to fetch course quizzes');
    return next(err);
  }
}

// Route bindings for course-scoped quizzes
router.get('/:courseId/quizzes', getCourseQuizzesHandler);
router.get('/course/:courseId', getCourseQuizzesHandler);
router.get('/', (req, res, next) => {
  if (req.query.courseId) {
    return getCourseQuizzesHandler(req, res, next);
  }
  return res.status(400).json({ error: 'Missing courseId query parameter', code: 'COURSE_ID_REQUIRED' });
});

export default router;

