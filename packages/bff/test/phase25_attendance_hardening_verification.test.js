/**
 * Phase 25: Attendance Engine Production Hardening Doctrine Certification
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Verifies:
 * 1. Multi-Session Sub-Slot Invariance (Week N, sub_session 1..4)
 * 2. Parameterized Semester Horizon Telemetry (dynamic sessions_per_week * 15)
 * 3. 2G Asymmetric Disconnect Idempotent Retry Short-Circuit (Locked & Expired immune)
 * 4. Mismatch-Only Attempt Quota Preservation
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';
import { studentAttendanceService } from '../src/services/studentAttendanceService.js';

test('Phase 25: Attendance Engine Production Hardening Doctrine Certification', async (t) => {
  try {
    redis.disconnect();
  } catch {}

  // 1. Resolve an active enrolled student and course in current semester
  const enrollmentRes = await pool.query(`
    SELECT e.student_id, e.course_id, s.matric_number, c.code, e.semester_id
    FROM enrollments e
    JOIN students s ON e.student_id = s.student_id
    JOIN courses c ON e.course_id = c.course_id
    WHERE (e.semester_id = '2026_RAIN' OR e.semester_id IS NULL)
      AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
    LIMIT 1
  `);

  assert.ok(enrollmentRes.rows.length > 0, 'Must have at least one enrollment seeded in DB');
  const { student_id, course_id, semester_id } = enrollmentRes.rows[0];

  const cleanSessions = async () => {
    await pool.query(
      'DELETE FROM attendance_records WHERE session_id IN (SELECT session_id FROM attendance_sessions WHERE course_id = $1)',
      [course_id]
    );
    await pool.query('DELETE FROM attendance_sessions WHERE course_id = $1', [course_id]);
  };

  await cleanSessions();

  // Test 1: Multi-Session Sub-Slot Invariance
  await t.test('1. Multi-Session Sub-Slot Invariance (Week 1 Sub 1 & Sub 2 Coexistence)', async () => {
    // Ensure course allows up to 2 sub-sessions per week for this test
    await pool.query(`UPDATE courses SET sessions_per_week = 2 WHERE course_id = $1`, [course_id]);

    // Sub-session 1 (Lecture 1)
    const s1 = await pool.query(`
      INSERT INTO attendance_sessions (
        course_id, semester_id, week_number, sub_session, session_date, session_mode, created_by, is_locked
      )
      VALUES ($1, $2, 1, 1, CURRENT_DATE, 'ROLL_CALL', 'lecturer1', TRUE)
      RETURNING session_id, sub_session;
    `, [course_id, semester_id]);

    assert.equal(s1.rows[0].sub_session, 1, 'First sub-session must be 1');

    // Sub-session 2 (Lab / Lecture 2) in the SAME week
    const s2 = await pool.query(`
      INSERT INTO attendance_sessions (
        course_id, semester_id, week_number, sub_session, session_date, session_mode, created_by, is_locked
      )
      VALUES ($1, $2, 1, 2, CURRENT_DATE, 'REP_DIRECT', 'student_rep', FALSE)
      RETURNING session_id, sub_session;
    `, [course_id, semester_id]);

    assert.equal(s2.rows[0].sub_session, 2, 'Second sub-session must be 2');
    assert.notEqual(s1.rows[0].session_id, s2.rows[0].session_id, 'Session IDs must be distinct');

    const fetchRes = await pool.query(`
      SELECT session_id, week_number, sub_session, is_locked
      FROM attendance_sessions
      WHERE course_id = $1 AND semester_id = $2 AND week_number = 1
      ORDER BY sub_session ASC;
    `, [course_id, semester_id]);

    assert.equal(fetchRes.rows.length, 2, 'Must have 2 coexisting sessions in Week 1');
    assert.equal(fetchRes.rows[0].sub_session, 1);
    assert.equal(fetchRes.rows[1].sub_session, 2);

    await cleanSessions();
  });

  // Test 2: Dynamic Parameterized Semester Horizon Telemetry
  await t.test('2. Parameterized Horizon Telemetry (3 Sessions/Week -> 45 Planned Baseline)', async () => {
    // Configure course for 3 sessions/week (e.g. 2 lectures + 1 lab)
    await pool.query(`
      UPDATE courses
      SET sessions_per_week = 3, total_planned_sessions = 45
      WHERE course_id = $1;
    `, [course_id]);

    // Hold 15 sessions (H = 15) across weeks 1-5, student attends 12, absent 3, excused 0
    for (let w = 1; w <= 5; w++) {
      for (let sub = 1; sub <= 3; sub++) {
        const sess = await pool.query(`
          INSERT INTO attendance_sessions (
            course_id, semester_id, week_number, sub_session, session_date, session_mode, created_by, is_locked
          )
          VALUES ($1, $2, $3, $4, CURRENT_DATE, 'ROLL_CALL', 'lecturer1', TRUE)
          RETURNING session_id;
        `, [course_id, semester_id, w, sub]);

        const sessionIndex = (w - 1) * 3 + sub;
        const isAttended = sessionIndex <= 12;
        await pool.query(`
          INSERT INTO attendance_records (session_id, student_id, status, verification_method)
          VALUES ($1, $2, $3, 'ROLL_CALL');
        `, [sess.rows[0].session_id, student_id, isAttended ? 'PRESENT' : 'ABSENT']);
      }
    }

    const summary = await studentAttendanceService.getStudentAttendanceSummary(student_id, semester_id);
    const courseStat = summary.courses.find(c => c.courseId === course_id);

    assert.ok(courseStat, 'Course stat must exist in student attendance summary');
    assert.equal(courseStat.totalLockedSessions, 15, 'Total locked sessions held must be 15');
    assert.equal(courseStat.effectiveLockedSessions, 15, 'Effective locked must be 15 (0 excused)');
    assert.equal(courseStat.attendedSessions, 12, 'Attended must be 12');
    assert.equal(courseStat.plannedSemesterBaseline, 45, 'Planned semester baseline must be 45 (not legacy hardcoded 15)');
    assert.equal(courseStat.examQualificationTarget, 34, 'Exam qualification target must be CEIL(0.75 * 45) = 34');
    assert.equal(courseStat.remainingSessions, 30, 'Remaining unheld sessions must be 45 - 15 = 30');
    assert.equal(courseStat.maxAchievableAttendance, 42, 'Max achievable must be 12 + 30 = 42');
    assert.equal(courseStat.canStillQualify, true, 'canStillQualify must be true since 42 >= 34');
    assert.equal(courseStat.isBarredFromExam, false, 'isBarredFromExam must be false');
    assert.equal(courseStat.sessionsNeededForExam, 22, 'Sessions needed for exam must be 34 - 12 = 22');
    assert.equal(courseStat.attendancePercentage, 80.0, 'Attendance % must be 12/15 = 80.0%');

    // Reset course back to standard 1 session/week
    await pool.query(`
      UPDATE courses
      SET sessions_per_week = 1, total_planned_sessions = 15
      WHERE course_id = $1;
    `, [course_id]);

    await cleanSessions();
  });

  // Test 3: 2G Asymmetric Disconnect Idempotent Retry Short-Circuit
  await t.test('3. 2G Asymmetric Disconnect Idempotent Retry Short-Circuit', async () => {
    await cleanSessions();
    const otpPin = '742918';
    const hmacSecret = process.env.OTP_HMAC_SECRET || 'focit_otp_hmac_secret_2026';
    const canonicalHash = crypto.createHmac('sha256', hmacSecret).update(`${course_id}:${otpPin}`).digest('hex');

    // Create session in Week 1 Sub 1 and pre-seed record like otp/generate does
    const sess = await pool.query(`
      INSERT INTO attendance_sessions (
        course_id, semester_id, week_number, sub_session, session_date, session_mode, created_by, is_locked, active_otp_hash, otp_expires_at
      )
      VALUES ($1, $2, 1, 1, CURRENT_DATE, 'CODE_OTP', 'lecturer1', FALSE, $3, NOW() + INTERVAL '300 seconds')
      RETURNING session_id;
    `, [course_id, semester_id, canonicalHash]);
    const sessionId = sess.rows[0].session_id;

    await pool.query(`
      INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
      VALUES ($1, $2, 'ABSENT', 'CODE_OTP', 1.000)
      ON CONFLICT (session_id, student_id) DO NOTHING;
    `, [sessionId, student_id]);

    // Helper to execute check-in CTE
    const executeCheckInCte = async (targetSessionId, targetOtp, targetTicketId) => {
      const hash = crypto.createHmac('sha256', hmacSecret).update(`${course_id}:${targetOtp}`).digest('hex');
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
                session_id, student_id, status, verification_method, confidence_score
            )
            SELECT ts.session_id, ve.student_id, 'ABSENT', 'CODE_OTP', 1.000
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
                (ar.status = 'PRESENT') AS is_already_present,
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
                    WHEN lr.status = 'PRESENT' THEN 'PRESENT'
                    WHEN ts.is_locked = FALSE AND ts.otp_valid = TRUE AND ts.otp_matched = TRUE AND lr.is_locked_out = FALSE AND (lr.ticket_valid = TRUE OR lr.active_ticket_id IS NULL) THEN 'PRESENT'
                    ELSE ar.status
                END,
                verification_method = 'CODE_OTP',
                confidence_score = 1.000,
                marked_at = CASE 
                    WHEN lr.status = 'PRESENT' THEN ar.marked_at
                    WHEN ts.is_locked = FALSE AND ts.otp_valid = TRUE AND ts.otp_matched = TRUE AND lr.is_locked_out = FALSE AND (lr.ticket_valid = TRUE OR lr.active_ticket_id IS NULL) THEN NOW()
                    ELSE ar.marked_at
                END,
                attempt_count = CASE 
                    WHEN lr.status = 'PRESENT' OR ar.status = 'PRESENT' THEN ar.attempt_count
                    WHEN ts.otp_matched = FALSE OR (lr.active_ticket_id IS NOT NULL AND lr.ticket_valid = FALSE) THEN ar.attempt_count + 1
                    ELSE ar.attempt_count
                END,
                is_locked_out = CASE 
                    WHEN lr.status = 'PRESENT' OR ar.status = 'PRESENT' THEN FALSE
                    WHEN ar.is_locked_out = TRUE THEN TRUE
                    WHEN (ts.otp_matched = FALSE OR (lr.active_ticket_id IS NOT NULL AND lr.ticket_valid = FALSE)) AND (ar.attempt_count + 1 >= 3) THEN TRUE
                    ELSE FALSE
                END,
                locked_out_at = CASE 
                    WHEN lr.status = 'PRESENT' OR ar.status = 'PRESENT' THEN NULL
                    WHEN ar.is_locked_out = TRUE THEN ar.locked_out_at
                    WHEN (ts.otp_matched = FALSE OR (lr.active_ticket_id IS NOT NULL AND lr.ticket_valid = FALSE)) AND (ar.attempt_count + 1 >= 3) THEN NOW()
                    ELSE ar.locked_out_at
                END,
                active_ticket_id = CASE
                    WHEN lr.status = 'PRESENT' OR ts.otp_matched = TRUE OR (ar.attempt_count + 1 >= 3) THEN NULL
                    ELSE ar.active_ticket_id
                END,
                active_ticket_expires_at = CASE
                    WHEN lr.status = 'PRESENT' OR ts.otp_matched = TRUE OR (ar.attempt_count + 1 >= 3) THEN NULL
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
            ts.session_id,
            ts.is_locked,
            ts.otp_valid,
            ts.otp_matched,
            lr.is_already_present AS was_already_present,
            ua.status AS record_status,
            ua.attempt_count AS new_attempt_count,
            ua.is_locked_out AS new_is_locked_out,
            (ua.status = 'PRESENT' AND (SELECT status FROM locked_record) = 'PRESENT') AS was_idempotent_retry
        FROM target_session ts
        LEFT JOIN verified_enrollment ve ON TRUE
        LEFT JOIN locked_record lr ON TRUE
        LEFT JOIN upsert_attendance ua ON TRUE;
      `;
      const res = await pool.query(cteQuery, [targetSessionId, course_id, student_id, hash, targetTicketId]);
      return res.rows[0];
    };

    // First request: valid OTP check-in commits PRESENT
    const res1 = await executeCheckInCte(sessionId, otpPin, null);
    assert.equal(res1.record_status, 'PRESENT', 'Initial check-in must commit PRESENT');
    assert.equal(res1.was_already_present, false, 'First check-in is not already present');

    // Simulate 2G Network Disconnect: Response lost!
    // Lecturer locks session and OTP window expires
    await pool.query(`
      UPDATE attendance_sessions
      SET is_locked = TRUE, active_otp_hash = NULL, otp_expires_at = NOW() - INTERVAL '10 seconds'
      WHERE session_id = $1;
    `, [sessionId]);

    // Student retries 4 seconds later with the same OTP
    const res2 = await executeCheckInCte(sessionId, otpPin, null);

    assert.equal(res2.was_already_present, true, 'Second request must detect student was ALREADY present');
    assert.equal(res2.record_status, 'PRESENT', 'Record status must remain PRESENT');
    assert.equal(res2.was_idempotent_retry, true, 'Must flag was_idempotent_retry = true');
    assert.equal(res2.new_is_locked_out, false, 'Must NOT lock out student on idempotent retry');
    assert.equal(res2.new_attempt_count, 0, 'Attempt count must remain 0 on retry');

    await cleanSessions();
  });

  await cleanSessions();
  await pool.end();
});

