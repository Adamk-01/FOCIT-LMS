/**
 * FOCIT LMS — Multi-Range Edge Capability Token Service
 *
 * Implements Phase 13D Architecture:
 * 1. Ephemeral Capability Lease:
 *    Generates cryptographically signed session leases (15-30 min) for Mozilla PDF.js
 *    linearized document reading, replacing broken single-use tokens.
 *
 * 2. Cryptographic Security & Fingerprinting:
 *    HMAC-SHA256 signature over Base64URL-encoded payload containing:
 *    - iid: Item UUID
 *    - sub: Student ID
 *    - exp: Expiration Epoch Seconds
 *    - fps: Client Subnet + User-Agent Fingerprint
 *
 * 3. Mobile Carrier Subnet Tolerance:
 *    Normalizes IPv4 (/24) and IPv6 (/64) to prevent cellular tower handoffs
 *    from terminating legitimate student reading sessions.
 */

import crypto from 'node:crypto';
import config from '../config.js';

const TICKET_SECRET = process.env.EDGE_TICKET_SECRET || config.jwt?.secret || 'focit_edge_ticket_secret_fallback_key';
const DEFAULT_TICKET_TTL_SECONDS = 1800; // 30 minutes

/**
 * Normalizes client IP to subnet level (/24 for IPv4, /64 for IPv6)
 * to tolerate mobile network tower handoffs.
 *
 * @param {string} ip
 * @returns {string}
 */
export function normalizeClientSubnet(ip) {
  if (!ip || typeof ip !== 'string') return '0.0.0.0';
  const clean = ip.replace(/^::ffff:/, '').trim();

  // IPv4 subnet (/24): 192.168.1.45 -> 192.168.1.0
  if (clean.includes('.')) {
    const parts = clean.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
  }

  // IPv6 subnet (/64): 2001:db8:abcd:0012:... -> 2001:db8:abcd:12::
  if (clean.includes(':')) {
    const parts = clean.split(':');
    return parts.slice(0, 4).join(':') + '::';
  }

  return clean;
}

/**
 * Computes a deterministic client fingerprint.
 *
 * @param {string} clientIp
 * @param {string} userAgent
 * @param {string} [secret]
 * @returns {string}
 */
export function computeClientFingerprint(clientIp, userAgent, secret = TICKET_SECRET) {
  const subnet = normalizeClientSubnet(clientIp);
  const ua = (userAgent || '').slice(0, 80);
  return crypto
    .createHmac('sha256', secret)
    .update(`${subnet}:${ua}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Base64URL encoding helper.
 */
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * Base64URL decoding helper.
 */
function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Generates an Edge Capability Ticket for document streaming.
 *
 * @param {string} studentId
 * @param {string} itemId
 * @param {string} clientIp
 * @param {string} userAgent
 * @param {number} [ttlSeconds=1800]
 * @returns {{ ticket: string, expiresAt: number, streamUrl: string }}
 */
export function generateEdgeTicket(studentId, itemId, clientIp, userAgent, ttlSeconds = DEFAULT_TICKET_TTL_SECONDS) {
  const nowSec = Math.floor(Date.now() / 1000);
  const expiresAt = nowSec + ttlSeconds;
  const fps = computeClientFingerprint(clientIp, userAgent, TICKET_SECRET);

  const payload = {
    iid: itemId,
    sub: studentId,
    exp: expiresAt,
    fps,
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadStr);

  const signature = crypto
    .createHmac('sha256', TICKET_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const ticket = `${payloadB64}.${signature}`;

  return {
    ticket,
    expiresAt,
    streamUrl: `/api/library/items/${itemId}/stream?ticket=${ticket}`,
  };
}

/**
 * Cryptographically verifies an Edge Capability Ticket.
 *
 * @param {string} ticket
 * @param {string} expectedItemId
 * @param {string} [clientIp]
 * @param {string} [userAgent]
 * @param {boolean} [enforceFingerprint=true]
 * @returns {{ valid: boolean, payload?: object, reason?: string }}
 */
export function verifyEdgeTicket(ticket, expectedItemId, clientIp, userAgent, enforceFingerprint = true) {
  if (!ticket || typeof ticket !== 'string') {
    return { valid: false, reason: 'MISSING_TICKET' };
  }

  const parts = ticket.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'MALFORMED_TICKET' };
  }

  const [payloadB64, signature] = parts;

  // 1. Verify HMAC Signature with Constant-Time Comparison
  const expectedSignature = crypto
    .createHmac('sha256', TICKET_SECRET)
    .update(payloadB64)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }

  // 2. Parse Payload
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64));
  } catch {
    return { valid: false, reason: 'INVALID_PAYLOAD' };
  }

  // 3. Expiration Check
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp <= nowSec) {
    return { valid: false, reason: 'EXPIRED' };
  }

  // 4. Resource Item ID Match
  if (expectedItemId && payload.iid !== expectedItemId) {
    return { valid: false, reason: 'ITEM_MISMATCH' };
  }

  // 5. Client Subnet & User-Agent Fingerprint Check
  if (enforceFingerprint && clientIp && payload.fps) {
    const computedFps = computeClientFingerprint(clientIp, userAgent, TICKET_SECRET);
    const fpsBuffer = Buffer.from(payload.fps);
    const computedBuffer = Buffer.from(computedFps);

    if (fpsBuffer.length !== computedBuffer.length || !crypto.timingSafeEqual(fpsBuffer, computedBuffer)) {
      return { valid: false, reason: 'FINGERPRINT_MISMATCH' };
    }
  }

  return { valid: true, payload };
}
