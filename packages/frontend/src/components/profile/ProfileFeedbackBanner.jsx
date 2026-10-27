import React from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * <ProfileFeedbackBanner />
 *
 * Renders transactional mutation notifications and concurrent state conflict resolution prompts.
 */
export function ProfileFeedbackBanner({
  feedback,
  conflictState,
  onDismissFeedback,
  onResolveConflict,
}) {
  return (
    <>
      {feedback && (
        <div
          role="alert"
          className={`p-4 rounded-xl text-sm flex items-start justify-between border shadow-sm transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800'
              : feedback.type === 'info'
              ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 border-blue-200 dark:border-blue-800'
              : 'bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 border-red-200 dark:border-red-800'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' && <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />}
            {feedback.type === 'error' && <AlertTriangle size={18} className="text-red-600 dark:text-red-400 shrink-0" />}
            <span className="font-medium">{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={onDismissFeedback}
            className="text-xs font-bold underline ml-4 hover:opacity-80 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            Dismiss
          </button>
        </div>
      )}

      {conflictState && (
        <div className="p-5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 shadow-sm flex flex-col gap-3">
          <div className="flex items-center gap-2 font-bold text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle size={18} />
            <span>Concurrent State Mutation Detected</span>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
            Another browser session updated this profile to version <strong>{conflictState.version}</strong>. To protect against data overwrites, you must reload the latest authoritative record.
          </p>
          <button
            type="button"
            onClick={onResolveConflict}
            className="w-fit inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold min-h-[44px]"
          >
            <RefreshCw size={13} /> Load Server State (v{conflictState.version})
          </button>
        </div>
      )}
    </>
  );
}

export default ProfileFeedbackBanner;
