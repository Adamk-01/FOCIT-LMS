/**
 * FOCIT LMS - Student Mode 2 Passcode Check-In Modal
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Invariants:
 * 1. Physical Viewport: Quarantined inside fixed portal overlay with touch targets >= 44x44px
 * 2. Dual-State Partitioning: Draft in-flight PIN persisted in student-scoped sessionStorage
 * 3. Mutation Lock: Button and inputs disabled during mutation transit
 * 4. Zero-Trust Feedback: Explicit error boundaries for invalid PIN, expired windows, and locked sessions
 * 5. Flexible Ingress: Operates in both auto-detected session mode and manual course-selection mode
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  KeyRound, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Sparkles, 
  ShieldCheck, 
  BookOpen,
  Calendar
} from 'lucide-react';
import { useSubmitOtpCheckIn } from '../../hooks/useStudentAttendance';
import { useAuth } from '../../contexts/AuthContext';

export function StudentOtpCheckInModal({
  isOpen,
  onClose,
  sessionData = null, // { sessionId, courseId, courseCode, courseTitle, weekNumber, sessionDate, remainingSeconds }
  enrolledCourses = [],
  defaultCourseId = null,
  defaultWeekNumber = null,
  defaultSessionDate = null,
  onSuccess,
}) {
  const { user } = useAuth();
  const studentId = user?.student_id || user?.username || 'student';

  const [selectedCourseId, setSelectedCourseId] = useState(
    sessionData?.courseId || defaultCourseId || enrolledCourses[0]?.course_id || enrolledCourses[0]?.id || ''
  );

  const activeCourseId = sessionData?.courseId || selectedCourseId;
  const activeCourse = enrolledCourses.find((c) => (c.course_id || c.id || c.courseId) === activeCourseId);
  const activeCourseCode = sessionData?.courseCode || activeCourse?.code || activeCourseId || 'Course';
  const activeCourseTitle = sessionData?.courseTitle || activeCourse?.title || 'Live Lecture Session';
  const weekNumber = sessionData?.weekNumber || defaultWeekNumber || 1;
  const initialSeconds = sessionData?.remainingSeconds || 300;

  const rawSessionDate = sessionData?.sessionDate || defaultSessionDate || null;
  const formattedSessionDate = useMemo(() => {
    if (!rawSessionDate) return null;
    try {
      return new Date(rawSessionDate).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch (_) {
      return null;
    }
  }, [rawSessionDate]);

  const draftStorageKey = `focit_otp_draft:${studentId}:${activeCourseId || 'any'}`;

  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successInfo, setSuccessInfo] = useState(null);

  const inputRefs = useRef([]);
  const submitMutation = useSubmitOtpCheckIn();

  // 1. Sync selected course when props change
  useEffect(() => {
    if (sessionData?.courseId) {
      setSelectedCourseId(sessionData.courseId);
    } else if (defaultCourseId) {
      setSelectedCourseId(defaultCourseId);
    } else if (enrolledCourses.length > 0 && !selectedCourseId) {
      setSelectedCourseId(enrolledCourses[0]?.course_id || enrolledCourses[0]?.id || '');
    }
  }, [sessionData, defaultCourseId, enrolledCourses]);

  // 2. Rehydrate draft digits from sessionStorage on open
  useEffect(() => {
    if (!isOpen) {
      setDigits(['', '', '', '', '', '']);
      setErrorMsg(null);
      setIsSuccess(false);
      setSuccessInfo(null);
      return;
    }

    setSecondsLeft(initialSeconds);

    try {
      const saved = sessionStorage.getItem(draftStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === 6) {
          setDigits(parsed);
        }
      }
    } catch (_) {}

    // Focus first empty digit
    const firstEmptyIndex = digits.findIndex((d) => !d);
    const targetIdx = firstEmptyIndex === -1 ? 0 : firstEmptyIndex;
    setTimeout(() => {
      inputRefs.current[targetIdx]?.focus();
    }, 50);
  }, [isOpen, draftStorageKey, initialSeconds]);

  // 3. Countdown Timer (if running an active session)
  useEffect(() => {
    if (!isOpen || isSuccess || secondsLeft <= 0 || !sessionData) return;
    const timer = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, isSuccess, secondsLeft, sessionData]);

  // 4. Save draft to sessionStorage on digit change
  const updateDigits = (newDigits) => {
    setDigits(newDigits);
    setErrorMsg(null);
    try {
      sessionStorage.setItem(draftStorageKey, JSON.stringify(newDigits));
    } catch (_) {}
  };

  const handleDigitChange = (index, value) => {
    const rawVal = value.replace(/\D/g, '');
    if (!rawVal) {
      const next = [...digits];
      next[index] = '';
      updateDigits(next);
      return;
    }

    const next = [...digits];
    next[index] = rawVal.slice(-1);
    updateDigits(next);

    // Auto-advance focus to next empty input
    if (index < 5 && rawVal) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    const next = [...digits];
    for (let i = 0; i < 6; i++) {
      next[i] = pasted[i] || '';
    }
    updateDigits(next);

    const focusIdx = Math.min(5, pasted.length);
    inputRefs.current[focusIdx]?.focus();
  };

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    const fullPin = digits.join('');
    if (fullPin.length !== 6) {
      setErrorMsg('Please enter all 6 digits of the attendance passcode.');
      return;
    }

    if (!activeCourseId) {
      setErrorMsg('Please select an enrolled course module to check in for.');
      return;
    }

    if (sessionData && secondsLeft <= 0) {
      setErrorMsg('This passcode window has expired. Please ask your lecturer for a new code.');
      return;
    }

    setErrorMsg(null);

    submitMutation.mutate(
      {
        courseId: activeCourseId,
        sessionId: sessionData?.sessionId,
        otp: fullPin,
      },
      {
        onSuccess: (data) => {
          setIsSuccess(true);
          setSuccessInfo(data);
          try {
            sessionStorage.removeItem(draftStorageKey);
          } catch (_) {}
          if (onSuccess) onSuccess(data);
        },
        onError: (err) => {
          const msg = err?.data?.error || err?.response?.data?.error || err?.message || 'Failed to verify attendance passcode.';
          setErrorMsg(msg);
        },
      }
    );
  };

  // Auto-submit when all 6 digits filled
  useEffect(() => {
    const fullPin = digits.join('');
    if (fullPin.length === 6 && !submitMutation.isPending && !isSuccess && !errorMsg) {
      handleSubmit();
    }
  }, [digits]);

  if (!isOpen) return null;

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  return createPortal(
    <div 
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-fade-in min-h-[100dvh] max-h-[100dvh] overflow-y-auto"
      style={{ contain: 'layout paint' }}
    >
      <div 
        role="dialog"
        aria-modal="true"
        aria-labelledby="otp-modal-title"
        className="relative w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] animate-slide-up sm:animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Banner */}
        <div className="px-6 py-5 bg-[#0a1142] text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#ffb81c]/20 text-[#ffb81c] rounded-xl">
              <KeyRound size={20} />
            </div>
            <div>
              <h2 id="otp-modal-title" className="text-base font-bold font-display">
                Lecture Attendance Check-In
              </h2>
              <p className="text-xs text-gray-300 flex items-center gap-1.5 flex-wrap">
                <span>{activeCourseCode}</span>
                <span>• Week {weekNumber}</span>
                {formattedSessionDate && (
                  <>
                    <span>•</span>
                    <span className="flex items-center gap-1 text-[#ffb81c]">
                      <Calendar size={11} />
                      <span>{formattedSessionDate}</span>
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/10 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
            aria-label="Close check-in modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          {isSuccess ? (
            <div className="text-center py-6 space-y-4 animate-fade-in">
              <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-200">
                <CheckCircle2 size={36} />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-bold text-[#0a1142] font-display">
                  Attendance Confirmed!
                </h3>
                <p className="text-xs text-gray-600 max-w-xs mx-auto">
                  {successInfo?.message || `Your presence for ${activeCourseCode} has been recorded and verified in the authoritative course ledger.`}
                </p>
                <div className="py-2.5 px-3.5 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 inline-flex flex-col gap-1 shadow-2xs">
                  <div className="font-bold flex items-center justify-center gap-1.5 text-emerald-950">
                    <Calendar size={13} className="text-emerald-700" />
                    <span>Week {successInfo?.weekNumber || weekNumber} Lecture</span>
                    {formattedSessionDate && <span>• {formattedSessionDate}</span>}
                  </div>
                  {successInfo?.markedAt && (
                    <p className="text-[11px] text-emerald-700">
                      Confirmed at: {new Date(successInfo.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[44px] px-4 py-2.5 bg-[#0a1142] hover:bg-[#16258f] text-white rounded-xl text-xs font-bold transition shadow-md cursor-pointer"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Course Selection (when not strictly locked by an active session) */}
              {!sessionData?.courseId && enrolledCourses.length > 0 && (
                <div className="space-y-1.5 text-left">
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">
                    Select Enrolled Course Module
                  </label>
                  <select
                    value={selectedCourseId}
                    onChange={(e) => {
                      setSelectedCourseId(e.target.value);
                      setErrorMsg(null);
                    }}
                    disabled={submitMutation.isPending}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 bg-white text-xs font-bold text-[#0a1142] focus:ring-2 focus:ring-[#0a1142] focus:border-[#0a1142]"
                  >
                    {enrolledCourses.map((c) => {
                      const cid = c.course_id || c.id || c.courseId;
                      return (
                        <option key={cid} value={cid}>
                          {c.code} — {c.title}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Context Pill & Live Timer */}
              <div className="flex items-center justify-between p-3.5 bg-gray-50 rounded-xl border border-gray-100">
                <div className="min-w-0 text-left space-y-0.5">
                  <p className="text-xs font-bold text-[#0a1142] truncate">
                    {activeCourseTitle}
                  </p>
                  <p className="text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold text-gray-700">Week {weekNumber}</span>
                    {formattedSessionDate && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-gray-600">
                          <Calendar size={11} />
                          <span>{formattedSessionDate}</span>
                        </span>
                      </>
                    )}
                  </p>
                </div>

                {sessionData?.remainingSeconds > 0 && (
                  <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold border shrink-0 ${
                    secondsLeft <= 60 
                      ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}>
                    <Clock size={13} />
                    <span>{formattedTime}</span>
                  </div>
                )}
              </div>

              {/* 6-Box Segmented Numeric PIN Input */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-gray-700 text-center uppercase tracking-wider">
                  6-Digit Passcode
                </label>
                <div className="flex items-center justify-center gap-2 sm:gap-2.5" onPaste={handlePaste}>
                  {digits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (inputRefs.current[idx] = el)}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={digit}
                      disabled={submitMutation.isPending}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleKeyDown(idx, e)}
                      className={`w-11 h-13 sm:w-12 sm:h-14 text-center text-xl sm:text-2xl font-black rounded-xl border-2 transition-all focus:outline-hidden ${
                        errorMsg 
                          ? 'border-rose-400 bg-rose-50/50 text-rose-800' 
                          : digit
                            ? 'border-[#0a1142] bg-blue-50/30 text-[#0a1142]'
                            : 'border-gray-200 bg-white text-gray-800 focus:border-[#0a1142] focus:ring-2 focus:ring-blue-100'
                      }`}
                      aria-label={`Passcode digit ${idx + 1}`}
                    />
                  ))}
                </div>
              </div>

              {/* Error Alert */}
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-800 text-xs animate-shake text-left">
                  <AlertCircle size={16} className="shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Submit Mutation Lock Button */}
              <button
                type="submit"
                disabled={submitMutation.isPending || digits.join('').length !== 6 || (sessionData && secondsLeft <= 0)}
                className="w-full min-h-[44px] px-5 py-3 bg-[#0a1142] hover:bg-[#16258f] disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                {submitMutation.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin text-[#ffb81c]" />
                    <span>Verifying Passcode...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} className="text-[#ffb81c]" />
                    <span>Confirm Attendance</span>
                  </>
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default StudentOtpCheckInModal;
