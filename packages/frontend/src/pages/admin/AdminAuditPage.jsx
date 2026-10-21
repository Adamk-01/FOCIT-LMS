import React from 'react';
import { ShieldCheck, FileText } from 'lucide-react';
import { useAdminDashboard } from '../../hooks/useAdminDashboard';

/**
 * Senate Security & Cryptographic Identity Audit Ledger Page
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function AdminAuditPage() {
  const { auditLogs, isAuditLoading } = useAdminDashboard();
  const logs = auditLogs?.logs || [];

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 mb-1">
            <ShieldCheck size={12} />
            <span>WORM Tamper-Evident Ledger</span>
          </div>
          <h1 className="text-2xl font-black text-[#0a1142] font-display">Security & Audit Ledger</h1>
          <p className="text-xs text-gray-500 mt-1">Cryptographically hash-chained identity events, role promotions, and governance logs</p>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          {isAuditLoading ? (
            <div className="py-16 text-center text-xs text-gray-400">Loading immutable audit logs...</div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-xs">
              <FileText size={32} className="mx-auto text-gray-300 mb-2" />
              No security audit log entries recorded yet.
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-slate-50/50">
                  <th className="py-3 px-4">Event Type</th>
                  <th className="py-3 px-4">Actor</th>
                  <th className="py-3 px-4">Target Identity</th>
                  <th className="py-3 px-4">IP Address</th>
                  <th className="py-3 px-4 text-right">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4">
                      <span className="font-mono font-bold text-[11px] text-[#0a1142] bg-slate-100 px-2 py-0.5 rounded-md">
                        {log.eventType}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-gray-700">
                      {log.actorId} <span className="text-gray-400 text-[10px]">({log.actorRole})</span>
                    </td>
                    <td className="py-3.5 px-4 text-gray-600 font-mono text-[11px]">{log.targetId}</td>
                    <td className="py-3.5 px-4 text-gray-500 font-mono text-[11px]">{log.ipAddress || '—'}</td>
                    <td className="py-3.5 px-4 text-right text-gray-400 text-[11px] whitespace-nowrap">
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
      </div>
    </div>
  );
}
export default AdminAuditPage;
