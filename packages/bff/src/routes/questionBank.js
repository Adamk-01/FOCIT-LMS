/**
 * FOCIT LMS - Lecturer Question Bank & Atomic Pointer Swap Router (Screen 5 Engine)
 *
 * Implements the 8-8-8 Architectural Doctrine:
 * 1. Strict Transactional Boundary (BEGIN / COMMIT / ROLLBACK)
 * 2. Non-Key Row-Level Serialization (FOR NO KEY UPDATE on courses)
 * 3. Engine-Enforced Partial Unique Index (uq_one_active_quiz_per_course)
 * 4. Optimistic CAS Revision Guard (Detects concurrent lecturer publications)
 * 5. Full Decoupling from Incoming Student Traffic (FOR KEY SHARE compatibility)
 */

import express from 'express';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

/**
 * GET /api/courses/:courseId/question-bank
 * Retrieves questions, revision status, and metrics for the Lecturer View (Screen 5).
 */
router.get('/:courseId/question-bank', async (req, res, next) => {
  const { courseId } = req.params;

  try {
    // 1. Fetch active revision context
    const quizResult = await pool.query(`
      SELECT 
        q.quiz_id,
        q.course_id,
        q.title,
        q.description,
        q.duration_minutes,
        q.total_points,
        q.version,
        q.status,
        q.is_active_for_new_attempts,
        q.published_at,
        c.code AS course_code,
        c.title AS course_title
      FROM quizzes q
      JOIN courses c ON c.course_id = q.course_id
      WHERE q.course_id = $1
      ORDER BY q.version DESC;
    `, [courseId]);

    const activeQuiz = quizResult.rows.find((q) => q.is_active_for_new_attempts) || quizResult.rows[0];

    if (!activeQuiz) {
      return res.status(200).json({
        courseId,
        activeQuiz: null,
        revisions: [],
        questions: [],
        metrics: { total: 0, mcq: 0, trueFalse: 0, shortAnswer: 0 },
      });
    }

    // 2. Fetch questions for the active revision
    const questionsResult = await pool.query(`
      SELECT 
        qq.question_id,
        qq.quiz_id,
        qq.question_number,
        qq.type,
        qq.prompt,
        qq.options,
        qq.correct_option_id,
        qq.points,
        qq.explanation
      FROM quiz_questions qq
      WHERE qq.quiz_id = $1
      ORDER BY qq.question_number ASC;
    `, [activeQuiz.quiz_id]);

    const questions = questionsResult.rows.map((row) => ({
      id: row.question_id,
      number: row.question_number,
      type: row.type,
      prompt: row.prompt,
      options: row.options,
      correctOptionId: row.correct_option_id,
      points: Number(row.points),
      explanation: row.explanation,
    }));

    // Calculate question metrics
    const metrics = {
      total: questions.length,
      mcq: questions.filter((q) => q.type === 'MULTIPLE_CHOICE').length,
      trueFalse: questions.filter((q) => q.type === 'TRUE_FALSE').length,
      shortAnswer: questions.filter((q) => q.type === 'SHORT_ANSWER').length,
    };

    return res.status(200).json({
      courseId,
      courseCode: activeQuiz.course_code,
      courseTitle: activeQuiz.course_title,
      activeQuiz: {
        id: activeQuiz.quiz_id,
        title: activeQuiz.title,
        version: activeQuiz.version,
        status: activeQuiz.status,
        durationMinutes: activeQuiz.duration_minutes,
        totalPoints: Number(activeQuiz.total_points),
        publishedAt: activeQuiz.published_at,
      },
      revisions: quizResult.rows.map((r) => ({
        id: r.quiz_id,
        version: r.version,
        status: r.status,
        isActive: r.is_active_for_new_attempts,
      })),
      metrics,
      questions,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId }, '[QuestionBank] Fetch error');
    next(err);
  }
});

/**
 * POST /api/courses/:courseId/question-bank/publish
 * The Atomic Non-Key Pointer Swap Route Handler.
 *
 * Guarantees that only ONE revision holds is_active_for_new_attempts = TRUE,
 * eliminating split-brain states and concurrent lecturer publication collisions.
 */
