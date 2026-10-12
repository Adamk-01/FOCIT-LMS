/**
 * FOCIT LMS - useRegistrationWizard Hook
 *
 * Implements the Core Client-Side Academic Governance FSM:
 * 1. Dual-State Sandbox:
 *    - URL SearchParams (?step=1|2|3) for browser history & shareability
 *    - SessionStorage sandbox with active session nonce signature
 * 2. Fetches authoritative registration state from BFF (GET /api/registration/current)
 * 3. Enforces Senate credit bounds [15, 24] (or 27 with Dean's waiver)
 * 4. Provides idempotent draft saving (PUT /api/registration/draft)
 * 5. Provides idempotent final submission (POST /api/registration/submit) with X-Idempotency-Key
 */

import { useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useCourseRegistrationDraft } from './useCourseRegistrationDraft';

const MIN_SENATE_CREDIT_FLOOR = 15;
const MAX_STANDARD_CREDIT_CEILING = 24;

export function useRegistrationWizard(studentId = 'student1') {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // 1. URL SearchParams Step Synchronization (?step=1|2|3)
  const activeStep = useMemo(() => {
    const raw = parseInt(searchParams.get('step') || '1', 10);
    return raw >= 1 && raw <= 3 ? raw : 1;
  }, [searchParams]);

  const setStep = useCallback(
    (stepNum) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('step', String(Math.max(1, Math.min(3, stepNum))));
          return next;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  const goToNextStep = useCallback(() => {
    setStep(activeStep + 1);
  }, [activeStep, setStep]);

  const goToPreviousStep = useCallback(() => {
    setStep(activeStep - 1);
  }, [activeStep, setStep]);

  // 2. Fetch Authoritative Registration State from BFF
  const {
    data: registrationData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['registration-current', studentId],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get('/registration/current', { signal });
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const student = registrationData?.student;
  const semester = registrationData?.semester;
  const batch = registrationData?.batch;
  const initialItems = registrationData?.items || [];
  const eligibleCatalog = useMemo(() => registrationData?.eligibleCatalog || [], [registrationData]);

  const initialCourseIds = useMemo(
    () => initialItems.map((item) => item.course_id),
    [initialItems]
  );

  // 3. Cybercafé-Secured Session Sandbox
  const termId = semester?.id || '2026_RAIN';
  const {
    selectedCourseIds,
    setSelectedCourseIds,
    toggleCourse,
    setCourseSelection,
    clearDraft,
  } = useCourseRegistrationDraft({
    studentId,
    termId,
    initialCourseIds,
  });

  // 4. Reactive Curriculum & Unit Calculation
  const selectedCourses = useMemo(() => {
    const set = new Set(selectedCourseIds);
    return eligibleCatalog.filter((c) => set.has(c.course_id));
  }, [eligibleCatalog, selectedCourseIds]);

  const totalSelectedUnits = useMemo(() => {
    return selectedCourses.reduce((sum, c) => sum + (c.units || 0), 0);
  }, [selectedCourses]);

  const maxCeiling = batch?.dean_waiver ? 27 : MAX_STANDARD_CREDIT_CEILING;
  const minFloor = MIN_SENATE_CREDIT_FLOOR;

  const isUnderMinimum = totalSelectedUnits < minFloor;
  const isOverMaximum = totalSelectedUnits > maxCeiling;
  const unitsDeficit = Math.max(0, minFloor - totalSelectedUnits);
  const unitsSurplus = Math.max(0, totalSelectedUnits - maxCeiling);

  // Status flags
  const batchStatus = batch?.status || 'DRAFT';
  const isDraft = batchStatus === 'DRAFT';
  const isSubmitted = batchStatus === 'SUBMITTED';
  const isApproved = batchStatus === 'ADVISOR_APPROVED';
  const isRejected = batchStatus === 'REJECTED';
  const isLocked = isSubmitted || isApproved;
  const rejectionRemarks = batch?.rejection_remarks || null;

  // 5. Select All Core Courses Helper
  const selectAllCore = useCallback(() => {
    const coreIds = eligibleCatalog
      .filter((c) => c.category === 'CORE')
      .map((c) => c.course_id);
    setCourseSelection([...new Set([...selectedCourseIds, ...coreIds])]);
  }, [eligibleCatalog, selectedCourseIds, setCourseSelection]);

  // 6. Save Draft Mutation (PUT /api/registration/draft)
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.put('/registration/draft', {
        course_ids: selectedCourseIds,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registration-current'] });
    },
  });

  // 7. Submit Final Registration Mutation (POST /api/registration/submit)
  const submitMutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey = `submit_${studentId}_${termId}_${Date.now()}`;
      const res = await apiClient.post(
        '/registration/submit',
        {
          course_ids: selectedCourseIds,
        },
        {
          headers: {
            'X-Idempotency-Key': idempotencyKey,
          },
        }
      );
      return res.data;
    },
    onSuccess: () => {
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ['registration-current'] });
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
      setStep(1); // Return to step 1 which will now render clearance tracker
    },
  });

  return {
    // Stepper
    activeStep,
    setStep,
    goToNextStep,
    goToPreviousStep,

    // Entities
    student,
    semester,
    batch,
    eligibleCatalog,
    selectedCourseIds,
    selectedCourses,

    // Status Flags
    batchStatus,
    isDraft,
    isSubmitted,
    isApproved,
    isRejected,
    isLocked,
    rejectionRemarks,

    // Credit Math
    totalSelectedUnits,
    minFloor,
    maxCeiling,
    isUnderMinimum,
    isOverMaximum,
    unitsDeficit,
    unitsSurplus,

    // Actions
    toggleCourse,
    selectAllCore,
    clearDraft,

    // Draft Mutation
    saveDraft: saveDraftMutation.mutate,
    isSavingDraft: saveDraftMutation.isPending,
    saveDraftSuccess: saveDraftMutation.isSuccess,
    saveDraftError: saveDraftMutation.error,

    // Submit Mutation
    submitRegistration: submitMutation.mutate,
    isSubmitting: submitMutation.isPending,
    submitSuccess: submitMutation.isSuccess,
    submitError: submitMutation.error,

    // Loading / Queries
    isLoading,
    isError,
    error,
    refetch,
  };
}
