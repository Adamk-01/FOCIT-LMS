import React from 'react';
import { UserCheck, RefreshCw, Check } from 'lucide-react';

/**
 * Level Advisor Sticky Bulk Approval Action Bar
 *
 * Implements:
 * 1. Fixed floating action dock for multi-selected student registration batches
 * 2. Visual transaction state during Dijkstra-ordered bulk endorsement
 * 3. WCAG minimum 44px touch targets on interactive controls
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function BulkApprovalBar({
  selectedCount = 0,
  onCancel,
  onApprove,
  isPending = false,
  isActionLocked = false,
}) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="region"
      aria-label="Bulk actions dock"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-8 sm:w-auto z-40 bg-[#0a1142] text-white px-6 py-4 rounded-2xl shadow-2xl border border-[#ffb81c]/30 flex items-center justify-between sm:justify-start gap-6 animate-fade-in"
    >
      <div className="flex items-center gap-3">
        <UserCheck size={20} className="text-[#ffb81c]" aria-hidden="true" />
        <div>
          <span className="text-sm font-bold block">
            {selectedCount} Student{selectedCount === 1 ? '' : 's'} Selected
          </span>
          <span className="text-[11px] text-gray-300">
            Ready for Dijkstra-ordered bulk endorsement
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isActionLocked}
          onClick={onCancel}
          className="min-h-[44px] px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white transition-colors disabled:opacity-50 touch-manipulation"
        >
          Cancel
        </button>

        <button
          type="button"
          disabled={isActionLocked}
          onClick={onApprove}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#ffb81c] to-[#e5a200] text-[#0a1142] text-xs font-extrabold hover:brightness-105 transition-all shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation"
        >
          {isPending ? (
            <>
              <RefreshCw size={14} className="animate-spin text-[#0a1142]" aria-hidden="true" />
              <span>Securing Dijkstra Locks...</span>
            </>
          ) : (
            <>
              <Check size={14} aria-hidden="true" />
              <span>Approve Selected ({selectedCount})</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default BulkApprovalBar;
