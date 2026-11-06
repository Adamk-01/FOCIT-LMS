import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ErrorAlertCallout } from '../components/ErrorAlertCallout.jsx';
import { resolveRemediation } from '../lib/userFriendlyMessages.js';
import { ActivatePortalModal } from '../components/auth/ActivatePortalModal.jsx';

export const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [isActivateModalOpen, setIsActivateModalOpen] = useState(false);

  const sessionTimeoutError = searchParams.get('reason') === 'session_timeout' ? {
    code: 'UPSTREAM_EXPIRED',
    title: 'Session Expired',
    problem: 'Your secure session has timed out due to institutional safety policies.',
    remediation: 'Please sign in again to resume your academic tasks.',
    severity: 'warning',
  } : null;

  const displayError = authError || sessionTimeoutError;
  const isSubmittingRef = useRef(false);
  const activeAbortRef = useRef(null);

  useEffect(() => () => {
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setAuthError(null);

    const trimmedId = studentId.trim();

    // UNIOSUN Matric Number Format Validation: YYYY/XXXXX (strict 5 digits)
    if (/^\d{4}[/-]/.test(trimmedId) || /^[A-Za-z]+\/\d{4}[/-]/.test(trimmedId)) {
      const parts = trimmedId.split(/[/-]/);
      const suffix = parts[parts.length - 1];
      if (/^\d+$/.test(suffix) && suffix.length !== 5) {
        isSubmittingRef.current = false;
        setAuthError({
          code: 'INVALID_MATRIC_FORMAT',
          title: 'Invalid Matriculation Format',
          problem: `The matric number "${trimmedId}" is invalid. UNIOSUN student matric numbers require exactly 5 digits after the year (e.g. 2023/47162).`,
          remediation: 'Please check your matriculation number and ensure you enter the full 5 digits assigned to you.',
          severity: 'error',
          recoveryAction: {
            type: 'FOCUS_INPUT',
            target: 'studentId',
            label: 'Fix Matric Number',
          },
        });
        return;
      }
    }
    if (!trimmedId || !password) {
      isSubmittingRef.current = false;
      setAuthError({
        code: 'INVALID_CREDENTIALS',
        title: 'Credentials Required',
        problem: 'Please enter both your Student ID / Matric Number and Password.',
        remediation: 'Fill in your assigned credentials to access your university portal.',
        severity: 'warning',
        recoveryAction: {
          type: 'FOCUS_INPUT',
          target: !trimmedId ? 'studentId' : 'password',
          label: !trimmedId ? 'Fix Student ID' : 'Enter Password',
        },
      });
      return;
    }

    setIsAuthenticating(true);
    activeAbortRef.current?.abort();
    const controller = new AbortController();
    activeAbortRef.current = controller;

    try {
      const shadowUser = await login({ studentId: trimmedId, password }, { signal: controller.signal });
      const userRole = String(shadowUser?.role || '').toUpperCase();
      const isStaffRole = ['ADMIN', 'SYSTEM_ADMIN', 'LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF', 'LECTURER'].includes(userRole);
      let destination = '/dashboard';
      if (shadowUser?.mustChangePassword || shadowUser?.scope === 'RESET_ONLY') {
        destination = isStaffRole ? '/admin/profile' : '/profile?tab=security';
      } else if (['ADMIN', 'SYSTEM_ADMIN'].includes(userRole)) {
        destination = '/admin';
      } else if (userRole === 'HOD') {
        destination = '/hod';
      } else if (userRole === 'LECTURER') {
        destination = '/lecturer';
      } else if (['LEVEL_ADVISOR', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF'].includes(userRole)) {
        destination = '/advisor/registrations';
      }

      // Always route cleanly to the user's role-specific primary workspace dashboard
      navigate(destination, { replace: true });
    } catch (err) {
      if (controller.signal.aborted && err?.name === 'AbortError') return;
      setAuthError(resolveRemediation(err));
    } finally {
      isSubmittingRef.current = false;
      setIsAuthenticating(false);
      activeAbortRef.current = null;
    }
  };

  return (
    <div className="fixed inset-0 h-[100dvh] max-h-[100dvh] overflow-hidden m-0 p-0 bg-slate-50 dark:bg-slate-950 flex flex-col">
      <main className="h-full w-full overflow-y-auto overflow-x-hidden overscroll-y-contain flex flex-col py-6 sm:py-10 px-4 sm:px-6 lg:px-8">
        <div className="my-auto sm:mx-auto sm:w-full sm:max-w-md flex flex-col">
          <div className="text-center">
            <div className="inline-flex items-center justify-center mb-3">
              <img
                src="/faculty-logo.jpg"
                alt="UNIOSUN FOCIT Faculty Crest"
                className="w-20 h-20 rounded-full object-cover ring-4 ring-[#ffb81c]/80 shadow-lg"
                width="80"
                height="80"
              />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[#0a1142] dark:text-slate-100 tracking-tight font-display">
              UNIOSUN FOCIT
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-gray-600 dark:text-slate-400 font-sans">
              Faculty of Computing & Information Technology
            </p>
          </div>

          <div className="mt-6">
            <div className="bg-white dark:bg-slate-900 py-8 px-6 shadow-xl rounded-2xl sm:px-10 border border-gray-100 dark:border-slate-800 border-t-4 border-t-[#ffb81c]">
              {displayError && <ErrorAlertCallout error={displayError} className="mb-6" />}

            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              <fieldset disabled={isAuthenticating} className="space-y-4">
                <legend className="sr-only">University Portal Credentials</legend>
                <div>
                  <label htmlFor="studentId" className="block text-xs sm:text-sm font-bold text-gray-800 dark:text-slate-200 mb-1 font-sans">
                    Student ID / Matric Number
                  </label>
                  <input
                    id="studentId"
                    name="studentId"
                    type="text"
                    required
                    autoComplete="username"
                    value={studentId}
                    onChange={(e) => {
                      setStudentId(e.target.value);
                      if (authError) setAuthError(null);
                    }}
                    placeholder="e.g. 2023/47162"
                    className="appearance-none block w-full min-h-[44px] px-3.5 py-2.5 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl shadow-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-[#ffb81c] focus:border-[#0a1142] dark:focus:border-[#ffb81c] text-sm font-sans transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs sm:text-sm font-bold text-gray-800 dark:text-slate-200 mb-1 font-sans">
                    Password
                  </label>
                  <input
                    id="password" name="password" type="password" required autoComplete="current-password"
                    value={password} onChange={(e) => { setPassword(e.target.value); if (authError) setAuthError(null); }}
                    placeholder="••••••••••••"
                    className="appearance-none block w-full min-h-[44px] px-3.5 py-2.5 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl shadow-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-[#ffb81c] focus:border-[#0a1142] dark:focus:border-[#ffb81c] text-sm font-sans transition-all"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit" disabled={isAuthenticating} aria-busy={isAuthenticating}
                    className="w-full flex justify-center items-center min-h-[44px] min-w-[44px] py-2.5 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-[#0a1142] bg-[#ffb81c] hover:bg-[#e5a619] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0a1142] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isAuthenticating ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-[#0a1142]/30 border-t-[#0a1142] rounded-full animate-spin" aria-hidden="true" />
                        <span>Authenticating...</span>
                      </span>
                    ) : 'Sign In to Academic Portal'}
                  </button>
                </div>
              </fieldset>
            </form>

              <div className="mt-6 pt-5 border-t border-gray-100 dark:border-slate-800 text-center">
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-2 font-sans">
                  New or returning student setting up your portal?
                </p>
                <button
                  type="button"
                  onClick={() => setIsActivateModalOpen(true)}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-bold text-[#0a1142] dark:text-[#ffb81c] bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 border border-amber-200 dark:border-amber-800/60 rounded-xl transition-all shadow-xs w-full sm:w-auto"
                >
                  <span>Activate Student Portal</span>
                  <span aria-hidden="true">&rarr;</span>
                </button>
              </div>

              <ActivatePortalModal
                isOpen={isActivateModalOpen}
                onClose={() => setIsActivateModalOpen(false)}
                onActivated={({ matricNumber, temporaryPassword }) => {
                  setStudentId(matricNumber);
                  setPassword(temporaryPassword);
                  setAuthError({
                    code: 'TEMPORARY_PASSWORD_COPIED',
                    title: 'Temporary Password Copied',
                    problem: 'Your temporary password has been copied to your clipboard and filled in above.',
                    remediation: 'Click "Sign In to Academic Portal" to log in and set your permanent secret password.',
                    severity: 'success',
                  });
                }}
              />
          </div>
        </div>
        </div>
      </main>
    </div>
  );
};

export default LoginPage;
