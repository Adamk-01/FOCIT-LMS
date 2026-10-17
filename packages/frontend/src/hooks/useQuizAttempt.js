import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useQuizTimer } from './useQuizTimer';

/**
 * Resolves a cryptographically secure UUID v4 conforming to RFC 4122.
 * Defensively handles non-SecureContext environments (plain HTTP campus LANs).
 */
function safeRandomUUID() {
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    try {
      return window.crypto.randomUUID();
    } catch {
      // Insecure context fallback
    }
  }

  const cryptoObj = (typeof window !== 'undefined' && window.crypto) || (typeof crypto !== 'undefined' ? crypto : null);
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Derives a deterministic payload fingerprint and resolves a cached or fresh idempotency token.
 */
function getQuizIdempotencyKey(studentId, attemptId, answersArray) {
  if (typeof window === 'undefined') return `quiz_${safeRandomUUID()}`;

  const fingerprint = answersArray
    .map((a) => `${a.questionId}:${a.optionId}`)
    .sort()
    .join('|');
  const storageKey = `focit_quiz_idempotency:${studentId}:${attemptId}`;

  try {
    const cached = sessionStorage.getItem(storageKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (
        parsed?.fingerprint === fingerprint &&
        parsed?.key &&
        Date.now() - (parsed.createdAt || 0) < 10 * 60 * 1000
      ) {
        return parsed.key;
      }
    }
  } catch {
    // SessionStorage unavailable or parse error
  }

  const newKey = `quiz_${safeRandomUUID()}`;
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        key: newKey,
        fingerprint,
        createdAt: Date.now(),
      })
    );
  } catch {
    // Quota safe
  }
  return newKey;
}

