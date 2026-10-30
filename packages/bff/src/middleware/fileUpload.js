/**
 * FOCIT LMS - Streamed File Upload Middleware (Milestone 10.3)
 *
 * Implements:
 * 1. Two-Phase Busboy Streaming Valve with 4.1KB Sync Buffer
 * 2. Strict Magic-Byte Inspection (PDF, ZIP, OpenXML DOCX)
 * 3. 10MB Hard Quota with Capped Socket Drain & Anti-TCP-Reset Teardown
 * 4. Staged Temporary File Isolation for Two-Phase ACID Coordination
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import Busboy from 'busboy';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { logger } from '../lib/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STAGED_UPLOADS_DIR = path.resolve(__dirname, '../../uploads/assignments/staged');
export const PERMANENT_UPLOADS_DIR = path.resolve(__dirname, '../../uploads/assignments/permanent');

// Ensure staging and permanent directories exist at startup
fs.mkdirSync(STAGED_UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PERMANENT_UPLOADS_DIR, { recursive: true });

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB hard ceiling
const MAGIC_BYTE_HEADER_SIZE = 4100; // 4.1KB sync inspection window
const SOCKET_DRAIN_LIMIT_BYTES = 2 * 1024 * 1024; // 2MB bounded drain valve
const SOCKET_DRAIN_TIMEOUT_MS = 500; // 500ms max drain window

// Binary Signatures
const PDF_MAGIC = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF-
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const DOCX_NEEDLE_1 = Buffer.from('word/');
const DOCX_NEEDLE_2 = Buffer.from('[Content_Types].xml');

/**
 * Inspects a header buffer and detects authoritative binary MIME.
 * Returns { valid: boolean, mimeType: string, extension: string, reason?: string }
 */
export function inspectBinaryMagicBytes(headerBuffer, originalFilename = '') {
  if (!headerBuffer || headerBuffer.length < 4) {
    return {
      valid: false,
      reason: 'File payload is too small to contain a valid binary file signature (minimum 4 bytes required).',
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

  // 2. PKZIP Family (Standard ZIP and OpenXML DOCX)
  if (headerBuffer.subarray(0, 4).equals(ZIP_MAGIC)) {
    const ext = path.extname(originalFilename).toLowerCase();

    // Check for OpenXML Word document signatures within the first 4.1KB
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
        reason: 'File has a .docx extension but lacks valid OpenXML structure (missing word/ or [Content_Types].xml headers).',
      };
    }

    // Standard ZIP Archive
    return {
      valid: true,
      mimeType: 'application/zip',
      extension: 'zip',
    };
  }

  return {
    valid: false,
    reason: 'Unrecognized or unauthorized file format. Only PDF, ZIP, and Microsoft Word (.docx) files are permitted.',
  };
}

/**
 * Capped Socket Drain Helper:
 * Discards remaining incoming TCP bytes up to a strict limit,
 * then sends the RFC 7807 response with `Connection: close` to prevent browser TCP Reset (RST).
 */
export function drainAndReject(req, res, statusCode, errorCode, message) {
  if (res.headersSent) return;

  res.setHeader('Connection', 'close');

  let drainedBytes = 0;
  let finished = false;

  const cleanupAndRespond = () => {
    if (finished) return;
    finished = true;

    try {
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.removeAllListeners('error');
    } catch (_) {}

    res.status(statusCode).json({
      type: `https://focit.osustech.edu.ng/errors/${errorCode.toLowerCase()}`,
      title: 'File Upload Rejected',
      status: statusCode,
      code: errorCode,
      detail: message,
    });

    res.on('finish', () => {
      setImmediate(() => {
        try {
          if (!req.socket.destroyed) req.socket.destroy();
        } catch (_) {}
      });
    });
  };

  const drainTimeout = setTimeout(() => {
    cleanupAndRespond();
  }, SOCKET_DRAIN_TIMEOUT_MS);

  req.on('data', (chunk) => {
    drainedBytes += chunk.length;
    if (drainedBytes >= SOCKET_DRAIN_LIMIT_BYTES) {
      clearTimeout(drainTimeout);
      cleanupAndRespond();
    }
  });

  req.on('end', () => {
    clearTimeout(drainTimeout);
    cleanupAndRespond();
  });

  req.on('error', () => {
    clearTimeout(drainTimeout);
    cleanupAndRespond();
  });

  // Resume request stream in case it was paused
  req.resume();
}

/**
 * Express Middleware: streamAssignmentUpload
 */
