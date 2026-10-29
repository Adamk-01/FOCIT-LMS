import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

/**
 * useAttendance Hook
 * Manages Mode 4 physical attendance ledger, scanning, lecturer verification desk, and 75% NUC eligibility.
 */
export function useAttendance(courseId) {
  const queryClient = useQueryClient();

  // 1. Fetch sessions for the course
  const sessionsQuery = useQuery({
    queryKey: ['attendance-sessions', courseId],
    queryFn: async () => {
      const res = await apiClient.get(`/attendance/courses/${courseId}/sessions`);
      return res.data;
    },
    enabled: Boolean(courseId),
    staleTime: 15 * 1000,
  });

  // 2. Fetch 75% NUC summary
  const summaryQuery = useQuery({
    queryKey: ['attendance-summary', courseId],
    queryFn: async () => {
      const res = await apiClient.get(`/attendance/courses/${courseId}/summary`);
      return res.data;
    },
    enabled: Boolean(courseId),
    staleTime: 30 * 1000,
  });

  // 3. Update records mutation
  const updateRecordsMutation = useMutation({
    mutationFn: async ({ sessionId, updates }) => {
      const res = await apiClient.put(`/attendance/sessions/${sessionId}/records`, { updates });
      return res.data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['attendance-session', vars.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['attendance-sessions', courseId] });
      queryClient.invalidateQueries({ queryKey: ['attendance-summary', courseId] });
    },
  });

  // 4. Lock session mutation
  const lockSessionMutation = useMutation({
    mutationFn: async ({ sessionId }) => {
      const res = await apiClient.post(`/attendance/sessions/${sessionId}/lock`);
      return res.data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['attendance-session', vars.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['attendance-sessions', courseId] });
      queryClient.invalidateQueries({ queryKey: ['attendance-summary', courseId] });
    },
  });

  // 5. Course Rep Upload Scanned Sheet mutation
  const uploadSheetMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post(`/attendance/courses/${courseId}/upload-scanned-sheet`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-sessions', courseId] });
      queryClient.invalidateQueries({ queryKey: ['attendance-summary', courseId] });
    },
  });

  return {
    sessions: sessionsQuery.data?.sessions || [],
    isLoadingSessions: sessionsQuery.isLoading,
    summary: summaryQuery.data,
    isLoadingSummary: summaryQuery.isLoading,
    updateRecordsMutation,
    lockSessionMutation,
    uploadSheetMutation,
    refetchAll: () => {
      sessionsQuery.refetch();
      summaryQuery.refetch();
    },
  };
}

/**
 * useAttendanceSessionDetails Hook
 * Fetches single attendance session with student records and photos for Verification Desk.
 */
export function useAttendanceSessionDetails(sessionId) {
  return useQuery({
    queryKey: ['attendance-session', sessionId],
    queryFn: async () => {
      const res = await apiClient.get(`/attendance/sessions/${sessionId}`);
      return res.data;
    },
    enabled: Boolean(sessionId),
    staleTime: 10 * 1000,
  });
}
