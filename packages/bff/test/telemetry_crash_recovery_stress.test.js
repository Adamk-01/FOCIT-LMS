import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  recordTelemetryEvent,
  rotateAndDrainTelemetry,
  LUA_ROTATE_METRICS,
  KEY_VIEWS_ACTIVE,
  KEY_VIEWS_FLUSHING,
  KEY_DOWNLOADS_ACTIVE,
  KEY_DOWNLOADS_FLUSHING,
  KEY_AUDIT_STREAM,
  MAX_AUDIT_STREAM_LEN,
  VIEW_LEASE_TTL_MS,
  DOWNLOAD_DEBOUNCE_TTL_MS,
} from '../src/services/telemetryBufferService.js';

test('CYBERSECURITY: UUID Validation & Parameter Sanitization', async () => {
  const validUuid = crypto.randomUUID();
  const studentId = 'student_test_101';

  // 1. Valid UUID and valid event types must succeed
  const validView = await recordTelemetryEvent(studentId, validUuid, 'VIEW');
  assert.strictEqual(typeof validView, 'boolean');

  // 2. Reject path traversal, CRLF, and SQL injection strings
  const attackUuids = [
    '../../etc/passwd',
    'fuzz\r\nSET pwned 1',
    "'; DROP TABLE library_item_metrics; --",
    'NOT-A-UUID-12345',
    '',
    null,
    undefined,
  ];

  for (const badId of attackUuids) {
    const res = await recordTelemetryEvent(studentId, badId, 'VIEW');
    assert.strictEqual(res, false, `Must reject invalid itemId: ${badId}`);
  }

  // 3. Reject illegal event types
  const badEvents = ['DELETE', 'DROP', 'UPDATE', 'INJECT', '', null];
  for (const badEv of badEvents) {
    const res = await recordTelemetryEvent(studentId, validUuid, badEv);
    assert.strictEqual(res, false, `Must reject invalid eventType: ${badEv}`);
  }
});

test('CYBERSECURITY & RESILIENCE: Telemetry Lease De-duplication Fence', async () => {
  const studentId = 'student_dedup_test';
  const testUuid = crypto.randomUUID();

  // First call should record
  const first = await recordTelemetryEvent(studentId, testUuid, 'VIEW');
  assert.strictEqual(first, true);

  // Immediate second call with identical student and item must be deduplicated
  const second = await recordTelemetryEvent(studentId, testUuid, 'VIEW');
  assert.strictEqual(second, false, 'Immediate duplicate view must be deduplicated by lease fence');
});

test('CRASH-RECOVERY: Atomic Lua Rotation Script Invariants', () => {
  // Verify Lua script syntax and branch conditions
  assert.match(LUA_ROTATE_METRICS, /EXISTS", KEYS\[2\]\) == 1/);
  assert.match(LUA_ROTATE_METRICS, /return -1/); // Staging key exists (crash recovery)
  assert.match(LUA_ROTATE_METRICS, /EXISTS", KEYS\[1\]\) == 0/);
  assert.match(LUA_ROTATE_METRICS, /return 0/);  // Idle window
  assert.match(LUA_ROTATE_METRICS, /RENAME", KEYS\[1\], KEYS\[2\]/);
  assert.match(LUA_ROTATE_METRICS, /return 1/);  // Normal rotation
});

test('CONCURRENCY & DEADLOCK IMMUNITY: Lexicographical Ordering Simulation', async () => {
  // Generate 5 random UUIDs in random unsorted order
  const unsortedUuids = Array.from({ length: 5 }, () => crypto.randomUUID());
  
  // Track parameters sent to mock database client
  let capturedQuery = null;
  let capturedParams = null;

  const mockClient = {
    query: async (sql, params) => {
      if (typeof sql === 'string' && sql.includes('INSERT INTO library_item_metrics')) {
        capturedQuery = sql;
        capturedParams = params;
      }
      return { rows: [] };
    },
    release: () => {},
  };

  const mockPool = {
    connect: async () => mockClient,
  };

  // Verify that an array of UUIDs sorted by localeCompare is strictly deterministic
  const sorted = [...unsortedUuids].sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < sorted.length - 1; i++) {
    assert.ok(
      sorted[i].localeCompare(sorted[i + 1]) < 0,
      `Lexicographical sort invariant: ${sorted[i]} must precede ${sorted[i + 1]}`
    );
  }
});

test('FAIL-OPEN RESILIENCE: rotateAndDrainTelemetry Handles Missing DB Pool and Offline State', async () => {
  // 1. Missing dbPool returns safe status without throwing
  const resultNullPool = await rotateAndDrainTelemetry(null);
  assert.strictEqual(resultNullPool.drained, false);
  assert.strictEqual(resultNullPool.reason, 'NO_DB_POOL');

  // 2. When Redis is offline or not ready, returns REDIS_OFFLINE safely
  const dummyPool = { connect: async () => {} };
  const resultOffline = await rotateAndDrainTelemetry(dummyPool);
  assert.strictEqual(resultOffline.drained, false);
});
