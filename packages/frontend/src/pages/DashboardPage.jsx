import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  BookOpen, 
  GraduationCap, 
  CheckCircle2, 
  ArrowRight, 
  Clock, 
  ShieldCheck, 
  AlertCircle,
  Video,
  FileText,
  Calendar,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../lib/api';

export const DashboardPage = () => {
  const { user } = useAuth();
  const location = useLocation();
  const studentId = user?.username || 'student1';

  // Query authoritative student dashboard telemetry from BFF
  const { 
    data: dashboardData, 
    isLoading, 
    error, 
    refetch 
  } = useQuery({
    queryKey: ['student-dashboard', studentId],
    queryFn: async ({ signal }) => {
      const response = await apiClient.get('/student/dashboard', { signal });
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const student = dashboardData?.student;
  const metrics = dashboardData?.metrics;
  const courses = dashboardData?.courses || [];
  const upcomingActivities = dashboardData?.upcoming_activities || [];

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-8 pb-16">
      {/* Registration Success Flash Notification */}
      {location.state?.registrationSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <span>
              <strong>Registration Committed:</strong> Your academic modules have been finalized with <strong>{location.state?.units} units</strong> and synced with Moodle.
            </span>
          </div>
          <button 
            type="button" 
            onClick={() => window.history.replaceState({}, document.title)}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-900"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 1. Header Hero Banner (Screen 1 in ui_template.jpeg) */}
      <header className="bg-gradient-to-r from-[#0a1142] via-[#070c2e] to-[#0a1142] rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-white/10">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-[#ffb81c]/15 to-transparent pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#ffb81c] border border-[#ffb81c]/30 mb-3">
              <ShieldCheck size={14} />
              <span>UNIOSUN FOCIT LMS • Academic Identity Portal</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display">
              Welcome, <span className="text-[#ffb81c]">{student?.full_name || 'John Doe'}</span>
            </h1>
            <p className="text-gray-300 mt-2 text-sm sm:text-base font-medium">
              {student?.programme || 'Computer Science'} • Level {student?.level || 200}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-4 py-2.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center gap-3 text-sm">
              <Clock size={18} className="text-[#ffb81c]" />
              <div>
                <p className="text-[11px] text-gray-300">Active Term</p>
                <p className="font-semibold text-white">{metrics?.academic_term || '2026/2027 Rain Semester'}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Key Telemetry Summary Cards (Exact match to Screen 1) */}
      <section aria-label="Student Academic Metrics" className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Metric 1: Registered Courses */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Registered Courses
            </p>
            <p className="text-3xl font-extrabold text-[#0a1142]">
              {isLoading ? '...' : metrics?.registered_courses || 5}
            </p>
            <span className="text-xs text-gray-500 font-medium">Active this term</span>
          </div>
          <div className="p-3.5 bg-blue-50 text-[#0a1142] rounded-2xl">
            <BookOpen size={26} />
          </div>
        </div>

        {/* Metric 2: Completed Units */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Completed Units
            </p>
            <p className="text-3xl font-extrabold text-emerald-600">
              {isLoading ? '...' : metrics?.completed_units || 2}
            </p>
            <span className="text-xs text-gray-500 font-medium">Completed courses/modules</span>
          </div>
          <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-2xl">
            <CheckCircle2 size={26} />
          </div>
        </div>

        {/* Metric 3: Cumulative GPA */}
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              Cumulative GPA
            </p>
            <p className="text-3xl font-extrabold text-[#0a1142]">
              {isLoading ? '...' : (metrics?.current_gpa ? metrics.current_gpa.toFixed(2) : '3.60')}
            </p>
            <span className="text-xs text-emerald-600 font-bold">First Class Standing</span>
          </div>
          <div className="p-3.5 bg-amber-50 text-[#ffb81c] rounded-2xl">
            <GraduationCap size={26} />
          </div>
        </div>
      </section>

      {/* 3. Main Dashboard Grid: My Courses (Left) & Upcoming Activities (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: My Courses Section (Screen 1 in template) */}
        <section className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[#0a1142] font-display">
              My Courses
            </h2>
            <Link 
              to="/courses/1/materials" 
              className="text-xs font-bold text-[#0a1142] hover:text-[#16258f] flex items-center gap-1 transition-colors"
            >
              <span>View All</span>
              <ArrowRight size={14} />
            </Link>
          </div>

          <div className="space-y-3">
            {courses.length === 0 && !isLoading ? (
              <div className="bg-white rounded-2xl p-8 border border-gray-200 text-center space-y-3">
                <BookOpen size={32} className="mx-auto text-gray-400" />
                <p className="text-sm text-gray-600 font-medium">No active courses enrolled for this term.</p>
                <Link
                  to="/registration"
                  className="inline-block px-4 py-2 bg-[#0a1142] text-white text-xs font-bold rounded-xl"
                >
                  Proceed to Course Registration
                </Link>
              </div>
            ) : (
              courses.map((course) => (
                <div 
                  key={course.course_id}
                  className="bg-white rounded-2xl p-5 border border-gray-200 hover:border-[#0a1142]/30 shadow-sm transition-all hover:shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-[#0a1142]/10 text-[#0a1142] flex items-center justify-center font-bold text-xs shrink-0">
                      {course.code.slice(0, 3)}
                    </div>
                    <div>
                      <h3 className="font-bold text-[#0a1142] text-sm">
                        {course.code} — {course.title}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {course.units} Units • Level {course.level} • {course.category}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      course.status === 'In Progress' 
                        ? 'bg-emerald-100 text-emerald-800' 
                        : course.status === 'Completed'
                          ? 'bg-blue-100 text-[#0a1142]'
                          : 'bg-gray-100 text-gray-600'
                    }`}>
                      {course.status}
                    </span>

                    <Link
                      to={`/courses/1/materials`}
                      className="p-2 rounded-lg text-gray-400 hover:text-[#0a1142] hover:bg-gray-100 transition-colors"
                      title="Open Course Materials"
                    >
                      <ArrowRight size={18} />
                    </Link>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Right Column: Upcoming Activities & Virtual Lecture */}
        <aside className="space-y-6">
          {/* Zoom Meeting Action Card (Screen 2 preview) */}
          <div className="bg-gradient-to-br from-[#0a1142] to-[#16258f] rounded-2xl p-6 text-white shadow-lg space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#ffb81c]">
              <Video size={16} />
              <span>Live Virtual Classroom</span>
            </div>
            <div>
              <h3 className="font-bold text-base text-white">CSC 204 Live Lecture</h3>
              <p className="text-xs text-gray-300 mt-1">Topic: Trees, AVL Rotations & Priority Heaps</p>
            </div>
            <a
              href="https://zoom.us"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 px-4 bg-[#ffb81c] hover:bg-[#e5a200] text-[#0a1142] rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-md"
            >
              <span>Join Zoom Meeting</span>
              <ExternalLink size={14} />
            </a>
          </div>

          {/* Upcoming Activities List (Screen 2 in template) */}
          <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <h3 className="text-sm font-bold text-[#0a1142]">Upcoming Activities</h3>
              <span className="text-[11px] text-gray-500 font-medium">Synced with Moodle</span>
            </div>

            <div className="space-y-3">
              {upcomingActivities.map((act) => (
                <div key={act.id} className="p-3.5 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between gap-3">
                  <div className="space-y-0.5 min-w-0">
                    <p className="font-bold text-xs text-[#0a1142] truncate">{act.title}</p>
                    <p className="text-[11px] text-gray-500 flex items-center gap-1">
                      <Clock size={11} className="shrink-0" />
                      <span>Due: {act.due_date}</span>
                    </p>
                  </div>

                  <Link
                    to={act.link || '/courses/1/quizzes'}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                      act.type === 'quiz' 
                        ? 'bg-[#0a1142] text-[#ffb81c] hover:bg-[#16258f]' 
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {act.action_label}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
