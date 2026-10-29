/**
 * Files Route — GET /api/files/:moduleId/:filename
 */

import { Router } from 'express';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline as streamPipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import moodlePool from '../lib/moodlePool.js';
import config from '../config.js';
import { pool } from '../db/index.js';
import { LRUDiskCache } from '../lib/lruDiskCache.js';
import { enrollmentCheck } from '../middleware/auth.js';
import { listRateLimit } from '../middleware/rateLimiter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '../../.cache');

// 2GB quota for the LRU disk cache
const cache = new LRUDiskCache(CACHE_DIR, 2 * 1024 * 1024 * 1024);
await cache.init();

const router = Router();

/**
 * Helper to serve a sliced file honoring HTTP Range from the local disk cache
 */
async function serveLocalSlice(req, res, localPath, contentType = 'application/pdf', filename = 'document.pdf') {
  const stat = await fs.stat(localPath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const isDownload = req.query?.download === '1' || req.query?.download === 'true';
  res.setHeader('Content-Disposition', isDownload ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`);

  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] !== '' ? parseInt(match[2], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }

      const chunkSize = (end - start) + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Type', contentType);

      const readStream = createReadStream(localPath, { start, end });
      await streamPipeline(readStream, res);
      return;
    }
  }

  // Full file fallback
  res.status(200);
  res.setHeader('Content-Length', fileSize);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  
  const readStream = createReadStream(localPath);
  await streamPipeline(readStream, res);
}

/**
 * GET /api/files/avatars/:filename
 * Serves processed student avatars with Cache-Control headers
 */
router.get('/avatars/:filename', async (req, res) => {
  const { filename } = req.params;
  const sanitized = path.basename(filename);
  const avatarPath = path.join(CACHE_DIR, 'avatars', sanitized);
  try {
    await fs.stat(avatarPath);
    const ext = path.extname(sanitized).toLowerCase();
    const mime = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'image/jpeg';
    
    // Strict Stored XSS & Polyglot File Execution Mitigations
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    createReadStream(avatarPath).pipe(res);
  } catch (err) {
    return res.status(404).json({ error: 'Avatar image not found', code: 'AVATAR_NOT_FOUND' });
  }
});

/**
 * GET /api/files/sheets/:filename
 * Serves scanned attendance sheets with strict course-level authorization
 */
router.get('/sheets/:filename', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required to view attendance sheets', code: 'AUTH_REQUIRED' });
  }

  const { filename } = req.params;
  const sanitized = path.basename(filename);
  const sheetPath = path.join(CACHE_DIR, 'sheets', sanitized);

  try {
    await fs.stat(sheetPath);

    // Finding 7: Enforce course-level authorization for the requested attendance sheet
    const userRole = String(req.user?.role || '').toUpperCase();
    const userId = req.user?.username || req.user?.id || req.user?.student_id;

    if (!['ADMIN', 'SYSTEM_ADMIN'].includes(userRole)) {
      // Authoritatively resolve course from attendance sessions
      const sessionRes = await pool.query(
        `SELECT course_id FROM attendance_sessions 
         WHERE sheet_image_urls::text LIKE '%' || $1 || '%' 
         LIMIT 1`,
        [sanitized]
      );

      const courseId = sessionRes.rows[0]?.course_id;

      // Fail-closed security barrier: Unlinked sheets cannot be accessed by non-admins
      if (!courseId) {
        return res.status(404).json({
          error: 'Attendance sheet is not associated with any recorded course session',
          code: 'UNLINKED_SHEET_RECORD',
        });
      }

      if (['LECTURER', 'HOD', 'LEVEL_ADVISOR'].includes(userRole)) {
        const isAllocated = await pool.query(
          `SELECT 1 FROM hod_course_allocations WHERE (course_id = $1 OR UPPER(REPLACE(course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))) AND lecturer_id = $2 LIMIT 1`,
          [courseId, userId]
        );
        const isDeptHod = await pool.query(
          `SELECT 1 FROM staff_advisors sa 
           JOIN courses c ON c.department_id = sa.department_id 
           WHERE sa.advisor_id = $1 AND sa.role = 'HOD' AND (c.course_id = $2 OR UPPER(REPLACE(c.course_id, ' ', '')) = UPPER(REPLACE($2, ' ', ''))) LIMIT 1`,
          [userId, courseId]
        );
        if (isAllocated.rows.length === 0 && isDeptHod.rows.length === 0) {
          return res.status(403).json({
            error: 'Forbidden: You are not authorized to access attendance records for this course',
            code: 'FORBIDDEN_SHEET_ACCESS',
          });
        }
      } else {
        // Appointed course representative authorization check
        // Ordinary enrolled students must NOT view raw physical attendance sheets (aligned with attendance listing redaction)
        const isRep = await pool.query(
          `SELECT 1 FROM course_representatives 
           WHERE (course_id = $1 OR UPPER(REPLACE(course_id, ' ', '')) = UPPER(REPLACE($1, ' ', ''))) AND student_id = $2 LIMIT 1`,
          [courseId, userId]
        );
        if (isRep.rows.length === 0) {
          return res.status(403).json({
            error: 'Forbidden: Physical attendance sheets are restricted to course lecturers and designated course representatives',
            code: 'FORBIDDEN_SHEET_ACCESS',
          });
        }
      }
    }

    const ext = path.extname(sanitized).toLowerCase();
    const mime = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : 'image/jpeg';
    
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    createReadStream(sheetPath).pipe(res);
  } catch (err) {
    return res.status(404).json({ error: 'Attendance sheet image not found', code: 'SHEET_NOT_FOUND' });
  }
});

/**
 * GET /api/files/:moduleId/:filename OR /api/files/:fileId
 *
 * Middleware chain: auth (global) → enrollment → rate limit → handler
 */
router.get(
  ['/:moduleId/:filename', '/:fileId'],

  (req, res, next) => {
    let { moduleId, fileId } = req.params;
    if (!moduleId && fileId) {
      const hyphenIndex = fileId.indexOf('-');
      req.params.moduleId = hyphenIndex !== -1 ? fileId.slice(0, hyphenIndex) : fileId;
    }
    next();
  },
  enrollmentCheck('moduleId'),
  listRateLimit,
  async (req, res, next) => {
    try {
      let { moduleId, filename, fileId } = req.params;
      if (!filename && fileId) {
        const hyphenIndex = fileId.indexOf('-');
        if (hyphenIndex !== -1) {
          moduleId = fileId.slice(0, hyphenIndex);
          filename = fileId.slice(hyphenIndex + 1);
        } else {
          moduleId = fileId;
          filename = 'document.pdf';
        }
      }

      const cacheKey = `${moduleId}-${filename}`;
      const range = req.headers.range;

      // 1. Check if fully cached or currently downloading (The Promise Lock)
      if (cache.has(cacheKey) || cache.isInflight(cacheKey)) {
        const localPath = await cache.getOrWait(cacheKey);
        return serveLocalSlice(req, res, localPath, 'application/pdf', filename);
      }

      // 2. Not in cache. Fetch from Moodle, passing the Range header
      // Note: We append the raw token to the Moodle URL because pluginfile.php
      // requires it in the query string or cookie.
      const query = new URLSearchParams({ token: config.moodle.wsToken });
      const headers = {};
      if (range) headers['Range'] = range;

      const { statusCode, headers: moodleHeaders, body } = await moodlePool.request({
        path: `/pluginfile.php/${moduleId}/${encodeURIComponent(filename)}?${query.toString()}`,
        method: 'GET',
        headers
      });

      // 3. Moodle respected the Range (206): Direct Proxy (Bypass Cache)
      // We cannot cache partial chunks natively without assembling them.
      if (statusCode === 206) {
        res.status(206);
        res.setHeader('Content-Range', moodleHeaders['content-range']);
        res.setHeader('Content-Length', moodleHeaders['content-length']);
        res.setHeader('Content-Type', moodleHeaders['content-type'] || 'application/pdf');
        await streamPipeline(body, res);
        return;
      }

      if (statusCode !== 200) {
        throw new Error(`Moodle returned HTTP ${statusCode}`);
      }

      const contentLength = parseInt(moodleHeaders['content-length'] || '0', 10);
      const contentType = moodleHeaders['content-type'] || 'application/pdf';

      // 4. File too large for quota -> Direct Proxy
      if (contentLength > cache.maxSizeBytes) {
        res.status(200);
        res.setHeader('Content-Length', contentLength);
        res.setHeader('Content-Type', contentType);
        await streamPipeline(body, res);
        return;
      }

      // 5. Moodle ignored Range (Returned 200 OK). 
      // Write to cache using Pessimistic Space Reservation.
      const localPath = await cache.writeToCache(cacheKey, body, contentLength);

      // 6. Serve the local slice to satisfy the client's original Range request
      return serveLocalSlice(req, res, localPath, contentType, filename);

    } catch (err) {
      if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // Client disconnected
      if (err.name === 'AbortError') return;
      next(err);
    }
  }
);

export default router;
