import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { sessionLifecycle } from '../lib/sessionLifecycle';
import {
  calculateCristianSkew,
  extractServerTimeMs,
  JITTER_REJECTION_THRESHOLD_MS,
} from '../lib/temporalSync';

export const AuthState = {
  PENDING: 'PENDING',
  AUTHENTICATED: 'AUTHENTICATED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  QUARANTINED: 'QUARANTINED',
};

const CLOCK_SKEW_LEEWAY_SEC = 30; // 30-second defensive safety margin

const AuthContext = createContext({
  status: AuthState.PENDING,
  user: null,
  quarantineError: null,
  login: async () => {},
  logout: async () => {},
  retryLogout: async () => {},
  isAuthenticated: false,
});

/**
 * Synchronous O(1) Startup Evaluator with Nonce Verification & Server Skew Calibration
 */
function getInitialAuthState() {
  try {
    if (typeof window === 'undefined') {
      return { status: AuthState.PENDING, user: null, quarantineError: null };
    }

    // Both the shadow credentials AND the ephemeral nonce must exist
    const sessionNonce = sessionStorage.getItem('session_nonce');
    const shadowStr = sessionStorage.getItem('shadow_auth') || localStorage.getItem('shadow_auth');

    if (!sessionNonce || !shadowStr) {
      sessionStorage.removeItem('session_nonce');
      sessionStorage.removeItem('shadow_auth');
      localStorage.removeItem('shadow_auth');
      return { status: AuthState.UNAUTHENTICATED, user: null, quarantineError: null };
    }

    const shadow = JSON.parse(shadowStr);
    if (!shadow || typeof shadow !== 'object' || !shadow.exp) {
      sessionStorage.removeItem('session_nonce');
      sessionStorage.removeItem('shadow_auth');
      localStorage.removeItem('shadow_auth');
      return { status: AuthState.UNAUTHENTICATED, user: null, quarantineError: null };
    }

    const clientEpochSec = Math.floor(Date.now() / 1000);
    const skewDeltaSec = typeof shadow.skewDeltaSec === 'number' ? shadow.skewDeltaSec : 0;
    const estimatedServerEpoch = clientEpochSec + skewDeltaSec;

    // Reject if expired based on server-calibrated epoch minus defensive leeway
    if (estimatedServerEpoch >= shadow.exp - CLOCK_SKEW_LEEWAY_SEC) {
      sessionStorage.removeItem('session_nonce');
      sessionStorage.removeItem('shadow_auth');
      localStorage.removeItem('shadow_auth');
      return { status: AuthState.UNAUTHENTICATED, user: null, quarantineError: null };
    }

    return { status: AuthState.AUTHENTICATED, user: shadow, quarantineError: null };
  } catch {
    return { status: AuthState.UNAUTHENTICATED, user: null, quarantineError: null };
  }
}

