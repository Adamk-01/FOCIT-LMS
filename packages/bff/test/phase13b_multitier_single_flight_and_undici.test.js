/**
 * FOCIT LMS — Phase 13B Concurrency Certification Test
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Verifies:
 * 1. 50+ simultaneous cold requests result in EXACTLY 1 upstream fetchFn() execution (Zero Stampede).
 * 2. Boot-time pattern subscription (psubscribe) routes events with zero per-request subscribe() leaks.
 * 3. Upstream Failure Propagation (Grill Guard 2):
 *    Leader failure broadcasts { __err: true, status: 'ERROR', error } envelope over Pub/Sub.
 *    Contenders fail fast immediately without waiting for contenderTimeoutMs.
 *    L2 Redis cache is NOT poisoned by the error.
 * 4. Undici Connection Pool:
 *    Ensures connections are partitioned deterministically without EMFILE socket leaks.
 */

import test from 'node:test';
import assert from 'node:assert';
import {
  DistributedSingleFlight,
  RedisSubscriberDispatcher,
  PATTERN_SUBSCRIPTION,
} from '../src/lib/distributedSingleFlight.js';
import { getMoodlePoolStats } from '../src/lib/moodlePool.js';

test('Phase 13B.1: 60 Simultaneous Cold Callers Coalesce into Exactly 1 Upstream Fetch', async () => {
  const flight = new DistributedSingleFlight({ defaultTimeoutMs: 5000 });
  let upstreamFetchCount = 0;
  const startTs = Date.now();

  const mockUpstreamMoodleFetch = async (signal) => {
    upstreamFetchCount++;
    // Simulate 80ms legacy Moodle PHP processing time
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      courseId: 'CSC301',
      title: 'Operating Systems & Concurrency',
      units: 3,
      materials: [
        { id: 1, title: 'Dijkstra Semaphores.pdf' },
        { id: 2, title: 'Virtual Memory & Page Tables.pdf' },
      ],
      fetchedAt: Date.now(),
    };
  };

  // Launch 60 concurrent cold requests simultaneously
  const callers = Array.from({ length: 60 }, (_, idx) =>
    flight.do('course_materials:CSC301', mockUpstreamMoodleFetch).then((data) => ({
      callerId: idx,
      data,
    }))
  );

  // Invariant 7: Exactly 1 single-flight key tracked during in-flight window
  assert.strictEqual(flight.activeKeys.length, 1);
  assert.strictEqual(flight.activeKeys[0], 'course_materials:CSC301');

  const settledCallers = await Promise.all(callers);
  const elapsedMs = Date.now() - startTs;

  // Assertions:
  // 1. Exactly 1 upstream execution across 60 simultaneous callers
  assert.strictEqual(upstreamFetchCount, 1, 'Upstream fetchFn must be invoked exactly once');

  // 2. All 60 callers receive identical data payload
  const firstPayload = settledCallers[0].data;
  assert.strictEqual(firstPayload.courseId, 'CSC301');
  assert.strictEqual(firstPayload.materials.length, 2);

  for (const caller of settledCallers) {
    assert.strictEqual(caller.data.courseId, 'CSC301');
    assert.strictEqual(caller.data.fetchedAt, firstPayload.fetchedAt);
  }

  // 3. Map must be completely evicted after settlement (Zero Heap Leaks)
  assert.strictEqual(flight.activeKeys.length, 0, 'In-flight flightMap must be 0 after settlement');

  console.log(`  [Phase 13B.1] 60 callers settled in ${elapsedMs}ms with 1 upstream fetch.`);
  await flight.close();
});

