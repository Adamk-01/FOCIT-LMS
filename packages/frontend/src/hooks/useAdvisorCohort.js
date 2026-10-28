import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

/**
 * Level Advisor Cohort Review Controller Hook
 *
 * Implements:
 * 1. Synchronized URL SearchParams filtering (?level=200&status=SUBMITTED with { replace: true })
 * 2. Multi-Select Batch State with Actionable Partitioning (only SUBMITTED batches)
 * 3. Bulk Endorsement Mutex Mutation (POST /api/registration/advisor/batch-approve)
 * 4. Rejection Mutation with CAS Version Lock & Mandatory Senate Remarks (POST /api/registration/advisor/reject)
 * 5. Deterministic Query Cache Invalidation on Commit
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function useAdvisorCohort() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // 1. URL State Synchronization (?level=200&status=SUBMITTED)
  const selectedLevel = searchParams.get('level') || '200';
  const selectedStatus = searchParams.get('status') || 'SUBMITTED';

  const setSelectedLevel = useCallback(
    (lvl) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('level', lvl);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setSelectedStatus = useCallback(
    (st) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('status', st);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // 2. Fetch Cohort Data from BFF
  const {
    data: cohortData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['advisor-cohort', selectedLevel, selectedStatus],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (selectedLevel) params.append('level', selectedLevel);
      if (selectedStatus && selectedStatus !== 'ALL') params.append('status', selectedStatus);

      const res = await apiClient.get(`/registration/advisor/cohort?${params.toString()}`, {
        signal,
      });
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const cohort = useMemo(() => cohortData?.cohort || [], [cohortData]);
  const semester = cohortData?.semester;

  // 3. Multi-Select State
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);

  const handleToggleBatch = useCallback((batchId) => {
    setSelectedBatchIds((prev) =>
      prev.includes(batchId) ? prev.filter((id) => id !== batchId) : [...prev, batchId]
    );
  }, []);

  const handleSelectAll = useCallback(() => {
    const actionable = cohort.filter((b) => b.status === 'SUBMITTED').map((b) => b.batch_id);
    setSelectedBatchIds((prev) => (prev.length === actionable.length ? [] : actionable));
  }, [cohort]);

  // 4. Modal and Drawer States
  const [inspectingBatch, setInspectingBatch] = useState(null);
  const [rejectionTarget, setRejectionTarget] = useState(null);
  const [rejectionRemarks, setRejectionRemarks] = useState('');
  const [rejectionError, setRejectionError] = useState(null);

  // 5. Bulk Approval Mutation
  const batchApproveMutation = useMutation({
    mutationFn: async (batchIds) => {
      const res = await apiClient.post('/registration/advisor/batch-approve', {
        batch_ids: batchIds,
      });
      return res.data;
    },
    onSuccess: () => {
      setSelectedBatchIds([]);
      queryClient.invalidateQueries({ queryKey: ['advisor-cohort'] });
    },
  });

  // 6. Rejection Mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ batchId, remarks, expectedVersion }) => {
      const res = await apiClient.post('/registration/advisor/reject', {
        batch_id: batchId,
        remarks,
        expected_version: expectedVersion,
      });
      return res.data;
    },
    onSuccess: () => {
      setRejectionTarget(null);
      setRejectionRemarks('');
      setRejectionError(null);
      queryClient.invalidateQueries({ queryKey: ['advisor-cohort'] });
    },
    onError: (err) => {
      setRejectionError(
        err?.response?.data?.error || err.message || 'Failed to reject registration.'
      );
    },
  });

  const handleOpenRejection = useCallback((batch) => {
    setRejectionTarget(batch);
    setRejectionRemarks('');
    setRejectionError(null);
  }, []);

  const handleConfirmRejection = useCallback(() => {
    if (!rejectionRemarks || rejectionRemarks.trim().length < 5) {
      setRejectionError('Rejection remarks must be at least 5 characters for Senate audit logging.');
      return;
    }
    if (!rejectionTarget) return;

    rejectMutation.mutate({
      batchId: rejectionTarget.batch_id,
      remarks: rejectionRemarks.trim(),
      expectedVersion: rejectionTarget.version,
    });
  }, [rejectionRemarks, rejectionTarget, rejectMutation]);

  const isActionLocked = batchApproveMutation.isPending || rejectMutation.isPending;

  return {
    cohort,
    semester,
    isLoading,
    isError,
    error,
    refetch,
    selectedLevel,
    setSelectedLevel,
    selectedStatus,
    setSelectedStatus,
    selectedBatchIds,
    setSelectedBatchIds,
    handleToggleBatch,
    handleSelectAll,
    inspectingBatch,
    setInspectingBatch,
    rejectionTarget,
    setRejectionTarget,
    rejectionRemarks,
    setRejectionRemarks,
    rejectionError,
    handleOpenRejection,
    handleConfirmRejection,
    batchApproveMutation,
    rejectMutation,
    isActionLocked,
  };
}

export default useAdvisorCohort;