export function streamAssignmentUpload(req, res, next) {
  // If not multipart, let downstream JSON body parser handle payload
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return next();
  }

  let busboy;
  try {
    busboy = Busboy({
      headers: req.headers,
      limits: {
        fileSize: MAX_FILE_SIZE_BYTES,
        files: 1,
      },
    });
  } catch (err) {
    logger.error({ err }, '[FileUpload] Busboy initialization failed');
    return res.status(400).json({
      error: 'Malformed multipart/form-data headers',
      code: 'INVALID_MULTIPART_HEADERS',
    });
  }

  let uploadedFile = null;
  let stagedFilePath = null;
  let writeStream = null;
  let uploadAborted = false;
  const fields = {};

  let resolveFileWrite;
  let rejectFileWrite;
  const fileWritePromise = new Promise((resolve, reject) => {
    resolveFileWrite = resolve;
    rejectFileWrite = reject;
  });
  let hasFile = false;

  const abort = (statusCode, errorCode, message) => {
    if (uploadAborted) return;
    uploadAborted = true;

    // Disconnect streams
    try {
      req.unpipe(busboy);
    } catch (_) {}

    if (writeStream) {
      writeStream.destroy();
      writeStream = null;
    }

    if (stagedFilePath) {
      fs.promises.unlink(stagedFilePath).catch(() => {});
      stagedFilePath = null;
    }

    if (rejectFileWrite) {
      try {
        rejectFileWrite(new Error(message || 'Upload aborted'));
      } catch (_) {}
    }

    drainAndReject(req, res, statusCode, errorCode, message);
  };

  // Capture non-file fields (e.g. submission_text, x-idempotency-key)
  busboy.on('field', (name, val) => {
    fields[name] = val;
  });

  busboy.on('file', (fieldname, fileStream, info) => {
    const { filename, mimeType: reportedMime } = info;

    if (!filename || filename.trim().length === 0) {
      fileStream.resume();
      return;
    }

    hasFile = true;
    const tempToken = randomBytes(12).toString('hex');
    const sanitizedBase = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    stagedFilePath = path.join(STAGED_UPLOADS_DIR, `focit_stage_${Date.now()}_${tempToken}.tmp`);

    let totalBytesReceived = 0;
    let headerBuffer = Buffer.alloc(0);
    let mimeVerified = false;
    let detectedMime = null;
    let detectedExt = null;

    fileStream.on('data', (chunk) => {
      if (uploadAborted) return;

      totalBytesReceived += chunk.length;

      // Check file size ceiling
      if (totalBytesReceived > MAX_FILE_SIZE_BYTES) {
        fileStream.resume();
        return abort(413, 'FILE_TOO_LARGE', `Uploaded file exceeds institutional limit of 10MB (${MAX_FILE_SIZE_BYTES} bytes).`);
      }

      // Phase 1: Accumulate sync header buffer for magic bytes inspection
      if (!mimeVerified) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);

        if (headerBuffer.length >= MAGIC_BYTE_HEADER_SIZE) {
          const inspection = inspectBinaryMagicBytes(headerBuffer, sanitizedBase);
          if (!inspection.valid) {
            fileStream.resume();
            return abort(422, 'MIME_SPOOFING_DETECTED', inspection.reason || 'File signature does not match allowed types.');
          }

          mimeVerified = true;
          detectedMime = inspection.mimeType;
          detectedExt = inspection.extension;

          // Open write stream and flush header buffer to disk
          try {
            writeStream = fs.createWriteStream(stagedFilePath);
            writeStream.on('finish', () => resolveFileWrite?.());
            writeStream.on('error', (writeErr) => rejectFileWrite?.(writeErr));
            writeStream.write(headerBuffer);
          } catch (writeErr) {
            logger.error({ writeErr }, '[FileUpload] Error creating staged disk descriptor');
            return abort(500, 'DISK_WRITE_FAILURE', 'Internal filesystem failure while persisting upload.');
          }
        }
        return;
      }

      // Phase 2: Pipe directly to disk once verified
      if (writeStream && !writeStream.destroyed) {
        const canContinue = writeStream.write(chunk);
        if (!canContinue) {
          fileStream.pause();
          writeStream.once('drain', () => fileStream.resume());
        }
      }
    });

    fileStream.on('end', () => {
      if (uploadAborted) return;

      // Handle small file edge case (< 4,100 bytes)
      if (!mimeVerified) {
        const inspection = inspectBinaryMagicBytes(headerBuffer, sanitizedBase);
        if (!inspection.valid) {
          return abort(422, 'MIME_SPOOFING_DETECTED', inspection.reason || 'File signature does not match allowed types.');
        }

        mimeVerified = true;
        detectedMime = inspection.mimeType;
        detectedExt = inspection.extension;

        try {
          writeStream = fs.createWriteStream(stagedFilePath);
          writeStream.on('finish', () => resolveFileWrite?.());
          writeStream.on('error', (writeErr) => rejectFileWrite?.(writeErr));
          writeStream.end(headerBuffer);
        } catch (writeErr) {
          return abort(500, 'DISK_WRITE_FAILURE', 'Internal filesystem failure while persisting upload.');
        }
      } else if (writeStream) {
        writeStream.end();
      }

      uploadedFile = {
        originalName: sanitizedBase,
        reportedMime,
        mimeType: detectedMime,
        extension: detectedExt,
        sizeBytes: totalBytesReceived,
        stagedPath: stagedFilePath,
      };
    });

    fileStream.on('error', (err) => {
      logger.error({ err }, '[FileUpload] Incoming file stream error');
      abort(400, 'FILE_STREAM_ERROR', 'File transfer interrupted by client network anomaly.');
    });
  });

  let isCompleted = false;
  const onBusboyFinish = async () => {
    if (uploadAborted || isCompleted) return;
    isCompleted = true;

    if (hasFile) {
      try {
        await fileWritePromise;
      } catch (writeErr) {
        if (!uploadAborted) {
          logger.error({ writeErr }, '[FileUpload] File write stream error during completion');
          return abort(500, 'DISK_WRITE_FAILURE', 'Internal filesystem failure while persisting upload.');
        }
        return;
      }
    }

    if (uploadAborted) return;

    // Attach parsed fields and staged file metadata to Express req
    req.body = { ...req.body, ...fields };
    if (uploadedFile) {
      req.uploadedFile = uploadedFile;
    }
    next();
  };

  busboy.on('finish', onBusboyFinish);
  busboy.on('close', onBusboyFinish);

  busboy.on('error', (err) => {
    logger.error({ err }, '[FileUpload] Busboy parse error');
    abort(400, 'MULTIPART_PARSE_ERROR', 'Failed to parse multipart request body.');
  });

  req.pipe(busboy);
}
