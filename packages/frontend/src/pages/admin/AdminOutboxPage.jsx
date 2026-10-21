import React from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useAdminDashboard } from '../../hooks/useAdminDashboard';

/**
 * Moodle Integration Engine & Transactional Outbox Page
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function AdminOutboxPage() {
  const {
    outbox, isOutboxLoading, outboxFilter, setOutboxFilter, retryOutbox, isRetryingOutbox,
  } = useAdminDashboard();

  const queue = outbox?.moodleSyncQueue || [];
  const pendingCount = queue.filter((i) => i.status === 'PENDING' || i.status === 'RETRYING').length;
  const failedCount = queue.filter((i) => i.status === 'FAILED' || i.status === 'DEAD_LETTER').length;

  const filteredQueue = queue.filter((item) => {
    if (outboxFilter === 'PENDING') return item.status === 'PENDING' || item.status === 'RETRYING';
    if (outboxFilter === 'FAILED') return item.status === 'FAILED' || item.status === 'DEAD_LETTER';
    return true;
  });

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-black text-[#0a1142] font-display">Moodle Integration Outbox</h1>
          <p className="text-xs text-gray-500 mt-1">Real-time transactional queue monitoring and automated Moodle synchronization</p>
        </div>

        {/* Filter Pills */}
        <div className="inline-flex items-center gap-1.5 p-1 bg-gray-100 rounded-xl">
          <button
            type="button"
            onClick={() => setOutboxFilter('ALL')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              outboxFilter === 'ALL' ? 'bg-white text-[#0a1142] shadow-xs' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            All ({queue.length})
          </button>
          <button
            type="button"
            onClick={() => setOutboxFilter('PENDING')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              outboxFilter === 'PENDING' ? 'bg-white text-amber-700 shadow-xs' : 'text-gray-600 hover:text-amber-700'
            }`}
          >
            Pending ({pendingCount})
          </button>
          <button
            type="button"
            onClick={() => setOutboxFilter('FAILED')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
              outboxFilter === 'FAILED' ? 'bg-white text-rose-700 shadow-xs' : 'text-gray-600 hover:text-rose-700'
            }`}
          >
            Failed ({failedCount})
          </button>
        </div>
      </div>

      {/* Outbox Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          {isOutboxLoading ? (
            <div className="py-16 text-center text-xs text-gray-400">Loading synchronization queue...</div>
          ) : filteredQueue.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-xs">
              <CheckCircle2 size={32} className="mx-auto text-emerald-500 mb-2 opacity-80" />
              No outbox events matching the selected filter.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-slate-50/50">
                  <th className="py-3 px-4">Event ID</th>
                  <th className="py-3 px-4">Operation / Target</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredQueue.map((item) => {
                  const isFailed = item.status === 'FAILED' || item.status === 'DEAD_LETTER';
                  const isPending = item.status === 'PENDING' || item.status === 'RETRYING';
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-500 text-[11px]">#{item.id}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-800">{item.action || item.type || 'Course Enrollment Sync'}</div>
                        <div className="text-[11px] text-gray-400 font-mono">{item.targetStudent || item.payload?.studentId || 'Batch Sync'}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          isFailed ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : isPending ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-gray-500 text-[11px] whitespace-nowrap">
                        {item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {isFailed ? (
                          <button
                            type="button"
                            onClick={() => retryOutbox(item.id)}
                            disabled={isRetryingOutbox}
                            className="px-3 py-1 rounded-lg text-[11px] font-bold bg-[#0a1142] text-white hover:bg-blue-900 transition-colors disabled:opacity-50"
                          >
                            Retry Sync
                          </button>
                        ) : (
                          <span className="text-gray-400 text-[11px]">—</span>
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
    </div>
  );
}
export default AdminOutboxPage;
