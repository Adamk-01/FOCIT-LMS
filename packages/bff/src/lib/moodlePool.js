/**
 * Undici Connection Pool — Moodle upstream
 *
 * This is the ONLY pathway to Moodle. All HTTP requests to Moodle
 * MUST go through this pool. Using native `fetch()` or `http.request()`
 * bypasses the connection ceiling and will crash the server under load.
 *
 * Why Undici Pool and not http.Agent:
 * Node 18+ native fetch is built on Undici (not node:http).
 * Passing http.Agent to fetch() is a silent no-op.
 * Undici Pool is the correct primitive for bounded connection management.
 */

import os from 'node:os';
import { Pool } from 'undici';
import config from '../config.js';
import { logger } from './logger.js';

function getValidOrigin(url) {
  if (!url || typeof url !== 'string') return 'http://127.0.0.1:3001';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

// Multi-Core & Horizontal Container Detection (CAP-4)
const detectedCpus = os.cpus()?.length || 1;
const clusterWorkers = parseInt(
  process.env.CLUSTER_WORKERS || process.env.WEB_CONCURRENCY || String(detectedCpus),
  10
);
const estimatedContainers = parseInt(process.env.ESTIMATED_CONTAINERS || '1', 10);
const configuredTotal = parseInt(
  process.env.MOODLE_GLOBAL_MAX_CONNS || String(config.pool?.maxConnections || 50),
  10
);

// Total active workers across all cluster containers
const totalClusterWorkers = Math.max(1, clusterWorkers * estimatedContainers);
// Bounded partition per worker with a safety floor of 1 connection (hard ceiling configuredTotal wins)
const partitionedConnections = Math.max(1, Math.floor(configuredTotal / totalClusterWorkers));

logger.info(
  {
    clusterWorkers,
    estimatedContainers,
    totalClusterWorkers,
    configuredTotal,
    partitionedConnections,
  },
  '[MoodlePool] Bounded connection pool initialized'
);

const moodlePool = new Pool(getValidOrigin(config.moodle.baseUrl), {
  connections: partitionedConnections,       // Dynamically partitioned per worker process
  pipelining: 1,                             // No HTTP pipelining (safer for binary streams)
  connect: {
    timeout: config.pool.connectTimeoutMs,   // 10s to establish TCP connection
  },
  bodyTimeout: config.pool.bodyTimeoutMs,    // 5min to receive full body (large PDFs)
  headersTimeout: 30_000,                    // 30s to receive response headers
  keepAliveTimeout: 30_000,                  // 30s idle before closing socket
  keepAliveMaxTimeout: 60_000,
});

/**
 * Returns current pool statistics for the /health endpoint
 * and the global concurrency gate middleware.
 */
export function getMoodlePoolStats() {
  const stats = moodlePool.stats;
  return {
    connected: stats.connected,
    free: stats.free,
    pending: stats.pending,
    running: stats.running,
    size: stats.size,
  };
}

export default moodlePool;
