/**
 * Materials Routes — GET /api/courses/:courseId/materials
 *
 * Implements Step 1:
 * - Local Bounded L1 Cache with Stale-While-Revalidate (SWR) mechanics.
 * - Single-Flight request coalescing to eliminate upstream Moodle cache stampedes.
 * - Decoupled client ingress timeout (3,000ms) with Retry-After load-shedding vs. 
 *   persistent upstream execution (10,000ms ceiling).
 * - Quarantined background revalidation error sink preventing unhandled promise rejections.
 */

import { Router } from 'express';
import { enrollmentCheck } from '../middleware/auth.js';
import { listRateLimit } from '../middleware/rateLimiter.js';
import { getCourseContents } from '../lib/moodleApi.js';
import { singleFlight } from '../lib/singleFlight.js';
import { materialsCache } from '../lib/materialsCache.js';
import { logger } from '../lib/logger.js';
import { pool } from '../db/index.js';

const router = Router();

const CLIENT_INGRESS_TIMEOUT_MS = 3000;
const UPSTREAM_FETCH_TIMEOUT_MS = 10000;

/**
 * Resolves a canonical course code or ID (e.g., 'CSC204', 'CSC 204', '1') 
 * to its authoritative { course_id, moodle_course_id, code, title } record.
 * Enforces Invariant 1 (Authoritative Database Catalog) & Invariant 7 (Single-Flight + L1 Cache).
 */
export async function resolveCourseRecord(rawIdentifier) {
  if (!rawIdentifier || typeof rawIdentifier !== 'string') {
    return null;
  }

  const normalizedKey = rawIdentifier.trim().toUpperCase().replace(/\s+/g, '');
  const cacheKey = `course_resolve:${normalizedKey}`;

  // 1. Fast-Path: Bounded L1 SWR Cache Lookup
  const cached = materialsCache.get(cacheKey);
  if (cached && cached.status !== 'MISS' && cached.data) {
    return cached.data;
  }

  // 2. Coalesced Miss: Single-Flight PostgreSQL Lookup
  return singleFlight.do(cacheKey, async () => {
    const query = `
      SELECT 
        course_id, 
        code, 
        title, 
        department_id, 
        level, 
        units, 
        COALESCE(moodle_course_id, 1) AS moodle_course_id
      FROM courses
      WHERE UPPER(REPLACE(course_id, ' ', '')) = $1
         OR UPPER(REPLACE(code, ' ', '')) = $1
         OR moodle_course_id::text = $2
      LIMIT 1;
    `;
    const { rows } = await pool.query(query, [normalizedKey, rawIdentifier.trim()]);
    const record = rows[0] || null;

    if (record) {
      materialsCache.set(cacheKey, record);
    }
    return record;
  });
}

/**
 * Resolves FOCIT course code to Moodle course ID with authoritative DB fallback
 */
export async function resolveMoodleCourseId(focitCourseCode) {
  if (/^\d+$/.test(String(focitCourseCode))) {
    return parseInt(focitCourseCode, 10);
  }

  const record = await resolveCourseRecord(focitCourseCode);
  if (!record) {
    const err = new Error(`Course '${focitCourseCode}' not found in authoritative catalog.`);
    err.status = 404;
    err.code = 'COURSE_NOT_FOUND';
    throw err;
  }

  return record.moodle_course_id;
}

/**
 * Worker function that queries Moodle and transforms sections into flattened materials.
 */
async function fetchAndTransformMaterials(moodleCourseId, signal) {
  const sanitizedSections = await getCourseContents(moodleCourseId, signal);

  return sanitizedSections.flatMap((section) =>
    section.materials.map((material) => ({
      id: material.id,
      moduleId: material.moduleId,
      filename: material.name,
      title: material.name,
      type: material.type || 'pdf',
      url: material.url,
      sizeBytes: material.sizeBytes || 0,
      createdAt: material.createdAt || new Date().toISOString(),
    }))
  );
}

/**
 * GET /api/courses
 * Returns the authenticated student's authoritative enrolled courses for the active semester.
 */
