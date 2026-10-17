import React from 'react';
import { TrendingUp, FileText, Sparkles } from 'lucide-react';

/**
 * Gradebook Performance Metric Summary Cards
 *
 * Implements:
 * 1. Weighted score metric
 * 2. Graded components count
 * 3. Senate grade track classification
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function GradeSummaryCards({ cumulativePercentage = 89, gradedCount = 0 }) {
  const classification =
    cumulativePercentage >= 70
      ? 'First Class Track'
      : cumulativePercentage >= 60
      ? 'Second Class Upper'
      : cumulativePercentage >= 50
      ? 'Second Class Lower'
      : 'Pass Degree Track';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-blue-50 text-[#0a1142] rounded-xl">
          <TrendingUp size={22} aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs text-gray-500 font-medium">Weighted Score</p>
          <p className="text-lg font-extrabold text-[#0a1142]">{cumulativePercentage}%</p>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-amber-50 text-amber-700 rounded-xl">
          <FileText size={22} aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs text-gray-500 font-medium">Graded Components</p>
          <p className="text-lg font-extrabold text-gray-900">{gradedCount} Evaluated</p>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-center gap-4">
        <div className="p-3 bg-emerald-50 text-emerald-700 rounded-xl">
          <Sparkles size={22} aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs text-gray-500 font-medium">Grade Classification</p>
          <p className="text-lg font-extrabold text-emerald-700">{classification}</p>
        </div>
      </div>
    </div>
  );
}

export default GradeSummaryCards;
