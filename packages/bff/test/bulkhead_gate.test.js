import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createBulkheadGate } from '../src/middleware/bulkheadGate.js';

describe('Bulkhead Concurrency Gate Doctrine', () => {
  it('allows requests up to maxConcurrent limit', () => {
    const gate = createBulkheadGate(3, 'STAFF');
    let accepted = 0;

    const mockReq = { originalUrl: '/api/admin/dashboard' };
    const createMockRes = () => {
      const res = new EventEmitter();
      res.status = () => res;
      res.set = () => res;
      res.json = () => res;
      return res;
    };

    // First 3 requests admitted
    for (let i = 0; i < 3; i++) {
      gate(mockReq, createMockRes(), () => {
        accepted++;
      });
    }

    assert.equal(accepted, 3, 'Expected first 3 requests to be accepted');
  });

  it('rejects the (maxConcurrent + 1)th request with HTTP 429 and Retry-After', () => {
    const gate = createBulkheadGate(2, 'STAFF');
    const mockReq = { originalUrl: '/api/hod/analytics' };
    const resList = [];

    const createMockRes = () => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      res.status = (code) => { res.statusCode = code; return res; };
      res.set = (k, v) => { res.headers[k] = v; return res; };
      res.json = (body) => { res.body = body; return res; };
      return res;
    };

    // Fill capacity
    for (let i = 0; i < 2; i++) {
      const res = createMockRes();
      resList.push(res);
      gate(mockReq, res, () => {});
    }

    // 3rd request must be rejected
    const saturatedRes = createMockRes();
    let nextCalled = false;
    gate(mockReq, saturatedRes, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'Should not have called next() when saturated');
    assert.equal(saturatedRes.statusCode, 429, 'Expected HTTP 429');
    assert.equal(saturatedRes.headers['Retry-After'], '3', 'Expected Retry-After: 3');
    assert.equal(saturatedRes.body?.code, 'BULKHEAD_CAPACITY_EXCEEDED');

    // Complete one request
    resList[0].emit('finish');

    // 4th request should now be admitted
    let admittedAfterRelease = false;
    const retryRes = createMockRes();
    gate(mockReq, retryRes, () => { admittedAfterRelease = true; });

    assert.equal(admittedAfterRelease, true, 'Expected slot to be freed after finish event');
  });

  it('reclaims concurrency slot on client socket drop (close event)', () => {
    const gate = createBulkheadGate(1, 'STAFF');
    const mockReq = { originalUrl: '/api/lecturer/courses/CSC204/roster/export' };

    const createMockRes = () => {
      const res = new EventEmitter();
      res.status = () => res;
      res.set = () => res;
      res.json = () => res;
      return res;
    };

    const droppedRes = createMockRes();
    gate(mockReq, droppedRes, () => {});

    // Saturated
    const saturatedRes = createMockRes();
    let admitted = false;
    gate(mockReq, saturatedRes, () => { admitted = true; });
    assert.equal(admitted, false);

    // Client drops connection prematurely
    droppedRes.emit('close');

    // Now permitted
    let admittedAfterClose = false;
    const nextRes = createMockRes();
    gate(mockReq, nextRes, () => { admittedAfterClose = true; });
    assert.equal(admittedAfterClose, true, 'Slot must be reclaimed on close event');
  });
});
