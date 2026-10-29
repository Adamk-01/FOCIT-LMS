import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, HelpCircle, CheckCircle, Share2 } from 'lucide-react';

export function AddQuestionToTestModal({ isOpen, onClose, test, onAddQuestion, isPending }) {
  const allowedFormat = test?.question_format || 'MULTIPLE_CHOICE';
  const initialType = allowedFormat === 'MIXED' ? 'MULTIPLE_CHOICE' : allowedFormat;

  const [questionType, setQuestionType] = useState(initialType);
  const [prompt, setPrompt] = useState('');
  const [points, setPoints] = useState(1);
  const [explanation, setExplanation] = useState('');
  
  // MCQ state
  const [options, setOptions] = useState([
    { id: 'opt_1', text: '' },
    { id: 'opt_2', text: '' },
    { id: 'opt_3', text: '' },
    { id: 'opt_4', text: '' },
  ]);
  const [correctOptionId, setCorrectOptionId] = useState('opt_1');

  // True/False state
  const [tfCorrect, setTfCorrect] = useState('true');

  // Short Answer state
  const [shortAnswerExpected, setShortAnswerExpected] = useState('');

  const resetForm = () => {
    setQuestionType(initialType);
    setPrompt('');
    setPoints(1);
    setExplanation('');
    setOptions([
      { id: 'opt_1', text: '' },
      { id: 'opt_2', text: '' },
      { id: 'opt_3', text: '' },
      { id: 'opt_4', text: '' },
    ]);
    setCorrectOptionId('opt_1');
    setTfCorrect('true');
    setShortAnswerExpected('');
  };

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, test?.quiz_id]);

  if (!isOpen || !test) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    let payload = {
      prompt: prompt.trim(),
      type: questionType,
      points: Number(points) || 1,
      explanation: explanation.trim() || undefined,
    };

    if (questionType === 'MULTIPLE_CHOICE') {
      const validOptions = options.map((opt, i) => ({
        id: opt.id || `opt_${i + 1}`,
        text: opt.text.trim(),
      }));
      if (validOptions.some((o) => !o.text)) return;
      payload.options = validOptions;
      payload.correctOptionId = correctOptionId;
    } else if (questionType === 'TRUE_FALSE') {
      payload.correctOptionId = tfCorrect;
    } else if (questionType === 'SHORT_ANSWER') {
      if (!shortAnswerExpected.trim()) return;
      payload.correctOptionId = shortAnswerExpected.trim();
      payload.options = [{ id: 'opt_answer', text: shortAnswerExpected.trim() }];
    }

    onAddQuestion(payload);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-[#0a1142] text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/10 rounded-xl">
              <Plus className="w-5 h-5 text-indigo-300" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Add Question to Test</h2>
              <p className="text-xs text-indigo-200">Target Test: {test.title}</p>
            </div>
          </div>
          <button onClick={onClose} type="button" className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto text-sm">
          {allowedFormat === 'MIXED' && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Question Type</label>
              <select
                value={questionType}
                onChange={(e) => setQuestionType(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs bg-white"
              >
                <option value="MULTIPLE_CHOICE">Multiple Choice (MCQ)</option>
                <option value="TRUE_FALSE">True / False</option>
                <option value="SHORT_ANSWER">Short Answer</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Question Prompt *</label>
            <textarea
              rows={3}
              required
              placeholder="Enter your question here..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-gray-200 focus:border-[#0a1142] text-xs outline-none"
            />
          </div>

          {/* Type Specific Inputs */}
          {questionType === 'MULTIPLE_CHOICE' && (
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-gray-700 uppercase">Options (Select Correct)</label>
              {options.map((opt, idx) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mcqCorrect"
                    checked={correctOptionId === opt.id}
                    onChange={() => setCorrectOptionId(opt.id)}
                    className="accent-emerald-600 w-4 h-4"
                  />
                  <input
                    type="text"
                    required
                    placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                    value={opt.text}
                    onChange={(e) => {
                      const next = [...options];
                      next[idx].text = e.target.value;
                      setOptions(next);
                    }}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-[#0a1142]"
                  />
                </div>
              ))}
            </div>
          )}

          {questionType === 'TRUE_FALSE' && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-2">Correct Answer</label>
              <div className="flex gap-4">
                {['true', 'false'].map((val) => (
                  <label key={val} className="flex items-center gap-2 cursor-pointer text-xs font-medium capitalize">
                    <input
                      type="radio"
                      name="tfCorrect"
                      checked={tfCorrect === val}
                      onChange={() => setTfCorrect(val)}
                      className="accent-[#0a1142] w-4 h-4"
                    />
                    {val}
                  </label>
                ))}
              </div>
            </div>
          )}

          {questionType === 'SHORT_ANSWER' && (
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Expected Answer *</label>
              <input
                type="text"
                required
                placeholder="Exact expected keyword or short sentence"
                value={shortAnswerExpected}
                onChange={(e) => setShortAnswerExpected(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none focus:border-[#0a1142]"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Points / Weight</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Explanation (Optional)</label>
              <input
                type="text"
                placeholder="Rationale shown on review"
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-xs outline-none"
              />
            </div>
          </div>

          {test.sync_to_moodle && (
            <div className="p-2.5 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center gap-2 text-[11px] text-indigo-700">
              <Share2 className="w-3.5 h-3.5 shrink-0" />
              <span>Question will be automatically recreated in Moodle server.</span>
            </div>
          )}

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !prompt.trim()}
              className="px-5 py-2.5 text-xs font-bold text-white bg-[#0a1142] hover:bg-indigo-900 rounded-xl transition-all shadow-md shadow-indigo-900/10"
            >
              {isPending ? 'Saving...' : 'Add Question'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
