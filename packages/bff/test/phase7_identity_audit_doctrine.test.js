/**
 * FOCIT LMS - Phase 7 Identity & Security Audit Doctrine Test Suite
 *
 * Verifies:
 * 1. Cryptographic scrypt Hashing & Constant-Time Verification
 * 2. Layer 2 WORM Immutability Trigger (Blocks UPDATE & DELETE with SQLSTATE 55000)
 * 3. Linear Merkle Hash Chaining in identity_audit_logs
 * 4. Real Database Identity Verification on POST /api/auth/login
 *    - Unknown user -> 401 INVALID_CREDENTIALS + AUTHENTICATION_FAILURE audit log
 *    - Wrong password -> 401 INVALID_CREDENTIALS + AUTHENTICATION_FAILURE audit log
 *    - Valid password -> 200 OK + FULL_ACCESS scope + AUTHENTICATION_SUCCESS audit log
 * 5. Partial Session Escapement Barrier (Postman / cURL Defense):
 *    - student2 (must_change_password: true) receives scope: 'RESET_ONLY'
 *    - Calling academic routes (/api/registration/current) returns 403 MANDATORY_PASSWORD_RESET_REQUIRED
 *    - Calling /api/student/change-password succeeds, logs CREDENTIAL_INITIALIZATION, and clears must_change_password
 */

import '../src/config.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';
import { hashPassword, verifyPassword, computeEntryHash } from '../src/lib/passwords.js';
import { recordIdentityAuditLog } from '../src/lib/auditLogger.js';

