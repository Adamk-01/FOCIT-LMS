/**
 * Digital Library Route Handler — /api/library
 *
 * Implements Phase 12 Architecture under the 8-8-8 Doctrine:
 * 1. Zero-Heap RFC 9110 Streaming Engine (200 OK, 206 Partial Content, 416 Range Not Satisfiable).
 * 2. Socket Teardown & EMFILE Leak Prevention via explicit AbortController + pipeline(signal).
 * 3. Hot-Row Contention Elimination: Decoupled library_item_metrics with HOT updates.
 * 4. Invariant 3 Concurrency: Lexicographically sorted batch flushes (Dijkstra Resource Ordering).
 * 5. Telemetry Deduplication Fence: 30-minute inline view lease, 60-second download debounce.
 * 6. Composite Course Aggregator with Graceful Degradation: Promise.allSettled(1500ms) fallback.
 */

import { Router } from 'express';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { listRateLimit } from '../middleware/rateLimiter.js';
import { getCourseContents } from '../lib/moodleApi.js';
import { materialsCache } from '../lib/materialsCache.js';
import { recordTelemetryEvent, rotateAndDrainTelemetry } from '../services/telemetryBufferService.js';
import { generateEdgeTicket, verifyEdgeTicket } from '../services/edgeTicketService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '../../.cache');
const LIBRARY_DIR = path.join(CACHE_DIR, 'library');

const router = Router();

// ─── 1. CRASH-SAFE TELEMETRY BUFFER INTEGRATION ──────────────────────
// Decouples ingestion to Redis cluster with worker-plane persistence (Phase 13C)
function recordTelemetry(studentId, itemId, eventType) {
  recordTelemetryEvent(studentId, itemId, eventType).catch((err) => {
    logger.debug({ err: err?.message, itemId }, '[Library] Background telemetry record notice');
  });
  return true;
}

/**
 * Flushes aggregated metrics to PostgreSQL via Crash-Safe Telemetry Service.
 * Exported for test backwards-compatibility and manual worker invocation.
 */
export async function flushMetricsBuffer() {
  return rotateAndDrainTelemetry(pool);
}

// ─── 2. CATEGORIES TAXONOMY ENDPOINT ─────────────────────────────────
/**
 * GET /api/library/categories
 * Returns taxonomy categories with live published item counts
 */
router.get('/categories', listRateLimit, async (req, res, next) => {
  try {
    const cacheKey = 'library:categories:all';
    const cached = materialsCache.get(cacheKey);
    if (cached && cached.data) {
      return res.json({ data: cached.data, cached: true });
    }

    const { rows } = await pool.query(`
      SELECT 
        c.id, c.slug, c.name, c.description, c.icon_name, c.display_order,
        COUNT(i.id)::int AS item_count
      FROM library_categories c
      LEFT JOIN library_items i 
        ON i.category_id = c.id 
       AND i.is_published = TRUE 
       AND (i.embargo_until IS NULL OR i.embargo_until <= NOW())
      GROUP BY c.id, c.slug, c.name, c.description, c.icon_name, c.display_order
      ORDER BY c.display_order ASC;
    `);

    materialsCache.set(cacheKey, rows);
    return res.json({ data: rows, cached: false });
  } catch (err) {
    next(err);
  }
});

// ─── 3. COURSE PICKER CATALOG ENDPOINT ───────────────────────────────
/**
 * GET /api/library/courses/catalog
 * Returns faculty courses annotated with student enrollment and material counts
 */
