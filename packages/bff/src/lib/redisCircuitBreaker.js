/**
 * Resilient Redis Circuit Breaker
 *
 * Implements:
 * 1. Three-State Machine: CLOSED, OPEN, HALF_OPEN.
 * 2. Synchronous Test-and-Set Latch: Mathematically guarantees exactly 1 trial probe
 *    in HALF_OPEN state under concurrent microtask scheduling; 49 of 50 fast-fail.
 * 3. O(1) Memory Sliding Window: Tracks failure thresholds using two circular integer
 *    registers, guaranteeing zero heap allocation churn under high failure volume.
 * 4. Deferred Factory Execution: Prevents pipeline allocation when breaker is OPEN.
 */

export class CircuitBreakerOpenError extends Error {
  constructor(message = 'Circuit breaker is OPEN: backing store is unavailable') {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.code = 'CIRCUIT_BREAKER_OPEN';
  }
}

export class CircuitBreakerTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`Circuit breaker operation timed out after ${timeoutMs}ms`);
    this.name = 'CircuitBreakerTimeoutError';
    this.code = 'CIRCUIT_BREAKER_TIMEOUT';
    this.timeoutMs = timeoutMs;
  }
}

export class SlidingWindowCounter {
  /**
   * @param {number} [windowMs=10000] - Duration of the rolling window
   */
  constructor(windowMs = 10000) {
    this.windowMs = windowMs;
    this.currentWindowStartMs = Date.now();
    this.currentFailures = 0;
    this.previousFailures = 0;
  }

  recordFailure(now = Date.now()) {
    const elapsed = now - this.currentWindowStartMs;

    if (elapsed >= this.windowMs) {
      const windowsPassed = Math.floor(elapsed / this.windowMs);
      this.previousFailures = windowsPassed === 1 ? this.currentFailures : 0;
      this.currentFailures = 0;
      this.currentWindowStartMs = now - (elapsed % this.windowMs);
    }

    this.currentFailures++;
  }

  getEstimatedFailures(now = Date.now()) {
    const elapsed = now - this.currentWindowStartMs;

    if (elapsed >= this.windowMs * 2) {
      return 0;
    }

    if (elapsed >= this.windowMs) {
      // Current failures have shifted into the previous slot relative to elapsed time
      const decayWeight = (this.windowMs * 2 - elapsed) / this.windowMs;
      return Math.floor(this.currentFailures * decayWeight);
    }

    const weight = (this.windowMs - elapsed) / this.windowMs;
    return Math.floor(this.previousFailures * weight) + this.currentFailures;
  }

  reset() {
    this.currentFailures = 0;
    this.previousFailures = 0;
    this.currentWindowStartMs = Date.now();
  }
}

export class RedisCircuitBreaker {
  /**
   * @param {object} [options]
   * @param {number} [options.failureThreshold=5] - Failures in window before tripping OPEN
   * @param {number} [options.windowMs=10000] - Sliding failure window duration
   * @param {number} [options.resetTimeoutMs=5000] - Cooldown duration in OPEN state before HALF_OPEN
   * @param {number} [options.defaultTimeoutMs=500] - Per-operation execution deadline
   */
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.windowMs = options.windowMs ?? 10000;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 5000;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 500;

    /** @type {'CLOSED'|'OPEN'|'HALF_OPEN'} */
    this.state = 'CLOSED';
    this.nextAttemptMs = 0;

    // The Synchronous Test-and-Set Latch for HALF_OPEN
    this.isProbeInFlight = false;

    // O(1) Memory Rolling Failure Counter
    this.failureCounter = new SlidingWindowCounter(this.windowMs);
  }

  /**
   * Evaluates if a request is permitted to execute.
   * Synchronously thread-safe within Node.js non-preemptive tick.
   *
   * @returns {boolean}
   */
  canExecute() {
    const now = Date.now();

    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      if (now < this.nextAttemptMs) {
        return false; // Fast-fail in O(1)
      }
      // Cooldown elapsed. Transition state synchronously.
      this.state = 'HALF_OPEN';
      this.isProbeInFlight = false;
    }

    if (this.state === 'HALF_OPEN') {
      // SYNCHRONOUS TEST-AND-SET LATCH:
      // The very first caller in this tick reads isProbeInFlight === false,
      // flips it to true, and claims the single trial probe.
      if (!this.isProbeInFlight) {
        this.isProbeInFlight = true;
        return true;
      }
      // All subsequent callers synchronously receive false and fast-fail.
      return false;
    }

    return false;
  }

  /**
   * Records successful operation settlement.
   */
  onSuccess() {
    this.failureCounter.reset();
    this.state = 'CLOSED';
    this.isProbeInFlight = false;
  }

  /**
   * Records operation failure or timeout.
   * @param {Error} err
   */
  onFailure(err) {
    const now = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Trial probe failed: immediately trip back to OPEN for another full cooldown
      this.state = 'OPEN';
      this.nextAttemptMs = now + this.resetTimeoutMs;
      this.isProbeInFlight = false;
      return;
    }

    // In CLOSED state: record failure in O(1) window
    this.failureCounter.recordFailure(now);
    const estimated = this.failureCounter.getEstimatedFailures(now);

    if (estimated >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptMs = now + this.resetTimeoutMs;
      this.isProbeInFlight = false;
    }
  }

  /**
   * Executes a deferred operation closure protected by the breaker.
   *
   * @template T
   * @param {() => Promise<T>} factoryFn - Factory closure executed ONLY if circuit permits
   * @param {number} [timeoutMs]
   * @returns {Promise<T>}
   */
  async execute(factoryFn, timeoutMs = this.defaultTimeoutMs) {
    // 1. STATE BARRIER: Evaluated BEFORE factoryFn is called (Zero pipeline allocation on OPEN)
    if (!this.canExecute()) {
      throw new CircuitBreakerOpenError();
    }

    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new CircuitBreakerTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([factoryFn(), timeoutPromise]);
      clearTimeout(timeoutId);
      this.onSuccess();
      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      this.onFailure(err);
      throw err;
    }
  }

  /**
   * Administrative reset.
   */
  reset() {
    this.state = 'CLOSED';
    this.nextAttemptMs = 0;
    this.isProbeInFlight = false;
    this.failureCounter.reset();
  }
}

export const redisCircuitBreaker = new RedisCircuitBreaker();
