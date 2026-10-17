import test from 'node:test';
import assert from 'node:assert';
import { errorHandler } from '../src/middleware/errorHandler.js';

test.describe('OWASP API8 Error Sanitization & RFC 7807 Quarantine Verification', () => {
  test('Known check constraint translates to typed domain code without leaking raw symbols', () => {
    let statusCode = null;
    let jsonPayload = null;

    const mockReq = {
      originalUrl: '/api/student/registration/submit',
      id: 'req_known_123',
      headers: {},
    };

    const mockRes = {
      status: (code) => {
        statusCode = code;
        return mockRes;
      },
      json: (data) => {
        jsonPayload = data;
        return mockRes;
      },
      headersSent: false,
    };

    const knownCheckError = new Error('check constraint failed');
    knownCheckError.code = '23514';
    knownCheckError.constraint = 'chk_max_credit_limit_24';
    knownCheckError.table = 'enrollments';

    errorHandler(knownCheckError, mockReq, mockRes, () => {});

    assert.strictEqual(statusCode, 422);
    assert.strictEqual(jsonPayload.code, 'MAX_CREDIT_CEILING_EXCEEDED');
    assert.strictEqual(jsonPayload.title, 'Academic Credit Ceiling Exceeded');
    assert.strictEqual(jsonPayload.maxCeiling, 24);
    assert.strictEqual(jsonPayload.correlationId, 'req_known_123');
    assert.strictEqual(jsonPayload.constraint, undefined);
  });

  test('Unmapped 23514 check constraint is fully redacted with ZERO schema leaks', () => {
    let statusCode = null;
    let jsonPayload = null;

    const mockReq = {
      originalUrl: '/api/student/courses/register',
      id: 'req_unmapped_456',
      headers: {},
    };

    const mockRes = {
      status: (code) => {
        statusCode = code;
        return mockRes;
      },
      json: (data) => {
        jsonPayload = data;
        return mockRes;
      },
      headersSent: false,
    };

    const maliciousInternalError = new Error('Database check failed');
    maliciousInternalError.code = '23514';
    maliciousInternalError.constraint = 'chk_secret_internal_rule';
    maliciousInternalError.table = 'student_transcripts_confidential';
    maliciousInternalError.detail = 'Failing row contains (student1, SECRET_CREDITS_99)';

    errorHandler(maliciousInternalError, mockReq, mockRes, () => {});

    // Positive RFC 7807 Assertions
    assert.strictEqual(statusCode, 422);
    assert.strictEqual(jsonPayload.code, 'ACADEMIC_INVARIANT_VIOLATION');
    assert.strictEqual(jsonPayload.title, 'Academic Invariant Validation Failed');
    assert.strictEqual(jsonPayload.correlationId, 'req_unmapped_456');

    // Negative Zero-Leakage Audit
    assert.strictEqual(jsonPayload.constraint, undefined);
    assert.strictEqual(jsonPayload.table, undefined);
    assert.strictEqual(jsonPayload.detail.includes('chk_secret_internal_rule'), false);
    assert.strictEqual(jsonPayload.detail.includes('SECRET_CREDITS_99'), false);

    const serializedPayload = JSON.stringify(jsonPayload);
    assert.strictEqual(serializedPayload.includes('chk_secret_internal_rule'), false);
    assert.strictEqual(serializedPayload.includes('SECRET_CREDITS_99'), false);
    assert.strictEqual(serializedPayload.includes('student_transcripts_confidential'), false);
  });
});
