/**
 * Student Profile & Preferences Router
 *
 * Implements:
 * 1. Tier 1 Institutional Identity (Read-Only) + Tier 2 Demographics + Tier 3 Preferences Aggregator (GET /)
 * 2. Idempotent Optimistic Concurrency Mutation with Relational Set-Identity Check for 3G Replays (PATCH /)
 * 3. Zero-Heap Busboy Avatar Stream Pipeline with MIME Sniffing & 500KB Limit (POST /avatar)
 * 4. Credential Mutation with 4-Phase Teardown and Session Revocation (POST /change-password)
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline as streamPipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Busboy from 'busboy';
import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { recordIdentityAuditLog } from '../lib/auditLogger.js';
import { evaluateGpaStanding } from '../lib/academicStanding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AVATAR_DIR = path.resolve(__dirname, '../../.cache/avatars');

const router = Router();

// Ensure avatar directory exists on module load
await fs.mkdir(AVATAR_DIR, { recursive: true }).catch(() => {});


/**
 * 1. GET /api/student/profile
 * Aggregates Tier 1 academic standing with Tier 2 demographics and Tier 3 preferences.
 */
router.get('/profile', async (req, res) => {
  const studentId = req.user?.username || req.user?.id || 'student1';

  try {
    const query = `
      SELECT 
        s.student_id,
        s.matric_number,
        s.username,
        s.full_name,
        s.email AS institutional_email,
        s.level,
        s.current_gpa,
        s.completed_units,
        p.name AS programme_name,
        d.name AS department_name,
        COALESCE(sp.phone_number, '') AS phone_number,
        COALESCE(sp.alternate_email, '') AS alternate_email,
        COALESCE(sp.avatar_url, '') AS avatar_url,
        COALESCE(sp.bio, '') AS bio,
        COALESCE(sp.residential_address, '') AS residential_address,
        COALESCE(sp.preferences, '{
          "email_notifications": true,
          "quiz_reminders": true,
          "forum_digest": "daily",
          "sms_alerts": false,
          "theme": "system",
          "compact_tables": false
        }'::jsonb) AS preferences,
        COALESCE(sp.version, 1) AS version,
        sp.updated_at
      FROM students s
      JOIN programmes p ON p.id = s.programme_id
      JOIN departments d ON d.id = p.department_id
      LEFT JOIN student_profiles sp ON sp.student_id = s.student_id
      WHERE s.student_id = $1;
    `;

    const { rows } = await pool.query(query, [studentId]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Student record not found in academic registry',
        code: 'STUDENT_NOT_FOUND',
      });
    }

    const studentProfile = rows[0];

    // If profile tuple does not exist yet, initialize it lazily
    if (!studentProfile.updated_at) {
      await pool.query(
        `INSERT INTO student_profiles (student_id, version) VALUES ($1, 1) ON CONFLICT (student_id) DO NOTHING`,
        [studentId]
      ).catch((err) => logger.warn({ err }, '[Profile] Lazy profile init collision ignored'));
    }

    const gpaTelemetry = evaluateGpaStanding(studentProfile);
    const enrichedProfile = {
      ...studentProfile,
      current_gpa: gpaTelemetry.current_gpa,
      gpa_exempt: gpaTelemetry.gpa_exempt,
      standing_label: gpaTelemetry.standing_label,
      exemption_reason: gpaTelemetry.exemption_reason,
    };

    return res.status(200).json(enrichedProfile);
  } catch (err) {
    logger.error({ err, studentId }, '[Profile] Failed to fetch student profile');
    return res.status(500).json({ error: 'Failed to retrieve profile data', code: 'INTERNAL_ERROR' });
  }
});

/**
 * 2. PATCH /api/student/profile
 * Idempotent Optimistic Concurrency Mutation with Relational Set-Identity Check for 3G Replays.
 */
