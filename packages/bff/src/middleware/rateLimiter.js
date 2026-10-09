/**
 * Three-Tier Rate Limiter Middleware
 *
 * Tier 1: Global Concurrency Gate (Undici pool queue depth)
 * Tier 2: Per-User Sliding Window (keyed by userId from JWT)
 * Tier 3: Per-User-Per-Resource Deduplication (prevents duplicate concurrent downloads)
 *
 * All tiers fire BEFORE requests reach Moodle, protecting the
 * upstream from being rate-limited or blacklisted by our BFF's IP.
 */

import { getMoodlePoolStats } from '../lib/moodlePool.js';
import config from '../config.js';

// ─── Tier 1: Global Concurrency Gate ──────────────────────────
// If the Undici pool's pending queue exceeds threshold,
// the server is at capacity. Reject early with 503.

const MAX_PENDING_QUEUE = 100;

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function globalConcurrencyGate(req, res, next) {
  const { pending } = getMoodlePoolStats();
  if (pending > MAX_PENDING_QUEUE) {
    return res.status(503)
      .set('Retry-After', '5')
      .json({
        error: 'Server at capacity. Please try again shortly.',
        code: 'RATE_LIMIT_SERVER_CAPACITY',
        retryAfter: 5,
      });
  }
  next();
}

// ─── Tier 2: Per-User Sliding Window ──────────────────────────
// In-memory sliding window rate limiter keyed by userId.
// Production: swap Map for Redis with INCR + EXPIRE.

/** @type {Map<string, { count: number, resetTime: number }>} */
const userWindows = new Map();

// Clean up expired windows every 60 seconds to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of userWindows) {
    if (now > record.resetTime) {
      userWindows.delete(key);
    }
  }
}, 60_000).unref(); // .unref() so this doesn't prevent process exit

/**
 * Factory: creates a per-user rate limiter for a specific endpoint type.
 *
 * @param {number} maxRequests - Max requests allowed per window
 * @param {number} windowMs - Window duration in milliseconds
 * @param {string} endpointType - Label for the rate limit bucket (e.g., 'list', 'download')
 * @returns {import('express').RequestHandler}
 */
export function perUserRateLimit(maxRequests, windowMs = 60_000, endpointType = 'general') {
  return (req, res, next) => {
    if (!req.user?.id) {
      // If auth middleware hasn't run yet, skip (shouldn't happen).
      return next();
    }

    const key = `${req.user.id}:${endpointType}`;
    const now = Date.now();
    const record = userWindows.get(key);

    // Window expired or first request — start new window
    if (!record || now > record.resetTime) {
      userWindows.set(key, { count: 1, resetTime: now + windowMs });
      res.set({
        'X-RateLimit-Limit': String(maxRequests),
        'X-RateLimit-Remaining': String(maxRequests - 1),
        'X-RateLimit-Reset': String(Math.ceil((now + windowMs) / 1000)),
      });
      return next();
    }

    // Window still active — check count
    if (record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      return res.status(429)
        .set({
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(record.resetTime / 1000)),
        })
        .json({
          error: 'Too many requests. Please slow down.',
          code: 'RATE_LIMIT_USER_EXCEEDED',
          retryAfter,
        });
    }

    record.count++;
    res.set({
      'X-RateLimit-Limit': String(maxRequests),
      'X-RateLimit-Remaining': String(maxRequests - record.count),
      'X-RateLimit-Reset': String(Math.ceil(record.resetTime / 1000)),
    });
    next();
  };
}

// Pre-configured limiters for each endpoint type
export const listRateLimit = perUserRateLimit(config.rateLimit.listMax, 60_000, 'list');
export const downloadRateLimit = perUserRateLimit(config.rateLimit.downloadMax, 60_000, 'download');
export const previewRateLimit = perUserRateLimit(config.rateLimit.previewMax, 60_000, 'preview');

// ─── Tier 3: Per-User-Per-Resource Deduplication ──────────────
// Prevents the same user from having multiple concurrent downloads
// of the same file. Prevents double-click and scripted abuse.

/** @type {Set<string>} */
const activeStreams = new Set();

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function downloadDedup(req, res, next) {
  if (!req.user?.id || !req.params.moduleId) {
    return next();
  }

  const key = `${req.user.id}:${req.params.moduleId}`;

  if (activeStreams.has(key)) {
    return res.status(429).json({
      error: 'A download for this file is already in progress.',
      code: 'RATE_LIMIT_DOWNLOAD_IN_PROGRESS',
    });
  }

  activeStreams.add(key);

  // Clean up when response finishes (success or failure) or client disconnects
  const cleanup = () => {
    activeStreams.delete(key);
    res.removeListener('finish', cleanup);
    res.removeListener('close', cleanup);
  };

  res.on('finish', cleanup);
  res.on('close', cleanup);

  next();
}
