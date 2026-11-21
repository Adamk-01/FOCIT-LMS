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
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

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

// ─── Tier 2: Per-User Distributed Rate Limiting (F13 Remediation) ───
// Distributed atomic sliding window rate limiter backed by Redis (with in-memory Map fallback).

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
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));

  return async (req, res, next) => {
    if (!req.user?.id) {
      return next();
    }

    const userId = req.user.id;
    const redisKey = `rl:user:${endpointType}:${userId}`;
    const now = Date.now();

    // 1. Distributed Redis Rate Limiting (F13 Hardening)
    if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(redisKey);
        pipeline.ttl(redisKey);
        const results = await pipeline.exec();

        const count = results?.[0]?.[1] || 1;
        let ttl = results?.[1]?.[1] || -1;

        if (count === 1 || ttl === -1) {
          await redis.expire(redisKey, windowSeconds);
          ttl = windowSeconds;
        }

        const remaining = Math.max(0, maxRequests - count);
        const resetTimeSec = Math.ceil(now / 1000) + (ttl > 0 ? ttl : windowSeconds);

        res.set({
          'X-RateLimit-Limit': String(maxRequests),
          'X-RateLimit-Remaining': String(remaining),
          'X-RateLimit-Reset': String(resetTimeSec),
        });

        if (count > maxRequests) {
          const retryAfter = ttl > 0 ? ttl : windowSeconds;
          return res.status(429)
            .set('Retry-After', String(retryAfter))
            .json({
              error: `Too many requests for ${endpointType}. Please slow down.`,
              code: 'RATE_LIMIT_USER_EXCEEDED',
              retryAfter,
            });
        }

        return next();
      } catch (err) {
        logger.warn({ err: err?.message || err, userId }, '[RateLimiter] Redis perUserRateLimit failed, falling back to memory store');
      }
    }

    // 2. In-memory fallback if Redis is offline
    const memoryKey = `${userId}:${endpointType}`;
    const record = userWindows.get(memoryKey);

    // Window expired or first request — start new window
    if (!record || now > record.resetTime) {
      userWindows.set(memoryKey, { count: 1, resetTime: now + windowMs });
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

/** @type {Map<string, { count: number, resetTime: number }>} */
const memoryLoginWindows = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryLoginWindows) {
    if (now > record.resetTime) {
      memoryLoginWindows.delete(key);
    }
  }
}, 60_000).unref();

/**
 * Unauthenticated Login Sliding Window Rate Limiter (F14 Remediation)
 * Protects POST /api/auth/login against credential stuffing & CPU scrypt DoS.
 * Limit: Max 25 attempts per IP and max 5 attempts per candidate studentId per 15 minutes.
 */
export async function loginRateLimiter(req, res, next) {
  const rawIp = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
  const ip = String(rawIp).split(',')[0].trim();
  const candidateId = (req.body?.studentId || '').toString().trim().toUpperCase().replace(/\s+/g, '');

  const ipKey = `rl:login:ip:${ip}`;
  const userKey = candidateId ? `rl:login:user:${candidateId}` : null;
  const WINDOW_SECONDS = 900; // 15 minutes
  const WINDOW_MS = WINDOW_SECONDS * 1000;
  const now = Date.now();

  try {
    if (redis && (redis.status === 'ready' || redis.status === 'connect')) {
      const pipeline = redis.pipeline();
      pipeline.incr(ipKey);
      if (userKey) pipeline.incr(userKey);
      const results = await pipeline.exec();

      const ipCount = results?.[0]?.[1] || 1;
      const userCount = userKey ? (results?.[1]?.[1] || 1) : 1;

      if (ipCount === 1) await redis.expire(ipKey, WINDOW_SECONDS);
      if (userKey && userCount === 1) await redis.expire(userKey, WINDOW_SECONDS);

      if (ipCount > 25 || userCount > 5) {
        logger.warn({ ip, candidateId, ipCount, userCount }, '[RateLimiter] Login brute-force rate limit triggered');
        const ttl = await redis.ttl(userCount > 5 ? userKey : ipKey);
        const retryAfter = ttl > 0 ? ttl : WINDOW_SECONDS;

        return res.status(429)
          .set('Retry-After', String(retryAfter))
          .json({
            error: 'Too many login attempts. Please wait 15 minutes before trying again.',
            code: 'AUTH_RATE_LIMIT_EXCEEDED',
            retryAfter,
          });
      }
      return next();
    }
  } catch (err) {
    logger.warn({ err: err?.message || err }, '[RateLimiter] Redis login rate limit check failed, falling back to memory store');
  }

  // Resilient in-memory fallback if Redis is offline
  const memIpRec = memoryLoginWindows.get(ipKey);
  const memUserRec = userKey ? memoryLoginWindows.get(userKey) : null;

  const currentIpCount = (!memIpRec || now > memIpRec.resetTime) ? 1 : memIpRec.count + 1;
  const currentUserCount = userKey ? ((!memUserRec || now > memUserRec.resetTime) ? 1 : memUserRec.count + 1) : 1;

  memoryLoginWindows.set(ipKey, { count: currentIpCount, resetTime: (!memIpRec || now > memIpRec.resetTime) ? now + WINDOW_MS : memIpRec.resetTime });
  if (userKey) {
    memoryLoginWindows.set(userKey, { count: currentUserCount, resetTime: (!memUserRec || now > memUserRec.resetTime) ? now + WINDOW_MS : memUserRec.resetTime });
  }

  if (currentIpCount > 25 || currentUserCount > 5) {
    logger.warn({ ip, candidateId, currentIpCount, currentUserCount }, '[RateLimiter] In-memory login rate limit triggered');
    return res.status(429)
      .set('Retry-After', String(WINDOW_SECONDS))
      .json({
        error: 'Too many login attempts. Please wait 15 minutes before trying again.',
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        retryAfter: WINDOW_SECONDS,
      });
  }

  next();
}
