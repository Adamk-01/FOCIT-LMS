import config from '../config.js';
import { db } from '../db/index.js';
import { redis } from '../lib/redis.js';

async function runTest() {
  console.log('====================================================');
  console.log('       FOCIT CLOUD INFRASTRUCTURE HEALTH CHECK      ');
  console.log('====================================================\n');

  let pgConnected = false;
  let schemaVerified = false;
  let redisConnected = false;

  // 1. PostgreSQL Transport & Auth Handshake
  console.log('🔍 Testing PostgreSQL Transport Connectivity (Neon DB)...');
  try {
    const startPg = Date.now();
    const pgRes = await db.query('SELECT NOW() as current_time, current_database(), version();');
    const pgLatency = Date.now() - startPg;

    console.log('✅ PostgreSQL Transport Connected successfully!');
    console.log(`   Database Name : ${pgRes.rows[0].current_database}`);
    console.log(`   Latency       : ${pgLatency}ms`);
    console.log(`   Server Time   : ${pgRes.rows[0].current_time}`);
    pgConnected = true;
  } catch (err) {
    console.error('❌ PostgreSQL Connection Failed:', err.message);
  }

  // 1b. Schema & Seed Data Verification (Decoupled from socket connectivity)
  if (pgConnected) {
    console.log('\n🔍 Verifying Application Schema & Seed Data...');
    try {
      const advisorRes = await db.query('SELECT count(*) FROM staff_advisors;');
      const studentRes = await db.query('SELECT count(*) FROM students;');
      const courseRes = await db.query('SELECT count(*) FROM courses;');
      const adminRes = await db.query(
        "SELECT advisor_id, staff_number, email, role, account_status FROM staff_advisors WHERE role IN ('ADMIN', 'SYSTEM_ADMIN');"
      );

      console.log('✅ Application Schema & Seed Data Verified!');
      console.log(`   Staff Advisors: ${advisorRes.rows[0].count}`);
      console.log(`   Students      : ${studentRes.rows[0].count}`);
      console.log(`   Courses       : ${courseRes.rows[0].count}`);
      console.log(`   Admins Found  : ${adminRes.rows.length}`);
      for (const admin of adminRes.rows) {
        console.log(`     👉 ${admin.staff_number} | ${admin.email} (${admin.role}) | Status: ${admin.account_status}`);
      }
      schemaVerified = true;
    } catch (schemaErr) {
      console.warn('⚠️ Schema check uninitialized or incomplete:', schemaErr.message);
    }
  }

  // 2. Redis Test
  console.log('\n🔍 Testing Redis (Upstash Cloud)...');
  try {
    const startRedis = Date.now();
    const pong = await redis.ping();
    const redisLatency = Date.now() - startRedis;

    console.log('✅ Redis Connected successfully!');
    console.log(`   PING Response : ${pong}`);
    console.log(`   Latency       : ${redisLatency}ms`);

    const testKey = `focit_test_conn_${Date.now()}`;
    await redis.set(testKey, 'operational', 'EX', 30);
    const readVal = await redis.get(testKey);
    const writeReadSuccess = readVal === 'operational';
    await redis.del(testKey);

    console.log(`   Read/Write Check: ${writeReadSuccess ? 'PASSED ✅' : 'FAILED ❌'}`);
    if (writeReadSuccess) {
      redisConnected = true;
    }
  } catch (err) {
    console.error('❌ Redis Connection Failed:', err.message);
  }

  console.log('\n====================================================');
  console.log(`   SUMMARY: PostgreSQL Transport: ${pgConnected ? 'ONLINE 🟢' : 'OFFLINE 🔴'}`);
  console.log(`            PostgreSQL Schema   : ${schemaVerified ? 'INITIALIZED 🟢' : 'NOT INITIALIZED 🟡'}`);
  console.log(`            Redis Session Store : ${redisConnected ? 'ONLINE 🟢' : 'OFFLINE 🔴'}`);
  console.log('====================================================\n');

  try {
    await redis.quit();
  } catch {}
  try {
    await db.end();
  } catch {}

  process.exitCode = pgConnected && schemaVerified && redisConnected ? 0 : 1;
}

runTest();
