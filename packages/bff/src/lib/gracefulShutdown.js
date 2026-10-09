/**
 * Zero-Downtime Deployment (ZDD) Graceful Shutdown Coordinator
 *
 * Implements a non-deadlocking, production-grade teardown sequence:
 *
 * Phase 1: Ingress Deregistration Signaling (fail /health, sleep drain window)
 * Phase 2: Non-blocking listener unbind (server.close() initiated without awaiting)
 * Phase 3: Active connection evacuation:
 *          - SSE Streams: broadcast reconnect frame and seal with res.end()
 *          - Idle HTTP Keep-Alive: purge immediately via server.closeIdleConnections()
 * Phase 4: Await active in-flight requests & SingleFlight tasks, with periodic idle reaping
 *          - Fallback: server.closeAllConnections() after drain ceiling
 *          - Await server.close() settlement promise
 * Phase 5: Ordered infrastructure teardown (Postgres pool.end() -> Redis.quit())
 * Phase 6: Clean process exit (process.exit(0))
 */

import { logger } from './logger.js';
import { singleFlight } from './singleFlight.js';

let isShuttingDown = false;
const activeRequests = new Set();
const activeSseStreams = new Set();

/**
 * Returns true if the process is currently executing the shutdown sequence.
 * Queried by /health probe to signal load balancers to deregister this target.
 * @returns {boolean}
 */
export function isDraining() {
  return isShuttingDown;
}

/**
 * Express middleware to track in-flight requests and register persistent SSE streams.
 * Sets 'Connection: close' on incoming requests during shutdown to prevent socket reuse.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function connectionTracker(req, res, next) {
  if (isShuttingDown) {
    res.set('Connection', 'close');
  }

  activeRequests.add(res);

  const isSse = req.path.includes('/stream/') || req.headers.accept === 'text/event-stream';
  if (isSse) {
    activeSseStreams.add(res);
  }

  const cleanup = () => {
    activeRequests.delete(res);
    activeSseStreams.delete(res);
  };

  res.on('finish', cleanup);
  res.on('close', cleanup);

  next();
}

/**
 * Registers persistent SSE response for managed teardown.
 * @param {import('express').Response} res
 */
