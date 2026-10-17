/**
 * FOCIT LMS - Academic Cohort CLI Ingestion Runner
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Usage:
 *   node src/scripts/ingestCohort.js --file <path_to_json> [--programme <programme_id>] [--level <level>]
 *
 * Example:
 *   node src/scripts/ingestCohort.js --file ./scratch/csc_200l.json --programme BSC_CSC --level 200
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import { ingestionService } from '../services/ingestionService.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--file' && args[i + 1]) {
      options.file = args[i + 1];
      i++;
    } else if (args[i] === '--programme' && args[i + 1]) {
      options.programme_id = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === '--level' && args[i + 1]) {
      options.level = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return options;
}

async function run() {
  const options = parseArgs();

  if (!options.file) {
    console.error('\n❌ Usage: node src/scripts/ingestCohort.js --file <path_to_json> [--programme <id>] [--level <level>]\n');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), options.file);
  console.log(`\n📂 Reading cohort payload from: ${resolvedPath}`);

  let fileContent;
  try {
    fileContent = await fs.readFile(resolvedPath, 'utf8');
  } catch (err) {
    console.error(`❌ Failed to read file: ${err.message}`);
    process.exit(1);
  }

  let cohortData;
  try {
    cohortData = JSON.parse(fileContent);
  } catch (err) {
    console.error(`❌ Invalid JSON format: ${err.message}`);
    process.exit(1);
  }

  const rawList = Array.isArray(cohortData) ? cohortData : (cohortData.students || cohortData.cohort || []);

  console.log(`📋 Found ${rawList.length} candidate student record(s). Commencing ingestion transaction...\n`);

  try {
    const report = await ingestionService.ingestCohort(rawList, {
      programme_id: options.programme_id,
      level: options.level,
    });

    console.log('============================================================');
    console.log('✅ ACADEMIC COHORT INGESTION RECONCILIATION REPORT');
    console.log('============================================================');
    console.log(`Total Submitted:         ${report.totalSubmitted}`);
    console.log(`Successfully Processed:  ${report.processedCount}`);
    console.log(`New Students Inserted:   ${report.insertedCount}`);
    console.log(`Existing Students Updated: ${report.updatedCount}`);
    console.log(`Moodle Outbox Enqueued:  ${report.outboxEnqueuedCount}`);
    console.log(`Validation Rejections:   ${report.errors.length}`);
    console.log('============================================================\n');

    if (report.errors.length > 0) {
      console.warn('⚠️  REJECTED INGRESS ROWS (Sanitization Boundary Triggered):');
      report.errors.forEach((e) => {
        console.warn(`  - Row ${e.row}: [${e.record?.matric_number || 'UNKNOWN'}] -> ${e.reason}`);
      });
      console.log('\n');
    }

  } catch (err) {
    console.error(`\n❌ Ingestion transaction aborted: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
    redis.disconnect();
  }
}

run();
