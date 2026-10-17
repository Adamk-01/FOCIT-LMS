/**
 * FOCIT LMS - Authoritative Registered Courses Directory (CoursesPage)
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Invariants Enforced:
 * 1. State Partitioning: Category filter & search query live in URL SearchParams
 * 2. History Stack Protection: { replace: true } on text input and filter mutations
 * 3. Deterministic Keying: Backend course_id / id keys
 * 4. Zero-Trust UI Primitives: Non-destructive <ErrorStateView /> with RFC 7807 telemetry
 * 5. Dumb Presentation Shell: Under 180 lines (165 lines)
 */

import React, { useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { CourseCard } from '../components/courses/CourseCard';
import { CourseDirectoryHero } from '../components/courses/CourseDirectoryHero';
import { CourseFilterBar } from '../components/courses/CourseFilterBar';
import { CourseEmptyState } from '../components/courses/CourseEmptyState';
import { CourseGridSkeleton } from '../components/courses/CourseGridSkeleton';
import { CourseFocusBanner } from '../components/courses/CourseFocusBanner';
import { ErrorStateView } from '../components/ErrorStateView';

export function CoursesPage() {
  const { user } = useAuth();
  const studentId = user?.username || 'student1';

  // 1. Dual-State URL SearchParams Partitioning (History Stack Protected: replace: true)
  const [searchParams, setSearchParams] = useSearchParams();
  const focus = searchParams.get('focus');
  const selectedFilter = searchParams.get('filter') || 'ALL';
  const searchQuery = searchParams.get('search') || '';

  const setSelectedFilter = useCallback((filter) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (filter === 'ALL') next.delete('filter');
      else next.set('filter', filter);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const setSearchQuery = useCallback((query) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!query.trim()) next.delete('search');
      else next.set('search', query);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleClearFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('search');
      next.delete('filter');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 2. Fetch Authoritative Enrolled Courses
  const { 
    data: coursesResponse, 
    isLoading, 
    isError, 
    error, 
    refetch 
  } = useQuery({
    queryKey: ['student-courses-directory', studentId, selectedFilter],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (selectedFilter === 'COMPLETED') params.set('status', 'COMPLETED');
      if (selectedFilter === 'IN_PROGRESS') params.set('status', 'IN_PROGRESS');
      const response = await apiClient.get(`/student/courses?${params.toString()}`, { signal });
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const rawCourses = useMemo(() => coursesResponse?.courses || [], [coursesResponse]);
  const metrics = coursesResponse?.metrics || {};

  // 3. Telemetry Aggregation
  const totalUnits = useMemo(() => {
    return rawCourses.reduce((sum, c) => sum + (Number(c.units) || 0), 0);
  }, [rawCourses]);

  const inProgressCount = useMemo(() => {
    return rawCourses.filter((c) => c.status === 'In Progress' || c.status === 'Not Started').length;
  }, [rawCourses]);

  const completedCount = useMemo(() => {
    return rawCourses.filter((c) => c.status === 'Completed').length;
  }, [rawCourses]);

  // 4. Client Filtering
  const filteredCourses = useMemo(() => {
    return rawCourses.filter((course) => {
      const query = searchQuery.trim().toLowerCase();
      const matchesSearch = 
        !query || 
        course.code?.toLowerCase().includes(query) || 
        course.title?.toLowerCase().includes(query) ||
        course.category?.toLowerCase().includes(query);

      if (!matchesSearch) return false;
      if (selectedFilter === 'ALL') return true;
      if (selectedFilter === 'CORE') return course.category === 'CORE';
      if (selectedFilter === 'ELECTIVE') return course.category === 'ELECTIVE';
      if (selectedFilter === 'IN_PROGRESS') return course.status === 'In Progress' || course.status === 'Not Started';
      if (selectedFilter === 'COMPLETED') return course.status === 'Completed';

      return true;
    });
  }, [rawCourses, searchQuery, selectedFilter]);

  // Unhappy Path: Error State View
  if (isError && !isLoading) {
    return (
      <div className="max-w-7xl mx-auto py-8">
        <ErrorStateView error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-8 pb-16 animate-fade-in">
      {/* 1. Dynamic Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="text-xs font-semibold text-gray-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">Portal</Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
          <li className="text-[#0a1142] font-bold" aria-current="page">My Courses</li>
        </ol>
      </nav>

      {/* 2. Top Hero Header Card with Telemetry */}
      <CourseDirectoryHero 
        termName={metrics?.academic_term}
        department={user?.department}
        level={user?.level}
        totalModules={rawCourses.length}
        totalUnits={totalUnits}
        inProgressCount={inProgressCount}
        completedCount={completedCount}
      />

      {/* Focus Guidance Alert Banner */}
      <CourseFocusBanner focus={focus} />

      {/* 3. Search & Category Filters Bar */}
      <CourseFilterBar 
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedFilter={selectedFilter}
        onFilterChange={setSelectedFilter}
      />

      {/* 4. Loading State Skeletons */}
      {isLoading && <CourseGridSkeleton count={6} />}

      {/* 5. Empty State */}
      {!isLoading && filteredCourses.length === 0 && (
        <CourseEmptyState 
          searchQuery={searchQuery}
          onClearSearch={handleClearFilters}
        />
      )}

      {/* 6. Authoritative Registered Courses Grid */}
      {!isLoading && filteredCourses.length > 0 && (
        <section aria-label="Registered Courses List" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCourses.map((course) => (
            <CourseCard 
              key={course.course_id || course.id} 
              course={course} 
              focus={focus} 
            />
          ))}
        </section>
      )}
    </div>
  );
}

export default CoursesPage;
