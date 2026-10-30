import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, Clock, Award, FileText, User, RefreshCw, Send, AlertCircle } from 'lucide-react';
import { apiClient } from '../../lib/api';

export function AssignmentSubmissionsModal({ isOpen, onClose, courseId, assignment, onUpdated }) {
  const [loading, setLoading] = useState(true);
  const [submissions, setSubmissions] = useState([]);
  const [error, setError] = useState(null);
  const [gradesState, setGradesState] = useState({});
  const [savingStudentId, setSavingStudentId] = useState(null);
  const [saveSuccessId, setSaveSuccessId] = useState(null);

  useEffect(() => {
    if (!isOpen || !assignment) return;
    loadSubmissions();
  }, [isOpen, assignment]);

  const loadSubmissions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get(
        `/courses/${encodeURIComponent(courseId)}/assignments/${assignment.assignment_id}/submissions`
      );
      const subs = res.data?.submissions || [];
      setSubmissions(subs);
      const initGrades = {};
      subs.forEach((s) => {
        initGrades[s.student_id] = {
          grade: s.grade !== null && s.grade !== undefined ? s.grade : '',
          feedback: s.feedback || '',
          submissionId: s.submission_id,
        };
      });
      setGradesState(initGrades);
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to fetch student submissions');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGrade = async (studentId) => {
    const data = gradesState[studentId];
    if (data.grade === '' || isNaN(Number(data.grade))) return;
    setSavingStudentId(studentId);
    try {
      await apiClient.put(
        `/courses/${encodeURIComponent(courseId)}/assignments/${assignment.assignment_id}/grade`,
        {
          student_id: studentId,
          submission_id: data.submissionId,
          grade: Number(data.grade),
          feedback: data.feedback,
        }
      );
      setSaveSuccessId(studentId);
      setTimeout(() => setSaveSuccessId(null), 2500);
      if (onUpdated) onUpdated();
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to save grade');
    } finally {
      setSavingStudentId(null);
    }
  };

  if (!isOpen || !assignment) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#0a1142] text-white">
          <div>
            <span className="text-[11px] font-bold text-[#ffb81c] uppercase tracking-wider">
              Submissions & Grading Desk
            </span>
            <h3 className="font-bold text-base font-display">{assignment.title}</h3>
            <p className="text-xs text-blue-200">
              Max Points: {assignment.max_points} • Weight: {assignment.weight_percent}% • Due:{' '}
              {new Date(assignment.due_date).toLocaleDateString()}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <div className="py-16 text-center space-y-2">
              <RefreshCw size={24} className="animate-spin text-[#0a1142] mx-auto" />
              <p className="text-xs text-gray-500 font-medium">Retrieving student submissions...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
              {error}
            </div>
          ) : submissions.length === 0 ? (
            <div className="py-12 text-center text-gray-400 text-xs">
              No enrolled students found for this course.
            </div>
          ) : (
            <div className="space-y-3">
              {submissions.map((student) => {
                const gradeInfo = gradesState[student.student_id] || { grade: '', feedback: '' };
                const isSaving = savingStudentId === student.student_id;
                const isSuccess = saveSuccessId === student.student_id;
                const hasSubmitted = Boolean(student.submission_id);

                return (
                  <div
                    key={student.student_id}
                    className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 hover:bg-white hover:border-gray-300 transition-all flex flex-col md:flex-row gap-4 items-start md:items-center justify-between"
                  >
                    <div className="space-y-1 min-w-[200px]">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#0a1142]">
                          {student.matric_number}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            student.submission_status === 'GRADED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : hasSubmitted
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {student.submission_status || 'NOT SUBMITTED'}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-gray-800">{student.full_name}</p>
                      {hasSubmitted && student.submitted_at && (
                        <p className="text-[11px] text-gray-500">
                          Submitted: {new Date(student.submitted_at).toLocaleString()}
                        </p>
                      )}
                      {student.submission_text && (
                        <p className="text-xs text-gray-600 italic line-clamp-2 bg-white p-2 rounded border border-gray-200">
                          "{student.submission_text}"
                        </p>
                      )}
                    </div>

                    {/* Grading Controls */}
                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                      <div>
                        <input
                          type="number"
                          placeholder="Score"
                          min="0"
                          max={assignment.max_points}
                          value={gradeInfo.grade}
                          onChange={(e) =>
                            setGradesState({
                              ...gradesState,
                              [student.student_id]: { ...gradeInfo, grade: e.target.value },
                            })
                          }
                          className="w-20 px-2.5 py-1.5 text-xs font-bold border border-gray-300 rounded-lg text-center focus:ring-2 focus:ring-[#0a1142]"
                        />
                        <span className="text-[10px] text-gray-400 block text-center">
                          /{assignment.max_points}
                        </span>
                      </div>

                      <input
                        type="text"
                        placeholder="Feedback note..."
                        value={gradeInfo.feedback}
                        onChange={(e) =>
                          setGradesState({
                            ...gradesState,
                            [student.student_id]: { ...gradeInfo, feedback: e.target.value },
                          })
                        }
                        className="flex-1 md:w-48 px-3 py-1.5 text-xs border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0a1142]"
                      />

                      <button
                        type="button"
                        onClick={() => handleSaveGrade(student.student_id)}
                        disabled={isSaving || gradeInfo.grade === ''}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                          isSuccess
                            ? 'bg-emerald-600 text-white'
                            : 'bg-[#0a1142] hover:bg-[#16258f] text-white disabled:opacity-40'
                        }`}
                      >
                        {isSuccess ? <CheckCircle2 size={13} /> : <Send size={13} />}
                        <span>{isSaving ? '...' : isSuccess ? 'Saved' : 'Save'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
