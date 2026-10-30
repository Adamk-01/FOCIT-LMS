import React from 'react';
import { ShieldCheck, AlertTriangle, Users, Award, CheckCircle, XCircle } from 'lucide-react';

export function AttendanceSummaryView({ summary, isLoading }) {
  if (isLoading) {
    return <div className="p-8 text-center text-xs text-gray-400">Loading NUC eligibility metrics...</div>;
  }

  if (!summary) return null;

  const totalSessions = summary.totalLockedSessions || 0;
  const students = summary.students || [];
  const atRiskStudents = students.filter((s) => !s.isEligible);
  const eligibleStudents = students.filter((s) => s.isEligible);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Locked Lectures</p>
          <p className="text-2xl font-extrabold text-[#0a1142]">{totalSessions}</p>
          <p className="text-[11px] text-gray-400">Official sessions recorded</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Total Enrolled</p>
          <p className="text-2xl font-extrabold text-[#0a1142]">{students.length}</p>
          <p className="text-[11px] text-gray-400">Roster candidate count</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
          <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Exam Eligible (≥75%)</p>
          <p className="text-2xl font-extrabold text-emerald-700">{eligibleStudents.length}</p>
          <p className="text-[11px] text-gray-400">Qualify for final examination</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
          <p className="text-[11px] font-bold text-red-700 uppercase tracking-wider">At Risk / Disqualified</p>
          <p className="text-2xl font-extrabold text-red-600">{atRiskStudents.length}</p>
          <p className="text-[11px] text-gray-400">Below NUC 75% threshold</p>
        </div>
      </div>

      {/* At-Risk Warning Callout */}
      {atRiskStudents.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 space-y-1">
            <p className="font-bold">NUC 75% Attendance Invariant Alert</p>
            <p className="leading-relaxed">
              {atRiskStudents.length} student(s) currently fail to meet the mandatory 75% attendance criterion. Under academic regulations, students below 75% attendance are disqualified from sitting the final semester examination.
            </p>
          </div>
        </div>
      )}

      {/* Students Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-[#0a1142]">
            NUC Examination Eligibility Audit List
          </h3>
          <span className="text-xs text-gray-400">Threshold: 75.0%</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-gray-50 text-gray-600 uppercase text-[10px] tracking-wider border-b border-gray-200">
              <tr>
                <th className="py-3 px-4">Student</th>
                <th className="py-3 px-4 font-mono">Matric Number</th>
                <th className="py-3 px-4 text-center">Attended / Total</th>
                <th className="py-3 px-4 text-center">Attendance Rate</th>
                <th className="py-3 px-4 text-center">Eligibility Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {students.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-400">
                    No locked sessions recorded yet. Lock sessions to compute official eligibility.
                  </td>
                </tr>
              ) : (
                students.map((st) => (
                  <tr key={st.studentId} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4 font-medium text-gray-900">
                      {st.firstName} {st.lastName}
                    </td>
                    <td className="py-3 px-4 font-mono text-gray-600 text-[11px]">
                      {st.matricNumber || st.studentId}
                    </td>
                    <td className="py-3 px-4 text-center font-semibold text-gray-700">
                      {st.attendedSessions} / {totalSessions}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${
                              st.attendancePercentage >= 75 ? 'bg-emerald-600' : 'bg-red-500'
                            }`}
                            style={{ width: `${Math.min(100, st.attendancePercentage)}%` }}
                          />
                        </div>
                        <span className={`font-bold ${
                          st.attendancePercentage >= 75 ? 'text-emerald-700' : 'text-red-600'
                        }`}>
                          {st.attendancePercentage.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      {st.isEligible ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                          <CheckCircle size={12} />
                          ELIGIBLE
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
                          <XCircle size={12} />
                          DISQUALIFIED (&lt;75%)
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default AttendanceSummaryView;
