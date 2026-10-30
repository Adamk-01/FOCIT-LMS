import React from 'react';
import { BookX, RotateCcw, Search } from 'lucide-react';

export function LibraryEmptyState({ searchQuery, onClearFilters }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 rounded-2xl my-8">
      <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/60 dark:border-indigo-800/40 flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-4 shadow-sm">
        {searchQuery ? <Search className="w-8 h-8" /> : <BookX className="w-8 h-8" />}
      </div>
      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-1.5">
        No Academic Materials Found
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mb-6 leading-relaxed">
        {searchQuery 
          ? `No items matched your query "${searchQuery}". Check for typos or broaden your search terms.`
          : 'No published library items match your current filter criteria. Try adjusting the department, level, or semester filters.'}
      </p>
      <button
        type="button"
        onClick={onClearFilters}
        className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span>Clear All Filters</span>
      </button>
    </div>
  );
}
