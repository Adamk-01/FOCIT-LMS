/**
 * FOCIT LMS - Discussion Forum Routes (Screen 7 Engine)
 *
 * Implements:
 * 1. GET /:courseId/forum - Aggregates active discussion threads, badges, and reply counts.
 * 2. POST /:courseId/forum/threads - Thread creation with anti-spam mutation rate limits.
 */

import express from 'express';
import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

/**
 * GET /api/courses/:courseId/forum
 * Thread Aggregator for Screen 7 with author profile picture joins
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
        c.title AS course_title,
        sp.avatar_url
      FROM forum_threads f
      JOIN courses c ON c.course_id = f.course_id
      LEFT JOIN student_profiles sp ON sp.student_id = f.student_id
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
        avatarUrl: row.avatar_url || null,
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
 * GET /api/courses/:courseId/forum/threads/:threadId/replies
 * Retrieves all replies for a discussion thread with author profile pictures
 */
router.get('/:courseId/forum/threads/:threadId/replies', async (req, res, next) => {
  const { courseId, threadId } = req.params;

  try {
    const threadCheck = await pool.query(
      `SELECT thread_id, title, course_id FROM forum_threads WHERE thread_id = $1 AND course_id = $2 LIMIT 1`,
      [threadId, courseId]
    );

    if (threadCheck.rows.length === 0) {
      return res.status(404).json({
        error: 'Discussion thread not found for this course',
        code: 'THREAD_NOT_FOUND',
      });
    }

    const repliesRes = await pool.query(
      `
      SELECT 
        r.reply_id,
        r.thread_id,
        r.student_id,
        r.author_name,
        r.author_role,
        r.body,
        r.created_at,
        sp.avatar_url
      FROM forum_replies r
      LEFT JOIN student_profiles sp ON sp.student_id = r.student_id
      WHERE r.thread_id = $1
      ORDER BY r.created_at ASC;
      `,
      [threadId]
    );

    const replies = repliesRes.rows.map((row) => ({
      id: row.reply_id,
      threadId: row.thread_id,
      body: row.body,
      createdAt: row.created_at,
      author: {
        id: row.student_id,
        name: row.author_name,
        role: row.author_role,
        avatarUrl: row.avatar_url || null,
        initials: row.author_name
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase(),
      },
    }));

    return res.status(200).json({
      threadId,
      totalReplies: replies.length,
      replies,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, courseId, threadId }, '[Forum] Fetch replies error');
    next(err);
  }
});

/**
 * POST /api/courses/:courseId/forum/threads/:threadId/replies
 * Atomic Thread Reply Creation with anti-spam check and avatar propagation
 */
