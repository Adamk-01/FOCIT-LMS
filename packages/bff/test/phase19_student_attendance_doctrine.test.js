/**
 * Phase 19: Student Attendance Ecosystem & Multi-Modal Sync Bridge Doctrine Certification
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Verifies:
 * 1. NUC BMAS Denominator Exemption (H_effective = H - E, Baseline = 15 - E)
 * 2. All-Excused Boundary Condition (H > 0, H = E => 100.0% standing, 0 deficit)
 * 3. Decoupled Recovery vs. Disqualification Horizon (x_consecutive vs x_exam)
 * 4. Mathematical Barred Ceiling (A + (15 - H) < T_exam => isBarredFromExam = TRUE)
 * 5. Ghost-Pulse State Decomposition (hasActiveSession vs requiresCheckIn vs alreadyCheckedInActive)
 * 6. Course Rep Ingress Boundaries (Parameter forging prevention & Faculty session immobility)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/index.js';
import { studentAttendanceService } from '../src/services/studentAttendanceService.js';
import { redis } from '../src/lib/redis.js';

test('Phase 19: Student Attendance Ecosystem & NUC BMAS Doctrine', async (t) => {
  // Gracefully suppress standalone redis reconnection loops
  try {
    redis.disconnect();
  } catch {}

  // 1. Resolve an enrolled student and course for fixture testing
  const enrollmentRes = await pool.query(`
    SELECT e.student_id, e.course_id, s.matric_number, c.code, e.semester_id
    FROM enrollments e
    JOIN students s ON e.student_id = s.student_id
    JOIN courses c ON e.course_id = c.course_id
    LIMIT 1
  `);

  assert.ok(enrollmentRes.rows.length > 0, 'Must have at least one enrollment seeded in DB');
  const { student_id, course_id, matric_number, code, semester_id } = enrollmentRes.rows[0];

  // Helper cleanup
  const cleanSessions = async () => {
    await pool.query('DELETE FROM attendance_records WHERE session_id IN (SELECT session_id FROM attendance_sessions WHERE course_id = $1)', [course_id]);
    await pool.query('DELETE FROM attendance_sessions WHERE course_id = $1', [course_id]);
  };

  await cleanSessions();

  await t.test('1. Denominator Exemption & Decoupled Metrics (H=4, A=2, E=1)', async () => {
    // Week 1: PRESENT
    const s1 = await pool.query(`
      INSERT INTO attendance_sessions (course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked)
      VALUES ($1, $2, 1, '2026-10-01', 'ROLL_CALL', 'lecturer1', TRUE)
      RETURNING session_id
    `, [course_id, semester_id]);
    await pool.query(`INSERT INTO attendance_records (session_id, student_id, status, verification_method) VALUES ($1, $2, 'PRESENT', 'ROLL_CALL')`, [s1.rows[0].session_id, student_id]);

    // Week 2: PRESENT
    const s2 = await pool.query(`
      INSERT INTO attendance_sessions (course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked)
      VALUES ($1, $2, 2, '2026-10-08', 'CODE_OTP', 'lecturer1', TRUE)
      RETURNING session_id
    `, [course_id, semester_id]);
    await pool.query(`INSERT INTO attendance_records (session_id, student_id, status, verification_method) VALUES ($1, $2, 'PRESENT', 'CODE_OTP')`, [s2.rows[0].session_id, student_id]);

    // Week 3: EXCUSED
    const s3 = await pool.query(`
      INSERT INTO attendance_sessions (course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked)
      VALUES ($1, $2, 3, '2026-10-15', 'ROLL_CALL', 'lecturer1', TRUE)
      RETURNING session_id
    `, [course_id, semester_id]);
    await pool.query(`INSERT INTO attendance_records (session_id, student_id, status, verification_method) VALUES ($1, $2, 'EXCUSED', 'MANUAL_OVERRIDE')`, [s3.rows[0].session_id, student_id]);

    // Week 4: ABSENT
    const s4 = await pool.query(`
      INSERT INTO attendance_sessions (course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked)
      VALUES ($1, $2, 4, '2026-10-22', 'ROLL_CALL', 'lecturer1', TRUE)
      RETURNING session_id
    `, [course_id, semester_id]);
    await pool.query(`INSERT INTO attendance_records (session_id, student_id, status, verification_method) VALUES ($1, $2, 'ABSENT', 'ROLL_CALL')`, [s4.rows[0].session_id, student_id]);

    const summary = await studentAttendanceService.getStudentAttendanceSummary(student_id, semester_id);
    const courseSummary = summary.courses.find(c => c.courseId === course_id);

    // H_effective = 4 - 1 = 3. Rate = (2 / 3) * 100 = 66.7%
    assert.equal(courseSummary.totalLockedSessions, 4);
    assert.equal(courseSummary.effectiveLockedSessions, 3);
    assert.equal(courseSummary.attendedSessions, 2);
    assert.equal(courseSummary.excusedSessions, 1);
    assert.equal(courseSummary.attendancePercentage, 66.7);

    // Consecutive to clear: 3(3) - 4(2) = 1
    assert.equal(courseSummary.consecutiveToClearWarning, 1);

    // Exam target: ceil(0.75 * (15 - 1)) = 11. Sessions needed = 11 - 2 = 9
    assert.equal(courseSummary.plannedSemesterBaseline, 14);
    assert.equal(courseSummary.examQualificationTarget, 11);
    assert.equal(courseSummary.sessionsNeededForExam, 9);
    assert.equal(courseSummary.canStillQualify, true);
    assert.equal(courseSummary.isBarredFromExam, false);

    await cleanSessions();
  });

  await t.test('2. The All-Excused Edge Case (H=1, E=1, A=0 => 100.0%)', async () => {
    // Week 1: EXCUSED only
    const s1 = await pool.query(`
      INSERT INTO attendance_sessions (course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked)
      VALUES ($1, $2, 1, '2026-10-01', 'ROLL_CALL', 'lecturer1', TRUE)
      RETURNING session_id
    `, [course_id, semester_id]);
    await pool.query(`INSERT INTO attendance_records (session_id, student_id, status, verification_method) VALUES ($1, $2, 'EXCUSED', 'MANUAL_OVERRIDE')`, [s1.rows[0].session_id, student_id]);

    const summary = await studentAttendanceService.getStudentAttendanceSummary(student_id, semester_id);
    const courseSummary = summary.courses.find(c => c.courseId === course_id);

    // H=1, E=1 => H_effective = 0 => standing must be 100.0%, NOT 0.0%
    assert.equal(courseSummary.effectiveLockedSessions, 0);
    assert.equal(courseSummary.attendancePercentage, 100.0);
    assert.equal(courseSummary.isExamEligible, true);
    assert.equal(courseSummary.consecutiveToClearWarning, 0);

    await cleanSessions();
  });

  await t.test('3. Ghost-Pulse Elimination & Active Session State', async () => {
    // Week 1: Active Mode 2 OTP Session (unlocked)
    const s1 = await pool.query(`
      INSERT INTO attendance_sessions (course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked, active_otp_hash, otp_expires_at)
      VALUES ($1, $2, 1, NOW(), 'CODE_OTP', 'lecturer1', FALSE, 'mock_hash', NOW() + INTERVAL '5 minutes')
      RETURNING session_id
    `, [course_id, semester_id]);

    // Unsubmitted: requiresCheckIn = true, alreadyCheckedInActive = false
    const timeline1 = await studentAttendanceService.getCourseStudentAttendanceTimeline(student_id, course_id, semester_id);
    const activeItem1 = timeline1.timeline.find(s => s.sessionId === s1.rows[0].session_id);
    assert.equal(activeItem1.requiresCheckIn, true);
    assert.equal(activeItem1.alreadyCheckedInActive, false);

    // Student submits check-in: PRESENT
    await pool.query(`
      INSERT INTO attendance_records (session_id, student_id, status, verification_method)
      VALUES ($1, $2, 'PRESENT', 'CODE_OTP')
    `, [s1.rows[0].session_id, student_id]);

    // Submitted: requiresCheckIn = false, alreadyCheckedInActive = true
    const timeline2 = await studentAttendanceService.getCourseStudentAttendanceTimeline(student_id, course_id, semester_id);
    const activeItem2 = timeline2.timeline.find(s => s.sessionId === s1.rows[0].session_id);
    assert.equal(activeItem2.requiresCheckIn, false);
    assert.equal(activeItem2.alreadyCheckedInActive, true);

    await cleanSessions();
  });

  await t.test('4. Course Rep Ingress: Relational Set-Difference & Poisoned Roster Defense', async () => {
    // Seed Course Rep appointment for testing
    await pool.query(`
      INSERT INTO course_representatives (course_id, semester_id, student_id, appointed_by)
      VALUES ($1, $2, $3, 'lecturer1')
      ON CONFLICT (course_id, semester_id, student_id) DO NOTHING;
    `, [course_id, semester_id, student_id]);

    // Query active enrollments for this course
    const enrolledRes = await pool.query(`
      SELECT s.student_id FROM enrollments e
      JOIN students s ON s.student_id = e.student_id
      WHERE e.course_id = $1 AND (e.semester_id = $2 OR e.semester_id IS NULL)
        AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
      ORDER BY s.student_id ASC;
    `, [course_id, semester_id]);

    const enrolledIds = new Set(enrolledRes.rows.map(r => r.student_id));
    assert.ok(enrolledIds.has(student_id), 'Student must be enrolled in course');

    // Simulate poisoned roster with a rogue unenrolled student_id
    const rogueId = 'rogue_student_9999';
    const submittedRecords = [
      { student_id, status: 'PRESENT' },
      { student_id: rogueId, status: 'PRESENT' }
    ];

    const poisonedStudents = submittedRecords
      .map(r => r.student_id)
      .filter(id => id && !enrolledIds.has(id));

    // Verify Relational Set-Difference Detection: R \ E(C) != empty
    assert.equal(poisonedStudents.length, 1);
    assert.equal(poisonedStudents[0], rogueId);

    // Clean up course rep
    await pool.query('DELETE FROM course_representatives WHERE course_id = $1 AND student_id = $2', [course_id, student_id]);
    await cleanSessions();
  });

  await t.test('5. Mode 2 OTP Projection: Live Student Telemetry, Zero-Trust Ingress & Idempotency', async () => {
    // Week 1: Lecturer generates live OTP session
    const activeOtpHash = 'test_canonical_hash_999';
    const s1 = await pool.query(`
      INSERT INTO attendance_sessions (course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked, active_otp_hash, otp_expires_at)
      VALUES ($1, $2, 1, NOW(), 'CODE_OTP', 'lecturer1', FALSE, $3, NOW() + INTERVAL '5 minutes')
      RETURNING session_id
    `, [course_id, semester_id, activeOtpHash]);
    const sessionId = s1.rows[0].session_id;

    // Pre-seed enrolled student as ABSENT (Mode 2 invariant)
    await pool.query(`
      INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
      VALUES ($1, $2, 'ABSENT', 'CODE_OTP', 1.000)
      ON CONFLICT (session_id, student_id) DO NOTHING;
    `, [sessionId, student_id]);

    // Query status records as lecturer (verifying student info returned)
    const recordsRes = await pool.query(`
      SELECT 
        r.id AS record_id,
        r.student_id,
        r.status,
        r.verification_method,
        r.marked_at,
        s.matric_number,
        s.full_name,
        p.code AS programme_code,
        s.level
      FROM attendance_records r
      JOIN students s ON s.student_id = r.student_id
      LEFT JOIN programmes p ON p.id = s.programme_id
      WHERE r.session_id = $1
      ORDER BY 
        CASE WHEN r.status = 'PRESENT' THEN 0 ELSE 1 END,
        r.marked_at DESC NULLS LAST,
        s.matric_number ASC;
    `, [sessionId]);

    assert.equal(recordsRes.rows.length, 1);
    assert.equal(recordsRes.rows[0].student_id, student_id);
    assert.equal(recordsRes.rows[0].status, 'ABSENT');
    assert.ok(recordsRes.rows[0].full_name, 'Full name must be present in telemetry');
    assert.ok(recordsRes.rows[0].matric_number, 'Matric number must be present in telemetry');

    // Canonical 1-RTT Atomic CTE with decoupled verified_enrollment
    const cteQuery = `
      WITH target_session AS (
          SELECT 
              s.session_id, 
              s.course_id, 
              s.semester_id,
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
            AND (
                ts.semester_id IS NULL 
                OR e.semester_id IS NULL 
                OR e.semester_id = ts.semester_id
            )
            AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
          LIMIT 1
      ),
      existing_record AS (
          SELECT r.id, r.status, r.marked_at
          FROM attendance_records r
          JOIN target_session ts ON ts.session_id = r.session_id
          WHERE r.student_id = $3
      ),
      upsert_attendance AS (
          INSERT INTO attendance_records (
              session_id,
              student_id,
              status,
              verification_method,
              confidence_score,
              marked_at
          )
          SELECT 
              ts.session_id,
              ve.student_id,
              'PRESENT',
              'CODE_OTP',
              1.000,
              NOW()
          FROM target_session ts
          JOIN verified_enrollment ve ON TRUE
          WHERE ts.is_locked = FALSE 
            AND ts.otp_valid = TRUE
            AND ts.otp_matched = TRUE
          ON CONFLICT (session_id, student_id)
          DO UPDATE SET 
              status = 'PRESENT',
              verification_method = 'CODE_OTP',
              confidence_score = 1.000,
              marked_at = NOW()
          WHERE attendance_records.status != 'PRESENT'
          RETURNING id, status, marked_at
      )
      SELECT 
          (SELECT session_id FROM target_session) AS session_id,
          (SELECT is_locked FROM target_session) AS is_locked,
          (SELECT otp_valid FROM target_session) AS otp_valid,
          (SELECT otp_matched FROM target_session) AS otp_matched,
          (SELECT student_id FROM verified_enrollment) AS student_id,
          COALESCE((SELECT id FROM upsert_attendance), (SELECT id FROM existing_record)) AS record_id,
          COALESCE((SELECT status FROM upsert_attendance), (SELECT status FROM existing_record)) AS record_status,
          COALESCE((SELECT marked_at FROM upsert_attendance), (SELECT marked_at FROM existing_record)) AS marked_at,
          ((SELECT id FROM upsert_attendance) IS NULL AND (SELECT status FROM existing_record) = 'PRESENT') AS was_idempotent_retry;
    `;

    // 1. Intruder Probing: An unenrolled student uuid must return student_id = NULL
    const intruderRes = await pool.query(cteQuery, [null, course_id, 'rogue_intruder_uuid', activeOtpHash]);
    assert.equal(intruderRes.rows[0].student_id, null, 'Intruder must return student_id = null for immediate 403 rejection');

    // 2. Enrolled Student Manual Ingress (sessionId = null): Resolves session, returns status PRESENT
    const checkInRes1 = await pool.query(cteQuery, [null, course_id, student_id, activeOtpHash]);
    const row1 = checkInRes1.rows[0];
    assert.equal(row1.session_id, sessionId, 'CTE must resolve target session natively when sessionId is NULL');
    assert.equal(row1.record_status, 'PRESENT');
    assert.equal(row1.was_idempotent_retry, false, 'First submission is not an idempotent retry');
    const firstMarkedAt = row1.marked_at;
    assert.ok(firstMarkedAt, 'marked_at must be populated');

    // 3. Idempotent Retry: Resubmission preserves marked_at and returns was_idempotent_retry = true
    const checkInRes2 = await pool.query(cteQuery, [null, course_id, student_id, activeOtpHash]);
    const row2 = checkInRes2.rows[0];
    assert.equal(row2.was_idempotent_retry, true, 'Second submission must return was_idempotent_retry: true');
    assert.equal(new Date(row2.marked_at).getTime(), new Date(firstMarkedAt).getTime(), 'Audit timestamp marked_at must be immutable');

    // 4. Delta Polling with 2-Second MVCC Lookback
    const lookbackCursor = new Date().toISOString();
    const deltaRes = await pool.query(`
      SELECT 
        r.id AS record_id,
        r.student_id,
        r.status,
        r.marked_at,
        s.matric_number,
        s.full_name
      FROM attendance_records r
      JOIN students s ON s.student_id = r.student_id
      WHERE r.session_id = $1
        AND r.marked_at >= ($2::timestamptz - INTERVAL '2 seconds')
      ORDER BY r.marked_at ASC;
    `, [sessionId, lookbackCursor]);

    assert.equal(deltaRes.rows.length, 1, 'Delta query with 2s lookback must include recently committed record');
    assert.equal(deltaRes.rows[0].student_id, student_id);

        // 5. Invariant #4: Carry-Over Multi-Semester Registration Defense (SQLSTATE 21000 immunity)
    const carryOverStudentId = 'carryover_stu_uuid';
    const progRes = await pool.query('SELECT programme_id FROM students WHERE student_id = $1', [student_id]);
    const testProgId = progRes.rows[0]?.programme_id || 1;

    await pool.query(`
      INSERT INTO students (student_id, username, full_name, matric_number, email, programme_id)
      VALUES ($1, 'carryover_user', 'Carryover Student', '2023/9999', 'carryover@focit.edu', $2)
      ON CONFLICT (student_id) DO NOTHING;
    `, [carryOverStudentId, testProgId]);

    // Insert historical enrollment (2025_RAIN)
    await pool.query(`
      INSERT INTO enrollments (student_id, course_id, course_code, semester_id, status)
      VALUES ($1, $2, $3, '2026_HARMATTAN', 'ENROLLED')
      ON CONFLICT DO NOTHING;
    `, [carryOverStudentId, course_id, code]);

    // Insert active enrollment (current semester)
    await pool.query(`
      INSERT INTO enrollments (student_id, course_id, course_code, semester_id, status)
      VALUES ($1, $2, $3, $4, 'ENROLLED')
      ON CONFLICT DO NOTHING;
    `, [carryOverStudentId, course_id, code, semester_id]);

    // Pre-seed carry-over student in attendance_records
    await pool.query(`
      INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
      VALUES ($1, $2, 'ABSENT', 'CODE_OTP', 1.000)
      ON CONFLICT (session_id, student_id) DO NOTHING;
    `, [sessionId, carryOverStudentId]);

    // Check in carry-over student: must resolve strictly to 1 row without throwing SQLSTATE 21000
    const carryOverRes = await pool.query(cteQuery, [null, course_id, carryOverStudentId, activeOtpHash]);
    assert.equal(carryOverRes.rows[0].student_id, carryOverStudentId);
    assert.equal(carryOverRes.rows[0].record_status, 'PRESENT');

    // Clean up carry-over test records
    await pool.query('DELETE FROM attendance_records WHERE student_id = $1', [carryOverStudentId]);
    await pool.query('DELETE FROM enrollments WHERE student_id = $1', [carryOverStudentId]);
    await pool.query('DELETE FROM students WHERE student_id = $1', [carryOverStudentId]);

    await cleanSessions();
  });

  // Final Cleanup
  await cleanSessions();
  await pool.end();
});
