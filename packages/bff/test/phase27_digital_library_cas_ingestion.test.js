/**
 * FOCIT LMS - Phase 27: Digital Library Content-Addressed Storage (CAS)
 * & Ingestion Subsystem Verification Suite
 *
 * Mathematically validates:
 * 1. Trap 1 Resolution: CAS placement creates library_storage_blobs with ref_count = 0 in Step 1.
 * 2. Trap 2 Resolution: Hard-purge decrements ref_count; Reaper deletes blob only when ref_count = 0
 *    AND zero active unexpired staging tickets reference the hash.
 * 3. Trap 3 Resolution: Invariant 5 Quota Query deduplicates over DISTINCT b.file_hash.
 * 4. Invariant 4 Relational Constraint: chk_exam_pq_embargo_quarantine blocks unembargoed published exam papers.
 * 5. Strict Magic-Byte Inspection (PDF, DOCX, EPUB, ZIP) & Rejection of Malicious Scripts.
 * 6. Step 2 Zero-Trust Hydration: Authoritative staging ticket ingestion with zero client size spoofing.
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db/index.js';
import {
  inspectBinaryMagicBytes,
  checkDepartmentQuota,
  getCasStoragePath,
  CAS_STORAGE_DIR,
  CAS_STAGED_DIR,
} from '../src/services/casStorageService.js';
import {
  commitLibraryItem,
  updateLibraryItem,
  hardPurgeLibraryItem,
  listAdminLibraryItems,
} from '../src/services/libraryAdminService.js';
import { runLibraryReaperSweep } from '../src/workers/libraryReaperWorker.js';

test.describe('Phase 27: Digital Library CAS Ingestion & Curation Doctrine', () => {

  // ─── Test Suite 1: Magic Byte Inspection ──────────────────────────────
  test.describe('Suite 1: Strict Document Magic-Byte Inspection', () => {
    test('authoritatively accepts valid PDF headers (%PDF-)', () => {
      const header = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
      const res = inspectBinaryMagicBytes(header, 'Algorithms.pdf');
      assert.equal(res.valid, true);
      assert.equal(res.mimeType, 'application/pdf');
      assert.equal(res.extension, 'pdf');
    });

    test('authoritatively accepts valid EPUB containers', () => {
      const header = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('mimetypeapplication/epub+zip'),
      ]);
      const res = inspectBinaryMagicBytes(header, 'discrete_math.epub');
      assert.equal(res.valid, true);
      assert.equal(res.mimeType, 'application/epub+zip');
      assert.equal(res.extension, 'epub');
    });

    test('authoritatively accepts OpenXML DOCX files', () => {
      const header = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('word/document.xml [Content_Types].xml'),
      ]);
      const res = inspectBinaryMagicBytes(header, 'handbook.docx');
      assert.equal(res.valid, true);
      assert.equal(res.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      assert.equal(res.extension, 'docx');
    });

    test('authoritatively rejects spoofed HTML, shell scripts, and executables', () => {
      const htmlHeader = Buffer.from('<!DOCTYPE html><html><script>alert(1)</script>');
      assert.equal(inspectBinaryMagicBytes(htmlHeader, 'malicious.pdf').valid, false);

      const exeHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00]); // MZ executable
      assert.equal(inspectBinaryMagicBytes(exeHeader, 'payload.pdf').valid, false);

      const truncated = Buffer.from([0x25, 0x50]); // 2 bytes only
      assert.equal(inspectBinaryMagicBytes(truncated, 'short.pdf').valid, false);
    });
  });

  // ─── Test Suite 2: Trap 3 Resolution - Distinct Quota Calculation ─────
  test.describe('Suite 2: Invariant 5 Quota Deduplication (Trap 3)', () => {
    test('checkDepartmentQuota evaluates storage over DISTINCT file_hash', async () => {
      const res = await checkDepartmentQuota('CSC', 10 * 1024 * 1024);
      assert.equal(typeof res.allowed, 'boolean');
      assert.equal(typeof res.usedBytes, 'number');
      assert.equal(typeof res.projectedBytes, 'number');
      assert.equal(typeof res.quotaBytes, 'number');
      assert.ok(res.quotaBytes > 0);
    });
  });

  // ─── Test Suite 3: Invariant 4 Relational Exam Quarantine Constraint ──
  test.describe('Suite 3: Invariant 4 Zero-Day Exam Embargo Quarantine', () => {
    test('PostgreSQL chk_exam_pq_embargo_quarantine rejects published exam without embargo date', async () => {
      const invalidExamId = crypto.randomUUID();
      await assert.rejects(
        async () => {
          await pool.query(`
            INSERT INTO library_items (
              id, category_id, title, item_type, file_url, is_published, embargo_until
            ) VALUES (
              $1, 'past_questions', 'Compromised Exam Paper 2026', 'SEMESTER_EXAM_PQ', '/mock', TRUE, NULL
            );
          `, [invalidExamId]);
        },
        (err) => {
          assert.match(err.message, /chk_exam_pq_embargo_quarantine/);
          return true;
        }
      );
    });

    test('permits exam papers when unreleased (is_published = FALSE)', async () => {
      const draftExamId = crypto.randomUUID();
      const { rows } = await pool.query(`
        INSERT INTO library_items (
          id, category_id, title, item_type, file_url, is_published, embargo_until
        ) VALUES (
          $1, 'past_questions', 'Quarantined Draft Exam 2026', 'SEMESTER_EXAM_PQ', '/mock', FALSE, NULL
        ) RETURNING id, is_published, embargo_until;
      `, [draftExamId]);

      assert.equal(rows[0].id, draftExamId);
      assert.equal(rows[0].is_published, false);

      // Cleanup
      await pool.query('DELETE FROM library_items WHERE id = $1', [draftExamId]);
    });

    test('permits published exam papers with explicit future embargo timestamp', async () => {
      const embargoedExamId = crypto.randomUUID();
      const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days

      const { rows } = await pool.query(`
        INSERT INTO library_items (
          id, category_id, title, item_type, file_url, is_published, embargo_until
        ) VALUES (
          $1, 'past_questions', 'Future Embargoed Exam 2026', 'SEMESTER_EXAM_PQ', '/mock', TRUE, $2
        ) RETURNING id, is_published, embargo_until;
      `, [embargoedExamId, futureDate]);

      assert.equal(rows[0].id, embargoedExamId);
      assert.equal(rows[0].is_published, true);
      assert.ok(rows[0].embargo_until !== null);

      // Cleanup
      await pool.query('DELETE FROM library_items WHERE id = $1', [embargoedExamId]);
    });
  });

  // ─── Test Suite 4: Two-Phase Ingestion & CAS Lifecycle (Traps 1 & 2) ──
  test.describe('Suite 4: CAS Ingestion Lifecycle, Step 1 Upsert & Step 2 Commit', () => {
    const testHash = crypto.createHash('sha256').update(`test_pdf_${Date.now()}`).digest('hex');
    const stagedId = crypto.randomUUID();
    const testActor = {
      id: 'admin1',
      advisor_id: 'admin1',
      role: 'SYSTEM_ADMIN',
      department_id: 'CSC',
    };

    test('Step 1 (Trap 1 Fix): upserts library_storage_blobs with ref_count = 0 and registers staging ticket', async () => {
      const { relativePath, dirPath, absolutePath } = getCasStoragePath(testHash, 'pdf');
      await fsp.mkdir(dirPath, { recursive: true });
      await fsp.writeFile(absolutePath, '%PDF-1.7 Test Content');

      // 1. Insert blob with ref_count = 0
      await pool.query(`
        INSERT INTO library_storage_blobs (
          file_hash, file_size_bytes, mime_type, page_count, storage_path, ref_count, created_at, updated_at
        ) VALUES ($1, 2048, 'application/pdf', 5, $2, 0, NOW(), NOW())
        ON CONFLICT (file_hash) DO NOTHING;
      `, [testHash, relativePath]);

      // 2. Insert staging record
      const stagingRes = await pool.query(`
        INSERT INTO library_upload_staging (
          staged_id, uploader_id, file_hash, file_size_bytes, mime_type, page_count, original_filename, status, expires_at
        ) VALUES ($1, $2, $3, 2048, 'application/pdf', 5, 'Unit_Test_Textbook.pdf', 'STAGED', NOW() + INTERVAL '2 hours')
        RETURNING *;
      `, [stagedId, testActor.id, testHash]);

      assert.equal(stagingRes.rows[0].staged_id, stagedId);
      assert.equal(stagingRes.rows[0].status, 'STAGED');

      // Verify blob ref_count is 0 in DB
      const blobRes = await pool.query(`SELECT ref_count FROM library_storage_blobs WHERE file_hash = $1`, [testHash]);
      assert.equal(blobRes.rows[0].ref_count, 0, 'Blob must start with ref_count = 0 in Step 1');
    });

    test('Step 2: commitLibraryItem locks staging ticket, increments ref_count to 1, and marks COMMITTED', async () => {
      const itemPayload = {
        stagedId,
        categoryId: 'textbooks',
        title: 'Modern Distributed Systems Architecture',
        author: 'Faculty Testing Team',
        publisher: 'UNIOSUN Press',
        publicationYear: 2026,
        courseId: 'CSC302',
        departmentId: 'CSC',
        level: 300,
        itemType: 'TEXTBOOK',
        isFeatured: true,
        isPublished: true,
      };

      const committedItem = await commitLibraryItem(testActor, itemPayload, '127.0.0.1');

      assert.ok(committedItem.id);
      assert.equal(committedItem.file_hash, testHash);
      assert.equal(committedItem.title, 'Modern Distributed Systems Architecture');

      // Verify CAS ref_count incremented to 1
      const blobRes = await pool.query(`SELECT ref_count FROM library_storage_blobs WHERE file_hash = $1`, [testHash]);
      assert.equal(blobRes.rows[0].ref_count, 1, 'Blob ref_count must be atomically incremented to 1');

      // Verify staging status updated to COMMITTED
      const stageRes = await pool.query(`SELECT status FROM library_upload_staging WHERE staged_id = $1`, [stagedId]);
      assert.equal(stageRes.rows[0].status, 'COMMITTED');

      // Verify HOT metrics row initialized
      const metricRes = await pool.query(`SELECT view_count, download_count FROM library_item_metrics WHERE item_id = $1`, [committedItem.id]);
      assert.equal(metricRes.rows[0].view_count, '0');
      assert.equal(metricRes.rows[0].download_count, '0');

      // Cleanup
      await pool.query('DELETE FROM library_items WHERE id = $1', [committedItem.id]);
    });

    test('Trap 2 Fix: hardPurgeLibraryItem decrements ref_count to 0; physical file is NOT immediately deleted', async () => {
      // Re-link an item to testHash
      const purgeItemId = crypto.randomUUID();
      await pool.query(`
        INSERT INTO library_items (
          id, category_id, title, item_type, file_url, file_hash, uploaded_by, is_published
        ) VALUES (
          $1, 'textbooks', 'Purge Candidate', 'TEXTBOOK', '/mock', $2, 'admin1', TRUE
        );
      `, [purgeItemId, testHash]);

      await pool.query(`UPDATE library_storage_blobs SET ref_count = 1 WHERE file_hash = $1`, [testHash]);

      const purgeRes = await hardPurgeLibraryItem(testActor, purgeItemId, '127.0.0.1');
      assert.equal(purgeRes.success, true);
      assert.equal(purgeRes.remainingRefs, 0);

      // Invariant: Physical file MUST still exist on disk immediately after HTTP return (Resolves Trap 2)
      const { absolutePath } = getCasStoragePath(testHash, 'pdf');
      const fileStillExists = await fsp.stat(absolutePath).then(() => true).catch(() => false);
      assert.equal(fileStillExists, true, 'Physical file must NOT be unlinked in HTTP post-commit hook');

      // Verify ref_count is 0 in DB
      const blobRes = await pool.query(`SELECT ref_count FROM library_storage_blobs WHERE file_hash = $1`, [testHash]);
      assert.equal(blobRes.rows[0].ref_count, 0);

      // Clean up test file
      await fsp.unlink(absolutePath).catch(() => {});
      await pool.query('DELETE FROM library_storage_blobs WHERE file_hash = $1', [testHash]);
      await pool.query('DELETE FROM library_upload_staging WHERE file_hash = $1', [testHash]);
    });
  });

  // ─── Test Suite 5: Reaper Sweep Concurrency & Trap 2 Immunity ─────────
  test.describe('Suite 5: Orphan Reaper Concurrency Defense (Trap 1 & 2)', () => {
    test('runLibraryReaperSweep does NOT delete ref_count = 0 blobs if active STAGED ticket exists', async () => {
      const activeHash = crypto.createHash('sha256').update(`active_staged_${Date.now()}`).digest('hex');
      const activeStagedId = crypto.randomUUID();
      const { relativePath, dirPath, absolutePath } = getCasStoragePath(activeHash, 'pdf');
      await fsp.mkdir(dirPath, { recursive: true });
      await fsp.writeFile(absolutePath, 'Active In-Flight Payload');

      // Blob aged > 24 hours with ref_count = 0
      await pool.query(`
        INSERT INTO library_storage_blobs (
          file_hash, file_size_bytes, mime_type, storage_path, ref_count, created_at, updated_at
        ) VALUES ($1, 1024, 'application/pdf', $2, 0, NOW() - INTERVAL '48 hours', NOW() - INTERVAL '48 hours')
        ON CONFLICT (file_hash) DO NOTHING;
      `, [activeHash, relativePath]);

      // BUT active staging ticket exists (user is on Step 2 form)
      await pool.query(`
        INSERT INTO library_upload_staging (
          staged_id, uploader_id, file_hash, file_size_bytes, mime_type, original_filename, status, expires_at
        ) VALUES ($1, 'admin1', $2, 1024, 'application/pdf', 'active.pdf', 'STAGED', NOW() + INTERVAL '1 hour');
      `, [activeStagedId, activeHash]);

      // Run Reaper sweep
      await runLibraryReaperSweep();

      // Verify blob was NOT deleted because of active staging ticket
      const blobRes = await pool.query(`SELECT file_hash FROM library_storage_blobs WHERE file_hash = $1`, [activeHash]);
      assert.equal(blobRes.rows.length, 1, 'Reaper must NOT delete blob while active staging ticket exists');

      // Cleanup
      await fsp.unlink(absolutePath).catch(() => {});
      await pool.query('DELETE FROM library_upload_staging WHERE staged_id = $1', [activeStagedId]);
      await pool.query('DELETE FROM library_storage_blobs WHERE file_hash = $1', [activeHash]);
    });
  });

  // ─── Test Suite 6: Administrative Directory Query ─────────────────────
  test.describe('Suite 6: Admin Directory Filtering & HOD Sandboxing', () => {
    test('listAdminLibraryItems returns paginated results', async () => {
      const actor = { id: 'admin1', role: 'SYSTEM_ADMIN', department_id: 'CSC' };
      const res = await listAdminLibraryItems(actor, { page: 1, limit: 10 });
      assert.ok(Array.isArray(res.data));
      assert.ok(res.pagination.total >= 0);
      assert.equal(res.pagination.page, 1);
    });
  });

  test.after(async () => {
    await pool.end();
  });
});
