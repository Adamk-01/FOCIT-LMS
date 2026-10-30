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
import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { streamAssignmentUpload, PERMANENT_UPLOADS_DIR } from '../middleware/fileUpload.js';
import config from '../config.js';

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

/**
 * Helper to resolve authenticated academic staff/lecturer
 */
async function resolveLecturerAuth(req) {
  const userRole = String(req.user?.role || '').toUpperCase();
  const isStaff = ['LECTURER', 'LEVEL_ADVISOR', 'HOD', 'ADMIN', 'SYSTEM_ADMIN'].includes(userRole);
  if (!isStaff) return null;

  const identifier = req.user?.email || req.user?.username || req.user?.id || req.user?.student_id;
  const staffRes = await pool.query(
    `SELECT advisor_id, staff_number, full_name, email, role, department_id 
     FROM staff_advisors 
     WHERE email = $1 OR advisor_id = $1 OR staff_number = $1 
     LIMIT 1`,
    [identifier]
  );

  // Finding 6: Verify role revocation against database before trusting request role
  if (staffRes.rows.length > 0) {
    const dbRole = String(staffRes.rows[0].role || '').toUpperCase();
    const isDbRoleStaff = ['LECTURER', 'LEVEL_ADVISOR', 'HOD', 'ADMIN', 'SYSTEM_ADMIN'].includes(dbRole);
    if (!isDbRoleStaff) {
      return null;
    }
    return {
      ...staffRes.rows[0],
      role: dbRole,
    };
  }

  // System Administrator: Authoritatively verify active database administrator record
  if (['ADMIN', 'SYSTEM_ADMIN'].includes(userRole)) {
    const adminCheck = await pool.query(
      `SELECT id, email, role FROM system_administrators 
       WHERE (id = $1 OR email = $2 OR username = $2) AND is_active = TRUE
       LIMIT 1`,
      [req.user?.id, req.user?.email || req.user?.username]
    ).catch((err) => {
      logger.warn({ err: err?.message, userId: req.user?.id }, '[AssignmentsAuth] Database administrator lookup error');
      return { rows: [] };
    });

    if (adminCheck.rows.length > 0) {
      // Map verified database admin record to canonical SYSTEM_ADMIN
      return {
        advisor_id: String(adminCheck.rows[0].id),
        staff_number: 'ADMIN',
        full_name: req.user?.name || 'Administrator',
        role: 'SYSTEM_ADMIN',
      };
    }

    // Fail-closed administrator bypass: Strictly allow in local development with explicit opt-in
    const isLocalDev = (process.env.NODE_ENV === 'development' || config?.nodeEnv === 'development')
      && process.env.ALLOW_DEV_ADMIN_BYPASS === 'true';
    if (isLocalDev) {
      return {
        advisor_id: req.user?.id || 'admin',
        staff_number: 'ADMIN',
        full_name: req.user?.name || 'Administrator',
        role: 'SYSTEM_ADMIN',
      };
    }
  }

  return null;
}

/**
 * Course-Level Staff Allocation Guard:
 * Strictly verifies that the authenticated lecturer is allocated to teach this course,
 * or is the departmental HOD, or has system administrator governance privileges.
 */
async function resolveLecturerAuthForCourse(req, courseId) {
  const staff = await resolveLecturerAuth(req);
  if (!staff) return null;
  // Privileges strictly derived from verified active database role
  const activeRole = String(staff.role).toUpperCase();
  if (['ADMIN', 'SYSTEM_ADMIN'].includes(activeRole)) return staff;

  const courseRes = await pool.query(
    `SELECT course_id, department_id FROM courses 
     WHERE course_id = $1 OR code = $1 
        OR UPPER(REPLACE(course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
        OR UPPER(REPLACE(code, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
     LIMIT 1`,
    [courseId]
  );
  if (courseRes.rows.length === 0) return null;
  const canonicalCourseId = courseRes.rows[0].course_id;
  const deptId = courseRes.rows[0].department_id;
  if (activeRole === 'HOD' && staff.department_id === deptId) return staff;

  const allocRes = await pool.query(
    `SELECT 1 FROM hod_course_allocations 
     WHERE course_id = $1 AND lecturer_id = $2 
     LIMIT 1`,
    [canonicalCourseId, staff.advisor_id]
  );
  if (allocRes.rows.length > 0) return staff;

  return null;
}

