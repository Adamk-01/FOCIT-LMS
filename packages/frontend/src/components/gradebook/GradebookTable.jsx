import React from 'react';
import { HelpCircle, FileText } from 'lucide-react';

function getLetterBadgeStyle(letter) {
  switch (letter) {
    case 'A':
      return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    case 'B':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'C':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    default:
      return 'bg-rose-100 text-rose-800 border-rose-300';
  }
}

/**
 * Gradebook Assessment Breakdown & Matrix Table
 *
 * Implements:
 * 1. Accessible HTML table with caption, scope, and semantic headers
 * 2. Graded assessment rows with weight, score, range, percentage, and letter badge
 * 3. Course total summary row in tfoot
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function GradebookTable({
  items = [],
  courseCode = 'CSC 204',
  overallLetter = 'A',
  cumulativePercentage = 89,
}) {
  const totalGradeSum = items.reduce((acc, curr) => acc + (Number(curr.grade) || 0), 0);

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-base font-bold text-[#0a1142] font-display">
          Assessment Breakdown & Grade Items
        </h2>
        <span className="text-xs text-gray-500 font-medium">
          Aggregated via Headless Moodle REST Core
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs sm:text-sm">
          <caption className="sr-only">Student assessment grades for {courseCode}</caption>
          <thead>
            <tr className="bg-gray-50/80 border-b border-gray-200 text-gray-600 font-bold uppercase text-[11px] tracking-wider">
              <th scope="col" className="py-3.5 px-6">Grade Item</th>
              <th scope="col" className="py-3.5 px-4 text-center">Weight</th>
              <th scope="col" className="py-3.5 px-4 text-center">Grade</th>
              <th scope="col" className="py-3.5 px-4 text-center">Range</th>
              <th scope="col" className="py-3.5 px-4 text-center">Percentage</th>
              <th scope="col" className="py-3.5 px-4 text-center">Letter</th>
              <th scope="col" className="py-3.5 px-6">Feedback</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-blue-50/20 transition-colors">
                <th scope="row" className="py-4 px-6 font-bold text-gray-900 font-normal">
                  <div className="flex items-center gap-2.5">
                    {item.category === 'QUIZ' ? (
                      <HelpCircle size={16} className="text-[#0a1142] shrink-0" aria-hidden="true" />
                    ) : (
                      <FileText size={16} className="text-amber-600 shrink-0" aria-hidden="true" />
                    )}
                    <span>{item.name}</span>
                  </div>
                </th>
                <td className="py-4 px-4 text-center font-medium text-gray-600">
                  {item.weightPercent}%
                </td>
                <td className="py-4 px-4 text-center font-bold text-[#0a1142]">
                  {Number(item.grade).toFixed(2)}
                </td>
                <td className="py-4 px-4 text-center text-gray-500">
                  0.00–{Number(item.maxGrade).toFixed(2)}
                </td>
                <td className="py-4 px-4 text-center font-extrabold text-emerald-700">
                  {item.percentage}%
                </td>
                <td className="py-4 px-4 text-center">
                  <span
                    className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getLetterBadgeStyle(
                      item.letterGrade
                    )}`}
                  >
                    {item.letterGrade}
                  </span>
                </td>
                <td className="py-4 px-6 text-gray-600 text-xs italic leading-relaxed">
                  {item.feedback || 'No comments recorded.'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-bold border-t-2 border-gray-200 text-gray-900">
              <th scope="row" className="py-4 px-6 uppercase text-xs tracking-wider text-[#0a1142]">
                Course Total
              </th>
              <td className="py-4 px-4 text-center">100%</td>
              <td className="py-4 px-4 text-center text-[#0a1142]">
                {totalGradeSum.toFixed(2)}
              </td>
              <td className="py-4 px-4 text-center text-gray-500">0.00–100.00</td>
              <td className="py-4 px-4 text-center text-emerald-700 font-extrabold text-base">
                {cumulativePercentage}%
              </td>
              <td className="py-4 px-4 text-center">
                <span
                  className={`inline-block px-3 py-1 rounded-full text-xs font-black border ${getLetterBadgeStyle(
                    overallLetter
                  )}`}
                >
                  {overallLetter}
                </span>
              </td>
              <td className="py-4 px-6 text-xs text-gray-500 font-medium">
                Authoritative semester grade point calculation.
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default GradebookTable;
