import React, { useEffect, useRef } from 'react';
import { Send, RefreshCw, X } from 'lucide-react';
import { ErrorAlertCallout } from '../ErrorAlertCallout';

/**
 * New Discussion Topic Top Layer Dialog
 *
 * Implements:
 * 1. Native HTML <dialog> element per WHATWG HTML Living Standard Section 4.11.4
 * 2. Mutation Lock: onCancel intercepted during active post submission
 * 3. Integrated RFC 7807 <ErrorAlertCallout /> for institutional error handling
 * 4. WCAG minimum 44px touch targets on interactive buttons
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function NewTopicDialog({
  isOpen = false,
  onClose,
  onSubmit,
  title = '',
  onChangeTitle,
  body = '',
  onChangeBody,
  isPosting = false,
  error = null,
  courseCode = 'CSC 204',
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [isOpen]);

  const handleCancel = (e) => {
    if (isPosting) {
      e.preventDefault();
    } else {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-labelledby="forum-modal-title"
      className="m-auto rounded-2xl p-0 bg-transparent backdrop:bg-black/60 backdrop:backdrop-blur-sm max-w-lg w-full shadow-2xl border-0 overflow-hidden"
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 space-y-6 border border-gray-200 dark:border-slate-800 text-slate-900 dark:text-slate-100">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 id="forum-modal-title" className="text-xl font-bold text-[#0a1142] dark:text-[#ffb81c] font-display">
              New Discussion Topic
            </h3>
            <p className="text-xs text-gray-600 dark:text-slate-400">
              Post an academic question or discussion prompt to the {courseCode} community.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPosting}
            aria-label="Close dialog"
            className="min-w-[44px] min-h-[44px] p-2 text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors flex items-center justify-center touch-manipulation"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="topic-title"
              className="block text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
            >
              Subject / Topic Title *
            </label>
            <input
              id="topic-title"
              type="text"
              required
              disabled={isPosting}
              placeholder="e.g. Asymptotic Bounds on Hash Table Probing"
              value={title}
              onChange={(e) => onChangeTitle(e.target.value)}
              className="w-full min-h-[44px] px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition-all font-medium disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="topic-body"
              className="block text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider mb-1.5"
            >
              Message Body *
            </label>
            <textarea
              id="topic-body"
              required
              rows={4}
              disabled={isPosting}
              placeholder="Elaborate on your question or discussion context..."
              value={body}
              onChange={(e) => onChangeBody(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-indigo-500 focus:bg-white dark:focus:bg-slate-800 transition-all font-medium resize-none disabled:opacity-50"
            />
          </div>

          {error && (
            <ErrorAlertCallout
              error={error}
              onRetry={onSubmit}
              className="text-xs"
            />
          )}

          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isPosting}
              className="min-h-[44px] px-4 py-2.5 rounded-xl border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-xs font-bold hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors touch-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPosting || !title.trim() || !body.trim()}
              className={`
                min-h-[44px] px-6 py-2.5 rounded-xl bg-[#0a1142] dark:bg-indigo-600 hover:bg-[#16258f] dark:hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-all flex items-center gap-2 touch-manipulation
                ${isPosting ? 'opacity-70 cursor-not-allowed pointer-events-none' : ''}
              `}
            >
              {isPosting ? (
                <>
                  <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
                  <span>Posting Topic...</span>
                </>
              ) : (
                <>
                  <Send size={14} className="text-[#ffb81c]" aria-hidden="true" />
                  <span>Post to Forum</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

export default NewTopicDialog;