/**
 * 1B. GET /api/courses/:courseId/assignments/manage
 * Lecturer Workspace: Lists all assignments with submission/grading progress tallies.
 */
router.get('/:courseId/assignments/manage', async (req, res, next) => {
  const { courseId } = req.params;
  try {
    const staff = await resolveLecturerAuthForCourse(req, courseId);
    if (!staff) {
      return res.status(403).json({
        error: 'Forbidden: You must be allocated to teach this course, or be the departmental HOD, to manage its assignments.',
        code: 'FORBIDDEN_COURSE_ALLOCATION',
      });
    }

    const courseRes = await pool.query(
      `SELECT course_id, code, title, units FROM courses
       WHERE course_id = $1 OR code = $1 
          OR UPPER(REPLACE(course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
          OR UPPER(REPLACE(code, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
       LIMIT 1`,
      [courseId]
    );

    if (courseRes.rows.length === 0) {
      return res.status(404).json({
        error: `Course '${courseId}' not found`,
        code: 'COURSE_NOT_FOUND',
      });
    }
    const course = courseRes.rows[0];
    const canonicalCourseId = course.course_id;

    const assignmentsRes = await pool.query(
      `SELECT 
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
         a.status,
         a.created_at,
         COUNT(s.submission_id)::int AS total_submissions,
         COUNT(s.submission_id) FILTER (WHERE s.status = 'GRADED')::int AS graded_submissions,
         COUNT(s.submission_id) FILTER (WHERE s.status IN ('SUBMITTED', 'LATE'))::int AS pending_submissions
       FROM course_assignments a
       LEFT JOIN student_assignment_submissions s ON s.assignment_id = a.assignment_id
       WHERE a.course_id = $1
       GROUP BY a.assignment_id
       ORDER BY a.due_date DESC, a.created_at DESC`,
      [canonicalCourseId]
    );

    const enrolledRes = await pool.query(
      `SELECT COUNT(DISTINCT student_id)::int AS enrolled_count
       FROM enrollments
       WHERE course_id = $1 AND status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')`,
      [canonicalCourseId]
    );

    return res.json({
      course,
      enrolled_count: enrolledRes.rows[0]?.enrolled_count || 0,
      assignments: assignmentsRes.rows,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId }, '[Assignments] Manage fetch error');
    return next(err);
  }
});

/**
 * 1C. POST /api/courses/:courseId/assignments
 * Lecturer Workspace: Publishes or drafts a new course assignment.
 */
