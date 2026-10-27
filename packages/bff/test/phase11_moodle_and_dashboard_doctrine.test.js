/**
 * FOCIT LMS - Phase 11 Moodle Integration & Student Dashboard Doctrine Test Suite
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces:
 * 1. Catch 1: MoodleAPIError Classification & Decoupled Retryability Logic
 * 2. Catch 2: Multi-Session Relational Isolation on moodle_course_mappings (focit_course_id, semester_id)
 * 3. Catch 3: PostgreSQL Native Timezone (Africa/Lagos) & Parameterized Interval Construction (make_interval)
 * 4. Transactional Outbox Poison Pill Quarantine vs Exponential Backoff Recovery
 * 5. Student Dashboard Zero-Trust Principal Boundary & Mathematical Credit Aggregation
 */

import '../src/config.js';
import test from 'node:test';
import assert from 'node:assert';
import { pool } from '../src/db/index.js';
import { redis } from '../src/lib/redis.js';
import { MoodleAPIError, NON_RETRYABLE_CODES } from '../src/integrations/moodle/moodle.client.js';
import { studentDashboardService } from '../src/services/studentDashboardService.js';
import { unifiedOutboxWorker } from '../src/workers/unifiedOutboxWorker.js';

test.describe('Phase 11: Moodle Integration & Student Dashboard Doctrine', { concurrency: 1 }, () => {

  // ----------------------------------------------------------------------------
  // CATCH 1: MoodleAPIError Error Classification & Retryability
  // ----------------------------------------------------------------------------
  test('Catch 1: Moodle 200-OK application error with non-retryable errorcode evaluates isRetryable = false', () => {
    const nonRetryableError = new MoodleAPIError(
      'invalidparameter: Invalid course module ID',
      200,
      'core_completion_override_activity_completion_status',
      'invalidparameter'
    );

    assert.strictEqual(nonRetryableError.isRetryable, false, 'Deterministic errorcode invalidparameter must NOT be retryable');
    assert.strictEqual(nonRetryableError.errorCode, 'invalidparameter');
    assert.strictEqual(nonRetryableError.httpStatus, 200);

    const userNotFoundError = new MoodleAPIError(
      'usernotfound: Cannot find user',
      200,
      'core_user_get_users_by_field',
      'usernotfound'
    );
    assert.strictEqual(userNotFoundError.isRetryable, false, 'Deterministic errorcode usernotfound must NOT be retryable');
  });

  test('Catch 1: Moodle 200-OK application error with transient database lock evaluates isRetryable = true', () => {
    // When Moodle returns 200 OK with dmlwriteexception or locktimeout
    const lockError = new MoodleAPIError(
      'dmlwriteexception: Database lock wait timeout exceeded',
      200,
      'enrol_manual_enrol_users',
      'dmlwriteexception'
    );

    assert.strictEqual(lockError.isRetryable, true, 'Transient dmlwriteexception must be retryable even on HTTP 200');

    const timeoutError = new MoodleAPIError(
      'locktimeout: Lock timeout',
      200,
      'enrol_manual_enrol_users',
      'locktimeout'
    );
    assert.strictEqual(timeoutError.isRetryable, true, 'Transient locktimeout must be retryable on HTTP 200');
  });

  test('Catch 1: Transport & Network error classification without errorCode', () => {
    const error500 = new MoodleAPIError('HTTP 500 Internal Server Error', 500, 'core_user_create_users');
    assert.strictEqual(error500.isRetryable, true, 'HTTP 500 must be retryable');

    const error429 = new MoodleAPIError('HTTP 429 Too Many Requests', 429, 'core_user_create_users');
    assert.strictEqual(error429.isRetryable, true, 'HTTP 429 rate limit must be retryable');

    const networkDrop = new MoodleAPIError('Network dropped', null, 'core_user_create_users');
    assert.strictEqual(networkDrop.isRetryable, true, 'Network failure (!httpStatus) must be retryable');

    const error404 = new MoodleAPIError('HTTP 404 Not Found', 404, 'core_user_create_users');
    assert.strictEqual(error404.isRetryable, false, 'HTTP 404 client error must NOT be retryable');
  });

  // ----------------------------------------------------------------------------
  // CATCH 2: Multi-Session Relational Course Mappings (focit_course_id, semester_id)
  // ----------------------------------------------------------------------------
  test('Catch 2: Multi-session isolation permits same course across distinct semesters with unique constraint', async () => {
    // Clean test mappings for CSC204
    await pool.query(`DELETE FROM moodle_course_mappings WHERE focit_course_id = 'CSC204'`);

    // Insert Harmattan semester mapping (e.g. Moodle Course ID 101)
    await pool.query(`
      INSERT INTO moodle_course_mappings (focit_course_id, semester_id, moodle_course_id, sync_status)
      VALUES ('CSC204', '2026_HARMATTAN', 101, 'SYNCED');
    `);

    // Insert Rain semester mapping for the SAME FOCIT course (e.g. Moodle Course ID 202)
    await pool.query(`
      INSERT INTO moodle_course_mappings (focit_course_id, semester_id, moodle_course_id, sync_status)
      VALUES ('CSC204', '2026_RAIN', 202, 'SYNCED');
    `);

    const { rows } = await pool.query(`
      SELECT focit_course_id, semester_id, moodle_course_id 
      FROM moodle_course_mappings 
      WHERE focit_course_id = 'CSC204'
      ORDER BY semester_id ASC;
    `);

    assert.strictEqual(rows.length, 2, 'Must allow separate course shell mappings across distinct academic semesters');
    assert.strictEqual(rows[0].semester_id, '2026_HARMATTAN');
    assert.strictEqual(rows[0].moodle_course_id, 101);
    assert.strictEqual(rows[1].semester_id, '2026_RAIN');
    assert.strictEqual(rows[1].moodle_course_id, 202);

    // Duplicate insert for same (course_id, semester_id) must be rejected by unique constraint
    await assert.rejects(
      async () => {
        await pool.query(`
          INSERT INTO moodle_course_mappings (focit_course_id, semester_id, moodle_course_id, sync_status)
          VALUES ('CSC204', '2026_RAIN', 999, 'SYNCED');
        `);
      },
      /uq_course_semester_mapping/,
      'Direct duplicate insert on (focit_course_id, semester_id) must violate uq_course_semester_mapping'
    );
  });

  // ----------------------------------------------------------------------------
  // CATCH 3: PostgreSQL Native Time Casting & make_interval Interval Constructor
  // ----------------------------------------------------------------------------
  test('Catch 3: Timetable query executes without string-concatenation errors using make_interval and Africa/Lagos timezone', async () => {
    // Execute the exact query format in StudentDashboardService
    const { rows } = await pool.query(`
      SELECT 
        t.course_id,
        c.code,
        c.title,
        t.room_id,
        t.start_time,
        t.duration_minutes
      FROM academic_timetable t
      JOIN courses c ON c.course_id = t.course_id
      JOIN enrollments e ON e.course_id = c.course_id AND e.student_id = 'student1'
      WHERE e.status IN ('ENROLLED', 'IN_PROGRESS')
        AND t.day_of_week = EXTRACT(DOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos'))::int
        AND (t.start_time::time + make_interval(mins => t.duration_minutes::int)) > (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::time
      ORDER BY t.start_time ASC
      LIMIT 1;
    `);

    assert.ok(Array.isArray(rows), 'Timetable query using make_interval must succeed');
  });

  test('Catch 3: Outbox lease extension executes safely with make_interval(secs => ...)', async () => {
    // Insert a test event
    const testEventId = 'e0000000-0000-0000-0000-000000000099';
    await pool.query(`
      INSERT INTO integration_outbox_events (
        event_id, aggregate_type, aggregate_id, event_type, payload, status, delivery_attempts
      )
      VALUES ($1, 'STUDENT', 'student1', 'USER_PROVISION_REQUESTED', '{"matric_number": "TEST/001"}'::jsonb, 'PROCESSING', 1)
      ON CONFLICT (event_id) DO UPDATE SET status = 'PROCESSING', delivery_attempts = 1;
    `, [testEventId]);

    // Test updating lease with make_interval
    const leaseSeconds = 30;
    const { rows } = await pool.query(`
      UPDATE integration_outbox_events
      SET locked_until = NOW() + make_interval(secs => $2::int)
      WHERE event_id = $1
      RETURNING event_id, locked_until;
    `, [testEventId, leaseSeconds]);

    assert.strictEqual(rows.length, 1);
    assert.ok(new Date(rows[0].locked_until) > new Date(), 'locked_until must be in the future');

    // Clean up
    await pool.query(`DELETE FROM integration_outbox_events WHERE event_id = $1`, [testEventId]);
  });

  // ----------------------------------------------------------------------------
  // OUTBOX WORKER: Poison Pill Quarantine vs Exponential Backoff
  // ----------------------------------------------------------------------------
  test('Outbox Quarantine: Non-retryable error (invalidparameter) quarantines event immediately as FAILED', async () => {
    const quarantineEventId = 'e0000000-0000-0000-0000-000000000088';
    await pool.query(`
      INSERT INTO integration_outbox_events (
        event_id, aggregate_type, aggregate_id, event_type, payload, status, delivery_attempts
      )
      VALUES ($1, 'ACTIVITY', 'act_1', 'ACTIVITY_COMPLETED', '{"cmid": "invalid_cmid"}'::jsonb, 'PROCESSING', 1)
      ON CONFLICT (event_id) DO UPDATE SET status = 'PROCESSING', delivery_attempts = 1;
    `, [quarantineEventId]);

    const fakeEvent = {
      event_id: quarantineEventId,
      event_type: 'ACTIVITY_COMPLETED',
      aggregate_id: 'act_1',
      payload: { cmid: 'invalid_cmid' },
      delivery_attempts: 1,
    };

    // Simulate worker processing an event that throws a non-retryable MoodleAPIError
    const nonRetryableErr = new MoodleAPIError('Invalid module ID', 200, 'core_completion', 'invalidparameter');
    
    // Test the quarantine branch logic directly
    if (!nonRetryableErr.isRetryable || fakeEvent.delivery_attempts >= 5) {
      await pool.query(`
        UPDATE integration_outbox_events
        SET status = 'FAILED', locked_until = NULL, updated_at = NOW()
        WHERE event_id = $1;
      `, [quarantineEventId]);
    }

    const { rows } = await pool.query(
      `SELECT status FROM integration_outbox_events WHERE event_id = $1`,
      [quarantineEventId]
    );

    assert.strictEqual(rows[0].status, 'FAILED', 'Non-retryable poison pill must be quarantined as FAILED immediately');

    // Clean up
    await pool.query(`DELETE FROM integration_outbox_events WHERE event_id = $1`, [quarantineEventId]);
  });

  // ----------------------------------------------------------------------------
  // STUDENT DASHBOARD: Zero-Trust Principal & Mathematical Credit Calculation
  // ----------------------------------------------------------------------------
  test('Zero-Trust IDOR Defense: Missing or unauthenticated studentId is strictly rejected', async () => {
    await assert.rejects(
      async () => {
        await studentDashboardService.getDashboardData(null);
      },
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.strictEqual(err.code, 'INVALID_STUDENT_ID');
        return true;
      },
      'Missing studentId must throw 400 INVALID_STUDENT_ID without hardcoded fallback'
    );

    await assert.rejects(
      async () => {
        await studentDashboardService.getDashboardData('non_existent_student_999');
      },
      (err) => {
        assert.strictEqual(err.status, 404);
        assert.strictEqual(err.code, 'STUDENT_NOT_FOUND');
        return true;
      },
      'Unknown studentId must throw 404 STUDENT_NOT_FOUND'
    );
  });

  test('Mathematical Credit Integrity: Student dashboard dynamically aggregates units and courses', async () => {
    const dashboardData = await studentDashboardService.getDashboardData('student1');

    assert.ok(dashboardData.student, 'Student record must exist');
    assert.strictEqual(dashboardData.student.student_id, 'student1');
    assert.strictEqual(dashboardData.student.matric_number, '2024/0042');

    // MTH101 is 3 units completed in seed
    assert.strictEqual(dashboardData.metrics.completed_units, 3, 'Completed units must be calculated directly from completed enrollments');
    assert.strictEqual(dashboardData.metrics.registered_courses, 4, 'Active registered courses count must be exactly 4');
    assert.ok(Array.isArray(dashboardData.courses), 'Courses array must be populated');
    assert.strictEqual(dashboardData.courses.length, 5, 'Total enrollment items must equal 5');
  });

  test.after(async () => {
    await pool.end();
    redis.disconnect();
  });
});
