/**
 * FOCIT LMS - Moodle Enrolments Adapter
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { callMoodleAPI } from './moodle.client.js';
import { logger } from '../../lib/logger.js';

/**
 * Enrols a user in a Moodle course via enrol_manual_enrol_users.
 *
 * @param {object} params
 * @param {number} params.moodleUserId - Moodle Integer User ID
 * @param {number} params.moodleCourseId - Moodle Integer Course ID
 * @param {number} [params.roleId=5] - Moodle Role ID (5 = Student)
 * @returns {Promise<boolean>}
 */
export async function enrolUserInCourse({ moodleUserId, moodleCourseId, roleId = 5 }) {
  if (!moodleUserId || !moodleCourseId) {
    throw new Error(`Enrolment requires valid integer moodleUserId (${moodleUserId}) and moodleCourseId (${moodleCourseId})`);
  }

  const payload = {
    enrolments: [
      {
        roleid: roleId,
        userid: parseInt(moodleUserId, 10),
        courseid: parseInt(moodleCourseId, 10),
      },
    ],
  };

  logger.info({ moodleUserId, moodleCourseId, roleId }, '[MoodleEnrol] Calling enrol_manual_enrol_users');
  try {
    await callMoodleAPI('enrol_manual_enrol_users', payload, 'POST');
    logger.info({ moodleUserId, moodleCourseId }, '[MoodleEnrol] Manual enrolment confirmed');
    return true;
  } catch (err) {
    // Idempotency trap: Moodle throws if user is already enrolled in course
    if (err.errorCode === 'wsclienterror' || err.message?.toLowerCase().includes('already enrolled')) {
      logger.warn({ moodleUserId, moodleCourseId }, '[MoodleEnrol] User already enrolled in course; idempotent success');
      return true;
    }
    throw err;
  }
}
