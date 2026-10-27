import React from 'react';
import { Search } from 'lucide-react';

const FILTER_TABS = [
  { id: 'ALL', label: 'All Courses' },
  { id: 'CORE', label: 'Core' },
  { id: 'ELECTIVE', label: 'Electives' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'COMPLETED', label: 'Completed' },
];

/**
 * <CourseFilterBar />
 *
 * Course search and categorical filter bar with WCAG 44x44px touch targets.
 */
export function CourseFilterBar({
  searchQuery = '',
  onSearchChange,
  selectedFilter = 'ALL',
  onFilterChange,
}) {
  return (
    <section aria-label="Course Filters" className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-surface p-4 rounded-2xl border border-surface-border shadow-sm">
      <div className="relative flex-1 min-w-[240px]">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" aria-hidden="true" />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by course code or title (e.g. CSC 204, Algorithms)..."
          className="w-full min-h-[44px] pl-10 pr-4 py-2 text-xs sm:text-sm bg-surface-alt border border-surface-border rounded-xl text-focitText-primary placeholder:text-focitText-muted focus:bg-surface focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-indigo-500 transition-all"
        />
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
        {FILTER_TABS.map((tab) => {
          const isActive = selectedFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onFilterChange(tab.id)}
              className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center justify-center ${
                isActive 
                  ? 'bg-[#0a1142] dark:bg-indigo-600 text-white shadow-sm' 
                  : 'bg-surface-alt hover:bg-slate-200 dark:hover:bg-slate-800 text-focitText-secondary hover:text-[#0a1142] dark:hover:text-white border border-transparent dark:border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default CourseFilterBar;
