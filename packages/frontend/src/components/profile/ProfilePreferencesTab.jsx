import React from 'react';
import { RefreshCw, Save, Check } from 'lucide-react';
import { toast } from 'react-toastify';
import { applyTheme, applyTableDensity, applyAllPreferences } from '../../lib/preferencesManager';

/**
 * <ProfilePreferencesTab />
 *
 * Tier 3 JSONB State - System Preferences & Notifications Form
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function ProfilePreferencesTab({ form, onChange, onSubmit, isPending }) {
  const handleToggle = (key, val) => {
    const updated = { ...form, [key]: val };
    onChange(updated);
    applyAllPreferences(updated, false);

    if (key === 'theme') {
      applyTheme(val, false);
      toast.info(`Portal color scheme set to ${val.toUpperCase()}`, { autoClose: 1500 });
    } else if (key === 'compact_tables') {
      applyTableDensity(val, false);
      toast.info(`Compact table density ${val ? 'enabled' : 'disabled'}`, { autoClose: 1500 });
    }
  };

  return (
    <section aria-labelledby="preferences-heading" className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-6 transition-colors">
      <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
        <h2 id="preferences-heading" className="text-lg font-bold text-[#0a1142] dark:text-[#ffb81c]">
          System Preferences & Notifications
        </h2>
        <p className="text-xs text-slate-500 dark:text-gray-400">
          Customize automated alerts, timetable reminders, and user interface options.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Notification Conduit
          </h3>

          {/* Announcements */}
          <label htmlFor="email_notifications" className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 hover:border-slate-300 cursor-pointer transition-colors">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-sm font-bold text-slate-800">Course & Senate Announcements</span>
              <span className="text-xs text-slate-500">
                Receive urgent broadcast notifications from lecturers and departmental heads via email.
              </span>
            </div>
            <input
              type="checkbox"
              id="email_notifications"
              checked={Boolean(form.email_notifications)}
              onChange={(e) => handleToggle('email_notifications', e.target.checked)}
              className="sr-only peer"
            />
            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[#0a1142] peer-focus-visible:ring-offset-2 ${
              form.email_notifications
                ? 'bg-[#0a1142] text-white border-2 border-[#0a1142]'
                : 'bg-white border-2 border-slate-300'
            }`}>
              {form.email_notifications && <Check size={18} strokeWidth={3} />}
            </div>
          </label>

          {/* Quiz Reminders */}
          <label htmlFor="quiz_reminders" className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 hover:border-slate-300 cursor-pointer transition-colors">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-sm font-bold text-slate-800">Topic Mastery & Self-Practice Reminders</span>
              <span className="text-xs text-slate-500">
                Pushes reminders for weekly topic knowledge checks and self-practice quizzes on active modules.
              </span>
            </div>
            <input
              type="checkbox"
              id="quiz_reminders"
              checked={Boolean(form.quiz_reminders)}
              onChange={(e) => handleToggle('quiz_reminders', e.target.checked)}
              className="sr-only peer"
            />
            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[#0a1142] peer-focus-visible:ring-offset-2 ${
              form.quiz_reminders
                ? 'bg-[#0a1142] text-white border-2 border-[#0a1142]'
                : 'bg-white border-2 border-slate-300'
            }`}>
              {form.quiz_reminders && <Check size={18} strokeWidth={3} />}
            </div>
          </label>

          {/* SMS Alerts */}
          <label htmlFor="sms_alerts" className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 hover:border-slate-300 cursor-pointer transition-colors">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-sm font-bold text-slate-800">Campus Emergency & Timetable SMS</span>
              <span className="text-xs text-slate-500">
                Instant cellular SMS for exam venue reallocations and severe weather alerts.
              </span>
            </div>
            <input
              type="checkbox"
              id="sms_alerts"
              checked={Boolean(form.sms_alerts)}
              onChange={(e) => handleToggle('sms_alerts', e.target.checked)}
              className="sr-only peer"
            />
            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[#0a1142] peer-focus-visible:ring-offset-2 ${
              form.sms_alerts
                ? 'bg-[#0a1142] text-white border-2 border-[#0a1142]'
                : 'bg-white border-2 border-slate-300'
            }`}>
              {form.sms_alerts && <Check size={18} strokeWidth={3} />}
            </div>
          </label>

          {/* Forum Digest */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Discussion Forum Digest Frequency</span>
              <span className="text-xs text-slate-500 dark:text-gray-400">
                Frequency for consolidated forum thread digests and peer replies.
              </span>
            </div>
            <select
              value={form.forum_digest || 'daily'}
              onChange={(e) => handleToggle('forum_digest', e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#0a1142] min-h-[44px]"
            >
              <option value="daily" className="dark:bg-slate-800">Daily Morning Digest</option>
              <option value="weekly" className="dark:bg-slate-800">Weekly Friday Digest</option>
              <option value="immediate" className="dark:bg-slate-800">Immediate Per-Reply Alert</option>
              <option value="none" className="dark:bg-slate-800">Disabled (No Digest)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-4 pt-2">
          <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
            Display & Accessibility
          </h3>

          {/* Theme */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Portal Color Scheme</span>
              <span className="text-xs text-slate-500 dark:text-gray-400">
                Select your preferred interface display mode.
              </span>
            </div>
            <div className="flex items-center gap-2">
              {['system', 'light', 'dark'].map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => handleToggle('theme', mode)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors min-h-[44px] ${
                    form.theme === mode
                      ? 'bg-[#0a1142] dark:bg-[#ffb81c] text-white dark:text-[#0a1142] shadow-sm'
                      : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-600'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {/* Compact Tables */}
          <label htmlFor="compact_tables" className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 hover:border-slate-300 cursor-pointer transition-colors">
            <div className="flex flex-col gap-0.5 pr-4">
              <span className="text-sm font-bold text-slate-800">Compact Density for Gradebook</span>
              <span className="text-xs text-slate-500">
                Tightens row padding across grade tables for enhanced data scanning on small screens.
              </span>
            </div>
            <input
              type="checkbox"
              id="compact_tables"
              checked={Boolean(form.compact_tables)}
              onChange={(e) => handleToggle('compact_tables', e.target.checked)}
              className="sr-only peer"
            />
            <div className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-[#0a1142] peer-focus-visible:ring-offset-2 ${
              form.compact_tables
                ? 'bg-[#0a1142] text-white border-2 border-[#0a1142]'
                : 'bg-white border-2 border-slate-300'
            }`}>
              {form.compact_tables && <Check size={18} strokeWidth={3} />}
            </div>
          </label>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#0a1142] dark:bg-[#ffb81c] text-white dark:text-[#0a1142] text-xs sm:text-sm font-semibold hover:bg-[#16258f] dark:hover:bg-yellow-400 transition-colors shadow-md disabled:opacity-50 min-h-[44px]"
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
