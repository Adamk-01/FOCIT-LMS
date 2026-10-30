import React from 'react';
import { ArrowLeft, Plus, RefreshCw, Trash2, CheckCircle2, BookOpen, Send, EyeOff, Copy } from 'lucide-react';

export function TestQuestionManagerView({
  test,
  questions = [],
  isLoading,
  onBack,
  onOpenAddQuestion,
  onDeleteQuestion,
  onSyncMoodle,
  isSyncing,
  onTogglePublish,
  isPublishing,
  onDuplicateAsPractice,
  isDuplicating,
}) {
  const isPublished = Boolean(test.is_active_for_new_attempts);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header Bar */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <button
              onClick={onBack}
              type="button"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0a1142] mb-2 transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Back to Tests</span>
            </button>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-lg font-bold text-[#0a1142]">{test.title}</h2>
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                {test.question_format?.replace('_', ' ')}
              </span>
              <span
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
                  isPublished
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {isPublished ? '● Live to Students' : '○ Draft (Hidden from Students)'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">{test.description || 'Manage test questions and publish to students.'}</p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {test.quiz_type === 'OFFICIAL_TEST' && (
              <button
                onClick={() => onDuplicateAsPractice(test.quiz_id)}
                disabled={isDuplicating || questions.length === 0}
                type="button"
                title="Create a formative practice drill with dynamic anti-memorization shuffling"
                className="flex items-center gap-1.5 px-3 py-2 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
              >
                <Copy size={13} />
                <span>{isDuplicating ? 'Duplicating...' : 'Duplicate as Practice'}</span>
              </button>
            )}

            {test.sync_to_moodle && (
              <button
                onClick={() => onSyncMoodle(test.quiz_id)}
                disabled={isSyncing}
                type="button"
                className="flex items-center gap-1.5 px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
              >
                <RefreshCw size={13} className={isSyncing ? 'animate-spin text-indigo-600' : ''} />
                <span>{test.moodle_quiz_id ? `Moodle #${test.moodle_quiz_id}` : 'Sync Moodle'}</span>
              </button>
            )}

            <button
              onClick={() => onTogglePublish(!isPublished)}
              disabled={isPublishing || (!isPublished && questions.length === 0)}
              type="button"
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl transition-all shadow-sm ${
                isPublished
                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50'
              }`}
            >
              {isPublished ? <EyeOff size={13} /> : <Send size={13} />}
              <span>{isPublishing ? 'Updating...' : isPublished ? 'Unpublish (Draft)' : 'Publish to Students'}</span>
            </button>

            <button
              onClick={onOpenAddQuestion}
              type="button"
              className="flex items-center gap-1.5 px-3.5 py-2 bg-[#0a1142] hover:bg-indigo-950 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-95"
            >
              <Plus size={15} />
              <span>+ Add Question</span>
            </button>
          </div>
        </div>
      </div>

      {/* Questions List */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 bg-gray-100 rounded-2xl" />
          ))}
        </div>
      ) : questions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
          <BookOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-gray-700">No Questions Added Yet</h3>
          <p className="text-xs text-gray-400 max-w-sm mx-auto mt-1 mb-4">
            Add at least 1 question before publishing this assessment to enrolled students.
          </p>
          <button
            onClick={onOpenAddQuestion}
            className="px-4 py-2 bg-[#0a1142] hover:bg-indigo-950 text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
          >
            + Add First Question
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((q, idx) => {
            const opts = Array.isArray(q.options) ? q.options : [];
            return (
              <div key={q.question_id || idx} className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm hover:border-indigo-100 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-black text-[#0a1142] bg-indigo-50 px-2 py-0.5 rounded-md">
                        Q{q.question_number || idx + 1}
                      </span>
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">
                        {q.type?.replace('_', ' ')}
                      </span>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                        {q.points || 1} {q.points === 1 ? 'pt' : 'pts'}
                      </span>
                    </div>

                    <p className="text-xs font-medium text-gray-900 leading-relaxed">{q.prompt}</p>

                    {q.type === 'MULTIPLE_CHOICE' && opts.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                        {opts.map((opt, oIdx) => {
                          const isCorrect = opt.id === q.correct_option_id;
                          return (
                            <div
                              key={opt.id || oIdx}
                              className={`p-2 rounded-xl text-xs flex items-center gap-2 border ${
                                isCorrect
                                  ? 'bg-emerald-50/80 border-emerald-300 text-emerald-900 font-semibold'
                                  : 'bg-gray-50/60 border-gray-100 text-gray-600'
                              }`}
                            >
                              <span className="w-5 h-5 flex items-center justify-center text-[10px] font-bold rounded-md bg-white border border-gray-200 shrink-0">
                                {String.fromCharCode(65 + oIdx)}
                              </span>
                              <span className="truncate">{opt.text}</span>
                              {isCorrect && <CheckCircle2 size={13} className="text-emerald-600 shrink-0 ml-auto" />}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {q.type === 'TRUE_FALSE' && (
                      <div className="mt-2.5 text-xs">
                        <span className="text-gray-500">Correct Answer: </span>
                        <span className="font-bold text-emerald-700 capitalize">{q.correct_option_id}</span>
                      </div>
                    )}

                    {q.type === 'SHORT_ANSWER' && (
                      <div className="mt-2.5 text-xs">
                        <span className="text-gray-500">Expected Key: </span>
                        <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                          {opts[0]?.text || q.correct_option_id}
                        </span>
                      </div>
                    )}

                    {q.explanation && <p className="mt-2 text-[11px] text-gray-500 italic">Note: {q.explanation}</p>}
                  </div>

                  <button
                    onClick={() => onDeleteQuestion(q.question_id)}
                    type="button"
                    title="Remove question"
                    className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
