/**
 * FOCIT LMS - Course Representative Data Ingestion Engine
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. Zero-Trust Ingress Sanitization & Canonicalization (Matric numbers, Names, Emails)
 * 2. Invariant 3: Dijkstra Resource Ordering (Lexicographical sorting prior to lock acquisition)
 * 3. Atomic Bulk Upsert + Outbox CTE with Quarantined FAILED Outbox Resurrection (Catch 1)
 * 4. Authoritative upserted_students Identity Propagation & Auth Credential Bootstrap (Catch 2)
 * 5. Full-Spectrum Timetable Collision Engine (Intra-batch & DB-level room/cohort clashes) (Catch 3)
 */

import { pool } from '../db/index.js';
import { hashPassword } from '../lib/passwords.js';
import { logger } from '../lib/logger.js';
import { canonicalizeMatricNumber } from '../utils/matricNormalizer.js';

export const INSTITUTIONAL_PROGRAMMES = new Set([
  'BSC_CSC', // Computer Science
  'BSC_CYS', // Cyber Security
  'BSC_SEN', // Software Engineering
  'BSC_DSC', // Data Science
  'BSC_IFS', // Information Systems
  'BSC_IFT', // Information Technology
  'BSC_LIS', // Library and Information Science
]);

export class IngestionService {
  /**
   * Canonicalizes and validates raw matriculation numbers from spreadsheets.
   * Handles loose inputs: '2024/0042', 'focit-2024-0042', 'FOCIT/2024/0042', etc.
   *
   * @param {string} raw
   * @returns {string} Normalized institutional matric number (e.g., 'FOCIT/2024/0042')
   */
  normalizeMatricNumber(raw) {
    if (!raw || typeof raw !== 'string') {
      throw new Error('Matriculation number is required');
    }

    const { valid, value } = canonicalizeMatricNumber(raw);
    if (!valid) {
      throw new Error(`Invalid matriculation number format: "${raw}". Expected Senate Standard YYYY/NNNNN (e.g. 2024/28682)`);
    }

    return value;
  }

  /**
   * Generates a deterministic, URL-safe internal student ID from matric number.
   * Example: 'FOCIT/2024/0042' -> 'focit_2024_0042'
   *
   * @param {string} matricNumber
   * @returns {string}
   */
  canonicalizeStudentId(matricNumber) {
    return matricNumber.toLowerCase().replace(/[^a-z0-9]/g, '_');
  }

  /**
   * Validates and normalizes an entire student cohort batch before database execution.
   *
   * @param {Array<object>} rawCohort
   * @param {object} [defaultContext]
   * @returns {{ validBatch: Array<object>, errors: Array<object> }}
   */
  sanitizeStudentBatch(rawCohort, defaultContext = {}) {
    if (!Array.isArray(rawCohort) || rawCohort.length === 0) {
      throw new Error('Ingestion payload must be a non-empty array of student records');
    }

    const validBatch = [];
    const errors = [];
    const seenMatricNumbers = new Set();

    rawCohort.forEach((item, index) => {
      try {
        const rowNumber = index + 1;
        const rawMatric = item.matric_number || item.matricNo || item.matric;
        const normalizedMatric = this.normalizeMatricNumber(rawMatric);

        if (seenMatricNumbers.has(normalizedMatric)) {
          throw new Error(`Duplicate matriculation number within batch: ${normalizedMatric}`);
        }
        seenMatricNumbers.add(normalizedMatric);

        const fullName = (item.full_name || item.name || '').trim();
        if (!fullName || fullName.length < 3) {
          throw new Error(`Student full name missing or too short (row ${rowNumber})`);
        }

        const programmeId = (item.programme_id || item.programme || defaultContext.programme_id || '').trim().toUpperCase();
        if (!INSTITUTIONAL_PROGRAMMES.has(programmeId)) {
          throw new Error(`Invalid programme code: "${programmeId}". Allowed: ${Array.from(INSTITUTIONAL_PROGRAMMES).join(', ')}`);
        }

        const level = parseInt(item.level || defaultContext.level || 200, 10);
        if (![100, 200, 300, 400].includes(level)) {
          throw new Error(`Invalid academic level: "${level}". Allowed: 100, 200, 300, 400`);
        }

        const studentId = item.student_id || this.canonicalizeStudentId(normalizedMatric);
        const email = (item.email || `${studentId}@focit.uniosun.edu.ng`).trim().toLowerCase();
        const username = (item.username || studentId).trim().toLowerCase();

        validBatch.push({
          student_id: studentId,
          matric_number: normalizedMatric,
          username,
          full_name: fullName,
          email,
          programme_id: programmeId,
          level,
        });
      } catch (err) {
        errors.push({
          row: index + 1,
          record: item,
          reason: err.message,
        });
      }
    });

    return { validBatch, errors };
  }

