import React from 'react';
import { CheckCircle2, RefreshCw, Eye } from 'lucide-react';

/**
 * Cohort Ledger Table
 *
 * Implements:
 * 1. Multi-select table with select-all for actionable (SUBMITTED) batches
 * 2. Status badges with high-contrast institutional color palette
 * 3. Inspection and per-row endorsement / rejection actions
 * 4. WCAG minimum 44px touch targets on all interactive table controls
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function CohortLedgerTable({
  cohort = [],
  selectedBatchIds = [],
  onToggleBatch,
  onSelectAll,
  onInspect,
  onEndorse,
  onReject,
  isLoading = false,
  isActionLocked = false,
  selectedLevel = '200',
  selectedStatus = 'SUBMITTED',
}) {
  const actionableBatches = cohort.filter((b) => b.status === 'SUBMITTED');
  const allActionableSelected =
    actionableBatches.length > 0 && selectedBatchIds.length === actionableBatches.length;

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm p-12 text-center flex flex-col items-center justify-center gap-3">
        <RefreshCw size={32} className="animate-spin text-[#0a1142] dark:text-[#ffb81c]" aria-hidden="true" />
        <span className="text-xs font-semibold text-gray-500 dark:text-slate-400">
          Querying Level Advisor cohort records...
        </span>
      </div>
    );
  }

  if (cohort.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm p-12 text-center flex flex-col items-center justify-center gap-2">
        <CheckCircle2 size={36} className="text-gray-300 dark:text-slate-600" aria-hidden="true" />
        <h3 className="text-sm font-bold text-gray-700 dark:text-slate-200">No Registrations in Cohort</h3>
        <p className="text-xs text-gray-500 dark:text-slate-400 max-w-sm">
          There are no student registration batches matching Level {selectedLevel} with status {selectedStatus}.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-sm">
          <thead className="bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 text-xs uppercase tracking-wider font-bold border-b border-gray-200 dark:border-slate-700">
            <tr>
              <th className="py-3 px-4 w-12 text-center">
                <label className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allActionableSelected}
                    disabled={actionableBatches.length === 0 || isActionLocked}
                    onChange={onSelectAll}
                    aria-label="Select all pending batches"
                    className="w-4 h-4 rounded text-[#0a1142] dark:text-indigo-600 focus:ring-[#0a1142] dark:focus:ring-indigo-500 border-gray-300 dark:border-slate-600 dark:bg-slate-800 cursor-pointer"
                  />
                </label>
              </th>
              <th className="py-3 px-4">Student</th>
              <th className="py-3 px-4">Matric No</th>
              <th className="py-3 px-4">Programme</th>
              <th className="py-3 px-4">CGPA</th>
              <th className="py-3 px-4">Units</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {cohort.map((row) => {
              const isSelected = selectedBatchIds.includes(row.batch_id);
              const isActionable = row.status === 'SUBMITTED';

              return (
                <tr
                  key={row.batch_id}
                  className={`transition-colors ${
                    isSelected ? 'bg-[#0a1142]/5 dark:bg-indigo-950/20' : 'hover:bg-gray-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <td className="py-3 px-4 text-center">
                    <label className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={!isActionable || isActionLocked}
                        onChange={() => onToggleBatch(row.batch_id)}
                        aria-label={`Select ${row.student_name}`}
                        className="w-4 h-4 rounded text-[#0a1142] dark:text-indigo-600 focus:ring-[#0a1142] dark:focus:ring-indigo-500 border-gray-300 dark:border-slate-600 dark:bg-slate-800 cursor-pointer disabled:opacity-40"
                      />
                    </label>
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-bold text-[#0a1142] dark:text-slate-100 block">
                      {row.student_name}
                    </span>
                    <span className="text-[11px] text-gray-500 dark:text-slate-400">{row.student_id}</span>
                  </td>
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-gray-800 dark:text-slate-300">
                    {row.matric_number}
                  </td>
                  <td className="py-3 px-4 text-xs text-gray-700 dark:text-slate-300">
                    {row.programme_name}
                  </td>
                  <td className="py-3 px-4 font-bold text-xs text-gray-800 dark:text-slate-200">
                    {row.current_gpa || '—'}
                  </td>
                  <td className="py-3 px-4">
                    <span className="font-extrabold text-[#0a1142] dark:text-[#ffb81c] text-xs">
                      {row.total_units} Units
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                        row.status === 'ADVISOR_APPROVED'
                          ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                          : row.status === 'SUBMITTED'
                          ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                          : row.status === 'REJECTED'
                          ? 'bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300'
                          : 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-300'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => onInspect(row)}
                        className="min-w-[44px] min-h-[44px] p-2 rounded-xl text-gray-500 dark:text-slate-400 hover:text-[#0a1142] dark:hover:text-[#ffb81c] hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors touch-manipulation flex items-center justify-center"
                        title="Inspect Registered Modules"
                        aria-label={`Inspect ${row.student_name}'s modules`}
                      >
                        <Eye size={18} aria-hidden="true" />
                      </button>

                      {isActionable && (
                        <>
                          <button
                            type="button"
                            disabled={isActionLocked}
                            onClick={() => onEndorse(row.batch_id)}
                            className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm disabled:opacity-50 touch-manipulation"
                          >
                            Endorse
                          </button>
                          <button
                            type="button"
                            disabled={isActionLocked}
                            onClick={() => onReject(row)}
                            className="min-h-[44px] px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors shadow-sm disabled:opacity-50 touch-manipulation"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default CohortLedgerTable;
