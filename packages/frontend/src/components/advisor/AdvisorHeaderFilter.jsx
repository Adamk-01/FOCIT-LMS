import React from 'react';
import { ShieldCheck, RefreshCw, Filter } from 'lucide-react';

/**
 * Level Advisor Cohort Header and Filter Bar
 *
 * Implements:
 * 1. Governance title and active academic semester badge
 * 2. Level filter controls (100, 200, 300, 400)
 * 3. Status filter buttons (SUBMITTED, ADVISOR_APPROVED, REJECTED, ALL)
 * 4. WCAG minimum 44px touch targets on all interactive selectors
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function AdvisorHeaderFilter({
  semesterName = '2026/2027 Rain Semester',
  selectedLevel = '200',
  onSelectLevel,
  selectedStatus = 'SUBMITTED',
  onSelectStatus,
  onRefresh,
  isLoading = false,
  isActionLocked = false,
}) {
  return (
    <header className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#0a1142]/10 text-[#0a1142] mb-1">
            <ShieldCheck size={14} className="text-[#0a1142]" aria-hidden="true" />
            <span>Level Advisor Governance Portal • Senate Clearance Engine</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#0a1142] font-display">
            Course Registration Clearance Cohort
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Review, endorse, or return student registration submissions for Level {selectedLevel}.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs px-3 py-2 rounded-lg bg-gray-100 font-bold text-gray-800">
            {semesterName}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading || isActionLocked}
            className="p-2.5 min-w-[44px] min-h-[44px] rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50 touch-manipulation flex items-center justify-center"
            title="Refresh Cohort Data"
            aria-label="Refresh Cohort Data"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Filter Selectors */}
      <div className="mt-6 pt-5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mr-1 flex items-center gap-1">
            <Filter size={12} aria-hidden="true" />
            Level:
          </span>
          {['100', '200', '300', '400'].map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => onSelectLevel(lvl)}
              className={`px-3 py-2 min-h-[44px] rounded-xl text-xs font-bold transition-all touch-manipulation ${
                selectedLevel === lvl
                  ? 'bg-[#0a1142] text-[#ffb81c] shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {lvl} Level
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mr-1">
            Status:
          </span>
          {[
            { id: 'SUBMITTED', label: 'Pending Review' },
            { id: 'ADVISOR_APPROVED', label: 'Approved' },
            { id: 'REJECTED', label: 'Rejected' },
            { id: 'ALL', label: 'All Batches' },
          ].map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => onSelectStatus(st.id)}
              className={`px-3 py-2 min-h-[44px] rounded-xl text-xs font-bold transition-all touch-manipulation ${
                selectedStatus === st.id
                  ? 'bg-[#0a1142] text-white shadow-sm'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

export default AdvisorHeaderFilter;