router.get('/courses/catalog', listRateLimit, async (req, res, next) => {
  try {
    const studentId = req.user?.student_id || req.user?.id || req.user?.username || 'student1';

    const { rows } = await pool.query(`
      SELECT 
        c.course_id, c.code, c.title, c.department_id, c.level,
        COUNT(i.id)::int AS material_count,
        EXISTS (
          SELECT 1 FROM enrollments e 
          WHERE e.course_id = c.course_id 
            AND e.student_id = $1 
            AND e.status IN ('ENROLLED', 'PASSED')
        ) AS is_enrolled
      FROM courses c
      LEFT JOIN library_items i 
        ON i.course_id = c.course_id 
       AND i.is_published = TRUE 
       AND (i.embargo_until IS NULL OR i.embargo_until <= NOW())
      GROUP BY c.course_id, c.code, c.title, c.department_id, c.level
      ORDER BY is_enrolled DESC, c.level ASC, c.code ASC;
    `, [studentId]);

    return res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

// ─── 4. REPOSITORY ITEMS SEARCH & FILTER ENDPOINT ────────────────────
/**
 * GET /api/library/items
 * Multi-dimensional academic repository search with composite course module aggregation
 */
router.get('/items', listRateLimit, async (req, res, next) => {
  const startTs = Date.now();
  try {
    const category = req.query.category && req.query.category !== 'all' ? String(req.query.category).trim() : null;
    const courseId = req.query.courseId ? String(req.query.courseId).trim() : null;
    const departmentId = req.query.departmentId ? String(req.query.departmentId).trim() : null;
    const level = req.query.level ? parseInt(req.query.level, 10) : null;
    const academicSession = req.query.session ? String(req.query.session).trim() : null;
    const semester = req.query.semester ? parseInt(req.query.semester, 10) : null;
    const itemType = req.query.itemType ? String(req.query.itemType).trim() : null;
    const queryTerm = req.query.q ? String(req.query.q).trim() : null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const offset = (page - 1) * limit;

    // Build dynamic SQL conditions
    const conditions = [
      'i.is_published = TRUE',
      '(i.embargo_until IS NULL OR i.embargo_until <= NOW())'
    ];
    const params = [];

    if (category) {
      params.push(category);
      conditions.push(`i.category_id = $${params.length}`);
    }

    if (courseId) {
      params.push(courseId.toUpperCase().replace(/\s+/g, ''));
      conditions.push(`UPPER(REPLACE(i.course_id, ' ', '')) = $${params.length}`);
    }

    if (departmentId) {
      params.push(departmentId.toUpperCase());
      conditions.push(`UPPER(i.department_id) = $${params.length}`);
    }

    if (level) {
      params.push(level);
      conditions.push(`i.level = $${params.length}`);
    }

    if (academicSession) {
      params.push(academicSession);
      conditions.push(`i.academic_session = $${params.length}`);
    }

    if (semester) {
      params.push(semester);
      conditions.push(`i.semester_number = $${params.length}`);
    }

    if (itemType) {
      params.push(itemType);
      conditions.push(`i.item_type = $${params.length}`);
    }

    let searchJoin = '';
    let orderBy = 'i.is_featured DESC, i.created_at DESC';

    if (queryTerm) {
      params.push(queryTerm);
      const qIdx = params.length;
      conditions.push(`i.search_vector @@ websearch_to_tsquery('english', $${qIdx})`);
      orderBy = `ts_rank(i.search_vector, websearch_to_tsquery('english', $${qIdx})) DESC, i.created_at DESC`;
    }

    const whereClause = conditions.join(' AND ');

    // 1. Authoritative PostgreSQL Catalog Query
    const countSql = `SELECT COUNT(*)::int AS total FROM library_items i WHERE ${whereClause}`;
    const dataSql = `
      SELECT 
        i.id,
        i.category_id,
        i.title,
        i.description,
        i.author,
        i.publisher,
        i.publication_year,
        i.edition,
        i.isbn,
        i.course_id,
        i.department_id,
        i.level,
        i.academic_session,
        i.semester_number,
        i.item_type,
        i.file_url,
        i.file_size_bytes,
        i.mime_type,
        i.page_count,
        i.cover_image_url,
        i.is_featured,
        i.is_published,
        i.created_at,
        COALESCE(m.view_count, 0)::int AS view_count,
        COALESCE(m.download_count, 0)::int AS download_count,
        'POSTGRESQL_AUTHORITATIVE' AS source,
        FALSE AS is_stale
      FROM library_items i
      LEFT JOIN library_item_metrics m ON m.item_id = i.id
      WHERE ${whereClause}
      ORDER BY ${orderBy}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;

    const countPromise = pool.query(countSql, params);
    const dataPromise = pool.query(dataSql, [...params, limit, offset]);

    // 2. Parallel Moodle Fan-Out if Category === 'courses' and courseId is provided
    let moodlePromise = null;
    if (category === 'courses' && courseId) {
      moodlePromise = (async () => {
        // Enforce aggressive 1,500ms timeout boundary
        const moodleAc = new AbortController();
        const timeoutId = setTimeout(() => moodleAc.abort(), 1500);
        try {
          // Look up moodle_course_id
          const courseLookup = await pool.query(
            'SELECT moodle_course_id FROM courses WHERE UPPER(REPLACE(course_id, \' \', \'\')) = $1 LIMIT 1',
            [courseId.toUpperCase().replace(/\s+/g, '')]
          );
          const moodleCourseId = courseLookup.rows[0]?.moodle_course_id || 1;
          const rawSections = await getCourseContents(moodleCourseId, moodleAc.signal);
          clearTimeout(timeoutId);

          const moodleItems = rawSections.flatMap(sec => 
            (sec.materials || []).map(mat => ({
              id: `moodle-${mat.moduleId || mat.id}`,
              category_id: 'courses',
              title: mat.name,
              description: `Moodle course module: ${mat.name}`,
              author: 'Course Lecturer (Moodle Core)',
              course_id: courseId,
              level: null,
              item_type: 'LECTURE_NOTE',
              file_url: mat.url,
              file_size_bytes: mat.sizeBytes || 0,
              mime_type: 'application/pdf',
              page_count: null,
              cover_image_url: null,
              is_featured: false,
              is_published: true,
              created_at: mat.createdAt || new Date().toISOString(),
              view_count: 0,
              download_count: 0,
              source: 'MOODLE_UPSTREAM',
              is_stale: false,
            }))
          );

          // Update SWR cache with fresh Moodle modules
          materialsCache.set(`library_moodle_modules:${courseId}`, moodleItems);
          return { status: 'HEALTHY', items: moodleItems };
        } catch (err) {
          clearTimeout(timeoutId);
          // Check SWR cache for stale fallback
          const stale = materialsCache.get(`library_moodle_modules:${courseId}`);
          return {
            status: 'DEGRADED',
            error: err.name === 'AbortError' ? 'Moodle upstream timeout (>1500ms)' : err.message,
            items: stale?.data?.map(item => ({ ...item, is_stale: true, source: 'MOODLE_SWR_CACHE' })) || [],
            staleFallback: Boolean(stale?.data?.length)
          };
        }
      })();
    }

    const [countRes, dataRes, moodleRes] = await Promise.all([
      countPromise,
      dataPromise,
      moodlePromise ? moodlePromise : Promise.resolve(null)
    ]);

    let combinedItems = dataRes.rows;
    let isDegraded = false;
    let moodleMeta = { status: 'SKIPPED' };

    if (moodleRes) {
      if (moodleRes.status === 'DEGRADED') {
        isDegraded = true;
        moodleMeta = {
          status: 'DEGRADED',
          error: moodleRes.error,
          staleFallback: moodleRes.staleFallback,
          staleCount: moodleRes.items.length
        };
      } else {
        moodleMeta = { status: 'HEALTHY', count: moodleRes.items.length };
      }

      // Merge Moodle items into the active list if not searching textually
      if (moodleRes.items.length > 0 && !queryTerm) {
        combinedItems = [...combinedItems, ...moodleRes.items];
      }
    }

    const totalCount = countRes.rows[0].total + (moodleRes?.items?.length || 0);
    const pgLatency = Date.now() - startTs;

    return res.json({
      data: combinedItems,
      meta: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit) || 1,
        _degraded: isDegraded,
        sources: {
          postgresql: { status: 'HEALTHY', latencyMs: pgLatency, count: dataRes.rows.length },
          moodle: moodleMeta
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// ─── 4B. EDGE CAPABILITY TICKET ISSUER ──────────────────────────────
/**
 * GET /api/library/items/:id/ticket
 * Issues an ephemeral HMAC-SHA256 Capability Lease Ticket (15-30 min)
 * for multi-range PDF.js streaming and Cloudflare Edge caching (Phase 13D).
 */
router.get('/items/:id/ticket', async (req, res, next) => {
  const { id } = req.params;
  const studentId = req.user?.student_id || req.user?.id || req.user?.username || 'anonymous_student';

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      type: 'https://focit.uniosun.edu.ng/errors/invalid-identifier',
      title: 'Invalid Item Identifier',
      status: 400,
      detail: `The requested identifier '${id}' is not a valid canonical UUID.`,
      code: 'INVALID_IDENTIFIER'
    });
  }

    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    // Fold reading progress query directly via LEFT JOIN into single composite round-trip (Invariant 6)
    const { rows } = await pool.query(`
      SELECT 
        li.id, 
        li.title, 
        li.is_published, 
        li.embargo_until,
        rp.last_page,
        rp.max_page_reached,
        rp.total_pages,
        rp.percentage,
        rp.updated_at
      FROM library_items li
      LEFT JOIN library_reading_progress rp 
        ON rp.item_id = li.id AND rp.student_id = $2
      WHERE li.id = $1 
      LIMIT 1;
    `, [id, studentId]);

    const item = rows[0];
    if (!item) {
      return res.status(404).json({
        type: 'https://focit.uniosun.edu.ng/errors/file-not-found',
        title: 'Resource Not Found',
        status: 404,
        detail: `The requested library item '${id}' does not exist in the catalog.`,
        code: 'FILE_NOT_FOUND'
      });
    }

    if (!item.is_published || (item.embargo_until && new Date(item.embargo_until) > new Date())) {
      return res.status(403).json({
        type: 'https://focit.uniosun.edu.ng/errors/embargoed-resource',
        title: 'Access Restricted',
        status: 403,
        detail: 'This examination paper or resource is currently under academic embargo.',
        code: 'EMBARGOED_RESOURCE'
      });
    }

    const ticketData = generateEdgeTicket(studentId, id, clientIp, userAgent, 1800);

    const readingProgress = item.last_page ? {
      hasProgress: true,
      lastPage: item.last_page,
      maxPageReached: item.max_page_reached,
      totalPages: item.total_pages,
      percentage: item.percentage,
      updatedAt: item.updated_at,
    } : {
      hasProgress: false,
      lastPage: 1,
      maxPageReached: 1,
      totalPages: null,
      percentage: 0,
      updatedAt: null,
    };

    return res.status(200).json({
      ticket: ticketData.ticket,
      expiresAt: ticketData.expiresAt,
      streamUrl: ticketData.streamUrl,
      readingProgress,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 4C. CROSS-DEVICE READING PROGRESS LEDGER ───────────────────────
/**
 * GET /api/library/items/:id/progress
 * Returns the student's authoritative reading position for seamless cross-device resumption.
 */
router.get('/items/:id/progress', async (req, res, next) => {
  const { id } = req.params;
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;

  if (!studentId) {
    return res.status(200).json({ hasProgress: false, lastPage: 1 });
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      type: 'https://focit.uniosun.edu.ng/errors/invalid-identifier',
      title: 'Invalid Item Identifier',
      status: 400,
      detail: `The requested identifier '${id}' is not a valid canonical UUID.`,
      code: 'INVALID_IDENTIFIER'
    });
  }

  try {
    const { rows } = await pool.query(`
      SELECT last_page, max_page_reached, total_pages, percentage, updated_at
      FROM library_reading_progress
      WHERE student_id = $1 AND item_id = $2
      LIMIT 1;
    `, [studentId, id]);

    if (rows.length === 0) {
      return res.status(200).json({
        hasProgress: false,
        lastPage: 1,
        maxPageReached: 1,
        totalPages: null,
        percentage: 0,
        updatedAt: null,
      });
    }

    const row = rows[0];
    return res.status(200).json({
      hasProgress: true,
      lastPage: row.last_page,
      maxPageReached: row.max_page_reached,
      totalPages: row.total_pages,
      percentage: row.percentage,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/library/items/:id/progress
 * Saves the student's current reading position with monotonic progress guarantees.
 * Calculates percentage strictly server-side using max_page_reached to prevent spoofing or regression.
 */
router.put('/items/:id/progress', async (req, res, next) => {
  const { id } = req.params;
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;

  if (!studentId) {
    return res.status(401).json({
      type: 'https://focit.uniosun.edu.ng/errors/unauthorized',
      title: 'Authentication Required',
      status: 401,
      detail: 'Only authenticated students can persist academic reading progress.',
      code: 'UNAUTHORIZED'
    });
  }

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      type: 'https://focit.uniosun.edu.ng/errors/invalid-identifier',
      title: 'Invalid Item Identifier',
      status: 400,
      detail: `The requested identifier '${id}' is not a valid canonical UUID.`,
      code: 'INVALID_IDENTIFIER'
    });
  }

  const rawPage = parseInt(req.body.page, 10);
  const rawTotalPages = req.body.totalPages ? parseInt(req.body.totalPages, 10) : null;

  if (!rawPage || rawPage < 1 || isNaN(rawPage)) {
    return res.status(400).json({
      type: 'https://focit.uniosun.edu.ng/errors/invalid-page',
      title: 'Invalid Page Number',
      status: 400,
      detail: 'Page must be an integer >= 1.',
      code: 'INVALID_PAGE'
    });
  }

  const totalPages = rawTotalPages && rawTotalPages > 0 ? rawTotalPages : null;
  // Defensive clamp: student cannot supply a page number exceeding totalPages
  const page = totalPages ? Math.min(rawPage, totalPages) : rawPage;

  try {
    const { rows } = await pool.query(`
      INSERT INTO library_reading_progress (
        student_id, 
        item_id, 
        last_page, 
        max_page_reached, 
        total_pages, 
        percentage, 
        updated_at
      )
      VALUES (
        $1, 
        $2, 
        LEAST($3::integer, COALESCE(NULLIF($4::integer, 0), $3::integer)), 
        LEAST($3::integer, COALESCE(NULLIF($4::integer, 0), $3::integer)), 
        $4::integer, 
        CASE 
          WHEN $4::integer IS NOT NULL AND $4::integer > 0 THEN LEAST(100, ROUND(($3::numeric / $4::numeric) * 100)::int)
          ELSE 0 
        END, 
        NOW()
      )
      ON CONFLICT (student_id, item_id) DO UPDATE SET
        last_page = LEAST(EXCLUDED.last_page, COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages, EXCLUDED.last_page)),
        max_page_reached = LEAST(
          GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page),
          COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages, GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page))
        ),
        total_pages = COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages),
        percentage = CASE 
          WHEN COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages) IS NOT NULL 
               AND COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages) > 0 
          THEN LEAST(100, ROUND(
            (LEAST(
              GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page),
              COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages, GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page))
            )::numeric 
             / COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages)::numeric) * 100
          )::int)
          ELSE library_reading_progress.percentage
        END,
        updated_at = NOW()
      RETURNING last_page, max_page_reached, total_pages, percentage, updated_at;
    `, [studentId, id, page, totalPages]);

    const saved = rows[0];
    return res.status(200).json({
      success: true,
      lastPage: saved.last_page,
      maxPageReached: saved.max_page_reached,
      percentage: saved.percentage,
      totalPages: saved.total_pages,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 5. ZERO-HEAP STREAMING & RANGE CONTROLLER ───────────────────────
/**
 * GET /api/library/items/:id/stream
 * Serves zero-heap byte slices adhering strictly to RFC 9110 (200, 206, 416).
 * Enforces socket termination and backpressure without EMFILE handle leaks.
 * Supports capability ticket authentication for Cloudflare Edge & PDF.js.
 */
router.get('/items/:id/stream', async (req, res, next) => {
  const { id } = req.params;
  const ticket = req.query.ticket;
  let studentId = req.user?.student_id || req.user?.id || req.user?.username;

  if (ticket) {
    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';
    const verifyRes = verifyEdgeTicket(ticket, id, clientIp, userAgent, false);
    if (!verifyRes.valid) {
      return res.status(403).json({
        type: 'https://focit.uniosun.edu.ng/errors/invalid-ticket',
        title: 'Capability Ticket Rejected',
        status: 403,
        detail: `Edge capability ticket verification failed: ${verifyRes.reason}`,
        code: 'INVALID_TICKET'
      });
    }
    studentId = studentId || verifyRes.payload?.sub || 'ticket_student';
  } else if (!studentId) {
    studentId = 'anonymous_student';
  }

  const isDownload = req.query.download === '1' || req.query.download === 'true';

  // 0. Strict Canonical UUID Validation: Eliminates PostgreSQL 22P02 syntax errors & path traversal
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !UUID_REGEX.test(id)) {
    return res.status(400).json({
      type: 'https://focit.uniosun.edu.ng/errors/invalid-identifier',
      title: 'Invalid Item Identifier',
      status: 400,
      detail: `The requested identifier '${id}' is not a valid canonical UUID.`,
      code: 'INVALID_IDENTIFIER'
    });
  }

  try {
    // 1. Verify item existence in PostgreSQL metadata ledger
    const { rows } = await pool.query(`
      SELECT id, title, file_url, file_size_bytes, mime_type, is_published, embargo_until
      FROM library_items
      WHERE id = $1 LIMIT 1;
    `, [id]);

    const item = rows[0];
    if (!item) {
      return res.status(404).json({
        type: 'https://focit.uniosun.edu.ng/errors/file-not-found',
        title: 'Resource Not Found',
        status: 404,
        detail: `The requested library item '${id}' does not exist in the catalog.`,
        code: 'FILE_NOT_FOUND'
      });
    }

    // 2. Embargo security check
    if (!item.is_published || (item.embargo_until && new Date(item.embargo_until) > new Date())) {
      return res.status(403).json({
        type: 'https://focit.uniosun.edu.ng/errors/embargoed-resource',
        title: 'Access Restricted',
        status: 403,
        detail: 'This examination paper or resource is currently under academic embargo.',
        code: 'EMBARGOED_RESOURCE'
      });
    }

    // 3. Locate physical file on disk (.cache/library/${id}.pdf)
    const localPath = path.join(LIBRARY_DIR, `${id}.pdf`);
    let stat;
    try {
      stat = await fs.stat(localPath);
    } catch (fsErr) {
      if (fsErr.code === 'ENOENT') {
        logger.warn({ id, localPath }, '[Library Stream] Physical binary missing from local cache');
        return res.status(404).json({
          type: 'https://focit.uniosun.edu.ng/errors/binary-missing',
          title: 'File Content Missing',
          status: 404,
          detail: 'The physical binary file for this catalog item is missing from storage.',
          code: 'FILE_NOT_FOUND'
        });
      }
      throw fsErr;
    }

    const fileSize = stat.size;
    const sanitizedTitle = (item.title || 'document').replace(/[^a-zA-Z0-9_\-.]/g, '_');
    const filename = `${sanitizedTitle}.pdf`;

    // 4. Evaluate RFC 9110 Range Header
    const rangeHeader = req.headers.range;
    let start = 0;
    let end = fileSize - 1;
    let isRangeRequest = false;

    if (rangeHeader) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
      if (!match) {
        // Malformed range header: RFC 9110 §14.1.2 mandates 416
        res.status(416);
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }

      start = parseInt(match[1], 10);
      const rawEnd = match[2] !== '' ? parseInt(match[2], 10) : fileSize - 1;

      // RFC 9110 §14.1.2: Check if first-byte-pos is unsatisfiable
      if (start >= fileSize || start < 0 || (match[2] !== '' && start > rawEnd)) {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }

      // RFC 9110 §14.1.2: Clamp last-pos to representation end if absent or >= fileSize
      end = Math.min(rawEnd, fileSize - 1);
      isRangeRequest = true;
    }

    // 5. Deduplicate and record telemetry (Zero locks during request)
    // Only the initial slice (start === 0) or full download is eligible
    if (!rangeHeader || start === 0) {
      recordTelemetry(studentId, id, isDownload ? 'DOWNLOAD' : 'VIEW');
    }

    // 6. Set HTTP Headers
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=0, must-revalidate');
    res.setHeader('Content-Type', item.mime_type || 'application/pdf');
    res.setHeader('Content-Disposition', isDownload ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');

    let statusCode = 200;
    let chunkSize = fileSize;

    if (isRangeRequest) {
      statusCode = 206;
      chunkSize = (end - start) + 1;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    }

    res.setHeader('Content-Length', chunkSize);
    res.status(statusCode);

    // 7. Socket Teardown & EMFILE Prevention via AbortController
    const ac = new AbortController();
    const onDisconnect = () => {
      if (!res.writableEnded) {
        ac.abort();
      }
    };

    req.once('aborted', onDisconnect);
    res.once('close', onDisconnect);

    // Instantiate bounded stream with 64KB highWaterMark
    const readStream = createReadStream(localPath, { 
      start, 
      end, 
      highWaterMark: 64 * 1024 
    });

    try {
      // Pipeline automatically manages backpressure:
      // If client is on 3G and pauses, pipeline pauses readStream.
      // If client aborts, pipeline destroys readStream.
      await pipeline(readStream, res, { signal: ac.signal });
    } catch (streamErr) {
      if (streamErr.name === 'AbortError' || streamErr.code === 'ERR_STREAM_PREMATURE_CLOSE') {
        // Normal student tab close or skip-page navigation
        logger.debug({ id, studentId }, '[Library Stream] Client aborted stream');
      } else {
        logger.error({ id, err: streamErr?.message || streamErr }, '[Library Stream] Unexpected stream failure');
        if (!res.headersSent) {
          res.status(500).end();
        }
      }
    } finally {
      // Unconditional socket and file handle cleanup
      req.removeListener('aborted', onDisconnect);
      res.removeListener('close', onDisconnect);
      if (!readStream.destroyed) {
        readStream.destroy();
      }
    }
  } catch (err) {
    next(err);
  }
});

export default router;
