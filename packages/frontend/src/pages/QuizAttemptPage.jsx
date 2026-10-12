import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { 
  Clock, 
  ChevronLeft, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  ShieldCheck, 
  Send, 
  ArrowLeft
} from 'lucide-react';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export const QuizAttemptPage = () => {
  const { courseId = 'CSC204', quizId = 'quiz_csc204_1', attemptId = 'att_csc204_john' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const studentId = user?.username || 'student1';

  // 1. Fetch Authoritative Quiz Attempt & Skew Context
  const { 
    data: attemptData, 
    isLoading, 
    error: fetchError,
    refetch 
  } = useQuery({
    queryKey: ['quiz-attempt', quizId, attemptId],
    queryFn: async () => {
      const clientSend = Date.now();
      const res = await apiClient.get(`/quizzes/${quizId}/attempts/${attemptId}`);
      const clientReceive = Date.now();
      return {
        ...res.data,
        _telemetry: {
          clientSend,
          clientReceive,
          rtt: clientReceive - clientSend,
        }
      };
    },
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const attempt = attemptData?.attempt;
  const quiz = attemptData?.quiz;
  const questions = attemptData?.questions || [];
  const serverInitialAnswers = attemptData?.answers || {};

  // Local Storage Sandbox Key for Resilient Disconnect State
  const storageKey = useMemo(() => `focit_quiz_draft:${studentId}:${attemptId}`, [studentId, attemptId]);

  // Active Question Pointer (Screen 4: 1-indexed for student display)
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Selected Answers State (Synchronously backed by localStorage)
  const [selectedAnswers, setSelectedAnswers] = useState(() => {
    try {
      const cached = localStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.answers || {};
      }
    } catch {
      // ignore JSON parse error
    }
    return {};
  });

  // Reconcile server answers once loaded
  useEffect(() => {
    if (Object.keys(serverInitialAnswers).length > 0) {
      setSelectedAnswers((prev) => {
        const merged = { ...prev };
        for (const [qId, ans] of Object.entries(serverInitialAnswers)) {
          if (!merged[qId]) {
            merged[qId] = { optionId: ans.optionId, synced: true, updatedAt: ans.updatedAt };
          }
        }
        return merged;
      });
    }
  }, [serverInitialAnswers]);

  // 2. Monotonic Countdown Clock Anchor (Cristian's Algorithm + performance.now())
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState(null);
  const isTimeExpired = timeRemainingSeconds !== null && timeRemainingSeconds <= 0;

  useEffect(() => {
    if (!attempt?.dueAt || !attempt?.serverNow || !attemptData?._telemetry) return;

    // Cristian's Skew Offset Calculation: serverNow + (rtt / 2)
    const { rtt } = attemptData._telemetry;
    const serverNowMs = new Date(attempt.serverNow).getTime();
    const estimatedServerNowAtReceive = serverNowMs + (rtt / 2);
    const initialPerfNow = performance.now();
    const dueAtMs = new Date(attempt.dueAt).getTime();

    const intervalId = setInterval(() => {
      // Monotonic projection: serverNow + delta(performance.now)
      const elapsedSinceReceive = performance.now() - initialPerfNow;
      const currentProjectedServerMs = estimatedServerNowAtReceive + elapsedSinceReceive;
      const diffSeconds = Math.max(0, Math.floor((dueAtMs - currentProjectedServerMs) / 1000));

      setTimeRemainingSeconds(diffSeconds);

      if (diffSeconds <= 0) {
        clearInterval(intervalId);
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [attempt?.dueAt, attempt?.serverNow, attemptData?._telemetry]);

  // Formatted Timer String: HH:MM:SS (Screen 4 in ui_template: "00:42:17")
  const formattedTimer = useMemo(() => {
    if (timeRemainingSeconds === null) return '45:00';
    const hours = Math.floor(timeRemainingSeconds / 3600);
    const minutes = Math.floor((timeRemainingSeconds % 3600) / 60);
    const seconds = timeRemainingSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }, [timeRemainingSeconds]);

  // 3. Online/Offline & Auto-Save Sync Engine
  const [syncStatus, setSyncStatus] = useState('SYNCED'); // 'SYNCED' | 'SAVING' | 'OFFLINE'
  const autoSaveTimeoutRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Flush answers to BFF
  const flushPendingAnswers = useCallback(async () => {
    if (!navigator.onLine) {
      setSyncStatus('OFFLINE');
      return;
    }

    try {
      const cached = localStorage.getItem(storageKey);
      if (!cached) return;
      const { answers = {} } = JSON.parse(cached);
      const unsyncedEntries = Object.entries(answers).filter(([, a]) => !a.synced);
      if (unsyncedEntries.length === 0) {
        setSyncStatus('SYNCED');
        return;
      }

      setSyncStatus('SAVING');
      const payload = unsyncedEntries.map(([qId, val]) => ({
        questionId: qId,
        optionId: val.optionId,
      }));

      abortControllerRef.current = new AbortController();
      await apiClient.post(
        `/quizzes/${quizId}/attempts/${attemptId}/save`,
        { answers: payload },
        { signal: abortControllerRef.current.signal }
      );

      // Mark synced in memory & localStorage
      setSelectedAnswers((prev) => {
        const next = { ...prev };
        for (const [qId] of unsyncedEntries) {
          if (next[qId]) next[qId] = { ...next[qId], synced: true };
        }
        localStorage.setItem(storageKey, JSON.stringify({ answers: next }));
        return next;
      });

      setSyncStatus('SYNCED');
    } catch (err) {
      if (err?.name !== 'CanceledError') {
        setSyncStatus('OFFLINE');
      }
    }
  }, [storageKey, quizId, attemptId]);

  // Monitor network status
  useEffect(() => {
    const handleOnline = () => {
      flushPendingAnswers();
    };
    const handleOffline = () => {
      setSyncStatus('OFFLINE');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushPendingAnswers]);

  // Option selection handler: Synchronous commit to localStorage + debounced sync
  const handleSelectOption = (questionId, optionId) => {
    if (attempt?.status === 'SUBMITTED' || isSubmitting) return;

    const nextAnswers = {
      ...selectedAnswers,
      [questionId]: {
        optionId,
        synced: false,
        updatedAt: Date.now(),
      },
    };

    setSelectedAnswers(nextAnswers);

    // Synchronous Commit to Local Sandbox Before Any Network Dispatch
    try {
      localStorage.setItem(storageKey, JSON.stringify({ answers: nextAnswers }));
    } catch {
      // storage quota safe
    }

    // Debounced Auto-Save Dispatch
    if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
    setSyncStatus('SAVING');
    autoSaveTimeoutRef.current = setTimeout(() => {
      flushPendingAnswers();
    }, 600);
  };

  // 4. Submission Mutex & FSM Transition
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submissionReceipt, setSubmissionReceipt] = useState(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Abort any pending background auto-save to eliminate race conditions
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const answersArray = Object.entries(selectedAnswers).map(([qId, val]) => ({
        questionId: qId,
        optionId: val.optionId,
      }));

      const res = await apiClient.post(
        `/quizzes/${quizId}/attempts/${attemptId}/submit`,
        { answers: answersArray },
        {
          headers: {
            'Idempotency-Key': `quiz_sub_${attemptId}_v1`,
          },
        }
      );
      return res.data;
    },
    onSuccess: (data) => {
      setSubmissionReceipt(data);
      setShowConfirmModal(false);
      try {
        localStorage.removeItem(storageKey);
      } catch {}
    },
  });

  const isSubmitting = submitMutation.isPending;
  const isFinalized = attempt?.status === 'SUBMITTED' || Boolean(submissionReceipt);

  const activeQuestion = questions[currentQuestionIndex] || questions[0];
  const activeAnswer = activeQuestion ? selectedAnswers[activeQuestion.id]?.optionId : null;

  const answeredCount = useMemo(() => {
    return Object.keys(selectedAnswers).length;
  }, [selectedAnswers]);

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] mx-auto" />
        <p className="text-gray-600 font-medium">Securing authoritative attempt context & clock anchor...</p>
      </div>
    );
  }

  if (fetchError || !attempt) {
    return (
      <div className="max-w-2xl mx-auto p-8 bg-red-50 border border-red-200 rounded-2xl text-center space-y-4">
        <AlertCircle size={40} className="text-red-600 mx-auto" />
        <h2 className="text-lg font-bold text-red-900">Quiz Attempt Unavailable</h2>
        <p className="text-sm text-red-700">
          {fetchError?.response?.data?.error || 'Could not load quiz attempt. Verify your enrollment or connection.'}
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

  // 5. Finalized State View (If already submitted)
  if (isFinalized) {
    const finalScore = submissionReceipt?.score ?? attempt.score ?? 0;
    const finalTotal = submissionReceipt?.totalPoints ?? attempt.totalPoints ?? 10;
    const percent = Math.round((finalScore / finalTotal) * 100);

    return (
      <div className="max-w-3xl mx-auto py-12 px-4 space-y-8">
        <header className="bg-white rounded-2xl p-8 border border-gray-200 shadow-card text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
            <CheckCircle2 size={36} />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0a1142] font-display">
            Assessment Attempt Submitted
          </h1>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            Your answers have been cryptographically committed to the FOCIT academic ledger and synchronized with Headless Moodle.
          </p>

          <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto py-6 border-y border-gray-100">
            <div>
              <p className="text-xs text-gray-500 font-medium">Final Score</p>
              <p className="text-xl font-extrabold text-[#0a1142] mt-1">{finalScore} / {finalTotal}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Percentage</p>
              <p className="text-xl font-extrabold text-emerald-600 mt-1">{percent}%</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Status</p>
              <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                GRADED
              </span>
            </div>
          </div>

          <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to={`/courses/${courseId}`}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-sm font-bold shadow-md transition-all flex items-center justify-center gap-2"
            >
              <ArrowLeft size={16} />
              <span>Return to Course Overview</span>
            </Link>
            <Link
              to={`/courses/${courseId}/grades`}
              className="w-full sm:w-auto px-6 py-3 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-bold transition-all flex items-center justify-center gap-2"
            >
              <Award size={16} />
              <span>View in Gradebook</span>
            </Link>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* 1. Dynamic Breadcrumbs (Matching Screen 4) */}
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
              {quiz?.courseCode || 'CSC 204'}
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" />
          <li className="text-[#0a1142] font-bold" aria-current="page">
            {quiz?.title || 'Quiz 1'}
          </li>
        </ol>
      </nav>

      {/* 2. Top Banner Header (Screen 4: Course Code & Authoritative Clock Badge) */}
      <header className="bg-gradient-to-r from-[#0a1142] via-[#0d1656] to-[#0a1142] rounded-2xl p-6 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-white/10">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#ffb81c]/20 text-[#ffb81c] border border-[#ffb81c]/30">
            <span>OFFICIAL EXAMINATION</span>
            <span>•</span>
            <span>45 MINUTES</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display text-white">
            {quiz?.courseCode || 'CSC 204'}: {quiz?.title || 'Data Structures and Algorithms'}
          </h1>
          <p className="text-xs text-gray-300">
            Question {currentQuestionIndex + 1} of {questions.length} • {answeredCount} Answered
          </p>
        </div>

        {/* The Monotonic Countdown Timer Badge (Screen 4 in ui_template: "Time left: 00:42:17") */}
        <div className="flex items-center gap-3">
          <div className={`
            px-4 py-2 rounded-xl flex items-center gap-2.5 font-mono text-sm sm:text-base font-extrabold tracking-wider border shadow-inner transition-all
            ${timeRemainingSeconds !== null && timeRemainingSeconds < 300 
              ? 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse' 
              : 'bg-white/10 text-[#ffb81c] border-white/20'}
          `}>
            <Clock size={18} className={timeRemainingSeconds !== null && timeRemainingSeconds < 300 ? 'text-red-400' : 'text-[#ffb81c]'} />
            <span>Time left: {formattedTimer}</span>
          </div>

          {/* Sync Engine Status Pill */}
          <div className="hidden sm:flex items-center">
            {syncStatus === 'SYNCED' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 size={12} /> All Saved
              </span>
            )}
            {syncStatus === 'SAVING' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                <RefreshCw size={12} className="animate-spin" /> Syncing...
              </span>
            )}
            {syncStatus === 'OFFLINE' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                <WifiOff size={12} /> Saved Locally (Offline)
              </span>
            )}
          </div>
        </div>
      </header>

      {/* 3. Main Two-Column Quiz Attempt Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Left Column (3/4): The Active Question Box */}
        <main className="lg:col-span-3 space-y-6">
          <article className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-card space-y-6">
            {/* Question Header Meta */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-gray-100 text-gray-800 text-xs font-bold">
                <span>Question {activeQuestion?.number || currentQuestionIndex + 1}</span>
                <span>of</span>
                <span>{questions.length}</span>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500 font-medium">
                <span>Marked out of {Number(activeQuestion?.points || 1).toFixed(2)}</span>
                <span>•</span>
                <span className={activeAnswer ? 'text-emerald-600 font-bold' : 'text-gray-400'}>
                  {activeAnswer ? 'Answered' : 'Not yet answered'}
                </span>
              </div>
            </div>

            {/* Prompt Text (Screen 4 in template) */}
            <div className="text-base sm:text-lg font-medium text-gray-900 leading-relaxed font-sans">
              {activeQuestion?.prompt}
            </div>

            {/* Options List with Geometric CLS & Touch Constraints */}
            <div className="space-y-3 pt-2" role="radiogroup" aria-label={`Question ${activeQuestion?.number} Options`}>
              {activeQuestion?.options?.map((option) => {
                const isSelected = activeAnswer === option.id;

                return (
                  <label
                    key={option.id}
                    className={`
                      w-full min-h-[56px] box-border p-4 rounded-xl border-2 flex items-center gap-4 cursor-pointer select-none transition-all
                      touch-manipulation
                      ${isSelected 
                        ? 'border-[#0a1142] bg-blue-50/50 shadow-sm' 
                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'}
                    `}
                  >
                    <input
                      type="radio"
                      name={`question_${activeQuestion.id}`}
                      value={option.id}
                      checked={isSelected}
                      onChange={() => handleSelectOption(activeQuestion.id, option.id)}
                      className="w-4 h-4 text-[#0a1142] focus:ring-[#0a1142] border-gray-300"
                    />
                    <div className="flex-1 text-sm sm:text-base font-medium text-gray-800">
                      <span className="font-bold mr-2 uppercase text-[#0a1142]">{option.id.replace('opt_', '')}.</span>
                      {option.text}
                    </div>
                  </label>
                );
              })}
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between border-t border-gray-100 pt-6">
              <button
                type="button"
                onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
                disabled={currentQuestionIndex === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 text-xs font-bold hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <ChevronLeft size={16} />
                <span>Previous</span>
              </button>

              {currentQuestionIndex < questions.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setCurrentQuestionIndex((prev) => Math.min(questions.length - 1, prev + 1))}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-sm transition-all"
                >
                  <span>Next Question</span>
                  <ChevronRight size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(true)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition-all"
                >
                  <span>Finish Attempt...</span>
                  <Send size={14} />
                </button>
              )}
            </div>
          </article>
        </main>

        {/* Right Sidebar (1/4): Quiz Navigation Grid (Screen 4 in template) */}
        <aside className="space-y-6">
          <section className="bg-white rounded-2xl p-6 border border-gray-200 shadow-card space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h2 className="text-sm font-bold text-[#0a1142] font-display">
                Quiz Navigation
              </h2>
              <span className="text-xs text-gray-500 font-semibold">
                {answeredCount}/{questions.length} Answered
              </span>
            </div>

            {/* 10-Question Square Navigation Grid */}
            <div className="grid grid-cols-5 gap-2.5">
              {questions.map((q, idx) => {
                const isCurrent = idx === currentQuestionIndex;
                const hasAnswered = Boolean(selectedAnswers[q.id]?.optionId);

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentQuestionIndex(idx)}
                    aria-label={`Go to Question ${idx + 1}`}
                    className={`
                      aspect-square rounded-xl text-xs font-extrabold flex items-center justify-center transition-all relative
                      ${isCurrent ? 'ring-2 ring-offset-2 ring-[#0a1142]' : ''}
                      ${hasAnswered 
                        ? 'bg-[#0a1142] text-white shadow-sm' 
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
                    `}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Navigation Summary Info */}
            <div className="p-3 bg-gray-50 rounded-xl space-y-1 text-xs text-gray-600">
              <div className="flex items-center justify-between">
                <span>Completed:</span>
                <span className="font-bold text-[#0a1142]">{Math.round((answeredCount / questions.length) * 100)}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden mt-1">
                <div 
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${(answeredCount / questions.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Finish Attempt Trigger Button */}
            <button
              type="button"
              onClick={() => setShowConfirmModal(true)}
              className="w-full py-3 px-4 rounded-xl bg-gray-100 hover:bg-[#0a1142] text-gray-800 hover:text-white text-xs font-bold transition-all border border-gray-200"
            >
              Finish attempt...
            </button>
          </section>
        </aside>
      </div>

      {/* 4. Submission Confirmation Modal (Screen 4 Mutation Lock & Safety Net) */}
      {showConfirmModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-modal-title"
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-gray-200">
            <div className="space-y-2">
              <h3 id="submit-modal-title" className="text-xl font-bold text-[#0a1142] font-display">
                Confirm Quiz Submission
              </h3>
              <p className="text-xs text-gray-600 leading-relaxed">
                Once you submit, your answers will be committed permanently to the academic records ledger and you cannot change them.
              </p>
            </div>

            {/* Submission Checklist */}
            <div className="p-4 bg-gray-50 rounded-xl space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-gray-700">
                <span>Questions Answered:</span>
                <span className="text-[#0a1142] font-bold">{answeredCount} of {questions.length}</span>
              </div>
              {answeredCount < questions.length && (
                <p className="text-amber-700 text-[11px] font-medium pt-1">
                  ⚠️ You have {questions.length - answeredCount} unanswered questions remaining.
                </p>
              )}
            </div>

            {submitMutation.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                {submitMutation.error?.response?.data?.error || 'Submission failed. Please verify connection and retry.'}
              </div>
            )}

            {/* Modal Actions with Hardware Mutation Lock */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                disabled={isSubmitting}
                className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-xs font-bold hover:bg-gray-50 disabled:opacity-50"
              >
                Return to Attempt
              </button>

              <button
                type="button"
                onClick={() => submitMutation.mutate()}
                disabled={isSubmitting}
                className={`
                  px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition-all flex items-center gap-2
                  ${isSubmitting ? 'opacity-70 cursor-not-allowed pointer-events-none' : ''}
                `}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Committing to Ledger...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} />
                    <span>Confirm & Submit</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
