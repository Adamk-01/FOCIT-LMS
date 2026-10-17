/**
 * FOCIT LMS - Academic Course Assignments Router
 *
 * Implements:
 * 1. GET /api/courses/:courseId/assignments           -> List published assignments + student submission status
 * 2. GET /api/courses/:courseId/assignments/:assignId -> Single assignment detail & rubric
 * 3. POST /api/courses/:courseId/assignments/:assignId/submit -> Idempotent assignment submission engine
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import express from 'express';
import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const router = express.Router({ mergeParams: true });
const IDEMPOTENCY_TTL_SECONDS = 86400; // 24 hours

/**
 * 1. GET /api/courses/:courseId/assignments
 * Retrieves all published assignments for the course, including the authenticated student's submission status.
 */
router.get('/:courseId/assignments', async (req, res, next) => {
  const { courseId } = req.params;
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  if (!studentId) {
    return res.status(401).json({
      error: 'Unauthenticated: Valid student credentials required',
      code: 'AUTH_REQUIRED',
    });
  }

  try {
    // 1. Verify Course Existence & Student Enrollment Authorization
    const courseRes = await pool.query(
      `SELECT c.course_id, c.code, c.title, c.level, c.units,
              EXISTS (
                SELECT 1 FROM enrollments e 
                WHERE e.student_id = $2 
                  AND e.course_id = c.course_id
                  AND e.status IN ('ENROLLED', 'IN_PROGRESS', 'COMPLETED')
              ) AS is_enrolled
       FROM courses c
       WHERE c.course_id = $1 
          OR c.code = $1 
          OR c.moodle_course_id::text = $1
          OR UPPER(REPLACE(c.course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
          OR UPPER(REPLACE(c.code, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
       LIMIT 1`,
      [courseId, studentId]
    );

    if (courseRes.rows.length === 0) {
      return res.status(404).json({
        error: `Course '${courseId}' not found in academic catalog`,
        code: 'COURSE_NOT_FOUND',
      });
    }

    const course = courseRes.rows[0];
    const canonicalCourseId = course.course_id;

    // Zero-Trust Access Check: Ensure student is enrolled (or is staff/advisor)
    const isStaff = req.user?.role && ['LECTURER', 'ADVISOR', 'ADMIN', 'STAFF'].includes(String(req.user.role).toUpperCase());
    if (!course.is_enrolled && !isStaff) {
      return res.status(403).json({
        error: `Access denied: You must be registered and enrolled in ${course.code} to access assignments`,
        code: 'ENROLLMENT_REQUIRED',
        course_id: canonicalCourseId,
      });
    }

    // 2. Fetch Assignments joined with Student Submissions
    const assignmentsRes = await pool.query(
      `
      SELECT 
        a.assignment_id,
        a.course_id,
        a.title,
        a.description,
        a.lecturer_name,
        a.due_date,
        a.max_points::float AS max_points,
        a.weight_percent,
        a.file_url,
        a.file_name,
        a.file_size_bytes::bigint AS file_size_bytes,
        a.status AS assignment_status,
        a.created_at,
        s.submission_id,
        s.submission_text,
        s.file_url AS submission_file_url,
        s.file_name AS submission_file_name,
        s.file_size_bytes::bigint AS submission_file_size,
        s.submitted_at,
        s.grade::float AS grade,
        s.feedback,
        s.status AS submission_status
      FROM course_assignments a
      LEFT JOIN student_assignment_submissions s 
        ON s.assignment_id = a.assignment_id AND s.student_id = $2
      WHERE a.course_id = $1 AND a.status IN ('PUBLISHED', 'CLOSED')
      ORDER BY a.due_date ASC
      `,
      [canonicalCourseId, studentId]
    );

    const now = Date.now();
    const assignments = assignmentsRes.rows.map((row) => {
      const dueDateEpoch = new Date(row.due_date).getTime();
      const isOverdue = now > dueDateEpoch;

      let submission = null;
      if (row.submission_id) {
        submission = {
          submission_id: row.submission_id,
          submission_text: row.submission_text,
          file_url: row.submission_file_url,
          file_name: row.submission_file_name,
          file_size_bytes: row.submission_file_size ? Number(row.submission_file_size) : null,
          submitted_at: row.submitted_at,
          grade: row.grade !== null ? Number(row.grade) : null,
          feedback: row.feedback,
          status: row.submission_status,
        };
      }

      return {
        assignment_id: row.assignment_id,
        course_id: row.course_id,
        title: row.title,
        description: row.description,
        lecturer_name: row.lecturer_name,
        due_date: row.due_date,
        max_points: Number(row.max_points),
        weight_percent: row.weight_percent,
        file_url: row.file_url,
        file_name: row.file_name,
        file_size_bytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
        status: row.assignment_status,
        is_overdue: isOverdue,
        submission,
      };
    });

    return res.status(200).json({
      course: {
        course_id: course.course_id,
        code: course.code,
        title: course.title,
        units: course.units,
      },
      assignments,
      total: assignments.length,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId, studentId }, '[Assignments] Query error');
    return next(err);
  }
});

