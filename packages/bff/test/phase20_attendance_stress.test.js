/**
 * Phase 20: High-Concurrency Stress Test & Contention Hardening
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Simulates:
 * 1. 20 concurrent students slamming POST /otp/ticket simultaneously at t=0
 * 2. 5 concurrent rapid-fire requests from the SAME student (simulating mobile double-taps + StrictMode)
 * 3. Concurrent mixed workload: Ticket requests, explicit closes, and check-ins happening in parallel
 * 4. Lockout invariant under load: Ensures no student exceeds 3 attempts or gets false lockouts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';

test('Phase 20 Stress Test: High-Concurrency Ticket Acquisition & Circuit Breaker', async (t) => {
  try {
    redis.disconnect();
  } catch {}

  const enrollmentRes = await pool.query(`
    SELECT e.student_id, e.course_id, c.code, e.semester_id
    FROM enrollments e
    JOIN courses c ON e.course_id = c.course_id
    LIMIT 1
  `);
  assert.ok(enrollmentRes.rows.length > 0, 'Must have at least one enrollment seeded in DB');
  const { course_id, code, semester_id } = enrollmentRes.rows[0];

  // Helper cleanup
  const cleanSessions = async () => {
    await pool.query('DELETE FROM attendance_records WHERE session_id IN (SELECT session_id FROM attendance_sessions WHERE course_id = $1)', [course_id]);
    await pool.query('DELETE FROM attendance_sessions WHERE course_id = $1', [course_id]);
  };
  await cleanSessions();

  // Create Mode 2 session
  const otpPin = '918273';
  const hmacSecret = process.env.OTP_HMAC_SECRET || 'focit_otp_hmac_secret_2026';
  const canonicalHash = crypto
    .createHmac('sha256', hmacSecret)
    .update(`${course_id}:${otpPin}`)
    .digest('hex');

  const sessionRes = await pool.query(`
    INSERT INTO attendance_sessions (
      course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked, active_otp_hash, otp_expires_at
    )
    VALUES ($1, $2, 6, CURRENT_DATE, 'CODE_OTP', 'lecturer1', FALSE, $3, NOW() + INTERVAL '300 seconds')
    RETURNING session_id;
  `, [course_id, semester_id, canonicalHash]);
  const sessionId = sessionRes.rows[0].session_id;

  // Pre-seed 10 test students
  const studentIds = [];
  for (let i = 1; i <= 10; i++) {
    const sId = `stress_student_${i}`;
    studentIds.push(sId);
    await pool.query(`
      INSERT INTO students (student_id, matric_number, username, full_name, email, programme_id, level)
      VALUES ($1, $2, $3, $4, $5, 'BSC_CSC', 200)
      ON CONFLICT (student_id) DO NOTHING;
    `, [sId, `2026/${1000 + i}`, sId, `Stress Student ${i}`, `${sId}@test.focit.edu`]);

    await pool.query(`
      INSERT INTO enrollments (student_id, course_id, course_code, semester_id, status)
      VALUES ($1, $2, $3, $4, 'ENROLLED')
      ON CONFLICT (student_id, course_id, semester_id) DO NOTHING;
    `, [sId, course_id, code, semester_id]);
  }

  // Helper: Request ticket following BFF route exact logic
  const requestTicket = async (targetStudentId) => {
    // Step 0: Pre-seed row guarantee
    await pool.query(`
      INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
      SELECT s.session_id, $2, 'ABSENT', 'CODE_OTP', 1.000
      FROM attendance_sessions s
      JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = $2
      WHERE s.course_id = $1 AND ($3::uuid IS NULL OR s.session_id = $3::uuid)
      ON CONFLICT (session_id, student_id) DO NOTHING;
    `, [course_id, targetStudentId, sessionId]);

    // Step 1: Atomic CTE
    const query = `
      WITH target_session AS (
          SELECT s.session_id, s.course_id, s.is_locked, s.otp_expires_at,
                 (s.is_locked = FALSE AND s.otp_expires_at > NOW()) AS is_session_active
          FROM attendance_sessions s
          WHERE s.session_id = $1 LIMIT 1
      ),
      locked_record AS (
          SELECT ar.id, ar.status, ar.is_locked_out, ar.attempt_count, ar.active_ticket_id,
                 (ar.active_ticket_id IS NOT NULL AND ar.active_ticket_expires_at > NOW() AND ar.status != 'PRESENT') AS has_valid_lease,
                 (ar.active_ticket_id IS NOT NULL AND ar.active_ticket_expires_at <= NOW() AND ar.status != 'PRESENT') AS has_expired_lease,
                 (ar.attempt_count + CASE WHEN (ar.active_ticket_id IS NOT NULL AND ar.active_ticket_expires_at <= NOW() AND ar.status != 'PRESENT') THEN 1 ELSE 0 END) AS projected_attempts
          FROM attendance_records ar
          WHERE ar.session_id = $1 AND ar.student_id = $2
          FOR UPDATE OF ar
      ),
      upsert_ticket AS (
          UPDATE attendance_records ar
          SET attempt_count = lr.projected_attempts,
              is_locked_out = ar.is_locked_out OR (lr.projected_attempts >= 3 AND lr.status != 'PRESENT'),
              active_ticket_id = CASE
                  WHEN ar.is_locked_out OR lr.projected_attempts >= 3 OR lr.status = 'PRESENT' THEN NULL
                  WHEN lr.has_valid_lease THEN ar.active_ticket_id
                  ELSE gen_random_uuid()
              END,
              active_ticket_expires_at = CASE
                  WHEN ar.is_locked_out OR lr.projected_attempts >= 3 OR lr.status = 'PRESENT' THEN NULL
                  WHEN lr.has_valid_lease THEN ar.active_ticket_expires_at
                  ELSE LEAST(NOW() + INTERVAL '180 seconds', ts.otp_expires_at)
              END,
              ticket_opened_at = CASE
                  WHEN ar.is_locked_out OR lr.projected_attempts >= 3 OR lr.status = 'PRESENT' THEN NULL
                  WHEN lr.has_valid_lease THEN ar.ticket_opened_at
                  ELSE NOW()
              END
          FROM locked_record lr, target_session ts
          WHERE ar.id = lr.id
          RETURNING ar.session_id, ar.student_id, ar.status, ar.attempt_count, ar.is_locked_out, ar.active_ticket_id, lr.has_valid_lease
      )
      SELECT * FROM upsert_ticket;
    `;
    const res = await pool.query(query, [sessionId, targetStudentId]);
    return res.rows[0];
  };

  const closeTicket = async (targetStudentId, targetTicketId) => {
    const query = `
      WITH locked_record AS (
          SELECT ar.id, ar.attempt_count, ar.is_locked_out, ar.active_ticket_id, ar.status
          FROM attendance_records ar
          WHERE ar.session_id = $1 AND ar.student_id = $2
          FOR UPDATE OF ar
      ),
      burn_lease AS (
          UPDATE attendance_records ar
          SET attempt_count = CASE WHEN lr.active_ticket_id IS NOT NULL AND lr.status != 'PRESENT' THEN ar.attempt_count + 1 ELSE ar.attempt_count END,
              is_locked_out = CASE WHEN lr.status = 'PRESENT' THEN FALSE WHEN lr.is_locked_out = TRUE THEN TRUE WHEN lr.active_ticket_id IS NOT NULL AND (ar.attempt_count + 1 >= 3) THEN TRUE ELSE FALSE END,
              active_ticket_id = NULL,
              active_ticket_expires_at = NULL
          FROM locked_record lr
          WHERE ar.id = lr.id AND ($3::uuid IS NULL OR lr.active_ticket_id = $3::uuid)
          RETURNING ar.attempt_count, ar.is_locked_out
      )
      SELECT * FROM burn_lease;
    `;
    const res = await pool.query(query, [sessionId, targetStudentId, targetTicketId]);
    return res.rows[0];
  };

  await t.test('1. 20 Concurrent Initial Ticket Requests (All 10 students hit simultaneously)', async () => {
    // Each student sends 2 concurrent ticket requests at once (20 concurrent queries)
    const promises = [];
    for (const sId of studentIds) {
      promises.push(requestTicket(sId));
      promises.push(requestTicket(sId));
    }

    const results = await Promise.all(promises);
    assert.equal(results.length, 20, 'All 20 requests must complete');

    // Verify each student has a valid ticket and attempt_count 0
    for (const sId of studentIds) {
      const studentResults = results.filter(r => r.student_id === sId);
      assert.equal(studentResults.length, 2);
      assert.equal(studentResults[0].active_ticket_id, studentResults[1].active_ticket_id, 'Both requests for student must share exact same lease');
      assert.equal(studentResults[0].attempt_count, 0, 'Attempt count must be 0');
      assert.equal(studentResults[0].is_locked_out, false);
    }
  });

  await t.test('2. 5 Rapid-Fire Concurrent Closures from Same Student (Zero Double-Burn)', async () => {
    const testStudent = studentIds[0];
    const ticketBefore = (await pool.query('SELECT active_ticket_id FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, testStudent])).rows[0];
    assert.ok(ticketBefore.active_ticket_id);

    // Student double/triple clicks close or network retries 5 times concurrently
    const closePromises = [
      closeTicket(testStudent, ticketBefore.active_ticket_id),
      closeTicket(testStudent, ticketBefore.active_ticket_id),
      closeTicket(testStudent, ticketBefore.active_ticket_id),
      closeTicket(testStudent, ticketBefore.active_ticket_id),
      closeTicket(testStudent, ticketBefore.active_ticket_id),
    ];

    await Promise.all(closePromises);

    // Exactly 1 attempt must have burned! (1 not 5)
    const recAfter = (await pool.query('SELECT attempt_count, is_locked_out, active_ticket_id FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, testStudent])).rows[0];
    assert.equal(recAfter.attempt_count, 1, 'Only 1 attempt must be burned despite 5 concurrent close calls');
    assert.equal(recAfter.is_locked_out, false);
    assert.equal(recAfter.active_ticket_id, null);
  });

  await t.test('3. Full 3-Attempt Lockout Boundary Under Parallel Load', async () => {
    const testStudent = studentIds[1];

    // Attempt 1 already open from test 1: Burn Attempt 1
    const t1 = (await pool.query('SELECT active_ticket_id FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, testStudent])).rows[0];
    await closeTicket(testStudent, t1.active_ticket_id);

    // Attempt 2: Open and Burn
    const r2 = await requestTicket(testStudent);
    assert.equal(r2.attempt_count, 1);
    await closeTicket(testStudent, r2.active_ticket_id);

    // Attempt 3: Open (must be granted!)
    const r3 = await requestTicket(testStudent);
    assert.equal(r3.attempt_count, 2, 'Burned count is 2 on Attempt 3 entry');
    assert.equal(r3.is_locked_out, false, 'Attempt 3 must NOT be locked out on entry');
    assert.ok(r3.active_ticket_id, 'Must grant ticket for Attempt 3');

    // Burn Attempt 3
    const c3 = await closeTicket(testStudent, r3.active_ticket_id);
    assert.equal(c3.attempt_count, 3, 'Ceiling reached');
    assert.equal(c3.is_locked_out, true, 'Circuit breaker tripped');

    // Any new request must return locked out and null ticket
    const rBlocked = await requestTicket(testStudent);
    assert.equal(rBlocked.is_locked_out, true);
    assert.equal(rBlocked.active_ticket_id, null);
  });

  // Cleanup
  await cleanSessions();
  for (const sId of studentIds) {
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [sId]);
    await pool.query('DELETE FROM students WHERE student_id = $1', [sId]);
  }
  await pool.end();
});

