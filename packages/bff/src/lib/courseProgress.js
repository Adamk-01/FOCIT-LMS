/**
 * FOCIT LMS - Dynamic Course Progress Calculation Engine
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Computes deterministic course completion percentages based on:
 * 1. Live lecture attendance sessions recorded and locked by course lecturers (40% weight)
 * 2. Formative assessments, active quizzes, and course assignment submissions (60% weight)
 * 3. Graceful adaptive scaling when tasks or attendance sessions have not yet been scheduled
 * 4. NUC/University academic standing rule: 100% completion if officially marked COMPLETED
 */

export function calculateCourseProgress({
  status,
  held_sessions = 0,
  attended_sessions = 0,
  total_quizzes = 0,
  completed_quizzes = 0,
  total_assignments = 0,
  submitted_assignments = 0,
}) {
  const normStatus = String(status || '').toUpperCase();
  if (normStatus === 'COMPLETED') {
    return 100;
  }

  const held = Math.max(0, Number(held_sessions) || 0);
  const attended = Math.max(0, Number(attended_sessions) || 0);
  const totalTasks = Math.max(0, Number(total_quizzes) || 0) + Math.max(0, Number(total_assignments) || 0);
  const completedTasks = Math.max(0, Number(completed_quizzes) || 0) + Math.max(0, Number(submitted_assignments) || 0);

  // If the semester has just opened and neither sessions nor tasks have been published
  if (held === 0 && totalTasks === 0) {
    return 0;
  }

  // UNIOSUN standard semester active lecture calendar: 12 instructional weeks
  const SEMESTER_LECTURE_BENCHMARK = 12;

  // 1. Attendance Progression (40% Weight)
  const attendancePace = Math.min(1.0, held / SEMESTER_LECTURE_BENCHMARK);
  const attendanceRatio = held > 0 ? Math.min(1.0, attended / held) : 0;
  const attendanceScore = attendanceRatio * attendancePace * 40;

  // 2. Assessment Progression (60% Weight)
  const assessmentRatio = totalTasks > 0 ? Math.min(1.0, completedTasks / totalTasks) : 0;
  const assessmentScore = assessmentRatio * 60;

  let calculatedProgress;
  if (totalTasks === 0) {
    // Lecturer has not published assignments/quizzes yet; progress reflects lecture attendance pace
    calculatedProgress = attendanceRatio * attendancePace * 100;
  } else if (held === 0) {
    // Lecturer has not initiated attendance sessions yet; progress reflects completed coursework
    calculatedProgress = assessmentRatio * 100;
  } else {
    // Combined multi-modal progression
    calculatedProgress = attendanceScore + assessmentScore;
  }

  return Math.min(100, Math.max(0, Math.round(calculatedProgress)));
}
