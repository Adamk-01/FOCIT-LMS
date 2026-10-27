import React from 'react';
import { Search } from 'lucide-react';

/**
 * Forum Search and Results Counter Bar
 *
 * Implements:
 * 1. Filter input for titles, messages, and authors
 * 2. Real-time topic count indicator
 * 3. 44px minimum touch targets on inputs
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function ForumSearchBar({ searchQuery = '', onSearchChange, filteredCount = 0 }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between gap-4">
      <div className="relative flex-1 max-w-md">
        <Search
          size={16}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500"
          aria-hidden="true"
        />
        <input
          type="text"
          placeholder="Search discussions, topics, or authors..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search discussions, topics, or authors"
          className="w-full min-h-[44px] pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition-all font-medium"
        />
      </div>

      <div className="text-xs text-gray-500 dark:text-slate-400 font-medium shrink-0">
        Showing <span className="font-bold text-[#0a1142] dark:text-slate-100">{filteredCount}</span> {filteredCount === 1 ? 'topic' : 'topics'}
      </div>
    </div>
  );
}

export default ForumSearchBar;
