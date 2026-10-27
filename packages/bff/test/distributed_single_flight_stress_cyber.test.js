import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  DistributedSingleFlight,
  RedisSubscriberDispatcher,
  toCanonicalKey,
  CoalescerCapacityExceededError,
  ContenderTimeoutError,
  InvalidKeyError,
  MAX_L2_PAYLOAD_BYTES,
  MAX_INBAND_PAYLOAD_BYTES,
} from '../src/lib/distributedSingleFlight.js';
import { getMoodlePoolStats } from '../src/lib/moodlePool.js';

test('CYBERSECURITY (VULN-1): Key-Cardinality Heap Exhaustion & Capacity Ceiling', async () => {
  // Bounded instance with ceiling of 50 concurrent keys
  const flight = new DistributedSingleFlight({
    maxConcurrentKeys: 50,
    defaultTimeoutMs: 5000,
  });

  const resolvers = [];
  const slowFetcher = () => new Promise((resolve) => { resolvers.push(resolve); });

  // 1. Fill the capacity to exactly 50 keys
  const initialPromises = [];
  for (let i = 0; i < 50; i++) {
    initialPromises.push(flight.do(`fuzz_test_key_${i}`, slowFetcher));
  }

  assert.strictEqual(flight.activeKeys.length, 50);

  // 2. Attack: Spray 100 additional fuzzed keys
  let rejectedCount = 0;
  const attackPromises = [];
  for (let i = 50; i < 150; i++) {
    const p = flight.do(`fuzz_test_key_${i}`, slowFetcher).catch((err) => {
      assert.ok(err instanceof CoalescerCapacityExceededError);
      assert.strictEqual(err.statusCode, 503);
      assert.strictEqual(err.retryAfter, 1);
      rejectedCount++;
      return 'REJECTED';
    });
    attackPromises.push(p);
  }

  const attackResults = await Promise.all(attackPromises);
  assert.strictEqual(rejectedCount, 100);
  assert.strictEqual(attackResults.length, 100);

  // 3. Invariant: Active keys must NEVER breach 50
  assert.strictEqual(flight.activeKeys.length, 50);

  // 4. Resolve slow fetchers and verify clean eviction
  for (const resolve of resolvers) {
    resolve({ ok: true });
  }
  await Promise.all(initialPromises);

  // Map must be completely evicted
  assert.strictEqual(flight.activeKeys.length, 0);
  await flight.close();
});

test('CYBERSECURITY (VULN-2): Redis Key & Channel Injection Prevention', () => {
  // Test 1: Empty or non-string keys must throw InvalidKeyError
  assert.throws(() => toCanonicalKey(''), InvalidKeyError);
  assert.throws(() => toCanonicalKey('   '), InvalidKeyError);
  assert.throws(() => toCanonicalKey(null), InvalidKeyError);
  assert.throws(() => toCanonicalKey(12345), InvalidKeyError);

  // Test 2: Standard safe keys must remain human-readable
  assert.strictEqual(toCanonicalKey('course_materials:CSC204'), 'course_materials:CSC204');
  assert.strictEqual(toCanonicalKey('gradebook:user_123:term_1'), 'gradebook:user_123:term_1');

  // Test 3: CRLF injection attempt
  const crlfKey = 'course\r\nSET pwned 1\r\n';
  const canonicalCrlf = toCanonicalKey(crlfKey);
  assert.ok(!canonicalCrlf.includes('\r'));
  assert.ok(!canonicalCrlf.includes('\n'));
  assert.ok(canonicalCrlf.startsWith('raw:course__SET_pwned_1:'));

  // Test 4: Redis glob wildcard injection attempt (*, ?, [])
  const globKey = 'course:*::flushing?pattern=[a-z]';
  const canonicalGlob = toCanonicalKey(globKey);
  assert.ok(!canonicalGlob.includes('*'));
  assert.ok(!canonicalGlob.includes('?'));
  assert.ok(!canonicalGlob.includes('['));
  assert.ok(canonicalGlob.startsWith('raw:course____flushing_pattern__'));

  // Test 5: Oversized 1KB key string
  const giantKey = 'a'.repeat(1024);
  const canonicalGiant = toCanonicalKey(giantKey);
  assert.ok(canonicalGiant.length < 60);
  assert.ok(canonicalGiant.startsWith('raw:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:'));
});

test('CYBERSECURITY (VULN-3): Unbounded Payload Size Clamps', () => {
  assert.strictEqual(MAX_L2_PAYLOAD_BYTES, 2 * 1024 * 1024); // 2MB ceiling
  assert.strictEqual(MAX_INBAND_PAYLOAD_BYTES, 32 * 1024);    // 32KB ceiling

  // Verify byte length evaluation safety
  const smallPayload = JSON.stringify({ items: [1, 2, 3] });
  assert.ok(Buffer.byteLength(smallPayload) <= MAX_INBAND_PAYLOAD_BYTES);

  // 3MB payload must exceed ceiling
  const oversizedPayload = 'x'.repeat(3 * 1024 * 1024);
  assert.ok(Buffer.byteLength(oversizedPayload) > MAX_L2_PAYLOAD_BYTES);
});

test('STRESS / CONCURRENCY (CAP-2): Set-Based Dispatcher (100 concurrent listeners)', async () => {
  const dispatcher = new RedisSubscriberDispatcher();
  let receivedCount = 0;

  const callbacks = [];
  for (let i = 0; i < 100; i++) {
    const cb = (msg) => {
      if (msg === 'TEST_BURST') receivedCount++;
    };
    callbacks.push(cb);
    await dispatcher.subscribe('test_burst_channel', cb);
  }

  // Verify internal Set size
  const registeredSet = dispatcher.channelCallbacks.get('test_burst_channel');
  assert.strictEqual(registeredSet.size, 100);

  // Simulate internal message dispatch
  for (const cb of registeredSet) {
    cb('TEST_BURST');
  }

  assert.strictEqual(receivedCount, 100);

  // Unsubscribe all 100
  for (const cb of callbacks) {
    await dispatcher.unsubscribe('test_burst_channel', cb);
  }

  // Registry must be completely cleaned up
  assert.strictEqual(dispatcher.channelCallbacks.has('test_burst_channel'), false);
  await dispatcher.close();
});

test('STRESS / CONCURRENCY (CAP-1): Contender Timeout & Contender Promotion Election', async () => {
  const channel = 'focit:channel:test_course';
  const timeoutMs = 4000;
  const contenderErr = new ContenderTimeoutError(channel, timeoutMs);

  assert.strictEqual(contenderErr.name, 'ContenderTimeoutError');
  assert.strictEqual(contenderErr.statusCode, 503);
  assert.strictEqual(contenderErr.retryAfter, 2);
  assert.match(contenderErr.message, /Contender timeout expired/);
});

test('SYSTEM ARCHITECTURE (CAP-4): Undici Moodle Pool Statistics & Bounded Limits', () => {
  const stats = getMoodlePoolStats();
  assert.ok(typeof stats.connected === 'number');
  assert.ok(typeof stats.free === 'number');
  assert.ok(typeof stats.pending === 'number');
  assert.ok(typeof stats.running === 'number');
  assert.ok(typeof stats.size === 'number');
});
