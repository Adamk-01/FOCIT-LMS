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
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline as streamPipeline } from 'node:stream/promises';
import Busboy from 'busboy';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import { notificationBroadcaster } from '../services/notificationBroadcaster.js';
import { createStudentNotification } from './notifications.js';
import config from '../config.js';
import { studentAttendanceService } from '../services/studentAttendanceService.js';
import { singleFlight } from '../lib/singleFlight.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHEETS_DIR = path.join(__dirname, '../../.cache/sheets');
await fs.mkdir(SHEETS_DIR, { recursive: true }).catch(() => {});

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

  // Check Lecturer Allocation with fallback to department teaching match
  try {
    const allocCheck = await pool.query(
      `SELECT 1 FROM hod_course_allocations WHERE course_id = $1 AND lecturer_id = $2 AND semester_id = $3 LIMIT 1`,
      [courseId, actorId, semesterId]
    );
    if (allocCheck.rows.length > 0) return { role: 'LECTURER' };
  } catch (allocErr) {
    if (role === 'LECTURER') {
      const staffDeptCheck = await pool.query(
        `SELECT 1 FROM staff_advisors sa 
         JOIN courses c ON c.department_id = sa.department_id 
         WHERE sa.advisor_id = $1 AND c.course_id = $2 LIMIT 1`,
        [actorId, courseId]
      );
      if (staffDeptCheck.rows.length > 0) return { role: 'LECTURER' };
    }
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

// ─── 0. Upload Single Scanned Attendance Sheet Image (Multipart) ──────────────
router.post('/courses/:courseId/upload-sheet-image', async (req, res, next) => {
  const { courseId } = req.params;

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const semesterId = termRes.rows[0]?.id || '2026_RAIN';

    const access = await verifyAttendanceAccess(req.attendanceActor, courseId, semesterId);
    if (!access || !['LECTURER', 'HOD', 'ADMIN', 'COURSE_REP'].includes(access.role)) {
      return res.status(403).json({ error: 'Permission denied: Unauthorized for this course', code: 'FORBIDDEN' });
    }

    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > 10 * 1024 * 1024) {
      return res.status(413).json({
        error: 'Payload Too Large: Sheet photo exceeds 10MB ceiling.',
        code: 'SHEET_PAYLOAD_TOO_LARGE',
      });
    }

    const busboy = Busboy({
      headers: req.headers,
      limits: {
        fileSize: 10 * 1024 * 1024,
        files: 1,
      },
    });

    let fileProcessed = false;
    let firstError = null;
    let writePromise = Promise.resolve();
    let responded = false;
    const targetFilename = `${courseId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.jpg`;
    const targetPath = path.join(SHEETS_DIR, targetFilename);
    const sheetUrl = `/api/files/sheets/${targetFilename}`;

    const sendErrorResponse = async (statusCode, errorObj) => {
      if (responded || res.headersSent) return;
      responded = true;
      await fs.unlink(targetPath).catch(() => {});
      return res.status(statusCode).json(errorObj);
    };

    busboy.on('file', (name, fileStream, info) => {
      fileProcessed = true;
      let sniffed = false;
      const writeStream = createWriteStream(targetPath);

      fileStream.on('data', (chunk) => {
        if (!sniffed) {
          sniffed = true;
          const isWebp =
            chunk.length >= 12 &&
            chunk.toString('ascii', 0, 4) === 'RIFF' &&
            chunk.toString('ascii', 8, 12) === 'WEBP';
          const isPng =
            chunk.length >= 4 &&
            chunk[0] === 0x89 &&
            chunk[1] === 0x50 &&
            chunk[2] === 0x4E &&
            chunk[3] === 0x47;
          const isJpeg =
            chunk.length >= 3 &&
            chunk[0] === 0xff &&
            chunk[1] === 0xd8 &&
            chunk[2] === 0xff;

          if (!isWebp && !isPng && !isJpeg) {
            firstError = firstError || new Error('Invalid image binary: Magic byte check failed');
            fileStream.resume();
            writeStream.destroy();
            sendErrorResponse(400, {
              error: firstError.message,
              code: 'INVALID_IMAGE_BINARY',
            });
          }
        }
      });

      fileStream.on('limit', () => {
        firstError = firstError || new Error('File size exceeded 10MB limit');
        writeStream.destroy();
        sendErrorResponse(413, {
          error: firstError.message,
          code: 'SHEET_PAYLOAD_TOO_LARGE',
        });
      });

      // Finding 4: Respond immediately when the file pipeline fails rather than waiting or hanging
      writePromise = streamPipeline(fileStream, writeStream).catch(async (err) => {
        firstError = firstError || err;
        await sendErrorResponse(400, {
          error: firstError?.message || 'File upload pipeline failed',
          code: 'SHEET_UPLOAD_PIPELINE_FAILED',
        });
      });
    });

    busboy.on('finish', async () => {
      if (responded || res.headersSent) return;
      try {
        await writePromise;
        if (responded || res.headersSent) return;
        if (!fileProcessed || firstError) {
          return await sendErrorResponse(400, {
            error: firstError?.message || 'No valid image file uploaded',
            code: 'SHEET_UPLOAD_FAILED',
          });
        }
        responded = true;
        return res.status(201).json({
          status: 'SUCCESS',
          url: sheetUrl,
          filename: targetFilename,
        });
      } catch (finishErr) {
        await sendErrorResponse(500, {
          error: finishErr?.message || 'Unexpected server error during upload finalization',
          code: 'UPLOAD_FINISH_FAILED',
        });
      }
    });

    // Finding 5: Remove partial files on Busboy errors and respond cleanly
    busboy.on('error', async (err) => {
      firstError = firstError || err;
      await fs.unlink(targetPath).catch(() => {});
      if (!responded && !res.headersSent) {
        responded = true;
        return res.status(400).json({
          error: err?.message || 'Multipart parsing failed',
          code: 'MULTIPART_PARSER_ERROR',
        });
      }
    });

    req.pipe(busboy);
  } catch (err) {
    next(err);
  }
});

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
    const access = await verifyAttendanceAccess(req.attendanceActor, courseId, semesterId);
    if (!access || !['LECTURER', 'HOD', 'ADMIN', 'COURSE_REP'].includes(access.role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Forbidden: You must be the allocated Lecturer, Department HOD, or officially appointed Course Representative for this course.',
        code: 'FORBIDDEN_ATTENDANCE_UPLOADER',
      });
    }

    // 2.1 Enforce Session Lock Guard: Reject sheet uploads if session is already finalized and locked
    const existingSession = await client.query(
      `SELECT session_id, is_locked, session_mode, created_by FROM attendance_sessions 
       WHERE course_id = $1 AND semester_id = $2 AND week_number = $3 
       LIMIT 1 FOR UPDATE`,
      [courseId, semesterId, week_number]
    );
    if (existingSession.rows[0]?.is_locked) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Attendance session for week ${week_number} has already been approved and locked. Modifications are prohibited.`,
        code: 'SESSION_LOCKED',
      });
    }

    // Provenance Boundary: Course Rep cannot overwrite faculty lecture sessions
    if (access.role === 'COURSE_REP' && existingSession.rows.length > 0) {
      const existing = existingSession.rows[0];
      if (['ROLL_CALL', 'CODE_OTP'].includes(existing.session_mode)) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: `Course Representative cannot overwrite faculty lecture session (${existing.session_mode}) for week ${week_number}.`,
          code: 'FACULTY_SESSION_OVERWRITE_FORBIDDEN',
        });
      }
      if (existing.created_by !== actorId && existing.session_mode !== 'SHEET_SCAN') {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: `Course Representative cannot modify an attendance session initiated by faculty for week ${week_number}.`,
          code: 'FACULTY_SESSION_OVERWRITE_FORBIDDEN',
        });
      }
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
      WHERE attendance_sessions.is_locked = FALSE
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

    if (sessionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Attendance session for week ${week_number} has already been approved and locked. Modifications are prohibited.`,
        code: 'SESSION_LOCKED',
      });
    }

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