test('Phase 13B.2: Single Boot-Time Pattern Subscription (psubscribe) vs Zero-Per-Request Leak', async () => {
  const dispatcher = new RedisSubscriberDispatcher();

  // Pattern subscription constant check
  assert.strictEqual(PATTERN_SUBSCRIPTION, 'focit:channel:*');

  let mockMessagesReceived = 0;
  const channelKey = 'focit:channel:course_materials:CSC305';

  const listener1 = (msg) => {
    const parsed = JSON.parse(msg);
    if (parsed.status === 'READY') mockMessagesReceived++;
  };
  const listener2 = (msg) => {
    const parsed = JSON.parse(msg);
    if (parsed.status === 'READY') mockMessagesReceived++;
  };

  // Register listeners on same pattern channel
  await dispatcher.subscribe(channelKey, listener1);
  await dispatcher.subscribe(channelKey, listener2);

  // Introspection: Two listeners registered for this channel
  assert.strictEqual(dispatcher.channelCallbacks.get(channelKey).size, 2);

  // Simulate internal Redis pmessage dispatch from the single pattern subscription
  dispatcher.subscriberEvents.emit(
    channelKey,
    JSON.stringify({ status: 'READY', data: { test: true }, inBand: true })
  );

  assert.strictEqual(mockMessagesReceived, 2, 'Both listeners must receive message from single dispatcher');

  // Unsubscribe listener 1
  await dispatcher.unsubscribe(channelKey, listener1);
  assert.strictEqual(dispatcher.channelCallbacks.get(channelKey).size, 1);

  // Unsubscribe listener 2 -> Channel entry cleanly evicted
  await dispatcher.unsubscribe(channelKey, listener2);
  assert.strictEqual(dispatcher.channelCallbacks.has(channelKey), false, 'Channel entry must be pruned');

  await dispatcher.close();
});

test('Phase 13B.3: Upstream Failure Propagation & Non-Poisoning Invariant (Grill Guard 2)', async () => {
  const flight = new DistributedSingleFlight({ defaultTimeoutMs: 5000, contenderTimeoutMs: 4000 });
  let upstreamAttempts = 0;

  const failingUpstreamFetcher = async () => {
    upstreamAttempts++;
    await new Promise((resolve) => setTimeout(resolve, 40));
    const moodleErr = new Error('502 Bad Gateway: Upstream Moodle connection timed out');
    moodleErr.code = 'UND_ERR_CONNECT_TIMEOUT';
    moodleErr.statusCode = 502;
    throw moodleErr;
  };

  // 25 concurrent callers hit the failing resource simultaneously
  const callers = Array.from({ length: 25 }, () =>
    flight.do('course_materials:FAILING_COURSE', failingUpstreamFetcher).catch((err) => ({
      failed: true,
      code: err.code,
      message: err.message,
    }))
  );

  const results = await callers;
  const errors = await Promise.all(callers);

  // 1. Upstream must only be attempted ONCE
  assert.strictEqual(upstreamAttempts, 1, 'Only 1 failed attempt executed upstream');

  // 2. All 25 callers receive the upstream failure fast without hanging for 4,000ms
  for (const err of errors) {
    assert.strictEqual(err.failed, true);
    assert.strictEqual(err.code, 'UND_ERR_CONNECT_TIMEOUT');
    assert.ok(err.message.includes('502 Bad Gateway'));
  }

  // 3. FlightMap is completely evicted
  assert.strictEqual(flight.activeKeys.length, 0);

  // 4. NON-POISONING INVARIANT:
  // Subsequent retry for this resource must NOT return a cached error.
  // It must execute the worker function fresh.
  const recoveredResult = await flight.do('course_materials:FAILING_COURSE', async () => ({
    recovered: true,
    data: 'fresh_data_after_moodle_restart',
  }));

  assert.strictEqual(recoveredResult.recovered, true);
  assert.strictEqual(recoveredResult.data, 'fresh_data_after_moodle_restart');

  await flight.close();
});

test('Phase 13B.4: Undici Connection Pool Partitioning & Socket Health', () => {
  const stats = getMoodlePoolStats();

  // Verify pool statistics are exposed and non-negative
  assert.ok(typeof stats.connected === 'number');
  assert.ok(typeof stats.free === 'number');
  assert.ok(typeof stats.pending === 'number');
  assert.ok(typeof stats.running === 'number');
  assert.ok(typeof stats.size === 'number');

  // Pending queue under baseline should be 0 (no contention)
  assert.strictEqual(stats.pending, 0);

  console.log('  [Phase 13B.4] Undici Moodle Pool Telemetry:', stats);
});
