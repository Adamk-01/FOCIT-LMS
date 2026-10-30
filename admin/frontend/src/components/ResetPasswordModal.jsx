import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Key, Copy, Check, X, AlertTriangle } from 'lucide-react';

/**
 * <ResetPasswordModal />
 * Single-reveal dialog for resetting temporary credentials.
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function ResetPasswordModal({ isOpen, user, onClose, onReset, isSubmitting }) {
  const [customPassword, setCustomPassword] = useState('');
  const [newPasswordResult, setNewPasswordResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);

  if (!isOpen || !user) return null;

  const handleClose = () => {
    if (isSubmitting) return;
    setCustomPassword('');
    setNewPasswordResult(null);
    setCopied(false);
    setErrorMsg(null);
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const res = await onReset(user.id, customPassword.trim() || undefined);
      if (res?.temporaryPassword) {
        setNewPasswordResult(res.temporaryPassword);
      } else {
        handleClose();
      }
    } catch (err) {
      setErrorMsg(err.message || 'Failed to reset password');
    }
  };

  const handleCopy = async () => {
    if (!newPasswordResult) return;
    try {
      await navigator.clipboard.writeText(newPasswordResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrorMsg('Failed to copy to clipboard');
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex min-h-full items-center justify-center p-4 sm:p-6">
      <div role="dialog" aria-modal="true" className="bg-white rounded-2xl max-w-md w-full p-6 sm:p-7 shadow-xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-150 my-auto">
        <button
          type="button"
          onClick={handleClose}
          disabled={isSubmitting}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        {newPasswordResult ? (
          <div>
            <div className="w-11 h-11 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
              <Key size={22} />
            </div>
            <h2 className="text-lg font-black text-[#0a1142] font-display">Temporary Password Generated</h2>
            <p className="text-xs text-gray-600 mt-1">Credentials for <strong>{user.fullName || user.name}</strong> ({user.identifier || user.matricNumber}) have been reset.</p>

            <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">New Temporary Password</span>
              <div className="flex items-center justify-between gap-3">
                <code className="text-base font-mono font-bold text-[#0a1142] tracking-wider select-all">{newPasswordResult}</code>
                <button type="button" onClick={handleCopy} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#0a1142] text-white hover:bg-blue-900 transition-colors">
                  {copied ? <><Check size={14} className="text-emerald-400" /><span>Copied!</span></> : <><Copy size={14} /><span>Copy</span></>}
                </button>
              </div>
            </div>

            <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-amber-800 text-xs">
              <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              <span>Advise the user to sign in with this temporary password and immediately set their permanent password.</span>
            </div>

            <div className="mt-6 flex justify-end">
              <button type="button" onClick={handleClose} className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors min-h-[44px]">
                Close & Finish
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="w-11 h-11 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-1">
              <Key size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black text-[#0a1142] font-display">Reset Temporary Password</h2>
              <p className="text-xs text-gray-500 mt-0.5">Generate a new temporary password for <strong>{user.fullName || user.name}</strong> ({user.identifier || user.matricNumber}).</p>
            </div>

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">{errorMsg}</div>
            )}

            <div>
              <label htmlFor="customPassword" className="block text-xs font-bold text-gray-700 mb-1">
                Custom Password <span className="font-normal text-gray-400">(Optional)</span>
              </label>
              <input
                id="customPassword" type="text" value={customPassword} onChange={(e) => setCustomPassword(e.target.value)}
                placeholder="Leave blank to auto-generate (min 8 chars)"
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142]"
              />
              <span className="text-[11px] text-gray-400 mt-1 block">Leaving blank generates a cryptographically secure 12-character password.</span>
            </div>

            <div className="mt-2 flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
              <button type="button" onClick={handleClose} disabled={isSubmitting} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition-colors">
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} className="px-5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold bg-[#0a1142] hover:bg-blue-900 text-white transition-all disabled:opacity-50 shadow-sm">
                {isSubmitting ? 'Generating...' : 'Reset Credentials'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
export default ResetPasswordModal;
