import assert from 'node:assert/strict';
import { pool } from '../db/index.js';

let cookies = '';
let sessionNonce = '';

async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Origin': 'http://localhost:5173',
    ...(cookies ? { Cookie: cookies } : {}),
    ...(sessionNonce ? { 'x-session-nonce': sessionNonce } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`http://localhost:3000${url}`, { ...options, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/focit_token=([^;]+)/);
    if (match) {
      cookies = `focit_token=${match[1]}`;
    }
  }
  return res;
}

async function run() {
  console.log('[Test] Verifying Course Details when No Quiz Exists...');

  // Generate an isolated, ephemeral test course identity to avoid mutating or deleting any existing course data
  const testCourseId = ('TMP_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)).toUpperCase().slice(0, 16);
  const testCourseCode = `TST ${Math.floor(100 + Math.random() * 899)}`;
  const testCourseTitle = `Ephemeral QA Test Course (${testCourseId})`;

  let createdQuizId = null;

  try {
    const deptRes = await pool.query(`SELECT id FROM departments LIMIT 1`);
    const departmentId = deptRes.rows[0].id;

    const semRes = await pool.query(`SELECT id FROM academic_semesters LIMIT 1`);
    const semesterId = semRes.rows[0].id;

    // 1. Create a brand new ephemeral course with 0 quizzes
    await pool.query(`
      INSERT INTO courses (course_id, code, title, department_id, level, semester_number, units, category, max_capacity, is_active)
      VALUES ($1, $2, $3, $4, 400, 2, 3, 'CORE', 100, TRUE);
    `, [testCourseId, testCourseCode, testCourseTitle, departmentId]);

    // Allocate lecturer1 to this ephemeral course
    await pool.query(`
      INSERT INTO hod_course_allocations (course_id, semester_id, lecturer_id, allocated_by)
      VALUES ($1, $2, 'lecturer1', 'hod1')
      ON CONFLICT (course_id, semester_id) DO NOTHING;
    `, [testCourseId, semesterId]);

    // Login as lecturer1
    const loginRes = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ studentId: 'lecturer1', password: 'password123' }),
    });

    const loginBody = await loginRes.json();
    assert.equal(loginRes.status, 200, 'Login failed');
    if (loginBody.sessionNonce) {
      sessionNonce = loginBody.sessionNonce;
    }

    // 2. Call GET /api/courses/:courseId/question-bank
    const qbRes = await apiFetch(`/api/courses/${encodeURIComponent(testCourseId)}/question-bank`);
    assert.equal(qbRes.status, 200, `Expected 200, got ${qbRes.status}`);
    const qbData = await qbRes.json();

    console.log('Response for isolated course with 0 quizzes:\n', JSON.stringify(qbData, null, 2));

    assert.equal(qbData.courseId, testCourseId);
    assert.equal(qbData.courseCode, testCourseCode, 'courseCode must match test course');
    assert.equal(qbData.courseTitle, testCourseTitle, 'courseTitle must match test course');
    assert.equal(qbData.activeQuiz, null, 'activeQuiz must be null');
    assert.deepEqual(qbData.questions, [], 'questions must be empty array');
    assert.deepEqual(qbData.metrics, { total: 0, mcq: 0, trueFalse: 0, shortAnswer: 0 });

    console.log('✔ Course details correctly returned when no quiz exists!');

    // 3. Test creating a question when activeQuiz is null
    const addQRes = await apiFetch(`/api/courses/${encodeURIComponent(testCourseId)}/question-bank/questions`, {
      method: 'POST',
      body: JSON.stringify({
        prompt: 'What does MTBF stand for in reliability analysis?',
        type: 'MULTIPLE_CHOICE',
        options: [
          { id: 'opt_a', text: 'Mean Time Between Failures' },
          { id: 'opt_b', text: 'Maximum Test Build Frequency' },
        ],
        correctOptionId: 'opt_a',
        points: 2.0,
      }),
    });

    assert.equal(addQRes.status, 201, `Failed to add question to empty course: ${addQRes.status}`);
    const addQData = await addQRes.json();
    createdQuizId = addQData.quiz_id;
    console.log('✔ Successfully created question in newly initialized quiz bank:', createdQuizId);

    // 4. Test re-fetching question bank to verify newly created practice quiz has correct total_points
    const qbRes2 = await apiFetch(`/api/courses/${encodeURIComponent(testCourseId)}/question-bank`);
    const qbData2 = await qbRes2.json();
    assert.equal(qbData2.questions.length, 1);
    assert.equal(qbData2.activeQuiz.totalPoints, 2.0, 'totalPoints must match sum of question points');
    console.log('✔ Synchronized totalPoints verified:', qbData2.activeQuiz.totalPoints);

    console.log('\n🎉 ALL EDGE CASE CHECKS FOR QUESTION BANK PASSED WITH 100% SUCCESS!');
  } catch (err) {
    console.error('Test failed:', err);
    process.exitCode = 1;
  } finally {
    // Isolated Cleanup: only cleans the generated test course
    try {
      if (createdQuizId) {
        await pool.query(`DELETE FROM quiz_questions WHERE quiz_id = $1`, [createdQuizId]);
      }
      await pool.query(`DELETE FROM quizzes WHERE course_id = $1`, [testCourseId]);
      await pool.query(`DELETE FROM hod_course_allocations WHERE course_id = $1`, [testCourseId]);
      await pool.query(`DELETE FROM courses WHERE course_id = $1`, [testCourseId]);
      console.log(`[Test] Cleaned up ephemeral test course (${testCourseId})`);
    } catch (cleanupErr) {
      console.error('[Test] Cleanup failed:', cleanupErr);
      process.exitCode = 1;
    } finally {
      await pool.end().catch(() => {});
    }
  }
}

run();