router.post('/:courseId/question-bank/publish', async (req, res, next) => {
  const { courseId } = req.params;
  const { targetQuizId, expectedPreviousQuizId } = req.body;
  const lecturerId = req.user?.username || req.user?.id || 'lecturer1';

  // 1. Syntactic Ingress Guard
  if (!targetQuizId) {
    return res.status(400).json({
      error: 'Malformed request: targetQuizId is required to publish a revision',
      code: 'MISSING_TARGET_QUIZ_ID',
    });
  }

  const client = await pool.connect();

  try {
    // 2. Open Dedicated ACID Transaction Boundary
    await client.query('BEGIN');

    // 3. Serializing Mutex on the Parent Course Tuple
    // Acquires FOR NO KEY UPDATE on courses.
    // Invariant: Fully COMPATIBLE with student attempts FK (FOR KEY SHARE),
    // but SERIALIZES concurrent lecturers executing publish transactions on this course.
    const courseLockResult = await client.query(`
      SELECT course_id, code 
      FROM courses 
      WHERE course_id = $1 
      FOR NO KEY UPDATE;
    `, [courseId]);

    if (courseLockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Course not found in academic catalog',
        code: 'COURSE_NOT_FOUND',
      });
    }

    // 4. Probe Currently Active Revision
    const currentActiveResult = await client.query(`
      SELECT quiz_id, version, status
      FROM quizzes
      WHERE course_id = $1 
        AND is_active_for_new_attempts = TRUE
      LIMIT 1;
    `, [courseId]);

    const currentActiveQuiz = currentActiveResult.rows[0] || null;

    // 5. Optimistic CAS Guard: Detect Concurrent Publication Races
    // If the client specified expectedPreviousQuizId and it diverged, reject blind overwrite.
    if (
      expectedPreviousQuizId &&
      currentActiveQuiz &&
      currentActiveQuiz.quiz_id !== expectedPreviousQuizId
    ) {
      await client.query('ROLLBACK');
      logger.warn(
        { courseId, expected: expectedPreviousQuizId, actual: currentActiveQuiz.quiz_id, targetQuizId },
        '[QuestionBank] Optimistic CAS conflict: Another lecturer published a revision concurrently'
      );
      return res.status(409).json({
        error: 'Publish Conflict: The active quiz version was updated by another lecturer while you were drafting.',
        code: 'CONCURRENT_PUBLISH_CONFLICT',
        currentActiveQuizId: currentActiveQuiz.quiz_id,
        currentActiveVersion: currentActiveQuiz.version,
        recommendation: 'Refresh your question bank context to inspect the active revision before re-publishing.',
      });
    }

    // 6. Verify Target Revision Eligibility
    const targetQuizResult = await client.query(`
      SELECT quiz_id, course_id, version, status, is_active_for_new_attempts
      FROM quizzes
      WHERE quiz_id = $1 AND course_id = $2
      FOR NO KEY UPDATE;
    `, [targetQuizId, courseId]);

    if (targetQuizResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Target revision not found for this course',
        code: 'TARGET_QUIZ_NOT_FOUND',
      });
    }

    const targetQuiz = targetQuizResult.rows[0];

    // Idempotency: If already active, return 200 OK immediately
    if (targetQuiz.is_active_for_new_attempts) {
      await client.query('ROLLBACK');
      return res.status(200).json({
        status: 'ALREADY_ACTIVE',
        activatedQuizId: targetQuiz.quiz_id,
        activatedVersion: targetQuiz.version,
        message: 'Target revision is already active for incoming student attempts.',
      });
    }

    // 7. Verify Target Question Bank Is Populated
    const questionCountCheck = await client.query(`
      SELECT COUNT(*)::int AS count 
      FROM quiz_questions 
      WHERE quiz_id = $1;
    `, [targetQuizId]);

    if (questionCountCheck.rows[0].count === 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Cannot publish an empty revision: Quiz bank contains 0 questions.',
        code: 'EMPTY_QUESTION_BANK',
      });
    }

    // 8. The Atomic Non-Key Pointer Swap
    // Step 8A: Retire any currently active revisions for this course
    await client.query(`
      UPDATE quizzes 
      SET is_active_for_new_attempts = FALSE 
      WHERE course_id = $1 
        AND is_active_for_new_attempts = TRUE;
    `, [courseId]);

    // Step 8B: Promote the target revision to active
    const activateResult = await client.query(`
      UPDATE quizzes
      SET 
        is_active_for_new_attempts = TRUE,
        status = 'ACTIVE',
        published_at = NOW()
      WHERE quiz_id = $1 
        AND course_id = $2
      RETURNING 
        quiz_id, 
        course_id, 
        version, 
        title, 
        duration_minutes, 
        total_points, 
        status, 
        is_active_for_new_attempts, 
        published_at;
    `, [targetQuizId, courseId]);

    const activatedRecord = activateResult.rows[0];

    // 9. Commit the Atomic Transaction
    await client.query('COMMIT');

    logger.info(
      { 
        courseId, 
        activatedQuizId: activatedRecord.quiz_id, 
        version: activatedRecord.version, 
        previousQuizId: currentActiveQuiz?.quiz_id,
        lecturerId 
      },
      '[QuestionBank] Atomic pointer swap committed successfully. Version promoted.'
    );

    // 10. Authoritative Receipt
    return res.status(200).json({
      status: 'PUBLISHED',
      courseId,
      activatedQuizId: activatedRecord.quiz_id,
      version: activatedRecord.version,
      publishedAt: activatedRecord.published_at,
      previousQuizId: currentActiveQuiz?.quiz_id || null,
      questionCount: questionCountCheck.rows[0].count,
    });
  } catch (err) {
    // 11. Transaction Rollback & Error Quarantine Boundary
    await client.query('ROLLBACK').catch(() => {});

    // Catch PostgreSQL Partial Unique Index Violations
    if (err.code === '23505') {
      logger.error(
        { err, courseId, targetQuizId },
        '[QuestionBank] Partial unique index violation caught: Split-brain prevented natively'
      );
      return res.status(409).json({
        error: 'Concurrency Collision: Another lecturer committed a revision simultaneously. Split-brain prevented.',
        code: 'SPLIT_BRAIN_COLLISION_PREVENTED',
      });
    }

    logger.error({ err: err?.message || err, courseId, targetQuizId }, '[QuestionBank] Publish failure');
    next(err);
  } finally {
    // 12. Guaranteed Socket Release Back to Pool
    client.release();
  }
});

