import React from 'react';
import { HelpCircle, CheckCircle2 } from 'lucide-react';
import { QUESTION_TYPES } from '../../hooks/useQuestionBank';

/**
 * <QuestionInventoryList />
 *
 * Question inventory table and type filter pills with deterministic backend keys.
 */
export function QuestionInventoryList({
  questions = [],
  filteredQuestions = [],
  selectedTypeFilter = 'ALL',
  onFilterChange,
}) {
  return (
    <div className="space-y-4">
      {/* Filter Chips Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-gray-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
          {QUESTION_TYPES.map((type) => {
            const isSelected = selectedTypeFilter === type.id;
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => onFilterChange(type.id)}
                className={`
                  px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border min-h-[44px]
                  ${isSelected 
                    ? 'bg-[#0a1142] dark:bg-indigo-600 text-white border-[#0a1142] dark:border-indigo-600 shadow-sm' 
                    : 'bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-700'}
                `}
              >
                {type.label}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-gray-500 dark:text-slate-400 font-medium">
          Displaying <span className="font-bold text-[#0a1142] dark:text-[#ffb81c]">{filteredQuestions.length}</span> of {questions.length} questions
        </div>
      </div>

      {/* Questions Inventory Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-card overflow-hidden">
        <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#0a1142] dark:text-[#ffb81c] font-display">
            Question Bank Inventory
          </h2>
          <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">
            Enforced by PostgreSQL Immutability Trigger
          </span>
        </div>

        {filteredQuestions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <HelpCircle size={36} className="text-gray-300 dark:text-slate-600 mx-auto" />
            <p className="text-sm font-semibold text-gray-700 dark:text-slate-300">No questions match this filter</p>
            <p className="text-xs text-gray-500 dark:text-slate-400">Add a new question or change your filter category above.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {filteredQuestions.map((q) => (
              <article key={q.id} className="p-6 hover:bg-gray-50/70 dark:hover:bg-slate-800/40 transition-all space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-[#0a1142] text-[#ffb81c] text-xs font-extrabold flex items-center justify-center">
                      {q.number}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-slate-800 text-[#0a1142] dark:text-indigo-400 border border-blue-200 dark:border-slate-700">
                      {q.type.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-slate-400 font-semibold">
                      {Number(q.points || 1).toFixed(2)} Points
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 dark:text-slate-500 font-mono">ID: {q.id}</span>
                  </div>
                </div>

                <p className="text-sm sm:text-base font-bold text-gray-900 dark:text-slate-100 leading-relaxed font-sans">
                  {q.prompt}
                </p>

                {/* Options Breakdown with Correct Answer Highlight */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {q.options?.map((opt) => {
                    const isCorrect = q.correctOptionId === opt.id;
                    return (
                      <div
                        key={opt.id}
                        className={`
                          p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 border
                          ${isCorrect 
                            ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700 font-bold text-emerald-900 dark:text-emerald-200' 
                            : 'bg-gray-50 dark:bg-slate-800/60 border-gray-100 dark:border-slate-700/60 text-gray-700 dark:text-slate-300'}
                        `}
                      >
                        <span className="truncate">
                          <strong className="mr-1.5 uppercase text-[#0a1142] dark:text-[#ffb81c]">{opt.id.replace('opt_', '')}.</strong>
                          {opt.text}
                        </span>
                        {isCorrect && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 bg-emerald-200/60 dark:bg-emerald-950/80 px-2 py-0.5 rounded-full shrink-0">
                            <CheckCircle2 size={10} /> Correct
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default QuestionInventoryList;
