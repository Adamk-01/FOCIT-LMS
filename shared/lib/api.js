/**
 * Zero-Dependency Enterprise Fetch Client (apiClient)
 *
 * Implements:
 * 1. Ambient credential support (credentials: 'include' for HttpOnly cookies)
 * 2. Unforgeable Fetch Metadata & CORS Preflight Trigger (X-Requested-With)
 * 3. Ephemeral Nonce injection (X-Session-Nonce)
 * 4. Transparent 503 Gateway Load-Shedding Re-Drive with Jitter
 * 5. Session lifecycle signal binding & Single-flight 401 eviction mutex
 *
 * NOTE: document.cookie parsing has been completely eliminated.
 */

import { sessionLifecycle } from './sessionLifecycle.js';

export class ApiError extends Error {
  constructor(message, status, data, response) {
    super(message);
    this.name = 'ApiError';
    this.status = typeof status === 'number' ? status : 0;
    this.data = data || null;
    this.response = response || null;

    // RFC 7807 Standard Fields
    this.code = data?.code || (this.status === 0 ? 'NETWORK_ERROR' : (this.status === 408 || this.status === 504 ? 'GATEWAY_TIMEOUT' : 'UNKNOWN_ERROR'));
    this.title = data?.title || 'System Notification';
    this.detail = data?.detail || data?.message || data?.error || message || 'An unexpected error occurred.';
    this.instance = data?.instance || null;
    this.correlationId = data?.correlationId || response?.headers?.get('x-correlation-id') || null;

    // Server Telemetry Extensions (Normalized casing and guarded types)
    this.projectedUnits = Number.isFinite(data?.projectedUnits) ? data.projectedUnits : null;
    this.maxCeiling = Number.isFinite(data?.maxCeiling) ? data.maxCeiling : null;
    this.minimumRequired = Number.isFinite(data?.minimumRequired) ? data.minimumRequired : null;
    this.excessUnits = Number.isFinite(data?.excessUnits) 
      ? data.excessUnits 
      : (Number.isFinite(data?.projectedUnits) && Number.isFinite(data?.maxCeiling) && data.projectedUnits > data.maxCeiling
          ? data.projectedUnits - data.maxCeiling 
          : null);
    this.courseId = (data?.courseId ?? data?.course_id ?? null) != null ? String(data?.courseId ?? data?.course_id).trim() : null;
    this.violations = Array.isArray(data?.violations) ? data.violations : null;
    this.extensions = data?.extensions || null;
  }
}

let isEvicting = false;

function combineSignals(primarySignal, secondarySignal) {
  if (!secondarySignal) return primarySignal;
  if (!primarySignal) return secondarySignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([primarySignal, secondarySignal]);
  }
  const controller = new AbortController();
  if (primarySignal.aborted || secondarySignal.aborted) {
    controller.abort();
    return controller.signal;
  }
  const onAbort = () => controller.abort();
  primarySignal.addEventListener('abort', onAbort, { once: true });
  secondarySignal.addEventListener('abort', onAbort, { once: true });
  return controller.signal;
}

/**
 * Sleep helper respecting AbortSignal
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

/**
 * Extracts and parses Retry-After header with defensive fallbacks.
 * @param {string|null} header
 * @returns {number} Delay in milliseconds
 */
function parseRetryAfterMs(header) {
  if (!header) return 2000;
  const seconds = parseInt(header, 10);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  const dateMs = new Date(header).getTime();
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? diff : 2000;
  }
  return 2000;
}

/**
 * Core Request Pipeline with Automated 503 Jittered Re-Drive
 */
