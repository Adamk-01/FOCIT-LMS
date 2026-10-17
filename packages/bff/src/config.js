/**
 * BFF Configuration Module
 *
 * Loads environment variables with strict validation.
 * Fails fast on missing or invalid configuration —
 * a server that starts with bad config is worse than one that refuses to start.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Load .env relative to the bff package root if present (local development)
try {
  const { config: loadDotenv } = await import('dotenv');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  loadDotenv({ path: path.resolve(__dirname, '..', '.env') });
} catch {
  // In production, environment variables are injected directly by cloud environment (Render/Container)
}

/**
 * Read an env var, throw if missing and no default provided.
 * @param {string} key
 * @param {string} [fallback]
 * @returns {string}
 */
function required(key, fallback) {
  const value = process.env[key] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `[CONFIG] Missing required environment variable: ${key}. ` +
      `Copy .env.example to .env and fill in all values.`
    );
  }
  return value;
}

/**
 * Parse an env var as a positive integer.
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function int(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error(
      `[CONFIG] Invalid integer for ${key}: "${raw}". Must be a non-negative integer.`
    );
  }
  return parsed;
}

/**
 * Normalizes an HTTP/HTTPS URL, prepending http:// if protocol is omitted.
 * Critical for cloud platforms (e.g., Render) where internal discovery passes bare hostnames.
 * @param {string} rawUrl
 * @returns {string}
 */
function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `http://${trimmed}`;
  }
  return trimmed;
}

function normalizeRedisUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return 'redis://localhost:6379';
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('//')) {
    return `rediss:${trimmed}`;
  }
  if (!/^rediss?:\/\//i.test(trimmed)) {
    return `rediss://${trimmed}`;
  }
  return trimmed;
}

const config = Object.freeze({
  // --- Server ---
  port: int('PORT', 3000),
  nodeEnv: required('NODE_ENV', 'development'),
  frontendOrigin: required('FRONTEND_ORIGIN', 'http://localhost:5173'),

  // --- Moodle ---
  moodle: Object.freeze({
    baseUrl: normalizeUrl(required('MOODLE_BASE_URL', 'http://localhost:3001')),
    wsToken: required('MOODLE_WS_TOKEN', 'mock_dev_token_do_not_use_in_production'),
  }),

  // --- Undici Connection Pool ---
  pool: Object.freeze({
    maxConnections: int('MOODLE_POOL_MAX_CONNECTIONS', 50),
    connectTimeoutMs: int('MOODLE_POOL_CONNECT_TIMEOUT_MS', 10_000),
    bodyTimeoutMs: int('MOODLE_POOL_BODY_TIMEOUT_MS', 300_000),
  }),

  // --- LRU Disk Cache ---
  cache: Object.freeze({
    dir: required('CACHE_DIR', '.cache/files'),
    maxSizeBytes: int('CACHE_MAX_SIZE_BYTES', 2 * 1024 ** 3), // 2GB
    ttlMs: int('CACHE_TTL_MS', 30 * 60 * 1000),                // 30 min
  }),

  // --- Rate Limiting (per user, per minute) ---
  rateLimit: Object.freeze({
    listMax: int('RATE_LIMIT_LIST_MAX', 30),
    downloadMax: int('RATE_LIMIT_DOWNLOAD_MAX', 10),
    previewMax: int('RATE_LIMIT_PREVIEW_MAX', 20),
  }),

  // --- JWT Auth ---
  jwt: Object.freeze({
    secret: required('JWT_SECRET'),
    issuer: required('JWT_ISSUER', 'focit-lms'),
    audience: required('JWT_AUDIENCE', 'focit-materials'),
  }),

  // --- Redis Connection ---
  redis: Object.freeze({
    url: normalizeRedisUrl(process.env.REDIS_URL),
  }),
});

export default config;
