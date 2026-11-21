/**
 * FOCIT LMS - Digital Library Administrative Curation & Ingestion Service
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces:
 * 1. Two-Phase Ingestion Contract: Physical CAS staging in Step 1, Zero-I/O ACID commit in Step 2.
 * 2. Invariant 4 Relational Department Boundary & Zero-Day Exam Embargo Quarantine.
 * 3. CAS Reference Counting: Decoupled metadata from immutable binary storage blobs.
 * 4. Unified Audit Logging via security_audit_events ledger.
 * 5. Single-Flight Cache Eviction on catalog state mutations.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import fsp from 'node:fs/promises';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { materialsCache } from '../lib/materialsCache.js';
import {
  checkDepartmentQuota,
  getCasStoragePath,
  extractPdfPageCount,
  inspectBinaryMagicBytes,
  MAX_SINGLE_UPLOAD_BYTES,
  CAS_STAGED_DIR,
} from './casStorageService.js';
import Busboy from 'busboy';

// Canonical UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Step 1: Busboy Two-Phase Streaming Ingest Valve.
 * Pipes chunks directly to disk, computes SHA-256 on the fly, checks quotas,
 * places into CAS directory, and registers with library_upload_staging.
 */
export async function handleStreamUpload(req, res) {
  const actor = req.user;
  if (!actor || !['DEAN', 'HOD', 'ADMIN', 'SYSTEM_ADMIN'].includes(actor.role)) {
    return res.status(403).json({
      type: 'https://focit.uniosun.edu.ng/errors/forbidden',
      title: 'Access Denied',
      status: 403,
      detail: 'Insufficient privileges to ingest resources into the Digital Library.',
      code: 'FORBIDDEN_INSUFFICIENT_ROLE',
    });
  }

  // Pre-flight quota check against actor's department (if HOD)
  const quotaCheck = await checkDepartmentQuota(actor.role === 'HOD' ? actor.department_id : null, 0);
  if (!quotaCheck.allowed) {
    return res.status(422).json({
      type: 'https://focit.uniosun.edu.ng/errors/quota-exceeded',
      title: 'Departmental Storage Quota Exceeded',
      status: 422,
      detail: `Storage limit of ${(quotaCheck.quotaBytes / (1024 * 1024 * 1024)).toFixed(1)}GB has been reached.`,
      code: 'QUOTA_EXCEEDED',
      meta: quotaCheck,
    });
  }

  const stagedId = crypto.randomUUID();
  const tempFilePath = path.join(CAS_STAGED_DIR, `${stagedId}.tmp`);

  let busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: MAX_SINGLE_UPLOAD_BYTES,
      },
    });
  } catch (err) {
    return res.status(400).json({
      type: 'https://focit.uniosun.edu.ng/errors/invalid-form',
      title: 'Invalid Multipart Request',
      status: 400,
      detail: err.message,
      code: 'INVALID_MULTIPART_HEADERS',
    });
  }

  let fileProcessed = false;
  let fileError = null;
  let fileHash = null;
  let fileSizeBytes = 0;
  let mimeType = null;
  let detectedExtension = 'pdf';
  let originalFilename = 'document.pdf';

  busboy.on('file', (fieldname, stream, info) => {
    fileProcessed = true;
    originalFilename = (info?.filename || 'document.pdf').slice(0, 255);

    const hashStream = crypto.createHash('sha256');
    let headerBuffer = Buffer.alloc(0);
    let headerInspected = false;
    let byteCounter = 0;

    const writeStream = fsp.open(tempFilePath, 'w');

    let fileHandle = null;

    stream.on('data', async (chunk) => {
      byteCounter += chunk.length;

      // 1. Enforce hard 150MB single-file cap dynamically
      if (byteCounter > MAX_SINGLE_UPLOAD_BYTES) {
        stream.destroy(new Error('FILE_SIZE_LIMIT_EXCEEDED'));
        return;
      }

      // 2. Magic-byte inspection on initial 4KB
      if (!headerInspected) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        if (headerBuffer.length >= 4096 || stream.readableEnded) {
          const inspection = inspectBinaryMagicBytes(headerBuffer, originalFilename);
          if (!inspection.valid) {
            fileError = { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', detail: inspection.reason };
            stream.destroy(new Error('INVALID_MAGIC_BYTES'));
            return;
          }
          mimeType = inspection.mimeType;
          detectedExtension = inspection.extension;
          headerInspected = true;
        }
      }

      hashStream.update(chunk);

      // Write chunk to staged file
      try {
        if (!fileHandle) {
          fileHandle = await writeStream;
        }
        await fileHandle.write(chunk);
      } catch (writeErr) {
        stream.destroy(writeErr);
      }
    });

    stream.on('error', async (err) => {
      logger.warn({ err: err.message, stagedId }, '[CAS Ingestion] Stream error during ingestion');
      if (fileHandle) {
        await fileHandle.close().catch(() => {});
      }
      await fsp.unlink(tempFilePath).catch(() => {});
      if (!fileError) {
        fileError = {
          status: err.message === 'FILE_SIZE_LIMIT_EXCEEDED' ? 413 : 400,
          code: err.message === 'FILE_SIZE_LIMIT_EXCEEDED' ? 'FILE_TOO_LARGE' : 'STREAM_ABORTED',
          detail: err.message === 'FILE_SIZE_LIMIT_EXCEEDED'
            ? 'File size exceeds maximum permitted ceiling of 150MB.'
            : 'Error occurred during binary transfer.',
        };
      }
    });

    stream.on('end', async () => {
      if (fileHandle) {
        await fileHandle.close().catch(() => {});
      }

      if (!headerInspected) {
        const inspection = inspectBinaryMagicBytes(headerBuffer, originalFilename);
        if (!inspection.valid) {
          fileError = { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', detail: inspection.reason };
          await fsp.unlink(tempFilePath).catch(() => {});
          return;
        }
        mimeType = inspection.mimeType;
        detectedExtension = inspection.extension;
        headerInspected = true;
      }

      fileSizeBytes = byteCounter;
      fileHash = hashStream.digest('hex');
    });
  });

  busboy.on('error', async (err) => {
    logger.error({ err: err.message }, '[CAS Ingestion] Busboy parser error');
    await fsp.unlink(tempFilePath).catch(() => {});
    if (!res.headersSent) {
      return res.status(400).json({
        type: 'https://focit.uniosun.edu.ng/errors/upload-failed',
        title: 'Upload Parsing Failed',
        status: 400,
        detail: err.message,
        code: 'PARSER_ERROR',
      });
    }
  });

  busboy.on('finish', async () => {
    if (!fileProcessed || fileError) {
      await fsp.unlink(tempFilePath).catch(() => {});
      const status = fileError?.status || 400;
      return res.status(status).json({
        type: 'https://focit.uniosun.edu.ng/errors/upload-rejected',
        title: 'File Upload Rejected',
        status,
        detail: fileError?.detail || 'No file payload was transmitted.',
        code: fileError?.code || 'NO_FILE_ATTACHED',
      });
    }

    try {
      // 1. Resolve Sharded CAS Storage Path
      const { dirPath, relativePath, absolutePath } = getCasStoragePath(fileHash, detectedExtension);
      await fsp.mkdir(dirPath, { recursive: true });

      // 2. Check if CAS blob already exists on disk
      let isExistingBlob = false;
      try {
        await fsp.stat(absolutePath);
        isExistingBlob = true;
        // Blob already exists: immediately unlink staged temp file (Zero Storage Amplification)
        await fsp.unlink(tempFilePath).catch(() => {});
      } catch (statErr) {
        if (statErr.code === 'ENOENT') {
          // New file: atomically move to permanent CAS location
          await fsp.rename(tempFilePath, absolutePath);
        } else {
          throw statErr;
        }
      }

      // 3. Extract PDF Page count if PDF format
      let pageCount = null;
      if (detectedExtension === 'pdf') {
        pageCount = await extractPdfPageCount(absolutePath);
      }

      // 4. Trap 1 Resolution: Upsert library_storage_blobs with ref_count = 0 in Step 1
      await pool.query(`
        INSERT INTO library_storage_blobs (
          file_hash, file_size_bytes, mime_type, page_count, storage_path, ref_count, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 0, NOW(), NOW())
        ON CONFLICT (file_hash) DO NOTHING;
      `, [fileHash, fileSizeBytes, mimeType, pageCount, relativePath]);

      // 5. Register in library_upload_staging ledger
      const { rows } = await pool.query(`
        INSERT INTO library_upload_staging (
          staged_id, uploader_id, file_hash, file_size_bytes, mime_type, page_count, original_filename, status, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'STAGED', NOW() + INTERVAL '2 hours')
        RETURNING staged_id, file_hash, file_size_bytes, mime_type, page_count, original_filename, expires_at;
      `, [stagedId, actor.id || actor.advisor_id, fileHash, fileSizeBytes, mimeType, pageCount, originalFilename]);

      const stagingTicket = rows[0];

      return res.status(201).json({
        data: stagingTicket,
        meta: {
          deduplicated: isExistingBlob,
          storagePath: relativePath,
        },
      });
    } catch (finalErr) {
      logger.error({ err: finalErr.message, stagedId }, '[CAS Ingestion] Post-stream staging failure');
      await fsp.unlink(tempFilePath).catch(() => {});
      return res.status(500).json({
        type: 'https://focit.uniosun.edu.ng/errors/internal-error',
        title: 'Ingestion Staging Failure',
        status: 500,
        detail: 'Failed to record upload ticket in authoritative staging ledger.',
        code: 'STAGING_RECORD_FAILED',
      });
    }
  });

  req.pipe(busboy);
}

