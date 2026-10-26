import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Clock, 
  Lock, 
  Upload, 
  CheckCircle, 
  AlertTriangle, 
  Eye, 
  Plus,
  RefreshCw 
} from 'lucide-react';
import { useAttendance } from '../../hooks/useAttendance';
import { AttendanceVerificationDeskModal } from './AttendanceVerificationDeskModal';
import { CourseRepUploadModal } from './CourseRepUploadModal';
import { AttendanceSummaryView } from './AttendanceSummaryView';

export function AttendanceLecturerPanel({ courseId, courses = [], onSelectCourseId }) {
  const currentCourse = courses.find((c) => c.course_id === courseId) || courses[0];
  const {
    sessions,
    isLoadingSessions,
    summary,
    isLoadingSummary,
    updateRecordsMutation,
    lockSessionMutation,
    uploadSheetMutation,
    refetchAll,
  } = useAttendance(courseId);

  const [activeSessionId, setActiveSessionId] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);

  const handleSaveRecords = (updates, onSuccess) => {
    if (!activeSessionId) return;
    updateRecordsMutation.mutate(
      { sessionId: activeSessionId, updates },
      { onSuccess }
    );
  };

  const handleLockSession = (sessionId) => {
    if (window.confirm('Are you sure you want to approve and lock this attendance session? Once locked, records are immutable and will authoritatively count toward the NUC 75% exam eligibility.')) {
      lockSessionMutation.mutate(
        { sessionId },
        { onSuccess: () => setActiveSessionId(null) }
      );
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Sessions Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#ffb81c]/20 text-[#0a1142] mb-2">
            <ShieldCheck size={14} />
            <span>MODE 4 HYBRID LEDGER</span>
          </div>
          <h2 className="text-xl font-bold text-[#0a1142] font-display">
            Weekly Attendance Sessions: {currentCourse?.code || courseId}
          </h2>
          <p className="text-xs text-gray-500">
            Physical sheets snapped in class by the Course Rep are transcribed here for lecturer verification and locking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {courses.length > 1 && (
            <div>
              <select
                value={courseId}
                onChange={(e) => onSelectCourseId && onSelectCourseId(e.target.value)}
                className="border border-gray-300 rounded-xl px-3 py-2 text-xs bg-white font-bold text-[#0a1142] focus:ring-2 focus:ring-[#0a1142]"
              >
                {courses.map((c) => (
                  <option key={c.course_id} value={c.course_id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowUploadModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition-all"
          >
            <Upload size={14} className="text-[#ffb81c]" />
            <span>Upload Class Sheet</span>
          </button>
        </div>
      </div>

      {/* Weekly Sessions Grid */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
          Recorded Lecture Sessions ({sessions.length})
        </h3>

        {isLoadingSessions ? (
          <div className="bg-white p-12 rounded-2xl border border-gray-200 text-center space-y-2">
            <RefreshCw size={24} className="animate-spin text-[#0a1142] mx-auto" />
            <p className="text-xs text-gray-500">Loading attendance ledger sessions...</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-white p-10 rounded-2xl border border-dashed border-gray-300 text-center space-y-3">
            <Clock size={32} className="text-gray-400 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-bold text-gray-700">No attendance sessions submitted yet</p>
              <p className="text-xs text-gray-400 max-w-md mx-auto">
                When the course rep snaps photos of physical attendance sheets in class and submits them, they will appear here ready for your review.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold"
            >
              <Plus size={14} />
              <span>Submit First Sheet</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map((sess) => {
              const isLocked = sess.is_locked;
              const presentCount = parseInt(sess.present_count, 10) || 0;
              const absentCount = parseInt(sess.absent_count, 10) || 0;
              const total = presentCount + absentCount;
              const attendanceRate = total > 0 ? ((presentCount / total) * 100).toFixed(0) : 0;

              return (
                <div
                  key={sess.session_id}
                  className={`bg-white rounded-2xl p-5 border transition-all flex flex-col justify-between gap-4 shadow-sm ${
                    isLocked ? 'border-gray-200' : 'border-amber-300 ring-2 ring-amber-100/60'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-[#0a1142] bg-[#ffb81c]/20 px-2.5 py-0.5 rounded-full">
                        Week {sess.week_number}
                      </span>
                      {isLocked ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                          <Lock size={11} />
                          Locked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                          <Clock size={11} />
                          Review Required
                        </span>
                      )}
                    </div>

                    <div>
                      <p className="text-xs text-gray-500">
                        Date: {new Date(sess.session_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      {sess.notes && (
                        <p className="text-xs text-gray-600 italic mt-1 line-clamp-1">
                          "{sess.notes}"
                        </p>
                      )}
                    </div>

                    <div className="pt-2 flex items-center justify-between text-xs border-t border-gray-100">
                      <div>
                        <span className="font-bold text-emerald-700">{presentCount}</span>
                        <span className="text-gray-400"> Present • </span>
                        <span className="font-bold text-red-600">{absentCount}</span>
                        <span className="text-gray-400"> Absent</span>
                      </div>
                      <span className="font-bold text-gray-700">{attendanceRate}% Rate</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setActiveSessionId(sess.session_id)}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold transition-all inline-flex items-center justify-center gap-1.5 ${
                      isLocked
                        ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                        : 'bg-[#0a1142] hover:bg-[#16258f] text-white shadow-sm'
                    }`}
                  >
                    <Eye size={14} />
                    <span>{isLocked ? 'View Locked Ledger' : 'Open Verification Desk'}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 75% NUC Summary Section */}
      <div className="space-y-4 pt-4 border-t border-gray-200">
        <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
          NUC 75% Exam Eligibility Audit ({currentCourse?.code || courseId})
        </h3>
        <AttendanceSummaryView summary={summary} isLoading={isLoadingSummary} />
      </div>

      {/* Verification Desk Modal */}
      {activeSessionId && (
        <AttendanceVerificationDeskModal
          sessionId={activeSessionId}
          isOpen={Boolean(activeSessionId)}
          onClose={() => setActiveSessionId(null)}
          onSaveRecords={handleSaveRecords}
          onLockSession={handleLockSession}
          isSaving={updateRecordsMutation.isPending}
          isLocking={lockSessionMutation.isPending}
        />
      )}

      {/* Course Rep Upload Modal */}
      <CourseRepUploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        courseId={courseId}
        courseCode={currentCourse?.code || courseId}
        onUpload={(payload) => {
          uploadSheetMutation.mutate(payload, {
            onSuccess: () => setShowUploadModal(false),
          });
        }}
        isUploading={uploadSheetMutation.isPending}
      />
    </div>
  );
}

export default AttendanceLecturerPanel;
