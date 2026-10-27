/**
 * FOCIT LMS — Crash-Safe Redis Telemetry Buffer Service
 *
 * Implements Phase 13C Architecture:
 * 1. Distributed Ingestion Plane (Web Nodes -> Redis):
 *    - High-volume atomic view/download counters via Redis HINCRBY.
 *    - Append-only audit stream via bounded Redis XADD.
 *    - Distributed de-duplication lease via SET ... PX ... NX.
 *    - Zero-Trust Fail-Open: Telemetry failures never crash student document requests.
 *
 * 2. Crash-Safe Rotation & Persistence Pipeline (Worker Node -> PostgreSQL):
 *    - Pre-flush orphan inspection: If a previous worker crashed mid-flush, drains the
 *      orphaned staging hash before rotating new keys.
 *    - Atomic swap Lua script: Rotates active -> flushing without overwriting existing
 *      staging keys and safely handles idle windows (0 views).
 *    - Dijkstra-Ordered Batch Upsert: Sorts item IDs lexicographically before executing
 *      PostgreSQL UNNEST upsert, guaranteeing deadlock (40P01) immunity.
 *    - Verified Commit Cleanup: Redis staging keys and stream messages are deleted strictly
 *      AFTER the PostgreSQL ACID transaction commits.
 */

import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

// Redis Namespaces
export const KEY_VIEWS_ACTIVE = 'focit:metrics:views';
export const KEY_VIEWS_FLUSHING = 'focit:metrics:views:flushing';
export const KEY_DOWNLOADS_ACTIVE = 'focit:metrics:downloads';
export const KEY_DOWNLOADS_FLUSHING = 'focit:metrics:downloads:flushing';
export const KEY_AUDIT_STREAM = 'focit:metrics:audit_stream';
export const LEASE_PREFIX = 'focit:lease:';

// Architectural Limits
export const MAX_AUDIT_STREAM_LEN = 50_000;
export const VIEW_LEASE_TTL_MS = 60_000;         // 60s window per student view
export const DOWNLOAD_DEBOUNCE_TTL_MS = 10_000;  // 10s debounce window

// Atomic Swap Lua Script: Rotates active hash to staging safely
export const LUA_ROTATE_METRICS = `
if redis.call("EXISTS", KEYS[2]) == 1 then
  return -1 -- Staging key already exists from interrupted crash; drain first!
end
if redis.call("EXISTS", KEYS[1]) == 0 then
  return 0  -- Idle window: nothing to flush
end
redis.call("RENAME", KEYS[1], KEYS[2])
return 1    -- Successfully rotated
`;

// In-memory fallback de-duplication lease map for when Redis is unavailable
const memoryLeaseFallback = new Map();

/**
 * UUID regex validator for PostgreSQL safety.
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Records a verified telemetry event with distributed de-duplication.
 * Fails open if Redis is down (never crashes HTTP request).
 *
 * @param {string} studentId
 * @param {string} itemId
 * @param {'VIEW' | 'DOWNLOAD'} eventType
 * @returns {Promise<boolean>} True if enqueued, false if deduplicated or invalid
 */