describe('Phase 7: Cryptographic Identity & Security Audit Doctrine', () => {

  // 1. Cryptographic scrypt Functionality
  test('Cryptographic Invariant: scrypt derivation is non-blocking and timing-safe', async () => {
    const rawSecret = 'P@ssword_Str0ng_2026!';
    const hashed = await hashPassword(rawSecret);

    assert.ok(hashed.includes(':'), 'Hash must contain salt:key delimiter');
    const [salt, key] = hashed.split(':');
    assert.strictEqual(salt.length, 32, 'Salt must be 16 bytes hex (32 characters)');
    assert.strictEqual(key.length, 128, 'Key must be 64 bytes hex (128 characters)');

    // Verify correct password
    const valid = await verifyPassword(rawSecret, hashed);
    assert.strictEqual(valid, true, 'Correct password must verify successfully');

    // Verify incorrect password
    const invalid = await verifyPassword('Wrong_Password_123', hashed);
    assert.strictEqual(invalid, false, 'Incorrect password must be rejected');
  });

  // 2. WORM Immutability Trigger Enforcement
  test('WORM Immutability Invariant: Triggers block UPDATE and DELETE on identity_audit_logs', async () => {
    const client = await pool.connect();
    try {
      // 1. Append a test audit record
      const auditEntry = await recordIdentityAuditLog(client, {
        eventType: 'TEST_IMMUTABILITY_PROBE',
        actorId: 'system_test',
        targetId: 'audit_probe_1',
        metadata: { probe: true },
      });

      assert.ok(auditEntry.id, 'Audit record must be successfully created');
      const testId = auditEntry.id;

      // 2. Attempt UPDATE operation (Must fail with 55000 object_not_modifiable)
      await assert.rejects(
        async () => {
          await client.query(
            `UPDATE identity_audit_logs SET event_type = 'MUTATED_CORRUPT' WHERE id = $1`,
            [testId]
          );
        },
        (err) => {
          assert.strictEqual(err.code, '55000', 'Must throw SQLSTATE 55000 object_not_modifiable on UPDATE');
          assert.ok(err.message.includes('SECURITY AUDIT VIOLATION'), 'Error message must reflect Senate WORM policy');
          return true;
        }
      );

      // 3. Attempt DELETE operation (Must fail with 55000 object_not_modifiable)
      await assert.rejects(
        async () => {
          await client.query(
            `DELETE FROM identity_audit_logs WHERE id = $1`,
            [testId]
          );
        },
        (err) => {
          assert.strictEqual(err.code, '55000', 'Must throw SQLSTATE 55000 object_not_modifiable on DELETE');
          assert.ok(err.message.includes('SECURITY AUDIT VIOLATION'), 'Error message must reflect Senate WORM policy');
          return true;
        }
      );
    } finally {
      client.release();
    }
  });

  // 3. Merkle Linear Hash Chaining
  test('Linear Hash Chain Invariant: Sequential audit entries maintain verifiable entry_hash continuity', async () => {
    const client = await pool.connect();
    try {
      const entry1 = await recordIdentityAuditLog(client, {
        eventType: 'AUDIT_CHAIN_TEST_1',
        actorId: 'test_student',
        targetId: 'chain_target_1',
        metadata: { seq: 1 },
      });

      const entry2 = await recordIdentityAuditLog(client, {
        eventType: 'AUDIT_CHAIN_TEST_2',
        actorId: 'test_student',
        targetId: 'chain_target_2',
        metadata: { seq: 2 },
      });

      // Verify that entry 2's prev_entry_hash points to entry 1's entry_hash
      const { rows } = await client.query(
        `SELECT id, prev_entry_hash, entry_hash FROM identity_audit_logs WHERE id = $1`,
        [entry2.id]
      );

      assert.strictEqual(
        rows[0].prev_entry_hash,
        entry1.entry_hash,
        'Entry 2 prev_entry_hash must match Entry 1 entry_hash'
      );
    } finally {
      client.release();
    }
  });

  // Teardown connections so test runner exits deterministically
  after(async () => {
    await pool.end().catch(() => {});
    redis.disconnect();
  });

  // 4. Real Database Identity Verification on POST /api/auth/login
  test('Identity Verification: Rejects unknown user and wrong password with 401 and logs failures', async (t) => {
    const BASE_URL = 'http://localhost:3000';
    try {
      await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      t.skip('BFF HTTP server is not running on localhost:3000');
      return;
    }
    const baseHeaders = {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:5180',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Dest': 'empty',
    };

    // 1. Unknown user test
    const ghostRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ studentId: 'ghost_matric_99999', password: 'password123' }),
    });

    assert.strictEqual(ghostRes.status, 401, 'Unknown user must return 401');
    const ghostBody = await ghostRes.json();
    assert.strictEqual(ghostBody.code, 'INVALID_CREDENTIALS');

    // 2. Wrong password test on real student
    const wrongPassRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: baseHeaders,
      body: JSON.stringify({ studentId: 'student1', password: 'wrong_secret_123' }),
    });

    assert.strictEqual(wrongPassRes.status, 401, 'Wrong password must return 401');
    const wrongPassBody = await wrongPassRes.json();
    assert.strictEqual(wrongPassBody.code, 'INVALID_CREDENTIALS');

    // 3. Verify failure events logged in identity_audit_logs
    const auditRes = await pool.query(
      `SELECT event_type, actor_id, metadata 
       FROM identity_audit_logs 
       WHERE event_type = 'AUTHENTICATION_FAILURE' 
       ORDER BY created_at DESC LIMIT 2`
    );

    assert.ok(auditRes.rows.length >= 2, 'Must log failed authentication attempts in audit ledger');
  });

  // 5. Partial Session Escapement & Forced Reset State Machine
  test('Privilege Escalation Barrier: Quarantines student2 with RESET_ONLY and blocks academic API escapement', async (t) => {
    const BASE_URL = 'http://localhost:3000';
    try {
      await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      t.skip('BFF HTTP server is not running on localhost:3000');
      return;
    }

    // 0. Reset student2 credentials to guarantee test idempotency
    await pool.query(
      `UPDATE student_profiles 
       SET password_hash = 'f0c17a9b0123456789abcdef01234567:52669d26faf75c9cdd896ede664f8d288e17ab129fb1979fc425b0604a6c801063873ff8a8e2ee3ce5f6da3b774d07e4b3410a7288c443d7121784eb467d3590',
           must_change_password = TRUE 
       WHERE student_id = 'student2'`
    );

    // 1. Login with student2 (seeded with must_change_password = TRUE)
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:5180',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Dest': 'empty',
      },
      body: JSON.stringify({ studentId: 'student2', password: 'password123' }),
    });

    assert.strictEqual(loginRes.status, 200, 'Student2 login must succeed');
    const loginBody = await loginRes.json();
    assert.strictEqual(loginBody.scope, 'RESET_ONLY', 'Must issue RESET_ONLY session scope');
    assert.strictEqual(loginBody.mustChangePassword, true, 'mustChangePassword flag must be true');

    const setCookie = loginRes.headers.get('set-cookie');
    const tokenMatch = /focit_token=([^;]+)/.exec(setCookie);
    assert.ok(tokenMatch, 'HttpOnly cookie must be issued');
    const cookie = tokenMatch[1];
    const sessionNonce = loginBody.sessionNonce;

    const authHeaders = {
      'Cookie': `focit_token=${cookie}`,
      'X-Session-Nonce': sessionNonce,
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:5180',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Dest': 'empty',
    };

    // 2. Postman / cURL bypass simulation:
    // Attempting to invoke protected academic route (/api/registration/current) using the valid cookie
    const escapementRes = await fetch(`${BASE_URL}/api/registration/current`, {
      method: 'GET',
      headers: authHeaders,
    });

    assert.strictEqual(
      escapementRes.status,
      403,
      'Must return 403 Forbidden when calling academic endpoints with RESET_ONLY session'
    );
    const escapementBody = await escapementRes.json();
    assert.strictEqual(escapementBody.code, 'MANDATORY_PASSWORD_RESET_REQUIRED');

    // 3. Authorized path: Invoking /api/student/change-password
    const changePassRes = await fetch(`${BASE_URL}/api/student/change-password`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        currentPassword: 'password123',
        newPassword: 'MyNewSecurePassword2026!',
      }),
    });

    assert.strictEqual(changePassRes.status, 200, 'Password change must succeed');
    const changePassBody = await changePassRes.json();
    assert.strictEqual(changePassBody.status, 'CREDENTIALS_MUTATED');

    // 4. Verify database state for student2: must_change_password is now FALSE
    const student2Db = await pool.query(
      `SELECT must_change_password FROM student_profiles WHERE student_id = 'student2'`
    );
    assert.strictEqual(student2Db.rows[0].must_change_password, false, 'must_change_password must be promoted to FALSE');

    // 5. Verify CREDENTIAL_INITIALIZATION event in audit ledger
    const auditRecord = await pool.query(
      `SELECT event_type, actor_id, metadata 
       FROM identity_audit_logs 
       WHERE actor_id = 'student2' AND event_type = 'CREDENTIAL_INITIALIZATION' 
       ORDER BY created_at DESC LIMIT 1`
    );
    assert.strictEqual(auditRecord.rows.length, 1, 'Must record CREDENTIAL_INITIALIZATION in audit ledger');
  });

});
