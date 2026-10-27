import React from 'react';
import { Layers, HelpCircle, CheckCircle2, FileText } from 'lucide-react';

/**
 * <QuestionMetricsSummary />
 *
 * 4-card metric overview of assessment questions partitioned by type.
 */
export function QuestionMetricsSummary({ metrics = { total: 0, mcq: 0, trueFalse: 0, shortAnswer: 0 } }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-blue-50 dark:bg-slate-800 text-[#0a1142] dark:text-indigo-400 rounded-xl">
          <Layers size={22} />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">Total Questions</p>
          <p className="text-xl font-extrabold text-[#0a1142] dark:text-slate-100">{metrics.total} Active</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 rounded-xl">
          <HelpCircle size={22} />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">Multiple Choice</p>
          <p className="text-xl font-extrabold text-indigo-900 dark:text-indigo-200">{metrics.mcq} Items</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-xl">
          <CheckCircle2 size={22} />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">True / False</p>
          <p className="text-xl font-extrabold text-emerald-900 dark:text-emerald-200">{metrics.trueFalse} Items</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 rounded-xl">
          <FileText size={22} />
        </div>
        <div>
          <p className="text-xs text-gray-500 dark:text-slate-400 font-medium">Short Answer</p>
          <p className="text-xl font-extrabold text-amber-900 dark:text-amber-200">{metrics.shortAnswer} Items</p>
        </div>
      </div>
    </div>
  );
}

export default QuestionMetricsSummary;
