import React from 'react';

/**
 * <CourseGridSkeleton />
 *
 * Deterministic loading state skeleton for registered courses directory
 * Meets Zero-Trust UI Requirement: Explicit Loading State (3-second wait)
 */
export function CourseGridSkeleton({ count = 6 }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm animate-pulse space-y-4">
          <div className="flex items-center justify-between">
            <div className="w-20 h-6 bg-gray-200 dark:bg-slate-700 rounded-full" />
            <div className="w-16 h-5 bg-gray-200 dark:bg-slate-700 rounded" />
          </div>
          <div className="w-3/4 h-6 bg-gray-300 dark:bg-slate-600 rounded" />
          <div className="w-1/2 h-4 bg-gray-100 dark:bg-slate-800 rounded" />
          <div className="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default CourseGridSkeleton;
