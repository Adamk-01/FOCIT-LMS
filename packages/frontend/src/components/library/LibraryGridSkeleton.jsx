import React from 'react';

export function LibraryGridSkeleton({ count = 6 }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 sm:gap-7">
      {Array.from({ length: count }).map((_, idx) => (
        <div 
          key={idx}
          className="flex flex-col h-80 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden p-6 animate-pulse"
        >
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="h-6 w-28 bg-slate-200 dark:bg-slate-800 rounded-lg" />
            <div className="h-6 w-16 bg-slate-200 dark:bg-slate-800 rounded-lg" />
          </div>
          <div className="h-6 w-4/5 bg-slate-200 dark:bg-slate-800 rounded-md mb-2" />
          <div className="h-4 w-3/5 bg-slate-200 dark:bg-slate-800 rounded-md mb-5" />
          <div className="space-y-2 mb-5">
            <div className="h-3 w-full bg-slate-100 dark:bg-slate-800/60 rounded" />
            <div className="h-3 w-4/5 bg-slate-100 dark:bg-slate-800/60 rounded" />
          </div>
          <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="h-4 w-20 bg-slate-200 dark:bg-slate-800 rounded" />
            <div className="h-9 w-28 bg-slate-200 dark:bg-slate-800 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
