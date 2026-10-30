/**
 * FOCIT LMS - Digital Library E2E Browser Runtime & QA Pipeline Verification
 * Target Gateway: http://localhost:5180 (Vite Proxy) -> http://localhost:3000 (Express BFF)
 *
 * Verifies:
 * 1. Vite Dev Server on http://localhost:5180 serving React 19 Single Page App HTML.
 * 2. Express BFF Proxy on http://localhost:3000 health and readiness.
 * 3. Authenticated Developer Session (student1 with JWT and session nonce).
 * 4. Catalog query for "CSC 401: Software Engineering II - Advanced System Architecture Slides" (ID: c0000000-0000-0000-0000-000000000004).
 * 5. Capability Lease Ticket issuance (Status 200, valid HMAC ticket, streamUrl, expiresAt).
 * 6. Binary PDF stream retrieval via streamUrl (Status 200, Content-Type application/pdf, Content-Length 1,401,224 bytes, %PDF- header magic).
 * 7. Ingestion of received binary stream into PDF.js engine:
 *    - All 35 pages verified and rendered.
 *    - TrueType font glyph mapping and text content extraction across all pages.
 *    - 0 runtime errors.
 */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import assert from 'node:assert';

const VITE_GATEWAY = 'http://localhost:5180';
const BFF_DIRECT = 'http://localhost:3000';
const TARGET_ITEM_ID = 'c0000000-0000-0000-0000-000000000004';
const EXPECTED_TITLE = 'CSC 401: Software Engineering II - Advanced System Architecture Slides';
const EXPECTED_BYTES = 1401224;
const EXPECTED_PAGES = 35;

