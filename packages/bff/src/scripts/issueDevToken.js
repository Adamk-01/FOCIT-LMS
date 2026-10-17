/**
 * FOCIT LMS - Local Developer Session & Token Issuer
 *
 * Usage:
 *   node src/scripts/issueDevToken.js [student_id_or_matric]
 *
 * Example:
 *   node src/scripts/issueDevToken.js student2
 *   node src/scripts/issueDevToken.js FOCIT/2025/0104
 *
 * Establishes an authentic Redis session and signs a production-identical JWT,
 * printing ready-to-use curl and browser test headers.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import config from '../config.js';

const targetIdentifier = process.argv[2] || 'student1';
const SESSION_TTL_SECONDS = 3600;

async function issueToken() {
  console.log(`\n🔍 Looking up student: "${targetIdentifier}"...`);

  const { rows } = await pool.query(
    `SELECT student_id, matric_number, username, full_name, email, level 
     FROM students 
     WHERE student_id = $1 OR username = $1 OR matric_number = $1
     LIMIT 1`,
    [targetIdentifier]
  );

  if (rows.length === 0) {
    console.error(`❌ Student "${targetIdentifier}" not found in students table.`);
    process.exit(1);
  }

  const student = rows[0];
  const sessionId = crypto.randomUUID();
  const sessionNonce = crypto.randomBytes(32).toString('hex');
  const nowSec = Math.floor(Date.now() / 1000);

  // 1. Establish session in Redis
  const sessionKey = `session:${sessionId}`;
  await redis.hset(sessionKey, {
    userId: String(student.student_id),
    username: student.username,
    role: 'STUDENT',
    scope: 'FULL_ACCESS',
    mustChangePassword: '0',
    nonce: sessionNonce,
    createdAt: String(nowSec),
  });
  await redis.expire(sessionKey, SESSION_TTL_SECONDS);

  // 2. Issue signed JWT
  const token = jwt.sign(
    {
      sub: student.student_id,
      sid: sessionId,
      username: student.username,
      email: student.email,
      role: 'STUDENT',
      scope: 'FULL_ACCESS',
      mustChangePassword: false,
    },
    config.jwt.secret,
    {
      expiresIn: SESSION_TTL_SECONDS,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    }
  );

  console.log('\n============================================================');
  console.log('✅ AUTHENTIC DEV SESSION ESTABLISHED');
  console.log('============================================================');
  console.log(`Student:       ${student.full_name} (${student.matric_number})`);
  console.log(`Student ID:    ${student.student_id}`);
  console.log(`Session ID:    ${sessionId}`);
  console.log(`TTL:           ${SESSION_TTL_SECONDS}s`);
  console.log('------------------------------------------------------------');
  console.log('📋 HEADERS FOR TESTING:');
  console.log(`Cookie:          focit_token=${token}`);
  console.log(`X-Session-Nonce: ${sessionNonce}`);
  console.log('------------------------------------------------------------');
  console.log('🧪 EXAMPLE CURL:');
  console.log(`curl -X GET "http://localhost:3000/api/student/dashboard" \\`);
  console.log(`  -H "Cookie: focit_token=${token}" \\`);
  console.log(`  -H "X-Session-Nonce: ${sessionNonce}"`);
  console.log('============================================================\n');

  await pool.end();
  redis.disconnect();
}

issueToken().catch((err) => {
  console.error('Failed to issue dev token:', err);
  process.exit(1);
});
