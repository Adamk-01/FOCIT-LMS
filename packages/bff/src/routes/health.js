/**
 * Health Check Routes — GET /health
 *
 * Returns system health metrics: pool stats, cache stats, queue depth.
 * Used by load balancers, monitoring systems, and operational dashboards.
 */

import { Router } from 'express';
import { getMoodlePoolStats } from '../lib/moodlePool.js';
import { isDraining } from '../lib/gracefulShutdown.js';

const router = Router();

router.get('/', (req, res) => {
  // Phase 1 ZDD Signal: Tell AWS ALB / Cloudflare to drop this pod from routing
  if (isDraining()) {
    return res.status(503).json({
      status: 'draining',
      message: 'Server process is shutting down. Do not route new requests.',
      timestamp: new Date().toISOString(),
    });
  }

  const poolStats = getMoodlePoolStats();

  const health = {
    status: poolStats.pending > 100 ? 'degraded' : 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    moodlePool: poolStats,
    memory: {
      rss: Math.floor(process.memoryUsage.rss() / 1024 / 1024),
      heapUsed: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.floor(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  };

  // Return 503 if degraded, so load balancers can route traffic away
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;