export async function recordTelemetryEvent(studentId, itemId, eventType) {
  if (!itemId || !studentId) return false;
  if (eventType !== 'VIEW' && eventType !== 'DOWNLOAD') return false;

  const cleanItemId = String(itemId).trim();
  const cleanStudentId = String(studentId).trim();

  if (!UUID_REGEX.test(cleanItemId)) {
    logger.debug({ itemId: cleanItemId }, '[TelemetryService] Ignored non-UUID itemId');
    return false;
  }

  const ttl = eventType === 'VIEW' ? VIEW_LEASE_TTL_MS : DOWNLOAD_DEBOUNCE_TTL_MS;
  const leaseKey = `${LEASE_PREFIX}${eventType}:${cleanStudentId}:${cleanItemId}`;

  // 1. Distributed De-duplication Lease
  const isRedisReady = redis && redis.status === 'ready';

  if (isRedisReady) {
    try {
      const leaseAcquired = await redis.set(leaseKey, '1', 'PX', ttl, 'NX');
      if (leaseAcquired !== 'OK') {
        return false; // Deduplicated within active window
      }

      // 2. High-Volume Atomic Counter Accumulation
      const targetHash = eventType === 'VIEW' ? KEY_VIEWS_ACTIVE : KEY_DOWNLOADS_ACTIVE;
      await redis.hincrby(targetHash, cleanItemId, 1);

      // 3. Append to Bounded Audit Stream
      await redis.xadd(
        KEY_AUDIT_STREAM,
        'MAXLEN',
        '~',
        MAX_AUDIT_STREAM_LEN,
        '*',
        'itemId',
        cleanItemId,
        'studentId',
        cleanStudentId,
        'eventType',
        eventType,
        'createdAt',
        new Date().toISOString()
      );

      return true;
    } catch (err) {
      logger.warn({ err: err?.message, itemId: cleanItemId }, '[TelemetryService] Redis telemetry enqueue notice; failing open');
    }
  }

  // Fallback: In-memory lease if Redis is offline
  const now = Date.now();
  const existingExpiry = memoryLeaseFallback.get(leaseKey);
  if (existingExpiry && existingExpiry > now) {
    return false;
  }
  memoryLeaseFallback.set(leaseKey, now + ttl);

  // Evict expired entries from fallback map if it grows
  if (memoryLeaseFallback.size > 5000) {
    for (const [k, exp] of memoryLeaseFallback.entries()) {
      if (exp <= now) memoryLeaseFallback.delete(k);
    }
  }

  return true;
}

/**
 * Rotates and drains telemetry buffers from Redis to PostgreSQL.
 * Designed to be called by worker.js on a recurring interval.
 *
 * @param {import('pg').Pool} dbPool
 * @returns {Promise<{ drained: boolean, itemsCount: number, auditCount: number, reason?: string }>}
 */
