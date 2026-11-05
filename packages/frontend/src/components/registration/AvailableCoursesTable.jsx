import React, { useState } from 'react';
import { ChevronRight, FileCheck2, RefreshCw, Filter } from 'lucide-react';
import { CourseMatrixToolbar } from './CourseMatrixToolbar';
import { CourseMatrixRow } from './CourseMatrixRow';

/**
 * <AvailableCoursesTable />
 * Course catalog matrix with level prioritization, carryover discovery, and category controls.
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function AvailableCoursesTable({
  catalog = [],
  selectedCourseIds = [],
  toggleCourse,
  selectAllCore,
  clearDraft,
  categoryFilter = 'ALL',
  setCategoryFilter,
  searchQuery = '',
  setSearchQuery,
  onSaveDraft,
  isSavingDraft = false,
  saveDraftSuccess = false,
  onProceed,
  isOverMaximum = false,
  studentLevel = 200,
}) {
  const [levelFilter, setLevelFilter] = useState('CURRENT');

  const hasCarryoverCourses = catalog.some(
    (c) => c.is_carryover || (studentLevel && c.level < studentLevel)
  );

  const filteredCatalog = catalog.filter((course) => {
    // 1. Category Filter
    if (categoryFilter !== 'ALL' && course.category !== categoryFilter) return false;

    // 2. Search Query (Searches across ALL levels globally)
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      return (
        course.code.toLowerCase().includes(query) ||
        course.title.toLowerCase().includes(query)
      );
    }

    // 3. Level Filter (Only active when not searching)
    const isCurrentLevel = course.level === studentLevel;
    const isCarryover = course.is_carryover || course.level < studentLevel;

    if (levelFilter === 'CURRENT') return isCurrentLevel;
    if (levelFilter === 'CARRYOVER') return isCarryover;
    return true; // 'ALL'
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
      <CourseMatrixToolbar
        selectAllCore={selectAllCore}
        clearDraft={clearDraft}
        hasSelection={selectedCourseIds.length > 0}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        levelFilter={levelFilter}
        setLevelFilter={setLevelFilter}
        studentLevel={studentLevel}
        hasCarryoverCourses={hasCarryoverCourses}
      />

      {/* Course Matrix Table: Physical Scrollport Isolation via contain: layout paint */}
      <div className="flex-1 overflow-y-auto overflow-x-auto min-h-0 [contain:layout_paint]">
        {filteredCatalog.length === 0 ? (
          <div className="p-12 text-center text-gray-500 dark:text-slate-400">
            <Filter className="w-8 h-8 mx-auto text-gray-400 dark:text-slate-500 mb-2" aria-hidden="true" />
            <p className="text-sm font-semibold">No courses found matching criteria.</p>
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('ALL');
                setLevelFilter('ALL');
                setSearchQuery('');
              }}
              className="mt-3 text-xs font-bold text-[#0a1142] dark:text-blue-400 underline hover:text-[#16258f] dark:hover:text-blue-300"
            >
              Reset filters & search
            </button>
          </div>
        ) : (
          <>
            {/* Desktop View (>= md) */}
            <div className="hidden md:block">
              <table className="w-full text-left border-collapse text-sm">
                <thead className="sticky top-0 bg-gray-100/95 dark:bg-slate-800/95 backdrop-blur-sm text-gray-700 dark:text-slate-300 text-xs uppercase tracking-wider font-bold z-10 border-b border-gray-200 dark:border-slate-700">
                  <tr>
                    <th className="py-3 px-4 w-14 text-center">Select</th>
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Module Title</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Units</th>
                    <th className="py-3 px-4">Seats</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-sans">
                  {filteredCatalog.map((course) => (
                    <CourseMatrixRow
                      key={course.course_id}
                      course={course}
                      isSelected={selectedCourseIds.includes(course.course_id)}
                      toggleCourse={toggleCourse}
                      studentLevel={studentLevel}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile / Small Tablet Card View (< md) */}
            <div className="md:hidden p-3 space-y-2.5">
              {filteredCatalog.map((course) => {
                const isSelected = selectedCourseIds.includes(course.course_id);
                const maxCapacity = Number(course.max_capacity) || 0;
                const isFull = maxCapacity > 0 && (course.enrolled_count || 0) >= maxCapacity;
                const canToggle = isSelected || !isFull;
                const isCarryover = course.is_carryover || (studentLevel && course.level < studentLevel);

                return (
                  <div
                    key={course.course_id}
                    onClick={() => canToggle && toggleCourse(course.course_id)}
                    className={`p-3.5 rounded-2xl border transition-all ${
                      canToggle ? 'cursor-pointer' : 'cursor-not-allowed'
                    } ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-indigo-950/30 border-[#0a1142] dark:border-indigo-500 shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 hover:border-gray-300'
                    } ${isFull && !isSelected ? 'opacity-50 cursor-not-allowed bg-gray-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!canToggle}
                          onChange={() => canToggle && toggleCourse(course.course_id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${course.code}`}
                          className="w-5 h-5 rounded text-[#0a1142] focus:ring-[#0a1142] border-gray-300 cursor-pointer disabled:cursor-not-allowed"
                        />
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-black text-sm text-[#0a1142] dark:text-[#ffb81c]">{course.code}</span>
                            <span className="text-xs font-bold text-gray-700 dark:text-slate-300">({course.units} Units)</span>
                            {isCarryover && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
                                {course.level}L Carryover
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-800 dark:text-slate-200 font-medium mt-1 leading-snug">{course.title}</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between text-[11px] text-gray-500 border-t border-gray-100 dark:border-slate-800 pt-2">
                      <span className={`px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                        course.category === 'CORE'
                          ? 'bg-blue-100 text-blue-800'
                          : course.category === 'ELECTIVE'
                          ? 'bg-purple-100 text-purple-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {course.category}
                      </span>
                      <span className={isFull ? 'text-red-600 font-bold' : 'text-gray-500'}>
                        Seats: {maxCapacity > 0 ? `${course.enrolled_count || 0}/${maxCapacity}${isFull ? ' (FULL)' : ''}` : `${course.enrolled_count || 0} (Unlimited)`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Sticky Bottom Action Bar with WCAG 44x44px Touch Targets */}
      <div className="p-4 sm:p-5 bg-gray-50 dark:bg-slate-800/40 border-t border-gray-200/80 dark:border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button" onClick={onSaveDraft} disabled={isSavingDraft}
            className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-bold transition-all flex items-center gap-2 shadow-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
          >
            {isSavingDraft ? <RefreshCw size={14} className="animate-spin text-gray-500" /> : <FileCheck2 size={14} className="text-[#0a1142]" />}
            <span>{saveDraftSuccess ? 'Draft Saved ✓' : 'Save Draft'}</span>
          </button>
          <span className="text-xs text-gray-500 hidden sm:inline font-sans">
            {selectedCourseIds.length} course(s) selected
          </span>
        </div>

        <button
          type="button" onClick={onProceed}
          disabled={selectedCourseIds.length === 0 || isOverMaximum}
          className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs sm:text-sm font-bold flex items-center gap-2 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
        >
          <span>Proceed to Review</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
export default AvailableCoursesTable;