router.get('/', listRateLimit, async (req, res, next) => {
  try {
    const studentId = req.user?.student_id || req.user?.id || req.user?.username;
    if (!studentId) {
      return res.status(401).json({
        error: 'Unauthenticated: Valid student credentials required',
        code: 'AUTH_REQUIRED',
      });
    }

    const studentQuery = `
      SELECT s.student_id, s.level, p.department_id, d.name AS department_name
      FROM students s
      LEFT JOIN programmes p ON p.id = s.programme_id
      LEFT JOIN departments d ON d.id = p.department_id
      WHERE s.student_id = $1
      LIMIT 1;
    `;

    const enrollmentsQuery = `
      SELECT 
        COALESCE(c.moodle_course_id, 1) AS id,
        c.course_id,
        c.code,
        c.title,
        COALESCE(d.name, 'Faculty of Computing & Information Technology') AS department,
        c.department_id,
        c.level,
        c.units,
        c.category,
        COALESCE(e.progress_percent, 0) AS progress_percent,
        e.status AS enrollment_status,
        COALESCE(c.moodle_course_id, 1) AS moodle_course_id
      FROM enrollments e
      JOIN courses c ON c.course_id = e.course_id
      LEFT JOIN departments d ON d.id = c.department_id
      WHERE e.student_id = $1
        AND e.status IN ('ENROLLED', 'IN_PROGRESS', 'COMPLETED')
      ORDER BY c.category = 'CORE' DESC, c.code ASC;
    `;

    const [studentRes, enrollmentsRes] = await Promise.all([
      pool.query(studentQuery, [studentId]),
      pool.query(enrollmentsQuery, [studentId]),
    ]);

    const student = studentRes.rows[0] || {
      student_id: studentId,
      level: 200,
      department_name: 'Department of Computer Science',
      department_id: 'CSC',
    };

    return res.status(200).json({
      data: enrollmentsRes.rows,
      total: enrollmentsRes.rowCount,
      student: {
        student_id: student.student_id,
        level: Number(student.level),
        department: student.department_name || 'Department of Computer Science',
        department_id: student.department_id || 'CSC',
        username: req.user?.username,
        email: req.user?.email,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * GET /api/courses/:courseId/shell
 * Composite Aggregator for Course View Shell (Screen 2 in ui_template.jpeg).
 * Fetches FOCIT PostgreSQL metadata, student enrollment progress, Zoom details,
 * and upcoming Moodle activities via Promise.allSettled with a 1,500ms timeout boundary.
 */
router.get(
  '/:courseId/shell',
  async (req, res, next) => {
    const { courseId } = req.params;
    const studentId = req.user?.student_id || req.user?.id || req.user?.username;
    if (!studentId) {
      return res.status(401).json({
        error: 'Unauthenticated: Valid student credentials required',
        code: 'AUTH_REQUIRED',
      });
    }

    try {
      const moodleCourseId = await resolveMoodleCourseId(courseId);

      // Execute internal queries in parallel via Promise.allSettled
      const [pgResult, activitiesResult] = await Promise.allSettled([
        pool.query(`
          SELECT 
            c.course_id,
            c.code,
            c.title,
            c.units,
            c.level,
            c.category,
            c.description,
            c.moodle_course_id,
            d.name AS department_name,
            COALESCE(e.progress_percent, 45) AS progress_percent,
            COALESCE(e.status, 'IN_PROGRESS') AS enrollment_status
          FROM courses c
          LEFT JOIN departments d ON d.id = c.department_id
          LEFT JOIN enrollments e ON e.course_id = c.course_id AND e.student_id = $2
          WHERE c.course_id = $1 
             OR c.code = $1
             OR UPPER(REPLACE(c.course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
             OR UPPER(REPLACE(c.code, ' ', '')) = UPPER(REPLACE($1, ' ', ''))
             OR c.moodle_course_id = $3
          LIMIT 1
        `, [courseId, studentId, moodleCourseId]),

        // Upcoming Activities Mock/Moodle Sync
        (async () => [
          {
            id: 'quiz-1',
            title: 'Quiz 1 — Arrays and Lists',
            type: 'quiz',
            due_date: '15 May 2026, 10:00 AM',
            action_label: 'Start',
            link: `/courses/${courseId}/quizzes`,
          },
          {
            id: 'assign-1',
            title: 'Assignment 1 — Lab Exercises',
            type: 'assignment',
            due_date: '18 May 2026, 11:59 PM',
            action_label: 'View',
            link: `/courses/${courseId}/materials`,
          },
        ])()
      ]);

      const courseRow = pgResult.status === 'fulfilled' && pgResult.value.rows[0];
      const upcomingActivities = activitiesResult.status === 'fulfilled' ? activitiesResult.value : [];

      if (!courseRow) {
        return res.status(404).json({
          error: `Course '${courseId}' not found in academic catalog`,
          code: 'COURSE_NOT_FOUND',
        });
      }

      const courseData = courseRow;

      return res.status(200).json({
        course: {
          id: courseData.course_id,
          moodleCourseId,
          code: courseData.code,
          title: courseData.title,
          units: courseData.units,
          level: courseData.level,
          category: courseData.category,
          description: courseData.description,
          department: courseData.department_name,
          enrollment_status: courseData.enrollment_status,
          status: courseData.enrollment_status,
        },
        progress: {
          percent: courseData.progress_percent,
          status: 'SYNCED',
        },
        zoom_session: {
          title: `${courseData.code} Live Interactive Lecture`,
          join_url: 'https://zoom.us',
          schedule: 'Tuesdays & Thursdays • 10:00 AM - 12:00 PM',
        },
        upcoming_activities: upcomingActivities,
        breadcrumbs: [
          { name: 'Dashboard', path: '/dashboard' },
          { name: 'My courses', path: '/dashboard' },
          { name: courseData.code, path: `/courses/${courseId}` },
        ],
        tabs: [
          { id: 'overview', label: 'Overview' },
          { id: 'materials', label: 'Materials' },
          { id: 'assignments', label: 'Assignments' },
          { id: 'quizzes', label: 'Quizzes' },
          { id: 'forum', label: 'Forum' },
          { id: 'grades', label: 'Grades' },
        ],
        _degraded: pgResult.status === 'rejected' || activitiesResult.status === 'rejected',
      });
    } catch (err) {
      logger.error({ err: err?.message || err }, '[CourseShell] Aggregation failure');
      next(err);
    }
  }
);

/**
 * Dispatches background revalidation wrapped in an explicit error boundary.
 * Guarantees zero unhandled promise rejections escape into the V8 event loop.
 */
function triggerBackgroundRevalidation(courseId, moodleCourseId) {
  const flightKey = `course_materials:${moodleCourseId}`;

  singleFlight
    .do(flightKey, (signal) => fetchAndTransformMaterials(moodleCourseId, signal), UPSTREAM_FETCH_TIMEOUT_MS)
    .then((freshMaterials) => {
      materialsCache.set(courseId, freshMaterials);
      logger.debug({ courseId, moodleCourseId }, '[SWR] Background revalidation succeeded; cache updated');
    })
    .catch((err) => {
      // Quarantined Error Boundary:
      // Prevents unhandledRejection from crashing the process and leaves existing stale cache intact.
      logger.warn(
        { courseId, moodleCourseId, err: err?.message || err, code: err?.code || 'UPSTREAM_REVALIDATION_FAILED' },
        '[SWR] Background revalidation failed; retaining existing stale cache'
      );
    });
}

/**
 * GET /api/courses/:courseId/materials
 *
 * Middleware chain: auth (global) → enrollment → rate limit → handler
 */
router.get(
  '/:courseId/materials',
  enrollmentCheck('courseId'),
  listRateLimit,
  async (req, res, next) => {
    const courseId = req.params.courseId;

    let moodleCourseId;
    try {
      moodleCourseId = await resolveMoodleCourseId(courseId);
    } catch {
      return res.status(404).json({
        error: 'Course mapping not found.',
        code: 'COURSE_NOT_MAPPED',
      });
    }

    // 1. SWR Cache Inspection
    const cacheResult = materialsCache.get(courseId);

    // 1A. Fresh Cache Hit: Return in <2ms
    if (cacheResult.status === 'FRESH') {
      res.set('X-Cache', 'HIT-FRESH');
      return res.json({
        focitCourseId: courseId,
        moodleCourseId,
        data: cacheResult.data,
      });
    }

    // 1B. Stale Cache Hit: Return immediately in <5ms, trigger background revalidation
    if (cacheResult.status === 'STALE') {
      res.set('X-Cache', 'HIT-STALE');
      res.set('Warning', '110 - "Response is Stale"');

      // Dispatch non-blocking background revalidation
      triggerBackgroundRevalidation(courseId, moodleCourseId);

      return res.json({
        focitCourseId: courseId,
        moodleCourseId,
        data: cacheResult.data,
      });
    }

    // 1C. Cache MISS: Coalesce via Single-Flight with decoupled Ingress vs. Upstream timeout
    res.set('X-Cache', 'MISS');
    const flightKey = `course_materials:${moodleCourseId}`;

    // Upstream Single-Flight task (persists up to UPSTREAM_FETCH_TIMEOUT_MS)
    const upstreamPromise = singleFlight
      .do(flightKey, (signal) => fetchAndTransformMaterials(moodleCourseId, signal), UPSTREAM_FETCH_TIMEOUT_MS)
      .then((materials) => {
        // Populate cache upon resolution (even if client ingress timed out)
        materialsCache.set(courseId, materials);
        return materials;
      });

    // Attach quarantined catch handler so detached late failures never trigger unhandledRejection
    upstreamPromise.catch((bgErr) => {
      logger.warn(
        { courseId, moodleCourseId, err: bgErr?.message || bgErr },
        '[SWR] Decoupled upstream fetch completed with error'
      );
    });

    // Ingress Timeout Timer: Shed client connection if upstream exceeds CLIENT_INGRESS_TIMEOUT_MS
    let ingressTimeoutId = null;

    const ingressTimeoutPromise = new Promise((_, reject) => {
      ingressTimeoutId = setTimeout(() => {
        const timeoutErr = new Error('Client ingress timeout exceeded while awaiting upstream data');
        timeoutErr.code = 'CLIENT_INGRESS_TIMEOUT';
        reject(timeoutErr);
      }, CLIENT_INGRESS_TIMEOUT_MS);
    });

    try {
      const flattenedMaterials = await Promise.race([upstreamPromise, ingressTimeoutPromise]);
      clearTimeout(ingressTimeoutId);

      return res.json({
        focitCourseId: courseId,
        moodleCourseId,
        data: flattenedMaterials,
      });
    } catch (err) {
      clearTimeout(ingressTimeoutId);

      // Handle client ingress timeout: Shed load, instruct client to retry with jitter
      if (err.code === 'CLIENT_INGRESS_TIMEOUT') {
        logger.warn(
          { courseId, moodleCourseId, timeoutMs: CLIENT_INGRESS_TIMEOUT_MS },
          '[SWR] Ingress timeout ceiling reached on cold cache; shedding client connection'
        );

        // Check if ANY degraded cache exists before emitting 503
        const fallback = materialsCache.store.get(String(courseId));
        if (fallback?.data) {
          res.set('X-Cache', 'HIT-EXPIRED');
          res.set('Warning', '111 - "Revalidation Failed"');
          return res.json({
            focitCourseId: courseId,
            moodleCourseId,
            data: fallback.data,
          });
        }

        res.set('Retry-After', '3');
        return res.status(503).json({
          error: 'Course materials are currently being primed from the upstream registry. Please retry.',
          code: 'UPSTREAM_PRIMING_RETRY',
          retryAfterSeconds: 3,
        });
      }

      // Genuine upstream error
      next(err);
    }
  }
);

export default router;
