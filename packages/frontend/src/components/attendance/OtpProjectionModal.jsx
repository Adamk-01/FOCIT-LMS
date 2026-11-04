import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  KeyRound, 
  Clock, 
  Users, 
  CheckCircle2, 
  RefreshCw, 
  Copy, 
  Check, 
  AlertCircle, 
  Play, 
  Search,
  UserCheck,
  UserX,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { apiClient } from '../../lib/api';

export function OtpProjectionModal({ isOpen, onClose, courseId, onSuccess }) {
  const [weekNumber, setWeekNumber] = useState(1);
  const [otp, setOtp] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [presentCount, setPresentCount] = useState(0);
  const [totalEnrolled, setTotalEnrolled] = useState(0);
  const [records, setRecords] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(null);
  const [rosterFilter, setRosterFilter] = useState('ALL'); // 'ALL' | 'PRESENT' | 'ABSENT'
  const [searchQuery, setSearchQuery] = useState('');
  const [isRosterExpanded, setIsRosterExpanded] = useState(false);

  // Invariant #7 & #8: O(1) Map-based delta reconciliation to eliminate multi-table payload stampedes
  const recordsMapRef = useRef(new Map());
  const lastSinceRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const pollStatus = async () => {
    try {
      const url = lastSinceRef.current
        ? `/attendance/courses/${encodeURIComponent(courseId)}/sessions/otp/status?since=${encodeURIComponent(lastSinceRef.current)}`
        : `/attendance/courses/${encodeURIComponent(courseId)}/sessions/otp/status`;

      const res = await apiClient.get(url);
      if (res.data?.active) {
        if (res.data.otp) setOtp(res.data.otp);
        if (res.data.weekNumber) setWeekNumber(res.data.weekNumber);
        setRemainingSeconds(res.data.remainingSeconds || 0);
        setPresentCount(res.data.presentCount || 0);
        setTotalEnrolled(res.data.totalEnrolled || 0);

        if (res.data.serverTime) {
          lastSinceRef.current = res.data.serverTime;
        }

        if (Array.isArray(res.data.records)) {
          if (res.data.isDelta) {
            // O(1) Idempotent delta merge (handles MVCC sliding window overlap seamlessly)
            for (const rec of res.data.records) {
              recordsMapRef.current.set(rec.studentId, rec);
            }
          } else {
            // Initial full baseline load
            recordsMapRef.current = new Map(res.data.records.map((r) => [r.studentId, r]));
          }
          setRecords(Array.from(recordsMapRef.current.values()));
        }
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
      recordsMapRef.current.clear();
      lastSinceRef.current = null;
      setRecords([]);
      setError(null);
      setSearchQuery('');
      setIsRosterExpanded(false);
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

      // Reset client-side delta cursor
      recordsMapRef.current.clear();
      lastSinceRef.current = null;
      setRecords([]);

      // Start polling status immediately
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(pollStatus, 3000);
      await pollStatus();
    } catch (err) {
      setError(err?.response?.data?.error || err?.data?.error || err?.message || 'Failed to generate attendance passcode');
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

  // Extract recent check-ins for the Live Ticker (Option A)
  const recentCheckIns = useMemo(() => {
    return records
      .filter((r) => r.status === 'PRESENT' && r.markedAt)
      .sort((a, b) => new Date(b.markedAt).getTime() - new Date(a.markedAt).getTime())
      .slice(0, 10);
  }, [records]);

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

  // Roster filtering and search
  const absentCount = Math.max(0, totalEnrolled - presentCount);
  const filteredRecords = records.filter((r) => {
    if (rosterFilter === 'PRESENT' && r.status !== 'PRESENT') return false;
    if (rosterFilter === 'ABSENT' && r.status !== 'ABSENT') return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const nameMatch = (r.fullName || '').toLowerCase().includes(q);
      const matricMatch = (r.matricNumber || r.studentId || '').toLowerCase().includes(q);
      const progMatch = (r.programmeCode || '').toLowerCase().includes(q);
      return nameMatch || matricMatch || progMatch;
    }
    return true;
  });

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-md p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col text-center animate-scale-in my-6 max-h-[92vh]"
        style={{ contain: 'layout paint' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#0a1142] text-white shrink-0">
          <div className="flex items-center gap-2">
            <span className="p-1.5 bg-[#ffb81c]/20 text-[#ffb81c] rounded-lg">
              <KeyRound size={16} />
            </span>
            <div className="text-left">
              <p className="text-[10px] font-bold text-[#ffb81c] uppercase tracking-wider">
                Mode 2: Fast Digital Roll Call
              </p>
              <h3 className="font-bold text-sm">Projection Passcode Screen & Live Telemetry</h3>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition cursor-pointer"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Projection Body */}
        <div className="p-6 sm:p-8 space-y-6 overflow-y-auto">
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
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-[#0a1142] rounded-xl hover:bg-[#16258f] shadow-md transition cursor-pointer"
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
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm cursor-pointer"
                  >
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                    <span>{copied ? 'Copied' : 'Copy Code'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => generatePasscode()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm cursor-pointer"
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

          {/* Real-time Attendee Tally */}
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

          {/* Live Check-In Ticker (Option A: Last 10 Check-Ins) */}
          {otp && remainingSeconds > 0 && (
            <div className="p-3.5 bg-emerald-50/70 rounded-2xl border border-emerald-200/80 text-left space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-extrabold text-emerald-950 uppercase tracking-wider">
                    Live Check-In Ticker ({recentCheckIns.length} Latest)
                  </span>
                </div>
                <span className="text-[11px] font-bold text-emerald-800">
                  {presentCount} Verified
                </span>
              </div>

              {recentCheckIns.length === 0 ? (
                <p className="text-xs text-emerald-700/80 italic py-2 text-center">
                  Waiting for students to enter the 6-digit passcode...
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {recentCheckIns.map((st) => (
                    <div
                      key={st.studentId}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-white rounded-lg border border-emerald-200 text-xs shadow-2xs animate-fade-in"
                    >
                      <span className="font-bold text-[#0a1142]">{st.fullName || st.studentId}</span>
                      <span className="text-gray-400 font-mono text-[10px]">({st.matricNumber || st.studentId})</span>
                      <span className="text-emerald-700 font-mono text-[10px] font-bold">
                        • {new Date(st.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Live Student Info Telemetry Section (Lecturer Visibility - Collapsible Drawer) */}
          <div className="border border-gray-200 rounded-2xl bg-white overflow-hidden text-left shadow-xs">
            <div 
              className="p-3.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between cursor-pointer select-none hover:bg-gray-100/60 transition"
              onClick={() => setIsRosterExpanded(!isRosterExpanded)}
            >
              <div className="flex items-center gap-2">
                <Users size={16} className="text-[#0a1142]" />
                <h4 className="text-xs font-extrabold text-[#0a1142] uppercase tracking-wider">
                  Full Enrolled Student Roster ({records.length})
                </h4>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                <span>{isRosterExpanded ? 'Collapse' : 'Expand Roster'}</span>
                {isRosterExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
            </div>

            {isRosterExpanded && (
              <div className="p-3 space-y-3">
                {/* Search & Tabs Toolbar */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-1.5 p-1 bg-gray-100 rounded-xl text-[11px] font-bold shrink-0">
                    <button
                      type="button"
                      onClick={() => setRosterFilter('ALL')}
                      className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                        rosterFilter === 'ALL'
                          ? 'bg-white text-[#0a1142] shadow-xs'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      All ({totalEnrolled})
                    </button>
                    <button
                      type="button"
                      onClick={() => setRosterFilter('PRESENT')}
                      className={`px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer ${
                        rosterFilter === 'PRESENT'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'text-emerald-700 hover:bg-emerald-50'
                      }`}
                    >
                      <UserCheck size={12} />
                      <span>Checked In ({presentCount})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRosterFilter('ABSENT')}
                      className={`px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer ${
                        rosterFilter === 'ABSENT'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'text-amber-700 hover:bg-amber-50'
                      }`}
                    >
                      <UserX size={12} />
                      <span>Awaiting ({absentCount})</span>
                    </button>
                  </div>

                  {/* Search Bar */}
                  <div className="relative flex-1 min-w-[180px]">
                    <Search size={13} className="absolute left-2.5 top-2.5 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search student or matric no..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-gray-200 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-[#0a1142] focus:border-[#0a1142] font-medium"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-2 text-xs text-gray-400 hover:text-gray-600 cursor-pointer"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Students List Container */}
                <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 border border-gray-100 rounded-xl bg-gray-50/50">
                  {filteredRecords.length === 0 ? (
                    <div className="py-8 px-4 text-center text-xs text-gray-400">
                      {records.length === 0
                        ? 'No active lecture roster loaded. Generate a passcode to load enrolled students.'
                        : searchQuery
                          ? `No enrolled students match "${searchQuery}".`
                          : rosterFilter === 'PRESENT'
                            ? 'No students have checked in yet. Live check-ins will appear here in real time.'
                            : 'All enrolled students have checked in!'}
                    </div>
                  ) : (
                    filteredRecords.map((st) => {
                      const isPresent = st.status === 'PRESENT';
                      const formattedMarkedTime = st.markedAt 
                        ? new Date(st.markedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : null;

                      return (
                        <div
                          key={st.studentId}
                          className={`p-2.5 sm:px-3.5 flex items-center justify-between gap-3 transition-colors ${
                            isPresent ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-gray-100/60'
                          }`}
                        >
                          <div className="min-w-0 flex items-center gap-2.5">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0 ${
                              isPresent ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-200 text-gray-700'
                            }`}>
                              {(st.fullName || st.studentId).slice(0, 2).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[#0a1142] truncate">
                                {st.fullName || st.studentId}
                              </p>
                              <div className="flex items-center gap-2 text-[11px] text-gray-500 font-mono">
                                <span>{st.matricNumber || st.studentId}</span>
                                {st.programmeCode && (
                                  <>
                                    <span>•</span>
                                    <span>{st.programmeCode} L{st.level || 200}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="shrink-0 text-right">
                            {isPresent ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shadow-2xs">
                                <CheckCircle2 size={12} className="text-emerald-700" />
                                <span>Present</span>
                                {formattedMarkedTime && (
                                  <span className="text-[10px] text-emerald-700/80 font-mono hidden sm:inline">
                                    • {formattedMarkedTime}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                                <Clock size={11} className="text-gray-400" />
                                <span>Awaiting Passcode</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
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
