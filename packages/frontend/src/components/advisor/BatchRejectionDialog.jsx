import React, { useEffect, useRef } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';
import { ErrorAlertCallout } from '../ErrorAlertCallout';

/**
 * Batch Rejection Dialog with Senate Audit Remarks
 *
 * Implements:
 * 1. Native HTML <dialog> element per WHATWG HTML Living Standard Section 4.11.4
 * 2. Mandatory Senate Audit Remarks validation (minimum 5 non-whitespace characters)
 * 3. Mutation Lock: onCancel intercepted during in-flight transaction commit
 * 4. Integrated RFC 7807 <ErrorAlertCallout /> with deterministic recovery
 * 5. Minimum WCAG 44x44px touch targets on all interactive controls
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function BatchRejectionDialog({
  target,
  remarks = '',
  onChangeRemarks,
  onConfirm,
  onClose,
  isPending = false,
  error = null,
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (target) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [target]);

  const handleCancel = (e) => {
    if (isPending) {
      e.preventDefault();
    } else {
      onClose();
    }
  };

  if (!target) return null;

  const trimmedLength = remarks.trim().length;
  const isValidRemarks = trimmedLength >= 5;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-labelledby="rejection-dialog-title"
      className="m-auto rounded-2xl p-0 bg-transparent backdrop:bg-black/60 backdrop:backdrop-blur-sm max-w-lg w-full shadow-2xl border-0 overflow-hidden"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl flex flex-col border border-gray-200 dark:border-slate-800 text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="p-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-red-50/50 dark:bg-red-950/20">
          <div className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-red-600 dark:text-red-400" aria-hidden="true" />
            <h3 id="rejection-dialog-title" className="text-base font-bold text-red-950 dark:text-red-200">
              Return Registration to Student
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Close dialog"
            className="min-w-[44px] min-h-[44px] p-2 rounded-xl text-gray-400 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-red-100/50 dark:hover:bg-slate-800 flex items-center justify-center transition-colors disabled:opacity-40 touch-manipulation"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-600 dark:text-slate-300 leading-relaxed">
            Rejecting this batch releases reserved seat capacity and returns the registration to{' '}
            <strong className="text-slate-900 dark:text-slate-100">{target.student_name}</strong> for modification. Mandatory descriptive remarks are written to the immutable Senate audit ledger.
          </p>

          {error && (
            <ErrorAlertCallout
              error={typeof error === 'string' ? { message: error } : error}
              onRetry={onConfirm}
              className="text-xs"
            />
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label
                htmlFor="rejection-remarks"
                className="block text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider"
              >
                Senate Audit Remarks *
              </label>
              <span
                className={`text-[11px] font-semibold ${
                  isValidRemarks ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-slate-500'
                }`}
              >
                {trimmedLength} / 5 chars minimum
              </span>
            </div>
            <textarea
              id="rejection-remarks"
              rows={3}
              value={remarks}
              disabled={isPending}
              onChange={(e) => onChangeRemarks(e.target.value)}
              placeholder="e.g. Please add core GST 204 Entrepreneurship before approval."
              className="w-full text-xs p-3 border border-gray-300 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-indigo-500 focus:border-transparent outline-none resize-none transition-all disabled:opacity-50"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 bg-gray-50 dark:bg-slate-800/60 border-t border-gray-100 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors touch-manipulation"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isPending || !isValidRemarks}
            onClick={onConfirm}
            className="min-h-[44px] px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-md touch-manipulation"
          >
            {isPending ? (
              <>
                <RefreshCw size={14} className="animate-spin text-white" aria-hidden="true" />
                <span>Reverting Capacity...</span>
              </>
            ) : (
              <span>Confirm Rejection</span>
            )}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default BatchRejectionDialog;
