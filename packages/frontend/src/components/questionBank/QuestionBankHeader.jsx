import React from 'react';
import { ShieldCheck, Plus, Clock } from 'lucide-react';

/**
 * <QuestionBankHeader />
 *
 * Top assessment revision management banner with publish and authoring triggers.
 */
export function QuestionBankHeader({
  courseCode,
  courseTitle,
  activeQuiz,
  isPublishing,
  canPublish,
  onPublish,
  showAuthoringCard,
  onToggleAuthoring,
  onOpenPublishTestModal,
  courses = [],
  selectedCourseId,
  onSelectCourse,
}) {
  return (
    <header className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-gray-200 dark:border-slate-800 shadow-card flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#0a1142] border border-[#ffb81c]/30">
            <ShieldCheck size={14} className="text-[#0a1142]" />
            <span>TOPIC PRACTICE & REVISION POOL</span>
          </div>
          {courses.length > 1 && onSelectCourse && (
            <select
              value={selectedCourseId}
              onChange={(e) => onSelectCourse(e.target.value)}
              className="text-xs font-bold bg-blue-50 text-[#0a1142] border border-blue-200 rounded-lg px-2.5 py-1 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            >
              {courses.map((c) => (
                <option key={c.course_id} value={c.course_id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          )}
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0a1142] font-display">
          Question Bank: {courseCode}{courseTitle ? ` — ${courseTitle}` : ''}
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 font-medium">
          Active Practice Drill: Version {activeQuiz?.version || 1} • {activeQuiz?.durationMinutes || 45} Min Self-Paced Session
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onOpenPublishTestModal}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-md transition-all min-h-[44px]"
        >
          <Clock size={16} className="text-white" />
          <span>Publish Official Test</span>
        </button>
        <button
          type="button"
          disabled={isPublishing || !canPublish}
          onClick={onPublish}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all min-h-[44px]"
        >
          <ShieldCheck size={16} className="text-white" />
          <span>{isPublishing ? 'Publishing...' : 'Publish Practice Drill'}</span>
        </button>
        <button
          type="button"
          onClick={onToggleAuthoring}
          className="inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition-all min-h-[44px]"
        >
          <Plus size={16} className="text-[#ffb81c]" />
          <span>{showAuthoringCard ? 'Close Question Form' : 'Add Question'}</span>
        </button>
      </div>
    </header>
  );
}

export default QuestionBankHeader;
