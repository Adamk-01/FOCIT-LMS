import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  generateEdgeTicket,
  verifyEdgeTicket,
  normalizeClientSubnet,
  computeClientFingerprint,
} from '../src/services/edgeTicketService.js';

test('CYBERSECURITY (PHASE 13D): Ticket Generation & Tamper Resistance', () => {
  const studentId = 'student_001';
  const itemId = crypto.randomUUID();
  const clientIp = '197.210.45.12';
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0';

  // 1. Generate valid capability ticket
  const ticketData = generateEdgeTicket(studentId, itemId, clientIp, userAgent, 1800);
  assert.ok(ticketData.ticket);
  assert.ok(ticketData.ticket.includes('.'));
  assert.ok(ticketData.expiresAt > Math.floor(Date.now() / 1000));
  assert.strictEqual(ticketData.streamUrl, `/api/library/items/${itemId}/stream?ticket=${ticketData.ticket}`);

  // 2. Verify valid ticket succeeds
  const verified = verifyEdgeTicket(ticketData.ticket, itemId, clientIp, userAgent, true);
  assert.strictEqual(verified.valid, true);
  assert.strictEqual(verified.payload.iid, itemId);
  assert.strictEqual(verified.payload.sub, studentId);

  // 3. Attack: Tamper with ticket payload (flip a byte)
  const [b64Payload, sig] = ticketData.ticket.split('.');
  const decodedStr = Buffer.from(b64Payload, 'base64url').toString('utf8');
  const tamperedPayload = decodedStr.replace(studentId, 'student_attacker');
  const tamperedB64 = Buffer.from(tamperedPayload).toString('base64url');
  const tamperedTicket = `${tamperedB64}.${sig}`;

  const tamperedResult = verifyEdgeTicket(tamperedTicket, itemId, clientIp, userAgent, false);
  assert.strictEqual(tamperedResult.valid, false);
  assert.strictEqual(tamperedResult.reason, 'INVALID_SIGNATURE');

  // 4. Attack: Forged signature
  const forgedTicket = `${b64Payload}.forged_fake_signature_bytes`;
  const forgedResult = verifyEdgeTicket(forgedTicket, itemId, clientIp, userAgent, false);
  assert.strictEqual(forgedResult.valid, false);
  assert.strictEqual(forgedResult.reason, 'INVALID_SIGNATURE');

  // 4b. Attack (Trap 3): Truncated signature byteLength mismatch (Must NOT throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH)
  const truncatedTicket = `${b64Payload}.short`;
  assert.doesNotThrow(() => {
    const truncatedResult = verifyEdgeTicket(truncatedTicket, itemId, clientIp, userAgent, false);
    assert.strictEqual(truncatedResult.valid, false);
    assert.strictEqual(truncatedResult.reason, 'INVALID_SIGNATURE');
  });

  // 4c. Attack (Trap 3): Oversized signature byteLength mismatch
  const oversizedTicket = `${b64Payload}.${'x'.repeat(128)}`;
  assert.doesNotThrow(() => {
    const oversizedResult = verifyEdgeTicket(oversizedTicket, itemId, clientIp, userAgent, false);
    assert.strictEqual(oversizedResult.valid, false);
    assert.strictEqual(oversizedResult.reason, 'INVALID_SIGNATURE');
  });

  // 5. Attack: Resource Item ID Mismatch (using ticket for Item A to fetch Item B)
  const anotherItemId = crypto.randomUUID();
  const mismatchResult = verifyEdgeTicket(ticketData.ticket, anotherItemId, clientIp, userAgent, false);
  assert.strictEqual(mismatchResult.valid, false);
  assert.strictEqual(mismatchResult.reason, 'ITEM_MISMATCH');
});

test('CYBERSECURITY (PHASE 13D): Expiration Lease Safeguard', () => {
  const studentId = 'student_002';
  const itemId = crypto.randomUUID();
  const clientIp = '10.0.0.1';
  const userAgent = 'Mozilla/5.0';

  // Generate an already-expired ticket (ttl = -10 seconds)
  const expiredTicket = generateEdgeTicket(studentId, itemId, clientIp, userAgent, -10);
  const result = verifyEdgeTicket(expiredTicket.ticket, itemId, clientIp, userAgent, false);

  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.reason, 'EXPIRED');
});

test('MOBILE RESILIENCE: Subnet Tolerance for Cellular Tower Handoffs', () => {
  // Mobile tower switch within same /24 subnet (e.g. 197.210.45.12 -> 197.210.45.89)
  const ip1 = '197.210.45.12';
  const ip2 = '197.210.45.89';
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';

  assert.strictEqual(normalizeClientSubnet(ip1), '197.210.45.0');
  assert.strictEqual(normalizeClientSubnet(ip2), '197.210.45.0');

  const fp1 = computeClientFingerprint(ip1, ua);
  const fp2 = computeClientFingerprint(ip2, ua);
  assert.strictEqual(fp1, fp2, 'Fingerprints must match across cellular handoffs within same /24 subnet');

  // Different carrier network
  const differentIp = '102.89.23.4';
  const fpDifferent = computeClientFingerprint(differentIp, ua);
  assert.notStrictEqual(fp1, fpDifferent);
});

test('PERFORMANCE & STRESS: 200 Tickets Generation & Verification (<1000ms)', () => {
  const studentId = 'bench_student';
  const itemId = crypto.randomUUID();
  const clientIp = '192.168.1.100';
  const userAgent = 'Benchmark-Agent/1.0';

  const startTime = Date.now();
  for (let i = 0; i < 200; i++) {
    const { ticket } = generateEdgeTicket(studentId, itemId, clientIp, userAgent, 1800);
    const result = verifyEdgeTicket(ticket, itemId, clientIp, userAgent, false);
    assert.strictEqual(result.valid, true);
  }
  const elapsedMs = Date.now() - startTime;

  // 200 HMAC ticket operations should complete under 1000ms (typically <80ms)
  assert.ok(elapsedMs < 1000, `Expected 200 tickets in <1000ms, completed in ${elapsedMs}ms`);
});
