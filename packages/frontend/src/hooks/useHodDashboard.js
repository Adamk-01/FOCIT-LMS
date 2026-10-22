import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

/**
 * HOD Dashboard Data Controller Hooks
 * Synchronized with BFF endpoints under /api/hod/*.
 */

/**
 * Runtime-safe POST helper.
 * Uses apiClient.post / apiClient.request if they exist, otherwise falls
 * back to raw fetch replicating the app's own request contract
 * (credentials + ephemeral nonce header + JSON body).
 */
async function postJson(path, body) {
  if (typeof apiClient?.post === 'function') {
    return apiClient.post(path, body);
  }
  if (typeof apiClient?.request === 'function') {
    return apiClient.request(path, { method: 'POST', body });
  }

  const res = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'X-Session-Nonce':
        (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('session_nonce')) || '',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.detail = data.error;
    throw err;
  }
  return data;
}

async function getJson(path, signal) {
  const res = await apiClient.get(path, { signal });
  return res.data;
}

export function useHodAllocations(semesterId) {
  return useQuery({
    queryKey: ['hod-allocations', semesterId],
    queryFn: async ({ signal }) => {
      const q = semesterId ? `?semesterId=${encodeURIComponent(semesterId)}` : '';
      const data = await getJson(`/hod/allocations${q}`, signal);
      return data?.allocations ?? [];
    },
    staleTime: 30 * 1000,
  });
}

export function useHodEscalations() {
  return useQuery({
    queryKey: ['hod-escalations'],
    queryFn: async ({ signal }) => {
      const data = await getJson('/hod/clearance/escalations', signal);
      return data?.escalations ?? [];
    },
    refetchInterval: 15000,
    staleTime: 10 * 1000,
  });
}

export function useHodAnalytics() {
  return useQuery({
    queryKey: ['hod-analytics'],
    queryFn: async ({ signal }) => getJson('/hod/analytics', signal),
    staleTime: 60 * 1000,
  });
}

export function useHodMutations() {
  const queryClient = useQueryClient();

  const invalidateHod = () => {
    queryClient.invalidateQueries({ queryKey: ['hod-allocations'] });
    queryClient.invalidateQueries({ queryKey: ['hod-escalations'] });
  };

  const allocate = useMutation({
    mutationFn: (body) => postJson('/hod/allocations', body),
    onSuccess: invalidateHod,
  });

  const decide = useMutation({
    mutationFn: (body) => postJson('/hod/clearance/override', body),
    onSuccess: invalidateHod,
  });

  return { allocate, decide };
}
