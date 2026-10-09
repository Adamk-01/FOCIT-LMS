/**
 * Global Error Handler Middleware
 *
 * Catches all uncaught errors from route handlers and middleware.
 * Maps known error types to appropriate HTTP responses.
 * Never leaks stack traces or internal details to the client.
 */

import { MoodleAPIError } from '../lib/moodleApi.js';
import config from '../config.js';
import { logger } from '../lib/logger.js';

export function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    return _next(err);
  }

  // === Moodle API Errors ===
  if (err instanceof MoodleAPIError) {
    logger.error({ 
      function: err.wsfunction, 
      errorCode: err.errorCode, 
      message: err.message 
    }, 'Moodle API Error');
    
    return res.status(502).json({
      error: 'The learning management system is temporarily unavailable.',
      code: 'MOODLE_UPSTREAM_ERROR',
    });
  }

  // === Undici Connection Errors ===
  if (err.code === 'UND_ERR_CONNECT_TIMEOUT') {
    logger.error({ err_message: err.message }, 'Moodle connection timed out');
    return res.status(503)
      .set('Retry-After', '10')
      .json({
        error: 'The learning management system is not responding. Please try again.',
        code: 'MOODLE_UNREACHABLE',
        retryAfter: 10,
      });
  }

  if (err.code === 'UND_ERR_HEADERS_TIMEOUT') {
    logger.error({ err_message: err.message }, 'Moodle headers timeout');
    return res.status(504).json({
      error: 'The learning management system is responding too slowly.',
      code: 'MOODLE_GATEWAY_TIMEOUT',
    });
  }

  // === Abort Errors (client disconnected) ===
  if (err.name === 'AbortError') {
    return;
  }

  // === Validation Errors ===
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: err.message,
      code: 'VALIDATION_ERROR',
    });
  }

  // === Unknown Errors ===
  logger.error({ 
    err_name: err.name, 
    err_message: err.message,
    stack: config.nodeEnv === 'development' ? err.stack : undefined
  }, 'Unhandled Server Error');

  return res.status(500).json({
    error: 'An unexpected error occurred.',
    code: 'INTERNAL_SERVER_ERROR',
    ...(config.nodeEnv === 'development' && { detail: err.message }),
  });
}
