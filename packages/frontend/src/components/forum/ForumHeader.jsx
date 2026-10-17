import React from 'react';
import { Link } from 'react-router-dom';
import { MessagesSquare, ChevronRight, Plus } from 'lucide-react';

/**
 * Forum Header and Breadcrumbs Banner
 *
 * Implements:
 * 1. Semantic breadcrumbs leading to Course and Dashboard
 * 2. Academic discourse header banner
 * 3. Action button to trigger new discussion topic modal
 * 4. WCAG minimum 44px touch targets on all interactive controls
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function ForumHeader({
  courseId = 'CSC204',
  courseCode = 'CSC 204',
  courseTitle = 'Course',
  onOpenNewTopic,
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
            Discussion Forum
          </li>
        </ol>
      </nav>

      {/* 2. Top Banner Header */}
      <header className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#0a1142] border border-[#ffb81c]/30">
            <MessagesSquare size={14} className="text-[#0a1142]" aria-hidden="true" />
            <span>STUDENT & FACULTY ACADEMIC DISCOURSE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0a1142] font-display">
            Discussion Forum: {courseCode} — {courseTitle}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 font-medium">
            Collaborate on algorithmic derivations, lab exercises, and assessment questions.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenNewTopic}
          className="inline-flex items-center gap-2 px-6 py-3 min-h-[44px] rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition-all shrink-0 touch-manipulation"
        >
          <Plus size={16} className="text-[#ffb81c]" aria-hidden="true" />
          <span>Add a new discussion topic</span>
        </button>
      </header>
    </div>
  );
}

export default ForumHeader;
