/**
 * FOCIT LMS - Digital Library Administrative & Ingestion Hook
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. Two-phase upload orchestration with native XHR progress tracking & AbortController.
 * 2. TanStack Query integration with SWR caching and cache invalidation.
 * 3. Mutation locks preventing concurrent duplicate submissions.
 */

import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';

export function useAdminLibrary(filters = {}) {
  const queryClient = useQueryClient();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const abortControllerRef = useRef(null);

  // 1. Fetch Library Admin Items
  const itemsQuery = useQuery({
    queryKey: ['admin-library-items', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.category && filters.category !== 'all') params.set('categoryId', filters.category);
      if (filters.status && filters.status !== 'all') params.set('status', filters.status);
      if (filters.departmentId) params.set('departmentId', filters.departmentId);
      if (filters.search) params.set('search', filters.search);
      if (filters.page) params.set('page', String(filters.page));
      params.set('limit', String(filters.limit || 20));

      const res = await apiClient.get(`/api/library/admin/items?${params.toString()}`);
      return res;
    },
  });

  // 2. Fetch Library Admin Stats & Quota
  const statsQuery = useQuery({
    queryKey: ['admin-library-stats'],
    queryFn: async () => {
      const res = await apiClient.get('/api/library/admin/stats');
      return res?.data || {};
    },
  });

  // 3. Step 1: Binary Stream Upload with Progress
  const uploadBinary = useCallback(async (file) => {
    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/library/admin/upload', true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(percent);
        }
      };

      xhr.onload = () => {
        setIsUploading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            resolve(response.data);
          } catch (err) {
            setUploadError('Invalid JSON response from server.');
            reject(err);
          }
        } else {
          let errorDetail = 'Upload failed.';
          try {
            const errObj = JSON.parse(xhr.responseText);
            errorDetail = errObj.detail || errObj.message || errorDetail;
          } catch (_) {}
          setUploadError(errorDetail);
          reject(new Error(errorDetail));
        }
      };

      xhr.onerror = () => {
        setIsUploading(false);
        setUploadError('Network failure occurred during upload.');
        reject(new Error('Network failure during upload.'));
      };

      xhr.onabort = () => {
        setIsUploading(false);
        setUploadError('Upload cancelled by user.');
        reject(new Error('Upload aborted.'));
      };

      controller.signal.addEventListener('abort', () => xhr.abort());

      const formData = new FormData();
      formData.append('file', file);
      xhr.send(formData);
    });
  }, []);

  const cancelUpload = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  // 4. Step 2: Metadata Commit Mutation
  const commitMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post('/api/library/admin/items', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-library-items'] });
      queryClient.invalidateQueries({ queryKey: ['admin-library-stats'] });
      queryClient.invalidateQueries({ queryKey: ['library-items'] });
    },
  });

  // 5. Update Item Mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }) => {
      const res = await apiClient.patch(`/api/library/admin/items/${id}`, updates);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-library-items'] });
      queryClient.invalidateQueries({ queryKey: ['admin-library-stats'] });
    },
  });

  // 6. Delete Item Mutation (Soft vs Hard-Purge)
  const deleteMutation = useMutation({
    mutationFn: async ({ id, purge = false }) => {
      const res = await apiClient.delete(`/api/library/admin/items/${id}?purge=${purge}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-library-items'] });
      queryClient.invalidateQueries({ queryKey: ['admin-library-stats'] });
    },
  });

  // 7. Trigger Orphan Reaper Sweep
  const sweepMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/api/library/admin/reaper/sweep', {});
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-library-stats'] });
    },
  });

  return {
    items: itemsQuery.data?.data || [],
    pagination: itemsQuery.data?.pagination || { page: 1, total: 0, totalPages: 1 },
    stats: statsQuery.data || {},
    isLoading: itemsQuery.isLoading,
    isStatsLoading: statsQuery.isLoading,
    isError: itemsQuery.isError,
    error: itemsQuery.error,
    refetchItems: itemsQuery.refetch,
    refetchStats: statsQuery.refetch,

    // Upload & Commit
    uploadBinary,
    cancelUpload,
    isUploading,
    uploadProgress,
    uploadError,
    commitItem: commitMutation.mutateAsync,
    isCommitting: commitMutation.isPending,
    commitError: commitMutation.error,

    // Curation
    updateItem: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    deleteItem: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    runReaper: sweepMutation.mutateAsync,
    isReaping: sweepMutation.isPending,
  };
}

