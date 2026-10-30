/**
 * Course Quizzes Presentation Tab
 *
 * Implements:
 * 1. Course-scoped quizzes isolation (prevents completed attempt spillover from other courses)
 * 2. Unhappy-path defense: loading skeletons, non-destructive error recovery, and empty state
 * 3. Clear zero-state: "No Set Quiz" when no assessment is scheduled for this course
 * 4. Semantic, accessible interactive controls with WCAG >= 44x44px touch targets
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  HelpCircle, 
  Clock, 
  Calendar, 
  Award, 
  CheckCircle2, 
  ArrowRight, 
  RefreshCw,
  AlertCircle 
} from 'lucide-react';
import { apiClient } from '../../lib/api';

export function CourseQuizzesTab({ courseId, courseCode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [startingQuizId, setStartingQuizId] = useState(null);
  const [startError, setStartError] = useState(null);

  
  const requestAutoFullscreen = () => {
    if (typeof document !== 'undefined' && !document.fullscreenElement) {
      const el = document.documentElement;
      const rfs =
        el.requestFullscreen ||
        el.webkitRequestFullscreen ||
        el.mozRequestFullScreen ||
        el.msRequestFullscreen;
      if (rfs) {
        rfs.call(el).catch(() => {});
      }
    }
  };

  const startQuizMutation = useMutation({
    mutationFn: async (quizId) => {
      const clientSend = Date.now();
      const res = await apiClient.post(`/quizzes/${quizId}/attempts`);
      const clientReceive = Date.now();
      return {
        ...res.data,
        _telemetry: {
          clientSend,
          clientReceive,
          rtt: clientReceive - clientSend,
        },
      };
    },
    onSuccess: (data, quizId) => {
      const freshAttemptId = data?.attempt?.id || data?.attempt?.attempt_id;
      // Pre-seed TanStack Query cache synchronously to eliminate waterfall
      queryClient.setQueryData(['quiz-attempt', quizId, freshAttemptId], data);
      queryClient.invalidateQueries({ queryKey: ['course-quizzes', courseId] });
      navigate(
        `/courses/${encodeURIComponent(courseId)}/quizzes/${quizId}?attemptId=${encodeURIComponent(freshAttemptId)}`
      );
    },
    onError: (err) => {
      setStartError(err?.response?.data?.error || err?.message || 'Failed to initialize assessment attempt');
    },
    onSettled: () => {
      setStartingQuizId(null);
    },
  });

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['course-quizzes', courseId],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get(`/courses/${encodeURIComponent(courseId)}/quizzes`, { signal });
      return res.data;
    },
    staleTime: 30_000,
  });

  // 1. Loading State: Skeleton Cards
  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Loading quizzes">
        {[1, 2].map((i) => (
          <div key={i} className="p-6 bg-surface rounded-xl border border-surface-border space-y-4">
            <div className="flex justify-between items-start gap-4">
              <div className="space-y-2 flex-1">
                <div className="w-2/5 h-5 bg-surface-alt rounded" />
                <div className="w-3/4 h-3 bg-surface-alt rounded" />
              </div>
              <div className="w-24 h-6 bg-surface-alt rounded-full" />
            </div>
            <div className="flex gap-4">
              <div className="w-28 h-4 bg-surface-alt rounded" />
              <div className="w-28 h-4 bg-surface-alt rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 2. Error State: Non-destructive Callout
  if (isError) {
    return (
      <div className="p-8 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-2xl text-center space-y-3">
        <AlertCircle size={36} className="text-red-600 dark:text-red-400 mx-auto" aria-hidden="true" />
        <h3 className="text-base font-bold text-red-900 dark:text-red-200">
          Unable to Load Course Quizzes
        </h3>
        <p className="text-xs text-red-700 dark:text-red-300 max-w-md mx-auto">
          {error?.response?.data?.error || error?.message || 'A network error occurred while retrieving course assessments.'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="min-h-[44px] px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl transition-colors inline-flex items-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  const quizzes = data?.quizzes || [];

  // 3. Empty State: Course Has No Set Quiz
  if (quizzes.length === 0) {
    return (
      <div className="p-12 bg-surface rounded-2xl border border-surface-border text-center space-y-3 shadow-xs">
        <div className="w-12 h-12 rounded-full bg-surface-alt text-focitText-muted flex items-center justify-center mx-auto">
          <HelpCircle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-focitText-primary font-display">
          No Set Quiz
        </h3>
        <p className="text-xs text-focitText-muted max-w-md mx-auto font-sans leading-relaxed">
          There is no set quiz for <span className="font-semibold text-focitText-primary">{courseCode || courseId}</span> at this time.
        </p>
      </div>
    );
  }

  // 4. Populated State: Course-Specific Quizzes
  return (
    <div className="space-y-4">
      {quizzes.map((quiz) => {
        const attempt = quiz.attempt;
        const isGraded = attempt?.status === 'GRADED';
        const isInProgress = attempt?.status === 'IN_PROGRESS';
        const formattedDueDate = quiz.dueDate
          ? new Date(quiz.dueDate).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Pending Announcement';

        return (
          <article
            key={quiz.quizId}
            className="p-6 bg-surface rounded-xl border border-surface-border shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-base font-bold text-focitText-primary">
                    {quiz.title}
                  </h3>
                  {isGraded ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      GRADED ({attempt.score !== null ? attempt.score.toFixed(2) : '0.00'} / {quiz.totalPoints.toFixed(2)} pts)
                    </span>
                  ) : isInProgress ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                      <Clock className="w-3.5 h-3.5" />
                      IN PROGRESS
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      ACTIVE
                    </span>
                  )}
                </div>
                {quiz.description && (
                  <p className="text-xs text-focitText-secondary line-clamp-2 leading-relaxed">
                    {quiz.description}
                  </p>
                )}
              </div>

              {/* Assessment Dimension Badges */}
              <div className="flex items-center gap-3 text-xs text-focitText-secondary shrink-0 flex-wrap">
                <span className="inline-flex items-center gap-1.5 bg-surface-alt px-3 py-1.5 rounded-lg border border-surface-border">
                  <Clock className="w-3.5 h-3.5 text-focitText-muted" />
                  {quiz.durationMinutes} mins
                </span>
                <span className="inline-flex items-center gap-1.5 bg-surface-alt px-3 py-1.5 rounded-lg border border-surface-border">
                  <Award className="w-3.5 h-3.5 text-focitText-muted" />
                  {quiz.totalPoints} pts
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-surface-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs text-focitText-muted">
                <Calendar className="w-3.5 h-3.5 text-focitText-muted" />
                <span>Due: <strong className="text-focitText-secondary font-medium">{formattedDueDate}</strong></span>
              </div>

              {/* Action Navigation */}
              {isGraded ? (
                <Link
                  to={`/courses/${encodeURIComponent(courseId)}/quizzes/${quiz.quizId}${attempt?.attemptId ? `?attemptId=${encodeURIComponent(attempt.attemptId)}` : ''}`}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-surface-alt hover:bg-surface border border-surface-border text-focitText-primary text-xs font-bold transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  View Assessment Receipt
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              ) : isInProgress ? (
                <button
                  type="button"
                  onClick={() => {
                    requestAutoFullscreen();
                    navigate(
                      `/courses/${encodeURIComponent(courseId)}/quizzes/${quiz.quizId}${attempt?.attemptId ? `?attemptId=${encodeURIComponent(attempt.attemptId)}` : ''}`
                    );
                  }}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors inline-flex items-center justify-center gap-1.5 shadow-xs"
                >
                  Resume Quiz Attempt
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={startingQuizId === quiz.quizId || startQuizMutation.isPending}
                  onClick={() => {
                    requestAutoFullscreen();
                    setStartError(null);
                    setStartingQuizId(quiz.quizId);
                    startQuizMutation.mutate(quiz.quizId);
                  }}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#0a1142] dark:bg-indigo-600 hover:bg-[#16258f] dark:hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-xs font-bold transition-colors inline-flex items-center justify-center gap-1.5 shadow-xs"
                >
                  {startingQuizId === quiz.quizId ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Securing Attempt...</span>
                    </>
                  ) : (
                    <>
                      <span>Start Quiz</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              )}
            </div>
          </article>
        );
      })}

      {startError && (
        <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-xl flex items-center justify-between gap-3 text-red-800 dark:text-red-200 text-xs">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
            <span>{startError}</span>
          </div>
          <button
            type="button"
            onClick={() => setStartError(null)}
            className="text-red-700 dark:text-red-300 font-bold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export default CourseQuizzesTab;
