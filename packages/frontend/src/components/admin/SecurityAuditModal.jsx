import React from 'react';
import { X, ShieldCheck, Clock, FileText } from 'lucide-react';

/**
 * Security & Identity Audit Ledger Modal
 *
 * Implements:
 * 1. Read-only inspection of immutable Senate identity logs (WORM defense)
 * 2. Event type badges, actor/target pairings, IP addresses, and timestamps
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function SecurityAuditModal({ isOpen, onClose, logs = [], isLoading = false }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-modal-title"
        className="bg-white rounded-2xl max-w-3xl w-full p-6 sm:p-8 shadow-xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="pb-4 border-b border-gray-100">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 mb-1">
            <ShieldCheck size={12} />
            <span>WORM Tamper-Evident Ledger</span>
          </div>
          <h2 id="audit-modal-title" className="text-xl font-extrabold text-[#0a1142] font-display">
            Security & Identity Audit Ledger
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Cryptographically chained governance events and administrative credential changes.
          </p>
        </div>

        {/* Content Table */}
        <div className="mt-4 flex-1 overflow-y-auto overflow-x-auto">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-gray-400">
              Loading security audit records...
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400">
              <FileText size={28} className="mx-auto text-gray-300 mb-2" />
              No audit log entries recorded yet.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <th className="py-2.5 px-3">Event Type</th>
                  <th className="py-2.5 px-3">Actor</th>
                  <th className="py-2.5 px-3">Target</th>
                  <th className="py-2.5 px-3">IP Address</th>
                  <th className="py-2.5 px-3 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3 px-3">
                      <span className="font-mono font-bold text-[11px] text-[#0a1142] bg-slate-100 px-2 py-0.5 rounded-md">
                        {log.eventType}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-medium text-gray-700">
                      {log.actorId} <span className="text-gray-400 text-[10px]">({log.actorRole})</span>
                    </td>
                    <td className="py-3 px-3 text-gray-600 font-mono text-[11px]">
                      {log.targetId}
                    </td>
                    <td className="py-3 px-3 text-gray-500 font-mono text-[11px]">
                      {log.ipAddress || '—'}
                    </td>
                    <td className="py-3 px-3 text-right text-gray-400 text-[11px] whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#0a1142] text-white hover:bg-blue-900 transition-colors min-h-[44px]"
          >
            Close Ledger
          </button>
        </div>
      </div>
    </div>
  );
}
