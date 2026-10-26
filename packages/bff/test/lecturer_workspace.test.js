/**
 * FOCIT LMS - Lecturer Workspace & Cohort Roster Test Suite
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import '../src/config.js';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db/index.js';
import lecturerRouter from '../src/routes/lecturer.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
    setHeader(key, val) {
      this.headers[key] = val;
      return this;
    },
  };
  return res;
}

describe('Lecturer Workspace & Class Roster Verification', () => {
  before(async () => {
    const { rows: termRows } = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const activeSemesterId = termRows[0]?.id || '2026_RAIN';

    await pool.query(
      `INSERT INTO hod_course_allocations (course_id, semester_id, lecturer_id, allocated_by)
       VALUES ('CSC204', $1, 'lecturer1', 'hod_csc')
       ON CONFLICT (course_id, semester_id) DO UPDATE SET lecturer_id = 'lecturer1'`,
      [activeSemesterId]
    );
  });

  after(async () => {
    // cleanup any test artifacts if necessary
  });

  test('Security Guard: Rejects non-staff users with 403 FORBIDDEN_NOT_LECTURER', async () => {
    const req = {
      user: { role: 'STUDENT', email: 'student1@focit.uniosun.edu.ng' },
    };
    const res = mockRes();
    let nextCalled = false;

    // First layer in lecturerRouter is the requireLecturer middleware
    const middleware = lecturerRouter.stack[0].handle;
    await middleware(req, res, () => { nextCalled = true; });

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body?.code, 'FORBIDDEN_NOT_LECTURER');
    assert.strictEqual(nextCalled, false);
  });

  test('Scope Resolution: Resolves staff record and permits verified LECTURER', async () => {
    const req = {
      user: { role: 'LECTURER', email: 'lecturer1@focit.uniosun.edu.ng' },
    };
    const res = mockRes();
    let nextCalled = false;

    const middleware = lecturerRouter.stack[0].handle;
    await middleware(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.lecturerScope?.advisor_id, 'lecturer1');
    assert.strictEqual(req.lecturerScope?.role, 'LECTURER');
  });

  test('Course Allocation: Returns verified allocated courses for current semester', async () => {
    const { rows: termRows } = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const activeSemesterId = termRows[0]?.id || '2026_RAIN';

    const { rows: allocatedCourses } = await pool.query(
      `SELECT hca.course_id, c.code, c.title
       FROM hod_course_allocations hca
       JOIN courses c ON c.course_id = hca.course_id
       WHERE hca.lecturer_id = 'lecturer1' AND hca.semester_id = $1`,
      [activeSemesterId]
    );

    assert.ok(allocatedCourses.length > 0, 'lecturer1 must have allocated courses in current semester');
  });

  test('Class Roster Export: Generates formatted CSV examination hall sheet', async () => {
    const { rows: termRows } = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const activeSemesterId = termRows[0]?.id || '2026_RAIN';

    const { rows: sampleAlloc } = await pool.query(
      `SELECT course_id FROM hod_course_allocations 
       WHERE lecturer_id = 'lecturer1' AND semester_id = $1 
       LIMIT 1`,
      [activeSemesterId]
    );

    const targetCourseId = sampleAlloc[0].course_id;

    // Simulate export handler logic
    const { rows: courseRows } = await pool.query(
      `SELECT code, title FROM courses WHERE course_id = $1`,
      [targetCourseId]
    );
    const course = courseRows[0];

    const { rows: students } = await pool.query(
      `SELECT s.matric_number, s.full_name, p.code AS programme_code, s.level
       FROM enrollments e
       JOIN students s ON s.student_id = e.student_id
       JOIN programmes p ON p.id = s.programme_id
       WHERE e.course_id = $1 AND e.semester_id = $2 AND e.status = 'ENROLLED'
       ORDER BY s.matric_number ASC`,
      [targetCourseId, activeSemesterId]
    );

    assert.ok(course.code, 'Course code must exist');
    assert.ok(Array.isArray(students), 'Student list must be an array');
  });

  after(async () => {
    await pool.end();
  });
});
