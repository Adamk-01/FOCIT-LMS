import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  ShieldCheck, 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  Play, 
  RefreshCw, 
  RotateCcw,
  BookOpen,
  Award
} from 'lucide-react';
import { apiClient } from '../../lib/api';

export function CourseAssessmentsList({ courseId }) {
  const navigate = useNavigate();
  const [startingQuizId, setStartingQuizId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['quizzes', courseId],
    queryFn: async () => {
      const res = await apiClient.get(`/quizzes/course/${courseId}`);
      return res.data;
    },
    staleTime: 15 * 1000,
  });

  const quizzes = data?.quizzes || [];
  const practiceQuizzes = quizzes.filter(q => q.quiz_type === 'SELF_PRACTICE');
  const officialTests = quizzes.filter(q => q.quiz_type === 'OFFICIAL_TEST');

  const handleStartAttempt = async (quiz) => {
    setActionError(null);
    setStartingQuizId(quiz.quiz_id);
    try {
      const res = await apiClient.post(`/quizzes/${quiz.quiz_id}/start`);
      const attempt = res.data.attempt;
      if (attempt?.attempt_id) {
        navigate(`/courses/${courseId}/quizzes/${quiz.quiz_id}/attempts/${attempt.attempt_id}`);
      }
    } catch (err) {
      setActionError(err.response?.data?.error || err.message || 'Failed to initialize assessment attempt.');
    } finally {
      setStartingQuizId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl p-12 border border-gray-200 text-center space-y-4 shadow-sm animate-pulse">
        <RefreshCw size={32} className="animate-spin text-[#0a1142] mx-auto" />
        <p className="text-sm text-gray-500">Loading course assessment assessments...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {actionError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Tier 1: Course Self-Practice Drill */}
      <section className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700">
              <BookOpen size={14} />
              <span>TIER 1 • FORMATIVE MASTERY DRILL</span>
            </div>
            <h2 className="text-xl font-extrabold text-[#0a1142] font-display">
              Course Self-Practice Drill
            </h2>
            <p className="text-xs text-gray-500">
              Untimed self-study drills based on this course's syllabus. Unlimited attempts with instant rationales.
            </p>
          </div>
        </div>

        {practiceQuizzes.length === 0 ? (
          <div className="p-6 rounded-xl bg-gray-50 text-center text-xs text-gray-500">
            No self-practice drills currently published for this course.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {practiceQuizzes.map((quiz) => {
              const attempt = quiz.latestAttempt;
              const hasActiveAttempt = attempt?.status === 'IN_PROGRESS';
              const isStarting = startingQuizId === quiz.quiz_id;

              return (
                <div 
                  key={quiz.quiz_id}
                  className="p-5 rounded-2xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full">
                        {quiz.question_count || 0} Questions Available
                      </span>
                      {attempt && (
                        <span className="text-[11px] text-gray-500">
                          {quiz.attemptsCount} prior session{quiz.attemptsCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-gray-900 font-display">
                      {quiz.title}
                    </h3>
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {quiz.description || 'Continuous self-assessment review session.'}
                    </p>
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-gray-100">
                    <div className="text-xs">
                      {attempt?.score !== undefined && attempt.status !== 'IN_PROGRESS' ? (
                        <span className="font-semibold text-emerald-700">
                          Last Score: {parseFloat(attempt.score).toFixed(1)} / {parseFloat(attempt.total_points).toFixed(1)}
                        </span>
                      ) : (
                        <span className="text-gray-400">Untimed practice</span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={isStarting}
                      onClick={() => handleStartAttempt(quiz)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0a1142] hover:bg-[#16258f] disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-all"
                    >
                      {hasActiveAttempt ? <RotateCcw size={14} /> : <Play size={14} />}
                      <span>{hasActiveAttempt ? 'Resume Drill' : 'Start Practice'}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Tier 2: Official Lecturer Online Tests */}
      <section className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700">
              <Clock size={14} />
              <span>TIER 2 • OFFICIAL TIMED ASSESSMENTS</span>
            </div>
            <h2 className="text-xl font-extrabold text-[#0a1142] font-display">
              Continuous Assessment Online Tests
            </h2>
            <p className="text-xs text-gray-500">
              Lecturer-scheduled summative examinations. Strict countdown timer. Auto-zero recorded upon expiration.
            </p>
          </div>
        </div>

        {officialTests.length === 0 ? (
          <div className="p-8 rounded-xl bg-gray-50 border border-dashed border-gray-200 text-center space-y-2">
            <Award size={28} className="text-gray-400 mx-auto" />
            <p className="text-xs font-bold text-gray-700">No active continuous assessment tests scheduled</p>
            <p className="text-[11px] text-gray-400">Your lecturer will publish official tests here during the assessment window.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {officialTests.map((test) => {
              const attempt = test.latestAttempt;
              const hasActiveAttempt = attempt?.status === 'IN_PROGRESS';
              const isCompleted = attempt && attempt.status !== 'IN_PROGRESS';
              const isExpired = attempt?.status === 'EXPIRED';
              const isStarting = startingQuizId === test.quiz_id;

              return (
                <div 
                  key={test.quiz_id}
                  className={`p-5 rounded-2xl border transition-all flex flex-col justify-between gap-4 ${
                    isCompleted 
                      ? 'bg-gray-50/50 border-gray-200' 
                      : 'bg-white border-amber-200/80 shadow-card hover:border-amber-400'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-amber-800 bg-amber-100/70 px-2.5 py-0.5 rounded-full inline-flex items-center gap-1">
                        <Clock size={12} />
                        {test.duration_minutes} Mins • {parseFloat(test.total_points).toFixed(0)} Points
                      </span>
                      {test.auto_zero && (
                        <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                          AUTO-ZERO
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-gray-900 font-display">
                      {test.title}
                    </h3>
                    <p className="text-xs text-gray-500 line-clamp-2">
                      {test.description || 'Official timed examination for this course.'}
                    </p>
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-gray-100">
                    <div className="text-xs">
                      {isCompleted ? (
                        isExpired ? (
                          <span className="font-bold text-red-600">
                            Expired • Score: 0.00 (Auto-Zero)
                          </span>
                        ) : (
                          <span className="font-bold text-emerald-700">
                            Completed • Score: {parseFloat(attempt.score).toFixed(1)} / {parseFloat(attempt.total_points).toFixed(1)}
                          </span>
                        )
                      ) : (
                        <span className="text-gray-500 font-medium">Single Attempt Allowed</span>
                      )}
                    </div>

                    {isCompleted ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-400 px-3 py-1.5 bg-gray-100 rounded-lg">
                        <CheckCircle size={14} className="text-emerald-600" />
                        Finalized
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={isStarting}
                        onClick={() => handleStartAttempt(test)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-all"
                      >
                        {hasActiveAttempt ? <RotateCcw size={14} /> : <Play size={14} />}
                        <span>{hasActiveAttempt ? 'Resume Test' : 'Start Test'}</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default CourseAssessmentsList;