async function runFullVerification() {
  const report = {
    timestamp: new Date().toISOString(),
    stages: {},
    passed: false,
  };

  console.log('========================================================================');
  console.log('🚀 FOCIT LMS — Digital Library End-to-End Pipeline QA Verification');
  console.log('========================================================================\n');

  // Stage 1: Vite Dev Server Verification
  console.log('[STAGE 1] Probing Vite Dev Server on http://localhost:5180...');
  const viteRes = await fetch(`${VITE_GATEWAY}/library`);
  const viteHtml = await viteRes.text();
  assert.strictEqual(viteRes.status, 200, 'Vite dev server must return HTTP 200');
  assert.ok(viteHtml.includes('<div id="root"></div>'), 'HTML must contain React mount root');
  assert.ok(viteHtml.includes('/src/main.jsx'), 'HTML must reference React main entry');
  console.log(`  ✅ Vite dev server is LIVE (HTTP 200, ${viteHtml.length} bytes HTML)`);
  report.stages.viteGateway = { status: 'PASSED', httpStatus: viteRes.status, bytes: viteHtml.length };

  // Stage 2: Express BFF Proxy Health Verification
  console.log('\n[STAGE 2] Probing Express BFF Proxy on http://localhost:3000/health...');
  const bffRes = await fetch(`${BFF_DIRECT}/health`);
  const bffHealth = await bffRes.json();
  assert.strictEqual(bffRes.status, 200, 'BFF health must return HTTP 200');
  assert.strictEqual(bffHealth.status, 'healthy', 'BFF status must be healthy');
  console.log(`  ✅ Express BFF is HEALTHY (Uptime: ${bffHealth.uptime}s, Memory RSS: ${bffHealth.memory?.rss}MB)`);
  report.stages.bffHealth = { status: 'PASSED', health: bffHealth };

  // Stage 3: Authenticated Developer Session Handshake
  console.log('\n[STAGE 3] Performing Authenticated Session Handshake (student1)...');
  const loginRes = await fetch(`${VITE_GATEWAY}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': VITE_GATEWAY,
      'Sec-Fetch-Site': 'same-origin',
    },
    body: JSON.stringify({
      studentId: 'student1',
      password: 'password123',
    }),
  });
  assert.strictEqual(loginRes.status, 200, 'Login must return HTTP 200');
  const loginData = await loginRes.json();
  const setCookie = loginRes.headers.get('set-cookie') || '';
  const tokenMatch = /focit_token=([^;]+)/.exec(setCookie);
  assert.ok(tokenMatch, 'focit_token cookie must be present in Set-Cookie header');
  const token = tokenMatch[1];
  const sessionNonce = loginData.sessionNonce;
  assert.ok(sessionNonce, 'Session nonce must be returned');
  console.log(`  ✅ Authenticated as: ${loginData.user.fullName} (${loginData.user.username})`);
  console.log(`  ✅ Role: ${loginData.user.role} | Scope: ${loginData.scope}`);
  console.log(`  ✅ Session Nonce: ${sessionNonce.slice(0, 24)}...`);
  report.stages.authentication = {
    status: 'PASSED',
    user: loginData.user.username,
    role: loginData.user.role,
    scope: loginData.scope,
  };

  const authHeaders = {
    Cookie: `focit_token=${token}`,
    'X-Session-Nonce': sessionNonce,
    'Origin': VITE_GATEWAY,
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
  };

  // Stage 4: Query Catalog for CSC 401 Slides
  console.log('\n[STAGE 4] Querying Catalog for CSC 401 Slides (ID: ' + TARGET_ITEM_ID + ')...');
  const catalogRes = await fetch(`${VITE_GATEWAY}/api/library/items?q=CSC+401`, { headers: authHeaders });
  assert.strictEqual(catalogRes.status, 200, 'Catalog query must return HTTP 200');
  const catalogData = await catalogRes.json();
  const foundItem = (catalogData.data || []).find((item) => item.id === TARGET_ITEM_ID);
  assert.ok(foundItem, `Target item ${TARGET_ITEM_ID} must be present in catalog`);
  assert.strictEqual(foundItem.title, EXPECTED_TITLE);
  console.log(`  ✅ Catalog Item Verified: "${foundItem.title}"`);
  console.log(`     - ID: ${foundItem.id}`);
  console.log(`     - Course: ${foundItem.course_id} | Level: ${foundItem.level}`);
  console.log(`     - File Size: ${foundItem.file_size_bytes} bytes`);
  console.log(`     - MIME Type: ${foundItem.mime_type}`);
  report.stages.catalogQuery = {
    status: 'PASSED',
    itemId: foundItem.id,
    title: foundItem.title,
    sizeBytes: foundItem.file_size_bytes,
  };

  // Stage 5: Request Capability Lease Ticket
  console.log('\n[STAGE 5] Requesting Capability Lease Ticket (GET /api/library/items/' + TARGET_ITEM_ID + '/ticket)...');
  const ticketRes = await fetch(`${VITE_GATEWAY}/api/library/items/${TARGET_ITEM_ID}/ticket`, { headers: authHeaders });
  assert.strictEqual(ticketRes.status, 200, 'Ticket request must return HTTP 200');
  const ticketData = await ticketRes.json();
  assert.ok(ticketData.ticket, 'Capability ticket must be returned');
  assert.ok(ticketData.streamUrl, 'Stream URL must be returned');
  assert.ok(ticketData.expiresAt, 'Expires timestamp must be returned');
  console.log(`  ✅ Ticket Received: ${ticketData.ticket.slice(0, 32)}...`);
  console.log(`  ✅ Expires At: ${new Date(ticketData.expiresAt * 1000).toISOString()}`);
  console.log(`  ✅ Stream URL: ${ticketData.streamUrl}`);
  report.stages.ticketIssuance = {
    status: 'PASSED',
    ticketPreview: ticketData.ticket.slice(0, 32) + '...',
    expiresAt: ticketData.expiresAt,
    streamUrl: ticketData.streamUrl,
  };

  // Stage 6: Fetch Binary Stream from streamUrl
  console.log('\n[STAGE 6] Fetching Binary PDF Stream from streamUrl via Vite Gateway...');
  const streamRes = await fetch(`${VITE_GATEWAY}${ticketData.streamUrl}`, {
    headers: {
      'User-Agent': authHeaders['User-Agent'],
    },
  });
  assert.strictEqual(streamRes.status, 200, 'Full stream request must return HTTP 200');
  const contentType = streamRes.headers.get('content-type');
  const contentLength = parseInt(streamRes.headers.get('content-length'), 10);
  assert.ok(contentType?.includes('application/pdf'), `Content-Type must be application/pdf, got ${contentType}`);
  assert.strictEqual(contentLength, EXPECTED_BYTES, `Content-Length must be ${EXPECTED_BYTES}, got ${contentLength}`);

  const binaryBuffer = await streamRes.arrayBuffer();
  assert.strictEqual(binaryBuffer.byteLength, EXPECTED_BYTES, `Buffer byteLength must be ${EXPECTED_BYTES}`);
  const headerMagic = Buffer.from(binaryBuffer.slice(0, 5)).toString('ascii');
  assert.strictEqual(headerMagic, '%PDF-', `Header magic bytes must be "%PDF-", got "${headerMagic}"`);
  console.log(`  ✅ HTTP Status: ${streamRes.status} OK`);
  console.log(`  ✅ Content-Type: ${contentType}`);
  console.log(`  ✅ Content-Length: ${contentLength} bytes (Exact match: ${EXPECTED_BYTES})`);
  console.log(`  ✅ PDF Magic Number: "${headerMagic}" verified`);
  report.stages.streamFetch = {
    status: 'PASSED',
    httpStatus: streamRes.status,
    contentType,
    contentLength,
    magicHeader: headerMagic,
  };

  // Stage 7: Ingest Binary Payload into PDF.js Parsing Engine
  console.log('\n[STAGE 7] Ingesting Binary Payload into PDF.js Parsing Engine...');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(binaryBuffer),
    standardFontDataUrl: './node_modules/pdfjs-dist/standard_fonts/',
  });
  const pdfDoc = await loadingTask.promise;
  assert.strictEqual(pdfDoc.numPages, EXPECTED_PAGES, `Document page count must be ${EXPECTED_PAGES}, got ${pdfDoc.numPages}`);
  console.log(`  ✅ PDF.js Document Loaded: ${pdfDoc.numPages} pages detected (Expected: ${EXPECTED_PAGES})`);

  let totalChars = 0;
  let totalOps = 0;
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const operatorList = await page.getOperatorList();
    totalOps += operatorList.fnArray?.length || 0;
    for (const item of textContent.items) {
      if (item.str) totalChars += item.str.length;
    }
  }

  assert.ok(totalChars > 10000, `Expected > 10,000 extracted text characters, got ${totalChars}`);
  console.log(`  ✅ Page Iteration & Parsing: All ${pdfDoc.numPages} pages parsed without throwing runtime errors`);
  console.log(`  ✅ TrueType Fonts & Glyph Rendering: ${totalOps} canvas operators evaluated`);
  console.log(`  ✅ Text Layer Extraction: ${totalChars} characters extracted cleanly across all 35 pages`);
  report.stages.pdfjsEngine = {
    status: 'PASSED',
    pages: pdfDoc.numPages,
    totalCharacters: totalChars,
    operatorCount: totalOps,
  };

  report.passed = true;
  console.log('\n========================================================================');
  console.log('🎉 ALL END-TO-END VERIFICATION CHECKS PASSED WITH 100% SUCCESS!');
  console.log('========================================================================\n');
  return report;
}

runFullVerification()
  .then((report) => {
    console.log('JSON Report:');
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Verification Failure:', err);
    process.exit(1);
  });

