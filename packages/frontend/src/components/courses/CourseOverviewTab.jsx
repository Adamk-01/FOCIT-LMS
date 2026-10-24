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
        <section className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-5">
          <h2 className="text-lg font-bold text-[#0a1142] font-display">
            Course Information
          </h2>
          <p className="text-sm text-gray-600 leading-relaxed font-sans">
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
            <p className="text-xs text-gray-400 mt-2 font-sans">
              Scheduled: {zoom?.schedule || 'Tuesdays & Thursdays • 10:00 AM - 12:00 PM'}
            </p>
          </div>
        </section>
      </div>

      {/* Right Column: Course Progress & Upcoming Activities */}
      <aside className="space-y-6">
        {/* Course Academic Overview Card */}
        <section className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h3 className="text-sm font-bold text-[#0a1142]">Course Enrolment</h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
              (course?.status === 'Pending' || course?.status === 'PENDING')
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : (course?.status === 'Completed' || course?.status === 'COMPLETED')
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              {course?.status || course?.enrolment_status || 'Enrolled'}
            </span>
          </div>

          <div className="space-y-2 text-xs text-gray-600">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Credit Load:</span>
              <span className="font-bold text-[#0a1142]">{course?.units || 3} Units</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Academic Level:</span>
              <span className="font-bold text-[#0a1142]">Level {course?.level || 200}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Term:</span>
              <span className="font-bold text-[#0a1142]">Rain Semester</span>
            </div>
          </div>
        </section>

        {/* Upcoming Activities Card */}
        <section className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h3 className="text-sm font-bold text-[#0a1142]">Upcoming Activities</h3>
            <span className="text-[11px] text-gray-500 font-medium">Headless Moodle</span>
          </div>

          <div className="space-y-3">
            {upcomingActivities.map((act) => (
              <div key={act.id} className="p-3.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between gap-3">
                <div className="space-y-0.5 min-w-0">
                  <p className="font-bold text-xs text-[#0a1142] truncate font-sans">{act.title}</p>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1 font-sans">
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
