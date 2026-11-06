import React, { useEffect, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useExamLock } from '../contexts/ExamLockContext';
import { useQuizAttempt } from '../hooks/useQuizAttempt';
import { useAntiCheat } from '../hooks/useAntiCheat';
import { QuizHeaderTimer } from '../components/quiz/QuizHeaderTimer';
import { QuizQuestionCard } from '../components/quiz/QuizQuestionCard';
import { QuestionNavigationPalette } from '../components/quiz/QuestionNavigationPalette';
import { QuizSubmissionModal } from '../components/quiz/QuizSubmissionModal';
import { QuizFinalizedView } from '../components/quiz/QuizFinalizedView';
import { ProctoringCurtainModal } from '../components/quiz/ProctoringCurtainModal';
import { ErrorAlertCallout } from '../components/ErrorAlertCallout';

/**
 * Quiz Attempt Page Presentation Shell
 *
 * Implements:
 * 1. Pure Dumb Presentation Shell (<180 lines strictly enforced)
 * 2. Formative vs Summative Policy Decoupling (SELF_PRACTICE unproctored vs OFFICIAL_TEST lockdown)
 * 3. Zero-Chrome Physical Viewport Lock (Topbar and Sidebar unmounted in summative)
 * 4. Two-Strike Fullscreen & Anti-Cheat Proctoring Engine
 * 5. URL SearchParams Question Navigation (?q=1..N via { replace: true })
 * 6. Scoped sessionStorage Draft Answers Sandbox (focit_quiz_draft:${studentId}:${attemptId})
 * 7. Canonical Ingress Normalization (/quizzes/:quizId/attempts/:attemptId)
 * 8. Two-Latch Mutex for Expiry Auto-Submit vs Manual Recovery Retries
 * 9. W3C Monotonic Clock with OS Deep-Sleep Server Heartbeat Re-Anchoring
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function QuizAttemptPage() {
  const { courseId, quizId, attemptId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setExamLocked } = useExamLock();
  const studentId = user?.student_id || user?.id || user?.username;

  const [isMobilePaletteOpen, setIsMobilePaletteOpen] = React.useState(false);

  // Defensive Ingress Normalization: resolve attemptId whether arriving via path segment or query param
  const effectiveAttemptId = attemptId || searchParams.get('attemptId');

  // Synchronize to canonical path if accessed via query parameter while preserving question navigation (e.g. ?q=N)
  useEffect(() => {
    if (!attemptId && effectiveAttemptId && courseId && quizId) {
      const remainingParams = new URLSearchParams(searchParams);
      remainingParams.delete('attemptId');
      const searchStr = remainingParams.toString();
      navigate(
        `/courses/${encodeURIComponent(courseId)}/quizzes/${encodeURIComponent(quizId)}/attempts/${encodeURIComponent(effectiveAttemptId)}${searchStr ? `?${searchStr}` : ''}`,
        { replace: true }
      );
    }
  }, [attemptId, effectiveAttemptId, courseId, quizId, navigate, searchParams]);

  const {
    attempt,
    quiz,
    questions,
    isLoading,
    fetchError,
    refetch,
    selectedAnswers,
    handleSelectOption,
    answeredCount,
    syncStatus,
    currentQuestionIndex,
    activeQuestion,
    activeAnswer,
    navigateToQuestion,
    timer,
    showConfirmModal,
    setShowConfirmModal,
    isSubmitting,
    submitError,
    submissionReceipt,
    isFinalized,
    triggerSubmit,
  } = useQuizAttempt({ quizId, attemptId: effectiveAttemptId, studentId });

  // 1. Formative vs. Summative Policy Invariant (Defensive DTO check across camelCase & snake_case contracts)
  const isProctored = Boolean(
    (quiz?.quizType === 'OFFICIAL_TEST' ||
      quiz?.quiz_type === 'OFFICIAL_TEST' ||
      attempt?.quizType === 'OFFICIAL_TEST' ||
      attempt?.quiz_type === 'OFFICIAL_TEST' ||
      quiz?.is_proctored ||
      quiz?.require_lockdown) &&
    !attempt?.isPractice &&
    attempt?.quizType !== 'SELF_PRACTICE' &&
    attempt?.quiz_type !== 'SELF_PRACTICE' &&
    quiz?.quizType !== 'SELF_PRACTICE' &&
    quiz?.quiz_type !== 'SELF_PRACTICE'
  );

  // 2. Physical Viewport Chrome Lockdown Lifecycle
  useEffect(() => {
    const shouldLock = Boolean(
      attempt && attempt.status === 'IN_PROGRESS' && !isFinalized && isProctored
    );
    setExamLocked(shouldLock);
    return () => {
      setExamLocked(false);
    };
  }, [attempt, isFinalized, isProctored, setExamLocked]);

  // 3. Anti-Cheat Soft-Lockdown & Proctoring Hook
  const handleViolationAutoSubmit = useCallback(
    (reason) => {
      triggerSubmit({ submissionMode: reason || 'FULLSCREEN_VIOLATION_AUTO_SUBMIT' });
    },
    [triggerSubmit]
  );

  // Defensive extraction of restored fullscreen exits across DTO shapes and telemetry log (guarded against negative/non-integer)
  const rawRestoredExits = Number(
    attempt?.fullscreenExits ??
    attempt?.fullscreen_exits ??
    (Array.isArray(attempt?.telemetry_log)
      ? attempt.telemetry_log.filter((e) => e && e.type === 'FULLSCREEN_EXIT').length
      : Array.isArray(attempt?.telemetryLog)
      ? attempt.telemetryLog.filter((e) => e && e.type === 'FULLSCREEN_EXIT').length
      : 0)
  );
  const restoredFullscreenExits =
    Number.isFinite(rawRestoredExits) && rawRestoredExits > 0
      ? Math.floor(rawRestoredExits)
      : 0;

  const {
    lockdownState,
    infractionCount,
    fullscreenExits,
    enterFullscreenProctoring,
  } = useAntiCheat({
    quizId,
    attemptId: effectiveAttemptId,
    enabled: Boolean(isProctored && attempt?.status === 'IN_PROGRESS' && !isFinalized),
    initialFullscreenExits: restoredFullscreenExits,
    restoredExits: restoredFullscreenExits,
    isSubmitting,
    onViolationAutoSubmit: handleViolationAutoSubmit,
  });

  if (!studentId) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorAlertCallout error={{ message: 'Authenticated student session required to participate in assessments.' }} />
      </div>
    );
  }

  if (!quizId || !effectiveAttemptId) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorAlertCallout error={{ message: 'Invalid or missing quiz attempt identifier. Please select an active quiz from your course assessments.' }} />
      </div>
    );
  }

  // 4. Loading State
  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] mx-auto" aria-hidden="true" />
        <p className="text-gray-600 dark:text-gray-300 font-medium">Securing authoritative attempt context & clock anchor...</p>
      </div>
    );
  }

  // 5. Unhappy Path Error Boundary (Navigation Chrome Retained, Never Trapped)
  if (fetchError || !attempt) {
    return (
      <div className="max-w-2xl mx-auto p-8 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-2xl text-center space-y-4">
        <AlertCircle size={40} className="text-red-600 dark:text-red-400 mx-auto" aria-hidden="true" />
        <h2 className="text-lg font-bold text-red-900 dark:text-red-200">Quiz Attempt Unavailable</h2>
        <ErrorAlertCallout error={fetchError} onRetry={() => refetch()} />
        <div className="pt-2">
          <Link
            to={courseId ? `/courses/${courseId}` : '/dashboard'}
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold transition-colors"
          >
            Return to Course Assessments
          </Link>
        </div>
      </div>
    );
  }

  // 6. Finalized State View
  if (isFinalized) {
    return (
      <QuizFinalizedView
        courseId={courseId}
        attempt={attempt}
        submissionReceipt={submissionReceipt}
      />
    );
  }

  // 7. Main Examination Workspace
  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      <QuizHeaderTimer
        courseCode={quiz?.courseCode || 'CSC 204'}
        courseId={courseId}
        quizTitle={quiz?.title || 'Quiz Attempt'}
        currentQuestionNumber={activeQuestion?.number || currentQuestionIndex + 1}
        totalQuestions={questions.length}
        answeredCount={answeredCount}
        timer={timer}
        syncStatus={syncStatus}
      />

      {/* Mobile / Tablet Quick-Jump Bar (< lg screens) */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setIsMobilePaletteOpen((prev) => !prev)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-sm text-xs font-bold text-[#0a1142] dark:text-[#ffb81c] active:scale-[0.99] transition-all"
          aria-expanded={isMobilePaletteOpen}
          aria-label="Toggle Question Navigation Palette"
        >
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Question Palette ({answeredCount}/{questions.length} Answered)</span>
          </div>
          <span className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-slate-800 text-[11px] font-semibold text-gray-600 dark:text-slate-300">
            {isMobilePaletteOpen ? 'Hide Grid ▲' : 'Show Grid ▼'}
          </span>
        </button>

        {isMobilePaletteOpen && (
          <div className="mt-3 p-4 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-lg animate-fade-in">
            <QuestionNavigationPalette
              questions={questions}
              currentQuestionIndex={currentQuestionIndex}
              selectedAnswers={selectedAnswers}
              onSelectQuestion={(idx) => {
                navigateToQuestion(idx);
                setIsMobilePaletteOpen(false);
              }}
              onOpenFinishModal={() => {
                setIsMobilePaletteOpen(false);
                setShowConfirmModal(true);
              }}
              isSubmitting={isSubmitting}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        <main className="lg:col-span-3 space-y-6">
          <QuizQuestionCard
            question={activeQuestion}
            activeAnswer={activeAnswer}
            currentQuestionIndex={currentQuestionIndex}
            totalQuestions={questions.length}
            onSelectOption={handleSelectOption}
            onNavigateNext={() => navigateToQuestion(currentQuestionIndex + 1)}
            onNavigatePrev={() => navigateToQuestion(currentQuestionIndex - 1)}
            onOpenFinishModal={() => setShowConfirmModal(true)}
            isSubmitting={isSubmitting}
          />
        </main>

        <div className="hidden lg:block lg:col-span-1">
          <QuestionNavigationPalette
            questions={questions}
            currentQuestionIndex={currentQuestionIndex}
            selectedAnswers={selectedAnswers}
            onSelectQuestion={navigateToQuestion}
            onOpenFinishModal={() => setShowConfirmModal(true)}
            isSubmitting={isSubmitting}
          />
        </div>
      </div>

      <QuizSubmissionModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onSubmit={triggerSubmit}
        isSubmitting={isSubmitting}
        error={submitError}
        answeredCount={answeredCount}
        totalQuestions={questions.length}
      />

      {isProctored && (
        <ProctoringCurtainModal
          lockdownState={lockdownState}
          infractionCount={infractionCount}
          fullscreenExits={fullscreenExits}
          onResumeExam={enterFullscreenProctoring}
        />
      )}
    </div>
  );
}

export default QuizAttemptPage;
