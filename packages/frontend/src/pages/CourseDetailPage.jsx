import React, { useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  BookOpen, 
  Video, 
  ExternalLink, 
  Clock, 
  CheckCircle2, 
  ChevronRight, 
  AlertCircle, 
  RefreshCw,
  FileText,
  HelpCircle,
  MessagesSquare,
  Award,
  Sparkles,
  Calendar
} from 'lucide-react';
import { apiClient } from '../lib/api';
import { MaterialsPage } from './MaterialsPage';
import { QuizAttemptPage } from './QuizAttemptPage';
import { GradebookPage } from './GradebookPage';
import { ForumPage } from './ForumPage';

const TABS = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'materials', label: 'Materials', icon: FileText },
  { id: 'assignments', label: 'Assignments', icon: Calendar },
  { id: 'quizzes', label: 'Quizzes', icon: HelpCircle },
  { id: 'forum', label: 'Forum', icon: MessagesSquare },
  { id: 'grades', label: 'Grades', icon: Award },
];

export const CourseDetailPage = () => {
  const { courseId = '1' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'overview';

  const handleTabChange = (tabId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tabId);
      return next;
    });
  };

  // 1. Fetch Above-the-Fold Composite Shell Data in a single RTT
  const { 
    data: shellData, 
    isLoading, 
    error, 
    refetch 
  } = useQuery({
    queryKey: ['course-shell', courseId],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get(`/courses/${courseId}/shell`, { signal });
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const course = shellData?.course;
  const progressPercent = shellData?.progress?.percent ?? 45;
  const zoom = shellData?.zoom_session;
  const upcomingActivities = shellData?.upcoming_activities || [];
  const isDegraded = shellData?._degraded;

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-8 pb-16">
      {/* 1. Dynamic Breadcrumbs (Screen 2 in ui_template.jpeg) */}
      <nav aria-label="Course Breadcrumbs" className="text-xs font-semibold text-gray-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">
              Dashboard
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" />
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">
              My courses
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" />
          <li className="text-[#0a1142] font-bold" aria-current="page">
            {course?.code || 'CSC 204'}
          </li>
        </ol>
      </nav>

      {/* 2. Top Hero Card (Screen 2 in template) */}
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
            <p className="text-gray-300 mt-2 text-sm sm:text-base font-medium">
              {course?.units || 3} Units • {course?.level || 200} Level
            </p>
          </div>

          {/* Background Revalidation Indicator */}
          {isDegraded && (
            <div className="px-3.5 py-1.5 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-xs font-semibold flex items-center gap-2">
              <RefreshCw size={14} className="animate-spin text-amber-400" />
              <span>Syncing with Moodle in background...</span>
            </div>
          )}
        </div>
      </header>

      {/* 3. Navigation Tabs Bar (Screen 2 in template) */}
      <nav aria-label="Course Navigation Tabs" className="border-b border-gray-200">
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`
                  flex items-center gap-2 px-5 py-3 text-sm font-bold border-b-2 transition-all whitespace-nowrap
                  ${isActive 
                    ? 'border-[#0a1142] text-[#0a1142]' 
                    : 'border-transparent text-gray-500 hover:text-gray-900 hover:border-gray-300'}
                `}
              >
                <Icon size={16} className={isActive ? 'text-[#0a1142]' : 'text-gray-400'} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* 4. Tab Content Router */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Course Information & Description */}
          <div className="lg:col-span-2 space-y-6">
            <section className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-5">
              <h2 className="text-lg font-bold text-[#0a1142] font-display">
                Course Information
              </h2>
              <p className="text-sm text-gray-600 leading-relaxed">
                {course?.description || 
                  'This course covers fundamental data structures and algorithms including arrays, linked lists, stacks, queues, hash tables, balanced binary search trees, heaps, priority queues, and graph representations with Big-O time and space complexity evaluations.'}
              </p>

              {/* Join Zoom Meeting Button (Screen 2 matching) */}
              <div className="pt-3">
                <a
                  href={zoom?.join_url || 'https://zoom.us'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2.5 px-6 py-3 bg-[#0a1142] hover:bg-[#16258f] text-white rounded-xl font-bold text-sm shadow-md transition-all"
                >
                  <Video size={18} className="text-[#ffb81c]" />
                  <span>Join Zoom Meeting</span>
                  <ExternalLink size={14} className="text-gray-300" />
                </a>
                <p className="text-xs text-gray-400 mt-2">
                  Scheduled: {zoom?.schedule || 'Tuesdays & Thursdays • 10:00 AM - 12:00 PM'}
                </p>
              </div>
            </section>
          </div>

          {/* Right Column: Course Progress & Upcoming Activities */}
          <aside className="space-y-6">
            {/* Course Progress Card (Screen 2: 45%) */}
            <section className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[#0a1142]">Course Progress</h3>
                <span className="text-lg font-extrabold text-[#0a1142]">{progressPercent}%</span>
              </div>

              {/* Radial / Bar Progress Gauge */}
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden p-0.5">
                <div 
                  className="h-full bg-gradient-to-r from-[#0a1142] to-[#16258f] rounded-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              <p className="text-xs text-gray-500">
                You have completed 4 out of 9 core syllabus modules.
              </p>
            </section>

            {/* Upcoming Activities Card (Screen 2) */}
            <section className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-sm font-bold text-[#0a1142]">Upcoming Activities</h3>
                <span className="text-[11px] text-gray-500 font-medium">Headless Moodle</span>
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
                      to={act.link}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0a1142] text-[#ffb81c] hover:bg-[#16258f] shrink-0 transition-colors"
                    >
                      {act.action_label}
                    </Link>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      )}

      {/* Materials Tab (Screen 3: Learning Materials) */}
      {activeTab === 'materials' && (
        <section aria-label="Course Learning Materials" className="w-full">
          <MaterialsPage />
        </section>
      )}

      {/* Quizzes Tab (Screen 4: Quiz Attempt Engine) */}
      {activeTab === 'quizzes' && (
        <section aria-label="Course Assessment & Quizzes" className="w-full">
          <QuizAttemptPage />
        </section>
      )}

      {/* Gradebook Tab (Screen 6: Official Grade Matrix) */}
      {activeTab === 'grades' && (
        <section aria-label="Course Gradebook" className="w-full">
          <GradebookPage />
        </section>
      )}

      {/* Discussion Forum Tab (Screen 7: Academic Discourse) */}
      {activeTab === 'forum' && (
        <section aria-label="Course Discussion Forum" className="w-full">
          <ForumPage />
        </section>
      )}

      {/* Fallback for other modules (e.g. Assignments) */}
      {activeTab !== 'overview' && 
       activeTab !== 'materials' && 
       activeTab !== 'quizzes' && 
       activeTab !== 'grades' && 
       activeTab !== 'forum' && (
        <section className="bg-white rounded-2xl p-12 border border-gray-200 text-center space-y-4 shadow-sm">
          <div className="p-4 bg-blue-50 text-[#0a1142] rounded-full w-fit mx-auto">
            <Sparkles size={32} />
          </div>
          <h2 className="text-xl font-bold text-[#0a1142] font-display capitalize">
            {activeTab} Module
          </h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto">
            This module is synchronized with Headless Moodle Core. Access your scheduled assessments and activities directly.
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => handleTabChange('materials')}
              className="px-5 py-2.5 rounded-xl bg-[#0a1142] text-white text-xs font-bold"
            >
              Return to Learning Materials
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
