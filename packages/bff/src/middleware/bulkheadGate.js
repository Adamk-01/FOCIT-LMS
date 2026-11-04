/**
 * FOCIT LMS - In-Process Bulkhead Concurrency Gate
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 * Reference: Michael Nygard, "Release It!" (The Bulkhead Pattern)
 *
 * Isolates high-latency staff analytical/administrative workloads from
 * latency-critical student OLTP operations, guaranteeing that no more than
 * maxConcurrent database sockets can be consumed by staff routes simultaneously.
 */

import { logger } from '../lib/logger.js';

export function createBulkheadGate(maxConcurrent = 5, planeName = 'STAFF') {
  let inFlight = 0;

  return (req, res, next) => {
    if (inFlight >= maxConcurrent) {
      logger.warn(
        { planeName, inFlight, maxConcurrent, path: req.originalUrl || req.path },
        '[BulkheadGate] Concurrency limit exceeded; shedding request'
      );
      return res.status(429)
        .set('Retry-After', '3')
        .json({
          error: `${planeName} reporting capacity saturated. Core academic services protected.`,
          code: 'BULKHEAD_CAPACITY_EXCEEDED',
          retryAfter: 3,
        });
    }

    inFlight++;
    let released = false;

    const release = () => {
      if (!released) {
        released = true;
        inFlight = Math.max(0, inFlight - 1);
      }
    };

    res.once('finish', release);
    res.once('close', release); // Reclaims socket quota if client aborts/drops TCP
    next();
  };
}
