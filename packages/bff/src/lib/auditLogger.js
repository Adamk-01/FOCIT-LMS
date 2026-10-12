/**
 * FOCIT LMS - Identity & Security Audit Logger
 *
 * Implements Layer 3 Cryptographic Hash Chaining:
 * Every audit log entry computes:
 * entry_hash = SHA256(prev_entry_hash || event_type || actor_id || target_id || created_at || metadata)
 *
 * Guarantees a verifiable linear DAG across all security and credential operations.
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { computeStateHash, computeEntryHash } from './passwords.js';
import { logger } from './logger.js';

/**
 * Records an immutable identity or credential event into identity_audit_logs.
 *
 * @param {import('pg').PoolClient|import('pg').Pool} dbClient
 * @param {object} event
 * @param {string} event.eventType
 * @param {string} event.actorId
 * @param {string} [event.actorRole='STUDENT']
 * @param {string} event.targetId
 * @param {string} [event.targetType='CREDENTIALS']
 * @param {string} [event.ipAddress]
 * @param {string} [event.userAgent]
 * @param {string} [event.sessionId]
 * @param {object|string} [event.prevState]
 * @param {object|string} [event.newState]
 * @param {object} [event.metadata={}]
 * @returns {Promise<object>} The committed audit row
 */
export async function recordIdentityAuditLog(dbClient, {
  eventType,
  actorId,
  actorRole = 'STUDENT',
  targetId,
  targetType = 'CREDENTIALS',
  ipAddress = null,
  userAgent = null,
  sessionId = null,
  prevState = null,
  newState = null,
  metadata = {},
}) {
  const createdAt = new Date();

  // 1. Compute state hashes (PII and raw secrets are never logged in plaintext)
  const prevStateHash = prevState ? computeStateHash(prevState) : null;
  const newStateHash = newState ? computeStateHash(newState) : null;

  try {
    // 2. Query previous entry hash to maintain linear hash chain
    const prevRes = await dbClient.query(
      `SELECT entry_hash FROM identity_audit_logs ORDER BY created_at DESC, id DESC LIMIT 1`
    );
    const prevEntryHash = prevRes.rows[0]?.entry_hash || 'GENESIS_ROOT_FOCIT_IDENTITY_LEDGER';

    // 3. Compute entry hash
    const entryHash = computeEntryHash(
      prevEntryHash,
      eventType,
      actorId,
      targetId,
      createdAt,
      metadata
    );

    // 4. Atomic append-only insertion
    const insertRes = await dbClient.query(
      `
      INSERT INTO identity_audit_logs (
        event_type, actor_id, actor_role, target_id, target_type,
        ip_address, user_agent, session_id,
        prev_state_hash, new_state_hash, prev_entry_hash, entry_hash,
        metadata, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id, event_type, actor_id, target_id, entry_hash, created_at;
      `,
      [
        eventType,
        actorId,
        actorRole,
        targetId,
        targetType,
        ipAddress || null,
        userAgent || null,
        sessionId || null,
        prevStateHash,
        newStateHash,
        prevEntryHash,
        entryHash,
        JSON.stringify(metadata),
        createdAt,
      ]
    );

    return insertRes.rows[0];
  } catch (err) {
    logger.error({ err, eventType, actorId, targetId }, '[AuditLedger] Failed to append identity audit log');
    // Audit write failures must not silently disappear
    throw err;
  }
}
