import React, { useState, useRef, useEffect } from 'react';
import { ChevronLeft, Lock, RefreshCw, Info } from 'lucide-react';
import { ErrorAlertCallout } from '../ErrorAlertCallout.jsx';

/**
 * <RegistrationDeclarationModal />
 *
 * Final Senate Registration Confirmation & Atomic Commit View
 * Implements:
 * 1. Synchronous double-mutation lock (useRef mutex)
 * 2. Mandatory Senate Declaration Checkbox
 * 3. Inlined Zero-Trust <ErrorAlertCallout /> for RFC 7807 problem details
 * 4. Semantic <dialog> element with native cancel (Escape key) interception during submission
 * 5. WCAG 44x44px touch targets on all interactive controls
 */
export function RegistrationDeclarationModal({
  selectedCourses = [],
  totalUnits = 0,
  onSubmit,
  isSubmitting = false,
  submitError = null,
  onBack,
  isUnderMinimum = false,
  isOverMaximum = false,
}) {
  const [hasDeclared, setHasDeclared] = useState(false);
  const dialogRef = useRef(null);
  const isSubmittingRef = useRef(false);

  // WHATWG HTML Section 4.11.4: Imperatively activate modal Top Layer with native inert backdrop & focus trap
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        // Fallback for non-supporting test environments
      }
    }
  }, []);

  // Intercept WHATWG native cancel (Escape key) event during active atomic submission
  const handleCancel = (e) => {
    if (isSubmittingRef.current || isSubmitting) {
      e.preventDefault();
      return;
    }
    // Route native Escape cancellation to parent step navigation
    e.preventDefault();
    if (onBack) onBack();
  };

  const handleBack = () => {
    if (isSubmittingRef.current || isSubmitting) return;
    try {
      dialogRef.current?.close();
    } catch {
      // Defensive
    }
    if (onBack) onBack();
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // 1. Synchronous Atomic Mutation Lock
    if (isSubmittingRef.current || isSubmitting) return;
    if (!hasDeclared) return;

    isSubmittingRef.current = true;
    try {
      onSubmit();
    } finally {
      // Released upon mutation completion or error via parent
      setTimeout(() => {
        isSubmittingRef.current = false;
      }, 500);
    }
  };

  const isBlocked = isUnderMinimum || isOverMaximum || !hasDeclared || isSubmitting;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-modal="true"
      aria-labelledby="declaration-title"
      aria-describedby="declaration-desc"
      className="fixed inset-0 m-auto w-[min(94vw,640px)] max-h-[min(90dvh,680px)] flex flex-col p-0 overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-gray-200/80 dark:border-slate-800 text-slate-900 dark:text-slate-100 backdrop:bg-black/60 backdrop:backdrop-blur-sm animate-fade-in"
      style={{ contain: 'layout paint' }}
    >
      <form onSubmit={handleSubmit} className="flex flex-col h-full max-h-[min(90dvh,680px)]">
        {/* 1. Fixed Header (flex: 0 0 auto) */}
        <div className="flex-none px-5 py-4 sm:px-6 border-b border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <h2 id="declaration-title" className="text-base sm:text-lg font-black text-[#0a1142] dark:text-[#ffb81c] font-display tracking-tight">
            Final Senate Registration Commitment
          </h2>
          <p id="declaration-desc" className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 font-sans">
            Committing your registration reserves seat capacity and routes your course matrix for Level Advisor endorsement.
          </p>
        </div>

        {/* 2. Quarantined Scrollable Body (flex: 1 1 auto; min-height: 0) */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-4 font-sans text-gray-800 dark:text-slate-200">
          {/* Inlined Zero-Trust RFC 7807 Error Alert Callout */}
          {submitError && (
            <ErrorAlertCallout
              error={submitError}
              className="mb-2"
            />
          )}

          {/* Academic Honor Declaration Notice */}
          <div className="p-4 sm:p-5 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800 text-amber-950 dark:text-amber-200 text-xs space-y-2">
            <p className="font-bold flex items-center gap-2 text-amber-950 dark:text-amber-200 text-sm font-display">
              <Info size={16} className="text-amber-700 dark:text-amber-400 shrink-0" />
              <span>Senate Academic Regulation & Honor Code</span>
            </p>
            <p className="leading-relaxed text-amber-900 dark:text-amber-300">
              I formally declare that I am registering for{' '}
              <strong>{totalUnits} credit units</strong> across{' '}
              <strong>{selectedCourses.length} accredited courses</strong> for this session.
              I understand that course capacity allocations will be locked upon submission, and subsequent changes require formal Level Advisor approval or batch rejection.
            </p>
          </div>

          {/* Course Summary Pill List */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-gray-200/80 dark:border-slate-700/80 rounded-xl space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-slate-400">
              Selected Curriculum Modules ({selectedCourses.length})
            </span>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-1">
              {selectedCourses.map((c) => (
                <span
                  key={c.course_id || c.code}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-[#0a1142] dark:text-[#ffb81c]"
                >
                  <span>{c.code}</span>
                  <span className="text-[10px] text-gray-500 dark:text-slate-400 font-normal">({c.units}u)</span>
                </span>
              ))}
            </div>
          </div>

          {/* Mandatory Checkbox Declaration */}
          <label
            htmlFor="senateDeclaration"
            className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
          >
            <div className="flex items-center min-h-[44px]">
              <input
                id="senateDeclaration"
                type="checkbox"
                checked={hasDeclared}
                onChange={(e) => setHasDeclared(e.target.checked)}
                disabled={isSubmitting}
                className="w-5 h-5 rounded text-[#0a1142] focus:ring-[#0a1142] border-gray-300 dark:border-slate-600 cursor-pointer disabled:cursor-not-allowed"
              />
            </div>
            <span className="text-xs sm:text-sm text-gray-700 dark:text-slate-300 font-sans leading-relaxed pt-2.5">
              I confirm that I have reviewed my curriculum selections and agree to adhere to University Senate regulations governing academic workload.
            </span>
          </label>
        </div>

        {/* 3. Docked Elevated Action Bar (flex: 0 0 auto; sticky bottom-0) */}
        <div className="flex-none p-4 sm:p-5 border-t border-gray-100 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-md sticky bottom-0 z-10 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.03)] pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          <button
            type="button"
            onClick={handleBack}
            disabled={isSubmitting}
            className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            <ChevronLeft size={16} />
            <span>Back to Review</span>
          </button>

          <button
            type="submit"
            disabled={isBlocked}
            className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#0a1142] to-[#16258f] hover:from-[#070c2e] hover:to-[#0a1142] text-[#ffb81c] font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0a1142]"
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={16} className="animate-spin text-[#ffb81c]" aria-hidden="true" />
                <span>Securing Dijkstra Locks...</span>
              </>
            ) : (
              <>
                <Lock size={16} aria-hidden="true" />
                <span>Submit for Level Advisor Clearance</span>
              </>
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export default RegistrationDeclarationModal;
