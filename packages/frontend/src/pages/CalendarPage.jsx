import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Calendar as CalendarIcon, 
  Clock, 
  MapPin, 
  BookOpen, 
  Bell, 
  BellRing, 
  Smartphone, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCw, 
  ShieldCheck,
  ChevronRight,
  Flame,
  ArrowRight
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { SyncPhoneCalendarModal } from '../components/calendar/SyncPhoneCalendarModal';
import { useLectureNotifications } from '../hooks/useLectureNotifications';
import { ErrorStateView } from '../components/ErrorStateView';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DOW_INDEX = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5 };

/**
 * <CalendarPage />
 *
 * Implements:
 * 1. Screen 5: Academic Timetable Matrix & Milestone Calendar
 * 2. Weekly Lecture Grid (Monday - Friday) with room/venue resolution
 * 3. In-Browser 15-Minute Lecture Notification Engine with user permission gating
 * 4. 1-Tap Native Phone Calendar Sync modal (webcal:// with -PT15M VALARM)
 * 5. Important Academic Deadlines & Milestones ledger
 * 6. Full Dark Mode compatibility
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function CalendarPage() {
  const [showSyncModal, setShowSyncModal] = useState(false);

  // 1. Fetch Timetable Events & Next Lecture Telemetry
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['student-timetable-events'],
    queryFn: async () => {
      const res = await apiClient.get('/student/timetable/events');
      return res.data;
    },
    staleTime: 60 * 1000,
    refetchInterval: 30 * 1000, // Background poll for real-time lecture countdown
  });

  const schedule = data?.schedule || [];
  const deadlines = data?.upcomingDeadlines || [];
  const nextLecture = data?.nextUpcomingLecture || null;

  // 2. Browser Web Notification API Hook (User Gesture Gated)
  const {
    permission,
    isGranted,
    isDefault,
    isDenied,
    requestPermission,
  } = useLectureNotifications(nextLecture);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] dark:text-[#ffb81c] mx-auto" aria-hidden="true" />
        <p className="text-gray-600 dark:text-gray-300 font-medium">Loading academic timetable and lecture schedule...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorStateView
          title="Timetable Unavailable"
          message={error?.message || 'Failed to retrieve your lecture timetable schedule.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* 1. Header Banner & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-sm transition-colors">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-bold text-[#0a1142] dark:text-[#ffb81c] uppercase tracking-wider">
            <CalendarIcon size={14} />
            <span>Academic Timetable & Schedule</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white font-display">
            Weekly Lectures & Deadlines
          </h1>
          <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400">
            Authoritative schedule of enrolled lectures, physical venues, and submission deadlines.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Browser Notification Permission Button */}
          {isDefault && (
            <button
              type="button"
              onClick={requestPermission}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-300 font-bold text-xs flex items-center gap-2 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors shadow-xs"
            >
              <BellRing size={16} className="text-amber-600 dark:text-amber-400 animate-bounce" />
              <span>Enable Browser Reminders</span>
            </button>
          )}

          {isGranted && (
            <div className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 font-bold text-xs flex items-center gap-1.5">
              <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span>15m Alerts Active</span>
            </div>
          )}

          {isDenied && (
            <div title="Notifications are blocked in your browser settings" className="min-h-[44px] px-3 py-2 rounded-xl bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 font-medium text-xs flex items-center gap-1.5">
              <Bell size={15} />
              <span>Alerts Blocked</span>
            </div>
          )}

          {/* Sync with Phone Calendar Trigger */}
          <button
            type="button"
            onClick={() => setShowSyncModal(true)}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0a1142] dark:bg-[#ffb81c] text-white dark:text-[#0a1142] font-bold text-xs flex items-center gap-2 shadow-md hover:bg-[#16258f] dark:hover:bg-[#ffd060] transition-all"
          >
            <Smartphone size={16} />
            <span>Sync with Phone Calendar</span>
          </button>
        </div>
      </div>

      {/* 2. Live Lecture / Upcoming Class Alert Banner */}
      {nextLecture && (
        <div className={`p-4 sm:p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm transition-all ${
          nextLecture.isStartingSoon
            ? 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 border-amber-300 dark:border-amber-700/80 animate-pulse'
            : nextLecture.isLiveNow
            ? 'bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 border-emerald-300 dark:border-emerald-700/80'
            : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/60'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              nextLecture.isStartingSoon
                ? 'bg-amber-500 text-white'
                : nextLecture.isLiveNow
                ? 'bg-emerald-600 text-white'
                : 'bg-[#0a1142] dark:bg-[#ffb81c] text-[#ffb81c] dark:text-[#0a1142]'
            }`}>
              {nextLecture.isStartingSoon ? <Flame size={20} /> : <Clock size={20} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                  nextLecture.isStartingSoon
                    ? 'bg-amber-200 dark:bg-amber-900 text-amber-900 dark:text-amber-200'
                    : nextLecture.isLiveNow
                    ? 'bg-emerald-200 dark:bg-emerald-900 text-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                }`}>
                  {nextLecture.isStartingSoon ? 'Starting Soon' : nextLecture.isLiveNow ? 'Live Lecture' : 'Today\'s Lecture'}
                </span>
                <span className="text-xs font-bold text-gray-900 dark:text-white font-mono">
                  {nextLecture.courseCode}
                </span>
              </div>
              <p className="text-sm font-bold text-gray-900 dark:text-white mt-0.5">
                {nextLecture.courseTitle}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-gray-600 dark:text-gray-300 shrink-0">
            <div className="flex items-center gap-1.5">
              <MapPin size={15} className="text-gray-400" />
              <span>Room: {nextLecture.roomId}</span>
            </div>
            <span className="hidden sm:inline">•</span>
            <div className="flex items-center gap-1.5">
              <Clock size={15} className="text-gray-400" />
              <span>{nextLecture.startTime.slice(0, 5)} ({nextLecture.durationMinutes} mins)</span>
            </div>
            <Link
              to={`/courses/${nextLecture.courseId || nextLecture.courseCode}`}
              className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#0a1142] dark:bg-indigo-600 text-white font-bold text-xs flex items-center gap-1.5 hover:bg-[#16258f] dark:hover:bg-indigo-700 transition-colors shadow-sm ml-auto sm:ml-0"
            >
              <span>{nextLecture.isLiveNow ? 'Join Class Now' : 'Open Classroom'}</span>
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      {/* 3. Main Grid: Weekly Schedule & Deadlines Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Weekly Timetable Matrix */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-card p-6 transition-colors">
            <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-slate-800 mb-6">
              <h2 className="text-base font-bold text-[#0a1142] dark:text-[#ffb81c] font-display">
                Weekly Class Schedule
              </h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Synchronized with Central Academic Catalog
              </span>
            </div>

            {schedule.length === 0 ? (
              <div className="py-12 text-center space-y-3">
                <BookOpen size={36} className="text-gray-300 dark:text-gray-600 mx-auto" />
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">No lecture schedules found</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Ensure you are enrolled in approved courses with active semester timetable entries.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {DAYS.map((dayName) => {
                  const targetDow = DOW_INDEX[dayName];
                  const daySlots = schedule.filter((s) => Number(s.dayOfWeek) === targetDow);

                  return (
                    <div key={dayName} className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 font-mono">
                          {dayName}
                        </span>
                        <div className="flex-1 h-px bg-gray-100 dark:bg-slate-800" />
                        <span className="text-[11px] text-gray-400">
                          {daySlots.length} {daySlots.length === 1 ? 'class' : 'classes'}
                        </span>
                      </div>

                      {daySlots.length === 0 ? (
                        <div className="p-3.5 rounded-xl bg-slate-50/50 dark:bg-slate-800/20 border border-dashed border-gray-200 dark:border-slate-800 text-xs text-gray-400">
                          No classes scheduled
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {daySlots.map((slot) => {
                            const courseTarget = slot.courseId || slot.courseCode;
                            return (
                              <div
                                key={slot.id}
                                className="p-4 rounded-xl bg-white dark:bg-slate-800/70 border border-gray-200/80 dark:border-slate-700/60 shadow-xs hover:border-[#0a1142]/40 dark:hover:border-indigo-400/60 hover:shadow-md transition-all space-y-3 group flex flex-col justify-between"
                              >
                                <div>
                                  <div className="flex items-center justify-between">
                                    <Link
                                      to={`/courses/${courseTarget}`}
                                      className="font-extrabold text-sm text-[#0a1142] dark:text-[#ffb81c] hover:underline flex items-center gap-1.5 focus:outline-none"
                                    >
                                      <span>{slot.courseCode}</span>
                                      <ChevronRight size={14} className="text-gray-400 group-hover:text-[#0a1142] dark:group-hover:text-[#ffb81c] group-hover:translate-x-0.5 transition-all" />
                                    </Link>
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-gray-700 dark:text-gray-300">
                                      {slot.units || 3} Units
                                    </span>
                                  </div>

                                  <h3 className="text-xs font-semibold text-gray-800 dark:text-gray-200 line-clamp-1 mt-1 group-hover:text-[#16258f] dark:group-hover:text-white transition-colors">
                                    <Link to={`/courses/${courseTarget}`}>
                                      {slot.courseTitle}
                                    </Link>
                                  </h3>

                                  <div className="flex items-center justify-between pt-2 text-xs text-gray-500 dark:text-gray-400">
                                    <div className="flex items-center gap-1 font-mono">
                                      <Clock size={12} className="text-gray-400" />
                                      <span>{slot.startTime.slice(0, 5)}</span>
                                      <span>({slot.durationMinutes}m)</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <MapPin size={12} className="text-gray-400" />
                                      <span>Room: {slot.roomId}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Quick Module Navigation Links */}
                                <div className="pt-2 border-t border-gray-100 dark:border-slate-700/60 flex items-center gap-1.5 flex-wrap">
                                  <Link
                                    to={`/courses/${courseTarget}`}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-[#0a1142] dark:text-indigo-300 bg-slate-100 dark:bg-slate-800 hover:bg-[#0a1142] hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-colors flex items-center gap-1"
                                  >
                                    <BookOpen size={11} />
                                    <span>Classroom</span>
                                  </Link>
                                  <Link
                                    to={`/courses/${courseTarget}?tab=materials`}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-600 hover:text-white transition-colors flex items-center gap-1"
                                  >
                                    <span>Materials</span>
                                  </Link>
                                  <Link
                                    to={`/courses/${courseTarget}?tab=assignments`}
                                    className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-600 hover:text-white transition-colors flex items-center gap-1"
                                  >
                                    <span>Tasks</span>
                                  </Link>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Deadlines & Milestones Sidebar */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-card p-6 transition-colors space-y-5">
            <div className="flex items-center justify-between pb-3.5 border-b border-gray-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-[#ffb81c]" />
                <h2 className="text-sm font-bold text-gray-900 dark:text-white font-display whitespace-nowrap">
                  Important Deadlines
                </h2>
              </div>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-[#ffb81c] border border-amber-500/20 shrink-0">
                Assessments
              </span>
            </div>

            {deadlines.length === 0 ? (
              <div className="py-8 text-center text-xs text-gray-400">
                No impending submission deadlines.
              </div>
            ) : (
              <div className="space-y-3.5">
                {deadlines.map((dl) => {
                  const isQuiz = dl.type === 'QUIZ';
                  const targetTab = isQuiz ? 'quizzes' : 'assignments';
                  const courseTarget = dl.courseId || dl.courseCode;
                  const targetUrl = `/courses/${courseTarget}?tab=${targetTab}`;

                  return (
                    <Link
                      key={dl.id}
                      to={targetUrl}
                      className="block p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 hover:border-[#0a1142]/40 dark:hover:border-indigo-500/60 hover:bg-white dark:hover:bg-slate-800 hover:shadow-md transition-all space-y-2.5 group cursor-pointer"
                      title={`Open ${isQuiz ? 'Quiz' : 'Assignment'} in ${dl.courseCode}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-sm text-[#0a1142] dark:text-[#ffb81c]">
                            {dl.courseCode}
                          </span>
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider shrink-0 ${
                            isQuiz 
                              ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300/50 dark:border-amber-700/50' 
                              : 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-300 border border-indigo-300/50 dark:border-indigo-700/50'
                          }`}>
                            {isQuiz ? 'Quiz' : 'Assignment'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700/60 shrink-0">
                          <Clock size={11} className="text-gray-400" />
                          <span className="whitespace-nowrap">
                            {new Date(dl.dueDate).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <p className="text-xs font-medium text-gray-800 dark:text-gray-200 line-clamp-1 group-hover:text-[#16258f] dark:group-hover:text-indigo-300 transition-colors">
                          {dl.title}
                        </p>
                        <ChevronRight size={14} className="text-gray-400 dark:text-slate-500 group-hover:text-[#0a1142] dark:group-hover:text-[#ffb81c] group-hover:translate-x-1 transition-all shrink-0" aria-hidden="true" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Academic Semester Milestones Card */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-card p-6 transition-colors space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-slate-800">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
              <h2 className="text-sm font-bold text-gray-900 dark:text-white font-display">
                Semester Milestones
              </h2>
            </div>
            <div className="space-y-2.5 text-xs text-gray-600 dark:text-gray-300">
              <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-800/80">
                <span className="font-medium">Lecture Series End</span>
                <span className="font-mono font-bold text-gray-800 dark:text-gray-200 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">Dec 15, 2026</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-gray-100 dark:border-slate-800/80">
                <span className="font-medium">Revision Week</span>
                <span className="font-mono font-bold text-gray-800 dark:text-gray-200 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">Dec 16 - 20</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="font-medium">Rain Semester Exams</span>
                <span className="font-mono font-bold text-[#0a1142] dark:text-[#ffb81c] bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200/50 dark:border-amber-800/50">Jan 05, 2027</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sync Phone Calendar Top Layer Modal */}
      <SyncPhoneCalendarModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
      />
    </div>
  );
}

export default CalendarPage;
