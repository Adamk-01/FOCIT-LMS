import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  useLecturerOverview,
  useLecturerCourses,
  useLecturerCourseStudents,
} from '../hooks/useLecturerDashboard';
import { AttendanceLecturerPanel } from '../components/attendance/AttendanceLecturerPanel';
import { AssignmentManagementPanel } from '../components/assignment/AssignmentManagementPanel';
import { useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet } from 'lucide-react';
import { ContinuousAssessmentIngestModal } from '../components/roster/ContinuousAssessmentIngestModal';

export function LecturerDashboardPage() {
  const [activeTab, setActiveTab] = useState('courses');
  const [selectedCourseId, setSelectedCourseId] = useState('');

  const { data: overview, isLoading: overviewLoading } = useLecturerOverview();
  const { data: courses = [], isLoading: coursesLoading } = useLecturerCourses();

  // Automatically select first course when courses load if none selected
  React.useEffect(() => {
    if (courses.length > 0 && !selectedCourseId) {
      setSelectedCourseId(courses[0].course_id);
    }
  }, [courses, selectedCourseId]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b pb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0a1142]">Lecturer Workspace</h1>
          <p className="text-sm text-gray-600">
            {overview?.lecturer?.full_name ? `${overview.lecturer.full_name} (${overview.lecturer.staff_number})` : 'Academic Staff'} —{' '}
            <span className="font-semibold text-[#0a1142]">{overview?.semester?.name || 'Current Academic Session'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            ● Active Faculty Allocation
          </span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Allocated Courses</p>
          <p className="text-2xl font-bold text-[#0a1142] mt-1">
            {overviewLoading ? '…' : overview?.metrics?.assigned_courses_count ?? 0}
          </p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Enrolled Students</p>
          <p className="text-2xl font-bold text-[#0a1142] mt-1">
            {overviewLoading ? '…' : overview?.metrics?.total_students_taught ?? 0}
          </p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Active Quizzes / Tests</p>
          <p className="text-2xl font-bold text-[#0a1142] mt-1">
            {overviewLoading ? '…' : overview?.metrics?.active_quizzes_count ?? 0}
          </p>
        </div>
        <div 
          role="button"
          tabIndex={0}
          onClick={() => setActiveTab('assignments')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setActiveTab('assignments');
            }
          }}
          className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm cursor-pointer hover:border-[#0a1142] focus:outline-hidden focus:ring-2 focus:ring-[#0a1142] transition-colors"
        >
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Published Assignments</p>
          <p className="text-2xl font-bold text-[#0a1142] mt-1">
            {overviewLoading ? '…' : overview?.metrics?.active_assignments_count ?? 0}
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-200 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('courses')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'courses'
              ? 'border-[#0a1142] text-[#0a1142]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          My Allocated Courses
        </button>
        <button
          onClick={() => setActiveTab('roster')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'roster'
              ? 'border-[#0a1142] text-[#0a1142]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Class Roster & Examination Sheets
        </button>
        <button
          onClick={() => setActiveTab('assignments')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'assignments'
              ? 'border-[#0a1142] text-[#0a1142]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Continuous Assessment & Assignments
        </button>
        <button
          onClick={() => setActiveTab('attendance')}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'attendance'
              ? 'border-[#0a1142] text-[#0a1142]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          Attendance & NUC Eligibility
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'courses' && (
        <CoursesListPanel
          courses={courses}
          isLoading={coursesLoading}
          onSelectCourse={(id) => {
            setSelectedCourseId(id);
            setActiveTab('roster');
          }}
        />
      )}

      {activeTab === 'roster' && (
        <ClassRosterPanel
          courses={courses}
          selectedCourseId={selectedCourseId}
          onSelectCourseId={setSelectedCourseId}
        />
      )}

      {activeTab === 'assignments' && (
        <AssignmentManagementPanel
          courses={courses}
          selectedCourseId={selectedCourseId}
          onSelectCourseId={setSelectedCourseId}
        />
      )}

      {activeTab === 'attendance' && (
        <AttendanceLecturerPanel
          courseId={selectedCourseId || courses[0]?.course_id}
          courses={courses}
          onSelectCourseId={setSelectedCourseId}
        />
      )}
    </div>
  );
}