// ─── 1B. Mode 1: Live Roll Call Digital Submission ────────────────────────────
router.post('/courses/:courseId/sessions/roll-call', async (req, res, next) => {
  const { courseId } = req.params;
  const week_number = req.body?.week_number ?? req.body?.weekNumber;
  const session_date = req.body?.session_date ?? req.body?.sessionDate;
  const notes = req.body?.notes || 'Live Class Roll Call';
  const records = req.body?.records || [];
  const is_locked = req.body?.is_locked ?? true;
  const actorId = req.attendanceActor.userId;

  if (!week_number || week_number < 1 || week_number > 15) {
    return res.status(400).json({ error: 'Valid week_number (1-15) is required', code: 'INVALID_WEEK' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const termRes = await client.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const semesterId = termRes.rows[0]?.id || '2026_RAIN';

    const access = await verifyAttendanceAccess(req.attendanceActor, courseId, semesterId);
    if (!access || !['LECTURER', 'HOD', 'ADMIN', 'COURSE_REP'].includes(access.role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: Unauthorized for this course', code: 'FORBIDDEN' });
    }

    // Lock Guard: Reject if session is already finalized and locked
    const existing = await client.query(
      `SELECT is_locked, session_mode, created_by FROM attendance_sessions WHERE course_id = $1 AND semester_id = $2 AND week_number = $3 LIMIT 1 FOR UPDATE`,
      [courseId, semesterId, week_number]
    );
    if (existing.rows[0]?.is_locked) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Attendance session for week ${week_number} has already been approved and locked. Modifications are prohibited.`,
        code: 'SESSION_LOCKED',
      });
    }

    // Provenance Boundary: Course Rep cannot overwrite faculty lecture sessions
    if (access.role === 'COURSE_REP' && existing.rows.length > 0) {
      const ex = existing.rows[0];
      if (['ROLL_CALL', 'CODE_OTP'].includes(ex.session_mode)) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: `Course Representative cannot overwrite faculty lecture session (${ex.session_mode}) for week ${week_number}.`,
          code: 'FACULTY_SESSION_OVERWRITE_FORBIDDEN',
        });
      }
      if (ex.created_by !== actorId && ex.session_mode !== 'REP_DIRECT') {
        await client.query('ROLLBACK');
        return res.status(403).json({
          error: `Course Representative cannot modify an attendance session initiated by faculty for week ${week_number}.`,
          code: 'FACULTY_SESSION_OVERWRITE_FORBIDDEN',
        });
      }
    }

    // Role Enforcement: Only faculty (Lecturer/HOD/Admin) can lock sessions; course reps cannot
    const canLock = ['LECTURER', 'HOD', 'ADMIN'].includes(access.role);
    const finalIsLocked = canLock && Boolean(is_locked);
    const lockedBy = finalIsLocked ? actorId : null;
    const lockedAt = finalIsLocked ? new Date() : null;

    const sessionRes = await client.query(`
      INSERT INTO attendance_sessions (
        course_id, semester_id, week_number, session_date, session_mode,
        created_by, is_locked, locked_by, locked_at, notes
      )
      VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), 'ROLL_CALL', $5, $6, $7, $8, $9)
      ON CONFLICT (course_id, semester_id, week_number)
      DO UPDATE SET
        session_mode = 'ROLL_CALL',
        notes = EXCLUDED.notes,
        is_locked = (attendance_sessions.is_locked OR EXCLUDED.is_locked),
        locked_by = CASE WHEN attendance_sessions.is_locked THEN attendance_sessions.locked_by ELSE EXCLUDED.locked_by END,
        locked_at = CASE WHEN attendance_sessions.is_locked THEN attendance_sessions.locked_at ELSE EXCLUDED.locked_at END,
        updated_at = NOW()
      WHERE attendance_sessions.is_locked = FALSE
      RETURNING *;
    `, [courseId, semesterId, week_number, session_date || null, actorId, finalIsLocked, lockedBy, lockedAt, notes]);

    if (sessionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Attendance session for week ${week_number} has already been approved and locked. Modifications are prohibited.`,
        code: 'SESSION_LOCKED',
      });
    }

    const session = sessionRes.rows[0];

    const enrolledRes = await client.query(`
      SELECT s.student_id
      FROM enrollments e
      JOIN students s ON s.student_id = e.student_id
      WHERE e.course_id = $1 AND (e.semester_id = $2 OR e.semester_id IS NULL)
        AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
    `, [courseId, semesterId]);

    const statusMap = new Map();
    for (const r of records) {
      const sId = r.student_id || r.studentId;
      if (sId) statusMap.set(sId, r.status);
    }

    let presentCount = 0;
    let absentCount = 0;
    let excusedCount = 0;

    for (const stu of enrolledRes.rows) {
      const sId = stu.student_id;
      const status = statusMap.get(sId) || 'ABSENT';
      if (status === 'PRESENT') presentCount++;
      else if (status === 'EXCUSED') excusedCount++;
      else absentCount++;

      await client.query(`
        INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
        VALUES ($1, $2, $3, 'ROLL_CALL', 1.000)
        ON CONFLICT (session_id, student_id)
        DO UPDATE SET status = EXCLUDED.status, verification_method = 'ROLL_CALL', marked_at = NOW();
      `, [session.session_id, sId, status]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      status: 'SUCCESS',
      sessionId: session.session_id,
      weekNumber: session.week_number,
      message: `Week ${week_number} roll call recorded successfully.`,
      session,
      metrics: {
        totalEnrolled: enrolledRes.rows.length,
        presentCount,
        absentCount,
        excusedCount,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// In-memory fallback if Redis is temporarily unavailable
const memoryOtpStore = new Map();

// ─── 1C. Mode 2: Generate Ephemeral 5-Min OTP Passcode ───────────────────────
router.post('/courses/:courseId/sessions/otp/generate', async (req, res, next) => {
  const { courseId } = req.params;
  const rawWeek = req.body?.week_number ?? req.body?.weekNumber ?? 1;
  const week_number = parseInt(rawWeek, 10);
  const actorId = req.attendanceActor.userId;

  // 1. Week Bounds Validation
  if (isNaN(week_number) || week_number < 1 || week_number > 16) {
    return res.status(400).json({
      error: 'Valid week_number between 1 and 16 is required',
      code: 'INVALID_WEEK_NUMBER',
    });
  }

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const semesterId = termRes.rows[0]?.id || '2026_RAIN';

    // 2. Staff Course Allocation Guard: Restrict generation to allocated lecturer / HOD / Admin
    const access = await verifyAttendanceAccess(req.attendanceActor, courseId, semesterId);
    if (!access || !['LECTURER', 'HOD', 'ADMIN'].includes(access.role)) {
      return res.status(403).json({
        error: 'Forbidden: Only allocated course lecturers, HODs, or Administrators may generate attendance passcodes.',
        code: 'FORBIDDEN_STAFF_REQUIRED',
      });
    }

    // 3. Lock Guard: Reject if session is already approved and locked
    const lockCheck = await pool.query(
      `SELECT session_id, is_locked FROM attendance_sessions
       WHERE course_id = $1 AND semester_id = $2 AND week_number = $3 LIMIT 1`,
      [courseId, semesterId, week_number]
    );
    if (lockCheck.rows[0]?.is_locked) {
      return res.status(409).json({
        error: `Cannot generate passcode: Attendance session for week ${week_number} has already been approved and locked.`,
        code: 'SESSION_LOCKED',
      });
    }

    const sessionRes = await pool.query(`
      INSERT INTO attendance_sessions (
        course_id, semester_id, week_number, session_date, session_mode, created_by, is_locked, notes
      )
      VALUES ($1, $2, $3, CURRENT_DATE, 'CODE_OTP', $4, FALSE, 'Mode 2 Dynamic Passcode Session')
      ON CONFLICT (course_id, semester_id, week_number)
      DO UPDATE SET
        session_mode = 'CODE_OTP',
        updated_at = NOW()
      WHERE attendance_sessions.is_locked = FALSE
      RETURNING *;
    `, [courseId, semesterId, week_number, actorId]);

    if (sessionRes.rows.length === 0) {
      return res.status(409).json({
        error: `Cannot generate passcode: Attendance session for week ${week_number} has already been approved and locked.`,
        code: 'SESSION_LOCKED',
      });
    }

    const session = sessionRes.rows[0];

    const enrolledRes = await pool.query(`
      SELECT s.student_id FROM enrollments e
      JOIN students s ON s.student_id = e.student_id
      WHERE e.course_id = $1 AND (e.semester_id = $2 OR e.semester_id IS NULL)
        AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
    `, [courseId, semesterId]);

    for (const stu of enrolledRes.rows) {
      await pool.query(`
        INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
        VALUES ($1, $2, 'ABSENT', 'CODE_OTP', 1.000)
        ON CONFLICT (session_id, student_id) DO NOTHING;
      `, [session.session_id, stu.student_id]);
    }

    // Cryptographically Hardened OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const ttlSeconds = 300;
    const expiresAt = Date.now() + (ttlSeconds * 1000);

    // Cryptographic HMAC-SHA256 Derivation for L2 Persistence (Canonical courseId:otp format)
    const hmacSecret = process.env.OTP_HMAC_SECRET || config.jwt?.secret || 'focit_otp_hmac_secret_2026';
    const activeOtpHash = crypto
      .createHmac('sha256', hmacSecret)
      .update(`${courseId}:${otp}`)
      .digest('hex');

    // Commit authoritative hash and expiry to PostgreSQL L2 ledger
    await pool.query(`
      UPDATE attendance_sessions
      SET active_otp_hash = $1,
          otp_expires_at = TO_TIMESTAMP($2 / 1000.0),
          updated_at = NOW()
      WHERE session_id = $3
    `, [activeOtpHash, expiresAt, session.session_id]);

    const payload = JSON.stringify({
      otp,
      activeOtpHash,
      courseId,
      sessionId: session.session_id,
      weekNumber: session.week_number,
      expiresAt,
    });

    try {
      if (redis && typeof redis.set === 'function') {
        await redis.set(`attendance:otp:${courseId}`, payload, 'EX', ttlSeconds);
        await redis.zadd('attendance:active_sessions_zset', expiresAt, courseId);
        await redis.zremrangebyscore('attendance:active_sessions_zset', '-inf', Date.now());
      }
    } catch (_) {}

    // In-memory fallback in case Redis is offline
    memoryOtpStore.set(courseId, {
      otp,
      activeOtpHash,
      courseId,
      sessionId: session.session_id,
      weekNumber: session.week_number,
      expiresAt,
    });

    res.json({
      status: 'SUCCESS',
      otp,
      expiresInSeconds: ttlSeconds,
      expiresAt,
      sessionId: session.session_id,
      weekNumber: session.week_number,
      message: 'Dynamic 5-minute attendance passcode generated.',
    });
  } catch (err) {
    next(err);
  }
});

// ─── 1D. Mode 2: Student Check-in via OTP ────────────────────────────────────
router.post('/courses/:courseId/sessions/otp/check-in', async (req, res, next) => {
  const { courseId } = req.params;
  const { otp, sessionId } = req.body || {};
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;

  if (!otp || !String(otp).trim()) {
    return res.status(400).json({ error: 'Passcode is required', code: 'OTP_REQUIRED' });
  }

  const cleanOtp = String(otp).trim();
  const targetSessionId = sessionId && String(sessionId).trim() ? String(sessionId).trim() : null;

  try {
    const hmacSecret = process.env.OTP_HMAC_SECRET || config.jwt?.secret || 'focit_otp_hmac_secret_2026';
    // Canonical hash based on courseId:otp (allows 1-RTT zero-waterfall CTE even when sessionId is NULL)
    const canonicalHash = crypto
      .createHmac('sha256', hmacSecret)
      .update(`${courseId}:${cleanOtp}`)
      .digest('hex');

    // Legacy hash support (${sessionId}:${courseId}:${otp}) for backward compatibility
    const legacyHash = targetSessionId
      ? crypto.createHmac('sha256', hmacSecret).update(`${targetSessionId}:${courseId}:${cleanOtp}`).digest('hex')
      : canonicalHash;

    // Hardened Single-Statement 4-Part Atomic CTE (Zero-RTT waterfall, Relational Set-Difference & Idempotency)
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
          (SELECT week_number FROM target_session) AS week_number,
          (SELECT session_date FROM target_session) AS session_date,
          (SELECT is_locked FROM target_session) AS is_locked,
          (SELECT otp_valid FROM target_session) AS otp_valid,
          (SELECT otp_matched FROM target_session) AS otp_matched,
          (SELECT student_id FROM verified_enrollment) AS student_id,
          COALESCE((SELECT id FROM upsert_attendance), (SELECT id FROM existing_record)) AS record_id,
          COALESCE((SELECT status FROM upsert_attendance), (SELECT status FROM existing_record)) AS record_status,
          COALESCE((SELECT marked_at FROM upsert_attendance), (SELECT marked_at FROM existing_record)) AS marked_at,
          ((SELECT id FROM upsert_attendance) IS NULL AND (SELECT status FROM existing_record) = 'PRESENT') AS was_idempotent_retry;
    `;

    const queryRes = await pool.query(cteQuery, [targetSessionId, courseId, studentId, canonicalHash]);
    const row = queryRes.rows[0];

    // Invariant #4: Zero-Trust Precedence. Non-enrolled students are rejected with 403
    // before exposing any metadata about session existence, lock status, or expiration.
    if (!row || !row.student_id) {
      return res.status(403).json({
        error: 'Forbidden: You are not actively enrolled in this course for the current semester.',
        code: 'NOT_ENROLLED',
      });
    }
    if (!row.session_id) {
      return res.status(404).json({
        error: 'No active attendance session found for this course.',
        code: 'SESSION_NOT_FOUND',
      });
    }
    if (row.is_locked) {
      return res.status(409).json({ error: 'This attendance session has already been locked by the lecturer.', code: 'SESSION_LOCKED' });
    }
    if (!row.otp_valid) {
      return res.status(400).json({ error: 'This 5-minute passcode window has expired.', code: 'OTP_EXPIRED' });
    }
    if (!row.otp_matched) {
      return res.status(400).json({ error: 'Invalid 6-digit passcode. Check the lecture screen and try again.', code: 'INVALID_OTP' });
    }

    return res.status(200).json({
      status: 'VERIFIED',
      idempotent: Boolean(row.was_idempotent_retry),
      message: row.was_idempotent_retry
        ? 'Your attendance was already confirmed for this session.'
        : 'Attendance successfully confirmed via Passcode OTP!',
      sessionId: row.session_id,
      weekNumber: row.week_number,
      sessionDate: row.session_date,
      recordId: row.record_id,
      markedAt: row.marked_at,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 1E. Mode 2: OTP Session Status & Live Ticker ────────────────────────────
router.get('/courses/:courseId/sessions/otp/status', async (req, res, next) => {
  const { courseId } = req.params;
  const rawSince = req.query?.since ? String(req.query.since).trim() : null;
  const sinceMs = rawSince ? new Date(rawSince).getTime() : NaN;
  const validSince = Number.isFinite(sinceMs) ? new Date(sinceMs).toISOString() : null;

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const semesterId = termRes.rows[0]?.id || '2026_RAIN';

    const access = await verifyAttendanceAccess(req.attendanceActor, courseId, semesterId);
    if (!access || !['LECTURER', 'HOD', 'ADMIN'].includes(access.role)) {
      return res.status(403).json({
        error: 'Forbidden: Only allocated course lecturers, HODs, or Administrators may view OTP projection status.',
        code: 'FORBIDDEN_STAFF_REQUIRED',
      });
    }

    // Coalesce concurrent staff status polling via Single-Flight bucketed to 1-second floor intervals (Invariant #7)
    const sinceBucket = validSince ? Math.floor(sinceMs / 1000) : 'initial';
    const singleFlightKey = `otp:status:${courseId}:${sinceBucket}`;

    const statusPayload = await singleFlight.do(singleFlightKey, async () => {
      let otpData = null;
      try {
        if (redis && typeof redis.get === 'function') {
          const raw = await redis.get(`attendance:otp:${courseId}`);
          if (raw) otpData = JSON.parse(raw);
        }
      } catch (_) {}
      if (!otpData) otpData = memoryOtpStore.get(courseId);

      if (!otpData || otpData.courseId !== courseId || Date.now() > otpData.expiresAt) {
        return { active: false };
      }

      const remainingSeconds = Math.max(0, Math.floor((otpData.expiresAt - Date.now()) / 1000));
      const tallyRes = await pool.query(`
        SELECT 
          COUNT(id) FILTER (WHERE status = 'PRESENT')::int AS present_count,
          COUNT(id)::int AS total_records
        FROM attendance_records
        WHERE session_id = $1
      `, [otpData.sessionId]);

      const isStaffCaller = ['LECTURER', 'HOD', 'ADMIN', 'SYSTEM_ADMIN'].includes(
        String(req.attendanceActor?.role || '').toUpperCase()
      );

      const serverTime = new Date().toISOString();
      const payload = {
        active: true,
        sessionId: otpData.sessionId,
        weekNumber: otpData.weekNumber,
        remainingSeconds,
        presentCount: tallyRes.rows[0]?.present_count || 0,
        totalEnrolled: tallyRes.rows[0]?.total_records || 0,
        serverTime,
      };

      if (isStaffCaller) {
        payload.otp = otpData.otp;

        let recordsQuery = '';
        let queryParams = [];

        if (validSince) {
          // Delta query with 2-second sliding lookback window to absorb PostgreSQL MVCC commit reordering
          payload.isDelta = true;
          recordsQuery = `
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
              AND r.marked_at >= ($2::timestamptz - INTERVAL '2 seconds')
            ORDER BY r.marked_at ASC, s.matric_number ASC;
          `;
          queryParams = [otpData.sessionId, validSince];
        } else {
          // Initial baseline roster mount
          recordsQuery = `
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
          `;
          queryParams = [otpData.sessionId];
        }

        const recordsRes = await pool.query(recordsQuery, queryParams);
        payload.records = recordsRes.rows.map((r) => ({
          recordId: r.record_id,
          studentId: r.student_id,
          status: r.status,
          verificationMethod: r.verification_method,
          markedAt: r.marked_at,
          matricNumber: r.matric_number,
          fullName: r.full_name,
          programmeCode: r.programme_code,
          level: r.level,
        }));
      }

      return payload;
    });

    res.json(statusPayload);
  } catch (err) {
    next(err);
  }
});

// ─── 1F. Mode 3: Course Rep Lab Direct Check-in ──────────────────────────────
router.post('/courses/:courseId/sessions/rep-direct', async (req, res, next) => {
  const { courseId } = req.params;
  const week_number = req.body?.week_number ?? req.body?.weekNumber;
  const session_date = req.body?.session_date ?? req.body?.sessionDate;
  const notes = req.body?.notes || 'Course Rep Lab Direct Check-in';
  const records = req.body?.records || [];
  const is_locked = req.body?.is_locked ?? false;
  const actorId = req.attendanceActor.userId;

  if (!week_number || week_number < 1 || week_number > 15) {
    return res.status(400).json({ error: 'Valid week_number (1-15) is required', code: 'INVALID_WEEK' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const termRes = await client.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const semesterId = termRes.rows[0]?.id || '2026_RAIN';

    const access = await verifyAttendanceAccess(req.attendanceActor, courseId, semesterId);
    if (!access || !['LECTURER', 'HOD', 'ADMIN', 'COURSE_REP'].includes(access.role)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied: Unauthorized for this course', code: 'FORBIDDEN' });
    }

    // Lock Guard: Reject if session is already finalized and locked
    const existing = await client.query(
      `SELECT is_locked FROM attendance_sessions WHERE course_id = $1 AND semester_id = $2 AND week_number = $3 LIMIT 1 FOR UPDATE`,
      [courseId, semesterId, week_number]
    );
    if (existing.rows[0]?.is_locked) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Attendance session for week ${week_number} has already been approved and locked. Modifications are prohibited.`,
        code: 'SESSION_LOCKED',
      });
    }

    // Role Enforcement: Only faculty (Lecturer/HOD/Admin) can lock sessions; course reps cannot
    const canLock = ['LECTURER', 'HOD', 'ADMIN'].includes(access.role);
    const finalIsLocked = canLock && Boolean(is_locked);
    const lockedBy = finalIsLocked ? actorId : null;
    const lockedAt = finalIsLocked ? new Date() : null;

    const sessionRes = await client.query(`
      INSERT INTO attendance_sessions (
        course_id, semester_id, week_number, session_date, session_mode,
        created_by, is_locked, locked_by, locked_at, notes
      )
      VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), 'REP_DIRECT', $5, $6, $7, $8, $9)
      ON CONFLICT (course_id, semester_id, week_number)
      DO UPDATE SET
        session_mode = 'REP_DIRECT',
        notes = EXCLUDED.notes,
        is_locked = (attendance_sessions.is_locked OR EXCLUDED.is_locked),
        locked_by = CASE WHEN attendance_sessions.is_locked THEN attendance_sessions.locked_by ELSE EXCLUDED.locked_by END,
        locked_at = CASE WHEN attendance_sessions.is_locked THEN attendance_sessions.locked_at ELSE EXCLUDED.locked_at END,
        updated_at = NOW()
      WHERE attendance_sessions.is_locked = FALSE
      RETURNING *;
    `, [courseId, semesterId, week_number, session_date || null, actorId, finalIsLocked, lockedBy, lockedAt, notes]);

    if (sessionRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Attendance session for week ${week_number} has already been approved and locked. Modifications are prohibited.`,
        code: 'SESSION_LOCKED',
      });
    }

    const session = sessionRes.rows[0];

    // Invariant 3: Dijkstra Resource Ordering (Enrolled roster sorted by s.student_id ASC guarantees deadlock immunity)
    const enrolledRes = await client.query(`
      SELECT s.student_id FROM enrollments e
      JOIN students s ON s.student_id = e.student_id
      WHERE e.course_id = $1 AND (e.semester_id = $2 OR e.semester_id IS NULL)
        AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
      ORDER BY s.student_id ASC;
    `, [courseId, semesterId]);

    const enrolledSet = new Set(enrolledRes.rows.map((r) => r.student_id));

    // Invariant 4: Relational Set-Difference Validation (Poisoned Roster Payload Defense)
    const poisonedStudents = records
      .map((r) => r.student_id || r.studentId)
      .filter((id) => id && !enrolledSet.has(id));

    if (poisonedStudents.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Poisoned roster payload rejected: The following student identifiers are not actively enrolled in ${courseId}: ${poisonedStudents.join(', ')}`,
        code: 'POISONED_ROSTER_PAYLOAD',
        unenrolledStudentIds: poisonedStudents,
      });
    }

    const VALID_STATUSES = ['PRESENT', 'ABSENT', 'EXCUSED'];
    for (const r of records) {
      const status = r.status;
      if (status && !VALID_STATUSES.includes(status)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Invalid attendance status "${status}". Allowed values: ${VALID_STATUSES.join(', ')}`,
          code: 'INVALID_ATTENDANCE_STATUS',
        });
      }
    }

    const statusMap = new Map();
    for (const r of records) {
      const sId = r.student_id || r.studentId;
      if (sId) statusMap.set(sId, r.status);
    }

    let presentCount = 0;
    let absentCount = 0;

    for (const stu of enrolledRes.rows) {
      const sId = stu.student_id;
      const status = statusMap.get(sId) || 'ABSENT';
      if (status === 'PRESENT') presentCount++;
      else absentCount++;

      await client.query(`
        INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
        VALUES ($1, $2, $3, 'MANUAL_OVERRIDE', 1.000)
        ON CONFLICT (session_id, student_id)
        DO UPDATE SET status = EXCLUDED.status, verification_method = 'MANUAL_OVERRIDE', marked_at = NOW();
      `, [session.session_id, sId, status]);
    }

    if (access.role === 'COURSE_REP') {
      const allocRes = await client.query(`
        SELECT sa.advisor_id FROM hod_course_allocations hca
        JOIN staff_advisors sa ON sa.advisor_id = hca.lecturer_id
        WHERE hca.course_id = $1 AND hca.semester_id = $2 LIMIT 1
      `, [courseId, semesterId]);
      if (allocRes.rows[0]) {
        await notificationBroadcaster.broadcast({
          student_id: allocRes.rows[0].advisor_id,
          title: `📝 Course Rep Lab Attendance Submitted (Week ${week_number})`,
          body: `Course Rep submitted digital lab attendance. ${presentCount} present, ${absentCount} absent. Review and lock.`,
          action_url: '/lecturer',
          course_id: courseId,
          session_id: session.session_id,
          week_number,
        }, client);
      }
    }

    await client.query('COMMIT');

    res.status(201).json({
      status: 'SUCCESS',
      sessionId: session.session_id,
      weekNumber: session.week_number,
      message: `Week ${week_number} lab direct attendance submitted.`,
      session,
      metrics: {
        totalEnrolled: enrolledRes.rows.length,
        presentCount,
        absentCount,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
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
      SET is_locked = TRUE, 
          locked_by = $1, 
          locked_at = NOW(), 
          active_otp_hash = NULL,
          otp_expires_at = NULL,
          updated_at = NOW()
      WHERE session_id = $2 AND is_locked = FALSE
      RETURNING *;
    `, [actorId, sessionId]);

    if (rows.length === 0) {
      return res.status(409).json({ error: 'Session is already locked or does not exist', code: 'ALREADY_LOCKED' });
    }

    try {
        if (redis) {
          await redis.del(`attendance:otp:${rows[0].course_id}`);
          await redis.zrem('attendance:active_sessions_zset', rows[0].course_id);
        }
      } catch (_) {}

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



// ─── 7. Student Attendance Telemetry & Audit Endpoints ─────────────────────────

/**
 * GET /api/attendance/student/summary
 * Retrieves overall attendance percentage, per-course 75% NUC eligibility,
 * and session deficit counts for the calling student.
 */
router.get(['/student/summary', '/summary'], async (req, res, next) => {
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  const { semesterId } = req.query;

  try {
    const summary = await studentAttendanceService.getStudentAttendanceSummary(studentId, semesterId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/attendance/student/active
 * Probes for live Mode 2 OTP sessions in enrolled courses. Strips plaintext PIN.
 */
router.get(['/student/active', '/active'], async (req, res, next) => {
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  const { semesterId } = req.query;

  try {
    const active = await studentAttendanceService.getStudentActiveSessions(studentId, semesterId);
    res.json(active);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/attendance/courses/:courseId/student-attendance
 * Returns weekly timeline for a single enrolled course with all cohort data stripped.
 */
router.get('/courses/:courseId/student-attendance', async (req, res, next) => {
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  const { courseId } = req.params;
  const { semesterId } = req.query;

  try {
    const timeline = await studentAttendanceService.getCourseStudentAttendanceTimeline(studentId, courseId, semesterId);
    res.json(timeline);
  } catch (err) {
    next(err);
  }
});

export default router;