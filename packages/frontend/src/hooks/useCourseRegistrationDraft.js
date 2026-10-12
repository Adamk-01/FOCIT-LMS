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
}) {
  const activeNonce = typeof window !== 'undefined' ? sessionStorage.getItem('session_nonce') : null;
  const storageKey = `focit_reg_draft:${studentId}:${termId}`;
  const initialSyncRef = useRef(false);

  // Synchronous O(1) Initializer with Strict Cybercafé Nonce Verification
  const [selectedCourseIds, setSelectedCourseIds] = useState(() => {
    if (typeof window === 'undefined') return initialCourseIds;

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

      if (Array.isArray(parsed.courseIds) && parsed.courseIds.length > 0) {
        return [...new Set(parsed.courseIds)];
      }

      return initialCourseIds;
    } catch (err) {
      console.error('[RegistrationSandbox] Failed to hydrate draft from sessionStorage:', err);
      sessionStorage.removeItem(storageKey);
      return initialCourseIds;
    }
  });

  // Reconcile initial backend items if sandbox was empty on initial load
  useEffect(() => {
    if (!initialSyncRef.current && initialCourseIds.length > 0) {
      initialSyncRef.current = true;
      setSelectedCourseIds((current) => {
        if (current.length === 0) {
          return initialCourseIds;
        }
        return current;
      });
    }
  }, [initialCourseIds]);

  // Persist reactive updates to sessionStorage with active sessionNonce signature
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const currentNonce = sessionStorage.getItem('session_nonce');
      const payload = {
        studentId,
        termId,
        sessionNonce: currentNonce,
        courseIds: selectedCourseIds,
        lastModified: Date.now(),
      };
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (err) {
      console.warn('[RegistrationSandbox] Failed to persist sandbox update to sessionStorage:', err);
    }
  }, [selectedCourseIds, storageKey, studentId, termId]);

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
