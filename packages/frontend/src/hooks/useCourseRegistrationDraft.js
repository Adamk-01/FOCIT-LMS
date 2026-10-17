/**
 * FOCIT LMS - useCourseRegistrationDraft Hook
 *
 * Implements Doctrinal Invariant: Dual-State Sandbox Execution
 *
 * Requirements:
 * 1. Sandboxed in sessionStorage under: focit_reg_draft:${studentId}:${termId}
 * 2. Session Nonce Protection: If the sandbox's sessionNonce does not match the active session nonce,
 *    instantly purge the sandbox to prevent cybercafé session leakages across shared terminals.
 * 3. Reactive state synchronization between in-memory React state and sessionStorage.
 * 4. Zero global context pollution.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export function useCourseRegistrationDraft({
  studentId = 'student1',
  termId = '2026_RAIN',
  initialCourseIds = [],
  serverUpdatedAt = null,
  isLocked = false,
  batchStatus: _batchStatus = 'DRAFT',
}) {
  const activeNonce = typeof window !== 'undefined' ? sessionStorage.getItem('session_nonce') : null;
  const storageKey = `focit_reg_draft:${studentId}:${termId}`;
  const initialSyncRef = useRef(false);

  // Synchronous O(1) Initializer with Strict Cybercafé Nonce Verification & Causal Baseline Check
  const [selectedCourseIds, setSelectedCourseIds] = useState(() => {
    if (typeof window === 'undefined') return initialCourseIds;

    // Invariant: If batch is already locked (SUBMITTED / ADVISOR_APPROVED), purge local draft immediately
    if (isLocked) {
      sessionStorage.removeItem(storageKey);
      return initialCourseIds;
    }

    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return initialCourseIds;

      const parsed = JSON.parse(raw);
      // Strict Security Guard: Purge sandbox if session nonce doesn't match active session
      if (!parsed || !parsed.sessionNonce || parsed.sessionNonce !== activeNonce) {
        console.warn(
          `[RegistrationSandbox] Ephemeral session nonce mismatch or missing for key ${storageKey}. Purging untrusted cybercafé sandbox.`
        );
        sessionStorage.removeItem(storageKey);
        return initialCourseIds;
      }

      // Causal Baseline Pinning: Never compare client wall-clock against server NTP clock.
      // If a draft has an established baseline server timestamp and the server has mutated externally,
      // the baseline server timestamp differs from current serverUpdatedAt -> evict stale draft.
      if (serverUpdatedAt && parsed.baseServerUpdatedAt && parsed.baseServerUpdatedAt !== serverUpdatedAt) {
        console.info(
          `[RegistrationSandbox] Server state mutated externally (base=${parsed.baseServerUpdatedAt}, current=${serverUpdatedAt}). Overwriting local draft with authoritative server record.`
        );
        sessionStorage.removeItem(storageKey);
        return initialCourseIds;
      }

      if (Array.isArray(parsed.courseIds)) {
        return [...new Set(parsed.courseIds)];
      }

      return initialCourseIds;
    } catch (err) {
      console.error('[RegistrationSandbox] Failed to hydrate draft from sessionStorage:', err);
      sessionStorage.removeItem(storageKey);
      return initialCourseIds;
    }
  });

  // Reconcile when server batch items, lock status, or serverUpdatedAt changes
  useEffect(() => {
    if (isLocked) {
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(storageKey);
      }
      setSelectedCourseIds(initialCourseIds);
      return;
    }

    // Causal Baseline Verification: Check if server updated_at has mutated externally since draft was pinned
    if (serverUpdatedAt && typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.baseServerUpdatedAt && parsed.baseServerUpdatedAt !== serverUpdatedAt) {
            console.info(
              `[RegistrationSandbox] External server mutation detected (base=${parsed.baseServerUpdatedAt}, current=${serverUpdatedAt}). Resetting to authoritative server state.`
            );
            sessionStorage.removeItem(storageKey);
            setSelectedCourseIds(initialCourseIds);
            return;
          }
          // If draft was pinned prior to serverUpdatedAt arriving, pin it now
          if (!parsed.baseServerUpdatedAt) {
            parsed.baseServerUpdatedAt = serverUpdatedAt;
            sessionStorage.setItem(storageKey, JSON.stringify(parsed));
          }
        }
      } catch {
        // Defensive
      }
    }

    const hasStoredDraft = typeof window !== 'undefined' && Boolean(sessionStorage.getItem(storageKey));
    if (!initialSyncRef.current && !hasStoredDraft && initialCourseIds.length > 0) {
      initialSyncRef.current = true;
      setSelectedCourseIds(initialCourseIds);
    }
  }, [initialCourseIds, isLocked, serverUpdatedAt, storageKey]);

  // Persist reactive updates to sessionStorage with active sessionNonce signature and pinned baseServerUpdatedAt
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const currentNonce = sessionStorage.getItem('session_nonce');
      const payload = {
        studentId,
        termId,
        sessionNonce: currentNonce,
        courseIds: selectedCourseIds,
        baseServerUpdatedAt: serverUpdatedAt || null,
        pinnedAt: new Date().toISOString(),
      };
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (err) {
      console.warn('[RegistrationSandbox] Failed to persist sandbox update to sessionStorage:', err);
    }
  }, [selectedCourseIds, serverUpdatedAt, storageKey, studentId, termId]);

  // Toggle single course ID
  const toggleCourse = useCallback((courseId) => {
    setSelectedCourseIds((prev) => {
      const idStr = String(courseId).trim();
      if (prev.includes(idStr)) {
        return prev.filter((id) => id !== idStr);
      }
      return [...prev, idStr];
    });
  }, []);

  // Select all courses matching a list of IDs (e.g., all CORE courses)
  const setCourseSelection = useCallback((courseIds) => {
    const deduped = [...new Set(courseIds.map((id) => String(id).trim()))];
    setSelectedCourseIds(deduped);
  }, []);

  // Clear sandbox completely
  const clearDraft = useCallback(() => {
    setSelectedCourseIds([]);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Defensive
    }
  }, [storageKey]);

  return {
    selectedCourseIds,
    setSelectedCourseIds,
    toggleCourse,
    setCourseSelection,
    clearDraft,
    storageKey,
  };
}
