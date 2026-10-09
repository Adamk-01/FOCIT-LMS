/**
 * Mock Moodle Web Services Server
 *
 * Mimics Moodle's REST Web Services API for local development.
 * Supports:
 * - core_course_get_contents: Returns course sections/modules/files
 * - pluginfile.php: Serves sample PDF files with Range request support
 *
 * This server returns the EXACT JSON shape that real Moodle returns,
 * so the BFF code works identically against mock and production Moodle.
 */

import express from 'express';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { courses } from './data/courses.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.MOCK_MOODLE_PORT || 3001;

const app = express();

// ─── Static Files for End-to-End PDF Testing ──────────────
// Serves local PDFs to test the BFF QuotaGuard transform
const staticDir = path.join(__dirname, '../../200level first semester');
app.use('/static', express.static(staticDir));


// ─── Web Services API ────────────────────────────────────────
// Moodle's REST API serves everything through a single endpoint:
// GET /webservice/rest/server.php?wstoken=...&wsfunction=...&moodlewsrestformat=json

app.get('/webservice/rest/server.php', (req, res) => {
  const { wstoken, wsfunction, moodlewsrestformat } = req.query;

  // Validate token (mock validation)
  if (!wstoken) {
    return res.json({
      exception: 'moodle_exception',
      errorcode: 'invalidtoken',
      message: 'Invalid token - token not found',
    });
  }

  // Route to the appropriate function handler
  switch (wsfunction) {
    case 'core_course_get_contents':
      return handleGetCourseContents(req, res);

    case 'core_completion_override_activity_completion_status':
      return handleOverrideCompletion(req, res);

    default:
      return res.json({
        exception: 'moodle_exception',
        errorcode: 'invalidfunction',
        message: `Invalid function - function "${wsfunction}" not found`,
      });
  }
});

/**
 * Handler: core_course_get_contents
 * Returns sections, modules, and file metadata for a course.
 */
function handleGetCourseContents(req, res) {
  const courseId = parseInt(req.query.courseid, 10);

  if (!courseId || !courses[courseId]) {
    return res.json({
      exception: 'moodle_exception',
      errorcode: 'invalidcourseid',
      message: `Invalid course ID: ${courseId}`,
    });
  }

  // Simulate network latency (50–200ms)
  const delay = 50 + Math.random() * 150;
  setTimeout(() => {
    res.json(courses[courseId]);
  }, delay);
}

/**
 * Handler: core_completion_override_activity_completion_status
 * Accepts userid, cmid, and newstate. Logs the completion override.
 */
function handleOverrideCompletion(req, res) {
  const { userid, cmid, newstate } = req.query;

  if (!userid || !cmid || newstate === undefined) {
    return res.json({
      exception: 'moodle_exception',
      errorcode: 'invalidparameter',
      message: 'Missing required parameters: userid, cmid, newstate',
    });
  }

  console.log(
    `[MOCK MOODLE] Completion override: user=${userid} cmid=${cmid} state=${newstate}`
  );

  // Simulate success response
  res.json({ status: true });
}

// ─── File Serving (pluginfile.php) ───────────────────────────
// Moodle serves files through /pluginfile.php/contextid/component/...
// Our mock serves sample PDFs from the local data/sample-files directory.

const SAMPLE_FILES_DIR = path.join(__dirname, 'data', 'sample-files');

app.get('/pluginfile.php/:moduleId/:filename', (req, res) => {
  const { moduleId, filename } = req.params;
  const decodedFilename = decodeURIComponent(filename);

  // Look for a real sample file first
  const filePath = path.join(SAMPLE_FILES_DIR, decodedFilename);

  let targetPath;
  let fileSize;

  if (existsSync(filePath)) {
    targetPath = filePath;
    fileSize = statSync(filePath).size;
  } else {
    // Generate a placeholder PDF if the sample file doesn't exist
    targetPath = getOrCreatePlaceholderPDF(decodedFilename);
    fileSize = statSync(targetPath).size;
  }

  // Set common headers
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', `"mock-${moduleId}-${Buffer.from(decodedFilename).toString('base64').slice(0, 16)}"`);
  res.setHeader('Last-Modified', new Date('2025-09-01').toUTCString());
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${decodedFilename}"`
  );

  // Handle Range requests
  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] !== '' ? parseInt(match[2], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        return res.status(416)
          .setHeader('Content-Range', `bytes */${fileSize}`)
          .end();
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);

      const stream = createReadStream(targetPath, { start, end });
      stream.pipe(res);
      return;
    }
  }

  // Full file response
  res.setHeader('Content-Length', fileSize);
  const stream = createReadStream(targetPath);
  stream.pipe(res);
});

