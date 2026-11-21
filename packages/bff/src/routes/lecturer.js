function escapeCsvField(val) {
  if (val === null || val === undefined) return '""';
  let str = String(val);
  // Mitigate CSV Formula Injection (CWE-1236): Prepend apostrophe to formula trigger chars
  if (/^[=\+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}
/**
 * FOCIT LMS - Lecturer Workspace & Cohort Roster Router
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. GET /api/lecturer/courses - Returns courses officially allocated to lecturer by HOD
 * 2. GET /api/lecturer/courses/:courseId/students - Returns authoritative enrolled student list
 * 3. GET /api/lecturer/courses/:courseId/roster/export - Generates printable/CSV exam attendance sheet
 * 4. GET /api/lecturer/overview - Returns teaching workload and assessment counts
 */

import { Router } from 'express';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { createNotification } from './notifications.js';
import { recordIdentityAuditLog } from '../lib/auditLogger.js';

const router = Router();

/**
 * Resolves the authenticated lecturer's staff record and scopes.
 * Permitted roles: LECTURER, LEVEL_ADVISOR, HOD, ADMIN, SYSTEM_ADMIN
 */
async function requireLecturer(req, res, next) {
  try {
    const userRole = String(req.user?.role || '').toUpperCase();
    const isStaff = ['LECTURER', 'LEVEL_ADVISOR', 'HOD', 'ADMIN', 'SYSTEM_ADMIN'].includes(userRole);

    if (!isStaff) {
      return res.status(403).json({
        error: 'Lecturer or academic staff role required',
        code: 'FORBIDDEN_NOT_LECTURER',
      });
    }

    const identifier = req.user?.email || req.user?.username || req.user?.id || req.user?.student_id;

    const { rows } = await pool.query(
      `SELECT advisor_id, staff_number, full_name, email, department_id, role, account_status
       FROM staff_advisors
       WHERE email = $1 OR advisor_id = $1 OR staff_number = $1
       LIMIT 1`,
      [identifier]
    );

    if (rows.length === 0) {
      // If admin testing without staff_advisors entry, create synthetic scope
      if (['ADMIN', 'SYSTEM_ADMIN'].includes(userRole)) {
        req.lecturerScope = {
          advisor_id: req.user?.id || 'admin',
          staff_number: 'ADMIN',
          full_name: 'Administrator',
          department_id: 'CSC',
          role: userRole,
          isSystemAdmin: true,
        };
        return next();
      }

      return res.status(403).json({
        error: 'Staff advisor / lecturer profile not found',
        code: 'STAFF_RECORD_NOT_FOUND',
      });
    }

    req.lecturerScope = rows[0];
    next();
  } catch (err) {
    logger.error({ err: err?.message || err }, '[LecturerScope] Scope resolution failure');
    next(err);
  }
}

router.use(requireLecturer);

// ─── 1. Lecturer Workload & Overview Metrics ──────────────────────────────────
router.get('/overview', async (req, res, next) => {
  const lecturerId = req.lecturerScope.advisor_id;

  try {
    const termRes = await pool.query(
      `SELECT id, name FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const activeSemesterId = termRes.rows[0]?.id || '2026_RAIN';

    // Workload stats
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT hca.course_id)::int AS assigned_courses_count,
        COALESCE(COUNT(DISTINCT e.student_id), 0)::int AS total_students_taught,
        COALESCE(COUNT(DISTINCT q.quiz_id), 0)::int AS active_quizzes_count,
        COALESCE(COUNT(DISTINCT a.assignment_id), 0)::int AS active_assignments_count
      FROM hod_course_allocations hca
      JOIN courses c ON c.course_id = hca.course_id
      LEFT JOIN enrollments e ON e.course_id = hca.course_id AND e.semester_id = hca.semester_id AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
      LEFT JOIN quizzes q ON q.course_id = hca.course_id AND q.status = 'ACTIVE'
      LEFT JOIN course_assignments a ON a.course_id = hca.course_id AND a.status = 'PUBLISHED'
      WHERE (
        hca.lecturer_id = $1 
        OR ($2 = TRUE AND ($4::varchar IS NULL OR c.department_id = $4::varchar))
      )
      AND hca.semester_id = $3
    `;

    const { rows } = await pool.query(statsQuery, [
      lecturerId,
      req.lecturerScope.isSystemAdmin || req.lecturerScope.role === 'HOD',
      activeSemesterId,
      req.lecturerScope.isSystemAdmin ? null : req.lecturerScope.department_id,
    ]);

    res.json({
      semester: termRes.rows[0],
      lecturer: req.lecturerScope,
      metrics: rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// ─── 2. Allocated Courses for Authenticated Lecturer ──────────────────────────
router.get('/courses', async (req, res, next) => {
  const lecturerId = req.lecturerScope.advisor_id;
  const { semesterId } = req.query;

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const targetSemesterId = semesterId || termRes.rows[0]?.id || '2026_RAIN';

    const query = `
      SELECT 
        c.course_id,
        c.code,
        c.title,
        c.level,
        c.units,
        c.category,
        c.max_capacity,
        c.enrolled_count,
        d.name AS department_name,
        d.code AS department_code,
        hca.id AS allocation_id,
        hca.updated_at AS allocated_at,
        (
          SELECT COUNT(*)::int 
          FROM enrollments e 
          WHERE e.course_id = c.course_id 
            AND e.semester_id = $2 
            AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS', 'COMPLETED')
        ) AS verified_enrolled_students,
        (
          SELECT COUNT(*)::int
          FROM course_registration_items cri
          JOIN course_registration_batches b ON b.id = cri.batch_id
          WHERE cri.course_id = c.course_id
            AND b.semester_id = $2
            AND cri.status = 'PENDING_LECTURER'
        ) AS pending_registrations_count
      FROM courses c
      JOIN departments d ON d.id = c.department_id
      JOIN hod_course_allocations hca ON hca.course_id = c.course_id AND hca.semester_id = $2
      WHERE (
        hca.lecturer_id = $1 
        OR ($3 = TRUE AND ($4::varchar IS NULL OR c.department_id = $4::varchar))
      )
      AND c.is_active = TRUE
      ORDER BY c.code ASC
    `;

    const { rows } = await pool.query(query, [
      lecturerId,
      targetSemesterId,
      req.lecturerScope.isSystemAdmin || req.lecturerScope.role === 'HOD',
      req.lecturerScope.isSystemAdmin ? null : req.lecturerScope.department_id,
    ]);

    res.json({
      semesterId: targetSemesterId,
      courses: rows,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 3. Enrolled Student Class Roster for Assigned Course ───────────────────────
router.get('/courses/:courseId/students', async (req, res, next) => {
  const { courseId } = req.params;
  const lecturerId = req.lecturerScope.advisor_id;
  const { semesterId, search, level } = req.query;

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const targetSemesterId = semesterId || termRes.rows[0]?.id || '2026_RAIN';

    // 1. Verify Course Authorization (Must be allocated to caller or caller is Admin/HOD)
    const authCheck = await pool.query(
      `SELECT 1 FROM hod_course_allocations 
       WHERE course_id = $1 AND semester_id = $2 AND (lecturer_id = $3 OR $4 = TRUE)
       LIMIT 1`,
      [courseId, targetSemesterId, lecturerId, req.lecturerScope.isSystemAdmin || req.lecturerScope.role === 'HOD']
    );

    if (authCheck.rows.length === 0) {
      return res.status(403).json({
        error: 'Access denied: You are not allocated to teach this course in the selected semester',
        code: 'COURSE_NOT_ALLOCATED',
      });
    }

    // 2. Fetch Course Details
    const courseRes = await pool.query(
      `SELECT course_id, code, title, units, level FROM courses WHERE course_id = $1 LIMIT 1`,
      [courseId]
    );
    const course = courseRes.rows[0];

    // 3. Query Enrolled Cohort with aggregated CA Test and Practice Quiz scores
    const studentsQuery = `
      SELECT 
        s.student_id,
        s.matric_number,
        s.full_name,
        s.email,
        s.level,
        p.name AS programme_name,
        p.code AS programme_code,
        d.code AS department_code,
        e.enrollment_id,
        e.status AS enrollment_status,
        e.enrolled_at,
        e.grade,
        COALESCE(e.is_course_rep, FALSE) AS is_course_rep,
        (
          SELECT CASE 
            WHEN COUNT(qa.attempt_id) = 0 THEN NULL
            ELSE ROUND(AVG(
              CASE 
                WHEN COALESCE(q.total_points, 0) > 0 THEN (qa.score / q.total_points) * 40.0
                ELSE qa.score
              END
            )::numeric, 1)::float
          END
          FROM quiz_attempts qa
          JOIN quizzes q ON q.quiz_id = qa.quiz_id
          WHERE qa.student_id = s.student_id
            AND q.course_id = $1
            AND (q.semester_id = $2 OR q.semester_id IS NULL)
            AND qa.status = 'SUBMITTED'
        ) AS ca_test_score
      FROM enrollments e
      JOIN students s ON s.student_id = e.student_id
      JOIN programmes p ON p.id = s.programme_id
      JOIN departments d ON d.id = p.department_id
      WHERE e.course_id = $1 
        AND e.semester_id = $2
        AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS', 'COMPLETED')
        AND ($3::varchar IS NULL OR (
          s.full_name ILIKE '%' || $3 || '%' 
          OR s.matric_number ILIKE '%' || $3 || '%'
        ))
        AND ($4::int IS NULL OR s.level = $4::int)
      ORDER BY s.matric_number ASC
    `;

    const { rows: students } = await pool.query(studentsQuery, [
      courseId,
      targetSemesterId,
      search?.trim() || null,
      level ? parseInt(level, 10) : null,
    ]);

    res.json({
      course,
      semesterId: targetSemesterId,
      totalCount: students.length,
      students,
    });
  } catch (err) {
    next(err);
  }
});

// ─── 3b. Assign or Toggle Course Representative ──────────────────────────────
router.post('/courses/:courseId/students/:studentId/assign-rep', async (req, res, next) => {
  const { courseId, studentId } = req.params;
  const { isRep, semesterId } = req.body || {};
  const lecturerId = req.lecturerScope.advisor_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolve Target Active Semester
    const termRes = await client.query(
      `SELECT s.id 
       FROM academic_semesters s
       LEFT JOIN academic_sessions sess ON sess.id = s.session_id
       ORDER BY COALESCE(sess.is_current, FALSE) DESC, s.created_at DESC 
       LIMIT 1`
    );
    const targetSemesterId = semesterId || req.query?.semesterId || termRes.rows[0]?.id || '2026_RAIN';

    // 2. Fetch Course details and enforce allocation check
    const courseRes = await client.query(
      `SELECT course_id, code, title, department_id FROM courses WHERE course_id = $1 LIMIT 1`,
      [courseId]
    );
    if (courseRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Course not found', code: 'COURSE_NOT_FOUND' });
    }
    const course = courseRes.rows[0];

    const isAllocated = (await client.query(
      `SELECT 1 FROM hod_course_allocations 
       WHERE course_id = $1 AND semester_id = $2 AND lecturer_id = $3 LIMIT 1`,
      [courseId, targetSemesterId, lecturerId]
    )).rows.length > 0;

    const isDeptHod = req.lecturerScope.role === 'HOD' && req.lecturerScope.department_id === course.department_id;
    const isSysAdmin = Boolean(req.lecturerScope.isSystemAdmin);

    if (!isAllocated && !isDeptHod && !isSysAdmin) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'Forbidden: You must be allocated to teach this course in the active semester to designate a Course Representative.',
        code: 'FORBIDDEN_COURSE_ALLOCATION',
      });
    }

    const setRep = isRep !== undefined ? Boolean(isRep) : true;
    const appointedBy = String(lecturerId || req.lecturerScope.username || req.user?.username || 'STAFF').slice(0, 64);

    // 3. Limit update strictly to active enrollments in the selected semester
    const updateRes = await client.query(
      `UPDATE enrollments
       SET is_course_rep = $1, updated_at = NOW()
       WHERE course_id = $2 
         AND student_id = $3 
         AND semester_id = $4
         AND status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS', 'COMPLETED')
       RETURNING enrollment_id, course_id, student_id, semester_id, is_course_rep`,
      [setRep, courseId, studentId, targetSemesterId]
    );

    if (updateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Active student enrollment not found for this course in the specified semester',
        code: 'ENROLLMENT_NOT_FOUND',
      });
    }

    // 4. Synchronize with course_representatives table used by attendance & access control
    if (setRep) {
      await client.query(
        `INSERT INTO course_representatives (course_id, semester_id, student_id, appointed_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (course_id, semester_id, student_id) 
         DO UPDATE SET appointed_by = EXCLUDED.appointed_by`,
        [courseId, targetSemesterId, studentId, appointedBy]
      );
    } else {
      await client.query(
        `DELETE FROM course_representatives 
         WHERE course_id = $1 AND student_id = $2 AND semester_id = $3`,
        [courseId, studentId, targetSemesterId]
      );
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: setRep ? 'Student designated as Course Representative' : 'Course Representative designation revoked',
      enrollment: updateRes.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// ─── 4. Export Printable / CSV Examination Hall Roster ─────────────────────────
router.get('/courses/:courseId/roster/export', async (req, res, next) => {
  const { courseId } = req.params;
  const lecturerId = req.lecturerScope.advisor_id;
  const { semesterId } = req.query;

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const targetSemesterId = semesterId || termRes.rows[0]?.id || '2026_RAIN';

    // 1. Fetch Course metadata & enforce course allocation check
    const courseRes = await pool.query(
      `SELECT course_id, code, title, department_id FROM courses WHERE course_id = $1 LIMIT 1`,
      [courseId]
    );
    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found', code: 'COURSE_NOT_FOUND' });
    }
    const course = courseRes.rows[0];

    // Enforce course allocation check: caller must be assigned lecturer, department HOD, or System Admin
    const isAllocated = await pool.query(
      `SELECT 1 FROM hod_course_allocations 
       WHERE course_id = $1 AND semester_id = $2 AND lecturer_id = $3 LIMIT 1`,
      [courseId, targetSemesterId, lecturerId]
    );
    const isDeptHod = req.lecturerScope.role === 'HOD' && req.lecturerScope.department_id === course.department_id;
    const isSysAdmin = req.lecturerScope.isSystemAdmin;

    if (!isAllocated.rows.length && !isDeptHod && !isSysAdmin) {
      return res.status(403).json({
        error: 'Forbidden: You must be allocated to teach this course to export its official examination roster.',
        code: 'FORBIDDEN_ROSTER_EXPORT',
      });
    }

    // 2. Fetch all verified enrolled students
    const { rows: students } = await pool.query(
      `SELECT 
        s.matric_number,
        s.full_name,
        p.code AS programme_code,
        s.level
       FROM enrollments e
       JOIN students s ON s.student_id = e.student_id
       JOIN programmes p ON p.id = s.programme_id
       WHERE e.course_id = $1 AND e.semester_id = $2 AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS', 'COMPLETED')
       ORDER BY s.matric_number ASC`,
      [courseId, targetSemesterId]
    );

    // 3. Format CSV content with rigorous escaping against CSV Formula Injection (CWE-1236)
    const csvRows = [
      escapeCsvField('OSUN STATE UNIVERSITY - FACULTY OF COMPUTING & INFORMATION TECHNOLOGY (FOCIT)'),
      escapeCsvField('OFFICIAL CLASS & EXAMINATION ROSTER'),
      escapeCsvField(`Course: ${course.code} - ${course.title} | Semester: ${targetSemesterId}`),
      escapeCsvField(`Lecturer: ${req.lecturerScope.full_name} (${req.lecturerScope.staff_number})`),
      escapeCsvField(`Total Enrolled Students: ${students.length}`),
      '',
      [
        escapeCsvField('S/N'),
        escapeCsvField('Matric Number'),
        escapeCsvField('Student Full Name'),
        escapeCsvField('Programme'),
        escapeCsvField('Level'),
        escapeCsvField('Continuous Assessment (40)'),
        escapeCsvField('Exam (60)'),
        escapeCsvField('Total (100)'),
        escapeCsvField('Candidate Signature'),
      ].join(','),
    ];

    students.forEach((s, idx) => {
      csvRows.push([
        idx + 1,
        escapeCsvField(s.matric_number),
        escapeCsvField(s.full_name),
        escapeCsvField(s.programme_code),
        s.level,
        '""',
        '""',
        '""',
        '""',
      ].join(','));
    });

    const csvContent = csvRows.join('\r\n');
    const safeCode = course.code.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Record roster data export in immutable audit ledger (F8 Hardening)
    await recordIdentityAuditLog(pool, {
      eventType: 'COURSE_ROSTER_EXPORT',
      actorId: req.user?.id || req.lecturerScope.advisor_id,
      actorRole: req.user?.role || req.lecturerScope.role || 'LECTURER',
      targetId: courseId,
      targetType: 'COURSE_ROSTER',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { courseId, semesterId: targetSemesterId, recordCount: students.length, format: 'CSV' },
    }).catch((err) => logger.warn({ err }, '[Lecturer] Failed to record roster export audit log'));

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${safeCode}_Official_Roster.csv"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
});


// ── 5. Ingest Bulk Continuous Assessment (CSV / JSON) ──────────────────────────
router.post('/courses/:courseId/grades/ingest', async (req, res, next) => {
  const { courseId } = req.params;
  const lecturerId = req.lecturerScope.advisor_id;
  const { semesterId, grades } = req.body;

  if (!Array.isArray(grades) || grades.length === 0) {
    return res.status(400).json({
      error: 'Grades payload must be a non-empty array of records: [{ matricNumber, caScore, examScore }]',
      code: 'INVALID_GRADES_PAYLOAD'
    });
  }

  const client = await pool.connect();
  try {
    const termRes = await client.query(
      'SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1'
    );
    const targetSemesterId = semesterId || termRes.rows[0]?.id || '2026_RAIN';

    // 1. Course Authorization
    const courseRes = await client.query(
      `SELECT course_id, code, title, department_id FROM courses WHERE course_id = $1 LIMIT 1`,
      [courseId]
    );
    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found', code: 'COURSE_NOT_FOUND' });
    }
    const course = courseRes.rows[0];

    const isAllocated = (await client.query(
      `SELECT 1 FROM hod_course_allocations 
       WHERE course_id = $1 AND semester_id = $2 AND lecturer_id = $3 LIMIT 1`,
      [courseId, targetSemesterId, lecturerId]
    )).rows.length > 0;

    const isDeptHod = req.lecturerScope.role === 'HOD' && req.lecturerScope.department_id === course.department_id;
    const isSysAdmin = Boolean(req.lecturerScope.isSystemAdmin);

    if (!isAllocated && !isDeptHod && !isSysAdmin) {
      return res.status(403).json({
        error: 'Access denied: You are not authorized to record grades for this course',
        code: 'FORBIDDEN_GRADE_INGESTION'
      });
    }

    await client.query('BEGIN');

    let updatedCount = 0;
    const errors = [];
    const sanitizedRecords = [];

    for (const record of grades) {
      const matric = String(record.matricNumber || record.matric_number || '').trim();
      const rawCa = record.caScore ?? record.ca ?? record.continuous_assessment;
      const rawExam = record.examScore ?? record.exam;
      const rawTotal = record.totalScore ?? record.total ?? record.grade;

      if (!matric) {
        errors.push({ matric: 'UNKNOWN', error: 'Missing matric number' });
        continue;
      }

      const hasTotal = rawTotal !== undefined && rawTotal !== null && String(rawTotal).trim() !== '';
      const hasCa = rawCa !== undefined && rawCa !== null && String(rawCa).trim() !== '';
      const hasExam = rawExam !== undefined && rawExam !== null && String(rawExam).trim() !== '';

      if (!hasTotal && !hasCa && !hasExam) {
        errors.push({ matric, error: 'Record contains no grade scores (skipped to avoid clearing existing grade)' });
        continue;
      }

      // Validate caScore and examScore bounds even when a total is supplied
      let caVal = 0;
      let examVal = 0;

      if (hasCa) {
        const parsedCa = Number(rawCa);
        if (isNaN(parsedCa) || parsedCa < 0 || parsedCa > 40) {
          errors.push({ matric, error: `Invalid CA score '${rawCa}': must be a valid number between 0 and 40` });
          continue;
        }
        caVal = parsedCa;
      }

      if (hasExam) {
        const parsedExam = Number(rawExam);
        if (isNaN(parsedExam) || parsedExam < 0 || parsedExam > 60) {
          errors.push({ matric, error: `Invalid Exam score '${rawExam}': must be a valid number between 0 and 60` });
          continue;
        }
        examVal = parsedExam;
      }

      let numericGrade = null;
      if (hasTotal) {
        const parsed = Number(rawTotal);
        if (isNaN(parsed) || parsed < 0 || parsed > 100) {
          errors.push({ matric, error: `Invalid Total score '${rawTotal}': must be a valid number between 0 and 100` });
          continue;
        }
        numericGrade = parsed;
      } else {
        numericGrade = Math.round((caVal + examVal) * 100) / 100;
      }

      if (numericGrade < 0 || numericGrade > 100) {
        errors.push({ matric, error: `Calculated total score (${numericGrade}) is out of bounds (0 - 100)` });
        continue;
      }

      // Check enrollment existence: only actively enrolled students
      const findRes = await client.query(
        `SELECT e.enrollment_id, e.student_id 
         FROM enrollments e
         JOIN students s ON s.student_id = e.student_id
         WHERE (UPPER(TRIM(s.matric_number)) = UPPER(TRIM($1)) OR s.student_id = $1)
           AND e.course_id = $2
           AND e.semester_id = $3
           AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS', 'COMPLETED')
           AND s.is_active = TRUE
         LIMIT 1`,
        [matric, courseId, targetSemesterId]
      );

      if (findRes.rows.length === 0) {
        errors.push({ matric, error: 'Student is not actively enrolled in this course for the semester' });
        continue;
      }

      const enrollmentId = findRes.rows[0].enrollment_id;

      await client.query(
        `UPDATE enrollments
         SET grade = $1,
             updated_at = NOW()
         WHERE enrollment_id = $2`,
        [numericGrade, enrollmentId]
      );

      updatedCount++;
      sanitizedRecords.push({ matric, grade: numericGrade });
    }

    await client.query('COMMIT');

    return res.status(200).json({
      message: `Successfully ingested continuous assessment grades for ${updatedCount} student(s)`,
      updatedCount,
      errorsCount: errors.length,
      errors,
      records: sanitizedRecords
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err: err?.message || err, courseId }, '[Lecturer] Grade ingestion failed');
    next(err);
  } finally {
    client.release();
  }
});

// ─── 8. Course Registration Approval Desk (Assigned Lecturers Only) ──────────

/**
 * Strict verification that caller is officially allocated to this course (Primary or Co-Lecturer).
 * Explicitly rejects Admin, HOD, and unassigned staff with zero bypass.
 */
async function verifyAssignedCourseLecturer(courseId, lecturerId, semesterId) {
  const query = `
    SELECT hca.id, hca.is_primary, sa.full_name, sa.staff_number
    FROM hod_course_allocations hca
    JOIN staff_advisors sa ON sa.advisor_id = hca.lecturer_id
    WHERE hca.course_id = $1 
      AND hca.semester_id = $2 
      AND hca.lecturer_id = $3
    LIMIT 1
  `;
  const { rows } = await pool.query(query, [courseId, semesterId, lecturerId]);
  return rows[0] || null;
}

/**
 * GET /api/lecturer/courses/:courseId/registrations
 * Retrieves pending student course registration applications for an assigned course.
 * Strict Guard: Caller must be an allocated primary or co-lecturer.
 */
router.get('/courses/:courseId/registrations', async (req, res, next) => {
  const { courseId } = req.params;
  const lecturerId = req.lecturerScope.advisor_id;
  const { semesterId } = req.query;

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const targetSemesterId = semesterId || termRes.rows[0]?.id || '2026_RAIN';

    // 1. Strict Assigned Lecturer Invariant (No Admin or HOD bypass)
    const assignment = await verifyAssignedCourseLecturer(courseId, lecturerId, targetSemesterId);
    if (!assignment) {
      return res.status(403).json({
        error: 'Access denied: Only primary or secondary lecturers officially assigned to this course can view or manage course registrations. Admins, HODs, and unallocated staff are prohibited.',
        code: 'FORBIDDEN_NOT_ASSIGNED_LECTURER',
      });
    }

    // 2. Fetch Course Metadata
    const courseRes = await pool.query(
      `SELECT course_id, code, title, units, level, enrolled_count, max_capacity FROM courses WHERE course_id = $1 LIMIT 1`,
      [courseId]
    );
    if (courseRes.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found', code: 'COURSE_NOT_FOUND' });
    }

    // 3. Query Registrations Queue
    const query = `
      SELECT 
        cri.id AS item_id,
        cri.batch_id,
        cri.course_id,
        cri.units,
        cri.category,
        cri.status,
        cri.approved_by,
        cri.approved_at,
        cri.rejected_by,
        cri.rejected_at,
        cri.rejection_reason,
        cri.created_at,
        s.student_id,
        s.matric_number,
        s.full_name,
        s.email,
        s.level,
        s.current_gpa,
        p.name AS programme_name,
        p.code AS programme_code,
        d.name AS department_name
      FROM course_registration_items cri
      JOIN course_registration_batches b ON b.id = cri.batch_id
      JOIN students s ON s.student_id = b.student_id
      JOIN programmes p ON p.id = s.programme_id
      JOIN departments d ON d.id = p.department_id
      WHERE cri.course_id = $1
        AND b.semester_id = $2
        AND b.status != 'DRAFT'
      ORDER BY 
        CASE WHEN cri.status = 'PENDING_LECTURER' THEN 1 ELSE 2 END ASC,
        cri.created_at ASC
    `;

    const { rows } = await pool.query(query, [courseId, targetSemesterId]);

    const pendingCount = rows.filter(r => r.status === 'PENDING_LECTURER').length;
    const approvedCount = rows.filter(r => r.status === 'APPROVED').length;
    const rejectedCount = rows.filter(r => r.status === 'REJECTED').length;

    return res.status(200).json({
      course: courseRes.rows[0],
      assignment,
      semesterId: targetSemesterId,
      counts: { pending: pendingCount, approved: approvedCount, rejected: rejectedCount, total: rows.length },
      registrations: rows,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/lecturer/courses/:courseId/registrations/:itemId/accept
 * Assigned lecturer accepts a student's course registration.
 * Creates/activates enrollment record and dispatches student notification.
 */
router.post('/courses/:courseId/registrations/:itemId/accept', async (req, res, next) => {
  const { courseId, itemId } = req.params;
  const lecturerId = req.lecturerScope.advisor_id;
  const { semesterId } = req.query;

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const targetSemesterId = semesterId || termRes.rows[0]?.id || '2026_RAIN';

    // 1. Strict Assigned Lecturer Check
    const assignment = await verifyAssignedCourseLecturer(courseId, lecturerId, targetSemesterId);
    if (!assignment) {
      return res.status(403).json({
        error: 'Access denied: Only primary or secondary lecturers officially assigned to this course can accept student registrations.',
        code: 'FORBIDDEN_NOT_ASSIGNED_LECTURER',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 2. Lock item row
      const itemRes = await client.query(
        `SELECT cri.id, cri.batch_id, cri.course_id, cri.units, cri.status,
                b.student_id, b.semester_id, b.status AS batch_status, c.code AS course_code, c.title AS course_title
         FROM course_registration_items cri
         JOIN course_registration_batches b ON b.id = cri.batch_id
         JOIN courses c ON c.course_id = cri.course_id
         WHERE cri.id = $1 AND cri.course_id = $2 AND b.semester_id = $3 AND b.status != 'DRAFT'
         FOR UPDATE`,
        [itemId, courseId, targetSemesterId]
      );

      if (itemRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Course registration item not found or batch is an unsubmitted draft', code: 'ITEM_NOT_FOUND' });
      }

      const item = itemRes.rows[0];

      // Validate acceptance transitions: reject already approved or rejected items
      if (item.status === 'APPROVED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Course registration item has already been approved', code: 'ALREADY_APPROVED' });
      }
      if (item.status === 'REJECTED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Cannot accept a previously rejected course registration item', code: 'INVALID_STATUS_TRANSITION' });
      }

      // 3. Mark as APPROVED by lecturer
      await client.query(
        `UPDATE course_registration_items 
         SET status = 'APPROVED', approved_by = $1, approved_at = NOW(), rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL
         WHERE id = $2`,
        [lecturerId, itemId]
      );

      // 4. Upsert into enrollments
      await client.query(
        `INSERT INTO enrollments (student_id, course_id, course_code, semester_id, status, approved_by_lecturer_id, enrolled_at)
         VALUES ($1, $2, $3, $4, 'ENROLLED', $5, NOW())
         ON CONFLICT (student_id, course_id, semester_id)
         DO UPDATE SET status = 'ENROLLED', approved_by_lecturer_id = EXCLUDED.approved_by_lecturer_id, enrolled_at = NOW()`,
        [item.student_id, item.course_id, item.course_code, item.semester_id, lecturerId]
      );

      // 5. Enqueue Outbox Event for Moodle Sync (re-arms to PENDING if previously existing)
      await client.query(
        `INSERT INTO integration_outbox_events (aggregate_type, aggregate_id, event_type, payload, idempotency_key)
         VALUES ('COURSE_REGISTRATION', $1, 'ENROLLMENT_SYNC', $2, $3)
         ON CONFLICT (idempotency_key) 
         DO UPDATE SET status = 'PENDING', locked_until = NULL, last_error = NULL, updated_at = NOW()`,
        [
          item.batch_id,
          JSON.stringify({ student_id: item.student_id, course_id: item.course_id, course_code: item.course_code, semester_id: item.semester_id }),
          `moodle_sync:${item.student_id}:${item.course_id}:${item.semester_id}`
        ]
      );

      await client.query('COMMIT');

      // 6. Post-commit Notification to Student
      createNotification({
        studentId: item.student_id,
        category: 'REGISTRATION',
        priority: 'HIGH',
        title: `Registration Accepted: ${item.course_code}`,
        body: `Your course registration for ${item.course_code} (${item.course_title}) has been approved by your course lecturer (${assignment.full_name}). Official enrollment is active.`,
        actionUrl: '/registration',
        metadata: { courseId: item.course_id, status: 'APPROVED', approvedBy: lecturerId },
      }).catch((e) => logger.warn({ err: e?.message }, '[LecturerRegistration] Failed to notify student'));

      return res.status(200).json({
        status: 'SUCCESS',
        message: `Successfully accepted registration for ${item.course_code}`,
        itemId,
        courseId,
        studentId: item.student_id,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/lecturer/courses/:courseId/registrations/:itemId/reject
 * Assigned lecturer rejects a student's course registration.
 * Releases seat capacity and notifies the student with the reason.
 */
router.post('/courses/:courseId/registrations/:itemId/reject', async (req, res, next) => {
  const { courseId, itemId } = req.params;
  const lecturerId = req.lecturerScope.advisor_id;
  const { reason } = req.body || {};
  const { semesterId } = req.query;

  if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
    return res.status(400).json({
      error: 'A descriptive rejection reason (minimum 3 characters) is required',
      code: 'REJECTION_REASON_REQUIRED',
    });
  }

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const targetSemesterId = semesterId || termRes.rows[0]?.id || '2026_RAIN';

    // 1. Strict Assigned Lecturer Check
    const assignment = await verifyAssignedCourseLecturer(courseId, lecturerId, targetSemesterId);
    if (!assignment) {
      return res.status(403).json({
        error: 'Access denied: Only primary or secondary lecturers officially assigned to this course can reject student registrations.',
        code: 'FORBIDDEN_NOT_ASSIGNED_LECTURER',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 2. Lock item row
      const itemRes = await client.query(
        `SELECT cri.id, cri.batch_id, cri.course_id, cri.units, cri.status,
                b.student_id, b.semester_id, b.status AS batch_status, c.code AS course_code, c.title AS course_title
         FROM course_registration_items cri
         JOIN course_registration_batches b ON b.id = cri.batch_id
         JOIN courses c ON c.course_id = cri.course_id
         WHERE cri.id = $1 AND cri.course_id = $2 AND b.semester_id = $3 AND b.status != 'DRAFT'
         FOR UPDATE`,
        [itemId, courseId, targetSemesterId]
      );

      if (itemRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Course registration item not found or batch is an unsubmitted draft', code: 'ITEM_NOT_FOUND' });
      }

      const item = itemRes.rows[0];

      // Validate rejection: only reject items that are not already rejected
      if (item.status === 'REJECTED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Course registration item has already been rejected', code: 'ALREADY_REJECTED' });
      }

      // 3. Mark as REJECTED
      await client.query(
        `UPDATE course_registration_items 
         SET status = 'REJECTED', rejected_by = $1, rejected_at = NOW(), rejection_reason = $2, approved_by = NULL, approved_at = NULL
         WHERE id = $3`,
        [lecturerId, reason.trim(), itemId]
      );

      // 4. Safely decrement course enrolled_count
      await client.query(
        `UPDATE courses SET enrolled_count = GREATEST(0, enrolled_count - 1) WHERE course_id = $1`,
        [item.course_id]
      );

      // 5. Remove any tentative enrollment row
      await client.query(
        `DELETE FROM enrollments WHERE student_id = $1 AND course_id = $2 AND semester_id = $3`,
        [item.student_id, item.course_id, item.semester_id]
      );

      // 5b. Purge any pending ENROLLMENT_SYNC outbox event to prevent post-rejection upstream sync
      await client.query(
        `DELETE FROM integration_outbox_events 
         WHERE aggregate_type = 'COURSE_REGISTRATION'
           AND event_type = 'ENROLLMENT_SYNC'
           AND idempotency_key = $1
           AND status = 'PENDING'`,
        [`moodle_sync:${item.student_id}:${item.course_id}:${item.semester_id}`]
      );

      await client.query('COMMIT');

      // 6. Post-commit Notification to Student
      createNotification({
        studentId: item.student_id,
        category: 'REGISTRATION',
        priority: 'URGENT',
        title: `Registration Declined: ${item.course_code}`,
        body: `Your course registration for ${item.course_code} (${item.course_title}) was rejected by course lecturer (${assignment.full_name}). Reason: "${reason.trim()}".`,
        actionUrl: '/registration',
        metadata: { courseId: item.course_id, status: 'REJECTED', reason: reason.trim(), rejectedBy: lecturerId },
      }).catch((e) => logger.warn({ err: e?.message }, '[LecturerRegistration] Failed to notify student'));

      return res.status(200).json({
        status: 'SUCCESS',
        message: `Successfully rejected registration for ${item.course_code}`,
        itemId,
        courseId,
        studentId: item.student_id,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/lecturer/courses/:courseId/registrations/batch-accept
 * Bulk accept pending registrations for an assigned course.
 */
router.post('/courses/:courseId/registrations/batch-accept', async (req, res, next) => {
  const { courseId } = req.params;
  const lecturerId = req.lecturerScope.advisor_id;
  const { itemIds } = req.body || {};
  const { semesterId } = req.query;

  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return res.status(400).json({ error: 'itemIds array is required', code: 'INVALID_PAYLOAD' });
  }

  try {
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    const targetSemesterId = semesterId || termRes.rows[0]?.id || '2026_RAIN';

    const assignment = await verifyAssignedCourseLecturer(courseId, lecturerId, targetSemesterId);
    if (!assignment) {
      return res.status(403).json({
        error: 'Access denied: Only primary or secondary lecturers officially assigned to this course can accept student registrations.',
        code: 'FORBIDDEN_NOT_ASSIGNED_LECTURER',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const itemsRes = await client.query(
        `SELECT cri.id, cri.batch_id, cri.course_id, b.student_id, b.semester_id, c.code AS course_code, c.title AS course_title
         FROM course_registration_items cri
         JOIN course_registration_batches b ON b.id = cri.batch_id
         JOIN courses c ON c.course_id = cri.course_id
         WHERE cri.id = ANY($1::uuid[]) 
           AND cri.course_id = $2 
           AND b.semester_id = $3
           AND b.status != 'DRAFT'
           AND cri.status = 'PENDING_LECTURER'
         ORDER BY cri.id ASC
         FOR UPDATE`,
        [itemIds, courseId, targetSemesterId]
      );

      if (itemsRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'No pending registration items found for acceptance',
          code: 'NO_PENDING_REGISTRATIONS',
        });
      }

      for (const item of itemsRes.rows) {
        await client.query(
          `UPDATE course_registration_items 
           SET status = 'APPROVED', approved_by = $1, approved_at = NOW(), rejected_by = NULL, rejected_at = NULL, rejection_reason = NULL
           WHERE id = $2`,
          [lecturerId, item.id]
        );

        await client.query(
          `INSERT INTO enrollments (student_id, course_id, course_code, semester_id, status, approved_by_lecturer_id, enrolled_at)
           VALUES ($1, $2, $3, $4, 'ENROLLED', $5, NOW())
           ON CONFLICT (student_id, course_id, semester_id)
           DO UPDATE SET status = 'ENROLLED', approved_by_lecturer_id = EXCLUDED.approved_by_lecturer_id, enrolled_at = NOW()`,
          [item.student_id, item.course_id, item.course_code, item.semester_id, lecturerId]
        );

        await client.query(
          `INSERT INTO integration_outbox_events (aggregate_type, aggregate_id, event_type, payload, idempotency_key)
           VALUES ('COURSE_REGISTRATION', $1, 'ENROLLMENT_SYNC', $2, $3)
           ON CONFLICT (idempotency_key) 
           DO UPDATE SET status = 'PENDING', locked_until = NULL, last_error = NULL, updated_at = NOW()`,
          [
            item.batch_id,
            JSON.stringify({ student_id: item.student_id, course_id: item.course_id, course_code: item.course_code, semester_id: item.semester_id }),
            `moodle_sync:${item.student_id}:${item.course_id}:${item.semester_id}`
          ]
        );
      }

      await client.query('COMMIT');

      // Post-commit notify
      for (const item of itemsRes.rows) {
        createNotification({
          studentId: item.student_id,
          category: 'REGISTRATION',
          priority: 'HIGH',
          title: `Registration Accepted: ${item.course_code}`,
          body: `Your course registration for ${item.course_code} (${item.course_title}) has been approved by your course lecturer (${assignment.full_name}).`,
          actionUrl: '/registration',
          metadata: { courseId: item.course_id, status: 'APPROVED', approvedBy: lecturerId },
        }).catch(() => {});
      }

      return res.status(200).json({
        status: 'SUCCESS',
        acceptedCount: itemsRes.rows.length,
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    next(err);
  }
});

export default router;