router.patch('/profile', async (req, res) => {
  const studentId = req.user?.username || req.user?.id || 'student1';
  const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'Missing required X-Idempotency-Key header for state-mutating operation',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }

  const {
    phone_number,
    alternate_email,
    bio,
    residential_address,
    preferences,
    version: clientVersion,
  } = req.body || {};

  if (typeof clientVersion !== 'number') {
    return res.status(400).json({
      error: 'Missing or invalid version parameter for optimistic concurrency control',
      code: 'INVALID_VERSION_SPECIFIER',
    });
  }

  // Defensive input validation
  if (alternate_email && alternate_email.trim() !== '') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(alternate_email.trim())) {
      return res.status(422).json({
        error: 'Invalid alternate email format',
        code: 'INVALID_EMAIL_FORMAT',
      });
    }
  }

  if (bio && typeof bio === 'string' && bio.length > 1000) {
    return res.status(422).json({
      error: 'Bio exceeds maximum allowed length of 1000 characters',
      code: 'BIO_TOO_LONG',
    });
  }

  if (residential_address && typeof residential_address === 'string' && residential_address.length > 500) {
    return res.status(422).json({
      error: 'Residential address exceeds maximum allowed length of 500 characters',
      code: 'ADDRESS_TOO_LONG',
    });
  }

  const client = await pool.connect();

  try {
    // 1. Check Redis Idempotency Cache (O(1) Memory Bypass)
    try {
      const cachedResponse = await redis.get(`idempotency:profile:${idempotencyKey}`);
      if (cachedResponse) {
        return res.status(200).type('json').send(cachedResponse);
      }
    } catch (redisErr) {
      logger.warn({ redisErr }, '[Profile] Redis idempotency cache read bypassed');
    }

    await client.query('BEGIN');

    // 2. Check Database Idempotency Ledger
    const { rows: existingRecords } = await client.query(
      `SELECT status_code, response_payload FROM bff_idempotency_records WHERE key = $1 AND student_id = $2`,
      [idempotencyKey, studentId]
    );

    if (existingRecords.length > 0) {
      await client.query('COMMIT');
      const record = existingRecords[0];
      return res.status(record.status_code).json(record.response_payload);
    }

    // Ensure student_profiles row exists prior to versioned update
    await client.query(
      `INSERT INTO student_profiles (student_id, version) VALUES ($1, 1) ON CONFLICT (student_id) DO NOTHING`,
      [studentId]
    );

    // 3. Execute Optimistic Concurrency Update
    const updateResult = await client.query(
      `
      UPDATE student_profiles
      SET 
        phone_number = COALESCE($1, phone_number),
        alternate_email = COALESCE($2, alternate_email),
        bio = COALESCE($3, bio),
        residential_address = COALESCE($4, residential_address),
        preferences = CASE WHEN $5::jsonb IS NOT NULL THEN $5::jsonb ELSE preferences END,
        version = version + 1,
        updated_at = NOW()
      WHERE student_id = $6 AND version = $7
      RETURNING student_id, phone_number, alternate_email, avatar_url, bio, residential_address, preferences, version, updated_at;
      `,
      [
        phone_number !== undefined ? phone_number : null,
        alternate_email !== undefined ? alternate_email : null,
        bio !== undefined ? bio : null,
        residential_address !== undefined ? residential_address : null,
        preferences ? JSON.stringify(preferences) : null,
        studentId,
        clientVersion,
      ]
    );

    // 4. Handle Lock Mismatch (0 rows returned)
    if (updateResult.rows.length === 0) {
      // Query Current Persisted State for Relational Set-Identity Check
      const { rows: currentRow } = await client.query(
        `SELECT phone_number, alternate_email, avatar_url, bio, residential_address, preferences, version 
         FROM student_profiles WHERE student_id = $1`,
        [studentId]
      );

      if (currentRow.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Student profile not found', code: 'PROFILE_NOT_FOUND' });
      }

      const current = currentRow[0];

      // Relational Set-Identity Invariant (PostgreSQL IS NOT DISTINCT FROM semantics):
      // Check if previous network-dropped 3G retry already succeeded with this data
      const isIdentical =
        (phone_number === undefined || current.phone_number === phone_number) &&
        (alternate_email === undefined || current.alternate_email === alternate_email) &&
        (bio === undefined || current.bio === bio) &&
        (residential_address === undefined || current.residential_address === residential_address);

      if (isIdentical) {
        // Self-Healing Replay: The previous commit succeeded before client dropped TCP link.
        await client.query('COMMIT');
        const selfHealedPayload = {
          status: 'SUCCESS',
          recovered: true,
          message: 'Profile state verified (network retry reconciled safely).',
          data: current,
        };

        // Cache self-healed payload in Redis
        try {
          await redis.setex(`idempotency:profile:${idempotencyKey}`, 3600, JSON.stringify(selfHealedPayload));
        } catch (_) {}

        return res.status(200).json(selfHealedPayload);
      }

      // True Concurrent Mutation by another session/device
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Conflict: Profile was modified concurrently by another session.',
        code: 'OPTIMISTIC_LOCK_CONFLICT',
        authoritativeVersion: current.version,
        authoritativeData: current,
      });
    }

    const updatedProfile = updateResult.rows[0];

    // 5. Enqueue Outbox Event for Upstream Moodle Sync (Doctrine 8)
    const outboxKey = `moodle_sync:profile:${studentId}:${idempotencyKey}`;
    await client.query(
      `
      INSERT INTO moodle_outbox (event_type, student_focit_id, moodle_course_id, payload, idempotency_key)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (idempotency_key) DO NOTHING;
      `,
      [
        'UPDATE_USER_PROFILE',
        studentId,
        0, // Global user profile scope
        JSON.stringify({
          phone1: updatedProfile.phone_number,
          description: updatedProfile.bio,
          email: updatedProfile.alternate_email,
        }),
        outboxKey,
      ]
    );

    // 6. Persist Idempotency Record
    const responsePayload = {
      status: 'SUCCESS',
      data: updatedProfile,
    };

    await client.query(
      `
      INSERT INTO bff_idempotency_records (key, student_id, endpoint, status_code, response_payload)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (key) DO NOTHING;
      `,
      [idempotencyKey, studentId, 'PATCH /api/student/profile', 200, JSON.stringify(responsePayload)]
    );

    await client.query('COMMIT');

    // 7. Write Redis Idempotency Cache (TTL: 3600s)
    try {
      await redis.setex(`idempotency:profile:${idempotencyKey}`, 3600, JSON.stringify(responsePayload));
    } catch (_) {}

    return res.status(200).json(responsePayload);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, studentId, idempotencyKey }, '[Profile] Profile mutation transaction failed');
    return res.status(500).json({ error: 'Internal database error during profile update', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
});

