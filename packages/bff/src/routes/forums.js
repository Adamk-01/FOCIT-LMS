/**
 * FOCIT LMS - Discussion Forum Routes (Screen 7 Engine)
 *
 * Implements:
 * 1. GET /:courseId/forum - Aggregates active discussion threads, badges, and reply counts.
 * 2. POST /:courseId/forum/threads - Thread creation with anti-spam mutation rate limits.
 */

import express from 'express';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

// Ephemeral in-memory spam bucket: 1 post per 15s per student
const spamBucket = new Map();

/**
 * GET /api/courses/:courseId/forum
 * Thread Aggregator for Screen 7
 */
router.get('/:courseId/forum', async (req, res, next) => {
  const { courseId } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        f.thread_id,
        f.course_id,
        f.author_name,
        f.author_role,
        f.title,
        f.body,
        f.replies_count,
        f.last_post_at,
        f.created_at,
        c.code AS course_code,
        c.title AS course_title
      FROM forum_threads f
      JOIN courses c ON c.course_id = f.course_id
      WHERE f.course_id = $1
      ORDER BY f.last_post_at DESC;
    `, [courseId]);

    const threads = result.rows.map((row) => ({
      id: row.thread_id,
      title: row.title,
      body: row.body,
      author: {
        name: row.author_name,
        role: row.author_role,
        initials: row.author_name
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase(),
      },
      repliesCount: row.replies_count,
      lastPostAt: row.last_post_at,
      createdAt: row.created_at,
    }));

    const courseMeta = result.rows[0] || { course_code: courseId, course_title: 'Course Forum' };

    return res.status(200).json({
      courseId,
      courseCode: courseMeta.course_code,
      courseTitle: courseMeta.course_title,
      totalThreads: threads.length,
      threads,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId }, '[Forum] Fetch error');
    next(err);
  }
});

/**
 * POST /api/courses/:courseId/forum/threads
 * Thread Creation with anti-spam check
 */
router.post('/:courseId/forum/threads', async (req, res, next) => {
  const { courseId } = req.params;
  const studentId = req.user?.student_id || req.user?.studentId || req.user?.id || req.user?.username || 'student1';
  const { title, body } = req.body;

  if (!title || !title.trim() || !body || !body.trim()) {
    return res.status(400).json({
      error: 'Discussion title and message body are both required',
      code: 'INVALID_PAYLOAD',
    });
  }

  // Anti-Spam Rate Limit Check
  const lastPost = spamBucket.get(studentId);
  const now = Date.now();
  if (lastPost && now - lastPost < 15000) {
    const waitSec = Math.ceil((15000 - (now - lastPost)) / 1000);
    return res.status(429).json({
      error: `Please wait ${waitSec} seconds before starting another discussion topic`,
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfterSeconds: waitSec,
    });
  }

  try {
    const callerRole = String(req.user?.role || 'STUDENT').toUpperCase();
    const isStaff = ['ADMIN', 'SYSTEM_ADMIN', 'LECTURER', 'HOD', 'LEVEL_ADVISOR', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF'].includes(callerRole);

    let resolvedAuthorId = String(studentId);
    let authorName = null;
    let authorRole = callerRole;

    if (isStaff) {
      const staffQuery = await pool.query(
        'SELECT advisor_id, full_name, role FROM staff_advisors WHERE advisor_id = $1 OR staff_number = $1 OR (email IS NOT NULL AND email = $2) LIMIT 1',
        [String(studentId), req.user?.email ? String(req.user.email).trim() : '']
      );
      if (staffQuery.rows.length > 0) {
        resolvedAuthorId = staffQuery.rows[0].advisor_id;
        authorName = staffQuery.rows[0].full_name;
        authorRole = staffQuery.rows[0].role || callerRole;
      } else {
        authorName = req.user?.name || 'Academic Staff';
        authorRole = callerRole;
      }
    } else {
      const studentQuery = await pool.query(
        'SELECT student_id, full_name FROM students WHERE student_id = $1 OR UPPER(matric_number) = UPPER($1) OR UPPER(username) = UPPER($1) ORDER BY (student_id = $1) DESC LIMIT 1',
        [String(studentId)]
      );
      if (studentQuery.rows.length > 0) {
        resolvedAuthorId = studentQuery.rows[0].student_id;
        authorName = studentQuery.rows[0].full_name;
      } else {
        authorName = req.user?.name || 'Student';
      }
      authorRole = 'STUDENT';
    }

    const insertResult = await pool.query(`
      INSERT INTO forum_threads (
        course_id,
        student_id,
        author_name,
        author_role,
        title,
        body,
        replies_count,
        last_post_at,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, NOW(), NOW())
      RETURNING *;
    `, [courseId, resolvedAuthorId, authorName, authorRole, title.trim(), body.trim()]);

    spamBucket.set(studentId, now);

    const newThread = insertResult.rows[0];

    return res.status(201).json({
      id: newThread.thread_id,
      title: newThread.title,
      body: newThread.body,
      author: {
        name: newThread.author_name,
        role: newThread.author_role,
        initials: newThread.author_name
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase(),
      },
      repliesCount: 0,
      lastPostAt: newThread.last_post_at,
      createdAt: newThread.created_at,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId, studentId }, '[Forum] Thread creation error');
    next(err);
  }
});

export default router;
