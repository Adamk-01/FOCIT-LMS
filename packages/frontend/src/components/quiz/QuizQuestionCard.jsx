import React from 'react';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react';

/**
 * Single Question Card with Interactive Radiogroup or Short Answer Text Input
 *
 * Implements:
 * 1. Semantic <article> container with header metadata
 * 2. WCAG-compliant radiogroup for MCQ/TrueFalse (min-h-[56px] touch targets)
 * 3. Dedicated clean text input for SHORT_ANSWER questions
 * 4. Next/Previous and Finish navigation controls with 44x44px minimum sizing
 * 5. Distinct visual selection state (blue-50/50 fill + 2px navy border)
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
      <div className="bg-white rounded-2xl p-8 border border-gray-200 text-center text-gray-500">
        No question selected.
      </div>
    );
  }

  const isFirst = currentQuestionIndex === 0;
  const isLast = currentQuestionIndex >= totalQuestions - 1;
  const isAnswered = Boolean(activeAnswer);
  const isShortAnswer = question.type === 'SHORT_ANSWER';

  return (
    <article className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-card space-y-6">
      {/* 1. Question Meta Header */}
      <div className="flex items-center justify-between border-b border-gray-100 pb-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-gray-100 text-gray-800 text-xs font-bold">
          <span>Question {question.number || currentQuestionIndex + 1}</span>
          <span>of</span>
          <span>{totalQuestions}</span>
          {isShortAnswer && (
            <span className="ml-1 px-2 py-0.5 rounded text-[10px] bg-purple-100 text-purple-700 uppercase font-semibold">
              Short Answer
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
          <span>Marked out of {Number(question.points || 1).toFixed(2)}</span>
          <span>•</span>
          <span className={isAnswered ? 'text-emerald-600 font-bold' : 'text-gray-400'}>
            {isAnswered ? 'Answered' : 'Not yet answered'}
          </span>
        </div>
      </div>

      {/* 2. Prompt Text */}
      <div className="text-base sm:text-lg font-medium text-gray-900 leading-relaxed font-sans">
        {question.prompt}
      </div>

      {/* 3. Interactive Answer Inputs: SHORT_ANSWER vs Options Radiogroup */}
      {isShortAnswer ? (
        <div className="space-y-3 pt-2">
          <label htmlFor={`short_answer_${question.id}`} className="block text-xs font-bold uppercase tracking-wider text-gray-600">
            Your Written Answer
          </label>
          <div className="relative">
            <input id={`short_answer_${question.id}`}

              type="text"
              name={`question_${question.id}`}
              value={activeAnswer || ''}
              disabled={isSubmitting}
              placeholder="Type your answer here..."
              onChange={(e) => onSelectOption(question.id, e.target.value)}
              className="w-full min-h-[52px] px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-[#0a1142] focus:bg-blue-50/20 text-gray-900 font-medium text-base outline-none transition-all shadow-sm placeholder:text-gray-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
          </div>
          <p className="text-xs text-gray-400">
            Tip: Be precise with your terminology and spelling.
          </p>
        </div>
      ) : (
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
                    ? 'border-[#0a1142] bg-blue-50/50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
                  }
                `}
              >
                <input id={`opt_${option.id}`}

                  type="radio"
                  name={`question_${question.id}`}
                  value={option.id}
                  checked={isSelected}
                  disabled={isSubmitting}
                  onChange={() => onSelectOption(question.id, option.id)}
                  className="w-4 h-4 text-[#0a1142] focus:ring-[#0a1142] border-gray-300"
                />
                <div className="flex-1 text-sm sm:text-base font-medium text-gray-800">
                  <span className="font-bold mr-2 uppercase text-[#0a1142]">
                    {letter}.
                  </span>
                  {option.text}
                </div>
              </label>
            );
          })}
        </div>
      )}

      {/* 4. Directional Pagination Controls */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-6">
        <button
          type="button"
          onClick={onNavigatePrev}
          disabled={isFirst || isSubmitting}
          className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border border-gray-200 text-gray-700 text-xs font-bold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all touch-manipulation"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span>Previous</span>
        </button>

        {!isLast ? (
          <button
            type="button"
            onClick={onNavigateNext}
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 min-h-[44px] rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-sm transition-all touch-manipulation"
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
