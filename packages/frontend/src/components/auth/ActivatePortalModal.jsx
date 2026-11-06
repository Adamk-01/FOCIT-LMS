import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Key, Check, Copy, AlertCircle, Sparkles } from 'lucide-react';

export function ActivatePortalModal({ isOpen, onClose, onActivated }) {
  const [matricNumber, setMatricNumber] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [activationResult, setActivationResult] = useState(null);
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = async (textToCopy) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const cleanMatric = matricNumber.trim();
    const cleanEmail = email.trim();

    if (!cleanMatric || !cleanEmail) {
      setError({
        title: 'Missing Required Fields',
        problem: 'Please enter both your Matriculation Number and your faculty registered email.',
      });
      return;
    }

    // Client-side matric syntax guard
    if (!/^[0-9]{4}\/[0-9]{5}$/.test(cleanMatric)) {
      setError({
        title: 'Invalid Matriculation Format',
        problem: 'UNIOSUN matriculation numbers require 5 digits after the year (e.g. 2023/47162).',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matricNumber: cleanMatric, email: cleanEmail }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw data;
      }

      setActivationResult(data);
    } catch (err) {
      if (err?.code === 'ACCOUNT_ALREADY_ACTIVATED') {
        setError({
          title: 'Portal Already Activated',
          problem: err.error || 'This account has already completed initial portal activation.',
          remediation: 'Please sign in directly using your permanent secret password.',
          severity: 'warning',
        });
      } else if (err?.code === 'EMAIL_MISMATCH') {
        setError({
          title: 'Email Verification Failed',
          problem: 'The email provided does not match the faculty admission record for this matric number.',
          remediation: 'Please check your personal Gmail/email used during faculty registration.',
          severity: 'error',
        });
      } else if (err?.code === 'STUDENT_NOT_FOUND') {
        setError({
          title: 'Student Record Not Found',
          problem: 'No registered student was found matching this matriculation number.',
          remediation: 'Verify your matric number (e.g. 2023/47162) or contact your department officer.',
          severity: 'error',
        });
      } else {
        setError({
          title: 'Activation Failed',
          problem: err?.error || 'Unable to process portal activation. Please try again.',
          remediation: 'Ensure you have an active network connection and valid admission records.',
          severity: 'error',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProceedToLogin = () => {
    if (activationResult) {
      handleCopy(activationResult.temporaryPassword);
      onActivated?.({
        matricNumber: activationResult.matricNumber,
        temporaryPassword: activationResult.temporaryPassword,
      });
      onClose();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex min-h-full items-center justify-center p-4 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="activate-modal-title"
        className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-gray-100 dark:border-slate-800 relative animate-in fade-in zoom-in-95 duration-150 my-auto"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        {activationResult ? (
          <div>
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-4">
              <Sparkles size={24} />
            </div>

            <h2 id="activate-modal-title" className="text-xl font-extrabold text-[#0a1142] dark:text-slate-100 font-display">
              Portal Initialized Successfully
            </h2>

            <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">
              Welcome, <strong>{activationResult.fullName}</strong> ({activationResult.matricNumber}). Your one-time temporary password has been generated.
            </p>

            <div className="mt-5 p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[11px] font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                Your One-Time Temporary Password
              </span>
              <div className="flex items-center justify-between gap-3">
                <code className="text-base font-mono font-bold text-[#0a1142] dark:text-amber-400 tracking-wider select-all">
                  {activationResult.temporaryPassword}
                </code>
                <button
                  type="button"
                  onClick={() => handleCopy(activationResult.temporaryPassword)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-[#0a1142] dark:text-slate-200 bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 hover:bg-gray-100 dark:hover:bg-slate-600 transition-colors shadow-xs"
                >
                  {copied ? (
                    <>
                      <Check size={14} className="text-emerald-600 dark:text-emerald-400" />
                      <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <p className="mt-3 text-[11px] text-gray-500 dark:text-slate-400 leading-relaxed">
              <strong>Notice:</strong> Copy this temporary password and sign in. The system will prompt you to immediately set your permanent private password.
            </p>

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleProceedToLogin}
                className="w-full flex justify-center items-center py-2.5 px-4 rounded-xl shadow-md text-sm font-bold text-[#0a1142] bg-[#ffb81c] hover:bg-[#e5a619] transition-all"
              >
                Copy & Proceed to Sign In
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/60 text-[#0a1142] dark:text-blue-400 flex items-center justify-center mb-4">
              <Key size={24} />
            </div>

            <h2 id="activate-modal-title" className="text-xl font-extrabold text-[#0a1142] dark:text-slate-100 font-display">
              Activate Student Portal
            </h2>

            <p className="text-xs text-gray-600 dark:text-slate-400 mt-1">
              Initialize your academic workspace. Enter your UNIOSUN matric number and the personal email registered with the faculty.
            </p>

            {error && (
              <div
                className={`mt-4 p-3.5 rounded-xl border text-xs ${
                  error.severity === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                    : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
                }`}
              >
                <div className="flex gap-2.5">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">{error.title}</strong>
                    <span>{error.problem}</span>
                    {error.remediation && <p className="mt-1 font-medium text-[11px] opacity-90">{error.remediation}</p>}
                  </div>
                </div>
              </div>
            )}

            <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="activate-matric" className="block text-xs font-bold text-gray-800 dark:text-slate-200 mb-1">
                  Matriculation Number
                </label>
                <input
                  id="activate-matric"
                  type="text"
                  required
                  placeholder="e.g. 2023/47162"
                  value={matricNumber}
                  onChange={(e) => setMatricNumber(e.target.value)}
                  className="appearance-none block w-full px-3.5 py-2.5 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl shadow-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-[#ffb81c] text-sm"
                />
              </div>

              <div>
                <label htmlFor="activate-email" className="block text-xs font-bold text-gray-800 dark:text-slate-200 mb-1">
                  Registered Faculty Email (Gmail)
                </label>
                <input
                  id="activate-email"
                  type="email"
                  required
                  placeholder="e.g. yourname@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-3.5 py-2.5 border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl shadow-sm placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-[#ffb81c] text-sm"
                />
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex justify-center items-center py-2.5 px-4 rounded-xl shadow-md text-sm font-bold text-[#0a1142] bg-[#ffb81c] hover:bg-[#e5a619] disabled:opacity-50 transition-all"
                >
                  {isSubmitting ? 'Verifying Admission Record...' : 'Verify & Initialize Portal'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default ActivatePortalModal;
