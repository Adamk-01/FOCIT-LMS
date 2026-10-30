/**
 * FOCIT PostgreSQL Database Adapter Singleton
 *
 * Implements:
 * 1. Resilient Connection Pooling: Sized via Little's Law (max 20 connections).
 * 2. Prepared Statement-Safe Autocommit Reads: Appends tail SQL comments for unnamed
 *    queries without mutating socket session state or invalidating pg_stat_statements.
 * 3. Pipelined Transaction Scoping: Bundles `BEGIN; SET LOCAL application_name` in
 *    a single network RTT, with 100% engine-guaranteed cleanup on COMMIT/ROLLBACK.
 * 4. Zero Connection Leaks: Enforces strict checkout-and-release boundaries.
 */

import pg from 'pg';
import net from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';

if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}
import config from '../config.js';
import { logger } from '../lib/logger.js';

// Dynamically and safely load Neon serverless driver when available
let NeonPool = pg.Pool;
try {
  const neonModule = await import('@neondatabase/serverless');
  NeonPool = neonModule.Pool || neonModule.default?.Pool || pg.Pool;
  const wsModule = await import('ws');
  if (neonModule.neonConfig) {
    neonModule.neonConfig.webSocketConstructor = wsModule.default || wsModule;
  }
} catch (_) {
  // Graceful fallback to native pg.Pool in non-Neon or offline environments
}

// Ephemeral Async Context Storage for Request Trace Propagation
export const traceStorage = new AsyncLocalStorage();

/**
 * Extracts currently active W3C traceparent or request ID.
 * @returns {string|null}
 */
export function getActiveTraceId() {
  const store = traceStorage.getStore();
  return store?.traceId || null;
}

// Bounded PostgreSQL Connection Pool configuration
const rawUrl = process.env.DATABASE_URL || 'postgresql://focit_user:focit_password@127.0.0.1:5432/focit_db';
const isNeon = rawUrl.includes('neon.tech');

const poolConfig = {
  connectionString: rawUrl,
  max: 20,
  idleTimeoutMillis: 120000,
  connectionTimeoutMillis: 30000,
  query_timeout: 15000,
  allowExitOnIdle: false,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
};

// Use Neon Serverless Pool when target is Neon (port 443 WebSocket traversal)
// or standard pg.Pool for local/direct PostgreSQL
export const pool = isNeon ? new NeonPool(poolConfig) : new pg.Pool(poolConfig);

// Direct pool dedicated for DDL / migrations / seed scripts (bypasses PgBouncer transaction mode)
const directUrl = process.env.DIRECT_DATABASE_URL || rawUrl.replace('-pooler', '');
const directIsNeon = directUrl.includes('neon.tech');
export const directPool = directIsNeon 
  ? new NeonPool({ connectionString: directUrl, connectionTimeoutMillis: 30000 }) 
  : new pg.Pool({ connectionString: directUrl, connectionTimeoutMillis: 30000 });

pool.on('error', (err) => {
  logger.error({ err: err?.message || err }, '[PostgreSQL] Unexpected error on idle client');
});

/**
 * Enterprise Database Access Layer
 */
export class DatabaseAdapter {
  constructor(underlyingPool) {
    this.pool = underlyingPool;
  }

