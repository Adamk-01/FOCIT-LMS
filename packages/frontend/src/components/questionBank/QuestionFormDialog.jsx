import React, { useState } from 'react';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { ErrorAlertCallout } from '../ErrorAlertCallout';

/**
 * <QuestionFormDialog />
 *
 * Authoring form for assessment questions with Zero-Trust error callouts.
 * Enforces explicit DOM target IDs matching userFriendlyMessages.js FOCUS_INPUT actions:
 * - question-text-input
 * - question-points-input
 * - option-input-0, option-input-1, ...
 * - correct-option-radio-0, correct-option-radio-1, ...
 */
export function QuestionFormDialog({
  questionCount = 0,
  activeQuizVersion = 1,
  onSubmit,
  onCancel,
  isPending = false,
  error = null,
}) {
  const [formType, setFormType] = useState('MULTIPLE_CHOICE');
  const [formPrompt, setFormPrompt] = useState('');
  const [formPoints, setFormPoints] = useState(1.0);
  const [formCorrectOption, setFormCorrectOption] = useState('opt_a');
  const [formOptions, setFormOptions] = useState([
    { id: 'opt_a', text: '' },
    { id: 'opt_b', text: '' },
    { id: 'opt_c', text: '' },
    { id: 'opt_d', text: '' },
  ]);

  const handleOptionChange = (optId, text) => {
    setFormOptions((prev) =>
      prev.map((opt) => (opt.id === optId ? { ...opt, text } : opt))
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isPending) return;

    onSubmit({
      type: formType,
      prompt: formPrompt,
      options: formOptions,
      correctOptionId: formCorrectOption,
      points: formPoints,
    });
  };

  return (
    <section 
      aria-label="Create Question Form"
      className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border-2 border-[#0a1142]/20 dark:border-slate-800 shadow-xl space-y-6 animate-in slide-in-from-top-4 duration-300"
    >
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-4">
        <div className="space-y-0.5">
          <h2 className="text-lg font-bold text-[#0a1142] dark:text-[#ffb81c] font-display">
            Manual Question Creator
          </h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Author new assessment questions. Correct options are bound and enforced at the database engine level.
          </p>
        </div>
        <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 dark:bg-slate-800 text-[#0a1142] dark:text-indigo-400">
          Question #{questionCount + 1}
        </span>
      </div>

      {/* Inlined Zero-Trust RFC 7807 Error Alert Callout */}
      {error && (
        <ErrorAlertCallout
          error={error}
          className="mb-4"
        />
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="question-type-select" className="block text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Question Type
            </label>
            <select
              id="question-type-select"
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-semibold text-gray-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-indigo-500 min-h-[44px]"
            >
              <option value="MULTIPLE_CHOICE">Multiple Choice</option>
              <option value="TRUE_FALSE">True / False</option>
              <option value="SHORT_ANSWER">Short Answer</option>
            </select>
          </div>

          <div>
            <label htmlFor="question-points-input" className="block text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Points Allocation
            </label>
            <input
              id="question-points-input"
              type="number"
              step="0.5"
              min="0.5"
              max="10"
              value={formPoints}
              onChange={(e) => setFormPoints(Number(e.target.value))}
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-semibold text-gray-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-indigo-500 min-h-[44px]"
            />
          </div>

          <div>
            <label htmlFor="target-revision-input" className="block text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Target Revision
            </label>
            <input
              id="target-revision-input"
              type="text"
              disabled
              value={`Version ${activeQuizVersion} (Live)`}
              className="w-full px-4 py-2.5 bg-gray-100 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm font-bold text-gray-500 dark:text-slate-400 cursor-not-allowed min-h-[44px]"
            />
          </div>
        </div>

        <div>
          <label htmlFor="question-text-input" className="block text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            Question Prompt Text
          </label>
          <textarea
            id="question-text-input"
            required
            rows={3}
            placeholder="Enter the examination prompt (e.g. In a Min-Heap with N elements, what is the asymptotic runtime to extract min?)..."
            value={formPrompt}
            onChange={(e) => setFormPrompt(e.target.value)}
            className="w-full px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 font-medium focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-indigo-500 resize-none"
          />
        </div>

        {/* Dynamic Option Authoring with Radial Correct Answer Binder */}
        <div className="space-y-3 pt-2">
          <label className="block text-xs font-bold text-gray-700 dark:text-slate-300 uppercase tracking-wider">
            Options & Correct Answer Selection (Radial Selector Binds Key)
          </label>

          <div className="space-y-2.5">
            {formOptions.map((opt, idx) => (
              <div 
                key={opt.id}
                className={`
                  flex items-center gap-3 p-3 rounded-xl border-2 transition-all
                  ${formCorrectOption === opt.id 
                    ? 'border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/30 dark:border-emerald-700 shadow-sm' 
                    : 'border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/40'}
                `}
              >
                <input
                  type="radio"
                  name="correct_option_selector"
                  id={`correct-option-radio-${idx}`}
                  checked={formCorrectOption === opt.id}
                  onChange={() => setFormCorrectOption(opt.id)}
                  className="w-5 h-5 text-emerald-600 focus:ring-emerald-500 cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                />
                <label htmlFor={`correct-option-radio-${idx}`} className="text-xs font-extrabold uppercase text-[#0a1142] dark:text-[#ffb81c] w-6 shrink-0 cursor-pointer">
                  {opt.id.replace('opt_', '')}.
                </label>
                <input
                  id={`option-input-${idx}`}
                  type="text"
                  required
                  placeholder={`Enter text for option ${opt.id.replace('opt_', '').toUpperCase()}...`}
                  value={opt.text}
                  onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                  className="flex-1 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 px-3 py-2 rounded-lg text-xs sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 font-medium focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-indigo-500 min-h-[44px]"
                />
                {formCorrectOption === opt.id && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-2.5 py-1 rounded-full shrink-0">
                    <CheckCircle2 size={12} /> Correct
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 text-xs font-bold hover:bg-gray-50 dark:hover:bg-slate-800 min-h-[44px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || !formPrompt.trim()}
            className="px-6 py-2.5 rounded-xl bg-[#0a1142] dark:bg-indigo-600 hover:bg-[#16258f] dark:hover:bg-indigo-700 text-white text-xs font-bold shadow-md transition-all flex items-center gap-2 disabled:opacity-50 min-h-[44px]"
          >
            {isPending ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                <span>Enforcing Constraint...</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={16} className="text-[#ffb81c]" />
                <span>Save Question to Bank</span>
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

export default QuestionFormDialog;
