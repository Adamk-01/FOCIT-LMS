import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'react-toastify/dist/ReactToastify.css';
import { AuthProvider, useAuth, AuthState } from './contexts/AuthContext';
import { QuarantineBoundary } from './components/QuarantineBoundary';
import { router } from './router';

// Synchronized SWR Client Contract: Mathematically aligned with BFF Cache Epochs
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 1. Fresh Epoch: Matches BFF Fresh TTL (5 minutes). Serves from memory with 0 network calls.
      staleTime: 5 * 60 * 1000,
      // 2. Inactive Retention: Matches BFF Stale TTL (60 minutes). Preserves data during route navigation.
      gcTime: 60 * 60 * 1000,
      // 3. Network hygiene: Disable naive auto-refetches while within the 5m fresh window.
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: true, // Only revalidate if network physically dropped and reconnected
      // 4. Circuit-Breaker Aware Retry: Never hammer 503 or 4xx responses blindly
      retry: (failureCount, error) => {
        // Halt retries immediately on auth, client, or circuit breaker open errors
        if (error?.status === 401 || error?.status === 403 || error?.status === 404) return false;
        // Bounded retries for transient gateway issues
        return failureCount < 2;
      },
      retryDelay: (attemptIndex, error) => {
        // Parse Retry-After header if provided by BFF (e.g. 503 circuit-breaker open)
        const retryHeader = error?.response?.headers?.get?.('retry-after');
        const baseMs = retryHeader ? parseInt(retryHeader, 10) * 1000 : Math.min(1000 * 2 ** attemptIndex, 10000);
        // Desynchronize retries with +/- 25% jitter
        return Math.round(baseMs * (0.75 + Math.random() * 0.5));
      },
    },
  },
});

const FocitSplash = () => (
  <div className="flex items-center justify-center min-h-screen bg-[#0a1142]">
    <div className="w-16 h-16 border-4 border-[#ffb81c] border-t-transparent rounded-full animate-spin" />
  </div>
);

const AppRoot = () => {
  const { status } = useAuth();

  if (status === AuthState.PENDING) {
    return <FocitSplash />;
  }

  // Unbypassable security quarantine boundary
  if (status === AuthState.QUARANTINED) {
    return <QuarantineBoundary />;
  }
  
  return (
    <>
      <RouterProvider router={router} />
      <ToastContainer position="top-right" className="z-[9999]" />
    </>
  );
};

export const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <AppRoot />
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
