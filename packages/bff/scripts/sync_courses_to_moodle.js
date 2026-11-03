import { pool } from '../src/db/index.js';
import { callMoodleAPI } from '../src/integrations/moodle/moodle.client.js';

async function syncCourses() {
  const { rows: courses } = await pool.query('SELECT course_id, code, title, department_id, level FROM courses ORDER BY code;');
  console.log(`Starting sync for ${courses.length} courses...`);

  for (const c of courses) {
    const shortname = c.course_id.replace(/\s+/g, '');
    try {
      const existing = await callMoodleAPI('core_course_get_courses_by_field', { field: 'shortname', value: shortname });
      if (existing?.courses && existing.courses.length > 0) {
        const mId = existing.courses[0].id;
        console.log(`[EXISTS] ${shortname} -> Moodle ID: ${mId}`);
        await pool.query(
          `INSERT INTO moodle_course_mappings (id, focit_course_id, semester_id, moodle_course_id, sync_status, last_synced_at)
           VALUES (gen_random_uuid(), $1, '2026_RAIN', $2, 'SYNCED', NOW())
           ON CONFLICT (focit_course_id, semester_id) DO UPDATE SET moodle_course_id = EXCLUDED.moodle_course_id, sync_status = 'SYNCED', last_synced_at = NOW()`,
          [c.course_id, mId]
        );
        continue;
      }

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
         VALUES (gen_random_uuid(), $1, '2026_RAIN', $2, 'SYNCED', NOW())
         ON CONFLICT (focit_course_id, semester_id) DO UPDATE SET moodle_course_id = EXCLUDED.moodle_course_id, sync_status = 'SYNCED', last_synced_at = NOW()`,
        [c.course_id, newId]
      );
    } catch (err) {
      console.error(`[ERROR] ${shortname}:`, err.message);
    }
  }

  console.log('--- ALL COURSES SYNCED TO MOODLE ---');
  await pool.end();
}

syncCourses().catch((err) => {
  console.error('Fatal sync failure:', err);
  process.exit(1);
});
