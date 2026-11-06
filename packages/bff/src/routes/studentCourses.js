/**
 * FOCIT LMS - Dedicated Student Courses Directory Endpoint
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Invariants Enforced:
 * 1. Specialized Dynamic Query Generation: Eliminates the ($2 IS NULL OR e.status = $2) generic plan trap.
 * 2. Lookahead Keyset Pagination: Fetches parsedLimit + 1 rows to deterministically compute has_more and next_cursor.
 * 3. Zero In-Memory Sort: Relies on idx_enrollments_student_status_code_cursor and idx_enrollments_student_code_cursor.
 */

import express from 'express';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { calculateCourseProgress } from '../lib/courseProgress.js';

const router = express.Router();

router.get('/', async (req, res, next) => {
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  if (!studentId) {
    return res.status(401).json({
      error: 'Unauthenticated: Valid student credentials required',
      code: 'AUTH_REQUIRED',
    });
  }

  const { status, cursor_code, cursor_id } = req.query;

  // 1. Defensively parse and bound limit strictly between [1, 50]
  const rawLimit = parseInt(req.query.limit, 10);
  const parsedLimit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 50)) : 12;

  const conditions = ['e.student_id = $1'];
  const values = [studentId];
  let paramIdx = 2;

  // 2. Specialized Status Branch (Zero OR disjunctions)
  if (status && status !== 'ALL') {
    conditions.push(`e.status = $${paramIdx++}`);
    values.push(status);
  }

  // 3. Specialized Keyset Cursor Branch (Zero OR disjunctions)
  if (cursor_code && cursor_id) {
    conditions.push(`(e.course_code, e.course_id) > ($${paramIdx++}, $${paramIdx++})`);
    values.push(cursor_code, cursor_id);
  }

  // Pass parsedLimit + 1 to execute the Lookahead Pattern
  values.push(parsedLimit + 1);
  const limitIdx = paramIdx;

  const sql = `
    SELECT 
      e.enrollment_id,
      e.status,
      COALESCE(e.progress_percent, 0) AS legacy_progress_percent,
      e.grade,
      c.course_id,
      COALESCE(e.course_code, c.code) AS code,
      c.title,
      c.units,
      c.level,
      c.category,
      c.moodle_course_id,
      c.description,
      COALESCE(att.held_sessions, 0)::int AS held_sessions,
      COALESCE(att.attended_sessions, 0)::int AS attended_sessions,
      COALESCE(q.total_quizzes, 0)::int AS total_quizzes,
      COALESCE(q.completed_quizzes, 0)::int AS completed_quizzes,
      COALESCE(a.total_assignments, 0)::int AS total_assignments,
      COALESCE(a.submitted_assignments, 0)::int AS submitted_assignments
    FROM enrollments e
    JOIN courses c ON c.course_id = e.course_id
    LEFT JOIN LATERAL (
      SELECT 
        COUNT(s.session_id)::int AS held_sessions,
        COUNT(r.id) FILTER (WHERE r.status = 'PRESENT')::int AS attended_sessions
      FROM attendance_sessions s
      LEFT JOIN attendance_records r ON r.session_id = s.session_id AND r.student_id = e.student_id
      WHERE s.course_id = e.course_id
    ) att ON TRUE
    LEFT JOIN LATERAL (
      SELECT 
        COUNT(DISTINCT qz.quiz_id)::int AS total_quizzes,
        COUNT(DISTINCT qa.quiz_id) FILTER (WHERE qa.status IN ('SUBMITTED', 'COMPLETED', 'GRADED'))::int AS completed_quizzes
      FROM quizzes qz
      LEFT JOIN quiz_attempts qa ON qa.quiz_id = qz.quiz_id AND qa.student_id = e.student_id
      WHERE qz.course_id = e.course_id AND qz.status = 'ACTIVE'
    ) q ON TRUE
    LEFT JOIN LATERAL (
      SELECT 
        COUNT(DISTINCT ca.assignment_id)::int AS total_assignments,
        COUNT(DISTINCT sub.assignment_id) FILTER (WHERE sub.status IN ('SUBMITTED', 'GRADED'))::int AS submitted_assignments
      FROM course_assignments ca
      LEFT JOIN student_assignment_submissions sub ON sub.assignment_id = ca.assignment_id AND sub.student_id = e.student_id
      WHERE ca.course_id = e.course_id AND ca.status = 'PUBLISHED'
    ) a ON TRUE
    WHERE ${conditions.join(' AND ')}
    ORDER BY 
      COALESCE(e.course_code, c.code) ASC, 
      e.course_id ASC
    LIMIT $${limitIdx};
  `;

  try {
    const { rows } = await pool.query(sql, values);

    // 4. Derive pagination boundaries using N + 1 Lookahead
    const hasMore = rows.length > parsedLimit;
    const courses = hasMore ? rows.slice(0, parsedLimit) : rows;
    const nextCursor = hasMore && courses.length > 0 ? {
      cursor_code: courses[courses.length - 1].code,
      cursor_id: courses[courses.length - 1].course_id,
    } : null;

    const coursesWithProgress = courses.map((c) => ({
      ...c,
      progress: calculateCourseProgress({
        status: c.status,
        held_sessions: c.held_sessions,
        attended_sessions: c.attended_sessions,
        total_quizzes: c.total_quizzes,
        completed_quizzes: c.completed_quizzes,
        total_assignments: c.total_assignments,
        submitted_assignments: c.submitted_assignments,
      }),
      progress_percent: calculateCourseProgress({
        status: c.status,
        held_sessions: c.held_sessions,
        attended_sessions: c.attended_sessions,
        total_quizzes: c.total_quizzes,
        completed_quizzes: c.completed_quizzes,
        total_assignments: c.total_assignments,
        submitted_assignments: c.submitted_assignments,
      }),
    }));

    return res.status(200).json({
      courses: coursesWithProgress,
      has_more: hasMore,
      next_cursor: nextCursor,
      limit: parsedLimit,
    });
  } catch (err) {
    logger.error({ err: err.message, studentId }, '[Courses Directory] Query failure');
    next(err);
  }
});

export default router;
