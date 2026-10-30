import React from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useQuizAttempt } from '../hooks/useQuizAttempt';
import { QuizHeaderTimer } from '../components/quiz/QuizHeaderTimer';
import { QuizQuestionCard } from '../components/quiz/QuizQuestionCard';
import { QuestionNavigationPalette } from '../components/quiz/QuestionNavigationPalette';
import { QuizSubmissionModal } from '../components/quiz/QuizSubmissionModal';
import { QuizFinalizedView } from '../components/quiz/QuizFinalizedView';
import { ErrorAlertCallout } from '../components/ErrorAlertCallout';

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
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function QuizAttemptPage() {
  const { courseId = 'CSC204', quizId = 'quiz_csc204_1', attemptId = 'att_csc204_john' } = useParams();
  const { user } = useAuth();
  const studentId = user?.username || user?.id || 'student1';

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

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] mx-auto" aria-hidden="true" />
        <p className="text-gray-600 font-medium">Securing authoritative attempt context & clock anchor...</p>
      </div>
    );
  }

  // 2. Error Boundary
  if (fetchError || !attempt) {
    return (
      <div className="max-w-2xl mx-auto p-8 bg-red-50 border border-red-200 rounded-2xl text-center space-y-4">
        <AlertCircle size={40} className="text-red-600 mx-auto" aria-hidden="true" />
        <h2 className="text-lg font-bold text-red-900">Quiz Attempt Unavailable</h2>
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

        <QuestionNavigationPalette
          questions={questions}
          currentQuestionIndex={currentQuestionIndex}
          selectedAnswers={selectedAnswers}
          onSelectQuestion={navigateToQuestion}
          onOpenFinishModal={() => setShowConfirmModal(true)}
          isSubmitting={isSubmitting}
        />
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
    </div>
  );
}

export default QuizAttemptPage;
