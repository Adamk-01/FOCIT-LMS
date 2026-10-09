import test from 'node:test';
import assert from 'node:assert';
import {
  RedisCircuitBreaker,
  CircuitBreakerOpenError,
  CircuitBreakerTimeoutError,
  SlidingWindowCounter,
} from '../src/lib/redisCircuitBreaker.js';

test('SlidingWindowCounter: O(1) Memory Failure Tracking and Window Expiration', () => {
  const counter = new SlidingWindowCounter(100); // 100ms window
  const startTime = Date.now();

  // Record 3 failures at start
  counter.recordFailure(startTime);
  counter.recordFailure(startTime + 10);
  counter.recordFailure(startTime + 20);

  assert.strictEqual(counter.getEstimatedFailures(startTime + 20), 3);

  // Advance into second window (110ms elapsed): previous window weight decays
  counter.recordFailure(startTime + 110);
  const estimated = counter.getEstimatedFailures(startTime + 110);
  // Current has 1, previous has 3 with ~90% weight -> ~3 + 1 = ~3-4
  assert.ok(estimated >= 2 && estimated <= 4);

  // Advance past 2 windows (250ms elapsed): fully expired
  assert.strictEqual(counter.getEstimatedFailures(startTime + 250), 0);
});

test('RedisCircuitBreaker: CLOSED -> OPEN Transition and Zero-Allocation Fast-Fail', async () => {
  const breaker = new RedisCircuitBreaker({
    failureThreshold: 3,
    windowMs: 5000,
    resetTimeoutMs: 100, // Short cooldown for testing
    defaultTimeoutMs: 50,
  });

  assert.strictEqual(breaker.state, 'CLOSED');

  let factoryExecutionCount = 0;
  const failingOp = async () => {
    factoryExecutionCount++;
    throw new Error('Connection refused (ECONNREFUSED)');
  };

  // Fail 1
  await assert.rejects(() => breaker.execute(failingOp), /Connection refused/);
  assert.strictEqual(breaker.state, 'CLOSED');

  // Fail 2
  await assert.rejects(() => breaker.execute(failingOp), /Connection refused/);
  assert.strictEqual(breaker.state, 'CLOSED');

  // Fail 3 -> Must trip OPEN
  await assert.rejects(() => breaker.execute(failingOp), /Connection refused/);
  assert.strictEqual(breaker.state, 'OPEN');
  assert.strictEqual(factoryExecutionCount, 3);

  // Next invocation: Must fast-fail immediately WITHOUT invoking factory (Zero allocation)
  await assert.rejects(
    () => breaker.execute(failingOp),
    (err) => {
      assert.strictEqual(err.code, 'CIRCUIT_BREAKER_OPEN');
      return true;
    }
  );

  // Factory was NOT called!
  assert.strictEqual(factoryExecutionCount, 3);
});

test('RedisCircuitBreaker: HALF_OPEN Concurrency Latch (Exactly 1 probe, 49 fast-fail)', async () => {
  const breaker = new RedisCircuitBreaker({
    failureThreshold: 2,
    windowMs: 5000,
    resetTimeoutMs: 50,
    defaultTimeoutMs: 200,
  });

  // Trip to OPEN
  const failingOp = async () => {
    throw new Error('ECONNREFUSED');
  };
  await assert.rejects(() => breaker.execute(failingOp));
  await assert.rejects(() => breaker.execute(failingOp));
  assert.strictEqual(breaker.state, 'OPEN');

  // Wait for cooldown to elapse (55ms > 50ms)
  await new Promise((resolve) => setTimeout(resolve, 55));

  let probeExecutionCount = 0;
  let openRejectionCount = 0;

  // Simulate 50 concurrent requests hitting the breaker simultaneously in the same tick
  const promises = Array.from({ length: 50 }, (_, i) => {
    return breaker
      .execute(async () => {
        probeExecutionCount++;
        // Simulate trial probe latency
        await new Promise((resolve) => setTimeout(resolve, 30));
        return `probe_success_${i}`;
      })
      .catch((err) => {
        if (err.code === 'CIRCUIT_BREAKER_OPEN') {
          openRejectionCount++;
        } else {
          throw err;
        }
      });
  });

  await Promise.all(promises);

  // MATHEMATICAL GUARANTEE:
  // Exactly 1 request was permitted to execute the trial probe
  assert.strictEqual(probeExecutionCount, 1);
  // Exactly 49 requests were fast-failed with CIRCUIT_BREAKER_OPEN
  assert.strictEqual(openRejectionCount, 49);

  // Since the single trial probe succeeded, breaker must have transitioned back to CLOSED
  assert.strictEqual(breaker.state, 'CLOSED');
});

test('RedisCircuitBreaker: Failed Probe in HALF_OPEN trips back to OPEN', async () => {
  const breaker = new RedisCircuitBreaker({
    failureThreshold: 2,
    windowMs: 5000,
    resetTimeoutMs: 50,
    defaultTimeoutMs: 200,
  });

  // Trip to OPEN
  const failingOp = async () => {
    throw new Error('ECONNREFUSED');
  };
  await assert.rejects(() => breaker.execute(failingOp));
  await assert.rejects(() => breaker.execute(failingOp));
  assert.strictEqual(breaker.state, 'OPEN');

  // Wait for cooldown
  await new Promise((resolve) => setTimeout(resolve, 55));

  // Trial probe fails
  await assert.rejects(
    () => breaker.execute(failingOp),
    /ECONNREFUSED/
  );

  // Breaker must trip immediately back to OPEN with renewed cooldown
  assert.strictEqual(breaker.state, 'OPEN');
});
