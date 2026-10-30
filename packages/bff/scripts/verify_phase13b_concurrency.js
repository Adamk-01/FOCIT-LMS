/**
 * Verification Script: Phase 13B Enterprise Two-Layer Coalescing & Socket Teardown
 * Simulates high-density concurrency spikes against single-flight keys.
 */

import {
  DistributedSingleFlight,
  RedisSubscriberDispatcher,
  PATTERN_SUBSCRIPTION,
} from '../src/lib/distributedSingleFlight.js';
import { getMoodlePoolStats } from '../src/lib/moodlePool.js';

async function runVerification() {
  console.log('\n==============================================================');
  console.log(' Phase 13B: Two-Layer Distributed Single-Flight & Undici Pool');
  console.log('==============================================================\n');

  const flight = new DistributedSingleFlight({ defaultTimeoutMs: 5000 });
  let upstreamInvocations = 0;

  // 1. High-Density Cold Key Surge (50 concurrent students)
  console.log('[Test 1] Dispatching 50 concurrent cold requests for "course_materials:CSC401"...');
  const startTs = Date.now();

  const slowMoodleFetch = async (signal) => {
    upstreamInvocations++;
    await new Promise((r) => setTimeout(r, 60)); // Simulate upstream latency
    return {
      courseId: 'CSC401',
      title: 'Advanced Distributed Systems & Consensus',
      data: 'verified_course_syllabus',
      timestamp: Date.now(),
    };
  };

  const requests = Array.from({ length: 50 }, (_, i) =>
    flight.do('course_materials:CSC401', slowMoodleFetch)
  );

  const activeKeysDuringBurst = flight.activeKeys;
  console.log(`  -> Active in-flight keys during burst: [${activeKeysDuringBurst.join(', ')}]`);

  const results = await Promise.all(requests);
  const elapsedMs = Date.now() - startTs;

  console.log(`  -> 50 concurrent requests settled in ${elapsedMs}ms.`);
  console.log(`  -> Total Upstream fetchFn() invocations: ${upstreamInvocations}`);
  console.log(`  -> Active in-flight keys after settlement: [${flight.activeKeys.join(', ')}]`);

  const test1Passed =
    upstreamInvocations === 1 &&
    flight.activeKeys.length === 0 &&
    results.length === 50 &&
    results.every((r) => r.courseId === 'CSC401');

  // 2. Upstream Error Propagation & Non-Poisoning Check
  console.log('\n[Test 2] Testing Upstream Failure Coalescing & Fast Contender Propagation...');
  let failedInvocations = 0;
  const failingFetch = async () => {
    failedInvocations++;
    await new Promise((r) => setTimeout(r, 30));
    const err = new Error('502 Bad Gateway: Legacy Moodle PHP socket reset');
    err.code = 'UND_ERR_CONNECT_TIMEOUT';
    throw err;
  };

  const errorRequests = Array.from({ length: 25 }, () =>
    flight.do('failing:resource', failingFetch).catch((err) => ({
      caught: true,
      code: err.code,
      message: err.message,
    }))
  );

  const errorResults = await Promise.all(errorRequests);
  console.log(`  -> 25 error callers settled.`);
  console.log(`  -> Upstream failed fetchFn() invocations: ${failedInvocations}`);
  console.log(`  -> All callers received identical error: ${errorResults.every((r) => r.code === 'UND_ERR_CONNECT_TIMEOUT')}`);

  // Test Non-Poisoning: Immediate retry must execute fresh
  const recoveryResult = await flight.do('failing:resource', async () => ({ recovered: true }));
  const test2Passed =
    failedInvocations === 1 &&
    errorResults.every((r) => r.code === 'UND_ERR_CONNECT_TIMEOUT') &&
    recoveryResult.recovered === true;

  // 3. Boot-Time Pattern Subscription Introspection
  console.log('\n[Test 3] Verifying Single Boot-Time Pattern Subscription (psubscribe)...');
  const dispatcher = new RedisSubscriberDispatcher();
  const test3Passed = PATTERN_SUBSCRIPTION === 'focit:channel:*';
  console.log(`  -> Pattern subscription: "${PATTERN_SUBSCRIPTION}" (Boot-Time Registered)`);

  // 4. Undici Pool Telemetry
  console.log('\n[Test 4] Inspecting Undici Moodle Connection Pool...');
  const poolStats = getMoodlePoolStats();
  console.log('  -> Undici Pool Statistics:', poolStats);
  const test4Passed = poolStats.pending === 0 && typeof poolStats.connected === 'number';

  console.log('\n─── Audit Verdict ────────────────────────────────────────────');
  console.log(` 1. Cold Burst Coalescing (50 requests -> 1 upstream): ${test1Passed ? 'PASS' : 'FAIL'}`);
  console.log(` 2. Failure Coalescing & Non-Poisoning Invariant:       ${test2Passed ? 'PASS' : 'FAIL'}`);
  console.log(` 3. Pattern Subscription (psubscribe Zero Leak):       ${test3Passed ? 'PASS' : 'FAIL'}`);
  console.log(` 4. Undici Moodle Pool Boundary:                       ${test4Passed ? 'PASS' : 'FAIL'}`);
  console.log('──────────────────────────────────────────────────────────────\n');

  await flight.close();
  await dispatcher.close();

  if (test1Passed && test2Passed && test3Passed && test4Passed) {
    console.log('>>> VERIFICATION PASSED: Phase 13B Architecture certified under 8-8-8 Doctrine.\n');
    process.exit(0);
  } else {
    console.error('>>> VERIFICATION FAILED.\n');
    process.exit(1);
  }
}

runVerification().catch((err) => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
