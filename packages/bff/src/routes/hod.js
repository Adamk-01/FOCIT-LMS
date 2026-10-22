/**
 * FOCIT LMS - HOD Dashboard Routes
 * /api/hod/allocations, /api/hod/clearance/*, /api/hod/analytics
 *
 * Role scope resolved from staff_advisors (role = 'HOD') — never from client input.
 */
import { Router } from 'express';
import db from '../db/index.js';
import { recordIdentityAuditLog } from '../lib/auditLogger.js';
import { logger } from '../lib/logger.js';

const router = Router();

/** Resolves the caller's HOD record or 403s. Attaches req.hodScope. */
async function requireHod(req, res, next) {
  try {
    const { rows } = await db.query(
      `SELECT advisor_id, full_name, department_id
       FROM staff_advisors
       WHERE email = $1 AND role = 'HOD'
       LIMIT 1`,
      [req.user.email]
    );
    if (rows.length === 0) {
      return res.status(403).json({ error: 'HOD scope required', code: 'FORBIDDEN' });
    }
    req.hodScope = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

router.use(requireHod);

// ─── 1. Course Allocation Matrix ─────────────────────────────
router.get('/allocations', async (req, res, next) => {
  try {
    const { semesterId } = req.query;
    const { rows } = await db.query(
      `SELECT c.course_id, c.code, c.title, c.units, c.level,
              hca.id AS allocation_id, sa.advisor_id AS lecturer_id,
              sa.full_name AS lecturer_name, hca.updated_at
       FROM courses c
       LEFT JOIN hod_course_allocations hca
         ON hca.course_id = c.course_id
        AND hca.semester_id = $2
       LEFT JOIN staff_advisors sa ON sa.advisor_id = hca.lecturer_id
       WHERE c.department_id = $1 AND c.is_active = TRUE
       ORDER BY c.code`,
      [req.hodScope.department_id, semesterId || '']
    );
    res.json({ allocations: rows });
  } catch (err) { next(err); }
});

router.post('/allocations', async (req, res, next) => {
  const { courseId, semesterId, lecturerId } = req.body || {};
  if (!courseId || !semesterId || !lecturerId) {
    return res.status(422).json({ error: 'courseId, semesterId and lecturerId are required', code: 'VALIDATION_ERROR' });
  }
  try {
    const result = await db.transaction(async (client) => {
      const course = await client.query(
        `SELECT course_id FROM courses WHERE course_id = $1 AND department_id = $2`,
        [courseId, req.hodScope.department_id]
      );
      if (course.rowCount === 0) {
        const e = new Error('Course not found in your department'); e.status = 404; throw e;
      }
      const lecturer = await client.query(
        `SELECT advisor_id FROM staff_advisors
         WHERE advisor_id = $1 AND department_id = $2 AND role = 'LEVEL_ADVISOR'`,
        [lecturerId, req.hodScope.department_id]
      );
      if (lecturer.rowCount === 0) {
        const e = new Error('Lecturer not verified in your department'); e.status = 422; throw e;
      }
      const { rows } = await client.query(
        `INSERT INTO hod_course_allocations (course_id, semester_id, lecturer_id, allocated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (course_id, semester_id)
         DO UPDATE SET lecturer_id = EXCLUDED.lecturer_id,
                       allocated_by = EXCLUDED.allocated_by,
                       updated_at = NOW()
         RETURNING *`,
        [courseId, semesterId, lecturerId, req.hodScope.advisor_id]
      );
      await recordIdentityAuditLog(client, {
        eventType: 'HOD_COURSE_ALLOCATED',
        actorId: req.user.id,
        actorRole: 'HOD',
        targetId: courseId,
        targetType: 'COURSE_ALLOCATION',
        metadata: { semesterId, lecturerId },
      });
      return rows[0];
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

// ─── 2. Clearance Escalation Desk (overloads > 24 units) ─────
router.get('/clearance/escalations', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT crb.id AS batch_id, crb.student_id, s.full_name, s.matric_number,
              s.level, crb.total_units, crb.status, crb.semester_id,
              e.hod_remarks, e.status AS escalation_status
       FROM course_registration_batches crb
       JOIN students s ON s.student_id = crb.student_id
       JOIN programmes p ON p.id = s.programme_id
       LEFT JOIN hod_clearance_escalations e
         ON e.batch_id = crb.id AND e.status = 'ESCALATED'
       WHERE p.department_id = $1
         AND crb.total_units > 24
         AND crb.status IN ('SUBMITTED', 'ADVISOR_APPROVED')
       ORDER BY crb.total_units DESC
       LIMIT 200`,
      [req.hodScope.department_id]
    );
    res.json({ escalations: rows });
  } catch (err) { next(err); }
});

router.post('/clearance/override', async (req, res, next) => {
  const { batchId, decision, remarks } = req.body || {};
  if (!batchId || !['HOD_CLEARED', 'REJECTED'].includes(decision) || !remarks || remarks.length < 5) {
    return res.status(422).json({ error: 'batchId, decision (HOD_CLEARED|REJECTED) and remarks required', code: 'VALIDATION_ERROR' });
  }
  try {
    const result = await db.transaction(async (client) => {
      const batch = await client.query(
        `SELECT crb.* FROM course_registration_batches crb
         JOIN students s ON s.student_id = crb.student_id
         JOIN programmes p ON p.id = s.programme_id
         WHERE crb.id = $1 AND p.department_id = $2
         FOR UPDATE`,
        [batchId, req.hodScope.department_id]
      );
      if (batch.rowCount === 0) {
        const e = new Error('Registration batch not found in your department'); e.status = 404; throw e;
      }
      const b = batch.rows[0];
      if (!['SUBMITTED', 'ADVISOR_APPROVED'].includes(b.status)) {
        const e = new Error(`Batch is in ${b.status} state and cannot be overridden`); e.status = 409; throw e;
      }

      const { rows } = await client.query(
        `UPDATE course_registration_batches
         SET status = $1, hod_id = $2, hod_cleared_at = NOW(),
             rejection_remarks = $3, rejected_by = $4, rejected_at = CASE WHEN $1 = 'REJECTED' THEN NOW() ELSE rejected_at END,
             version = version + 1, updated_at = NOW()
         WHERE id = $5 AND status = $6
         RETURNING id, status`,
        [decision, req.hodScope.advisor_id, remarks,
         decision === 'REJECTED' ? req.hodScope.advisor_id : null,
         batchId, b.status]
      );
      if (rows.length === 0) {
        const e = new Error('Concurrent modification: batch state changed'); e.status = 409; throw e;
      }

      await recordIdentityAuditLog(client, {
        eventType: `HOD_CLEARANCE_${decision}`,
        actorId: req.user.id,
        actorRole: 'HOD',
        targetId: batchId,
        targetType: 'REGISTRATION_BATCH',
        metadata: { previousStatus: b.status, remarks },
      });
      return rows[0];
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ─── 3. Cohort Analytics (GPA distribution + at-risk) ────────
router.get('/analytics', async (req, res, next) => {
  try {
    const { rows: dist } = await db.query(
      `SELECT s.level,
              COUNT(*) FILTER (WHERE s.current_gpa < 1.50) AS bucket_lt_1_5,
              COUNT(*) FILTER (WHERE s.current_gpa >= 1.50 AND s.current_gpa < 2.50) AS bucket_1_5_2_5,
              COUNT(*) FILTER (WHERE s.current_gpa >= 2.50 AND s.current_gpa < 3.50) AS bucket_2_5_3_5,
              COUNT(*) FILTER (WHERE s.current_gpa >= 3.50) AS bucket_gte_3_5
       FROM students s
       JOIN programmes p ON p.id = s.programme_id
       WHERE p.department_id = $1
       GROUP BY s.level ORDER BY s.level`,
      [req.hodScope.department_id]
    );
    const { rows: atRisk } = await db.query(
      `SELECT s.full_name, s.matric_number, s.level, s.current_gpa
       FROM students s JOIN programmes p ON p.id = s.programme_id
       WHERE p.department_id = $1 AND s.current_gpa < 1.50
       ORDER BY s.current_gpa ASC LIMIT 100`,
      [req.hodScope.department_id]
    );
    res.json({ gpaDistribution: dist, atRiskStudents: atRisk });
  } catch (err) { next(err); }
});

export default router;
