import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

async function getJson(path, signal) {
  const res = await apiClient.get(path, { signal });
  return res.data;
}

export function useLecturerOverview() {
  return useQuery({
    queryKey: ['lecturer-overview'],
    queryFn: async ({ signal }) => {
      const data = await getJson('/lecturer/overview', signal);
      return data;
    },
    staleTime: 60 * 1000,
  });
}

export function useLecturerCourses(semesterId) {
  return useQuery({
    queryKey: ['lecturer-courses', semesterId],
    queryFn: async ({ signal }) => {
      const q = semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : '';
      const data = await getJson(`/lecturer/courses${q}`, signal);
      return data?.courses ?? [];
    },
    staleTime: 60 * 1000,
  });
}

export function useLecturerCourseStudents(courseId, { semesterId, search, level } = {}) {
  return useQuery({
    queryKey: ['lecturer-course-students', courseId, semesterId, search, level],
    queryFn: async ({ signal }) => {
      if (!courseId) return null;
      const params = new URLSearchParams();
      if (semesterId) params.set('semesterId', semesterId);
      if (search) params.set('search', search);
      if (level) params.set('level', String(level));

      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const data = await getJson(`/lecturer/courses/${encodeURIComponent(courseId)}/students${queryStr}`, signal);
      return data;
    },
    enabled: Boolean(courseId),
    staleTime: 30 * 1000,
  });
}
