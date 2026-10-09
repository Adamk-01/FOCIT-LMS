import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

/**
 * Fetches the expanded timetable from the BFF.
 * The BFF shields us from RRULE complexity using its Piscina worker pool and Redis cache.
 */
const fetchTimetable = async ({ queryKey, signal }) => {
  const [_key, courseId, weekStart] = queryKey;
  const query = weekStart ? `?weekStart=${encodeURIComponent(weekStart)}` : '';
  const response = await apiClient.get(`/timetable/${courseId}${query}`, { signal });
  return response.data;
};

/**
 * Custom React Query hook implementing the Zero-Trust Unhappy Path.
 * @param {string|number} courseId 
 * @param {string} weekStart - ISO date string (YYYY-MM-DD)
 */
export const useTimetable = (courseId, weekStart) => {
  return useQuery({
    queryKey: ['timetable', courseId, weekStart],
    queryFn: fetchTimetable,
    
    // Ensure we don't fire undefined requests on initial mount
    enabled: !!courseId && !!weekStart,
    
    // The RRULE expansion is highly deterministic and heavily cached on the BFF.
    // We mirror that caching strategy locally to save browser battery and network.
    staleTime: 1000 * 60 * 60 * 24, // 24 Hours
    
    retry: (failureCount, error) => {
      // DEFENSE: Respect the Cryptographic Boundary
      // Do not auto-retry on HTTP 401/403 authorization failures.
      // Let the error boundary and interceptors handle it immediately.
      if (error?.status && [401, 403].includes(error.status)) {
        return false;
      }
      // Standard retry heuristic for genuine 502s or network drops
      return failureCount < 3; 
    }
  });
};
