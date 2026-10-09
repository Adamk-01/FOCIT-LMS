/**
 * Unified Session Lifecycle Manager
 * Provides deterministic cancellation of all asynchronous browser processes
 * (WebSockets, SSE streams, in-flight HTTP requests, background intervals)
 * on auth boundary transitions and logouts.
 */

class SessionLifecycleManager {
  constructor() {
    this.controller = new AbortController();
    this.cleanupHandlers = new Set();
  }

  get signal() {
    return this.controller.signal;
  }

  /**
   * Registers a cleanup callback to be invoked during session termination.
   * @param {(reason: string) => void} handler
   * @returns {() => void} Unregister function
   */
  registerCleanup(handler) {
    if (typeof handler !== 'function') {
      throw new TypeError('[SessionLifecycle] Handler must be a function');
    }
    this.cleanupHandlers.add(handler);
    return () => this.cleanupHandlers.delete(handler);
  }

  /**
   * Terminate all active operations bound to this session.
   * @param {string} [reason='SESSION_TERMINATED']
   */
  terminate(reason = 'SESSION_TERMINATED') {
    // 1. Abort all in-flight network promises bound to signal
    if (!this.controller.signal.aborted) {
      try {
        this.controller.abort(reason);
      } catch (err) {
        console.error('[SessionLifecycle] Error aborting controller:', err);
      }
    }

    // 2. Execute registered cleanup handlers (EventSource, WebSockets, timers)
    for (const handler of this.cleanupHandlers) {
      try {
        handler(reason);
      } catch (err) {
        console.error('[SessionLifecycle] Error executing cleanup handler:', err);
      }
    }
    this.cleanupHandlers.clear();

    // 3. Reset controller to a fresh state for subsequent sessions
    this.controller = new AbortController();
  }
}

export const sessionLifecycle = new SessionLifecycleManager();
