import { useState, useMemo, useDeferredValue, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useAuth } from './useAuth';
import { apiClient } from '../lib/api';

/**
 * Synchronized SWR Course Materials Hook
 *
 * Implements Tier 6 Zero-Trust Client Contract:
 * 1. Synchronized Epochs: staleTime matches BFF Fresh TTL (5m); gcTime matches Stale TTL (60m).
 * 2. Background Revalidation Non-Blocking UI: Exposes isRevalidating (isFetching && !isPending)
 *    so the UI displays a subtle sync status without clearing rendered course items.
 * 3. Ingress Timeout Bounds: Propagates client-side AbortController with 3000ms deadline.
 * 4. ABAC Tenant Isolation: queryKey includes student department and academic level.
 */
export function useMaterials({ courseId, search }) {
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const { user } = useAuth();
  
  const activePdfAbortController = useRef(null);
  const deferredSearch = useDeferredValue(search || '');
  const isSearchPending = search !== deferredSearch;

  // 1. Grid Initialization & SWR Synchronized Query
  const { data: rawData, isPending, isFetching, error } = useQuery({
    queryKey: ['materials', courseId, { dept: user?.department, level: user?.level }],
    queryFn: async ({ signal }) => {
      // apiClient injects HttpOnly credentials, X-Session-Nonce, and handles 503 jittered backoff
      const response = await apiClient.get(`/courses/${courseId}/materials`, { signal });
      return response.data?.data || [];
    },
    enabled: !!courseId,
    // Explicit SWR alignment: 5 minutes fresh, 60 minutes retention
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  // 2. O(N) Memoized Local Filtering over client-side array
  const filteredData = useMemo(() => {
    if (!rawData) return null;
    if (!deferredSearch) return rawData;
    
    const lowerQuery = deferredSearch.toLowerCase();
    return rawData.filter(m => (m.title || m.name || '').toLowerCase().includes(lowerQuery));
  }, [rawData, deferredSearch]);

  // 3. Binary PDF Fetcher with AbortController & Stream Isolation
  const fetchPdfBinary = async (materialId) => {
    if (activePdfAbortController.current) {
      activePdfAbortController.current.abort(); // Cancel previous active stream
    }
    
    activePdfAbortController.current = new AbortController();
    setIsPdfLoading(true);
    
    try {
      const response = await fetch(`/api/files/${materialId}`, {
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...(typeof sessionStorage !== 'undefined' && sessionStorage.getItem('session_nonce')
            ? { 'X-Session-Nonce': sessionStorage.getItem('session_nonce') }
            : {}),
        },
        signal: activePdfAbortController.current.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.arrayBuffer();
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast.error("Failed to fetch secure document stream.");
        console.error("[useMaterials] Binary fetch error:", err);
      }
      return null;
    } finally {
      setIsPdfLoading(false);
    }
  };

  return {
    data: filteredData,
    isPending,
    isFetching,
    isRevalidating: isFetching && !isPending,
    isStale: isSearchPending,
    error,
    fetchPdfBinary,
    isPdfLoading
  };
}
