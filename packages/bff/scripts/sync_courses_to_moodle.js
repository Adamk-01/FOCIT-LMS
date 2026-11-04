import { pool } from '../src/db/index.js';
import config from '../src/config.js';

// Parse target Moodle URL and Token from CLI arguments or environment variables
const cliUrl = process.argv.find(a => a.startsWith('--url='))?.split('=')[1];
const cliToken = process.argv.find(a => a.startsWith('--token='))?.split('=')[1];

const targetBaseUrl = (cliUrl || process.env.MOODLE_BASE_URL || config.moodle?.baseUrl || 'http://localhost:8080').replace(/\/+$/, '');
const targetToken = cliToken || process.env.MOODLE_WS_TOKEN || config.moodle?.wsToken;

async function callDirectMoodle(wsfunction, params = {}, method = 'GET') {
  const queryParams = new URLSearchParams({
    wstoken: targetToken,
    wsfunction,
    moodlewsrestformat: 'json',
  });

  let url = `${targetBaseUrl}/webservice/rest/server.php`;
  let options = { method: method.toUpperCase() };

  if (method.toUpperCase() === 'POST') {
    const bodyParams = new URLSearchParams(queryParams);
    function flatten(prefix, obj) {
      for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}[${key}]` : key;
        if (typeof val === 'object' && val !== null) {
          flatten(fullKey, val);
        } else {
          bodyParams.append(fullKey, String(val));
        }
      }
    }
    flatten('', params);
    options.body = bodyParams.toString();
    options.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  } else {
    for (const [key, val] of Object.entries(params)) {
      queryParams.append(key, String(val));
    }
    url += `?${queryParams.toString()}`;
  }

  const res = await fetch(url, options);
  const json = await res.json();
  if (json && (json.exception || json.errorcode)) {
    throw new Error(`Moodle API Exception [${json.errorcode}]: ${json.message}`);
  }
  return json;
}

async function syncCourses() {
  console.log(`Connecting to Target Moodle at: ${targetBaseUrl}`);
  console.log(`Using Token: ${targetToken ? targetToken.substring(0, 6) + '...' : 'NONE'}`);

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
    'SELECT course_id, code, title, department_id, level FROM courses WHERE is_active IS NOT FALSE ORDER BY code;'
  );
  console.log(`Starting sync for ${courses.length} courses...`);
  let successCount = 0;
  let failCount = 0;

  for (const c of courses) {
    const shortname = c.course_id.replace(/\s+/g, '');
    try {
      // 1. Search upstream target Moodle by shortname to verify actual existence
      let targetMoodleId = null;
      try {
        const existing = await callDirectMoodle('core_course_get_courses_by_field', { field: 'shortname', value: shortname });
        if (existing?.courses && existing.courses.length > 0) {
          targetMoodleId = existing.courses[0].id;
          console.log(`[EXISTS UPSTREAM] ${shortname} -> Moodle ID: ${targetMoodleId}`);
        }
      } catch (err) {
        // Not found or check failed, proceed to creation
      }

      // 2. If it does not exist upstream in target Moodle, create it!
      if (!targetMoodleId) {
        const created = await callDirectMoodle('core_course_create_courses', {
          courses: [
            {
              fullname: `${c.title} (${c.code})`,
              shortname,
              categoryid: 1,
              idnumber: c.course_id
            }
          ]
        }, 'POST');

        targetMoodleId = created[0].id;
        console.log(`[CREATED IN MOODLE] ${shortname} -> New Moodle ID: ${targetMoodleId}`);
      }

      // 3. Update database mapping with authoritative target Moodle ID
      await pool.query(
        `INSERT INTO moodle_course_mappings (id, focit_course_id, semester_id, moodle_course_id, sync_status, last_synced_at)
         VALUES (gen_random_uuid(), $1, $2, $3, 'SYNCED', NOW())
         ON CONFLICT (focit_course_id, semester_id) DO UPDATE SET moodle_course_id = EXCLUDED.moodle_course_id, sync_status = 'SYNCED', last_synced_at = NOW()`,
        [c.course_id, activeSemesterId, targetMoodleId]
      );
      try {
        await pool.query('UPDATE courses SET moodle_course_id = $1 WHERE course_id = $2', [targetMoodleId, c.course_id]);
      } catch (_) {}
      successCount++;
    } catch (err) {
      failCount++;
      console.error(`[SYNC FAILED] ${shortname} (${c.title}):`, err.message);
    }
  }

  console.log('\n--- MOODLE SYNCHRONIZATION SUMMARY ---');
  console.log(`Total Courses: ${courses.length}`);
  console.log(`Successfully Synchronized: ${successCount}`);
  console.log(`Failures: ${failCount}`);

  await pool.end();
  if (failCount > 0) process.exit(1);
}

syncCourses();
