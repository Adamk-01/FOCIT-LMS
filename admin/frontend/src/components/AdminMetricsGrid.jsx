import React from 'react';
import { Users, GraduationCap, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

/**
 * Admin Metrics & Telemetry Grid
 *
 * Implements:
 * 1. 3 spacious, clean white cards matching the student dashboard telemetry layout
 * 2. Visual hierarchy: prominent KPI metrics, sub-labels, and circular iconography
 * 3. Real-time Moodle integration health status indicator
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function AdminMetricsGrid({
  totalStudents = 0,
  totalStaff = 0,
  moodleStatus = 'UP',
}) {
  const isMoodleUp = moodleStatus === 'UP';
  const isMoodleDegraded = moodleStatus === 'DEGRADED';

  return (
    <section aria-label="System Metrics Overview" className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* 1. Total Enrolled Students Card */}
      <div className="bg-white rounded-2xl p-6 sm:p-7 border border-gray-200/80 shadow-sm flex items-center justify-between transition-all hover:border-gray-300">
        <div>
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
            Total Enrolled Students
          </span>
          <p className="text-3xl sm:text-4xl font-black text-[#0a1142] font-display mt-1">
            {totalStudents.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 font-medium mt-1">
            Across 7 Degree Programmes
          </p>
        </div>

        <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
          <Users size={22} aria-hidden="true" />
        </div>
      </div>

      {/* 2. Academic Staff & Advisors Card */}
      <div className="bg-white rounded-2xl p-6 sm:p-7 border border-gray-200/80 shadow-sm flex items-center justify-between transition-all hover:border-gray-300">
        <div>
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
            Academic Staff & Advisors
          </span>
          <p className="text-3xl sm:text-4xl font-black text-[#0a1142] font-display mt-1">
            {totalStaff.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 font-medium mt-1">
            Active Faculty Members
          </p>
        </div>

        <div className="w-12 h-12 rounded-full bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0">
          <GraduationCap size={22} aria-hidden="true" />
        </div>
      </div>

      {/* 3. Moodle Integration Engine Health Card */}
      <div className="bg-white rounded-2xl p-6 sm:p-7 border border-gray-200/80 shadow-sm flex items-center justify-between transition-all hover:border-gray-300">
        <div>
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block">
            Moodle Integration Engine
          </span>
          <p className={`text-2xl sm:text-3xl font-black font-display mt-1 ${
            isMoodleUp ? 'text-emerald-600' : isMoodleDegraded ? 'text-amber-600' : 'text-rose-600'
          }`}>
            {isMoodleUp ? 'HEALTHY' : isMoodleDegraded ? 'DEGRADED' : 'OFFLINE'}
          </p>
          <p className="text-xs text-gray-500 font-medium mt-1">
            {isMoodleUp
              ? 'REST API Synced • 0 Critical Faults'
              : isMoodleDegraded
              ? 'Intermittent upstream responses'
              : 'Connection interrupted'}
          </p>
        </div>

        <div className={`w-12 h-12 rounded-full border flex items-center justify-center shrink-0 ${
          isMoodleUp
            ? 'bg-emerald-50 border-emerald-100 text-emerald-600'
            : isMoodleDegraded
            ? 'bg-amber-50 border-amber-100 text-amber-600'
            : 'bg-rose-50 border-rose-100 text-rose-600'
        }`}>
          {isMoodleUp ? (
            <CheckCircle size={22} aria-hidden="true" />
          ) : isMoodleDegraded ? (
            <AlertTriangle size={22} aria-hidden="true" />
          ) : (
            <XCircle size={22} aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}
