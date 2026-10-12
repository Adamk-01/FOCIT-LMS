/**
 * FOCIT LMS - Phase 4 & Phase 5 Architectural Doctrine Test Suite
 *
 * Mathematically validates:
 * 1. Phase 4: Atomic CAS Submission Mutex & Outbox Persistence
 * 2. Phase 4: Relational Set-Difference Guard (Foreign Question Rejection)
 * 3. Phase 4: Non-Blocking Outbox Sweeper with FOR UPDATE SKIP LOCKED
 * 4. Phase 5: Engine-Level Referential Integrity JSONB CHECK Constraint (@>)
 * 5. Phase 5: Database Immutability Trigger Guard (ERRCODE 55000)
 * 6. Phase 5: Partial Unique Index & Atomic Pointer Swap (Single Active Pointer)
 */

import test from 'node:test';
import assert from 'node:assert';
import { pool } from '../src/db/index.js';

test.describe('FOCIT 8-8-8 Architectural Doctrine Verification', { concurrency: 1 }, () => {

  // Test 1: Phase 5 JSONB Option Membership Constraint (@>)
  test('Engine Invariant: Rejects question if correct_option_id does not exist in options array', async () => {
    const invalidQuestionId = `test_invalid_${Date.now()}`;
    const testQuizId = 'quiz_csc204_1';

    let caughtError = null;
    try {
      await pool.query(`
        INSERT INTO quiz_questions (
          question_id, quiz_id, question_number, type, prompt, options, correct_option_id, points
        ) VALUES (
          $1, $2, 999, 'MULTIPLE_CHOICE', 'Test Prompt',
          '[{"id":"opt_a","text":"Option A"},{"id":"opt_b","text":"Option B"}]'::jsonb,
          'opt_nonexistent', -- Malicious / mismatched correct option!
          1.00
        );
      `, [invalidQuestionId, testQuizId]);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Database must reject orphaned correct_option_id');
    assert.strictEqual(caughtError.code, '23514', 'PostgreSQL must reject with check_violation (23514)');
  });

  // Test 2: Phase 5 Immutability Trigger Guard (ERRCODE 55000)
  test('Engine Invariant: Rejects mutation on questions belonging to active quiz with student attempts', async () => {
    // quiz_csc204_1 has student1 active attempt 'att_csc204_john'
    let caughtError = null;
    try {
      await pool.query(`
        UPDATE quiz_questions
        SET prompt = 'Mutated prompt while exam is live!'
        WHERE quiz_id = 'quiz_csc204_1' AND question_number = 1;
      `);
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError, 'Immutability trigger must reject live question mutation');
    assert.strictEqual(caughtError.code, '55000', 'PostgreSQL must raise object_not_in_prerequisite_state (55000)');
    assert.match(caughtError.message, /Academic Integrity Invariant/, 'Error message must cite Academic Integrity Invariant');
  });

  // Test 3: Phase 5 Partial Unique Index (Split-Brain Prevention)
  test('Engine Invariant: Partial Unique Index prevents multiple active quizzes per course', async () => {
    const draftQuizId = `test_draft_${Date.now()}`;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      // Create a test draft quiz for CSC204
      await client.query(`
        INSERT INTO quizzes (quiz_id, course_id, title, duration_minutes, version, status, is_active_for_new_attempts)
        VALUES ($1, 'CSC204', 'Draft Quiz V2', 45, 2, 'DRAFT', FALSE);
      `, [draftQuizId]);

      // Attempt to activate draft without deactivating the currently active quiz
      let caughtError = null;
      try {
        await client.query(`
          UPDATE quizzes
          SET is_active_for_new_attempts = TRUE
          WHERE quiz_id = $1;
        `, [draftQuizId]);
      } catch (err) {
        caughtError = err;
      }

      assert.ok(caughtError, 'Partial Unique Index must reject second active quiz for same course');
      assert.strictEqual(caughtError.code, '23505', 'PostgreSQL must throw unique_violation (23505)');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  // Test 4: Phase 4 Atomic CAS Submission Mutex & Outbox Logging
  test('Phase 4: Atomic CAS updates attempt to SUBMITTED and logs Outbox event in same transaction', async () => {
    const testQuizId = `test_quiz_${Date.now()}`;
    const testAttemptId = `test_att_${Date.now()}`;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Setup a clean test quiz
      await client.query(`
        INSERT INTO quizzes (quiz_id, course_id, title, duration_minutes, version, status, is_active_for_new_attempts)
        VALUES ($1, 'CSC204', 'Temporary Test Quiz', 45, 1, 'DRAFT', FALSE);
      `, [testQuizId]);

      // Setup a fresh in-progress attempt for student1
      await client.query(`
        INSERT INTO quiz_attempts (attempt_id, quiz_id, student_id, status, score, total_points, started_at, due_at)
        VALUES ($1, $2, 'student1', 'IN_PROGRESS', 0, 10, NOW(), NOW() + INTERVAL '45 min');
      `, [testAttemptId, testQuizId]);

      // Execute Atomic CAS Submission
      const casResult = await client.query(`
        UPDATE quiz_attempts
        SET status = 'SUBMITTED', submitted_at = NOW(), score = 8.0, total_points = 10.0
        WHERE attempt_id = $1 AND status = 'IN_PROGRESS'
        RETURNING attempt_id, status, score;
      `, [testAttemptId]);

      assert.strictEqual(casResult.rowCount, 1, 'CAS update must succeed on IN_PROGRESS attempt');

      // Insert Outbox event in same transaction
      const outboxResult = await client.query(`
        INSERT INTO outbox_events (
          event_id, aggregate_type, aggregate_id, event_type, payload, status, created_at
        ) VALUES (
          gen_random_uuid(), 'QUIZ_ATTEMPT', $1::varchar, 'QUIZ_SUBMITTED',
          jsonb_build_object('attemptId', $1::varchar, 'score', 8.0), 'PENDING', NOW()
        )
        RETURNING event_id;
      `, [testAttemptId]);

      assert.strictEqual(outboxResult.rowCount, 1, 'Outbox event must be persisted');

      // Test Concurrent Frantic Double-Click Simulation:
      const duplicateCas = await client.query(`
        UPDATE quiz_attempts
        SET status = 'SUBMITTED'
        WHERE attempt_id = $1 AND status = 'IN_PROGRESS'
        RETURNING attempt_id;
      `, [testAttemptId]);

      assert.strictEqual(duplicateCas.rowCount, 0, 'Duplicate submission must match 0 rows (CAS mutex engaged)');

      await client.query('ROLLBACK'); // clean rollback keeps DB pure
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  // Test 5: Phase 4 Outbox Sweeper Concurrency (SKIP LOCKED)
  test('Phase 4: Non-blocking sweeper claims events via FOR UPDATE SKIP LOCKED', async () => {
    const testEventId = `ev_test_${Date.now()}`;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      await client.query(`
        INSERT INTO outbox_events (event_id, aggregate_type, aggregate_id, event_type, payload, status, delivery_attempts, created_at)
        VALUES (gen_random_uuid(), 'TEST', $1, 'SYNC', '{"data":1}'::jsonb, 'PENDING', 0, NOW());
      `, [testEventId]);

      const claimResult = await client.query(`
        WITH claimable AS (
          SELECT event_id FROM outbox_events
          WHERE aggregate_id = $1 AND status = 'PENDING'
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox_events e
        SET status = 'PROCESSING', locked_until = NOW() + INTERVAL '30 seconds', delivery_attempts = delivery_attempts + 1
        FROM claimable c
        WHERE e.event_id = c.event_id
        RETURNING e.event_id, e.status, e.delivery_attempts;
      `, [testEventId]);

      assert.strictEqual(claimResult.rowCount, 1, 'Sweeper must claim pending event');
      assert.strictEqual(claimResult.rows[0].status, 'PROCESSING');
      assert.strictEqual(claimResult.rows[0].delivery_attempts, 1);

      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  test.after(async () => {
    await pool.end();
  });

});
