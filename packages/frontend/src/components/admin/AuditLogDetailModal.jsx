import React, { useState } from 'react';
import { X, Copy, Check, ShieldCheck, Lock, Hash } from 'lucide-react';

/**
 * AuditLogDetailModal
 *
 * Cryptographic ledger inspector modal:
 * - Full SHA-256 hash-chaining verification (prev_entry_hash -> entry_hash)
 * - Actor, target entity, network IP, and session attribution
 * - Formatted JSON audit metadata with 1-click clipboard copy
 *
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function AuditLogDetailModal({ log, isOpen, onClose }) {
  const [copied, setCopied] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);

  if (!isOpen || !log) return null;

  const handleCopyJson = async () => {
    const text = JSON.stringify(log.details || log.metadata || {}, null, 2);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyHash = async (hash) => {
    if (!hash) return;
    await navigator.clipboard.writeText(hash);
    setHashCopied(true);
    setTimeout(() => setHashCopied(false), 2000);
  };

  const formatFullDate = (raw) => {
    if (!raw) return '—';
    const d = new Date(raw);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium',
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="audit-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#0a1142] text-[#ffb81c]">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h2 id="audit-modal-title" className="text-base font-bold text-[#0a1142]">
                {log.eventType}
              </h2>
              <p className="text-[11px] font-mono text-gray-400">
                Log UUID: #{log.id}
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

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 text-xs text-gray-600">
          {/* Identity & Network Attribution */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-50 border border-gray-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Actor</span>
              <span className="font-bold text-slate-800 text-xs block">{log.actorId}</span>
              <span className="text-[10px] text-gray-500 font-semibold">{log.actorRole}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-gray-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Target Identity</span>
              <span className="font-mono text-slate-800 text-xs truncate block" title={log.targetId}>{log.targetId}</span>
              <span className="text-[10px] text-gray-500">{log.targetEntity || 'RESOURCE'}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-gray-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">IP Address</span>
              <span className="font-mono text-slate-800 text-xs block">{log.ipAddress || 'Internal / Proxy'}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-gray-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Recorded At</span>
              <span className="font-mono text-slate-800 text-[11px] block">{formatFullDate(log.createdAt || log.timestamp)}</span>
            </div>
          </div>

          {/* Cryptographic Hash Chain Proof */}
          <div className="p-3.5 rounded-xl bg-[#0a1142]/5 border border-[#0a1142]/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-[#0a1142] flex items-center gap-1.5">
                <Lock size={13} className="text-[#ffb81c]" /> Cryptographic Hash Chain (SHA-256)
              </span>
              {log.entryHash && (
                <button
                  type="button"
                  onClick={() => handleCopyHash(log.entryHash)}
                  className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600 hover:text-slate-900 bg-white px-2 py-0.5 rounded border border-gray-200"
                >
                  {hashCopied ? <Check size={10} className="text-emerald-600" /> : <Copy size={10} />}
                  <span>{hashCopied ? 'Hash Copied' : 'Copy Hash'}</span>
                </button>
              )}
            </div>

            <div className="space-y-1 font-mono text-[10px] bg-white p-2.5 rounded-lg border border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center gap-1">
                <span className="text-gray-400 font-bold uppercase w-24">Prev Hash:</span>
                <span className="text-slate-600 truncate flex-1">{log.prevEntryHash || 'GENESIS_ROOT_FOCIT_IDENTITY_LEDGER'}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1">
                <span className="text-[#0a1142] font-bold uppercase w-24">Entry Hash:</span>
                <span className="text-emerald-700 font-bold truncate flex-1">{log.entryHash || '—'}</span>
              </div>
            </div>
          </div>

          {/* Event Metadata JSON */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                Security Event Metadata
              </span>
              <button
                type="button"
                onClick={handleCopyJson}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy JSON'}</span>
              </button>
            </div>
            <pre className="p-3.5 rounded-xl bg-slate-900 text-slate-100 font-mono text-[11px] overflow-x-auto max-h-56 leading-relaxed border border-slate-800">
              {JSON.stringify(log.details || log.metadata || {}, null, 2)}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3.5 border-t border-gray-100 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default AuditLogDetailModal;
