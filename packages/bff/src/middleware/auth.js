/**
 * Zero-Token CSRF Middleware Barrier
 *
 * Implements Phase 1: Ephemeral Nonce & Quarantine Protocol.
 *
 * Enforces dual-factor session validation:
 * 1. Ambient credential: HttpOnly signed JWT ('focit_token')
 * 2. Explicit client proof: Header nonce ('X-Session-Nonce')
 *
 * Validates both against Redis session hash in a single atomic lookup.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

/**
 * Constant-time string comparison preventing side-channel timing analysis attacks.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeTimingCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function authMiddleware(req, res, next) {
  // 1. Extract Ambient Cookie Token & Ephemeral Header Nonce
  const token = req.cookies?.focit_token || extractBearerToken(req);
  const clientNonce = req.headers['x-session-nonce'];

  // Fail-fast barrier: Missing credential components
  if (!token) {
    return res.status(401).json({
      error: 'Authentication required: missing session token',
      code: 'AUTH_MISSING_TOKEN',
    });
  }

  if (!clientNonce || typeof clientNonce !== 'string') {
    return res.status(401).json({
      error: 'Authentication barrier: missing or malformed ephemeral session nonce',
      code: 'AUTH_MISSING_NONCE',
    });
  }

  // 2. Cryptographic JWT Verification
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Session token expired',
        code: 'AUTH_TOKEN_EXPIRED',
      });
    }

    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid session token signature',
        code: 'AUTH_TOKEN_INVALID',
      });
    }

    return res.status(401).json({
      error: 'Authentication verification failure',
      code: 'AUTH_UNKNOWN_ERROR',
    });
  }

  // Validate session claim presence
  const sessionId = payload.sid;
  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(401).json({
      error: 'Malformed session claims: missing session identifier',
      code: 'AUTH_TOKEN_INVALID',
    });
  }

  // 3. The Single Redis Lookup Barrier
  // Simultaneously fetches userId and nonce in a single O(1) command
  try {
    const sessionKey = `session:${sessionId}`;
    const [storedUserId, storedNonce] = await redis.hmget(sessionKey, 'userId', 'nonce');

    // Edge Case: Session revoked, expired, or non-existent in Redis
    if (!storedUserId || !storedNonce) {
      return res.status(401).json({
        error: 'Session terminated or expired in backing store',
        code: 'AUTH_SESSION_TERMINATED',
      });
    }

    // Edge Case: Identity binding divergence
    if (storedUserId !== String(payload.sub)) {
      logger.warn(
        { jwtUser: payload.sub, redisUser: storedUserId, sessionId },
        '[AuthBarrier] Session record identity divergence'
      );
      return res.status(401).json({
        error: 'Session identity binding conflict',
        code: 'AUTH_INVALID_SESSION',
      });
    }

    // Edge Case: CSRF / Nonce mismatch using constant-time evaluation
    if (!safeTimingCompare(storedNonce, clientNonce)) {
      logger.warn(
        { userId: payload.sub, sessionId },
        '[AuthBarrier] Ephemeral session nonce mismatch detected'
      );
      return res.status(401).json({
        error: 'Invalid session nonce: request origin unverified',
        code: 'AUTH_NONCE_MISMATCH',
      });
    }

    // 4. Attach verified session & user context
    req.user = {
      id: payload.sub,
      sessionId,
      moodleUserId: payload.moodleUserId,
      username: payload.username,
      email: payload.email,
      enrolledCourses: payload.enrolledCourses ?? [],
    };

    return next();
  } catch (redisErr) {
    // Fail-Closed Boundary: Never grant access if session store is unavailable
    logger.error(
      { err: redisErr?.message || redisErr, sessionId },
      '[AuthBarrier] Redis session lookup failed'
    );
    return res.status(503).json({
      error: 'Authentication state verification temporarily unavailable',
      code: 'AUTH_SERVICE_UNAVAILABLE',
    });
  }
}

/**
 * Enrollment check middleware factory.
 * Verifies the authenticated user is enrolled in the requested course.
 *
 * @param {string} courseIdParam - The route parameter name for the course ID
 * @returns {import('express').RequestHandler}
 */
export function enrollmentCheck(courseIdParam = 'courseId') {
  return (req, res, next) => {
    const courseIdParamValue = req.params[courseIdParam];
    if (!courseIdParamValue) {
      return res.status(400).json({
        error: 'Missing course ID parameter',
        code: 'ENROLLMENT_MISSING_COURSE_ID',
      });
    }

    let checkId;
    if (/^\d+$/.test(courseIdParamValue)) {
      checkId = parseInt(courseIdParamValue, 10);
    } else {
      const mockDb = { 'CSC204': 1, 'CSC202': 2, 'MTH101': 3 };
      checkId = mockDb[courseIdParamValue.toUpperCase()];
    }

    if (!checkId || !req.user?.enrolledCourses?.includes(checkId)) {
      return res.status(403).json({
        error: 'You are not enrolled in this course',
        code: 'ENROLLMENT_NOT_ENROLLED',
      });
    }

    next();
  };
}

/**
 * Extract bearer token from Authorization header.
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}
