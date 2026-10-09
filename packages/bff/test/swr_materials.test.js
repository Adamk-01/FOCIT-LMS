import test from 'node:test';
import assert from 'node:assert';
import { MaterialsCache } from '../src/lib/materialsCache.js';
import { SingleFlight } from '../src/lib/singleFlight.js';

test('MaterialsCache: Fresh, Stale, and Hard Expiry Transitions', async () => {
  // Setup cache with short test TTLs: fresh 50ms, stale 150ms
  const cache = new MaterialsCache({ freshTtlMs: 50, staleTtlMs: 150, maxEntries: 10 });
  const sampleData = [{ id: '1', title: 'Calculus I Syllabus' }];

  cache.set('CSC204', sampleData);

  // 1. Immediate retrieval is FRESH
  const freshResult = cache.get('CSC204');
  assert.strictEqual(freshResult.status, 'FRESH');
  assert.deepStrictEqual(freshResult.data, sampleData);

  // 2. Wait 60ms: Transitions from FRESH to STALE
  await new Promise((resolve) => setTimeout(resolve, 60));
  const staleResult = cache.get('CSC204');
  assert.strictEqual(staleResult.status, 'STALE');
  assert.deepStrictEqual(staleResult.data, sampleData);

  // 3. Wait another 100ms (total 160ms > 150ms): Hard expiry -> MISS
  await new Promise((resolve) => setTimeout(resolve, 100));
  const expiredResult = cache.get('CSC204');
  assert.strictEqual(expiredResult.status, 'MISS');
  assert.strictEqual(expiredResult.data, null);
});

test('MaterialsCache: Bounded Capacity and LRU Eviction', () => {
  const cache = new MaterialsCache({ maxEntries: 3, freshTtlMs: 10000, staleTtlMs: 20000 });

  cache.set('course1', { id: 1 });
  cache.set('course2', { id: 2 });
  cache.set('course3', { id: 3 });

  assert.strictEqual(cache.size, 3);

  // Access course1 so course2 becomes the least-recently used
  cache.get('course1');

  // Insert 4th item -> should evict course2
  cache.set('course4', { id: 4 });

  assert.strictEqual(cache.size, 3);
  assert.strictEqual(cache.get('course2').status, 'MISS');
  assert.strictEqual(cache.get('course1').status, 'FRESH');
  assert.strictEqual(cache.get('course3').status, 'FRESH');
  assert.strictEqual(cache.get('course4').status, 'FRESH');
});

test('SWR Single-Flight: Coalesces Concurrent Calls and Quarantines Errors', async () => {
  const singleFlight = new SingleFlight(5000);
  const cache = new MaterialsCache({ freshTtlMs: 100, staleTtlMs: 500 });
  let upstreamFetchCount = 0;

  const mockUpstreamFetcher = async () => {
    upstreamFetchCount++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return [{ id: 'doc-1', title: 'Architecture Review' }];
  };

  // Dispatch 10 concurrent requests for the same course on a cold cache
  const results = await Promise.all([
    singleFlight.do('course:1', mockUpstreamFetcher),
    singleFlight.do('course:1', mockUpstreamFetcher),
    singleFlight.do('course:1', mockUpstreamFetcher),
    singleFlight.do('course:1', mockUpstreamFetcher),
  ]);

  // Single-Flight MUST have collapsed all 4 into exactly 1 upstream execution
  assert.strictEqual(upstreamFetchCount, 1);
  assert.strictEqual(results.length, 4);
  assert.strictEqual(results[0][0].title, 'Architecture Review');

  // Prime cache with result
  cache.set('1', results[0]);

  // Wait until cache becomes STALE
  await new Promise((resolve) => setTimeout(resolve, 120));
  const staleCheck = cache.get('1');
  assert.strictEqual(staleCheck.status, 'STALE');

  // Simulate failing background revalidation
  let backgroundErrorCaught = false;
  const failingFetcher = async () => {
    throw new Error('Moodle 502 Bad Gateway');
  };

  // Background execution with quarantined catch handler
  const bgPromise = singleFlight
    .do('course:1:fail', failingFetcher, 2000)
    .then((fresh) => cache.set('1', fresh))
    .catch((err) => {
      backgroundErrorCaught = true;
      assert.strictEqual(err.message, 'Moodle 502 Bad Gateway');
    });

  await bgPromise;

  // Verify: Error was caught cleanly, and existing stale cache entry remains valid
  assert.strictEqual(backgroundErrorCaught, true);
  const retainedCheck = cache.get('1');
  assert.strictEqual(retainedCheck.status, 'STALE');
  assert.strictEqual(retainedCheck.data[0].title, 'Architecture Review');
});

test('SWR Decoupled Ingress: Upstream Worker Persists and Warms Cache After Client Timeout', async () => {
  const singleFlight = new SingleFlight(10000);
  const cache = new MaterialsCache({ freshTtlMs: 5000, staleTtlMs: 10000 });
  const courseId = 'CSC301';

  let upstreamCompleted = false;

  // Upstream takes 100ms
  const upstreamWorker = async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    upstreamCompleted = true;
    return [{ id: 'slow-doc', title: 'Distributed Systems Syllabus' }];
  };

  // Single-flight background worker
  const upstreamPromise = singleFlight
    .do(`course:${courseId}`, upstreamWorker, 5000)
    .then((data) => {
      cache.set(courseId, data);
      return data;
    });

  // Client enforces an aggressive 30ms timeout (simulating client ingress shedding)
  const clientTimeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      const err = new Error('Client ingress timeout');
      err.code = 'CLIENT_INGRESS_TIMEOUT';
      reject(err);
    }, 30);
  });

  // Client request races against the ingress ceiling
  let clientReceived503 = false;
  try {
    await Promise.race([upstreamPromise, clientTimeoutPromise]);
  } catch (err) {
    if (err.code === 'CLIENT_INGRESS_TIMEOUT') {
      clientReceived503 = true;
    }
  }

  // Client was shed at 30ms
  assert.strictEqual(clientReceived503, true);
  assert.strictEqual(upstreamCompleted, false);

  // Wait for the decoupled upstream flight to finish at ~100ms
  await upstreamPromise;
  assert.strictEqual(upstreamCompleted, true);

  // Verify the cache is now HOT for subsequent requests
  const subsequentCheck = cache.get(courseId);
  assert.strictEqual(subsequentCheck.status, 'FRESH');
  assert.strictEqual(subsequentCheck.data[0].title, 'Distributed Systems Syllabus');
});
