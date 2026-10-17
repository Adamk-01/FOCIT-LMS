import React from 'react';
import { ShieldCheck, Clock } from 'lucide-react';

/**
 * Dashboard Hero Banner
 *
 * Implements:
 * 1. University academic identity branding
 * 2. Welcome greetings with student name, programme, and level
 * 3. Authoritative active academic term badge
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function DashboardHeroBanner({
  fullName = 'Student',
  programme = 'Computer Science',
  level = 200,
  academicTerm = '2026/2027 Rain Semester',
}) {
  return (
    <header className="bg-gradient-to-r from-[#0a1142] via-[#070c2e] to-[#0a1142] rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-white/10">
      <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-[#ffb81c]/15 to-transparent pointer-events-none" />

      <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#ffb81c] border border-[#ffb81c]/30 mb-3">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>UNIOSUN FOCIT LMS • Academic Identity Portal</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display">
            Welcome, <span className="text-[#ffb81c]">{fullName}</span>
          </h1>
          <p className="text-gray-300 mt-2 text-sm sm:text-base font-medium">
            {programme} • Level {level}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center gap-3 text-sm">
            <Clock size={18} className="text-[#ffb81c]" aria-hidden="true" />
            <div>
              <p className="text-[11px] text-gray-300">Active Term</p>
              <p className="font-semibold text-white">{academicTerm}</p>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default DashboardHeroBanner;
