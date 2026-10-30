import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, RefreshCw } from 'lucide-react';

/**
 * <CourseDetailHero />
 *
 * Header card and breadcrumbs for CourseDetailPage.
 */
export function CourseDetailHero({
  course,
  isDegraded = false,
}) {
  return (
    <>
      {/* 1. Dynamic Breadcrumbs */}
      <nav aria-label="Course Breadcrumbs" className="text-xs font-semibold text-gray-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">
              Dashboard
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
          <li>
            <Link to="/courses" className="hover:text-[#0a1142] transition-colors">
              My courses
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
          <li className="text-[#0a1142] font-bold" aria-current="page">
            {course?.code || 'CSC 204'}
          </li>
        </ol>
      </nav>

      {/* 2. Top Hero Card */}
      <header className="bg-gradient-to-r from-[#0a1142] via-[#070c2e] to-[#0a1142] rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-white/10">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-[#ffb81c]/15 to-transparent pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#ffb81c] border border-[#ffb81c]/30 mb-3">
              <span>{course?.category || 'CORE'} MODULE</span>
              <span>•</span>
              <span>{course?.department || 'Department of Computer Science'}</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight font-display text-white">
              {course?.code || 'CSC 204'} — {course?.title || 'Data Structures and Algorithms'}
            </h1>
            <p className="text-gray-300 mt-2 text-sm sm:text-base font-medium font-sans">
              {course?.units || 3} Units • {course?.level || 200} Level
            </p>
          </div>

          {/* Background Revalidation Indicator */}
          {isDegraded && (
            <div className="px-3.5 py-1.5 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-xs font-semibold flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin text-amber-400" aria-hidden="true" />
              <span>Syncing with Moodle in background...</span>
            </div>
          )}
        </div>
      </header>
    </>
  );
}

export default CourseDetailHero;