router.post('/:courseId/assignments', async (req, res, next) => {
  const { courseId } = req.params;
  try {
    const staff = await resolveLecturerAuthForCourse(req, courseId);
    if (!staff) {
      return res.status(403).json({
        error: 'Forbidden: You must be allocated to teach this course, or be the departmental HOD, to manage its assignments.',
        code: 'FORBIDDEN_COURSE_ALLOCATION',
      });
    }

    const courseRes = await pool.query(
      `SELECT course_id, code, title FROM courses
       WHERE course_id = $1 OR code = $1 
          OR UPPER(REPLACE(course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
          OR UPPER(REPLACE(code, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
       LIMIT 1`,
      [courseId]
    );

    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: `Course '${courseId}' not found`, code: 'COURSE_NOT_FOUND' });
    }
    const canonicalCourseId = courseRes.rows[0].course_id;

    const {
      title,
      description,
      due_date,
      dueDate,
      max_points,
      maxPoints,
      weight_percent,
      weightPercent,
      status = 'PUBLISHED',
      file_url,
      file_name,
      file_size_bytes,
    } = req.body || {};

    const targetDueDate = due_date || dueDate;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Assignment title is required', code: 'TITLE_REQUIRED' });
    }
    if (!targetDueDate) {
      return res.status(400).json({ error: 'Valid due date is required', code: 'DUE_DATE_REQUIRED' });
    }
    const parsedDate = new Date(targetDueDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Valid ISO format due date is required', code: 'INVALID_DUE_DATE' });
    }

    const rawMaxPoints = max_points ?? maxPoints;
    const targetMaxPoints = rawMaxPoints !== undefined ? Number(rawMaxPoints) : 100;
    if (isNaN(targetMaxPoints) || targetMaxPoints <= 0) {
      return res.status(400).json({ error: 'max_points must be a positive number', code: 'INVALID_MAX_POINTS' });
    }

    const rawWeight = weight_percent ?? weightPercent;
    const targetWeight = rawWeight !== undefined ? Number(rawWeight) : 10;
    if (isNaN(targetWeight) || targetWeight < 0 || targetWeight > 100) {
      return res.status(400).json({ error: 'weight_percent must be a number between 0 and 100', code: 'INVALID_WEIGHT' });
    }

    if (status && !['DRAFT', 'PUBLISHED', 'CLOSED'].includes(status)) {
      return res.status(400).json({ error: 'status must be one of: DRAFT, PUBLISHED, CLOSED', code: 'INVALID_STATUS' });
    }
    const targetStatus = status || 'PUBLISHED';

    const insertRes = await pool.query(
      `INSERT INTO course_assignments (
         course_id, title, description, lecturer_name, due_date, max_points, weight_percent,
         file_url, file_name, file_size_bytes, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        canonicalCourseId,
        title.trim(),
        description?.trim() || '',
        staff.full_name || 'Course Lecturer',
        new Date(targetDueDate),
        Number(targetMaxPoints),
        Number(targetWeight),
        file_url?.trim() || null,
        file_name?.trim() || null,
        file_size_bytes ? Number(file_size_bytes) : null,
        targetStatus,
      ]
    );

    return res.status(201).json({
      message: 'Assignment created successfully',
      assignment: insertRes.rows[0],
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId }, '[Assignments] Creation error');
    return next(err);
  }
});

/**
 * 1D. GET /api/courses/:courseId/assignments/:assignmentId/submissions
 * Lecturer Workspace: Lists all enrolled students and their assignment submission statuses.
 */
router.get('/:courseId/assignments/:assignmentId/submissions', async (req, res, next) => {
  const { courseId, assignmentId } = req.params;
  try {
    const staff = await resolveLecturerAuthForCourse(req, courseId);
    if (!staff) {
      return res.status(403).json({
        error: 'Forbidden: You must be allocated to teach this course, or be the departmental HOD, to manage its assignments.',
        code: 'FORBIDDEN_COURSE_ALLOCATION',
      });
    }

    const courseRes = await pool.query(
      `SELECT course_id, code, title FROM courses
       WHERE course_id = $1 OR code = $1 
          OR UPPER(REPLACE(course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
          OR UPPER(REPLACE(code, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
       LIMIT 1`,
      [courseId]
    );
    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found', code: 'COURSE_NOT_FOUND' });
    }
    const canonicalCourseId = courseRes.rows[0].course_id;

    const assignRes = await pool.query(
      `SELECT * FROM course_assignments WHERE assignment_id = $1 AND course_id = $2 LIMIT 1`,
      [assignmentId, canonicalCourseId]
    );
    if (assignRes.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found', code: 'ASSIGNMENT_NOT_FOUND' });
    }

    const submissionsRes = await pool.query(
      `SELECT 
         s.student_id,
         s.matric_number,
         s.full_name,
         s.email,
         s.level,
         sub.submission_id,
         sub.submission_text,
         sub.file_url,
         sub.file_name,
         sub.file_size_bytes::bigint AS file_size_bytes,
         sub.submitted_at,
         sub.grade::float AS grade,
         sub.feedback,
         sub.status AS submission_status
       FROM enrollments e
       JOIN students s ON s.student_id = e.student_id
       LEFT JOIN student_assignment_submissions sub 
         ON sub.student_id = s.student_id AND sub.assignment_id = $1
       WHERE e.course_id = $2 
         AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
       ORDER BY s.matric_number ASC`,
      [assignmentId, canonicalCourseId]
    );

    return res.json({
      assignment: assignRes.rows[0],
      submissions: submissionsRes.rows,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId, assignmentId }, '[Assignments] Submissions fetch error');
    return next(err);
  }
});

/**
 * 1E. PUT /api/courses/:courseId/assignments/:assignmentId/submissions/:submissionId/grade
 * & PUT /api/courses/:courseId/assignments/:assignmentId/grade
 * Lecturer Workspace: Grades a submission and adds feedback.
 */
router.put([
  '/:courseId/assignments/:assignmentId/submissions/:submissionId/grade',
  '/:courseId/assignments/:assignmentId/grade'
], async (req, res, next) => {
  const { courseId, assignmentId, submissionId } = req.params;
  const { submission_id, student_id, grade, feedback } = req.body || {};
  const targetSubmissionId = submissionId || submission_id;

  try {
    const staff = await resolveLecturerAuthForCourse(req, courseId);
    if (!staff) {
      return res.status(403).json({
        error: 'Forbidden: You must be allocated to teach this course, or be the departmental HOD, to manage its assignments.',
        code: 'FORBIDDEN_COURSE_ALLOCATION',
      });
    }

    if (grade === undefined || grade === null || isNaN(Number(grade))) {
      return res.status(400).json({ error: 'Valid numerical grade is required', code: 'INVALID_GRADE' });
    }

    // 1. Verify that assignment belongs to this course and retrieve max_points
    const assignCheck = await pool.query(
      `SELECT a.assignment_id, a.course_id, a.max_points::float AS max_points
       FROM course_assignments a
       JOIN courses c ON c.course_id = a.course_id
       WHERE a.assignment_id = $1 
         AND (c.course_id = $2 OR c.code = $2 
              OR UPPER(REPLACE(c.course_id, ' ', '')) = UPPER(REPLACE($2, ' ', ''))
              OR UPPER(REPLACE(c.code, ' ', '')) = UPPER(REPLACE($2, ' ', '')))
       LIMIT 1`,
      [assignmentId, courseId]
    );
    if (assignCheck.rows.length === 0) {
      return res.status(404).json({
        error: `Assignment '${assignmentId}' not found for course '${courseId}'`,
        code: 'ASSIGNMENT_NOT_FOUND',
      });
    }
    const assignment = assignCheck.rows[0];

    // 2. Validate grade range (0 <= grade <= max_points)
    const numGrade = Number(grade);
    if (numGrade < 0 || numGrade > assignment.max_points) {
      return res.status(400).json({
        error: `Grade must be a number between 0 and ${assignment.max_points}`,
        code: 'GRADE_OUT_OF_RANGE',
      });
    }

    let updated;
    if (targetSubmissionId) {
      // 3. Scope grade write strictly to submission_id AND assignment_id
      const updateRes = await pool.query(
        `UPDATE student_assignment_submissions
         SET grade = $1, feedback = $2, status = 'GRADED'
         WHERE submission_id = $3 AND assignment_id = $4
         RETURNING *`,
        [numGrade, feedback || null, targetSubmissionId, assignment.assignment_id]
      );
      if (updateRes.rows.length === 0) {
        return res.status(404).json({
          error: `Submission '${targetSubmissionId}' not found for assignment '${assignmentId}'`,
          code: 'SUBMISSION_NOT_FOUND',
        });
      }
      updated = updateRes.rows[0];
    } else if (student_id) {
      const upsertRes = await pool.query(
        `INSERT INTO student_assignment_submissions (
           assignment_id, student_id, grade, feedback, status, submitted_at
         )
         VALUES ($1, $2, $3, $4, 'GRADED', NOW())
         ON CONFLICT (assignment_id, student_id)
         DO UPDATE SET
           grade = EXCLUDED.grade,
           feedback = EXCLUDED.feedback,
           status = 'GRADED'
         RETURNING *`,
        [assignment.assignment_id, student_id, numGrade, feedback || null]
      );
      updated = upsertRes.rows[0];
    } else {
      return res.status(400).json({ error: 'Either submissionId or student_id is required', code: 'TARGET_REQUIRED' });
    }

    return res.json({
      message: 'Grade recorded successfully',
      submission: updated,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId, assignmentId }, '[Assignments] Grading error');
    return next(err);
  }
});

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
 * Zero-I/O Pre-Upload Idempotency & Concurrency Barrier
 * Placed strictly BEFORE streamAssignmentUpload (Busboy).
 * Defends against network retry storms and concurrent multipart uploads.
 */
export async function submissionPreUploadBarrier(req, res, next) {
  const { assignmentId } = req.params;
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  const rawIdempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];

  if (!studentId) {
    return res.status(401).json({
      error: 'Unauthenticated: Valid student credentials required',
      code: 'AUTH_REQUIRED',
    });
  }

  if (!rawIdempotencyKey || typeof rawIdempotencyKey !== 'string' || rawIdempotencyKey.trim().length < 8) {
    return res.status(400).json({
      error: 'Missing or invalid X-Idempotency-Key header (minimum 8 characters required).',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }

  const cleanKey = rawIdempotencyKey.trim();
  const redisReplayKey = `idempotency:assign:${studentId}:${cleanKey}`;
  const redisLockKey = `lock:assign:${studentId}:${assignmentId}`;

  // 1. Instant Redis Replay Check (Zero Disk I/O)
  try {
    if (redis && typeof redis.get === 'function') {
      const cached = await redis.get(redisReplayKey);
      if (cached) {
        return res.status(200).set('X-Idempotency-Replay', 'true').json(JSON.parse(cached));
      }
    }
  } catch (redisErr) {
    logger.warn({ redisErr }, '[PreUploadBarrier] Redis replay read bypassed');
  }

  // 2. Distributed In-Flight Lock Acquisition (Zero Disk I/O)
  try {
    if (redis && typeof redis.set === 'function') {
      const acquired = await redis.set(redisLockKey, cleanKey, 'NX', 'EX', 45); // 45s ceiling
      if (!acquired) {
        return res.status(409).json({
          error: 'A submission or upload is already in progress for this assignment. Please wait.',
          code: 'SUBMISSION_IN_FLIGHT',
        });
      }

      // 3. Register Teardown Hook: Always release distributed lock on completion or close
      let released = false;
      const releaseLock = () => {
        if (!released) {
          released = true;
          redis.del(redisLockKey).catch(() => {});
        }
      };
      res.on('finish', releaseLock);
      res.on('close', releaseLock);
    }
  } catch (lockErr) {
    logger.warn({ lockErr }, '[PreUploadBarrier] Redis lock failed, falling back to ACID row lock');
  }

  return next();
}

/**
 * 3. POST /api/courses/:courseId/assignments/:assignmentId/submit
 * Idempotently submits or updates a student's assignment work.
 * Enforces:
 * - Pre-Upload Redis In-Flight Lock & Replay Barrier (<2ms)
 * - Single-RTT Relational Set-Intersection boundary check
 * - Atomic Snapshot MVCC CTE capturing pre-mutation file for zero-leak eviction
 * - Preserves submitted_at and status on identical idempotency retries
 * - Immutable once status is 'GRADED' (409 Conflict) with zero orphaned disk I/O
 * - Monotonic status calculation (LATE if submitted after due_date)
 */
router.post(
  '/:courseId/assignments/:assignmentId/submit',
  submissionPreUploadBarrier,
  streamAssignmentUpload,
  async (req, res, next) => {
    const { courseId, assignmentId } = req.params;
    const studentId = req.user?.student_id || req.user?.id || req.user?.username;
    if (!studentId) {
      return res.status(401).json({
        error: 'Unauthenticated: Valid student credentials required',
        code: 'AUTH_REQUIRED',
      });
    }

    const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'] || req.body?.idempotency_key;
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) {
      if (req.uploadedFile?.stagedPath) {
        fs.promises.unlink(req.uploadedFile.stagedPath).catch(() => {});
      }
      return res.status(400).json({
        error: 'Missing or invalid X-Idempotency-Key header.',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      });
    }

    const cleanKey = idempotencyKey.trim();

    // Resolve submission fields from multipart upload or JSON body
    const submissionText = req.body?.submission_text?.trim() || null;
    const removeFile = req.body?.remove_file === true || req.body?.remove_file === 'true';
    let finalFileUrl = removeFile ? null : (req.body?.file_url?.trim() || null);
    let finalFileName = removeFile ? null : (req.body?.file_name?.trim() || null);
    let finalFileSize = removeFile ? null : (req.body?.file_size_bytes ? Number(req.body.file_size_bytes) : null);

    let stagedPath = null;
    let targetPermanentPath = null;
    let filePromoted = false;
    let commitSucceeded = false;
    let previousPermanentPath = null;

    if (req.uploadedFile) {
      stagedPath = req.uploadedFile.stagedPath;
      finalFileName = req.uploadedFile.originalName;
      finalFileSize = req.uploadedFile.sizeBytes;

      const fileToken = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const permanentFileName = `sub_${assignmentId}_${studentId}_${fileToken}.${req.uploadedFile.extension}`;
      targetPermanentPath = path.join(PERMANENT_UPLOADS_DIR, permanentFileName);
      finalFileUrl = `/api/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submissions/file/${encodeURIComponent(permanentFileName)}`;
    }

    if (!submissionText && !finalFileUrl) {
      if (stagedPath) {
        fs.promises.unlink(stagedPath).catch(() => {});
      }
      return res.status(400).json({
        error: 'Submission requires either submission_text or an attached file.',
        code: 'EMPTY_SUBMISSION_PAYLOAD',
      });
    }

    const redisKey = `idempotency:assign:${studentId}:${cleanKey}`;

    // 1. Redis Fast-Path Idempotency Check (<2ms)
    try {
      if (redis && typeof redis.get === 'function') {
        const cachedPayload = await redis.get(redisKey);
        if (cachedPayload) {
          if (stagedPath) fs.promises.unlink(stagedPath).catch(() => {});
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
          AND (
            UPPER(REPLACE(c.course_id, ' ', '')) = $3 
            OR UPPER(REPLACE(c.code, ' ', '')) = $3
            OR c.course_id = $3
            OR c.code = $3
            OR c.moodle_course_id::text = $3
          )
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

      // Detect superseded previous physical file
      if (existing?.file_url && existing.file_url.includes('/submissions/file/')) {
        const prevBasename = path.basename(existing.file_url);
        const possiblePath = path.join(PERMANENT_UPLOADS_DIR, prevBasename);
        if (fs.existsSync(possiblePath)) {
          previousPermanentPath = possiblePath;
        }
      }

      // Case A: Exact Idempotent Network Retry (preserves original submitted_at & status)
      if (existing && existing.idempotency_key === cleanKey) {
        await client.query('COMMIT');
        commitSucceeded = true;
        const replayPayload = {
          message: 'Assignment submission confirmed (idempotent replay).',
          submission: existing,
        };
        return res.status(200).set('X-Idempotency-Replay', 'true').json(replayPayload);
      }

      // Case B: Lecturer has already graded the submission -> Immutable Lockout (Surgical Guardrail 2)
      if (existing && existing.status === 'GRADED') {
        await client.query('ROLLBACK');
        if (stagedPath) {
          fs.promises.unlink(stagedPath).catch(() => {});
        }
        return res.status(409).json({
          error: 'Cannot modify submission: assignment has already been evaluated and graded by the lecturer.',
          code: 'SUBMISSION_ALREADY_GRADED',
          grade: existing.grade,
        });
      }

      // Promote staged file to permanent storage strictly before DB commit
      if (stagedPath && targetPermanentPath) {
        await fs.promises.rename(stagedPath, targetPermanentPath);
        filePromoted = true;
      }

      // Case C: First-time submission or valid ungraded update via Locking Upsert CTE
      const upsertQuery = `
        WITH existing_submission AS (
          SELECT file_url 
          FROM student_assignment_submissions
          WHERE assignment_id = $1 AND student_id = $2
          FOR UPDATE
        ),
        upserted_submission AS (
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
            CASE WHEN NOW() > $7::timestamptz THEN 'LATE' ELSE 'SUBMITTED' END,
            $8
          )
          ON CONFLICT (assignment_id, student_id)
          DO UPDATE SET
            submission_text = COALESCE(EXCLUDED.submission_text, student_assignment_submissions.submission_text),
            file_url        = CASE WHEN $9::boolean IS TRUE THEN NULL ELSE COALESCE(EXCLUDED.file_url, student_assignment_submissions.file_url) END,
            file_name       = CASE WHEN $9::boolean IS TRUE THEN NULL ELSE COALESCE(EXCLUDED.file_name, student_assignment_submissions.file_name) END,
            file_size_bytes = CASE WHEN $9::boolean IS TRUE THEN NULL ELSE COALESCE(EXCLUDED.file_size_bytes, student_assignment_submissions.file_size_bytes) END,
            submitted_at    = NOW(),
            status          = CASE WHEN NOW() > $7::timestamptz THEN 'LATE' ELSE 'SUBMITTED' END,
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
            idempotency_key
        )
        SELECT 
          u.*,
          (SELECT file_url FROM existing_submission) AS superseded_file_url
        FROM upserted_submission u;
      `;

      const upsertRes = await client.query(upsertQuery, [
        assignmentId,
        studentId,
        submissionText,
        finalFileUrl,
        finalFileName,
        finalFileSize,
        boundary.due_date,
        cleanKey,
        removeFile,
      ]);

      // Surgical Guardrail 2: Reject modification if status was concurrent updated to GRADED
      if (upsertRes.rowCount === 0 || upsertRes.rows.length === 0) {
        await client.query('ROLLBACK');
        if (filePromoted && targetPermanentPath) {
          fs.promises.unlink(targetPermanentPath).catch(() => {});
        } else if (stagedPath) {
          fs.promises.unlink(stagedPath).catch(() => {});
        }
        return res.status(409).json({
          error: 'Cannot modify submission: assignment has already been evaluated and graded by the lecturer.',
          code: 'SUBMISSION_ALREADY_GRADED',
        });
      }

      await client.query('COMMIT');
      commitSucceeded = true;

      const upsertedRow = upsertRes.rows[0];
      const supersededUrl = upsertedRow?.superseded_file_url;

      // Post-Commit POSIX Eviction: Prune superseded previous file strictly after successful commit
      if (supersededUrl && supersededUrl !== finalFileUrl && supersededUrl.includes('/submissions/file/')) {
        const prevBasename = path.basename(supersededUrl);
        const possibleOldPath = path.join(PERMANENT_UPLOADS_DIR, prevBasename);
        fs.promises.unlink(possibleOldPath).catch((unlinkErr) => {
          logger.warn({ unlinkErr, possibleOldPath }, '[Assignments] Failed to prune superseded submission file');
        });
      }

      const { superseded_file_url, ...cleanedSubmission } = upsertedRow;
      const responsePayload = {
        message: existing ? 'Assignment submission updated successfully.' : 'Assignment submitted successfully.',
        submission: cleanedSubmission,
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

      // Two-Phase POSIX Coordination:
      // (a) If transaction failed or rolled back, purge any newly uploaded files
      if (!commitSucceeded) {
        if (stagedPath) {
          fs.promises.unlink(stagedPath).catch(() => {});
        }
        if (filePromoted && targetPermanentPath) {
          fs.promises.unlink(targetPermanentPath).catch(() => {});
        }
      }

      // (b) Fallback Pruning if previous file was detected pre-query
      if (commitSucceeded && previousPermanentPath && previousPermanentPath !== targetPermanentPath) {
        fs.promises.unlink(previousPermanentPath).catch(() => {});
      }
    }
  }
);

/**
 * 4. GET /api/courses/:courseId/assignments/:assignmentId/submissions/file/:filename
 * Securely streams student submitted work with strict ownership and authorization boundaries.
 */
router.get('/:courseId/assignments/:assignmentId/submissions/file/:filename', async (req, res, next) => {
  const { courseId, assignmentId, filename } = req.params;
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  const isStaff = req.user?.role && ['LECTURER', 'ADVISOR', 'ADMIN', 'STAFF'].includes(String(req.user.role).toUpperCase());

  if (!studentId) {
    return res.status(401).json({ error: 'Unauthenticated', code: 'AUTH_REQUIRED' });
  }

  const sanitizedFilename = path.basename(filename);
  const filePath = path.join(PERMANENT_UPLOADS_DIR, sanitizedFilename);

  try {
    const submissionCheck = await pool.query(
      `SELECT submission_id, student_id, file_name, file_url
       FROM student_assignment_submissions
       WHERE assignment_id = $1 AND file_url LIKE $2
       LIMIT 1`,
      [assignmentId, `%${sanitizedFilename}%`]
    );

    if (submissionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Submission file record not found', code: 'FILE_NOT_FOUND' });
    }

    const submission = submissionCheck.rows[0];
    if (submission.student_id !== studentId && !isStaff) {
      return res.status(403).json({ error: 'Access denied: You do not own this submission', code: 'UNAUTHORIZED_FILE_ACCESS' });
    }

    await fs.promises.stat(filePath);

    const ext = path.extname(sanitizedFilename).toLowerCase();
    const mimeMap = {
      '.pdf': 'application/pdf',
      '.zip': 'application/zip',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const contentType = mimeMap[ext] || 'application/octet-stream';
    const originalName = submission.file_name || sanitizedFilename;

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${originalName}"`);

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Physical file not found on disk storage', code: 'FILE_NOT_FOUND' });
    }
    return next(err);
  }
});

export default router;
