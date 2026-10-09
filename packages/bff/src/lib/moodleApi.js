/**
 * Moodle Web Services API Wrapper
 *
 * Typed wrappers around raw Moodle REST API calls.
 * All requests go through the Undici Pool (moodlePool).
 * The wstoken is injected server-side — never exposed to the client.
 */

import moodlePool from './moodlePool.js';
import config from '../config.js';

/**
 * Custom error class for Moodle API failures.
 */
export class MoodleAPIError extends Error {
  constructor(message, httpStatus, wsfunction, errorCode) {
    super(message);
    this.name = 'MoodleAPIError';
    this.httpStatus = httpStatus;
    this.wsfunction = wsfunction;
    this.errorCode = errorCode;
  }
}

/**
 * Make a Moodle Web Services API call using the Undici pool.
 * Implements the explicit trap for Moodle's legacy fake "200 OK" application errors.
 */
export async function callMoodleAPI(wsfunction, params = {}, signal) {
  const query = new URLSearchParams({
    wstoken: config.moodle.wsToken,
    wsfunction,
    moodlewsrestformat: 'json',
    ...params,
  });

  const { statusCode, body } = await moodlePool.request({
    path: `/webservice/rest/server.php?${query.toString()}`,
    method: 'GET',
    signal,
  });

  const responseText = await body.text();

  if (statusCode !== 200) {
    throw new MoodleAPIError(
      `Moodle returned HTTP ${statusCode}`,
      statusCode,
      wsfunction
    );
  }

  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new MoodleAPIError(
      `Moodle returned non-JSON response`,
      statusCode,
      wsfunction
    );
  }

  // EXPLICIT TRAP: Moodle's fake "200 OK" exceptions
  // Moodle returns an object with an "exception" property on failure, despite the 200 status.
  if (result && result.exception) {
    throw new MoodleAPIError(
      `${result.errorcode}: ${result.message}`,
      200, // It was a 200 OK, but we caught the application error
      wsfunction,
      result.errorcode
    );
  }

  return result;
}

/**
 * Fetch course contents and apply the O(N) flatMap transformation.
 */
export async function getCourseContents(courseId, signal) {
  const rawSections = await callMoodleAPI(
    'core_course_get_contents',
    { courseid: String(courseId) },
    signal
  );

  return transformAndSanitizeSections(rawSections);
}

/**
 * O(N) Data Transformation Pipeline
 * Extracts materials from modules and flattens folder contents.
 * Strips the wstoken by generating a safe proxy URL.
 */
function transformAndSanitizeSections(sections) {
  if (!Array.isArray(sections)) return [];

  return sections.map(section => {
    if (!Array.isArray(section.modules)) return null;

    // The O(N) FlatMap: Iterates over modules and contents in a single continuous pass
    const materials = section.modules
      .filter(mod => mod.visible === 1 && ['resource', 'url', 'folder'].includes(mod.modname))
      .flatMap(mod => {
        if (!Array.isArray(mod.contents)) return [];
        
        return mod.contents.map(file => ({
          // Composite key ensures stable DOM reconciliation in React
          id: `${mod.id}-${file.filename}`,
          moduleId: mod.id,
          // Use filename for folders, module name for single resources
          name: mod.modname === 'folder' ? file.filename : mod.name,
          type: file.mimetype === 'application/pdf' ? 'pdf' : (file.type || 'unknown'),
          // The proxy URL (safe, no wstoken), except for external URLs which stay intact
          url: mod.modname === 'url' 
            ? file.fileurl 
            : `/api/files/${mod.id}/${encodeURIComponent(file.filename)}`,
          sizeBytes: file.filesize || 0
        }));
      });

    // Drop sections that have no visible materials
    return materials.length > 0 
      ? { id: section.id, title: section.name, materials } 
      : null;
      
  }).filter(Boolean);
}
