/**
 * <DashboardCourseCard />
 *
 * Enforces:
 * 1. Zero Div Soup: Semantic <article>, <header>, <nav>, and <button> elements
 * 2. WCAG 2.1 AA First-Class Dark Mode Design Tokens (No washed-out light badges)
 * 3. NUC 75% Benchmark Attendance Standing Meter with deterministic threshold notch
 * 4. Contextual Live Lecture Ingress: Gold pulsing action when a lecture session is OPEN
 * 5. Deterministic Routing: Direct course room entry and tab deep-links
 * 6. Responsive Anti-Wrapping Hierarchy: Top row strictly isolated to [Code] and [Status]
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { 
  ArrowRight, 
  KeyRound, 
  ShieldCheck, 
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';

/**
 * Returns deterministic department/course palette for consistent brand identity.
 */
function getCoursePalette(code = '') {
  const prefix = String(code).trim().slice(0, 3).toUpperCase();
  switch (prefix) {
    case 'CSC':
      return {
        badgeBg: 'bg-indigo-50 dark:bg-indigo-950/60',
        badgeText: 'text-indigo-700 dark:text-indigo-300',
        badgeBorder: 'border-indigo-200 dark:border-indigo-800/60',
        accentGlow: 'group-hover:border-indigo-400 dark:group-hover:border-indigo-500/60',
      };
    case 'GST':
      return {
        badgeBg: 'bg-amber-50 dark:bg-amber-950/60',
        badgeText: 'text-amber-800 dark:text-amber-300',
        badgeBorder: 'border-amber-200 dark:border-amber-800/60',
        accentGlow: 'group-hover:border-amber-400 dark:group-hover:border-amber-500/60',
      };
    case 'MTH':
    case 'PHY':
    case 'CHM':
      return {
        badgeBg: 'bg-emerald-50 dark:bg-emerald-950/60',
        badgeText: 'text-emerald-700 dark:text-emerald-300',
        badgeBorder: 'border-emerald-200 dark:border-emerald-800/60',
        accentGlow: 'group-hover:border-emerald-400 dark:group-hover:border-emerald-500/60',
      };
    default:
      return {
        badgeBg: 'bg-blue-50 dark:bg-blue-950/60',
        badgeText: 'text-blue-700 dark:text-blue-300',
        badgeBorder: 'border-blue-200 dark:border-blue-800/60',
        accentGlow: 'group-hover:border-blue-400 dark:group-hover:border-blue-500/60',
      };
  }
}

