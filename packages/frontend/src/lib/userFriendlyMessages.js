/**
 * FOCIT LMS - User-Friendly Message & Remediation Translation Architecture
 * Standard: Zero-Trust Client & Institutional Compassion (Milestone 1)
 *
 * Implements:
 * 1. RFC 7807 Dynamic Remediation Registry (server telemetry formatting)
 * 2. Deterministic Mapping for Native Fetch Exceptions (AbortError, TypeError)
 * 3. Strict Numeric Telemetry Guarding (ECMA-262 ToBoolean Falsy-Zero Immunity)
 * 4. Backward-compatible string formatter (getUserFriendlyErrorMessage)
 */

export const REMEDIATION_REGISTRY = {
  // ── Authentication & Session ──
  INVALID_CREDENTIALS: () => ({
    title: 'Authentication Failed',
    problem: 'The Matric Number or password entered does not match university records.',
    remediation: 'Check your matric number format (e.g. 2024/28682) and re-enter your password.',
    severity: 'error',
    recoveryAction: { type: 'FOCUS_INPUT', target: 'studentId' },
  }),

  ACCOUNT_SUSPENDED: () => ({
    title: 'Account Suspended',
    problem: 'Your institutional account has been suspended by academic or administrative policy.',
    remediation: 'Please contact the Faculty Administration or your Departmental HOD to resolve your account status.',
    severity: 'error',
    recoveryAction: null,
  }),

  ACCOUNT_LOCKED: () => ({
    title: 'Account Locked',
    problem: 'Your account has been locked due to repeated security flags or institutional hold.',
    remediation: 'Please reach out to the ICT Support Desk or Faculty System Administrator for identity clearance.',
    severity: 'error',
    recoveryAction: null,
  }),

  UPSTREAM_EXPIRED: () => ({
    title: 'Session Expired',
    problem: 'Your secure session has timed out due to institutional safety policies.',
    remediation: 'Please sign in again to resume your academic tasks.',
    severity: 'warning',
    recoveryAction: { type: 'REAUTH', target: '/login' },
  }),

  JWT_EXPIRED: () => ({
    title: 'Session Expired',
    problem: 'Your authentication token has elapsed.',
    remediation: 'Please sign in again to revalidate your academic session.',
    severity: 'warning',
    recoveryAction: { type: 'REAUTH', target: '/login' },
  }),

  AUTH_TOKEN_EXPIRED: () => ({
    title: 'Session Expired',
    problem: 'Your security credentials have expired.',
    remediation: 'Please log in again to continue your academic work.',
    severity: 'warning',
    recoveryAction: { type: 'REAUTH', target: '/login' },
  }),

  AUTH_MISSING_TOKEN: () => ({
    title: 'Authentication Required',
    problem: 'You must be authenticated to access this academic portal feature.',
    remediation: 'Please sign in with your university credentials.',
    severity: 'error',
    recoveryAction: { type: 'REAUTH', target: '/login' },
  }),

  UNAUTHORIZED: () => ({
    title: 'Sign-in Required',
    problem: 'You need an active authenticated session to perform this action.',
    remediation: 'Please sign in with your matric number and password.',
    severity: 'error',
    recoveryAction: { type: 'REAUTH', target: '/login' },
  }),

  FORBIDDEN: () => ({
    title: 'Access Restricted',
    problem: 'You do not have institutional authorization to access this academic resource.',
    remediation: 'Please verify your enrollment status or consult your department coordinator.',
    severity: 'error',
    recoveryAction: null,
  }),

  RESET_ONLY: () => ({
    title: 'Password Update Required',
    problem: 'Your account was initialized with a temporary password. All academic modules are quarantined until updated.',
    remediation: 'Please change your temporary password in your Profile to unlock your dashboard and courses.',
    severity: 'warning',
    recoveryAction: { type: 'NAVIGATE', label: 'Update Password', target: '/profile?tab=security' },
  }),

  MANDATORY_PASSWORD_RESET_REQUIRED: () => ({
    title: 'Password Update Required',
    problem: 'Your account was initialized with a temporary password. All academic modules are quarantined until updated.',
    remediation: 'Please change your temporary password in your Profile to unlock your dashboard and courses.',
    severity: 'warning',
    recoveryAction: { type: 'NAVIGATE', label: 'Update Password', target: '/profile?tab=security' },
  }),

  // ── Registration & Academic Invariants (Dynamic Telemetry Guarded) ──
  MAX_CREDIT_CEILING_EXCEEDED: (err) => {
    const hasProjected = Number.isFinite(err?.projectedUnits);
    const max = Number.isFinite(err?.maxCeiling) ? err.maxCeiling : 24;
    const excess = Number.isFinite(err?.excessUnits)
      ? err.excessUnits
      : (hasProjected ? Math.max(0, err.projectedUnits - max) : null);

    return {
      title: 'Credit Ceiling Exceeded',
      problem: hasProjected
        ? `Your selected courses total ${err.projectedUnits} credit units, which exceeds the University Senate limit of ${max} units.`
        : 'Your course selection exceeds the maximum semester credit limit.',
      remediation: Number.isFinite(excess) && excess > 0
        ? `Please deselect at least ${excess} credit unit${excess > 1 ? 's' : ''} to proceed with submission.`
        : 'Please deselect one or more courses to bring your total within the approved limit.',
      severity: 'error',
      recoveryAction: { type: 'NAVIGATE', label: 'Review Course Selections', target: '?step=1' },
    };
  },

  MIN_CREDIT_FLOOR_VIOLATION: (err) => {
    const hasProjected = Number.isFinite(err?.projectedUnits);
    const min = Number.isFinite(err?.minimumRequired) ? err.minimumRequired : 15;
    const needed = hasProjected ? Math.max(0, min - err.projectedUnits) : null;

    return {
      title: 'Minimum Credit Floor Required',
      problem: hasProjected
        ? `Your selection contains only ${err.projectedUnits} credit units. Senate regulations require a minimum of ${min} units for regular registration.`
        : 'Your selection contains fewer than the mandatory minimum credit units.',
      remediation: Number.isFinite(needed) && needed > 0
        ? `Please select at least ${needed} more credit unit${needed > 1 ? 's' : ''} before submitting.`
        : 'Please add additional approved core or elective courses before final submission.',
      severity: 'error',
      recoveryAction: { type: 'NAVIGATE', label: 'Browse Eligible Courses', target: '?step=1' },
    };
  },

  COURSE_CAPACITY_EXCEEDED: (err) => {
    const courseIdentifier = err?.courseId ? `Course ${err.courseId}` : 'The selected course';
    return {
      title: 'Course Enrollment Full',
      problem: `${courseIdentifier} has reached its approved seat capacity for this term.`,
      remediation: 'Please select an alternative elective module or consult your Level Advisor for quota allocation.',
      severity: 'warning',
      recoveryAction: { type: 'NAVIGATE', label: 'Select Alternate Course', target: '?step=1' },
    };
  },

  ELIGIBILITY_VIOLATION: (err) => {
    const count = Array.isArray(err?.violations) ? err.violations.length : 1;
    return {
      title: 'Course Eligibility Restriction',
      problem: `Your submission contains ${count} course${count > 1 ? 's' : ''} that do not meet departmental eligibility or prerequisites.`,
      remediation: 'Review the flagged courses in your list and remove ineligible modules before re-submitting.',
      severity: 'error',
      recoveryAction: { type: 'NAVIGATE', label: 'Review Flagged Courses', target: '?step=1' },
    };
  },

  ACADEMIC_LEVEL_CEILING_BREACH: () => ({
    title: 'Level Ceiling Restriction',
    problem: 'Course Selection Boundary: One or more selected courses exceed your current academic level ceiling.',
    remediation: 'Remove courses above your level or consult your Department Coordinator for approved overrides.',
    severity: 'error',
    recoveryAction: { type: 'NAVIGATE', label: 'Adjust Course Selection', target: '?step=1' },
  }),

  COURSE_ALREADY_PASSED: () => ({
    title: 'Academic Standing Guard',
    problem: 'You have already completed and passed one or more of these courses in a prior semester.',
    remediation: 'Remove completed courses from your registration draft to proceed.',
    severity: 'warning',
    recoveryAction: { type: 'NAVIGATE', label: 'Remove Completed Course', target: '?step=1' },
  }),

  PREREQUISITE_NOT_MET: () => ({
    title: 'Course Prerequisite Required',
    problem: 'You have not satisfied the mandatory prerequisite courses for one or more selections.',
    remediation: 'Check departmental course requirements and enroll in prerequisite modules first.',
    severity: 'error',
    recoveryAction: { type: 'NAVIGATE', label: 'Check Prerequisites', target: '?step=1' },
  }),

  COURSE_NOT_FOUND: () => ({
    title: 'Course Not Found',
    problem: 'The requested course could not be located in the authoritative academic catalog.',
    remediation: 'Please refresh your course catalog list or verify the course code.',
    severity: 'error',
    recoveryAction: { type: 'RETRY', label: 'Refresh Catalog' },
  }),

  DUPLICATE_ENROLLMENT: () => ({
    title: 'Duplicate Enrollment Record',
    problem: 'You are already registered or enrolled in this course for the active semester.',
    remediation: 'Refresh your registration page to inspect your current active enrollments.',
    severity: 'warning',
    recoveryAction: { type: 'RETRY', label: 'Refresh Registration' },
  }),

  BATCH_ALREADY_EXISTS: () => ({
    title: 'Registration Batch Conflict',
    problem: 'An active course registration batch already exists for this semester.',
    remediation: 'Refresh the portal to view your existing registration batch.',
    severity: 'warning',
    recoveryAction: { type: 'RETRY', label: 'Refresh Portal' },
  }),

  BATCH_ALREADY_SUBMITTED: () => ({
    title: 'Registration Already Submitted',
    problem: 'Your registration batch is already submitted and pending departmental advisor review.',
    remediation: 'No further changes can be submitted while advisor review is pending.',
    severity: 'info',
    recoveryAction: null,
  }),

  BATCH_LOCKED: () => ({
    title: 'Registration Batch Locked',
    problem: 'This registration batch is currently locked for review and cannot be modified.',
    remediation: 'Please contact your Level Advisor if you need to make changes.',
    severity: 'info',
    recoveryAction: null,
  }),

  REGISTRATION_CLOSED: () => ({
    title: 'Course Registration Closed',
    problem: 'Academic course registration is currently closed for this term.',
    remediation: 'Please consult the university academic calendar for official registration schedules.',
    severity: 'warning',
    recoveryAction: null,
  }),

  REGISTRATION_LOCKED: () => ({
    title: 'Registration Modifying Locked',
    problem: 'Your registration cannot be modified in its current submission lifecycle state.',
    remediation: 'Please wait for your Level Advisor review or request batch rejection to edit.',
    severity: 'warning',
    recoveryAction: null,
  }),

  ACADEMIC_INVARIANT_VIOLATION: () => ({
    title: 'Academic Invariant Validation Failed',
    problem: 'The requested academic record mutation violates an authoritative catalog integrity rule.',
    remediation: 'Review your course selections against university senate regulations and try again.',
    severity: 'error',
    recoveryAction: { type: 'NAVIGATE', label: 'Review Selections', target: '?step=1' },
  }),

  // ── Quizzes & Assessments ──
  ATTEMPT_NOT_FOUND: () => ({
    title: 'Assessment Attempt Not Found',
    problem: 'We could not locate this assessment attempt. It may have expired or been finalized.',
    remediation: 'Return to the course page to verify available assessment windows.',
    severity: 'warning',
    recoveryAction: { type: 'NAVIGATE', label: 'Back to Course', target: '/courses' },
  }),

  QUIZ_EXPIRED: () => ({
    title: 'Assessment Window Closed',
    problem: 'The scheduled time window for this assessment has elapsed.',
    remediation: 'Late submissions cannot be accepted. Contact your course lecturer if an extension was approved.',
    severity: 'warning',
    recoveryAction: null,
  }),

  QUESTION_NOT_FOUND: () => ({
    title: 'Question Unavailable',
    problem: 'The requested assessment question is temporarily unavailable.',
    remediation: 'Please refresh your assessment session to sync questions.',
    severity: 'error',
    recoveryAction: { type: 'RETRY', label: 'Refresh Session' },
  }),

  ATTEMPT_ALREADY_SUBMITTED: () => ({
    title: 'Assessment Already Submitted',
    problem: 'This assessment attempt has already been submitted and securely recorded.',
    remediation: 'Your responses are locked. Results will be published by the course lecturer.',
    severity: 'info',
    recoveryAction: null,
  }),

  DEADLINE_EXCEEDED: () => ({
    title: 'Practice Time Expired',
    problem: 'The practice drill timer has reached zero.',
    remediation: 'Your final recorded responses have been evaluated. Please return to the course overview.',
    severity: 'warning',
    recoveryAction: { type: 'NAVIGATE', label: 'Return to Course', target: '/courses' },
  }),

  ATTEMPT_CLOSED: () => ({
    title: 'Attempt Finalized',
    problem: 'This practice attempt has already been closed and submitted.',
    remediation: 'No further responses can be saved. You can start a new practice drill or return to the course overview.',
    severity: 'info',
    recoveryAction: { type: 'NAVIGATE', label: 'Course Overview', target: '/courses' },
  }),

  ATTEMPT_ACCESS_FORBIDDEN: () => ({
    title: 'Access Restricted',
    problem: 'This assessment attempt belongs to another student matriculation record.',
    remediation: 'Please verify your active login session.',
    severity: 'critical',
    recoveryAction: { type: 'REAUTH', label: 'Re-authenticate', target: '/login' },
  }),

  ILLEGAL_QUESTION_PAYLOAD: () => ({
    title: 'Question Mismatch Detected',
    problem: 'One or more submitted question identifiers do not belong to this practice session.',
    remediation: 'Please refresh the page to reload the authoritative question set.',
    severity: 'error',
    recoveryAction: { type: 'RETRY', label: 'Reload Practice Drill' },
  }),

  INVALID_ATTEMPT_STATE: () => ({
    title: 'Invalid Attempt Status',
    problem: 'This attempt is no longer in progress and cannot accept further modifications.',
    remediation: 'Return to the course page to review your completed assessments.',
    severity: 'warning',
    recoveryAction: { type: 'NAVIGATE', label: 'Course Overview', target: '/courses' },
  }),

  // ── Question Bank & Assessment Authoring Invariants ──
  QUESTION_INSUFFICIENT_OPTIONS: (err) => ({
    title: 'Insufficient Question Options',
    problem: 'Multiple-choice questions require at least two distinct answer options.',
    remediation: `Please define at least ${err?.minRequired || 2} answer choices before saving this question.`,
    severity: 'error',
    recoveryAction: { type: 'FOCUS_INPUT', label: 'Add Options', target: 'option-input-0' },
  }),

  QUESTION_INVALID_CORRECT_COUNT: () => ({
    title: 'Invalid Correct Answer Selection',
    problem: 'Single-choice questions must specify exactly one correct answer option.',
    remediation: 'Select the radio button beside the correct answer before saving.',
    severity: 'error',
    recoveryAction: { type: 'FOCUS_INPUT', label: 'Select Correct Option', target: 'correct-option-radio-0' },
  }),

  QUESTION_INVALID_POINTS: () => ({
    title: 'Invalid Question Weight',
    problem: 'Question points must be a positive integer greater than zero.',
    remediation: 'Enter a valid point value (e.g. 1, 2, or 5) for this assessment item.',
    severity: 'error',
    recoveryAction: { type: 'FOCUS_INPUT', label: 'Set Points', target: 'question-points-input' },
  }),

  QUESTION_INSUFFICIENT_PAIRS: (err) => ({
    title: 'Incomplete Matching Pair Definitions',
    problem: 'Matching questions require at least two complete prompt-target pairs.',
    remediation: `Please configure at least ${err?.minRequired || 2} matching pairs before saving.`,
    severity: 'error',
    recoveryAction: { type: 'FOCUS_INPUT', label: 'Configure Pairs', target: 'matching-pair-prompt-0' },
  }),

  QUESTION_SCHEMA_VALIDATION_FAILED: () => ({
    title: 'Question Format Error',
    problem: 'The submitted question structure does not satisfy faculty assessment guidelines.',
    remediation: 'Please review all question fields, options, and point allocations before saving.',
    severity: 'error',
    recoveryAction: { type: 'FOCUS_INPUT', label: 'Review Question', target: 'question-text-input' },
  }),

  // ── Upstream, Gateway & Concurrency ──
  TRANSACTION_DEADLOCK_DETECTED: () => ({
    title: 'High Portal Traffic Surge',
    problem: 'The registration gateway experienced momentary contention during simultaneous submissions.',
    remediation: 'The system has safely isolated your transaction. Please pause a moment and tap submit again.',
    severity: 'warning',
    recoveryAction: { type: 'RETRY', label: 'Submit Again' },
  }),

  RATE_LIMIT_EXCEEDED: () => ({
    title: 'Request Rate Limit Exceeded',
    problem: 'You are submitting requests too quickly for the campus gateway.',
    remediation: 'Please pause for a few seconds before trying again.',
    severity: 'warning',
    recoveryAction: { type: 'RETRY', label: 'Try Again' },
  }),

  GATEWAY_TIMEOUT: () => ({
    title: 'Campus Gateway Timeout',
    problem: 'The server or campus network boundary took too long to complete the request.',
    remediation: 'Please check your connection and retry the operation.',
    severity: 'error',
    recoveryAction: { type: 'RETRY', label: 'Retry Request' },
  }),

  MOODLE_GATEWAY_TIMEOUT: () => ({
    title: 'Learning Server Timeout',
    problem: 'The course materials server took longer than expected to respond.',
    remediation: 'Please refresh the page or try loading materials again in a moment.',
    severity: 'warning',
    recoveryAction: { type: 'RETRY', label: 'Refresh Materials' },
  }),

  MOODLE_UPSTREAM_ERROR: () => ({
    title: 'Learning Server Synchronizing',
    problem: 'The course materials server is momentarily unavailable or synchronizing.',
    remediation: 'Core portal functions remain active. Materials will reconnect shortly.',
    severity: 'warning',
    recoveryAction: { type: 'RETRY', label: 'Retry Connection' },
  }),

  MOODLE_UNREACHABLE: () => ({
    title: 'Learning Gateway Unreachable',
    problem: 'The learning management gateway is currently offline or busy.',
    remediation: 'We will automatically reconnect when the service resumes.',
    severity: 'warning',
    recoveryAction: { type: 'RETRY', label: 'Reconnect' },
  }),

  NETWORK_ERROR: () => ({
    title: 'Campus Gateway Unreachable',
    problem: 'The browser cannot establish a connection to the FOCIT portal server.',
    remediation: 'Check your Wi-Fi or mobile network connection and retry.',
    severity: 'error',
    recoveryAction: { type: 'RETRY', label: 'Check Connection' },
  }),

  INTERNAL_SERVER_ERROR: () => ({
    title: 'Portal Service Error',
    problem: 'An unexpected issue occurred on the academic portal.',
    remediation: 'Our technical team has been notified. Please try again shortly.',
    severity: 'error',
    recoveryAction: { type: 'RETRY', label: 'Retry Action' },
  }),

  UNKNOWN_ERROR: (err) => ({
    title: err?.title || 'System Notification',
    problem: err?.detail || err?.message || 'An unexpected condition occurred while processing your request.',
    remediation: 'Please verify your information or retry the action in a moment.',
    severity: 'error',
    recoveryAction: { type: 'RETRY', label: 'Try Again' },
  }),
};

