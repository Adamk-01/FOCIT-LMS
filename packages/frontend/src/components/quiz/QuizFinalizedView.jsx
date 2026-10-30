import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ArrowLeft, Award, Minimize2 } from 'lucide-react';

/**
 * Quiz Finalized View (Graded Attempt Receipt)
 *
 * Implements:
 * 1. Clean receipt card displaying authoritative score and percentage
 * 2. Automatic fullscreen release on mount + manual exit fallback button
 * 3. Navigation routes back to Course Overview and Gradebook
 * 4. Minimum WCAG 44x44px touch targets on action links
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function QuizFinalizedView({
  courseId = 'CSC204',
  attempt,
  submissionReceipt,
}) {
  const finalScore = submissionReceipt?.score ?? attempt?.score ?? 0;
  const finalTotal = submissionReceipt?.totalPoints ?? attempt?.totalPoints ?? 10;
  const percent = finalTotal > 0 ? Math.round((finalScore / finalTotal) * 100) : 0;

  const [isFullscreenActive, setIsFullscreenActive] = useState(() => {
    return typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false;
  });

  useEffect(() => {
    // Automatically exit fullscreen on mount
    if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }

    const handleFsChange = () => {
      setIsFullscreenActive(typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : false);
    };

    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleManualExit = () => {
    if (typeof document !== 'undefined' && document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
      setIsFullscreenActive(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 space-y-6">
      {/* Fullscreen notification & fallback exit trigger */}
      {isFullscreenActive && (
        <div className="p-4 bg-amber-500/15 border border-amber-500/40 rounded-2xl text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between gap-3 shadow-sm">
          <span>Assessment finalized. Fullscreen proctoring lock has been released.</span>
          <button
            type="button"
            onClick={handleManualExit}
            className="px-4 py-2 min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Minimize2 size={14} aria-hidden="true" />
            <span>Exit Fullscreen</span>
          </button>
        </div>
      )}

      <header className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-gray-200 dark:border-slate-800 shadow-card text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
          <CheckCircle2 size={36} aria-hidden="true" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0a1142] dark:text-slate-100 font-display">
          Assessment Attempt Submitted
        </h1>
        <p className="text-sm text-gray-600 dark:text-slate-400 max-w-md mx-auto">
          Your answers have been evaluated and permanently recorded into your official academic Gradebook ledger.
        </p>

        <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto py-6 border-y border-gray-100 dark:border-slate-800">
          <div>
            <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">Final Score</p>
            <p className="text-xl font-extrabold text-[#0a1142] dark:text-[#ffb81c] mt-1">
              {finalScore} / {finalTotal}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">Percentage</p>
            <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400 mt-1">
              {percent}%
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">Gradebook Status</p>
            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              SAVED &amp; GRADED
            </span>
          </div>
        </div>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to={`/courses/${encodeURIComponent(courseId)}?tab=grades`}
            className="w-full sm:w-auto px-6 py-3 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2 touch-manipulation"
          >
            <Award size={16} aria-hidden="true" />
            <span>Review Course Materials</span>
          </Link>
          <Link
            to={`/courses/${encodeURIComponent(courseId)}?tab=quizzes`}
            className="w-full sm:w-auto px-6 py-3 min-h-[44px] rounded-xl border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 text-sm font-bold transition-all flex items-center justify-center gap-2 touch-manipulation"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Return to Quizzes</span>
          </Link>
        </div>
      </header>
    </div>
  );
}

export default QuizFinalizedView;
