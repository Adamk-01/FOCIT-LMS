/**
 * FOCIT LMS - Phase 12 Course Rep Ingestion Doctrine Test Suite
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces:
 * 1. Catch 1: Quarantined FAILED Outbox Resurrection with Corrected Payload
 * 2. Catch 2: Authoritative upserted_students Identity Propagation & Auth Credential Bootstrap
 * 3. Catch 3: Intra-Batch & DB-Level Collision Detection (Physical Hall & Cohort Core Curriculum)
 * 4. Zero-Trust Sanitization Boundary (Matriculation format, duplicate ingress, programme validation)
 */

import '../src/config.js';
import test from 'node:test';
import assert from 'node:assert';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';
import { ingestionService } from '../src/services/ingestionService.js';
import { verifyPassword } from '../src/lib/passwords.js';

test.describe('Phase 12: Course Rep Ingestion Doctrine', { concurrency: 1 }, () => {

  // ----------------------------------------------------------------------------
  // CATCH 1: Quarantined FAILED Outbox Resurrection
  // ----------------------------------------------------------------------------
  test('Catch 1 Invariant: Re-ingesting student resurrects FAILED outbox event with fresh payload and resets retry counter', async () => {
    const testMatric = 'FOCIT/2026/9001';
    const testStudentId = 'focit_2026_9001';
    const outboxIdempotencyKey = `moodle_provision:${testStudentId}`;

    // Clean any prior artifacts
    await pool.query(`DELETE FROM integration_outbox_events WHERE idempotency_key = $1`, [outboxIdempotencyKey]);
    await pool.query(`DELETE FROM student_profiles WHERE student_id = $1`, [testStudentId]);
    await pool.query(`DELETE FROM students WHERE student_id = $1`, [testStudentId]);

    // 1. Initial Ingestion: Student with poisoned/bad email
    const initialBatch = [
      {
        matric_number: testMatric,
        full_name: 'Adewale Badmus',
        email: 'adewale.badmus@wrong-domain.com',
        programme_id: 'BSC_CSC',
        level: 200,
      },
    ];

    const report1 = await ingestionService.ingestCohort(initialBatch);
    assert.strictEqual(report1.insertedCount, 1);
    assert.strictEqual(report1.outboxEnqueuedCount, 1);

    // 2. Simulate worker picking up event and quarantining it to FAILED (e.g. invalidparameter)
    await pool.query(`
      UPDATE integration_outbox_events
      SET 
        status = 'FAILED',
        delivery_attempts = 5,
        locked_until = NULL,
        last_error = 'invalidparameter: Institutional domain required'
      WHERE idempotency_key = $1;
    `, [outboxIdempotencyKey]);

    const { rows: failedRows } = await pool.query(
      `SELECT status, delivery_attempts, last_error, payload FROM integration_outbox_events WHERE idempotency_key = $1`,
      [outboxIdempotencyKey]
    );
    assert.strictEqual(failedRows[0].status, 'FAILED');
    assert.strictEqual(failedRows[0].delivery_attempts, 5);
    assert.strictEqual(failedRows[0].payload.email, 'adewale.badmus@wrong-domain.com');

    // 3. Re-Ingestion with Corrected Institutional Email
    const correctedBatch = [
      {
        matric_number: testMatric,
        full_name: 'Adewale Badmus',
        email: 'adewale.badmus@focit.uniosun.edu.ng', // Corrected
        programme_id: 'BSC_CSC',
        level: 200,
      },
    ];

    const report2 = await ingestionService.ingestCohort(correctedBatch);
    assert.strictEqual(report2.updatedCount, 1, 'Existing student must be updated');
    assert.strictEqual(report2.outboxEnqueuedCount, 1, 'FAILED outbox event must be resurrected');

    // 4. Assert Resurrection Invariants
    const { rows: resurrectedRows } = await pool.query(
      `SELECT status, delivery_attempts, locked_until, last_error, payload 
       FROM integration_outbox_events 
       WHERE idempotency_key = $1`,
      [outboxIdempotencyKey]
    );

    assert.strictEqual(resurrectedRows.length, 1);
    assert.strictEqual(resurrectedRows[0].status, 'PENDING', 'Outbox row must be transitioned back to PENDING');
    assert.strictEqual(resurrectedRows[0].delivery_attempts, 0, 'Delivery attempts must be reset to 0');
    assert.strictEqual(resurrectedRows[0].locked_until, null, 'Lock lease must be cleared');
    assert.strictEqual(resurrectedRows[0].last_error, null, 'Previous error must be wiped clean');
    assert.strictEqual(resurrectedRows[0].payload.email, 'adewale.badmus@focit.uniosun.edu.ng', 'Payload must reflect corrected data');

    // Clean up
    await pool.query(`DELETE FROM integration_outbox_events WHERE idempotency_key = $1`, [outboxIdempotencyKey]);
    await pool.query(`DELETE FROM student_profiles WHERE student_id = $1`, [testStudentId]);
    await pool.query(`DELETE FROM students WHERE student_id = $1`, [testStudentId]);
  });

  // ----------------------------------------------------------------------------
  // CATCH 2: Authoritative Identity & Auth Credential Bootstrap
  // ----------------------------------------------------------------------------
  test('Catch 2 Invariant: Re-ingestion binds to authoritative student_id and bootstraps student_profiles without clobbering existing passwords', async () => {
    // student1 already exists in seed with student_id = 'student1', matric_number = 'FOCIT/2024/0042'
    const { rows: existingProfile } = await pool.query(
      `SELECT password_hash FROM student_profiles WHERE student_id = 'student1'`
    );
    const originalPasswordHash = existingProfile[0]?.password_hash;

    // Re-ingest student1 using standard matric number
    const batchWithExisting = [
      {
        matric_number: 'FOCIT/2024/0042',
        full_name: 'John Doe Updated',
        programme_id: 'BSC_CSC',
        level: 200,
      },
    ];

    const report = await ingestionService.ingestCohort(batchWithExisting);
    assert.strictEqual(report.updatedCount, 1);

    // Verify existing password was NOT overwritten
    const { rows: postProfile } = await pool.query(
      `SELECT password_hash FROM student_profiles WHERE student_id = 'student1'`
    );
    assert.strictEqual(postProfile[0].password_hash, originalPasswordHash, 'Existing password hash must never be clobbered');

    // Ingest a brand new student and verify credentials bootstrap
    const newMatric = 'FOCIT/2026/8888';
    const newStudentId = 'focit_2026_8888';
    await pool.query(`DELETE FROM student_profiles WHERE student_id = $1`, [newStudentId]);
    await pool.query(`DELETE FROM students WHERE student_id = $1`, [newStudentId]);

    const newBatch = [
      {
        matric_number: newMatric,
        full_name: 'Kafayat Olayinka',
        programme_id: 'BSC_SEN',
        level: 100,
      },
    ];

    await ingestionService.ingestCohort(newBatch);

    const { rows: newProfileRows } = await pool.query(
      `SELECT password_hash, must_change_password FROM student_profiles WHERE student_id = $1`,
      [newStudentId]
    );

    assert.strictEqual(newProfileRows.length, 1, 'Brand new student must receive bootstrapped profile');
    assert.strictEqual(newProfileRows[0].must_change_password, true, 'must_change_password must be true for initial login');
    const isDefaultValid = await verifyPassword('Welcome@FOCIT2026', newProfileRows[0].password_hash);
    assert.strictEqual(isDefaultValid, true, 'Bootstrapped password hash must match default institutional credential');

    // Clean up
    await pool.query(`UPDATE students SET full_name = 'John Doe' WHERE student_id = 'student1'`);
    await pool.query(`DELETE FROM integration_outbox_events WHERE aggregate_id = $1`, [newStudentId]);
    await pool.query(`DELETE FROM student_profiles WHERE student_id = $1`, [newStudentId]);
    await pool.query(`DELETE FROM students WHERE student_id = $1`, [newStudentId]);
  });

  // ----------------------------------------------------------------------------
  // CATCH 3: Full-Spectrum Timetable Collision Detection
  // ----------------------------------------------------------------------------
  test('Catch 3 Invariant: Intra-batch physical room collision is rejected before database insertion', async () => {
    // Two classes in the same physical venue (Room 501) at overlapping hours
    const conflictingBatch = [
      {
        course_id: 'CSC202',
        room_id: 501,
        day_of_week: 1, // Monday
        start_time: '08:00:00',
        duration_minutes: 120, // 08:00 - 10:00
      },
      {
        course_id: 'CSC206',
        room_id: 501, // SAME ROOM
        day_of_week: 1, // SAME DAY
        start_time: '09:00:00', // OVERLAPS (09:00 - 11:00)
        duration_minutes: 120,
      },
    ];

    const result = await ingestionService.ingestTimetableSchedule(conflictingBatch);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'TIMETABLE_CLASH_DETECTED');
    assert.ok(result.clashes.some(c => c.violation_code === 'INTRA_BATCH_ROOM_CLASH'));
  });

  test('Catch 3 Invariant: Intra-batch cohort curriculum clash (two compulsory CORE courses) is rejected even in different rooms', async () => {
    // CSC 202 and CSC 204 are BOTH 200L CORE courses in Computer Science
    // Scheduled at the same time in DIFFERENT physical rooms (Room 501 vs Room 502)
    const cohortClashBatch = [
      {
        course_id: 'CSC202', // 200L CSC CORE
        room_id: 501,
        day_of_week: 2, // Tuesday
        start_time: '10:00:00',
        duration_minutes: 90, // 10:00 - 11:30
      },
      {
        course_id: 'CSC204', // 200L CSC CORE
        room_id: 502, // Different room!
        day_of_week: 2, // Same day
        start_time: '10:30:00', // OVERLAPS (10:30 - 12:00)
        duration_minutes: 90,
      },
    ];

    const result = await ingestionService.ingestTimetableSchedule(cohortClashBatch);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.code, 'TIMETABLE_CLASH_DETECTED');
    assert.ok(result.clashes.some(c => c.violation_code === 'INTRA_BATCH_COHORT_CLASH'));
  });

  test('Catch 3 Invariant: Valid non-conflicting schedule is accepted and GiST exclusion constraint guards against raw DB race conditions', async () => {
    const cleanBatch = [
      {
        course_id: 'CSC102',
        room_id: 601,
        day_of_week: 3, // Wednesday
        start_time: '08:00:00',
        duration_minutes: 60, // 08:00 - 09:00
      },
      {
        course_id: 'CSC102',
        room_id: 601,
        day_of_week: 3, // Wednesday
        start_time: '09:00:00', // Perfectly adjacent, non-overlapping
        duration_minutes: 60, // 09:00 - 10:00
      },
    ];

    const result = await ingestionService.ingestTimetableSchedule(cleanBatch);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.insertedCount, 2);

    // Direct DB insertion violating GiST exclusion constraint must throw 23P01 (exclusion_violation)
    await assert.rejects(
      async () => {
        await pool.query(`
          INSERT INTO academic_timetable (
            course_id, lecturer_id, room_id, first_occurrence_start, duration_minutes, rrule, day_of_week, start_time
          )
          VALUES ('CSC102', 1, 601, NOW(), 60, 'FREQ=WEEKLY', 3, '08:30:00'::time);
        `);
      },
      /uq_timetable_room_slot/,
      'Direct overlapping insert on room 601 must trigger GiST uq_timetable_room_slot constraint'
    );

    // Clean test timetable entries
    await pool.query(`DELETE FROM academic_timetable WHERE room_id = 601`);
  });

  // ----------------------------------------------------------------------------
  // ZERO-TRUST SANITIZATION BOUNDARY
  // ----------------------------------------------------------------------------
  test('Sanitization Boundary: Rejects invalid matriculation formats, invalid programmes, and duplicate rows within batch', () => {
    const malformedBatch = [
      {
        matric_number: 'NOT_A_MATRIC', // Invalid format
        full_name: 'Adebayo Tunde',
        programme_id: 'BSC_CSC',
        level: 200,
      },
      {
        matric_number: 'FOCIT/2024/0099',
        full_name: 'Bisi Akande',
        programme_id: 'BSC_UNKNOWN_PROGRAMME', // Invalid programme
        level: 200,
      },
      {
        matric_number: '2024/0050', // Valid loose format -> FOCIT/2024/0050
        full_name: 'Chioma Ajayi',
        programme_id: 'BSC_CSC',
        level: 999, // Invalid level
      },
      {
        matric_number: 'focit-2024-0077', // Valid loose format -> FOCIT/2024/0077
        full_name: 'Damilola Lawal',
        programme_id: 'BSC_CYS',
        level: 300,
      },
      {
        matric_number: 'FOCIT/2024/0077', // Duplicate of previous row!
        full_name: 'Duplicate Student',
        programme_id: 'BSC_CYS',
        level: 300,
      },
    ];

    const { validBatch, errors } = ingestionService.sanitizeStudentBatch(malformedBatch);

    assert.strictEqual(validBatch.length, 1, 'Only row 4 (Damilola Lawal) is fully valid');
    assert.strictEqual(validBatch[0].matric_number, 'FOCIT/2024/0077');
    assert.strictEqual(errors.length, 4, '4 rows must be quarantined with descriptive reasons');
    assert.ok(errors.some(e => e.reason.includes('Invalid matriculation number format')));
    assert.ok(errors.some(e => e.reason.includes('Invalid programme code')));
    assert.ok(errors.some(e => e.reason.includes('Invalid academic level')));
    assert.ok(errors.some(e => e.reason.includes('Duplicate matriculation number')));
  });

  test.after(async () => {
    await pool.end();
    redis.disconnect();
  });
});
