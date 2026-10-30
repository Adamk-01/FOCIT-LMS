import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { submissionPreUploadBarrier } from '../src/routes/assignments.js';
import { redis } from '../src/lib/redis.js';
import { pool } from '../src/db/index.js';

describe('Phase 11A: Pre-Upload Mutex Barrier & Idempotency Defense', () => {
  after(async () => {
    try {
      if (redis && typeof redis.quit === 'function') await redis.quit();
    } catch (_) {}
    try {
      if (pool && typeof pool.end === 'function') await pool.end();
    } catch (_) {}
  });

  it('rejects unauthenticated requests before checking headers or inspecting disk', async () => {
    let nextCalled = false;
    const req = {
      params: { assignmentId: 'a0000000-0000-0000-0000-000000000001' },
      user: null,
      headers: {},
    };
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      },
      on() {},
    };

    await submissionPreUploadBarrier(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
    assert.equal(jsonBody.code, 'AUTH_REQUIRED');
  });

  it('rejects requests with missing or short (<8 chars) X-Idempotency-Key without invoking Busboy', async () => {
    let nextCalled = false;
    const req = {
      params: { assignmentId: 'a0000000-0000-0000-0000-000000000001' },
      user: { student_id: 'student1' },
      headers: { 'x-idempotency-key': 'short' },
    };
    let statusCode = null;
    let jsonBody = null;
    const res = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        jsonBody = body;
        return this;
      },
      on() {},
    };

    await submissionPreUploadBarrier(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
    assert.equal(jsonBody.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('advances to next() when valid student and idempotency key are provided', async () => {
    let nextCalled = false;
    const testKey = `test_key_valid_${Date.now()}`;
    const req = {
      params: { assignmentId: 'a0000000-0000-0000-0000-000000000001' },
      user: { student_id: 'student1' },
      headers: { 'x-idempotency-key': testKey },
    };
    const res = {
      status() { return this; },
      json() { return this; },
      set() { return this; },
      on() {},
    };

    await submissionPreUploadBarrier(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});
