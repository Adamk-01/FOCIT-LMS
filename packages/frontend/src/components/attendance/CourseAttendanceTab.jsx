/**
 * FOCIT LMS - Student Course Attendance Room Tab
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. NUC 75% Examination Qualification Gauge & Consecutive Recovery Horizon
 * 2. Weekly Student-Scoped Audit Matrix (Weeks 1–15 with zero peer data leakage)
 * 3. Course Representative Role Elevation (Direct Scanned Sheet Upload & Lab Check-in)
 * 4. Active Lecture Mode 2 Passcode Quick Trigger
 */

import React, { useState } from 'react';
import { 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  KeyRound, 
  Upload, 
  FileSpreadsheet, 
  Lock, 
  HelpCircle,
  RefreshCw,
  Calendar,
  Sparkles,
  Info
} from 'lucide-react';
import { useCourseStudentAttendance } from '../../hooks/useStudentAttendance';
import { StudentOtpCheckInModal } from './StudentOtpCheckInModal';
import { CourseRepUploadModal } from './CourseRepUploadModal';
import { RepDirectModal } from './RepDirectModal';

const MODE_LABELS = {
  ROLL_CALL: 'Roll Call',
  CODE_OTP: 'OTP Passcode',
  REP_DIRECT: 'Lab Direct',
  SHEET_SCAN: 'Scanned Sheet',
};