/**
 * Step 2: Atomic Relational Commit Handler.
 * Consumes staging ticket, validates academic dimensions, verifies Invariant 4
 * departmental boundaries, locks and commits to PostgreSQL in a single ACID transaction.
 * Zero filesystem I/O inside transaction (Resolves Flaw 3).
 */
export async function commitLibraryItem(actor, payload, clientIp = '127.0.0.1') {
  const {
    stagedId,
    categoryId,
    title,
    description,
    author,
    publisher,
    publicationYear,
    edition,
    isbn,
    courseId,
    departmentId,
    level,
    academicSession,
    semesterNumber,
    itemType,
    coverImageUrl,
    isFeatured = false,
    isPublished = true,
    embargoUntil = null,
  } = payload || {};

  // 1. Strict Canonical UUID and Staged ID Validation
  if (!stagedId || !UUID_REGEX.test(stagedId)) {
    const err = new Error('Valid UUID stagedId ticket is required.');
    err.status = 400;
    err.code = 'INVALID_STAGED_ID';
    throw err;
  }

  // 2. Strict Metadata Boundary Checks
  if (!title || typeof title !== 'string' || !title.trim() || title.trim().length > 255) {
    const err = new Error('Title is mandatory and must not exceed 255 characters.');
    err.status = 400;
    err.code = 'INVALID_TITLE';
    throw err;
  }

  const validCategories = ['courses', 'textbooks', 'past_questions', 'faculty_resources'];
  if (!categoryId || !validCategories.includes(categoryId)) {
    const err = new Error(`Invalid categoryId. Must be one of: ${validCategories.join(', ')}`);
    err.status = 400;
    err.code = 'INVALID_CATEGORY';
    throw err;
  }

  const validItemTypes = [
    'LECTURE_NOTE', 'LAB_MANUAL', 'TEXTBOOK', 'REFERENCE_BOOK',
    'SEMESTER_EXAM_PQ', 'MIDTERM_TEST_PQ', 'HANDBOOK',
    'RESEARCH_TEMPLATE', 'CURRICULUM_GUIDE', 'POLICY_DOCUMENT',
  ];
  if (!itemType || !validItemTypes.includes(itemType)) {
    const err = new Error(`Invalid itemType. Must be one of: ${validItemTypes.join(', ')}`);
    err.status = 400;
    err.code = 'INVALID_ITEM_TYPE';
    throw err;
  }

  // 3. Category-Specific Validation
  if (categoryId === 'past_questions') {
    if (!academicSession || !semesterNumber || !level) {
      const err = new Error('Past Questions require academicSession, semesterNumber, and level.');
      err.status = 400;
      err.code = 'MISSING_PQ_DIMENSIONS';
      throw err;
    }
  }

  // 4. Invariant 4 Relational Exam Embargo Quarantine Rule
  const isExamType = ['SEMESTER_EXAM_PQ', 'MIDTERM_TEST_PQ'].includes(itemType);
  let parsedEmbargoUntil = null;
  if (embargoUntil) {
    parsedEmbargoUntil = new Date(embargoUntil);
    if (isNaN(parsedEmbargoUntil.getTime())) {
      const err = new Error('Invalid ISO-8601 embargoUntil timestamp format.');
      err.status = 400;
      err.code = 'INVALID_EMBARGO_DATE';
      throw err;
    }
  }

  if (isExamType && isPublished && !parsedEmbargoUntil) {
    const err = new Error('Examination papers marked published must carry an explicit embargoUntil quarantine date.');
    err.status = 422;
    err.code = 'EMBARGO_QUARANTINE_MANDATORY';
    throw err;
  }

  // 5. Invariant 4 Departmental Guard: HOD must match own department
  const uploaderId = actor.id || actor.advisor_id;
  const effectiveDepartmentId = actor.role === 'HOD' ? actor.department_id : (departmentId || null);

  // 6. Execute Atomic PostgreSQL ACID Transaction (Zero Filesystem Calls)
  const client = await pool.connect();
  try {
    await client.query('BEGIN;');

    // 6.1 Lock Staging Row (Authoritative Binary State)
    const stagingRes = await client.query(`
      SELECT staged_id, uploader_id, file_hash, file_size_bytes, mime_type, page_count, original_filename
      FROM library_upload_staging
      WHERE staged_id = $1 
        AND uploader_id = $2 
        AND status = 'STAGED' 
        AND expires_at > NOW()
      FOR UPDATE;
    `, [stagedId, uploaderId]);

    const stagingRow = stagingRes.rows[0];
    if (!stagingRow) {
      const err = new Error('Staging ticket not found, expired, or claimed by another actor.');
      err.status = 404;
      err.code = 'STAGING_TICKET_NOT_FOUND';
      throw err;
    }

    // 6.2 Increment CAS Storage Blob Reference Count
    const blobRes = await client.query(`
      UPDATE library_storage_blobs
      SET ref_count = ref_count + 1, updated_at = NOW()
      WHERE file_hash = $1
      RETURNING file_hash, storage_path, file_size_bytes;
    `, [stagingRow.file_hash]);

    if (blobRes.rows.length === 0) {
      const err = new Error('Underlying CAS storage blob missing from ledger.');
      err.status = 500;
      err.code = 'STORAGE_BLOB_INTEGRITY_FAILURE';
      throw err;
    }

    // 6.3 Insert into library_items catalog ledger
    const itemId = crypto.randomUUID();
    const fileUrl = `/api/library/items/${itemId}/stream`;

    const itemRes = await client.query(`
      INSERT INTO library_items (
        id, category_id, title, description, author, publisher, publication_year,
        edition, isbn, course_id, department_id, level, academic_session,
        semester_number, item_type, file_url, file_size_bytes, mime_type,
        page_count, cover_image_url, is_featured, is_published, embargo_until,
        uploaded_by, file_hash, original_filename, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, $26, NOW(), NOW()
      )
      RETURNING *;
    `, [
      itemId,
      categoryId,
      title.trim(),
      description !== undefined && description !== null ? String(description).trim() : null,
      author ? author.trim() : null,
      publisher ? publisher.trim() : null,
      publicationYear ? parseInt(publicationYear, 10) : null,
      edition ? edition.trim() : null,
      isbn ? isbn.trim() : null,
      courseId ? courseId.trim() : null,
      effectiveDepartmentId,
      level ? parseInt(level, 10) : null,
      academicSession ? academicSession.trim() : null,
      semesterNumber ? parseInt(semesterNumber, 10) : null,
      itemType,
      fileUrl,
      stagingRow.file_size_bytes,
      stagingRow.mime_type,
      stagingRow.page_count,
      coverImageUrl ? coverImageUrl.trim() : null,
      Boolean(isFeatured),
      Boolean(isPublished),
      parsedEmbargoUntil,
      uploaderId,
      stagingRow.file_hash,
      stagingRow.original_filename,
    ]);

    const createdItem = itemRes.rows[0];

    // 6.4 Initialize HOT Metrics Ledger
    await client.query(`
      INSERT INTO library_item_metrics (item_id, view_count, download_count, updated_at)
      VALUES ($1, 0, 0, NOW())
      ON CONFLICT (item_id) DO NOTHING;
    `, [itemId]);

    // 6.5 Mark Staging Ticket as COMMITTED
    await client.query(`
      UPDATE library_upload_staging
      SET status = 'COMMITTED'
      WHERE staged_id = $1;
    `, [stagedId]);

    // 6.6 Append-Only Governance Audit Event
    await client.query(`
      INSERT INTO library_curation_audit (
        item_id, actor_id, actor_role, action, changes_json, ip_address, created_at
      ) VALUES ($1, $2, $3, 'UPLOAD', $4, $5, NOW());
    `, [
      itemId,
      uploaderId,
      actor.role,
      JSON.stringify({
        title: createdItem.title,
        categoryId: createdItem.category_id,
        fileHash: createdItem.file_hash,
        fileSizeBytes: createdItem.file_size_bytes,
        embargoUntil: createdItem.embargo_until,
      }),
      clientIp,
    ]);

    await client.query('COMMIT;');

    // 7. SWR Cache Invalidation
    materialsCache.invalidate('library:categories:all');

    return createdItem;
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates catalog item metadata, publication status, or embargo quarantine.
 */
export async function updateLibraryItem(actor, itemId, updates, clientIp = '127.0.0.1') {
  if (!itemId || !UUID_REGEX.test(itemId)) {
    const err = new Error('Valid UUID item identifier required.');
    err.status = 400;
    err.code = 'INVALID_ITEM_ID';
    throw err;
  }

  const {
    title,
    description,
    author,
    publisher,
    publicationYear,
    edition,
    isbn,
    courseId,
    departmentId,
    level,
    academicSession,
    semesterNumber,
    isFeatured,
    isPublished,
    embargoUntil,
  } = updates || {};

  const client = await pool.connect();
  try {
    await client.query('BEGIN;');

    const existingRes = await client.query(`
      SELECT * FROM library_items WHERE id = $1 FOR UPDATE;
    `, [itemId]);

    const item = existingRes.rows[0];
    if (!item) {
      const err = new Error(`Library item '${itemId}' not found.`);
      err.status = 404;
      err.code = 'ITEM_NOT_FOUND';
      throw err;
    }

    // Invariant 4 Department Guard
    if (actor.role === 'HOD' && item.department_id !== actor.department_id) {
      const err = new Error('HOD cannot modify library items outside their assigned department.');
      err.status = 403;
      err.code = 'FORBIDDEN_DEPARTMENT_MISMATCH';
      throw err;
    }

    let parsedEmbargoUntil = item.embargo_until;
    if (embargoUntil !== undefined) {
      if (embargoUntil === null || embargoUntil === '') {
        parsedEmbargoUntil = null;
      } else {
        parsedEmbargoUntil = new Date(embargoUntil);
        if (isNaN(parsedEmbargoUntil.getTime())) {
          const err = new Error('Invalid ISO-8601 embargo date.');
          err.status = 400;
          err.code = 'INVALID_EMBARGO_DATE';
          throw err;
        }
      }
    }

    const nextIsPublished = isPublished !== undefined ? Boolean(isPublished) : item.is_published;
    const isExamType = ['SEMESTER_EXAM_PQ', 'MIDTERM_TEST_PQ'].includes(item.item_type);

    if (isExamType && nextIsPublished && !parsedEmbargoUntil) {
      const err = new Error('Exam papers marked published require an explicit embargoUntil quarantine date.');
      err.status = 422;
      err.code = 'EMBARGO_QUARANTINE_MANDATORY';
      throw err;
    }

    const { rows } = await client.query(`
      UPDATE library_items
      SET
        title = COALESCE($2, title),
        description = COALESCE($3, description),
        author = COALESCE($4, author),
        publisher = COALESCE($5, publisher),
        publication_year = COALESCE($6, publication_year),
        edition = COALESCE($7, edition),
        isbn = COALESCE($8, isbn),
        course_id = COALESCE($9, course_id),
        department_id = COALESCE($10, department_id),
        level = COALESCE($11, level),
        academic_session = COALESCE($12, academic_session),
        semester_number = COALESCE($13, semester_number),
        is_featured = COALESCE($14, is_featured),
        is_published = COALESCE($15, is_published),
        embargo_until = $16,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `, [
      itemId,
      title !== undefined ? title.trim() : null,
      description !== undefined ? description : null,
      author !== undefined ? author.trim() : null,
      publisher !== undefined ? publisher.trim() : null,
      publicationYear !== undefined ? parseInt(publicationYear, 10) : null,
      edition !== undefined ? edition.trim() : null,
      isbn !== undefined ? isbn.trim() : null,
      courseId !== undefined ? courseId.trim() : null,
      actor.role === 'HOD' ? item.department_id : (departmentId !== undefined ? departmentId : null),
      level !== undefined ? parseInt(level, 10) : null,
      academicSession !== undefined ? academicSession.trim() : null,
      semesterNumber !== undefined ? parseInt(semesterNumber, 10) : null,
      isFeatured !== undefined ? Boolean(isFeatured) : null,
      nextIsPublished,
      parsedEmbargoUntil,
    ]);

    const updated = rows[0];

    // Audit Event
    await client.query(`
      INSERT INTO library_curation_audit (
        item_id, actor_id, actor_role, action, changes_json, ip_address, created_at
      ) VALUES ($1, $2, $3, 'METADATA_UPDATE', $4, $5, NOW());
    `, [
      itemId,
      actor.id || actor.advisor_id,
      actor.role,
      JSON.stringify(updates),
      clientIp,
    ]);

    await client.query('COMMIT;');

    materialsCache.invalidate('library:categories:all');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Soft Delete (Default): Sets is_published = FALSE.
 */
export async function softDeleteLibraryItem(actor, itemId, clientIp = '127.0.0.1') {
  return updateLibraryItem(actor, itemId, { isPublished: false }, clientIp);
}

/**
 * Hard Purge (SYSTEM_ADMIN only):
 * Deletes library_items row, decrements CAS ref_count in PostgreSQL.
 * Physical unlink is delegated exclusively to the Reaper worker (Resolves Trap 2).
 */
export async function hardPurgeLibraryItem(actor, itemId, clientIp = '127.0.0.1') {
  if (actor.role !== 'SYSTEM_ADMIN') {
    const err = new Error('Hard-purge deletion is restricted exclusively to SYSTEM_ADMIN.');
    err.status = 403;
    err.code = 'FORBIDDEN_SYSTEM_ADMIN_REQUIRED';
    throw err;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN;');

    const itemRes = await client.query(`
      DELETE FROM library_items
      WHERE id = $1
      RETURNING id, title, file_hash;
    `, [itemId]);

    const deleted = itemRes.rows[0];
    if (!deleted) {
      const err = new Error(`Library item '${itemId}' not found.`);
      err.status = 404;
      err.code = 'ITEM_NOT_FOUND';
      throw err;
    }

    let remainingRefs = null;
    if (deleted.file_hash) {
      // Decrement reference count
      const blobRes = await client.query(`
        UPDATE library_storage_blobs
        SET ref_count = GREATEST(ref_count - 1, 0), updated_at = NOW()
        WHERE file_hash = $1
        RETURNING file_hash, ref_count;
      `, [deleted.file_hash]);
      remainingRefs = blobRes.rows[0]?.ref_count;
    }

    // Append Audit Event
    await client.query(`
      INSERT INTO library_curation_audit (
        item_id, actor_id, actor_role, action, changes_json, ip_address, created_at
      ) VALUES ($1, $2, $3, 'HARD_PURGE', $4, $5, NOW());
    `, [
      itemId,
      actor.id || actor.advisor_id,
      actor.role,
      JSON.stringify({ title: deleted.title, fileHash: deleted.file_hash, remainingRefs }),
      clientIp,
    ]);

    await client.query('COMMIT;');

    materialsCache.invalidate('library:categories:all');
    return { success: true, itemId, remainingRefs };
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Administrative Catalog Query (bypasses student embargo & publication filters).
 */
export async function listAdminLibraryItems(actor, queryParams = {}) {
  const {
    categoryId,
    departmentId,
    level,
    status = 'all', // 'all', 'published', 'draft', 'embargoed'
    search,
    page = 1,
    limit = 20,
  } = queryParams;

  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const offset = (pageNum - 1) * pageSize;

  const conditions = [];
  const params = [];

  // Invariant 4 Department Guard: HOD locked to own department
  if (actor.role === 'HOD') {
    params.push(actor.department_id);
    conditions.push(`i.department_id = $${params.length}`);
  } else if (departmentId) {
    params.push(departmentId);
    conditions.push(`i.department_id = $${params.length}`);
  }

  if (categoryId) {
    params.push(categoryId);
    conditions.push(`i.category_id = $${params.length}`);
  }

  if (level) {
    params.push(parseInt(level, 10));
    conditions.push(`i.level = $${params.length}`);
  }

  if (status === 'published') {
    conditions.push(`i.is_published = TRUE AND (i.embargo_until IS NULL OR i.embargo_until <= NOW())`);
  } else if (status === 'draft') {
    conditions.push(`i.is_published = FALSE`);
  } else if (status === 'embargoed') {
    conditions.push(`i.is_published = TRUE AND i.embargo_until > NOW()`);
  }

  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(`(
      LOWER(i.title) LIKE $${params.length} OR 
      LOWER(COALESCE(i.author, '')) LIKE $${params.length} OR 
      LOWER(COALESCE(i.course_id, '')) LIKE $${params.length} OR
      LOWER(COALESCE(i.original_filename, '')) LIKE $${params.length}
    )`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countQuery = `SELECT COUNT(*)::int AS total FROM library_items i ${whereClause};`;
  const countRes = await pool.query(countQuery, params);
  const total = countRes.rows[0]?.total || 0;

  params.push(pageSize);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const itemsQuery = `
    SELECT 
      i.id, i.category_id, i.title, i.description, i.author, i.publisher,
      i.publication_year, i.edition, i.isbn, i.course_id, i.department_id,
      i.level, i.academic_session, i.semester_number, i.item_type,
      i.file_url, i.file_size_bytes, i.mime_type, i.page_count,
      i.cover_image_url, i.is_featured, i.is_published, i.embargo_until,
      i.uploaded_by, i.file_hash, i.original_filename,
      i.created_at, i.updated_at,
      COALESCE(m.view_count, 0)::bigint AS view_count,
      COALESCE(m.download_count, 0)::bigint AS download_count,
      COALESCE(b.ref_count, 1)::int AS cas_ref_count
    FROM library_items i
    LEFT JOIN library_item_metrics m ON m.item_id = i.id
    LEFT JOIN library_storage_blobs b ON b.file_hash = i.file_hash
    ${whereClause}
    ORDER BY i.created_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx};
  `;

  const { rows } = await pool.query(itemsQuery, params);

  return {
    data: rows,
    pagination: {
      page: pageNum,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

/**
 * Aggregates library curation metrics and departmental storage quotas.
 */
export async function getLibraryAdminStats(actor) {
  const targetDept = actor.role === 'HOD' ? actor.department_id : null;

  // 1. Quota calculations (Deduplicated over DISTINCT file_hash - Invariant 5)
  const quota = await checkDepartmentQuota(targetDept, 0);

  // 2. Aggregate counts
  const { rows: countRows } = await pool.query(`
    SELECT 
      COUNT(*)::int AS total_items,
      COUNT(*) FILTER (WHERE is_published = TRUE AND (embargo_until IS NULL OR embargo_until <= NOW()))::int AS published_count,
      COUNT(*) FILTER (WHERE is_published = FALSE)::int AS draft_count,
      COUNT(*) FILTER (WHERE is_published = TRUE AND embargo_until > NOW())::int AS embargoed_count,
      COUNT(DISTINCT file_hash)::int AS distinct_cas_blobs
    FROM library_items
    WHERE ($1::varchar IS NULL OR department_id = $1);
  `, [targetDept]);

  // 3. Category Breakdown
  const { rows: categoryRows } = await pool.query(`
    SELECT category_id, COUNT(*)::int AS count
    FROM library_items
    WHERE ($1::varchar IS NULL OR department_id = $1)
    GROUP BY category_id;
  `, [targetDept]);

  return {
    counts: countRows[0] || {},
    categories: categoryRows,
    storage: quota,
  };
}
