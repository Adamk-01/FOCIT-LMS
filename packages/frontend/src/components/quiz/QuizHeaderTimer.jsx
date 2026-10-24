import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, ChevronRight, CheckCircle2, RefreshCw, WifiOff } from 'lucide-react';

/**
 * Quiz Header and Monotonic Countdown Timer Banner
 *
 * Implements:
 * 1. Semantic breadcrumb navigation
 * 2. Visual urgency states for remaining time (<5 min urgent, <1 min critical)
 * 3. WAI-ARIA live timer region for assistive technology
 * 4. Active offline/saving/synced status indicators
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function QuizHeaderTimer({
  courseCode = 'CSC 204',
  courseId = 'CSC204',
  quizTitle = 'Assessment',
  currentQuestionNumber = 1,
  totalQuestions = 1,
  answeredCount = 0,
  timer,
  syncStatus = 'SYNCED',
}) {
  const { formattedTimer, isUrgent, isCritical } = timer || {};

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Breadcrumbs */}
      <nav aria-label="Breadcrumb Navigation" className="text-xs font-semibold text-gray-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">
              Dashboard
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
          <li>
            <Link to={`/courses/${courseId}`} className="hover:text-[#0a1142] transition-colors">
              {courseCode}
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
          <li className="text-[#0a1142] font-bold" aria-current="page">
            {quizTitle}
          </li>
        </ol>
      </nav>

      {/* 2. Top Banner Header */}
      <header className="bg-gradient-to-r from-[#0a1142] via-[#0d1656] to-[#0a1142] rounded-2xl p-6 text-white shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-white/10">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#ffb81c]/20 text-[#ffb81c] border border-[#ffb81c]/30">
            <span>TOPIC PRACTICE & REVISION</span>
            <span>•</span>
            <span>SELF-STUDY DRILL</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display text-white">
            {courseCode}: {quizTitle}
          </h1>
          <p className="text-xs text-gray-300">
            Question {currentQuestionNumber} of {totalQuestions} • {answeredCount} Answered
          </p>
        </div>

        {/* Monotonic Countdown Timer Badge & Sync Status */}
        <div className="flex items-center gap-3">
          <div
            role="timer"
            aria-live="polite"
            aria-label={`Time remaining: ${formattedTimer}`}
            className={`
              px-4 py-2 rounded-xl flex items-center gap-2.5 font-mono text-sm sm:text-base font-extrabold tracking-wider border shadow-inner transition-all
              ${isCritical
                ? 'bg-red-600 text-white border-red-400 animate-pulse'
                : isUrgent
                ? 'bg-red-500/20 text-red-300 border-red-500/40 animate-pulse'
                : 'bg-white/10 text-[#ffb81c] border-white/20'
              }
            `}
          >
            <Clock
              size={18}
              className={isCritical ? 'text-white' : isUrgent ? 'text-red-400' : 'text-[#ffb81c]'}
              aria-hidden="true"
            />
            <span>Time left: {formattedTimer}</span>
          </div>

          {/* Sync Engine Status Pill */}
          <div className="hidden sm:flex items-center">
            {syncStatus === 'SYNCED' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                <CheckCircle2 size={12} aria-hidden="true" />
                <span>All Saved</span>
              </span>
            )}
            {syncStatus === 'SAVING' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30">
                <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                <span>Syncing...</span>
              </span>
            )}
            {syncStatus === 'OFFLINE' && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                <WifiOff size={12} aria-hidden="true" />
                <span>Saved Locally (Offline)</span>
              </span>
            )}
          </div>
        </div>
      </header>
    </div>
  );
}

export default QuizHeaderTimer;
