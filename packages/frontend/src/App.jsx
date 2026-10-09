import React from 'react';
import { RouterProvider } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import 'react-toastify/dist/ReactToastify.css';
import { AuthProvider, useAuth, AuthState } from './contexts/AuthContext';
import { QuarantineBoundary } from './components/QuarantineBoundary';
import { router } from './router';

// Global cache config: Course materials are immutable for 24h to prevent route thrashing
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 60 * 24, // 24 hours
      refetchOnWindowFocus: false, // Additional defense against unnecessary network hits
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
