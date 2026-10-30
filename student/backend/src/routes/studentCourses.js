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
      e.progress_percent,
      e.grade,
      c.course_id,
      COALESCE(e.course_code, c.code) AS code,
      c.title,
      c.units,
      c.level,
      c.category,
      c.moodle_course_id,
      c.description
    FROM enrollments e
    JOIN courses c ON c.course_id = e.course_id
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

    return res.status(200).json({
      courses,
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
