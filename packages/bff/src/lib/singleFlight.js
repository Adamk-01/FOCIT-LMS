/**
 * Deadlock-Immune Single-Flight Request Coalescer
 *
 * Implements Layer 4: Bounded Concurrency & Anti-Stampede Primitive.
 *
 * Guarantees:
 * 1. Hard Timeout Ceiling: No worker function can hang indefinitely.
 * 2. Independent Eviction Latch: The key is guaranteed to be purged from the
 *    inFlight registry even if the downstream promise never settles.
 * 3. Downstream Abort Propagation: The worker receives an AbortSignal to sever
 *    hanging TCP sockets (Undici, Postgres, HTTP).
 * 4. Subscriber Isolation: Individual subscriber disconnections do not poison
 *    the shared computation for remaining subscribers.
 */

export class SingleFlightTimeoutError extends Error {
  constructor(key, timeoutMs) {
    super(`[SingleFlight] Operation for key "${key}" timed out after ${timeoutMs}ms`);
    this.name = 'SingleFlightTimeoutError';
    this.code = 'SINGLE_FLIGHT_TIMEOUT';
    this.key = key;
    this.timeoutMs = timeoutMs;
  }
}

export class SingleFlight {
  constructor(defaultTimeoutMs = 10000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
    /** @type {Map<string, { promise: Promise<any>, controller: AbortController, timer: NodeJS.Timeout }>} */
    this.inFlight = new Map();
  }

  /**
   * Executes or coalesces an asynchronous task for a given key.
   *
   * @template T
   * @param {string} key - Unique resource identification key
   * @param {(signal: AbortSignal) => Promise<T>} workerFn - Worker receiving abort signal
   * @param {number} [timeoutMs] - Maximum execution threshold before forced abort
   * @returns {Promise<T>}
   */
  async do(key, workerFn, timeoutMs = this.defaultTimeoutMs) {
    // 1. Subscriber Coalescing: Attach to active promise if one is already running
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing.promise;
    }

    // 2. Setup Master Cancellation & Independent Eviction Timer
    const controller = new AbortController();
    let evictionTimer = null;

    // Independent Eviction Latch:
    // Guarantees key is erased from the registry even if the underlying
    // asynchronous promise refuses to resolve or hangs in V8 microtask limbo.
    const cleanup = () => {
      if (evictionTimer) {
        clearTimeout(evictionTimer);
        evictionTimer = null;
      }
      this.inFlight.delete(key);
    };

    // 3. Execution Wrapper with Hard Timeout Ceiling
    const executionPromise = new Promise((resolve, reject) => {
      // Hard timeout trigger
      evictionTimer = setTimeout(() => {
        controller.abort(new SingleFlightTimeoutError(key, timeoutMs));
        cleanup();
        reject(new SingleFlightTimeoutError(key, timeoutMs));
      }, timeoutMs);

      // Prevent timer from holding Node.js process open on exit
      if (evictionTimer.unref) {
        evictionTimer.unref();
      }

      // Execute worker with AbortSignal injection
      Promise.resolve()
        .then(() => workerFn(controller.signal))
        .then((result) => {
          cleanup();
          resolve(result);
        })
        .catch((err) => {
          cleanup();
          reject(err);
        });
    });

    // 4. Register in-flight context
    this.inFlight.set(key, {
      promise: executionPromise,
      controller,
      timer: evictionTimer,
    });

    return executionPromise;
  }

  /**
   * Diagnostic inspection: Active in-flight keys.
   * @returns {string[]}
   */
  get activeKeys() {
    return Array.from(this.inFlight.keys());
  }

  /**
   * Forced administrative purge of a stuck key.
   * @param {string} key
   */
  abort(key) {
    const entry = this.inFlight.get(key);
    if (entry) {
      entry.controller.abort(new Error(`Administrative abort for key: ${key}`));
      if (entry.timer) clearTimeout(entry.timer);
      this.inFlight.delete(key);
    }
  }
}

export const singleFlight = new SingleFlight();
