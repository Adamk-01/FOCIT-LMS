import React, { useState } from 'react';
import { Shield, KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/api';

/**
 * Administrator Profile & Security Settings Page
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function AdminProfilePage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setFeedback(null);
    if (newPassword.length < 8) return setErrorMsg('New password must be at least 8 characters long.');
    if (newPassword !== confirmPassword) return setErrorMsg('New password and confirmation do not match.');

    setIsSubmitting(true);
    try {
      const res = await apiClient.post('/student/change-password', { currentPassword, newPassword });
      setFeedback(res.data?.message || 'Credentials updated successfully. Redirecting to login...');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        sessionStorage.removeItem('shadow_auth');
        localStorage.removeItem('shadow_auth');
        window.location.href = '/login?reason=password_changed';
      }, 1500);
    } catch (err) {
      setErrorMsg(err.response?.data?.error || err.message || 'Failed to update administrator credentials.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6 pb-16">
      {/* Header */}
      <div className="pb-4 border-b border-gray-200">
        <h1 className="text-2xl font-black text-[#0a1142] font-display">Administrator Profile & Security</h1>
        <p className="text-xs text-gray-500 mt-1">Institutional identity governance, access credentials, and cryptographic security</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Left: Identity Credentials Card */}
        <div className="md:col-span-5 bg-white rounded-2xl border border-gray-200/80 shadow-xs p-6 space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-[#0a1142] text-amber-400 flex items-center justify-center mb-2">
            <Shield size={24} />
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Administrator Account</span>
            <span className="text-base font-bold text-[#0a1142]">{user?.username || user?.matric_number || user?.id || '—'}</span>
          </div>
          <div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Assigned Role</span>
            <span className="inline-flex px-2.5 py-0.5 mt-1 rounded-full text-xs font-extrabold bg-blue-100 text-blue-900">
              {user?.role || 'ADMIN'}
            </span>
          </div>
          <div className="pt-3 border-t border-gray-100">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Institutional Email</span>
            <span className="text-xs font-medium text-slate-700">{user?.email || '—'}</span>
          </div>
          <div className="pt-3 border-t border-gray-100">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Session Authorization</span>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-bold mt-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              FULL_ACCESS (Verified)
            </span>
          </div>
        </div>

        {/* Right: Password Rotation Card */}
        <div className="md:col-span-7 bg-white rounded-2xl border border-gray-200/80 shadow-xs p-6">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-800 mb-4 pb-3 border-b border-gray-100">
            <KeyRound size={17} className="text-amber-500" />
            <span>Rotate Administrative Password</span>
          </div>

          {feedback && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}

          {errorMsg && (
            <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle size={16} className="text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Current Password</label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="w-full px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">New Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="w-full px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-type new password"
                className="w-full px-3.5 py-2.5 text-xs border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
              />
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 w-full py-2.5 rounded-xl text-xs font-bold bg-[#0a1142] hover:bg-blue-900 text-white transition-all disabled:opacity-50 min-h-[44px]"
            >
              {isSubmitting ? 'Updating Credentials...' : 'Save New Password'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
export default AdminProfilePage;
