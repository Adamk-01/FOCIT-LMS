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
          JOIN quizzes qz ON qz.quiz_id = q.quiz_id
          WHERE qz.course_id = $2 
            AND qz.quiz_id != $1::varchar 
            AND qz.status != 'CLOSED'
            AND qz.quiz_id = (
              SELECT q_sub.quiz_id FROM quizzes q_sub
              WHERE q_sub.course_id = $2 
                AND q_sub.quiz_id != $1::varchar
                AND q_sub.status != 'CLOSED'
                AND EXISTS (SELECT 1 FROM quiz_questions qq WHERE qq.quiz_id = q_sub.quiz_id)
              ORDER BY (q_sub.quiz_type = 'SELF_PRACTICE') DESC, q_sub.is_active_for_new_attempts DESC, q_sub.version DESC
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

export default router;