/**
 * Quiz Attempt Controller Hook
 *
 * Implements:
 * 1. Authoritative Attempt Rehydration & Cristian's Clock Telemetry
 * 2. Scoped sessionStorage Sandbox (focit_quiz_draft:${studentId}:${attemptId})
 * 3. Two-Latch Mutex for Expiry Auto-Submit vs Manual Recovery Retries:
 *    - hasAutoSubmitFiredRef (one-shot expiry latch)
 *    - inFlightSubmitMutexRef (active mutation execution lock)
 * 4. URL SearchParams Question Navigation (?q=1..N via { replace: true })
 * 5. Debounced Relational Set-Difference Auto-Save Engine
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function useQuizAttempt({ quizId, attemptId, studentId }) {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Fetch Authoritative Quiz Attempt & Skew Context
  const {
    data: attemptData,
    isLoading,
    error: fetchError,
    refetch,
  } = useQuery({
    queryKey: ['quiz-attempt', quizId, attemptId],
    queryFn: async () => {
      const clientSend = Date.now();
      const res = await apiClient.get(`/quizzes/${quizId}/attempts/${attemptId}`);
      const clientReceive = Date.now();
      return {
        ...res.data,
        _telemetry: {
          clientSend,
          clientReceive,
          rtt: clientReceive - clientSend,
        },
      };
    },
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const attempt = attemptData?.attempt;
  const quiz = attemptData?.quiz;
  const questions = useMemo(() => attemptData?.questions || [], [attemptData?.questions]);
  const serverInitialAnswers = useMemo(() => attemptData?.answers || {}, [attemptData?.answers]);

  // Scoped sessionStorage Sandbox Key (Doctrine Invariant 4)
  const storageKey = useMemo(
    () => `focit_quiz_draft:${studentId}:${attemptId}`,
    [studentId, attemptId]
  );

  // Synchronously hydrate selected answers from scoped sessionStorage
  const [selectedAnswers, setSelectedAnswers] = useState(() => {
    if (typeof window === 'undefined') return {};
    try {
      const cached = sessionStorage.getItem(storageKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        return parsed.answers || {};
      }
    } catch {
      // Parse error fallback
    }
    return {};
  });

  // Reconcile server answers once loaded without overwriting newer local unsynced edits
  useEffect(() => {
    if (Object.keys(serverInitialAnswers).length > 0) {
      setSelectedAnswers((prev) => {
        const merged = { ...prev };
        for (const [qId, ans] of Object.entries(serverInitialAnswers)) {
          if (!merged[qId]) {
            merged[qId] = {
              optionId: ans.optionId,
              synced: true,
              updatedAt: ans.updatedAt || Date.now(),
            };
          }
        }
        return merged;
      });
    }
  }, [serverInitialAnswers]);

  // 2. URL SearchParams Question Navigation (?q=1..N via { replace: true })
  const activeQuestionIndex = useMemo(() => {
    if (questions.length === 0) return 0;
    const qParam = parseInt(searchParams.get('q') || '1', 10);
    if (isNaN(qParam) || qParam < 1) return 0;
    return Math.min(qParam - 1, questions.length - 1);
  }, [searchParams, questions.length]);

  const navigateToQuestion = useCallback(
    (index) => {
      const targetIndex = Math.max(0, Math.min(index, Math.max(0, questions.length - 1)));
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('q', String(targetIndex + 1));
          return next;
        },
        { replace: true }
      );
    },
    [questions.length, setSearchParams]
  );

  // 3. Online/Offline & Auto-Save Sync Engine
  const [syncStatus, setSyncStatus] = useState('SYNCED'); // 'SYNCED' | 'SAVING' | 'OFFLINE'
  const autoSaveTimeoutRef = useRef(null);
  const autoSaveAbortRef = useRef(null);

  const flushPendingAnswers = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setSyncStatus('OFFLINE');
      return;
    }

    try {
      const cached = sessionStorage.getItem(storageKey);
      if (!cached) return;
      const { answers = {} } = JSON.parse(cached);
      const unsyncedEntries = Object.entries(answers).filter(([, a]) => !a.synced);
      if (unsyncedEntries.length === 0) {
        setSyncStatus('SYNCED');
        return;
      }

      setSyncStatus('SAVING');
      const payload = unsyncedEntries.map(([qId, val]) => ({
        questionId: qId,
        optionId: val.optionId,
      }));

      autoSaveAbortRef.current = new AbortController();
      await apiClient.post(
        `/quizzes/${quizId}/attempts/${attemptId}/save`,
        { answers: payload },
        { signal: autoSaveAbortRef.current.signal }
      );

      // Mark synced in state & sessionStorage
      setSelectedAnswers((prev) => {
        const next = { ...prev };
        for (const [qId] of unsyncedEntries) {
          if (next[qId]) next[qId] = { ...next[qId], synced: true };
        }
        try {
          sessionStorage.setItem(storageKey, JSON.stringify({ answers: next }));
        } catch {}
        return next;
      });

      setSyncStatus('SYNCED');
    } catch (err) {
      if (err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
        setSyncStatus('OFFLINE');
      }
    }
  }, [storageKey, quizId, attemptId]);

  // Network online/offline event handlers
  useEffect(() => {
    const handleOnline = () => flushPendingAnswers();
    const handleOffline = () => setSyncStatus('OFFLINE');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [flushPendingAnswers]);

  // Option selection handler: Synchronous commit to sessionStorage + debounced sync
  const handleSelectOption = useCallback(
    (questionId, optionId) => {
      if (attempt?.status === 'SUBMITTED' || inFlightSubmitMutexRef.current) return;

      const nextAnswers = {
        ...selectedAnswers,
        [questionId]: {
          optionId,
          synced: false,
          updatedAt: Date.now(),
        },
      };

      setSelectedAnswers(nextAnswers);

      // Synchronous commit to scoped sessionStorage before network dispatch
      try {
        sessionStorage.setItem(storageKey, JSON.stringify({ answers: nextAnswers }));
      } catch {
        // Quota safe
      }

      // Debounced auto-save dispatch (600ms)
      if (autoSaveTimeoutRef.current) clearTimeout(autoSaveTimeoutRef.current);
      setSyncStatus('SAVING');
      autoSaveTimeoutRef.current = setTimeout(() => {
        flushPendingAnswers();
      }, 600);
    },
    [attempt?.status, selectedAnswers, storageKey, flushPendingAnswers]
  );

  // 4. Two-Latch Mutex for Expiry Auto-Submit vs Manual Recovery Retries
  const hasAutoSubmitFiredRef = useRef(false);
  const inFlightSubmitMutexRef = useRef(false);

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submissionReceipt, setSubmissionReceipt] = useState(null);
  const [submitError, setSubmitError] = useState(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Abort any pending background auto-save to eliminate race conditions
      if (autoSaveAbortRef.current) {
        autoSaveAbortRef.current.abort();
      }

      const answersArray = Object.entries(selectedAnswers).map(([qId, val]) => ({
        questionId: qId,
        optionId: val.optionId,
      }));

      const idempotencyKey = getQuizIdempotencyKey(studentId, attemptId, answersArray);

      const res = await apiClient.post(
        `/quizzes/${quizId}/attempts/${attemptId}/submit`,
        { answers: answersArray },
        {
          headers: {
            'Idempotency-Key': idempotencyKey,
          },
        }
      );
      return res.data;
    },
    onSuccess: (data) => {
      setSubmissionReceipt(data);
      setShowConfirmModal(false);
      setSubmitError(null);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {}
    },
    onError: (err) => {
      setSubmitError(err);
    },
  });

  const triggerSubmit = useCallback(async () => {
    // Hardware execution mutex: blocks frantic double-clicks while request is in-flight
    if (inFlightSubmitMutexRef.current || submitMutation.isPending) return;
    inFlightSubmitMutexRef.current = true;
    setSubmitError(null);

    try {
      await submitMutation.mutateAsync();
    } catch {
      // Mutation error handled in submitMutation.onError
    } finally {
      // Always release the execution mutex so retries and recovery buttons function
      inFlightSubmitMutexRef.current = false;
    }
  }, [submitMutation]);

  // One-shot timer auto-submission trigger
  const handleTimerExpire = useCallback(() => {
    // If one-shot latch has already fired, prevent infinite loop
    if (hasAutoSubmitFiredRef.current) return;
    hasAutoSubmitFiredRef.current = true;

    // Immediately trigger submission
    triggerSubmit();
  }, [triggerSubmit]);

  const timerRef = useRef(null);

  // Authoritative wake heartbeat to re-anchor server clock
  const handleWakeHeartbeat = useCallback(async () => {
    try {
      const clientSend = Date.now();
      const res = await apiClient.get(`/quizzes/${quizId}/attempts/${attemptId}`);
      const clientReceive = Date.now();
      const freshAttempt = res.data?.attempt;
      if (freshAttempt?.serverNow) {
        const freshRtt = clientReceive - clientSend;
        timerRef.current?.reanchor(freshAttempt.serverNow, freshRtt);
      }
    } catch {
      // Silently ignore network hiccup during wake heartbeat
    }
  }, [quizId, attemptId]);

  // 5. Monotonic Countdown Timer Hook
  const timer = useQuizTimer({
    dueAt: attempt?.dueAt,
    serverNow: attempt?.serverNow,
    telemetry: attemptData?._telemetry,
    onExpire: handleTimerExpire,
    onWakeHeartbeat: handleWakeHeartbeat,
  });

  useEffect(() => {
    timerRef.current = timer;
  }, [timer]);

  const isFinalized = attempt?.status === 'SUBMITTED' || Boolean(submissionReceipt);
  const activeQuestion = questions[activeQuestionIndex] || questions[0];
  const activeAnswer = activeQuestion ? selectedAnswers[activeQuestion.id]?.optionId : null;
  const answeredCount = useMemo(() => Object.keys(selectedAnswers).length, [selectedAnswers]);

  return {
    attemptData,
    attempt,
    quiz,
    questions,
    isLoading,
    fetchError,
    refetch,
    selectedAnswers,
    handleSelectOption,
    answeredCount,
    syncStatus,
    flushPendingAnswers,
    currentQuestionIndex: activeQuestionIndex,
    activeQuestion,
    activeAnswer,
    navigateToQuestion,
    timer,
    showConfirmModal,
    setShowConfirmModal,
    isSubmitting: submitMutation.isPending,
    submitError,
    submissionReceipt,
    isFinalized,
    triggerSubmit,
  };
}

export default useQuizAttempt;
