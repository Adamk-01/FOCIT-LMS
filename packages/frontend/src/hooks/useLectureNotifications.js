import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useLectureNotifications Hook
 *
 * Implements:
 * 1. Explicit user-granted Web Notification API permission lifecycle ('default' | 'granted' | 'denied')
 * 2. Strict User-Gesture Enforcement: NEVER requests permission automatically
 * 3. In-Browser 15-Minute Lecture Alerting when student has granted permission
 * 4. Deduplication Ledger (sessionStorage) ensuring each lecture only alerts once per day
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function useLectureNotifications(nextLecture = null) {
  const [permission, setPermission] = useState(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return Notification.permission;
    }
    return 'denied';
  });

  const lastNotifiedRef = useRef(null);

  // Synchronize state if permission changes externally
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPermission(Notification.permission);
    }
  }, []);

  /**
   * Explicit user action to request notification permission.
   * MUST be invoked from a user click gesture.
   */
  const requestPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'denied';
    }

    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        new Notification('FOCIT LMS: Lecture Reminders Enabled', {
          body: 'You will receive reminders 15 minutes before your scheduled lectures begin.',
          icon: '/favicon.ico',
        });
      }
      return result;
    } catch (_) {
      return 'denied';
    }
  }, []);

  // Monitor nextLecture and fire notification if starting soon (<= 15 mins) and permitted
  useEffect(() => {
    if (!nextLecture || permission !== 'granted') return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    const { scheduleId, courseCode, minutesUntilStart, isStartingSoon } = nextLecture;
    if (!isStartingSoon || minutesUntilStart < 0) return;

    const todayStr = new Date().toISOString().split('T')[0];
    const notifyKey = `focit_notified_${todayStr}_${scheduleId || courseCode}`;

    try {
      if (sessionStorage.getItem(notifyKey) || lastNotifiedRef.current === notifyKey) {
        return; // Already notified today
      }

      const notif = new Notification(`Lecture Reminder: ${courseCode}`, {
        body: `Class starts in ${minutesUntilStart} minute(s). Room: ${nextLecture.roomId || 'Faculty Hall'}.`,
        icon: '/favicon.ico',
        tag: `lecture-${courseCode}`,
      });

      sessionStorage.setItem(notifyKey, 'true');
      lastNotifiedRef.current = notifyKey;

      notif.onclick = () => {
        window.focus();
        notif.close();
      };
    } catch (_) {}
  }, [nextLecture, permission]);

  return {
    permission,
    isSupported: typeof window !== 'undefined' && 'Notification' in window,
    isGranted: permission === 'granted',
    isDenied: permission === 'denied',
    isDefault: permission === 'default',
    requestPermission,
  };
}

export default useLectureNotifications;
