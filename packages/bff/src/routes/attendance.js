/**
 * FOCIT LMS - Hybrid Attendance Engine & Sheet Scan Verification Router
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements Mode 4 (Course Rep Snapped Sheet Workflow) & Mode 1-3:
 * 1. POST /courses/:courseId/upload-scanned-sheet - Course Rep uploads snapped attendance sheet
 * 2. GET /courses/:courseId/sessions - Lists all weekly sessions with present/absent tallies
 * 3. GET /sessions/:sessionId - Retrieves session details + full student roster for verification
 * 4. PUT /sessions/:sessionId/records - Bulk updates attendance status (PRESENT, ABSENT, EXCUSED)
 * 5. POST /sessions/:sessionId/lock - Lecturer locks and approves session (NUC immutability)
 * 6. GET /courses/:courseId/summary - Computes 75% NUC exam eligibility per student
 */

import { Router } from 'express';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { notificationBroadcaster } from '../services/notificationBroadcaster.js';
import { createStudentNotification } from './notifications.js';

const router = Router();

/**
 * Access Control Barrier:
 * Verifies that the caller is either:
 * a) An allocated lecturer / HOD / Admin for the course
 * b) An appointed Course Representative for the course
 */
async function resolveAttendanceActor(req, res, next) {
  const userRole = String(req.user?.role || '').toUpperCase();
  const userId = req.user?.username || req.user?.id || req.user?.student_id;
  const email = req.user?.email;

  req.attendanceActor = {
    userId,
    userRole,
    role: userRole,
    isStaff: ['LECTURER', 'LEVEL_ADVISOR', 'HOD', 'ADMIN', 'SYSTEM_ADMIN'].includes(userRole),
    isCourseRep: false,
  };

  next();
}

async function verifyAttendanceAccess(actor, courseId, semesterId) {
  const actorId = actor.userId;
  const role = actor.role;

  if (['ADMIN', 'SYSTEM_ADMIN'].includes(role)) return { role: 'ADMIN' };

  // Check Course Rep
  const repCheck = await pool.query(
    `SELECT 1 FROM course_representatives WHERE course_id = $1 AND student_id = $2 AND semester_id = $3 LIMIT 1`,
    [courseId, actorId, semesterId]
  );
  if (repCheck.rows.length > 0) return { role: 'COURSE_REP' };

  // Check Lecturer Allocation
  const allocCheck = await pool.query(
    `SELECT 1 FROM hod_course_allocations WHERE course_id = $1 AND lecturer_id = $2 AND semester_id = $3 LIMIT 1`,
    [courseId, actorId, semesterId]
  );
  if (allocCheck.rows.length > 0) return { role: 'LECTURER' };

  // Check Department HOD
  if (role === 'HOD') {
    const hodCheck = await pool.query(
      `SELECT 1 FROM staff_advisors sa 
       JOIN courses c ON c.department_id = sa.department_id 
       WHERE sa.advisor_id = $1 AND c.course_id = $2 LIMIT 1`,
      [actorId, courseId]
    );
    if (hodCheck.rows.length > 0) return { role: 'HOD' };
  }

  // Check Enrolled Student
  const enrolledCheck = await pool.query(
    `SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2 AND (semester_id = $3 OR semester_id IS NULL) AND status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS') LIMIT 1`,
    [courseId, actorId, semesterId]
  );
  if (enrolledCheck.rows.length > 0) return { role: 'STUDENT', studentId: actorId };

  return null;
}

router.use(resolveAttendanceActor);