// Aliases for historical / alternate codes
REMEDIATION_REGISTRY.UNIT_CEILING_EXCEEDED = REMEDIATION_REGISTRY.MAX_CREDIT_CEILING_EXCEEDED;
REMEDIATION_REGISTRY.UNIT_FLOOR_BREACH = REMEDIATION_REGISTRY.MIN_CREDIT_FLOOR_VIOLATION;
REMEDIATION_REGISTRY.COURSE_CAPACITY_EXHAUSTED = REMEDIATION_REGISTRY.COURSE_CAPACITY_EXCEEDED;

export const HTTP_STATUS_MAP = {
  400: 'The information provided could not be processed. Please review your input and try again.',
  401: 'Please sign in with your matric number and password to continue.',
  403: 'Access restricted: You do not have authorization to view this academic module.',
  404: 'The requested course, assignment, or learning material could not be found.',
  408: 'The connection timed out. Please check your internet connection and try again.',
  409: 'This submission conflicts with an existing record. Please refresh to see the latest update.',
  422: 'The submitted academic information could not be validated. Please check the requirements.',
  429: 'The portal is currently experiencing a registration surge. Please wait a few seconds before trying again.',
  500: 'An unexpected issue occurred on the portal. Our technical team is working to resolve it.',
  502: 'The course materials service is briefly unavailable. Please try again in a few moments.',
  503: 'The academic system is temporarily undergoing maintenance or high traffic. Please retry shortly.',
  504: 'The server took longer than expected to respond. Please refresh to recheck.',
};

