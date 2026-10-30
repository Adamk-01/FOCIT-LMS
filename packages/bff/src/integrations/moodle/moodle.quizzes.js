/**
 * FOCIT LMS - Moodle Quizzes & Question Bank Synchronization Service
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { callMoodleAPI } from './moodle.client.js';
import { pool } from '../../db/index.js';
import { logger } from '../../lib/logger.js';

export async function syncFocitQuizToMoodle(focitQuizId) {
  const lockClient = await pool.connect();

  try {
    // 1. Serialize concurrent sync executions for the same quiz via session-level advisory lock
    await lockClient.query('SELECT pg_advisory_lock(hashtext($1))', [focitQuizId]);

    // Finding 1: Run all synchronization queries on the reserved client connection
    const quizRes = await lockClient.query(`
      SELECT q.*, c.moodle_course_id, c.code AS course_code, c.title AS course_title
      FROM quizzes q
      JOIN courses c ON c.course_id = q.course_id
      WHERE q.quiz_id = $1 LIMIT 1
    `, [focitQuizId]);

    if (quizRes.rows.length === 0) {
      throw new Error(`Quiz ${focitQuizId} not found`);
    }

    const quiz = quizRes.rows[0];
    let moodleCourseId = quiz.moodle_course_id;

    if (!moodleCourseId) {
      const mapRes = await lockClient.query(
        `SELECT moodle_course_id FROM moodle_course_mappings WHERE focit_course_id = $1 LIMIT 1`,
        [quiz.course_id]
      );
      moodleCourseId = mapRes.rows[0]?.moodle_course_id;
    }

    if (!moodleCourseId) {
      throw new Error(`Cannot sync quiz ${focitQuizId}: course ${quiz.course_id} is not mapped to any Moodle course`);
    }

    // 2. Check existing mapping on the reserved client
    const moodleQuizMappingRes = await lockClient.query(
      `SELECT * FROM moodle_quiz_mappings WHERE focit_quiz_id = $1 LIMIT 1`,
      [focitQuizId]
    );

    let moodleQuizId = moodleQuizMappingRes.rows[0]?.moodle_quiz_id;
    let moodleCmid = moodleQuizMappingRes.rows[0]?.moodle_cmid;

    if (!moodleQuizId) {
      // Idempotency probe: Check if quiz was already created in Moodle to prevent duplicates on retries
      try {
        const existingQuizzes = await callMoodleAPI('mod_quiz_get_quizzes_by_courses', {
          courseids: [moodleCourseId],
        }, 'GET');
        const match = existingQuizzes?.quizzes?.find((mq) => mq.name === quiz.title);
        if (match) {
          moodleQuizId = match.id;
          moodleCmid = match.coursemodule;
          logger.info({ focitQuizId, moodleQuizId, moodleCmid }, '[MoodleQuizSync] Recovered existing Moodle quiz on retry');
          await lockClient.query(`
            INSERT INTO moodle_quiz_mappings (focit_quiz_id, moodle_quiz_id, moodle_course_id, moodle_cmid, sync_status, last_synced_at)
            VALUES ($1, $2, $3, $4, 'SYNCED', NOW())
            ON CONFLICT (focit_quiz_id) DO UPDATE SET
              moodle_quiz_id = EXCLUDED.moodle_quiz_id,
              moodle_course_id = EXCLUDED.moodle_course_id,
              moodle_cmid = EXCLUDED.moodle_cmid,
              sync_status = 'SYNCED',
              last_synced_at = NOW();
          `, [focitQuizId, moodleQuizId, moodleCourseId, moodleCmid]);
        }
      } catch (probeErr) {
        logger.warn({ probeErr: probeErr?.message }, '[MoodleQuizSync] Pre-creation quiz probe failed; proceeding with creation');
      }
    }

    if (!moodleQuizId) {
      logger.info({ focitQuizId, title: quiz.title, moodleCourseId }, '[MoodleQuizSync] Creating quiz in Moodle');

      // Finding 3: Record PENDING sync intent so partial/stranded operations are recoverable
      await lockClient.query(`
        INSERT INTO moodle_quiz_mappings (focit_quiz_id, moodle_course_id, sync_status, last_synced_at)
        VALUES ($1, $2, 'PENDING', NOW())
        ON CONFLICT (focit_quiz_id) DO UPDATE SET
          moodle_course_id = EXCLUDED.moodle_course_id,
          sync_status = 'PENDING',
          last_synced_at = NOW()
        WHERE moodle_quiz_mappings.moodle_quiz_id IS NULL;
      `, [focitQuizId, moodleCourseId]);

      const moodleQuizData = await callMoodleAPI('mod_quiz_add_quiz', {
        courseid: moodleCourseId,
        name: quiz.title,
        intro: quiz.description || '',
        timelimit: (quiz.duration_minutes || 30) * 60,
        timeopen: quiz.window_open_at ? Math.floor(new Date(quiz.window_open_at).getTime() / 1000) : 0,
        timeclose: quiz.window_close_at ? Math.floor(new Date(quiz.window_close_at).getTime() / 1000) : 0,
      }, 'POST');

      moodleQuizId = moodleQuizData.quizid || moodleQuizData.id;
      moodleCmid = moodleQuizData.cmid;

      if (!moodleQuizId || !moodleCmid) {
        throw new Error(`Failed to create quiz in Moodle: invalid response ${JSON.stringify(moodleQuizData)}`);
      }

      await lockClient.query(`
        INSERT INTO moodle_quiz_mappings (focit_quiz_id, moodle_quiz_id, moodle_course_id, moodle_cmid, sync_status, last_synced_at)
        VALUES ($1, $2, $3, $4, 'SYNCED', NOW())
        ON CONFLICT (focit_quiz_id) DO UPDATE SET
          moodle_quiz_id = EXCLUDED.moodle_quiz_id,
          moodle_course_id = EXCLUDED.moodle_course_id,
          moodle_cmid = EXCLUDED.moodle_cmid,
          sync_status = 'SYNCED',
          last_synced_at = NOW();
      `, [focitQuizId, moodleQuizId, moodleCourseId, moodleCmid]);
    }

    // 3. Stepwise Idempotent Question Sync on the reserved client
    const questionsRes = await lockClient.query(`
      SELECT * FROM quiz_questions WHERE quiz_id = $1 ORDER BY question_number ASC
    `, [focitQuizId]);

    let syncedQuestionsCount = 0;

    for (const q of questionsRes.rows) {
      const qMapRes = await lockClient.query(
        `SELECT * FROM moodle_question_mappings WHERE focit_question_id = $1 LIMIT 1`,
        [q.question_id]
      );

      if (qMapRes.rows.length === 0) {
        // Replicate question to Moodle Question Bank
        const qData = await callMoodleAPI('core_question_create_questions', {
          courseid: moodleCourseId,
          questions: [{
            name: `Q${q.question_number}: ${quiz.course_code}`,
            questiontext: q.prompt,
            qtype: q.type === 'TRUE_FALSE' ? 'truefalse' : q.type === 'SHORT_ANSWER' ? 'shortanswer' : 'multichoice',
            defaultmark: Number(q.points) || 1.0,
            options: q.options,
            correct_option_id: q.correct_option_id,
          }],
        }, 'POST');

        const moodleQId = qData.questionids?.[0];
        if (!moodleQId) {
          throw new Error(`Failed to create question in Moodle: invalid response ${JSON.stringify(qData)}`);
        }

        // Link question to Moodle Quiz
        await callMoodleAPI('mod_quiz_add_question_to_quiz', {
          quizid: moodleQuizId,
          questionid: moodleQId,
        }, 'POST');

        // Persist mapping immediately on reserved client so any future retry will not re-create this question
        await lockClient.query(`
          INSERT INTO moodle_question_mappings (focit_question_id, moodle_question_id, moodle_quiz_id, sync_status, last_synced_at)
          VALUES ($1, $2, $3, 'SYNCED', NOW())
          ON CONFLICT (focit_question_id) DO UPDATE SET
            moodle_question_id = EXCLUDED.moodle_question_id,
            moodle_quiz_id = EXCLUDED.moodle_quiz_id,
            sync_status = 'SYNCED',
            last_synced_at = NOW();
        `, [q.question_id, moodleQId, moodleQuizId]);

        syncedQuestionsCount++;
      } else {
        syncedQuestionsCount++;
      }
    }

    return {
      status: 'SYNCED',
      moodleQuizId,
      moodleCmid,
      syncedQuestionsCount,
      totalQuestions: questionsRes.rows.length,
    };
  } finally {
    // Finding 2: Discard client if advisory unlock fails to prevent returning locked connection to pool
    try {
      await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [focitQuizId]);
      lockClient.release();
    } catch (unlockErr) {
      logger.error({ err: unlockErr?.message || unlockErr, focitQuizId }, '[MoodleQuizSync] Advisory unlock failed, destroying client');
      lockClient.release(unlockErr);
    }
  }
}
