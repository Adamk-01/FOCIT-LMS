/**
 * FOCIT LMS - useRegistrationWizard Hook (Milestone 3)
 *
 * Implements the Core Client-Side Academic Governance FSM:
 * 1. Dual-State Partitioning (Invariant 2):
 *    - Navigation progression (?step=1|2|3, ?filter=..., ?search=...) in URL SearchParams
 *    - Uncommitted draft in scoped sessionStorage sandbox (focit_reg_draft:${studentId}:${termId})
 * 2. Payload-Bound Idempotency Key Lifecycle:
 *    - Binds crypto.randomUUID() to canonical Dijkstra-sorted course fingerprint
 *    - Automatically invalidates previous key if candidate courses mutate
 * 3. Reactive Senate Credit Bounds ([15, 24] or [15, 27] with Dean's waiver)
 * 4. Authoritative composite integration with BFF endpoints:
 *    - GET /api/registration/current
 *    - PUT /api/registration/draft
 *    - POST /api/registration/submit (with Idempotency-Key & X-Idempotency-Key headers)
 */

import { useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { useCourseRegistrationDraft } from './useCourseRegistrationDraft.js';

const MIN_SENATE_CREDIT_FLOOR = 15;
const MAX_STANDARD_CREDIT_CEILING = 24;

/**
 * Resolves a cryptographically secure UUID v4 conforming to RFC 4122.
 * Defensively handles non-SecureContext environments (plain HTTP campus subnets: http://10.x.x.x)
 * where window.crypto.randomUUID is undefined per the W3C Web Crypto API specification.
 */
function safeRandomUUID() {
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    try {
      return window.crypto.randomUUID();
    } catch {
      // Insecure context or restricted sandbox fallback
    }
  }
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Fallback
    }
  }

  // W3C Web Crypto fallback via crypto.getRandomValues (RFC 4122 v4)
  const cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    // RFC 4122 section 4.4 variant & version bit manipulation
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Defensive fallback for non-crypto test harnesses
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Computes a deterministic canonical signature of the registration intent,
 * partitioned strictly by lifecycle action ('SAVE_DRAFT' vs 'FINALIZE') to satisfy Invariant 5.
 */
function computePayloadFingerprint(studentId, semesterId, action, courseIds) {
  const sortedCourses = [...courseIds].sort();
  return `${studentId}:${semesterId}:${action}:${sortedCourses.join(',')}`;
}

/**
 * Resolves an authoritative, payload-bound and action-partitioned idempotency token from sessionStorage
 */
function getOrGenerateIdempotencyKey(studentId, semesterId, action, currentCourseIds) {
  if (typeof window === 'undefined') return `reg_${safeRandomUUID()}`;
  const currentFingerprint = computePayloadFingerprint(studentId, semesterId, action, currentCourseIds);
  const storageKey = `focit_reg_idempotency:${studentId}:${semesterId}:${action}`;

  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw) {
      const cached = JSON.parse(raw);
      // Valid retry: exact same action and courses submitted within 5-minute validity window
      if (
        cached?.fingerprint === currentFingerprint &&
        cached?.key &&
        Date.now() - (cached.createdAt || 0) < 5 * 60 * 1000
      ) {
        return cached.key;
      }
    }
  } catch {
    // SessionStorage parse failure fallback
  }

  // Payload mutated (e.g. course swapped), action changed, or token expired:
  // Mint a fresh key and bind it strictly to the new action and fingerprint
  const newKey = `reg_${safeRandomUUID()}`;
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        key: newKey,
        fingerprint: currentFingerprint,
        createdAt: Date.now(),
      })
    );
  } catch {
    // SessionStorage quota fallback
  }

  return newKey;
}

export function useRegistrationWizard(studentId = 'student1') {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // 1. URL SearchParams Navigation Partitioning (?step=1|2|3, ?filter=..., ?search=...)
  const activeStep = useMemo(() => {
    const raw = parseInt(searchParams.get('step') || '1', 10);
    return raw >= 1 && raw <= 3 ? raw : 1;
  }, [searchParams]);

  const categoryFilter = useMemo(() => {
    return searchParams.get('filter') || 'ALL';
  }, [searchParams]);

  const searchQuery = useMemo(() => {
    return searchParams.get('search') || '';
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

  const setCategoryFilter = useCallback(
    (filter) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (filter === 'ALL') {
            next.delete('filter');
          } else {
            next.set('filter', filter);
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const setSearchQuery = useCallback(
    (query) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (!query.trim()) {
            next.delete('search');
          } else {
            next.set('search', query);
          }
          return next;
        },
        { replace: true }
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

  // Status flags
  const batchStatus = batch?.status || 'DRAFT';
  const isDraft = batchStatus === 'DRAFT';
  const isSubmitted = batchStatus === 'SUBMITTED';
  const isApproved = batchStatus === 'ADVISOR_APPROVED';
  const isRejected = batchStatus === 'REJECTED';
  const isLocked = isSubmitted || isApproved;
  const rejectionRemarks = batch?.rejection_remarks || null;

  // 3. Cybercafé-Secured Session Sandbox (focit_reg_draft:${studentId}:${termId})
  const termId = semester?.id || '2026_RAIN';
  const {
    selectedCourseIds,
    toggleCourse,
    setCourseSelection,
    clearDraft,
  } = useCourseRegistrationDraft({
    studentId,
    termId,
    initialCourseIds,
    serverUpdatedAt: batch?.updated_at || null,
    isLocked,
    batchStatus,
  });

  // 4. Reactive Curriculum & Cumulative Unit Bounds
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

  // 5. Select All Core Courses Helper
  const selectAllCore = useCallback(() => {
    const coreIds = eligibleCatalog
      .filter((c) => c.category === 'CORE')
      .map((c) => c.course_id);
    setCourseSelection([...new Set([...selectedCourseIds, ...coreIds])]);
  }, [eligibleCatalog, selectedCourseIds, setCourseSelection]);

  // 6. Save Draft Mutation (PUT /api/registration/draft) with Action-Scoped Idempotency
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey = getOrGenerateIdempotencyKey(studentId, termId, 'SAVE_DRAFT', selectedCourseIds);
      const res = await apiClient.put(
        '/registration/draft',
        {
          course_ids: selectedCourseIds,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
            'X-Idempotency-Key': idempotencyKey,
          },
        }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registration-current'] });
    },
  });

  // 7. Submit Final Registration Mutation with Action-Scoped Idempotency (FINALIZE)
  const submitMutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey = getOrGenerateIdempotencyKey(studentId, termId, 'FINALIZE', selectedCourseIds);
      const res = await apiClient.post(
        '/registration/submit',
        {
          course_ids: selectedCourseIds,
        },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
            'X-Idempotency-Key': idempotencyKey,
          },
        }
      );
      return res.data;
    },
    onSuccess: () => {
      // Evict draft sandbox and action-scoped idempotency keys upon authoritative commit
      clearDraft();
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(`focit_reg_idempotency:${studentId}:${termId}:FINALIZE`);
        sessionStorage.removeItem(`focit_reg_idempotency:${studentId}:${termId}:SAVE_DRAFT`);
      }
      queryClient.invalidateQueries({ queryKey: ['registration-current'] });
      queryClient.invalidateQueries({ queryKey: ['student-dashboard'] });
      setStep(1); // Return to step 1 which will now render clearance tracker
    },
  });

  return {
    // Stepper & URL Navigation
    activeStep,
    setStep,
    goToNextStep,
    goToPreviousStep,
    categoryFilter,
    setCategoryFilter,
    searchQuery,
    setSearchQuery,

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

export default useRegistrationWizard;