function CoursesListPanel({ courses, isLoading, onSelectCourse }) {
  if (isLoading) {
    return <div className="p-8 text-center text-gray-500">Loading assigned courses…</div>;
  }

  if (courses.length === 0) {
    return (
      <div className="bg-white p-8 rounded-xl border border-gray-200 text-center">
        <p className="text-gray-700 font-medium">No courses have been allocated to your profile for this semester.</p>
        <p className="text-xs text-gray-500 mt-1">Please contact your Head of Department (HOD) to finalize course allocation.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {courses.map((course) => (
        <div key={course.course_id} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm flex flex-col justify-between hover:border-[#0a1142]/40 transition-all">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                {course.code}
              </span>
              <span className="text-xs font-semibold text-gray-500">
                {course.units} Credit Units
              </span>
            </div>
            <h3 className="font-bold text-gray-900 mt-2 text-base line-clamp-1">{course.title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">{course.department_name} • {course.level} Level</p>

            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-600">
              <span>Enrolled Students:</span>
              <span className="font-bold text-[#0a1142]">{course.verified_enrolled_students}</span>
            </div>
          </div>

          <div className="mt-5 pt-3 border-t border-gray-100 flex flex-wrap gap-2">
            <button
              onClick={() => onSelectCourse(course.course_id)}
              className="flex-1 bg-[#0a1142] text-white text-xs font-semibold py-2 px-3 rounded hover:bg-[#0a1142]/90 text-center"
            >
              Class Roster
            </button>
            <Link
              to={`/courses/${course.course_id}/question-bank`}
              className="flex-1 bg-gray-100 text-gray-700 text-xs font-semibold py-2 px-3 rounded hover:bg-gray-200 text-center"
            >
              Question Bank
            </Link>
          </div>
        </div>
      ))}
    </div>
  );
}

function ClassRosterPanel({ courses, selectedCourseId, onSelectCourseId }) {
  const queryClient = useQueryClient();
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('');

  const { data: rosterData, isLoading, error } = useLecturerCourseStudents(selectedCourseId, {
    search,
    level: levelFilter,
  });

  const students = rosterData?.students ?? [];
  const currentCourse = rosterData?.course;

  const [isExportingCsv, setIsExportingCsv] = useState(false);

  const handleDownloadCsv = async () => {
    if (!selectedCourseId) return;
    setIsExportingCsv(true);
    try {
      const nonce = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('session_nonce') : null;
      const res = await fetch(`/api/lecturer/courses/${encodeURIComponent(selectedCourseId)}/roster/export`, {
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...(nonce ? { 'x-session-nonce': nonce } : {}),
        },
      });

      if (!res.ok) {
        throw new Error(`Failed to export roster: HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const safeCode = (currentCourse?.code || selectedCourseId).replace(/[^a-zA-Z0-9_-]/g, '_');
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${safeCode}_Official_Roster.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      console.error('[ClassRoster] Export error:', err);
      alert('Failed to download exam roster. Please ensure your session is active.');
    } finally {
      setIsExportingCsv(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filters & Actions Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Select Course</label>
            <select
              value={selectedCourseId}
              onChange={(e) => onSelectCourseId(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white font-medium text-gray-900"
            >
              {courses.map((c) => (
                <option key={c.course_id} value={c.course_id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Search Students</label>
            <input
              type="text"
              placeholder="Filter by name or matric..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-48 md:w-60"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Level</label>
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white text-gray-700"
            >
              <option value="">All Levels</option>
              <option value="100">100 Level</option>
              <option value="200">200 Level</option>
              <option value="300">300 Level</option>
              <option value="400">400 Level</option>
            </select>
          </div>
        </div>

        <div className="self-end md:self-auto flex items-center gap-2">
          <button
            onClick={() => setShowIngestModal(true)}
            disabled={!selectedCourseId}
            className="inline-flex items-center gap-1.5 bg-[#0a1142] text-white text-xs font-semibold px-3.5 py-2 rounded hover:bg-[#16258f] disabled:opacity-50 transition-all shadow-sm"
          >
            <FileSpreadsheet size={15} />
            <span>Ingest CA Scores (CSV)</span>
          </button>
          <button
            onClick={handleDownloadCsv}
            disabled={!selectedCourseId || students.length === 0 || isExportingCsv}
            className="inline-flex items-center gap-1.5 bg-emerald-700 text-white text-xs font-semibold px-3.5 py-2 rounded hover:bg-emerald-800 disabled:opacity-50 transition-all shadow-sm"
          >
            <span>📥</span> {isExportingCsv ? 'Exporting...' : 'Export Exam Roster (CSV)'}
          </button>
        </div>
      </div>

      {/* Roster Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <h4 className="font-bold text-sm text-[#0a1142]">
            {currentCourse ? `${currentCourse.code}: ${currentCourse.title}` : 'Enrolled Students'}
          </h4>
          <span className="text-xs font-semibold text-gray-500">
            {students.length} verified enrolled students
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-500">Loading student roster…</div>
        ) : error ? (
          <div className="p-6 text-center text-red-600 text-sm font-medium">
            {error.detail || error.message || 'Failed to load enrolled roster'}
          </div>
        ) : students.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No registered students found matching your criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
              <thead className="bg-gray-100/70 text-xs text-gray-500 uppercase tracking-wider border-b border-gray-200">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">S/N</th>
                  <th className="py-2.5 px-4 font-semibold">Matric Number</th>
                  <th className="py-2.5 px-4 font-semibold">Student Name</th>
                  <th className="py-2.5 px-4 font-semibold">Programme</th>
                  <th className="py-2.5 px-4 font-semibold">Level</th>
                  <th className="py-2.5 px-4 font-semibold">CA / Grade</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                  <th className="py-2.5 px-4 font-semibold">Enrolled Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {students.map((student, idx) => (
                  <tr key={student.student_id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-2.5 px-4 text-xs font-mono text-gray-400">{idx + 1}</td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-gray-900">{student.matric_number}</td>
                    <td className="py-2.5 px-4 font-medium text-gray-800">{student.full_name}</td>
                    <td className="py-2.5 px-4 text-xs text-gray-600">{student.programme_code || student.programme_name}</td>
                    <td className="py-2.5 px-4 text-xs font-semibold text-gray-600">{student.level}L</td>
                    <td className="py-2.5 px-4">
                      {student.grade !== null && student.grade !== undefined ? (
                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-blue-50 text-[#0a1142] border border-blue-200">
                          {student.grade}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400 font-mono italic">Pending</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                        {student.enrollment_status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-gray-400 font-mono">
                      {student.enrolled_at ? new Date(student.enrolled_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ContinuousAssessmentIngestModal
        isOpen={showIngestModal}
        onClose={() => setShowIngestModal(false)}
        courseId={selectedCourseId}
        courseCode={currentCourse?.code}
        courseTitle={currentCourse?.title}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['lecturer-course-students'] });
        }}
      />
    </div>
  );
}
