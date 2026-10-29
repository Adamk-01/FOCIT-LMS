import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, ShieldAlert, Users, Award, AlertCircle, Loader2 } from 'lucide-react';
import { apiClient } from '../../lib/api';

export function RepDirectModal({ isOpen, onClose, courseId, onSuccess }) {
  const [weekNumber, setWeekNumber] = useState(1);
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('Mode 3: Course Rep Practical Lab Check-in');
  const [students, setStudents] = useState([]);
  const [attendanceMap, setAttendanceMap] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    loadStudents();
  }, [isOpen, courseId]);

  const loadStudents = async () => {
    setIsLoading(true);
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
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const toggleStudent = (id) => {
    setAttendanceMap((prev) => ({
      ...prev,
      [id]: prev[id] === 'PRESENT' ? 'ABSENT' : 'PRESENT',
    }));
  };

  const presentCount = Object.values(attendanceMap).filter((s) => s === 'PRESENT').length;
  const absentCount = Object.values(attendanceMap).filter((s) => s === 'ABSENT').length;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const records = students.map((s) => ({
      student_id: s.student_id,
      status: attendanceMap[s.student_id] || 'ABSENT',
    }));

    try {
      await apiClient.post(`/attendance/courses/${encodeURIComponent(courseId)}/sessions/rep-direct`, {
        week_number: Number(weekNumber),
        session_date: sessionDate,
        notes: notes.trim(),
        records,
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to submit lab attendance');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 bg-[#0a1142] text-white">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-amber-500/20 rounded-xl text-amber-300">
              <Users size={18} />
            </div>
            <div>
              <span className="text-[10px] font-bold text-[#ffb81c] uppercase tracking-wider">
                Mode 3: Course Rep Direct
              </span>
              <h3 className="font-bold text-base font-display">Practical Lab Attendance</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto flex-1 space-y-4">
          {error && (
            <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Week Number *</label>
              <select
                value={weekNumber}
                onChange={(e) => setWeekNumber(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white font-bold text-[#0a1142]"
              >
                {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>Week {w}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Session Date *</label>
              <input
                type="date"
                required
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-3 bg-amber-50/60 rounded-xl border border-amber-200 text-xs">
            <div className="flex gap-4">
              <span className="font-bold text-emerald-700">{presentCount} Present</span>
              <span className="font-bold text-rose-700">{absentCount} Absent</span>
            </div>
            <span className="text-gray-500 text-[11px]">Tap row to toggle</span>
          </div>

          <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
            {isLoading ? (
              <div className="p-8 text-center text-xs text-gray-400">Loading roster...</div>
            ) : (
              students.map((student) => {
                const isPresent = attendanceMap[student.student_id] === 'PRESENT';
                return (
                  <div
                    key={student.student_id}
                    onClick={() => toggleStudent(student.student_id)}
                    className="flex items-center justify-between p-3 bg-white hover:bg-gray-50 cursor-pointer transition select-none"
                  >
                    <div>
                      <p className="font-mono text-xs font-bold text-[#0a1142]">{student.matric_number}</p>
                      <p className="text-xs text-gray-700">{student.full_name}</p>
                    </div>
                    <span
                      className={`px-3 py-1 text-xs font-bold rounded-lg ${
                        isPresent ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {isPresent ? 'PRESENT' : 'ABSENT'}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase mb-1">Lab Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
            <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-gray-600">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || students.length === 0}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 size={14} className="animate-spin text-[#ffb81c]" /> : <CheckCircle2 size={14} className="text-[#ffb81c]" />}
              <span>Submit Lab Batch</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
