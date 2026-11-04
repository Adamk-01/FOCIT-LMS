/**
 * FOCIT LMS - Student Attendance Overview Telemetry Card
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces:
 * 1. NUC 75% Examination Threshold Visibility
 * 2. Unhappy Path Audit: Shimmer loading skeletons and empty states
 * 3. Courses at Risk Alerting
 * 4. Direct Attendance Passcode Ingress Trigger
 * 5. Anti-Collision Typography: Discrete vertical metric stacking prevents layout breakage
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  KeyRound
} from 'lucide-react';
import { useStudentAttendanceSummary } from '../../hooks/useStudentAttendance';

export function StudentAttendanceOverviewCard({ onOpenCheckIn }) {
  const { data, isLoading, isError } = useStudentAttendanceSummary();

  const metrics = data?.metrics;

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-[#0c132c] rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm animate-pulse space-y-4">
        <div className="flex items-center justify-between">
          <div className="w-36 h-4 bg-gray-200 dark:bg-slate-800 rounded" />
          <div className="w-16 h-6 bg-gray-100 dark:bg-slate-800 rounded-full" />
        </div>
        <div className="w-24 h-8 bg-gray-200 dark:bg-slate-800 rounded" />
        <div className="w-full h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full" />
        <div className="flex justify-between w-full h-3 bg-gray-100 dark:bg-slate-800 rounded" />
      </div>
    );
  }

  if (isError || !metrics) {
    return null; // Gracefully degrade if endpoint is unavailable
  }

  const overallPercentage = metrics.overallAttendancePercentage ?? 100.0;
  const isEligible = metrics.isExamEligibleOverall;
  const totalHeld = metrics.totalSessionsHeld ?? 0;
  const totalAttended = metrics.totalSessionsAttended ?? 0;
  const atRiskCount = metrics.coursesAtRiskCount ?? 0;

  return (
    <div className="bg-white dark:bg-[#0c132c] rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm space-y-5 hover:border-gray-300 dark:hover:border-slate-700 transition-colors">
      {/* 1. Header with Status Badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-2 rounded-xl shrink-0 ${
            isEligible 
              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400' 
              : 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400'
          }`}>
            <ShieldCheck size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider truncate">
              NUC Standing
            </h3>
            <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate">75% Exam Threshold</p>
          </div>
        </div>

        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold border shrink-0 whitespace-nowrap ${
          isEligible 
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60' 
            : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60'
        }`}>
          {isEligible ? (
            <>
              <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Exam Eligible</span>
            </>
          ) : (
            <>
              <AlertTriangle size={13} className="text-rose-600 dark:text-rose-400 shrink-0" />
              <span>Below 75%</span>
            </>
          )}
        </span>
      </div>

      {/* 2. Structured Telemetry Gauge (Discrete Columns Prevent Word Overlap) */}
      <div className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className={`text-3xl sm:text-4xl font-extrabold font-display tracking-tight leading-none ${
              isEligible ? 'text-[#0a1142] dark:text-white' : 'text-rose-600 dark:text-rose-400'
            }`}>
              {overallPercentage}%
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400 font-medium mt-1">
              Overall Attendance
            </p>
          </div>

          <div className="text-right">
            <div className="text-sm sm:text-base font-bold text-gray-700 dark:text-slate-200 leading-none">
              {totalAttended} / {totalHeld}
            </div>
            <p className="text-xs text-gray-400 dark:text-slate-500 font-medium mt-1">
              Sessions Held
            </p>
          </div>
        </div>

        {/* Visual Progress Bar with 75% Indicator Marker */}
        <div className="relative w-full h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-500 rounded-full ${
              isEligible ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, overallPercentage))}%` }}
          />
          {/* 75% Target Marker */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-gray-800/40 dark:bg-white/40 z-10" 
            style={{ left: '75%' }}
            title="NUC 75% Exam Minimum Standard"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-slate-500 font-medium pt-0.5">
          <span>0%</span>
          <span className="font-semibold text-gray-600 dark:text-slate-300">75% Target</span>
          <span>100%</span>
        </div>
      </div>

      {/* 3. Quick Check-In Passcode Trigger */}
      {onOpenCheckIn && (
        <button
          type="button"
          onClick={onOpenCheckIn}
          className="w-full min-h-[42px] px-3.5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer active:scale-98"
        >
          <KeyRound size={15} className="text-[#ffb81c]" />
          <span>Enter Attendance Passcode</span>
        </button>
      )}

      {/* 4. Courses At Risk Warning */}
      {atRiskCount > 0 ? (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl flex items-center justify-between gap-2 text-amber-900 dark:text-amber-200 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="truncate">
              <strong>{atRiskCount} {atRiskCount === 1 ? 'course is' : 'courses are'}</strong> currently below 75%.
            </span>
          </div>
          <Link
            to="/courses"
            className="text-[11px] font-bold text-amber-900 dark:text-amber-300 underline hover:text-amber-950 shrink-0"
          >
            Review Courses
          </Link>
        </div>
      ) : totalHeld === 0 ? (
        <p className="text-xs text-gray-500 dark:text-slate-400 italic bg-gray-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-gray-100 dark:border-slate-800 text-center">
          Academic semester just commenced. No attendance sessions locked yet.
        </p>
      ) : (
        <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30 p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-900/40 text-center font-medium">
          ✓ All registered courses meet NUC exam eligibility standards.
        </p>
      )}
    </div>
  );
}

export default StudentAttendanceOverviewCard;
