import React from 'react';
import { AlertTriangle, Lock, RefreshCw, ShieldAlert } from 'lucide-react';

/**
 * Proctoring Curtain Modal
 *
 * Implements:
 * 1. Initial Fullscreen Gate (NEEDS_FULLSCREEN)
 * 2. Two-strike fullscreen exit policy:
 *    - Strike 1: Warning modal (SUSPENDED_AWAY)
 *    - Strike 2: Violation Auto-Submit notification (AUTO_SUBMITTING)
 * 3. Focus interruption notification (TRANSIENT_BLUR)
 * 4. WCAG >= 44x44px accessible touch target
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function ProctoringCurtainModal({
  lockdownState,
  infractionCount = 0,
  fullscreenExits = 0,
  onResumeExam,
}) {
  if (lockdownState === 'ACTIVE') return null;

  const isAutoSubmitting = lockdownState === 'AUTO_SUBMITTING' || fullscreenExits >= 2;
  const isNeedsFullscreen = lockdownState === 'NEEDS_FULLSCREEN';
  const isBlur = lockdownState === 'TRANSIENT_BLUR';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="proctor-lock-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 select-none"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 sm:p-8 text-slate-100 shadow-2xl space-y-5">
        {/* Header Icon & Status Pill */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {isAutoSubmitting ? (
              <div className="p-2 rounded-xl bg-red-950/80 border border-red-500/40 text-red-400">
                <ShieldAlert size={22} aria-hidden="true" />
              </div>
            ) : isNeedsFullscreen ? (
              <div className="p-2 rounded-xl bg-indigo-950/80 border border-indigo-500/40 text-indigo-400">
                <Lock size={22} aria-hidden="true" />
              </div>
            ) : (
              <div className="p-2 rounded-xl bg-amber-950/80 border border-amber-500/40 text-amber-400">
                <AlertTriangle size={22} aria-hidden="true" />
              </div>
            )}
            <h2 id="proctor-lock-title" className="text-base sm:text-lg font-bold tracking-tight">
              {isAutoSubmitting
                ? 'Assessment Terminated'
                : isNeedsFullscreen
                ? 'Fullscreen Required'
                : isBlur
                ? 'Focus Interrupted'
                : 'Fullscreen Violation'}
            </h2>
          </div>

          {/* Strike indicator badge */}
          {isAutoSubmitting ? (
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-red-900/60 text-red-300 border border-red-700">
              Strike 2 of 2
            </span>
          ) : isNeedsFullscreen ? (
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-900/60 text-indigo-300 border border-indigo-700">
              Exam Security
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-900/60 text-amber-300 border border-amber-700">
              Strike 1 of 2
            </span>
          )}
        </div>

        {/* Narrative Description */}
        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
          {isAutoSubmitting
            ? 'You have exited full-screen mode twice. Under exam regulations, your attempt has been automatically locked and submitted to the academic ledger for review.'
            : isNeedsFullscreen
            ? 'This assessment is monitored in full-screen mode to ensure academic integrity. Please enter full screen to view and begin your exam.'
            : isBlur
            ? 'An external application or system prompt stole window focus. Return to the assessment immediately to prevent an unexcused absence infraction.'
            : 'You exited full-screen mode. You are permitted to exit only ONCE. If you exit full-screen mode again, your assessment will be submitted automatically and locked immediately.'}
        </p>

        {/* Diagnostic Meta Bar */}
        {!isNeedsFullscreen && (
          <div className="rounded-xl bg-slate-800/80 border border-slate-700/80 p-3 text-xs text-slate-400 flex items-center justify-between">
            <span>Context Switches Recorded:</span>
            <strong className="text-amber-400 font-mono text-sm">{infractionCount}</strong>
          </div>
        )}

        {/* Primary Action Button */}
        {isAutoSubmitting ? (
          <div className="w-full min-h-[44px] rounded-xl bg-red-950/60 border border-red-800 p-3 flex items-center justify-center gap-2 text-red-300 text-xs font-bold">
            <RefreshCw size={15} className="animate-spin text-red-400" aria-hidden="true" />
            <span>Committing attempt to academic records...</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onResumeExam}
            className={`
              w-full min-h-[44px] rounded-xl px-4 py-3 text-xs sm:text-sm font-bold shadow-md transition-all touch-manipulation flex items-center justify-center gap-2
              ${
                isNeedsFullscreen
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
              }
            `}
          >
            {isNeedsFullscreen ? (
              <>
                <Lock size={15} aria-hidden="true" />
                <span>Lock Fullscreen &amp; Begin Assessment</span>
              </>
            ) : (
              <>
                <ShieldAlert size={15} aria-hidden="true" />
                <span>Restore Fullscreen &amp; Resume Assessment</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default ProctoringCurtainModal;
