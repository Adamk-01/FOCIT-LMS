import { useState, useMemo, useDeferredValue, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { useAuth } from './useAuth'; // ABAC context from JWT

export function useMaterials({ courseId, search }) {
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const { user } = useAuth(); // Extract department and level
  
  const activePdfAbortController = useRef(null);
  const deferredSearch = useDeferredValue(search || '');
  const isStale = search !== deferredSearch;

  // 1. Grid Initialization Fetch via React Query (24h Cache)
  const { data: rawData, isPending, isFetching, error } = useQuery({
    // ABAC Tenant Isolation: Prevent cross-tenant cache poisoning
    queryKey: ['materials', courseId, { dept: user?.department, level: user?.level }],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/courses/${courseId}/materials`, { signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const json = await response.json();
      return json.data;
    },
    enabled: !!courseId,
  });

  // 2. O(N) Memoized Local Filtering
  const filteredData = useMemo(() => {
    if (!rawData) return null;
    if (!deferredSearch) return rawData;
    
    const lowerQuery = deferredSearch.toLowerCase();
    return rawData.filter(m => m.title.toLowerCase().includes(lowerQuery));
  }, [rawData, deferredSearch]);

  // 3. Binary Fetcher with AbortController (Localized error isolation)
  const fetchPdfBinary = async (materialId) => {
    if (activePdfAbortController.current) {
      activePdfAbortController.current.abort(); // Kill previous race condition
    }
    
    activePdfAbortController.current = new AbortController();
    setIsPdfLoading(true);
    
    try {
      const response = await fetch(`/api/files/${materialId}`, {
        signal: activePdfAbortController.current.signal
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.arrayBuffer();
    } catch (err) {
      if (err.name !== 'AbortError') {
        toast.error("Failed to fetch secure document stream.");
        console.error("Binary fetch isolated:", err);
      }
      return null; // Localized error isolation without freezing UI
    } finally {
      setIsPdfLoading(false);
    }
  };

  return {
    data: filteredData,
    isPending,
    isFetching,
    error,
    isStale,
    fetchPdfBinary,
    isPdfLoading
  };
}
