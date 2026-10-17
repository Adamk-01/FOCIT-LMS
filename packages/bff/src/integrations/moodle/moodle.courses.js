/**
 * FOCIT LMS - Moodle Courses Adapter
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { callMoodleAPI } from './moodle.client.js';

/**
 * Retrieves course contents and syllabus materials.
 *
 * @param {number|string} courseId - Moodle Course ID
 * @param {AbortSignal} [signal]
 * @returns {Promise<any[]>}
 */
export async function getCourseContents(courseId, signal) {
  return callMoodleAPI('core_course_get_contents', { courseid: String(courseId) }, 'GET', signal);
}

/**
 * Retrieves course details by field from Moodle.
 *
 * @param {string} field - 'id' or 'idnumber' or 'shortname'
 * @param {string} value
 * @returns {Promise<any|null>}
 */
export async function getMoodleCourseByField(field, value) {
  const result = await callMoodleAPI('core_course_get_courses_by_field', {
    field,
    value,
  });
  if (result?.courses && Array.isArray(result.courses) && result.courses.length > 0) {
    return result.courses[0];
  }
  return null;
}
