/**
 * FOCIT LMS - Cryptographic Password & Audit Hashing Utility
 *
 * Implements:
 * 1. Asynchronous libuv Threadpool scrypt Hashing (OWASP Calibrated)
 *    - N = 16384 (Cost parameter 2^14)
 *    - r = 8 (Block size)
 *    - p = 1 (Parallelization)
 *    - maxmem = 32 MiB (Off-heap allocation ceiling)
 * 2. Constant-Time Timing-Safe Comparison (timingSafeEqual)
 * 3. Linear Tamper-Evident Hash Chain Computation for identity_audit_logs
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);

const SCRYPT_PARAMS = {
  cost: 16384,              // N = 2^14
  blockSize: 8,             // r = 8
  parallelization: 1,       // p = 1
  maxmem: 32 * 1024 * 1024, // 32 MiB allocation ceiling
};

const KEY_LENGTH_BYTES = 64;

/**
 * Asynchronously hashes a password using libuv off-thread scrypt.
 * Zero V8 main-thread blocking.
 *
 * @param {string} password
 * @param {string} [customSalt]
 * @returns {Promise<string>} Format: `${salt}:${derivedHex}`
 */
export async function hashPassword(password, customSalt) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }

  const salt = customSalt || crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, KEY_LENGTH_BYTES, SCRYPT_PARAMS);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Asynchronously verifies a candidate password against a stored salt:hash string.
 * Uses constant-time comparison to eliminate timing side-channels.
 *
 * @param {string} candidatePassword
 * @param {string} storedHashString
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(candidatePassword, storedHashString) {
  if (!candidatePassword || !storedHashString) return false;

  const parts = storedHashString.split(':');
  if (parts.length !== 2) return false;

  const [salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  try {
    const candidateKey = await scryptAsync(candidatePassword, salt, KEY_LENGTH_BYTES, SCRYPT_PARAMS);
    const expectedBuf = Buffer.from(expectedHex, 'hex');

    if (candidateKey.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(candidateKey, expectedBuf);
  } catch (err) {
    return false;
  }
}

/**
 * Generates deterministic SHA-256 state hash for audit ledger records.
 *
 * @param {any} statePayload
 * @returns {string} SHA-256 hex string
 */
export function computeStateHash(statePayload) {
  if (!statePayload) return null;
  const canonicalString = typeof statePayload === 'string' 
    ? statePayload 
    : JSON.stringify(statePayload);
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

/**
 * Computes verifiable entry hash for Merkle linear chaining in identity_audit_logs.
 *
 * @param {string|null} prevEntryHash
 * @param {string} eventType
 * @param {string} actorId
 * @param {string} targetId
 * @param {Date|string} createdAt
 * @param {object} metadata
 * @returns {string} SHA-256 hex string
 */
export function computeEntryHash(prevEntryHash, eventType, actorId, targetId, createdAt, metadata) {
  const prev = prevEntryHash || 'GENESIS_ROOT_FOCIT_IDENTITY_LEDGER';
  const metaStr = JSON.stringify(metadata || {});
  const timeStr = new Date(createdAt).toISOString();
  const raw = `${prev}:${eventType}:${actorId}:${targetId}:${timeStr}:${metaStr}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}
