/**
 * FOCIT LMS - Moodle Web Services Base Client
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces:
 * 1. Undici Connection Pooling (All HTTP calls constrained via moodlePool)
 * 2. Moodle "Fake 200 OK" Exception Trapping
 * 3. Token Insulation: wstoken injected exclusively server-side
 * 4. Error Classification & Structured Logging
 */

import moodlePool from '../../lib/moodlePool.js';
import config from '../../config.js';
import { logger } from '../../lib/logger.js';

export const NON_RETRYABLE_CODES = new Set([
  'invalidparameter',
  'invalidrecord',
  'usernotfound',
  'coursenotfound',
  'invalidtoken',
  'accessexception',
  'nopermissions',
  'coding_exception',
  'invaliduser',
  'cannotenrol',
  'usernotincourse',
]);

export class MoodleAPIError extends Error {
  constructor(message, httpStatus, wsfunction, errorCode) {
    super(message);
    this.name = 'MoodleAPIError';
    this.httpStatus = httpStatus;
    this.wsfunction = wsfunction;
    this.errorCode = errorCode;

    if (errorCode) {
      // Moodle 200-OK application exception: retry ONLY if not in deterministic blacklist
      this.isRetryable = !NON_RETRYABLE_CODES.has(errorCode);
    } else {
      // Transport / HTTP level error: retry on 5xx, 429, or network drop (!httpStatus)
      this.isRetryable = httpStatus >= 500 || httpStatus === 429 || !httpStatus;
    }
  }
}

/**
 * Executes a typed Moodle Web Services API call.
 *
 * @param {string} wsfunction - Moodle WS function name (e.g., 'core_user_create_users')
 * @param {Record<string, any>} params - Query/body parameters
 * @param {string} [method='GET'] - HTTP method ('GET' or 'POST')
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<any>}
 */
export async function callMoodleAPI(wsfunction, params = {}, method = 'GET', signal) {
  const queryParams = new URLSearchParams({
    wstoken: config.moodle.wsToken,
    wsfunction,
    moodlewsrestformat: 'json',
  });

  let path = '/webservice/rest/server.php';
  let body = null;
  const headers = {};

  if (method.toUpperCase() === 'POST') {
    // Append params into form-urlencoded payload for POST mutations
    const bodyParams = new URLSearchParams(queryParams);
    for (const [key, val] of Object.entries(params)) {
      if (typeof val === 'object' && val !== null) {
        // Handle array / object parameter nesting for Moodle PHP formatting
        flattenMoodleParams(bodyParams, key, val);
      } else {
        bodyParams.append(key, String(val));
      }
    }
    body = bodyParams.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  } else {
    // Append params into query string for GET reads
    for (const [key, val] of Object.entries(params)) {
      if (typeof val === 'object' && val !== null) {
        flattenMoodleParams(queryParams, key, val);
      } else {
        queryParams.append(key, String(val));
      }
    }
    path = `/webservice/rest/server.php?${queryParams.toString()}`;
  }

  const { statusCode, body: responseBody } = await moodlePool.request({
    path,
    method: method.toUpperCase(),
    headers,
    body,
    signal,
  });

  const responseText = await responseBody.text();

  if (statusCode !== 200) {
    logger.error({ wsfunction, statusCode, response: responseText }, '[MoodleClient] Upstream HTTP error');
    throw new MoodleAPIError(`Moodle returned HTTP ${statusCode}`, statusCode, wsfunction);
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch (err) {
    logger.error({ wsfunction, err: err.message, response: responseText }, '[MoodleClient] Non-JSON response');
    throw new MoodleAPIError(`Moodle returned non-JSON response: ${responseText.slice(0, 100)}`, statusCode, wsfunction);
  }

  // EXPLICIT TRAP: Moodle Fake "200 OK" exceptions
  if (result && typeof result === 'object' && result.exception) {
    logger.warn({ wsfunction, errorcode: result.errorcode, message: result.message }, '[MoodleClient] Application error in 200 OK response');
    throw new MoodleAPIError(`${result.errorcode}: ${result.message}`, 200, wsfunction, result.errorcode);
  }

  return result;
}

/**
 * Recursive helper to serialize nested arrays and objects into PHP-compatible
 * key[0][field] format required by Moodle Web Services REST API.
 */
function flattenMoodleParams(searchParams, prefix, obj) {
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      flattenMoodleParams(searchParams, `${prefix}[${index}]`, item);
    });
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [subKey, val] of Object.entries(obj)) {
      flattenMoodleParams(searchParams, `${prefix}[${subKey}]`, val);
    }
  } else {
    searchParams.append(prefix, String(obj));
  }
}
