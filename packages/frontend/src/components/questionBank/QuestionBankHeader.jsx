import React from 'react';
import { ShieldCheck, Plus } from 'lucide-react';

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
}) {
  return (
    <header className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-card flex flex-col md:flex-row md:items-center justify-between gap-6">
      <div className="space-y-1">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#0a1142] border border-[#ffb81c]/30">
          <ShieldCheck size={14} className="text-[#0a1142]" />
          <span>AUTHORITATIVE ASSESSMENT INVENTORY</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0a1142] font-display">
          Question Bank: {courseCode} — {courseTitle}
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 font-medium">
          Active Revision: Version {activeQuiz?.version || 1} • {activeQuiz?.durationMinutes || 45} Minutes Examination
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={isPublishing || !canPublish}
          onClick={onPublish}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all min-h-[44px]"
        >
          <ShieldCheck size={16} className="text-white" />
          <span>{isPublishing ? 'Publishing...' : 'Publish Revision'}</span>
        </button>
        <button
          type="button"
          onClick={onToggleAuthoring}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition-all min-h-[44px]"
        >
          <Plus size={16} className="text-[#ffb81c]" />
          <span>{showAuthoringCard ? 'Close Question Form' : 'Add Question'}</span>
        </button>
      </div>
    </header>
  );
}

export default QuestionBankHeader;
