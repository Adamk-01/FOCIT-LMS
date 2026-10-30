/**
 * FOCIT LMS - Quiz Submission Controller
 * Endpoint: POST /api/quizzes/:quizId/attempts/:attemptId/submit
 *
 * Implements the 8-8-8 Architectural Doctrine:
 * 1. Strict Database Transaction Scoping (BEGIN / COMMIT / ROLLBACK)
 * 2. Relational Set-Difference Guard (Detects & blocks foreign question IDs before persistence)
 * 3. Authoritative Server Deadline Barrier (Ingress clock enforcement)
 * 4. Atomic Compare-And-Swap (CAS) State Transition (Deadlock-safe status mutator)
 * 5. Single-Transaction Durable Outbox Event Persistence (Dual-Write Fallacy neutralization)
 * 6. Idempotent Replay Recognition (Safe handling of duplicate student clicks)
 */

import { pool } from '../db/index.js';
import { invalidateGradeCache } from '../routes/grades.js';
import { logger } from '../lib/logger.js';
import {
  allocateQuizAttempt,
  translateClientAnswersToCanonical,
} from '../services/quizAllocationService.js';

/**
 * Handles final quiz attempt submission with transactional outbox event.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function submitQuizAttemptHandler(req, res, next) {
  const { quizId, attemptId } = req.params;
  const studentId = req.user?.username || req.user?.id || req.user?.studentId;
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || null;
  const { answers = [] } = req.body;

  // 1. Syntactic Ingress Guard
  if (!studentId) {
    return res.status(401).json({
      error: 'Authentication required: missing or unverified student credentials',
      code: 'AUTH_UNAUTHENTICATED',
    });
  }

  if (!quizId || !attemptId) {
    return res.status(400).json({
      error: 'Malformed URL: quizId and attemptId route parameters are required',
      code: 'INVALID_PARAMETERS',
    });
  }

  if (!Array.isArray(answers)) {
    return res.status(400).json({
      error: 'Malformed payload: answers must be an array of question selections',
      code: 'INVALID_PAYLOAD_STRUCTURE',
    });
  }

  const client = await pool.connect();

  try {
    // 2. Open Dedicated ACID Transaction Boundary
    await client.query('BEGIN');

    // 3. Row-Level Mutex Lock & Student Ownership Verification
    const attemptResult = await client.query(`
      SELECT 
        a.attempt_id,
        a.quiz_id,
        a.student_id,
        a.status,
        a.score,
        a.total_points,
        a.due_at,
        a.submitted_at,
        a.allocation_seed,
        NOW() AS server_now
      FROM quiz_attempts a
      WHERE a.attempt_id = $1
      FOR UPDATE;
    `, [attemptId]);

    // Zero-Trust Boundary: Non-existent attempt check
    if (attemptResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Quiz attempt record not found',
        code: 'ATTEMPT_NOT_FOUND',
      });
    }

    const attempt = attemptResult.rows[0];

    // Zero-Trust Boundary: Cryptographic Session Binding
    // Prohibits student A from submitting an attempt belonging to student B
    if (attempt.student_id !== studentId || String(attempt.quiz_id) !== String(quizId)) {
      await client.query('ROLLBACK');
      logger.warn(
        { studentId, attemptStudentId: attempt.student_id, attemptId, quizId },
        '[QuizSubmission] Security Violation: Student attempted unauthorized attempt mutation'
      );
      return res.status(403).json({
        error: 'Forbidden: You do not have authorization to modify this assessment attempt',
        code: 'ATTEMPT_ACCESS_FORBIDDEN',
      });
    }

    // 4. Idempotency Guard: Safe Replay Handling for Frantic Double-Clicks
    if (attempt.status === 'SUBMITTED') {
      await client.query('ROLLBACK');
      logger.info(
        { attemptId, studentId, idempotencyKey },
        '[QuizSubmission] Idempotent submission hit: Attempt was already finalized'
      );
      return res.status(200).json({
        status: 'ALREADY_SUBMITTED',
        attemptId: attempt.attempt_id,
        quizId: attempt.quiz_id,
        studentId: attempt.student_id,
        score: attempt.score,
        totalPoints: attempt.total_points,
        submittedAt: attempt.submitted_at,
        message: 'This quiz attempt was already submitted and graded. Duplicate request ignored safely.',
      });
    }

    // Verify attempt is in a submittable state
    if (attempt.status !== 'IN_PROGRESS') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Cannot submit attempt with status: ${attempt.status}`,
        code: 'INVALID_ATTEMPT_STATE',
      });
    }

    // 5. Ingress Deadline Barrier (Grace period of 3,000ms for cellular RTT jitter)
    const serverNow = new Date(attempt.server_now).getTime();
    const dueAt = new Date(attempt.due_at).getTime();
    const GRACE_PERIOD_MS = 3000;
    const isOverdue = serverNow > (dueAt + GRACE_PERIOD_MS);
    const requestedMode = req.body?.submissionMode;
    const submissionMode = isOverdue
      ? 'EXPIRED_AUTO_SUBMIT'
      : (requestedMode === 'FULLSCREEN_VIOLATION_AUTO_SUBMIT' ? 'FULLSCREEN_VIOLATION' : 'STANDARD');

    // 6. Relational Set-Difference Guard (Detects Poisoned/Foreign Question IDs)
    if (answers.length > 0) {
      let canonicalAnswers = answers;
      if (attempt.allocation_seed) {
        const qRows = await client.query(
          'SELECT question_id, options FROM quiz_questions WHERE quiz_id = $1 ORDER BY question_id ASC',
          [quizId]
        );
        const { reverseMap } = allocateQuizAttempt(attemptId, attempt.allocation_seed, qRows.rows);
        canonicalAnswers = translateClientAnswersToCanonical(answers, reverseMap);
      }

      const setDifferenceQuery = await client.query(`
        WITH incoming_answers AS (
          SELECT 
            (elem->>'questionId')::varchar AS question_id,
            (elem->>'optionId')::varchar   AS option_id
          FROM jsonb_array_elements($1::jsonb) AS elem
        ),
        illegal_questions AS (
          -- Relational Set-Difference: P_incoming \\ Q_authorized
          SELECT ia.question_id
          FROM incoming_answers ia
          WHERE NOT EXISTS (
            SELECT 1 
            FROM quiz_questions qq
            WHERE qq.quiz_id = $2 
              AND qq.question_id = ia.question_id
          )
        )
        SELECT array_agg(question_id) AS illegal_question_ids
        FROM illegal_questions;
      `, [JSON.stringify(canonicalAnswers), quizId]);

      const illegalIds = setDifferenceQuery.rows[0]?.illegal_question_ids;
      if (illegalIds && illegalIds.length > 0) {
        await client.query('ROLLBACK');
        logger.warn(
          { attemptId, quizId, studentId, illegalIds },
          '[QuizSubmission] Poisoned payload rejected: Questions not belonging to quiz'
        );
        return res.status(422).json({
          error: 'Unprocessable Entity: Payload contains question IDs that do not belong to this quiz bank',
          code: 'ILLEGAL_QUESTION_PAYLOAD',
          illegalQuestionIds: illegalIds,
        });
      }

      // Atomically upsert in-flight final answers into relational ledger
      await client.query(`
        INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_option_id, updated_at)
        SELECT 
          $1,
          (elem->>'questionId')::varchar,
          (elem->>'optionId')::varchar,
          NOW()
        FROM jsonb_array_elements($2::jsonb) AS elem
        ON CONFLICT (attempt_id, question_id)
        DO UPDATE SET 
          selected_option_id = EXCLUDED.selected_option_id,
          updated_at = NOW();
      `, [attemptId, JSON.stringify(canonicalAnswers)]);
    }

    // 7. Atomic Scoring, CAS State Transition & Outbox Insertion (Single CTE Execution)
    const finalizedResult = await client.query(`
      WITH calculated_grade AS (
        SELECT 
          $1::varchar AS attempt_id,
          COALESCE(SUM(CASE WHEN qaa.selected_option_id = qq.correct_option_id THEN qq.points ELSE 0 END), 0)::numeric AS calculated_score,
          COALESCE(SUM(qq.points), 0)::numeric AS total_points,
          COUNT(qq.question_id)::int AS total_questions,
          COUNT(qaa.selected_option_id)::int AS answered_questions
        FROM quiz_questions qq
        LEFT JOIN quiz_attempt_answers qaa 
          ON qaa.question_id = qq.question_id 
         AND qaa.attempt_id = $1
        WHERE qq.quiz_id = $2
      ),
      sealed_attempt AS (
        UPDATE quiz_attempts qa
        SET 
          status = 'SUBMITTED',
          submitted_at = NOW(),
          score = cg.calculated_score,
          total_points = cg.total_points,
          submission_mode = $3
        FROM calculated_grade cg
        WHERE qa.attempt_id = $1 
          AND qa.status = 'IN_PROGRESS'
          AND qa.student_id = $4
          AND qa.quiz_id = $2
        RETURNING 
          qa.attempt_id, 
          qa.student_id, 
          qa.quiz_id, 
          qa.status, 
          qa.score, 
          qa.total_points, 
          qa.submitted_at, 
          qa.submission_mode
      ),
      enqueued_outbox AS (
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
          $5,
          NOW()
        FROM sealed_attempt sa
        RETURNING outbox_events.event_id
      )
      SELECT 
        sa.attempt_id, 
        sa.student_id, 
        sa.quiz_id, 
        sa.status, 
        sa.score, 
        sa.total_points, 
        sa.submitted_at, 
        sa.submission_mode,
        cg.total_questions,
        cg.answered_questions,
        eo.event_id AS outbox_event_id
      FROM sealed_attempt sa
      CROSS JOIN calculated_grade cg
      LEFT JOIN enqueued_outbox eo ON true;
    `, [attemptId, quizId, submissionMode, studentId, idempotencyKey]);

    // Concurrency collision defense: Zero rows returned means concurrent CAS won
    if (finalizedResult.rows.length === 0) {
      await client.query('ROLLBACK');
      logger.warn({ attemptId, studentId }, '[QuizSubmission] Concurrency collision during CAS update');
      return res.status(409).json({
        error: 'Conflict: This attempt was modified or submitted concurrently by another request',
        code: 'CAS_MUTATION_CONFLICT',
      });
    }

    const finalizedAttempt = finalizedResult.rows[0];
    const outboxEventId = finalizedAttempt.outbox_event_id;

    
    // 9. Synchronize score to Gradebook ledger (grade_items)
    const quizMetaResult = await client.query(
      'SELECT quiz_id, title, course_id, total_points FROM quizzes WHERE quiz_id = $1',
      [quizId]
    );
    const quizMeta = quizMetaResult.rows[0] || {
      title: 'Quiz Assessment',
      course_id: req.params.courseId || 'CSC204',
      total_points: finalizedAttempt.total_points || 10,
    };

    const finalScore = Number(finalizedAttempt.score) || 0;
    const finalTotal = Number(finalizedAttempt.total_points) || Number(quizMeta.total_points) || 10;
    const finalPct = finalTotal > 0 ? Math.round((finalScore / finalTotal) * 100) : 0;
    const letterGrade =
      finalPct >= 70 ? 'A' :
      finalPct >= 60 ? 'B' :
      finalPct >= 50 ? 'C' :
      finalPct >= 45 ? 'D' : 'F';

    await client.query(`
      WITH deleted_stale AS (
        DELETE FROM grade_items
        WHERE (
          course_id = $1 
          OR UPPER(REPLACE(course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
        )
          AND student_id = $2
          AND (
            item_name = $3
            OR (item_name ILIKE '%Quiz 1%' AND $3 ILIKE '%Quiz 1%')
          )
      )
      INSERT INTO grade_items (
        id,
        course_id,
        student_id,
        item_name,
        category,
        weight_percent,
        grade,
        max_grade,
        percentage,
        letter_grade,
        feedback,
        status,
        graded_at
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        'QUIZ',
        10,
        $4,
        $5,
        $6,
        $7,
        'Assessment finalized and graded via examination engine',
        'GRADED',
        NOW()
      );
    `, [
      quizMeta.course_id,
      studentId,
      quizMeta.title,
      finalScore,
      finalTotal,
      finalPct,
      letterGrade,
    ]);

    // 10. Commit the Atomic Transaction
    await client.query('COMMIT');
    invalidateGradeCache(quizMeta.course_id, studentId);

    logger.info(
      { 
        attemptId: finalizedAttempt.attempt_id, 
        studentId, 
        outboxEventId, 
        score: finalizedAttempt.score,
        totalPoints: finalizedAttempt.total_points 
      },
      '[QuizSubmission] Submission successfully finalized and committed to Outbox'
    );

    // 11. Authoritative HTTP Response Receipt
    return res.status(200).json({
      status: 'SUBMITTED',
      attemptId: finalizedAttempt.attempt_id,
      quizId: finalizedAttempt.quiz_id,
      studentId: finalizedAttempt.student_id,
      score: Number(finalizedAttempt.score),
      totalPoints: Number(finalizedAttempt.total_points),
      submittedAt: finalizedAttempt.submitted_at,
      submissionMode: finalizedAttempt.submission_mode,
      outboxEventId,
      answeredCount: finalizedAttempt.answered_questions,
      totalQuestions: finalizedAttempt.total_questions,
    });
  } catch (err) {
    // 12. Transaction Rollback & Error Quarantine Boundary
    await client.query('ROLLBACK').catch((rollbackErr) => {
      logger.error({ rollbackErr: rollbackErr?.message || rollbackErr }, '[QuizSubmission] Rollback failed');
    });

    // Check for specific PostgreSQL concurrency exceptions
    if (err.code === '40P01') {
      logger.error({ err, attemptId, studentId }, '[QuizSubmission] Deadlock detected during submission');
      return res.status(503).json({
        error: 'Service temporarily congested by concurrent transactions. Please retry.',
        code: 'TRANSACTION_DEADLOCK_DETECTED',
      });
    }

    logger.error(
      { err: err?.message || err, code: err?.code, attemptId, studentId },
      '[QuizSubmission] Critical internal error during transaction'
    );

    return next(err);
  } finally {
    // 13. Guaranteed Socket Release Back to the Pool
    client.release();
  }
}
