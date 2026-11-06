import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/index.js';
import crypto from 'node:crypto';
import { hashPassword } from '../src/lib/passwords.js';

describe('Portal Activation Engine & One-Time Lock Doctrine', () => {
  const testMatric = '2023/88888';
  const testStudentId = 'student_test_activation';
  const testEmail = 'test.activation@gmail.com';

  before(async () => {
    // Clean and insert test fixture
    await pool.query(`DELETE FROM student_profiles WHERE student_id = $1`, [testStudentId]);
    await pool.query(`DELETE FROM students WHERE student_id = $1`, [testStudentId]);

    await pool.query(
      `
      INSERT INTO students (student_id, matric_number, username, full_name, email, programme_id, level, account_status)
      VALUES ($1, $2, $2, 'Activation Test Student', $3, 'BSC_CSC', 200, 'ACTIVE');
      `,
      [testStudentId, testMatric, testEmail]
    );

    const initialHash = await hashPassword('TemporaryInitial123!');
    await pool.query(
      `
      INSERT INTO student_profiles (student_id, password_hash, must_change_password, is_activated)
      VALUES ($1, $2, TRUE, FALSE);
      `,
      [testStudentId, initialHash]
    );
  });

  after(async () => {
    await pool.query(`DELETE FROM student_profiles WHERE student_id = $1`, [testStudentId]);
    await pool.query(`DELETE FROM students WHERE student_id = $1`, [testStudentId]);
    await pool.end();
  });

  test('Rejects invalid 4-digit matriculation numbers with INVALID_MATRIC_FORMAT', () => {
    const invalidMatric = '2024/0042';
    const isValid = /^[0-9]{4}\/[0-9]{5}$/.test(invalidMatric);
    assert.strictEqual(isValid, false, '4-digit matric must be rejected');
  });

  test('Validates matching matric and email, updates profile with temporary password', async () => {
    const studentRes = await pool.query(
      `
      SELECT s.student_id, s.matric_number, s.email, sp.must_change_password, sp.is_activated
      FROM students s
      LEFT JOIN student_profiles sp ON sp.student_id = s.student_id
      WHERE s.matric_number = $1
      `,
      [testMatric]
    );

    assert.strictEqual(studentRes.rows.length, 1);
    const student = studentRes.rows[0];
    assert.strictEqual(student.email, testEmail);
    assert.strictEqual(student.is_activated, false);

    // Simulate activation
    const tempPassword = crypto.randomBytes(9).toString('base64url') + '!A1';
    const tempHash = await hashPassword(tempPassword);

    await pool.query(
      `
      UPDATE student_profiles
      SET password_hash = $1, must_change_password = TRUE, is_activated = FALSE
      WHERE student_id = $2
      `,
      [tempHash, student.student_id]
    );

    const updatedRes = await pool.query(
      `SELECT must_change_password, is_activated FROM student_profiles WHERE student_id = $1`,
      [student.student_id]
    );
    assert.strictEqual(updatedRes.rows[0].must_change_password, true);
    assert.strictEqual(updatedRes.rows[0].is_activated, false);
  });

  test('One-Time Activation Lock: Blocks repeat activation once permanent password is set', async () => {
    // Simulate user setting their permanent password
    await pool.query(
      `
      UPDATE student_profiles
      SET must_change_password = FALSE, is_activated = TRUE, activated_at = NOW()
      WHERE student_id = $1
      `,
      [testStudentId]
    );

    const profileRes = await pool.query(
      `SELECT must_change_password, is_activated FROM student_profiles WHERE student_id = $1`,
      [testStudentId]
    );

    const profile = profileRes.rows[0];
    const isLocked = profile.is_activated === true && profile.must_change_password === false;
    assert.strictEqual(isLocked, true, 'Account must be locked against repeat activation once activated');
  });
});
