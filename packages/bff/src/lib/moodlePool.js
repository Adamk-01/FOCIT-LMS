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

import { Pool } from 'undici';
import config from '../config.js';

const moodlePool = new Pool(config.moodle.baseUrl, {
  connections: config.pool.maxConnections,  // Hard ceiling on concurrent TCP sockets
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