  /**
   * Ingests a cohort batch into the database using Dijkstra Resource Ordering
   * and atomic CTE outbox enqueuing with FAILED event resurrection.
   *
   * @param {Array<object>} rawCohort
   * @param {object} [context]
   * @returns {Promise<object>} Reconciliation report
   */
  async ingestCohort(rawCohort, context = {}) {
    const { validBatch, errors } = this.sanitizeStudentBatch(rawCohort, context);

    if (validBatch.length === 0) {
      return {
        success: false,
        totalSubmitted: rawCohort.length,
        processedCount: 0,
        insertedCount: 0,
        updatedCount: 0,
        outboxEnqueuedCount: 0,
        errors,
      };
    }

    // Invariant 3: Dijkstra Resource Ordering on Ingress
    // Strictly sort by matric_number ASC in Node.js before database lock acquisition
    validBatch.sort((a, b) => a.matric_number.localeCompare(b.matric_number));

    // Generate standard initial password hash for student profile bootstrap
    const defaultPassword = context.defaultPassword || 'Welcome@FOCIT2026';
    const initialPasswordHash = await hashPassword(defaultPassword);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Execute Single Atomic Ingestion CTE (Catch 1 & Catch 2)
      const query = `
        WITH raw_batch AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
            student_id VARCHAR(64),
            matric_number VARCHAR(32),
            username VARCHAR(64),
            full_name VARCHAR(128),
            email VARCHAR(128),
            programme_id VARCHAR(32),
            level INT
          )
        ),
        upserted_students AS (
          INSERT INTO students (
            student_id, 
            matric_number, 
            username, 
            full_name, 
            email, 
            programme_id, 
            level
          )
          SELECT 
            student_id, 
            matric_number, 
            username, 
            full_name, 
            email, 
            programme_id, 
            level
          FROM raw_batch
          ORDER BY matric_number ASC -- Dijkstra Row Locking Order
          ON CONFLICT (matric_number) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            email = EXCLUDED.email,
            programme_id = EXCLUDED.programme_id,
            level = EXCLUDED.level
          RETURNING student_id, matric_number, full_name, email, (xmax = 0) AS is_new_record
        ),
        bootstrap_profiles AS (
          -- Initialize credentials strictly for new students; existing students keep passwords
          INSERT INTO student_profiles (student_id, password_hash, must_change_password)
          SELECT us.student_id, $2, TRUE
          FROM upserted_students us
          ON CONFLICT (student_id) DO NOTHING
        ),
        enqueued_outbox AS (
          -- Catch 1 & Catch 2: Query from upserted_students to ensure true student_id binding,
          -- and resurrect FAILED events with the newly corrected payload
          INSERT INTO integration_outbox_events (
            aggregate_type,
            aggregate_id,
            event_type,
            payload,
            idempotency_key
          )
          SELECT 
            'STUDENT',
            us.student_id,
            'USER_PROVISION_REQUESTED',
            jsonb_build_object(
              'student_id', us.student_id,
              'matric_number', us.matric_number,
              'full_name', us.full_name,
              'email', us.email
            ),
            'moodle_provision:' || us.student_id
          FROM upserted_students us
          LEFT JOIN moodle_user_mappings m 
            ON m.focit_user_id = us.student_id 
           AND m.sync_status = 'SYNCED'
          WHERE m.focit_user_id IS NULL
          ON CONFLICT (idempotency_key) DO UPDATE SET
            status = 'PENDING',
            payload = EXCLUDED.payload,
            delivery_attempts = 0,
            locked_until = NULL,
            last_error = NULL,
            updated_at = NOW()
          WHERE integration_outbox_events.status = 'FAILED'
          RETURNING event_id, aggregate_id
        )
        SELECT 
          (SELECT COUNT(*) FROM upserted_students WHERE is_new_record = TRUE)::int AS inserted_count,
          (SELECT COUNT(*) FROM upserted_students WHERE is_new_record = FALSE)::int AS updated_count,
          (SELECT COUNT(*) FROM enqueued_outbox)::int AS outbox_enqueued_count;
      `;

      const { rows } = await client.query(query, [JSON.stringify(validBatch), initialPasswordHash]);
      await client.query('COMMIT');

      const stats = rows[0] || { inserted_count: 0, updated_count: 0, outbox_enqueued_count: 0 };

      logger.info(
        { batchSize: validBatch.length, ...stats, errorCount: errors.length },
        '[IngestionService] Cohort ingestion transaction committed successfully'
      );

      return {
        success: true,
        totalSubmitted: rawCohort.length,
        processedCount: validBatch.length,
        insertedCount: stats.inserted_count,
        updatedCount: stats.updated_count,
        outboxEnqueuedCount: stats.outbox_enqueued_count,
        errors,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err: err?.message || err }, '[IngestionService] Cohort ingestion transaction failed');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Ingests and validates academic timetable schedules from Course Reps.
   * Enforces intra-batch and database-level collision detection (Catch 3).
   *
   * @param {Array<object>} rawSlots
   * @returns {Promise<object>}
   */
  async ingestTimetableSchedule(rawSlots) {
    if (!Array.isArray(rawSlots) || rawSlots.length === 0) {
      throw new Error('Timetable payload must be a non-empty array of schedule slots');
    }

    // Sanitize slot formats
    const candidateSlots = rawSlots.map((slot, idx) => {
      const courseId = (slot.course_id || slot.courseId || '').trim();
      const roomId = slot.room_id !== undefined ? (slot.room_id ? parseInt(slot.room_id, 10) : null) : null;
      const dayOfWeek = parseInt(slot.day_of_week !== undefined ? slot.day_of_week : slot.dayOfWeek, 10);
      const duration = parseInt(slot.duration_minutes || slot.duration || 60, 10);
      let startTime = (slot.start_time || slot.startTime || '09:00:00').trim();

      if (/^\d{1,2}:\d{2}$/.test(startTime)) {
        startTime = `${startTime}:00`;
      }

      if (!courseId) {
        throw new Error(`Schedule item at index ${idx} missing course_id`);
      }
      if (isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
        throw new Error(`Schedule item ${courseId} has invalid day_of_week (must be 0-6)`);
      }
      if (duration < 30 || duration > 240) {
        throw new Error(`Schedule item ${courseId} duration must be between 30 and 240 minutes`);
      }

      return {
        course_id: courseId,
        room_id: roomId,
        day_of_week: dayOfWeek,
        start_time: startTime,
        duration_minutes: duration,
      };
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Comprehensive Collision Detection CTE (Catch 3: Inter-DB + Intra-Batch Collisions)
      const clashCheckQuery = `
        WITH candidate_slots AS (
          SELECT 
            course_id,
            room_id,
            day_of_week,
            start_time::time AS start_t,
            (start_time::time + make_interval(mins => duration_minutes::int))::time AS end_t,
            duration_minutes
          FROM jsonb_to_recordset($1::jsonb) AS x(
            course_id VARCHAR(32),
            room_id INT,
            day_of_week INT,
            start_time TIME,
            duration_minutes INT
          )
        ),
        detected_clashes AS (
          -- 1. DB-Level Physical Venue Collision (Two classes in same hall)
          SELECT 
            cs.course_id AS candidate_course,
            cs.room_id,
            cs.day_of_week,
            cs.start_t AS proposed_start,
            cs.end_t AS proposed_end,
            t.course_id AS conflicting_course,
            t.start_time AS existing_start,
            (t.start_time + make_interval(mins => t.duration_minutes::int))::time AS existing_end,
            'PHYSICAL_VENUE_OVERBOOKED' AS violation_code
          FROM candidate_slots cs
          JOIN academic_timetable t 
            ON t.day_of_week = cs.day_of_week 
           AND t.room_id = cs.room_id
           AND cs.room_id IS NOT NULL
           AND (cs.start_t < (t.start_time + make_interval(mins => t.duration_minutes::int))::time
                AND t.start_time < cs.end_t)

          UNION ALL

          -- 2. DB-Level Cohort Curriculum Collision (Same level & department compulsory courses)
          SELECT 
            cs.course_id AS candidate_course,
            cs.room_id,
            cs.day_of_week,
            cs.start_t AS proposed_start,
            cs.end_t AS proposed_end,
            t.course_id AS conflicting_course,
            t.start_time AS existing_start,
            (t.start_time + make_interval(mins => t.duration_minutes::int))::time AS existing_end,
            'COHORT_CURRICULUM_CLASH' AS violation_code
          FROM candidate_slots cs
          JOIN courses c_cand ON c_cand.course_id = cs.course_id
          JOIN academic_timetable t ON t.day_of_week = cs.day_of_week
          JOIN courses c_exist ON c_exist.course_id = t.course_id
          WHERE c_cand.department_id = c_exist.department_id
            AND c_cand.level = c_exist.level
            AND c_cand.category = 'CORE' 
            AND c_exist.category = 'CORE'
            AND c_cand.course_id != c_exist.course_id
            AND (cs.start_t < (t.start_time + make_interval(mins => t.duration_minutes::int))::time
                 AND t.start_time < cs.end_t)

          UNION ALL

          -- 3. Intra-Batch Venue & Curriculum Self-Collisions (Catch 3)
          SELECT 
            cs1.course_id AS candidate_course,
            cs1.room_id,
            cs1.day_of_week,
            cs1.start_t AS proposed_start,
            cs1.end_t AS proposed_end,
            cs2.course_id AS conflicting_course,
            cs2.start_t AS existing_start,
            cs2.end_t AS existing_end,
            CASE 
              WHEN cs1.room_id = cs2.room_id AND cs1.room_id IS NOT NULL THEN 'INTRA_BATCH_ROOM_CLASH'
              ELSE 'INTRA_BATCH_COHORT_CLASH'
            END AS violation_code
          FROM candidate_slots cs1
          JOIN candidate_slots cs2 
            ON cs1.course_id < cs2.course_id 
           AND cs1.day_of_week = cs2.day_of_week
           AND (cs1.start_t < cs2.end_t AND cs2.start_t < cs1.end_t)
          LEFT JOIN courses c1 ON c1.course_id = cs1.course_id
          LEFT JOIN courses c2 ON c2.course_id = cs2.course_id
          WHERE 
            (cs1.room_id = cs2.room_id AND cs1.room_id IS NOT NULL)
            OR (c1.department_id = c2.department_id AND c1.level = c2.level AND c1.category = 'CORE' AND c2.category = 'CORE')
        )
        SELECT * FROM detected_clashes;
      `;

      const clashResult = await client.query(clashCheckQuery, [JSON.stringify(candidateSlots)]);

      if (clashResult.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          success: false,
          code: 'TIMETABLE_CLASH_DETECTED',
          clashes: clashResult.rows,
        };
      }

      // No collisions: Insert schedule entries
      for (const slot of candidateSlots) {
        await client.query(`
          INSERT INTO academic_timetable (
            course_id, lecturer_id, room_id, first_occurrence_start, duration_minutes, rrule, day_of_week, start_time
          )
          VALUES ($1, 1, $2, NOW(), $3, 'FREQ=WEEKLY;COUNT=14', $4, $5);
        `, [slot.course_id, slot.room_id, slot.duration_minutes, slot.day_of_week, slot.start_time]);
      }

      await client.query('COMMIT');

      logger.info({ insertedSlots: candidateSlots.length }, '[IngestionService] Timetable schedule committed');
      return {
        success: true,
        insertedCount: candidateSlots.length,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err: err?.message || err }, '[IngestionService] Timetable ingestion failed');
      throw err;
    } finally {
      client.release();
    }
  }
}

export const ingestionService = new IngestionService();
