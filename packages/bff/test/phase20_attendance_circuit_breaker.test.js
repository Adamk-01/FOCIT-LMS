/**
 * Phase 20: Mode 2 Ephemeral Passcode Ingress Lease & Circuit Breaker Doctrine Certification
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Verifies:
 * 1. Single-Statement Atomic CTE & Row Lock Serialization
 * 2. Strict Idempotent Lease Preservation (React 18 StrictMode & 3G retry immunity)
 * 3. Lazy Expiration Sweep (Eliminates tab force-close bypass)
 * 4. Explicit Modal Dismissal Burner (POST /otp/ticket/close)
 * 5. Attempt 3 Usability & Exact Lockout Integer Boundary
 * 6. Hard Lockout Circuit Breaker (HTTP 423 ATTEMPTS_EXCEEDED)
 * 7. Faculty Verification Desk Override & Reset
 * 8. True Concurrent Burst Contention (Promise.all on fresh student without pre-existing record)
 * 9. Expired-Ticket Check-In Rejection on Attempt 3 (status stays ABSENT, trips lockout)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';

test('Phase 20: Attendance Monotonic Ingress Lease & 3-Attempt Circuit Breaker', async (t) => {
  try {
    redis.disconnect();
  } catch {}

  // 1. Resolve an enrolled student and course for testing
  const enrollmentRes = await pool.query(`
    SELECT e.student_id, e.course_id, s.matric_number, c.code, e.semester_id
    FROM enrollments e
    JOIN students s ON e.student_id = s.student_id
    JOIN courses c ON e.course_id = c.course_id
    LIMIT 1
  `);

  assert.ok(enrollmentRes.rows.length > 0, 'Must have at least one enrollment seeded in DB');
  const { student_id, course_id, code, semester_id } = enrollmentRes.rows[0];

  // Helper cleanup
  const cleanSessions = async () => {
    await pool.query('DELETE FROM attendance_records WHERE session_id IN (SELECT session_id FROM attendance_sessions WHERE course_id = $1)', [course_id]);
    await pool.query('DELETE FROM attendance_sessions WHERE course_id = $1', [course_id]);
  };

  await cleanSessions();

  // Create an active Mode 2 session with 300s TTL
  const otpPin = '839201';
  const hmacSecret = process.env.OTP_HMAC_SECRET || 'focit_otp_hmac_secret_2026';
  const canonicalHash = crypto
    .createHmac('sha256', hmacSecret)
    .update(`${course_id}:${otpPin}`)
    .digest('hex');

  const sessionRes = await pool.query(`
    INSERT INTO attendance_sessions (
      course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked, active_otp_hash, otp_expires_at
    )
    VALUES ($1, $2, 5, CURRENT_DATE, 'CODE_OTP', 'lecturer1', FALSE, $3, NOW() + INTERVAL '300 seconds')
    RETURNING session_id;
  `, [course_id, semester_id, canonicalHash]);

  const sessionId = sessionRes.rows[0].session_id;

  // Pre-seed absent record as generate route does
  await pool.query(`
    INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
    VALUES ($1, $2, 'ABSENT', 'CODE_OTP', 1.000)
    ON CONFLICT DO NOTHING;
  `, [sessionId, student_id]);

  // The Atomic CTE used by the BFF router
  const executeTicketCte = async (targetSessionId, targetCourseId, targetStudentId) => {
    const query = `
      WITH target_session AS (
          SELECT 
              s.session_id,
              s.course_id,
              s.week_number,
              s.is_locked,
              s.otp_expires_at,
              (s.is_locked = FALSE AND s.otp_expires_at IS NOT NULL AND s.otp_expires_at > NOW()) AS is_session_active
          FROM attendance_sessions s
          WHERE s.course_id = $2
            AND ($1::uuid IS NULL OR s.session_id = $1::uuid)
          ORDER BY s.created_at DESC
          LIMIT 1
      ),
      verified_enrollment AS (
          SELECT e.student_id
          FROM enrollments e
          JOIN target_session ts ON ts.course_id = e.course_id
          WHERE e.student_id = $3
            AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
          LIMIT 1
      ),
      ensure_record AS (
          INSERT INTO attendance_records (
              session_id,
              student_id,
              status,
              verification_method,
              confidence_score
          )
          SELECT 
              ts.session_id,
              ve.student_id,
              'ABSENT',
              'CODE_OTP',
              1.000
          FROM target_session ts
          JOIN verified_enrollment ve ON TRUE
          ON CONFLICT (session_id, student_id) DO NOTHING
          RETURNING id
      ),
      locked_record AS (
          SELECT 
              ar.id,
              ar.session_id,
              ar.student_id,
              ar.status,
              ar.is_locked_out,
              ar.attempt_count,
              ar.active_ticket_id,
              ar.active_ticket_expires_at,
              ar.ticket_opened_at,
              (ar.active_ticket_id IS NOT NULL AND ar.active_ticket_expires_at > NOW() AND ar.status != 'PRESENT') AS has_valid_lease,
              (ar.active_ticket_id IS NOT NULL AND ar.active_ticket_expires_at <= NOW() AND ar.status != 'PRESENT') AS has_expired_lease,
              (ar.attempt_count + CASE 
                  WHEN (ar.active_ticket_id IS NOT NULL AND ar.active_ticket_expires_at <= NOW() AND ar.status != 'PRESENT') THEN 1 
                  ELSE 0 
              END) AS projected_attempts
          FROM attendance_records ar
          JOIN target_session ts ON ts.session_id = ar.session_id
          JOIN verified_enrollment ve ON ve.student_id = ar.student_id
          FOR UPDATE OF ar
      ),
      upsert_ticket AS (
          UPDATE attendance_records ar
          SET 
              attempt_count = lr.projected_attempts,
              is_locked_out = ar.is_locked_out OR (lr.projected_attempts >= 3 AND lr.status != 'PRESENT'),
              locked_out_at = CASE 
                  WHEN (ar.is_locked_out = FALSE AND lr.projected_attempts >= 3 AND lr.status != 'PRESENT') THEN NOW()
                  ELSE ar.locked_out_at 
              END,
              active_ticket_id = CASE
                  WHEN ar.is_locked_out OR lr.projected_attempts >= 3 OR lr.status = 'PRESENT' OR ts.is_session_active = FALSE THEN NULL
                  WHEN lr.has_valid_lease THEN ar.active_ticket_id
                  ELSE gen_random_uuid()
              END,
              active_ticket_expires_at = CASE
                  WHEN ar.is_locked_out OR lr.projected_attempts >= 3 OR lr.status = 'PRESENT' OR ts.is_session_active = FALSE THEN NULL
                  WHEN lr.has_valid_lease THEN ar.active_ticket_expires_at
                  ELSE LEAST(NOW() + INTERVAL '180 seconds', ts.otp_expires_at)
              END,
              ticket_opened_at = CASE
                  WHEN ar.is_locked_out OR lr.projected_attempts >= 3 OR lr.status = 'PRESENT' OR ts.is_session_active = FALSE THEN NULL
                  WHEN lr.has_valid_lease THEN ar.ticket_opened_at
                  ELSE NOW()
              END
          FROM locked_record lr
          JOIN target_session ts ON TRUE
          WHERE ar.id = lr.id
          RETURNING 
              ar.session_id,
              ar.student_id,
              ar.status,
              ar.attempt_count,
              ar.is_locked_out,
              ar.active_ticket_id,
              ar.active_ticket_expires_at,
              ar.ticket_opened_at,
              lr.has_valid_lease AS was_idempotent_reuse,
              lr.has_expired_lease AS was_lazy_expired
      )
      SELECT 
          (SELECT session_id FROM target_session) AS session_id,
          (SELECT week_number FROM target_session) AS week_number,
          (SELECT is_session_active FROM target_session) AS is_session_active,
          (SELECT is_locked FROM target_session) AS is_session_locked,
          (SELECT student_id FROM verified_enrollment) AS enrolled_student_id,
          ut.*
      FROM target_session ts
      LEFT JOIN verified_enrollment ve ON TRUE
      LEFT JOIN upsert_ticket ut ON TRUE;
    `;
    const res = await pool.query(query, [targetSessionId, targetCourseId, targetStudentId]);
    return res.rows[0];
  };

  // Full BFF request handler logic (Step 0 pre-seed + Step 1 CTE)
  const requestTicketBff = async (targetSessionId, targetCourseId, targetStudentId) => {
    await pool.query(`
      INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
      SELECT s.session_id, $2, 'ABSENT', 'CODE_OTP', 1.000
      FROM attendance_sessions s
      JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = $2
      WHERE s.course_id = $1 AND ($3::uuid IS NULL OR s.session_id = $3::uuid)
      ON CONFLICT (session_id, student_id) DO NOTHING;
    `, [targetCourseId, targetStudentId, targetSessionId]);

    return executeTicketCte(targetSessionId, targetCourseId, targetStudentId);
  };

  const executeCloseCte = async (targetSessionId, targetCourseId, targetStudentId, targetTicketId) => {
    const query = `
      WITH target_session AS (
          SELECT s.session_id, s.course_id
          FROM attendance_sessions s
          WHERE s.course_id = $2
            AND ($1::uuid IS NULL OR s.session_id = $1::uuid)
          ORDER BY s.created_at DESC
          LIMIT 1
      ),
      locked_record AS (
          SELECT 
              ar.id, 
              ar.attempt_count, 
              ar.is_locked_out, 
              ar.active_ticket_id,
              ar.status
          FROM attendance_records ar
          JOIN target_session ts ON ts.session_id = ar.session_id
          WHERE ar.student_id = $3
          FOR UPDATE OF ar
      ),
      burn_lease AS (
          UPDATE attendance_records ar
          SET 
              attempt_count = CASE 
                  WHEN lr.active_ticket_id IS NOT NULL AND lr.status != 'PRESENT' THEN ar.attempt_count + 1
                  ELSE ar.attempt_count
              END,
              is_locked_out = CASE 
                  WHEN lr.status = 'PRESENT' THEN FALSE
                  WHEN lr.is_locked_out = TRUE THEN TRUE
                  WHEN lr.active_ticket_id IS NOT NULL AND (ar.attempt_count + 1 >= 3) THEN TRUE
                  ELSE FALSE
              END,
              locked_out_at = CASE 
                  WHEN lr.status = 'PRESENT' THEN NULL
                  WHEN lr.is_locked_out = TRUE THEN ar.locked_out_at
                  WHEN lr.active_ticket_id IS NOT NULL AND (ar.attempt_count + 1 >= 3) THEN NOW()
                  ELSE ar.locked_out_at
              END,
              active_ticket_id = NULL,
              active_ticket_expires_at = NULL
          FROM locked_record lr
          WHERE ar.id = lr.id
            AND ($4::uuid IS NULL OR lr.active_ticket_id = $4::uuid)
          RETURNING ar.attempt_count, ar.is_locked_out
      )
      SELECT b.attempt_count, b.is_locked_out FROM burn_lease b;
    `;
    const res = await pool.query(query, [targetSessionId, targetCourseId, targetStudentId, targetTicketId]);
    return res.rows[0];
  };

  const executeCheckInCte = async (targetSessionId, targetCourseId, targetStudentId, candidateOtp, targetTicketId) => {
    const targetHash = crypto
      .createHmac('sha256', hmacSecret)
      .update(`${targetCourseId}:${candidateOtp}`)
      .digest('hex');

    const cteQuery = `
      WITH target_session AS (
          SELECT 
              s.session_id, 
              s.course_id, 
              s.semester_id,
              s.week_number,
              s.session_date,
              s.is_locked, 
              (s.otp_expires_at IS NOT NULL AND s.otp_expires_at > NOW()) AS otp_valid,
              (s.active_otp_hash IS NOT NULL AND s.active_otp_hash = $4) AS otp_matched
          FROM attendance_sessions s
          WHERE s.course_id = $2
            AND ($1::uuid IS NULL OR s.session_id = $1::uuid)
          ORDER BY s.created_at DESC
          LIMIT 1
      ),
      verified_enrollment AS (
          SELECT e.student_id
          FROM enrollments e
          LEFT JOIN target_session ts ON TRUE
          WHERE e.course_id = $2
            AND e.student_id = $3
            AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
          LIMIT 1
      ),
      ensure_record AS (
          INSERT INTO attendance_records (
              session_id,
              student_id,
              status,
              verification_method,
              confidence_score
          )
          SELECT 
              ts.session_id,
              ve.student_id,
              'ABSENT',
              'CODE_OTP',
              1.000
          FROM target_session ts
          JOIN verified_enrollment ve ON TRUE
          ON CONFLICT (session_id, student_id) DO NOTHING
          RETURNING id
      ),
      locked_record AS (
          SELECT 
              ar.id, 
              ar.status, 
              ar.marked_at,
              ar.is_locked_out,
              ar.attempt_count,
              ar.active_ticket_id,
              ar.active_ticket_expires_at,
              (ar.active_ticket_expires_at IS NOT NULL AND ar.active_ticket_expires_at > NOW()) AS ticket_valid,
              (ar.active_ticket_id IS NOT NULL AND $5::uuid IS NOT NULL AND ar.active_ticket_id = $5::uuid) AS ticket_matched
          FROM attendance_records ar
          JOIN target_session ts ON ts.session_id = ar.session_id
          WHERE ar.student_id = $3
          FOR UPDATE OF ar
      ),
      upsert_attendance AS (
          UPDATE attendance_records ar
          SET 
              status = CASE 
                  WHEN ts.is_locked = FALSE AND ts.otp_valid = TRUE AND ts.otp_matched = TRUE AND lr.is_locked_out = FALSE AND (lr.ticket_valid = TRUE OR lr.active_ticket_id IS NULL) THEN 'PRESENT'
                  ELSE ar.status
              END,
              verification_method = 'CODE_OTP',
              confidence_score = 1.000,
              marked_at = CASE 
                  WHEN ts.is_locked = FALSE AND ts.otp_valid = TRUE AND ts.otp_matched = TRUE AND lr.is_locked_out = FALSE AND (lr.ticket_valid = TRUE OR lr.active_ticket_id IS NULL) THEN NOW()
                  ELSE ar.marked_at
              END,
              attempt_count = CASE 
                  WHEN ar.status = 'PRESENT' THEN ar.attempt_count
                  WHEN ts.otp_matched = FALSE OR (lr.active_ticket_id IS NOT NULL AND lr.ticket_valid = FALSE) THEN ar.attempt_count + 1
                  ELSE ar.attempt_count
              END,
              is_locked_out = CASE 
                  WHEN ar.status = 'PRESENT' THEN FALSE
                  WHEN ar.is_locked_out = TRUE THEN TRUE
                  WHEN (ts.otp_matched = FALSE OR (lr.active_ticket_id IS NOT NULL AND lr.ticket_valid = FALSE)) AND (ar.attempt_count + 1 >= 3) THEN TRUE
                  ELSE FALSE
              END,
              locked_out_at = CASE 
                  WHEN ar.status = 'PRESENT' THEN NULL
                  WHEN ar.is_locked_out = TRUE THEN ar.locked_out_at
                  WHEN (ts.otp_matched = FALSE OR (lr.active_ticket_id IS NOT NULL AND lr.ticket_valid = FALSE)) AND (ar.attempt_count + 1 >= 3) THEN NOW()
                  ELSE ar.locked_out_at
              END,
              active_ticket_id = CASE
                  WHEN ts.otp_matched = TRUE OR (ar.attempt_count + 1 >= 3) THEN NULL
                  ELSE ar.active_ticket_id
              END,
              active_ticket_expires_at = CASE
                  WHEN ts.otp_matched = TRUE OR (ar.attempt_count + 1 >= 3) THEN NULL
                  ELSE ar.active_ticket_expires_at
              END
          FROM locked_record lr
          JOIN target_session ts ON TRUE
          WHERE ar.id = lr.id
          RETURNING 
              ar.id, 
              ar.status, 
              ar.marked_at, 
              ar.attempt_count, 
              ar.is_locked_out
      )
      SELECT 
          (SELECT session_id FROM target_session) AS session_id,
          (SELECT is_locked FROM target_session) AS is_locked,
          (SELECT otp_valid FROM target_session) AS otp_valid,
          (SELECT otp_matched FROM target_session) AS otp_matched,
          (SELECT student_id FROM verified_enrollment) AS student_id,
          (SELECT is_locked_out FROM locked_record) AS was_locked_out,
          (SELECT ticket_valid FROM locked_record) AS was_ticket_valid,
          (SELECT active_ticket_id FROM locked_record) AS prior_ticket_id,
          ua.id AS record_id,
          ua.status AS record_status,
          ua.attempt_count AS new_attempt_count,
          ua.is_locked_out AS new_is_locked_out
      FROM target_session ts
      LEFT JOIN verified_enrollment ve ON TRUE
      LEFT JOIN upsert_attendance ua ON TRUE;
    `;
    const res = await pool.query(cteQuery, [targetSessionId, targetCourseId, targetStudentId, targetHash, targetTicketId]);
    return res.rows[0];
  };

  await t.test('1. Initial Ticket Lease Issuance (Attempt 1)', async () => {
    const row = await executeTicketCte(sessionId, course_id, student_id);
    assert.ok(row.active_ticket_id, 'Should issue active_ticket_id');
    assert.equal(row.attempt_count, 0, 'Burned attempt_count should be 0 during Attempt 1');
    assert.equal(row.is_locked_out, false, 'Should not be locked out');
    assert.equal(row.was_idempotent_reuse, false, 'First acquisition is not a reuse');
  });

  await t.test('2. Strict Idempotent Lease Preservation (React StrictMode / 3G retry)', async () => {
    // Calling ticket acquisition while lease 1 is active
    const row = await executeTicketCte(sessionId, course_id, student_id);
    assert.equal(row.was_idempotent_reuse, true, 'Subsequent request must reuse active lease');
    assert.equal(row.attempt_count, 0, 'Must NOT increment attempt_count on idempotent retry');
    assert.equal(row.is_locked_out, false);
  });

  await t.test('3. Explicit Modal Close Burns Attempt 1', async () => {
    const recBefore = (await pool.query('SELECT active_ticket_id FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, student_id])).rows[0];
    const closeRes = await executeCloseCte(sessionId, course_id, student_id, recBefore.active_ticket_id);
    assert.equal(closeRes.attempt_count, 1, 'Attempt count must increment to 1 after close');
    assert.equal(closeRes.is_locked_out, false, 'Should not be locked out after 1 burn');

    const recAfter = (await pool.query('SELECT active_ticket_id FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, student_id])).rows[0];
    assert.equal(recAfter.active_ticket_id, null, 'active_ticket_id must be cleared on close');
  });

  await t.test('4. Lazy Expiration Sweep (Simulating Force-Closed Browser Tab)', async () => {
    // Request Attempt 2
    const row2 = await executeTicketCte(sessionId, course_id, student_id);
    assert.ok(row2.active_ticket_id, 'Should issue ticket for Attempt 2');
    assert.equal(row2.attempt_count, 1, 'Attempt count should be 1');

    // Simulate force-closing tab: student never calls /close, but 180s expires in background
    await pool.query(`
      UPDATE attendance_records
      SET active_ticket_expires_at = NOW() - INTERVAL '10 seconds'
      WHERE session_id = $1 AND student_id = $2;
    `, [sessionId, student_id]);

    // Student returns after 180s and requests ticket for Attempt 3:
    // Atomic CTE must lazily burn Attempt 2 (bumping attempt_count to 2) and issue Attempt 3!
    const row3 = await executeTicketCte(sessionId, course_id, student_id);
    assert.equal(row3.was_lazy_expired, true, 'Lazy sweep must detect expired lease');
    assert.equal(row3.attempt_count, 2, 'Burned attempt_count must now be 2');
    assert.equal(row3.is_locked_out, false, 'Must NOT be locked out on Attempt 3 ingress');
    assert.ok(row3.active_ticket_id, 'Must grant usable ticket for Attempt 3');
  });

  await t.test('5. Attempt 3 Usability & Lockout on 3rd Burn', async () => {
    const rec3 = (await pool.query('SELECT active_ticket_id FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, student_id])).rows[0];
    assert.ok(rec3.active_ticket_id, 'Student is actively on Attempt 3');

    // Student dismisses or enters bad PIN on Attempt 3:
    const close3 = await executeCloseCte(sessionId, course_id, student_id, rec3.active_ticket_id);
    assert.equal(close3.attempt_count, 3, 'Attempt count must reach ceiling (3)');
    assert.equal(close3.is_locked_out, true, 'Circuit breaker MUST trip to TRUE on 3rd burn');

    // Any subsequent ticket request must be blocked
    const row4 = await executeTicketCte(sessionId, course_id, student_id);
    assert.equal(row4.is_locked_out, true, 'Must remain locked out');
    assert.equal(row4.active_ticket_id, null, 'Must refuse to issue any new ticket');
  });

  await t.test('6. Faculty Unlock Override in Verification Desk', async () => {
    // Faculty resets student
    await pool.query(`
      UPDATE attendance_records
      SET attempt_count = 0,
          is_locked_out = FALSE,
          locked_out_at = NULL,
          active_ticket_id = NULL,
          active_ticket_expires_at = NULL
      WHERE session_id = $1 AND student_id = $2;
    `, [sessionId, student_id]);

    const rowReset = await executeTicketCte(sessionId, course_id, student_id);
    assert.equal(rowReset.is_locked_out, false, 'Student is restored');
    assert.equal(rowReset.attempt_count, 0, 'Attempt count is reset to 0');
    assert.ok(rowReset.active_ticket_id, 'Student can acquire new tickets again');
  });

  await t.test('7. True Concurrent Burst Contention (Promise.all on fresh student without pre-existing record)', async () => {
    // Enroll a secondary student (student2) if not already enrolled
    await pool.query(`
      INSERT INTO enrollments (student_id, course_id, course_code, semester_id, status)
      VALUES ('student2', $1, $2, $3, 'ENROLLED')
      ON CONFLICT (student_id, course_id, semester_id) DO NOTHING;
    `, [course_id, code, semester_id]);

    // Guarantee student2 has NO pre-existing row in attendance_records
    await pool.query('DELETE FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, 'student2']);

    // Fire two ticket requests concurrently via Promise.all (simulating true network burst / React StrictMode)
    const [resA, resB] = await Promise.all([
      requestTicketBff(sessionId, course_id, 'student2'),
      requestTicketBff(sessionId, course_id, 'student2'),
    ]);

    // Both requests must succeed and return a valid ticket
    assert.ok(resA && resA.active_ticket_id, 'Request A must return an active ticket');
    assert.ok(resB && resB.active_ticket_id, 'Request B must return an active ticket');

    // Both must receive the EXACT same ticket UUID (idempotency preserved under concurrent lock contention)
    assert.equal(resA.active_ticket_id, resB.active_ticket_id, 'Both concurrent requests must resolve to the identical active ticket UUID');
    assert.equal(resA.attempt_count, 0, 'Attempt count must remain 0');
    assert.equal(resB.attempt_count, 0, 'Attempt count must remain 0');

    // One of them is the creator (was_idempotent_reuse = false), one is the follower (was_idempotent_reuse = true)
    const hasCreator = (!resA.was_idempotent_reuse && resB.was_idempotent_reuse) || (resA.was_idempotent_reuse && !resB.was_idempotent_reuse);
    assert.ok(hasCreator, 'Exactly one request must mint and the other must idempotently reuse the lease');

    // Database verification: Exactly 1 record in attendance_records
    const recCheck = await pool.query('SELECT * FROM attendance_records WHERE session_id = $1 AND student_id = $2', [sessionId, 'student2']);
    assert.equal(recCheck.rows.length, 1, 'Exactly one attendance row must exist for student2 in attendance_records');
    assert.equal(recCheck.rows[0].attempt_count, 0);
    assert.equal(recCheck.rows[0].is_locked_out, false);
  });

  await t.test('8. Expired-Ticket Check-In Rejection on Attempt 3 (Enforces Hard Lockout)', async () => {
    // Setup student on Attempt 3 with an expired lease (180s elapsed), while session OTP is still active
    const ticketId3 = crypto.randomUUID();
    await pool.query(`
      UPDATE attendance_records
      SET attempt_count = 2,
          is_locked_out = FALSE,
          locked_out_at = NULL,
          active_ticket_id = $3,
          active_ticket_expires_at = NOW() - INTERVAL '5 seconds',
          ticket_opened_at = NOW() - INTERVAL '185 seconds'
      WHERE session_id = $1 AND student_id = $2;
    `, [sessionId, student_id, ticketId3]);

    // Student submits the CORRECT passcode after their 180s ticket expired
    const checkInRes = await executeCheckInCte(sessionId, course_id, student_id, otpPin, ticketId3);

    // Assert CTE output
    assert.equal(checkInRes.otp_matched, true, 'OTP must match canonical hash');
    assert.equal(checkInRes.otp_valid, true, 'Lecturer 5-minute session is still active');
    assert.equal(checkInRes.was_ticket_valid, false, 'Ticket lease must be marked expired');
    assert.equal(checkInRes.record_status, 'ABSENT', 'Must REJECT check-in: status must remain ABSENT');
    assert.equal(checkInRes.new_attempt_count, 3, 'Must increment attempt_count from 2 to 3');
    assert.equal(checkInRes.new_is_locked_out, true, 'Must trip circuit breaker to TRUE (hard lockout)');

    // Assert DB persistence
    const dbRec = (await pool.query(`
      SELECT status, attempt_count, is_locked_out, locked_out_at, active_ticket_id
      FROM attendance_records
      WHERE session_id = $1 AND student_id = $2;
    `, [sessionId, student_id])).rows[0];

    assert.equal(dbRec.status, 'ABSENT', 'DB record status must remain ABSENT');
    assert.equal(dbRec.attempt_count, 3, 'DB record attempt_count must be 3');
    assert.equal(dbRec.is_locked_out, true, 'DB record is_locked_out must be TRUE');
    assert.ok(dbRec.locked_out_at, 'Must timestamp locked_out_at in DB');
    assert.equal(dbRec.active_ticket_id, null, 'Active ticket must be cleared upon lockout');
  });

  // Final cleanup
  await cleanSessions();
  await pool.end();
});
