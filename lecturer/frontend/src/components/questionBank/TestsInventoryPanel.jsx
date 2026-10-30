import React from 'react';
import { Plus, BookOpen, Clock, Award, Share2, Layers, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react';

const FORMAT_LABELS = {
  MULTIPLE_CHOICE: { label: 'Multiple Choice', style: 'bg-blue-50 text-blue-700 border-blue-200' },
  TRUE_FALSE: { label: 'True / False', style: 'bg-purple-50 text-purple-700 border-purple-200' },
  SHORT_ANSWER: { label: 'Short Answer', style: 'bg-amber-50 text-amber-700 border-amber-200' },
  MIXED: { label: 'Mixed Format', style: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

export function TestsInventoryPanel({
  tests = [],
  isLoading,
  onOpenCreateTest,
  onSelectTest,
  onSyncMoodle,
  syncingTestId,
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-pulse">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-44 bg-gray-100 rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-[#0a1142] flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-indigo-600" />
            Course Tests & Assessments
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Create assessment units with specific question formats and automatic Moodle LMS synchronization.
          </p>
        </div>
        <button
          onClick={onOpenCreateTest}
          type="button"
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[#0a1142] hover:bg-indigo-950 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-95 shrink-0"
        >
          <Plus size={16} />
          <span>Create Test</span>
        </button>
      </div>

      {/* Grid of Tests */}
      {tests.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
          <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-gray-700">No Tests Created Yet</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto mt-1 mb-4">
            Lecturers author tests first (Multiple Choice, True/False, Short Answer, or Mixed), then add questions that sync directly to Moodle.
          </p>
          <button
            onClick={onOpenCreateTest}
            className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-[#0a1142] text-xs font-bold rounded-xl transition-colors"
          >
            + Create First Test
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tests.map((test) => {
            const formatMeta = FORMAT_LABELS[test.question_format] || FORMAT_LABELS.MULTIPLE_CHOICE;
            const isSyncing = syncingTestId === test.quiz_id;

            return (
              <div
                key={test.quiz_id}
                className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
              >
                <div>
                  {/* Badges Bar */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${formatMeta.style}`}>
                      {formatMeta.label}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        test.is_active_for_new_attempts
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-gray-50 text-gray-600 border border-gray-200'
                      }`}
                    >
                      {test.is_active_for_new_attempts ? 'ACTIVE' : test.status || 'DRAFT'}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-gray-900 line-clamp-1">{test.title}</h3>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2 min-h-[32px]">
                    {test.description || 'No description provided.'}
                  </p>

                  {/* Metadata Chips */}
                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-50 text-[11px] text-gray-600">
                    <div className="flex items-center gap-1">
                      <Clock size={13} className="text-gray-400" />
                      <span>{test.duration_minutes}m</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Award size={13} className="text-gray-400" />
                      <span>{test.question_count || 0} questions</span>
                    </div>
                  </div>

                  {/* Moodle Sync Status */}
                  <div className="mt-3 p-2 bg-gray-50 rounded-xl flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 text-gray-600">
                      <Share2 size={13} className={test.moodle_quiz_id ? 'text-teal-600' : 'text-gray-400'} />
                      <span className="font-medium">
                        {test.moodle_quiz_id ? `Moodle Quiz #${test.moodle_quiz_id}` : 'Moodle: Pending'}
                      </span>
                    </div>
                    {test.sync_to_moodle && (
                      <button
                        onClick={() => onSyncMoodle(test.quiz_id)}
                        disabled={isSyncing}
                        title="Force sync to Moodle"
                        className="p-1 hover:bg-gray-200 rounded text-gray-600 disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={isSyncing ? 'animate-spin text-indigo-600' : ''} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Primary Action Button */}
                <button
                  onClick={() => onSelectTest(test)}
                  type="button"
                  className="mt-4 w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-50/70 hover:bg-indigo-100 text-[#0a1142] text-xs font-bold rounded-xl transition-colors"
                >
                  <span>Manage Questions ({test.question_count || 0})</span>
                  <ChevronRight size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
