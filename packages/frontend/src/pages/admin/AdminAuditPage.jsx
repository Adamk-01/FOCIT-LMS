import React, { useState } from 'react';
import { ShieldCheck, FileText, Eye, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAdminDashboard } from '../../hooks/useAdminDashboard';
import { AuditLogDetailModal } from '../../components/admin/AuditLogDetailModal';

const formatTimestamp = (val) => {
  if (!val) return { dateStr: '—', timeStr: '' };
  const d = new Date(val);
  if (isNaN(d.getTime())) return { dateStr: '—', timeStr: '' };
  return {
    dateStr: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    timeStr: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
};

const FILTER_OPTIONS = [
  { id: 'ALL', label: 'All Events' },
  { id: 'ADMIN_USER_PROVISIONED', label: 'Provisioning' },
  { id: 'USER_ROLE_ELEVATED', label: 'Role Changes' },
  { id: 'ADMIN_OUTBOX_RETRY_TRIGGERED', label: 'Outbox Retries' },
];

export function AdminAuditPage() {
  const {
    auditLogs, isAuditLoading, auditEventType, setAuditEventType, auditPage, setAuditPage,
  } = useAdminDashboard();

  const [selectedLog, setSelectedLog] = useState(null);

  const logs = auditLogs?.logs || [];
  const pagination = auditLogs?.pagination || { page: 1, total: logs.length, totalPages: 1 };

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 mb-1">
            <ShieldCheck size={12} />
            <span>WORM Tamper-Evident Ledger (PostgreSQL Trigger 55000)</span>
          </div>
          <h1 className="text-2xl font-black text-[#0a1142] font-display">Security & Cryptographic Audit Ledger</h1>
          <p className="text-xs text-gray-500 mt-1">
            Cryptographically hash-chained identity events, role promotions, and Senate governance logs
          </p>
        </div>

        {/* Filter Pills */}
        <div className="inline-flex items-center gap-1 p-1 bg-gray-100 rounded-xl overflow-x-auto">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { setAuditEventType(f.id); setAuditPage(1); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                auditEventType === f.id ? 'bg-white text-[#0a1142] shadow-xs' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          {isAuditLoading ? (
            <div className="py-16 text-center text-xs text-gray-400">Loading immutable audit ledger...</div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-xs">
              <FileText size={32} className="mx-auto text-gray-300 mb-2" />
              No security audit log entries matching the selected filter.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-slate-50/50">
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Target Identity</th>
                  <th className="py-3 px-4">Cryptographic Hash</th>
                  <th className="py-3 px-4">IP Address</th>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => {
                  const { dateStr, timeStr } = formatTimestamp(log.createdAt || log.timestamp);
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4">
                        <span className="font-mono font-bold text-[11px] text-[#0a1142] bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/70">
                          {log.eventType}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-medium text-gray-700">
                        <div className="font-semibold text-slate-800">{log.actorId}</div>
                        <div className="text-gray-400 text-[10px] uppercase font-bold">{log.actorRole}</div>
                      </td>
                      <td className="py-3.5 px-4 text-gray-700 font-mono text-[11px] truncate max-w-xs">{log.targetId}</td>
                      <td className="py-3.5 px-4 font-mono text-[10px] text-emerald-800">
                        <span className="bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200" title={log.entryHash || 'Unhashed entry'}>
                          {log.entryHash ? `${log.entryHash.slice(0, 8)}...` : (log.isGenesis ? 'GENESIS' : 'UNHASHED')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-gray-500 font-mono text-[11px]">{log.ipAddress || 'Internal'}</td>
                      <td className="py-3.5 px-4 text-gray-500 text-[11px] whitespace-nowrap">
                        <div className="font-semibold text-slate-700">{dateStr}</div>
                        <div className="text-[10px] text-gray-400 font-mono">{timeStr}</div>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedLog(log)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-[#0a1142] hover:text-white transition-colors border border-slate-200"
                        >
                          <Eye size={12} />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Footer */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 bg-slate-50/50 text-xs text-gray-500">
            <span>
              Page <strong className="text-slate-800">{pagination.page}</strong> of <strong className="text-slate-800">{pagination.totalPages}</strong> ({pagination.total} entries)
            </span>
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                disabled={pagination.page <= 1}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <button
                type="button"
                onClick={() => setAuditPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={pagination.page >= pagination.totalPages}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Inspector Modal */}
      <AuditLogDetailModal
        log={selectedLog}
        isOpen={Boolean(selectedLog)}
        onClose={() => setSelectedLog(null)}
      />
    </div>
  );
}

export default AdminAuditPage;
