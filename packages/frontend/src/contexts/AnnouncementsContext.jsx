import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { apiClient } from '../lib/api';
import { sessionLifecycle } from '../lib/sessionLifecycle';

const AnnouncementsContext = createContext(null);

export const AnnouncementsProvider = ({ courseId, children }) => {
  const [announcements, setAnnouncements] = useState([]);
  const lastEventIdRef = useRef(null); // Explicit state recovery tracker

  useEffect(() => {
    if (!courseId) return;

    let source;
    let isReconnecting = false;
    let reconnectTimeoutId;

    const connectSSE = () => {
      // Staff-Level Insight: Because we manually call source.close() to kill the zombie loop,
      // the browser deletes the native EventSource context. We must manually inject the 
      // Last-Event-ID into the URL search params so the Express BFF can trigger the catch-up query.
      const url = new URL(`/api/announcements/stream/${courseId}`, window.location.origin);
      if (lastEventIdRef.current) {
        url.searchParams.append('lastEventId', lastEventIdRef.current);
      }

      source = new EventSource(url.toString());

      source.onmessage = (event) => {
        // Track the ID locally for manual reconnection
        if (event.lastEventId) {
          lastEventIdRef.current = event.lastEventId;
        }

        try {
          const payload = JSON.parse(event.data);
          setAnnouncements((prev) => {
            // Idempotent push: deduplicate overlaps if the catch-up query catches a boundary event
            if (prev.some(a => a.id === payload.id)) return prev;
            return [...prev, payload].sort((a, b) => b.id - a.id); // Maintain chronological UI order
          });
        } catch (err) {
          console.error('[SSE] Failed to parse payload', err);
        }
      };

      source.onerror = () => {
        // DEFENSE 1: Sever the Infinite Loop
        source.close();

        if (isReconnecting) return;
        isReconnecting = true;

        // DEFENSE 2: The Diagnostic Probe
        apiClient.get('/auth/status')
          .then(() => {
            // HTTP 200 OK. The tunnel just dropped. 
            // Gracefully rebuild the pipe after a short backoff.
            reconnectTimeoutId = setTimeout(() => {
              isReconnecting = false;
              connectSSE();
            }, 3000);
          })
          .catch((error) => {
            // DEFENSE 3: The Network Offline Caveat
            // We explicitly check if the error is a cryptographic rejection.
            if (error.status === 401 || error.status === 403) {
              // The global interceptor handles the hard redirect.
              // The EventSource remains permanently dead. No zombie traffic.
              console.warn('[SSE] Authentication failed. Halting stream.');
            } else {
              // The device has completely lost cellular data (Network Error).
              // Wait and attempt reconnection on an exponential backoff.
              reconnectTimeoutId = setTimeout(() => {
                isReconnecting = false;
                connectSSE();
              }, 5000);
            }
          });
      };
    };

    connectSSE();

    // Register with global lifecycle manager for deterministic logout severance
    const unregisterLifecycle = sessionLifecycle.registerCleanup(() => {
      if (source) source.close();
      clearTimeout(reconnectTimeoutId);
    });

    // React 18 Strict Mode Teardown
    return () => {
      unregisterLifecycle();
      if (source) source.close();
      clearTimeout(reconnectTimeoutId);
    };
  }, [courseId]);

  return (
    <AnnouncementsContext.Provider value={{ announcements }}>
      {children}
    </AnnouncementsContext.Provider>
  );
};

export const useAnnouncements = () => {
  const context = useContext(AnnouncementsContext);
  if (!context) {
    throw new Error('useAnnouncements must be used within an AnnouncementsProvider context boundary');
  }
  return context;
};
