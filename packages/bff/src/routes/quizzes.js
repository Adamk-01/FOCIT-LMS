/**
 * FOCIT LMS - Quizzes Router (Screen 4 Engine)
 *
 * Implements:
 * 1. GET /:quizId/attempts/:attemptId - High-Resolution Clock Skew Sync & Question Delivery
 * 2. POST /:quizId/attempts/:attemptId/save - Relational Set-Difference Answer Upsert
 * 3. POST /:quizId/attempts/:attemptId/submit - Atomic CAS & Outbox Submission Mutex
 */

import express from 'express';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { submitQuizAttemptHandler } from '../controllers/quizSubmissionController.js';

const router = express.Router();

/**
 * GET /api/quizzes/:quizId/attempts/:attemptId
 * Rehydrates quiz attempt state, delivering masked questions and Cristian skew timestamps.
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

    // 2. Fetch Questions with Correct Answers Stripped (Zero-Trust Information Barrier)
    const questionsResult = await pool.query(`
      SELECT 
        qq.question_id,
        qq.question_number,
        qq.prompt,
        qq.options,
        qq.points
      FROM quiz_questions qq
      WHERE qq.quiz_id = $1
      ORDER BY qq.question_number ASC;
    `, [quizId]);

    // 3. Fetch Existing Saved Answers for this Attempt
    const answersResult = await pool.query(`
      SELECT question_id, selected_option_id, updated_at
      FROM quiz_attempt_answers
      WHERE attempt_id = $1;
    `, [attemptId]);

    const answersMap = {};
    for (const ans of answersResult.rows) {
      answersMap[ans.question_id] = {
        optionId: ans.selected_option_id,
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
        serverNow: attempt.server_now, // High-precision Cristian's algorithm anchor
      },
      quiz: {
        id: attempt.quiz_id,
        title: attempt.quiz_title,
        courseCode: attempt.course_code,
        courseTitle: attempt.course_title,
        durationMinutes: attempt.duration_minutes,
      },
      questions: questionsResult.rows.map((q) => ({
        id: q.question_id,
        number: q.question_number,
        prompt: q.prompt,
        options: q.options,
        points: q.points,
      })),
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
    `, [attemptId, studentId, quizId, JSON.stringify(answers)]);

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
 * POST /api/quizzes/:quizId/attempts/:attemptId/submit
 * Atomic CAS & Outbox Submission Controller
 */
router.post('/:quizId/attempts/:attemptId/submit', submitQuizAttemptHandler);

export default router;
