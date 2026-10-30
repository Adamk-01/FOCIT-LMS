/**
 * FOCIT LMS — Dedicated Background Integration & Telemetry Worker
 *
 * Implements 12-Factor Concurrency:
 * Decouples background outbox synchronization and batched telemetry persistence
 * from the stateless Express HTTP web processes.
 *
 * Lifecycle & Resilience:
 * 1. Unified Transactional Outbox Worker: SELECT ... FOR UPDATE SKIP LOCKED
 * 2. Telemetry Persistence Pipeline: Micro-batched PostgreSQL updates (Dijkstra ordered)
 * 3. Deterministic Graceful Shutdown Barrier:
 *    - Pauses new polling ticks immediately upon SIGTERM/SIGINT
 *    - Awaits active in-flight outbox batches and Moodle HTTP dispatches
 *    - Executes final telemetry drain before closing PostgreSQL and Redis sockets
 *    - Hard 25s watchdog protection against orchestrator SIGKILL
 */

import config from './config.js';
import { logger } from './lib/logger.js';
import { pool } from './db/index.js';
import { redis } from './lib/redis.js';
import { unifiedOutboxWorker } from './workers/unifiedOutboxWorker.js';
import { rotateAndDrainTelemetry } from './services/telemetryBufferService.js';

logger.info({ pid: process.pid, env: config.nodeEnv }, '[WorkerPlane] Initializing FOCIT LMS Background Worker...');

let isShuttingDown = false;
let flushTimer = null;
let activeFlushPromise = null;

const TELEMETRY_FLUSH_INTERVAL_MS = 10_000;

if (redis && redis.status === 'wait') {
  redis.connect().catch((err) => {
    logger.warn({ err: err?.message || err }, '[WorkerPlane] Initial Redis connection deferred');
  });
}

/**
 * Schedules the recurring telemetry flush cycle with active in-flight tracking
 */
function scheduleTelemetryFlush() {
  if (isShuttingDown) return;

  flushTimer = setInterval(async () => {
    if (isShuttingDown || activeFlushPromise) return;

    activeFlushPromise = (async () => {
      try {
        const res = await rotateAndDrainTelemetry(pool);
        if (res?.drained && (res.itemsCount > 0 || res.auditCount > 0)) {
          logger.info(
            { itemsCount: res.itemsCount, auditCount: res.auditCount },
            '[WorkerPlane] Flushed periodic telemetry batch to PostgreSQL'
          );
        }
      } catch (err) {
        logger.error({ err: err?.message || err }, '[WorkerPlane] Error during recurring telemetry flush');
      } finally {
        activeFlushPromise = null;
      }
    })();
  }, TELEMETRY_FLUSH_INTERVAL_MS);

  if (flushTimer.unref) {
    flushTimer.unref();
  }
}

// ─── Start Subsystems ────────────────────────────────────────────────────────
unifiedOutboxWorker.start();
scheduleTelemetryFlush();

logger.info(
  {
    workerId: unifiedOutboxWorker.workerId,
    flushIntervalMs: TELEMETRY_FLUSH_INTERVAL_MS,
  },
  '[WorkerPlane] All background worker subsystems successfully initialized and running'
);

// ─── Deterministic Graceful Shutdown Barrier ─────────────────────────────────
async function handleShutdown(signal) {
  if (isShuttingDown) {
    logger.warn({ signal }, '[WorkerPlane] Shutdown already in progress, ignoring duplicate signal');
    return;
  }
  isShuttingDown = true;

  logger.info({ signal, pid: process.pid }, '[WorkerPlane] Commencing deterministic graceful shutdown sequence');

  // Hard Watchdog: Forces non-zero exit if any step deadlocks (25s ceiling)
  const watchdog = setTimeout(() => {
    logger.fatal('[WorkerPlane] Hard watchdog ceiling exceeded (25s). Forcing non-zero exit.');
    process.exit(1);
  }, 25_000);

  if (watchdog.unref) {
    watchdog.unref();
  }

  try {
    // ── Phase 1: Halt new polling ticks ──────────────────────────────────────
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
      logger.info('[WorkerPlane] Phase 1: Cleared recurring telemetry timer');
    }

    // ── Phase 2: Await in-flight outbox batch and in-flight telemetry flush ────
    logger.info('[WorkerPlane] Phase 2: Awaiting in-flight outbox dispatches and telemetry commits...');

    const inFlightDrains = [
      unifiedOutboxWorker.stop(),
      activeFlushPromise ? activeFlushPromise.catch(() => {}) : Promise.resolve(),
    ];
    await Promise.all(inFlightDrains);
    logger.info('[WorkerPlane] In-flight tasks successfully settled');

    // ── Phase 3: Final Telemetry Drain Pass ───────────────────────────────────
    // Flushes any residual metrics accumulated in memory before database closes
    logger.info('[WorkerPlane] Phase 3: Executing final telemetry drain pass to PostgreSQL...');
    try {
      await rotateAndDrainTelemetry(pool);
      logger.info('[WorkerPlane] Final telemetry buffer successfully flushed to database');
    } catch (finalFlushErr) {
      logger.error(
        { err: finalFlushErr?.message || finalFlushErr },
        '[WorkerPlane] Notice: Error during final telemetry buffer flush'
      );
    }

    // ── Phase 4: Ordered Infrastructure Teardown ─────────────────────────────
    logger.info('[WorkerPlane] Phase 4: Tearing down infrastructure connections...');

    // 4a. Close PostgreSQL Pool
    if (pool && typeof pool.end === 'function') {
      try {
        await pool.end();
        logger.info('[WorkerPlane] PostgreSQL connection pool drained and closed cleanly');
      } catch (dbErr) {
        logger.error({ err: dbErr?.message || dbErr }, '[WorkerPlane] Error closing PostgreSQL pool');
      }
    }

    // 4b. Close Redis Connection
    if (redis) {
      try {
        if (redis.status === 'ready') {
          await redis.quit();
        } else {
          redis.disconnect();
        }
        logger.info('[WorkerPlane] Redis connection closed cleanly');
      } catch (redisErr) {
        logger.warn({ err: redisErr?.message || redisErr }, '[WorkerPlane] Redis quit timed out; forcing disconnect');
        redis.disconnect();
        logger.info('[WorkerPlane] Redis connection closed cleanly');
      }
    }

    // ── Phase 5: Clean Process Termination ───────────────────────────────────
    clearTimeout(watchdog);
    logger.info('[WorkerPlane] Worker process gracefully terminated. Exiting cleanly (0).');
    process.exit(0);

  } catch (fatalErr) {
    logger.fatal({ err: fatalErr?.message || fatalErr }, '[WorkerPlane] Fatal error during worker graceful shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('message', (msg) => {
  if (msg === 'SIGTERM' || msg === 'SIGINT' || msg?.type === 'SHUTDOWN') {
    handleShutdown(msg?.signal || (typeof msg === 'string' ? msg : 'SIGTERM'));
  }
});

export { handleShutdown, scheduleTelemetryFlush };

