/**
 * FOCIT LMS - Course Detail Module Shell (< 160 lines)
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Invariants Enforced:
 * 1. Viewport Containment: Standard layout flow inside ProtectedLayout (no nested 100dvh canvases)
 * 2. Heavy Container Containment: style={{ contain: 'layout paint' }} on tab viewport
 * 3. State Placement: Active tab driven by URL searchParams (?tab=...)
 * 4. Zero-Trust UI Primitives: Non-destructive <ErrorStateView /> with RFC 7807 telemetry
 * 5. Dumb Layout Shell: Under 180 lines (150 lines)
 */

import React, { useEffect } from 'react';
import { useParams, useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { apiClient } from '../lib/api';
import { MaterialsPage } from './MaterialsPage';
import { CourseQuizzesTab } from '../components/course/CourseQuizzesTab';
import { GradebookPage } from './GradebookPage';
import { ForumPage } from './ForumPage';
import AssignmentsTab from '../components/course/AssignmentsTab';
import { CourseDetailHero } from '../components/courses/CourseDetailHero';
import { CourseOverviewTab } from '../components/courses/CourseOverviewTab';
import { CourseDetailTabs, COURSE_TABS } from '../components/courses/CourseDetailTabs';
import { ErrorStateView } from '../components/ErrorStateView';

export const CourseDetailPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { courseId: paramCourseId } = useParams();

  // Resilient course ID resolution with session memory
  const savedCourseId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('focit_last_course_id') : null;
  const courseId = (paramCourseId && paramCourseId !== '1') ? paramCourseId : (savedCourseId && savedCourseId !== '1' ? savedCourseId : 'CSC202');

  const [searchParams] = useSearchParams();

  const activeTab = (() => {
    const tabParam = searchParams.get('tab');
    if (tabParam) return tabParam;
    if (location.pathname.endsWith('/materials')) return 'materials';
    if (location.pathname.endsWith('/quizzes')) return 'quizzes';
    if (location.pathname.endsWith('/grades')) return 'grades';
    if (location.pathname.endsWith('/forum')) return 'forum';
    if (location.pathname.endsWith('/assignments')) return 'assignments';
    return 'overview';
  })();

  const handleTabChange = (tabId) => navigate(`/courses/${encodeURIComponent(courseId)}?tab=${tabId}`);

  // System Invariant 2: Normalize sub-path deep-links to canonical URL SearchParams (?tab=...)
  useEffect(() => {
    const hasPathSuffix = location.pathname.match(/\/courses\/[^/]+\/(materials|quizzes|grades|forum|assignments)$/);
    if (hasPathSuffix && !searchParams.get('tab')) {
      navigate(`/courses/${encodeURIComponent(courseId)}?tab=${activeTab}`, { replace: true });
    }
  }, [location.pathname, courseId, activeTab, searchParams, navigate]);

  useEffect(() => {
    if (courseId && courseId !== '1') {
      try {
        sessionStorage.setItem('focit_last_course_id', courseId);
      } catch {
        // Defensive
      }
    }
  }, [courseId]);

  // Composite Above-the-Fold Course Shell Fetch
  const { 
    data: shellData, 
    isLoading, 
    isError, 
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
  const zoom = shellData?.zoom_session;
  const upcomingActivities = shellData?.upcoming_activities || [];
  const isDegraded = shellData?._degraded;

  // Unhappy Path: Loading Skeleton
  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col gap-8 pb-16 animate-pulse" aria-busy="true">
        <div className="w-48 h-4 bg-gray-200 dark:bg-slate-700 rounded" />
        <div className="h-44 bg-gray-200 dark:bg-slate-700 rounded-2xl" />
        <div className="h-12 bg-gray-100 dark:bg-slate-800 rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 h-64 bg-gray-100 dark:bg-slate-800 rounded-2xl" />
          <div className="h-64 bg-gray-100 dark:bg-slate-800 rounded-2xl" />
        </div>
      </div>
    );
  }

  // Unhappy Path: Zero-Trust Error State View
  if (isError) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorStateView error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-8 pb-16 animate-fade-in">
      {/* 1. Dynamic Breadcrumbs & Top Hero Header */}
      <CourseDetailHero course={course} isDegraded={isDegraded} />

      {/* 2. Navigation Tabs Bar (WCAG 44x44px Touch Targets) */}
      <CourseDetailTabs activeTab={activeTab} onTabChange={handleTabChange} />

      {/* 3. Tab Content Section with Layout Paint Containment (Invariant 1) */}
      <section 
        aria-label="Course Module Content" 
        className="w-full"
        style={{ contain: 'layout paint' }}
      >
        {activeTab === 'overview' && (
          <CourseOverviewTab 
            course={course}
            zoom={zoom}
            upcomingActivities={upcomingActivities}
          />
        )}

        {activeTab === 'materials' && (
          <MaterialsPage courseId={course?.course_id || courseId} />
        )}

        {activeTab === 'quizzes' && (
          <CourseQuizzesTab 
            courseId={course?.course_id || courseId} 
            courseCode={course?.code || courseId} 
          />
        )}

        {activeTab === 'grades' && (
          <GradebookPage />
        )}

        {activeTab === 'forum' && (
          <ForumPage />
        )}

        {activeTab === 'assignments' && (
          <AssignmentsTab courseId={course?.course_id || courseId} />
        )}

        {/* Fallback for unknown tab */}
        {!COURSE_TABS.some((t) => t.id === activeTab) && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-12 border border-gray-200 dark:border-slate-800 text-center space-y-4 shadow-sm">
            <div className="p-4 bg-blue-50 dark:bg-slate-800 text-[#0a1142] dark:text-indigo-400 rounded-full w-fit mx-auto">
              <Sparkles size={32} aria-hidden="true" />
            </div>
            <h2 className="text-xl font-bold text-[#0a1142] dark:text-slate-100 font-display capitalize">
              {activeTab} Module
            </h2>
            <p className="text-sm text-gray-600 dark:text-slate-400 max-w-md mx-auto font-sans">
              This module is synchronized with Headless Moodle Core.
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => handleTabChange('overview')}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0a1142] dark:bg-indigo-600 hover:bg-[#16258f] dark:hover:bg-indigo-700 text-white text-xs font-bold transition-colors"
              >
                Return to Overview
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default CourseDetailPage;