/**
 * POST /api/courses/:courseId/question-bank/questions
 * Creates a manual question with database-enforced option membership.
 */
router.post('/:courses/:courseId/question-bank/questions', async (req, res, next) => {
  const { courseId } = req.params;
  const { quizId, questionNumber, prompt, options, correctOptionId, points = 1.0, type = 'MULTIPLE_CHOICE' } = req.body;

  if (!quizId || !prompt || !options || !correctOptionId) {
    return res.status(400).json({
      error: 'quizId, prompt, options, and correctOptionId are required',
      code: 'MISSING_FIELDS',
    });
  }

  try {
    const questionId = `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const result = await pool.query(`
      INSERT INTO quiz_questions (
        question_id,
        quiz_id,
        question_number,
        type,
        prompt,
        options,
        correct_option_id,
        points,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      RETURNING *;
    `, [
      questionId,
      quizId,
      questionNumber || 1,
      type,
      prompt,
      JSON.stringify(options),
      correctOptionId,
      points,
    ]);

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23514') {
      return res.status(422).json({
        error: 'Referential Integrity Violation: correctOptionId must exist in the provided options array.',
        code: 'CORRECT_OPTION_MEMBERSHIP_VIOLATION',
      });
    }
    if (err.code === '55000') {
      return res.status(409).json({
        error: 'Active Attempt Guard: Cannot add question to a quiz with active student attempts.',
        code: 'QUIZ_SEALED_IMMUTABLE',
      });
    }
    next(err);
  }
});

/**
 * POST /api/courses/:courseId/tests/publish
 * Publishes an Official Timed Assessment for the given course.
 * Creates an OFFICIAL_TEST quiz with auto_zero = true, strict duration, window,
 * and attaches designated questions or copies all questions from the current practice pool.
 */
router.post('/:courseId/tests/publish', async (req, res, next) => {
  const { courseId } = req.params;
  const lecturerId = req.user?.username || req.user?.id || 'lecturer1';
  const callerRole = String(req.user?.role || '').toUpperCase();

  // Finding 7.1: Restrict official-test publishing strictly to lecturer or administrator roles
  const allowedRoles = ['LECTURER', 'HOD', 'ADMIN', 'SYSTEM_ADMIN'];
  if (!allowedRoles.includes(callerRole)) {
    return res.status(403).json({
      error: 'Forbidden: Only academic faculty (Lecturer, HOD, Admin) can publish official tests.',
      code: 'FORBIDDEN_TEST_AUTHORING',
    });
  }

  const {
    title,
    description = '',
    durationMinutes = 30,
    totalPoints = 20,
    windowOpenAt = null,
    windowCloseAt = null,
    autoZero = true,
    questionIds = [],
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      error: 'Test title is required',
      code: 'TITLE_REQUIRED',
    });
  }

  // Validate each window date on its own
  if (windowOpenAt !== null && windowOpenAt !== undefined && windowOpenAt !== '') {
    const openDate = new Date(windowOpenAt);
    if (isNaN(openDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid assessment window open date format.',
        code: 'INVALID_DATES',
      });
    }
  }
  if (windowCloseAt !== null && windowCloseAt !== undefined && windowCloseAt !== '') {
    const closeDate = new Date(windowCloseAt);
    if (isNaN(closeDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid assessment window close date format.',
        code: 'INVALID_DATES',
      });
    }
  }
  if (windowOpenAt && windowCloseAt) {
    if (new Date(windowCloseAt) <= new Date(windowOpenAt)) {
      return res.status(400).json({
        error: 'Assessment window close time must be strictly later than open time.',
        code: 'INVALID_WINDOW_RANGE',
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Check Course Allocation
    const courseCheck = await client.query(`
      SELECT course_id, code, title 
      FROM courses 
      WHERE course_id = $1;
    `, [courseId]);

    if (courseCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Course not found',
        code: 'COURSE_NOT_FOUND',
      });
    }

    const testId = `test_${courseId.toLowerCase()}_${Date.now()}`;

    // Finding 7.2: Retire only earlier OFFICIAL_TEST rows (preserve practice drills)
    await client.query(`
      UPDATE quizzes 
      SET is_active_for_new_attempts = FALSE, status = 'CLOSED'
      WHERE course_id = $1 
        AND quiz_type = 'OFFICIAL_TEST'
        AND is_active_for_new_attempts = TRUE;
    `, [courseId]);

    // 2. Insert Official Test Record
    const testResult = await client.query(`
      INSERT INTO quizzes (
        quiz_id,
        course_id,
        title,
        description,
        duration_minutes,
        total_points,
        version,
        status,
        quiz_type,
        auto_zero,
        window_open_at,
        window_close_at,
        is_active_for_new_attempts,
        published_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 1, 'ACTIVE', 'OFFICIAL_TEST', $7, $8, $9, TRUE, NOW()
      )
      RETURNING *;
    `, [
      testId,
      courseId,
      title.trim(),
      description,
      parseInt(durationMinutes, 10) || 30,
      parseFloat(totalPoints) || 20.00,
      autoZero !== false,
      windowOpenAt ? new Date(windowOpenAt) : new Date(),
      windowCloseAt ? new Date(windowCloseAt) : null,
    ]);

    const createdTest = testResult.rows[0];

    // 3. Attach Questions to the Test
    let copiedQuestionsCount = 0;
    if (Array.isArray(questionIds) && questionIds.length > 0) {
      const qRes = await client.query(`
        INSERT INTO quiz_questions (
          question_id,
          quiz_id,
          question_number,
          type,
          prompt,
          options,
          correct_option_id,
          points
        )
        SELECT 
          'qq_' || substring(md5(random()::text || q.question_id) from 1 for 16),
          $1::varchar,
          row_number() over (order by q.question_number),
          q.type,
          q.prompt,
          q.options,
          q.correct_option_id,
          q.points
        FROM quiz_questions q
        JOIN quizzes qz ON qz.quiz_id = q.quiz_id
        WHERE q.question_id = ANY($2::varchar[])
          AND qz.course_id = $3::varchar
        RETURNING question_id;
      `, [testId, questionIds, courseId]);
      copiedQuestionsCount = qRes.rowCount;
    } else {
      // Copy all questions from the latest quiz/practice bank for this course
      const qRes = await client.query(`
        INSERT INTO quiz_questions (
          question_id,
          quiz_id,
          question_number,
          type,
          prompt,
          options,
          correct_option_id,
          points
        )
        SELECT 
          'qq_' || substring(md5(random()::text || q.question_id) from 1 for 16),
          $1::varchar,
          row_number() over (order by q.question_number),
          q.type,
          q.prompt,
          q.options,
          q.correct_option_id,
          q.points
        FROM quiz_questions q
        JOIN quizzes qz ON qz.quiz_id = q.quiz_id
        WHERE qz.course_id = $2 
          AND qz.quiz_id != $1::varchar 
          AND qz.status != 'CLOSED'
        ORDER BY q.question_number ASC
        RETURNING question_id;
      `, [testId, courseId]);
      copiedQuestionsCount = qRes.rowCount;
    }

    // Finding 7.4: Reject an empty test
    if (copiedQuestionsCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Cannot publish an official test with 0 questions. Please add questions to the question bank first.',
        code: 'NO_QUESTIONS_FOUND',
      });
    }

    await client.query('COMMIT');

    logger.info({
      courseId,
      testId,
      title,
      durationMinutes,
      autoZero,
      copiedQuestionsCount,
      lecturerId,
    }, '[QuestionBank] Official test created & published');

    return res.status(201).json({
      status: 'PUBLISHED',
      test: createdTest,
      copiedQuestionsCount,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: err?.message || err, courseId, lecturerId }, '[QuestionBank] Official test publish failed');
    next(err);
  } finally {
    client.release();
  }
});

export default router;
