import React from 'react';
import { Link } from 'react-router-dom';
import { 
  Calendar, 
  HelpCircle, 
  FileText, 
  MessagesSquare, 
  Award, 
  ArrowRight 
} from 'lucide-react';

/**
 * <CourseCard />
 *
 * Isolated Course Directory Matrix Item
 * Invariants Enforced:
 * 1. Deterministic Keying & Routing (course_id)
 * 2. WCAG 44x44px touch targets on all interactive tab triggers
 * 3. SessionStorage continuity for contextual course memory
 */
export function CourseCard({ course, focus = null }) {
  const canonicalId = course.course_id || course.id || '1';
  const progressVal = Number(course.progress) || 45;
  const isCompleted = course.status === 'Completed';

  const handleCardClick = () => {
    try {
      sessionStorage.setItem('focit_last_course_id', canonicalId);
    } catch {
      // Defensive against sandbox storage quota/errors
    }
  };

  return (
    <article 
      className="bg-white rounded-2xl border border-gray-200/90 shadow-sm hover:shadow-md transition-all duration-300 flex flex-col justify-between overflow-hidden group hover:border-[#0a1142]/30"
    >
      {/* Card Header & Metadata */}
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="px-3 py-1 rounded-full text-xs font-extrabold bg-[#0a1142] text-white tracking-wide">
            {course.code}
          </span>

          <div className="flex items-center gap-1.5">
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
              course.category === 'CORE' 
                ? 'bg-blue-50 text-blue-700 border-blue-200' 
                : 'bg-purple-50 text-purple-700 border-purple-200'
            }`}>
              {course.category || 'CORE'}
            </span>

            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
              isCompleted 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              {course.status || 'In Progress'}
            </span>
          </div>
        </div>

        <div>
          <h2 className="text-base font-extrabold text-[#0a1142] group-hover:text-[#16258f] transition-colors leading-snug line-clamp-2">
            <Link 
              to={`/courses/${canonicalId}`} 
              onClick={handleCardClick}
              className="focus:outline-none focus:underline"
            >
              {course.title}
            </Link>
          </h2>
          
          <p className="text-xs text-gray-500 font-medium mt-1.5 flex items-center gap-2">
            <span>{course.units} Credit Units</span>
            <span>•</span>
            <span>Level {course.level || 200}</span>
            <span>•</span>
            <span>Semester 2</span>
          </p>
        </div>

        {/* Progress Gauge */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-gray-500 text-[11px]">Syllabus Completion</span>
            <span className="text-[#0a1142] font-bold">{progressVal}%</span>
          </div>

          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden p-0.5">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${
                isCompleted 
                  ? 'bg-emerald-500' 
                  : 'bg-gradient-to-r from-[#0a1142] to-[#16258f]'
              }`}
              style={{ width: `${progressVal}%` }}
            />
          </div>
        </div>
      </div>

      {/* Course-Peculiar Quick Navigation Hub */}
      <div className="px-4 py-3 bg-gray-50/70 border-t border-gray-100 flex items-center justify-between gap-1 text-[11px] font-bold">
        {/* Assignments Quick Tab */}
        <Link
          to={`/courses/${canonicalId}?tab=assignments`}
          onClick={handleCardClick}
          title="View Course Assignments & Lab Briefs"
          className="flex-1 min-h-[44px] p-2 rounded-lg text-gray-600 hover:text-[#0a1142] hover:bg-white text-center transition-colors flex flex-col items-center justify-center gap-0.5 border border-transparent hover:border-gray-200 hover:shadow-xs"
        >
          <Calendar size={14} className="text-indigo-600" />
          <span>Assignments</span>
        </Link>

        {/* Quizzes Quick Tab */}
        <Link
          to={`/courses/${canonicalId}?tab=quizzes`}
          onClick={handleCardClick}
          title="View Quiz Assessments & CBT"
          className="flex-1 min-h-[44px] p-2 rounded-lg text-gray-600 hover:text-[#0a1142] hover:bg-white text-center transition-colors flex flex-col items-center justify-center gap-0.5 border border-transparent hover:border-gray-200 hover:shadow-xs"
        >
          <HelpCircle size={14} className="text-amber-600" />
          <span>Quizzes</span>
        </Link>

        {/* Materials Quick Tab */}
        <Link
          to={`/courses/${canonicalId}?tab=materials`}
          onClick={handleCardClick}
          title="View Lecture Materials & PDFs"
          className={`flex-1 min-h-[44px] p-2 rounded-lg text-center transition-colors flex flex-col items-center justify-center gap-0.5 border hover:shadow-xs ${
            focus === 'materials' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-extrabold ring-2 ring-emerald-400/40' 
              : 'text-gray-600 hover:text-[#0a1142] hover:bg-white border-transparent hover:border-gray-200'
          }`}
        >
          <FileText size={14} className="text-emerald-600" />
          <span>Materials</span>
        </Link>

        {/* Forum Quick Tab */}
        <Link
          to={`/courses/${canonicalId}?tab=forum`}
          onClick={handleCardClick}
          title="View Course Discussion Forum"
          className="flex-1 min-h-[44px] p-2 rounded-lg text-gray-600 hover:text-[#0a1142] hover:bg-white text-center transition-colors flex flex-col items-center justify-center gap-0.5 border border-transparent hover:border-gray-200 hover:shadow-xs"
        >
          <MessagesSquare size={14} className="text-blue-600" />
          <span>Forum</span>
        </Link>

        {/* Grades Quick Tab */}
        <Link
          to={`/courses/${canonicalId}?tab=grades`}
          onClick={handleCardClick}
          title="View Official Course Gradebook"
          className="flex-1 min-h-[44px] p-2 rounded-lg text-gray-600 hover:text-[#0a1142] hover:bg-white text-center transition-colors flex flex-col items-center justify-center gap-0.5 border border-transparent hover:border-gray-200 hover:shadow-xs"
        >
          <Award size={14} className="text-purple-600" />
          <span>Grades</span>
        </Link>
      </div>

      {/* Primary Action Button */}
      <div className="p-4 bg-white border-t border-gray-100">
        <Link
          to={focus ? `/courses/${canonicalId}?tab=${focus}` : `/courses/${canonicalId}`}
          onClick={handleCardClick}
          className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 group-hover:bg-[#16258f]"
        >
          <span>
            {focus === 'materials' 
              ? 'Open Learning Materials' 
              : focus === 'quizzes' 
                ? 'Open Quizzes' 
                : focus === 'grades' 
                  ? 'Open Gradebook' 
                  : focus === 'forum' 
                    ? 'Open Forum' 
                    : 'Open Course Overview'}
          </span>
          <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" />
        </Link>
      </div>
    </article>
  );
}

export default CourseCard;
