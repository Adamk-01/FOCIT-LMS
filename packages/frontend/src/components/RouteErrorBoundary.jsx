import React from 'react';
import { useRouteError, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ErrorStateView } from './ErrorStateView.jsx';

/**
 * RouteErrorBoundary
 *
 * Catch-all boundary for React Router route exceptions.
 * Integrates directly with TanStack Query v5 to perform scoped cache error resets
 * instead of full-page document reload.
 */
export const RouteErrorBoundary = () => {
  const error = useRouteError();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const handleRetry = async () => {
    // 1. Reset ONLY error queries to prevent nuclear cache blast radius
    await queryClient.resetQueries({
      predicate: (query) => query.state.status === 'error',
    });

    // 2. Re-trigger active queries
    await queryClient.refetchQueries({ type: 'active' });

    // 3. Re-navigate the current route cleanly without browser document reload
    navigate(0);
  };

  return <ErrorStateView error={error} onRetry={handleRetry} />;
};

export default RouteErrorBoundary;
