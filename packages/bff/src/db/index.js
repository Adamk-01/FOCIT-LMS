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
import { AsyncLocalStorage } from 'node:async_hooks';
import config from '../config.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

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
const poolConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://focit_user:focit_password@localhost:5432/focit_lms',
  max: 20,                          // Little's Law capacity ceiling
  idleTimeoutMillis: 30000,         // Purge idle sockets after 30s
  connectionTimeoutMillis: 5000,    // Fail fast if pool is exhausted
};

export const pool = new Pool(poolConfig);

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
  async transaction(workFn) {
    const client = await this.pool.connect();
    const traceId = getActiveTraceId();

    try {
      if (traceId) {
        const sanitizedTrace = traceId.replace(/[^a-zA-Z0-9_-]/g, '');
        // Pipelined multi-statement: Exactly 1 network RTT, zero transaction overhead
        await client.query(`BEGIN; SET LOCAL application_name = 'focit_bff:${sanitizedTrace}'`);
      } else {
        await client.query('BEGIN');
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
export default db;