async function request(endpoint, options = {}) {
  const url = endpoint.startsWith('http') ? endpoint : `/api${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();

  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  // Defense-in-depth: Forces CORS preflight (OPTIONS) against untrusted origins
  headers.set('X-Requested-With', 'XMLHttpRequest');

  // Ephemeral Session Nonce injection (Platform Phase 1 Proof with Cross-Tab Resilience)
  let sessionNonce = null;
  if (typeof sessionStorage !== 'undefined') {
    sessionNonce = sessionStorage.getItem('session_nonce');
  }
  if (!sessionNonce && typeof localStorage !== 'undefined') {
    sessionNonce = localStorage.getItem('session_nonce');
  }
  if (sessionNonce && !headers.has('X-Session-Nonce')) {
    headers.set('X-Session-Nonce', sessionNonce);
  }

  // Ensure JSON content type on state-mutating requests
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
    }
  }

  const signal = combineSignals(sessionLifecycle.signal, options.signal);

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
    body = JSON.stringify(body);
  }

  const MAX_SHED_RETRIES = 3;
  let attempt = 0;

  while (attempt <= MAX_SHED_RETRIES) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        method,
        headers,
        body,
        credentials: 'include', // Guarantees HttpOnly session cookie transmission
        signal,
      });
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err?.name === 'AbortError') {
        throw new ApiError(
          'Request was aborted or timed out',
          408,
          {
            code: 'GATEWAY_TIMEOUT',
            title: 'Campus Gateway Timeout',
            detail: 'The network request took too long or was aborted by the connection boundary.',
          },
          null
        );
      }
      throw new ApiError(
        err?.message || 'Network request failed',
        0,
        {
          code: 'NETWORK_ERROR',
          title: 'Campus Gateway Unreachable',
          detail: 'Unable to reach the campus server. Please verify your connection or try again shortly.',
        },
        null
      );
    }

    // ─── 503 LOAD-SHEDDING INTERCEPTOR: Transparent Jittered Re-Drive ────────
    // If the gateway sheds load, absorb the backoff transparently instead
    // of throwing uncaught errors to React UI or triggering student F5 panics.
    if (response.status === 503 && attempt < MAX_SHED_RETRIES) {
      attempt++;
      const retryHeader = response.headers.get('retry-after');
      const baseDelayMs = parseRetryAfterMs(retryHeader);
      // Apply +/- 25% jitter to desynchronize stampeding client retries
      const jitterFactor = 0.75 + Math.random() * 0.5;
      const jitteredDelayMs = Math.round(baseDelayMs * jitterFactor);

      console.warn(
        `[apiClient] 503 Load Shedding encountered on ${endpoint}. Backing off for ${jitteredDelayMs}ms (attempt ${attempt}/${MAX_SHED_RETRIES})...`
      );

      await sleep(jitteredDelayMs, signal);
      continue; // Re-execute request transparently
    }

    // Auto-heal desynced tab nonce if server issued synchronization header
    const syncNonce = response.headers?.get?.('x-session-nonce-sync');
    if (syncNonce) {
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('session_nonce', syncNonce);
      if (typeof localStorage !== 'undefined') localStorage.setItem('session_nonce', syncNonce);
    }

    // Response Interception Pipeline
    if (!response.ok) {
      let errorData = null;
      try {
        const cloned = response.clone();
        errorData = await cloned.json();
      } catch {
        try {
          errorData = { message: await response.text() };
        } catch {
          errorData = null;
        }
      }

      // Traps 401 Unauthorized & Upstream Session Drops
      if (response.status === 401) {
        const code = errorData?.code;
        const isSessionTermination =
          code === 'UPSTREAM_EXPIRED' ||
          code === 'JWT_EXPIRED' ||
          code === 'AUTH_TOKEN_EXPIRED' ||
          code === 'AUTH_MISSING_TOKEN' ||
          code === 'AUTH_NONCE_MISMATCH' ||
          code === 'AUTH_INVALID_SESSION' ||
          code === 'AUTH_SESSION_TERMINATED' ||
          !code;

        if (isSessionTermination && !isEvicting) {
          isEvicting = true;
          sessionLifecycle.terminate('UPSTREAM_EXPIRED');
          sessionStorage.removeItem('session_nonce');
          sessionStorage.removeItem('shadow_auth');
          localStorage.removeItem('session_nonce');
          localStorage.removeItem('shadow_auth');
          if (typeof window !== 'undefined') {
            window.location.replace('/login?reason=session_timeout');
          }
        }
      }

      const message = errorData?.detail || errorData?.message || errorData?.error || `HTTP ${response.status} ${response.statusText}`;
      throw new ApiError(message, response.status, errorData, response);
    }

    // Handle successful response
    if (response.status === 204) {
      return { data: null, status: 204, headers: response.headers };
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      return { data, status: response.status, headers: response.headers };
    }

    return { data: response, status: response.status, headers: response.headers };
  }
}

export const apiClient = {
  get: (endpoint, options) => request(endpoint, { ...options, method: 'GET' }),
  post: (endpoint, body, options) => request(endpoint, { ...options, method: 'POST', body }),
  put: (endpoint, body, options) => request(endpoint, { ...options, method: 'PUT', body }),
  patch: (endpoint, body, options) => request(endpoint, { ...options, method: 'PATCH', body }),
  delete: (endpoint, options) => request(endpoint, { ...options, method: 'DELETE' }),
};
