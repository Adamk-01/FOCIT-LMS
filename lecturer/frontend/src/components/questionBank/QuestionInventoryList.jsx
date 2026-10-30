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
      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
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
                    ? 'bg-[#0a1142] text-white border-[#0a1142] shadow-sm' 
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}
                `}
              >
                {type.label}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-gray-500 font-medium">
          Displaying <span className="font-bold text-[#0a1142]">{filteredQuestions.length}</span> of {questions.length} questions
        </div>
      </div>

      {/* Questions Inventory Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#0a1142] font-display">
            Question Bank Inventory
          </h2>
          <span className="text-xs text-gray-500 font-medium">
            Enforced by PostgreSQL Immutability Trigger
          </span>
        </div>

        {filteredQuestions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <HelpCircle size={36} className="text-gray-300 mx-auto" />
            <p className="text-sm font-semibold text-gray-700">No questions match this filter</p>
            <p className="text-xs text-gray-500">Add a new question or change your filter category above.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredQuestions.map((q) => (
              <article key={q.id} className="p-6 hover:bg-gray-50/70 transition-all space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-[#0a1142] text-[#ffb81c] text-xs font-extrabold flex items-center justify-center">
                      {q.number}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-[#0a1142] border border-blue-200">
                      {q.type.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-500 font-semibold">
                      {Number(q.points || 1).toFixed(2)} Points
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 font-mono">ID: {q.id}</span>
                  </div>
                </div>

                <p className="text-sm sm:text-base font-bold text-gray-900 leading-relaxed font-sans">
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
                            ? 'bg-emerald-50/80 border-emerald-300 font-bold text-emerald-900' 
                            : 'bg-gray-50 border-gray-100 text-gray-700'}
                        `}
                      >
                        <span className="truncate">
                          <strong className="mr-1.5 uppercase text-[#0a1142]">{opt.id.replace('opt_', '')}.</strong>
                          {opt.text}
                        </span>
                        {isCorrect && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 bg-emerald-200/60 px-2 py-0.5 rounded-full shrink-0">
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
