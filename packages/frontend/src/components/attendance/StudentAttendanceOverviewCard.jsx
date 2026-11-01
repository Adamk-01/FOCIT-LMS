/**
 * FOCIT LMS - Student Attendance Overview Telemetry Card
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces:
 * 1. NUC 75% Examination Threshold Visibility
 * 2. Unhappy Path Audit: Shimmer loading skeletons and empty states
 * 3. Courses at Risk Alerting
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ArrowRight, 
  Award,
  BookOpen
} from 'lucide-react';
import { useStudentAttendanceSummary } from '../../hooks/useStudentAttendance';

export function StudentAttendanceOverviewCard() {
  const { data, isLoading, isError, refetch } = useStudentAttendanceSummary();

  const metrics = data?.metrics;
  const courses = data?.courses || [];

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm animate-pulse space-y-4">
        <div className="flex items-center justify-between">
          <div className="w-36 h-4 bg-gray-200 rounded" />
          <div className="w-12 h-6 bg-gray-100 rounded-full" />
        </div>
        <div className="w-24 h-8 bg-gray-200 rounded" />
        <div className="w-full h-2.5 bg-gray-100 rounded-full" />
        <div className="flex justify-between w-full h-3 bg-gray-100 rounded" />
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
    <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4 hover:border-gray-300 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-xl ${
            isEligible ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
          }`}>
            <ShieldCheck size={20} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              NUC Attendance Standing
            </h3>
            <p className="text-[11px] text-gray-400">75% Exam Threshold</p>
          </div>
        </div>

        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-extrabold border ${
          isEligible 
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
            : 'bg-rose-50 text-rose-800 border-rose-200'
        }`}>
          {isEligible ? (
            <>
              <CheckCircle2 size={13} className="text-emerald-600" />
              <span>Exam Eligible</span>
            </>
          ) : (
            <>
              <AlertTriangle size={13} className="text-rose-600" />
              <span>Below 75%</span>
            </>
          )}
        </span>
      </div>

      {/* Percentage Gauge */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className={`text-3xl font-extrabold font-display ${
              isEligible ? 'text-[#0a1142]' : 'text-rose-600'
            }`}>
              {overallPercentage}%
            </span>
            <span className="text-xs text-gray-500 font-medium">overall attendance</span>
          </div>

          <span className="text-xs text-gray-500 font-bold">
            {totalAttended} / {totalHeld} Sessions
          </span>
        </div>

        {/* Visual Progress Bar with 75% Indicator Marker */}
        <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden">
          <div 
            className={`h-full transition-all duration-500 rounded-full ${
              isEligible ? 'bg-emerald-500' : 'bg-rose-500'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, overallPercentage))}%` }}
          />
          {/* 75% Target Marker */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-gray-800/40 z-10" 
            style={{ left: '75%' }}
            title="NUC 75% Exam Minimum Standard"
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-gray-400 font-medium pt-0.5">
          <span>0%</span>
          <span className="font-bold text-gray-600">75% Target</span>
          <span>100%</span>
        </div>
      </div>

      {/* Courses At Risk Warning */}
      {atRiskCount > 0 ? (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between gap-2 text-amber-900 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <AlertTriangle size={15} className="text-amber-600 shrink-0" />
            <span className="truncate">
              <strong>{atRiskCount} {atRiskCount === 1 ? 'course is' : 'courses are'}</strong> currently below 75%.
            </span>
          </div>
          <Link
            to="/courses"
            className="text-[11px] font-bold text-amber-900 underline hover:text-amber-950 shrink-0"
          >
            Review Courses
          </Link>
        </div>
      ) : totalHeld === 0 ? (
        <p className="text-xs text-gray-500 italic bg-gray-50 p-2.5 rounded-xl border border-gray-100 text-center">
          Academic semester just commenced. No attendance sessions locked yet.
        </p>
      ) : (
        <p className="text-xs text-emerald-700 bg-emerald-50/60 p-2.5 rounded-xl border border-emerald-100 text-center font-medium">
          ✓ All registered courses meet NUC exam eligibility standards.
        </p>
      )}
    </div>
  );
}

