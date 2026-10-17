import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

/**
 * Authoritative Monotonic Countdown Clock with OS Deep-Sleep Resync
 *
 * Implements:
 * 1. Cristian's Algorithm Skew Offset: serverNow + (RTT / 2)
 * 2. Monotonic elapsed projection: performance.now() - T_perfAnchor (immune to manual wall clock edits)
 * 3. W3C High Resolution Time Level 3 Deep-Sleep Wake Mitigation:
 *    Dual-clock local max comparison on visibilitychange/focus + immediate authoritative server re-anchor heartbeat
 * 4. Deterministic one-shot expiry callback: onExpire() invoked once at remaining === 0
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function useQuizTimer({
  dueAt,
  serverNow,
  telemetry,
  onExpire,
  onWakeHeartbeat,
}) {
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState(null);

  const perfAnchorRef = useRef(null);
  const wallAnchorRef = useRef(null);
  const estimatedServerNowRef = useRef(null);
  const dueAtMsRef = useRef(null);
  const hasExpiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  const onWakeHeartbeatRef = useRef(onWakeHeartbeat);

  useEffect(() => {
    onExpireRef.current = onExpire;
    onWakeHeartbeatRef.current = onWakeHeartbeat;
  }, [onExpire, onWakeHeartbeat]);

  // Re-anchor clock projection against authoritative server timestamp
  const reanchor = useCallback((freshServerNow, rtt = 0) => {
    if (!freshServerNow || !dueAtMsRef.current) return;
    const freshServerMs = new Date(freshServerNow).getTime();
    estimatedServerNowRef.current = freshServerMs + (rtt / 2);
    perfAnchorRef.current = performance.now();
    wallAnchorRef.current = Date.now();

    const diffSeconds = Math.max(
      0,
      Math.floor((dueAtMsRef.current - estimatedServerNowRef.current) / 1000)
    );
    setTimeRemainingSeconds(diffSeconds);

    if (diffSeconds <= 0 && !hasExpiredRef.current) {
      hasExpiredRef.current = true;
      onExpireRef.current?.();
    }
  }, []);

  // Initial anchor when attempt timing context loads or changes
  useEffect(() => {
    if (!dueAt || !serverNow) return;

    dueAtMsRef.current = new Date(dueAt).getTime();
    const rtt = telemetry?.rtt ?? 0;
    reanchor(serverNow, rtt);
  }, [dueAt, serverNow, telemetry?.rtt, reanchor]);

  // Main high-precision interval tick (500ms for smooth 1-second countdown transitions)
  useEffect(() => {
    if (dueAtMsRef.current === null || estimatedServerNowRef.current === null) return;

    const intervalId = setInterval(() => {
      if (perfAnchorRef.current === null || estimatedServerNowRef.current === null) return;

      const elapsedSinceReceive = performance.now() - perfAnchorRef.current;
      const currentProjectedServerMs = estimatedServerNowRef.current + elapsedSinceReceive;
      const diffSeconds = Math.max(
        0,
        Math.floor((dueAtMsRef.current - currentProjectedServerMs) / 1000)
      );

      setTimeRemainingSeconds(diffSeconds);

      if (diffSeconds <= 0) {
        clearInterval(intervalId);
        if (!hasExpiredRef.current) {
          hasExpiredRef.current = true;
          onExpireRef.current?.();
        }
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [timeRemainingSeconds]);

  // W3C High Resolution Time Level 3: OS Deep-Sleep Monotonic Pause Listener
  useEffect(() => {
    const handleWakeOrFocus = () => {
      if (document.visibilityState === 'hidden') return;
      if (
        perfAnchorRef.current === null ||
        wallAnchorRef.current === null ||
        estimatedServerNowRef.current === null ||
        dueAtMsRef.current === null
      ) {
        return;
      }

      // 1. Dual-clock local evaluation: take max of monotonic vs wall elapsed to catch CPU suspend
      const elapsedPerf = performance.now() - perfAnchorRef.current;
      const elapsedWall = Date.now() - wallAnchorRef.current;
      const elapsedMs = Math.max(elapsedPerf, elapsedWall);

      const projectedMs = estimatedServerNowRef.current + elapsedMs;
      const immediateRemaining = Math.max(
        0,
        Math.floor((dueAtMsRef.current - projectedMs) / 1000)
      );

      setTimeRemainingSeconds(immediateRemaining);

      if (immediateRemaining <= 0 && !hasExpiredRef.current) {
        hasExpiredRef.current = true;
        onExpireRef.current?.();
      }

      // 2. Authoritative non-blocking server re-anchor heartbeat
      if (typeof onWakeHeartbeatRef.current === 'function') {
        onWakeHeartbeatRef.current();
      }
    };

    document.addEventListener('visibilitychange', handleWakeOrFocus);
    window.addEventListener('focus', handleWakeOrFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleWakeOrFocus);
      window.removeEventListener('focus', handleWakeOrFocus);
    };
  }, []);

  // Formatted Timer String: HH:MM:SS (Screen 4: "00:42:17")
  const formattedTimer = useMemo(() => {
    if (timeRemainingSeconds === null) return '--:--:--';
    const hours = Math.floor(timeRemainingSeconds / 3600);
    const minutes = Math.floor((timeRemainingSeconds % 3600) / 60);
    const seconds = timeRemainingSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }, [timeRemainingSeconds]);

  const isUrgent = timeRemainingSeconds !== null && timeRemainingSeconds < 300; // < 5 mins
  const isCritical = timeRemainingSeconds !== null && timeRemainingSeconds < 60; // < 1 min
  const isExpired = timeRemainingSeconds !== null && timeRemainingSeconds <= 0;

  return {
    timeRemainingSeconds,
    formattedTimer,
    isUrgent,
    isCritical,
    isExpired,
    reanchor,
  };
}

export default useQuizTimer;
