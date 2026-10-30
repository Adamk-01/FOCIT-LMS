import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Layers } from 'lucide-react';

/**
 * <CourseEmptyState />
 *
 * Empty state notice with registration call-to-action or search reset.
 */
export function CourseEmptyState({
  searchQuery = '',
  onClearSearch,
}) {
  return (
    <section aria-label="No Courses Found" className="bg-white rounded-2xl border border-gray-200 p-12 text-center space-y-4 shadow-sm">
      <div className="w-16 h-16 bg-blue-50 text-[#0a1142] rounded-2xl flex items-center justify-center mx-auto shadow-inner">
        <BookOpen size={30} className="text-[#0a1142]/70" aria-hidden="true" />
      </div>
      
      <div className="space-y-1 max-w-md mx-auto">
        <h3 className="text-lg font-bold text-[#0a1142] font-display">
          {searchQuery ? 'No matching courses found' : 'No registered courses for this semester'}
        </h3>
        <p className="text-xs sm:text-sm text-gray-500 leading-relaxed font-sans">
          {searchQuery 
            ? `No courses matched your query "${searchQuery}". Please check your spelling or clear the filter.` 
            : 'You have not finalized any course selections for the active semester ledger. Please proceed to registration.'}
        </p>
      </div>

      <div className="pt-2">
        {searchQuery ? (
          <button
            type="button"
            onClick={onClearSearch}
            className="min-h-[44px] px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition-colors"
          >
            Clear Search Filter
          </button>
        ) : (
          <Link
            to="/registration"
            className="inline-flex items-center gap-2 min-h-[44px] px-6 py-3 bg-[#0a1142] hover:bg-[#16258f] text-[#ffb81c] text-xs font-extrabold rounded-xl shadow-md transition-colors"
          >
            <Layers size={16} aria-hidden="true" />
            <span>Begin Course Registration</span>
          </Link>
        )}
      </div>
    </section>
  );
}

export default CourseEmptyState;
