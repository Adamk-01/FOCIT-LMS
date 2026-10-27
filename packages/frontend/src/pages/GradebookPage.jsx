import React from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useCourseGrades } from '../hooks/useCourseGrades';
import { GradebookHeader } from '../components/gradebook/GradebookHeader';
import { GradeSummaryCards } from '../components/gradebook/GradeSummaryCards';
import { GradebookTable } from '../components/gradebook/GradebookTable';
import { ErrorStateView } from '../components/ErrorStateView';

/**
 * Course Gradebook Report Presentation Shell
 *
 * Implements:
 * 1. Pure Dumb Presentation Shell (<180 lines strictly enforced)
 * 2. Official Academic Transcript Record Header with Letter Grade Gauge
 * 3. Weighted Score and Component Summary Telemetry
 * 4. Accessible Tabular Assessment Breakdown Matrix (Moodle-Synchronized)
 * 5. Minimum WCAG 44x44px Touch Targets on all Interactive Controls
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function GradebookPage() {
  const { user } = useAuth();
  const { courseId = 'CSC204' } = useParams();

  const {
    items,
    cumulativePercentage,
    overallLetter,
    courseCode,
    courseTitle,
    isLoading,
    isError,
    error,
    refetch,
  } = useCourseGrades({ courseId });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] dark:text-[#ffb81c] mx-auto" aria-hidden="true" />
        <p className="text-gray-600 dark:text-slate-400 font-medium">Aggregating gradebook items from Headless Moodle...</p>
      </div>
    );
  }

  if (isError && items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorStateView
          title="Grade Report Unavailable"
          message={error?.message || 'A network error occurred while aggregating your gradebook items.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* 1. Header Banner & Course Total Score Gauge */}
      <GradebookHeader
        courseId={courseId}
        courseCode={courseCode}
        courseTitle={courseTitle}
        studentName={user?.full_name || 'Enrolled Student'}
        studentMatric={user?.matric_number || user?.username || ''}
        overallLetter={overallLetter}
        cumulativePercentage={cumulativePercentage}
      />

      {/* 2. Performance Summary Cards */}
      <GradeSummaryCards
        cumulativePercentage={cumulativePercentage}
        gradedCount={items.length}
      />

      {/* 3. Accessible Tabular Gradebook Matrix */}
      <GradebookTable
        items={items}
        courseCode={courseCode}
        overallLetter={overallLetter}
        cumulativePercentage={cumulativePercentage}
      />
    </div>
  );
}

export default GradebookPage;
