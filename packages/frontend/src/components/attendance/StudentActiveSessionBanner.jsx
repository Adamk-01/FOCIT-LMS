/**
 * FOCIT LMS - Student Active Attendance Session Alert Banner
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Renders an elevated alert banner whenever an enrolled course has an active Mode 2 OTP passcode session.
 * Respects circuit breaker lockout state (disabling ingress button if student has exhausted 3 attempts).
 */

import React, { useState } from 'react';
import { KeyRound, Clock, ArrowRight, ShieldAlert, Lock } from 'lucide-react';
import { useStudentActiveSessions } from '../../hooks/useStudentAttendance';
import { StudentOtpCheckInModal } from './StudentOtpCheckInModal';

export function StudentActiveSessionBanner() {
  const { data: activeSessions = [], isLoading } = useStudentActiveSessions();
  const [selectedSession, setSelectedSession] = useState(null);

  // Filter sessions that require student action (not yet checked in)
  const pendingSessions = activeSessions.filter((s) => !s.alreadyCheckedIn && s.remainingSeconds > 0);

  if (isLoading || pendingSessions.length === 0) {
    return null;
  }

  const primarySession = pendingSessions[0];
  const minutes = Math.floor(primarySession.remainingSeconds / 60);
  const seconds = primarySession.remainingSeconds % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  const isLockedOut = Boolean(primarySession.isLockedOut);

  return (
    <>
      <div 
        role="alert"
        aria-live="polite"
        className={`p-4 sm:p-5 rounded-2xl text-white shadow-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-fade-in ${
          isLockedOut
            ? 'bg-gradient-to-r from-gray-900 via-rose-950 to-gray-900 border-rose-500/30'
            : 'bg-gradient-to-r from-[#0a1142] via-[#16258f] to-[#0a1142] border-[#ffb81c]/30'
        }`}
      >
        <div className="flex items-start sm:items-center gap-3.5">
          <div className={`p-2.5 rounded-xl shrink-0 border ${
            isLockedOut 
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' 
              : 'bg-[#ffb81c]/20 text-[#ffb81c] border-[#ffb81c]/30 animate-pulse'
          }`}>
            {isLockedOut ? <Lock size={22} /> : <KeyRound size={22} />}
          </div>

          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${
                isLockedOut
                  ? 'bg-rose-500 text-white'
                  : 'bg-[#ffb81c] text-[#0a1142]'
              }`}>
                {!isLockedOut && <span className="w-1.5 h-1.5 rounded-full bg-[#0a1142] animate-ping" />}
                <span>{isLockedOut ? 'PASSCODE ENTRY LOCKED' : 'LIVE ATTENDANCE OPEN'}</span>
              </span>
              <span className="text-xs text-gray-300 font-medium">
                Week {primarySession.weekNumber}
              </span>
            </div>

            <h3 className="text-sm sm:text-base font-bold text-white font-display">
              {primarySession.courseCode} — {primarySession.courseTitle}
            </h3>
            <p className="text-xs text-gray-300 flex items-center gap-1.5 pt-0.5">
              {isLockedOut ? (
                <span className="text-rose-300">
                  Maximum attempts (3/3) exceeded. Please verify with your lecturer in class.
                </span>
              ) : (
                <>
                  <Clock size={12} className="text-[#ffb81c]" />
                  <span>Passcode window closes in: <strong className="text-white">{formattedTime}</strong></span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {isLockedOut ? (
            <button
              type="button"
              onClick={() => setSelectedSession(primarySession)}
              className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-400/40 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <Lock size={15} />
              <span>Locked Out Details</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSelectedSession(primarySession)}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 bg-[#ffb81c] hover:bg-[#e5a200] text-[#0a1142] rounded-xl text-xs font-extrabold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Enter Passcode</span>
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </div>

      {selectedSession && (
        <StudentOtpCheckInModal
          isOpen={Boolean(selectedSession)}
          sessionData={selectedSession}
          onClose={() => setSelectedSession(null)}
          onSuccess={() => setSelectedSession(null)}
        />
      )}
    </>
  );
}

export default StudentActiveSessionBanner;