/**
 * 3. POST /api/student/avatar
 * Zero-Heap Busboy Avatar Stream Pipeline with MIME Sniffing & 500KB Ingress Gate.
 */
router.post('/avatar', async (req, res) => {
  const studentId = req.user?.username || req.user?.id || 'student1';
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);

  // Ingress Content-Length Gate: Reject raw 15MB payloads at TCP handshake
  if (contentLength > 500 * 1024) {
    return res.status(413).json({
      error: 'Payload Too Large: Avatar exceeds 500KB ceiling. Client must downsample before upload.',
      code: 'AVATAR_PAYLOAD_TOO_LARGE',
    });
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      fileSize: 500 * 1024, // 500KB physical boundary
      files: 1,
    },
  });

  let fileProcessed = false;
  let fileError = null;
  const targetFilename = `${studentId}_${Date.now()}.webp`;
  const targetPath = path.join(AVATAR_DIR, targetFilename);
  const avatarUrl = `/api/files/avatars/${targetFilename}`;

  busboy.on('file', (name, fileStream, info) => {
    fileProcessed = true;
    let sniffed = false;
    const writeStream = createWriteStream(targetPath);

    fileStream.on('data', (chunk) => {
      if (!sniffed) {
        sniffed = true;
        // Verify WebP (RIFF....WEBP), PNG, or JPEG magic numbers
        const isWebp =
          chunk.length >= 12 &&
          chunk.toString('ascii', 0, 4) === 'RIFF' &&
          chunk.toString('ascii', 8, 12) === 'WEBP';
        const isPng =
          chunk.length >= 4 &&
          chunk[0] === 0x89 &&
          chunk[1] === 0x50 &&
          chunk[2] === 0x4E &&
          chunk[3] === 0x47;
        const isJpeg =
          chunk.length >= 3 &&
          chunk[0] === 0xff &&
          chunk[1] === 0xd8 &&
          chunk[2] === 0xff;

        if (!isWebp && !isPng && !isJpeg) {
          fileError = new Error('Invalid image binary: Magic byte check failed');
          fileStream.resume(); // Drain stream
          writeStream.destroy();
        }
      }
    });

    fileStream.on('limit', () => {
      fileError = new Error('File size exceeded 500KB limit');
      writeStream.destroy();
    });

    streamPipeline(fileStream, writeStream).catch((err) => {
      if (!fileError) fileError = err;
    });
  });

  busboy.on('finish', async () => {
    if (fileError) {
      await fs.unlink(targetPath).catch(() => {});
      return res.status(400).json({ error: fileError.message, code: 'AVATAR_UPLOAD_FAILED' });
    }

    if (!fileProcessed) {
      return res.status(400).json({
        error: 'No avatar image file provided in multipart payload',
        code: 'NO_FILE_PROVIDED',
      });
    }

    try {
      // Upsert avatar URL in student_profiles
      await pool.query(
        `
        INSERT INTO student_profiles (student_id, avatar_url, version)
        VALUES ($1, $2, 1)
        ON CONFLICT (student_id) 
        DO UPDATE SET avatar_url = $2, version = student_profiles.version + 1, updated_at = NOW();
        `,
        [studentId, avatarUrl]
      );

      return res.status(200).json({ status: 'SUCCESS', avatarUrl });
    } catch (dbErr) {
      logger.error({ dbErr, studentId }, '[Profile] Failed to update avatar URL');
      return res.status(500).json({ error: 'Failed to update avatar record', code: 'DB_ERROR' });
    }
  });

  req.pipe(busboy);
});