/**
 * 2. GET /api/courses/:courseId/assignments/:assignmentId
 * Retrieves detailed single assignment view and submission telemetry.
 */
router.get('/:courseId/assignments/:assignmentId', async (req, res, next) => {
  const { courseId, assignmentId } = req.params;
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  if (!studentId) {
    return res.status(401).json({
      error: 'Unauthenticated: Valid student credentials required',
      code: 'AUTH_REQUIRED',
    });
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        a.assignment_id,
        a.course_id,
        c.code AS course_code,
        c.title AS course_title,
        a.title,
        a.description,
        a.lecturer_name,
        a.due_date,
        a.max_points::float AS max_points,
        a.weight_percent,
        a.file_url,
        a.file_name,
        a.file_size_bytes::bigint AS file_size_bytes,
        a.status AS assignment_status,
        a.created_at,
        s.submission_id,
        s.submission_text,
        s.file_url AS submission_file_url,
        s.file_name AS submission_file_name,
        s.file_size_bytes::bigint AS submission_file_size,
        s.submitted_at,
        s.grade::float AS grade,
        s.feedback,
        s.status AS submission_status
      FROM course_assignments a
      JOIN courses c ON c.course_id = a.course_id
      LEFT JOIN student_assignment_submissions s 
        ON s.assignment_id = a.assignment_id AND s.student_id = $2
      WHERE (a.course_id = $1 OR c.code = $1) AND a.assignment_id = $3
      LIMIT 1
      `,
      [courseId, studentId, assignmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Assignment not found',
        code: 'ASSIGNMENT_NOT_FOUND',
      });
    }

    const row = result.rows[0];
    const isOverdue = Date.now() > new Date(row.due_date).getTime();

    return res.status(200).json({
      assignment_id: row.assignment_id,
      course_id: row.course_id,
      course_code: row.course_code,
      course_title: row.course_title,
      title: row.title,
      description: row.description,
      lecturer_name: row.lecturer_name,
      due_date: row.due_date,
      max_points: Number(row.max_points),
      weight_percent: row.weight_percent,
      file_url: row.file_url,
      file_name: row.file_name,
      file_size_bytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
      status: row.assignment_status,
      is_overdue: isOverdue,
      submission: row.submission_id ? {
        submission_id: row.submission_id,
        submission_text: row.submission_text,
        file_url: row.submission_file_url,
        file_name: row.submission_file_name,
        file_size_bytes: row.submission_file_size ? Number(row.submission_file_size) : null,
        submitted_at: row.submitted_at,
        grade: row.grade !== null ? Number(row.grade) : null,
        feedback: row.feedback,
        status: row.submission_status,
      } : null,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId, assignmentId }, '[Assignments] Fetch single error');
    return next(err);
  }
});

/**
 * 3. POST /api/courses/:courseId/assignments/:assignmentId/submit
 * Idempotently submits or updates a student's assignment work.
 * Enforces:
 * - Redis Fast-Path Idempotency check (<2ms)
 * - Single-RTT Relational Set-Intersection boundary check
 * - Single-Tuple Mutex Lock on existing submission
 * - Preserves submitted_at and status on identical idempotency retries
 * - Immutable once status is 'GRADED' (409 Conflict)
 * - Monotonic status calculation (LATE if submitted after due_date)
 */
router.post('/:courseId/assignments/:assignmentId/submit', async (req, res, next) => {
  const { courseId, assignmentId } = req.params;
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  if (!studentId) {
    return res.status(401).json({
      error: 'Unauthenticated: Valid student credentials required',
      code: 'AUTH_REQUIRED',
    });
  }
  const { submission_text, file_url, file_name, file_size_bytes } = req.body || {};

  const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) {
    return res.status(400).json({
      error: 'Missing or invalid X-Idempotency-Key header.',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }

  const cleanKey = idempotencyKey.trim();

  if (!submission_text?.trim() && !file_url?.trim()) {
    return res.status(400).json({
      error: 'Submission requires either submission_text or an attached file_url.',
      code: 'EMPTY_SUBMISSION_PAYLOAD',
    });
  }

  const redisKey = `idempotency:assign:${studentId}:${cleanKey}`;

  // 1. Redis Fast-Path Idempotency Check (<2ms)
  try {
    if (redis && typeof redis.get === 'function') {
      const cachedPayload = await redis.get(redisKey);
      if (cachedPayload) {
        const parsed = JSON.parse(cachedPayload);
        return res.status(200).set('X-Idempotency-Replay', 'true').json(parsed);
      }
    }
  } catch (_) {
    // Non-fatal: fall through to PostgreSQL ACID ledger if Redis is degraded
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Single-RTT Relational Set-Intersection Boundary Check
    const normalizedCourse = courseId.trim().toUpperCase().replace(/\s+/g, '');
    const boundaryQuery = `
      SELECT 
        a.assignment_id,
        a.due_date,
        a.max_points,
        a.status AS assignment_status,
        c.course_id,
        c.code AS course_code,
        e.enrollment_id
      FROM course_assignments a
      JOIN courses c ON c.course_id = a.course_id
      LEFT JOIN enrollments e 
        ON e.course_id = a.course_id 
       AND e.student_id = $1 
       AND e.status IN ('ENROLLED', 'IN_PROGRESS', 'COMPLETED')
      WHERE a.assignment_id = $2
        AND (UPPER(REPLACE(c.course_id, ' ', '')) = $3 OR UPPER(REPLACE(c.code, ' ', '')) = $3)
        AND a.status != 'DRAFT'
      FOR SHARE OF a;
    `;
    const boundaryRes = await client.query(boundaryQuery, [studentId, assignmentId, normalizedCourse]);

    if (boundaryRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Assignment not found for the specified course.',
        code: 'ASSIGNMENT_NOT_FOUND_FOR_COURSE',
      });
    }

    const boundary = boundaryRes.rows[0];
    const isStaff = req.user?.role && ['LECTURER', 'ADVISOR', 'ADMIN', 'STAFF'].includes(String(req.user.role).toUpperCase());

    if (!boundary.enrollment_id && !isStaff) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: `Access denied: You are not enrolled in ${boundary.course_code}.`,
        code: 'ENROLLMENT_REQUIRED',
      });
    }

    if (boundary.assignment_status === 'CLOSED') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Submissions for this assignment are closed.',
        code: 'ASSIGNMENT_CLOSED',
      });
    }

    // 3. Acquire Single-Tuple Mutex Lock on existing submission (if any)
    const existingQuery = `
      SELECT 
        submission_id,
        assignment_id,
        student_id,
        submission_text,
        file_url,
        file_name,
        file_size_bytes,
        submitted_at,
        grade::float AS grade,
        feedback,
        status,
        idempotency_key
      FROM student_assignment_submissions
      WHERE assignment_id = $1 AND student_id = $2
      FOR UPDATE;
    `;
    const existingRes = await client.query(existingQuery, [assignmentId, studentId]);
    const existing = existingRes.rows[0];

    // Case A: Exact Idempotent Network Retry (preserves original submitted_at & status)
    if (existing && existing.idempotency_key === cleanKey) {
      await client.query('COMMIT');
      const replayPayload = {
        message: 'Assignment submission confirmed (idempotent replay).',
        submission: existing,
      };
      return res.status(200).set('X-Idempotency-Replay', 'true').json(replayPayload);
    }

    // Case B: Lecturer has already graded the submission -> Immutable Lockout
    if (existing && existing.status === 'GRADED') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Cannot modify submission: assignment has already been evaluated and graded by the lecturer.',
        code: 'SUBMISSION_ALREADY_GRADED',
        grade: existing.grade,
      });
    }

    // Case C: First-time submission or valid ungraded update
    const upsertQuery = `
      INSERT INTO student_assignment_submissions (
        assignment_id,
        student_id,
        submission_text,
        file_url,
        file_name,
        file_size_bytes,
        submitted_at,
        status,
        idempotency_key
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, NOW(),
        CASE WHEN NOW() > $7 THEN 'LATE' ELSE 'SUBMITTED' END,
        $8
      )
      ON CONFLICT (assignment_id, student_id)
      DO UPDATE SET
        submission_text = COALESCE(EXCLUDED.submission_text, student_assignment_submissions.submission_text),
        file_url = COALESCE(EXCLUDED.file_url, student_assignment_submissions.file_url),
        file_name = COALESCE(EXCLUDED.file_name, student_assignment_submissions.file_name),
        file_size_bytes = COALESCE(EXCLUDED.file_size_bytes, student_assignment_submissions.file_size_bytes),
        submitted_at = NOW(),
        status = CASE WHEN NOW() > $7 THEN 'LATE' ELSE 'SUBMITTED' END,
        idempotency_key = EXCLUDED.idempotency_key
      WHERE student_assignment_submissions.status != 'GRADED'
      RETURNING 
        submission_id,
        assignment_id,
        student_id,
        submission_text,
        file_url,
        file_name,
        file_size_bytes::bigint AS file_size_bytes,
        submitted_at,
        grade::float AS grade,
        feedback,
        status,
        idempotency_key;
    `;

    const upsertRes = await client.query(upsertQuery, [
      assignmentId,
      studentId,
      submission_text?.trim() || null,
      file_url?.trim() || null,
      file_name?.trim() || null,
      file_size_bytes ? Number(file_size_bytes) : null,
      boundary.due_date,
      cleanKey,
    ]);

    if (upsertRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Cannot modify submission: assignment has already been graded.',
        code: 'SUBMISSION_ALREADY_GRADED',
      });
    }

    await client.query('COMMIT');

    const responsePayload = {
      message: existing ? 'Assignment submission updated successfully.' : 'Assignment submitted successfully.',
      submission: upsertRes.rows[0],
    };

    // 4. Populate Redis Idempotency Cache
    try {
      if (redis && typeof redis.set === 'function') {
        await redis.set(redisKey, JSON.stringify(responsePayload), 'EX', IDEMPOTENCY_TTL_SECONDS);
      }
    } catch (_) {
      // Non-fatal cache write error
    }

    return res.status(existing ? 200 : 201).json(responsePayload);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err: err?.message || err, courseId, assignmentId, studentId }, '[Assignments] Submission error');
    return next(err);
  } finally {
    client.release();
  }
});

export default router;
