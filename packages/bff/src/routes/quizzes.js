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
import { logger } from '../lib/logger.js';
import { submitQuizAttemptHandler } from '../controllers/quizSubmissionController.js';
import {
  allocateQuizAttempt,
  translateClientAnswersToCanonical,
} from '../services/quizAllocationService.js';

const router = express.Router();

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

    const attempt = attemptResult.rows[0];

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
        score: attempt.score,
        totalPoints: attempt.total_points,
        startedAt: attempt.started_at,
        dueAt: attempt.due_at,
        submittedAt: attempt.submitted_at,
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

