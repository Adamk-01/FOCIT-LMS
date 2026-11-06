import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../lib/api';

const OS_INTERRUPT_GRACE_MS = 15_000; // 15s grace window for incoming call / battery modal

/**
 * Evaluates whether the current browser/device supports standard WHATWG Fullscreen API
 * on arbitrary DOM elements. Returns false on iPhone Safari to avoid infinite modal locks.
 */
export function isFullscreenSupported() {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.fullscreenEnabled ||
    document.webkitFullscreenEnabled ||
    document.mozFullScreenEnabled ||
    document.msFullscreenEnabled
  );
}

/**
 * Anti-Cheat Soft-Lockdown & Proctoring Hook
 *
 * Implements:
 * 1. Automatic initial fullscreen requirement (NEEDS_FULLSCREEN gate) for supported viewports
 * 2. Progressive degradation for iOS Safari / unsupported mobile browsers (CSS 100dvh lock + passive monitoring)
 * 3. Two-strike fullscreen enforcement policy (Summative exams only):
 *    - Strike 1: Warning modal (SUSPENDED_AWAY)
 *    - Strike 2: Automatic assessment submission (AUTO_SUBMITTING)
 * 4. Ephemeral OS interrupt grace window (15s for incoming cellular calls)
 * 5. Telemetry event queue with offline retry resilience
 * 6. Telemetry flush suspension during active submission to eliminate DB row-lock contention
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function useAntiCheat({
  quizId,
  attemptId,
  enabled = true,
  initialFullscreenExits = 0,
  restoredExits,
  isSubmitting = false,
  onViolationAutoSubmit,
}) {
  const rawRestoredExits = Number(restoredExits ?? initialFullscreenExits);
  const effectiveInitialExits =
    Number.isFinite(rawRestoredExits) && rawRestoredExits > 0
      ? Math.floor(rawRestoredExits)
      : 0;

  const [lockdownState, setLockdownState] = useState(() => {
    if (!enabled) return 'ACTIVE';
    if (!isFullscreenSupported()) return 'ACTIVE';
    if (effectiveInitialExits >= 2) return 'AUTO_SUBMITTING';
    if (effectiveInitialExits === 1) return 'SUSPENDED_AWAY';
    if (typeof document !== 'undefined' && !document.fullscreenElement) {
      return 'NEEDS_FULLSCREEN';
    }
    return 'ACTIVE';
  });

  const [isFullscreen, setIsFullscreen] = useState(() => {
    if (!enabled || !isFullscreenSupported()) return true;
    return typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : true;
  });

  const [infractionCount, setInfractionCount] = useState(0);
  const [fullscreenExits, setFullscreenExits] = useState(effectiveInitialExits);

  const fullscreenExitCountRef = useRef(effectiveInitialExits);
  const hasAutoSubmittedViolationRef = useRef(effectiveInitialExits >= 2);
  const blurStartRef = useRef(null);
  const graceTimerRef = useRef(null);
  const telemetryQueueRef = useRef([]);
  const isFlushingRef = useRef(false);
  const isUnloadingRef = useRef(false);
  const unloadResetTimerRef = useRef(null);

  // Synchronize persisted strike counter on server rehydration
  useEffect(() => {
    if (effectiveInitialExits > 0 && fullscreenExitCountRef.current < effectiveInitialExits) {
      fullscreenExitCountRef.current = effectiveInitialExits;
      setFullscreenExits(effectiveInitialExits);
      if (effectiveInitialExits >= 2 && !hasAutoSubmittedViolationRef.current) {
        hasAutoSubmittedViolationRef.current = true;
        setLockdownState('AUTO_SUBMITTING');
        if (typeof onViolationAutoSubmit === 'function') {
          onViolationAutoSubmit('FULLSCREEN_VIOLATION_AUTO_SUBMIT');
        }
      } else if (effectiveInitialExits === 1 && lockdownState === 'ACTIVE') {
        setLockdownState('SUSPENDED_AWAY');
      }
    }
  }, [effectiveInitialExits, lockdownState, onViolationAutoSubmit]);

  // Flush queued telemetry events to BFF with offline retry resilience
  const flushTelemetry = useCallback(async () => {
    // Suspend background telemetry if submitting, disabled, or already flushing
    if (isFlushingRef.current || telemetryQueueRef.current.length === 0 || !enabled || isSubmitting) {
      return;
    }

    isFlushingRef.current = true;
    const batch = telemetryQueueRef.current.splice(0, 15);

    try {
      await apiClient.post(`/quizzes/${quizId}/attempts/${attemptId}/telemetry`, {
        events: batch,
      });
    } catch {
      // Re-queue at head if campus network dropped
      telemetryQueueRef.current.unshift(...batch);
    } finally {
      isFlushingRef.current = false;
    }
  }, [quizId, attemptId, enabled, isSubmitting]);

  const queueEvent = useCallback(
    (type, startMs, durationMs = 0) => {
      telemetryQueueRef.current.push({
        type,
        start_ms: startMs,
        duration_ms: durationMs,
      });
      flushTelemetry();
    },
    [flushTelemetry]
  );

  // Request Fullscreen (must be invoked from a direct user tap handler)
  const enterFullscreenProctoring = useCallback(async () => {
    if (!enabled) {
      setLockdownState('ACTIVE');
      return;
    }

    if (!isFullscreenSupported()) {
      setIsFullscreen(true);
      setLockdownState('ACTIVE');
      return;
    }

    try {
      if (!document.fullscreenElement) {
        const el = document.documentElement;
        const rfs =
          el.requestFullscreen ||
          el.webkitRequestFullscreen ||
          el.mozRequestFullScreen ||
          el.msRequestFullscreen;
        if (rfs) {
          await rfs.call(el);
        }
      }
      setIsFullscreen(true);
      if (lockdownState !== 'AUTO_SUBMITTING') {
        setLockdownState('ACTIVE');
      }
    } catch {
      // Fallback for iOS Safari / restricted environments
      setIsFullscreen(true);
      if (lockdownState !== 'AUTO_SUBMITTING') {
        setLockdownState('ACTIVE');
      }
    }
  }, [enabled, lockdownState]);

  useEffect(() => {
    if (!enabled || !quizId || !attemptId || isSubmitting) {
      if (!enabled) {
        setLockdownState('ACTIVE');
      }
      return undefined;
    }

    // Check on mount if fullscreen is missing (only on browsers supporting native fullscreen)
    if (isFullscreenSupported() && !document.fullscreenElement && lockdownState === 'ACTIVE') {
      setLockdownState('NEEDS_FULLSCREEN');
    }

    // 1. Signal B: Visibility Change (Tab switch / Browser minimize)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (graceTimerRef.current) {
          clearTimeout(graceTimerRef.current);
          graceTimerRef.current = null;
        }
        blurStartRef.current = Date.now();
        if (lockdownState !== 'AUTO_SUBMITTING') {
          setLockdownState('SUSPENDED_AWAY');
        }
        setInfractionCount((c) => c + 1);
      } else if (document.visibilityState === 'visible' && blurStartRef.current) {
        const duration = Date.now() - blurStartRef.current;
        queueEvent('TAB_HIDDEN', blurStartRef.current, duration);
        blurStartRef.current = null;
      }
    };

    // 2. Signal A: Window Blur while Document remains Visible (OS Modal / Incoming Call)
    const handleWindowBlur = () => {
      if (document.visibilityState !== 'visible') return; // Handled by Signal B

      blurStartRef.current = Date.now();
      if (lockdownState !== 'AUTO_SUBMITTING' && lockdownState !== 'NEEDS_FULLSCREEN') {
        setLockdownState('TRANSIENT_BLUR');
      }

      graceTimerRef.current = setTimeout(() => {
        // Exceeded 15s grace window -> escalate to full suspension
        if (lockdownState !== 'AUTO_SUBMITTING') {
          setLockdownState('SUSPENDED_AWAY');
        }
        setInfractionCount((c) => c + 1);
      }, OS_INTERRUPT_GRACE_MS);
    };

    const handleWindowFocus = () => {
      if (graceTimerRef.current) {
        clearTimeout(graceTimerRef.current);
        graceTimerRef.current = null;
      }

      if (blurStartRef.current) {
        const duration = Date.now() - blurStartRef.current;
        if (
          duration < OS_INTERRUPT_GRACE_MS &&
          lockdownState !== 'SUSPENDED_AWAY' &&
          lockdownState !== 'AUTO_SUBMITTING' &&
          lockdownState !== 'NEEDS_FULLSCREEN'
        ) {
          queueEvent('EPHEMERAL_OS_INTERRUPT', blurStartRef.current, duration);
          setLockdownState('ACTIVE');
        } else {
          queueEvent('EXTENDED_ABSENCE', blurStartRef.current, duration);
        }
        blurStartRef.current = null;
      }
    };

    // 3. Fullscreen Exit Detection (Two-Strike Escalation)
    const handleFullscreenChange = () => {
      if (!isFullscreenSupported()) return;
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);

      // Non-Punitive Guard: Suppress false strikes if document is currently in an unload / reload sequence
      if (isUnloadingRef.current) {
        return;
      }

      if (!active) {
        // Increment exit counter
        fullscreenExitCountRef.current += 1;
        const currentExits = fullscreenExitCountRef.current;
        setFullscreenExits(currentExits);
        queueEvent('FULLSCREEN_EXIT', Date.now(), 0);

        if (currentExits === 1) {
          // Strike 1: Warning modal
          setLockdownState('SUSPENDED_AWAY');
          setInfractionCount((c) => c + 1);
        } else if (currentExits >= 2 && !hasAutoSubmittedViolationRef.current) {
          // Strike 2: Automatic finalization and submission
          hasAutoSubmittedViolationRef.current = true;
          setLockdownState('AUTO_SUBMITTING');
          if (typeof onViolationAutoSubmit === 'function') {
            onViolationAutoSubmit('FULLSCREEN_VIOLATION_AUTO_SUBMIT');
          }
        }
      } else if (active && lockdownState === 'NEEDS_FULLSCREEN') {
        setLockdownState('ACTIVE');
      }
    };

    // 4. Non-Punitive Fullscreen Recovery Handlers for Cancelled Reloads
    const handleBeforeUnload = () => {
      isUnloadingRef.current = true;
      if (unloadResetTimerRef.current) {
        clearTimeout(unloadResetTimerRef.current);
      }
      // If user clicks "Cancel" (Stay on Page), execution context survives.
      // Reset suppression after 2,000ms and non-punitively require fullscreen entry without incrementing strikes!
      unloadResetTimerRef.current = setTimeout(() => {
        isUnloadingRef.current = false;
        if (isFullscreenSupported() && !document.fullscreenElement) {
          if (lockdownState !== 'AUTO_SUBMITTING') {
            setLockdownState('NEEDS_FULLSCREEN');
          }
        }
      }, 2000);
    };

    const handlePageShow = () => {
      isUnloadingRef.current = false;
      if (isFullscreenSupported() && !document.fullscreenElement) {
        if (lockdownState !== 'AUTO_SUBMITTING') {
          setLockdownState('NEEDS_FULLSCREEN');
        }
      }
    };

    // 5. Clipboard & Context Menu Lockout
    const suppressClipboard = (e) => {
      e.preventDefault();
      queueEvent('CLIPBOARD_BLOCKED', Date.now(), 0);
    };

    const suppressContextMenu = (e) => {
      e.preventDefault();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    document.addEventListener('copy', suppressClipboard);
    document.addEventListener('cut', suppressClipboard);
    document.addEventListener('paste', suppressClipboard);
    document.addEventListener('contextmenu', suppressContextMenu);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pageshow', handlePageShow);

    const onlineListener = () => flushTelemetry();
    window.addEventListener('online', onlineListener);

    return () => {
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
      if (unloadResetTimerRef.current) clearTimeout(unloadResetTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
      document.removeEventListener('copy', suppressClipboard);
      document.removeEventListener('cut', suppressClipboard);
      document.removeEventListener('paste', suppressClipboard);
      document.removeEventListener('contextmenu', suppressContextMenu);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('online', onlineListener);
    };
  }, [
    enabled,
    quizId,
    attemptId,
    lockdownState,
    isSubmitting,
    onViolationAutoSubmit,
    queueEvent,
    flushTelemetry,
  ]);

  return {
    lockdownState,
    isFullscreen,
    infractionCount,
    fullscreenExits,
    enterFullscreenProctoring,
    flushTelemetry,
  };
}

export default useAntiCheat;
