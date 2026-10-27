import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, RefreshCw, Home, ShieldAlert } from 'lucide-react';
import { resolveRemediation } from '../lib/userFriendlyMessages.js';

/**
 * <ErrorStateView />
 *
 * Full Scrollport Replacement Primitive (Phase 4 Zero-Trust UI Primitive 5.2)
 *
 * Implements:
 * 1. Non-destructive React Query cache eviction (predicate-filtered reset)
 * 2. Elimination of brute-force window.location.reload()
 * 3. OWASP API8 redaction with IT support correlation token display
 * 4. WCAG 44x44px touch targets on all interactive recovery controls
 */
export function ErrorStateView({
  error,
  onRetry,
  queryKey,
  title: customTitle,
  problem: customProblem,
  className = '',
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [isRetrying, setIsRetrying] = useState(false);

  const remediation = resolveRemediation(error);
  const title = customTitle || remediation.title || 'System Notification';
  const problem = customProblem || remediation.problem;
  const correlationId = remediation.correlationId;

  const handleRetry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);

    try {
      if (typeof onRetry === 'function') {
        await onRetry();
      } else if (queryKey) {
        await queryClient.refetchQueries({ queryKey, exact: true });
      } else {
        // Scoped strictly to failed queries to prevent nuclear cache blast radius
        await queryClient.resetQueries({
          predicate: (query) => query.state.status === 'error',
        });
        await queryClient.refetchQueries({ type: 'active' });
      }
    } catch (retryErr) {
      console.warn('[ErrorStateView] Retry attempt encountered an error:', retryErr);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`min-h-[50vh] flex flex-col items-center justify-center p-4 sm:p-8 text-center animate-fade-in ${className}`}
    >
      <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl border border-gray-200/80 dark:border-slate-800 shadow-md p-6 sm:p-8 space-y-6">
        {/* Contextual Icon Header */}
        <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800 flex items-center justify-center mx-auto shadow-inner">
          {remediation.severity === 'critical' ? (
            <ShieldAlert className="w-8 h-8 text-red-600 dark:text-red-400" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-8 h-8" aria-hidden="true" />
          )}
        </div>

        {/* Informational Hierarchy */}
        <div className="space-y-2">
          <h2 className="text-xl sm:text-2xl font-black text-[#0a1142] dark:text-[#ffb81c] font-display tracking-tight">
            {title}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed font-sans">
            {problem}
          </p>
        </div>

        {/* Institutional Remediation Guidance */}
        {remediation.remediation && (
          <div className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 rounded-xl p-3.5 text-xs text-slate-700 dark:text-slate-300 text-left font-sans leading-relaxed">
            <span className="font-bold text-[#0a1142] dark:text-[#ffd060] block mb-1 uppercase tracking-wider text-[10px]">
              Recommended Action:
            </span>
            <span>{remediation.remediation}</span>
          </div>
        )}

        {/* Technical Reference (Redacted, Zero-Leakage Correlation Token) */}
        {correlationId && (
          <div className="pt-1 flex items-center justify-center gap-2">
            <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 px-2.5 py-1 rounded-md border border-gray-200/60 dark:border-slate-700 font-semibold select-all">
              IT Support Ref: {correlationId}
            </span>
          </div>
        )}

        {/* Interactive Controls (WCAG 44x44px Touch-Target Standard) */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-5 py-2.5 bg-[#0a1142] hover:bg-[#16258f] dark:bg-[#ffb81c] dark:hover:bg-[#e5a200] dark:text-[#0a1142] disabled:bg-gray-400 text-white text-xs font-bold rounded-xl shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0a1142]"
          >
            <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{isRetrying ? 'Reconnecting...' : 'Retry Connection'}</span>
          </button>

          <Link
            to="/dashboard"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-5 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 text-xs font-bold rounded-xl border border-gray-200/60 dark:border-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            <span>Go to Dashboard</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default ErrorStateView;