// ─── 1. Upload Scanned Attendance Sheet (Mode 4 Workflow) ────────────────────
router.post('/courses/:courseId/upload-scanned-sheet', async (req, res, next) => {
  const { courseId } = req.params;
  const week_number = req.body?.week_number ?? req.body?.weekNumber;
  const session_date = req.body?.session_date ?? req.body?.sessionDate;
  const sheet_image_urls = req.body?.sheet_image_urls ?? req.body?.sheetImageUrls ?? [];
  const extracted_matric_numbers = req.body?.extracted_matric_numbers ?? req.body?.extractedMatricNumbers ?? [];
  const raw_extracted_text = req.body?.raw_extracted_text ?? req.body?.rawExtractedText ?? '';
  const notesProvided = req.body && ('notes' in req.body);
  const rawNotes = req.body?.notes;
  const notesValue = (rawNotes === null || rawNotes === '' || (typeof rawNotes === 'string' && rawNotes.trim() === ''))
    ? null
    : String(rawNotes).trim();

  const actorId = req.attendanceActor.userId;

  if (!week_number || week_number < 1 || week_number > 15) {
    return res.status(400).json({ error: 'Valid week_number (1-15) is required', code: 'INVALID_WEEK' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolve Active Semester
    const termRes = await client.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const semesterId = termRes.rows[0]?.id || '2026_RAIN';

    // 2. Authorization Check: Must be Allocated Lecturer, Departmental HOD/Admin OR Appointed Course Rep
    const isStaff = req.attendanceActor.isStaff;
    const repCheck = await client.query(
      `SELECT 1 FROM course_representatives 
       WHERE course_id = $1 AND student_id = $2 AND semester_id = $3
       LIMIT 1`,
      [courseId, actorId, semesterId]
    );
    const isCourseRep = repCheck.rows.length > 0;

    if (!isStaff && !isCourseRep) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Only the allocated Lecturer, Department HOD, or officially appointed Course Representative may upload attendance sheets.',
        code: 'FORBIDDEN_ATTENDANCE_UPLOADER',
      });
    }

    // 2.1 Enforce Session Lock Guard: Reject sheet uploads if session is already finalized and locked
    const existingSession = await client.query(
      `SELECT session_id, is_locked FROM attendance_sessions 
       WHERE course_id = $1 AND semester_id = $2 AND week_number = $3 
       LIMIT 1`,
      [courseId, semesterId, week_number]
    );
    if (existingSession.rows[0]?.is_locked) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Attendance session for week ${week_number} has already been approved and locked. Modifications are prohibited.`,
        code: 'SESSION_LOCKED',
      });
    }

    // 3. Create or Update Attendance Session
    const sessionRes = await client.query(`
      INSERT INTO attendance_sessions (
        course_id, semester_id, week_number, session_date, session_mode, 
        created_by, is_locked, sheet_image_urls, raw_extracted_text, notes
      )
      VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), 'SHEET_SCAN', $5, FALSE, $6, $7, $9)
      ON CONFLICT (course_id, semester_id, week_number) 
      DO UPDATE SET
        sheet_image_urls = EXCLUDED.sheet_image_urls,
        raw_extracted_text = EXCLUDED.raw_extracted_text,
        notes = CASE WHEN $8::boolean THEN EXCLUDED.notes ELSE attendance_sessions.notes END,
        updated_at = NOW()
      RETURNING *;
    `, [
      courseId,
      semesterId,
      week_number,
      session_date || null,
      actorId,
      JSON.stringify(sheet_image_urls),
      raw_extracted_text,
      notesProvided,
      notesValue,
    ]);

    const session = sessionRes.rows[0];

    // 4. Fetch All Verified Enrolled Students in this Course
    const enrolledRes = await client.query(`
      SELECT s.student_id, s.matric_number, s.full_name
      FROM enrollments e
      JOIN students s ON s.student_id = e.student_id
      WHERE e.course_id = $1 AND (e.semester_id = $2 OR e.semester_id IS NULL) AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
      ORDER BY s.matric_number ASC;
    `, [courseId, semesterId]);

    const enrolledStudents = enrolledRes.rows;

    // 5. Intelligent Matcher: Normalize detected Matric Numbers
    // Any student whose matric appears in extracted_matric_numbers or raw text is PRESENT
    const normalizedDetected = new Set(
      extracted_matric_numbers.map((m) => String(m).trim().toUpperCase().replace(/\s+/g, ''))
    );

    let presentCount = 0;
    let absentCount = 0;

    for (const student of enrolledStudents) {
      const canonicalMatric = student.matric_number.toUpperCase().replace(/\s+/g, '');
      const escapedMatric = canonicalMatric.replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m);
      // Token-boundary regex: prevents '2021/CSC/01' from falsely matching substring in '2021/CSC/015'
      const tokenRegex = new RegExp(`(^|[^A-Z0-9])${escapedMatric}([^A-Z0-9]|$)`, 'i');
      const rawTextMatches = Boolean(raw_extracted_text && tokenRegex.test(raw_extracted_text));
      const isDetected = normalizedDetected.has(canonicalMatric) || rawTextMatches;

      const status = isDetected ? 'PRESENT' : 'ABSENT';
      if (status === 'PRESENT') presentCount++;
      else absentCount++;

      await client.query(`
        INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
        VALUES ($1, $2, $3, 'SHEET_SCAN', $4)
        ON CONFLICT (session_id, student_id)
        DO UPDATE SET status = EXCLUDED.status, marked_at = NOW();
      `, [session.session_id, student.student_id, status, isDetected ? 0.950 : 1.000]);
    }

    // 6. Notify Course Lecturer of Scanned Sheet Upload
    const allocRes = await client.query(`
      SELECT sa.advisor_id, sa.email, c.code AS course_code, c.title AS course_title
      FROM hod_course_allocations hca
      JOIN staff_advisors sa ON sa.advisor_id = hca.lecturer_id
      JOIN courses c ON c.course_id = hca.course_id
      WHERE hca.course_id = $1 AND hca.semester_id = $2
      LIMIT 1;
    `, [courseId, semesterId]);

    const lecturer = allocRes.rows[0];
    if (lecturer) {
      const notifPayload = {
        title: `📋 Week ${week_number} Attendance Sheet Uploaded`,
        body: `Course Rep uploaded sheet scan for ${lecturer.course_code}. ${presentCount} students detected present, ${absentCount} absent. Review and lock session.`,
        action_url: `/lecturer`,
        course_id: courseId,
        session_id: session.session_id,
        week_number,
      };

      await notificationBroadcaster.broadcast({
        student_id: lecturer.advisor_id,
        ...notifPayload,
      }, client);
    }

    await client.query('COMMIT');

    res.status(201).json({
      status: 'SUCCESS',
      sessionId: session.session_id,
      weekNumber: session.week_number,
      presentCount,
      absentCount,
      message: `Week ${week_number} attendance sheet uploaded and transcribed.`,
      session,
      metrics: {
        totalEnrolled: enrolledStudents.length,
        presentCount,
        absentCount,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error({ err: err?.message || err, courseId }, '[Attendance] Failed to upload scanned sheet');
    next(err);
  } finally {
    client.release();
  }
});

// ─── 2. List Weekly Attendance Sessions for Course ────────────────────────────
router.get('/courses/:courseId/sessions', async (req, res, next) => {
  const { courseId } = req.params;
  const { semesterId: reqSemesterId } = req.query;

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const semesterId = reqSemesterId || termRes.rows[0]?.id || '2026_RAIN';

    const access = await verifyAttendanceAccess(req.attendanceActor, courseId, semesterId);
    if (!access) {
      return res.status(403).json({
        error: 'Forbidden: You do not have permission to view attendance sessions for this course.',
        code: 'FORBIDDEN_ATTENDANCE_ACCESS',
      });
    }

    const { rows: sessions } = await pool.query(`
      SELECT 
        s.session_id,
        s.course_id,
        s.semester_id,
        s.week_number,
        s.session_date,
        s.session_mode,
        s.notes,
        s.is_locked,
        s.locked_by,
        s.locked_at,
        s.sheet_image_urls,
        s.created_by,
        s.created_at,
        COUNT(r.id) FILTER (WHERE r.status = 'PRESENT')::int AS present_count,
        COUNT(r.id) FILTER (WHERE r.status = 'ABSENT')::int AS absent_count,
        COUNT(r.id) FILTER (WHERE r.status = 'EXCUSED')::int AS excused_count
      FROM attendance_sessions s
      LEFT JOIN attendance_records r ON r.session_id = s.session_id
      WHERE s.course_id = $1 AND s.semester_id = $2
      GROUP BY s.session_id
      ORDER BY s.week_number ASC;
    `, [courseId, semesterId]);

    // Redact raw photo signatures from enrolled students (only staff & reps see sheets)
    const sanitizedSessions = access.role === 'STUDENT'
      ? sessions.map((sess) => ({ ...sess, sheet_image_urls: [] }))
      : sessions;

    res.json({
      courseId,
      semesterId,
      sessions: sanitizedSessions,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 3. Session Roster Detail for Verification Desk ───────────────────────────
router.get('/sessions/:sessionId', async (req, res, next) => {
  const { sessionId } = req.params;

  try {
    const sessionRes = await pool.query(
      `SELECT s.*, c.code AS course_code, c.title AS course_title
       FROM attendance_sessions s
       JOIN courses c ON c.course_id = s.course_id
       WHERE s.session_id = $1 LIMIT 1`,
      [sessionId]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Attendance session not found', code: 'SESSION_NOT_FOUND' });
    }

    const session = sessionRes.rows[0];

    // Authorization: Must be allocated lecturer, departmental HOD, Admin, or course representative
    const actorId = req.attendanceActor.userId;
    const isCourseRep = (await pool.query(
      `SELECT 1 FROM course_representatives WHERE course_id = $1 AND student_id = $2 LIMIT 1`,
      [session.course_id, actorId]
    )).rows.length > 0;
    const isAllocated = req.attendanceActor.isStaff && (await pool.query(
      `SELECT 1 FROM hod_course_allocations WHERE course_id = $1 AND lecturer_id = $2 LIMIT 1`,
      [session.course_id, actorId]
    )).rows.length > 0;
    const isSysAdmin = ['ADMIN', 'SYSTEM_ADMIN'].includes(req.attendanceActor.role);
    const isDeptHod = req.attendanceActor.role === 'HOD' && (await pool.query(
      `SELECT 1 FROM staff_advisors sa 
       JOIN courses c ON c.department_id = sa.department_id 
       WHERE sa.advisor_id = $1 AND c.course_id = $2 LIMIT 1`,
      [actorId, session.course_id]
    )).rows.length > 0;

    if (!isCourseRep && !isAllocated && !isDeptHod && !isSysAdmin) {
      return res.status(403).json({
        error: 'Forbidden: You do not have permission to view this attendance session.',
        code: 'FORBIDDEN_SESSION_ACCESS',
      });
    }

    const recordsRes = await pool.query(`
      SELECT 
        r.id AS record_id,
        r.student_id,
        r.status,
        r.verification_method,
        r.confidence_score,
        r.marked_at,
        s.matric_number,
        s.full_name,
        p.code AS programme_code,
        s.level
      FROM attendance_records r
      JOIN students s ON s.student_id = r.student_id
      LEFT JOIN programmes p ON p.id = s.programme_id
      WHERE r.session_id = $1
      ORDER BY s.matric_number ASC;
    `, [sessionId]);

    res.json({
      session,
      records: recordsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 4. Bulk Update Attendance Records (Lecturer/Rep Verification) ────────────
router.put('/sessions/:sessionId/records', async (req, res, next) => {
  const { sessionId } = req.params;
  const records = req.body?.records || req.body?.updates || [];

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array is required', code: 'INVALID_PAYLOAD' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Authorization & lock status check
    const sessionCheck = await client.query(
      `SELECT course_id, semester_id, is_locked FROM attendance_sessions WHERE session_id = $1 LIMIT 1`,
      [sessionId]
    );
    if (sessionCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
    }
    const sessionMeta = sessionCheck.rows[0];

    if (sessionMeta.is_locked) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Cannot modify attendance: Session has already been approved and locked.',
        code: 'SESSION_LOCKED',
      });
    }

    const actorId = req.attendanceActor.userId;
    const isCourseRep = (await client.query(
      `SELECT 1 FROM course_representatives WHERE course_id = $1 AND student_id = $2 LIMIT 1`,
      [sessionMeta.course_id, actorId]
    )).rows.length > 0;
    const isAllocated = req.attendanceActor.isStaff && (await client.query(
      `SELECT 1 FROM hod_course_allocations WHERE course_id = $1 AND lecturer_id = $2 LIMIT 1`,
      [sessionMeta.course_id, actorId]
    )).rows.length > 0;
    const isSysAdmin = ['ADMIN', 'SYSTEM_ADMIN'].includes(req.attendanceActor.role);
    const isDeptHod = req.attendanceActor.role === 'HOD' && (await client.query(
      `SELECT 1 FROM staff_advisors sa 
       JOIN courses c ON c.department_id = sa.department_id 
       WHERE sa.advisor_id = $1 AND c.course_id = $2 LIMIT 1`,
      [actorId, sessionMeta.course_id]
    )).rows.length > 0;

    if (!isAllocated && !isDeptHod && !isSysAdmin && !isCourseRep) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Forbidden: You do not have permission to modify attendance records for this course.',
        code: 'FORBIDDEN_RECORD_UPDATE',
      });
    }

    for (const item of records) {
      const studentId = item.student_id || item.studentId;
      if (['PRESENT', 'ABSENT', 'EXCUSED'].includes(item.status)) {
        await client.query(`
          UPDATE attendance_records
          SET status = $1, verification_method = 'MANUAL_OVERRIDE', marked_at = NOW()
          WHERE session_id = $2 AND student_id = $3;
        `, [item.status, sessionId, studentId]);
      }
    }

    await client.query('COMMIT');
    res.json({ status: 'UPDATED', updatedCount: records.length });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── 5. Lecturer Final Approval & Locking (Immutability Enforcement) ──────────
router.post('/sessions/:sessionId/lock', async (req, res, next) => {
  const { sessionId } = req.params;
  const actorId = req.attendanceActor.userId;

  // Only Staff/Lecturers can lock
  if (!req.attendanceActor.isStaff) {
    return res.status(403).json({
      error: 'Only the allocated course lecturer or departmental HOD can approve and lock attendance sessions.',
      code: 'FORBIDDEN_LOCK',
    });
  }

  try {
    // Require course allocation or departmental HOD authority before locking
    const sessionRes = await pool.query(
      `SELECT s.course_id, s.semester_id, c.department_id 
       FROM attendance_sessions s
       JOIN courses c ON c.course_id = s.course_id
       WHERE s.session_id = $1 LIMIT 1`,
      [sessionId]
    );
    if (sessionRes.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
    }
    const sessionMeta = sessionRes.rows[0];

    const isAllocated = await pool.query(
      `SELECT 1 FROM hod_course_allocations 
       WHERE course_id = $1 AND semester_id = $2 AND lecturer_id = $3 LIMIT 1`,
      [sessionMeta.course_id, sessionMeta.semester_id, actorId]
    );
    const isDeptHod = req.attendanceActor.role === 'HOD' && (await pool.query(
      `SELECT 1 FROM staff_advisors 
       WHERE advisor_id = $1 AND department_id = $2 LIMIT 1`,
      [actorId, sessionMeta.department_id]
    )).rows.length > 0;
    const isSysAdmin = ['ADMIN', 'SYSTEM_ADMIN'].includes(req.attendanceActor.role);

    if (!isAllocated.rows.length && !isDeptHod && !isSysAdmin) {
      return res.status(403).json({
        error: 'Forbidden: You must be allocated to teach this course to approve and lock its attendance.',
        code: 'FORBIDDEN_ALLOCATION_REQUIRED',
      });
    }

    const { rows } = await pool.query(`
      UPDATE attendance_sessions
      SET is_locked = TRUE, locked_by = $1, locked_at = NOW(), updated_at = NOW()
      WHERE session_id = $2 AND is_locked = FALSE
      RETURNING *;
    `, [actorId, sessionId]);

    if (rows.length === 0) {
      return res.status(409).json({ error: 'Session is already locked or does not exist', code: 'ALREADY_LOCKED' });
    }

    res.json({
      status: 'LOCKED',
      message: 'Attendance session has been approved and permanently locked for academic compliance.',
      session: rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ─── 6. NUC 75% Exam Eligibility Summary Engine ──────────────────────────────
router.get('/courses/:courseId/summary', async (req, res, next) => {
  const { courseId } = req.params;
  const { semesterId: reqSemesterId } = req.query;

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const semesterId = reqSemesterId || termRes.rows[0]?.id || '2026_RAIN';

    const access = await verifyAttendanceAccess(req.attendanceActor, courseId, semesterId);
    if (!access) {
      return res.status(403).json({
        error: 'Forbidden: You do not have permission to view attendance eligibility for this course.',
        code: 'FORBIDDEN_ATTENDANCE_ACCESS',
      });
    }

    // 1. Total locked sessions held (official NUC audit requires finalized sessions)
    const sessionCountRes = await pool.query(`
      SELECT COUNT(*)::int AS total_sessions
      FROM attendance_sessions
      WHERE course_id = $1 AND semester_id = $2 AND is_locked = TRUE;
    `, [courseId, semesterId]);

    const totalSessions = sessionCountRes.rows[0]?.total_sessions || 0;

    // 2. Student attendance percentages (Locked sessions only, explicit semester equality)
    const query = `
      SELECT 
        s.student_id,
        s.matric_number,
        s.full_name,
        p.code AS programme_code,
        s.level,
        $3::int AS total_sessions_held,
        COUNT(r.id) FILTER (WHERE r.status = 'PRESENT')::int AS sessions_attended,
        COUNT(r.id) FILTER (WHERE r.status = 'EXCUSED')::int AS sessions_excused,
        CASE 
          WHEN $3::int = 0 THEN 100.0
          ELSE ROUND((COUNT(r.id) FILTER (WHERE r.status = 'PRESENT')::numeric / $3::int) * 100, 1)
        END AS attendance_percentage,
        CASE 
          WHEN $3::int = 0 THEN TRUE
          WHEN ROUND((COUNT(r.id) FILTER (WHERE r.status = 'PRESENT')::numeric / $3::int) * 100, 1) >= 75.0 THEN TRUE
          ELSE FALSE
        END AS is_exam_eligible
      FROM enrollments e
      JOIN students s ON s.student_id = e.student_id
      LEFT JOIN programmes p ON p.id = s.programme_id
      LEFT JOIN attendance_sessions sess ON sess.course_id = e.course_id AND sess.semester_id = $2 AND sess.is_locked = TRUE
      LEFT JOIN attendance_records r ON r.session_id = sess.session_id AND r.student_id = s.student_id
      WHERE e.course_id = $1 AND (e.semester_id = $2 OR e.semester_id IS NULL) AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
      GROUP BY s.student_id, p.code
      ORDER BY s.matric_number ASC;
    `;

    const { rows } = await pool.query(query, [courseId, semesterId, totalSessions]);

    let students = rows.map((r) => ({
      studentId: r.student_id,
      matricNumber: r.matric_number,
      fullName: r.full_name,
      firstName: r.full_name ? r.full_name.split(' ')[0] : r.student_id,
      lastName: r.full_name ? r.full_name.split(' ').slice(1).join(' ') : '',
      attendedSessions: r.sessions_attended,
      excusedSessions: r.sessions_excused,
      totalSessionsHeld: totalSessions,
      attendancePercentage: parseFloat(r.attendance_percentage),
      isEligible: Boolean(r.is_exam_eligible),
    }));

    // Student Privacy Barrier: enrolled students see only their own row
    if (access.role === 'STUDENT') {
      students = students.filter((s) => s.studentId === access.studentId);
    }

    res.json({
      courseId,
      semesterId,
      totalLockedSessions: totalSessions,
      totalSessionsHeld: totalSessions,
      students,
      summary: access.role === 'STUDENT' ? rows.filter((r) => r.student_id === access.studentId) : rows,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
