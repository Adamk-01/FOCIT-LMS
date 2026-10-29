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
            AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
        ) AS verified_enrolled_students
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

    // 3. Query Enrolled Cohort
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
        e.grade
      FROM enrollments e
      JOIN students s ON s.student_id = e.student_id
      JOIN programmes p ON p.id = s.programme_id
      JOIN departments d ON d.id = p.department_id
      WHERE e.course_id = $1 
        AND e.semester_id = $2
        AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
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
       WHERE e.course_id = $1 AND e.semester_id = $2 AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
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

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${safeCode}_Official_Roster.csv"`);
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
});

export default router;
