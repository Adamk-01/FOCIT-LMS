import React, { useState } from 'react';
import { X, Clock, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react';

export function PublishOfficialTestModal({
  isOpen,
  onClose,
  courseId,
  courseCode,
  totalAvailableQuestions,
  onPublishTest,
  isPublishing,
}) {
  const [title, setTitle] = useState(`${courseCode || 'Course'} Continuous Assessment Test`);
  const [description, setDescription] = useState('Official timed assessment. Unsubmitted tests upon timer expiration are automatically marked zero.');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [totalPoints, setTotalPoints] = useState(20);
  const [autoZero, setAutoZero] = useState(true);
  const [windowOpenAt, setWindowOpenAt] = useState('');
  const [windowCloseAt, setWindowCloseAt] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onPublishTest({
      title,
      description,
      durationMinutes: Number(durationMinutes),
      totalPoints: Number(totalPoints),
      autoZero,
      windowOpenAt: windowOpenAt ? new Date(windowOpenAt).toISOString() : null,
      windowCloseAt: windowCloseAt ? new Date(windowCloseAt).toISOString() : null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        role="dialog" 
        aria-modal="true" 
        aria-labelledby="publish-test-title"
        className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-50 text-amber-700">
              <Clock size={20} />
            </div>
            <div>
              <h2 id="publish-test-title" className="text-lg font-bold text-[#0a1142] font-display">
                Publish Official Timed Test
              </h2>
              <p className="text-xs text-gray-500">
                {courseCode} • Single Attempt • Authoritative Timer Enforcement
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Strict Notice */}
          <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200/60 flex items-start gap-3">
            <ShieldAlert size={20} className="text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900 space-y-1">
              <p className="font-bold">Two-Tier Assessment Invariant</p>
              <p className="leading-relaxed">
                Unlike practice drills, this test is summative and timed. Students have exactly one attempt. When the timer runs out, unsubmitted answers will automatically result in an authoritative zero score.
              </p>
            </div>
          </div>

          {/* Test Title */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Test Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2.5 text-sm rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:border-transparent"
              placeholder="e.g. CSC 204 Midterm CA Test"
            />
          </div>

          {/* Instructions */}
          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Candidate Instructions
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-2.5 text-sm rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:border-transparent"
            />
          </div>

          {/* Duration & Points */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Duration (Minutes) *
              </label>
              <input
                type="number"
                min="5"
                max="180"
                required
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:border-transparent"
              />
              <span className="text-[11px] text-gray-400">Strict countdown per candidate</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Total Score Weight *
              </label>
              <input
                type="number"
                min="1"
                max="100"
                step="0.5"
                required
                value={totalPoints}
                onChange={(e) => setTotalPoints(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:border-transparent"
              />
              <span className="text-[11px] text-gray-400">Recorded into gradebook</span>
            </div>
          </div>

          {/* Test Availability Window */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Window Opens (Optional)
              </label>
              <input
                type="datetime-local"
                value={windowOpenAt}
                onChange={(e) => setWindowOpenAt(e.target.value)}
                className="w-full px-4 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
              />
              <span className="text-[11px] text-gray-400">Immediate if blank</span>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Window Closes (Optional)
              </label>
              <input
                type="datetime-local"
                value={windowCloseAt}
                onChange={(e) => setWindowCloseAt(e.target.value)}
                className="w-full px-4 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
              />
              <span className="text-[11px] text-gray-400">Deadline for all attempts</span>
            </div>
          </div>

          {/* Questions Pool Notice */}
          <div className="p-3 bg-gray-50 rounded-xl text-xs text-gray-600 flex items-center justify-between">
            <span>Questions to be included:</span>
            <span className="font-bold text-[#0a1142]">{totalAvailableQuestions} questions from bank</span>
          </div>

          {/* Auto-Zero Toggle */}
          <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 hover:bg-gray-50/50 cursor-pointer">
            <input
              type="checkbox"
              checked={autoZero}
              onChange={(e) => setAutoZero(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded text-[#0a1142] focus:ring-[#0a1142]"
            />
            <div className="text-xs">
              <span className="font-bold text-gray-800">Auto-Zero Enforcement</span>
              <p className="text-gray-500">
                If the candidate fails to submit before the countdown reaches zero, the background sweeper marks their attempt as expired with a score of 0.00.
              </p>
            </div>
          </label>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isPublishing}
              className="px-4 py-2.5 rounded-xl border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPublishing || totalAvailableQuestions === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all"
            >
              <CheckCircle size={15} />
              <span>{isPublishing ? 'Publishing Test...' : 'Publish Official Test'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default PublishOfficialTestModal;
