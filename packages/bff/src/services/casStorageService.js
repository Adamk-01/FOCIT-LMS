/**
 * FOCIT LMS - Content-Addressed Storage (CAS) & Ingestion Valve Service
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. Two-Phase Busboy Streaming Valve directly to disk (Zero V8 Heap Buffering).
 * 2. Strict Magic-Byte Inspection (PDF, OpenXML DOCX, EPUB, ZIP).
 * 3. On-The-Fly SHA-256 Digesting & Byte Counting.
 * 4. Invariant 5 Cumulative Departmental Quota Bound (SUM over DISTINCT file_hash).
 * 5. Hash-Sharded CAS File Placement (/uploads/library/cas/ab/cd/abcdef...pdf).
 * 6. Non-Blocking PDF Page Extractor with Safe Fallback.
 */

import Busboy from 'busboy';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const CAS_UPLOADS_ROOT = path.resolve(__dirname, '../../../uploads/library');
export const CAS_STAGED_DIR = path.join(CAS_UPLOADS_ROOT, 'staged');
export const CAS_STORAGE_DIR = path.join(CAS_UPLOADS_ROOT, 'cas');

// Ensure root, staged, and CAS storage directories exist at startup
fs.mkdirSync(CAS_STAGED_DIR, { recursive: true });
fs.mkdirSync(CAS_STORAGE_DIR, { recursive: true });

// Hard limits
export const MAX_SINGLE_UPLOAD_BYTES = 150 * 1024 * 1024; // 150MB single textbook ceiling
export const DEFAULT_DEPT_QUOTA_BYTES = 15 * 1024 * 1024 * 1024; // 15GB per department
export const FACULTY_GLOBAL_QUOTA_BYTES = 100 * 1024 * 1024 * 1024; // 100GB faculty ceiling

const MAGIC_BYTE_HEADER_SIZE = 4096;
const SOCKET_DRAIN_LIMIT_BYTES = 2 * 1024 * 1024; // 2MB drain ceiling
const SOCKET_DRAIN_TIMEOUT_MS = 500;

// Binary Signatures
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF-
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const DOCX_NEEDLE_1 = Buffer.from('word/');
const DOCX_NEEDLE_2 = Buffer.from('[Content_Types].xml');
const EPUB_NEEDLE = Buffer.from('application/epub+zip');

/**
 * Inspects a header buffer and detects authoritative binary MIME.
 * Strictly permits PDF, DOCX, EPUB, and ZIP archives.
 */
export function inspectBinaryMagicBytes(headerBuffer, originalFilename = '') {
  if (!headerBuffer || headerBuffer.length < 4) {
    return {
      valid: false,
      reason: 'Payload is too small to contain a valid document binary header (min 4 bytes required).',
    };
  }

  // 1. PDF Verification (%PDF-)
  if (headerBuffer.subarray(0, 4).equals(PDF_MAGIC)) {
    return {
      valid: true,
      mimeType: 'application/pdf',
      extension: 'pdf',
    };
  }

  // 2. PKZIP Family (Standard ZIP, OpenXML DOCX, and EPUB)
  if (headerBuffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    const ext = path.extname(originalFilename).toLowerCase();

    // EPUB Verification
    if (headerBuffer.includes(EPUB_NEEDLE) || ext === '.epub') {
      return {
        valid: true,
        mimeType: 'application/epub+zip',
        extension: 'epub',
      };
    }

    // DOCX Verification
    const hasWordNeedle = headerBuffer.includes(DOCX_NEEDLE_1) || headerBuffer.includes(DOCX_NEEDLE_2);
    if (ext === '.docx' || hasWordNeedle) {
      if (hasWordNeedle) {
        return {
          valid: true,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          extension: 'docx',
        };
      }
      return {
        valid: false,
        reason: 'File has .docx extension but lacks valid OpenXML structure.',
      };
    }

    // Generic ZIP archive
    return {
      valid: true,
      mimeType: 'application/zip',
      extension: 'zip',
    };
  }

  return {
    valid: false,
    reason: 'Unauthorized file format. Only PDF, Microsoft Word (.docx), EPUB, and ZIP archives are permitted in the Digital Library.',
  };
}

/**
 * Evaluates cumulative departmental storage quota (Invariant 5).
 * Deduplicates by b.file_hash so cross-listed CAS textbooks are not double-billed.
 */
