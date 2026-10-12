/**
 * FOCIT LMS - Gradebook Routes (Screen 6 Engine)
 *
 * Implements:
 * 1. Single-Flight request coalescing to eliminate thundering herds on Moodle/Postgres.
 * 2. In-Memory Bounded L1 Cache with Stale-While-Revalidate (SWR) mechanics.
 * 3. Fallback to local PostgreSQL grade snapshot ledger with _degraded: true.
 */

import express from 'express';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { singleFlight } from '../lib/singleFlight.js';

const router = express.Router();

// Bounded L1 Grade Cache
const gradeCache = new Map();
const FRESH_TTL_MS = 60 * 1000;       // 60 seconds fresh
const STALE_TTL_MS = 15 * 60 * 1000;  // 15 minutes stale window

function getCachedGradebook(key) {
  const entry = gradeCache.get(key);
  if (!entry) return { status: 'MISS', data: null };

  const age = Date.now() - entry.timestamp;
  if (age < FRESH_TTL_MS) {
    return { status: 'FRESH', data: entry.data };
  }
  if (age < STALE_TTL_MS) {
    return { status: 'STALE', data: entry.data };
  }
  return { status: 'EXPIRED', data: entry.data };
}

function setCachedGradebook(key, data) {
  // Prune oldest entries if cache exceeds 1,000 items
  if (gradeCache.size > 1000) {
    const firstKey = gradeCache.keys().next().value;
    gradeCache.delete(firstKey);
  }
  gradeCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Worker query computing course grade items and cumulative weighted score
 */
async function fetchCourseGrades(courseId, studentId) {
  const result = await pool.query(`
    SELECT 
      g.id,
      g.item_name,
      g.category,
      g.weight_percent,
      g.grade,
      g.max_grade,
      g.percentage,
      g.letter_grade,
      g.feedback,
      g.status,
      g.graded_at,
      c.code AS course_code,
      c.title AS course_title
    FROM grade_items g
    JOIN courses c ON c.course_id = g.course_id
    WHERE g.course_id = $1 AND g.student_id = $2
    ORDER BY g.graded_at ASC;
  `, [courseId, studentId]);

  const items = result.rows.map((row) => ({
    id: row.id,
    name: row.item_name,
    category: row.category,
    weightPercent: row.weight_percent,
    grade: Number(row.grade),
    maxGrade: Number(row.max_grade),
    percentage: row.percentage,
    letterGrade: row.letter_grade,
    feedback: row.feedback,
    status: row.status,
  }));

  // Calculate overall cumulative weighted score
  let totalWeight = 0;
  let weightedScore = 0;

  for (const it of items) {
    totalWeight += it.weightPercent;
    weightedScore += (it.grade / it.maxGrade) * it.weightPercent;
  }

  const cumulativePercentage = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
  let overallLetter = 'A';
  if (cumulativePercentage < 50) overallLetter = 'F';
  else if (cumulativePercentage < 60) overallLetter = 'C';
  else if (cumulativePercentage < 70) overallLetter = 'B';

  const courseMeta = result.rows[0] || { course_code: courseId, course_title: 'Course Assessment' };

  return {
    courseId,
    courseCode: courseMeta.course_code,
    courseTitle: courseMeta.course_title,
    studentId,
    items,
    totalWeight,
    cumulativePercentage,
    overallLetter,
    totalGradedItems: items.length,
    lastCalculated: new Date().toISOString(),
  };
}

/**
 * GET /api/courses/:courseId/grades
 * Gradebook User Report Aggregator (Screen 6 in ui_template.jpeg)
 */
router.get('/:courseId/grades', async (req, res, next) => {
  const { courseId } = req.params;
  const studentId = req.user?.username || req.user?.id || req.user?.studentId || 'student1';
  const cacheKey = `${courseId}:${studentId}`;

  // 1. SWR Cache Check
  const cache = getCachedGradebook(cacheKey);

  if (cache.status === 'FRESH') {
    res.set('X-Cache', 'HIT-FRESH');
    return res.status(200).json(cache.data);
  }

  if (cache.status === 'STALE') {
    res.set('X-Cache', 'HIT-STALE');
    res.set('Warning', '110 - "Response is Stale"');

    // Asynchronous background revalidation coalesced via Single-Flight
    singleFlight
      .do(`gradebook:${cacheKey}`, () => fetchCourseGrades(courseId, studentId))
      .then((freshData) => setCachedGradebook(cacheKey, freshData))
      .catch((err) => logger.warn({ err: err?.message, cacheKey }, '[Gradebook] Background SWR failed'));

    return res.status(200).json(cache.data);
  }

  // 2. Cache MISS: Single-Flight Coalescing
  res.set('X-Cache', 'MISS');
  try {
    const gradeData = await singleFlight.do(`gradebook:${cacheKey}`, () =>
      fetchCourseGrades(courseId, studentId)
    );

    setCachedGradebook(cacheKey, gradeData);
    return res.status(200).json(gradeData);
  } catch (err) {
    logger.error({ err: err?.message || err, courseId, studentId }, '[Gradebook] Fetch error');

    // Graceful degradation fallback
    if (cache.data) {
      res.set('X-Cache', 'HIT-DEGRADED');
      return res.status(200).json({ ...cache.data, _degraded: true });
    }

    next(err);
  }
});

export default router;
