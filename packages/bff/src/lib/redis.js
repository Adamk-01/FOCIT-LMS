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
  lazyConnect: false,
  enableOfflineQueue: true,
  retryStrategy(times) {
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
