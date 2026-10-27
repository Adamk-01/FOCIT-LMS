import React from 'react';
import { Link } from 'react-router-dom';
import { Video, ExternalLink, Clock } from 'lucide-react';

/**
 * Dashboard Upcoming Activities & Virtual Lecture Sidebar
 *
 * Implements:
 * 1. Today's Live Virtual Lecture card with external launch link
 * 2. Upcoming published assignments and activities synced from Moodle
 * 3. Minimum WCAG 44x44px touch targets on action links
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function DashboardUpcomingActivities({
  zoomSession = null,
  upcomingActivities = [],
}) {
  return (
    <aside className="space-y-6">
      {/* 1. Dynamic Virtual Lecture Card */}
      {zoomSession ? (
        <div className="bg-gradient-to-br from-[#0a1142] to-[#16258f] rounded-2xl p-6 text-white shadow-lg space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#ffb81c]">
            <Video size={16} aria-hidden="true" />
            <span>Today's Virtual Classroom</span>
          </div>
          <div>
            <h3 className="font-bold text-base text-white">{zoomSession.title}</h3>
            <p className="text-xs text-gray-300 mt-1">
              {zoomSession.topic} • {zoomSession.schedule || 'Scheduled Live Session'}
            </p>
          </div>
          <a
            href={zoomSession.join_url || 'https://zoom.us'}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full min-h-[44px] py-2.5 px-4 bg-[#ffb81c] hover:bg-[#e5a200] text-[#0a1142] rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-md touch-manipulation"
          >
            <span>Join Live Lecture</span>
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-slate-400">
            <Video size={16} className="text-[#0a1142] dark:text-indigo-400" aria-hidden="true" />
            <span>Virtual Classroom</span>
          </div>
          <p className="font-bold text-sm text-[#0a1142] dark:text-slate-100">No Live Lectures Today</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            You have no scheduled virtual lectures for today based on your active timetable.
          </p>
        </div>
      )}

      {/* 2. Upcoming Activities List */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-3">
          <h3 className="text-sm font-bold text-[#0a1142] dark:text-slate-100">Upcoming Activities</h3>
          <span className="text-[11px] text-gray-500 dark:text-slate-400 font-medium">Synced with Moodle</span>
        </div>

        <div className="space-y-3">
          {upcomingActivities.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-500 dark:text-slate-400">
              No pending assignments or activities due.
            </div>
          ) : (
            upcomingActivities.map((act) => (
              <div
                key={act.id}
                className="p-3.5 rounded-xl bg-gray-50 dark:bg-slate-800/70 border border-gray-100 dark:border-slate-700/80 flex items-center justify-between gap-3"
              >
                <div className="space-y-0.5 min-w-0">
                  <p className="font-bold text-xs text-[#0a1142] dark:text-slate-100 truncate">{act.title}</p>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 flex items-center gap-1">
                    <Clock size={11} className="shrink-0" aria-hidden="true" />
                    <span>Due: {act.due_date}</span>
                  </p>
                </div>

                <Link
                  to={act.link || '/courses'}
                  className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-bold shrink-0 transition-colors flex items-center justify-center touch-manipulation ${
                    act.type === 'quiz'
                      ? 'bg-[#0a1142] text-[#ffb81c] hover:bg-[#16258f]'
                      : 'bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-600'
                  }`}
                >
                  {act.action_label || 'View'}
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}

export default DashboardUpcomingActivities;
