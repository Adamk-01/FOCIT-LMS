/**
 * FOCIT LMS - Production Schema Migration Engine
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. Zero-Downtime Deterministic Migrations: Applies unapplied .sql files in order.
 * 2. Immutable Tracking Ledger: Records applied migrations in `schema_migrations`.
 * 3. Idempotency: Skips already applied migrations.
 * 4. Transactional Safety: Each migration runs in an isolated transaction.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';
import { logger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  const migrationsDir = path.resolve(__dirname, 'migrations');
  const files = await fs.readdir(migrationsDir);
  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

  const client = await pool.connect();
  try {
    // 1. Ensure migration tracking ledger exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // 2. Fetch already applied migrations
    const { rows: appliedRows } = await client.query(
      `SELECT filename FROM schema_migrations;`
    );
    const appliedSet = new Set(appliedRows.map((r) => r.filename));

    let appliedCount = 0;

    for (const filename of sqlFiles) {
      if (appliedSet.has(filename)) {
        continue;
      }

      logger.info({ filename }, '[DB Migrate] Applying migration...');
      const filePath = path.join(migrationsDir, filename);
      const sqlContent = await fs.readFile(filePath, 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sqlContent);
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1);`,
          [filename]
        );
        await client.query('COMMIT');
        appliedCount++;
        logger.info({ filename }, '[DB Migrate] Successfully committed migration');
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error({ filename, err: err?.message || err }, '[DB Migrate] Migration failed and rolled back');
        throw err;
      }
    }

    if (appliedCount === 0) {
      logger.info('[DB Migrate] Database schema is already up to date. Zero migrations pending.');
    } else {
      logger.info({ appliedCount }, '[DB Migrate] Database migrations completed successfully.');
    }
  } finally {
    client.release();
  }
}

// Direct invocation CLI runner
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  runMigrations()
    .then(async () => {
      logger.info('[DB Migrate] Migration CLI completed');
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error({ err }, '[DB Migrate] Migration CLI failed');
      await pool.end();
      process.exit(1);
    });
}
