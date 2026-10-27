import test from 'node:test';
import assert from 'node:assert';
import { DistributedSingleFlight } from '../src/lib/distributedSingleFlight.js';

test('DistributedSingleFlight: Layer 1 Intra-Process Request Coalescing (50 concurrent callers)', async () => {
  const flight = new DistributedSingleFlight({ defaultTimeoutMs: 5000 });
  let executionCount = 0;

  const mockSlowFetcher = async (signal) => {
    executionCount++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return { data: 'authoritative_course_materials', timestamp: Date.now() };
  };

  // Launch 50 concurrent requests simultaneously for the same resource key
  const promises = Array.from({ length: 50 }, () => flight.do('course:CSC204', mockSlowFetcher));

  // In-flight activeKeys must reflect exactly 1 tracked key
  assert.deepStrictEqual(flight.activeKeys, ['course:CSC204']);

  const results = await Promise.all(promises);

  // Exactly 1 execution of the expensive upstream fetcher
  assert.strictEqual(executionCount, 1);

  // All 50 callers receive the identical payload and reference
  for (const res of results) {
    assert.strictEqual(res.data, 'authoritative_course_materials');
    assert.strictEqual(res.timestamp, results[0].timestamp);
  }

  // Memory cleanup invariant: Map must be completely empty after settlement
  assert.strictEqual(flight.activeKeys.length, 0);
  await flight.close();
});

test('DistributedSingleFlight: Error Propagation & Non-Poisoning Invariant', async () => {
  const flight = new DistributedSingleFlight({ defaultTimeoutMs: 5000 });
  let executionCount = 0;

  const failingFetcher = async () => {
    executionCount++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const error = new Error('Upstream Moodle 503 Service Unavailable');
    error.code = 'UPSTREAM_503';
    throw error;
  };

  // 10 concurrent requests for the same key
  const promises = Array.from({ length: 10 }, () =>
    flight.do('course:FAIL_TEST', failingFetcher).catch((err) => err)
  );

  const errors = await Promise.all(promises);

  // Only 1 failed attempt executed upstream
  assert.strictEqual(executionCount, 1);

  // All 10 callers receive the exact same error
  for (const err of errors) {
    assert.strictEqual(err.message, 'Upstream Moodle 503 Service Unavailable');
    assert.strictEqual(err.code, 'UPSTREAM_503');
  }

  // Registry must be cleanly cleared so a subsequent request can retry
  assert.strictEqual(flight.activeKeys.length, 0);

  // Retry after failure must execute successfully without being poisoned
  const retryResult = await flight.do('course:FAIL_TEST', async () => ({ recovered: true }));
  assert.strictEqual(retryResult.recovered, true);

  await flight.close();
});

test('DistributedSingleFlight: Hard Timeout Ceiling & Abort Signal Propagation', async () => {
  const flight = new DistributedSingleFlight({ defaultTimeoutMs: 100 });
  let signalReceived = null;

  const hangingFetcher = async (signal) => {
    signalReceived = signal;
    return new Promise((resolve) => {
      // Intentionally never resolves
    });
  };

  await assert.rejects(
    async () => {
      await flight.do('hanging:key', hangingFetcher, { timeoutMs: 80 });
    },
    (err) => {
      assert.match(err.message, /timeout exceeded/i);
      return true;
    }
  );

  // Verify AbortSignal was triggered
  assert.strictEqual(signalReceived?.aborted, true);

  // Verify local map evicted the stuck key
  assert.strictEqual(flight.activeKeys.length, 0);
  await flight.close();
});

test('DistributedSingleFlight: Administrative Abort Method', async () => {
  const flight = new DistributedSingleFlight({ defaultTimeoutMs: 5000 });

  const slowFetcher = async (signal) => {
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('Aborted by signal')));
    });
  };

  const promise = flight.do('abort:key', slowFetcher);
  assert.deepStrictEqual(flight.activeKeys, ['abort:key']);

  // Admin purges key
  flight.abort('abort:key');
  assert.strictEqual(flight.activeKeys.length, 0);

  await assert.rejects(promise, /Aborted by signal/);
  await flight.close();
});
