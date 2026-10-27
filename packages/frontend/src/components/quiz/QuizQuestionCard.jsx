import React from 'react';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react';

/**
 * Single Question Card with Interactive Radiogroup Options
 *
 * Implements:
 * 1. Semantic <article> container with header metadata
 * 2. WCAG-compliant radiogroup with min-h-[56px] touch targets
 * 3. Next/Previous and Finish navigation controls with 44x44px minimum sizing
 * 4. Distinct visual selection state (blue-50/50 fill + 2px navy border)
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function QuizQuestionCard({
  question,
  activeAnswer,
  currentQuestionIndex = 0,
  totalQuestions = 1,
  onSelectOption,
  onNavigateNext,
  onNavigatePrev,
  onOpenFinishModal,
  isSubmitting = false,
}) {
  if (!question) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-gray-200 dark:border-slate-800 text-center text-gray-500 dark:text-slate-400">
        No question selected.
      </div>
    );
  }

  const isFirst = currentQuestionIndex === 0;
  const isLast = currentQuestionIndex >= totalQuestions - 1;
  const isAnswered = Boolean(activeAnswer);

  return (
    <article className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-gray-200 dark:border-slate-800 shadow-card space-y-6">
      {/* 1. Question Meta Header */}
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs font-bold">
          <span>Question {question.number || currentQuestionIndex + 1}</span>
          <span>of</span>
          <span>{totalQuestions}</span>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-400 font-medium">
          <span>Marked out of {Number(question.points || 1).toFixed(2)}</span>
          <span>•</span>
          <span className={isAnswered ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-gray-400 dark:text-slate-500'}>
            {isAnswered ? 'Answered' : 'Not yet answered'}
          </span>
        </div>
      </div>

      {/* 2. Prompt Text */}
      <div className="text-base sm:text-lg font-medium text-gray-900 dark:text-slate-100 leading-relaxed font-sans">
        {question.prompt}
      </div>

      {/* 3. Options Radiogroup */}
      <div
        className="space-y-3 pt-2"
        role="radiogroup"
        aria-label={`Question ${question.number || currentQuestionIndex + 1} Options`}
      >
        {question.options?.map((option, idx) => {
          const isSelected = activeAnswer === option.id;
          const letter = String.fromCharCode(65 + idx);

          return (
            <label
              key={option.id}
              className={`
                w-full min-h-[56px] box-border p-4 rounded-xl border-2 flex items-center gap-4 cursor-pointer select-none transition-all
                touch-manipulation
                ${isSelected
                  ? 'border-[#0a1142] dark:border-indigo-400 bg-blue-50/50 dark:bg-slate-800 shadow-sm'
                  : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-gray-300 dark:hover:border-slate-600 hover:bg-gray-50/50 dark:hover:bg-slate-800/40'
                }
              `}
            >
              <input
                type="radio"
                name={`question_${question.id}`}
                value={option.id}
                checked={isSelected}
                disabled={isSubmitting}
                onChange={() => onSelectOption(question.id, option.id)}
                className="w-4 h-4 text-[#0a1142] focus:ring-[#0a1142] border-gray-300"
              />
              <div className="flex-1 text-sm sm:text-base font-medium text-gray-800 dark:text-slate-200">
                <span className="font-bold mr-2 uppercase text-[#0a1142] dark:text-[#ffb81c]">
                  {letter}.
                </span>
                {option.text}
              </div>
            </label>
          );
        })}
      </div>

      {/* 4. Directional Pagination Controls */}
      <div className="flex items-center justify-between border-t border-gray-100 dark:border-slate-800 pt-6">
        <button
          type="button"
          onClick={onNavigatePrev}
          disabled={isFirst || isSubmitting}
          className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-xs font-bold hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all touch-manipulation"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span>Previous</span>
        </button>

        {!isLast ? (
          <button
            type="button"
            onClick={onNavigateNext}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 min-h-[44px] rounded-xl bg-[#0a1142] dark:bg-indigo-600 hover:bg-[#16258f] dark:hover:bg-indigo-700 text-white text-xs font-bold shadow-sm transition-all touch-manipulation"
          >
            <span>Next Question</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenFinishModal}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition-all touch-manipulation"
          >
            <span>Finish Attempt...</span>
            <Send size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </article>
  );
}

export default QuizQuestionCard;
