import React, { useEffect } from 'react';
import { useParams, useSearchParams, Navigate } from 'react-router-dom';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useExamLock } from '../contexts/ExamLockContext';
import { useQuizAttempt } from '../hooks/useQuizAttempt';
import { QuizHeaderTimer } from '../components/quiz/QuizHeaderTimer';
import { QuizQuestionCard } from '../components/quiz/QuizQuestionCard';
import { QuestionNavigationPalette } from '../components/quiz/QuestionNavigationPalette';
import { QuizSubmissionModal } from '../components/quiz/QuizSubmissionModal';
import { QuizFinalizedView } from '../components/quiz/QuizFinalizedView';
import { ErrorAlertCallout } from '../components/ErrorAlertCallout';
import { useAntiCheat } from '../hooks/useAntiCheat';
import { ProctoringCurtainModal } from '../components/quiz/ProctoringCurtainModal';

/**
 * Quiz Attempt Page Presentation Shell
 *
 * Implements:
 * 1. Pure Dumb Presentation Shell (<180 lines strictly enforced)
 * 2. URL SearchParams Question Navigation (?q=1..N via { replace: true })
 * 3. Scoped sessionStorage Draft Answers Sandbox (focit_quiz_draft:${studentId}:${attemptId})
 * 4. Two-Latch Mutex for Expiry Auto-Submit vs Manual Recovery Retries
 * 5. Native HTML Top Layer <dialog> Modal with In-Flight Mutation Lock
 * 6. W3C Monotonic Clock with OS Deep-Sleep Server Heartbeat Re-Anchoring
 * 7. Milestone 10.1: Anti-Cheat Soft-Lockdown & Telemetry Proctoring Curtain
 * 8. Zero-Trust Navigation Lockdown via ExamLockContext
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function QuizAttemptPage() {
  const { courseId = 'CSC204', quizId, attemptId: paramAttemptId } = useParams();
  const [searchParams] = useSearchParams();
  const attemptId = paramAttemptId || searchParams.get('attemptId') || null;
  const { user } = useAuth();
  const studentId = user?.username || user?.id || 'student1';
  const { setExamLocked } = useExamLock();

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
  } = useQuizAttempt({ quizId, attemptId, studentId });

  // Milestone 10.1: Anti-Cheat Soft-Lockdown & Telemetry Proctoring Hook
  const {
    lockdownState,
    infractionCount,
    fullscreenExits,
    enterFullscreenProctoring,
  } = useAntiCheat({
    quizId,
    attemptId,
    enabled: !isFinalized && !isLoading && !fetchError && !isSubmitting && Boolean(attempt),
    isSubmitting,
    onViolationAutoSubmit: (mode) => triggerSubmit(mode),
  });

  // Zero-Trust Navigation Lock during active assessment
  useEffect(() => {
    const isLocked = !isFinalized && !isLoading && !fetchError && Boolean(attempt);
    setExamLocked(isLocked);
    return () => {
      setExamLocked(false);
    };
  }, [isFinalized, isLoading, fetchError, attempt, setExamLocked]);

  // If directly navigating without a quiz ID, redirect back to course quizzes tab
  if (!quizId) {
    return <Navigate to={`/courses/${encodeURIComponent(courseId)}?tab=quizzes`} replace />;
  }

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] dark:text-[#ffb81c] mx-auto" aria-hidden="true" />
        <p className="text-gray-600 dark:text-slate-400 font-medium">Securing authoritative attempt context & clock anchor...</p>
      </div>
    );
  }

  // 2. Error Boundary
  if (fetchError || !attempt) {
    return (
      <div className="max-w-2xl mx-auto p-8 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-2xl text-center space-y-4">
        <AlertCircle size={40} className="text-red-600 dark:text-red-400 mx-auto" aria-hidden="true" />
        <h2 className="text-lg font-bold text-red-900 dark:text-red-200">Quiz Attempt Unavailable</h2>
        <ErrorAlertCallout error={fetchError} onRetry={() => refetch()} />
      </div>
    );
  }

  // 3. Finalized State View
  if (isFinalized) {
    return (
      <QuizFinalizedView
        courseId={courseId}
        attempt={attempt}
        submissionReceipt={submissionReceipt}
      />
    );
  }

  // 4. Main Examination Workspace
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
        <main className="lg:col-span-8 space-y-6">
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

        <div className="lg:col-span-4">
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

      {/* Milestone 10.1: Accessible Soft-Lockdown Proctoring Curtain */}
      <ProctoringCurtainModal
        lockdownState={lockdownState}
        infractionCount={infractionCount}
        fullscreenExits={fullscreenExits}
        onResumeExam={enterFullscreenProctoring}
      />
    </div>
  );
}

export default QuizAttemptPage;
