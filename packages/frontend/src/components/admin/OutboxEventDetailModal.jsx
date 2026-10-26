import React, { useState } from 'react';
import { X, Copy, Check, AlertCircle, RefreshCw, FileText } from 'lucide-react';

/**
 * OutboxEventDetailModal - Telemetry inspector for outbox events & raw payloads
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function OutboxEventDetailModal({ event, isOpen, onClose, onRetry, isRetrying = false }) {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !event) return null;

  const handleCopyPayload = async () => {
    try {
      const text = JSON.stringify(event.payload || {}, null, 2);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Clipboard copy failed:', err);
    }
  };

  const isFailed = event.status === 'FAILED';
  const isDeadLetter = event.status === 'DEAD_LETTER';
  const isPending = event.status === 'PENDING' || event.status === 'RETRYING';
  const isCompleted = event.status === 'COMPLETED' || event.status === 'SYNCED';
  const isRetryable = ['FAILED', 'PROCESSING', 'COMPLETED', 'SYNCED'].includes(event.status);

  const formatDateTime = (raw) => {
    if (!raw) return '—';
    const d = new Date(raw);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="outbox-modal-title"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#0a1142] text-[#ffb81c]">
              <FileText size={18} />
            </div>
            <div>
              <h2 id="outbox-modal-title" className="text-base font-bold text-[#0a1142]">
                {event.action || event.eventType || 'Event Details'}
              </h2>
              <p className="text-[11px] font-mono text-gray-400">
                Event ID: #{event.id}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-gray-600">
          {/* Status & Key Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-50 border border-gray-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Status</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isFailed ? 'bg-rose-50 text-rose-700 border border-rose-200'
                  : isDeadLetter ? 'bg-purple-50 text-purple-700 border border-purple-200'
                  : isPending ? 'bg-amber-50 text-amber-700 border border-amber-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}>
                {event.status}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-gray-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Attempts</span>
              <span className="font-bold text-slate-800 text-sm">
                {event.retryCount ?? 0}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-gray-100 col-span-2">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Target / Subject</span>
              <span className="font-semibold text-slate-800 truncate block" title={event.targetStudent || event.matricNumber}>
                {event.targetStudent || event.matricNumber || event.studentId || 'Batch Sync'}
              </span>
            </div>
          </div>

          {/* Timestamps Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50/70 border border-gray-100">
            <div>
              <span className="text-[10px] uppercase font-bold text-gray-400 block">Created At</span>
              <span className="font-mono text-slate-700">{formatDateTime(event.createdAt || event.timestamp)}</span>
            </div>
            <div>
              <span className="text-[10px] uppercase font-bold text-gray-400 block">Last Synced / Processed</span>
              <span className="font-mono text-slate-700">{formatDateTime(event.updatedAt || event.timestamp)}</span>
            </div>
          </div>

          {/* Error Trace if Failed */}
          {event.lastError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800">
              <span className="text-[10px] uppercase font-bold text-rose-600 block mb-1 flex items-center gap-1">
                <AlertCircle size={12} /> Last Error Trace
              </span>
              <p className="font-mono text-[11px] break-all">{event.lastError}</p>
            </div>
          )}

          {/* Payload JSON Viewer */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                Transactional Payload
              </span>
              <button
                type="button"
                onClick={handleCopyPayload}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy JSON'}</span>
              </button>
            </div>
            <pre className="p-3.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-56 leading-relaxed border border-slate-800">
              {JSON.stringify(event.payload || {}, null, 2)}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-gray-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Close
          </button>

          {onRetry && isRetryable && (
            <button
              type="button"
              onClick={() => onRetry(event.id)}
              disabled={isRetrying}
              className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs ${
                isFailed
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-[#0a1142] hover:bg-blue-900 text-white'
              } disabled:opacity-50`}
            >
              <RefreshCw size={13} className={isRetrying ? 'animate-spin' : ''} />
              <span>{isRetrying ? 'Syncing...' : isCompleted ? 'Re-sync with Moodle' : 'Retry Synchronization'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default OutboxEventDetailModal;
