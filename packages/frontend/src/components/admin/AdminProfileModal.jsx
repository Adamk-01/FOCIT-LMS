import React, { useState } from 'react';
import { X, Shield, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiClient } from '../../lib/api';

/**
 * Administrator Profile & Security Settings Modal
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function AdminProfileModal({ isOpen, onClose, user }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  if (!isOpen) return null;

  const handleClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFeedback(null);
    setErrorMsg(null);
    onClose();
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedback(null);
    if (newPassword.length < 8) return setErrorMsg('New password must be at least 8 characters long.');
    if (newPassword !== confirmPassword) return setErrorMsg('New password and confirmation do not match.');

    setIsSubmitting(true);
    try {
      const res = await apiClient.post('/student/change-password', { currentPassword, newPassword });
      setFeedback(res.data?.message || 'Administrator password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to update credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="admin-profile-title"
        className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-150">
        <button type="button" onClick={handleClose} aria-label="Close dialog"
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-[#0a1142] text-amber-400 flex items-center justify-center">
            <Shield size={22} />
          </div>
          <div>
            <h2 id="admin-profile-title" className="text-lg font-extrabold text-[#0a1142] font-display">Administrator Profile & Security</h2>
            <p className="text-xs text-gray-500">Institutional control plane identity and credential lifecycle</p>
          </div>
        </div>

        {/* Identity Details Card */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6 grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-gray-400 uppercase tracking-wider text-[10px] font-bold block">Admin Account</span>
            <span className="font-bold text-[#0a1142] text-sm">{user?.username || user?.matric_number || user?.id || '—'}</span>
          </div>
          <div>
            <span className="text-gray-400 uppercase tracking-wider text-[10px] font-bold block">Assigned Role</span>
            <span className="inline-flex px-2 py-0.5 mt-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-900">{user?.role || 'ADMIN'}</span>
          </div>
          <div className="col-span-2 pt-2 border-t border-slate-200/60">
            <span className="text-gray-400 uppercase tracking-wider text-[10px] font-bold block">Institutional Email</span>
            <span className="font-medium text-slate-700">{user?.email || '—'}</span>
          </div>
        </div>

        {/* Password Mutation Section */}
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
            <KeyRound size={15} className="text-amber-500" />
            <span>Rotate Administrative Password</span>
          </div>

          {feedback && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-bold text-gray-700 mb-1">Current Password</label>
            <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password" className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0a1142]" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">New Password</label>
              <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 chars" className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0a1142]" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-gray-700 mb-1">Confirm New Password</label>
              <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type new password" className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0a1142]" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3">
            <button type="button" onClick={handleClose} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition-colors">
              Close
            </button>
            <button type="submit" disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#0a1142] hover:bg-blue-900 text-white transition-all disabled:opacity-50 min-h-[40px]">
              {isSubmitting ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
export default AdminProfileModal;
