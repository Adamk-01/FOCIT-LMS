import React from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ArrowRight } from 'lucide-react';

/**
 * Dashboard Enrolled Courses Section
 *
 * Implements:
 * 1. Enrolled courses card list with status badges
 * 2. Navigation links to course details with last-visited session caching
 * 3. Minimum WCAG 44x44px touch targets on directional links
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function DashboardCoursesSection({ courses = [], isLoading = false }) {
  const handleCourseClick = (courseId) => {
    try {
      sessionStorage.setItem('focit_last_course_id', courseId);
    } catch {
      // SessionStorage quota safe
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-[#0a1142] font-display">
          My Courses
        </h2>
        <Link
          to="/courses"
          className="min-h-[44px] px-3 py-2 text-xs font-bold text-[#0a1142] hover:text-[#16258f] flex items-center gap-1 transition-colors touch-manipulation"
        >
          <span>View All</span>
          <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>

      <div className="space-y-3">
        {courses.length === 0 && !isLoading ? (
          <div className="bg-white rounded-2xl p-8 border border-gray-200 text-center space-y-3">
            <BookOpen size={32} className="mx-auto text-gray-400" aria-hidden="true" />
            <p className="text-sm text-gray-600 font-medium">No active courses enrolled for this term.</p>
            <Link
              to="/registration"
              className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-[#0a1142] text-white text-xs font-bold rounded-xl hover:bg-[#16258f] transition-colors touch-manipulation"
            >
              Proceed to Course Registration
            </Link>
          </div>
        ) : (
          courses.map((course) => {
            const courseTargetId = course.course_id || course.id;

            return (
              <div
                key={courseTargetId}
                className="bg-white rounded-2xl p-5 border border-gray-200 hover:border-[#0a1142]/30 shadow-sm transition-all hover:shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-[#0a1142]/10 text-[#0a1142] flex items-center justify-center font-bold text-xs shrink-0">
                    {course.code.slice(0, 3)}
                  </div>
                  <div>
                    <h3 className="font-bold text-[#0a1142] text-sm">
                      <Link
                        to={`/courses/${courseTargetId}`}
                        onClick={() => handleCourseClick(courseTargetId)}
                        className="hover:text-[#16258f] transition-colors"
                      >
                        {course.code} — {course.title}
                      </Link>
                    </h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {course.units} Units • Level {course.level} • {course.category}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      course.status === 'In Progress' || course.status === 'IN_PROGRESS'
                        ? 'bg-emerald-100 text-emerald-800'
                        : course.status === 'Completed' || course.status === 'COMPLETED'
                        ? 'bg-blue-100 text-[#0a1142]'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {course.status}
                  </span>

                  <Link
                    to={`/courses/${courseTargetId}`}
                    onClick={() => handleCourseClick(courseTargetId)}
                    className="min-w-[44px] min-h-[44px] p-2 rounded-lg text-gray-400 hover:text-[#0a1142] hover:bg-gray-100 flex items-center justify-center transition-colors touch-manipulation"
                    title="Open Course Overview"
                    aria-label={`Open course ${course.code}`}
                  >
                    <ArrowRight size={18} aria-hidden="true" />
                  </Link>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export default DashboardCoursesSection;
