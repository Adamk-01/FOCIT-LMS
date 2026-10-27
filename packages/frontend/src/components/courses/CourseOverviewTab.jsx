import React from 'react';
import { Link } from 'react-router-dom';
import { Video, ExternalLink, Clock } from 'lucide-react';

/**
 * <CourseOverviewTab />
 *
 * Overview Tab Pane for CourseDetailPage
 * Isolates syllabus synopsis, live conference links, and Moodle upcoming assessments.
 */
export function CourseOverviewTab({
  course,
  zoom,
  progressPercent = 45,
  upcomingActivities = [],
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
      {/* Left Column: Course Information & Description */}
      <div className="lg:col-span-2 space-y-6">
        <section className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-gray-200 dark:border-slate-800 shadow-sm space-y-5">
          <h2 className="text-lg font-bold text-[#0a1142] dark:text-slate-100 font-display">
            Course Information
          </h2>
          <p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed font-sans">
            {course?.description || 
              'This course covers fundamental data structures and algorithms including arrays, linked lists, stacks, queues, hash tables, balanced binary search trees, heaps, priority queues, and graph representations with Big-O time and space complexity evaluations.'}
          </p>

          {/* Join Zoom Meeting Button */}
          <div className="pt-3">
            <a
              href={zoom?.join_url || 'https://zoom.us'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 min-h-[44px] px-6 py-3 bg-[#0a1142] hover:bg-[#16258f] text-white rounded-xl font-bold text-sm shadow-md transition-all"
            >
              <Video size={18} className="text-[#ffb81c]" aria-hidden="true" />
              <span>Join Zoom Meeting</span>
              <ExternalLink size={14} className="text-gray-300" aria-hidden="true" />
            </a>
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-2 font-sans">
              Scheduled: {zoom?.schedule || 'Tuesdays & Thursdays • 10:00 AM - 12:00 PM'}
            </p>
          </div>
        </section>
      </div>

      {/* Right Column: Course Progress & Upcoming Activities */}
      <aside className="space-y-6">
        {/* Course Progress Card */}
        <section className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#0a1142] dark:text-slate-100">Course Progress</h3>
            <span className="text-lg font-extrabold text-[#0a1142] dark:text-slate-100">{progressPercent}%</span>
          </div>

          <div className="w-full h-3 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden p-0.5">
            <div 
              className="h-full bg-gradient-to-r from-[#0a1142] to-[#16258f] rounded-full transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <p className="text-xs text-gray-500 dark:text-slate-400 font-sans">
            You have completed 4 out of 9 core syllabus modules.
          </p>
        </section>

        {/* Upcoming Activities Card */}
        <section className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-[#0a1142] dark:text-slate-100">Upcoming Activities</h3>
            <span className="text-[11px] text-gray-500 dark:text-slate-400 font-medium">Headless Moodle</span>
          </div>

          <div className="space-y-3">
            {upcomingActivities.map((act) => (
              <div key={act.id} className="p-3.5 rounded-xl bg-gray-50 dark:bg-slate-800/70 border border-gray-100 dark:border-slate-700/80 flex items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="font-bold text-xs text-[#0a1142] dark:text-slate-100 truncate font-sans">{act.title}</p>
                  <p className="text-[11px] text-gray-500 dark:text-slate-400 flex items-center gap-1 font-sans">
                    <Clock size={11} className="shrink-0" aria-hidden="true" />
                    <span>Due: {act.due_date}</span>
                  </p>
                </div>

                <Link
                  to={act.link}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-bold bg-[#0a1142] text-[#ffb81c] hover:bg-[#16258f] shrink-0 transition-colors flex items-center justify-center"
                >
                  {act.action_label}
                </Link>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

export default CourseOverviewTab;
