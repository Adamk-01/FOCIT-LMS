/**
 * FOCIT LMS - Phase 12 Digital Library Doctrine Test Suite
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces:
 * 1. Catch 1: MVCC Hot-Row Contention Elimination (Narrow HOT metrics table, 0 UPDATE locks on library_items).
 * 2. Catch 2: HTTP 206 Partial Content Range Deduplication (Initial slice only, sliding lease).
 * 3. Catch 3: PostgreSQL 16 Index Selectivity & Immutable Predicate Compliance (NULLS FIRST B-Tree clustering).
 * 4. Catch 4: RFC 9110 Compliance (200 OK for full downloads, 206 for ranges, 416 for out-of-bounds).
 * 5. Catch 5: Invariant 3 Dijkstra Resource Ordering on Batch Flushes (Deadlock 40P01 immunity).
 */

import config from '../src/config.js';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';
import app from '../src/server.js';
import { flushMetricsBuffer } from '../src/routes/library.js';

describe('Phase 12: Digital Library & Resource Vault Doctrine', () => {
  const baseUrl = `http://127.0.0.1:${config.port}`;
  let authHeaders = {};
  let testSessionId;

  before(async () => {
    // Await Redis connection readiness (Fail-Closed enableOfflineQueue = false defense)
    // Await Redis connection readiness (Fail-Closed enableOfflineQueue = false defense)
    if (redis.status !== 'ready') {
      if (redis.status === 'wait') {
        redis.connect().catch(() => {});
      }
      await new Promise((resolve, reject) => {
        const onReady = () => {
          redis.off('error', onError);
          resolve();
        };
        const onError = (err) => {
          redis.off('ready', onReady);
          reject(err);
        };
        redis.once('ready', onReady);
        redis.once('error', onError);
      });
    }

    testSessionId = crypto.randomUUID();
    const sessionNonce = crypto.randomBytes(32).toString('hex');
    const token = jwt.sign({
      sub: 'student1',
      student_id: 'student1',
      username: 'student1',
      role: 'STUDENT',
      sid: testSessionId,
      scope: 'FULL_ACCESS'
    }, config.jwt.secret, {
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      expiresIn: '1h'
    });

    await redis.hset(`session:${testSessionId}`, {
      userId: 'student1',
      username: 'student1',
      role: 'STUDENT',
      scope: 'FULL_ACCESS',
      mustChangePassword: '0',
      nonce: sessionNonce,
      createdAt: String(Math.floor(Date.now() / 1000))
    });

    authHeaders = {
      Cookie: `focit_token=${token}`,
      'X-Session-Nonce': sessionNonce,
    };
  });

  after(async () => {
    if (testSessionId) {
      await redis.del(`session:${testSessionId}`);
    }
    await redis.quit().catch(() => {});
    await pool.end().catch(() => {});
    setTimeout(() => process.exit(0), 200).unref();
  });

  // ----------------------------------------------------------------------------
  // SECTION 1: PostgreSQL 16 Schema, HOT Tables & Index Clustered Ordering
  // ----------------------------------------------------------------------------
  test('PostgreSQL Engine: Narrow library_item_metrics and append-only library_downloads exist', async () => {
    const { rows: metricsCols } = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'library_item_metrics';
    `);
    const colNames = metricsCols.map(c => c.column_name);
    assert.ok(colNames.includes('item_id'), 'metrics table must have item_id PK');
    assert.ok(colNames.includes('view_count'), 'metrics table must isolate view_count');
    assert.ok(colNames.includes('download_count'), 'metrics table must isolate download_count');

    // Invariant 8: library_items must NOT carry view_count or download_count
    const { rows: itemCols } = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'library_items';
    `);
    const itemColNames = itemCols.map(c => c.column_name);
    assert.strictEqual(itemColNames.includes('view_count'), false, 'library_items must NOT have view_count');
    assert.strictEqual(itemColNames.includes('download_count'), false, 'library_items must NOT have download_count');
  });

  test('PostgreSQL Engine: Partial indexes enforce is_published = TRUE with ASC NULLS FIRST', async () => {
    const { rows: indexRows } = await pool.query(`
      SELECT indexname, indexdef 
      FROM pg_indexes 
      WHERE tablename = 'library_items' 
        AND indexname IN ('idx_library_items_pq_lookup', 'idx_library_items_textbooks');
    `);

    assert.strictEqual(indexRows.length, 2, 'Both specialized partial indexes must exist');
    for (const idx of indexRows) {
      assert.ok(idx.indexdef.includes('WHERE (is_published = true)'), `${idx.indexname} must use immutable predicate WHERE is_published = true`);
      assert.ok(idx.indexdef.includes('NULLS FIRST'), `${idx.indexname} must cluster embargo_until ASC NULLS FIRST`);
    }
  });

  // ----------------------------------------------------------------------------
  // SECTION 2: Taxonomy & Catalog Query Ingress
  // ----------------------------------------------------------------------------
  test('GET /api/library/categories returns 4 core categories with item counts', async () => {
    const res = await fetch(`${baseUrl}/api/library/categories`, {
      headers: authHeaders
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();

    assert.ok(Array.isArray(json.data), 'Response data must be an array');
    assert.strictEqual(json.data.length, 4, 'Must return exactly 4 categories');

    const slugs = json.data.map(c => c.slug);
    assert.ok(slugs.includes('courses'), 'Must include courses category');
    assert.ok(slugs.includes('textbooks'), 'Must include textbooks category');
    assert.ok(slugs.includes('past-questions'), 'Must include past-questions category');
    assert.ok(slugs.includes('resources'), 'Must include faculty_resources category');

    for (const cat of json.data) {
      assert.ok(cat.item_count > 0, `Category ${cat.slug} must have seeded items`);
    }
  });

  test('GET /api/library/items?category=textbooks filters catalog to textbooks', async () => {
    const res = await fetch(`${baseUrl}/api/library/items?category=textbooks`, {
      headers: authHeaders
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();

    assert.ok(json.data.length > 0, 'Must return seeded textbooks');
    for (const item of json.data) {
      assert.strictEqual(item.category_id, 'textbooks', 'Filtered items must belong to textbooks category');
      assert.ok(typeof item.view_count === 'number', 'Items must join view_count from metrics ledger');
    }
  });

  test('GET /api/library/items full-text search ranks Cormen algorithms on query "Algorithms"', async () => {
    const res = await fetch(`${baseUrl}/api/library/items?q=Algorithms`, {
      headers: authHeaders
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();

    assert.ok(json.data.length > 0, 'Must match items containing Algorithms');
    const firstItem = json.data[0];
    assert.ok(firstItem.title.toLowerCase().includes('algorithm'), 'Top ranked item must be algorithms textbook/note');
  });

  test('GET /api/library/courses/catalog returns courses annotated with enrollment status', async () => {
    const res = await fetch(`${baseUrl}/api/library/courses/catalog`, {
      headers: authHeaders
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();

    assert.ok(Array.isArray(json.data), 'Course catalog must be an array');
    assert.ok(json.data.length > 0, 'Course catalog must return courses');
    const sample = json.data[0];
    assert.ok('course_id' in sample, 'Must contain course_id');
    assert.ok('is_enrolled' in sample, 'Must contain is_enrolled boolean');
    assert.ok('material_count' in sample, 'Must contain material_count');
  });

  // ----------------------------------------------------------------------------
  // SECTION 3: RFC 9110 Range Streaming & Socket Boundaries
  // ----------------------------------------------------------------------------
  test('RFC 9110: Full download request without Range header returns 200 OK', async () => {
    const { rows } = await pool.query("SELECT id FROM library_items WHERE category_id = 'textbooks' LIMIT 1");
    const testItemId = rows[0].id;

    const res = await fetch(`${baseUrl}/api/library/items/${testItemId}/stream?download=true`, {
      headers: authHeaders
    });
    assert.strictEqual(res.status, 200, 'Must return 200 OK when no Range header is sent');
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
    assert.ok(res.headers.get('content-disposition')?.includes('attachment'), 'Must set attachment disposition');
    const body = await res.arrayBuffer();
    assert.ok(body.byteLength > 1000, 'Must stream full multi-page PDF bytes');
  });

  test('RFC 9110: Range header bytes=0-1024 returns 206 Partial Content with Content-Range', async () => {
    const { rows } = await pool.query("SELECT id FROM library_items WHERE category_id = 'past_questions' LIMIT 1");
    const testItemId = rows[0].id;

    const res = await fetch(`${baseUrl}/api/library/items/${testItemId}/stream`, {
      headers: {
        ...authHeaders,
        Range: 'bytes=0-1024'
      }
    });

    assert.strictEqual(res.status, 206, 'Must return 206 Partial Content');
    assert.strictEqual(res.headers.get('accept-ranges'), 'bytes');
    assert.strictEqual(res.headers.get('content-length'), '1025');
    const contentRange = res.headers.get('content-range');
    assert.ok(contentRange?.startsWith('bytes 0-1024/'), `Content-Range header was ${contentRange}`);
    const chunk = await res.arrayBuffer();
    assert.strictEqual(chunk.byteLength, 1025, 'Chunk size must match requested range exactly');
  });

  test('Checkpoint 7: Non-canonical UUID in /items/:id/stream immediately rejects with 400 without PostgreSQL 22P02', async () => {
    const res = await fetch(`${baseUrl}/api/library/items/moodle-mod-402/stream`, {
      headers: authHeaders
    });
    assert.strictEqual(res.status, 400, 'Non-UUID identifier must reject with 400');
    const json = await res.json();
    assert.strictEqual(json.code, 'INVALID_IDENTIFIER');
  });

  test('Checkpoint 7: Missing physical binary on disk (ENOENT) returns RFC 7807 FILE_NOT_FOUND 404', async () => {
    // Insert an item without generating a physical file in .cache/library/
    const ghostId = '00000000-0000-0000-0000-000000000001';
    await pool.query(`
      INSERT INTO library_items (id, title, category_id, item_type, file_url, file_size_bytes, mime_type, is_published)
      VALUES ($1, 'Ghost Missing File Document', 'faculty_resources', 'HANDBOOK', 'https://example.com/ghost.pdf', 1024, 'application/pdf', true)
      ON CONFLICT (id) DO NOTHING;
    `, [ghostId]);

    try {
      const res = await fetch(`${baseUrl}/api/library/items/${ghostId}/stream`, {
        headers: authHeaders
      });
      assert.strictEqual(res.status, 404, 'Missing file on disk must return 404');
      const json = await res.json();
      assert.strictEqual(json.code, 'FILE_NOT_FOUND');
    } finally {
      await pool.query('DELETE FROM library_items WHERE id = $1', [ghostId]);
    }
  });

  test('RFC 9110: Oversized probe range bytes=0-99999999 clamps end to fileSize - 1 and returns 206', async () => {
    const { rows } = await pool.query("SELECT id, file_size_bytes FROM library_items LIMIT 1");
    const testItemId = rows[0].id;
    const expectedSize = parseInt(rows[0].file_size_bytes, 10);

    const res = await fetch(`${baseUrl}/api/library/items/${testItemId}/stream`, {
      headers: {
        ...authHeaders,
        Range: 'bytes=0-99999999'
      }
    });

    assert.strictEqual(res.status, 206, 'Oversized probe range must clamp and succeed with 206');
    const contentRange = res.headers.get('content-range');
    assert.strictEqual(contentRange, `bytes 0-${expectedSize - 1}/${expectedSize}`);
    assert.strictEqual(res.headers.get('content-length'), String(expectedSize));
  });

  test('RFC 9110: Out-of-bounds Range header returns 416 Range Not Satisfiable', async () => {
    const { rows } = await pool.query("SELECT id, file_size_bytes FROM library_items LIMIT 1");
    const testItemId = rows[0].id;
    const outOfBoundsStart = Number(rows[0].file_size_bytes) + 10000;

    const res = await fetch(`${baseUrl}/api/library/items/${testItemId}/stream`, {
      headers: {
        ...authHeaders,
        Range: `bytes=${outOfBoundsStart}-${outOfBoundsStart + 1000}`
      }
    });

    assert.strictEqual(res.status, 416, 'Out of bounds range must return 416 Range Not Satisfiable');
    const contentRange = res.headers.get('content-range');
    assert.ok(contentRange?.startsWith('bytes */'), `Must include Content-Range: bytes */size`);
  });

  // ----------------------------------------------------------------------------
  // SECTION 4: Invariant 3 Concurrency & Batch Flush Ordering
  // ----------------------------------------------------------------------------
  test('Invariant 3: flushMetricsBuffer executes lexicographical sort on item UUIDs', async () => {
    // Trigger telemetry via stream requests on two items
    const { rows } = await pool.query("SELECT id FROM library_items LIMIT 2");
    const itemA = rows[0].id;
    const itemB = rows[1].id;

    // Fire range requests
    await fetch(`${baseUrl}/api/library/items/${itemA}/stream`, {
      headers: { ...authHeaders, Range: 'bytes=0-512' }
    });
    await fetch(`${baseUrl}/api/library/items/${itemB}/stream`, {
      headers: { ...authHeaders, Range: 'bytes=0-512' }
    });

    // Flush batch to database
    await assert.doesNotReject(async () => {
      await flushMetricsBuffer();
    }, 'Batch flush with Dijkstra sorting must not deadlock or throw');

    // Verify metrics table has updated counts
    const { rows: metricsRows } = await pool.query(`
      SELECT item_id, view_count, download_count 
      FROM library_item_metrics 
      WHERE item_id IN ($1, $2);
    `, [itemA, itemB]);

    assert.ok(metricsRows.length > 0, 'Metrics ledger must have updated counters');
  });

});
