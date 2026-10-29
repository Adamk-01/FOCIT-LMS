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
      `SELECT session_id, is_locked FROM attendance_sessions 
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
      RETURNING *;
    `, [courseId, semesterId, week_number, actorId]);

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

    const payload = JSON.stringify({
      otp,
      courseId,
      sessionId: session.session_id,
      weekNumber: session.week_number,
      expiresAt,
    });

    try {
      if (redis && typeof redis.set === 'function') {
        await redis.set(`attendance:otp:${courseId}`, payload, 'EX', ttlSeconds);
      }
    } catch (_) {}
    memoryOtpStore.set(courseId, { otp, courseId, sessionId: session.session_id, weekNumber: session.week_number, expiresAt });

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
  const { otp } = req.body || {};
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;

  if (!otp || !String(otp).trim()) {
    return res.status(400).json({ error: 'Passcode is required', code: 'OTP_REQUIRED' });
  }

  try {
    let otpData = null;
    try {
      if (redis && typeof redis.get === 'function') {
        const raw = await redis.get(`attendance:otp:${courseId}`);
        if (raw) otpData = JSON.parse(raw);
      }
    } catch (_) {}

    if (!otpData) {
      otpData = memoryOtpStore.get(courseId);
    }

    if (!otpData || String(otpData.otp).trim() !== String(otp).trim() || Date.now() > otpData.expiresAt) {
      return res.status(400).json({
        error: 'Invalid or expired attendance passcode. Please ask your lecturer for the current code.',
        code: 'INVALID_OTP',
      });
    }

    // Verify session lock status
    const sessCheck = await pool.query(
      `SELECT is_locked FROM attendance_sessions WHERE session_id = $1 LIMIT 1`,
      [otpData.sessionId]
    );
    if (sessCheck.rows[0]?.is_locked) {
      return res.status(409).json({
        error: 'Cannot check in: Attendance session has already been approved and locked.',
        code: 'SESSION_LOCKED',
      });
    }

    const enrollCheck = await pool.query(`
      SELECT 1 FROM enrollments 
      WHERE course_id = $1 AND student_id = $2 
        AND status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
      LIMIT 1
    `, [courseId, studentId]);

    if (enrollCheck.rows.length === 0) {
      return res.status(403).json({
        error: 'You are not enrolled in this course.',
        code: 'ENROLLMENT_REQUIRED',
      });
    }

    await pool.query(`
      INSERT INTO attendance_records (session_id, student_id, status, verification_method, confidence_score)
      VALUES ($1, $2, 'PRESENT', 'CODE_OTP', 1.000)
      ON CONFLICT (session_id, student_id)
      DO UPDATE SET status = 'PRESENT', verification_method = 'CODE_OTP', marked_at = NOW();
    `, [otpData.sessionId, studentId]);

    res.json({
      status: 'VERIFIED',
      message: 'Attendance successfully confirmed via Passcode OTP!',
      sessionId: otpData.sessionId,
      weekNumber: otpData.weekNumber,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 1E. Mode 2: OTP Session Status & Live Ticker ────────────────────────────
router.get('/courses/:courseId/sessions/otp/status', async (req, res, next) => {
  const { courseId } = req.params;
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

    let otpData = null;
    try {
      if (redis && typeof redis.get === 'function') {
        const raw = await redis.get(`attendance:otp:${courseId}`);
        if (raw) otpData = JSON.parse(raw);
      }
    } catch (_) {}
    if (!otpData) otpData = memoryOtpStore.get(courseId);

    if (!otpData || Date.now() > otpData.expiresAt) {
      return res.json({ active: false });
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

    const statusPayload = {
      active: true,
      sessionId: otpData.sessionId,
      weekNumber: otpData.weekNumber,
      remainingSeconds,
      presentCount: tallyRes.rows[0]?.present_count || 0,
      totalEnrolled: tallyRes.rows[0]?.total_records || 0,
    };

    // Information Barrier: Only staff projection screens receive the plaintext OTP
    if (isStaffCaller) {
      statusPayload.otp = otpData.otp;
    }

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

    const enrolledRes = await client.query(`
      SELECT s.student_id FROM enrollments e
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
