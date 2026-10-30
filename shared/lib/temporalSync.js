/**
 * Cristian's Algorithm with Uncertainty Bounds & Jitter Rejection Filter
 *
 * Implements Phase 2: High-Resolution Temporal Synchronization.
 *
 * Mathematical Model:
 *   RTT = T_resp - T_orig
 *   T_mid = (T_orig + T_resp) / 2
 *   Skew (theta) = T_server - T_mid
 *   Uncertainty Bound (E) = +/- (RTT / 2)
 *
 * Symmetrical Transit Assumption:
 *   Latency(Client -> Server) ~ Latency(Server -> Client) = RTT / 2.
 *
 * Jitter Rejection Filter:
 *   Measurements with RTT > 3,000ms are discarded due to asymmetry
 *   variance and queueing delay degradation.
 */

export const JITTER_REJECTION_THRESHOLD_MS = 3000;
export const DEFAULT_FALLBACK_SKEW_SEC = 0;

/**
 * Extracts high-resolution server epoch in milliseconds from response body or headers.
 * @param {object} response - Axios or Fetch response wrapper
 * @returns {number|null} Server time in epoch ms
 */
export function extractServerTimeMs(response) {
  if (!response) return null;

  const data = response.data;
  // 1. Direct high-resolution millisecond timestamp from BFF
  if (typeof data?.server_epoch_ms === 'number' && Number.isFinite(data.server_epoch_ms)) {
    return data.server_epoch_ms;
  }

  // 2. Second-precision server epoch from JSON payload
  if (typeof data?.server_epoch === 'number' && Number.isFinite(data.server_epoch)) {
    return data.server_epoch * 1000;
  }

  // 3. Fallback: Parse standard HTTP Date header
  const headers = response.headers;
  const dateHeader = headers?.get ? headers.get('date') : headers?.date;
  if (dateHeader) {
    const parsed = new Date(dateHeader).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

/**
 * Pure calculation of Cristian's Algorithm clock skew with uncertainty bounds.
 *
 * @param {object} params
 * @param {number} params.tOrig - Client epoch start timestamp (Date.now())
 * @param {number} params.tResp - Client epoch completion timestamp (Date.now())
 * @param {number} [params.perfOrig] - Monotonic start timestamp (performance.now())
 * @param {number} [params.perfResp] - Monotonic completion timestamp (performance.now())
 * @param {number} params.serverTimeMs - Authoritative server timestamp in ms
 * @param {number} [params.previousSkewSec=0] - Previously verified skew to retain on jitter discard
 * @param {number} [params.thresholdMs=3000] - Jitter rejection threshold in ms
 * @returns {{
 *   skewDeltaSec: number,
 *   skewDeltaMs: number,
 *   rttMs: number,
 *   uncertaintyMs: number,
 *   isRejected: boolean,
 *   rejectionReason: string|null
 * }}
 */
export function calculateCristianSkew({
  tOrig,
  tResp,
  perfOrig,
  perfResp,
  serverTimeMs,
  previousSkewSec = DEFAULT_FALLBACK_SKEW_SEC,
  thresholdMs = JITTER_REJECTION_THRESHOLD_MS,
}) {
  // 1. Calculate Round Trip Time (RTT)
  // Prefer monotonic timer to eliminate vulnerability to client OS NTP steps during transit
  const hasMonotonic =
    typeof perfOrig === 'number' &&
    typeof perfResp === 'number' &&
    Number.isFinite(perfOrig) &&
    Number.isFinite(perfResp);

  const rttMs = Math.max(0, Math.round(hasMonotonic ? perfResp - perfOrig : tResp - tOrig));

  // 2. Validate Server Temporal Input
  if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) {
    return {
      skewDeltaSec: previousSkewSec,
      skewDeltaMs: Math.round(previousSkewSec * 1000),
      rttMs,
      uncertaintyMs: Math.round(rttMs / 2),
      isRejected: true,
      rejectionReason: 'Invalid or missing authoritative server timestamp',
    };
  }

  // 3. Jitter Rejection Filter
  // Reject highly degraded networks where transit asymmetry renders RTT/2 assumption invalid
  if (rttMs > thresholdMs) {
    return {
      skewDeltaSec: previousSkewSec,
      skewDeltaMs: Math.round(previousSkewSec * 1000),
      rttMs,
      uncertaintyMs: Math.round(rttMs / 2),
      isRejected: true,
      rejectionReason: `RTT (${rttMs}ms) exceeds jitter rejection threshold (${thresholdMs}ms)`,
    };
  }

  // 4. Symmetrical Transit Midpoint Estimation
  // Client wall-clock estimate at the instant the server generated serverTimeMs:
  // T_mid = (T_orig + T_resp) / 2 = T_orig + (RTT / 2)
  const tMid = tOrig + rttMs / 2;

  // 5. Compute Clock Skew (theta)
  // theta = T_server - T_mid
  const skewDeltaMs = Math.round(serverTimeMs - tMid);
  const skewDeltaSec = Number((skewDeltaMs / 1000).toFixed(3));
  const uncertaintyMs = Math.round(rttMs / 2);

  return {
    skewDeltaSec,
    skewDeltaMs,
    rttMs,
    uncertaintyMs,
    isRejected: false,
    rejectionReason: null,
  };
}

/**
 * Higher-Order Synchronization Wrapper:
 * Executes an asynchronous network call and measures Cristian's Algorithm skew.
 *
 * @template T
 * @param {() => Promise<T>} requestFn
 * @param {object} [options]
 * @param {number} [options.previousSkewSec=0]
 * @param {number} [options.thresholdMs=3000]
 * @returns {Promise<{ result: T, sync: ReturnType<typeof calculateCristianSkew> }>}
 */
export async function executeWithCristianSync(requestFn, options = {}) {
  const tOrig = Date.now();
  const perfOrig = typeof performance !== 'undefined' ? performance.now() : tOrig;

  const response = await requestFn();

  const tResp = Date.now();
  const perfResp = typeof performance !== 'undefined' ? performance.now() : tResp;

  const serverTimeMs = extractServerTimeMs(response);

  const sync = calculateCristianSkew({
    tOrig,
    tResp,
    perfOrig,
    perfResp,
    serverTimeMs,
    previousSkewSec: options.previousSkewSec ?? DEFAULT_FALLBACK_SKEW_SEC,
    thresholdMs: options.thresholdMs ?? JITTER_REJECTION_THRESHOLD_MS,
  });

  return { response, sync };
}
