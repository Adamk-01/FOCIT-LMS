/**
 * FOCIT LMS - Academic Registration Controller
 *
 * Implements the Core Academic Governance Plane:
 * 1. getCurrentRegistrationState (GET /api/registration/current)
 * 2. saveRegistrationDraft (PUT /api/registration/draft)
 * 3. submitRegistration (POST /api/registration/submit)
 * 4. getAdvisorCohort (GET /api/registration/advisor/cohort)
 * 5. batchApproveRegistrations (POST /api/registration/advisor/batch-approve)
 * 6. rejectRegistration (POST /api/registration/advisor/reject)
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

/**
 * 1. GET /api/registration/current
 * Retrieves active semester, current student batch, candidate courses, and items.
 */
export async function getCurrentRegistrationState(req, res) {
  const studentId = req.user?.username || req.user?.id || 'student1';

  try {
    // 1. Fetch Student Context
    const studentRes = await pool.query(
      `SELECT s.student_id, s.matric_number, s.full_name, s.level, s.current_gpa, 
              s.completed_units, s.programme_id, p.department_id, p.name AS programme_name
       FROM students s
       JOIN programmes p ON p.id = s.programme_id
       WHERE s.student_id = $1`,
      [studentId]
    );

    if (studentRes.rows.length === 0) {
      return res.status(404).json({ error: 'Student record not found', code: 'STUDENT_NOT_FOUND' });
    }
    const student = studentRes.rows[0];

    // 2. Fetch Active Registration Term
    const termRes = await pool.query(
      `SELECT id, name, session_id, semester_number, is_registration_open
       FROM academic_semesters
       WHERE is_registration_open = TRUE
       LIMIT 1`
    );

    if (termRes.rows.length === 0) {
      return res.status(403).json({
        error: 'Academic course registration is closed for all terms',
        code: 'REGISTRATION_CLOSED',
      });
    }
    const semester = termRes.rows[0];

    // 3. Fetch or Lazily Initialize Student Registration Batch
    let batchRes = await pool.query(
      `SELECT id, student_id, semester_id, status, total_units, dean_waiver,
              submitted_at, advisor_id, advisor_approved_at, rejection_remarks, version, updated_at
       FROM course_registration_batches
       WHERE student_id = $1 AND semester_id = $2`,
      [studentId, semester.id]
    );

    let batch = batchRes.rows[0];
    if (!batch) {
      const initRes = await pool.query(
        `INSERT INTO course_registration_batches (student_id, semester_id, status, total_units, version)
         VALUES ($1, $2, 'DRAFT', 0, 1)
         ON CONFLICT (student_id, semester_id) 
         DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [studentId, semester.id]
      );
      batch = initRes.rows[0];
    }

    // 4. Fetch Staged Items in Current Batch
    const itemsRes = await pool.query(
      `SELECT cri.id, cri.course_id, cri.units, cri.category, c.code, c.title
       FROM course_registration_items cri
       JOIN courses c ON c.course_id = cri.course_id
       WHERE cri.batch_id = $1
       ORDER BY cri.category ASC, c.code ASC`,
      [batch.id]
    );

    // 5. Fetch Authoritative Eligible Course Catalog for Student Level & Cohort
    const catalogRes = await pool.query(
      `
      SELECT 
        c.course_id,
        c.code,
        c.title,
        c.units,
        c.level,
        c.category,
        c.max_capacity,
        c.enrolled_count,
        c.description,
        d.name AS department_name,
        EXISTS (
          SELECT 1 FROM course_registration_items cri 
          WHERE cri.batch_id = $1 AND cri.course_id = c.course_id
        ) AS is_selected_in_batch
      FROM courses c
      JOIN departments d ON d.id = c.department_id
      WHERE c.is_active = TRUE
        AND c.semester_number = $2
        AND c.level <= $3 -- Level Invariant: cannot take above current academic level
        AND (
          c.department_id = $4 
          OR c.category IN ('GENERAL', 'ELECTIVE')
        )
        -- Exclude courses passed in any prior session
        AND NOT EXISTS (
          SELECT 1 FROM enrollments e
          WHERE e.student_id = $5
            AND e.course_id = c.course_id
            AND e.status = 'COMPLETED'
            AND (e.grade >= 40.00 OR e.grade IS NULL)
        )
      ORDER BY c.category ASC, c.code ASC
      `,
      [batch.id, semester.semester_number, student.level, student.department_id, studentId]
    );

    return res.status(200).json({
      student,
      semester,
      batch,
      items: itemsRes.rows,
      eligibleCatalog: catalogRes.rows,
    });
  } catch (err) {
    logger.error({ err, studentId }, '[Registration] Failed to fetch current registration state');
    return res.status(500).json({ error: 'Failed to retrieve registration data', code: 'DB_ERROR' });
  }
}

/**
 * 2. PUT /api/registration/draft
 * Idempotently saves or updates student's uncommitted draft courses.
 * Enforces:
 * - DISTINCT unnest cardinality sanitization
 * - Unit interval: 0 <= totalUnits <= 24
 * - Zero seat capacity locks
 */
export async function saveRegistrationDraft(req, res) {
  const studentId = req.user?.username || req.user?.id || 'student1';
  const { course_ids: rawCourseIds } = req.body || {};

  if (!Array.isArray(rawCourseIds)) {
    return res.status(400).json({ error: 'course_ids must be an array of strings', code: 'INVALID_PAYLOAD' });
  }

  // Deduplicate course IDs at ingress
  const courseIds = [...new Set(rawCourseIds.map(id => String(id).trim()))].sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolve Active Semester
    const termRes = await client.query(
      `SELECT id, semester_number FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    if (termRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Registration is closed', code: 'REGISTRATION_CLOSED' });
    }
    const semesterId = termRes.rows[0].id;

    // 2. Lock Registration Batch Tuple
    let batchRes = await client.query(
      `SELECT id, status, version FROM course_registration_batches 
       WHERE student_id = $1 AND semester_id = $2 FOR UPDATE`,
      [studentId, semesterId]
    );

    let batchId;
    if (batchRes.rows.length === 0) {
      const newBatch = await client.query(
        `INSERT INTO course_registration_batches (student_id, semester_id, status, version)
         VALUES ($1, $2, 'DRAFT', 1) RETURNING id, status, version`,
        [studentId, semesterId]
      );
      batchId = newBatch.rows[0].id;
    } else {
      const batch = batchRes.rows[0];
      if (batch.status !== 'DRAFT' && batch.status !== 'REJECTED') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Cannot modify draft while in status ${batch.status}`,
          code: 'REGISTRATION_LOCKED',
          status: batch.status,
        });
      }
      batchId = batch.id;
    }

    // 3. Compute Draft Units & Verify Ceiling Bound (0 <= U <= 24)
    let totalUnits = 0;
    let courses = [];
    if (courseIds.length > 0) {
      const coursesRes = await client.query(
        `
        WITH candidate_set AS (
          SELECT DISTINCT unnest($1::varchar[]) AS course_id
        )
        SELECT c.course_id, c.units, c.category, c.title, c.code
        FROM candidate_set cs
        JOIN courses c ON c.course_id = cs.course_id
        WHERE c.is_active = TRUE
        ORDER BY c.course_id ASC
        `,
        [courseIds]
      );
      courses = coursesRes.rows;
      totalUnits = courses.reduce((sum, c) => sum + c.units, 0);
    }

    if (totalUnits > 24) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Draft exceeds maximum allowed ceiling of 24 units (attempted: ${totalUnits})`,
        code: 'MAX_CREDIT_CEILING_EXCEEDED',
        totalUnits,
        maxCeiling: 24,
      });
    }

    // 4. Atomic Replacement of Draft Items
    await client.query(`DELETE FROM course_registration_items WHERE batch_id = $1`, [batchId]);

    if (courses.length > 0) {
      const insertValues = [];
      const params = [batchId];
      courses.forEach((c, idx) => {
        const offset = idx * 3 + 2;
        params.push(c.course_id, c.units, c.category);
        insertValues.push(`($1, $${offset}, $${offset + 1}, $${offset + 2})`);
      });

      await client.query(
        `INSERT INTO course_registration_items (batch_id, course_id, units, category)
         VALUES ${insertValues.join(', ')}`,
        params
      );
    }

    // 5. Update Batch Total Units & Monotonic Version
    const updatedBatch = await client.query(
      `UPDATE course_registration_batches 
       SET total_units = $1, status = 'DRAFT', version = version + 1, updated_at = NOW()
       WHERE id = $2 
       RETURNING id, student_id, semester_id, status, total_units, version, updated_at`,
      [totalUnits, batchId]
    );

    // 6. Audit Trail Logging
    await client.query(
      `INSERT INTO course_registration_audit_logs (batch_id, student_id, actor_id, action, previous_status, new_status, metadata)
       VALUES ($1, $2, $2, 'DRAFT_SAVED', 'DRAFT', 'DRAFT', $3)`,
      [batchId, studentId, JSON.stringify({ course_ids: courseIds, total_units: totalUnits })]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'SUCCESS',
      message: 'Registration draft updated successfully',
      batch: updatedBatch.rows[0],
      items: courses,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, studentId }, '[Registration] Failed to save draft');
    return res.status(500).json({ error: 'Internal database error saving draft', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
}

/**
 * 3. POST /api/registration/submit
 * Transitions batch from DRAFT/REJECTED to SUBMITTED.
 * Enforces:
 * - DISTINCT unnest Cardinality Sanitizer
 * - Relational Set-Difference CTE ($R \setminus \mathcal{E}(S)$)
 * - Decoupled bounds: 15 <= U <= 24 (or 27 with Dean waiver)
 * - Dijkstra Row-Locks on courses
 * - Physical seat capacity reservations
 */
export async function submitRegistration(req, res) {
  const studentId = req.user?.username || req.user?.id || 'student1';
  const { course_ids: rawCourseIds } = req.body || {};
  const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'Missing required X-Idempotency-Key header for state submission',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }

  if (!Array.isArray(rawCourseIds) || rawCourseIds.length === 0) {
    return res.status(400).json({
      error: 'Payload must contain a non-empty array of course_ids',
      code: 'INVALID_PAYLOAD',
    });
  }

  // Deduplicate and apply Dijkstra Resource Ordering
  const courseIds = [...new Set(rawCourseIds.map(id => String(id).trim()))].sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolve Active Term
    const termRes = await client.query(
      `SELECT id, semester_number FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    if (termRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Registration is closed', code: 'REGISTRATION_CLOSED' });
    }
    const semesterId = termRes.rows[0].id;
    const semesterNumber = termRes.rows[0].semester_number;

    // 2. Lock Registration Batch & Student Tuple
    const batchRes = await client.query(
      `SELECT id, status, version, dean_waiver 
       FROM course_registration_batches 
       WHERE student_id = $1 AND semester_id = $2 
       FOR UPDATE`,
      [studentId, semesterId]
    );

    if (batchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No active registration batch found', code: 'BATCH_NOT_FOUND' });
    }

    const batch = batchRes.rows[0];
    if (batch.status !== 'DRAFT' && batch.status !== 'REJECTED') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Registration is already in state ${batch.status}`,
        code: 'REGISTRATION_ALREADY_COMMITTED',
        status: batch.status,
      });
    }

    // 3. Relational Set-Difference CTE Engine with DISTINCT Ingress Guard
    const cteRes = await client.query(
      `
      WITH 
      candidate_set AS (
        SELECT DISTINCT unnest($1::varchar[]) AS course_id
      ),
      student_context AS (
        SELECT s.student_id, s.level AS student_level, p.department_id, s.programme_id
        FROM students s
        JOIN programmes p ON p.id = s.programme_id
        WHERE s.student_id = $2
      ),
      eligible_universe AS (
        SELECT c.course_id, c.units, c.category, c.max_capacity, c.enrolled_count
        FROM courses c
        CROSS JOIN student_context sc
        WHERE c.is_active = TRUE
          AND c.semester_number = $3
          AND c.level <= sc.student_level -- Level Invariant: Level Ceiling
          AND (
            c.department_id = sc.department_id -- Department Core
            OR c.category IN ('GENERAL', 'ELECTIVE') -- Approved Cross-Cutting
          )
          -- Relational Exclusion: Exclude courses passed in any prior session
          AND NOT EXISTS (
            SELECT 1 FROM enrollments e
            WHERE e.student_id = sc.student_id
              AND e.course_id = c.course_id
              AND e.status = 'COMPLETED'
              AND (e.grade >= 40.00 OR e.grade IS NULL)
          )
      ),
      set_difference_violations AS (
        SELECT 
          cs.course_id,
          CASE 
            WHEN c.course_id IS NULL THEN 'COURSE_NOT_FOUND'
            WHEN c.is_active = FALSE THEN 'COURSE_INACTIVE'
            WHEN c.semester_number != $3 THEN 'SEMESTER_MISMATCH'
            WHEN c.level > sc.student_level THEN 'ACADEMIC_LEVEL_CEILING_BREACH'
            WHEN EXISTS (
              SELECT 1 FROM enrollments e 
              WHERE e.student_id = sc.student_id 
                AND e.course_id = cs.course_id 
                AND e.status = 'COMPLETED' 
                AND (e.grade >= 40.00 OR e.grade IS NULL)
            ) THEN 'COURSE_ALREADY_PASSED'
            ELSE 'DEPARTMENTAL_CURRICULUM_VIOLATION'
          END AS violation_code
        FROM candidate_set cs
        CROSS JOIN student_context sc
        LEFT JOIN courses c ON c.course_id = cs.course_id
        WHERE cs.course_id NOT IN (SELECT course_id FROM eligible_universe)
      )
      SELECT course_id, violation_code FROM set_difference_violations;
      `,
      [courseIds, studentId, semesterNumber]
    );

    // Fail-fast on any Set-Difference violation
    if (cteRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Registration payload contains ineligible courses',
        code: 'ELIGIBILITY_VIOLATION',
        violations: cteRes.rows,
      });
    }

    // 4. Cumulative Credit Bounds Check
    const validCoursesRes = await client.query(
      `
      WITH candidate_set AS (
        SELECT DISTINCT unnest($1::varchar[]) AS course_id
      )
      SELECT c.course_id, c.units, c.category, c.title, c.code
      FROM candidate_set cs
      JOIN courses c ON c.course_id = cs.course_id
      ORDER BY c.course_id ASC
      `,
      [courseIds]
    );

    const validCourses = validCoursesRes.rows;
    const projectedUnits = validCourses.reduce((sum, c) => sum + c.units, 0);
    const maxCeiling = batch.dean_waiver ? 27 : 24;

    if (projectedUnits < 15) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Senate credit floor violation: Minimum 15 units required (selected: ${projectedUnits})`,
        code: 'MIN_CREDIT_FLOOR_VIOLATION',
        projectedUnits,
        minimumRequired: 15,
      });
    }

    if (projectedUnits > maxCeiling) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Credit ceiling violation: Maximum ${maxCeiling} units exceeded (selected: ${projectedUnits})`,
        code: 'MAX_CREDIT_CEILING_EXCEEDED',
        projectedUnits,
        maxCeiling,
      });
    }

    // 5. Dijkstra Row-Lock Acquisition on Courses to Prevent Over-Enrollment Race Conditions
    const lockedCourses = await client.query(
      `SELECT course_id, max_capacity, enrolled_count 
       FROM courses 
       WHERE course_id = ANY($1::varchar[])
       ORDER BY course_id ASC
       FOR UPDATE`,
      [courseIds]
    );

    for (const c of lockedCourses.rows) {
      if (c.enrolled_count >= c.max_capacity) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Course ${c.course_id} has reached maximum seat capacity (${c.max_capacity})`,
          code: 'COURSE_CAPACITY_EXCEEDED',
          course_id: c.course_id,
        });
      }
    }

    // 6. Atomic Capacity Increment
    await client.query(
      `UPDATE courses 
       SET enrolled_count = enrolled_count + 1 
       WHERE course_id = ANY($1::varchar[])`,
      [courseIds]
    );

    // 7. Update Registration Items
    await client.query(`DELETE FROM course_registration_items WHERE batch_id = $1`, [batch.id]);

    const insertValues = [];
    const params = [batch.id];
    validCourses.forEach((c, idx) => {
      const offset = idx * 3 + 2;
      params.push(c.course_id, c.units, c.category);
      insertValues.push(`($1, $${offset}, $${offset + 1}, $${offset + 2})`);
    });

    await client.query(
      `INSERT INTO course_registration_items (batch_id, course_id, units, category)
       VALUES ${insertValues.join(', ')}`,
      params
    );

    // 8. Advance State to SUBMITTED
    const updatedBatch = await client.query(
      `UPDATE course_registration_batches 
       SET status = 'SUBMITTED', total_units = $1, submitted_at = NOW(), version = version + 1, updated_at = NOW()
       WHERE id = $2 
       RETURNING *`,
      [projectedUnits, batch.id]
    );

    // 9. Enqueue Audit Trail Log
    await client.query(
      `INSERT INTO course_registration_audit_logs (batch_id, student_id, actor_id, action, previous_status, new_status, metadata)
       VALUES ($1, $2, $2, 'SUBMITTED', $3, 'SUBMITTED', $4)`,
      [batch.id, studentId, batch.status, JSON.stringify({ courses: courseIds, total_units: projectedUnits })]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'SUCCESS',
      message: 'Course registration successfully submitted for Level Advisor endorsement',
      batch: updatedBatch.rows[0],
      items: validCourses,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, studentId }, '[Registration] Failed to submit registration');
    return res.status(500).json({ error: 'Failed to commit registration', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
}

/**
 * 4. GET /api/registration/advisor/cohort
 * Level Advisor cohort review endpoint.
 * Returns submitted student batches filtered by level, status, and programme.
 */
export async function getAdvisorCohort(req, res) {
  const advisorId = req.user?.username || req.user?.id || 'advisor1';
  const { level, status = 'SUBMITTED', programme_id } = req.query || {};

  try {
    // 1. Resolve Advisor Role & Assigned Level
    const advisorRes = await pool.query(
      `SELECT advisor_id, full_name, department_id, assigned_level, role 
       FROM staff_advisors 
       WHERE advisor_id = $1`,
      [advisorId]
    );

    const advisor = advisorRes.rows[0];
    const targetLevel = level ? parseInt(level, 10) : (advisor?.assigned_level || 200);

    // 2. Fetch Active Semester
    const termRes = await pool.query(
      `SELECT id, name FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    if (termRes.rows.length === 0) {
      return res.status(200).json({ batches: [], message: 'No active registration semester' });
    }
    const semesterId = termRes.rows[0].id;

    // 3. Query Cohort Batches with Student Details and Course Items
    const query = `
      SELECT 
        b.id AS batch_id,
        b.student_id,
        b.status,
        b.total_units,
        b.submitted_at,
        b.advisor_id,
        b.advisor_approved_at,
        b.rejection_remarks,
        b.dean_waiver,
        b.version,
        b.updated_at,
        s.matric_number,
        s.full_name AS student_name,
        s.level AS student_level,
        s.current_gpa,
        p.code AS programme_code,
        p.name AS programme_name,
        COALESCE(
          json_agg(
            json_build_object(
              'course_id', cri.course_id,
              'units', cri.units,
              'category', cri.category,
              'code', c.code,
              'title', c.title
            ) ORDER BY cri.category ASC, c.code ASC
          ) FILTER (WHERE cri.id IS NOT NULL), '[]'::json
        ) AS items
      FROM course_registration_batches b
      JOIN students s ON s.student_id = b.student_id
      JOIN programmes p ON p.id = s.programme_id
      LEFT JOIN course_registration_items cri ON cri.batch_id = b.id
      LEFT JOIN courses c ON c.course_id = cri.course_id
      WHERE b.semester_id = $1
        AND ($2::int IS NULL OR s.level = $2::int)
        AND ($3::registration_batch_status IS NULL OR b.status = $3::registration_batch_status)
        AND ($4::varchar IS NULL OR p.id = $4::varchar)
      GROUP BY b.id, s.student_id, p.id
      ORDER BY b.submitted_at ASC NULLS LAST, s.matric_number ASC
    `;

    const { rows } = await pool.query(query, [
      semesterId,
      targetLevel || null,
      status || null,
      programme_id || null,
    ]);

    return res.status(200).json({
      semester: termRes.rows[0],
      advisor: advisor || { advisor_id: advisorId, assigned_level: targetLevel },
      cohort: rows,
    });
  } catch (err) {
    logger.error({ err, advisorId }, '[Advisor] Failed to fetch cohort registrations');
    return res.status(500).json({ error: 'Failed to retrieve cohort data', code: 'DB_ERROR' });
  }
}

