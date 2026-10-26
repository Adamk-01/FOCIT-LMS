/**
 * FOCIT LMS - Attendance Ledger (Mode 4) & Two-Tier Assessment Test Suite
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import '../src/config.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { pool } from '../src/db/index.js';
import attendanceRouter from '../src/routes/attendance.js';
import questionBankRouter from '../src/routes/questionBank.js';
import quizzesRouter from '../src/routes/quizzes.js';

describe('Mode 4 Physical Attendance Ledger & Two-Tier Assessment Architecture', () => {
  let server;
  let baseUrl;
  let createdSessionId = null;
  let createdTestId = null;
  const courseId = 'CSC204';

  before(async () => {
    // 1. Create express test harness
    const app = express();
    app.use(express.json());

    // Inject simulated authenticated user from header
    app.use((req, res, next) => {
      const userHeader = req.headers['x-test-user'];
      if (userHeader) {
        req.user = JSON.parse(userHeader);
      } else {
        req.user = { id: 'lecturer1', username: 'lecturer1', role: 'LECTURER' };
      }
      next();
    });

    app.use('/api/attendance', attendanceRouter);
    app.use('/api/courses', questionBankRouter);
    app.use('/api/quizzes', quizzesRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });

    // 2. Prepare test data in database
    await pool.query("DELETE FROM attendance_sessions WHERE course_id = 'CSC204'");
    await pool.query(`
      INSERT INTO enrollments (student_id, course_id, semester_id, course_code, status)
      VALUES 
        ('student1', 'CSC204', '2026_RAIN', 'CSC 204', 'ENROLLED'),
        ('student2', 'CSC204', '2026_RAIN', 'CSC 204', 'ENROLLED')
      ON CONFLICT DO NOTHING;
    `);

    // Ensure student profile has a known matric number
    await pool.query(`
      UPDATE students
      SET matric_number = '2021/CSC/001'
      WHERE student_id = 'student1';
    `);

    await pool.query(`
      UPDATE students
      SET matric_number = '2021/CSC/002'
      WHERE student_id = 'student2';
    `);

    // Appoint student1 as Course Rep and allocate lecturer1 to CSC204
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const semId = termRes.rows[0]?.id || '2026_RAIN';

    await pool.query(`
      INSERT INTO hod_course_allocations (course_id, semester_id, lecturer_id, allocated_by)
      VALUES ('CSC204', $1, 'lecturer1', 'hod_csc')
      ON CONFLICT (course_id, semester_id) DO UPDATE SET lecturer_id = 'lecturer1';
    `, [semId]);

    await pool.query(`
      INSERT INTO course_representatives (course_id, semester_id, student_id, appointed_by)
      VALUES ('CSC204', $1, 'student1', 'lecturer1')
      ON CONFLICT (course_id, semester_id, student_id) DO NOTHING;
    `, [semId]);
  });

  after(async () => {
    if (server) {
      server.close();
    }
    // Finding 11: Make test suite repeatable on a persistent database
    await pool.query("DELETE FROM attendance_sessions WHERE course_id = 'CSC204'").catch(() => {});
    await pool.query("DELETE FROM quizzes WHERE course_id = 'CSC204' AND quiz_type = 'OFFICIAL_TEST'").catch(() => {});
  });

  test('Mode 4 Upload: Course Rep submits snapped sheet and OCR text', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/upload-scanned-sheet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: 'student1', username: 'student1', role: 'STUDENT' }),
      },
      body: JSON.stringify({
        weekNumber: 4,
        sheetImageUrls: ['https://example.com/attendance_week4_p1.jpg'],
        rawExtractedText: 'Present attendees: 2021/CSC/001 signed at 10:15am. Student 2 absent.',
        notes: 'Held in ETF Hall 2. Verified by Course Rep.',
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 201, `Expected 201: ${JSON.stringify(body)}`);
    assert.ok(body.sessionId);
    assert.equal(body.weekNumber, 4);
    assert.equal(body.presentCount, 1);

    createdSessionId = body.sessionId;
  });

  test('Verification Desk: Lecturer views session details and student roster', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/sessions/${createdSessionId}`, {
      headers: {
        'x-test-user': JSON.stringify({ id: 'lecturer1', role: 'LECTURER' }),
      },
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.session);
    assert.equal(body.session.session_id, createdSessionId);
    assert.ok(Array.isArray(body.records));

    const st1 = body.records.find((r) => r.student_id === 'student1');
    const st2 = body.records.find((r) => r.student_id === 'student2');

    assert.ok(st1);
    assert.equal(st1.status, 'PRESENT');
    if (st2) {
      assert.equal(st2.status, 'ABSENT');
    }
  });

  test('Lecturer Adjustments: Modifies student status before approval', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/sessions/${createdSessionId}/records`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: 'lecturer1', role: 'LECTURER' }),
      },
      body: JSON.stringify({
        updates: [
          { studentId: 'student2', status: 'EXCUSED', notes: 'Medical note verified by HOD' },
        ],
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'UPDATED');
  });

  test('Immutability Seal: Locking session seals records against changes', async () => {
    const lockRes = await fetch(`${baseUrl}/api/attendance/sessions/${createdSessionId}/lock`, {
      method: 'POST',
      headers: {
        'x-test-user': JSON.stringify({ id: 'lecturer1', role: 'LECTURER' }),
      },
    });

    const lockBody = await lockRes.json();
    assert.equal(lockRes.status, 200);
    assert.equal(lockBody.session.is_locked, true);

    // Attempting to mutate locked session must fail with 409 Conflict
    const mutateRes = await fetch(`${baseUrl}/api/attendance/sessions/${createdSessionId}/records`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: 'lecturer1', role: 'LECTURER' }),
      },
      body: JSON.stringify({
        updates: [{ studentId: 'student1', status: 'ABSENT' }],
      }),
    });

    assert.equal(mutateRes.status, 409);
  });

  test('NUC 75% Audit: Calculates attendance and eligibility', async () => {
    const res = await fetch(`${baseUrl}/api/attendance/courses/${courseId}/summary`, {
      headers: {
        'x-test-user': JSON.stringify({ id: 'lecturer1', role: 'LECTURER' }),
      },
    });

    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.totalLockedSessions >= 1);
    assert.ok(Array.isArray(body.students));

    const st1 = body.students.find((s) => s.studentId === 'student1');
    assert.ok(st1);
    assert.equal(st1.isEligible, true);
  });

  test('Official Timed Test: Lecturer publishes test with auto-zero and timer', async () => {
    const res = await fetch(`${baseUrl}/api/courses/${courseId}/tests/publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-user': JSON.stringify({ id: 'lecturer1', role: 'LECTURER' }),
      },
      body: JSON.stringify({
        title: 'CSC 204 Midterm Assessment Test',
        description: 'Summative CA test. Auto-zero strictly enforced.',
        durationMinutes: 30,
        totalPoints: 20.0,
        autoZero: true,
      }),
    });

    const body = await res.json();
    assert.equal(res.status, 201, `Expected 201: ${JSON.stringify(body)}`);
    assert.ok(body.test);
    assert.equal(body.test.quiz_type, 'OFFICIAL_TEST');
    assert.equal(body.test.auto_zero, true);
    assert.equal(body.test.duration_minutes, 30);

    createdTestId = body.test.quiz_id;
  });

  test('Student Test Session: Start official test enforces countdown and resume mutex', async () => {
    const res = await fetch(`${baseUrl}/api/quizzes/${createdTestId}/start`, {
      method: 'POST',
      headers: {
        'x-test-user': JSON.stringify({ id: 'student1', username: 'student1', role: 'STUDENT' }),
      },
    });

    const body = await res.json();
    assert.equal(res.status, 201, `Expected 201 Started: ${JSON.stringify(body)}`);
    assert.ok(body.attempt);
    assert.equal(body.attempt.status, 'IN_PROGRESS');
    assert.equal(body.attempt.is_practice, false);
    assert.ok(new Date(body.attempt.due_at) > new Date());

    // Calling start again while IN_PROGRESS should resume session
    const resumeRes = await fetch(`${baseUrl}/api/quizzes/${createdTestId}/start`, {
      method: 'POST',
      headers: {
        'x-test-user': JSON.stringify({ id: 'student1', username: 'student1', role: 'STUDENT' }),
      },
    });

    const resumeBody = await resumeRes.json();
    assert.equal(resumeRes.status, 200);
    assert.equal(resumeBody.status, 'RESUMED');
  });

  test('Single Attempt Lock: Finalized official test cannot be re-taken', async () => {
    await pool.query(`
      UPDATE quiz_attempts 
      SET status = 'SUBMITTED', score = 18.00, submitted_at = NOW()
      WHERE quiz_id = $1 AND student_id = 'student1';
    `, [createdTestId]);

    const res = await fetch(`${baseUrl}/api/quizzes/${createdTestId}/start`, {
      method: 'POST',
      headers: {
        'x-test-user': JSON.stringify({ id: 'student1', username: 'student1', role: 'STUDENT' }),
      },
    });

    const body = await res.json();
    assert.equal(res.status, 409);
    assert.equal(body.code, 'OFFICIAL_TEST_ALREADY_COMPLETED');
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      const { redisSubscriber, redisPublisher } = await import('../src/routes/notifications.js');
      if (redisSubscriber?.disconnect) redisSubscriber.disconnect();
      if (redisPublisher?.disconnect) redisPublisher.disconnect();
    } catch {}
    await pool.end();
  });
});
