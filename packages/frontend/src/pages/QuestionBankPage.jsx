import React, { useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  ChevronRight, 
  Plus, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  ShieldCheck, 
  HelpCircle, 
  FileText, 
  Layers, 
} from 'lucide-react';
import { apiClient } from '../lib/api';

const QUESTION_TYPES = [
  { id: 'ALL', label: 'All Types' },
  { id: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
  { id: 'TRUE_FALSE', label: 'True / False' },
  { id: 'SHORT_ANSWER', label: 'Short Answer' },
];

export const QuestionBankPage = () => {
  const { courseId = 'CSC204' } = useParams();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedTypeFilter = searchParams.get('type') || 'ALL';

  const handleFilterChange = (typeId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (typeId === 'ALL') next.delete('type');
      else next.set('type', typeId);
      return next;
    });
  };

  // 1. Fetch Question Bank Context & Active Revision
  const { 
    data: bankData, 
    isLoading, 
    error, 
    refetch 
  } = useQuery({
    queryKey: ['question-bank', courseId],
    queryFn: async () => {
      const res = await apiClient.get(`/courses/${courseId}/question-bank`);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const activeQuiz = bankData?.activeQuiz;
  const questions = bankData?.questions || [];
  const metrics = bankData?.metrics || { total: 0, mcq: 0, trueFalse: 0, shortAnswer: 0 };
  const courseCode = bankData?.courseCode || 'CSC 204';
  const courseTitle = bankData?.courseTitle || 'Data Structures and Algorithms';

  // Filter questions by type
  const filteredQuestions = questions.filter((q) => {
    if (selectedTypeFilter === 'ALL') return true;
    return q.type === selectedTypeFilter;
  });

  // 2. Manual Question Authoring State (Form)
  const [showAuthoringCard, setShowAuthoringCard] = useState(false);
  const [formType, setFormType] = useState('MULTIPLE_CHOICE');
  const [formPrompt, setFormPrompt] = useState('');
  const [formPoints, setFormPoints] = useState(1.0);
  const [formCorrectOption, setFormCorrectOption] = useState('opt_a');
  const [formOptions, setFormOptions] = useState([
    { id: 'opt_a', text: '' },
    { id: 'opt_b', text: '' },
    { id: 'opt_c', text: '' },
    { id: 'opt_d', text: '' },
  ]);

  const handleOptionChange = (optId, text) => {
    setFormOptions((prev) =>
      prev.map((opt) => (opt.id === optId ? { ...opt, text } : opt))
    );
  };

  // Mutation to Add Question
  const addQuestionMutation = useMutation({
    mutationFn: async () => {
      if (!activeQuiz?.id) throw new Error('No active assessment bank resolved');

      const res = await apiClient.post(`/courses/${courseId}/question-bank/questions`, {
        quizId: activeQuiz.id,
        questionNumber: questions.length + 1,
        type: formType,
        prompt: formPrompt,
        options: formOptions,
        correctOptionId: formCorrectOption,
        points: formPoints,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['question-bank', courseId] });
      setFormPrompt('');
      setFormOptions([
        { id: 'opt_a', text: '' },
        { id: 'opt_b', text: '' },
        { id: 'opt_c', text: '' },
        { id: 'opt_d', text: '' },
      ]);
      setShowAuthoringCard(false);
    },
  });

  // Mutation to Publish Atomic Pointer Swap
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!activeQuiz?.id) throw new Error('No active quiz to publish');
      const res = await apiClient.post(`/courses/${courseId}/question-bank/publish`, {
        targetQuizId: activeQuiz.id,
        expectedPreviousQuizId: activeQuiz.id,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['question-bank', courseId] });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] mx-auto" />
        <p className="text-gray-600 font-medium">Securing Question Bank schema and active revisions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-8 bg-red-50 border border-red-200 rounded-2xl text-center space-y-4">
        <AlertCircle size={40} className="text-red-600 mx-auto" />
        <h2 className="text-lg font-bold text-red-900">Question Bank Unavailable</h2>
        <p className="text-sm text-red-700">
          {error?.response?.data?.error || 'A network error occurred while loading the assessment question bank.'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="px-5 py-2.5 bg-[#0a1142] text-white rounded-xl text-xs font-bold"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* 1. Dynamic Breadcrumbs (Screen 5 in ui_template.jpeg) */}
      <nav aria-label="Breadcrumb Navigation" className="text-xs font-semibold text-gray-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">
              Dashboard
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" />
          <li>
            <Link to={`/courses/${courseId}`} className="hover:text-[#0a1142] transition-colors">
              {courseCode}
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" />
          <li className="text-[#0a1142] font-bold" aria-current="page">
            Question Bank
          </li>
        </ol>
      </nav>

      {/* 2. Top Header & Revision Management Banner */}
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
            disabled={publishMutation.isPending || !activeQuiz?.id}
            onClick={() => publishMutation.mutate()}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all"
          >
            <ShieldCheck size={16} className="text-white" />
            <span>{publishMutation.isPending ? 'Publishing...' : 'Publish Revision'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAuthoringCard((prev) => !prev)}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition-all"
          >
            <Plus size={16} className="text-[#ffb81c]" />
            <span>{showAuthoringCard ? 'Close Question Form' : 'Add Question'}</span>
          </button>
        </div>
      </header>

      {/* 3. Metrics Summary Cards (Screen 5 in template) */}
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

      {/* 4. Manual Question Authoring Card (Screen 5 in ui_template.jpeg) */}
      {showAuthoringCard && (
        <section 
          aria-label="Create Question Form"
          className="bg-white rounded-2xl p-6 sm:p-8 border-2 border-[#0a1142]/20 shadow-xl space-y-6 animate-in slide-in-from-top-4 duration-300"
        >
          <div className="flex items-center justify-between border-b border-gray-100 pb-4">
            <div className="space-y-0.5">
              <h2 className="text-lg font-bold text-[#0a1142] font-display">
                Manual Question Creator
              </h2>
              <p className="text-xs text-gray-500">
                Author new assessment questions. Correct options are bound and enforced at the database engine level.
              </p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-[#0a1142]">
              Question #{questions.length + 1}
            </span>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              addQuestionMutation.mutate();
            }}
            className="space-y-5"
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Question Type
                </label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
                >
                  <option value="MULTIPLE_CHOICE">Multiple Choice</option>
                  <option value="TRUE_FALSE">True / False</option>
                  <option value="SHORT_ANSWER">Short Answer</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Points Allocation
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="10"
                  value={formPoints}
                  onChange={(e) => setFormPoints(Number(e.target.value))}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Target Revision
                </label>
                <input
                  type="text"
                  disabled
                  value={`Version ${activeQuiz?.version || 1} (Live)`}
                  className="w-full px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-xl text-xs sm:text-sm font-bold text-gray-500 cursor-not-allowed"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Question Prompt Text
              </label>
              <textarea
                required
                rows={3}
                placeholder="Enter the examination prompt (e.g. In a Min-Heap with N elements, what is the asymptotic runtime to extract min?)..."
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0a1142] resize-none"
              />
            </div>

            {/* Dynamic Option Authoring with Radial Correct Answer Binder */}
            <div className="space-y-3 pt-2">
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                Options & Correct Answer Selection (Radial Selector Binds Key)
              </label>

              <div className="space-y-2.5">
                {formOptions.map((opt) => (
                  <div 
                    key={opt.id}
                    className={`
                      flex items-center gap-3 p-3 rounded-xl border-2 transition-all
                      ${formCorrectOption === opt.id 
                        ? 'border-emerald-500 bg-emerald-50/40 shadow-sm' 
                        : 'border-gray-200 bg-gray-50/50'}
                    `}
                  >
                    <input
                      type="radio"
                      name="correct_option_selector"
                      id={`radio_${opt.id}`}
                      checked={formCorrectOption === opt.id}
                      onChange={() => setFormCorrectOption(opt.id)}
                      className="w-4 h-4 text-emerald-600 focus:ring-emerald-500"
                    />
                    <label htmlFor={`radio_${opt.id}`} className="text-xs font-extrabold uppercase text-[#0a1142] w-6 shrink-0 cursor-pointer">
                      {opt.id.replace('opt_', '')}.
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={`Enter text for option ${opt.id.replace('opt_', '').toUpperCase()}...`}
                      value={opt.text}
                      onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                      className="flex-1 bg-white border border-gray-200 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
                    />
                    {formCorrectOption === opt.id && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-extrabold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full shrink-0">
                        <CheckCircle2 size={11} /> Correct Answer
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {addQuestionMutation.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                {addQuestionMutation.error?.response?.data?.error || 'Database engine constraint rejected question payload.'}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowAuthoringCard(false)}
                className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-xs font-bold hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addQuestionMutation.isPending || !formPrompt.trim()}
                className="px-6 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition-all flex items-center gap-2"
              >
                {addQuestionMutation.isPending ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Enforcing Constraint...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} className="text-[#ffb81c]" />
                    <span>Save Question to Bank</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* 5. Filter Chips & Search Bar (Screen 5 in ui_template.jpeg) */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
          {QUESTION_TYPES.map((type) => {
            const isSelected = selectedTypeFilter === type.id;
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => handleFilterChange(type.id)}
                className={`
                  px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all border
                  ${isSelected 
                    ? 'bg-[#0a1142] text-white border-[#0a1142] shadow-sm' 
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}
                `}
              >
                {type.label}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-gray-500 font-medium">
          Displaying <span className="font-bold text-[#0a1142]">{filteredQuestions.length}</span> of {questions.length} questions
        </div>
      </div>

      {/* 6. Questions Inventory Table (Screen 5 in ui_template.jpeg) */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#0a1142] font-display">
            Question Bank Inventory
          </h2>
          <span className="text-xs text-gray-500 font-medium">
            Enforced by PostgreSQL Immutability Trigger
          </span>
        </div>

        {filteredQuestions.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <HelpCircle size={36} className="text-gray-300 mx-auto" />
            <p className="text-sm font-semibold text-gray-700">No questions match this filter</p>
            <p className="text-xs text-gray-500">Add a new question or change your filter category above.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredQuestions.map((q) => (
              <article key={q.id} className="p-6 hover:bg-gray-50/70 transition-all space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-7 rounded-lg bg-[#0a1142] text-[#ffb81c] text-xs font-extrabold flex items-center justify-center">
                      {q.number}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-[#0a1142] border border-blue-200">
                      {q.type.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-500 font-semibold">
                      {q.points.toFixed(2)} Points
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 font-mono">ID: {q.id}</span>
                  </div>
                </div>

                <p className="text-sm sm:text-base font-bold text-gray-900 leading-relaxed font-sans">
                  {q.prompt}
                </p>

                {/* Options Breakdown with Correct Answer Highlight */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {q.options?.map((opt) => {
                    const isCorrect = q.correctOptionId === opt.id;
                    return (
                      <div
                        key={opt.id}
                        className={`
                          p-2.5 rounded-xl text-xs flex items-center justify-between gap-2 border
                          ${isCorrect 
                            ? 'bg-emerald-50/80 border-emerald-300 font-bold text-emerald-900' 
                            : 'bg-gray-50 border-gray-100 text-gray-700'}
                        `}
                      >
                        <span className="truncate">
                          <strong className="mr-1.5 uppercase text-[#0a1142]">{opt.id.replace('opt_', '')}.</strong>
                          {opt.text}
                        </span>
                        {isCorrect && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-emerald-700 bg-emerald-200/60 px-2 py-0.5 rounded-full shrink-0">
                            <CheckCircle2 size={10} /> Correct
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
