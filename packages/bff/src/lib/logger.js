import pino from 'pino';
import config from '../config.js';

/**
 * Enterprise Structured Logger
 * 
 * In production, emits raw NDJSON for centralized log aggregation (Datadog, CloudWatch).
 * In development, we keep it simple or format the level/timestamp for readability.
 */
export const logger = pino({
  level: config.nodeEnv === 'development' ? 'debug' : 'info',
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
