import React from 'react';
import { BookOpen, ShieldAlert, HardDrive, FileCheck, Layers, RefreshCw } from 'lucide-react';

export function LibraryAdminStatsHeader({ stats, isLoading, onRefresh, onRunReaper, isReaping }) {
  const counts = stats?.counts || {};
  const storage = stats?.storage || {};

  const totalItems = counts.total_items || 0;
  const publishedCount = counts.published_count || 0;
  const embargoedCount = counts.embargoed_count || 0;
  const draftCount = counts.draft_count || 0;
  const distinctBlobs = counts.distinct_cas_blobs || 0;

  const usedGb = (Number(storage.usedBytes || 0) / (1024 * 1024 * 1024)).toFixed(2);
  const quotaGb = (Number(storage.quotaBytes || 15 * 1024 * 1024 * 1024) / (1024 * 1024 * 1024)).toFixed(1);
  const storagePercent = Math.min(100, Math.round((Number(storage.usedBytes || 0) / Number(storage.quotaBytes || 1)) * 100));

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Digital Library Ingestion & Curation Cockpit
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Content-Addressed Storage (CAS) with Atomic Reference Counting & Zero-Day Exam Quarantine
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRunReaper}
            disabled={isReaping}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50"
            title="Clean up unreferenced CAS blobs older than 24 hours"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReaping ? 'animate-spin' : ''}`} />
            {isReaping ? 'Reaping...' : 'Run Reaper'}
          </button>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Refresh Metrics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Catalog Items</span>
            <Layers className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <p className="text-lg font-bold text-slate-900 dark:text-white mt-1">{totalItems}</p>
        </div>

        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
          <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400">
            <span>Live Published</span>
            <FileCheck className="w-3.5 h-3.5" />
          </div>
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300 mt-1">{publishedCount}</p>
        </div>

        <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
          <div className="flex items-center justify-between text-xs text-amber-600 dark:text-amber-400">
            <span>Exam Embargoed</span>
            <ShieldAlert className="w-3.5 h-3.5" />
          </div>
          <p className="text-lg font-bold text-amber-700 dark:text-amber-300 mt-1">{embargoedCount}</p>
        </div>

        <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
          <div className="flex items-center justify-between text-xs text-blue-600 dark:text-blue-400">
            <span>Deduplicated Blobs</span>
            <HardDrive className="w-3.5 h-3.5" />
          </div>
          <p className="text-lg font-bold text-blue-700 dark:text-blue-300 mt-1">{distinctBlobs}</p>
        </div>

        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg col-span-2 md:col-span-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Department Storage</span>
            <span>{storagePercent}%</span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                storagePercent > 90 ? 'bg-rose-500' : storagePercent > 70 ? 'bg-amber-500' : 'bg-indigo-600'
              }`}
              style={{ width: `${storagePercent}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 truncate">
            {usedGb} GB / {quotaGb} GB
          </p>
        </div>
      </div>
    </div>
  );
}

