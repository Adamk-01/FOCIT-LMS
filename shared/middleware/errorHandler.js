/**
 * Global Error Handler Middleware
 *
 * Catches all uncaught errors from route handlers and middleware.
 * Maps known error types to appropriate HTTP responses.
 * Never leaks stack traces or internal details to the client.
 */

import crypto from 'node:crypto';
import { MoodleAPIError } from '../lib/moodleApi.js';
import config from '../config.js';
import { logger } from '../lib/logger.js';

const CONSTRAINT_MAP = {
  // === Check Constraints (23514) ===
  'chk_max_credit_limit_24': {
    status: 422,
    code: 'MAX_CREDIT_CEILING_EXCEEDED',
    title: 'Academic Credit Ceiling Exceeded',
    detail: 'The proposed semester registration exceeds the 24-unit ceiling approved by the University Senate.',
    maxCeiling: 24,
  },
  'chk_min_credit_limit_15': {
    status: 422,
    code: 'MIN_CREDIT_FLOOR_VIOLATION',
    title: 'Minimum Credit Floor Required',
    detail: 'A minimum of 15 registered units is required to submit your semester registration.',
    minimumRequired: 15,
  },
  'chk_course_capacity': {
    status: 409,
    code: 'COURSE_CAPACITY_EXCEEDED',
    title: 'Course Enrollment Capacity Full',
    detail: 'This course section has reached its maximum approved enrollment capacity.',
  },

  // === Unique Constraints (23505) ===
  'uq_student_course_semester': {
    status: 409,
    code: 'DUPLICATE_ENROLLMENT',
    title: 'Duplicate Course Enrollment',
    detail: 'You are already registered or enrolled in this course for the active semester.',
  },
  'uq_courses_id_code': {
    status: 409,
    code: 'COURSE_CATALOG_CONFLICT',
    title: 'Course Catalog Code Conflict',
    detail: 'A course with this identifier and code pairing already exists in the academic catalog.',
  },
  'uq_active_registration_batch': {
    status: 409,
    code: 'BATCH_ALREADY_EXISTS',
    title: 'Registration Batch Conflict',
    detail: 'An active course registration batch is already undergoing departmental review.',
  },

  // === Question Bank JSONB & Validation Constraints (23514) ===
  'chk_mcq_min_options': {
    status: 422,
    code: 'QUESTION_INSUFFICIENT_OPTIONS',
    title: 'Insufficient Question Options',
    detail: 'Multiple-choice questions require at least two distinct answer options.',
    minRequired: 2,
  },
  'chk_mcq_single_correct': {
    status: 422,
    code: 'QUESTION_INVALID_CORRECT_COUNT',
    title: 'Invalid Correct Answer Selection',
    detail: 'Single-choice questions must specify exactly one correct answer option.',
    expectedCorrect: 1,
  },
  'chk_points_positive': {
    status: 422,
    code: 'QUESTION_INVALID_POINTS',
    title: 'Invalid Question Weight',
    detail: 'Question points must be a positive integer greater than zero.',
  },
  'chk_matching_pairs_min': {
    status: 422,
    code: 'QUESTION_INSUFFICIENT_PAIRS',
    title: 'Incomplete Matching Pair Definitions',
    detail: 'Matching questions require at least two complete prompt-target pairs.',
    minRequired: 2,
  },

  // === Composite Foreign Key Constraints (23503) ===
  'fk_enrollments_course_id_code': {
    status: 422,
    code: 'CATALOG_INTEGRITY_VIOLATION',
    title: 'Academic Catalog Integrity Mismatch',
    detail: 'The specified course code does not correspond to the authoritative course record in the academic catalog.',
  },
};