export function DashboardCourseCard({
  course,
  attendance = null,
  activeSession = null,
  onOpenCheckIn,
}) {
  const courseId = course?.course_id || course?.id || '1';
  const courseCode = course?.code || 'CRS';
  const courseTitle = course?.title || 'Course Module';
  const units = course?.units || 3;
  const level = course?.level || 200;
  const category = course?.category || 'CORE';
  const status = course?.status || 'In Progress';
  const isCompleted = status === 'Completed' || status === 'COMPLETED';
  const progressVal = Math.min(100, Math.max(0, Number(course?.progress ?? course?.progress_percent ?? 0)));

  const palette = useMemo(() => getCoursePalette(courseCode), [courseCode]);

  // Attendance metrics parsing with defensive boundaries
  const totalLocked = attendance?.totalLockedSessions ?? 0;
  const percentage = attendance?.attendancePercentage ?? 100.0;
  const isEligible = attendance?.isExamEligible ?? true;
  const isBarred = attendance?.isBarredFromExam ?? false;
  const hasRecordedSessions = totalLocked > 0;

  // Live session check
  const hasLiveSession = Boolean(activeSession && activeSession.isOtpActive !== false);

  return (
    <article
      className={`
        group relative flex flex-col justify-between rounded-2xl p-5 sm:p-6
        bg-white dark:bg-[#0c132c] border border-gray-200/90 dark:border-slate-800/90
        shadow-xs hover:shadow-md hover:border-slate-300 dark:hover:border-slate-700
        transition-all duration-200
        ${palette.accentGlow}
        ${hasLiveSession ? 'ring-2 ring-[#ffb81c]/60 shadow-[#ffb81c]/10' : ''}
      `}
    >
      <div className="space-y-4">
        {/* 1. Header: Course Code on Left, Status Badge on Right (Clean 2-element row, NEVER wraps) */}
        <header className="flex items-center justify-between gap-2">
          <span
            className={`px-2.5 py-1 rounded-xl text-xs font-black font-mono tracking-wider border shadow-2xs shrink-0 whitespace-nowrap ${palette.badgeBg} ${palette.badgeText} ${palette.badgeBorder}`}
          >
            {courseCode}
          </span>

          <div className="shrink-0 flex items-center">
            {hasLiveSession ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-amber-400/20 text-[#ffb81c] border border-[#ffb81c]/40 animate-pulse whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-[#ffb81c] shrink-0" />
                <span>Live Lecture</span>
              </span>
            ) : isCompleted ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 whitespace-nowrap">
                <CheckCircle2 size={12} className="shrink-0" />
                <span>Completed</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 whitespace-nowrap shadow-2xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>In Progress</span>
              </span>
            )}
          </div>
        </header>

        {/* 2. Course Title & Structured Academic Metadata */}
        <div className="space-y-2">
          <Link
            to={`/courses/${encodeURIComponent(courseId)}`}
            className="block text-[#0a1142] dark:text-slate-100 group-hover:text-[#16258f] dark:group-hover:text-indigo-400 transition-colors"
          >
            <h3 className="text-base sm:text-lg font-extrabold leading-snug line-clamp-2 font-display">
              {courseTitle}
            </h3>
          </Link>

          <div className="flex items-center gap-1.5 sm:gap-2 text-xs text-slate-500 dark:text-slate-400 font-medium flex-wrap">
            <span>Level {level} Syllabus</span>
            <span className="text-slate-300 dark:text-slate-600">•</span>
            <span>{units} {units === 1 ? 'Unit' : 'Units'}</span>
            <span className="text-slate-300 dark:text-slate-600">•</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 whitespace-nowrap">
              {category}
            </span>
          </div>
        </div>

        {/* 3. Dynamic Course Progress & NUC Attendance Standing Gauges */}
        <div className="space-y-3">
          {/* A. Course Completion / Syllabus Progress */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                Course Progress
              </span>
              <span className="text-xs font-black text-[#0a1142] dark:text-slate-100 font-mono">
                {progressVal}%
              </span>
            </div>
            <div className="relative h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden p-0.5">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  isCompleted || progressVal === 100
                    ? 'bg-emerald-500'
                    : 'bg-gradient-to-r from-[#0a1142] to-[#16258f] dark:from-indigo-600 dark:to-indigo-500'
                }`}
                style={{ width: `${progressVal}%` }}
                role="progressbar"
                aria-valuenow={progressVal}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Course completion: ${progressVal}%`}
              />
            </div>
          </div>

          {/* B. NUC 75% Examination Attendance Standing Meter */}
          <div className="p-3 rounded-xl bg-slate-50/90 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 shrink-0">
                <ShieldCheck size={14} className="text-teal-600 dark:text-teal-400 shrink-0" />
                <span className="whitespace-nowrap">NUC Standing</span>
              </span>

              {/* Attendance Standing Label */}
              <div className="text-right min-w-0">
                {!hasRecordedSessions ? (
                  <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    100% (No Sessions)
                  </span>
                ) : isBarred ? (
                  <span className="text-[11px] font-black text-rose-600 dark:text-rose-400 flex items-center gap-1 justify-end whitespace-nowrap">
                    <AlertTriangle size={12} className="shrink-0" />
                    <span>Barred ({percentage}%)</span>
                  </span>
                ) : isEligible ? (
                  <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                    {percentage}% (Eligible)
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1 justify-end whitespace-nowrap">
                    <AlertTriangle size={12} className="shrink-0" />
                    <span>{percentage}% (Warning)</span>
                  </span>
                )}
              </div>
            </div>

            {/* Progress Bar with 75% NUC Threshold Line */}
            <div className="relative h-1.5 w-full bg-slate-200/90 dark:bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  !hasRecordedSessions
                    ? 'bg-slate-400 dark:bg-slate-600'
                    : isBarred
                      ? 'bg-rose-500'
                      : isEligible
                        ? 'bg-emerald-500 dark:bg-emerald-400'
                        : 'bg-amber-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
                role="progressbar"
                aria-valuenow={percentage}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Attendance standing: ${percentage}%`}
              />
              {/* 75% NUC Examination Benchmark Line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-slate-900/40 dark:bg-white/40 z-10"
                style={{ left: '75%' }}
                title="75% NUC Minimum Exam Benchmark"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 4. Action Cluster: Contextual Live Ingress & Direct Room Navigation */}
      <footer className="mt-5 pt-4 border-t border-gray-100 dark:border-slate-800/80">
        {hasLiveSession ? (
          <div className="flex flex-col sm:flex-row items-center gap-2.5">
            <button
              type="button"
              onClick={() => onOpenCheckIn(course, activeSession)}
              className="w-full min-h-[42px] px-4 py-2 bg-[#ffb81c] hover:bg-yellow-400 text-[#0a1142] rounded-xl text-xs font-black transition-all shadow-xs active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
              aria-label={`Enter attendance passcode for ${courseCode}`}
            >
              <KeyRound size={15} />
              <span>Enter Passcode (Wk {activeSession.weekNumber || 1})</span>
            </button>
            <Link
              to={`/courses/${encodeURIComponent(courseId)}`}
              className="w-full sm:w-auto min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1 shrink-0"
              title="Open Course Room"
            >
              <span>Room</span>
              <ArrowRight size={13} />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            <Link
              to={`/courses/${encodeURIComponent(courseId)}?tab=attendance`}
              className="min-h-[42px] px-3 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-[#0a1142] dark:hover:text-white bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 transition-all flex items-center justify-center gap-1.5 shadow-2xs hover:shadow-xs active:scale-98"
              title={`View ${courseCode} Attendance Ledger`}
            >
              <ShieldCheck size={14} className="text-teal-600 dark:text-teal-400 shrink-0" />
              <span className="whitespace-nowrap">Attendance</span>
            </Link>

            <Link
              to={`/courses/${encodeURIComponent(courseId)}`}
              className="min-h-[42px] px-3 py-2 rounded-xl text-xs font-bold bg-[#0a1142] dark:bg-indigo-600 hover:bg-[#16258f] dark:hover:bg-indigo-500 text-white transition-all flex items-center justify-center gap-1.5 shadow-xs hover:shadow-md active:scale-98"
              title={`Enter ${courseCode} Course Room`}
            >
              <span className="whitespace-nowrap">Enter Course</span>
              <ArrowRight size={14} className="shrink-0" />
            </Link>
          </div>
        )}
      </footer>
    </article>
  );
}

/**
 * Loading Skeleton Grid for CLS-free mounting
 */
export function DashboardCourseSkeleton({ count = 4 }) {
  return (
    <div
      aria-label="Loading enrolled courses"
      aria-busy="true"
      className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 animate-pulse"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-2xl p-6 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
        >
          <div className="flex justify-between items-center">
            <div className="h-6 w-20 bg-slate-200 dark:bg-slate-800 rounded-lg" />
            <div className="h-5 w-24 bg-slate-200 dark:bg-slate-800 rounded-full" />
          </div>
          <div className="space-y-2">
            <div className="h-5 w-3/4 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-3 w-1/3 bg-slate-200 dark:bg-slate-800 rounded" />
          </div>
          <div className="h-14 bg-slate-200/70 dark:bg-slate-800/70 rounded-xl" />
          <div className="pt-2 flex gap-2.5">
            <div className="h-10 w-1/2 bg-slate-200 dark:bg-slate-800 rounded-xl" />
            <div className="h-10 w-1/2 bg-slate-200 dark:bg-slate-800 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default DashboardCourseCard;
