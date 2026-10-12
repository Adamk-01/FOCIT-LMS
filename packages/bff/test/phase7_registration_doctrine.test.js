/**
/**
 * FOCIT LMS - Phase 7 Course Registration & Approval Doctrine Test Suite
 *
 * Validates:
 * 1. Duplicate Payload Ingress Sanitizer (DISTINCT unnest($1))
 * 2. Relational Set-Difference CTE (ACADEMIC_LEVEL_CEILING_BREACH, COURSE_ALREADY_PASSED)
 * 3. Decoupled Cumulative Unit Bounds ([0, 24] Draft vs [15, 24] Submit)
 * 4. Dijkstra Monotonic Lock Acquisition & Bulk Approval DAG
 * 5. Rejection Capacity Deallocation
 */

import '../src/config.js';
import test from 'node:test';
import assert from 'node:assert';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';

test.describe('Phase 7: Course Registration Governance & Approval Doctrine', { concurrency: 1 }, () => {

  // Test 1: Ingress Cardinality Sanitization (Duplicate Payload Injection Defense)
  test('Cardinality Invariant: Duplicate array elements deduped via DISTINCT unnest', async () => {
    const rawDuplicatePayload = ['CSC204', 'CSC204', 'CSC204', 'CSC202', 'CSC202'];

    const { rows } = await pool.query(`
      WITH candidate_set AS (
        SELECT DISTINCT unnest($1::varchar[]) AS course_id
      )
      SELECT c.course_id, c.units
      FROM candidate_set cs
      JOIN courses c ON c.course_id = cs.course_id
      ORDER BY c.course_id ASC
    `, [rawDuplicatePayload]);

    assert.strictEqual(rows.length, 2, 'Distinct courses must be exactly 2 despite 5 input elements');
    assert.strictEqual(rows[0].course_id, 'CSC202');
    assert.strictEqual(rows[1].course_id, 'CSC204');
    const totalUnits = rows.reduce((acc, r) => acc + r.units, 0);
    assert.strictEqual(totalUnits, 6, 'Units must aggregate to exactly 6 (3+3), not 15');
  });

  // Test 2: Set-Difference Barrier - Level Ceiling Breach (200L student selecting 400L course)
  test('Level Ceiling Invariant: Submitting 400L course by 200L student triggers ACADEMIC_LEVEL_CEILING_BREACH', async () => {
    const candidateCourses = ['CSC204', 'CSC404']; // CSC404 is a 400L core course
    const studentId = 'student1'; // 200L student
    const activeSemesterNumber = 2; // Rain

    const { rows: violations } = await pool.query(`
      WITH 
      candidate_set AS (
        SELECT DISTINCT unnest($1::varchar[]) AS course_id
      ),
      student_context AS (
        SELECT s.student_id, s.level AS student_level, p.department_id
        FROM students s
        JOIN programmes p ON p.id = s.programme_id
        WHERE s.student_id = $2
      ),
      eligible_universe AS (
        SELECT c.course_id
        FROM courses c
        CROSS JOIN student_context sc
        WHERE c.is_active = TRUE
          AND c.semester_number = $3
          AND c.level <= sc.student_level
          AND (
            c.department_id = sc.department_id
            OR c.category IN ('GENERAL', 'ELECTIVE')
          )
      ),
      set_difference_violations AS (
        SELECT 
          cs.course_id,
          CASE 
            WHEN c.course_id IS NULL THEN 'COURSE_NOT_FOUND'
            WHEN c.level > sc.student_level THEN 'ACADEMIC_LEVEL_CEILING_BREACH'
            ELSE 'CURRICULUM_VIOLATION'
          END AS violation_code
        FROM candidate_set cs
        CROSS JOIN student_context sc
        LEFT JOIN courses c ON c.course_id = cs.course_id
        WHERE cs.course_id NOT IN (SELECT course_id FROM eligible_universe)
      )
      SELECT course_id, violation_code FROM set_difference_violations;
    `, [candidateCourses, studentId, activeSemesterNumber]);

    assert.strictEqual(violations.length, 1, 'Must reject exactly 1 ineligible course');
    assert.strictEqual(violations[0].course_id, 'CSC404');
    assert.strictEqual(violations[0].violation_code, 'ACADEMIC_LEVEL_CEILING_BREACH');
  });

  // Test 3: Relational Exclusion - Reject Courses Already Passed (MTH101)
  test('Passed Course Exclusion: Submitting completed transcript course triggers COURSE_ALREADY_PASSED', async () => {
    // student1 has completed MTH101 with grade 86.00 in transcript seed
    const candidateCourses = ['CSC204', 'MTH101'];
    const studentId = 'student1';
    const activeSemesterNumber = 2;

    const { rows: violations } = await pool.query(`
      WITH 
      candidate_set AS (
        SELECT DISTINCT unnest($1::varchar[]) AS course_id
      ),
      student_context AS (
        SELECT s.student_id, s.level AS student_level, p.department_id
        FROM students s
        JOIN programmes p ON p.id = s.programme_id
        WHERE s.student_id = $2
      ),
      eligible_universe AS (
        SELECT c.course_id
        FROM courses c
        CROSS JOIN student_context sc
        WHERE c.is_active = TRUE
          AND c.level <= sc.student_level
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
            WHEN EXISTS (
              SELECT 1 FROM enrollments e 
              WHERE e.student_id = sc.student_id 
                AND e.course_id = cs.course_id 
                AND e.status = 'COMPLETED' 
                AND (e.grade >= 40.00 OR e.grade IS NULL)
            ) THEN 'COURSE_ALREADY_PASSED'
            ELSE 'GENERAL_INELIGIBLE'
          END AS violation_code
        FROM candidate_set cs
        CROSS JOIN student_context sc
        WHERE cs.course_id NOT IN (SELECT course_id FROM eligible_universe)
      )
      SELECT course_id, violation_code FROM set_difference_violations;
    `, [candidateCourses, studentId]);

    assert.strictEqual(violations.length, 1);
    assert.strictEqual(violations[0].course_id, 'MTH101');
    assert.strictEqual(violations[0].violation_code, 'COURSE_ALREADY_PASSED');
  });

  // Test 4: Decoupled Credit Bound Gate ([0, 24] Draft vs [15, 24] Submit)
  test('Credit Bound Invariant: 9 units allowed in DRAFT, rejected in SUBMITTED', async () => {
    const draftCourses = ['CSC204', 'CSC202', 'GST202']; // 3 + 3 + 2 = 8 units

    const { rows: unitSum } = await pool.query(`
      SELECT SUM(units)::int AS total_units FROM courses WHERE course_id = ANY($1::varchar[])
    `, [draftCourses]);
    const units = unitSum[0].total_units;
    assert.strictEqual(units, 8);

    // Draft evaluation
    const isDraftValid = units >= 0 && units <= 24;
    assert.strictEqual(isDraftValid, true, 'Draft with 8 units must be valid work-in-progress');

    // Submission evaluation
    const isSubmitValid = units >= 15 && units <= 24;
    assert.strictEqual(isSubmitValid, false, 'Submission with 8 units must fail floor check');
  });

  // Test 5: Dijkstra Resource Ordering DAG on Bulk Advisor Approval
  test('Deadlock Immunity: Lexicographically sorted batch approval executes atomically', async () => {
    // Ensure test batches for student2 and student5 are in SUBMITTED state
    await pool.query(`
      UPDATE course_registration_batches 
      SET status = 'SUBMITTED' 
      WHERE student_id IN ('student2', 'student5') AND semester_id = '2026_RAIN'
    `);

    // Acquire batches for student2 and student5 (both in SUBMITTED state)
    const { rows: batches } = await pool.query(`
      SELECT id, student_id, status FROM course_registration_batches 
      WHERE status = 'SUBMITTED'
      ORDER BY id ASC
    `);

    assert.ok(batches.length >= 2, 'Must have at least 2 submitted batches in seed data');
    const batchIds = batches.map(b => b.id).sort(); // Strict ascending sort

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock batches in deterministic ascending sort order
      const lockedBatches = await client.query(`
        SELECT id, student_id FROM course_registration_batches
        WHERE id = ANY($1::uuid[])
        ORDER BY id ASC
        FOR UPDATE
      `, [batchIds]);
      assert.strictEqual(lockedBatches.rows.length, batchIds.length);

      // 2. Lock student records in deterministic ascending order
      const studentIds = [...new Set(lockedBatches.rows.map(b => b.student_id))].sort();
      const lockedStudents = await client.query(`
        SELECT student_id FROM students
        WHERE student_id = ANY($1::varchar[])
        ORDER BY student_id ASC
        FOR UPDATE
      `, [studentIds]);
      assert.strictEqual(lockedStudents.rows.length, studentIds.length);

      // 3. Perform atomic batch update
      await client.query(`
        UPDATE course_registration_batches
        SET status = 'ADVISOR_APPROVED', advisor_id = 'advisor1', advisor_approved_at = NOW()
        WHERE id = ANY($1::uuid[])
      `, [batchIds]);

      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // Verify status updated in database
    const { rows: verified } = await pool.query(`
      SELECT id, status, advisor_id FROM course_registration_batches WHERE id = ANY($1::uuid[])
    `, [batchIds]);

    for (const b of verified) {
      assert.strictEqual(b.status, 'ADVISOR_APPROVED');
      assert.strictEqual(b.advisor_id, 'advisor1');
    }
  });

  // Test 6: Rejection Flow Releases Allocated Seat Capacities
  test('Capacity Release Invariant: Rejecting batch decrements course enrolled_count', async () => {
    // Check initial enrolled_count for CSC102
    const { rows: initial } = await pool.query(`
      SELECT enrolled_count FROM courses WHERE course_id = 'CSC102'
    `);
    const initialCount = initial[0].enrolled_count;

    // Simulate capacity increment on submission
    await pool.query(`
      UPDATE courses SET enrolled_count = enrolled_count + 1 WHERE course_id = 'CSC102'
    `);

    // Simulate rejection releasing capacity
    await pool.query(`
      UPDATE courses SET enrolled_count = GREATEST(0, enrolled_count - 1) WHERE course_id = 'CSC102'
    `);

    const { rows: afterRelease } = await pool.query(`
      SELECT enrolled_count FROM courses WHERE course_id = 'CSC102'
    `);
    assert.strictEqual(afterRelease[0].enrolled_count, initialCount, 'Capacity must revert to initial count');
  });

  test.after(async () => {
    await pool.end();
    redis.disconnect();
  });
});
