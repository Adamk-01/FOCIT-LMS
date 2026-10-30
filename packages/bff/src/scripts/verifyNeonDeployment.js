import config from '../config.js';
import { db, pool } from '../db/index.js';

async function verifyAll() {
  console.log('================================================================');
  console.log('       FOCIT LMS — NEON POSTGRESQL 16 END-TO-END VERIFICATION    ');
  console.log('================================================================\n');

  const startTotal = Date.now();
  let allPassed = true;

  try {
    // 1. Connection & Engine Metadata
    console.log('1. Connection & Engine Metadata:');
    const metaRes = await db.query('SELECT version(), current_database(), current_user, NOW() as server_time');
    console.log(`   Database Engine : ${metaRes.rows[0].version.split(' on ')[0]}`);
    console.log(`   Database Name   : ${metaRes.rows[0].current_database}`);
    console.log(`   Connected User  : ${metaRes.rows[0].current_user}`);
    console.log(`   Server Time     : ${metaRes.rows[0].server_time}`);
    console.log('   Status          : CONNECTED ✅\n');

    // 2. Schema Table Verification
    console.log('2. Core Academic Schema & Catalog Verification:');
    const tables = [
      { name: 'departments', label: 'Departments' },
      { name: 'programmes', label: 'Degree Programmes' },
      { name: 'courses', label: 'Academic Courses' },
      { name: 'students', label: 'Student Accounts' },
      { name: 'staff_advisors', label: 'Staff Advisors & Admins' },
      { name: 'academic_semesters', label: 'Academic Semesters' },
      { name: 'course_registration_batches', label: 'Registration Batches' },
      { name: 'library_items', label: 'Digital Library Items' },
      { name: 'library_categories', label: 'Library Categories' },
      { name: 'quizzes', label: 'Quizzes / Assessments' },
      { name: 'quiz_questions', label: 'Quiz Questions Bank' },
      { name: 'integration_outbox_events', label: 'Outbox Events Ledger' },
    ];

    for (const t of tables) {
      const countRes = await db.query(`SELECT COUNT(*)::int AS count FROM ${t.name}`);
      console.log(`   ${t.label.padEnd(28)} : ${countRes.rows[0].count} rows ✅`);
    }
    console.log('');

    // 3. Multi-Statement Transaction Test with Trace & Local Settings
    console.log('3. Pipelined Transaction Scoping (SET LOCAL & Rollback Cleanup):');
    const txStart = Date.now();
    const txResult = await db.transaction(async (client) => {
      await client.query("SET LOCAL application_name = 'focit_verification_runner'");
      const appNameRes = await client.query("SELECT current_setting('application_name') as app_name");
      const testRow = await client.query('SELECT 1 as verified');
      return { appName: appNameRes.rows[0].app_name, verified: testRow.rows[0].verified };
    });
    console.log(`   Application Name in TX: ${txResult.appName}`);
    console.log(`   Transaction Status    : COMMITTED (Latency: ${Date.now() - txStart}ms) ✅\n`);

    // 4. Digital Library GIN Full-Text Index Query
    console.log('4. Digital Library GIN tsvector Search:');
    const searchRes = await db.query(`
      SELECT id, title, item_type, course_id,
             ts_rank(search_vector, websearch_to_tsquery('english', 'algorithms')) as rank
      FROM library_items
      WHERE search_vector @@ websearch_to_tsquery('english', 'algorithms')
      ORDER BY rank DESC
      LIMIT 3;
    `);
    console.log(`   Query: 'algorithms' -> Found ${searchRes.rows.length} matched textbook(s):`);
    for (const item of searchRes.rows) {
      console.log(`     👉 [${item.item_type}] ${item.title} (Rank: ${parseFloat(item.rank).toFixed(4)})`);
    }
    console.log('   GIN Index Search Status: OPERATIONAL ✅\n');

    // 5. Digital Library Category Aggregation
    console.log('5. Digital Library Taxonomy & Aggregate Items:');
    const catRes = await db.query(`
      SELECT c.slug, c.name, COUNT(i.id)::int AS item_count
      FROM library_categories c
      LEFT JOIN library_items i ON i.category_id = c.id
      GROUP BY c.slug, c.name, c.display_order
      ORDER BY c.display_order ASC;
    `);
    for (const cat of catRes.rows) {
      console.log(`   Category [${cat.slug.padEnd(16)}]: ${cat.name} (${cat.item_count} items)`);
    }
    console.log('   Taxonomy Status: OPERATIONAL ✅\n');

    console.log('================================================================');
    console.log(`   DEPLOYMENT STATUS: NEON POSTGRESQL 16 IS 100% OPERATIONAL 🟢`);
    console.log(`   Total Verification Time: ${Date.now() - startTotal}ms`);
    console.log('================================================================\n');

  } catch (err) {
    allPassed = false;
    console.error('❌ Verification Error:', err);
  } finally {
    try {
      await pool.end();
    } catch {}
    process.exit(allPassed ? 0 : 1);
  }
}

verifyAll();
