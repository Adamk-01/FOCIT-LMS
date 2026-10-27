import React from 'react';
import { Bell, ChevronRight, CheckCircle2 } from 'lucide-react';

/**
 * Dashboard Notification & Registration Success Alert Strip
 *
 * Implements:
 * 1. Post-registration flash notification banner
 * 2. Unread real-time notification alert ribbon with one-click trigger
 * 3. WCAG minimum 44px touch targets on action buttons
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function DashboardNotificationStrip({
  registrationSuccess = false,
  registeredUnits = null,
  unreadCount = 0,
  notifications = [],
}) {
  return (
    <div className="space-y-4">
      {/* Registration Success Flash Notification */}
      {registrationSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm flex items-center justify-between shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
            <span>
              <strong>Registration Committed:</strong> Your academic modules have been finalized with{' '}
              <strong>{registeredUnits} units</strong>. Moodle enrolment is synchronizing in the background.
            </span>
          </div>
          <button
            type="button"
            onClick={() => window.history.replaceState({}, document.title)}
            className="min-h-[44px] px-3 py-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-200 touch-manipulation"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Real-Time Academic Notification Alert Strip */}
      {unreadCount > 0 && (
        <section
          aria-label="Pending Academic Notifications"
          className="p-4 rounded-2xl bg-gradient-to-r from-blue-50/90 to-indigo-50/60 dark:from-slate-800/90 dark:to-slate-850/60 border border-blue-200/80 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm animate-fade-in"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0a1142] text-[#ffb81c] flex items-center justify-center shrink-0 shadow-sm">
              <Bell size={18} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[#0a1142] dark:text-slate-100">
                  {unreadCount} Unread {unreadCount === 1 ? 'Notification' : 'Notifications'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-slate-700 text-[#0a1142] dark:text-indigo-300">
                  Action Required
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-slate-400 truncate mt-0.5">
                {notifications[0]?.title
                  ? `${notifications[0].title} — ${notifications[0].body}`
                  : 'You have updates regarding registration and course deadlines.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => document.getElementById('notification-trigger')?.click()}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-[#ffb81c] text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 transition-colors shadow-sm touch-manipulation"
          >
            <span>Open Notification Center</span>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </section>
      )}
    </div>
  );
}

export default DashboardNotificationStrip;