  /**
   * Executes a standalone autocommit query.
   * Appends tail SQL comment for live pg_stat_activity inspection without
   * mutating connection session state or breaking named prepared statements.
   *
   * @param {string|object} queryTextOrConfig
   * @param {any[]} [params]
   * @returns {Promise<import('pg').QueryResult>}
   */
  async query(queryTextOrConfig, params) {
    const traceId = getActiveTraceId();

    // If config object format is used (e.g. named prepared statements)
    if (typeof queryTextOrConfig === 'object' && queryTextOrConfig !== null) {
      // Named statements MUST preserve exact SQL text to avoid client driver crashes
      if (queryTextOrConfig.name) {
        return this.pool.query(queryTextOrConfig);
      }

      // Unnamed object queries: safely decorate text
      if (traceId && queryTextOrConfig.text) {
        const sanitizedTrace = traceId.replace(/[^a-zA-Z0-9_-]/g, '');
        const decorated = `${queryTextOrConfig.text.trim()} /*traceparent='${sanitizedTrace}'*/`;
        return this.pool.query({ ...queryTextOrConfig, text: decorated });
      }

      return this.pool.query(queryTextOrConfig);
    }

    // Standard string query
    const sqlText = String(queryTextOrConfig).trim();
    if (traceId) {
      const sanitizedTrace = traceId.replace(/[^a-zA-Z0-9_-]/g, '');
      const decorated = `${sqlText} /*traceparent='${sanitizedTrace}'*/`;
      return this.pool.query(decorated, params);
    }

    return this.pool.query(sqlText, params);
  }

  /**
   * Executes a transactional unit of work with pipelined trace context.
   * Bundles BEGIN + SET LOCAL into a single RTT.
   * Guarantees 100% clean session state reversion upon COMMIT/ROLLBACK.
   *
   * @template T
   * @param {(client: import('pg').PoolClient) => Promise<T>} workFn
   * @returns {Promise<T>}
   */
  async transaction(workFn, timeoutMs = 8000) {
    const client = await this.pool.connect();
    const traceId = getActiveTraceId();
    const sanitizedTimeout = Number(timeoutMs) || 8000;

    try {
      if (traceId) {
        const sanitizedTrace = traceId.replace(/[^a-zA-Z0-9_-]/g, '');
        // Pipelined multi-statement: Exactly 1 network RTT, zero transaction overhead
        await client.query(`BEGIN; SET LOCAL statement_timeout = '${sanitizedTimeout}ms'; SET LOCAL application_name = 'focit_bff:${sanitizedTrace}';`);
      } else {
        await client.query(`BEGIN; SET LOCAL statement_timeout = '${sanitizedTimeout}ms';`);
      }

      const result = await workFn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      // Socket is returned to the pool with zero dirty session state
      client.release();
    }
  }

  /**
   * Acquires a client directly for specialized operations (e.g. streaming).
   * Caller is strictly responsible for client.release().
   *
   * @returns {Promise<import('pg').PoolClient>}
   */
  async connect() {
    return this.pool.connect();
  }

  /**
   * Graceful pool draining during shutdown.
   */
  async end() {
    return this.pool.end();
  }
}

export const db = new DatabaseAdapter(pool);

/**
 * ─── Federated Multi-Database Microservice Pools ────────────────────────────
 * Supports independent Neon databases for Lecturer and Admin domains.
 * Gracefully falls back to primary `pool` if specific domain URL is omitted.
 */
function createDomainPool(connectionUrl, poolName) {
  if (!connectionUrl) return pool;
  const isDomainNeon = connectionUrl.includes('neon.tech');
  const DomainPoolClass = isDomainNeon ? NeonPool : pg.Pool;
  const domainConfig = {
    ...poolConfig,
    connectionString: connectionUrl,
    ssl: isDomainNeon ? { rejectUnauthorized: false } : poolConfig.ssl,
  };
  const dPool = new DomainPoolClass(domainConfig);
  dPool.on('error', (err) => {
    logger.error({ pool: poolName, err: err.message }, `[PostgreSQL] Unexpected error on idle ${poolName} client`);
  });
  return dPool;
}

export const lecturerPool = createDomainPool(process.env.LECTURER_DATABASE_URL, 'LecturerPool');
export const adminPool = createDomainPool(process.env.ADMIN_DATABASE_URL, 'AdminPool');

/**
 * Transaction helper enforcing PgBouncer transaction-mode safety
 */
export async function withTransaction(callback, timeoutMs = 8000) {
  return db.transaction(callback, timeoutMs);
}

export default db;
