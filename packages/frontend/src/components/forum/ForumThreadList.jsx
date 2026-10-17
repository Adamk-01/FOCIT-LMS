import React from 'react';
import { MessagesSquare, MessageCircle, Clock } from 'lucide-react';

/**
 * Forum Discussion Thread List
 *
 * Implements:
 * 1. Synchronized discussion topic feed with Moodle Forum Core
 * 2. Author role badges (FACULTY / STUDENT) with timestamp formatting
 * 3. High-contrast reply counter badge
 * 4. Empty state with guidance
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function ForumThreadList({ threads = [] }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex items-center justify-between">
        <h2 className="text-base font-bold text-[#0a1142] font-display">
          Active Discussion Topics
        </h2>
        <span className="text-xs text-gray-500 font-medium">
          Synchronized with Headless Moodle Forum Core
        </span>
      </div>

      {threads.length === 0 ? (
        <div className="p-12 text-center space-y-3">
          <MessagesSquare size={36} className="text-gray-300 mx-auto" aria-hidden="true" />
          <p className="text-sm font-semibold text-gray-700">No discussion topics found</p>
          <p className="text-xs text-gray-500">Be the first to start an academic discussion in this module.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {threads.map((thread) => (
            <article
              key={thread.id}
              className="p-6 hover:bg-gray-50/70 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 flex-1 min-w-0">
                <h3 className="text-base font-bold text-[#0a1142] hover:text-[#16258f] transition-colors truncate">
                  {thread.title}
                </h3>
                <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                  {thread.body}
                </p>

                <div className="flex items-center gap-3 pt-1 text-xs text-gray-500 font-medium">
                  {/* Author Avatar Pill */}
                  <div className="inline-flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-[#0a1142] text-[#ffb81c] font-bold text-[10px] flex items-center justify-center shrink-0">
                      {thread.author?.initials || thread.author?.name?.slice(0, 2).toUpperCase() || 'ST'}
                    </div>
                    <span className="text-gray-800 font-semibold">{thread.author?.name || 'Anonymous'}</span>
                    {thread.author?.role === 'LECTURER' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#0a1142] text-[#ffb81c]">
                        FACULTY
                      </span>
                    )}
                  </div>

                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock size={12} className="text-gray-400" aria-hidden="true" />
                    <span>
                      {thread.lastPostAt
                        ? new Date(thread.lastPostAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Recent'}
                    </span>
                  </span>
                </div>
              </div>

              {/* Reply Counter Badge */}
              <div className="flex sm:flex-col items-center justify-between sm:justify-center gap-2 sm:gap-1 shrink-0 min-w-[80px] bg-gray-50 p-2.5 sm:p-3 rounded-xl border border-gray-100">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#0a1142]">
                  <MessageCircle size={14} className="text-[#0a1142]" aria-hidden="true" />
                  <span>{thread.repliesCount ?? 0}</span>
                </div>
                <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                  Replies
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export default ForumThreadList;
