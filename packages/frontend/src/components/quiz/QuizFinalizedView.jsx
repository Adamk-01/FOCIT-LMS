import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ArrowLeft, Award } from 'lucide-react';

/**
 * Quiz Finalized View (Graded Attempt Receipt)
 *
 * Implements:
 * 1. Clean receipt card displaying authoritative score and percentage
 * 2. Navigation routes back to Course Overview and Gradebook
 * 3. Minimum WCAG 44x44px touch targets on action links
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

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 space-y-8">
      <header className="bg-white rounded-2xl p-8 border border-gray-200 shadow-card text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
          <CheckCircle2 size={36} aria-hidden="true" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0a1142] font-display">
          Practice Drill Completed
        </h1>
        <p className="text-sm text-gray-600 max-w-md mx-auto">
          Your practice responses have been recorded. Review your total score and mastery percentage below, and revisit your course materials for further revision.
        </p>

        <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto py-6 border-y border-gray-100">
          <div>
            <p className="text-xs text-gray-500 font-medium">Practice Score</p>
            <p className="text-xl font-extrabold text-[#0a1142] mt-1">
              {finalScore} / {finalTotal}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Topic Mastery</p>
            <p className="text-xl font-extrabold text-emerald-600 mt-1">
              {percent}%
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-medium">Status</p>
            <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
              COMPLETED
            </span>
          </div>
        </div>

        <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to={`/courses/${courseId}`}
            className="w-full sm:w-auto px-6 py-3 min-h-[44px] rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2 touch-manipulation"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Return to Course Overview</span>
          </Link>
          <Link
            to={`/courses/${courseId}?tab=materials`}
            className="w-full sm:w-auto px-6 py-3 min-h-[44px] rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-bold transition-all flex items-center justify-center gap-2 touch-manipulation"
          >
            <Award size={16} aria-hidden="true" />
            <span>Review Course Materials</span>
          </Link>
        </div>
      </header>
    </div>
  );
}

export default QuizFinalizedView;
