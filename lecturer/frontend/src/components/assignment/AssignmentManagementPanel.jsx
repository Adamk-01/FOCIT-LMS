import React, { useState, useEffect } from 'react';
import { Plus, FileText, CheckCircle, Clock, Award, Users, RefreshCw, ChevronRight } from 'lucide-react';
import { apiClient } from '../../lib/api';
import { CreateAssignmentModal } from './CreateAssignmentModal';
import { AssignmentSubmissionsModal } from './AssignmentSubmissionsModal';

export function AssignmentManagementPanel({ courses = [], selectedCourseId, onSelectCourseId }) {
  const currentCourseId = selectedCourseId || courses[0]?.course_id;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ assignments: [], enrolled_count: 0 });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedAssignmentForGrading, setSelectedAssignmentForGrading] = useState(null);

  const fetchAssignments = async () => {
    if (!currentCourseId) return;
    setLoading(true);
    try {
      const res = await apiClient.get(`/courses/${encodeURIComponent(currentCourseId)}/assignments/manage`);
      setData(res.data || { assignments: [], enrolled_count: 0 });
    } catch (err) {
      console.error('Error fetching assignments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssignments();
  }, [currentCourseId]);

  const assignments = data.assignments || [];
  const enrolledCount = data.enrolled_count || 0;
  const totalSubmissions = assignments.reduce((acc, a) => acc + (a.total_submissions || 0), 0);
  const totalGraded = assignments.reduce((acc, a) => acc + (a.graded_submissions || 0), 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div>
          <span className="text-[11px] font-bold text-[#0a1142] bg-[#ffb81c]/20 px-3 py-1 rounded-full uppercase tracking-wider">
            Continuous Assessment (CA) Engine
          </span>
          <h2 className="text-xl font-bold text-[#0a1142] font-display mt-2">
            Course Assignments & Assessments
          </h2>
          <p className="text-xs text-gray-500">
            Publish continuous assessments, set grading rubrics, and evaluate student submissions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {courses.length > 1 && (
            <select
              value={currentCourseId}
              onChange={(e) => onSelectCourseId && onSelectCourseId(e.target.value)}
              className="border border-gray-300 rounded-xl px-3 py-2 text-xs bg-white font-bold text-[#0a1142] focus:ring-2 focus:ring-[#0a1142]"
            >
              {courses.map((c) => (
                <option key={c.course_id} value={c.course_id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition-all"
          >
            <Plus size={15} className="text-[#ffb81c]" />
            <span>Create Assignment</span>
          </button>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-bold text-gray-500 uppercase">Total Assignments</p>
          <p className="text-2xl font-black text-[#0a1142] mt-1">{assignments.length}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-bold text-gray-500 uppercase">Enrolled Students</p>
          <p className="text-2xl font-black text-indigo-700 mt-1">{enrolledCount}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-bold text-gray-500 uppercase">Submissions Received</p>
          <p className="text-2xl font-black text-blue-700 mt-1">{totalSubmissions}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-bold text-gray-500 uppercase">Graded Work</p>
          <p className="text-2xl font-black text-emerald-700 mt-1">{totalGraded}</p>
        </div>
      </div>

      {/* Assignments List */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
          Course Work Items ({assignments.length})
        </h3>

        {loading ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center space-y-2">
            <RefreshCw size={24} className="animate-spin text-[#0a1142] mx-auto" />
            <p className="text-xs text-gray-500">Loading assignments and grading stats...</p>
          </div>
        ) : assignments.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-300 text-center space-y-3">
            <FileText size={32} className="text-gray-400 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-gray-700">No assignments published for this course yet</p>
              <p className="text-xs text-gray-400 max-w-sm mx-auto">
                Create your first course assignment to evaluate your enrolled students and track continuous assessment scores.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold"
            >
              <Plus size={14} />
              <span>Create Assignment</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {assignments.map((assign) => {
              const subCount = assign.total_submissions || 0;
              const gradedCount = assign.graded_submissions || 0;
              const percentSubmitted = enrolledCount > 0 ? Math.round((subCount / enrolledCount) * 100) : 0;

              return (
                <div
                  key={assign.assignment_id}
                  className="bg-white rounded-2xl p-5 border border-gray-200 hover:border-[#0a1142]/40 transition-all flex flex-col justify-between gap-4 shadow-sm"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                          assign.status === 'PUBLISHED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : assign.status === 'DRAFT'
                            ? 'bg-gray-100 text-gray-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {assign.status}
                      </span>
                      <span className="text-[11px] font-bold text-gray-500">
                        Weight: {assign.weight_percent}%
                      </span>
                    </div>

                    <div>
                      <h4 className="font-bold text-sm text-[#0a1142] line-clamp-1">{assign.title}</h4>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {assign.description || 'No additional instructions.'}
                      </p>
                    </div>

                    <div className="space-y-1.5 pt-2 border-t border-gray-100 text-[11px] text-gray-600">
                      <div className="flex justify-between">
                        <span>Due: {new Date(assign.due_date).toLocaleDateString()}</span>
                        <span className="font-bold">{assign.max_points} pts</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Turned In:</span>
                        <span className="font-bold text-[#0a1142]">
                          {subCount} / {enrolledCount} ({percentSubmitted}%)
                        </span>
                      </div>
                      <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-[#0a1142] h-full transition-all"
                          style={{ width: `${percentSubmitted}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setSelectedAssignmentForGrading(assign)}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-gray-50 hover:bg-[#0a1142] text-gray-700 hover:text-white text-xs font-bold border border-gray-200 hover:border-transparent transition"
                  >
                    <span>Submissions & Grading ({gradedCount}/{subCount})</span>
                    <ChevronRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateAssignmentModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        courseId={currentCourseId}
        onSuccess={fetchAssignments}
      />

      <AssignmentSubmissionsModal
        isOpen={Boolean(selectedAssignmentForGrading)}
        onClose={() => setSelectedAssignmentForGrading(null)}
        courseId={currentCourseId}
        assignment={selectedAssignmentForGrading}
        onUpdated={fetchAssignments}
      />
    </div>
  );
}
