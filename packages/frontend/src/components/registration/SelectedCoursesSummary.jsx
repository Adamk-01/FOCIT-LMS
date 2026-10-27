import React from 'react';
import { ChevronLeft, ChevronRight, BookOpen, AlertCircle, Trash2 } from 'lucide-react';

/**
 * <SelectedCoursesSummary />
 *
 * Curriculum review card displaying credit metrics, course list breakdown,
 * and Senate threshold status before final confirmation.
 */
export function SelectedCoursesSummary({
  selectedCourses = [],
  totalUnits = 0,
  minFloor = 15,
  maxCeiling = 24,
  isUnderMinimum = false,
  isOverMaximum = false,
  unitsDeficit = 0,
  unitsSurplus = 0,
  onBack,
  onProceed,
  onRemoveCourse,
}) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-gray-200/80 dark:border-slate-800 shadow-sm space-y-6 animate-fade-in">
      <div className="border-b border-gray-100 dark:border-slate-800 pb-4">
        <h2 className="text-lg sm:text-xl font-black text-[#0a1142] dark:text-blue-400 font-display tracking-tight">
          Curriculum Review & Credit Summary
        </h2>
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5 font-sans">
          Verify your proposed academic modules before final submission to your Level Advisor.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/60">
          <span className="text-xs text-gray-500 dark:text-slate-400 font-bold uppercase tracking-wider font-sans">
            Total Selected
          </span>
          <p className="text-2xl font-black text-[#0a1142] dark:text-slate-100 font-display mt-1">
            {selectedCourses.length} Modules
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/60">
          <span className="text-xs text-gray-500 dark:text-slate-400 font-bold uppercase tracking-wider font-sans">
            Accumulated Load
          </span>
          <p
            className={`text-2xl font-black font-display mt-1 ${
              isUnderMinimum
                ? 'text-amber-600 dark:text-amber-400'
                : isOverMaximum
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {totalUnits} / {maxCeiling} Units
          </p>
        </div>
      </div>

      {/* Senate Bounds Status Banner */}
      {(isUnderMinimum || isOverMaximum) && (
        <div
          role="alert"
          className={`p-4 rounded-xl border flex items-start gap-3 ${
            isUnderMinimum
              ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200'
              : 'bg-red-50 dark:bg-red-950/40 border-red-300 dark:border-red-700/60 text-red-900 dark:text-red-200'
          }`}
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-xs leading-relaxed font-sans">
            <span className="font-bold block text-sm mb-0.5 font-display">
              {isUnderMinimum ? 'Senate Floor Deficiency' : 'Senate Ceiling Breach'}
            </span>
            {isUnderMinimum
              ? `You need ${unitsDeficit} more credit unit${unitsDeficit > 1 ? 's' : ''} to meet the mandatory 15-unit minimum for submission.`
              : `Your selection exceeds the maximum Senate limit by ${unitsSurplus} credit unit${unitsSurplus > 1 ? 's' : ''}. Please remove courses to proceed.`}
          </div>
        </div>
      )}

      {/* Selected Modules Breakdown */}
      <div className="border border-gray-200/80 dark:border-slate-800 rounded-xl divide-y divide-gray-100 dark:divide-slate-800 overflow-hidden">
        {selectedCourses.map((c) => (
          <div
            key={c.course_id}
            className="p-4 flex items-center justify-between bg-white dark:bg-slate-900 hover:bg-gray-50/60 dark:hover:bg-slate-800/40 transition-colors"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-[#0a1142] dark:text-blue-400 text-sm font-display">
                  {c.code}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 uppercase tracking-wider font-sans">
                  {c.category}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-slate-400 mt-0.5 font-sans">{c.title}</p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-gray-800 dark:text-slate-200 font-display">
                {c.units} Units
              </span>
              {typeof onRemoveCourse === 'function' && (
                <button
                  type="button"
                  onClick={() => onRemoveCourse(c.course_id)}
                  aria-label={`Remove ${c.code}`}
                  className="p-2 rounded-lg text-gray-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Navigation Controls (WCAG 44x44px Touch Targets, Sticky on Mobile) */}
      <div className="sticky bottom-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md py-3 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between gap-3 z-10">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          <ChevronLeft size={16} />
          <span>Back to Selection</span>
        </button>

        <button
          type="button"
          onClick={onProceed}
          disabled={isUnderMinimum || isOverMaximum}
          className="min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-xl bg-[#0a1142] dark:bg-blue-600 hover:bg-[#16258f] dark:hover:bg-blue-700 text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0a1142]"
        >
          <span>Continue to Confirmation</span>
          <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}

export default SelectedCoursesSummary;
