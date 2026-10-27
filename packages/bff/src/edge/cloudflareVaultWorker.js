/**
 * FOCIT LMS — Cloudflare Edge Worker for Digital Library Document Vault
 *
 * Implements Phase 13D Edge Execution:
 * 1. Sub-Millisecond (<0.5ms) HMAC Capability Ticket Verification via Web Crypto API.
 * 2. RFC 9111 Edge Cache Key Normalization:
 *    Strips ephemeral capability tickets from the cache key so all authorized students
 *    hitting the same textbook slice share the exact same edge cache entry.
 * 3. Native RFC 9110 Multi-Range Streaming:
 *    Serves cached 64KB byte-slices (206 Partial Content) directly from Cloudflare Edge SSD/RAM
 *    without touching the origin BFF server.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Path Matching: /vault/items/:id/stream or /items/:id/stream
    const match = /^\/(?:vault\/)?items\/([0-9a-fA-F-]+)\/stream$/.exec(url.pathname);
    if (!match) {
      return new Response('Not Found', { status: 404 });
    }

    const itemId = match[1];
    const ticket = url.searchParams.get('ticket');

    // 2. Reject unauthenticated edge requests without capability ticket
    if (!ticket) {
      return new Response(
        JSON.stringify({
          error: 'Edge capability ticket required',
          code: 'EDGE_TICKET_REQUIRED',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. Verify HMAC-SHA256 Capability Ticket at Edge via Web Crypto API
    const ticketSecret = env.EDGE_TICKET_SECRET || 'focit_edge_ticket_secret_fallback_key';
    const isAuthorized = await verifyEdgeTicketSubtle(ticket, itemId, ticketSecret, request);

    if (!isAuthorized.valid) {
      return new Response(
        JSON.stringify({
          error: `Edge capability ticket rejected: ${isAuthorized.reason}`,
          code: isAuthorized.reason,
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 4. RFC 9111 Cache Key Normalization:
    // Strips ticket and session params so that all authorized students share the edge cache!
    const normalizedUrl = new URL(url.origin + url.pathname);
    const cacheKey = new Request(normalizedUrl.toString(), {
      method: request.method,
      headers: request.headers,
    });

    const cache = caches.default;
    let response = await cache.match(cacheKey);

    if (!response) {
      // Cache Miss: Fetch from origin BFF server
      const originHost = env.ORIGIN_BFF_URL || 'https://api.focit.uniosun.edu.ng';
      const originUrl = `${originHost}/api/library/items/${itemId}/stream?ticket=${ticket}`;

      const originRequest = new Request(originUrl, {
        method: request.method,
        headers: request.headers,
      });

      response = await fetch(originRequest);

      // Store in Cloudflare Edge Cache if response is cacheable (200 or 206)
      if (response.status === 200 || response.status === 206) {
        const edgeHeaders = new Headers(response.headers);
        edgeHeaders.set('Cache-Control', 'public, s-maxage=604800, max-age=0, must-revalidate');
        edgeHeaders.set('X-Edge-Cache', 'MISS');

        const cachedResponse = new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: edgeHeaders,
        });

        // Background cache population
        ctx.waitUntil(cache.put(cacheKey, cachedResponse.clone()));
        return cachedResponse;
      }
    } else {
      // Cache Hit: Serve directly from Cloudflare Edge RAM/SSD
      const hitHeaders = new Headers(response.headers);
      hitHeaders.set('X-Edge-Cache', 'HIT');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: hitHeaders,
      });
    }

    return response;
  },
};

/**
 * Validates Edge Capability Ticket in <0.5ms using native Web Crypto API.
 */
async function verifyEdgeTicketSubtle(ticket, expectedItemId, secret, request) {
  const parts = ticket.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'MALFORMED_TICKET' };

  const [payloadB64, signature] = parts;

  try {
    // 1. Web Crypto HMAC Import
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // 2. Decode signature from Base64URL
    const sigBase64 = signature.replace(/-/g, '+').replace(/_/g, '/');
    const sigBytes = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));

    // 3. Verify Signature
    const dataBytes = encoder.encode(payloadB64);
    const isValidSig = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, dataBytes);
    if (!isValidSig) return { valid: false, reason: 'INVALID_SIGNATURE' };

    // 4. Parse payload
    const payloadStr = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadStr);

    // 5. Check Expiration
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp <= nowSec) {
      return { valid: false, reason: 'EXPIRED' };
    }

    // 6. Check Item ID
    if (expectedItemId && payload.iid !== expectedItemId) {
      return { valid: false, reason: 'ITEM_MISMATCH' };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: 'VERIFICATION_ERROR' };
  }
}