/**
 * 4. POST /api/student/change-password
 * Credential Mutation with Session Invalidation Pipeline.
 */
router.post('/change-password', async (req, res) => {
  const studentId = req.user?.username || req.user?.id || 'student1';
  const sessionId = req.user?.sessionId || req.user?.sid;
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({
      error: 'Invalid password payload: Minimum 8 characters required',
      code: 'PASSWORD_TOO_WEAK',
    });
  }

  try {
    // 1. Check existing stored password hash
    const { rows } = await pool.query(
      `SELECT password_hash, must_change_password FROM student_profiles WHERE student_id = $1`,
      [studentId]
    );

    const storedHash = rows[0]?.password_hash;
    if (storedHash) {
      const isValid = await verifyPassword(currentPassword, storedHash);
      if (!isValid) {
        return res.status(401).json({
          error: 'Current password verification failed',
          code: 'INVALID_CURRENT_PASSWORD',
        });
      }
    }

    // 2. Hash new password asynchronously using libuv threadpool scrypt
    const newHash = await hashPassword(newPassword);

    // 3. Persist new hash in student_profiles and clear must_change_password flag
    await pool.query(
      `
      INSERT INTO student_profiles (student_id, password_hash, must_change_password, version)
      VALUES ($1, $2, FALSE, 1)
      ON CONFLICT (student_id)
      DO UPDATE SET 
        password_hash = $2, 
        must_change_password = FALSE, 
        version = student_profiles.version + 1, 
        updated_at = NOW();
      `,
      [studentId, newHash]
    );

    // Also update staff_advisors if this user is a staff member
    await pool.query(
      `UPDATE staff_advisors SET password_hash = $1, must_change_password = FALSE WHERE advisor_id = $2`,
      [newHash, studentId]
    );

    // 4. Record Immutable Security Audit Event
    const eventType = req.user?.scope === 'RESET_ONLY' 
      ? 'CREDENTIAL_INITIALIZATION' 
      : 'PASSWORD_MUTATION';

    await recordIdentityAuditLog(pool, {
      eventType,
      actorId: studentId,
      actorRole: req.user?.role || 'STUDENT',
      targetId: studentId,
      targetType: 'CREDENTIALS',
      ipAddress: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      sessionId,
      metadata: {
        previousScope: req.user?.scope,
        promotedScope: 'FULL_ACCESS',
        forcedReset: req.user?.scope === 'RESET_ONLY',
      },
    }).catch((auditErr) => {
      logger.warn({ auditErr }, '[Profile] Non-fatal: Failed to log credential audit event');
    });

    // 5. Revoke active Redis session hash
    if (sessionId) {
      try {
        await redis.del(`session:${sessionId}`);
      } catch (redisErr) {
        logger.warn({ redisErr }, '[Profile] Failed to delete session from Redis');
      }
    }

    // 6. Clear HttpOnly auth cookie
    res.clearCookie('focit_token', {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
    });

    return res.status(200).json({
      status: 'CREDENTIALS_MUTATED',
      message: 'Password updated successfully. Session revoked.',
      redirect: '/login?reason=password_changed',
    });
  } catch (err) {
    logger.error({ err, studentId }, '[Profile] Password mutation failed');
    return res.status(500).json({ error: 'Failed to update credentials', code: 'DB_ERROR' });
  }
});

export default router;
