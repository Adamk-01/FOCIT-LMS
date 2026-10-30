import React, { useState } from 'react';
import { AlertTriangle, AlertCircle, CheckCircle2, RefreshCw, Lock } from 'lucide-react';
import { toast } from 'react-toastify';

/**
 * <ProfileSecurityTab />
 * Self-contained Tier 4 Security & Credential Teardown Form
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function ProfileSecurityTab() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isMismatch = newPassword && confirmPassword && newPassword !== confirmPassword;
  const isTooShort = newPassword && newPassword.length < 8;

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const current = currentPassword.trim();
    const next = newPassword.trim();
    const confirm = confirmPassword.trim();

    if (!current) return setErrorMsg('Please enter your current temporary password.');
    if (!next) return setErrorMsg('Please enter a new password (min 8 characters).');
    if (next.length < 8) return setErrorMsg('New password must contain at least 8 characters.');
    if (next !== confirm) return setErrorMsg('New password and confirmation do not match.');

    setIsSubmitting(true);
    try {
      const sessionNonce = typeof window !== 'undefined' ? sessionStorage.getItem('session_nonce') : null;
      const res = await fetch('/api/student/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(sessionNonce ? { 'X-Session-Nonce': sessionNonce } : {}),
        },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
        credentials: 'include',
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Password update rejected by server.');

      setSuccessMsg('Password updated successfully! Redirecting to login...');
      toast.success('Password updated successfully!');
      sessionStorage.removeItem('session_nonce');
      sessionStorage.removeItem('shadow_auth');
      localStorage.removeItem('shadow_auth');

      setTimeout(() => window.location.replace('/login?reason=password_changed'), 900);
    } catch (err) {
      const msg = err.message || 'Failed to update credentials. Please check your temporary password.';
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="security-heading" className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col gap-6">
      <div className="border-b border-slate-100 pb-4">
        <h2 id="security-heading" className="text-lg font-bold text-[#0a1142]">Security Credentials & Session Management</h2>
        <p className="text-xs text-slate-500">Updating your password promotes your account from temporary quarantine to full academic access.</p>
      </div>

      {errorMsg && (
        <div role="alert" className="p-4 rounded-xl text-xs flex items-start gap-3 border bg-rose-50 border-rose-200 text-rose-800 animate-in fade-in duration-150">
          <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-600" />
          <div className="flex-1 font-semibold leading-relaxed">{errorMsg}</div>
        </div>
      )}

      {successMsg && (
        <div role="status" className="p-4 rounded-xl text-xs flex items-start gap-3 border bg-emerald-50 border-emerald-200 text-emerald-800 animate-in fade-in duration-150">
          <CheckCircle2 size={16} className="shrink-0 mt-0.5 text-emerald-600" />
          <div className="flex-1 font-semibold leading-relaxed">{successMsg}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6 max-w-xl" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="currentPassword" className="text-xs font-bold text-slate-700">Current Temporary Password <span className="text-red-500">*</span></label>
          <input
            id="currentPassword" type="password" autoComplete="current-password"
            value={currentPassword} onChange={(e) => { setCurrentPassword(e.target.value); setErrorMsg(null); }}
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            placeholder="Enter temporary password given by administrator"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="newPassword" className="text-xs font-bold text-slate-700">New Permanent Password <span className="text-red-500">*</span></label>
          <input
            id="newPassword" type="password" autoComplete="new-password"
            value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setErrorMsg(null); }}
            className={`px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isTooShort ? 'border-amber-400 focus:ring-amber-400' : 'border-slate-300 focus:ring-[#0a1142]'}`}
            placeholder="•••••••••••• (minimum 8 characters)"
          />
          {isTooShort && <span className="text-[11px] text-amber-600 font-semibold">Minimum 8 characters required ({newPassword.length}/8)</span>}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmPassword" className="text-xs font-bold text-slate-700">Confirm New Password <span className="text-red-500">*</span></label>
          <input
            id="confirmPassword" type="password" autoComplete="new-password"
            value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setErrorMsg(null); }}
            className={`px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none focus:ring-2 ${isMismatch ? 'border-rose-400 focus:ring-rose-400' : 'border-slate-300 focus:ring-[#0a1142]'}`}
            placeholder="Re-enter new password"
          />
          {isMismatch && <span className="text-[11px] text-rose-600 font-semibold">Passwords do not match</span>}
        </div>

        <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" size={16} />
          <div className="leading-relaxed">
            <strong>Security Notice:</strong> Setting your permanent password terminates quarantine and enables full academic access.
          </div>
        </div>

        <div className="pt-2">
          <button
            type="button" onClick={handleSubmit} disabled={isSubmitting}
            className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 text-white text-xs sm:text-sm font-bold hover:bg-red-700 active:scale-[0.98] transition-all shadow-md disabled:opacity-50 min-h-[44px] cursor-pointer"
          >
            {isSubmitting ? <><RefreshCw size={15} className="animate-spin" /> Updating Credentials...</> : <><Lock size={15} /> Update Password & Terminate Sessions</>}
          </button>
        </div>
      </form>
    </section>
  );
}

export default ProfileSecurityTab;
