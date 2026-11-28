import React, { useState } from 'react';
import { BookmarkCheck, Clock, CheckCircle2, Circle, RefreshCw, UserCheck, AlertCircle } from 'lucide-react';

/**
 * <RegistrationClearanceTracker />
 *
 * Clearance status tracker displayed when a student's registration batch
 * is in SUBMITTED or ADVISOR_APPROVED state.
 */
export function RegistrationClearanceTracker({
  batchStatus = 'SUBMITTED',
  isApproved = false,
  student,
  batch,
  selectedCourses = [],
  onRefresh,
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (typeof onRefresh !== 'function' || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const totalCourses = selectedCourses.length;
  const approvedCourses = selectedCourses.filter((c) => c.status === 'APPROVED');
  const rejectedCourses = selectedCourses.filter((c) => c.status === 'REJECTED');
  const pendingCourses = selectedCourses.filter(
    (c) => c.status !== 'APPROVED' && c.status !== 'REJECTED'
  );
  const progressPercent =
    totalCourses > 0 ? Math.round((approvedCourses.length / totalCourses) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6 animate-fade-in">
      {/* Clearance Banner */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-gray-200/80 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <span
              className={`p-2.5 rounded-xl ${
                isApproved
                  ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                  : 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
              }`}
            >
              {isApproved ? <BookmarkCheck size={28} /> : <Clock size={28} />}
            </span>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400 font-sans">
                Academic Clearance Status
              </span>
              <h1 className="text-xl sm:text-2xl font-black text-[#0a1142] dark:text-blue-400 font-display">
                {isApproved
                  ? 'Course Registration Endorsed by Level Advisor'
                  : 'Registration Submitted — Awaiting Advisor Clearance'}
              </h1>
            </div>
          </div>

          {typeof onRefresh === 'function' && (
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              title="Refresh clearance approvals"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#0a1142] dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50 shrink-0"
            >
              <RefreshCw size={13} className={isRefreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">{isRefreshing ? 'Checking...' : 'Refresh Status'}</span>
            </button>
          )}
        </div>

        <p className="text-sm text-gray-600 dark:text-slate-300 mb-6 font-sans leading-relaxed">
          {isApproved
            ? 'Your course registration has been formally endorsed by your Level Advisor and synced with the academic ledger and Moodle.'
            : 'Your registration batch is locked in the SUBMITTED state. Your Level Advisor and Course Lecturers are reviewing your course matrix.'}
        </p>

        {/* Governance Stepper */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 bg-gray-50 dark:bg-slate-800/40 rounded-xl border border-gray-200 dark:border-slate-700/60 text-xs font-sans">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold">
            <CheckCircle2 size={16} />
            <span>1. Draft (Done)</span>
          </div>
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold">
            <CheckCircle2 size={16} />
            <span>2. Submitted (Done)</span>
          </div>
          <div
            className={`flex items-center gap-2 font-bold ${
              isApproved ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {isApproved ? <CheckCircle2 size={16} /> : <Clock size={16} />}
            <span>3. Advisor Endorsement</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400 dark:text-slate-500 font-medium">
            <Circle size={16} />
            <span>4. Senate Cleared</span>
          </div>
        </div>

        {/* Lecturer Endorsement Progress Metric */}
        <div className="mt-4 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-gray-800 dark:text-slate-200 flex items-center gap-1.5">
              <UserCheck size={15} className="text-emerald-600 dark:text-emerald-400" />
              Lecturer Endorsement Progress: {approvedCourses.length} of {totalCourses} Courses Cleared
            </span>
            <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
              {progressPercent}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-slate-700 overflow-hidden flex">
            <div
              className="bg-emerald-500 transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {pendingCourses.length > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1">
              <Clock size={12} className="shrink-0" />
              <span>
                {pendingCourses.length} module{pendingCourses.length > 1 ? 's' : ''} awaiting lecturer clearance. You can contact the assigned lecturer{pendingCourses.length > 1 ? 's' : ''} listed below.
              </span>
            </p>
          )}
        </div>
      </div>

      {/* Enrolled Courses Matrix */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200/80 dark:border-slate-800 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-black text-[#0a1142] dark:text-blue-400 font-display">
              Registered Modules ({batch?.total_units || 0} Total Units)
            </h2>
            <span className="text-xs text-gray-500 dark:text-slate-400 font-sans">
              Matric: {student?.matric_number} • Level: {student?.level}
            </span>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              isApproved
                ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                : 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
            }`}
          >
            {batchStatus}
          </span>
        </div>

        <div className="divide-y divide-gray-100 dark:divide-slate-800">
          {selectedCourses.map((c) => (
            <div
              key={c.course_id}
              className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-[#0a1142] dark:text-blue-400 text-sm font-display">
                    {c.code}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 uppercase tracking-wider font-sans">
                    {c.category}
                  </span>
                  <span className="text-xs font-bold text-gray-800 dark:text-slate-200 font-display">
                    • {c.units} Units
                  </span>
                </div>
                <p className="text-xs text-gray-600 dark:text-slate-400 font-sans mt-0.5">{c.title}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {c.status === 'APPROVED' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 size={13} /> Accepted by Lecturer {c.approved_by_name ? `(${c.approved_by_name})` : ''}
                  </span>
                ) : c.status === 'REJECTED' ? (
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                      <AlertCircle size={13} /> Declined {c.rejected_by_name ? `by ${c.rejected_by_name}` : ''}
                    </span>
                    {c.rejection_reason && (
                      <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5 max-w-xs break-words" title={c.rejection_reason}>
                        "{c.rejection_reason}"
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                    <Clock size={13} /> Pending Lecturer Clearance {c.assigned_lecturer_name ? `• ${c.assigned_lecturer_name}` : ''}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default RegistrationClearanceTracker;