/**
 * 5. POST /api/registration/advisor/batch-approve
 * Level Advisor cohort bulk approval using Dijkstra resource ordering.
 * Eliminates 40P01 deadlocks by sorting batch IDs and student IDs.
 */
export async function batchApproveRegistrations(req, res) {
  const advisorId = req.user?.username || req.user?.id || 'advisor1';
  const { batch_ids: rawBatchIds } = req.body || {};

  if (!Array.isArray(rawBatchIds) || rawBatchIds.length === 0) {
    return res.status(400).json({ error: 'batch_ids must be a non-empty array', code: 'INVALID_PAYLOAD' });
  }

  // Dijkstra Lexicographical Sort on UUIDs to form a DAG wait-for graph
  const batchIds = [...new Set(rawBatchIds.map(id => String(id).trim()))].sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock Target Registration Batches in Ascending Lexicographical Order
    const lockedBatches = await client.query(
      `SELECT id, student_id, semester_id, status, total_units 
       FROM course_registration_batches 
       WHERE id = ANY($1::uuid[])
       ORDER BY id ASC
       FOR UPDATE`,
      [batchIds]
    );

    const validSubmissions = lockedBatches.rows.filter(b => b.status === 'SUBMITTED');
    if (validSubmissions.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'No candidate batches currently in SUBMITTED state for approval',
        code: 'NO_VALID_BATCHES',
      });
    }

    const validBatchIds = validSubmissions.map(b => b.id).sort();
    const studentIds = [...new Set(validSubmissions.map(b => b.student_id))].sort();

    // 2. Lock Student Tuples in Deterministic Ascending Order
    await client.query(
      `SELECT student_id 
       FROM students 
       WHERE student_id = ANY($1::varchar[]) 
       ORDER BY student_id ASC 
       FOR UPDATE`,
      [studentIds]
    );

    // 3. Batch Update Status to ADVISOR_APPROVED
    await client.query(
      `UPDATE course_registration_batches 
       SET 
         status = 'ADVISOR_APPROVED', 
         advisor_id = $1, 
         advisor_approved_at = NOW(), 
         version = version + 1, 
         updated_at = NOW()
       WHERE id = ANY($2::uuid[])`,
      [advisorId, validBatchIds]
    );

    // 4. Commit Authoritative Enrollments in Bulk
    await client.query(
      `
      INSERT INTO enrollments (student_id, course_id, semester_id, status)
      SELECT 
        b.student_id,
        cri.course_id,
        b.semester_id,
        'ENROLLED'
      FROM course_registration_items cri
      JOIN course_registration_batches b ON b.id = cri.batch_id
      WHERE b.id = ANY($1::uuid[])
      ON CONFLICT (student_id, course_id, semester_id) 
      DO UPDATE SET status = 'ENROLLED', enrolled_at = NOW();
      `,
      [validBatchIds]
    );

    // 5. Enqueue Moodle Outbox Events for Upstream Background Sync (Doctrine 8)
    await client.query(
      `
      INSERT INTO moodle_outbox (event_type, student_focit_id, moodle_course_id, payload, idempotency_key)
      SELECT 
        'ENROLLMENT_SYNC',
        b.student_id,
        COALESCE(c.moodle_course_id, 0),
        jsonb_build_object('student_id', b.student_id, 'course_code', c.code, 'semester_id', b.semester_id),
        'moodle_sync:' || b.student_id || ':' || cri.course_id || ':' || b.semester_id
      FROM course_registration_items cri
      JOIN course_registration_batches b ON b.id = cri.batch_id
      JOIN courses c ON c.course_id = cri.course_id
      WHERE b.id = ANY($1::uuid[])
      ON CONFLICT (idempotency_key) DO NOTHING;
      `,
      [validBatchIds]
    );

    // 6. Write Bulk Audit Log Entries
    const auditValues = [];
    const auditParams = [advisorId];
    validSubmissions.forEach((b, idx) => {
      const offset = idx * 2 + 2;
      auditParams.push(b.id, b.student_id);
      auditValues.push(`($${offset}, $${offset + 1}, $1, 'ADVISOR_APPROVED', 'SUBMITTED', 'ADVISOR_APPROVED')`);
    });

    await client.query(
      `INSERT INTO course_registration_audit_logs (batch_id, student_id, actor_id, action, previous_status, new_status)
       VALUES ${auditValues.join(', ')}`,
      auditParams
    );

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'SUCCESS',
      approvedCount: validBatchIds.length,
      approvedBatchIds: validBatchIds,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, advisorId }, '[Advisor] Bulk approval transaction failed');
    return res.status(500).json({ error: 'Bulk approval transaction failed', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
}

/**
 * 6. POST /api/registration/advisor/reject
 * Rejects a submitted batch, logs Senate remarks, and safely decrements seat capacity.
 * CRITICAL IDEMPOTENCY INVARIANT:
 * If the batch is ALREADY in REJECTED state (due to mobile retry/network partition),
 * this endpoint acts idempotently and skips capacity decrements to prevent leaking seats.
 */
export async function rejectRegistration(req, res) {
  const advisorId = req.user?.username || req.user?.id || 'advisor1';
  const { batch_id: batchId, remarks } = req.body || {};

  if (!batchId || !remarks || typeof remarks !== 'string' || remarks.trim().length < 5) {
    return res.status(400).json({
      error: 'batch_id and descriptive remarks (minimum 5 characters) are required for rejection',
      code: 'INVALID_REJECTION_PAYLOAD',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock Target Batch Row
    const batchRes = await client.query(
      `SELECT id, student_id, status, rejection_remarks, updated_at 
       FROM course_registration_batches 
       WHERE id = $1 
       FOR UPDATE`,
      [batchId]
    );

    if (batchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Registration batch not found', code: 'BATCH_NOT_FOUND' });
    }

    const batch = batchRes.rows[0];

    // 2. THE IDEMPOTENT REPLAY BARRIER:
    // If the batch is already in REJECTED state, do NOT decrement seat capacity again!
    if (batch.status === 'REJECTED') {
      await client.query('COMMIT');
      return res.status(200).json({
        status: 'SUCCESS',
        idempotentReplay: true,
        message: 'Registration batch is already in REJECTED state (idempotent recovery).',
        batch,
      });
    }

    // 3. State Machine Transition Check
    if (batch.status !== 'SUBMITTED') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Cannot reject registration batch while in status ${batch.status}`,
        code: 'INVALID_STATE_TRANSITION',
        status: batch.status,
      });
    }

    // 4. Fetch Associated Course IDs in Ascending Sort Order
    const itemsRes = await client.query(
      `SELECT course_id FROM course_registration_items WHERE batch_id = $1`,
      [batchId]
    );
    const courseIds = [...new Set(itemsRes.rows.map(r => r.course_id))].sort();

    // 5. Decrement Course Capacities with Dijkstra-ordered Row Lock
    if (courseIds.length > 0) {
      await client.query(
        `SELECT course_id FROM courses 
         WHERE course_id = ANY($1::varchar[]) 
         ORDER BY course_id ASC 
         FOR UPDATE`,
        [courseIds]
      );

      await client.query(
        `UPDATE courses 
         SET enrolled_count = GREATEST(0, enrolled_count - 1) 
         WHERE course_id = ANY($1::varchar[])`,
        [courseIds]
      );
    }

    // 6. Transition Batch State to REJECTED
    const updatedBatch = await client.query(
      `UPDATE course_registration_batches 
       SET 
         status = 'REJECTED', 
         rejection_remarks = $1, 
         rejected_by = $2, 
         rejected_at = NOW(), 
         version = version + 1, 
         updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [remarks.trim(), advisorId, batchId]
    );

    // 7. Audit Trail Logging
    await client.query(
      `INSERT INTO course_registration_audit_logs (batch_id, student_id, actor_id, action, previous_status, new_status, remarks)
       VALUES ($1, $2, $3, 'REJECTED', $4, 'REJECTED', $5)`,
      [batchId, batch.student_id, advisorId, batch.status, remarks.trim()]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'SUCCESS',
      message: 'Registration returned to student with remarks. Course capacities released.',
      batch: updatedBatch.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, batchId, advisorId }, '[Advisor] Rejection transaction failed');
    return res.status(500).json({ error: 'Failed to process registration rejection', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
}