// HEAD requests — PDF.js sends HEAD to probe Content-Length
app.head('/pluginfile.php/:moduleId/:filename', (req, res) => {
  const { filename } = req.params;
  const decodedFilename = decodeURIComponent(filename);
  const filePath = path.join(SAMPLE_FILES_DIR, decodedFilename);

  let fileSize;
  if (existsSync(filePath)) {
    fileSize = statSync(filePath).size;
  } else {
    const placeholder = getOrCreatePlaceholderPDF(decodedFilename);
    fileSize = statSync(placeholder).size;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', fileSize);
  res.setHeader('Accept-Ranges', 'bytes');
  res.end();
});

/**
 * Generate a minimal valid PDF placeholder file.
 * This creates a real PDF that PDF.js can render, not just random bytes.
 *
 * @param {string} filename
 * @returns {string} Path to the generated PDF
 */
function getOrCreatePlaceholderPDF(filename) {
  mkdirSync(SAMPLE_FILES_DIR, { recursive: true });

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const placeholderPath = path.join(SAMPLE_FILES_DIR, `_placeholder_${safeName}`);

  if (existsSync(placeholderPath)) {
    return placeholderPath;
  }

  // Generate a minimal valid PDF with the filename as content
  const title = filename.replace('.pdf', '').replace(/_/g, ' ');
  const pdfContent = generateMinimalPDF(title);
  writeFileSync(placeholderPath, pdfContent);

  console.log(`[MOCK MOODLE] Generated placeholder PDF: ${placeholderPath}`);
  return placeholderPath;
}

/**
 * Generate a minimal but valid PDF document.
 * This is a hand-crafted PDF that PDF.js can render properly.
 *
 * @param {string} title
 * @returns {Buffer}
 */
function generateMinimalPDF(title) {
  // Truncate title for safety
  const safeTitle = title.slice(0, 80);

  const objects = [];
  const offsets = [];

  // PDF Header
  let pdf = '%PDF-1.4\n%\xC3\xA4\xC3\xBC\xC3\xB6\xC3\x9F\n';

  // Object 1: Catalog
  offsets.push(pdf.length);
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  pdf += objects[objects.length - 1];

  // Object 2: Pages
  offsets.push(pdf.length);
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  pdf += objects[objects.length - 1];

  // Object 3: Page
  offsets.push(pdf.length);
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n'
  );
  pdf += objects[objects.length - 1];

  // Object 4: Content Stream
  const stream =
    `BT\n/F1 24 Tf\n50 700 Td\n(${safeTitle}) Tj\n` +
    `/F1 14 Tf\n50 660 Td\n(FOCIT LMS - Course Material) Tj\n` +
    `/F1 12 Tf\n50 620 Td\n(This is a placeholder document for development.) Tj\n` +
    `50 590 Td\n(In production, this will be the actual lecture material) Tj\n` +
    `50 560 Td\n(uploaded by the lecturer through Moodle.) Tj\nET\n`;

  offsets.push(pdf.length);
  objects.push(
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`
  );
  pdf += objects[objects.length - 1];

  // Object 5: Font
  offsets.push(pdf.length);
  objects.push(
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  );
  pdf += objects[objects.length - 1];

  // Cross-reference table
  const xrefOffset = pdf.length;
  pdf += 'xref\n';
  pdf += `0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  // Trailer
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

// ─── Start Server ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ┌──────────────────────────────────────────┐`);
  console.log(`  │  Mock Moodle Server                      │`);
  console.log(`  │  http://localhost:${PORT}                  │`);
  console.log(`  │  Courses: ${Object.keys(courses).length} loaded                       │`);
  console.log(`  └──────────────────────────────────────────┘\n`);
});
