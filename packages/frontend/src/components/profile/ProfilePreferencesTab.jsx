import React from 'react';
import { RefreshCw, Save } from 'lucide-react';

/**
 * <ProfilePreferencesTab />
 *
 * Tier 3 JSONB State - Preferences & Alerts Form
 */
export function ProfilePreferencesTab({
  form,
  onChange,
  onSubmit,
  isPending,
}) {
  return (
    <section aria-labelledby="preferences-heading" className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col gap-6">
      <div className="border-b border-slate-100 pb-4">
        <h2 id="preferences-heading" className="text-lg font-bold text-[#0a1142]">
          System Preferences & Notifications
        </h2>
        <p className="text-xs text-slate-500">
          Customize automated alerts, timetable reminders, and user interface options.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Notification Conduit
          </h3>

          {/* Email Notifications Toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-slate-800">Course & Senate Announcements</span>
              <span className="text-xs text-slate-500">
                Receive urgent broadcast notifications from lecturers and departmental heads via email.
              </span>
            </div>
            <input
              type="checkbox"
              id="email_notifications"
              checked={form.email_notifications}
              onChange={(e) => onChange({ ...form, email_notifications: e.target.checked })}
              className="w-5 h-5 accent-[#0a1142] rounded cursor-pointer min-h-[44px] min-w-[44px]"
            />
          </div>

          {/* Quiz Reminders Toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-slate-800">Quiz & Assessment Deadline Alerts</span>
              <span className="text-xs text-slate-500">
                Pushes a 24-hour reminder before online test windows close on active modules.
              </span>
            </div>
            <input
              type="checkbox"
              id="quiz_reminders"
              checked={form.quiz_reminders}
              onChange={(e) => onChange({ ...form, quiz_reminders: e.target.checked })}
              className="w-5 h-5 accent-[#0a1142] rounded cursor-pointer min-h-[44px] min-w-[44px]"
            />
          </div>

          {/* SMS Urgent Alerts Toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-slate-800">Campus Emergency & Timetable SMS</span>
              <span className="text-xs text-slate-500">
                Instant cellular SMS for exam venue reallocations and severe weather alerts.
              </span>
            </div>
            <input
              type="checkbox"
              id="sms_alerts"
              checked={form.sms_alerts}
              onChange={(e) => onChange({ ...form, sms_alerts: e.target.checked })}
              className="w-5 h-5 accent-[#0a1142] rounded cursor-pointer min-h-[44px] min-w-[44px]"
            />
          </div>

          {/* Forum Digest Select */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-slate-800">Discussion Forum Digest Frequency</span>
              <span className="text-xs text-slate-500">
                Frequency for consolidated forum thread digests and peer replies.
              </span>
            </div>
            <select
              value={form.forum_digest}
              onChange={(e) => onChange({ ...form, forum_digest: e.target.value })}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#0a1142] min-h-[44px]"
            >
              <option value="daily">Daily Morning Digest</option>
              <option value="weekly">Weekly Friday Digest</option>
              <option value="immediate">Immediate Per-Reply Alert</option>
              <option value="none">Disabled (No Digest)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-4 pt-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Display & Accessibility
          </h3>

          {/* Interface Theme */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-slate-800">Portal Color Scheme</span>
              <span className="text-xs text-slate-500">
                Select your preferred interface display mode.
              </span>
            </div>
            <div className="flex items-center gap-2">
              {['system', 'light', 'dark'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onChange({ ...form, theme: mode })}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors min-h-[44px] ${
                    form.theme === mode
                      ? 'bg-[#0a1142] text-white shadow-sm'
                      : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Compact Tables Toggle */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-slate-800">Compact Density for Gradebook</span>
              <span className="text-xs text-slate-500">
                Tightens row padding across grade tables for enhanced data scanning on small screens.
              </span>
            </div>
            <input
              type="checkbox"
              id="compact_tables"
              checked={form.compact_tables}
              onChange={(e) => onChange({ ...form, compact_tables: e.target.checked })}
              className="w-5 h-5 accent-[#0a1142] rounded cursor-pointer min-h-[44px] min-w-[44px]"
            />
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#0a1142] text-white text-xs sm:text-sm font-semibold hover:bg-[#16258f] transition-colors shadow-md disabled:opacity-50 min-h-[44px]"
          >
            {isPending ? (
              <>
                <RefreshCw size={15} className="animate-spin" /> Persisting Settings...
              </>
            ) : (
              <>
                <Save size={15} /> Save Preference Profile
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

export default ProfilePreferencesTab;
