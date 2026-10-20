import React from 'react';
import { RefreshCw, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

/**
 * Admin Moodle Outbox & Synchronization Queue Card
 *
 * Implements:
 * 1. Spacious, uncluttered queue preview matching the approved mockup
 * 2. Status filter pills (All, Pending, Failed)
 * 3. Status badges with emerald, amber, and rose indicators
 * 4. Single-click [Retry] trigger for failed/retrying sync jobs
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function AdminOutboxQueueCard({
  queue = [],
  filter = 'ALL',
  onFilterChange,
  onRetry,
  isRetrying = false,
  totalCount = 0,
}) {
  const pendingCount = queue.filter((i) => i.status === 'PENDING' || i.status === 'RETRYING').length;
  const failedCount = queue.filter((i) => i.status === 'FAILED' || i.status === 'DEAD_LETTER').length;

  const filteredQueue = queue.filter((item) => {
    if (filter === 'PENDING') return item.status === 'PENDING' || item.status === 'RETRYING';
    if (filter === 'FAILED') return item.status === 'FAILED' || item.status === 'DEAD_LETTER';
    return true;
  });

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-7 border border-gray-200/80 shadow-sm flex flex-col h-full">
      {/* Header with Title and Filter Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-gray-100">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-[#0a1142] font-display">
            Moodle Outbox Synchronization
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Recent Integration Queue • FOCIT Core to Moodle Engine
          </p>
        </div>

        {/* Filter Pills */}
        <div className="inline-flex items-center gap-1.5 p-1 bg-gray-100 rounded-xl">
          <button
            type="button"
            onClick={() => onFilterChange('ALL')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              filter === 'ALL'
                ? 'bg-white text-[#0a1142] shadow-xs'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            All ({totalCount || queue.length})
          </button>
          <button
            type="button"
            onClick={() => onFilterChange('PENDING')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              filter === 'PENDING'
                ? 'bg-white text-amber-700 shadow-xs'
                : 'text-gray-600 hover:text-amber-700'
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => onFilterChange('FAILED')}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              filter === 'FAILED'
                ? 'bg-white text-rose-700 shadow-xs'
                : 'text-gray-600 hover:text-rose-700'
            }`}
          >
            Failed ({failedCount})
          </button>
        </div>
      </div>

      {/* Queue Table */}
      <div className="mt-4 flex-1 overflow-x-auto">
        {filteredQueue.length === 0 ? (
          <div className="py-12 text-center text-gray-400 text-xs">
            <CheckCircle2 size={28} className="mx-auto text-emerald-500 mb-2 opacity-80" />
            No outbox synchronization items matching current filter.
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Operation / Target</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Action / Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 text-xs">
              {filteredQueue.slice(0, 5).map((item, idx) => {
                const isFailed = item.status === 'FAILED';
                const isDeadLetter = item.status === 'DEAD_LETTER';
                const isSynced = item.status === 'SYNCED' || item.status === 'COMPLETED';
                const isPending = item.status === 'PENDING' || item.status === 'RETRYING';

                return (
                  <tr key={item.id || idx} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3.5 px-3 font-semibold text-gray-400">
                      {idx + 1}.
                    </td>
                    <td className="py-3.5 px-3">
                      <div className="font-semibold text-gray-900">
                        {item.eventType || 'Course Enrollment Sync'}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {item.courseCode || item.matricNumber || item.studentName || 'CSC 204'}
                      </div>
                    </td>
                    <td className="py-3.5 px-3">
                      {isSynced && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 size={11} aria-hidden="true" />
                          SYNCED
                        </span>
                      )}
                      {isPending && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock size={11} aria-hidden="true" />
                          {item.status}
                        </span>
                      )}
                      {isFailed && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          <AlertCircle size={11} aria-hidden="true" />
                          FAILED
                        </span>
                      )}
                      {isDeadLetter && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                          <AlertCircle size={11} aria-hidden="true" />
                          DEAD LETTER
                        </span>
                      )}
                      {!isSynced && !isPending && !isFailed && !isDeadLetter && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                          {item.status}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-right">
                      {isFailed || isDeadLetter ? (
                        <button
                          type="button"
                          onClick={() => onRetry(item.id)}
                          disabled={isRetrying}
                          className="px-2.5 py-1 text-xs font-bold rounded-lg bg-gray-100 hover:bg-[#0a1142] hover:text-white text-gray-700 transition-all border border-gray-200 disabled:opacity-50"
                        >
                          {isRetrying ? 'Retrying...' : '[ Retry ]'}
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-400">
                          {item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
