import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { 
  BookOpen, 
  GraduationCap, 
  CheckCircle2, 
  ArrowRight, 
  Clock, 
  ShieldCheck, 
  Video,
  ExternalLink,
  KeyRound
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../lib/api';
import { ErrorStateView } from '../components/ErrorStateView';
import { StudentActiveSessionBanner } from '../components/attendance/StudentActiveSessionBanner';
import { StudentAttendanceOverviewCard } from '../components/attendance/StudentAttendanceOverviewCard';
import { StudentOtpCheckInModal } from '../components/attendance/StudentOtpCheckInModal';
import { useStudentAttendanceSummary, useStudentActiveSessions } from '../hooks/useStudentAttendance';
import { DashboardCourseCard, DashboardCourseSkeleton } from '../components/dashboard/DashboardCourseCard';

export const DashboardPage = () => {
  const { user } = useAuth();
  const location = useLocation();
  const studentId = user?.student_id || user?.id || user?.username;

  const [searchParams, setSearchParams] = useSearchParams();
  const urlCheckInCourse = searchParams.get('checkin_course');

  // Active check-in modal target: null, true (manual select), or specific course object
  const [checkInModalCourse, setCheckInModalCourse] = useState(null);

  // Query authoritative student dashboard telemetry from BFF
  const { 
    data: dashboardData, 
    isLoading, 
    error, 
    refetch 
  } = useQuery({
    queryKey: ['student-dashboard', studentId],
    queryFn: async ({ signal }) => {
      const response = await apiClient.get('/student/dashboard', { signal });
      return response.data;
    },
    enabled: Boolean(studentId),
    staleTime: 5 * 60 * 1000,
  });

  const student = dashboardData?.student;
  const metrics = dashboardData?.metrics;
  const courses = useMemo(() => dashboardData?.courses || [], [dashboardData?.courses]);
  const upcomingActivities = dashboardData?.upcoming_activities || [];
  const zoomSession = dashboardData?.zoom_session;


  // Invariant #2: URL SearchParams synchronization for persistent deep-link rehydration
  useEffect(() => {
    if (urlCheckInCourse && courses.length > 0) {
      const match = courses.find(
        (c) => (c.course_id || c.id || c.code)?.toLowerCase() === urlCheckInCourse.toLowerCase()
      );
      setCheckInModalCourse(match || { id: urlCheckInCourse, course_id: urlCheckInCourse });
    }
  }, [urlCheckInCourse, courses]);

  const handleOpenCheckIn = (courseTarget, activeSession = null) => {
    let targetObj = courseTarget || courses[0] || true;
    if (activeSession && typeof targetObj === 'object') {
      targetObj = {
        ...targetObj,
        sessionId: activeSession.sessionId,
        weekNumber: activeSession.weekNumber,
        sessionDate: activeSession.sessionDate,
        remainingSeconds: activeSession.otpRemainingSeconds || activeSession.remainingSeconds,
      };
    }
    setCheckInModalCourse(targetObj);
    const cid = typeof targetObj === 'object' ? (targetObj.course_id || targetObj.id || targetObj.code) : '';
    if (cid) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('checkin_course', cid);
          return next;
        },
        { replace: true }
      );
    }
  };

  const handleCloseCheckIn = () => {
    setCheckInModalCourse(null);
    if (searchParams.has('checkin_course')) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('checkin_course');
          return next;
        },
        { replace: true }
      );
    }
  };

  // Query cumulative student attendance summary (Rules of Hooks: called unconditionally)
  const { data: attendanceData, refetch: refetchAttendance } = useStudentAttendanceSummary();
  const courseAttendanceMap = useMemo(() => {
    const map = new Map();
    if (attendanceData?.courses) {
      attendanceData.courses.forEach((c) => {
        map.set(c.courseId, c);
      });
    }
    return map;
  }, [attendanceData]);

  // Query active OTP sessions (shares TanStack Query cache with StudentActiveSessionBanner)
  const { data: activeSessions = [] } = useStudentActiveSessions();
  const activeSessionsMap = useMemo(() => {
    const map = new Map();
    if (Array.isArray(activeSessions)) {
      activeSessions.forEach((s) => {
        map.set(s.courseId, s);
      });
    }
    return map;
  }, [activeSessions]);

  if (!studentId) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorStateView title="Session Required" message="Authenticated student session required to view dashboard telemetry." />
      </div>
    );
  }

  if (error && !dashboardData) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorStateView title="Dashboard Telemetry Unavailable" message={error.response?.data?.error || error.message || 'Failed to retrieve student dashboard telemetry.'} onRetry={refetch} />
      </div>
    );
  }


  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-8 pb-16">
      {/* Registration Success Flash Notification */}
      {location.state?.registrationSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center justify-between shadow-sm animate-fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600" />
            <span>
              <strong>Registration Committed:</strong> Your academic modules have been finalized with <strong>{location.state?.units} units</strong> and synced with Moodle.
            </span>
          </div>
          <button 
            type="button" 
            onClick={() => window.history.replaceState({}, document.title)}
            className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 1. Header Hero Banner with Quick Attendance Check-In Action */}
      <header className="bg-gradient-to-r from-[#0a1142] via-[#070c2e] to-[#0a1142] rounded-2xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden border border-white/10">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-[#ffb81c]/15 to-transparent pointer-events-none" />
        
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#ffb81c] border border-[#ffb81c]/30 mb-3">
              <ShieldCheck size={14} />
              <span>UNIOSUN FOCIT LMS • Academic Identity Portal</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display">
              Welcome, <span className="text-[#ffb81c]">{student?.full_name || 'John Doe'}</span>
            </h1>
            <p className="text-gray-300 mt-2 text-sm sm:text-base font-medium">
              {student?.programme || 'Computer Science'} • Level {student?.level || 200}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Direct Attendance Passcode Ingress */}
            <button
              type="button"
              onClick={() => handleOpenCheckIn(courses[0] || true)}
              className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#ffb81c] hover:bg-[#e5a200] text-[#0a1142] font-bold text-xs flex items-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
              aria-label="Enter lecture passcode to check in"
              title="Enter 6-digit attendance passcode projected by lecturer"
            >
              <KeyRound size={16} />
              <span>Enter Passcode</span>
            </button>

            <div className="px-4 py-2.5 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center gap-3 text-sm">
              <Clock size={18} className="text-[#ffb81c]" />
              <div>
                <p className="text-[11px] text-gray-300">Active Term</p>
                <p className="font-semibold text-white">{metrics?.academic_term || '2026/2027 Rain Semester'}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Live Active Attendance Passcode Banner */}
      <StudentActiveSessionBanner />

      {/* 3. Key Telemetry Summary Cards */}
      <section aria-label="Student Academic Metrics" className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Metric 1: Registered Courses */}
        <div className="bg-white dark:bg-[#0c132c] rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between transition-colors">
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
              Registered Courses
            </p>
            <p className="text-3xl font-extrabold text-[#0a1142] dark:text-white">
              {isLoading ? '...' : (metrics?.registered_courses ?? courses.length ?? 0)}
            </p>
            <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">Active this term</span>
          </div>
          <div className="p-3.5 bg-blue-50 dark:bg-blue-950/60 text-[#0a1142] dark:text-blue-300 border border-transparent dark:border-blue-800/50 rounded-2xl shadow-sm">
            <BookOpen size={26} className="text-[#0a1142] dark:text-blue-300" />
          </div>
        </div>

        {/* Metric 2: Completed Units */}
        <div className="bg-white dark:bg-[#0c132c] rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between transition-colors">
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
              Completed Units
            </p>
            <p className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
              {isLoading ? '...' : (metrics?.completed_units ?? 0)}
            </p>
            <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">Completed courses/modules</span>
          </div>
          <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 border border-transparent dark:border-emerald-800/50 rounded-2xl shadow-sm">
            <CheckCircle2 size={26} className="text-emerald-600 dark:text-emerald-300" />
          </div>
        </div>

        {/* Metric 3: Cumulative GPA */}
        <div className="bg-white dark:bg-[#0c132c] rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm flex items-center justify-between transition-colors">
          <div className="space-y-1">
            <p className="text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
              Cumulative GPA
            </p>
            <p className="text-3xl font-extrabold text-[#0a1142] dark:text-white">
              {isLoading ? '...' : (
                metrics?.gpa_exempt 
                  ? '0.00' 
                  : (metrics?.current_gpa != null ? Number(metrics.current_gpa).toFixed(2) : '0.00')
              )}
            </p>
            <span className={`text-xs font-bold ${
              metrics?.gpa_exempt 
                ? 'text-gray-500 dark:text-slate-400' 
                : Number(metrics?.current_gpa) >= 3.5 
                  ? 'text-emerald-600 dark:text-emerald-400' 
                  : 'text-gray-500 dark:text-slate-400'
            }`}>
              {metrics?.gpa_exempt 
                ? 'Foundational Level (100L/200L)' 
                : (metrics?.standing_label || (Number(metrics?.current_gpa) > 0 ? 'Good Standing' : 'Not Graded Yet'))}
            </span>
          </div>
          <div className="p-3.5 bg-amber-50 dark:bg-amber-950/60 text-[#ffb81c] dark:text-amber-300 border border-transparent dark:border-amber-800/50 rounded-2xl shadow-sm">
            <GraduationCap size={26} className="text-[#ffb81c] dark:text-amber-300" />
          </div>
        </div>
      </section>

      {/* 4. Main Dashboard Grid: My Courses (Left) & Attendance / Upcoming (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: My Courses Section */}
        <section className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-[#0a1142] dark:text-white font-display">
              My Courses
            </h2>
            <Link 
              to="/courses" 
              className="text-xs font-bold text-[#0a1142] dark:text-slate-300 hover:text-[#16258f] dark:hover:text-white flex items-center gap-1 transition-colors"
            >
              <span>View All</span>
              <ArrowRight size={14} />
            </Link>
          </div>

          {isLoading ? (
            <DashboardCourseSkeleton count={4} />
          ) : courses.length === 0 ? (
            <div className="bg-white dark:bg-[#0c132c] rounded-2xl p-8 border border-gray-200 dark:border-slate-800 text-center space-y-3 shadow-xs">
              <BookOpen size={32} className="mx-auto text-gray-400 dark:text-slate-500" />
              <p className="text-sm text-gray-600 dark:text-slate-300 font-medium">No active courses enrolled for this term.</p>
              <Link
                to="/registration"
                className="inline-block px-4 py-2 bg-[#0a1142] dark:bg-[#ffb81c] text-white dark:text-[#0a1142] text-xs font-bold rounded-xl hover:bg-[#16258f] dark:hover:bg-[#e5a200] transition-colors"
              >
                Proceed to Course Registration
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              {courses.map((course) => (
                <DashboardCourseCard
                  key={course.course_id}
                  course={course}
                  attendance={courseAttendanceMap.get(course.course_id)}
                  activeSession={activeSessionsMap.get(course.course_id)}
                  onOpenCheckIn={handleOpenCheckIn}
                />
              ))}
            </div>
          )}
        </section>

        {/* Right Column: Attendance Standing + Upcoming Activities */}
        <aside className="space-y-6">
          {/* NUC Attendance Standing Telemetry Card with Direct Check-in Ingress */}
          <StudentAttendanceOverviewCard onOpenCheckIn={() => handleOpenCheckIn(courses[0] || true)} />

          {/* Zoom Meeting Action Card: strictly conditional on active enrollments AND scheduled session */}
          {courses.length > 0 && zoomSession ? (
            <div className="bg-gradient-to-br from-[#0a1142] to-[#16258f] rounded-2xl p-6 text-white shadow-lg space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#ffb81c]">
                <Video size={16} />
                <span>Live Virtual Classroom</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-white">{zoomSession.title}</h3>
                <p className="text-xs text-gray-300 mt-1">{zoomSession.topic}</p>
                {zoomSession.schedule && (
                  <p className="text-[11px] text-[#ffb81c] font-medium mt-1">{zoomSession.schedule}</p>
                )}
              </div>
              <a
                href={zoomSession.join_url || "https://zoom.us"}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 bg-[#ffb81c] hover:bg-[#e5a200] text-[#0a1142] rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-md"
              >
                <span>Join Zoom Meeting</span>
                <ExternalLink size={14} />
              </a>
            </div>
          ) : null}

          {/* Upcoming Activities List */}
          <div className="bg-white dark:bg-[#0c132c] rounded-2xl p-6 border border-gray-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-[#0a1142] dark:text-white">Upcoming Activities</h3>
              <span className="text-[11px] text-gray-500 dark:text-slate-400 font-medium">Synced with Moodle</span>
            </div>

            {upcomingActivities.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-slate-500 text-center py-4">
                No upcoming deadlines or activities scheduled.
              </p>
            ) : (
              <div className="space-y-3">
                {upcomingActivities.map((act) => (
                  <div key={act.id} className="p-3.5 rounded-xl bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700/50 flex items-center justify-between gap-3">
                    <div className="space-y-0.5 min-w-0">
                      <p className="font-bold text-xs text-[#0a1142] dark:text-white truncate">{act.title}</p>
                      <p className="text-[11px] text-gray-500 dark:text-slate-400 flex items-center gap-1">
                        <Clock size={11} className="shrink-0" />
                        <span>Due: {act.due_date}</span>
                      </p>
                    </div>

                    <Link
                      to={act.link || '/courses'}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${
                        act.type === 'quiz' 
                          ? 'bg-[#0a1142] text-[#ffb81c] hover:bg-[#16258f]' 
                          : 'bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-600'
                      }`}
                    >
                      {act.action_label}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Global Student OTP Check-In Modal Triggered From Any Dashboard Sector */}
      {checkInModalCourse && (
        <StudentOtpCheckInModal
          isOpen={Boolean(checkInModalCourse)}
          onClose={handleCloseCheckIn}
          enrolledCourses={courses}
          defaultCourseId={typeof checkInModalCourse === 'object' ? (checkInModalCourse?.course_id || checkInModalCourse?.id) : (courses[0]?.course_id || '')}
          sessionData={typeof checkInModalCourse === 'object' && checkInModalCourse?.sessionId ? checkInModalCourse : null}
          onSuccess={() => {
            refetch();
            refetchAttendance();
          }}
        />
      )}
    </div>
  );
};

export default DashboardPage;
