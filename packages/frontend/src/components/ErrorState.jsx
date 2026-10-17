import React from 'react';
import { ErrorStateView } from './ErrorStateView.jsx';

/**
 * Legacy ErrorState Adapter
 * Redirects all callers to the zero-trust ErrorStateView primitive.
 */
export default function ErrorState({ error, onRetry }) {
  return <ErrorStateView error={error} onRetry={onRetry} />;
}
