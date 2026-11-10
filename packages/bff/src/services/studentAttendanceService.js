/**
 * FOCIT LMS - Student Attendance Telemetry & Ingress Service
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces:
 * 1. Authoritative Database State Boundaries (PostgreSQL L2 source of truth)
 * 2. Information Barrier: Zero cross-student data leakage & stripped sheet scans
 * 3. NUC Benchmark & UNIOSUN Academic Regulations:
 *    - Approved EXCUSED sessions grant Denominator Exemption: H_effective = H - E
 *    - Semester Baseline Exemption: N_effective = 15 - E, Exam Target = CEIL(0.75 * (15 - E))
 *    - Horizon Feasibility: canStillQualify = (A + (15 - H)) >= Exam Target
 *    - Decoupled Metrics: sessionsNeededForExam vs consecutiveToClearWarning
 * 4. Zero Ghost-Pulse: Differentiates active session vs requires_check_in vs already_checked_in
 */

import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

export class StudentAttendanceService {
  /**
   * Resolves the current active academic semester.
   */
  async getActiveSemesterId(fallbackSemesterId) {
    if (fallbackSemesterId && typeof fallbackSemesterId === 'string') {
      return fallbackSemesterId;
    }
    const termRes = await pool.query(
      `SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    return termRes.rows[0]?.id || '2026_RAIN';
  }

  /**
   * Retrieves comprehensive attendance summary and 75% NUC eligibility metrics
   * for the authenticated student across all registered courses.
   */
  async getStudentAttendanceSummary(studentId, reqSemesterId) {
    if (!studentId) {
      const err = new Error('Student identifier is required');
      err.status = 400;
      err.code = 'INVALID_STUDENT_ID';
      throw err;
    }

    const semesterId = await this.getActiveSemesterId(reqSemesterId);

    const query = `
      WITH enrolled_courses AS (
          SELECT 
              e.course_id,
              c.code AS course_code,
              c.title AS course_title,
              c.units,
              cr.student_id IS NOT NULL AS is_course_rep
          FROM enrollments e
          JOIN courses c ON c.course_id = e.course_id
          LEFT JOIN course_representatives cr 
                 ON cr.course_id = e.course_id 
                AND cr.student_id = e.student_id 
                AND cr.semester_id = $2
          WHERE e.student_id = $1
            AND (e.semester_id = $2 OR e.semester_id IS NULL)
            AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
      ),
      course_attendance_aggregates AS (
          SELECT 
              ec.course_id,
              ec.course_code,
              ec.course_title,
              ec.units,
              ec.is_course_rep,
              COUNT(s.session_id) FILTER (WHERE s.is_locked = TRUE)::int AS total_locked_sessions,
              COUNT(r.id) FILTER (WHERE s.is_locked = TRUE AND r.status = 'PRESENT')::int AS attended_sessions,
              COUNT(r.id) FILTER (WHERE s.is_locked = TRUE AND r.status = 'EXCUSED')::int AS excused_sessions,
              -- Active session existence
              BOOL_OR(s.is_locked = FALSE AND s.session_mode = 'CODE_OTP' AND s.otp_expires_at > NOW()) AS has_active_session,
              -- Actionable active session (student has NOT checked in yet)
              BOOL_OR(s.is_locked = FALSE AND s.session_mode = 'CODE_OTP' AND s.otp_expires_at > NOW() AND COALESCE(r.status, 'ABSENT') != 'PRESENT') AS requires_check_in,
              -- Already checked in for live active session
              BOOL_OR(s.is_locked = FALSE AND s.session_mode = 'CODE_OTP' AND s.otp_expires_at > NOW() AND r.status = 'PRESENT') AS already_checked_in_active,
              BOOL_OR(s.is_locked = FALSE AND s.session_mode = 'CODE_OTP' AND s.otp_expires_at > NOW() AND COALESCE(r.is_locked_out, FALSE) = TRUE) AS is_locked_out,
              MAX(CASE WHEN s.is_locked = FALSE AND s.session_mode = 'CODE_OTP' AND s.otp_expires_at > NOW() THEN s.session_id::text END) AS active_session_id,
              MAX(CASE WHEN s.is_locked = FALSE AND s.session_mode = 'CODE_OTP' AND s.otp_expires_at > NOW() THEN s.week_number END) AS active_week_number
          FROM enrolled_courses ec
          LEFT JOIN attendance_sessions s 
                 ON s.course_id = ec.course_id 
                AND s.semester_id = $2
          LEFT JOIN attendance_records r 
                 ON r.session_id = s.session_id 
                AND r.student_id = $1
          GROUP BY ec.course_id, ec.course_code, ec.course_title, ec.units, ec.is_course_rep
      ),
      calculated_metrics AS (
          SELECT 
              caa.*,
              -- 1. Denominator Exemption: Deduct approved EXCUSED sessions from audit baseline
              GREATEST(0, caa.total_locked_sessions - caa.excused_sessions)::int AS effective_locked_sessions,
              -- 2. Semester Total Baseline with Excused Exemption
              GREATEST(1, 15 - caa.excused_sessions)::int AS planned_semester_baseline,
              -- 3. Remaining sessions in the 15-week semester
              GREATEST(0, 15 - caa.total_locked_sessions)::int AS remaining_sessions,
              -- 4. Minimum sessions needed to sit final exam: CEIL(0.75 * (15 - E))
              CEIL(0.75 * GREATEST(1, 15 - caa.excused_sessions))::int AS exam_qualification_target,
              -- 5. Maximum achievable attendance if student attends every remaining class: A + (15 - H)
              (caa.attended_sessions + GREATEST(0, 15 - caa.total_locked_sessions))::int AS max_achievable_attendance,
              -- 6. Current Attendance Percentage: A / (H - E) (Defensive All-Excused Boundary)
              CASE 
                  WHEN (caa.total_locked_sessions - caa.excused_sessions) <= 0 THEN 100.0
                  ELSE ROUND((caa.attended_sessions::numeric / (caa.total_locked_sessions - caa.excused_sessions)::numeric) * 100, 1)
              END AS attendance_percentage
          FROM course_attendance_aggregates caa
      )
      SELECT 
          cm.course_id,
          cm.course_code,
          cm.course_title,
          cm.units,
          cm.is_course_rep,
          cm.total_locked_sessions,
          cm.effective_locked_sessions,
          cm.attended_sessions,
          cm.excused_sessions,
          cm.planned_semester_baseline,
          cm.remaining_sessions,
          cm.attendance_percentage,
          cm.exam_qualification_target,
          cm.max_achievable_attendance,
          -- Exam Feasibility: Can student mathematically reach the exam threshold?
          (cm.max_achievable_attendance >= cm.exam_qualification_target) AS can_still_qualify,
          (cm.max_achievable_attendance < cm.exam_qualification_target) AS is_barred_from_exam,
          -- Current Standing Status
          CASE 
              WHEN cm.effective_locked_sessions <= 0 THEN TRUE
              WHEN cm.attendance_percentage >= 75.0 THEN TRUE
              ELSE FALSE
          END AS is_currently_eligible,
          -- Sessions needed to qualify for the final exam (0 if already met, NULL if barred)
          CASE 
              WHEN cm.max_achievable_attendance < cm.exam_qualification_target THEN NULL
              ELSE GREATEST(0, cm.exam_qualification_target - cm.attended_sessions)
          END AS sessions_needed_for_exam,
          -- Consecutive sessions needed to restore current standing to >= 75%
          CASE 
              WHEN cm.effective_locked_sessions <= 0 THEN 0
              WHEN cm.max_achievable_attendance < cm.exam_qualification_target THEN NULL
              ELSE LEAST(
                  cm.remaining_sessions, 
                  GREATEST(0, (3 * cm.effective_locked_sessions) - (4 * cm.attended_sessions))
              )
          END AS consecutive_to_clear_warning,
          COALESCE(cm.has_active_session, FALSE) AS has_active_session,
          COALESCE(cm.requires_check_in, FALSE) AS requires_check_in,
          COALESCE(cm.already_checked_in_active, FALSE) AS already_checked_in_active,
          cm.active_session_id,
          cm.active_week_number
      FROM calculated_metrics cm
      ORDER BY cm.course_code ASC;
    `;

    const { rows } = await pool.query(query, [studentId, semesterId]);

    let totalEffectiveHeld = 0;
    let totalAttended = 0;
    let totalExcused = 0;
    let coursesAtRiskCount = 0;

    const courses = rows.map((r) => {
      const lockedSessions = parseInt(r.total_locked_sessions, 10) || 0;
      const effectiveLocked = parseInt(r.effective_locked_sessions, 10) || 0;
      const attended = parseInt(r.attended_sessions, 10) || 0;
      const excused = parseInt(r.excused_sessions, 10) || 0;
      const percentage = parseFloat(r.attendance_percentage) || 0;
      const isEligible = Boolean(r.is_currently_eligible);

      totalEffectiveHeld += effectiveLocked;
      totalAttended += attended;
      totalExcused += excused;

      if (!isEligible && effectiveLocked > 0) {
        coursesAtRiskCount++;
      }

      return {
        courseId: r.course_id,
        courseCode: r.course_code,
        courseTitle: r.course_title,
        units: r.units,
        isCourseRep: Boolean(r.is_course_rep),
        totalLockedSessions: lockedSessions,
        effectiveLockedSessions: effectiveLocked,
        effectiveDenominator: effectiveLocked,
        attendedSessions: attended,
        excusedSessions: excused,
        plannedSemesterBaseline: r.planned_semester_baseline,
        remainingSessions: r.remaining_sessions,
        examQualificationTarget: r.exam_qualification_target,
        maxAchievableAttendance: r.max_achievable_attendance,
        attendancePercentage: percentage,
        sessionsNeededForExam: r.sessions_needed_for_exam !== null ? parseInt(r.sessions_needed_for_exam, 10) : null,
        consecutiveToClearWarning: r.consecutive_to_clear_warning !== null ? parseInt(r.consecutive_to_clear_warning, 10) : null,
        isExamEligible: isEligible,
        canStillQualify: Boolean(r.can_still_qualify),
        isBarredFromExam: Boolean(r.is_barred_from_exam),
        hasActiveSession: Boolean(r.has_active_session),
        requiresCheckIn: Boolean(r.requires_check_in),
        alreadyCheckedInActive: Boolean(r.already_checked_in_active),
        isLockedOut: Boolean(r.is_locked_out),
        activeSessionId: r.active_session_id || null,
        activeWeekNumber: r.active_week_number || null,
      };
    });

    const overallAttendancePercentage = totalEffectiveHeld === 0
      ? 100.0
      : parseFloat(((totalAttended / totalEffectiveHeld) * 100).toFixed(1));

    return {
      studentId,
      semesterId,
      metrics: {
        totalCoursesEnrolled: courses.length,
        totalSessionsHeld: totalEffectiveHeld,
        totalSessionsAttended: totalAttended,
        totalSessionsExcused: totalExcused,
        overallAttendancePercentage,
        coursesAtRiskCount,
        isExamEligibleOverall: overallAttendancePercentage >= 75.0,
      },
      courses,
    };
  }

  /**
   * Probes for active Mode 2 OTP sessions in courses the student is enrolled in.
   * Strips the raw OTP code to protect information boundaries.
   */
  async getStudentActiveSessions(studentId, reqSemesterId) {
    if (!studentId) {
      const err = new Error('Student identifier is required');
      err.status = 400;
      err.code = 'INVALID_STUDENT_ID';
      throw err;
    }

    const semesterId = await this.getActiveSemesterId(reqSemesterId);

    try {
      const query = `
        SELECT 
            s.session_id,
            s.course_id,
            c.code AS course_code,
            c.title AS course_title,
            s.week_number,
            s.session_date,
            GREATEST(0, EXTRACT(EPOCH FROM (s.otp_expires_at - NOW())))::int AS remaining_seconds,
            COALESCE(r.status = 'PRESENT', FALSE) AS already_checked_in,
            COALESCE(r.is_locked_out, FALSE) AS is_locked_out,
            COALESCE(r.attempt_count, 0)::int AS attempt_count,
            r.active_ticket_id,
            r.active_ticket_expires_at,
            CASE WHEN r.active_ticket_expires_at IS NOT NULL AND r.active_ticket_expires_at > NOW() THEN GREATEST(0, EXTRACT(EPOCH FROM (r.active_ticket_expires_at - NOW())))::int ELSE NULL END AS ticket_remaining_seconds
        FROM attendance_sessions s
        JOIN courses c ON c.course_id = s.course_id
        JOIN enrollments e ON e.course_id = s.course_id AND e.student_id = $1
        LEFT JOIN attendance_records r ON r.session_id = s.session_id AND r.student_id = $1
        WHERE s.is_locked = FALSE 
          AND s.session_mode = 'CODE_OTP'
          AND s.active_otp_hash IS NOT NULL
          AND s.otp_expires_at > NOW()
          AND (s.semester_id = $2 OR s.semester_id IS NULL)
          AND e.status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
        ORDER BY s.otp_expires_at ASC;
      `;

      const { rows } = await pool.query(query, [studentId, semesterId]);

      return {
        studentId,
        semesterId,
        activeSessions: rows.map((r) => ({
          sessionId: r.session_id,
          courseId: r.course_id,
          courseCode: r.course_code,
          courseTitle: r.course_title,
          weekNumber: r.week_number,
          sessionDate: r.session_date,
          remainingSeconds: r.remaining_seconds,
          alreadyCheckedIn: Boolean(r.already_checked_in),
          isLockedOut: Boolean(r.is_locked_out),
          attemptCount: r.attempt_count,
          activeTicketId: r.active_ticket_id,
          ticketExpiresAt: r.active_ticket_expires_at,
          ticketRemainingSeconds: r.ticket_remaining_seconds,
        })),
      };
    } catch (err) {
      logger.error({ err: err?.message || err, studentId }, '[StudentAttendance] Active sessions probe failed');
      throw err;
    }
  }

  /**
   * Retrieves the weekly attendance audit timeline for a specific enrolled course.
   * Information Barrier: All sheet image URLs and cohort roster tallies are stripped.
   */
  async getCourseStudentAttendanceTimeline(studentId, courseId, reqSemesterId) {
    if (!studentId || !courseId) {
      const err = new Error('Student identifier and courseId are required');
      err.status = 400;
      err.code = 'INVALID_ARGUMENTS';
      throw err;
    }

    const semesterId = await this.getActiveSemesterId(reqSemesterId);

    // 1. Verify student enrollment
    const enrollRes = await pool.query(`
      SELECT 1 FROM enrollments 
      WHERE student_id = $1 AND course_id = $2 
        AND (semester_id = $3 OR semester_id IS NULL)
        AND status IN ('ENROLLED', 'CONFIRMED', 'ACTIVE', 'APPROVED', 'IN_PROGRESS')
      LIMIT 1;
    `, [studentId, courseId, semesterId]);

    if (enrollRes.rows.length === 0) {
      const err = new Error('You are not actively enrolled in this course.');
      err.status = 403;
      err.code = 'NOT_ENROLLED';
      throw err;
    }

    // 2. Fetch course header & rep status
    const courseRes = await pool.query(`
      SELECT 
        c.course_id,
        c.code,
        c.title,
        c.units,
        c.level,
        cr.student_id IS NOT NULL AS is_course_rep
      FROM courses c
      LEFT JOIN course_representatives cr 
             ON cr.course_id = c.course_id 
            AND cr.student_id = $1 
            AND cr.semester_id = $2
      WHERE c.course_id = $3 LIMIT 1;
    `, [studentId, semesterId, courseId]);

    const courseMeta = courseRes.rows[0];

    // 3. Query all weekly sessions and join only the calling student's records
    const sessionsRes = await pool.query(`
      SELECT 
          s.session_id,
          s.week_number,
          s.session_date,
          s.session_mode,
          s.is_locked,
          s.notes,
          (s.is_locked = FALSE AND s.session_mode = 'CODE_OTP' AND s.otp_expires_at > NOW()) AS is_otp_active,
          (s.is_locked = FALSE AND s.session_mode = 'CODE_OTP' AND s.otp_expires_at > NOW() AND COALESCE(r.status, 'ABSENT') != 'PRESENT') AS requires_check_in,
          (s.is_locked = FALSE AND s.session_mode = 'CODE_OTP' AND s.otp_expires_at > NOW() AND r.status = 'PRESENT') AS already_checked_in_active,
          GREATEST(0, EXTRACT(EPOCH FROM (s.otp_expires_at - NOW())))::int AS otp_remaining_seconds,
          COALESCE(r.status, 'NOT_RECORDED') AS status,
          COALESCE(r.is_locked_out, FALSE) AS is_locked_out,
          COALESCE(r.attempt_count, 0)::int AS attempt_count,
          r.active_ticket_id,
          r.active_ticket_expires_at,
          CASE WHEN r.active_ticket_expires_at IS NOT NULL AND r.active_ticket_expires_at > NOW() THEN GREATEST(0, EXTRACT(EPOCH FROM (r.active_ticket_expires_at - NOW())))::int ELSE NULL END AS ticket_remaining_seconds,
          r.verification_method,
          r.marked_at
      FROM attendance_sessions s
      LEFT JOIN attendance_records r 
             ON r.session_id = s.session_id 
            AND r.student_id = $1
      WHERE s.course_id = $2
        AND (s.semester_id = $3 OR s.semester_id IS NULL)
      ORDER BY s.week_number ASC;
    `, [studentId, courseId, semesterId]);

    const sessions = sessionsRes.rows.map((row) => ({
      sessionId: row.session_id,
      weekNumber: row.week_number,
      sessionDate: row.session_date,
      sessionMode: row.session_mode,
      isLocked: row.is_locked,
      status: row.status,
      isLockedOut: Boolean(row.is_locked_out),
      attemptCount: row.attempt_count,
      activeTicketId: row.active_ticket_id,
      ticketExpiresAt: row.active_ticket_expires_at,
      ticketRemainingSeconds: row.ticket_remaining_seconds,
      verificationMethod: row.verification_method,
      markedAt: row.marked_at,
      notes: row.is_locked ? row.notes : null,
      isOtpActive: Boolean(row.is_otp_active),
      requiresCheckIn: Boolean(row.requires_check_in),
      alreadyCheckedInActive: Boolean(row.already_checked_in_active),
      otpRemainingSeconds: row.is_otp_active ? row.otp_remaining_seconds : 0,
    }));

    // 4. Calculate individual course 75% NUC stats with Denominator Exemption
    const lockedSessions = sessions.filter((s) => s.isLocked);
    const totalLockedCount = lockedSessions.length;
    const attendedCount = lockedSessions.filter((s) => s.status === 'PRESENT').length;
    const excusedCount = lockedSessions.filter((s) => s.status === 'EXCUSED').length;

    // Denominator Exemption (Defensive All-Excused Boundary)
    const effectiveLockedCount = Math.max(0, totalLockedCount - excusedCount);
    const percentage = effectiveLockedCount <= 0
      ? 100.0
      : parseFloat(((attendedCount / effectiveLockedCount) * 100).toFixed(1));

    const plannedSemesterBaseline = Math.max(1, 15 - excusedCount);
    const examQualificationTarget = Math.ceil(0.75 * plannedSemesterBaseline);
    const maxAchievable = attendedCount + Math.max(0, 15 - totalLockedCount);
    const canStillQualify = maxAchievable >= examQualificationTarget;

    const sessionsNeededForExam = canStillQualify
      ? Math.max(0, examQualificationTarget - attendedCount)
      : null;

    const consecutiveToClearWarning = canStillQualify && effectiveLockedCount > 0
      ? Math.min(15 - totalLockedCount, Math.max(0, 3 * effectiveLockedCount - 4 * attendedCount))
      : 0;

    return {
      course: {
        courseId: courseMeta.course_id,
        code: courseMeta.code,
        title: courseMeta.title,
        units: courseMeta.units,
        level: courseMeta.level,
        isCourseRep: Boolean(courseMeta.is_course_rep),
      },
      semesterId,
      summary: {
        totalLockedSessions: totalLockedCount,
        effectiveLockedSessions: effectiveLockedCount,
        effectiveDenominator: effectiveLockedCount,
        attendedSessions: attendedCount,
        excusedSessions: excusedCount,
        plannedSemesterBaseline,
        remainingSessions: Math.max(0, 15 - totalLockedCount),
        attendancePercentage: percentage,
        examQualificationTarget,
        maxAchievableAttendance: maxAchievable,
        sessionsNeededForExam,
        consecutiveToClearWarning,
        isExamEligible: effectiveLockedCount === 0 || percentage >= 75.0,
        canStillQualify,
        isBarredFromExam: !canStillQualify,
      },
      timeline: sessions,
    };
  }
}

export const studentAttendanceService = new StudentAttendanceService();
