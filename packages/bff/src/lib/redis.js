/**
 * Resilient Redis Client Singleton
 *
 * Implements connection pooling, automatic reconnection backoff,
 * and fail-closed telemetry for the BFF service layer.
 */

import IORedis from 'ioredis';
import config from '../config.js';
import { logger } from './logger.js';

export const defaultRedisOptions = {
  family: 4,
  connectTimeout: 10000,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: process.env.NODE_ENV === 'test',
  enableOfflineQueue: false, // Strict Fail-Closed: Never buffer commands in offline memory
  retryStrategy(times) {
    if (times > 5 && (process.env.NODE_ENV === 'test' || !process.env.NODE_ENV)) {
      return null; // Bounded reconnect in test/dev so event loops don't hang indefinitely
    }
    const delay = Math.min(times * 100, 3000);
    logger.warn({ attempt: times, delayMs: delay }, '[Redis] Reconnecting to cluster...');
    return delay;
  },
};

export const redis = new IORedis(config.redis.url, defaultRedisOptions);

redis.on('error', (err) => {
  logger.error({ err: err?.message || err }, '[Redis] Connection failure detected');
});

redis.on('connect', () => {
  logger.info('[Redis] Client successfully connected to Redis session store');
});

export default redis;
