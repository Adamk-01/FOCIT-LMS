import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, Eye } from 'lucide-react';
import { useAdminDashboard } from '../../hooks/useAdminDashboard';
import { OutboxEventDetailModal } from '../../components/admin/OutboxEventDetailModal';

/**
 * Formats ISO timestamp into a readable date and time string.
 */
function formatEventTime(raw) {
  if (!raw) return { dateStr: '—', timeStr: '' };
  const d = new Date(raw);
  if (isNaN(d.getTime())) return { dateStr: '—', timeStr: '' };
  return {
    dateStr: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    timeStr: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

/**
 * Moodle Integration Engine & Transactional Outbox Page
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function AdminOutboxPage() {
  const {
    outbox, isOutboxLoading, outboxFilter, setOutboxFilter, retryOutbox, isRetryingOutbox,
  } = useAdminDashboard();

  const [retryingId, setRetryingId] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);

  const handleRetry = async (id) => {
    setRetryingId(id);
    try {
      await retryOutbox(id);
    } finally {
      setRetryingId(null);
    }
  };

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
                  const isFailed = item.status === 'FAILED';
                  const isDeadLetter = item.status === 'DEAD_LETTER';
                  const isPending = item.status === 'PENDING' || item.status === 'RETRYING';
                  const isItemRetrying = isRetryingOutbox && retryingId === item.id;
                  const { dateStr, timeStr } = formatEventTime(item.timestamp || item.createdAt || item.updatedAt);

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-500 text-[11px]">#{item.id}</td>
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-800">{item.action || item.type || item.eventType || 'Course Enrollment Sync'}</div>
                        <div className="text-[11px] text-gray-400 font-mono truncate max-w-xs">{item.targetStudent || item.matricNumber || item.studentId || 'Batch Sync'}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          isFailed ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : isDeadLetter ? 'bg-purple-50 text-purple-700 border border-purple-200'
                            : isPending ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-gray-500 text-[11px] whitespace-nowrap">
                        <div className="flex flex-col leading-tight">
                          <span className="font-semibold text-slate-700">{dateStr}</span>
                          {timeStr && <span className="text-[10px] text-gray-400 font-mono mt-0.5">{timeStr}</span>}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedEvent(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-[#0a1142] hover:text-white transition-colors border border-slate-200/80"
                            title="Inspect event payload and trace"
                          >
                            <Eye size={12} />
                            <span>Details</span>
                          </button>
                          {isFailed ? (
                            <button
                              type="button"
                              onClick={() => handleRetry(item.id)}
                              disabled={isRetryingOutbox}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-bold bg-[#0a1142] text-white hover:bg-blue-900 transition-colors disabled:opacity-50"
                            >
                              <RefreshCw size={11} className={isItemRetrying ? 'animate-spin' : ''} />
                              <span>{isItemRetrying ? 'Retrying...' : 'Retry'}</span>
                            </button>
                          ) : isDeadLetter ? (
                            <button
                              type="button"
                              onClick={() => handleRetry(item.id)}
                              disabled={isRetryingOutbox}
                              className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-bold bg-purple-700 text-white hover:bg-purple-800 transition-colors disabled:opacity-50"
                            >
                              <RefreshCw size={11} className={isItemRetrying ? 'animate-spin' : ''} />
                              <span>Recover</span>
                            </button>
                          ) : isPending ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 font-medium px-2 py-0.5 bg-amber-50 rounded-md border border-amber-200">
                              <RefreshCw size={11} className="animate-spin text-amber-600" />
                              <span>Queued</span>
                            </span>
                          ) : isCompleted ? (
                            <button
                              type="button"
                              onClick={() => handleRetry(item.id)}
                              disabled={isRetryingOutbox}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 transition-colors disabled:opacity-50"
                              title="Re-synchronize with Moodle upstream"
                            >
                              <RefreshCw size={11} className={isItemRetrying ? 'animate-spin' : ''} />
                              <span>{isItemRetrying ? 'Syncing...' : 'Re-sync'}</span>
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Inspector Modal */}
      <OutboxEventDetailModal
        event={selectedEvent}
        isOpen={Boolean(selectedEvent)}
        onClose={() => setSelectedEvent(null)}
        onRetry={async (id) => {
          try {
            await handleRetry(id);
            setSelectedEvent(null);
          } catch (err) {
            console.error('Outbox retry modal execution failed:', err);
          }
        }}
        isRetrying={isRetryingOutbox}
      />
    </div>
  );
}

export default AdminOutboxPage;
