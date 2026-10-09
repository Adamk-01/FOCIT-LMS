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

const router = Router();

const CLIENT_INGRESS_TIMEOUT_MS = 3000;
const UPSTREAM_FETCH_TIMEOUT_MS = 10000;

/**
 * Resolves FOCIT course code to Moodle course ID
 */
async function resolveMoodleCourseId(focitCourseCode) {
  if (/^\d+$/.test(focitCourseCode)) {
    return parseInt(focitCourseCode, 10);
  }

  const mockDb = {
    'CSC204': 1,
    'CSC202': 2,
    'MTH101': 3,
  };

  const moodleId = mockDb[focitCourseCode.toUpperCase()];
  if (!moodleId) {
    throw new Error(`Course not mapped: ${focitCourseCode}`);
  }

  return moodleId;
}

/**
 * Worker function that queries Moodle and transforms sections into flattened materials.
 */
async function fetchAndTransformMaterials(moodleCourseId, signal) {
  const sanitizedSections = await getCourseContents(moodleCourseId, signal);

  return sanitizedSections.flatMap((section) =>
    section.materials.map((material) => ({
      id: material.id,
      title: material.name,
      type: material.type || 'pdf',
      createdAt: material.createdAt || new Date().toISOString(),
    }))
  );
}

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
