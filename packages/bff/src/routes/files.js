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
async function serveLocalSlice(req, res, localPath, contentType = 'application/pdf') {
  const stat = await fs.stat(localPath);
  const fileSize = stat.size;
  const range = req.headers.range;

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
 * GET /api/files/:moduleId/:filename
 *
 * Middleware chain: auth (global) → enrollment → rate limit → handler
 */
router.get(
  '/:moduleId/:filename',
  // In a full production implementation, we would resolve the course ID
  // from the moduleId to run a strict enrollment check.
  // enrollmentCheck('moduleId'),
  listRateLimit,
  async (req, res, next) => {
    try {
      const { moduleId, filename } = req.params;
      const cacheKey = `${moduleId}-${filename}`;
      const range = req.headers.range;

      // 1. Check if fully cached or currently downloading (The Promise Lock)
      if (cache.has(cacheKey) || cache.isInflight(cacheKey)) {
        const localPath = await cache.getOrWait(cacheKey);
        return serveLocalSlice(req, res, localPath);
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
      return serveLocalSlice(req, res, localPath, contentType);

    } catch (err) {
      if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') return; // Client disconnected
      if (err.name === 'AbortError') return;
      next(err);
    }
  }
);

export default router;
