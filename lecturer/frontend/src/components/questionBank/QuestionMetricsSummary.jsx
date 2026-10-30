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
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-blue-50 text-[#0a1142] rounded-xl">
          <Layers size={22} />
        </div>
        <div>
          <p className="text-xs text-gray-500 font-medium">Total Questions</p>
          <p className="text-xl font-extrabold text-[#0a1142]">{metrics.total} Active</p>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-indigo-50 text-indigo-700 rounded-xl">
          <HelpCircle size={22} />
        </div>
        <div>
          <p className="text-xs text-gray-500 font-medium">Multiple Choice</p>
          <p className="text-xl font-extrabold text-indigo-900">{metrics.mcq} Items</p>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl">
          <CheckCircle2 size={22} />
        </div>
        <div>
          <p className="text-xs text-gray-500 font-medium">True / False</p>
          <p className="text-xl font-extrabold text-emerald-900">{metrics.trueFalse} Items</p>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-amber-50 text-amber-700 rounded-xl">
          <FileText size={22} />
        </div>
        <div>
          <p className="text-xs text-gray-500 font-medium">Short Answer</p>
          <p className="text-xl font-extrabold text-amber-900">{metrics.shortAnswer} Items</p>
        </div>
      </div>
    </div>
  );
}

export default QuestionMetricsSummary;