export async function rotateAndDrainTelemetry(dbPool) {
  if (!dbPool) {
    return { drained: false, itemsCount: 0, auditCount: 0, reason: 'NO_DB_POOL' };
  }

  const isRedisReady = redis && redis.status === 'ready';
  if (!isRedisReady) {
    return { drained: false, itemsCount: 0, auditCount: 0, reason: 'REDIS_OFFLINE' };
  }

  try {
    // ── Phase 1: Atomic Buffer Rotation (with Orphan Protection) ─────────────
    const viewsRotateStatus = await redis.eval(LUA_ROTATE_METRICS, 2, KEY_VIEWS_ACTIVE, KEY_VIEWS_FLUSHING);
    const downloadsRotateStatus = await redis.eval(LUA_ROTATE_METRICS, 2, KEY_DOWNLOADS_ACTIVE, KEY_DOWNLOADS_FLUSHING);

    const hasViewsToFlush = viewsRotateStatus !== 0; // -1 (orphan) or 1 (rotated)
    const hasDownloadsToFlush = downloadsRotateStatus !== 0;

    // ── Phase 2: Read Staging Hash Data ──────────────────────────────────────
    const viewsRaw = hasViewsToFlush ? await redis.hgetall(KEY_VIEWS_FLUSHING) : {};
    const downloadsRaw = hasDownloadsToFlush ? await redis.hgetall(KEY_DOWNLOADS_FLUSHING) : {};

    // ── Phase 3: Read Batch of Audit Stream Entries ──────────────────────────
    let auditRawEntries = [];
    try {
      auditRawEntries = await redis.xrange(KEY_AUDIT_STREAM, '-', '+', 'COUNT', 500);
    } catch (streamErr) {
      logger.debug({ err: streamErr?.message }, '[TelemetryService] XRANGE audit stream notice');
    }

    const auditParsed = [];
    const auditIdsToDelete = [];

    if (Array.isArray(auditRawEntries)) {
      for (const entry of auditRawEntries) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const [entryId, fields] = entry;
        auditIdsToDelete.push(entryId);

        const record = {};
        for (let i = 0; i < fields.length; i += 2) {
          record[fields[i]] = fields[i + 1];
        }

        if (record.itemId && UUID_REGEX.test(record.itemId)) {
          auditParsed.push({
            itemId: record.itemId,
            studentId: record.studentId || 'anonymous',
            eventType: record.eventType || 'VIEW',
            createdAt: record.createdAt || new Date().toISOString(),
          });
        }
      }
    }

    // Check if there is anything to commit
    const rawItemIds = new Set([...Object.keys(viewsRaw), ...Object.keys(downloadsRaw)]);
    if (rawItemIds.size === 0 && auditParsed.length === 0) {
      return { drained: true, itemsCount: 0, auditCount: 0, reason: 'IDLE' };
    }

    // ── Phase 4: Consolidate & Dijkstra Lexicographical Sort ─────────────────
    // Validates UUIDs and sorts lexicographically to prevent deadlocks (40P01)
    const sortedItemIds = Array.from(rawItemIds)
      .filter((id) => UUID_REGEX.test(id))
      .sort((a, b) => a.localeCompare(b));

    const itemIds = [];
    const viewsArr = [];
    const downloadsArr = [];

    for (const id of sortedItemIds) {
      itemIds.push(id);
      viewsArr.push(parseInt(viewsRaw[id] || '0', 10));
      downloadsArr.push(parseInt(downloadsRaw[id] || '0', 10));
    }

    // ── Phase 5: ACID PostgreSQL Commit ──────────────────────────────────────
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');

      // 5a. Upsert aggregated metrics into HOT ledger (library_item_metrics)
      if (itemIds.length > 0) {
        await client.query(
          `
          INSERT INTO library_item_metrics (item_id, view_count, download_count, updated_at)
          SELECT u.id, u.v, u.d, NOW()
          FROM UNNEST($1::uuid[], $2::bigint[], $3::bigint[]) AS u(id, v, d)
          ON CONFLICT (item_id) DO UPDATE SET
            view_count = library_item_metrics.view_count + EXCLUDED.view_count,
            download_count = library_item_metrics.download_count + EXCLUDED.download_count,
            updated_at = NOW();
          `,
          [itemIds, viewsArr, downloadsArr]
        );
      }

      // 5b. Bulk insert audit log entries (library_downloads)
      if (auditParsed.length > 0) {
        const auditItemIds = auditParsed.map((a) => a.itemId);
        const auditStudentIds = auditParsed.map((a) => a.studentId);
        const auditEventTypes = auditParsed.map((a) => a.eventType);
        const auditCreatedAts = auditParsed.map((a) => a.createdAt);

        await client.query(
          `
          INSERT INTO library_downloads (item_id, student_id, event_type, created_at)
          SELECT * FROM UNNEST($1::uuid[], $2::varchar[], $3::varchar[], $4::timestamptz[]);
          `,
          [auditItemIds, auditStudentIds, auditEventTypes, auditCreatedAts]
        );
      }

      await client.query('COMMIT');
    } catch (dbErr) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err: dbErr?.message }, '[TelemetryService] PostgreSQL transaction failed; staging keys preserved in Redis');
      throw dbErr; // Staging keys remain untouched in Redis for retry on next tick
    } finally {
      client.release();
    }

    // ── Phase 6: Verified Commit Cleanup ─────────────────────────────────────
    // Staging keys are deleted strictly AFTER the PostgreSQL COMMIT succeeded
    const cleanupOps = [];

    if (hasViewsToFlush) {
      cleanupOps.push(redis.del(KEY_VIEWS_FLUSHING));
    }
    if (hasDownloadsToFlush) {
      cleanupOps.push(redis.del(KEY_DOWNLOADS_FLUSHING));
    }
    if (auditIdsToDelete.length > 0) {
      cleanupOps.push(redis.xdel(KEY_AUDIT_STREAM, ...auditIdsToDelete));
    }

    await Promise.all(cleanupOps);

    logger.debug(
      { updatedItems: itemIds.length, audits: auditParsed.length },
      '[TelemetryService] Flushed telemetry micro-batch to PostgreSQL'
    );

    return { drained: true, itemsCount: itemIds.length, auditCount: auditParsed.length };
  } catch (err) {
    logger.error({ err: err?.message || err }, '[TelemetryService] Error in rotateAndDrainTelemetry');
    return { drained: false, itemsCount: 0, auditCount: 0, reason: err?.message };
  }
}