router.post('/:courseId/forum/threads/:threadId/replies', async (req, res, next) => {
  const { courseId, threadId } = req.params;
  const studentId = req.user?.student_id || req.user?.studentId || req.user?.id || req.user?.username || 'student1';
  const { body } = req.body || {};

  if (!body || !body.trim()) {
    return res.status(400).json({
      error: 'Reply message cannot be empty',
      code: 'INVALID_REPLY_PAYLOAD',
    });
  }

  // Distributed Anti-Spam Rate Limit Check: Redis Fast-Path (<2ms)
  const redisReplyKey = `spam:forum:reply:${studentId}`;
  try {
    if (redis && typeof redis.set === 'function') {
      const acquired = await redis.set(redisReplyKey, '1', 'EX', 5, 'NX');
      if (!acquired) {
        const ttl = await redis.ttl(redisReplyKey);
        const waitSec = ttl > 0 ? ttl : 5;
        return res.status(429).json({
          error: `Please wait ${waitSec} second(s) before posting another reply`,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfterSeconds: waitSec,
        });
      }
    }
  } catch (_) {
    // Non-fatal: PostgreSQL relational check acts as authoritative fallback
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Authoritative Cluster Rate-Limit Check against PostgreSQL ledger
    const rateCheck = await client.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::int AS elapsed_seconds
       FROM forum_replies
       WHERE student_id = $1;`,
      [studentId]
    );

    const elapsed = rateCheck.rows[0]?.elapsed_seconds;
    if (elapsed !== null && elapsed !== undefined && elapsed < 5) {
      await client.query('ROLLBACK');
      const waitSec = 5 - elapsed;
      return res.status(429).json({
        error: `Please wait ${waitSec} second(s) before posting another reply`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: waitSec,
      });
    }

    // 1. Verify thread exists and lock it
    const threadCheck = await client.query(
      `SELECT thread_id, course_id, replies_count FROM forum_threads WHERE thread_id = $1 AND course_id = $2 FOR UPDATE;`,
      [threadId, courseId]
    );

    if (threadCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Discussion thread not found for this course',
        code: 'THREAD_NOT_FOUND',
      });
    }

    // 2. Fetch author identity (resolve staff vs student)
    const userRole = String(req.user?.role || '').toUpperCase();
    const isStaffRole = ['ADMIN', 'SYSTEM_ADMIN', 'LECTURER', 'HOD', 'LEVEL_ADVISOR', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF'].includes(userRole);

    let authorId = studentId;
    let authorName = 'Participant';
    let authorRole = 'STUDENT';
    let avatarUrl = null;

    if (isStaffRole) {
      const staffRes = await client.query(
        `SELECT advisor_id, full_name, role 
         FROM staff_advisors 
         WHERE advisor_id = $1 OR staff_number = $1 OR (email IS NOT NULL AND email = $2)
         LIMIT 1`,
        [String(studentId), req.user?.email ? String(req.user.email).trim() : '']
      );
      if (staffRes.rows.length > 0) {
        authorId = staffRes.rows[0].advisor_id;
        authorName = staffRes.rows[0].full_name;
        authorRole = staffRes.rows[0].role || userRole;
      } else {
        authorName = req.user?.name || req.user?.username || 'Course Faculty';
        authorRole = userRole || 'STAFF';
      }
    } else {
      const studentQuery = await client.query(
        `SELECT s.student_id, s.full_name, sp.avatar_url 
         FROM students s 
         LEFT JOIN student_profiles sp ON sp.student_id = s.student_id 
         WHERE s.student_id = $1 OR UPPER(s.matric_number) = UPPER($1) OR UPPER(s.username) = UPPER($1)
         ORDER BY (s.student_id = $1) DESC, s.student_id ASC
         LIMIT 1;`,
        [String(studentId)]
      );
      if (studentQuery.rows.length > 0) {
        authorId = studentQuery.rows[0].student_id;
        authorName = studentQuery.rows[0].full_name;
        avatarUrl = studentQuery.rows[0].avatar_url || null;
      } else {
        authorName = req.user?.name || req.user?.username || 'Student Participant';
      }
      authorRole = 'STUDENT';
    }

    // 3. Insert reply
    const insertRes = await client.query(
      `INSERT INTO forum_replies (
         thread_id,
         student_id,
         author_name,
         author_role,
         body,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *;`,
      [threadId, authorId, authorName, authorRole, body.trim()]
    );

    // 4. Increment replies count and update last_post_at on parent thread
    await client.query(
      `UPDATE forum_threads
       SET replies_count = replies_count + 1,
           last_post_at = NOW()
       WHERE thread_id = $1;`,
      [threadId]
    );

    await client.query('COMMIT');

    const newReply = insertRes.rows[0];

    return res.status(201).json({
      id: newReply.reply_id,
      threadId: newReply.thread_id,
      body: newReply.body,
      createdAt: newReply.created_at,
      author: {
        id: authorId,
        name: authorName,
        role: authorRole,
        avatarUrl,
        initials: authorName
          .split(' ')
          .map((n) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase(),
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err: err?.message || err, courseId, threadId, studentId }, '[Forum] Reply creation error');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/courses/:courseId/forum/threads
 * Thread Creation with anti-spam check and avatar join
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

  // Distributed Anti-Spam Rate Limit Check for Threads: 15s interval
  const redisThreadKey = `spam:forum:thread:${studentId}`;
  try {
    if (redis && typeof redis.set === 'function') {
      const acquired = await redis.set(redisThreadKey, '1', 'EX', 15, 'NX');
      if (!acquired) {
        const ttl = await redis.ttl(redisThreadKey);
        const waitSec = ttl > 0 ? ttl : 15;
        return res.status(429).json({
          error: `Please wait ${waitSec} seconds before starting another discussion topic`,
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfterSeconds: waitSec,
        });
      }
    }
  } catch (_) {
    // Non-fatal: PostgreSQL relational check acts as authoritative fallback
  }

  try {
    // Authoritative Cluster Rate-Limit Check against PostgreSQL ledger
    const rateCheck = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))::int AS elapsed_seconds
       FROM forum_threads
       WHERE student_id = $1;`,
      [studentId]
    );

    const elapsed = rateCheck.rows[0]?.elapsed_seconds;
    if (elapsed !== null && elapsed !== undefined && elapsed < 15) {
      const waitSec = 15 - elapsed;
      return res.status(429).json({
        error: `Please wait ${waitSec} seconds before starting another discussion topic`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: waitSec,
      });
    }
    // Resolve author identity (resolve staff vs student)
    const userRole = String(req.user?.role || '').toUpperCase();
    const isStaffRole = ['ADMIN', 'SYSTEM_ADMIN', 'LECTURER', 'HOD', 'LEVEL_ADVISOR', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF'].includes(userRole);

    let authorId = studentId;
    let authorName = 'Participant';
    let authorRole = 'STUDENT';
    let avatarUrl = null;

    if (isStaffRole) {
      const staffRes = await pool.query(
        `SELECT advisor_id, full_name, role 
         FROM staff_advisors 
         WHERE advisor_id = $1 OR staff_number = $1 OR (email IS NOT NULL AND email = $2)
         LIMIT 1`,
        [String(studentId), req.user?.email ? String(req.user.email).trim() : '']
      );
      if (staffRes.rows.length > 0) {
        authorId = staffRes.rows[0].advisor_id;
        authorName = staffRes.rows[0].full_name;
        authorRole = staffRes.rows[0].role || userRole;
      } else {
        authorName = req.user?.name || req.user?.username || 'Course Faculty';
        authorRole = userRole || 'STAFF';
      }
    } else {
      const studentQuery = await pool.query(
        `SELECT s.student_id, s.full_name, sp.avatar_url 
         FROM students s 
         LEFT JOIN student_profiles sp ON sp.student_id = s.student_id 
         WHERE s.student_id = $1 OR UPPER(s.matric_number) = UPPER($1) OR UPPER(s.username) = UPPER($1)
         ORDER BY (s.student_id = $1) DESC, s.student_id ASC
         LIMIT 1`,
        [String(studentId)]
      );
      if (studentQuery.rows.length > 0) {
        authorId = studentQuery.rows[0].student_id;
        authorName = studentQuery.rows[0].full_name;
        avatarUrl = studentQuery.rows[0].avatar_url || null;
      } else {
        authorName = req.user?.name || req.user?.username || 'Student Participant';
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
    `, [courseId, authorId, authorName, authorRole, title.trim(), body.trim()]);

    const newThread = insertResult.rows[0];

    return res.status(201).json({
      id: newThread.thread_id,
      title: newThread.title,
      body: newThread.body,
      author: {
        name: newThread.author_name,
        role: newThread.author_role,
        avatarUrl,
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
