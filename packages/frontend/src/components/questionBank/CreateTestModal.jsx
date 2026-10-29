import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle, BookOpen, Layers, Clock, Award, Share2 } from 'lucide-react';

export function CreateTestModal({ isOpen, onClose, courseId, courseCode, onCreateTest, isPending }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [totalPoints, setTotalPoints] = useState(100);
  const [quizType, setQuizType] = useState('OFFICIAL_TEST');
  const [questionFormat, setQuestionFormat] = useState('MULTIPLE_CHOICE');
  const [syncToMoodle, setSyncToMoodle] = useState(true);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    onCreateTest({
      title: title.trim(),
      description: description.trim() || undefined,
      durationMinutes: Number(durationMinutes) || 30,
      totalPoints: Number(totalPoints) || 100,
      quizType,
      questionFormat,
      syncToMoodle,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#0a1142] text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <BookOpen className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Create Test / Assessment</h2>
              <p className="text-xs text-indigo-200">Course: {courseCode || courseId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            type="button"
            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto text-sm">
          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Test Title *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Mid-Semester Quiz or Continuous Assessment 1"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 focus:border-[#0a1142] focus:ring-2 focus:ring-[#0a1142]/10 outline-none text-sm transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
              Description (Optional)
            </label>
            <textarea
              rows={2}
              placeholder="Instructions or scope of the assessment..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-gray-200 focus:border-[#0a1142] focus:ring-2 focus:ring-[#0a1142]/10 outline-none text-xs transition-all resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Question Format
              </label>
              <select
                value={questionFormat}
                onChange={(e) => setQuestionFormat(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-[#0a1142] text-xs outline-none bg-white font-medium"
              >
                <option value="MULTIPLE_CHOICE">Multiple Choice (MCQ)</option>
                <option value="TRUE_FALSE">True / False</option>
                <option value="SHORT_ANSWER">Short Answer</option>
                <option value="MIXED">Mixed (All Types)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Assessment Tier
              </label>
              <select
                value={quizType}
                onChange={(e) => setQuizType(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-[#0a1142] text-xs outline-none bg-white font-medium"
              >
                <option value="OFFICIAL_TEST">Official Graded Test</option>
                <option value="SELF_PRACTICE">Self-Practice Drill</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Duration (Minutes)
              </label>
              <input
                type="number"
                min="5"
                max="300"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-[#0a1142] text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                Total Marks
              </label>
              <input
                type="number"
                min="1"
                max="1000"
                value={totalPoints}
                onChange={(e) => setTotalPoints(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-[#0a1142] text-xs outline-none"
              />
            </div>
          </div>

          {/* Moodle Sync Toggle */}
          <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Share2 className="w-4 h-4 text-indigo-600 shrink-0" />
              <div>
                <p className="text-xs font-bold text-indigo-950">Sync to Moodle Server</p>
                <p className="text-[11px] text-indigo-700">Recreates this test & its questions in Moodle automatically</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={syncToMoodle}
                onChange={(e) => setSyncToMoodle(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !title.trim()}
              className="px-5 py-2.5 text-xs font-bold text-white bg-[#0a1142] hover:bg-indigo-900 active:scale-95 disabled:opacity-50 disabled:pointer-events-none rounded-xl transition-all shadow-md shadow-indigo-900/10"
            >
              {isPending ? 'Creating Test...' : 'Create Test & Open Bank'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