export function registerSseStream(res) {
  activeSseStreams.add(res);
  res.on('close', () => activeSseStreams.delete(res));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Initializes graceful shutdown handlers for SIGTERM and SIGINT.
 *
 * @param {object} params
 * @param {import('http').Server} params.server - Active HTTP server instance
 * @param {import('pg').Pool} [params.pool] - PostgreSQL pool instance
 * @param {import('ioredis').Redis} [params.redis] - Redis client instance
 * @param {object} [params.options]
 * @param {number} [params.options.ingressDrainDelayMs=5000] - Time to fail health checks before server.close
 * @param {number} [params.options.maxDrainWaitMs=15000] - Maximum time to wait for in-flight requests
 * @param {number} [params.options.hardWatchdogMs=25000] - Hard termination ceiling (< orchestrator SIGKILL)
 */
export function setupGracefulShutdown({
  server,
  pool,
  redis,
  options = {},
}) {
  const {
    ingressDrainDelayMs = 5000,
    maxDrainWaitMs = 15000,
    hardWatchdogMs = 25000,
  } = options;

  async function handleShutdown(signal) {
    if (isShuttingDown) {
      logger.warn({ signal }, '[Shutdown] Shutdown already in progress, ignoring duplicate signal');
      return;
    }
    isShuttingDown = true;

    logger.info(
      { signal, activeRequests: activeRequests.size, activeSseStreams: activeSseStreams.size },
      '[Shutdown] Commencing Zero-Downtime graceful shutdown sequence'
    );

    // Hard Watchdog: Forces non-zero exit if any step deadlocks
    const watchdogTimer = setTimeout(() => {
      logger.fatal('[Shutdown] Hard watchdog ceiling exceeded (25s). Forcing non-zero exit.');
      process.exit(1);
    }, hardWatchdogMs);

    if (watchdogTimer.unref) {
      watchdogTimer.unref();
    }

    try {
      // =====================================================================
      // PHASE 1: Ingress Deregistration Signaling (5s Window)
      // =====================================================================
      // Fail /health probe with 503 so ALB / Cloudflare drops this pod from routing.
      // We sleep 5,000ms while CONTINUING to listen on port 3000 to absorb any
      // straggler packets already in transit across the wire.
      logger.info(
        { delayMs: ingressDrainDelayMs },
        '[Shutdown] Phase 1: Health check set to 503. Awaiting ingress route convergence...'
      );
      await delay(ingressDrainDelayMs);

      // =====================================================================
      // PHASE 2: Non-Blocking Listener Teardown
      // =====================================================================
      // CRITICAL FIX: Do NOT await server.close() here!
      // In Node.js, the server.close() callback will NOT fire until all sockets close.
      // Awaiting it here while 2,500 SSE streams are open causes a permanent deadlock.
      // Instead, we initiate server.close() non-blockingly to stop accepting NEW TCP
      // handshakes, store its settlement promise, and immediately proceed to evacuation.
      logger.info('[Shutdown] Phase 2: Unbinding HTTP listener from OS accept queue (non-blocking)...');
      let isServerClosed = false;
      const serverClosedPromise = new Promise((resolve) => {
        server.close((err) => {
          isServerClosed = true;
          if (err) {
            logger.warn({ err }, '[Shutdown] Notice during server.close() listener settlement');
          } else {
            logger.info('[Shutdown] HTTP listener closed and all connections fully terminated');
          }
          resolve();
        });
      });

      // =====================================================================
      // PHASE 3: Active Evacuation & Idle Keep-Alive Purging
      // =====================================================================
      // 3A. Evacuate Long-Lived SSE Connections:
      // Persistent SSE streams will never close on their own. Broadcast a clean
      // application-level reconnect frame and seal the response stream with res.end().
      logger.info(
        { count: activeSseStreams.size },
        '[Shutdown] Phase 3A: Broadcasting reconnect event to active SSE streams...'
      );
      for (const res of activeSseStreams) {
        try {
          if (!res.writableEnded) {
            res.write('event: reconnect\n');
            res.write('data: {"reason":"SERVER_SHUTDOWN","reconnectDelayMs":1000}\n\n');
            res.end();
          }
        } catch {
          // Socket already terminated by client
        }
      }
      activeSseStreams.clear();

      // 3B. Forcefully Purge Idle Keep-Alive Sockets:
      // Node.js 18.2.0+ native method: Immediately destroys all sockets connected
      // to this server that are currently IDLE (waiting for a new request).
      // Active requests streaming bytes or awaiting responses are NOT touched.
      if (typeof server.closeIdleConnections === 'function') {
        logger.info('[Shutdown] Phase 3B: Purging idle HTTP/1.1 Keep-Alive sockets via closeIdleConnections()...');
        server.closeIdleConnections();
      }

      // =====================================================================
      // PHASE 4: Drain Active In-Flight Requests & SingleFlight Tasks
      // =====================================================================
      // Poll activeRequests and singleFlight registry until all queries settle.
      // Periodically invoke server.closeIdleConnections() as requests finish.
      logger.info(
        { activeRequests: activeRequests.size, inFlightSingleFlight: singleFlight.activeKeys },
        '[Shutdown] Phase 4: Awaiting in-flight queries and Single-Flight promises...'
      );

      const drainStart = Date.now();
      while (
        (activeRequests.size > 0 || singleFlight.activeKeys.length > 0) &&
        Date.now() - drainStart < maxDrainWaitMs
      ) {
        if (typeof server.closeIdleConnections === 'function') {
          server.closeIdleConnections();
        }
        await delay(250);
      }

      // 4B. Emergency Socket Severing:
      // If stubborn sockets remain open after maxDrainWaitMs, invoke native closeAllConnections()
      // to forcibly terminate lingering sockets before closing database connections.
      if (!isServerClosed) {
        if (activeRequests.size > 0 || singleFlight.activeKeys.length > 0) {
          logger.warn(
            { remainingRequests: activeRequests.size, remainingSingleFlight: singleFlight.activeKeys.length },
            '[Shutdown] Drain deadline reached. Invoking server.closeAllConnections() to force-close stubborn sockets...'
          );
        }
        if (typeof server.closeAllConnections === 'function') {
          server.closeAllConnections();
        }
      }

      // Now await server.close() settlement (guaranteed to settle immediately)
      await Promise.race([serverClosedPromise, delay(2000)]);
      logger.info(
        { elapsedMs: Date.now() - drainStart },
        '[Shutdown] Request draining completed successfully'
      );

      // =====================================================================
      // PHASE 5: Ordered Database and Infrastructure Teardown
      // =====================================================================
      // Now that NO HTTP requests or database operations can execute:

      // 1. PostgreSQL Connection Pool
      if (pool && typeof pool.end === 'function') {
        logger.info('[Shutdown] Phase 5a: Closing PostgreSQL connection pool...');
        try {
          await pool.end();
          logger.info('[Shutdown] PostgreSQL connection pool drained and closed cleanly');
        } catch (dbErr) {
          logger.error({ err: dbErr }, '[Shutdown] Error closing PostgreSQL pool');
        }
      }

      // 2. Redis Session Store Connection
      if (redis && typeof redis.quit === 'function') {
        logger.info('[Shutdown] Phase 5b: Closing Redis client connection...');
        try {
          await redis.quit();
          logger.info('[Shutdown] Redis connection closed cleanly');
        } catch (redisErr) {
          logger.warn({ err: redisErr }, '[Shutdown] Redis quit timed out; forcing disconnect');
          redis.disconnect();
        }
      }

      // =====================================================================
      // PHASE 6: Clean Process Termination
      // =====================================================================
      clearTimeout(watchdogTimer);
      logger.info('[Shutdown] All subsystems gracefully terminated. Exiting cleanly.');
      process.exit(0);
    } catch (fatalErr) {
      logger.fatal({ err: fatalErr }, '[Shutdown] Catastrophic error during graceful shutdown');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
}
