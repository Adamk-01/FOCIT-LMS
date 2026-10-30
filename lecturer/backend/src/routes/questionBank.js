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
import crypto from 'node:crypto';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { syncFocitQuizToMoodle } from '../integrations/moodle/moodle.quizzes.js';

const router = express.Router();

/**
 * Zero-Trust Authorization Barrier for Question Bank & Test Authoring:
 * Strictly restricts access to academic staff allocated to the course,
 * the Department HOD, or Administrators.
 * Prevents Student Answer Key Leakage (CWE-200) and BOLA/IDOR (CWE-639).
 */
async function requireLecturerForCourse(req, res, next) {
  try {
    const userRole = String(req.user?.role || '').toUpperCase();
    const isAcademicStaff = ['LECTURER', 'LEVEL_ADVISOR', 'HOD', 'ADMIN', 'SYSTEM_ADMIN'].includes(userRole);

    if (!isAcademicStaff) {
      return res.status(403).json({
        error: 'Forbidden: Question Bank access and assessment authoring is strictly restricted to academic faculty.',
        code: 'FORBIDDEN_NOT_FACULTY',
      });
    }

    const { courseId } = req.params;
    if (!courseId) {
      return res.status(400).json({
        error: 'Course ID parameter is required.',
        code: 'MISSING_COURSE_ID',
      });
    }

    // Verify course existence for ALL roles (including ADMIN) to avoid silent 200/500 errors on invalid courses
    const { rows: courseRows } = await pool.query(
      `SELECT course_id, code, title, department_id FROM courses WHERE course_id = $1 LIMIT 1`,
      [courseId]
    );

    if (courseRows.length === 0) {
      return res.status(404).json({
        error: 'Course not found in academic catalog',
        code: 'COURSE_NOT_FOUND',
      });
    }

    const course = courseRows[0];
    req.course = course;

    if (['ADMIN', 'SYSTEM_ADMIN'].includes(userRole)) {
      req.facultyScope = {
        advisor_id: req.user?.id || 'admin',
        full_name: 'Administrator',
        role: userRole,
        isSystemAdmin: true,
      };
      return next();
    }

    const identifier = req.user?.email || req.user?.username || req.user?.id || req.user?.student_id;

    const { rows: staffRows } = await pool.query(
      `SELECT advisor_id, staff_number, full_name, email, department_id, role
       FROM staff_advisors
       WHERE email = $1 OR advisor_id = $1 OR staff_number = $1
       LIMIT 1`,
      [identifier]
    );

    if (staffRows.length === 0) {
      return res.status(403).json({
        error: 'Staff academic record not found',
        code: 'STAFF_RECORD_NOT_FOUND',
      });
    }

    const staff = staffRows[0];

    // Department HOD has managerial oversight of all courses within their department
    if (staff.role === 'HOD' && staff.department_id === course.department_id) {
      req.facultyScope = staff;
      return next();
    }

    // Must be officially allocated to teach this course in hod_course_allocations
    // Do not gate teaching authorization on student registration status (is_registration_open)
    const { rows: allocRows } = await pool.query(
      `SELECT 1 FROM hod_course_allocations
       WHERE course_id = $1 AND lecturer_id = $2
       LIMIT 1`,
      [courseId, staff.advisor_id]
    );

    if (allocRows.length === 0) {
      return res.status(403).json({
        error: 'Forbidden: You are not officially allocated to teach this course.',
        code: 'COURSE_NOT_ALLOCATED',
      });
    }

    req.facultyScope = staff;
    next();
  } catch (err) {
    logger.error({ err: err?.message || err }, '[QuestionBank] Authorization check failure');
    next(err);
  }
}

/**
 * GET /api/courses/:courseId/question-bank
 * Retrieves questions, revision status, and metrics for the Lecturer View (Screen 5).
 * Guaranteed to return courseCode and courseTitle even if no quizzes exist.
 */
