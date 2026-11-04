import { pool } from '../src/db/index.js';
import { callMoodleAPI } from '../src/integrations/moodle/moodle.client.js';

async function syncCourses() {
  let activeSemesterId = null;
  try {
    const semRes = await pool.query(
      `SELECT s.id 
       FROM academic_semesters s
       LEFT JOIN academic_sessions sess ON sess.id = s.session_id
       ORDER BY COALESCE(sess.is_current, FALSE) DESC, COALESCE(s.is_registration_open, FALSE) DESC, s.created_at DESC 
       LIMIT 1`
    );
    if (semRes.rows.length > 0 && semRes.rows[0].id) {
      activeSemesterId = semRes.rows[0].id;
    }
  } catch (err) {
    console.error('Fatal error querying active academic semester:', err.message);
    await pool.end();
    process.exit(1);
  }

  if (!activeSemesterId) {
    console.error('No active academic semester could be resolved from academic_semesters. Aborting synchronization.');
    await pool.end();
    process.exit(1);
  }

  console.log(`Authoritative semester for Moodle mapping: ${activeSemesterId}`);

  const { rows: courses } = await pool.query(
    'SELECT course_id, code, title, department_id, level, moodle_course_id FROM courses WHERE is_active IS NOT FALSE ORDER BY code;'
  );
  console.log(`Starting sync for ${courses.length} courses...`);
  let successCount = 0;
  let failCount = 0;

  for (const c of courses) {
    const shortname = c.course_id.replace(/\s+/g, '');
    try {
      // 1. Resolve an existing mapping before searching upstream by shortname
      let existingMoodleId = null;
      const mappingRes = await pool.query(
        `SELECT moodle_course_id 
         FROM moodle_course_mappings 
         WHERE focit_course_id = $1 AND semester_id = $2 AND moodle_course_id IS NOT NULL 
         LIMIT 1`,
        [c.course_id, activeSemesterId]
      );

      if (mappingRes.rows.length > 0 && mappingRes.rows[0].moodle_course_id) {
        existingMoodleId = mappingRes.rows[0].moodle_course_id;
      } else if (c.moodle_course_id) {
        existingMoodleId = parseInt(c.moodle_course_id, 10);
      }

      if (existingMoodleId) {
        console.log(`[RESOLVED MAPPING] ${shortname} -> Moodle ID: ${existingMoodleId}`);
        await pool.query(
          `INSERT INTO moodle_course_mappings (id, focit_course_id, semester_id, moodle_course_id, sync_status, last_synced_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'SYNCED', NOW())
           ON CONFLICT (focit_course_id, semester_id) DO UPDATE SET moodle_course_id = EXCLUDED.moodle_course_id, sync_status = 'SYNCED', last_synced_at = NOW()`,
          [c.course_id, activeSemesterId, existingMoodleId]
        );
        try {
          await pool.query('UPDATE courses SET moodle_course_id = $1 WHERE course_id = $2', [existingMoodleId, c.course_id]);
        } catch (_) {}
        successCount++;
        continue;
      }

      // 2. Search upstream Moodle by shortname if not mapped locally
      const existing = await callMoodleAPI('core_course_get_courses_by_field', { field: 'shortname', value: shortname });
      if (existing?.courses && existing.courses.length > 0) {
        const mId = existing.courses[0].id;
        console.log(`[EXISTS BY SHORTNAME] ${shortname} -> Moodle ID: ${mId}`);
        await pool.query(
          `INSERT INTO moodle_course_mappings (id, focit_course_id, semester_id, moodle_course_id, sync_status, last_synced_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'SYNCED', NOW())
           ON CONFLICT (focit_course_id, semester_id) DO UPDATE SET moodle_course_id = EXCLUDED.moodle_course_id, sync_status = 'SYNCED', last_synced_at = NOW()`,
          [c.course_id, activeSemesterId, mId]
        );
        try {
          await pool.query('UPDATE courses SET moodle_course_id = $1 WHERE course_id = $2', [mId, c.course_id]);
        } catch (_) {}
        successCount++;
        continue;
      }

      // 3. Create the course in Moodle if it does not exist upstream
      const created = await callMoodleAPI('core_course_create_courses', {
        courses: [
          {
            fullname: `${c.title} (${c.code})`,
            shortname,
            categoryid: 1,
            idnumber: c.course_id
          }
        ]
      }, 'POST');

      const newId = created[0].id;
      console.log(`[CREATED] ${shortname} -> Moodle ID: ${newId}`);
      await pool.query(
        `INSERT INTO moodle_course_mappings (id, focit_course_id, semester_id, moodle_course_id, sync_status, last_synced_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'SYNCED', NOW())
         ON CONFLICT (focit_course_id, semester_id) DO UPDATE SET moodle_course_id = EXCLUDED.moodle_course_id, sync_status = 'SYNCED', last_synced_at = NOW()`,
        [c.course_id, activeSemesterId, newId]
      );
      try {
        await pool.query('UPDATE courses SET moodle_course_id = $1 WHERE course_id = $2', [newId, c.course_id]);
      } catch (_) {}
      successCount++;
    } catch (err) {
      failCount++;
      console.error(`[ERROR] ${shortname}:`, err.message);
    }
  }

  await pool.end();

  if (failCount > 0) {
    console.error(`--- SYNC COMPLETED WITH FAILURES: ${successCount} succeeded, ${failCount} failed out of ${courses.length} courses ---`);
    process.exit(1);
  } else {
    console.log(`--- ALL ${successCount} COURSES SUCCESSFULLY SYNCED TO MOODLE ---`);
  }
}

syncCourses().catch((err) => {
  console.error('Fatal sync failure:', err);
  process.exit(1);
});
