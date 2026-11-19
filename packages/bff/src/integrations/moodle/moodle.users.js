/**
 * FOCIT LMS - Moodle User Management Adapter
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { callMoodleAPI } from './moodle.client.js';
import { logger } from '../../lib/logger.js';

/**
 * Looks up a Moodle user by username or email.
 *
 * @param {string} field - Field to query ('username' or 'email')
 * @param {string} value - Value to match
 * @returns {Promise<any|null>} - Returns the Moodle user object or null if not found
 */
export async function getMoodleUserByField(field, value) {
  try {
    const users = await callMoodleAPI('core_user_get_users_by_field', {
      field,
      values: [value],
    });
    if (Array.isArray(users) && users.length > 0) {
      return users[0];
    }
    return null;
  } catch (err) {
    if (err.errorCode === 'usernotfound') {
      return null;
    }
    throw err;
  }
}

/**
 * Provisions a new user in Moodle via core_user_create_users.
 *
 * @param {object} userData
 * @param {string} userData.username - Canonical username (e.g. 'focit_2024_0104')
 * @param {string} userData.firstname - Student first name
 * @param {string} userData.lastname - Student surname
 * @param {string} userData.email - Student email address
 * @param {string} [userData.password] - Temporary institutional password
 * @returns {Promise<number>} - Returned integer Moodle User ID
 */
export async function createMoodleUser({ username, firstname, lastname, email, password = 'FocitTemp@2026!' }) {
  const payload = {
    users: [
      {
        username: username.toLowerCase().replace(/[^a-z0-9_.-]/g, '_'),
        firstname: firstname || 'Student',
        lastname: lastname || username,
        email: email || `${username}@focit.uniosun.edu.ng`,
        password,
        auth: 'manual',
      },
    ],
  };

  logger.info({ username, email }, '[MoodleUser] Provisioning Moodle user record');
  const response = await callMoodleAPI('core_user_create_users', payload, 'POST');

  if (!Array.isArray(response) || response.length === 0 || !response[0]?.id) {
    throw new Error(`Unexpected Moodle user creation response: ${JSON.stringify(response)}`);
  }

  const moodleUserId = response[0].id;
  logger.info({ username, moodleUserId }, '[MoodleUser] Moodle user provisioned successfully');
  return moodleUserId;
}
