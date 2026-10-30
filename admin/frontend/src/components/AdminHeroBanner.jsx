import React from 'react';
import { Clock, ShieldCheck, UserPlus, Power } from 'lucide-react';

/**
 * Admin Dashboard Hero Banner
 *
 * Implements:
 * 1. Signature dark navy container (#0a1142) matching student dashboard hero rhythm
 * 2. Amber/gold typography accents for institutional authority
 * 3. Academic term telemetry badge
 * 4. Interactive Registration Window toggle (WCAG min 44x44px target)
 * 5. Primary action button triggering User Provisioning modal
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function AdminHeroBanner({
  semesterId = '',
  semesterName = 'No Active Academic Semester',
  isRegistrationOpen = false,
  onToggleWindow,
  onOpenProvisionModal,
}) {
  return (
    <section className="bg-[#0a1142] text-white rounded-2xl p-6 sm:p-8 shadow-sm border border-[#0a1142]/40 relative overflow-hidden">
      {/* Background Accent Subtle Glow */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-amber-500/10 via-transparent to-transparent rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        {/* Left Column: Governance Title & Tag */}
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-400/20 text-[#ffb81c] border border-amber-400/30 mb-2">
            <ShieldCheck size={14} className="text-[#ffb81c]" aria-hidden="true" />
            <span>UNIOSUN FOCIT LMS • System Control Plane</span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display text-white">
            Welcome, <span className="text-[#ffb81c]">Administrator</span>
          </h1>

          <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl">
            Faculty of Computing & Information Technology • Central Governance Cockpit
          </p>
        </div>

        {/* Right Column: Academic Term & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center lg:items-end gap-3 shrink-0">
          {/* Active Semester Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 text-xs font-medium text-slate-200">
            <Clock size={15} className="text-[#ffb81c]" aria-hidden="true" />
            <span>Active Term: <strong className="text-white font-bold">{semesterName}</strong></span>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-3">
            {/* Registration Window Switch */}
            <button
              type="button"
              disabled={!semesterId}
              onClick={() => onToggleWindow(semesterId, isRegistrationOpen)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-bold transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${
                isRegistrationOpen
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
              }`}
              title="Click to toggle faculty course registration open/closed"
              aria-label={`Registration Window is currently ${isRegistrationOpen ? 'OPEN' : 'CLOSED'}`}
            >
              <Power size={14} className={isRegistrationOpen ? 'text-emerald-400' : 'text-rose-400'} aria-hidden="true" />
              <span>Registration Window: <strong className="uppercase">{isRegistrationOpen ? 'OPEN' : 'CLOSED'}</strong></span>
            </button>

            {/* Provision User Primary Button */}
            <button
              type="button"
              onClick={onOpenProvisionModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-bold bg-[#ffb81c] text-[#0a1142] hover:bg-amber-400 active:scale-[0.98] transition-all shadow-sm font-sans"
              title="Provision a new student or academic staff account"
            >
              <UserPlus size={15} aria-hidden="true" />
              <span>+ Provision User</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