/**
 * Normalizes any error, exception, or network failure into a deterministic
 * 4-tuple remediation object with preserved code and correlationId.
 *
 * @param {any} error
 * @param {string} [fallback]
 * @returns {{
 *   code: string,
 *   correlationId: string | null,
 *   title: string,
 *   problem: string,
 *   remediation: string,
 *   severity: 'error' | 'warning' | 'info',
 *   recoveryAction: { type: string, label?: string, target?: string } | null
 * }}
 */
export function resolveRemediation(error, fallback = 'An unexpected issue occurred. Please try again.') {
  if (!error) {
    return {
      code: 'UNKNOWN_ERROR',
      correlationId: null,
      title: 'System Notification',
      problem: fallback,
      remediation: 'Please retry your action in a moment.',
      severity: 'error',
      recoveryAction: { type: 'RETRY', label: 'Try Again' },
    };
  }

  // 1. Direct string passed (e.g. error code or raw technical phrase)
  if (typeof error === 'string') {
    const trimmed = error.trim();
    if (REMEDIATION_REGISTRY[trimmed]) {
      const entry = REMEDIATION_REGISTRY[trimmed]({ code: trimmed });
      return {
        code: trimmed,
        correlationId: null,
        title: entry.title,
        problem: entry.problem,
        remediation: entry.remediation,
        severity: entry.severity,
        recoveryAction: entry.recoveryAction,
      };
    }

    if (trimmed.includes('Failed to fetch') || trimmed.includes('Network request failed') || trimmed.includes('ECONNREFUSED')) {
      const entry = REMEDIATION_REGISTRY.NETWORK_ERROR();
      return {
        code: 'NETWORK_ERROR',
        correlationId: null,
        title: entry.title,
        problem: entry.problem,
        remediation: entry.remediation,
        severity: entry.severity,
        recoveryAction: entry.recoveryAction,
      };
    }

    return {
      code: 'UNKNOWN_ERROR',
      correlationId: null,
      title: 'Notice',
      problem: trimmed,
      remediation: 'Please review your input or retry.',
      severity: 'error',
      recoveryAction: null,
    };
  }

  // 2. Deterministic Mapping for Native Fetch Exceptions (DOMException / TypeError)
  const isAbortError = error?.name === 'AbortError' || error?.code === 20 || (typeof error?.message === 'string' && error.message.toLowerCase().includes('aborted'));
  const isNetworkFailure = error instanceof TypeError || (typeof error?.message === 'string' && (
    error.message.includes('Failed to fetch') ||
    error.message.includes('NetworkError') ||
    error.message.includes('Network request failed') ||
    error.message.includes('ECONNREFUSED')
  ));

  let resolvedCode = (typeof error?.code === 'string' ? error.code : null) || (typeof error?.data?.code === 'string' ? error.data.code : null) || null;
  const correlationId = error?.correlationId || error?.data?.correlationId || error?.response?.headers?.get?.('x-correlation-id') || null;

  if (isAbortError) {
    resolvedCode = 'GATEWAY_TIMEOUT';
  } else if (isNetworkFailure && !resolvedCode) {
    resolvedCode = 'NETWORK_ERROR';
  } else if (!resolvedCode && error?.status) {
    if (error.status === 408 || error.status === 504) resolvedCode = 'GATEWAY_TIMEOUT';
    else if (error.status === 429) resolvedCode = 'RATE_LIMIT_EXCEEDED';
    else if (error.status === 401) resolvedCode = 'UNAUTHORIZED';
    else if (error.status === 403) resolvedCode = 'FORBIDDEN';
    else if (error.status === 404) resolvedCode = 'COURSE_NOT_FOUND';
    else if (error.status >= 500) resolvedCode = 'INTERNAL_SERVER_ERROR';
  }

  resolvedCode = resolvedCode || 'UNKNOWN_ERROR';

  // 3. Resolve from REMEDIATION_REGISTRY
  if (REMEDIATION_REGISTRY[resolvedCode]) {
    const entry = REMEDIATION_REGISTRY[resolvedCode](error);
    return {
      code: resolvedCode,
      correlationId,
      title: entry.title,
      problem: entry.problem,
      remediation: entry.remediation,
      severity: entry.severity,
      recoveryAction: entry.recoveryAction,
    };
  }

  // 4. Fallback to HTTP Status Map or Server Message
  const status = error.status || error.response?.status;
  const serverProblem = error?.data?.detail || error?.data?.message || error?.detail || (status && HTTP_STATUS_MAP[status]) || fallback;

  return {
    code: resolvedCode,
    correlationId,
    title: error?.title || error?.data?.title || 'System Notification',
    problem: serverProblem,
    remediation: 'Please verify your information or contact support if the problem persists.',
    severity: 'error',
    recoveryAction: { type: 'RETRY', label: 'Try Again' },
  };
}

/**
 * Backward-compatible helper for legacy components expecting a single message string.
 *
 * @param {any} error
 * @param {string} [fallback]
 * @returns {string}
 */
export function getUserFriendlyErrorMessage(error, fallback = 'An unexpected issue occurred. Please try again.') {
  if (!error) return fallback;
  const remediation = resolveRemediation(error, fallback);
  return `${remediation.problem} ${remediation.remediation}`.trim();
}
