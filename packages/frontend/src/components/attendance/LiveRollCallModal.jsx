import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, Clock, Users, ShieldCheck, AlertCircle, Loader2 } from 'lucide-react';
import { apiClient } from '../../lib/api';

export function LiveRollCallModal({ isOpen, onClose, courseId, onSuccess }) {
  const [weekNumber, setWeekNumber] = useState(1);
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('Mode 1: Direct Lecture Roll Call');
  const [students, setStudents] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [isLoadingStudents, setIsLoadingStudents] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    loadEnrolledStudents();
  }, [isOpen, courseId]);

  const loadEnrolledStudents = async () => {
    setIsLoadingStudents(true);
    setError(null);
    try {
      const res = await apiClient.get(`/lecturer/courses/${encodeURIComponent(courseId)}/students`);
      const list = res.data?.students || [];
      setStudents(list);
      const initMap = {};
      list.forEach((s) => {
        initMap[s.student_id] = 'PRESENT';
      });
      setAttendanceMap(initMap);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to fetch student roster');
    } finally {
      setIsLoadingStudents(false);
    }
  };

  if (!isOpen) return null;

  const markAll = (status) => {
    const updated = {};
    students.forEach((s) => {
      updated[s.student_id] = status;
    });
    setAttendanceMap(updated);
  };

  const presentCount = Object.values(attendanceMap).filter((s) => s === 'PRESENT').length;
  const absentCount = Object.values(attendanceMap).filter((s) => s === 'ABSENT').length;
  const excusedCount = Object.values(attendanceMap).filter((s) => s === 'EXCUSED').length;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const records = students.map((s) => ({
      student_id: s.student_id,
      status: attendanceMap[s.student_id] || 'ABSENT',
    }));

    try {
      await apiClient.post(`/attendance/courses/${encodeURIComponent(courseId)}/sessions/roll-call`, {
        week_number: Number(weekNumber),
        session_date: sessionDate,
        notes: notes.trim(),
        records,
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to submit live roll call');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#0a1142] text-white">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-500/20 rounded-xl text-blue-300">
              <Users size={18} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-[#ffb81c] uppercase tracking-wider">
                Mode 1: Digital Roll Call
              </span>
              <h3 className="font-bold text-base font-display">Live In-Class Roster Call</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Week Number *
              </label>
              <select
                value={weekNumber}
                onChange={(e) => setWeekNumber(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white font-bold text-[#0a1142] focus:ring-2 focus:ring-[#0a1142]"
              >
                {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>
                    Week {w} Lecture
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Lecture Date *
              </label>
              <input
                type="date"
                required
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142]"
              />
            </div>
          </div>

          {/* Quick Mark Actions & Live Tally */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-emerald-700">{presentCount} Present</span>
              <span className="font-bold text-rose-700">{absentCount} Absent</span>
              <span className="font-bold text-amber-700">{excusedCount} Excused</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => markAll('PRESENT')}
                className="px-2.5 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 rounded-lg transition"
              >
                All Present
              </button>
              <button
                type="button"
                onClick={() => markAll('ABSENT')}
                className="px-2.5 py-1 text-[11px] font-bold text-rose-800 bg-rose-100 hover:bg-rose-200 rounded-lg transition"
              >
                All Absent
              </button>
            </div>
          </div>

          {/* Student Roster */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
              Enrolled Students ({students.length})
            </h4>

            {isLoadingStudents ? (
              <div className="py-8 text-center text-gray-500 text-xs">Loading roster...</div>
            ) : students.length === 0 ? (
              <div className="py-8 text-center text-gray-400 text-xs">No registered students found.</div>
            ) : (
              <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                {students.map((student) => {
                  const currentStatus = attendanceMap[student.student_id] || 'ABSENT';
                  return (
                    <div
                      key={student.student_id}
                      className="flex items-center justify-between p-3 bg-white hover:bg-gray-50 transition"
                    >
                      <div>
                        <p className="font-mono text-xs font-bold text-[#0a1142]">
                          {student.matric_number}
                        </p>
                        <p className="text-xs font-medium text-gray-800">{student.full_name}</p>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setAttendanceMap({ ...attendanceMap, [student.student_id]: 'PRESENT' })
                          }
                          className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                            currentStatus === 'PRESENT'
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700'
                          }`}
                        >
                          Present
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAttendanceMap({ ...attendanceMap, [student.student_id]: 'ABSENT' })
                          }
                          className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                            currentStatus === 'ABSENT'
                              ? 'bg-rose-600 text-white shadow-sm'
                              : 'bg-gray-100 text-gray-600 hover:bg-rose-50 hover:text-rose-700'
                          }`}
                        >
                          Absent
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setAttendanceMap({ ...attendanceMap, [student.student_id]: 'EXCUSED' })
                          }
                          className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                            currentStatus === 'EXCUSED'
                              ? 'bg-amber-600 text-white shadow-sm'
                              : 'bg-gray-100 text-gray-600 hover:bg-amber-50 hover:text-amber-700'
                          }`}
                        >
                          Excused
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              Session Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142]"
            />
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || students.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin text-[#ffb81c]" />
                  <span>Saving Ledger...</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={14} className="text-[#ffb81c]" />
                  <span>Save & Seal Roll Call</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
