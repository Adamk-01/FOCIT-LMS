import React, { useState } from 'react';
import { ShieldAlert, RefreshCw, XOctagon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * Institutional Quarantine Boundary
 *
 * Rendered when the server-side logout network promise rejects.
 * Prevents navigation back to application state, informs student of dangling session risk,
 * and provides fail-safe eviction actions.
 */
export const QuarantineBoundary = () => {
  const { retryLogout, quarantineError } = useAuth();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    if (isRetrying) return; // Mutation lock
    setIsRetrying(true);
    try {
      await retryLogout();
    } catch {
      // Retain quarantine boundary if retry also fails
    } finally {
      setIsRetrying(false);
    }
  };

  const handleForceExit = () => {
    // Nuclear client exit: replace location with about:blank or attempt window close
    if (typeof window !== 'undefined') {
      window.location.replace('about:blank');
    }
  };

  return (
    <main
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="quarantine-title"
      aria-describedby="quarantine-desc"
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-[#070b24] text-white p-4 sm:p-6 select-none overflow-y-auto"
    >
      <article className="w-full max-w-xl bg-[#0c1236] border-2 border-red-500/70 rounded-xl shadow-2xl p-6 sm:p-8 space-y-6">
        <header className="flex items-center gap-4 border-b border-red-500/20 pb-5">
          <div className="p-3 bg-red-500/20 rounded-lg text-red-400 shrink-0" aria-hidden="true">
            <ShieldAlert size={36} />
          </div>
          <div>
            <span className="text-xs uppercase tracking-widest font-semibold text-red-400">
              Security Protocol Alert
            </span>
            <h1 id="quarantine-title" className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              Session Quarantine Activated
            </h1>
          </div>
        </header>

        <section id="quarantine-desc" className="space-y-4 text-sm text-gray-300 leading-relaxed">
          <p className="bg-red-950/40 border-l-4 border-red-500 p-3 rounded-r text-red-200 text-xs sm:text-sm">
            <strong>Warning:</strong> The portal was unable to confirm session revocation with the university authentication server due to a network interruption.
          </p>

          <p>
            Your browser session storage has been <strong>synchronously cleared</strong> and all active background tasks have been terminated. However, an encrypted session cookie may still reside in your browser jar.
          </p>

          <div className="bg-[#111947] p-4 rounded-lg border border-white/10 space-y-2">
            <h2 className="text-xs uppercase tracking-wider font-semibold text-[#ffb81c]">
              Mandatory Action Required
            </h2>
            <ul className="list-disc list-inside space-y-1.5 text-xs text-gray-300">
              <li>
                <strong>Close this browser window completely</strong> to ensure the session cookie is discarded.
              </li>
              <li>
                If you are on a public campus computer or shared library workstation, do <strong>not</strong> leave this machine unattended before closing the browser.
              </li>
            </ul>
          </div>

          {quarantineError && (
            <p className="text-xs text-gray-500 font-mono break-all">
              Diagnostic error: {quarantineError}
            </p>
          )}
        </section>

        <footer className="pt-2 flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
          >
            <RefreshCw size={16} className={isRetrying ? 'animate-spin' : ''} aria-hidden="true" />
            <span>{isRetrying ? 'Attempting Revocation...' : 'Retry Server Revocation'}</span>
          </button>

          <button
            type="button"
            onClick={handleForceExit}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-500 focus:outline-none focus:ring-2 focus:ring-red-400 transition"
          >
            <XOctagon size={16} aria-hidden="true" />
            <span>Force Exit Session</span>
          </button>
        </footer>
      </article>
    </main>
  );
};
