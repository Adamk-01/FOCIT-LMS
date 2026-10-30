import React from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, X } from 'lucide-react';

/**
 * Account Suspension Confirmation Modal
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function SuspendConfirmationModal({
  isOpen,
  user,
  onClose,
  onConfirm,
  isSubmitting = false,
}) {
  if (!isOpen || !user) return null;

  const displayName = user.fullName || user.name || 'User';
  const displayId = user.identifier || user.matricNumber || user.id || '—';

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="suspend-dialog-title"
        className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-150 my-auto"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          aria-label="Close dialog"
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <ShieldAlert size={20} />
          </div>
          <div>
            <h3 id="suspend-dialog-title" className="text-sm font-bold text-slate-900 font-display">
              Confirm Account Suspension
            </h3>
            <p className="text-[11px] text-gray-500">Immediate session termination & access revocation</p>
          </div>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed mb-5">
          Are you sure you want to suspend <strong className="text-slate-900">{displayName}</strong> (<span className="font-mono text-[11px]">{displayId}</span>)?
          All active login sessions for this account will be invalidated immediately.
        </p>

        <div className="flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl transition-all shadow-xs disabled:opacity-50 min-h-[38px]"
          >
            {isSubmitting ? 'Suspending...' : 'Confirm Suspension'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
export default SuspendConfirmationModal;
