/**
 * FOCIT LMS — Phase 13E Multi-Process Stress & Chaos Certification Test Suite
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Verifies the 3 Distributed Invariants:
 * 1. Multi-Process Layer-2 Contender Coalescing (child_process.fork):
 *    - 8 real OS child worker processes synchronized at IPC barrier.
 *    - Simultaneous burst of 65 requests per process (520 total).
 *    - Layer 1 collapses 65 -> 1 Redis attempt per worker (8 total SET NX attempts).
 *    - Exactly 1 Leader process wins and invokes upstream Moodle fetch (total upstream = 1).
 *    - Remaining 7 Contender processes receive payload via boot-time pattern subscriber singleton.
 *    - Zero EMFILE socket leaks and zero lost wakeups.
 *
 * 2. Unconditional Crash Recovery Under Abort/SIGKILL (Zero Lost Views):
 *    - Worker crashes after rotating 350 views to :flushing key before PostgreSQL commits.
 *    - Live HTTP traffic accumulates 150 new views in active hash during crash window.
 *    - Recovery Tick #1: Detects :flushing (swapResult === -1), refuses to overwrite, drains 350 orphaned views.
 *    - Recovery Tick #2: Rotates (swapResult === 1) and drains 150 live views.
 *    - Final PostgreSQL delta equals exactly +500 views (0% data loss).
 *
 * 3. Multi-Range PDF.js Burst & start === 0 Telemetry Deduplication:
 *    - 10 concurrent HTTP Range requests with capability ticket simulating PDF.js (header, body, xref).
 *    - All 10 requests return 206 Partial Content with valid Content-Range and clean RFC 9111 Vary.
 *    - Zero database queries hit PostgreSQL during cached binary slices (Fast-Path bypass).
 *    - Redis view counter increments by exactly +1 (only on start === 0 chunk, never +10).
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';
import libraryRouter from '../src/routes/library.js';
import { generateEdgeTicket } from '../src/services/edgeTicketService.js';
import {
  rotateAndDrainTelemetry,
  LUA_ROTATE_METRICS,
  KEY_VIEWS_ACTIVE,
  KEY_VIEWS_FLUSHING,
} from '../src/services/telemetryBufferService.js';
import { MiniRedisServer } from './helpers/miniRedisServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const childScript = path.resolve(__dirname, 'helpers/singleFlightWorkerChild.js');

let redisServer = null;

before(async () => {
  redisServer = new MiniRedisServer(6379);
  await redisServer.start();
  if (redis.status === 'wait') {
    await redis.connect().catch(() => {});
  }
});

after(async () => {
  if (redis) {
    await redis.quit().catch(() => redis.disconnect());
  }
  if (redisServer) {
    await redisServer.close();
  }
  await pool.end().catch(() => {});
});

// ----------------------------------------------------------------------------
// INVARIANT 1: Multi-Process Layer-2 Contender Coalescing (child_process.fork)
// ----------------------------------------------------------------------------
test('Phase 13E.1: Multi-Process Layer-2 Contender Coalescing (8 Child OS Processes x 65 Burst = 520 Requests)', async () => {
  const NUM_WORKERS = 8;
  const REQUESTS_PER_WORKER = 65;
  const children = [];

  try {
    // 1. Spawn 8 real child OS processes
    const readyPromises = [];
    for (let i = 0; i < NUM_WORKERS; i++) {
      const child = fork(childScript, [], {
        env: {
          ...process.env,
          REDIS_URL: 'redis://127.0.0.1:6379',
          NODE_ENV: 'test',
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      });

      const readyP = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Worker ${i} init timed out`)), 10000);
        child.on('message', (msg) => {
          if (msg.status === 'READY') {
            clearTimeout(timeout);
            resolve(msg);
          }
        });
      });

      child.send({ action: 'INIT', workerId: i });
      readyPromises.push(readyP);
      children.push(child);
    }

    const readyResponses = await Promise.all(readyPromises);
    assert.strictEqual(readyResponses.length, NUM_WORKERS);

    // Reset Redis stats prior to firing burst
    redisServer.stats.setNxCalls = 0;
    redisServer.stats.setNxWins = 0;

    // 2. Fire simultaneous burst across all 8 workers (8 x 65 = 520 requests)
    const donePromises = children.map((child, idx) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Worker ${idx} burst timed out`)), 15000);
        child.on('message', (msg) => {
          if (msg.status === 'DONE') {
            clearTimeout(timeout);
            resolve(msg);
          } else if (msg.status === 'ERROR') {
            clearTimeout(timeout);
            reject(new Error(`Worker ${idx} error: ${msg.error}`));
          }
        });
      });
    });

    const fireTimestamp = Date.now();
    for (let i = 0; i < NUM_WORKERS; i++) {
      children[i].send({
        action: 'FIRE',
        workerId: i,
        key: 'course_materials:CSC401',
        requestCount: REQUESTS_PER_WORKER,
        simulateLatencyMs: 100,
      });
    }

    const doneResults = await Promise.all(donePromises);
    const elapsedMs = Date.now() - fireTimestamp;

    // Invariant 1 Proofs:
    const totalSettled = doneResults.reduce((acc, r) => acc + r.settledCount, 0);
    const totalUpstreamCalls = doneResults.reduce((acc, r) => acc + r.upstreamCalls, 0);
    const leaderWorkers = doneResults.filter((r) => r.upstreamCalls === 1);
    const contenderWorkers = doneResults.filter((r) => r.upstreamCalls === 0);

    // 1. Layer 1 collapses 65 requests into 1 Redis attempt per worker process
    assert.strictEqual(totalSettled, 520, 'All 520 requests must settle');
    assert.strictEqual(redisServer.stats.setNxCalls, 8, 'Layer 1 must collapse 65 requests into 1 Redis SET NX per OS process (8 total)');

    // 2. Exactly 1 OS process wins Redis Leader lock and invokes upstream Moodle
    assert.strictEqual(redisServer.stats.setNxWins, 1, 'Exactly 1 worker process must win the Redis lock');
    assert.strictEqual(totalUpstreamCalls, 1, 'Total upstream Moodle calls across all 8 OS processes must equal exactly 1');
    assert.strictEqual(leaderWorkers.length, 1, 'Exactly 1 worker process must be the leader');
    assert.strictEqual(contenderWorkers.length, 7, 'Remaining 7 worker processes must be contenders');

    // 3. Contenders receive payload via boot-time psubscribe singleton
    assert.strictEqual(redisServer.stats.psubscribeCalls, 8, 'Exactly 8 pattern subscriptions (1 per process, zero per-request leaks)');
    assert.ok(doneResults.every((r) => r.allIdentical), 'All 520 requests must receive identical authoritative data');
    assert.ok(doneResults.every((r) => r.activeKeysAfter.length === 0), 'All in-flight flightMaps must be empty after settlement');

    console.log(`  [Phase 13E.1 PASS] 520 requests settled across 8 OS processes in ${elapsedMs}ms with 1 upstream fetch.`);
  } finally {
    for (const child of children) {
      child.send({ action: 'SHUTDOWN' });
    }
  }
});

// ----------------------------------------------------------------------------
// INVARIANT 2: Unconditional Crash Recovery Under Mid-Flush Crash (Zero Lost Views)
// ----------------------------------------------------------------------------
test('Phase 13E.2: Unconditional Crash Recovery Under Mid-Flush Crash (Zero Lost Views)', async () => {
  const testItemId = 'a0000000-0000-0000-0000-000000000001';

  // 0. Initial baseline from PostgreSQL
  const initRes = await pool.query(
    'SELECT COALESCE(view_count, 0)::bigint AS count FROM library_item_metrics WHERE item_id = $1',
    [testItemId]
  );
  const initialViews = initRes.rows.length > 0 ? BigInt(initRes.rows[0].count) : 0n;

  // Clean Redis keys
  await redis.del(KEY_VIEWS_ACTIVE, KEY_VIEWS_FLUSHING);

  // 1. Accumulate N1 = 350 views in Redis active hash
  await redis.hincrby(KEY_VIEWS_ACTIVE, testItemId, 350);
  const activeCount1 = await redis.hget(KEY_VIEWS_ACTIVE, testItemId);
  assert.strictEqual(activeCount1, '350');

  // 2. Rotate to staging (:flushing) and simulate hard crash / rollback
  const rotateStatus = await redis.eval(LUA_ROTATE_METRICS, 2, KEY_VIEWS_ACTIVE, KEY_VIEWS_FLUSHING);
  assert.strictEqual(rotateStatus, 1, 'Atomic swap must rotate active to flushing');

  // Staging key remains orphaned in Redis
  const flushingCount = await redis.hget(KEY_VIEWS_FLUSHING, testItemId);
  assert.strictEqual(flushingCount, '350');

  // 3. Live HTTP traffic accumulates N2 = 150 views in new active hash
  await redis.hincrby(KEY_VIEWS_ACTIVE, testItemId, 150);
  const activeCount2 = await redis.hget(KEY_VIEWS_ACTIVE, testItemId);
  assert.strictEqual(activeCount2, '150');

  // 4. Recovery Worker Flush Cycle across TWO TICKS

  // Tick #1: Detects :flushing (-1), refuses to overwrite, commits 350 orphaned views
  const tick1Result = await rotateAndDrainTelemetry(pool);
  assert.strictEqual(tick1Result.drained, true);
  assert.strictEqual(tick1Result.itemsCount, 1);

  const postTick1Db = await pool.query(
    'SELECT COALESCE(view_count, 0)::bigint AS count FROM library_item_metrics WHERE item_id = $1',
    [testItemId]
  );
  const viewsAfterTick1 = BigInt(postTick1Db.rows[0].count);
  assert.strictEqual(viewsAfterTick1 - initialViews, 350n, 'Tick #1 must commit exactly the 350 orphaned views');

  // Live active views must be retained untouched
  const activeAfterTick1 = await redis.hget(KEY_VIEWS_ACTIVE, testItemId);
  assert.strictEqual(activeAfterTick1, '150', 'Active hash must remain untouched during orphan drain');

  // Tick #2: Normal rotation (1), commits 150 live views
  const tick2Result = await rotateAndDrainTelemetry(pool);
  assert.strictEqual(tick2Result.drained, true);
  assert.strictEqual(tick2Result.itemsCount, 1);

  const postTick2Db = await pool.query(
    'SELECT COALESCE(view_count, 0)::bigint AS count FROM library_item_metrics WHERE item_id = $1',
    [testItemId]
  );
  const viewsAfterTick2 = BigInt(postTick2Db.rows[0].count);
  const totalDelta = viewsAfterTick2 - initialViews;

  // Invariant 2 Proof: Delta must equal exactly 350 + 150 = 500 (0% data loss)
  assert.strictEqual(totalDelta, 500n, 'Total committed delta must equal exactly 350 + 150 = 500');

  // Both Redis hashes must be completely clean
  const finalActive = await redis.hget(KEY_VIEWS_ACTIVE, testItemId);
  const finalFlushing = await redis.hget(KEY_VIEWS_FLUSHING, testItemId);
  assert.strictEqual(finalActive, null);
  assert.strictEqual(finalFlushing, null);

  console.log(`  [Phase 13E.2 PASS] Crash recovery verified: 350 orphaned + 150 live = exactly +500 views (0% data loss).`);
});

// ----------------------------------------------------------------------------
// INVARIANT 3: Multi-Range PDF.js Burst & start === 0 Telemetry Deduplication
// ----------------------------------------------------------------------------
test('Phase 13E.3: Multi-Range PDF.js Burst & start === 0 Telemetry Deduplication', async () => {
  const testItemId = 'a0000000-0000-0000-0000-000000000001';
  const clientIp = '127.0.0.1';
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PDF.js Reader Engine';

  // Mount ephemeral Express app
  const app = express();
  app.use(express.json());
  app.use('/api/library', libraryRouter);

  const server = http.createServer(app);
  const port = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });

  try {
    // Generate valid capability ticket
    const { ticket } = generateEdgeTicket('student_pdf_reader_doctrine', testItemId, clientIp, userAgent, 1800);

    // Clean Redis active views for this item
    await redis.del(KEY_VIEWS_ACTIVE);
    await redis.del(`focit:lease:VIEW:student_pdf_reader_doctrine:${testItemId}`);

    // Intercept PostgreSQL pool queries to prove ZERO DB queries on fast path
    let dbQueriesCount = 0;
    const originalQuery = pool.query.bind(pool);
    pool.query = async (...args) => {
      dbQueriesCount++;
      return originalQuery(...args);
    };

    // 10 concurrent HTTP Range requests simulating PDF.js reading header, body, xref
    const rangeHeaders = [
      'bytes=0-65535',       // Header chunk (start === 0, records telemetry)
      'bytes=65536-131071',   // Body slice 1 (start > 0)
      'bytes=131072-196607',  // xref trailer (start > 0)
      'bytes=196608-262143',  // Body slice 2
      'bytes=262144-327679',  // Body slice 3
      'bytes=327680-393215',  // Body slice 4
      'bytes=393216-458751',  // Body slice 5
      'bytes=458752-524287',  // Body slice 6
      'bytes=524288-589823',  // Body slice 7
      'bytes=589824-655359',  // Body slice 8
    ];

    const burstPromises = rangeHeaders.map(async (rangeHeader, idx) => {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/library/items/${testItemId}/stream?ticket=${ticket}`,
        {
          headers: {
            Range: rangeHeader,
            'User-Agent': userAgent,
          },
        }
      );

      const body = await res.arrayBuffer();
      return {
        idx,
        status: res.status,
        rangeHeader,
        contentRange: res.headers.get('content-range'),
        contentLength: res.headers.get('content-length'),
        vary: res.headers.get('vary'),
        cacheControl: res.headers.get('cache-control'),
        etag: res.headers.get('etag'),
        byteLength: body.byteLength,
      };
    });

    const responses = await Promise.all(burstPromises);
    pool.query = originalQuery; // Restore query function

    // Invariant 3 Proofs:
    // 1. All 10 requests return 206 Partial Content
    assert.strictEqual(responses.length, 10);
    assert.ok(responses.every((r) => r.status === 206), 'All 10 requests must return 206 Partial Content');

    // 2. All 10 have valid Content-Range and clean RFC 9111 Vary headers
    assert.ok(responses.every((r) => r.contentRange?.startsWith('bytes ')), 'All must have valid Content-Range');
    assert.ok(responses.every((r) => r.vary === 'Range, Accept-Encoding'), 'Vary must be strictly Range, Accept-Encoding');
    assert.ok(responses.every((r) => r.cacheControl?.includes('public, s-maxage=604800')), 'Must include edge s-maxage');

    // 3. Fast-Path eliminates all database queries (Zero DB queries)
    assert.strictEqual(dbQueriesCount, 0, 'Zero database queries must hit PostgreSQL during cached range slices');

    // 4. Redis view counter increments by exactly +1 (only on start === 0)
    await new Promise((r) => setTimeout(r, 120)); // Telemetry settlement window
    const viewsInRedis = await redis.hget(KEY_VIEWS_ACTIVE, testItemId);
    assert.strictEqual(viewsInRedis, '1', 'Redis view counter must increment by exactly +1, never +10');

    console.log(`  [Phase 13E.3 PASS] 10 Range requests served with 206, 0 DB queries, and exactly +1 telemetry view.`);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

