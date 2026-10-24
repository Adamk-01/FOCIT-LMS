/**
 * FOCIT LMS - End-to-End Moodle Integration & Outbox Pipeline Verification Script
 *
 * Demonstrates:
 * 1. Health probe against Moodle /health endpoint
 * 2. Atomic user creation & outbox event ingestion
 * 3. Course enrolment sync & outbox event ingestion
 * 4. UnifiedOutboxWorker batch sweep with FOR UPDATE SKIP LOCKED
 * 5. Deterministic Moodle REST Web Services dispatch
 * 6. Mapping persistence in moodle_user_mappings
 * 7. Clean lifecycle transition: PENDING -> PROCESSING -> COMPLETED
 */

import { pool } from '../db/index.js';
import { unifiedOutboxWorker } from '../workers/unifiedOutboxWorker.js';
import config from '../config.js';

async function runPipelineVerification() {
  console.log('\n======================================================');
  console.log('   FOCIT LMS: MOODLE INTEGRATION & OUTBOX PIPELINE   ');
  console.log('======================================================\n');

  // Step 1: Probe Moodle /health
  const healthUrl = `${config.moodle.baseUrl}/health`;
  console.log(`[1/5] Probing Moodle /health endpoint (${healthUrl})...`);
  try {
    const healthRes = await fetch(healthUrl);
    const healthData = await healthRes.json();
    console.log(`  ✔ Moodle Health Probe: HTTP ${healthRes.status} - Status: ${healthData.status} (v${healthData.version || '5.3'})`);
  } catch (err) {
    console.log(`  ⚠ Moodle server is not running or unreachable at ${config.moodle.baseUrl}: ${err.message}`);
    process.exit(1);
  }

  // Step 2: Create student in students table and enqueue transactional outbox event
  const testStudentId = 'student_pipeline_test_' + Date.now();
  const testUserEventId = 'b0000000-0000-0000-0000-' + String(Date.now()).slice(-12);
  const testEnrolEventId = 'c0000000-0000-0000-0000-' + String(Date.now() + 1).slice(-12);
  const testMatric = 'CSC/2026/TEST' + String(Date.now()).slice(-4);

  console.log(`\n[2/5] Enqueueing transactional outbox event (USER_PROVISION_REQUESTED)...`);
  console.log(`  Student: ${testStudentId} (${testMatric})`);

  // Create student identity record
  await pool.query(`
    INSERT INTO students (student_id, matric_number, username, full_name, email, programme_id, level, account_status)
    VALUES ($1, $2, $3, 'Pipeline Test Student', $4, 'BSC_CSC', 100, 'ACTIVE');
  `, [testStudentId, testMatric, testMatric, `${testStudentId}@focit.uniosun.edu.ng`]);

  // Enqueue user provision outbox event
  await pool.query(`
    INSERT INTO integration_outbox_events (
      event_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status
    )
    VALUES ($1, 'STUDENT', $2, 'USER_PROVISION_REQUESTED', $3, $4, 'PENDING');
  `, [
    testUserEventId,
    testStudentId,
    JSON.stringify({
      student_id: testStudentId,
      matric_number: testMatric,
      full_name: 'Pipeline Test Student',
      email: `${testStudentId}@focit.uniosun.edu.ng`,
    }),
    `moodle_provision:${testStudentId}`,
  ]);

  console.log('  ✔ Student record and provision event committed in PENDING state.');

  // Step 3: Trigger sweep for user provisioning
  console.log('\n[3/5] Triggering UnifiedOutboxWorker sweepBatch() for User Provisioning...');
  await unifiedOutboxWorker.sweepBatch();

  let userEventRes = await pool.query(
    `SELECT event_id, status FROM integration_outbox_events WHERE event_id = $1`,
    [testUserEventId]
  );
  for (let i = 0; i < 15 && userEventRes.rows[0]?.status === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 200));
    userEventRes = await pool.query(
      `SELECT event_id, status FROM integration_outbox_events WHERE event_id = $1`,
      [testUserEventId]
    );
  }
  console.log(`  ✔ Provision Outbox Event Status: ${userEventRes.rows[0]?.status}`);

  // Step 4: Enqueue ENROLLMENT_SYNC event for course CSC202
  console.log('\n[4/5] Enqueueing ENROLLMENT_SYNC outbox event for course CSC202...');
  await pool.query(`
    INSERT INTO integration_outbox_events (
      event_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key, status
    )
    VALUES ($1, 'COURSE_REGISTRATION', $2, 'ENROLLMENT_SYNC', $3, $4, 'PENDING');
  `, [
    testEnrolEventId,
    testStudentId,
    JSON.stringify({
      student_id: testStudentId,
      course_id: 'CSC202',
      course_code: 'CSC202',
      semester_id: '2026_RAIN',
    }),
    `moodle_sync:${testStudentId}:CSC202:2026_RAIN`,
  ]);

  console.log('  ✔ Enrolment outbox event committed in PENDING state.');

  // Trigger sweep for enrollment
  console.log('  Triggering UnifiedOutboxWorker sweepBatch() for Enrolment Sync...');
  await unifiedOutboxWorker.sweepBatch();

  let enrolEventRes = await pool.query(
    `SELECT event_id, status, last_error FROM integration_outbox_events WHERE event_id = $1`,
    [testEnrolEventId]
  );
  for (let i = 0; i < 15 && enrolEventRes.rows[0]?.status === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 200));
    enrolEventRes = await pool.query(
      `SELECT event_id, status, last_error FROM integration_outbox_events WHERE event_id = $1`,
      [testEnrolEventId]
    );
  }
  console.log(`  ✔ Enrolment Outbox Event Status: ${enrolEventRes.rows[0]?.status}`);

  // Step 5: Verification & Cleanup
  console.log('\n[5/5] Verifying pipeline state and cleaning up ephemeral data...');
  let hasFailed = false;

  const mappingRes = await pool.query(
    `SELECT focit_user_id, moodle_user_id, sync_status FROM moodle_user_mappings WHERE focit_user_id = $1`,
    [testStudentId]
  );

  if (userEventRes.rows[0]?.status !== 'COMPLETED') {
    console.error(`  ❌ Provision outbox event failed with status: ${userEventRes.rows[0]?.status}`);
    hasFailed = true;
  }

  if (enrolEventRes.rows[0]?.status !== 'COMPLETED') {
    console.error(`  ❌ Enrolment outbox event failed with status: ${enrolEventRes.rows[0]?.status}, error: ${enrolEventRes.rows[0]?.last_error}`);
    hasFailed = true;
  }

  if (mappingRes.rows.length > 0) {
    console.log(`  ✔ Moodle User Mapping confirmed: FOCIT=${mappingRes.rows[0].focit_user_id} -> Moodle=${mappingRes.rows[0].moodle_user_id}`);
  } else {
    console.error('  ❌ Moodle user mapping was not created.');
    hasFailed = true;
  }

  try {
    // Clean up ephemeral Moodle user
    if (mappingRes.rows.length > 0) {
      const moodleUserId = mappingRes.rows[0].moodle_user_id;
      try {
        const { callMoodleAPI } = await import('../integrations/moodle/moodle.client.js');
        await callMoodleAPI('core_user_delete_users', { userids: [moodleUserId] }, 'POST');
        console.log(`  ✔ Ephemeral Moodle test user (ID: ${moodleUserId}) purged from Moodle.`);
      } catch (wsErr) {
        console.warn(`  ⚠ Non-fatal: Ephemeral Moodle user could not be deleted from Moodle: ${wsErr.message}`);
      }
    }
    // Clean up database records
    await pool.query(`DELETE FROM moodle_user_mappings WHERE focit_user_id = $1`, [testStudentId]);
    await pool.query(`DELETE FROM integration_outbox_events WHERE event_id IN ($1, $2)`, [testUserEventId, testEnrolEventId]);
    await pool.query(`DELETE FROM students WHERE student_id = $1`, [testStudentId]);
    console.log('  ✔ Ephemeral pipeline test records cleaned up from database.');
  } catch (cleanupErr) {
    console.error('  ❌ Cleanup failed: Ephemeral test records could not be purged:', cleanupErr.message);
    hasFailed = true;
  }

  if (hasFailed) {
    console.error('\n======================================================');
    console.error('   PIPELINE VERIFICATION FAILED                       ');
    console.error('======================================================\n');
    process.exit(1);
  }

  console.log('\n======================================================');
  console.log('   FULL PIPELINE VERIFIED (PROVISION + ENROLMENT)     ');
  console.log('======================================================\n');
  process.exit(0);
}

runPipelineVerification().catch((err) => {
  console.error('Pipeline error:', err);
  process.exit(1);
});
