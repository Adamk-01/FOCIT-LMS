/**
 * FOCIT LMS - Phase 26: Attendance Hardening Refinements Verification
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Certifies:
 * 1. Migration 026 Trigger Bounds & Column-Specific Mutation Scoping
 * 2. Mandatory sessionId Check-in Enforcement (HTTP 400 MISSING_SESSION_ID)
 * 3. Cross-Subsession Ticket Pinning & Rejection (HTTP 403 TICKET_SESSION_MISMATCH)
 * 4. Zero-Clamp Dynamic Horizon Boundary (All-Excused 100% Student Exam Eligibility)
 * 5. Mode 4 Zero-Trust Client & Path Prefix / Replay Prevention
 * 6. Positional Homoglyph Normalization & Sequential Matric Collision Isolation
 */

import '../src/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';
import attendanceRouter from '../src/routes/attendance.js';
import { studentAttendanceService } from '../src/services/studentAttendanceService.js';
import {
  normalizeMatricHomoglyphs,
  matchStudentLine,
} from '../src/services/ocrAttendanceMatcher.js';
import { unifiedOutboxWorker } from '../src/workers/unifiedOutboxWorker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = path.join(__dirname, '../.cache/sheets');

test('Phase 26: Attendance Hardening Refinements Certification', async (t) => {
  try {
    redis.disconnect();
  } catch {}

  let server;
  let baseUrl;
  let sharedUploadBody;
  let sharedLegitimateKey;
  const courseId = 'TEST_P26_CSC';
  const semesterId = '2026_RAIN';
  const student1Id = 'student1';
  const student2Id = 'student2';
  const lecturerId = 'advisor1';

  // 1. Setup Express Test App
  const app = express();
  app.use(express.json());

  // Inject simulated authenticated user from header
  app.use((req, res, next) => {
    const userHeader = req.headers['x-test-user'];
    if (userHeader) {
      req.user = JSON.parse(userHeader);
    } else {
      req.user = { id: lecturerId, username: lecturerId, role: 'LECTURER' };
    }
    next();
  });

  app.use('/api/attendance', attendanceRouter);

  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // 2. Seed Clean Test Environment
  await pool.query(`DELETE FROM attendance_records WHERE session_id IN (SELECT session_id FROM attendance_sessions WHERE course_id = $1)`, [courseId]);
  await pool.query(`DELETE FROM attendance_sessions WHERE course_id = $1`, [courseId]);
  await pool.query(`DELETE FROM enrollments WHERE course_id = $1`, [courseId]);
  await pool.query(`DELETE FROM hod_course_allocations WHERE course_id = $1`, [courseId]);

  // Seed test course with sessions_per_week = 2
  await pool.query(`
    INSERT INTO courses (course_id, code, title, units, level, department_id, semester_number, category, max_capacity, sessions_per_week, total_planned_sessions)
    VALUES ($1, 'CSC206', 'Systems Architecture & Concurrency', 3, 200, 'CSC', 2, 'CORE', 100, 2, 30)
    ON CONFLICT (course_id) DO UPDATE SET sessions_per_week = 2, total_planned_sessions = 30;
  `, [courseId]);

  // Seed lecturer allocation
  await pool.query(`
    INSERT INTO hod_course_allocations (course_id, lecturer_id, semester_id, allocated_by, is_primary)
    VALUES ($1, $2, $3, 'HOD_CSC', TRUE)
    ON CONFLICT DO NOTHING;
  `, [courseId, lecturerId, semesterId]);

  // Enroll students in TEST_P26_CSC
  await pool.query(`
    INSERT INTO enrollments (student_id, course_id, semester_id, course_code, status)
    VALUES 
      ($1, $3, $4, 'CSC206', 'ENROLLED'),
      ($2, $3, $4, 'CSC206', 'ENROLLED')
    ON CONFLICT DO NOTHING;
  `, [student1Id, student2Id, courseId, semesterId]);

  // ─── Test 1: Trigger Sub-slot Bounds & Column Scoping ────────────────────────
  await t.test('1. Sub-slot Trigger Enforces Course Bounds & Preserves Historical Locking', async () => {
    // Attempt to insert sub_session = 3 when course has sessions_per_week = 2
    let threwCheck = false;
    try {
      await pool.query(`
        INSERT INTO attendance_sessions (
          course_id, semester_id, week_number, sub_session, session_date, session_mode, created_by, is_locked
        )
        VALUES ($1, $2, 1, 3, CURRENT_DATE, 'ROLL_CALL', $3, FALSE);
      `, [courseId, semesterId, lecturerId]);
    } catch (err) {
      threwCheck = true;
      assert.equal(err.code, '23514', 'Must throw SQLSTATE 23514 (check_violation)');
    }
    assert.ok(threwCheck, 'Must reject sub_session > courses.sessions_per_week with 23514');

    // Insert sub_session = 2 (within bounds)
    const validSession = await pool.query(`
      INSERT INTO attendance_sessions (
        course_id, semester_id, week_number, sub_session, session_date, session_mode, created_by, is_locked
      )
      VALUES ($1, $2, 1, 2, CURRENT_DATE, 'ROLL_CALL', $3, FALSE)
      RETURNING session_id;
    `, [courseId, semesterId, lecturerId]);
    const sid = validSession.rows[0].session_id;

    // Simulate Admin reducing course frequency to 1 session per week
    await pool.query(`UPDATE courses SET sessions_per_week = 1 WHERE course_id = $1`, [courseId]);

    // Now lecturer locks the historical sub_session = 2
    // Trigger is scoped to BEFORE INSERT OR UPDATE OF sub_session, course_id, so updating is_locked MUST succeed
    let lockFailed = false;
    try {
      await pool.query(`UPDATE attendance_sessions SET is_locked = TRUE WHERE session_id = $1`, [sid]);
    } catch (err) {
      lockFailed = true;
    }
    assert.equal(lockFailed, false, 'Locking historical session must NOT fail when sessions_per_week was reduced');

    // Restore course frequency to 2
    await pool.query(`UPDATE courses SET sessions_per_week = 2 WHERE course_id = $1`, [courseId]);
    await pool.query(`DELETE FROM attendance_sessions WHERE session_id = $1`, [sid]);
  });

  // ─── Test 2: Mandatory sessionId Enforcement in Check-in ─────────────────────
  await t.test('2. Check-in Rejects Missing sessionId with HTTP 400 MISSING_SESSION_ID', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/sessions/otp/check-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: student1Id, student_id: student1Id, role: 'STUDENT' }),
      },
      body: JSON.stringify({
        otp: '123456',
        // sessionId omitted
      }),
    });

    assert.equal(res.status, 400, 'Must return HTTP 400 for missing sessionId');
    const data = await res.json();
    assert.equal(data.code, 'MISSING_SESSION_ID', 'Must return MISSING_SESSION_ID error code');
  });

  // ─── Test 3: Cross-Subsession Ticket Pinning & Rejection ──────────────────────
  await t.test('3. Cross-Subsession Ticket Rejection (HTTP 403 TICKET_SESSION_MISMATCH)', async () => {
    // Generate active OTP session A (Week 2, sub_session = 1)
    const genResA = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/sessions/otp/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: lecturerId, role: 'LECTURER' }),
      },
      body: JSON.stringify({ weekNumber: 2, subSession: 1 }),
    });
    assert.equal(genResA.status, 200);
    const dataA = await genResA.json();
    const sessionAId = dataA.sessionId;

    // Generate active OTP session B (Week 2, sub_session = 2)
    const genResB = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/sessions/otp/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: lecturerId, role: 'LECTURER' }),
      },
      body: JSON.stringify({ weekNumber: 2, subSession: 2 }),
    });
    assert.equal(genResB.status, 200);
    const dataB = await genResB.json();
    const sessionBId = dataB.sessionId;
    const otpB = dataB.otp;

    // Student 1 acquires ticket on Session A
    const ticketResA = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/sessions/${sessionAId}/otp/ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: student1Id, student_id: student1Id, role: 'STUDENT' }),
      },
      body: JSON.stringify({ sessionId: sessionAId }),
    });
    assert.equal(ticketResA.status, 200);
    const ticketDataA = await ticketResA.json();
    const ticketA = ticketDataA.ticketId;
    assert.ok(ticketA, 'Must receive a valid ticket UUID for Session A');

    // Student 1 attempts to check into Session B using ticketA
    const crossCheckInRes = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/sessions/otp/check-in`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: student1Id, student_id: student1Id, role: 'STUDENT' }),
      },
      body: JSON.stringify({
        sessionId: sessionBId,
        ticketId: ticketA,
        otp: otpB,
      }),
    });

    assert.equal(crossCheckInRes.status, 403, 'Must reject cross-session ticket with HTTP 403');
    const crossData = await crossCheckInRes.json();
    assert.equal(crossData.code, 'TICKET_SESSION_MISMATCH', 'Must return TICKET_SESSION_MISMATCH');

    // Verify Session B record for student 1 remains ABSENT
    const recordCheck = await pool.query(
      `SELECT status FROM attendance_records WHERE session_id = $1 AND student_id = $2`,
      [sessionBId, student1Id]
    );
    assert.equal(recordCheck.rows[0]?.status, 'ABSENT', 'Status must remain ABSENT in Session B');
  });

  // ─── Test 4: Dynamic Horizon Zero-Clamp Boundary (All-Excused Student) ─────────
  await t.test('4. Clamping S_projected at 0 preserves 100% Exam Eligibility for All-Excused Students', async () => {
    // Create an enrolled course with 15 held locked sessions, where student has 0 attended and 15 excused
    const excusedCourseId = 'TEST_P26_EXCUSED';
    await pool.query(`DELETE FROM attendance_records WHERE student_id = $1`, [student2Id]);
    await pool.query(`DELETE FROM attendance_sessions WHERE course_id = $1`, [excusedCourseId]);
    await pool.query(`DELETE FROM enrollments WHERE course_id = $1`, [excusedCourseId]);

    await pool.query(`
      INSERT INTO courses (course_id, code, title, units, level, department_id, semester_number, category, max_capacity, sessions_per_week, total_planned_sessions)
      VALUES ($1, 'MTH209', 'Advanced Calculus', 3, 200, 'CSC', 2, 'CORE', 100, 1, 15)
      ON CONFLICT (course_id) DO UPDATE SET sessions_per_week = 1, total_planned_sessions = 15;
    `, [excusedCourseId]);

    await pool.query(`
      INSERT INTO enrollments (student_id, course_id, semester_id, course_code, status)
      VALUES ($1, $2, $3, 'MTH209', 'ENROLLED')
      ON CONFLICT DO NOTHING;
    `, [student2Id, excusedCourseId, semesterId]);

    // Seed 15 locked sessions with status = 'EXCUSED'
    for (let w = 1; w <= 15; w++) {
      const sRes = await pool.query(`
        INSERT INTO attendance_sessions (course_id, semester_id, week_number, sub_session, session_date, session_mode, created_by, is_locked)
        VALUES ($1, $2, $3, 1, CURRENT_DATE, 'ROLL_CALL', $4, TRUE)
        RETURNING session_id;
      `, [excusedCourseId, semesterId, w, lecturerId]);

      await pool.query(`
        INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
        VALUES ($1, $2, 'EXCUSED', 'MANUAL_OVERRIDE', 1.000);
      `, [sRes.rows[0].session_id, student2Id]);
    }

    const summary = await studentAttendanceService.getStudentAttendanceSummary(student2Id, semesterId);
    const mthCourse = summary.courses.find((c) => c.courseId === excusedCourseId);
    assert.ok(mthCourse, 'TEST_P26_EXCUSED summary must exist');

    // Verification of NUC Defensive Bounds:
    // H = 15, E = 15 => Effective Denominator = max(0, 15 - 15) = 0
    // Attendance % = 100.0%
    // S_projected = max(0, max(15, 15) - 15) = 0 => Exam Target = ceil(0.75 * 0) = 0
    // Max Achievable = 0 + 0 = 0 >= Exam Target (0) => canStillQualify = TRUE, isBarredFromExam = FALSE
    assert.equal(mthCourse.effectiveLockedSessions, 0, 'Effective denominator must be 0');
    assert.equal(mthCourse.attendancePercentage, 100.0, 'All-excused student must have 100.0% attendance');
    assert.equal(mthCourse.examQualificationTarget, 0, 'Exam qualification target must drop cleanly to 0');
    assert.equal(mthCourse.canStillQualify, true, 'All-excused student must qualify for exams');
    assert.equal(mthCourse.isBarredFromExam, false, 'All-excused student must NOT be barred from exams');

    // Clean up
    await pool.query(`DELETE FROM attendance_records WHERE student_id = $1`, [student2Id]);
    await pool.query(`DELETE FROM attendance_sessions WHERE course_id = $1`, [excusedCourseId]);
    await pool.query(`DELETE FROM enrollments WHERE course_id = $1`, [excusedCourseId]);
  });

  // ─── Test 5: Mode 4 Zero-Trust Client & Path Prefix / Replay Prevention ───────
  await t.test('5. Mode 4 Zero-Trust Client & Path Prefix Enforcement', async () => {
    // 5A: Request capability upload ticket
    const ticketRes = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/upload-ticket`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: lecturerId, role: 'LECTURER' }),
      },
      body: JSON.stringify({ weekNumber: 4, subSession: 1 }),
    });
    assert.equal(ticketRes.status, 200);
    const ticketData = await ticketRes.json();
    assert.ok(ticketData.objectKey.startsWith(`sheets/${semesterId}/${courseId}/w4_s1_`), 'Ticket prefix must match session slot');

    // 5A-2: Stream binary upload to presigned storage endpoint
    const streamUploadRes = await fetch(`${baseUrl}${ticketData.uploadUrl}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from('mock_image_binary_data'),
    });
    assert.equal(streamUploadRes.status, 200);
    const streamBody = await streamUploadRes.json();
    assert.equal(streamBody.status, 'UPLOAD_SUCCESS');

    // 5B: Attempt upload with mismatched path prefix (e.g. Week 1 key on Week 4 upload)
    const mismatchedRes = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/upload-scanned-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: lecturerId, role: 'LECTURER' }),
      },
      body: JSON.stringify({
        weekNumber: 4,
        subSession: 1,
        sheetImageUrls: [`sheets/${semesterId}/${courseId}/w1_s1_fake_key.jpg`],
      }),
    });
    assert.equal(mismatchedRes.status, 400);
    const mismatchedData = await mismatchedRes.json();
    assert.equal(mismatchedData.code, 'OBJECT_KEY_CROSS_SESSION_MISMATCH', 'Must reject mismatched prefix');

    // 5C: Legitimate upload strips client-supplied present matric forgery
    const legitimateKey = ticketData.objectKey;
    sharedLegitimateKey = legitimateKey;
    const uploadRes = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/upload-scanned-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: lecturerId, role: 'LECTURER' }),
      },
      body: JSON.stringify({
        weekNumber: 4,
        subSession: 1,
        sheetImageUrls: [legitimateKey],
        // Client sends forged matric numbers to mark students PRESENT
        extractedMatricNumbers: ['2024/0042', '2025/0104'],
        rawExtractedText: '2024/0042 2025/0104 ALL PRESENT',
      }),
    });

    assert.equal(uploadRes.status, 201);
    const uploadBody = await uploadRes.json();
    sharedUploadBody = uploadBody;
    // Zero-Trust verification: Server must IGNORE client extracted matrics!
    assert.equal(uploadBody.presentCount, 0, 'Zero-trust: Client-supplied matrics must NOT mark students present');
    assert.equal(uploadBody.absentCount, 2, 'All enrolled students must be pre-seeded as ABSENT');

    // Verify in database: All records are ABSENT with confidence 0.000
    const recordsInDb = await pool.query(
      `SELECT status, confidence_score, verification_method FROM attendance_records WHERE session_id = $1`,
      [uploadBody.sessionId]
    );
    assert.equal(recordsInDb.rows.length, 2);
    for (const r of recordsInDb.rows) {
      assert.equal(r.status, 'ABSENT', 'Must be ABSENT');
      assert.equal(parseFloat(r.confidence_score), 0.000, 'Zero-trust baseline confidence must be 0.000');
      assert.equal(r.verification_method, 'SHEET_SCAN');
    }

    // 5D: Multi-Page Append: Uploading a second page for Week 4 appends without resetting
    const page2Key = `sheets/${semesterId}/${courseId}/w4_s1_page2_${Date.now()}.jpg`;
    const appendRes = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/upload-scanned-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: lecturerId, role: 'LECTURER' }),
      },
      body: JSON.stringify({
        weekNumber: 4,
        subSession: 1,
        sheetImageUrls: [page2Key],
      }),
    });
    assert.equal(appendRes.status, 201);

    const sessionInDb = await pool.query(
      `SELECT sheet_image_urls FROM attendance_sessions WHERE session_id = $1`,
      [uploadBody.sessionId]
    );
    const rawStored = sessionInDb.rows[0].sheet_image_urls;
    const storedUrls = typeof rawStored === 'string' ? JSON.parse(rawStored) : rawStored;
    assert.equal(storedUrls.length, 2, 'Multi-page append must contain both page 1 and page 2 keys');
    assert.ok(storedUrls.includes(legitimateKey), 'Must contain page 1');
    assert.ok(storedUrls.includes(page2Key), 'Must contain page 2');

    // 5E: Cross-Session Replay Detection: Attempting to use legitimateKey on Week 5 must be rejected
    const replayRes = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/upload-scanned-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: lecturerId, role: 'LECTURER' }),
      },
      body: JSON.stringify({
        weekNumber: 5,
        subSession: 1,
        sheetImageUrls: [legitimateKey], // Week 4 key reused
      }),
    });
    assert.equal(replayRes.status, 400); // Fails prefix or replay check
  });

  // ─── Test 6: Positional Homoglyph Normalization & Sequential Collision Isolation
  await t.test('6. Positional Homoglyph Normalization & Sequential Matric Collision Isolation', async () => {
    // 6A: Positional Homoglyphs
    assert.equal(
      normalizeMatricHomoglyphs('2O24/CSC/OO42'),
      '2024/CSC/0042',
      'Homoglyphs O/D in numeric segments must normalize to 0'
    );
    assert.equal(
      normalizeMatricHomoglyphs('2o24/CSC/Il42'),
      '2024/CSC/1142',
      'Homoglyphs I/l in numeric segments must normalize to 1'
    );

    // 6B: Exact Match
    const studentDoe = { matric_number: '2024/0042', full_name: 'John Doe' };
    const exactMatch = matchStudentLine('Line 1: 2024/0042 John Doe - Present', studentDoe);
    assert.equal(exactMatch.isMatch, true);
    assert.equal(exactMatch.confidence, 1.000);

    // 6C: Homoglyph Match
    const homoglyphMatch = matchStudentLine('Line 2: 2O24/OO42 John Doe', studentDoe);
    assert.equal(homoglyphMatch.isMatch, true);
    assert.equal(homoglyphMatch.confidence, 0.950);

    // 6D: Sequential Matric Collision Isolation (Refinement 4 Defense):
    // In a cohort block, student 2024/0041 is a sequential neighbor to student 2024/0042.
    // An uncorroborated line containing ONLY "2024/0041" must NEVER match student Doe (2024/0042)!
    const collisionCheck = matchStudentLine('Line 3: 2024/0041 Smith Alexander', studentDoe);
    assert.equal(collisionCheck.isMatch, false, 'Sequential neighbor must NOT match without surname corroboration');
    assert.equal(collisionCheck.confidence, 0.000);

    // 6E: Composite Line Corroboration:
    // If OCR text has minor serial noise but student surname DOE is present on the same line:
    const surnameCorroborated = matchStudentLine('Line 4: 2024/0042 DOE', studentDoe);
    assert.equal(surnameCorroborated.isMatch, true);
  });

  // ─── Test 7: Outbox Worker PROCESS_ATTENDANCE_SHEET_OCR Execution & Invariant 3 ──────
  await t.test('7. Outbox Worker Processes PROCESS_ATTENDANCE_SHEET_OCR with Invariant 3 Batch Update', async () => {
    // 1. Verify outbox event was queued in integration_outbox_events for sharedUploadBody.sessionId
    const outboxRes = await pool.query(
      `SELECT event_id, event_type, status, payload FROM integration_outbox_events 
       WHERE aggregate_id = $1 AND event_type = 'PROCESS_ATTENDANCE_SHEET_OCR'`,
      [sharedUploadBody.sessionId]
    );
    assert.equal(outboxRes.rows.length, 1, 'Must have exactly one outbox event for the session');
    assert.equal(outboxRes.rows[0].status, 'PENDING');
    const outboxPayload = outboxRes.rows[0].payload;
    assert.equal(outboxPayload.sessionId, sharedUploadBody.sessionId);
    assert.equal(outboxPayload.rawExtractedText, undefined, 'Zero-Trust Defect 1: Client raw text must NOT exist in outbox payload');

    // 2. Resolve student 1's matric number and full name
    const s1Res = await pool.query(`SELECT student_id, matric_number, full_name FROM students WHERE student_id = $1`, [student1Id]);
    const student1 = s1Res.rows[0];

    // 3. Write OCR companion text file for legitimateKey to SHEETS_DIR containing student 1's line
    const sanitizedKey = sharedLegitimateKey.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const companionPath = path.join(SHEETS_DIR, `${sanitizedKey}.ocr.txt`);
    await fs.mkdir(SHEETS_DIR, { recursive: true }).catch(() => {});
    await fs.writeFile(companionPath, `Row 1: ${student1.matric_number} ${student1.full_name}\nRow 2: 2024/9999 Unknown Student`, 'utf8');

    // 4. Trigger UnifiedOutboxWorker batch sweep
    await unifiedOutboxWorker.sweepBatch();

    // 5. Verify outbox event is now COMPLETED
    const outboxAfter = await pool.query(
      `SELECT status, last_error FROM integration_outbox_events WHERE aggregate_id = $1 AND event_type = 'PROCESS_ATTENDANCE_SHEET_OCR'`,
      [sharedUploadBody.sessionId]
    );
    assert.equal(outboxAfter.rows[0].status, 'COMPLETED', `Outbox event must be COMPLETED, last_error: ${outboxAfter.rows[0]?.last_error}`);

    // 6. Verify student 1's attendance record was promoted to PRESENT with confidence 1.000 via atomic batch update
    const student1Rec = await pool.query(
      `SELECT status, confidence_score, verification_method FROM attendance_records WHERE session_id = $1 AND student_id = $2`,
      [sharedUploadBody.sessionId, student1Id]
    );
    assert.equal(student1Rec.rows[0].status, 'PRESENT', 'Student 1 must be marked PRESENT by OCR worker');
    assert.equal(parseFloat(student1Rec.rows[0].confidence_score), 1.000);
    assert.equal(student1Rec.rows[0].verification_method, 'SHEET_SCAN');

    // 7. Verify student 2 (not on sheet) remains ABSENT with confidence 0.000
    const student2Rec = await pool.query(
      `SELECT status, confidence_score, verification_method FROM attendance_records WHERE session_id = $1 AND student_id = $2`,
      [sharedUploadBody.sessionId, student2Id]
    );
    assert.equal(student2Rec.rows[0].status, 'ABSENT', 'Student 2 must remain ABSENT');
    assert.equal(parseFloat(student2Rec.rows[0].confidence_score), 0.000);

    // Clean up companion file
    await fs.unlink(companionPath).catch(() => {});
  });

  // Teardown
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await pool.query(`DELETE FROM attendance_records WHERE session_id IN (SELECT session_id FROM attendance_sessions WHERE course_id = $1)`, [courseId]);
    await pool.query(`DELETE FROM attendance_sessions WHERE course_id = $1`, [courseId]);
    await pool.query(`DELETE FROM enrollments WHERE course_id = $1`, [courseId]);
    await pool.query(`DELETE FROM hod_course_allocations WHERE course_id = $1`, [courseId]);
  } finally {
    await pool.end();
  }
});
