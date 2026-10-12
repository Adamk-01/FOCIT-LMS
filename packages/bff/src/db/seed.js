/**
 * FOCIT LMS - Academic Catalog Database Seeder
 *
 * Executes 002_academic_catalog_seed.sql against the configured PostgreSQL instance.
 * Reports seeded row counts for departments, programmes, courses, students, and enrollments.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';
import { logger } from '../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSeed() {
  const seedPath = path.resolve(__dirname, 'migrations', '002_academic_catalog_seed.sql');
  logger.info({ path: seedPath }, '[DB Seed] Reading SQL seed file...');

  const sqlContent = await fs.readFile(seedPath, 'utf8');

  const client = await pool.connect();
  try {
    logger.info('[DB Seed] Executing academic catalog seed transaction...');
    await client.query(sqlContent);
    const phase4Path = path.resolve(__dirname, 'migrations', '003_phase4_assessments_and_social.sql');
    logger.info({ path: phase4Path }, '[DB Seed] Reading Phase 4 SQL seed file...');
    const phase4Sql = await fs.readFile(phase4Path, 'utf8');

    logger.info('[DB Seed] Executing Phase 4 assessments & social seed transaction...');
    await client.query(phase4Sql);
    logger.info('[DB Seed] Phase 4 migration transaction committed successfully.');

    const phase5Path = path.resolve(__dirname, 'migrations', '004_phase5_question_bank.sql');
    logger.info({ path: phase5Path }, '[DB Seed] Reading Phase 5 SQL migration file...');
    const phase5Sql = await fs.readFile(phase5Path, 'utf8');

    logger.info('[DB Seed] Executing Phase 5 Question Bank & Partial Unique Index transaction...');
    await client.query(phase5Sql);
    logger.info('[DB Seed] Phase 5 migration transaction committed successfully.');

    const phase6Path = path.resolve(__dirname, 'migrations', '005_phase6_student_profiles_and_preferences.sql');
    logger.info({ path: phase6Path }, '[DB Seed] Reading Phase 6 SQL migration file...');
    const phase6Sql = await fs.readFile(phase6Path, 'utf8');

    logger.info('[DB Seed] Executing Phase 6 Student Profiles & Preferences transaction...');
    await client.query(phase6Sql);
    logger.info('[DB Seed] Phase 6 migration transaction committed successfully.');

    const phase7Path = path.resolve(__dirname, 'migrations', '006_course_registration_approval_engine.sql');
    logger.info({ path: phase7Path }, '[DB Seed] Reading Phase 7 Course Registration & Approval SQL file...');
    const phase7Sql = await fs.readFile(phase7Path, 'utf8');

    logger.info('[DB Seed] Executing Phase 7 Course Registration Approval Engine transaction...');
    await client.query(phase7Sql);
    logger.info('[DB Seed] Phase 7 migration transaction committed successfully.');

    const auditLedgerPath = path.resolve(__dirname, 'migrations', '007_identity_security_audit_ledger.sql');
    logger.info({ path: auditLedgerPath }, '[DB Seed] Reading Migration 007 Identity & Security Audit Ledger SQL file...');
    const auditLedgerSql = await fs.readFile(auditLedgerPath, 'utf8');

    logger.info('[DB Seed] Executing Migration 007 Identity & Security Audit Ledger transaction...');
    await client.query(auditLedgerSql);
    logger.info('[DB Seed] Migration 007 transaction committed successfully.');

    // Audit and verify seeded table records
    const deptsCount = await client.query('SELECT COUNT(*) FROM departments');
    const progsCount = await client.query('SELECT COUNT(*) FROM programmes');
    const coursesCount = await client.query('SELECT COUNT(*) FROM courses');
    const studentsCount = await client.query('SELECT COUNT(*) FROM students');
    const profilesCount = await client.query('SELECT COUNT(*) FROM student_profiles');
    const advisorsCount = await client.query('SELECT COUNT(*) FROM staff_advisors');
    const batchesCount = await client.query('SELECT COUNT(*) FROM course_registration_batches');
    const batchItemsCount = await client.query('SELECT COUNT(*) FROM course_registration_items');
    const enrollmentsCount = await client.query('SELECT COUNT(*) FROM enrollments');
    const quizzesCount = await client.query('SELECT COUNT(*) FROM quizzes');
    const questionsCount = await client.query('SELECT COUNT(*) FROM quiz_questions');
    const attemptsCount = await client.query('SELECT COUNT(*) FROM quiz_attempts');
    const gradesCount = await client.query('SELECT COUNT(*) FROM grade_items');
    const forumsCount = await client.query('SELECT COUNT(*) FROM forum_threads');

    console.log('\n============================================================');
    console.log('✅ FOCIT ACADEMIC CATALOG, REGISTRATION & CLEARANCE SEED COMPLETE');
    console.log('============================================================');
    console.log(`Departments Seeded:    ${deptsCount.rows[0].count} (CSC, CYS, SEN, DSC, IFS, IFT, LIS)`);
    console.log(`Programmes Seeded:     ${progsCount.rows[0].count} (B.Sc. Degree Programmes)`);
    console.log(`Courses Seeded:        ${coursesCount.rows[0].count} (Levels 100-400 with Units, Cores, Electives)`);
    console.log(`Students Seeded:       ${studentsCount.rows[0].count} (Varying Levels 100-400: student1 to student5)`);
    console.log(`Student Profiles:      ${profilesCount.rows[0].count} (Demographics & Preferences Seeded)`);
    console.log(`Staff Advisors Seeded: ${advisorsCount.rows[0].count} (Level Advisors & HODs)`);
    console.log(`Registration Batches:  ${batchesCount.rows[0].count} (FSM Batches: DRAFT & SUBMITTED seeded)`);
    console.log(`Batch Staged Items:    ${batchItemsCount.rows[0].count} (Candidate Course Selections)`);
    console.log(`Active Enrollments:    ${enrollmentsCount.rows[0].count} (Authoritative Ledger Entries)`);
    console.log(`Quizzes Seeded:        ${quizzesCount.rows[0].count} (Assessments)`);
    console.log(`Questions Seeded:      ${questionsCount.rows[0].count} (Question Bank)`);
    console.log(`Active Attempts:       ${attemptsCount.rows[0].count} (Quiz Attempts)`);
    console.log(`Grade Items Seeded:    ${gradesCount.rows[0].count} (Gradebook Items)`);
    console.log(`Forum Threads:         ${forumsCount.rows[0].count} (Discussion Forums)`);
    console.log('============================================================\n');

  } catch (err) {
    logger.error({ err: err?.message || err }, '[DB Seed] Failed to execute catalog seed');
    console.error('❌ SEED FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

runSeed().catch((err) => {
  console.error('Fatal seeder error:', err);
  process.exit(1);
});
