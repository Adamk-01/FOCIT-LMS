import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { pool } from '../src/db/index.js';
import quizzesRouter from '../src/routes/quizzes.js';

test('Phase 16: Quiz Ingress & Retake Doctrine Certification', async (t) => {
  const app = express();
  app.use(express.json());

  let mockUser = {
    username: 'student1',
    role: 'STUDENT',
  };

  app.use((req, res, next) => {
    req.user = mockUser;
    next();
  });

  app.use('/api/quizzes', quizzesRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const testStudentId = 'student1';
  const testQuizId = 'quiz_csc204_1';

  // Teardown hook
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query(
      "UPDATE quiz_attempts SET status = 'ABANDONED' WHERE student_id = $1 AND quiz_id = $2 AND status != 'ABANDONED'",
      [testStudentId, testQuizId]
    );
    await pool.end();
  });

  // Clean any previous test attempts for testStudentId on testQuizId
  await pool.query(
    "UPDATE quiz_attempts SET status = 'ABANDONED' WHERE student_id = $1 AND quiz_id = $2 AND status != 'ABANDONED'",
    [testStudentId, testQuizId]
  );

  await t.test('1. Atomic Ingress creates fresh attempt for enrolled student (HTTP 201)', async () => {
    mockUser = { username: testStudentId, role: 'STUDENT' };

    const res = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201, 'Must return 201 Created on fresh attempt');
    assert.ok(body.attempt?.id, 'Must return generated attempt ID');
    assert.strictEqual(body.attempt.status, 'IN_PROGRESS', 'Status must be IN_PROGRESS');
    assert.strictEqual(body.attempt.isNewRecord, true, 'isNewRecord must be true');
    assert.ok(body.questions?.length > 0, 'Must return shuffled questions');
  });

  await t.test('2. Idempotent Ingress returns active attempt without duplicate (HTTP 200, isNewRecord=false)', async () => {
    mockUser = { username: testStudentId, role: 'STUDENT' };

    const res = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200, 'Must return 200 OK on existing attempt');
    assert.strictEqual(body.attempt.status, 'IN_PROGRESS', 'Status must remain IN_PROGRESS');
    assert.strictEqual(body.attempt.isNewRecord, false, 'isNewRecord must be false');
  });

  await t.test('3. Server-Authoritative Lazy Expiration grades answers and inserts Outbox event on GET', async () => {
    mockUser = { username: testStudentId, role: 'STUDENT' };

    // A. Fetch current active attempt
    const activeRes = await pool.query(
      "SELECT attempt_id FROM quiz_attempts WHERE student_id = $1 AND quiz_id = $2 AND status = 'IN_PROGRESS'",
      [testStudentId, testQuizId]
    );
    const attemptId = activeRes.rows[0].attempt_id;

    // B. Save an answer for question 1 (q_csc204_1, correct answer is opt_c)
    await pool.query(
      `INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_option_id, updated_at)
       VALUES ($1, 'q_csc204_1', 'opt_c', NOW())
       ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected_option_id = EXCLUDED.selected_option_id`,
      [attemptId]
    );

    // C. Artificially back-date due_at to simulate power outage / elapsed clock
    await pool.query(
      "UPDATE quiz_attempts SET due_at = NOW() - INTERVAL '10 minutes' WHERE attempt_id = $1",
      [attemptId]
    );

    // D. Rehydration GET must trigger atomic lazy seal and auto-scoring
    const res = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts/${attemptId}`, {
      method: 'GET',
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(body.attempt.status, 'SUBMITTED', 'Must be sealed to SUBMITTED');
    assert.strictEqual(body.attempt.submissionMode, 'EXPIRED_AUTO_SUBMIT', 'Mode must be EXPIRED_AUTO_SUBMIT');
    assert.ok(body.attempt.score >= 1.0, 'Score must reflect correct answer opt_c');

    // E. Verify Outbox event was created in the SAME transaction
    const outboxCheck = await pool.query(
      "SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'QUIZ_SUBMITTED'",
      [attemptId]
    );
    assert.strictEqual(outboxCheck.rows.length, 1, 'Outbox event must exist for auto-sealed attempt');
  });

  await t.test('4. Infinite Retake Gate: Ingress returns sealed attempt instead of minting new one', async () => {
    mockUser = { username: testStudentId, role: 'STUDENT' };

    const res = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const body = await res.json();
    assert.strictEqual(res.status, 200, 'Must return 200 OK');
    assert.strictEqual(body.attempt.status, 'SUBMITTED', 'Must return sealed SUBMITTED attempt');
    assert.strictEqual(body.attempt.isNewRecord, false, 'Must not mint new attempt');
  });

  await t.test('5. Fenced Dev Reset marks attempt as ABANDONED and permits clean restart', async () => {
    mockUser = { username: 'lecturer1', role: 'LECTURER' };

    // Reset attempt
    const resetRes = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId: testStudentId }),
    });

    const resetBody = await resetRes.json();
    assert.strictEqual(resetRes.status, 200, 'Dev reset must succeed');
    assert.strictEqual(resetBody.reset, true);

    // Now Ingress for student must create a brand-new attempt (HTTP 201)
    mockUser = { username: testStudentId, role: 'STUDENT' };
    const newAttemptRes = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const newBody = await newAttemptRes.json();
    assert.strictEqual(newAttemptRes.status, 201, 'Must successfully mint fresh attempt after dev reset');
    assert.strictEqual(newBody.attempt.status, 'IN_PROGRESS');
    assert.strictEqual(newBody.attempt.isNewRecord, true);
  });

  await t.test('6. Non-enrolled student is rejected with HTTP 403', async () => {
    mockUser = { username: 'student5', role: 'STUDENT' }; // student5 is not in CSC204

    const res = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const body = await res.json();
    assert.strictEqual(res.status, 403, 'Must reject un-enrolled student');
    assert.strictEqual(body.code, 'NOT_ENROLLED_OR_INACTIVE');
  });

  await t.test('7. Anti-Cheat: Multi-Student HMAC Option Masking & Entropy Isolation', async () => {
    // Enroll student2 into CSC204 for multi-tenant isolation testing
    await pool.query(`
      INSERT INTO enrollments (enrollment_id, student_id, course_id, course_code, semester_id, status)
      VALUES (gen_random_uuid(), 'student2', 'CSC204', 'CSC 204', '2026_RAIN', 'ENROLLED')
      ON CONFLICT (student_id, course_id, semester_id) DO UPDATE SET status = 'ENROLLED'
    `);

    // Clean any prior attempts for student2
    await pool.query(
      "UPDATE quiz_attempts SET status = 'ABANDONED' WHERE student_id = 'student2' AND quiz_id = $1",
      [testQuizId]
    );

    // Student 1 starts attempt
    mockUser = { username: 'student1', role: 'STUDENT' };
    const res1 = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body1 = await res1.json();

    // Student 2 starts attempt
    mockUser = { username: 'student2', role: 'STUDENT' };
    const res2 = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const body2 = await res2.json();

    assert.notStrictEqual(body1.attempt.id, body2.attempt.id, 'Attempt IDs must be completely isolated');

    // Compare option IDs for the first question across students
    const q1Student1 = body1.questions[0];
    const q1Student2 = body2.questions.find((q) => q.id === q1Student1.id) || body2.questions[0];

    const optIdsStudent1 = q1Student1.options.map((o) => o.id);
    const optIdsStudent2 = q1Student2.options.map((o) => o.id);

    // Entropy Separation: Option IDs MUST NOT match across students even for the exact same question
    assert.notDeepStrictEqual(
      optIdsStudent1,
      optIdsStudent2,
      'Cryptographic HMAC option masking must generate unique keys per student attempt'
    );
  });

  await t.test('8. Anti-Cheat: Telemetry Ingestion, Anomaly Scoring & Proctor Review Escalation', async () => {
    mockUser = { username: 'student1', role: 'STUDENT' };

    const activeRes = await pool.query(
      "SELECT attempt_id FROM quiz_attempts WHERE student_id = 'student1' AND quiz_id = $1 AND status = 'IN_PROGRESS'",
      [testQuizId]
    );
    const attemptId = activeRes.rows[0].attempt_id;

    // Send suspicious proctoring events: tab switch (40s) + fullscreen exit + 3 clipboard copies
    const telemetryRes = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts/${attemptId}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          { type: 'TAB_HIDDEN', start_ms: Date.now() - 45000, duration_ms: 40000 },
          { type: 'FULLSCREEN_EXIT', start_ms: Date.now() - 4000, duration_ms: 0 },
          { type: 'CLIPBOARD_BLOCKED', start_ms: Date.now() - 2000, duration_ms: 0 },
          { type: 'CLIPBOARD_BLOCKED', start_ms: Date.now() - 1000, duration_ms: 0 },
          { type: 'CLIPBOARD_BLOCKED', start_ms: Date.now() - 500, duration_ms: 0 },
        ],
      }),
    });

    const telBody = await telemetryRes.json();
    assert.strictEqual(telemetryRes.status, 200);
    assert.ok(telBody.anomalyScore >= 35, `Anomaly score (${telBody.anomalyScore}) must cross suspicion threshold >= 35`);
    assert.strictEqual(
      telBody.proctorReviewStatus,
      'SUBMITTED_PENDING_REVIEW',
      'Attempt must be flagged for manual proctor review'
    );

    // Verify row in PostgreSQL reflects the escalated proctor review status
    const rowCheck = await pool.query(
      "SELECT anomaly_score, proctor_review_status FROM quiz_attempts WHERE attempt_id = $1",
      [attemptId]
    );
    assert.strictEqual(rowCheck.rows[0].proctor_review_status, 'SUBMITTED_PENDING_REVIEW');
    assert.ok(rowCheck.rows[0].anomaly_score >= 35);
  });

  await t.test('9. Anti-Cheat: Relational Set-Difference rejects foreign / poisoned question injection', async () => {
    mockUser = { username: 'student1', role: 'STUDENT' };

    const activeRes = await pool.query(
      "SELECT attempt_id FROM quiz_attempts WHERE student_id = 'student1' AND quiz_id = $1 AND status = 'IN_PROGRESS'",
      [testQuizId]
    );
    const attemptId = activeRes.rows[0].attempt_id;

    // Attacker tries to inject a question ID from another quiz or nonexistent bank
    const saveRes = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts/${attemptId}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: [{ questionId: 'poisoned_question_9999', optionId: 'opt_fake' }],
      }),
    });

    assert.strictEqual(saveRes.status, 422, 'Relational set-difference must reject foreign question with 422');
    const saveBody = await saveRes.json();
    assert.strictEqual(saveBody.code, 'ILLEGAL_QUESTION_PAYLOAD');
  });
  await t.test('10. Submission: Consolidated CTE grades attempt, records FULLSCREEN_VIOLATION mode and commits Outbox event', async () => {
    mockUser = { username: 'student1', role: 'STUDENT' };

    const activeRes = await pool.query(
      "SELECT attempt_id, allocation_seed FROM quiz_attempts WHERE student_id = 'student1' AND quiz_id = $1 AND status = 'IN_PROGRESS'",
      [testQuizId]
    );
    const attemptId = activeRes.rows[0].attempt_id;
    const allocationSeed = activeRes.rows[0].allocation_seed;

    // Get a valid question and its options
    const qRes = await pool.query(
      "SELECT question_id, options, correct_option_id FROM quiz_questions WHERE quiz_id = $1 ORDER BY question_id ASC LIMIT 1",
      [testQuizId]
    );
    const q1 = qRes.rows[0];

    // Derive masked option ID for correct answer
    const cryptoMod = await import('node:crypto');
    const hmac = cryptoMod.createHmac('sha256', allocationSeed);
    hmac.update(`${attemptId}:${q1.question_id}:${q1.correct_option_id}`);
    const maskedCorrectOptId = `opt_${hmac.digest('hex').slice(0, 16)}`;

    const submitRes = await fetch(`${baseUrl}/api/quizzes/${testQuizId}/attempts/${attemptId}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'test-sub-viol-key-1',
      },
      body: JSON.stringify({
        answers: [{ questionId: q1.question_id, optionId: maskedCorrectOptId }],
        submissionMode: 'FULLSCREEN_VIOLATION_AUTO_SUBMIT',
      }),
    });

    const submitBody = await submitRes.json();
    assert.strictEqual(submitRes.status, 200, 'Submission must succeed with 200');
    assert.strictEqual(submitBody.status, 'SUBMITTED');
    assert.strictEqual(submitBody.submissionMode, 'FULLSCREEN_VIOLATION');
    assert.ok(submitBody.score >= 1.0, 'Score must reflect correct answer');
    assert.ok(submitBody.outboxEventId, 'Outbox event ID must be present');

    // Verify row in database
    const dbCheck = await pool.query("SELECT status, submission_mode, score FROM quiz_attempts WHERE attempt_id = $1", [attemptId]);
    assert.strictEqual(dbCheck.rows[0].status, 'SUBMITTED');
    assert.strictEqual(dbCheck.rows[0].submission_mode, 'FULLSCREEN_VIOLATION');
  });
});