router.get('/:courseId/question-bank', requireLecturerForCourse, async (req, res, next) => {
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
        q.quiz_type,
        q.is_active_for_new_attempts,
        q.published_at,
        c.code AS course_code,
        c.title AS course_title
      FROM quizzes q
      JOIN courses c ON c.course_id = q.course_id
      WHERE q.course_id = $1
      ORDER BY q.version DESC;
    `, [courseId]);

    // Course metadata guaranteed via req.course (even when zero quizzes exist)
    const courseCode = req.course?.code || quizResult.rows[0]?.course_code || courseId;
    const courseTitle = req.course?.title || quizResult.rows[0]?.course_title || courseId;

    // Select strictly the practice revision for the question-bank view
    const practiceQuizzes = quizResult.rows.filter((q) => q.quiz_type === 'SELF_PRACTICE');
    const activeQuiz =
      practiceQuizzes.find((q) => q.is_active_for_new_attempts) ||
      practiceQuizzes[0] ||
      null;

    if (!activeQuiz) {
      return res.status(200).json({
        courseId,
        courseCode,
        courseTitle,
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
      courseCode,
      courseTitle,
      activeQuiz: {
        id: activeQuiz.quiz_id,
        title: activeQuiz.title,
        version: activeQuiz.version,
        status: activeQuiz.status,
        durationMinutes: activeQuiz.duration_minutes,
        totalPoints: Number(activeQuiz.total_points),
        publishedAt: activeQuiz.published_at,
      },
      revisions: practiceQuizzes.map((r) => ({
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
router.post('/:courseId/question-bank/publish', requireLecturerForCourse, async (req, res, next) => {
  const { courseId } = req.params;
  const { targetQuizId, expectedPreviousQuizId } = req.body;
  const lecturerId = req.facultyScope?.advisor_id || req.user?.username || req.user?.id || 'lecturer1';

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

    // 4. Verify Target Revision Eligibility FIRST to bind its quiz_type
    const targetQuizResult = await client.query(`
      SELECT quiz_id, course_id, version, status, is_active_for_new_attempts, quiz_type
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

    // 5. Probe Currently Active Revision FOR THE SAME QUIZ_TYPE
    // Invariant: CAS check compares against active revision of same type, avoiding false collisions with official tests
    const currentActiveResult = await client.query(`
      SELECT quiz_id, version, status
      FROM quizzes
      WHERE course_id = $1 
        AND quiz_type = $2
        AND is_active_for_new_attempts = TRUE
      LIMIT 1;
    `, [courseId, targetQuiz.quiz_type]);

    const currentActiveQuiz = currentActiveResult.rows[0] || null;

    // 6. Optimistic CAS Guard: Detect Concurrent Publication Races for the same quiz_type
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
    // Step 8A: Retire any currently active revisions for this course OF THE SAME QUIZ_TYPE
    // Invariant: Publishing a SELF_PRACTICE quiz does NOT deactivate an ongoing OFFICIAL_TEST (and vice versa)
    await client.query(`
      UPDATE quizzes 
      SET is_active_for_new_attempts = FALSE 
      WHERE course_id = $1 
        AND quiz_type = $2
        AND is_active_for_new_attempts = TRUE;
    `, [courseId, targetQuiz.quiz_type]);

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
 * Creates a manual question with validation, synchronized total points, and safe numbering.
 */
router.post('/:courseId/question-bank/questions', requireLecturerForCourse, async (req, res, next) => {
  const { courseId } = req.params;
  const { quizId, questionNumber, prompt, options, correctOptionId, points = 1.0, type = 'MULTIPLE_CHOICE' } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim() || !options || !correctOptionId) {
    return res.status(400).json({
      error: 'prompt, options, and correctOptionId are required',
      code: 'MISSING_FIELDS',
    });
  }

  // Parse and validate options array
  let optionsArray = options;
  if (typeof options === 'string') {
    try {
      optionsArray = JSON.parse(options);
    } catch {
      return res.status(400).json({
        error: 'options must be a valid JSON array of choices',
        code: 'INVALID_OPTIONS_JSON',
      });
    }
  }

  if (!Array.isArray(optionsArray) || optionsArray.length < 2) {
    return res.status(400).json({
      error: 'options must be an array containing at least 2 choices',
      code: 'INSUFFICIENT_OPTIONS',
    });
  }

  const optionExists = optionsArray.some((opt) => String(opt?.id) === String(correctOptionId));
  if (!optionExists) {
    return res.status(422).json({
      error: 'Referential Integrity Violation: correctOptionId must exist in the provided options array.',
      code: 'CORRECT_OPTION_MEMBERSHIP_VIOLATION',
    });
  }

  const validTypes = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER'];
  const sanitizedType = validTypes.includes(type) ? type : 'MULTIPLE_CHOICE';
  const numericPoints = Math.max(0.25, parseFloat(points) || 1.0);

  try {
    let effectiveQuizId = quizId;
    if (effectiveQuizId) {
      // Security Validation: Verify that supplied quizId belongs to :courseId
      const quizCheck = await pool.query(
        `SELECT quiz_id, course_id FROM quizzes WHERE quiz_id = $1 LIMIT 1`,
        [effectiveQuizId]
      );

      if (quizCheck.rows.length === 0) {
        return res.status(404).json({
          error: 'Target quiz revision not found',
          code: 'QUIZ_NOT_FOUND',
        });
      }
      if (quizCheck.rows[0].course_id !== courseId) {
        return res.status(400).json({
          error: `Referential Integrity Error: Specified quiz '${effectiveQuizId}' does not belong to course '${courseId}'`,
          code: 'QUIZ_COURSE_MISMATCH',
        });
      }
    } else {
      // Find or lazily initialize practice quiz for this course, ordering by active and version
      const existing = await pool.query(
        `SELECT quiz_id FROM quizzes 
         WHERE course_id = $1 AND quiz_type = 'SELF_PRACTICE' 
         ORDER BY is_active_for_new_attempts DESC, version DESC 
         LIMIT 1`,
        [courseId]
      );
      if (existing.rows.length > 0) {
        effectiveQuizId = existing.rows[0].quiz_id;
      } else {
        effectiveQuizId = `practice_${courseId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        await pool.query(
          `INSERT INTO quizzes (quiz_id, course_id, title, description, duration_minutes, total_points, status, quiz_type, auto_zero, is_active_for_new_attempts)
           VALUES ($1, $2, $3, $4, 0, 0, 'ACTIVE', 'SELF_PRACTICE', FALSE, TRUE)
           ON CONFLICT (quiz_id) DO NOTHING`,
          [effectiveQuizId, courseId, `${req.course?.code || courseId} Practice Assessment`, 'Formative practice questions']
        );
      }
    }

    let qNum = parseInt(questionNumber, 10);
    if (!qNum || isNaN(qNum)) {
      const maxRes = await pool.query(
        `SELECT COALESCE(MAX(question_number), 0) + 1 AS next_qnum FROM quiz_questions WHERE quiz_id = $1`,
        [effectiveQuizId]
      );
      qNum = parseInt(maxRes.rows[0]?.next_qnum, 10) || 1;
    }

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
      effectiveQuizId,
      qNum,
      sanitizedType,
      prompt.trim(),
      JSON.stringify(optionsArray),
      correctOptionId,
      numericPoints,
    ]);

    // Synchronize parent quiz total_points
    await pool.query(`
      UPDATE quizzes
      SET total_points = (
        SELECT COALESCE(SUM(points), 0) FROM quiz_questions WHERE quiz_id = $1
      )
      WHERE quiz_id = $1;
    `, [effectiveQuizId]);

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({
        error: `Question number conflict: Question number ${questionNumber || 'specified'} already exists in this quiz.`,
        code: 'QUESTION_NUMBER_COLLISION',
      });
    }
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
router.post('/:courseId/tests/publish', requireLecturerForCourse, async (req, res, next) => {
  const { courseId } = req.params;
  const lecturerId = req.facultyScope?.advisor_id || req.user?.username || req.user?.id || 'lecturer1';

  const {
    title,
    description = '',
    durationMinutes = 30,
    totalPoints = 20,
    windowOpenAt = null,
    windowCloseAt = null,
    autoZero = true,
    questionIds = [],
    randomQuestionCount = 0,
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

    // 1. Check Course Allocation and lock course row
    const courseCheck = await client.query(`
      SELECT course_id, code, title 
      FROM courses 
      WHERE course_id = $1
      FOR NO KEY UPDATE;
    `, [courseId]);

    if (courseCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Course not found',
        code: 'COURSE_NOT_FOUND',
      });
    }

    // Generate safe testId strictly capped under 32 characters (VARCHAR(32))
    const cleanCourse = courseId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const testId = `t_${cleanCourse}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    // Finding 7.2: Retire only earlier OFFICIAL_TEST rows (preserve practice drills)
    await client.query(`
      UPDATE quizzes 
      SET is_active_for_new_attempts = FALSE, status = 'CLOSED'
      WHERE course_id = $1 
        AND quiz_type = 'OFFICIAL_TEST'
        AND is_active_for_new_attempts = TRUE;
    `, [courseId]);

    const sanitizedDuration = Math.max(1, parseInt(durationMinutes, 10) || 30);
    const sanitizedPoints = Math.max(1, parseFloat(totalPoints) || 20.00);

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
      sanitizedDuration,
      sanitizedPoints,
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
      // Copy questions from the active practice bank, supporting randomQuestionCount
      const limitCount = parseInt(randomQuestionCount, 10) || 0;
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
          'qq_' || substring(md5(random()::text || src.question_id) from 1 for 16),
          $1::varchar,
          row_number() over (order by (case when $3::int > 0 then random() else src.question_number::text::float end)),
          src.type,
          src.prompt,
          src.options,
          src.correct_option_id,
          src.points
        FROM (
          SELECT q.*
          FROM quiz_questions q
          WHERE q.quiz_id = (
            SELECT q_sub.quiz_id FROM quizzes q_sub
            WHERE q_sub.course_id = $2 
              AND q_sub.quiz_id != $1::varchar
              AND q_sub.status = 'ACTIVE'
              AND EXISTS (SELECT 1 FROM quiz_questions qq WHERE qq.quiz_id = q_sub.quiz_id)
            ORDER BY 
              (q_sub.quiz_type = 'SELF_PRACTICE' AND q_sub.is_active_for_new_attempts = TRUE) DESC,
              (q_sub.quiz_type = 'SELF_PRACTICE') DESC,
              q_sub.is_active_for_new_attempts DESC,
              q_sub.version DESC,
              q_sub.created_at DESC
            LIMIT 1
          )
          ORDER BY (case when $3::int > 0 then random() else q.question_number::text::float end)
          LIMIT (case when $3::int > 0 then $3::int else 500 end)
        ) src
        RETURNING question_id;
      `, [testId, courseId, limitCount]);
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
      durationMinutes: sanitizedDuration,
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

/**
 * ============================================================================
 * TEST-FIRST QUESTION BANK & MOODLE SYNC REST APIS
 * ============================================================================
 */

/**
 * GET /:courseId/tests
 * Retrieves all tests/quizzes belonging to the course with question counts and Moodle sync telemetry.
 */
router.get('/:courseId/tests', requireLecturerForCourse, async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const query = `
      SELECT 
        q.quiz_id,
        q.course_id,
        q.title,
        q.description,
        q.duration_minutes,
        q.total_points,
        q.status,
        q.version,
        q.is_active_for_new_attempts,
        q.published_at,
        q.quiz_type,
        q.question_format,
        q.sync_to_moodle,
        q.created_by,
        q.created_at,
        q.window_open_at,
        q.window_close_at,
        COUNT(qq.question_id)::int AS question_count,
        COALESCE(SUM(qq.points), 0)::numeric AS calculated_points,
        mqm.moodle_quiz_id,
        mqm.moodle_course_id,
        mqm.moodle_cmid,
        mqm.sync_status AS moodle_sync_status,
        mqm.last_synced_at AS moodle_last_synced_at
      FROM quizzes q
      LEFT JOIN quiz_questions qq ON qq.quiz_id = q.quiz_id
      LEFT JOIN moodle_quiz_mappings mqm ON mqm.focit_quiz_id = q.quiz_id
      WHERE q.course_id = $1
      GROUP BY q.quiz_id, mqm.moodle_quiz_id, mqm.moodle_course_id, mqm.moodle_cmid, mqm.sync_status, mqm.last_synced_at
      ORDER BY q.created_at DESC;
    `;
    const { rows } = await pool.query(query, [courseId]);
    return res.json({ tests: rows });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId: req.params.courseId }, '[QuestionBank] Failed to list tests');
    next(err);
  }
});

/**
 * POST /:courseId/tests
 * Test-first authoring: Creates a new assessment container with chosen format and Moodle sync hook.
 */
router.post('/:courseId/tests', requireLecturerForCourse, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { courseId } = req.params;
    const {
      title,
      description,
      durationMinutes = 30,
      totalPoints = 100,
      quizType = 'OFFICIAL_TEST',
      questionFormat = 'MULTIPLE_CHOICE',
      syncToMoodle = true,
      windowOpenAt,
      windowCloseAt,
      isActive = false
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        error: 'Test title is required',
        code: 'MISSING_TEST_TITLE'
      });
    }

    const validFormats = ['MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'MIXED'];
    if (!validFormats.includes(questionFormat)) {
      return res.status(400).json({
        error: `Invalid questionFormat. Must be one of: ${validFormats.join(', ')}`,
        code: 'INVALID_QUESTION_FORMAT'
      });
    }

    const testId = `test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const staffId = req.facultyScope?.advisor_id || req.user?.id || 'staff';

    await client.query('BEGIN');

    if (isActive && quizType === 'OFFICIAL_TEST') {
      await client.query(`
        UPDATE quizzes 
        SET is_active_for_new_attempts = false
        WHERE course_id = $1 AND quiz_type = 'OFFICIAL_TEST' AND is_active_for_new_attempts = true
      `, [courseId]);
    }

    const insertRes = await client.query(`
      INSERT INTO quizzes (
        quiz_id, course_id, title, description, duration_minutes, total_points,
        status, version, is_active_for_new_attempts, quiz_type, auto_zero,
        question_format, sync_to_moodle, created_by, window_open_at, window_close_at,
        created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, 1, $8, $9, false,
        $10, $11, $12, $13, $14,
        NOW()
      ) RETURNING *;
    `, [
      testId, courseId, title.trim(), description?.trim() || null, Number(durationMinutes) || 30,
      Number(totalPoints) || 100, isActive ? 'ACTIVE' : 'DRAFT', Boolean(isActive), quizType,
      questionFormat, Boolean(syncToMoodle), staffId, windowOpenAt || null, windowCloseAt || null
    ]);

    const createdTest = insertRes.rows[0];

    if (syncToMoodle) {
      await client.query(`
        INSERT INTO integration_outbox_events (
          event_id, event_type, aggregate_type, aggregate_id, payload, status, created_at
        ) VALUES (
          gen_random_uuid(), 'MOODLE_QUIZ_SYNC', 'QUIZ', $1, $2, 'PENDING', NOW()
        );
      `, [testId, JSON.stringify({ quizId: testId, courseId, title: title.trim() })]);
    }

    await client.query('COMMIT');

    if (syncToMoodle) {
      syncFocitQuizToMoodle(testId).catch(err => {
        logger.warn({ testId, err: err?.message || err }, '[QuestionBank] Immediate Moodle sync background error');
      });
    }

    return res.status(201).json({
      test: createdTest,
      message: 'Test created successfully'
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: err?.message || err, courseId: req.params.courseId }, '[QuestionBank] Create test failed');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * GET /:courseId/tests/:quizId
 * Returns test details and its questions.
 */
router.get('/:courseId/tests/:quizId', requireLecturerForCourse, async (req, res, next) => {
  try {
    const { courseId, quizId } = req.params;
    const testRes = await pool.query(`
      SELECT 
        q.*,
        mqm.moodle_quiz_id,
        mqm.moodle_course_id,
        mqm.moodle_cmid,
        mqm.sync_status AS moodle_sync_status,
        mqm.last_synced_at AS moodle_last_synced_at
      FROM quizzes q
      LEFT JOIN moodle_quiz_mappings mqm ON mqm.focit_quiz_id = q.quiz_id
      WHERE q.quiz_id = $1 AND q.course_id = $2
      LIMIT 1;
    `, [quizId, courseId]);

    if (testRes.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found', code: 'TEST_NOT_FOUND' });
    }

    const test = testRes.rows[0];

    const questionsRes = await pool.query(`
      SELECT 
        question_id, quiz_id, question_number, prompt, options, correct_option_id,
        points, type, explanation, created_at
      FROM quiz_questions
      WHERE quiz_id = $1
      ORDER BY question_number ASC;
    `, [quizId]);

    return res.json({
      test,
      questions: questionsRes.rows
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId: req.params.courseId, quizId: req.params.quizId }, '[QuestionBank] Failed to get test details');
    next(err);
  }
});

/**
 * POST /:courseId/tests/:quizId/questions
 * Adds a question directly to a specific test, enforcing format and syncing to Moodle.
 */
router.post('/:courseId/tests/:quizId/questions', requireLecturerForCourse, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { courseId, quizId } = req.params;
    const {
      prompt,
      type = 'MULTIPLE_CHOICE',
      options = [],
      correctOptionId,
      points = 1,
      explanation = null
    } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Question prompt is required', code: 'MISSING_PROMPT' });
    }

    await client.query('BEGIN');

    const testRes = await client.query(`
      SELECT * FROM quizzes WHERE quiz_id = $1 AND course_id = $2 FOR UPDATE;
    `, [quizId, courseId]);

    if (testRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Test not found', code: 'TEST_NOT_FOUND' });
    }

    const test = testRes.rows[0];

    if (test.question_format && test.question_format !== 'MIXED') {
      if (test.question_format !== type) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Question type ${type} does not match test question format ${test.question_format}`,
          code: 'FORMAT_MISMATCH'
        });
      }
    }

    let finalOptions = [];
    let finalCorrectOptionId = correctOptionId;

    if (type === 'MULTIPLE_CHOICE') {
      if (!Array.isArray(options) || options.length < 2) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Multiple choice questions require at least 2 options', code: 'INVALID_OPTIONS' });
      }
      finalOptions = options.map((opt, idx) => ({
        id: opt.id || `opt_${idx + 1}`,
        text: typeof opt === 'string' ? opt : (opt.text || '')
      }));
      if (!finalCorrectOptionId || !finalOptions.some(o => o.id === finalCorrectOptionId)) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Valid correct_option_id must match one of the options', code: 'INVALID_CORRECT_OPTION' });
      }
    } else if (type === 'TRUE_FALSE') {
      finalOptions = [
        { id: 'true', text: 'True' },
        { id: 'false', text: 'False' }
      ];
      const normalized = String(correctOptionId).toLowerCase();
      if (normalized !== 'true' && normalized !== 'false') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'True/False question correct_option_id must be "true" or "false"', code: 'INVALID_CORRECT_OPTION' });
      }
      finalCorrectOptionId = normalized;
    } else if (type === 'SHORT_ANSWER') {
      const ansText = typeof correctOptionId === 'string' ? correctOptionId.trim() : (options?.[0]?.text || '');
      if (!ansText) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Short answer questions require an expected correct answer text', code: 'MISSING_SHORT_ANSWER' });
      }
      finalOptions = [{ id: 'opt_answer', text: ansText }];
      finalCorrectOptionId = 'opt_answer';
    }

    const maxNumRes = await client.query(`
      SELECT COALESCE(MAX(question_number), 0) + 1 AS next_num
      FROM quiz_questions
      WHERE quiz_id = $1;
    `, [quizId]);
    const nextQuestionNumber = maxNumRes.rows[0].next_num;

    const questionId = `q_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const insertQRes = await client.query(`
      INSERT INTO quiz_questions (
        question_id, quiz_id, question_number, prompt, options, correct_option_id,
        points, type, explanation, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, NOW()
      ) RETURNING *;
    `, [
      questionId, quizId, nextQuestionNumber, prompt.trim(), JSON.stringify(finalOptions),
      finalCorrectOptionId, Number(points) || 1, type, explanation?.trim() || null
    ]);

    const createdQuestion = insertQRes.rows[0];

    if (test.sync_to_moodle) {
      await client.query(`
        INSERT INTO integration_outbox_events (
          event_id, event_type, aggregate_type, aggregate_id, payload, status, created_at
        ) VALUES (
          gen_random_uuid(), 'MOODLE_QUESTION_SYNC', 'QUESTION', $1, $2, 'PENDING', NOW()
        );
      `, [questionId, JSON.stringify({ questionId, quizId, courseId })]);
    }

    await client.query('COMMIT');

    if (test.sync_to_moodle) {
      syncFocitQuizToMoodle(quizId).catch(err => {
        logger.warn({ quizId, questionId, err: err?.message || err }, '[QuestionBank] Immediate question sync error');
      });
    }

    return res.status(201).json({
      question: createdQuestion,
      message: 'Question added to test successfully'
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: err?.message || err, courseId: req.params.courseId, quizId: req.params.quizId }, '[QuestionBank] Add question failed');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * DELETE /:courseId/tests/:quizId/questions/:questionId
 * Removes a question from a test.
 */
router.delete('/:courseId/tests/:quizId/questions/:questionId', requireLecturerForCourse, async (req, res, next) => {
  try {
    const { courseId, quizId, questionId } = req.params;

    const testCheck = await pool.query(`
      SELECT quiz_id FROM quizzes WHERE quiz_id = $1 AND course_id = $2 LIMIT 1;
    `, [quizId, courseId]);

    if (testCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found', code: 'TEST_NOT_FOUND' });
    }

    const delRes = await pool.query(`
      DELETE FROM quiz_questions WHERE question_id = $1 AND quiz_id = $2 RETURNING question_id;
    `, [questionId, quizId]);

    if (delRes.rowCount === 0) {
      return res.status(404).json({ error: 'Question not found in this test', code: 'QUESTION_NOT_FOUND' });
    }

    return res.json({ success: true, message: 'Question removed from test' });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId: req.params.courseId, quizId: req.params.quizId, questionId: req.params.questionId }, '[QuestionBank] Delete question failed');
    next(err);
  }
});

/**
 * POST /:courseId/tests/:quizId/sync-moodle
 * Manual one-click sync to push test and questions directly into Moodle.
 */
router.post('/:courseId/tests/:quizId/sync-moodle', requireLecturerForCourse, async (req, res, next) => {
  try {
    const { courseId, quizId } = req.params;

    const testCheck = await pool.query(`
      SELECT quiz_id FROM quizzes WHERE quiz_id = $1 AND course_id = $2 LIMIT 1;
    `, [quizId, courseId]);

    if (testCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found', code: 'TEST_NOT_FOUND' });
    }

    const syncResult = await syncFocitQuizToMoodle(quizId);

    return res.json({
      success: true,
      message: 'Test and questions synced to Moodle successfully',
      result: syncResult
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId: req.params.courseId, quizId: req.params.quizId }, '[QuestionBank] Manual Moodle sync failed');
    return res.status(500).json({
      error: `Moodle synchronization failed: ${err.message || 'Unknown error'}`,
      code: 'MOODLE_SYNC_FAILED'
    });
  }
});

/**
 * PUT /:courseId/tests/:quizId/status
 * Updates status (DRAFT / ACTIVE / CLOSED) or activation flag.
 */
router.put('/:courseId/tests/:quizId/status', requireLecturerForCourse, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { courseId, quizId } = req.params;
    const { isActive, status } = req.body;

    await client.query('BEGIN');

    const testRes = await client.query(`
      SELECT * FROM quizzes WHERE quiz_id = $1 AND course_id = $2 FOR UPDATE;
    `, [quizId, courseId]);

    if (testRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Test not found', code: 'TEST_NOT_FOUND' });
    }

    const current = testRes.rows[0];

    // Ensure test has questions before publishing to students
    if (isActive) {
      const qCountRes = await client.query('SELECT COUNT(*)::int AS cnt FROM quiz_questions WHERE quiz_id = $1', [quizId]);
      if (qCountRes.rows[0].cnt === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Cannot publish a test with 0 questions. Please add questions before publishing to students.',
          code: 'CANNOT_PUBLISH_EMPTY_TEST'
        });
      }
    }

    if (isActive && current.quiz_type === 'OFFICIAL_TEST') {
      await client.query(`
        UPDATE quizzes
        SET is_active_for_new_attempts = false
        WHERE course_id = $1 AND quiz_type = 'OFFICIAL_TEST' AND is_active_for_new_attempts = true;
      `, [courseId]);
    }

    const updateRes = await client.query(`
      UPDATE quizzes
      SET 
        is_active_for_new_attempts = COALESCE($1, is_active_for_new_attempts),
        status = COALESCE($2, status),
        published_at = CASE WHEN $1 = true AND published_at IS NULL THEN NOW() ELSE published_at END
      WHERE quiz_id = $3
      RETURNING *;
    `, [isActive !== undefined ? Boolean(isActive) : null, status || null, quizId]);

    await client.query('COMMIT');

    return res.json({ test: updateRes.rows[0], message: 'Test status updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});


/**
 * POST /:courseId/tests/:quizId/duplicate-as-practice
 * Duplicates a completed or current test into an ongoing Formative Self-Practice Drill
 * so students can practice all questions anytime with anti-memorization shuffling.
 */
router.post('/:courseId/tests/:quizId/duplicate-as-practice', requireLecturerForCourse, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { courseId, quizId } = req.params;
    await client.query('BEGIN');

    const srcRes = await client.query(`
      SELECT * FROM quizzes WHERE quiz_id = $1 AND course_id = $2 FOR SHARE;
    `, [quizId, courseId]);

    if (srcRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Source test not found', code: 'TEST_NOT_FOUND' });
    }

    const src = srcRes.rows[0];
    const newQuizId = `drill_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const newTitle = src.title.includes('Practice Drill') ? `${src.title} (Copy)` : `${src.title} (Practice Drill)`;
    const staffId = req.facultyScope?.advisor_id || req.user?.id || 'staff';

    const insertQuiz = await client.query(`
      INSERT INTO quizzes (
        quiz_id, course_id, title, description, duration_minutes, total_points,
        status, version, is_active_for_new_attempts, quiz_type, auto_zero,
        question_format, sync_to_moodle, created_by, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        'ACTIVE', 1, true, 'SELF_PRACTICE', false,
        $7, false, $8, NOW()
      ) RETURNING *;
    `, [
      newQuizId,
      courseId,
      newTitle,
      src.description || 'Unlimited formative self-practice drill with dynamic anti-memorization shuffling.',
      src.duration_minutes || 30,
      src.total_points || 100,
      src.question_format || 'MIXED',
      staffId
    ]);

    // Copy all questions
    const qCopyRes = await client.query(`
      INSERT INTO quiz_questions (
        question_id, quiz_id, question_number, prompt, options, correct_option_id,
        points, type, explanation, created_at
      )
      SELECT 
        'q_drill_' || gen_random_uuid(),
        $1,
        question_number,
        prompt,
        options,
        correct_option_id,
        points,
        type,
        explanation,
        NOW()
      FROM quiz_questions
      WHERE quiz_id = $2
      RETURNING question_id;
    `, [newQuizId, quizId]);

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Practice drill created successfully',
      test: insertQuiz.rows[0],
      copiedQuestionsCount: qCopyRes.rowCount
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: err?.message || err, courseId: req.params.courseId, quizId: req.params.quizId }, '[QuestionBank] Duplicate as practice failed');
    next(err);
  } finally {
    client.release();
  }
});


/**
 * POST /:courseId/tests/sync-all
 * Batch reconciles all pending tests for the course into Moodle.
 */
router.post('/:courseId/tests/sync-all', requireLecturerForCourse, async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const pendingQuizzes = await pool.query(`
      SELECT q.quiz_id
      FROM quizzes q
      LEFT JOIN moodle_quiz_mappings mqm ON mqm.focit_quiz_id = q.quiz_id
      WHERE q.course_id = $1 AND q.sync_to_moodle = true AND mqm.moodle_quiz_id IS NULL;
    `, [courseId]);

    const results = [];
    for (const q of pendingQuizzes.rows) {
      try {
        const syncRes = await syncFocitQuizToMoodle(q.quiz_id);
        results.push(syncRes);
      } catch (err) {
        logger.warn({ quizId: q.quiz_id, err: err?.message }, '[QuestionBank] Error syncing single quiz in sync-all');
      }
    }

    return res.json({
      success: true,
      syncedCount: results.length,
      results
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId: req.params.courseId }, '[QuestionBank] Sync all failed');
    next(err);
  }
});

export default router;
