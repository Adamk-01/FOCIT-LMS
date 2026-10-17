import React from 'react';
import { Search, ChevronRight, FileCheck2, RefreshCw, X, Filter } from 'lucide-react';

const CATEGORIES = ['ALL', 'CORE', 'ELECTIVE', 'GENERAL'];

/**
 * <AvailableCoursesTable />
 *
 * Course catalog matrix with search, category filtering, and selection controls.
 * Uses contain: layout paint to isolate scroll reflow calculations.
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
}) {
  const filteredCatalog = catalog.filter((course) => {
    const matchesCategory =
      categoryFilter === 'ALL' || course.category === categoryFilter;
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      course.code.toLowerCase().includes(query) ||
      course.title.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-white rounded-2xl border border-gray-200/80 shadow-sm overflow-hidden">
      {/* Matrix Controls & Search Bar */}
      <div className="p-4 sm:p-5 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAllCore}
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0a1142] text-[#ffb81c] text-xs font-bold hover:bg-[#16258f] transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
          >
            Select All Core
          </button>
          <button
            type="button"
            onClick={clearDraft}
            disabled={selectedCourseIds.length === 0}
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 rounded-xl bg-gray-200 text-gray-700 text-xs font-bold hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Clear Selection
          </button>
        </div>

        {/* Search Input & Category Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search code or title..."
              className="w-full min-h-[44px] pl-9 pr-8 py-2 rounded-xl border border-gray-300 bg-white text-xs font-sans placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#0a1142] transition-all"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                aria-label="Clear search query"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  categoryFilter === cat
                    ? 'bg-[#0a1142] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-200/60'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Course Matrix Table: Physical Scrollport Isolation via contain: layout paint */}
      <div
        className="flex-1 overflow-y-auto overflow-x-auto min-h-0 [contain:layout_paint]"
      >
        {filteredCatalog.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <Filter className="w-8 h-8 mx-auto text-gray-400 mb-2" aria-hidden="true" />
            <p className="text-sm font-semibold">No courses found matching criteria.</p>
            <button
              type="button"
              onClick={() => {
                setCategoryFilter('ALL');
                setSearchQuery('');
              }}
              className="mt-3 text-xs font-bold text-[#0a1142] underline hover:text-[#16258f]"
            >
              Reset filters & search
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-sm">
            <thead className="sticky top-0 bg-gray-100/95 backdrop-blur-sm text-gray-700 text-xs uppercase tracking-wider font-bold z-10 border-b border-gray-200">
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
              {filteredCatalog.map((course) => {
                const isSelected = selectedCourseIds.includes(course.course_id);
                const isFull = course.enrolled_count >= course.max_capacity;

                return (
                  <tr
                    key={course.course_id}
                    onClick={() => !isFull && toggleCourse(course.course_id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#0a1142]/5 font-medium'
                        : 'hover:bg-gray-50/80'
                    } ${isFull ? 'opacity-50 cursor-not-allowed bg-gray-50' : ''}`}
                  >
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center min-h-[44px]">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isFull}
                          onChange={() => toggleCourse(course.course_id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`Select ${course.code}: ${course.title}`}
                          className="w-4 h-4 rounded text-[#0a1142] focus:ring-[#0a1142] border-gray-300 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </div>
                    </td>
                    <td className="py-3 px-4 font-black font-display text-[#0a1142]">
                      {course.code}
                    </td>
                    <td className="py-3 px-4 text-gray-800 text-xs sm:text-sm">
                      {course.title}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                          course.category === 'CORE'
                            ? 'bg-blue-100 text-blue-800'
                            : course.category === 'ELECTIVE'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {course.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-bold text-gray-800 font-display">
                      {course.units}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-xs font-semibold ${
                          isFull ? 'text-red-600 font-bold' : 'text-gray-600'
                        }`}
                      >
                        {course.enrolled_count} / {course.max_capacity}
                        {isFull && ' (FULL)'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Sticky Bottom Action Bar with WCAG 44x44px Touch Targets */}
      <div className="p-4 sm:p-5 bg-gray-50 border-t border-gray-200/80 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSaveDraft}
            disabled={isSavingDraft}
            className="min-h-[44px] min-w-[44px] px-4 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-bold transition-all flex items-center gap-2 shadow-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
          >
            {isSavingDraft ? (
              <RefreshCw size={14} className="animate-spin text-gray-500" />
            ) : (
              <FileCheck2 size={14} className="text-[#0a1142]" />
            )}
            <span>{saveDraftSuccess ? 'Draft Saved ✓' : 'Save Draft'}</span>
          </button>

          <span className="text-xs text-gray-500 hidden sm:inline font-sans">
            {selectedCourseIds.length} course(s) selected
          </span>
        </div>

        <button
          type="button"
          onClick={onProceed}
          disabled={selectedCourseIds.length === 0 || isOverMaximum}
          className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs sm:text-sm font-bold flex items-center gap-2 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0a1142]"
        >
          <span>Proceed to Review</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}

export default AvailableCoursesTable;
