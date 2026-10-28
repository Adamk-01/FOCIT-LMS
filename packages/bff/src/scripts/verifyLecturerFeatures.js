/**
 * FOCIT LMS - End-to-End Verification of Lecturer Dashboard & Features
 * Standard: Category 3 of lms_user_categories_and_access_matrix.md
 * Tests both local Express logic and live Docker endpoints.
 */

import assert from 'node:assert/strict';

const BASE_URL = process.env.TEST_BFF_URL || 'http://localhost:3000';

console.log(`[Test] Starting Lecturer Features Verification against: ${BASE_URL}`);

async function runVerification() {
  let cookies = '';
  let sessionNonce = '';

  // Helper fetch with cookies and headers
  async function apiFetch(endpoint, options = {}) {
    const url = `${BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Origin': 'http://localhost:5173',
      ...(cookies ? { Cookie: cookies } : {}),
      ...(sessionNonce ? { 'x-session-nonce': sessionNonce } : {}),
      ...(options.headers || {}),
    };
    const res = await fetch(url, { ...options, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/focit_token=([^;]+)/);
      if (match) {
        cookies = `focit_token=${match[1]}`;
      }
    }
    return res;
  }

  // 1. Authenticate as Lecturer
  console.log('1. Testing Lecturer Authentication (POST /api/auth/login)...');
  const loginRes = await apiFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ studentId: 'lecturer1', password: 'password123' }),
  });
  const loginBody = await loginRes.json();
  assert.equal(loginRes.status, 200, `Login failed: ${JSON.stringify(loginBody)}`);
  assert.ok(loginBody.user, 'Login must return user profile');
  assert.equal(loginBody.user.role, 'LECTURER', 'User role must be LECTURER');
  if (loginBody.sessionNonce) {
    sessionNonce = loginBody.sessionNonce;
  }
  console.log('   ✔ Successfully authenticated as LECTURER:', loginBody.user.username);

  // 2. Verify Session Context (GET /api/lecturer/overview)
  console.log('2. Verifying Session Context (GET /api/lecturer/overview)...');
  const meRes = await apiFetch('/api/lecturer/overview');
  const meBody = await meRes.json();
  assert.equal(meRes.status, 200, `Lecturer overview failed: ${JSON.stringify(meBody)}`);
  assert.ok(meBody.lecturer, 'Overview must include lecturer details');
  console.log('   ✔ Verified active session context for:', meBody.lecturer.full_name || meBody.lecturer.staff_number);

  // 3. Lecturer Overview Metrics (GET /api/lecturer/overview)
  console.log('3. Testing Lecturer Overview Metrics (GET /api/lecturer/overview)...');
  const overviewRes = await apiFetch('/api/lecturer/overview');
  const overview = await overviewRes.json();
  assert.equal(overviewRes.status, 200);
  assert.ok(overview.lecturer, 'Overview must include lecturer details');
  assert.ok(overview.metrics, 'Overview must include metrics');
  assert.equal(typeof overview.metrics.assigned_courses_count, 'number');
  assert.equal(typeof overview.metrics.total_students_taught, 'number');
  console.log(`   ✔ Overview metrics retrieved: ${overview.metrics.assigned_courses_count} courses, ${overview.metrics.total_students_taught} students`);

  // 4. Allocated Courses (GET /api/lecturer/courses)
  console.log('4. Testing Allocated Courses (GET /api/lecturer/courses)...');
  const coursesRes = await apiFetch('/api/lecturer/courses');
  const coursesBody = await coursesRes.json();
  assert.equal(coursesRes.status, 200);
  assert.ok(Array.isArray(coursesBody.courses), 'courses must be an array');
  assert.ok(coursesBody.courses.length > 0, 'Lecturer must have at least one allocated course');
  const targetCourse = coursesBody.courses[0];
  const targetCourseId = targetCourse.course_id;
  console.log(`   ✔ Retrieved ${coursesBody.courses.length} allocated courses. Target: ${targetCourse.code} (${targetCourseId})`);

  // 5. Class Roster (GET /api/lecturer/courses/:courseId/students)
  console.log(`5. Testing Class Roster for ${targetCourseId}...`);
  const rosterRes = await apiFetch(`/api/lecturer/courses/${encodeURIComponent(targetCourseId)}/students`);
  const rosterBody = await rosterRes.json();
  assert.equal(rosterRes.status, 200);
  assert.ok(Array.isArray(rosterBody.students), 'students must be an array');
  console.log(`   ✔ Retrieved class roster: ${rosterBody.students.length} enrolled students`);

  // 6. CSV Roster Export (GET /api/lecturer/courses/:courseId/roster/export)
  console.log('6. Testing Examination Roster CSV Export...');
  const csvRes = await apiFetch(`/api/lecturer/courses/${encodeURIComponent(targetCourseId)}/roster/export`);
  assert.equal(csvRes.status, 200);
  assert.ok(csvRes.headers.get('content-type').includes('text/csv'));
  const csvContent = await csvRes.text();
  assert.ok(csvContent.includes('Matric Number'), 'CSV must contain headers');
  assert.ok(csvContent.includes('Candidate Signature'), 'CSV must contain exam hall signature column');
  console.log('   ✔ Successfully generated examination hall CSV roster');

  // 7. Attendance Sessions (GET /api/attendance/courses/:courseId/sessions)
  console.log(`7. Testing Attendance Sessions list for ${targetCourseId}...`);
  const attRes = await apiFetch(`/api/attendance/courses/${encodeURIComponent(targetCourseId)}/sessions`);
  const attBody = await attRes.json();
  assert.equal(attRes.status, 200);
  assert.ok(Array.isArray(attBody.sessions), 'sessions must be an array');
  console.log(`   ✔ Retrieved ${attBody.sessions.length} existing attendance sessions`);

  // 8. Mode 4 Attendance Sheet Upload (POST /api/attendance/courses/:courseId/upload-scanned-sheet)
  console.log('8. Testing Mode 4 Snapped Sheet Attendance Ingestion...');
  const testWeek = Math.min(15, (attBody.sessions.length % 14) + 1);
  const uploadRes = await apiFetch(`/api/attendance/courses/${encodeURIComponent(targetCourseId)}/upload-scanned-sheet`, {
    method: 'POST',
    body: JSON.stringify({
      week_number: testWeek,
      sheet_image_urls: ['https://storage.focit.uniosun.edu.ng/attendance/week_sheet_sample.jpg'],
      extracted_matric_numbers: ['FOCIT/2024/0042', 'CSC/2022/1001'],
      raw_extracted_text: 'FOCIT/2024/0042 PRESENT\nCSC/2022/1001 PRESENT',
    }),
  });
  const uploadBody = await uploadRes.json();
  assert.ok([200, 201, 409].includes(uploadRes.status), `Unexpected upload status: ${uploadRes.status}`);
  const activeSessionId = uploadBody?.session?.session_id || attBody.sessions[0]?.session_id;
  console.log(`   ✔ Sheet scan ingestion verified. Session ID: ${activeSessionId || 'N/A'}`);

  // 9. Session Details & Verification Desk (GET /api/attendance/sessions/:sessionId)
  if (activeSessionId) {
    console.log(`9. Testing Attendance Verification Desk for session ${activeSessionId}...`);
    const deskRes = await apiFetch(`/api/attendance/sessions/${activeSessionId}`);
    const deskBody = await deskRes.json();
    assert.equal(deskRes.status, 200);
    assert.ok(deskBody.session);
    assert.ok(Array.isArray(deskBody.records));
    console.log(`   ✔ Verification desk loaded: ${deskBody.records.length} student records`);

    // 10. Update Records (PUT /api/attendance/sessions/:sessionId/records)
    if (!deskBody.session.is_locked && deskBody.records.length > 0) {
      console.log('10. Testing Attendance Status Modification...');
      const targetStudent = deskBody.records[0];
      const updateRes = await apiFetch(`/api/attendance/sessions/${activeSessionId}/records`, {
        method: 'PUT',
        body: JSON.stringify({
          updates: [{ studentId: targetStudent.student_id, status: 'PRESENT', notes: 'Verified in class' }],
        }),
      });
      assert.equal(updateRes.status, 200);
      console.log('   ✔ Attendance record status modified successfully');
    }
  }

  // 11. NUC 75% Attendance Summary (GET /api/attendance/courses/:courseId/summary)
  console.log('11. Testing NUC 75% Attendance Eligibility Computation...');
  const summaryRes = await apiFetch(`/api/attendance/courses/${encodeURIComponent(targetCourseId)}/summary`);
  const summaryBody = await summaryRes.json();
  assert.equal(summaryRes.status, 200);
  assert.ok(Array.isArray(summaryBody.students));
  assert.equal(typeof summaryBody.totalLockedSessions, 'number');
  console.log(`   ✔ NUC 75% audit calculated for ${summaryBody.students.length} students`);

  // 12. Question Bank & AI (GET /api/courses/:courseId/question-bank)
  console.log('12. Testing Question Bank Retrieval...');
  const qbRes = await apiFetch(`/api/courses/${encodeURIComponent(targetCourseId)}/question-bank`);
  const qbBody = await qbRes.json();
  assert.equal(qbRes.status, 200);
  assert.ok(Array.isArray(qbBody.questions));
  console.log(`   ✔ Question Bank retrieved: ${qbBody.questions.length} questions`);

  // 12.1 Ensure at least one question exists in the question bank before publishing
  console.log('12.1 Testing Manual Question Authoring into Question Bank...');
  const addQRes = await apiFetch(`/api/courses/${encodeURIComponent(targetCourseId)}/question-bank/questions`, {
    method: 'POST',
    body: JSON.stringify({
      prompt: `Sample Verification Question (${Date.now()})`,
      type: 'MULTIPLE_CHOICE',
      options: [
        { id: 'opt_a', text: 'Option A' },
        { id: 'opt_b', text: 'Option B' },
        { id: 'opt_c', text: 'Option C' },
        { id: 'opt_d', text: 'Option D' },
      ],
      correctOptionId: 'opt_a',
      points: 1.0,
    }),
  });
  const addQBody = await addQRes.json();
  assert.equal(addQRes.status, 201, `Failed to add question to bank: ${JSON.stringify(addQBody)}`);
  console.log('   ✔ Successfully authored question into question bank');

  // 13. Publish Official Midterm Test (POST /api/courses/:courseId/tests/publish)
  console.log('13. Testing Official Summative Test Publishing...');
  const testTitle = `CSC 204 Midterm Assessment (${Date.now()})`;
  const publishRes = await apiFetch(`/api/courses/${encodeURIComponent(targetCourseId)}/tests/publish`, {
    method: 'POST',
    body: JSON.stringify({
      title: testTitle,
      durationMinutes: 30,
      autoZero: true,
      windowOpenAt: new Date(Date.now() - 3600000).toISOString(),
      windowCloseAt: new Date(Date.now() + 86400000).toISOString(),
      randomQuestionCount: 5,
    }),
  });
  const publishBody = await publishRes.json();
  assert.equal(publishRes.status, 201, `Failed to publish test: ${JSON.stringify(publishBody)}`);
  assert.ok(publishBody.test);
  assert.equal(publishBody.test.auto_zero, true);
  console.log(`   ✔ Published official summative test: "${publishBody.test.title}" (ID: ${publishBody.test.quiz_id})`);

  // 14. Course Materials (GET /api/courses/:courseId/materials)
  console.log('14. Testing Course Materials Station...');
  let matRes = await apiFetch(`/api/courses/${encodeURIComponent(targetCourseId)}/materials`);
  if (matRes.status === 503) {
    console.log('   (Priming cold upstream cache, waiting 3s for SWR revalidation...)');
    await new Promise((r) => setTimeout(r, 3500));
    matRes = await apiFetch(`/api/courses/${encodeURIComponent(targetCourseId)}/materials`);
  }
  const matBody = await matRes.json();
  assert.equal(matRes.status, 200, `Materials fetch failed: ${JSON.stringify(matBody)}`);
  assert.ok(matBody.data || Array.isArray(matBody.materials) || matBody.moodleCourseId !== undefined);
  console.log('   ✔ Course materials station verified');

  // 15. Continuous Assessment Gradebook (GET /api/courses/:courseId/grades)
  console.log('15. Testing Continuous Assessment Gradebook...');
  const gradeRes = await apiFetch(`/api/courses/${encodeURIComponent(targetCourseId)}/grades`);
  const gradeBody = await gradeRes.json();
  assert.equal(gradeRes.status, 200, `Gradebook fetch failed: ${JSON.stringify(gradeBody)}`);
  assert.ok(Array.isArray(gradeBody.items) || Array.isArray(gradeBody.grades) || gradeBody.courseId !== undefined);
  console.log(`   ✔ Gradebook verified for course ${targetCourseId}`);

  console.log('\n======================================================');
  console.log('🎉 ALL CATEGORY 3 LECTURER FEATURES VERIFIED SUCCESSFULLY!');
  console.log('======================================================\n');
}

runVerification().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
