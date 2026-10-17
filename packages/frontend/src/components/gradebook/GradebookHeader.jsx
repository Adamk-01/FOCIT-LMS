import React from 'react';
import { Link } from 'react-router-dom';
import { Award, ChevronRight, CheckCircle2 } from 'lucide-react';

/**
 * Gradebook Header Banner with Course Total Score Gauge
 *
 * Implements:
 * 1. Semantic breadcrumbs leading to Course and Dashboard
 * 2. Official transcript record banner
 * 3. Course Total Gauge with Letter Grade and Percentage
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function GradebookHeader({
  courseId = 'CSC204',
  courseCode = 'CSC 204',
  courseTitle = 'Course',
  studentName = 'Enrolled Student',
  studentMatric = '',
  overallLetter = 'A',
  cumulativePercentage = 89,
}) {
  return (
    <div className="space-y-4">
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
            Gradebook
          </li>
        </ol>
      </nav>

      {/* 2. Top Header & Metric Banner */}
      <header className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-card flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#0a1142] border border-[#ffb81c]/30">
            <Award size={14} className="text-[#0a1142]" aria-hidden="true" />
            <span>OFFICIAL ACADEMIC TRANSCRIPT RECORD</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0a1142] font-display">
            User Report: {courseCode} — {courseTitle}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 font-medium">
            Student: {studentName} {studentMatric ? `(${studentMatric})` : ''} • Rain Semester 2026/2027
          </p>
        </div>

        {/* Course Total Score Gauge */}
        <div className="bg-gradient-to-br from-[#0a1142] to-[#16258f] rounded-2xl p-5 text-white shadow-md flex items-center gap-5 min-w-[260px]">
          <div className="w-14 h-14 rounded-full bg-white/10 border border-white/20 flex items-center justify-center font-extrabold text-2xl text-[#ffb81c]">
            {overallLetter}
          </div>
          <div className="space-y-0.5">
            <p className="text-xs text-gray-300 font-semibold uppercase tracking-wider">Course Total</p>
            <p className="text-2xl font-extrabold text-white">{cumulativePercentage}%</p>
            <p className="text-[11px] text-emerald-300 flex items-center gap-1">
              <CheckCircle2 size={11} aria-hidden="true" />
              <span>Good Academic Standing</span>
            </p>
          </div>
        </div>
      </header>
    </div>
  );
}

export default GradebookHeader;
