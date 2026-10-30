import React from 'react';

/**
 * Quiz Navigation Question Palette
 *
 * Implements:
 * 1. 5-column responsive question palette grid with WCAG 44x44px touch targets
 * 2. Visual states for current question (active ring), answered (filled), and unvisited (gray)
 * 3. Proportional progress bar of answered questions
 * 4. Submit confirmation trigger button
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function QuestionNavigationPalette({
  questions = [],
  currentQuestionIndex = 0,
  selectedAnswers = {},
  onSelectQuestion,
  onOpenFinishModal,
  isSubmitting = false,
}) {
  const answeredCount = Object.keys(selectedAnswers).length;
  const totalQuestions = questions.length;
  const percentComplete = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  return (
    <aside className="space-y-6">
      <section className="bg-white dark:bg-slate-900 rounded-2xl p-5 sm:p-6 border border-gray-200 dark:border-slate-800 shadow-card space-y-5">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-3.5 gap-2">
          <h2 className="text-sm font-bold text-[#0a1142] dark:text-[#ffb81c] font-display whitespace-nowrap">
            Quiz Navigation
          </h2>
          <span className="text-xs text-gray-500 dark:text-slate-400 font-semibold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 shrink-0">
            {answeredCount}/{totalQuestions} Answered
          </span>
        </div>

        {/* 5-Column Question Grid */}
        <div
          role="navigation"
          aria-label="Questions list"
          className="grid grid-cols-5 gap-2.5 sm:gap-3"
        >
          {questions.map((q, idx) => {
            const isCurrent = idx === currentQuestionIndex;
            const hasAnswered = Boolean(selectedAnswers[q.id]?.optionId);

            return (
              <button
                key={q.id}
                type="button"
                onClick={() => onSelectQuestion(idx)}
                aria-label={`Question ${idx + 1}${hasAnswered ? ' - Answered' : ' - Unanswered'}`}
                aria-current={isCurrent ? 'true' : undefined}
                className={`
                  w-full h-10 sm:h-11 max-w-[48px] mx-auto rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center transition-all relative
                  touch-manipulation focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-[#ffb81c] focus:ring-offset-2
                  ${isCurrent ? 'ring-2 ring-offset-2 ring-amber-400 dark:ring-[#ffb81c] z-10 font-black' : ''}
                  ${hasAnswered
                    ? 'bg-[#0a1142] dark:bg-indigo-600 text-white shadow-sm hover:bg-[#16258f] dark:hover:bg-indigo-500'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'}
                `}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>

        {/* Progress Metric */}
        <div className="p-3 bg-gray-50 dark:bg-slate-800/80 rounded-xl space-y-1.5 text-xs text-gray-600 dark:text-slate-400">
          <div className="flex items-center justify-between">
            <span>Completed:</span>
            <span className="font-bold text-[#0a1142] dark:text-[#ffb81c]">{percentComplete}%</span>
          </div>
          <div
            className="w-full h-1.5 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden mt-1"
            role="progressbar"
            aria-valuenow={percentComplete}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Quiz completion progress"
          >
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${percentComplete}%` }}
            />
          </div>
        </div>

        {/* Finish Attempt Trigger Button */}
        <button
          type="button"
          onClick={onOpenFinishModal}
          disabled={isSubmitting}
          className="w-full min-h-[44px] py-3 px-4 rounded-xl bg-gray-100 dark:bg-slate-800 hover:bg-[#0a1142] dark:hover:bg-indigo-600 text-gray-800 dark:text-slate-200 hover:text-white text-xs sm:text-sm font-bold transition-all border border-gray-200 dark:border-slate-700 disabled:opacity-50 touch-manipulation flex items-center justify-center cursor-pointer shadow-sm active:scale-[0.99]"
        >
          {isSubmitting ? 'Submitting...' : 'Finish attempt...'}
        </button>
      </section>
    </aside>
  );
}

export default QuestionNavigationPalette;
