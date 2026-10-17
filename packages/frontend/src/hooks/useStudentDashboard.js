import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from './useNotifications';
import { apiClient } from '../lib/api';

/**
 * Student Dashboard Data and Telemetry Hook
 *
 * Implements:
 * 1. Authoritative Student Dashboard Aggregation from BFF (/api/student/dashboard)
 * 2. Real-time academic notification counter integration
 * 3. Registration completion flash message detection from router state
 * 4. Stale-While-Revalidate memory retention for fault-tolerant composite rendering
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function useStudentDashboard() {
  const { user } = useAuth();
  const location = useLocation();
  const studentId = user?.student_id || user?.username;
  const { unreadCount, notifications } = useNotifications();

  const {
    data: dashboardData,
    isLoading,
    isError,
    error,
    refetch,
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
  const zoomSession = dashboardData?.zoom_session || null;

  return {
    student,
    metrics,
    courses,
    upcomingActivities,
    zoomSession,
    unreadCount,
    notifications,
    registrationSuccess: location.state?.registrationSuccess,
    registeredUnits: location.state?.units,
    isLoading,
    isError,
    error,
    refetch,
  };
}

export default useStudentDashboard;
