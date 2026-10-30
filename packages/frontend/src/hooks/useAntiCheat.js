import { useState, useEffect, useRef, useCallback } from 'react';
import { apiClient } from '../lib/api';

const OS_INTERRUPT_GRACE_MS = 15_000; // 15s grace window for incoming call / battery modal

/**
 * Anti-Cheat Soft-Lockdown & Proctoring Hook
 *
 * Implements:
 * 1. Automatic initial fullscreen requirement (NEEDS_FULLSCREEN gate)
 * 2. Two-strike fullscreen enforcement policy:
 *    - Strike 1: Warning modal (SUSPENDED_AWAY)
 *    - Strike 2: Automatic assessment submission (AUTO_SUBMITTING)
 * 3. Ephemeral OS interrupt grace window (15s for incoming cellular calls)
 * 4. Telemetry event queue with offline retry resilience
 * 5. Telemetry flush suspension during active submission to eliminate DB row-lock contention
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function useAntiCheat({
  quizId,
  attemptId,
  enabled = true,
  isSubmitting = false,
  onViolationAutoSubmit,
}) {
  const [lockdownState, setLockdownState] = useState(() => {
    if (typeof document !== 'undefined' && !document.fullscreenElement) {
      return 'NEEDS_FULLSCREEN';
    }
    return 'ACTIVE';
  });

  const [isFullscreen, setIsFullscreen] = useState(() => {
    return typeof document !== 'undefined' ? Boolean(document.fullscreenElement) : true;
  });

  const [infractionCount, setInfractionCount] = useState(0);
  const [fullscreenExits, setFullscreenExits] = useState(0);

  const fullscreenExitCountRef = useRef(0);
  const hasAutoSubmittedViolationRef = useRef(false);
  const blurStartRef = useRef(null);
  const graceTimerRef = useRef(null);
  const telemetryQueueRef = useRef([]);
  const isFlushingRef = useRef(false);

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
      // Fallback for iOS Safari where Fullscreen API on non-video elements is restricted
      setIsFullscreen(true);
      if (lockdownState !== 'AUTO_SUBMITTING') {
        setLockdownState('ACTIVE');
      }
    }
  }, [lockdownState]);

  useEffect(() => {
    if (!enabled || !quizId || !attemptId || isSubmitting) return undefined;

    // Check on mount if fullscreen is missing
    if (!document.fullscreenElement && lockdownState === 'ACTIVE') {
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
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);

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

    // 4. Clipboard & Context Menu Lockout
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

    const onlineListener = () => flushTelemetry();
    window.addEventListener('online', onlineListener);

    return () => {
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
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
