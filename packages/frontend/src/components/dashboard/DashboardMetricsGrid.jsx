import React from 'react';
import { BookOpen, CheckCircle2, GraduationCap } from 'lucide-react';

/**
 * Key Academic Telemetry Summary Cards
 *
 * Implements:
 * 1. Registered Courses metric
 * 2. Completed Units metric
 * 3. Cumulative GPA standing with inter-faculty 100L/200L exemption handling
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function DashboardMetricsGrid({ metrics, isLoading = false }) {
  return (
    <section aria-label="Student Academic Metrics" className="grid grid-cols-1 sm:grid-cols-3 gap-5">
      {/* Metric 1: Registered Courses */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
            Registered Courses
          </p>
          <p className="text-3xl font-extrabold text-[#0a1142] dark:text-slate-100">
            {isLoading ? '...' : metrics?.registered_courses ?? 0}
          </p>
          <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">Active this term</span>
        </div>
        <div className="p-3.5 bg-blue-50 dark:bg-slate-800 text-[#0a1142] dark:text-indigo-400 rounded-2xl">
          <BookOpen size={26} aria-hidden="true" />
        </div>
      </div>

      {/* Metric 2: Completed Units */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
            Completed Units
          </p>
          <p className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {isLoading ? '...' : metrics?.completed_units ?? 0}
          </p>
          <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">Completed courses/modules</span>
        </div>
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-2xl">
          <CheckCircle2 size={26} aria-hidden="true" />
        </div>
      </div>

      {/* Metric 3: Cumulative GPA */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
        <div className="space-y-1">
          <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
            Cumulative GPA
          </p>
          {isLoading ? (
            <p className="text-3xl font-extrabold text-[#0a1142] dark:text-slate-100">...</p>
          ) : metrics?.gpa_exempt ? (
            <div className="space-y-1">
              <span
                title={metrics.exemption_reason}
                className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
              >
                EXEMPT (100L/200L Inter-Faculty)
              </span>
              <p className="text-[11px] text-gray-500 dark:text-slate-400">
                Departmental CGPA computation commences at 300 Level.
              </p>
            </div>
          ) : (
            <>
              <p className="text-3xl font-extrabold text-[#0a1142] dark:text-slate-100">
                {typeof metrics?.current_gpa === 'number' ? metrics.current_gpa.toFixed(2) : '0.00'}
              </p>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold">
                {metrics?.standing_label || 'Good Standing'}
              </span>
            </>
          )}
        </div>
        <div className="p-3.5 bg-amber-50 dark:bg-slate-800 text-[#ffb81c] rounded-2xl shrink-0">
          <GraduationCap size={26} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

export default DashboardMetricsGrid;
