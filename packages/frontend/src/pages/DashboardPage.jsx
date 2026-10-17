import React from 'react';
import { useStudentDashboard } from '../hooks/useStudentDashboard';
import { DashboardHeroBanner } from '../components/dashboard/DashboardHeroBanner';
import { DashboardNotificationStrip } from '../components/dashboard/DashboardNotificationStrip';
import { DashboardMetricsGrid } from '../components/dashboard/DashboardMetricsGrid';
import { DashboardCoursesSection } from '../components/dashboard/DashboardCoursesSection';
import { DashboardUpcomingActivities } from '../components/dashboard/DashboardUpcomingActivities';
import { ErrorStateView } from '../components/ErrorStateView';
import { ErrorAlertCallout } from '../components/ErrorAlertCallout';

/**
 * Student Academic Dashboard Shell
 *
 * Implements:
 * 1. Pure Dumb Presentation Shell (<180 lines strictly enforced)
 * 2. Fault-Tolerant Composite Architecture with SWR Memory Retention
 * 3. Academic Hero Banner and Real-Time Notification Alert Ribbon
 * 4. Credit Units & GPA Standing Telemetry Cards
 * 5. Active Enrolled Modules and Today's Timetabled Live Lecture
 * 6. Minimum WCAG 44x44px Touch Targets on all Interactive Controls
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function DashboardPage() {
  const {
    student,
    metrics,
    courses,
    upcomingActivities,
    zoomSession,
    unreadCount,
    notifications,
    registrationSuccess,
    registeredUnits,
    isLoading,
    isError,
    error,
    refetch,
  } = useStudentDashboard();

  if (isError && !student) {
    return (
      <div className="max-w-7xl mx-auto py-12 px-4">
        <ErrorStateView
          title="Academic Dashboard Unavailable"
          message={error?.message || 'Could not load student dashboard records.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-8 pb-16">
      {/* 1. Flash Registration Alert & Unread Notification Ribbon */}
      <DashboardNotificationStrip
        registrationSuccess={registrationSuccess}
        registeredUnits={registeredUnits}
        unreadCount={unreadCount}
        notifications={notifications}
      />

      {/* 2. Header Hero Banner */}
      <DashboardHeroBanner
        fullName={student?.full_name || 'John Doe'}
        programme={student?.programme || 'Computer Science'}
        level={student?.level || 200}
        academicTerm={metrics?.academic_term || '2026/2027 Rain Semester'}
      />

      {/* 3. Non-blocking Inline Error Notice if Upstream Was Degraded */}
      {isError && (
        <ErrorAlertCallout
          error={error}
          onRetry={() => refetch()}
          className="text-xs"
        />
      )}

      {/* 4. Key Academic Telemetry Cards */}
      <DashboardMetricsGrid
        metrics={metrics}
        isLoading={isLoading}
      />

      {/* 5. Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <DashboardCoursesSection
            courses={courses}
            isLoading={isLoading}
          />
        </div>

        <div>
          <DashboardUpcomingActivities
            zoomSession={zoomSession}
            upcomingActivities={upcomingActivities}
          />
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
