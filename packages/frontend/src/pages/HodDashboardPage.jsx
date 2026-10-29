import React, { useState } from 'react';
import {
  useHodAllocations,
  useHodAnalytics,
  useHodLecturers,
  useHodMutations,
} from '../hooks/useHodDashboard';
import {
  BookOpen,
  TrendingUp,
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  ShieldCheck,
  ArrowUpRight,
} from 'lucide-react';

export function HodDashboardPage() {
  const [tab, setTab] = useState('allocations');

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Executive Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-gray-200 pb-5 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#0a1142] text-white tracking-wider uppercase">
              Department Control Plane
            </span>
            <span className="text-xs text-gray-400 font-mono">Computer Science (CSC)</span>
          </div>
          <h1 className="text-2xl font-bold text-[#0a1142] mt-1.5 font-display">
            HOD Academic Governance Desk
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Manage course lecturer allocations and monitor cohort CGPA portfolio health across the department.
          </p>
        </div>

        {/* Tab Navigation Pill Bar */}
        <div className="flex items-center bg-gray-100 p-1 rounded-xl self-start md:self-auto border border-gray-200">
          {[
            ['allocations', 'Course Allocations', BookOpen],
            ['analytics', 'Cohort Analytics Terminal', TrendingUp],
          ].map(([k, label, Icon]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                tab === k
                  ? 'bg-white text-[#0a1142] shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon size={14} className={tab === k ? 'text-[#0a1142]' : 'text-gray-400'} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Tab Panels */}
      {tab === 'allocations' && <AllocationMatrix />}
      {tab === 'analytics' && <AnalyticsTerminal />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Course Allocation Matrix (Interactive Assign Dropdown)
// ─────────────────────────────────────────────────────────────────────────────
function AllocationMatrix() {
  const { data: allocations = [], isLoading, error } = useHodAllocations();
  const { data: lecturers = [] } = useHodLecturers();
  const { allocate } = useHodMutations();
  const [savingCourseId, setSavingCourseId] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const handleAssignLecturer = async (courseId, lecturerId) => {
    if (!lecturerId) return;
    setSavingCourseId(courseId);
    setSuccessMsg(null);
    try {
      await allocate.mutateAsync({
        courseId,
        semesterId: '2026_RAIN',
        lecturerId,
      });
      setSuccessMsg(`Lecturer successfully allocated!`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      alert(err.response?.data?.error || err.message || 'Failed to allocate lecturer');
    } finally {
      setSavingCourseId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-gray-500 border border-gray-200 shadow-sm animate-pulse">
        Loading department course allocation matrix...
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 text-red-700 p-6 rounded-2xl border border-red-200 text-sm font-medium">
        {error.detail || error.message || 'Failed to load course allocation matrix'}
      </div>
    );
  }

  const assignedCount = allocations.filter((a) => a.lecturer_id).length;
  const unassignedCount = allocations.length - assignedCount;

  return (
    <div className="space-y-4">
      {/* Allocation Summary Metric Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-blue-50 text-[#0a1142]">
            <BookOpen size={20} />
          </div>
          <div>
            <div className="text-xl font-bold text-gray-900">{allocations.length}</div>
            <div className="text-xs text-gray-500 font-medium">Department Courses</div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <div className="text-xl font-bold text-emerald-700">{assignedCount} Assigned</div>
            <div className="text-xs text-gray-500 font-medium">Active Teaching Allocations</div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600">
            <Clock size={20} />
          </div>
          <div>
            <div className="text-xl font-bold text-amber-700">{unassignedCount} Pending</div>
            <div className="text-xs text-gray-500 font-medium">Awaiting Lecturer Assignment</div>
          </div>
        </div>
      </div>

      {successMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Interactive Allocations Table */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-sm text-[#0a1142]">Department Course Allocation Matrix</h3>
            <p className="text-xs text-gray-500">
              Select and assign verified academic staff to teach semester courses.
            </p>
          </div>
          <span className="text-xs font-bold text-[#0a1142] bg-blue-50 px-3 py-1 rounded-full border border-blue-100">
            Semester: 2026_RAIN
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-100/70 text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200 font-bold">
              <tr>
                <th className="py-3 px-4">Course Code</th>
                <th className="py-3 px-4">Title</th>
                <th className="py-3 px-4 text-center">Units</th>
                <th className="py-3 px-4 text-center">Level</th>
                <th className="py-3 px-4">Assigned Lecturer</th>
                <th className="py-3 px-4 text-right">Action / Reassign</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {allocations.map((row) => {
                const isSaving = savingCourseId === row.course_id;
                const isAssigned = Boolean(row.lecturer_id);

                return (
                  <tr key={row.course_id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-gray-900">
                      {row.code}
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-800">
                      {row.title}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-gray-100 text-gray-700 font-mono">
                        {row.units} U
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-purple-50 text-purple-700">
                        {row.level}L
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {isAssigned ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-[#0a1142] text-white text-[10px] flex items-center justify-center font-bold">
                            {row.lecturer_name?.charAt(0) || 'L'}
                          </div>
                          <span className="font-semibold text-gray-900 text-xs">
                            {row.lecturer_name}
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                          <AlertTriangle size={12} />
                          <span>Unassigned</span>
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <select
                        disabled={isSaving}
                        value={row.lecturer_id || ''}
                        onChange={(e) => handleAssignLecturer(row.course_id, e.target.value)}
                        className={`text-xs px-3 py-1.5 rounded-lg border font-medium outline-none transition-all ${
                          isSaving
                            ? 'bg-gray-100 text-gray-400 border-gray-200'
                            : 'bg-white border-gray-300 hover:border-[#0a1142] text-gray-800 focus:ring-1 focus:ring-[#0a1142]'
                        }`}
                      >
                        <option value="" disabled>
                          -- Choose Lecturer --
                        </option>
                        {lecturers.map((lec) => (
                          <option key={lec.lecturer_id} value={lec.lecturer_id}>
                            {lec.full_name} ({lec.role})
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cohort Analytics Terminal (Finance Portfolio Style)
// ─────────────────────────────────────────────────────────────────────────────
function AnalyticsTerminal() {
  const { data, isLoading } = useHodAnalytics();

  if (isLoading || !data) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-gray-500 border border-gray-200 shadow-sm animate-pulse">
        Compiling department academic portfolio analytics...
      </div>
    );
  }

  const summary = data.summary || {};
  const gpaDistribution = data.gpaDistribution || [];
  const atRiskStudents = data.atRiskStudents || [];

  return (
    <div className="space-y-6">
      {/* Financial Portfolio KPI Ribbon */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Department CGPA Index */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-card relative overflow-hidden">
          <div className="flex items-center justify-between text-xs font-bold text-gray-400 uppercase tracking-wider">
            <span>Graded CGPA Index</span>
            <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-[11px] font-semibold">
              5.00 Max Scale
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-[#0a1142] font-mono">
              {Number(summary.dept_cgpa_index || 0).toFixed(2)}
            </span>
            <span className="text-xs text-gray-400 font-semibold font-mono">/ 5.00</span>
          </div>
          <p className="text-xs text-gray-500 mt-1 flex items-center gap-1 font-medium">
            <Award size={13} className="text-emerald-600" />
            <span>Weighted average across 300L & 400L</span>
          </p>
          <div className="absolute right-0 bottom-0 w-24 h-24 bg-blue-50/50 rounded-tl-full -z-0 pointer-events-none" />
        </div>

        {/* KPI 2: Upper Honours Yield */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-card relative overflow-hidden">
          <div className="flex items-center justify-between text-xs font-bold text-gray-400 uppercase tracking-wider">
            <span>Honours Yield (≥ 3.50)</span>
            <span className="text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded text-[10px] font-bold">
              First Class & 2:1
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-emerald-600 font-mono">
              {summary.graded_cohort > 0
                ? `${Math.round(((summary.honours_count || 0) / summary.graded_cohort) * 100)}%`
                : '—'}
            </span>
            <span className="text-xs text-gray-500 font-semibold">
              ({summary.honours_count || 0} students)
            </span>
          </div>
          <p className="text-xs text-emerald-700 mt-1 font-medium flex items-center gap-1">
            <ArrowUpRight size={14} />
            <span>High Academic Distinction Pool</span>
          </p>
        </div>

        {/* KPI 3: Academic Probation Risk */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-card relative overflow-hidden">
          <div className="flex items-center justify-between text-xs font-bold text-gray-400 uppercase tracking-wider">
            <span>At-Risk Ratio (&lt; 1.50)</span>
            <span className="text-red-700 bg-red-50 px-2 py-0.5 rounded text-[10px] font-bold">
              Intervention
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-red-600 font-mono">
              {summary.at_risk_count || 0}
            </span>
            <span className="text-xs text-gray-500 font-semibold">Senior Students</span>
          </div>
          <p className="text-xs text-red-600 mt-1 font-medium flex items-center gap-1">
            <AlertTriangle size={13} />
            <span>Probation monitoring required</span>
          </p>
        </div>

        {/* KPI 4: Foundational Cohort Pool */}
        <div className="bg-white rounded-2xl p-5 border border-gray-200 shadow-card relative overflow-hidden">
          <div className="flex items-center justify-between text-xs font-bold text-gray-400 uppercase tracking-wider">
            <span>Foundational Cohort</span>
            <span className="text-purple-700 bg-purple-50 px-2 py-0.5 rounded text-[10px] font-bold">
              Exempt Pool
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-purple-700 font-mono">
              {summary.foundational_pool || 0}
            </span>
            <span className="text-xs text-gray-500 font-semibold">100L & 200L Students</span>
          </div>
          <p className="text-xs text-purple-600 mt-1 font-medium flex items-center gap-1">
            <ShieldCheck size={13} />
            <span>Protected under Senate 100/200L Policy</span>
          </p>
        </div>
      </div>

      {/* Cohort Grade Distribution Terminal */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-sm text-[#0a1142]">
              Cohort Asset Performance & NUC Honours Distribution
            </h3>
            <p className="text-xs text-gray-500">
              Standard 5.00 CGPA brackets audited across all departmental cohorts.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-emerald-700 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              1st / 2:1 (≥ 3.50)
            </span>
            <span className="flex items-center gap-1.5 text-blue-700 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
              2:2 (2.50–3.49)
            </span>
            <span className="flex items-center gap-1.5 text-amber-700 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
              3rd (1.50–2.49)
            </span>
            <span className="flex items-center gap-1.5 text-red-700 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
              Probation (&lt; 1.50)
            </span>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {gpaDistribution.map((row) => {
            const isFoundational = row.level === 100 || row.level === 200;
            const total = row.total_enrolled || 1;
            const p1st = Math.round((row.first_or_second_upper / total) * 100);
            const p2nd = Math.round((row.second_lower / total) * 100);
            const p3rd = Math.round((row.third_class / total) * 100);
            const pRisk = Math.round((row.probation_risk / total) * 100);

            return (
              <div key={row.level} className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-lg bg-gray-100 font-bold text-gray-800 text-xs">
                      {row.level} Level
                    </span>
                    <span className="text-gray-500 font-normal">
                      ({row.total_enrolled} Enrolled)
                    </span>
                    {isFoundational && (
                      <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
                        Foundational Pre-Major
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-gray-400">Cohort Avg:</span>
                    <span className="font-bold text-[#0a1142]">{Number(row.avg_gpa || 0).toFixed(2)} / 5.00</span>
                  </div>
                </div>

                {/* Horizontal Stacked Yield Bar */}
                <div className="h-3 w-full bg-gray-100 rounded-full overflow-hidden flex shadow-inner">
                  <div
                    style={{ width: `${p1st}%` }}
                    className="bg-emerald-500 hover:bg-emerald-600 transition-all"
                    title={`First / 2:1: ${row.first_or_second_upper} (${p1st}%)`}
                  />
                  <div
                    style={{ width: `${p2nd}%` }}
                    className="bg-blue-500 hover:bg-blue-600 transition-all"
                    title={`Second Class Lower: ${row.second_lower} (${p2nd}%)`}
                  />
                  <div
                    style={{ width: `${p3rd}%` }}
                    className="bg-amber-400 hover:bg-amber-500 transition-all"
                    title={`Third Class: ${row.third_class} (${p3rd}%)`}
                  />
                  <div
                    style={{ width: `${pRisk}%` }}
                    className="bg-red-500 hover:bg-red-600 transition-all"
                    title={`Probation Risk: ${row.probation_risk} (${pRisk}%)`}
                  />
                </div>

                <div className="grid grid-cols-4 gap-2 pt-1 text-[11px] font-mono text-gray-500">
                  <div>
                    <span className="text-emerald-700 font-bold">{row.first_or_second_upper}</span> (≥3.50)
                  </div>
                  <div>
                    <span className="text-blue-700 font-bold">{row.second_lower}</span> (2.50–3.49)
                  </div>
                  <div>
                    <span className="text-amber-700 font-bold">{row.third_class}</span> (1.50–2.49)
                  </div>
                  <div>
                    <span className="text-red-700 font-bold">{row.probation_risk}</span> (&lt;1.50)
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Early Warning Watchlist (At-Risk Students Table) */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-red-600" size={18} />
            <h3 className="font-bold text-sm text-[#0a1142]">
              Specialization Early-Warning Watchlist (CGPA &lt; 1.50)
            </h3>
          </div>
          <span className="text-xs text-gray-500 font-medium">
            Excludes foundational pre-majors
          </span>
        </div>

        {atRiskStudents.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-xs">
            <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2" />
            <p className="font-semibold text-gray-700">Clean Portfolio Health</p>
            <p className="text-gray-400 mt-0.5">
              No senior students (300L/400L) are currently below the 1.50 academic probation threshold.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-100/70 text-gray-500 uppercase font-bold border-b border-gray-200">
                <tr>
                  <th className="py-2.5 px-4">Student Name</th>
                  <th className="py-2.5 px-4">Matriculation No</th>
                  <th className="py-2.5 px-4">Programme</th>
                  <th className="py-2.5 px-4 text-center">Level</th>
                  <th className="py-2.5 px-4 text-center">Current CGPA</th>
                  <th className="py-2.5 px-4 text-right">Academic Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {atRiskStudents.map((s) => (
                  <tr key={s.matric_number} className="hover:bg-red-50/30">
                    <td className="py-2.5 px-4 font-bold text-gray-900">{s.full_name}</td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-gray-700">{s.matric_number}</td>
                    <td className="py-2.5 px-4 text-gray-600">{s.programme_code || 'B.Sc. CSC'}</td>
                    <td className="py-2.5 px-4 text-center font-bold">{s.level}L</td>
                    <td className="py-2.5 px-4 text-center">
                      <span className="font-mono font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                        {Number(s.current_gpa || 0).toFixed(2)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-red-100 text-red-800">
                        Probation Review
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default HodDashboardPage;
