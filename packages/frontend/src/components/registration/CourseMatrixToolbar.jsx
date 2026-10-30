import React from 'react';
import { Search, X } from 'lucide-react';

const CATEGORIES = ['ALL', 'CORE', 'ELECTIVE', 'GENERAL'];

/**
 * <CourseMatrixToolbar />
 * Level filtering, category switcher, and carryover search toolbar.
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function CourseMatrixToolbar({
  selectAllCore,
  clearDraft,
  hasSelection,
  searchQuery,
  setSearchQuery,
  categoryFilter,
  setCategoryFilter,
  levelFilter,
  setLevelFilter,
  studentLevel,
  hasCarryoverCourses,
}) {
  return (
    <div className="p-4 sm:p-5 border-b border-gray-100 bg-gray-50/60 flex flex-col gap-3 shrink-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Core & Selection Actions */}
        <div className="flex items-center gap-2">
          <button
            type="button" onClick={selectAllCore}
            className="inline-flex items-center justify-center min-h-[40px] px-3.5 py-1.5 rounded-xl bg-[#0a1142] text-[#ffb81c] text-xs font-bold hover:bg-[#16258f] transition-colors shadow-xs"
          >
            Select All Core
          </button>
          <button
            type="button" onClick={clearDraft} disabled={!hasSelection}
            className="inline-flex items-center justify-center min-h-[40px] px-3.5 py-1.5 rounded-xl bg-gray-200 text-gray-700 text-xs font-bold hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Clear Selection
          </button>
        </div>

        {/* Academic Level Scope Switcher */}
        <div className="inline-flex items-center gap-1 bg-white p-1 rounded-xl border border-gray-200 shadow-xs">
          <button
            type="button" onClick={() => setLevelFilter('CURRENT')}
            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              levelFilter === 'CURRENT'
                ? 'bg-[#0a1142] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            {studentLevel}L (Current Curriculum)
          </button>
          {hasCarryoverCourses && (
            <button
              type="button" onClick={() => setLevelFilter('CARRYOVER')}
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                levelFilter === 'CARRYOVER'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-amber-800 hover:text-amber-950 hover:bg-amber-50'
              }`}
            >
              Carryovers & Lower Levels
            </button>
          )}
          <button
            type="button" onClick={() => setLevelFilter('ALL')}
            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold transition-all ${
              levelFilter === 'ALL'
                ? 'bg-[#0a1142] text-white shadow-xs'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            All Eligible Courses
          </button>
        </div>
      </div>

      {/* Row 2: Search Input & Category Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search code or title (e.g. 102, CSC, Calculus)..."
            className="w-full min-h-[40px] pl-9 pr-8 py-2 rounded-xl border border-gray-300 bg-white text-xs font-sans placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0a1142] transition-all"
          />
          {searchQuery && (
            <button
              type="button" onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
          {CATEGORIES.map((cat) => (
            <button
              key={cat} type="button" onClick={() => setCategoryFilter(cat)}
              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                categoryFilter === cat
                  ? 'bg-[#0a1142] text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
export default CourseMatrixToolbar;
