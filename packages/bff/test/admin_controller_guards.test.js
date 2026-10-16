/**
 * Unit & Integration Tests for Admin Controller Governance Guards
 */

import '../src/config.js';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';
import {
  updateUserStatus,
  updateUserRole,
  toggleRegistrationWindow,
  createUser,
  getDashboardOverview,
  getOutboxEvents,
  retryOutboxEvent,
} from '../src/controllers/adminController.js';
import { hashPassword } from '../src/lib/passwords.js';
import authRouter from '../src/routes/auth.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

describe('Admin Controller Governance & Security Guards', () => {
  after(async () => {
    try {
      await redis.quit();
    } catch {}
    try {
      await pool.end();
    } catch {}
  });

  // 1. Issue 2: Admin Provisioning Guard
  test('Issue 2: Blocks non-SYSTEM_ADMIN from provisioning a SYSTEM_ADMIN account', async () => {
    const req = {
      body: {
        identifier: 'SYS/2026/999',
        fullName: 'Test Sysadmin',
        email: 'sysadmin_test@focit.uniosun.edu.ng',
        role: 'SYSTEM_ADMIN',
        departmentId: 'D-CS',
      },
      user: { id: 'admin1', role: 'ADMIN' }, // Regular ADMIN caller
      ip: '127.0.0.1',
    };
    const res = mockRes();

    await createUser(req, res, () => {});

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.code, 'FORBIDDEN_PROVISION_SYSTEM_ADMIN');
  });

  // 2. Issue 4: Reliable Self-Status Guard
  test('Issue 4: Blocks self-suspension even when caller provides staff_number instead of advisor_id', async () => {
    // Current admin user has id: 'admin1', but supplies their staff_number 'ADM/2026/001' in URL
    const req = {
      params: { id: 'ADM/2026/001' },
      body: { status: 'SUSPENDED' },
      user: { id: 'admin1', username: 'admin1', email: 'admin@focit.uniosun.edu.ng', role: 'ADMIN' },
      ip: '127.0.0.1',
    };
    const res = mockRes();

    await updateUserStatus(req, res, () => {});

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'CANNOT_SUSPEND_SELF');
  });

  // 3. Issue 5: Reliable Self-Demotion Guard
  test('Issue 5: Blocks self-demotion even when caller provides staff_number instead of advisor_id', async () => {
    // Current admin user has id: 'admin1', but supplies 'ADM/2026/001' to demote to LEVEL_ADVISOR
    const req = {
      params: { id: 'ADM/2026/001' },
      body: { role: 'LEVEL_ADVISOR' },
      user: { id: 'admin1', username: 'admin1', email: 'admin@focit.uniosun.edu.ng', role: 'ADMIN' },
      ip: '127.0.0.1',
    };
    const res = mockRes();

    await updateUserRole(req, res, () => {});

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'CANNOT_DEMOTE_SELF');
  });

  // 4. Issue 6: Semester ID Parameter Validation
  test('Issue 6: Rejects invalid or malicious semester ID with 400 INVALID_SEMESTER_ID', async () => {
    const invalidIds = ['', '   ', 'this_semester_id_is_way_too_long_exceeding_32_characters_limit', 'semester;DROP TABLE;'];

    for (const testId of invalidIds) {
      const req = {
        params: { id: testId },
        body: { isOpen: true },
        user: { id: 'admin1', role: 'ADMIN' },
        ip: '127.0.0.1',
      };
      const res = mockRes();

      await toggleRegistrationWindow(req, res, () => {});

      assert.strictEqual(res.statusCode, 400, `Expected 400 for invalid id: "${testId}"`);
      assert.strictEqual(res.body.code, 'INVALID_SEMESTER_ID');
    }
  });

  // 5. Issue 3: Unpredictable Temporary Password Generation
  test('Issue 3: Generates high-entropy crypto random temporary password and never uses ChangeMe123!', async () => {
    const uniqueMatric = `TEST_${Date.now()}`;
    const req = {
      body: {
        identifier: uniqueMatric,
        fullName: 'Test Random Pass User',
        email: `random_pass_${Date.now()}@focit.uniosun.edu.ng`,
        role: 'STUDENT',
        departmentId: 'D-CS',
        level: 100,
      },
      user: { id: 'admin1', role: 'ADMIN' },
      ip: '127.0.0.1',
    };
    const res = mockRes();

    await createUser(req, res, () => {});

    assert.strictEqual(res.statusCode, 201);
    assert.ok(res.body.data.temporaryPassword, 'Must return temporary password for admin one-time provisioning');
    assert.notStrictEqual(res.body.data.temporaryPassword, 'ChangeMe123!', 'Must NOT use ChangeMe123!');
    assert.ok(res.body.data.temporaryPassword.length >= 12, 'Temporary password must be high entropy (>= 12 chars)');
    assert.strictEqual(res.body.data.mustChangePassword, true, 'Must enforce mustChangePassword = true');

    // Clean up created student from DB to keep test idempotent
    await pool.query('DELETE FROM student_profiles WHERE student_id = $1', [res.body.data.user.id]);
    await pool.query('DELETE FROM students WHERE student_id = $1', [res.body.data.user.id]);
  });

  // 6. Round 2: Validate status type before calling toUpperCase
  test('Round 2: Rejects non-string status values with 400 INVALID_STATUS without throwing TypeError', async () => {
    const invalidStatuses = [123, true, false, {}, [], null];

    for (const statusVal of invalidStatuses) {
      const req = {
        params: { id: 'ADM/2026/001' },
        body: { status: statusVal },
        user: { id: 'other_admin', role: 'ADMIN' },
        ip: '127.0.0.1',
      };
      const res = mockRes();

      await updateUserStatus(req, res, () => {});

      assert.strictEqual(res.statusCode, 400, `Expected 400 for status: ${JSON.stringify(statusVal)}`);
      assert.strictEqual(res.body.code, 'INVALID_STATUS');
    }
  });

  // 7. Round 2 & 3: Demotion guard on SYSTEM_ADMIN accounts with isolated fixtures
  test('Round 2 & 3: Demoting a SYSTEM_ADMIN succeeds when others remain, but blocks when it is the last active SYSTEM_ADMIN', async () => {
    // 1. Query current active SYSTEM_ADMIN count
    const countRes = await pool.query(
      "SELECT COUNT(*)::int AS count FROM staff_advisors WHERE role = 'SYSTEM_ADMIN' AND account_status = 'ACTIVE'"
    );
    const initialSysadminCount = countRes.rows[0]?.count || 0;

    // 2. Provision isolated ephemeral SYSTEM_ADMIN fixture so multiple active admins exist
    const ephemeralSysAdminId = `staff_sysadmin_${Date.now()}`;
    const ephemeralStaffNum = `STF/SYS/${Date.now().toString().slice(-4)}`;

    await pool.query(
      `INSERT INTO staff_advisors (advisor_id, staff_number, full_name, email, department_id, assigned_level, role, account_status)
       VALUES ($1, $2, 'Ephemeral SysAdmin', $3, 'CSC', 100, 'SYSTEM_ADMIN', 'ACTIVE')`,
      [ephemeralSysAdminId, ephemeralStaffNum, `${ephemeralSysAdminId}@focit.uniosun.edu.ng`]
    );

    try {
      // With the ephemeral fixture present, demoting it must be permitted since at least one other SYSTEM_ADMIN exists
      const permitReq = {
        params: { id: ephemeralSysAdminId },
        body: { role: 'ADMIN' },
        user: { id: 'admin1', role: 'SYSTEM_ADMIN' },
        ip: '127.0.0.1',
      };
      const permitRes = mockRes();

      await updateUserRole(permitReq, permitRes, () => {});

      assert.strictEqual(permitRes.statusCode, 200, 'Demoting should succeed when another active SYSTEM_ADMIN remains');
      assert.strictEqual(permitRes.body.data.role, 'ADMIN');

      // 3. Now verify that when only 1 active SYSTEM_ADMIN remains, demotion is strictly blocked
      if (initialSysadminCount === 1) {
        const lastAdminRes = await pool.query(
          "SELECT advisor_id FROM staff_advisors WHERE role = 'SYSTEM_ADMIN' AND account_status = 'ACTIVE' LIMIT 1"
        );
        const lastSysAdmin = lastAdminRes.rows[0];

        const blockReq = {
          params: { id: lastSysAdmin.advisor_id },
          body: { role: 'ADMIN' },
          user: { id: 'other_sysadmin', role: 'SYSTEM_ADMIN' },
          ip: '127.0.0.1',
        };
        const blockRes = mockRes();

        await updateUserRole(blockReq, blockRes, () => {});

        assert.strictEqual(blockRes.statusCode, 400);
        assert.strictEqual(blockRes.body.code, 'CANNOT_DEMOTE_LAST_SYSTEM_ADMIN');

        // Confirm database record was NOT mutated
        const checkRes = await pool.query('SELECT role FROM staff_advisors WHERE advisor_id = $1', [lastSysAdmin.advisor_id]);
        assert.strictEqual(checkRes.rows[0]?.role, 'SYSTEM_ADMIN');
      }
    } finally {
      // Clean up isolated ephemeral fixture
      await pool.query('DELETE FROM staff_advisors WHERE advisor_id = $1', [ephemeralSysAdminId]);
    }
  });

  // 8. Round 2 & 3: Role changes revoke existing privileges without mutating persistent seeded data
  test('Round 2 & 3: Role changes trigger session revocation without mutating seeded data', async () => {
    const ephemeralStaffId = `staff_test_role_${Date.now()}`;
    const ephemeralStaffNum = `STF/TEST/${Date.now().toString().slice(-4)}`;
    
    await pool.query(
      `INSERT INTO staff_advisors (advisor_id, staff_number, full_name, email, department_id, assigned_level, role, account_status)
       VALUES ($1, $2, 'Ephemeral Test Advisor', $3, 'CSC', 100, 'LEVEL_ADVISOR', 'ACTIVE')`,
      [ephemeralStaffId, ephemeralStaffNum, `${ephemeralStaffId}@focit.uniosun.edu.ng`]
    );

    try {
      const req = {
        params: { id: ephemeralStaffId },
        body: { role: 'HOD' },
        user: { id: 'admin1', role: 'SYSTEM_ADMIN' },
        ip: '127.0.0.1',
      };
      const res = mockRes();

      await updateUserRole(req, res, () => {});

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.data.role, 'HOD');
      assert.strictEqual(typeof res.body.data.sessionsRevoked, 'boolean');
    } finally {
      await pool.query('DELETE FROM staff_advisors WHERE advisor_id = $1', [ephemeralStaffId]);
    }
  });

  // 9. Round 2 & 3: Anti-enumeration defense (Wrong password returns 401; correct password returns 403 on suspended account)
  test('Round 2 & 3: Anti-enumeration: wrong password returns 401 on suspended account; valid password returns 403', async () => {
    const studentId = `test_susp_${Date.now()}`;
    const testPassword = 'CorrectPassword123!';
    const passwordHash = await hashPassword(testPassword);

    await pool.query(
      "INSERT INTO students (student_id, matric_number, username, full_name, email, programme_id, level, account_status) VALUES ($1, $1, $1, 'Suspended Student', $2, 'BSC_CSC', 100, 'SUSPENDED')",
      [studentId, `${studentId}@focit.uniosun.edu.ng`]
    );
    await pool.query(
      "INSERT INTO student_profiles (student_id, password_hash) VALUES ($1, $2)",
      [studentId, passwordHash]
    );

    try {
      // 1. Attacker sends WRONG password: must receive 401 INVALID_CREDENTIALS (does not leak suspension status)
      const wrongPassReq = {
        method: 'POST',
        url: '/login',
        body: { studentId, password: 'WrongPassword999!' },
        headers: {},
        ip: '127.0.0.1',
      };
      const wrongPassRes = mockRes();

      await new Promise((resolve) => {
        const origJson = wrongPassRes.json.bind(wrongPassRes);
        wrongPassRes.json = (data) => {
          origJson(data);
          resolve();
        };
        authRouter.handle(wrongPassReq, wrongPassRes, resolve);
      });

      assert.strictEqual(wrongPassRes.statusCode, 401);
      assert.strictEqual(wrongPassRes.body.code, 'INVALID_CREDENTIALS');

      // 2. Legitimate user sends CORRECT password: authenticated user receives 403 ACCOUNT_SUSPENDED
      const correctPassReq = {
        method: 'POST',
        url: '/login',
        body: { studentId, password: testPassword },
        headers: {},
        ip: '127.0.0.1',
      };
      const correctPassRes = mockRes();

      await new Promise((resolve) => {
        const origJson = correctPassRes.json.bind(correctPassRes);
        correctPassRes.json = (data) => {
          origJson(data);
          resolve();
        };
        authRouter.handle(correctPassReq, correctPassRes, resolve);
      });

      assert.strictEqual(correctPassRes.statusCode, 403);
      assert.strictEqual(correctPassRes.body.code, 'ACCOUNT_SUSPENDED');
    } finally {
      await pool.query('DELETE FROM student_profiles WHERE student_id = $1', [studentId]);
      await pool.query('DELETE FROM students WHERE student_id = $1', [studentId]);
    }
  });

  // 10. Audit Polish: getDashboardOverview executes without enum 22P02 error and returns complete metrics
  test('Audit Polish: getDashboardOverview executes without enum 22P02 error and returns complete metrics', async () => {
    const req = {
      user: { id: 'admin1', role: 'SYSTEM_ADMIN' },
      ip: '127.0.0.1',
    };
    const res = mockRes();

    await getDashboardOverview(req, res, () => {});

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.success);
    assert.ok(res.body.data.metrics);
    assert.ok(res.body.data.roleDistribution);
    assert.strictEqual(typeof res.body.data.roleDistribution.SYSTEM_ADMIN, 'number');
    assert.strictEqual(typeof res.body.data.roleDistribution.SENATE_OFFICER, 'number');
    assert.ok(res.body.data.systemHealth);
    assert.strictEqual(res.body.data.systemHealth.database.status, 'UP');
    assert.ok(res.body.data.registrationQueue);
    assert.ok(res.body.data.moodleOutbox);
  });

  // 11. Audit Polish: getOutboxEvents handles APPROVED and custom status without enum 22P02 error
  test('Audit Polish: getOutboxEvents handles APPROVED and custom status without enum 22P02 error', async () => {
    const req = {
      query: { status: 'APPROVED' },
      user: { id: 'admin1', role: 'SYSTEM_ADMIN' },
    };
    const res = mockRes();

    await getOutboxEvents(req, res, () => {});

    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.success);
    assert.ok(Array.isArray(res.body.data.events));
    assert.ok(Array.isArray(res.body.data.moodleSyncQueue));
  });

  // 12. Audit Polish: retryOutboxEvent validates identifier and returns 400 for malformed input
  test('Audit Polish: retryOutboxEvent validates identifier format and returns 400 for malformed input', async () => {
    const malformedReq = {
      params: { id: 'not-a-valid-uuid-or-id!;<script>' },
      user: { id: 'admin1', role: 'SYSTEM_ADMIN' },
      ip: '127.0.0.1',
    };
    const res = mockRes();

    await retryOutboxEvent(malformedReq, res, () => {});

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.code, 'INVALID_IDENTIFIER_FORMAT');
  });
});
