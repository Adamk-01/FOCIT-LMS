/**
 * FOCIT LMS - Digital Library Orphan Reaper Worker
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. Safe two-phase unreferenced CAS garbage collection (Resolves Trap 2).
 * 2. Unlinks physical CAS files ONLY when:
 *    - ref_count = 0
 *    - updated_at < (NOW() - INTERVAL '24 hours')
 *    - Zero active unexpired 'STAGED' staging tickets reference the hash
 * 3. Sweeps expired staging tickets (status = 'EXPIRED').
 */

import path from 'node:path';
import fsp from 'node:fs/promises';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { CAS_UPLOADS_ROOT } from '../services/casStorageService.js';

/**
 * Executes a single sweep of expired staging tickets and unreferenced CAS blobs.
 * Safe for concurrent invocations (FOR UPDATE SKIP LOCKED).
 */
export async function runLibraryReaperSweep() {
  const client = await pool.connect();
  let expiredStagedCount = 0;
  let reapedBlobsCount = 0;

  try {
    await client.query('BEGIN;');

    // 1. Expire stale staging tickets older than their 2-hour window
    const stagedRes = await client.query(`
      UPDATE library_upload_staging
      SET status = 'EXPIRED'
      WHERE status = 'STAGED' AND expires_at < NOW()
      RETURNING staged_id, file_hash;
    `);
    expiredStagedCount = stagedRes.rowCount || 0;

    // 2. Select and lock unreferenced CAS blobs that have aged >= 24 hours
    // AND have no active in-flight staging tickets (Resolves Trap 1 & 2)
    const blobRes = await client.query(`
      WITH candidates AS (
        SELECT b.file_hash, b.storage_path
        FROM library_storage_blobs b
        WHERE b.ref_count = 0
          AND b.updated_at < (NOW() - INTERVAL '24 hours')
          AND NOT EXISTS (
            SELECT 1 
            FROM library_upload_staging s 
            WHERE s.file_hash = b.file_hash 
              AND s.status = 'STAGED' 
              AND s.expires_at > NOW()
          )
        FOR UPDATE SKIP LOCKED
        LIMIT 50
      )
      DELETE FROM library_storage_blobs
      WHERE file_hash IN (SELECT file_hash FROM candidates)
      RETURNING file_hash, storage_path;
    `);

    const deletedBlobs = blobRes.rows || [];
    reapedBlobsCount = deletedBlobs.length;

    await client.query('COMMIT;');

    // 3. Post-Commit Physical File Cleanup
    for (const blob of deletedBlobs) {
      if (blob.storage_path) {
        const fullPath = path.isAbsolute(blob.storage_path)
          ? blob.storage_path
          : path.join(CAS_UPLOADS_ROOT, blob.storage_path);
        try {
          await fsp.unlink(fullPath);
          logger.info({ fileHash: blob.file_hash, fullPath }, '[Library Reaper] Physically unlinked orphaned CAS blob');
        } catch (unlinkErr) {
          if (unlinkErr.code !== 'ENOENT') {
            logger.warn({ err: unlinkErr.message, fullPath }, '[Library Reaper] Failed to unlink CAS blob file');
          }
        }
      }
    }

    if (expiredStagedCount > 0 || reapedBlobsCount > 0) {
      logger.info(
        { expiredStagedCount, reapedBlobsCount },
        '[Library Reaper] Sweep completed successfully'
      );
    }

    return { expiredStagedCount, reapedBlobsCount };
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    logger.error({ err: err.message }, '[Library Reaper] Sweep execution failed');
    throw err;
  } finally {
    client.release();
  }
}