export const AuthProvider = ({ children }) => {
  const queryClient = useQueryClient();
  const [authState, setAuthState] = useState(getInitialAuthState);
  const isLoggingOutRef = useRef(false);
  const userSkewRef = useRef(authState.user?.skewDeltaSec ?? 0);

  useEffect(() => {
    userSkewRef.current = authState.user?.skewDeltaSec ?? 0;
  }, [authState.user?.skewDeltaSec]);

  // Background hydration verification & dynamic clock drift calibration
  useEffect(() => {
    let isMounted = true;

    if (authState.status === AuthState.AUTHENTICATED) {
      const tOrig = Date.now();
      const perfOrig = typeof performance !== 'undefined' ? performance.now() : tOrig;

      apiClient
        .get('/auth/status')
        .then((res) => {
          if (!isMounted) return;
          const tResp = Date.now();
          const perfResp = typeof performance !== 'undefined' ? performance.now() : tResp;
          const serverTimeMs = extractServerTimeMs(res);

          const previousSkew = userSkewRef.current;
          const sync = calculateCristianSkew({
            tOrig,
            tResp,
            perfOrig,
            perfResp,
            serverTimeMs,
            previousSkewSec: previousSkew,
            thresholdMs: JITTER_REJECTION_THRESHOLD_MS,
          });

          // Discard corrupted temporal measurements exceeding 3,000ms RTT
          if (!sync.isRejected) {
            setAuthState((prev) => {
              if (!prev.user) return prev;
              const updated = {
                ...prev.user,
                skewDeltaSec: sync.skewDeltaSec,
                rttMs: sync.rttMs,
                uncertaintyMs: sync.uncertaintyMs,
              };
              sessionStorage.setItem('shadow_auth', JSON.stringify(updated));
              return { ...prev, user: updated };
            });
          } else {
            console.warn(
              `[AuthContext] Background temporal sync rejected (${sync.rejectionReason}). Preserving previous skew (${previousSkew}s).`
            );
          }
        })
        .catch((err) => {
          if (!isMounted) return;
          if (err.status === 401) {
            sessionStorage.removeItem('session_nonce');
            sessionStorage.removeItem('shadow_auth');
            localStorage.removeItem('shadow_auth');
            setAuthState({ status: AuthState.UNAUTHENTICATED, user: null, quarantineError: null });
          }
        });
    }

    return () => {
      isMounted = false;
    };
  }, [authState.status]);

  /**
   * 1. THE HANDSHAKE with Cristian's Algorithm & Jitter Rejection Filter
   */
  const login = async (credentials) => {
    // 1. High-Resolution Timestamp Capture: T_orig
    const tOrig = Date.now();
    const perfOrig = typeof performance !== 'undefined' ? performance.now() : tOrig;

    const response = await apiClient.post('/auth/login', credentials);

    // 2. High-Resolution Timestamp Capture: T_resp
    const tResp = Date.now();
    const perfResp = typeof performance !== 'undefined' ? performance.now() : tResp;

    const data = response.data || {};
    const serverTimeMs = extractServerTimeMs(response);

    // 3. Cristian's Algorithm with Uncertainty Bounds & Jitter Rejection
    const sync = calculateCristianSkew({
      tOrig,
      tResp,
      perfOrig,
      perfResp,
      serverTimeMs,
      previousSkewSec: 0,
      thresholdMs: JITTER_REJECTION_THRESHOLD_MS,
    });

    if (sync.isRejected) {
      console.warn(
        `[AuthContext] Cristian synchronization discarded due to network jitter (${sync.rejectionReason}). Applying 0s default skew.`
      );
    }

    const effectiveServerEpoch = Math.floor(
      (serverTimeMs || tResp) / 1000
    );

    const shadowPayload = {
      ...(data.user || {}),
      exp: data.exp || effectiveServerEpoch + 3600,
      skewDeltaSec: sync.skewDeltaSec,
      rttMs: sync.rttMs,
      uncertaintyMs: sync.uncertaintyMs,
      authenticatedAt: effectiveServerEpoch,
    };

    // Store ephemeral nonce in sessionStorage (never written to cookies)
    if (data.sessionNonce) {
      sessionStorage.setItem('session_nonce', data.sessionNonce);
    }
    sessionStorage.setItem('shadow_auth', JSON.stringify(shadowPayload));

    setAuthState({ status: AuthState.AUTHENTICATED, user: shadowPayload, quarantineError: null });
    return shadowPayload;
  };

  /**
   * 3. THE SYNCHRONOUS KILL-SWITCH & 4. QUARANTINE PROTOCOL
   */
  const logout = async () => {
    // Mutation Lock: prevent re-entrant or duplicate logout invocations
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;

    // 1. SYNCHRONOUS KILL-SWITCH:
    // Extract ephemeral nonce into memory and IMMEDIATELY destroy it in sessionStorage
    // *BEFORE* awaiting the network promise. Any concurrent fetch will immediately lack
    // the X-Session-Nonce header and fail the BFF barrier.
    const ephemeralNonce =
      typeof window !== 'undefined' ? sessionStorage.getItem('session_nonce') : null;

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('session_nonce');
      sessionStorage.removeItem('shadow_auth');
      localStorage.removeItem('shadow_auth');
    }

    // 2. Abort all in-flight network requests & close SSE / WebSocket streams
    sessionLifecycle.terminate('USER_LOGOUT');

    try {
      // 3. Dispatch the logout call with the ephemeral nonce in the request header
      await apiClient.post('/auth/logout', null, {
        headers: ephemeralNonce ? { 'X-Session-Nonce': ephemeralNonce } : {},
      });

      // 4. Clean exit: Purge query caches and redirect to login
      try {
        await queryClient.cancelQueries();
        queryClient.clear();
        queryClient.getQueryCache().clear();
        queryClient.getMutationCache().clear();
      } catch (cacheErr) {
        console.error('[AuthProvider] Failed to clear query client cache:', cacheErr);
      }

      setAuthState({ status: AuthState.UNAUTHENTICATED, user: null, quarantineError: null });

      if (typeof window !== 'undefined') {
        window.location.replace('/login');
      }
    } catch (networkErr) {
      // 4. THE QUARANTINE PROTOCOL:
      // The network promise rejected. The server's Redis session and the HttpOnly cookie
      // may still be alive in the browser's cookie jar. Transition application state
      // into QUARANTINED to lock the user out of all pages and mandate closing the browser.
      console.warn(
        '[AuthProvider] Logout network promise rejected. Engaging Quarantine Boundary:',
        networkErr
      );

      try {
        await queryClient.cancelQueries();
        queryClient.clear();
      } catch {
        // Defensive no-op
      }

      setAuthState({
        status: AuthState.QUARANTINED,
        user: null,
        quarantineError:
          networkErr?.message || 'Network failure prevented session revocation on authentication server.',
      });
    } finally {
      isLoggingOutRef.current = false;
    }
  };

  /**
   * Quarantine Recovery: Attempt re-revoking with the backend gateway
   */
  const retryLogout = async () => {
    try {
      await apiClient.post('/auth/logout');
      await queryClient.cancelQueries();
      queryClient.clear();
      setAuthState({ status: AuthState.UNAUTHENTICATED, user: null, quarantineError: null });
      if (typeof window !== 'undefined') {
        window.location.replace('/login');
      }
    } catch (err) {
      console.error('[AuthProvider] Retry revocation failed:', err);
      throw err;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        status: authState.status,
        user: authState.user,
        quarantineError: authState.quarantineError,
        login,
        logout,
        retryLogout,
        isAuthenticated: authState.status === AuthState.AUTHENTICATED,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider context boundary');
  }
  return context;
};
