import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, KeyRound, Clock, Users, CheckCircle2, RefreshCw, Copy, Check, AlertCircle, Play } from 'lucide-react';
import { apiClient } from '../../lib/api';

export function OtpProjectionModal({ isOpen, onClose, courseId, onSuccess }) {
  const [weekNumber, setWeekNumber] = useState(1);
  const [otp, setOtp] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [presentCount, setPresentCount] = useState(0);
  const [totalEnrolled, setTotalEnrolled] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const pollIntervalRef = useRef(null);

  const pollStatus = async () => {
    try {
      const res = await apiClient.get(
        `/attendance/courses/${encodeURIComponent(courseId)}/sessions/otp/status`
      );
      if (res.data?.active) {
        if (res.data.otp) setOtp(res.data.otp);
        if (res.data.weekNumber) setWeekNumber(res.data.weekNumber);
        setRemainingSeconds(res.data.remainingSeconds || 0);
        setPresentCount(res.data.presentCount || 0);
        setTotalEnrolled(res.data.totalEnrolled || 0);
        return true;
      } else {
        setRemainingSeconds(0);
        return false;
      }
    } catch (_) {
      return false;
    }
  };

  useEffect(() => {
    if (!isOpen) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      setOtp(null);
      setRemainingSeconds(0);
      setError(null);
      return;
    }

    let isCancelled = false;

    // On open, probe for existing active session rather than generating a new code
    pollStatus().then((isActive) => {
      if (!isCancelled && isActive) {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = setInterval(pollStatus, 3000);
      }
    });

    return () => {
      isCancelled = true;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isOpen, courseId]);

  const generatePasscode = async (targetWeek) => {
    setIsGenerating(true);
    setError(null);
    try {
      const selectedW = targetWeek || weekNumber;
      const res = await apiClient.post(
        `/attendance/courses/${encodeURIComponent(courseId)}/sessions/otp/generate`,
        { weekNumber: selectedW }
      );
      setOtp(res.data?.otp);
      setRemainingSeconds(res.data?.expiresInSeconds || 300);

      // Start polling status
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(pollStatus, 3000);
      pollStatus();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to generate attendance passcode');
    } finally {
      setIsGenerating(false);
    }
  };

  // Countdown timer tick every second
  useEffect(() => {
    if (!otp || remainingSeconds <= 0) return;
    const timer = setInterval(() => {
      setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [otp, remainingSeconds]);

  if (!isOpen) return null;

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  const handleCopy = () => {
    if (!otp) return;
    navigator.clipboard.writeText(otp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    if (onSuccess) onSuccess();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-xl bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col text-center animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#0a1142] text-white">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-[#ffb81c]/20 text-[#ffb81c] rounded-lg">
              <KeyRound size={16} />
            </span>
            <div className="text-left">
              <p className="text-[10px] font-bold text-[#ffb81c] uppercase tracking-wider">
                Mode 2: Fast Digital Roll Call
              </p>
              <h3 className="font-bold text-sm">Projection Passcode Screen</h3>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Projection Body */}
        <div className="p-8 space-y-6">
          {error && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl">
              {error}
            </div>
          )}

          {/* Week Selector */}
          <div className="flex items-center justify-center gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">Lecture Session:</span>
            <select
              value={weekNumber}
              disabled={isGenerating || (otp && remainingSeconds > 0)}
              onChange={(e) => setWeekNumber(Number(e.target.value))}
              className="px-3 py-1 text-xs font-bold border border-gray-300 rounded-lg bg-gray-50 text-[#0a1142] disabled:opacity-60"
            >
              {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  Week {w} Lecture Session
                </option>
              ))}
            </select>
          </div>

          {/* The Large Passcode Display */}
          <div className="relative py-6 px-4 bg-gradient-to-b from-[#0a1142]/5 to-indigo-50/50 rounded-3xl border border-indigo-100 space-y-3">
            <p className="text-xs font-bold text-indigo-900 uppercase tracking-widest">
              Ephemeral Check-In Passcode
            </p>

            {isGenerating ? (
              <div className="py-6 flex items-center justify-center gap-2 text-indigo-950 font-bold">
                <RefreshCw size={24} className="animate-spin text-[#0a1142]" />
                <span>Generating passcode...</span>
              </div>
            ) : !otp || remainingSeconds <= 0 ? (
              <div className="py-6 space-y-3">
                <p className="text-sm font-semibold text-gray-600">
                  {otp && remainingSeconds <= 0 ? 'Passcode Expired' : 'No Active Passcode Session'}
                </p>
                <button
                  type="button"
                  onClick={() => generatePasscode()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0a1142] rounded-xl hover:bg-[#16258f] shadow-md transition"
                >
                  <Play size={14} className="fill-white" />
                  <span>{otp ? 'Generate New Passcode' : `Generate Week ${weekNumber} Live Passcode`}</span>
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-center gap-3 font-mono font-black text-5xl md:text-6xl text-[#0a1142] tracking-wider select-all">
                  {otp ? otp.split('').join(' ') : '— — — — — —'}
                </div>

                <div className="flex items-center justify-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm"
                  >
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    <span>{copied ? 'Copied' : 'Copy Code'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => generatePasscode()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm"
                  >
                    <RefreshCw size={14} />
                    <span>Regenerate</span>
                  </button>
                </div>
              </div>
            )}

            {/* Countdown Clock */}
            {otp && remainingSeconds > 0 && (
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-white border border-indigo-100 text-indigo-950 shadow-sm">
                <Clock size={13} className={remainingSeconds < 60 ? 'text-rose-500 animate-pulse' : 'text-indigo-600'} />
                <span>Valid for: {formattedTime}</span>
              </div>
            )}
          </div>

          {/* Real-time Attendee Ticker */}
          <div className="grid grid-cols-2 gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-200">
            <div className="space-y-0.5">
              <p className="text-[11px] font-bold text-gray-500 uppercase">Checked In Live</p>
              <p className="text-2xl font-black text-emerald-700">{presentCount}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[11px] font-bold text-gray-500 uppercase">Total Enrolled</p>
              <p className="text-2xl font-black text-gray-800">{totalEnrolled || '—'}</p>
            </div>
          </div>

          {/* Student Instructions */}
          <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-[11px] text-blue-900 leading-relaxed text-left">
            <span className="font-bold">Instructions for Students:</span> Open student workspace on your phone or laptop, tap <strong>"Check-in"</strong>, and enter this 6-digit passcode before the timer runs out.
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default OtpProjectionModal;
