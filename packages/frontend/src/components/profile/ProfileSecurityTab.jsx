import React from 'react';
import { AlertTriangle, RefreshCw, Lock } from 'lucide-react';

/**
 * <ProfileSecurityTab />
 *
 * Tier 4 Security & Credential Teardown Form
 */
export function ProfileSecurityTab({
  form,
  onChange,
  onSubmit,
  isChangingPassword,
}) {
  return (
    <section aria-labelledby="security-heading" className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col gap-6">
      <div className="border-b border-slate-100 pb-4">
        <h2 id="security-heading" className="text-lg font-bold text-[#0a1142]">
          Security Credentials & Session Management
        </h2>
        <p className="text-xs text-slate-500">
          Mutating your password revokes all active session hashes across campus workstations.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-xl">
        {/* Current Password */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="currentPassword" className="text-xs font-bold text-slate-700">
            Current Password
          </label>
          <input
            id="currentPassword"
            type="password"
            required
            value={form.currentPassword}
            onChange={(e) => onChange({ ...form, currentPassword: e.target.value })}
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            placeholder="••••••••••••"
          />
        </div>

        {/* New Password */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="newPassword" className="text-xs font-bold text-slate-700">
            New Password (Minimum 8 Characters)
          </label>
          <input
            id="newPassword"
            type="password"
            required
            minLength={8}
            value={form.newPassword}
            onChange={(e) => onChange({ ...form, newPassword: e.target.value })}
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            placeholder="••••••••••••"
          />
        </div>

        {/* Confirm New Password */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmPassword" className="text-xs font-bold text-slate-700">
            Confirm New Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            minLength={8}
            value={form.confirmPassword}
            onChange={(e) => onChange({ ...form, confirmPassword: e.target.value })}
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            placeholder="••••••••••••"
          />
        </div>

        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={16} />
          <div className="leading-relaxed">
            <strong>4-Phase Teardown Notice:</strong> Updating your password will immediately terminate background SWR queries, clear your local session nonce, and redirect you to the login screen.
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={isChangingPassword}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 text-white text-xs sm:text-sm font-semibold hover:bg-red-700 transition-colors shadow-md disabled:opacity-50 min-h-[44px]"
          >
            {isChangingPassword ? (
              <>
                <RefreshCw size={15} className="animate-spin" /> Quenching Sessions & Updating...
              </>
            ) : (
              <>
                <Lock size={15} /> Update Password & Terminate Sessions
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

export default ProfileSecurityTab;
