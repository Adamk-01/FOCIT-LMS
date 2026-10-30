/**
 * Authentication & Session Management Router
 *
 * Implements:
 * 1. The Ephemeral Nonce Handshake (POST /login)
 * 2. Idempotent Server Session Revocation (POST /logout)
 * 3. Session Status & Skew Calibration (GET /status)
 */

import express from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../config.js';
import { redis } from '../lib/redis.js';
import { redisCircuitBreaker } from '../lib/redisCircuitBreaker.js';
import { logger } from '../lib/logger.js';
import { pool } from '../db/index.js';
import { verifyPassword } from '../lib/passwords.js';
import { recordIdentityAuditLog } from '../lib/auditLogger.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
const SESSION_TTL_SECONDS = 3600; // 1 hour session lifetime

/**
 * 1. THE HANDSHAKE: POST /api/auth/login
 * Real cryptographic verification:
 * - Queries students and staff_advisors tables
 * - Verifies password via async libuv threadpool scrypt (OWASP params)
 * - Evaluates must_change_password flag for RESET_ONLY vs FULL_ACCESS session scoping
 * - Appends immutable security audit event into identity_audit_logs
 * - Returns 256-bit ephemeral nonce exclusively in JSON body
 */
router.post('/login', async (req, res) => {
  const { studentId, password } = req.body || {};
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';

  // Input sanitization & defensive validation
  if (!studentId || typeof studentId !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({
      error: 'Invalid credentials payload: studentId and password required',
      code: 'AUTH_INVALID_PAYLOAD',
    });
  }

  const candidateId = studentId.trim();

  try {
    // 1. Query Authoritative Student Identity
    let user = null;
    const studentRes = await pool.query(
      `
      SELECT 
        s.student_id,
        s.matric_number,
        s.username,
        s.full_name,
        s.email,
        s.level,
        s.account_status,
        sp.password_hash,
        COALESCE(sp.must_change_password, FALSE) AS must_change_password,
        'STUDENT' AS role
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.student_id
      WHERE s.student_id = $1 
         OR s.username = $1 
         OR s.matric_number = $1
         OR UPPER(s.matric_number) = UPPER($1)
         OR UPPER(s.matric_number) = UPPER(CASE WHEN $1 LIKE 'FOCIT/%' THEN $1 ELSE 'FOCIT/' || $1 END)
      `,
      [candidateId]
    );

    if (studentRes.rows.length > 0) {
      user = studentRes.rows[0];
    } else {
      // 2. Query Staff Advisors & Governance Officers
      const staffRes = await pool.query(
        `
        SELECT 
          advisor_id AS student_id,
          staff_number AS matric_number,
          advisor_id AS username,
          full_name,
          email,
          assigned_level AS level,
          account_status,
          password_hash,
          COALESCE(must_change_password, FALSE) AS must_change_password,
          role
        FROM staff_advisors
        WHERE advisor_id = $1 OR staff_number = $1 OR UPPER(staff_number) = UPPER($1) OR email = $1
        `,
        [candidateId]
      );

      if (staffRes.rows.length > 0) {
        user = staffRes.rows[0];
      }
    }

    // Edge Case: Unknown identity
    if (!user) {
      await recordIdentityAuditLog(pool, {
        eventType: 'AUTHENTICATION_FAILURE',
        actorId: candidateId,
        actorRole: 'ANONYMOUS',
        targetId: candidateId,
        targetType: 'CREDENTIALS',
        ipAddress,
        userAgent,
        metadata: { reason: 'IDENTITY_NOT_FOUND' },
      }).catch((e) => logger.warn({ e }, '[AuthHandshake] Audit log write failure'));

      return res.status(401).json({
        error: 'Invalid institutional credentials. Please check your Student ID / Matric Number and password.',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // 3. Cryptographic Password Verification via async scrypt
    const isPasswordValid = await verifyPassword(password, user.password_hash);
    if (!isPasswordValid) {
      await recordIdentityAuditLog(pool, {
        eventType: 'AUTHENTICATION_FAILURE',
        actorId: user.student_id,
        actorRole: user.role,
        targetId: user.student_id,
        targetType: 'CREDENTIALS',
        ipAddress,
        userAgent,
        metadata: { reason: 'PASSWORD_MISMATCH' },
      }).catch((e) => logger.warn({ e }, '[AuthHandshake] Audit log write failure'));

      return res.status(401).json({
        error: 'Invalid institutional credentials. Please check your Student ID / Matric Number and password.',
        code: 'INVALID_CREDENTIALS',
      });
    }

    // 4. Edge Case: Suspended or locked account enforcement AFTER credential verification
    // (Prevents Account State Oracle / User Enumeration attacks: OWASP ASVS 4.0.3)
    const userStatus = String(user.account_status || 'ACTIVE').toUpperCase();
    if (userStatus === 'SUSPENDED') {
      await recordIdentityAuditLog(pool, {
        eventType: 'AUTHENTICATION_BLOCKED_SUSPENDED',
        actorId: user.student_id,
        actorRole: user.role,
        targetId: user.student_id,
        targetType: 'ACCOUNT_STATUS',
        ipAddress,
        userAgent,
        metadata: { reason: 'ACCOUNT_SUSPENDED' },
      }).catch((e) => logger.warn({ e }, '[AuthHandshake] Audit log write failure'));

      return res.status(403).json({
        error: 'Your account has been suspended. Please contact the Faculty Administrator.',
        code: 'ACCOUNT_SUSPENDED',
      });
    }

    if (userStatus === 'LOCKED') {
      await recordIdentityAuditLog(pool, {
        eventType: 'AUTHENTICATION_BLOCKED_LOCKED',
        actorId: user.student_id,
        actorRole: user.role,
        targetId: user.student_id,
        targetType: 'ACCOUNT_STATUS',
        ipAddress,
        userAgent,
        metadata: { reason: 'ACCOUNT_LOCKED' },
      }).catch((e) => logger.warn({ e }, '[AuthHandshake] Audit log write failure'));

      return res.status(403).json({
        error: 'Your account has been locked due to security policy. Please contact the Faculty Administrator.',
        code: 'ACCOUNT_LOCKED',
      });
    }

    // 4. Session Scoping Determination (Zero-Trust Quarantined State Machine)
    const sessionScope = user.must_change_password ? 'RESET_ONLY' : 'FULL_ACCESS';

    // 5. Generate 256-bit entropy ephemeral nonce & session UUID
    const sessionId = crypto.randomUUID();
    const sessionNonce = crypto.randomBytes(32).toString('hex');
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + SESSION_TTL_SECONDS;

    // 6. Atomic session write into Redis with deterministic TTL & scope, protected by Circuit Breaker
    const sessionKey = `session:${sessionId}`;
    await redisCircuitBreaker.execute(async () => {
      const pipeline = redis.pipeline();
      pipeline.hset(sessionKey, {
        userId: String(user.student_id),
        username: user.username,
        role: user.role,
        scope: sessionScope,
        mustChangePassword: user.must_change_password ? '1' : '0',
        nonce: sessionNonce,
        createdAt: String(nowSec),
      });
      pipeline.expire(sessionKey, SESSION_TTL_SECONDS);
      pipeline.sadd(`user_sessions:${String(user.student_id)}`, sessionId);
      pipeline.expire(`user_sessions:${String(user.student_id)}`, SESSION_TTL_SECONDS);

      const results = await pipeline.exec();
      if (!results) {
        throw new Error('Redis pipeline returned null results');
      }
      for (const [cmdErr] of results) {
        if (cmdErr) throw cmdErr;
      }
      return results;
    }, 5000);

    // 7. Issue signed JWT carrying the session ID and scope strictly AFTER persistence confirmed
    const token = jwt.sign(
      {
        sub: user.student_id,
        sid: sessionId,
        username: user.username,
        email: user.email,
        role: user.role,
        scope: sessionScope,
        mustChangePassword: user.must_change_password,
      },
      config.jwt.secret,
      {
        expiresIn: SESSION_TTL_SECONDS,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
      }
    );

    // 8. Bind ambient credential via hardened HttpOnly cookie
    res.cookie('focit_token', token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_TTL_SECONDS * 1000,
    });

    // 9. Append Immutable Security Audit Ledger Entry
    await recordIdentityAuditLog(pool, {
      eventType: 'AUTHENTICATION_SUCCESS',
      actorId: user.student_id,
      actorRole: user.role,
      targetId: user.student_id,
      targetType: 'CREDENTIALS',
      ipAddress,
      userAgent,
      sessionId,
      metadata: {
        scope: sessionScope,
        must_change_password: user.must_change_password,
      },
    }).catch((e) => logger.warn({ e }, '[AuthHandshake] Audit log write failure'));

    logger.info({ userId: user.student_id, sessionId, scope: sessionScope }, '[AuthHandshake] Session established');

    // 10. Return the ephemeral nonce in the JSON payload — NEVER in a cookie
    return res.status(200).json({
      status: 'authenticated',
      scope: sessionScope,
      mustChangePassword: user.must_change_password,
      user: {
        id: user.student_id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
      },
      sessionNonce, // Strict Zero-Token CSRF proof for client memory
      exp: expSec,
      server_epoch: nowSec,
      server_epoch_ms: Date.now(),
    });
  } catch (err) {
    if (err.code === 'CIRCUIT_BREAKER_OPEN' || err.code === 'CIRCUIT_BREAKER_TIMEOUT') {
      logger.warn({ code: err.code }, '[AuthHandshake] Redis circuit breaker fast-fail triggered');
      res.set('Retry-After', '5');
      return res.status(503).json({
        error: 'Authentication session store is temporarily unavailable. Please retry in 5 seconds.',
        code: 'AUTH_SERVICE_UNAVAILABLE',
        retryAfterSeconds: 5,
      });
    }

    logger.error({ err: err?.message || err }, '[AuthHandshake] Login process failure');
    return res.status(500).json({
      error: 'Authentication processing failed on security server',
      code: 'AUTH_PROCESSING_ERROR',
    });
  }
});

/**
 * 2. POST /api/auth/logout
 * Idempotently revokes the Redis session hash and purges the HttpOnly cookie.
 */
router.post('/logout', authMiddleware, async (req, res) => {
  const sessionId = req.user?.sessionId;

  try {
    if (sessionId) {
      await redis.del(`session:${sessionId}`);
      if (req.user?.id) {
        await redis.srem(`user_sessions:${req.user.id}`, sessionId).catch(() => {});
      }
      logger.info({ sessionId, userId: req.user?.id }, '[AuthLogout] Session revoked in Redis');
    }

    // Always clear the ambient cookie with exact matching attributes
    res.clearCookie('focit_token', {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return res.status(200).json({
      status: 'revoked',
      message: 'Session successfully revoked',
    });
  } catch (err) {
    logger.error({ err: err?.message || err, sessionId }, '[AuthLogout] Session revocation error');
    // Still clear the client cookie even if Redis delete had an issue
    res.clearCookie('focit_token', {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/',
    });

    return res.status(500).json({
      error: 'Failed to complete session revocation on server',
      code: 'LOGOUT_REVOCATION_FAILED',
    });
  }
});

/**
 * 3. GET /api/auth/status
 * Background verification & clock-skew calibration endpoint.
 */
router.get('/status', authMiddleware, (req, res) => {
  const nowMs = Date.now();
  return res.status(200).json({
    status: 'authenticated',
    user: req.user,
    server_epoch: Math.floor(nowMs / 1000),
    server_epoch_ms: nowMs,
  });
});

export default router;
