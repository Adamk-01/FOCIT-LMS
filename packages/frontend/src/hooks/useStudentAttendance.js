/**
 * FOCIT LMS - Student Attendance React Query Hooks
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. SWR Cache Management for Student Cumulative Attendance Telemetry
 * 2. Real-Time Active OTP Session Discovery with Polling
 * 3. Course Weekly Timeline Ingress (Zero Peer Leakage)
 * 4. Atomic OTP Check-In Mutation with Multi-Key Invalidation
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

/**
 * useStudentAttendanceSummary
 * Fetches overall attendance percentage, per-course NUC 75% standing, and deficit counts.
 */
export function useStudentAttendanceSummary() {
  return useQuery({
    queryKey: ['student-attendance-summary'],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get('/attendance/student/summary', { signal });
      return res.data;
    },
    staleTime: 30 * 1000, // 30s fresh epoch
    gcTime: 10 * 60 * 1000,
  });
}

/**
 * useStudentActiveSessions
 * Polls for live Mode 2 OTP sessions in enrolled courses where student has not yet checked in.
 */
export function useStudentActiveSessions(options = {}) {
  const { enabled = true, refetchInterval = 15000 } = options;

  return useQuery({
    queryKey: ['student-attendance-active-sessions'],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get('/attendance/student/active', { signal });
      return res.data?.activeSessions || [];
    },
    enabled,
    refetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 5 * 1000,
  });
}

/**
 * useCourseStudentAttendance
 * Retrieves individual student weekly attendance audit timeline for a specific course.
 */
export function useCourseStudentAttendance(courseId) {
  return useQuery({
    queryKey: ['course-student-attendance', courseId],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get(`/attendance/courses/${encodeURIComponent(courseId)}/student-attendance`, { signal });
      return res.data;
    },
    enabled: Boolean(courseId),
    staleTime: 15 * 1000,
    gcTime: 5 * 60 * 1000,
  });
}

/**
 * useSubmitOtpCheckIn
 * Submits student's 6-digit OTP passcode to claim attendance in an active session.
 */
export function useSubmitOtpCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ courseId, otp, sessionId }) => {
      const res = await apiClient.post(
        `/attendance/courses/${encodeURIComponent(courseId)}/sessions/otp/check-in`,
        { otp: String(otp).trim(), sessionId }
      );
      return res.data;
    },
    onSuccess: (data, variables) => {
      // Invalidate relevant query keys atomically
      queryClient.invalidateQueries({ queryKey: ['student-attendance-summary'] });
      queryClient.invalidateQueries({ queryKey: ['student-attendance-active-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['course-student-attendance', variables.courseId] });
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
    },
  });
}