export function errorHandler(err, req, res, _next) {
  if (res.headersSent) {
    return _next(err);
  }

  const correlationId = req.headers?.['x-correlation-id'] || req.id || `err_${crypto.randomUUID()}`;

  // === Moodle API Errors ===
  if (err instanceof MoodleAPIError) {
    logger.error({ 
      correlationId,
      function: err.wsfunction, 
      errorCode: err.errorCode, 
      message: err.message 
    }, 'Moodle API Error');
    
    return res.status(502).json({
      type: 'https://focit.uniosun.edu.ng/errors/moodle-upstream-error',
      title: 'Moodle Upstream Error',
      status: 502,
      error: 'The learning management system is temporarily unavailable.',
      code: 'MOODLE_UPSTREAM_ERROR',
      correlationId,
    });
  }

  // === Undici Connection Errors ===
  if (err.code === 'UND_ERR_CONNECT_TIMEOUT') {
    logger.error({ correlationId, err_message: err.message }, 'Moodle connection timed out');
    return res.status(503)
      .set('Retry-After', '10')
      .json({
        type: 'https://focit.uniosun.edu.ng/errors/moodle-unreachable',
        title: 'Moodle Gateway Unreachable',
        status: 503,
        error: 'The learning management system is not responding. Please try again.',
        code: 'MOODLE_UNREACHABLE',
        retryAfter: 10,
        correlationId,
      });
  }

  if (err.code === 'UND_ERR_HEADERS_TIMEOUT') {
    logger.error({ correlationId, err_message: err.message }, 'Moodle headers timeout');
    return res.status(504).json({
      type: 'https://focit.uniosun.edu.ng/errors/moodle-gateway-timeout',
      title: 'Moodle Gateway Timeout',
      status: 504,
      error: 'The learning management system is responding too slowly.',
      code: 'MOODLE_GATEWAY_TIMEOUT',
      correlationId,
    });
  }

  // === Abort Errors (client disconnected) ===
  if (err.name === 'AbortError') {
    return;
  }

  // === Validation Errors ===
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      type: 'https://focit.uniosun.edu.ng/errors/validation-error',
      title: 'Request Validation Error',
      status: 400,
      error: err.message,
      code: 'VALIDATION_ERROR',
      correlationId,
    });
  }

  // === PostgreSQL Concurrency & Deadlocks (40P01) & Serialization (40001) ===
  if (err.code === '40P01' || err.code === '40001') {
    logger.error({ correlationId, err_code: err.code, err_message: err.message }, 'PostgreSQL Concurrency Conflict Intercepted');
    return res.status(503).json({
      type: 'https://focit.uniosun.edu.ng/errors/deadlock-detected',
      title: 'High Portal Traffic Surge',
      status: 503,
      error: 'Service temporarily congested by concurrent transactions. Please retry.',
      detail: 'The academic portal is experiencing high concurrent traffic. Please pause a moment before retrying.',
      code: 'TRANSACTION_DEADLOCK_DETECTED',
      correlationId,
    });
  }

  // === PostgreSQL Check (23514), Unique (23505), Foreign Key (23503) Boundaries ===
  if (err.code === '23514' || err.code === '23505' || err.code === '23503') {
    const rawConstraint = err.constraint;
    const mapped = rawConstraint ? CONSTRAINT_MAP[rawConstraint] : null;

    if (mapped) {
      logger.warn({
        correlationId,
        pgCode: err.code,
        constraint: rawConstraint,
        table: err.table,
      }, '[DB Guard] Known constraint violation intercepted');

      return res.status(mapped.status).json({
        type: `https://focit.uniosun.edu.ng/errors/${mapped.code.toLowerCase().replace(/_/g, '-')}`,
        title: mapped.title,
        status: mapped.status,
        code: mapped.code,
        detail: mapped.detail,
        instance: req.originalUrl,
        correlationId,
        ...(mapped.maxCeiling !== undefined && { maxCeiling: mapped.maxCeiling }),
        ...(mapped.minimumRequired !== undefined && { minimumRequired: mapped.minimumRequired }),
        ...(mapped.minRequired !== undefined && { minRequired: mapped.minRequired }),
        ...(mapped.expectedCorrect !== undefined && { expectedCorrect: mapped.expectedCorrect }),
      });
    }

    // === UNMAPPED CONSTRAINT SAFETY NET (OWASP API8 Redaction) ===
    logger.error({
      correlationId,
      pgCode: err.code,
      unmappedConstraint: rawConstraint,
      table: err.table,
      detail: err.detail,
    }, '[DB Guard CRITICAL] Unmapped database constraint violation escaped to boundary');

    return res.status(422).json({
      type: 'https://focit.uniosun.edu.ng/errors/academic-invariant-violation',
      title: 'Academic Invariant Validation Failed',
      status: 422,
      code: 'ACADEMIC_INVARIANT_VIOLATION',
      detail: 'The requested academic record mutation violates an authoritative catalog integrity rule.',
      instance: req.originalUrl,
      correlationId,
    });
  }

  // === PostgreSQL Immutability Trigger Guard (55000) ===
  if (err.code === '55000') {
    logger.warn({ correlationId, err_code: err.code, err_message: err.message }, 'PostgreSQL Immutability Trigger Guard');
    return res.status(409).json({
      type: 'https://focit.uniosun.edu.ng/errors/object-immutability-violation',
      title: 'Record Immutability Guard',
      status: 409,
      code: 'OBJECT_IMMUTABILITY_VIOLATION',
      detail: 'Academic Integrity Violation: Attempted mutation on sealed record.',
      correlationId,
    });
  }

  // === Custom / Application Errors with HTTP Status ===
  if (err.status || err.statusCode) {
    const status = err.status || err.statusCode;
    const code = err.code || 'APPLICATION_ERROR';
    const title = err.title || (status === 404 ? 'Resource Not Found' : status === 403 ? 'Access Forbidden' : status === 401 ? 'Unauthorized' : 'Application Request Error');
    return res.status(status).json({
      type: `https://focit.uniosun.edu.ng/errors/${String(code).toLowerCase().replace(/_/g, '-')}`,
      title,
      status,
      code,
      detail: err.detail || err.message || 'An error occurred processing the request.',
      instance: req.originalUrl,
      correlationId,
      ...(err.projectedUnits !== undefined && { projectedUnits: err.projectedUnits }),
      ...(err.maxCeiling !== undefined && { maxCeiling: err.maxCeiling }),
      ...(err.minimumRequired !== undefined && { minimumRequired: err.minimumRequired }),
      ...(err.excessUnits !== undefined && { excessUnits: err.excessUnits }),
      ...(err.courseId !== undefined && { courseId: err.courseId }),
      ...(err.violations !== undefined && { violations: err.violations }),
    });
  }

  // === Unknown Server Errors ===
  logger.error({ 
    correlationId,
    err_name: err.name, 
    err_message: err.message,
    stack: config.nodeEnv === 'development' ? err.stack : undefined
  }, 'Unhandled Server Error');

  return res.status(500).json({
    type: 'https://focit.uniosun.edu.ng/errors/internal-server-error',
    title: 'Internal Server Error',
    status: 500,
    error: 'An unexpected error occurred.',
    code: 'INTERNAL_SERVER_ERROR',
    correlationId,
    ...(config.nodeEnv === 'development' && { detail: err.message }),
  });
}