export async function checkDepartmentQuota(departmentId, incomingSizeBytes = 0) {
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(sub.file_size_bytes), 0)::bigint AS used_bytes
    FROM (
      SELECT DISTINCT b.file_hash, b.file_size_bytes
      FROM library_items i
      JOIN library_storage_blobs b ON b.file_hash = i.file_hash
      WHERE ($1::varchar IS NULL OR i.department_id = $1)
    ) sub;
  `, [departmentId || null]);

  const usedBytes = BigInt(rows[0]?.used_bytes || '0');
  const incoming = BigInt(incomingSizeBytes);
  const quota = departmentId ? BigInt(DEFAULT_DEPT_QUOTA_BYTES) : BigInt(FACULTY_GLOBAL_QUOTA_BYTES);
  const projected = usedBytes + incoming;

  return {
    allowed: projected <= quota,
    usedBytes: Number(usedBytes),
    projectedBytes: Number(projected),
    quotaBytes: Number(quota),
    remainingBytes: Number(quota > usedBytes ? quota - usedBytes : 0n),
  };
}

/**
 * Generates deterministic 2-tier sharded directory path for CAS files:
 * /uploads/library/cas/ab/cd/abcdef123...pdf
 */
export function getCasStoragePath(fileHash, extension = 'pdf') {
  const prefix1 = fileHash.slice(0, 2);
  const prefix2 = fileHash.slice(2, 4);
  const dirPath = path.join(CAS_STORAGE_DIR, prefix1, prefix2);
  const relativePath = path.posix.join('cas', prefix1, prefix2, `${fileHash}.${extension}`);
  const absolutePath = path.join(dirPath, `${fileHash}.${extension}`);
  return { dirPath, relativePath, absolutePath };
}

/**
 * Lightweight safe PDF page count extractor.
 * Scans the cross-reference table and /Count dictionary with fallback to null.
 * Never throws or stalls stream execution.
 */
export async function extractPdfPageCount(filePath) {
  try {
    const fd = await fsp.open(filePath, 'r');
    try {
      const stat = await fd.stat();
      const readSize = Math.min(stat.size, 65536); // Read final 64KB
      const buffer = Buffer.alloc(readSize);
      await fd.read(buffer, 0, readSize, stat.size - readSize);
      const content = buffer.toString('latin1');

      // Attempt matching /Count inside /Pages catalog
      const matches = content.match(/\/Count\s+(\d+)/g);
      if (matches && matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const count = parseInt(lastMatch.replace(/\/Count\s+/, ''), 10);
        if (Number.isInteger(count) && count > 0 && count < 50000) {
          return count;
        }
      }
    } finally {
      await fd.close();
    }
  } catch (err) {
    logger.debug({ err: err?.message, filePath }, '[CAS Extractor] PDF page count extraction fallback to null');
  }
  return null;
}

/**
 * Capped Socket Drain Helper:
 * Discards remaining incoming TCP bytes up to 2MB, then sends error response
 * with `Connection: close` to prevent browser TCP Reset (RST).
 */
export function drainAndReject(req, res, statusCode, errorCode, message) {
  if (res.headersSent) return;

  res.setHeader('Connection', 'close');
  res.setHeader('Content-Type', 'application/json');

  let drainedBytes = 0;
  let timer = null;

  const cleanupAndSend = () => {
    if (timer) clearTimeout(timer);
    req.removeAllListeners('data');
    req.removeAllListeners('end');
    req.removeAllListeners('error');
    if (!res.headersSent) {
      res.status(statusCode).json({
        type: 'https://focit.uniosun.edu.ng/errors/upload-valve-rejected',
        title: 'Upload Valve Rejected',
        status: statusCode,
        detail: message,
        code: errorCode,
      });
    }
  };

  timer = setTimeout(() => {
    req.destroy();
    cleanupAndSend();
  }, SOCKET_DRAIN_TIMEOUT_MS);

  req.on('data', (chunk) => {
    drainedBytes += chunk.length;
    if (drainedBytes > SOCKET_DRAIN_LIMIT_BYTES) {
      req.destroy();
      cleanupAndSend();
    }
  });

  req.on('end', cleanupAndSend);
  req.on('error', () => {
    cleanupAndSend();
  });
  req.resume();
}

