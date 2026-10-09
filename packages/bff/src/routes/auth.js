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
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();
const SESSION_TTL_SECONDS = 3600; // 1 hour session lifetime

/**
 * 1. THE HANDSHAKE: POST /api/auth/login
 * Generates high-entropy ephemeral nonce, writes Redis session hash,
 * issues HttpOnly JWT, and returns nonce solely in the response JSON payload.
 */
router.post('/login', async (req, res) => {
  const { studentId, password } = req.body || {};

  // Input sanitization & defensive validation
  if (!studentId || typeof studentId !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({
      error: 'Invalid credentials payload: studentId and password required',
      code: 'AUTH_INVALID_PAYLOAD',
    });
  }

  // Simulated identity resolution (production binds against Moodle / Active Directory)
  const resolvedUser = {
    id: 1,
    moodleUserId: 1001,
    username: studentId.trim(),
    email: `${studentId.trim().toLowerCase().replace(/[^a-z0-9]/g, '')}@focit.uniosun.edu.ng`,
    enrolledCourses: [1, 2, 3],
  };

  try {
    // Generate 256-bit entropy ephemeral nonce & session UUID
    const sessionId = crypto.randomUUID();
    const sessionNonce = crypto.randomBytes(32).toString('hex');
    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + SESSION_TTL_SECONDS;

    // Atomic session write into Redis with deterministic TTL, protected by Circuit Breaker
    const sessionKey = `session:${sessionId}`;
    await redisCircuitBreaker.execute(async () => {
      const pipeline = redis.pipeline();
      pipeline.hset(sessionKey, {
        userId: String(resolvedUser.id),
        nonce: sessionNonce,
        createdAt: String(nowSec),
      });
      pipeline.expire(sessionKey, SESSION_TTL_SECONDS);

      const results = await pipeline.exec();
      if (!results) {
        throw new Error('Redis pipeline returned null results');
      }
      for (const [cmdErr] of results) {
        if (cmdErr) throw cmdErr;
      }
      return results;
    }, 500); // 500ms hard socket deadline

    // Issue signed JWT carrying the session ID pointer strictly AFTER persistence confirmed
    const token = jwt.sign(
      {
        sub: resolvedUser.id,
        sid: sessionId,
        moodleUserId: resolvedUser.moodleUserId,
        username: resolvedUser.username,
        email: resolvedUser.email,
        enrolledCourses: resolvedUser.enrolledCourses,
      },
      config.jwt.secret,
      {
        expiresIn: SESSION_TTL_SECONDS,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
      }
    );

    // Bind ambient credential via hardened HttpOnly cookie
    res.cookie('focit_token', token, {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_TTL_SECONDS * 1000,
    });

    logger.info({ userId: resolvedUser.id, sessionId }, '[AuthHandshake] Session established');

    // Return the ephemeral nonce in the JSON payload — NEVER in a cookie
    return res.status(200).json({
      status: 'authenticated',
      user: {
        id: resolvedUser.id,
        username: resolvedUser.username,
        email: resolvedUser.email,
        enrolledCourses: resolvedUser.enrolledCourses,
      },
      sessionNonce, // Strict Zero-Token CSRF proof for client memory
      exp: expSec,
      server_epoch: nowSec,
      server_epoch_ms: Date.now(), // High-resolution millisecond timestamp for Cristian's Algorithm
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
    return res.status(503).json({
      error: 'Authentication failed due to backing session store failure',
      code: 'AUTH_SERVICE_UNAVAILABLE',
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