export function CourseAttendanceTab({ courseId }) {
  const { data, isLoading, isError, error, refetch } = useCourseStudentAttendance(courseId);

  const [activeOtpSession, setActiveOtpSession] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showRepDirectModal, setShowRepDirectModal] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse" aria-busy="true">
        <div className="h-44 bg-gray-100 rounded-2xl border border-gray-200" />
        <div className="h-96 bg-gray-100 rounded-2xl border border-gray-200" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 bg-white rounded-2xl border border-rose-200 text-center space-y-3">
        <AlertTriangle size={36} className="text-rose-500 mx-auto" />
        <h3 className="text-base font-bold text-gray-900">Failed to load attendance timeline</h3>
        <p className="text-xs text-gray-500 max-w-md mx-auto">
          {error?.response?.data?.error || error?.message || 'Unable to retrieve your attendance ledger for this course.'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="min-h-[44px] px-4 py-2 bg-[#0a1142] text-white rounded-xl text-xs font-bold"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  const course = data?.course;
  const summary = data?.summary || {};
  const timeline = data?.timeline || [];

  const percentage = summary.attendancePercentage ?? 100.0;
  const isEligible = summary.isExamEligible;
  const attendedCount = summary.attendedSessions ?? 0;
  const excusedCount = summary.excusedSessions ?? 0;
  const totalLocked = summary.totalLockedSessions ?? 0;
  const effectiveDenominator = summary.effectiveDenominator ?? Math.max(0, totalLocked - excusedCount);
  const consecutiveToClear = summary.consecutiveToClearWarning ?? 0;
  const sessionsNeededForExam = summary.sessionsNeededForExam ?? summary.sessionsNeededFor75 ?? 0;
  const canStillQualify = summary.canStillQualify;
  const isBarred = summary.isBarredFromExam;
  const maxAchievable = summary.maxAchievableAttendance ?? 100.0;
  const isCourseRep = Boolean(course?.isCourseRep);

  // Ghost-pulse elimination: distinguish unsubmitted active sessions from already checked-in active sessions
  const activeSessionItem = timeline.find((s) => s.isOtpActive && (s.requiresCheckIn || (!s.alreadyCheckedInActive && s.status !== 'PRESENT')));
  const alreadyCheckedInSession = timeline.find((s) => s.isOtpActive && (s.alreadyCheckedInActive || s.status === 'PRESENT'));

  return (
    <div className="space-y-8 animate-fade-in">
      {/* 1. NUC 75% Exam Eligibility Hero Meter */}
      <div className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-100 pb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#ffb81c]/20 text-[#0a1142] mb-2">
              <ShieldCheck size={14} />
              <span>NUC BENCHMARK ACADEMIC STANDARDS</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#0a1142] font-display">
              Examination Eligibility Meter: {course?.code || courseId}
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              National Universities Commission mandates a minimum 75% lecture attendance rate to sit for final semester examinations.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-extrabold border ${
              isBarred
                ? 'bg-rose-100 text-rose-900 border-rose-300'
                : isEligible 
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                  : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}>
              {isBarred ? (
                <>
                  <AlertTriangle size={16} className="text-rose-600" />
                  <span>Barred from Examination (Standing: {percentage}%)</span>
                </>
              ) : isEligible ? (
                <>
                  <CheckCircle2 size={16} className="text-emerald-600" />
                  <span>Exam Qualified (Standing: {percentage}%)</span>
                </>
              ) : (
                <>
                  <AlertTriangle size={16} className="text-amber-600" />
                  <span>Attendance Warning (Standing: {percentage}%)</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Warning Callout Banners */}
        {isBarred ? (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-rose-900 shadow-xs">
            <AlertTriangle size={20} className="text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold uppercase tracking-wider text-rose-950">
                Senate Disqualification Alert
              </h4>
              <p className="text-xs text-rose-800 leading-relaxed">
                Under UNIOSUN Senate Regulations and NUC Benchmarks, you cannot achieve the required 75% attendance threshold even with 100% attendance in all remaining lectures (Maximum achievable: <strong>{maxAchievable}%</strong> across the semester). You are currently barred from the final examination. Please consult your Academic Adviser immediately.
              </p>
            </div>
          </div>
        ) : !isEligible ? (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3 text-amber-900 shadow-xs">
            <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-950">
                Academic Standing Recovery Notice
              </h4>
              <p className="text-xs text-amber-800 leading-relaxed">
                Your current attendance standing is <strong>{percentage}%</strong> (below the mandatory 75% mark). You must attend the next <strong>{consecutiveToClear} consecutive lecture{consecutiveToClear === 1 ? '' : 's'}</strong> to restore your good standing, and a cumulative minimum of <strong>{sessionsNeededForExam} more lecture{sessionsNeededForExam === 1 ? '' : 's'}</strong> by Week 15 to sit for the final examination.
              </p>
            </div>
          </div>
        ) : null}

        {/* Metric Cards Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 space-y-1">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Attendance Rate</p>
            <p className={`text-2xl font-extrabold ${isBarred ? 'text-rose-600' : isEligible ? 'text-[#0a1142]' : 'text-amber-600'}`}>
              {percentage}%
            </p>
            <span className="text-[11px] text-gray-400">75% required</span>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 space-y-1">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Sessions Attended</p>
            <p className="text-2xl font-extrabold text-[#0a1142]">
              {attendedCount} / {effectiveDenominator}
            </p>
            <span className="text-[11px] text-gray-400">
              {excusedCount > 0 ? `${excusedCount} excused (exempt)` : `${totalLocked} locked sessions`}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 space-y-1">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Recovery Target</p>
            <p className={`text-2xl font-extrabold ${isBarred ? 'text-rose-600' : consecutiveToClear === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
              {isBarred ? 'Barred' : consecutiveToClear === 0 ? '0' : `+${consecutiveToClear}`}
            </p>
            <span className="text-[11px] text-gray-400">
              {isBarred ? 'Ceiling < 75%' : consecutiveToClear === 0 ? 'In Good Standing' : 'Consecutive to clear'}
            </span>
          </div>

          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 space-y-1">
            <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Semester Horizon</p>
            <p className={`text-base font-extrabold pt-1 ${
              isBarred ? 'text-rose-700' : canStillQualify ? 'text-emerald-700' : 'text-rose-700'
            }`}>
              {isBarred ? 'Disqualified' : canStillQualify ? 'Eligible on Horizon' : 'Barred from Exam'}
            </p>
            <span className="text-[11px] text-gray-400">
              {isBarred ? `Max possible: ${maxAchievable}%` : `Need ${sessionsNeededForExam} more by Wk 15`}
            </span>
          </div>
        </div>

        {/* Progress Bar with 75% Target Marker */}
        <div className="space-y-1.5 pt-2">
          <div className="relative w-full h-3.5 bg-gray-100 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 rounded-full ${
                isBarred ? 'bg-rose-500' : isEligible ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
            />
            <div 
              className="absolute top-0 bottom-0 w-0.5 bg-gray-800/40 z-10" 
              style={{ left: '75%' }}
              title="75% NUC Threshold"
            />
          </div>
          <div className="flex justify-between text-[11px] text-gray-400 font-medium">
            <span>0%</span>
            <span className="font-bold text-gray-700">75% NUC Exam Threshold</span>
            <span>100% (Full Attendance)</span>
          </div>
        </div>

        {/* Active Session Alert in Course Room (Ghost-Pulse Protected) */}
        {activeSessionItem ? (
          <div className="p-4 rounded-xl bg-gradient-to-r from-[#0a1142] to-[#16258f] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#ffb81c]/20 text-[#ffb81c] rounded-xl animate-pulse">
                <KeyRound size={20} />
              </div>
              <div>
                <p className="text-xs font-extrabold text-[#ffb81c]">
                  LIVE ATTENDANCE OPEN (WEEK {activeSessionItem.weekNumber}{activeSessionItem.sessionDate ? ` • ${new Date(activeSessionItem.sessionDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}` : ''})
                </p>
                <p className="text-xs text-gray-200">The lecturer has projected an ephemeral attendance passcode for this lecture.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setActiveOtpSession({
                sessionId: activeSessionItem.sessionId,
                courseId,
                courseCode: course?.code,
                courseTitle: course?.title,
                weekNumber: activeSessionItem.weekNumber,
                sessionDate: activeSessionItem.sessionDate,
                remainingSeconds: activeSessionItem.otpRemainingSeconds || 300,
                isLockedOut: Boolean(activeSessionItem.isLockedOut),
              })}
              className="min-h-[44px] px-4 py-2 bg-[#ffb81c] hover:bg-[#e5a200] text-[#0a1142] rounded-xl text-xs font-bold transition shadow-sm shrink-0 flex items-center justify-center gap-1.5"
            >
              <KeyRound size={14} />
              <span>Enter Passcode</span>
            </button>
          </div>
        ) : alreadyCheckedInSession ? (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl">
                <CheckCircle2 size={20} />
              </div>
              <div>
                <p className="text-xs font-extrabold text-emerald-800">
                  ATTENDANCE RECORDED (WEEK {alreadyCheckedInSession.weekNumber}{alreadyCheckedInSession.sessionDate ? ` • ${new Date(alreadyCheckedInSession.sessionDate).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}` : ''})
                </p>
                <p className="text-xs text-emerald-700">Your presence for this live lecture has been verified and recorded.</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-100 text-emerald-800 font-bold text-xs rounded-full border border-emerald-300">
              ✓ Present
            </span>
          </div>
        ) : null}
      </div>

      {/* 2. Course Representative Privileged Operations Pod */}
      {isCourseRep && (
        <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-900 shrink-0">
              <Sparkles size={20} />
            </div>
            <div className="space-y-0.5">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-200 text-amber-900">
                COURSE REPRESENTATIVE APPOINTMENT
              </span>
              <h3 className="text-sm font-bold text-amber-950">
                Course Representative Administration Pod
              </h3>
              <p className="text-xs text-amber-800">
                You are authorized to submit digitized attendance sheets and direct lab check-ins for {course?.code || courseId}.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setShowRepDirectModal(true)}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold transition shadow-xs flex items-center gap-1.5"
            >
              <FileSpreadsheet size={15} />
              <span>Lab Direct</span>
            </button>

            <button
              type="button"
              onClick={() => setShowUploadModal(true)}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold transition shadow-md flex items-center gap-1.5"
            >
              <Upload size={15} className="text-[#ffb81c]" />
              <span>Upload Scanned Sheet</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Weekly Attendance Audit Timeline (Weeks 1 to 15) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
            Semester Session Ledger ({timeline.length} Recorded)
          </h3>
          <span className="text-[11px] text-gray-500 flex items-center gap-1">
            <Info size={13} />
            <span>Audited against institutional lecture records</span>
          </span>
        </div>

        {timeline.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-dashed border-gray-300 text-center space-y-3">
            <Clock size={32} className="text-gray-400 mx-auto" />
            <p className="text-sm font-bold text-gray-700">No attendance sessions recorded yet</p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Attendance records for this course will appear here once the lecturer initiates roll calls, passcode projections, or paper sheet uploads.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                    <th className="py-3.5 px-4 sm:px-6">Week & Date</th>
                    <th className="py-3.5 px-4">Ingress Mode</th>
                    <th className="py-3.5 px-4">Your Attendance Status</th>
                    <th className="py-3.5 px-4">Verification Method</th>
                    <th className="py-3.5 px-4 text-right">Approval Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-xs font-medium">
                  {timeline.map((sess) => {
                    const isPresent = sess.status === 'PRESENT';
                    const isAbsent = sess.status === 'ABSENT';
                    const isExcused = sess.status === 'EXCUSED';

                    return (
                      <tr key={sess.sessionId} className="hover:bg-gray-50/70 transition-colors">
                        <td className="py-3.5 px-4 sm:px-6">
                          <div className="font-bold text-[#0a1142]">
                            Week {sess.weekNumber}
                          </div>
                          <div className="text-[11px] text-gray-400 flex items-center gap-1 pt-0.5">
                            <Calendar size={11} />
                            <span>{new Date(sess.sessionDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                          </div>
                        </td>

                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                            {MODE_LABELS[sess.sessionMode] || sess.sessionMode}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          {sess.isOtpActive && sess.status !== 'PRESENT' ? (
                            <button
                              type="button"
                              onClick={() => setActiveOtpSession({
                                sessionId: sess.sessionId,
                                courseId,
                                courseCode: course?.code,
                                courseTitle: course?.title,
                                weekNumber: sess.weekNumber,
                                sessionDate: sess.sessionDate,
                                remainingSeconds: sess.otpRemainingSeconds || 300,
                              })}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-black bg-[#ffb81c] hover:bg-yellow-400 text-[#0a1142] shadow-xs animate-pulse min-h-[36px] transition cursor-pointer"
                              aria-label={`Enter passcode for Week ${sess.weekNumber}`}
                            >
                              <KeyRound size={13} />
                              <span>Enter Passcode</span>
                            </button>
                          ) : isPresent ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <CheckCircle2 size={12} />
                              <span>Present</span>
                            </span>
                          ) : isExcused ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200" title="Officially excused absence (exempt from NUC denominator calculation)">
                              <ShieldCheck size={12} className="text-blue-600" />
                              <span>Excused (Exempt)</span>
                            </span>
                          ) : isAbsent ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                              <span>Absent</span>
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">Not recorded</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-gray-600">
                          {sess.verificationMethod ? (
                            <span className="text-[11px] font-mono text-gray-500 bg-gray-50 px-2 py-0.5 rounded border border-gray-200">
                              {sess.verificationMethod}
                            </span>
                          ) : (
                            <span className="text-gray-400 text-[11px]">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          {sess.isLocked ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                              <Lock size={11} />
                              <span>Locked & Audited</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                              <Clock size={11} />
                              <span>In Review</span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

              {/* 4. Manual Lecture Passcode Quick Ingress */}
        <div className="p-5 rounded-2xl bg-white border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-[#0a1142]/5 text-[#0a1142] shrink-0">
              <KeyRound size={20} />
            </div>
            <div className="space-y-0.5">
              <h3 className="text-sm font-bold text-[#0a1142]">
                Attending lecture right now?
              </h3>
              <p className="text-xs text-gray-500">
                If your lecturer has projected a 6-digit passcode for today's lecture, enter it here to instantly record your attendance.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setActiveOtpSession({
              courseId,
              courseCode: course?.code,
              courseTitle: course?.title,
              sessionId: activeSessionItem?.sessionId || null,
              weekNumber: activeSessionItem?.weekNumber || (timeline.length > 0 ? timeline[timeline.length - 1].weekNumber : 1),
              sessionDate: activeSessionItem?.sessionDate || new Date().toISOString(),
              remainingSeconds: activeSessionItem?.otpRemainingSeconds || 300,
            })}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold transition shadow-sm shrink-0 flex items-center justify-center gap-2 cursor-pointer"
          >
            <KeyRound size={15} className="text-[#ffb81c]" />
            <span>Enter Lecture Passcode</span>
          </button>
        </div>

      {/* Modals */}
      {activeOtpSession && (
        <StudentOtpCheckInModal
          isOpen={Boolean(activeOtpSession)}
          sessionData={activeOtpSession}
          onClose={() => setActiveOtpSession(null)}
          onSuccess={() => {
            setActiveOtpSession(null);
            refetch();
          }}
        />
      )}

      {showUploadModal && (
        <CourseRepUploadModal
          isOpen={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          courseId={courseId}
          onSuccess={() => {
            setShowUploadModal(false);
            refetch();
          }}
        />
      )}

      {showRepDirectModal && (
        <RepDirectModal
          isOpen={showRepDirectModal}
          onClose={() => setShowRepDirectModal(false)}
          courseId={courseId}
          onSuccess={() => {
            setShowRepDirectModal(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}

export default CourseAttendanceTab;

