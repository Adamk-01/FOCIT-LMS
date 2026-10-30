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
import { pool } from '../db/index.js';
import { verifyEdgeTicket } from '../services/edgeTicketService.js';

const STREAM_ROUTE_REGEX = /^\/library\/items\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/stream$/i;

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
  // Public static avatar media bypass for browser <img> tags (defended with nosniff and CSP sandbox)
  if (req.method === 'GET' && req.path.startsWith('/files/avatars')) {
    return next();
  }

  // Public calendar feed bypass authenticated exclusively via high-entropy capability token (?token=...)
  if (req.method === 'GET' && (req.path.endsWith('/timetable/calendar.ics') || req.path.includes('/timetable/calendar.ics'))) {
    return next();
  }

  // Capability Ticket Stream Verification (Mozilla PDF.js 206 Partial Content Range Worker)
  const streamMatch = req.method === 'GET' ? STREAM_ROUTE_REGEX.exec(req.path) : null;
  if (streamMatch && req.query?.ticket) {
    const itemId = streamMatch[1];
    const clientIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';
    const verification = verifyEdgeTicket(
      req.query.ticket,
      itemId,
      clientIp,
      userAgent,
      false
    );

    if (!verification.valid) {
      return res.status(403).json({
        error: `Invalid or expired stream capability ticket: ${verification.reason}`,
        code: 'STREAM_TICKET_INVALID',
      });
    }

    // Populate authoritative identity from the cryptographically verified ticket
    req.user = { id: verification.payload.sub, viaCapabilityTicket: true };
    return next();
  }

  // 1. Extract Ambient Cookie Token & Ephemeral Header/Query Nonce (EventSource transport support)
  const token = req.cookies?.focit_token || extractBearerToken(req);
  const clientNonce = req.headers['x-session-nonce'] || req.query?.nonce || req.query?.sessionNonce;

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
  // Simultaneously fetches userId, nonce, and scope in a single O(1) command
  try {
    const sessionKey = `session:${sessionId}`;
    const [storedUserId, storedNonce, storedScope] = await redis.hmget(sessionKey, 'userId', 'nonce', 'scope');

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
    const isProduction = process.env.NODE_ENV === 'production' || config.nodeEnv === 'production';
    const isDevelopment = !isProduction && (config.nodeEnv === 'development' || process.env.NODE_ENV === 'development');
    const allowPermissiveDevSync = isDevelopment && process.env.ALLOW_DEV_NONCE_SYNC === 'true';
    if (!safeTimingCompare(storedNonce, clientNonce)) {
      if (allowPermissiveDevSync) {
        logger.warn(
          { userId: payload.sub, sessionId },
          '[AuthBarrier] Local dev mode: Self-healing tab session nonce mismatch'
        );
        res.setHeader('X-Session-Nonce-Sync', storedNonce);
      } else {
        logger.warn(
          { userId: payload.sub, sessionId },
          '[AuthBarrier] Ephemeral session nonce mismatch detected'
        );
        return res.status(401).json({
          error: 'Invalid session nonce: request origin unverified',
          code: 'AUTH_NONCE_MISMATCH',
        });
      }
    }

    // 4. Zero-Trust Scoping: The RESET_ONLY Session Barrier
    const effectiveScope = storedScope || payload.scope || 'FULL_ACCESS';
    if (effectiveScope === 'RESET_ONLY') {
      const fullPath = (req.baseUrl || '') + (req.path || '');
      const isWhitelistedResetPath =
        (req.method === 'POST' && fullPath.endsWith('/student/change-password')) ||
        (req.method === 'GET' && fullPath.endsWith('/auth/status')) ||
        (req.method === 'POST' && fullPath.endsWith('/auth/logout')) ||
        (req.method === 'GET' && fullPath.endsWith('/student/profile'));

      if (!isWhitelistedResetPath) {
        logger.warn(
          { userId: payload.sub, method: req.method, fullPath },
          '[AuthBarrier] Quarantined RESET_ONLY session attempted unauthorized resource access'
        );
        return res.status(403).json({
          error: 'Account credential initialization required. All academic access is quarantined.',
          code: 'MANDATORY_PASSWORD_RESET_REQUIRED',
          action_required: 'POST /api/student/change-password',
        });
      }
    }

    // 5. Attach verified session & user context
    req.user = {
      id: payload.sub,
      student_id: payload.sub, // Canonical student_id accessor
      sessionId,
      scope: effectiveScope,
      moodleUserId: payload.moodleUserId,
      username: payload.username,
      email: payload.email,
      role: payload.role || 'STUDENT',
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
  return async (req, res, next) => {
    const rawCourseId = req.params[courseIdParam];
    if (!rawCourseId) {
      return res.status(400).json({
        error: 'Missing course ID parameter',
        code: 'ENROLLMENT_MISSING_COURSE_ID',
      });
    }

    const studentId = req.user?.student_id || req.user?.id || req.user?.username;
    if (!studentId) {
      return res.status(401).json({
        error: 'Authentication required for course enrollment verification',
        code: 'AUTH_REQUIRED',
      });
    }

    // Staff/Lecturers/Admins bypass student enrollment checks
    if (req.user?.role && req.user.role !== 'STUDENT') {
      return next();
    }

    // Test stub bypass: Only in automated test harness may token claims skip authoritative DB check
    const normalizedKey = String(rawCourseId).trim().toUpperCase().replace(/\s+/g, '');
    const isNumeric = /^\d+$/.test(rawCourseId);
    const numericId = isNumeric ? parseInt(rawCourseId, 10) : null;

    if (config.nodeEnv === 'test' && Array.isArray(req.user?.enrolledCourses) && req.user.enrolledCourses.length > 0) {
      if (numericId && req.user.enrolledCourses.includes(numericId)) {
        return next();
      }
    }

    // Authoritative PostgreSQL Ledger Verification
    try {
      const query = `
        SELECT 1
        FROM enrollments e
        JOIN courses c ON c.course_id = e.course_id
        WHERE e.student_id = $1
          AND (
            UPPER(REPLACE(c.course_id, ' ', '')) = $2
            OR UPPER(REPLACE(c.code, ' ', '')) = $2
            OR c.moodle_course_id::text = $3
          )
          AND e.status IN ('ENROLLED', 'IN_PROGRESS', 'COMPLETED')
        LIMIT 1;
      `;
      const { rows } = await pool.query(query, [studentId, normalizedKey, String(rawCourseId).trim()]);
      if (rows.length === 0) {
        return res.status(403).json({
          error: 'You are not enrolled in this course',
          code: 'ENROLLMENT_NOT_ENROLLED',
        });
      }

      next();
    } catch (err) {
      logger.error({ err: err?.message || err, studentId, rawCourseId }, '[EnrollmentCheck] Database query error');
      return next(err);
    }
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

/**
 * Role-Based Access Control (RBAC) Guard Factory
 * Enforces strict role whitelist against authenticated req.user context.
 *
 * @param {string|string[]} allowedRoles - Role or array of permitted roles (e.g. 'ADMIN', ['ADMIN', 'SYSTEM_ADMIN'])
 * @returns {import('express').RequestHandler}
 */
export function requireRole(allowedRoles) {
  const normalized = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
    .map((r) => String(r).toUpperCase());

  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({
        error: 'Authentication session required for privileged access',
        code: 'AUTH_REQUIRED',
      });
    }

    const userRole = String(req.user.role).toUpperCase();

    if (!normalized.includes(userRole)) {
      logger.warn(
        { userId: req.user.id, userRole, requiredRoles: normalized, path: req.originalUrl },
        '[RBAC] Unauthorized role access attempt blocked'
      );

      return res.status(403).json({
        error: 'Access denied: insufficient administrative privileges',
        code: 'FORBIDDEN_INSUFFICIENT_ROLE',
        requiredRoles: normalized,
      });
    }

    return next();
  };
}
