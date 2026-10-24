import React, { useEffect, useRef } from 'react';
import { RefreshCw, ShieldCheck, X } from 'lucide-react';
import { ErrorAlertCallout } from '../ErrorAlertCallout';

/**
 * Quiz Submission Confirmation Modal (Top Layer Dialog)
 *
 * Implements:
 * 1. Native HTML <dialog> element per WHATWG HTML Living Standard Section 4.11.4
 * 2. Imperative dialogRef.current?.showModal() and close() lifecycle
 * 3. Mutation Lock: onCancel intercepted during in-flight commit (prohibits Escape-key dismissal)
 * 4. Integrated RFC 7807 <ErrorAlertCallout /> with actionable recovery
 * 5. Minimum WCAG 44x44px touch targets on all interactive controls
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function QuizSubmissionModal({
  isOpen = false,
  onClose,
  onSubmit,
  isSubmitting = false,
  error = null,
  answeredCount = 0,
  totalQuestions = 0,
}) {
  const dialogRef = useRef(null);

  // Synchronize modal state with native Top Layer <dialog>
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen]);

  // Intercept native Escape-key cancellation during active submission mutation lock
  const handleCancel = (e) => {
    if (isSubmitting) {
      e.preventDefault();
    } else {
      onClose();
    }
  };

  const unansweredCount = Math.max(0, totalQuestions - answeredCount);

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-labelledby="quiz-submit-modal-title"
      aria-describedby="quiz-submit-modal-description"
      className="m-auto rounded-2xl p-0 bg-transparent backdrop:bg-black/60 backdrop:backdrop-blur-sm max-w-md w-full shadow-2xl border-0 overflow-hidden"
    >
      <div className="bg-white p-6 sm:p-8 space-y-6 border border-gray-200 rounded-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2
              id="quiz-submit-modal-title"
              className="text-xl font-bold text-[#0a1142] font-display"
            >
              Complete Practice Session
            </h2>
            <p
              id="quiz-submit-modal-description"
              className="text-xs text-gray-600 leading-relaxed"
            >
              Ready to wrap up? Submitting your answers will generate your topic mastery score and let you review detailed explanations.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close modal"
            className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 disabled:opacity-40 transition-colors"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Checklist */}
        <div className="p-4 bg-gray-50 rounded-xl space-y-2 text-xs">
          <div className="flex items-center justify-between font-semibold text-gray-700">
            <span>Questions Answered:</span>
            <span className="text-[#0a1142] font-bold">
              {answeredCount} of {totalQuestions}
            </span>
          </div>
          {unansweredCount > 0 && (
            <p className="text-amber-700 text-[11px] font-medium pt-1">
              ⚠️ You have {unansweredCount} unanswered {unansweredCount === 1 ? 'question' : 'questions'} remaining.
            </p>
          )}
        </div>

        {/* RFC 7807 Error Alert Callout */}
        {error && (
          <ErrorAlertCallout
            error={error}
            onRetry={onSubmit}
            className="text-xs"
          />
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="px-4 py-2.5 min-h-[44px] rounded-xl border border-gray-300 text-gray-700 text-xs font-bold hover:bg-gray-50 disabled:opacity-50 touch-manipulation transition-colors"
          >
            Return to Questions
          </button>

          <button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting}
            className={`
              px-6 py-2.5 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition-all flex items-center gap-2 touch-manipulation
              ${isSubmitting ? 'opacity-70 cursor-not-allowed pointer-events-none' : ''}
            `}
          >
            {isSubmitting ? (
              <>
                <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
                <span>Evaluating Responses...</span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} aria-hidden="true" />
                <span>Complete Practice Drill</span>
              </>
            )}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export default QuizSubmissionModal;
