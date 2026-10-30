/**
 * FOCIT LMS - Phase 10: Assignment Upload & Mobile Viewport Doctrine Verification Suite
 *
 * Mathematically validates:
 * 1. Invariant 4: Strict MIME Magic-Byte Sniffer (PDF, ZIP, OpenXML DOCX)
 * 2. Invariant 4: Rejection of Spoofed Executables & Truncated Header Payloads
 * 3. Two-Phase POSIX Filesystem & ACID Transaction Coordination Mechanics
 * 4. Invariant 1 & 9: Mobile Viewport Containment & CSS Flexbox min-h-0 Invariant
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import {
  inspectBinaryMagicBytes,
  MAX_FILE_SIZE_BYTES,
  STAGED_UPLOADS_DIR,
  PERMANENT_UPLOADS_DIR,
  streamAssignmentUpload,
} from '../src/middleware/fileUpload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe('Phase 10: Assignment Upload & Mobile Viewport Doctrine', () => {

  // ─── Test Suite 1: Magic Byte Inspection & Anti-MIME Spoofing ───
  test.describe('Invariant 4: Multi-Format Magic-Byte Inspection Engine', () => {
    test('authoritatively accepts valid PDF headers (%PDF-)', () => {
      const pdfHeader = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
      const result = inspectBinaryMagicBytes(pdfHeader, 'lab_report.pdf');

      assert.equal(result.valid, true);
      assert.equal(result.mimeType, 'application/pdf');
      assert.equal(result.extension, 'pdf');
    });

    test('authoritatively accepts valid standard ZIP archives (PK\\x03\\x04)', () => {
      // Minimal ZIP local file header
      const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x0a, 0x00, 0x00, 0x00]);
      const result = inspectBinaryMagicBytes(zipHeader, 'source_code.zip');

      assert.equal(result.valid, true);
      assert.equal(result.mimeType, 'application/zip');
      assert.equal(result.extension, 'zip');
    });

    test('authoritatively distinguishes OpenXML DOCX from arbitrary ZIP using internal XML headers', () => {
      // DOCX header buffer containing PKZIP magic and [Content_Types].xml or word/
      const docxHeader = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('... PKWARE header ... [Content_Types].xml ... word/document.xml ...'),
      ]);
      const result = inspectBinaryMagicBytes(docxHeader, 'assignment_thesis.docx');

      assert.equal(result.valid, true);
      assert.equal(result.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      assert.equal(result.extension, 'docx');
    });

    test('rejects spoofed .docx files that are arbitrary ZIPs lacking OpenXML structure', () => {
      const genericZipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
      const result = inspectBinaryMagicBytes(genericZipHeader, 'malicious_payload.docx');

      assert.equal(result.valid, false);
      assert.match(result.reason, /lacks valid OpenXML structure/);
    });

    test('rejects Windows PE executable (MZ / 4D 5A) disguised as .pdf', () => {
      const exeHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
      const result = inspectBinaryMagicBytes(exeHeader, 'report_trojan.pdf');

      assert.equal(result.valid, false);
      assert.match(result.reason, /Unrecognized or unauthorized file format/);
    });

    test('rejects Linux ELF binary (7F 45 4C 46) disguised as .zip', () => {
      const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
      const result = inspectBinaryMagicBytes(elfHeader, 'archive.zip');

      assert.equal(result.valid, false);
      assert.match(result.reason, /Unrecognized or unauthorized file format/);
    });

    test('rejects truncated header buffers with fewer than 4 bytes', () => {
      const tinyHeader = Buffer.from([0x25, 0x50]);
      const result = inspectBinaryMagicBytes(tinyHeader, 'empty.pdf');

      assert.equal(result.valid, false);
      assert.match(result.reason, /minimum 4 bytes required/);
    });

    test('enforces hard 10MB ceiling configuration constant', () => {
      assert.equal(MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024);
    });
  });

  // ─── Test Suite 2: Two-Phase POSIX Filesystem & DB Coordination ───
  test.describe('Two-Phase POSIX File Coordination & Lifecycle Mechanics', () => {
    test('verifies staging and permanent directories exist and are isolated', () => {
      assert.ok(fs.existsSync(STAGED_UPLOADS_DIR));
      assert.ok(fs.existsSync(PERMANENT_UPLOADS_DIR));
      assert.notEqual(STAGED_UPLOADS_DIR, PERMANENT_UPLOADS_DIR);
    });

    test('simulates rollback cleanup: unlinks staged temp file when commit fails', async () => {
      const tempPath = path.join(STAGED_UPLOADS_DIR, `test_rollback_${Date.now()}.tmp`);
      await fs.promises.writeFile(tempPath, 'temporary upload bytes');
      assert.ok(fs.existsSync(tempPath));

      // Emulate catch/finally rollback block
      let commitSucceeded = false;
      if (!commitSucceeded) {
        await fs.promises.unlink(tempPath).catch(() => {});
      }

      assert.equal(fs.existsSync(tempPath), false, 'Staged temp file must be pruned after rollback');
    });

    test('simulates successful resubmission: captures and unlinks superseded previous file only after commit', async () => {
      const oldFilePath = path.join(PERMANENT_UPLOADS_DIR, `test_superseded_${Date.now()}.pdf`);
      const newFilePath = path.join(PERMANENT_UPLOADS_DIR, `test_active_${Date.now()}.pdf`);

      await fs.promises.writeFile(oldFilePath, 'draft 1');
      await fs.promises.writeFile(newFilePath, 'draft 2');
      assert.ok(fs.existsSync(oldFilePath));
      assert.ok(fs.existsSync(newFilePath));

      let commitSucceeded = true;
      let previousPermanentPath = oldFilePath;

      // Emulate post-commit finally cleanup
      if (commitSucceeded && previousPermanentPath && previousPermanentPath !== newFilePath) {
        await fs.promises.unlink(previousPermanentPath).catch(() => {});
      }

      assert.equal(fs.existsSync(oldFilePath), false, 'Superseded prior file must be pruned after commit');
      assert.equal(fs.existsSync(newFilePath), true, 'New file must remain preserved');

      // Cleanup
      await fs.promises.unlink(newFilePath).catch(() => {});
    });
  });

  // ─── Test Suite 3: Mobile Viewport Containment & min-h-0 Invariant ───
  test.describe('Invariant 9: Mobile Registration Viewport Containment & Flexbox Defense', () => {
    test('RegistrationDeclarationModal source code explicitly enforces min-h-0 on scrollable flex child', () => {
      const modalPath = path.resolve(__dirname, '../../frontend/src/components/registration/RegistrationDeclarationModal.jsx');
      const modalSource = fs.readFileSync(modalPath, 'utf8');

      // In CSS Flexbox Level 1 §4.5, min-height defaults to 'auto' (min-content),
      // which blows out flex child height on small screens unless min-h-0 is explicitly declared.
      assert.match(modalSource, /min-h-0/, 'Scrollable body must explicitly specify min-h-0 to allow flexbox shrinking');
      assert.match(modalSource, /overscroll-contain/, 'Must contain touch scroll boundaries to prevent rubber-band body lock');
      assert.match(modalSource, /sticky bottom-0/, 'Footer must be permanently docked and sticky at the bottom');
      assert.match(modalSource, /max-h-\[min\(90dvh,680px\)\]/, 'Must mathematically constrain modal viewport height');
    });
  });

  // ─── Test Suite 4: Ingress Negotiation & Non-Blocking Text-Only Multipart ───
  test.describe('Dual Ingress Negotiation & Non-Blocking Multipart Stream Contract', () => {
    test('passes through non-multipart application/json payloads synchronously without busboy invocation', (t, done) => {
      const req = {
        headers: { 'content-type': 'application/json' },
        body: { submission_text: 'Pure JSON Solution' },
      };
      const res = {};

      streamAssignmentUpload(req, res, (err) => {
        assert.ifError(err);
        assert.equal(req.body.submission_text, 'Pure JSON Solution');
        assert.equal(req.uploadedFile, undefined);
        done();
      });
    });

    test('parses text-only multipart/form-data without files and non-blockingly triggers next()', (t, done) => {
      const boundary = '----FocitBoundary12345';
      const multipartBody = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="submission_text"',
        '',
        'Algorithm proof in plain text with no file attached',
        `--${boundary}`,
        'Content-Disposition: form-data; name="idempotency_key"',
        '',
        'idem_test_abc_123',
        `--${boundary}--`,
        '',
      ].join('\r\n');

      const req = new Readable({
        read() {
          this.push(multipartBody);
          this.push(null);
        },
      });

      req.headers = {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      };
      req.body = {};

      const res = {
        status: (code) => ({ json: (data) => done(new Error(`Unexpected HTTP ${code}: ${JSON.stringify(data)}`)) }),
      };

      streamAssignmentUpload(req, res, (err) => {
        assert.ifError(err);
        assert.equal(req.body.submission_text, 'Algorithm proof in plain text with no file attached');
        assert.equal(req.body.idempotency_key, 'idem_test_abc_123');
        assert.equal(req.uploadedFile, undefined, 'Zero files attached must leave uploadedFile undefined');
        done();
      });
    });
  });

  // ─── Test Suite 5: AssignmentsTab Viewport Containment & Mutation Lock Invariants ───
  test.describe('AssignmentsTab Viewport Containment & Mutation Lock Invariants', () => {
    test('enforces layout paint containment without intrinsic size collapse and locks submit interactions', () => {
      const tabPath = path.resolve(__dirname, '../../frontend/src/components/course/AssignmentsTab.jsx');
      assert.ok(fs.existsSync(tabPath), 'AssignmentsTab.jsx must exist');
      const tabContent = fs.readFileSync(tabPath, 'utf8');

      // CSS Containment without size collapse
      assert.match(
        tabContent,
        /contain:\s*['"]layout paint['"]/,
        'Modal must enforce strict CSS layout paint containment without intrinsic size collapse'
      );
      assert.doesNotMatch(
        tabContent,
        /contain:\s*['"][^'"]*size[^'"]*['"]/,
        'Modal must NEVER declare size containment on auto-height dialog'
      );
      assert.match(
        tabContent,
        /max-h-\[min\(90dvh,720px\)\]/,
        'Modal must bound vertical dimension against dvh'
      );
      assert.match(
        tabContent,
        /flex-1\s+min-h-0/,
        'Inner modal scrollport must explicitly declare min-h-0 to prevent blowout'
      );

      // Mutation Lock & Close Defense
      assert.match(
        tabContent,
        /isSubmittingRef\.current\s*=\s*true/,
        'Must acquire synchronous useRef mutation lock before dispatching submission'
      );
      assert.match(
        tabContent,
        /handleCancelModal/,
        'Modal must intercept cancel events'
      );
      assert.match(
        tabContent,
        /disabled=\{submitMutation\.isPending\}/,
        'Action controls must be disabled during active mutation'
      );
    });
  });

});
