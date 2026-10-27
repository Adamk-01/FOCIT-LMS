import React, { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useIsFetching, useQuery } from '@tanstack/react-query';
import { 
  Menu, 
  Bell, 
  RefreshCw, 
  ChevronRight, 
  User,
  Sun,
  Moon,
  Clock
} from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationDrawer } from '../NotificationDrawer';
import { apiClient } from '../../lib/api';
import { useTheme } from '../../contexts/ThemeContext';

const ROUTE_NAME_MAP = {
  dashboard: 'Dashboard',
  courses: 'My Courses',
  materials: 'Learning Materials',
  quizzes: 'Quiz Assessment',
  grades: 'Gradebook',
  forum: 'Discussion Forum',
  calendar: 'Timetable & Calendar',
  timetable: 'Timetable & Calendar',
  assignments: 'Assignments',
  registration: 'Course Registration',
  profile: 'Student Profile & Settings',
  lecturer: 'Lecturer Portal',
  'question-bank': 'Question Bank & AI',
};

export const Topbar = ({ onOpenMobileDrawer, user }) => {
  const location = useLocation();
  const isFetching = useIsFetching();
  const { unreadCount, totalCount } = useNotifications();
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  const studentId = user?.username || user?.id || 'student1';
  const { data: profile } = useQuery({
    queryKey: ['student-profile', studentId],
    queryFn: async () => {
      const res = await apiClient.get('/student/profile');
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
    enabled: Boolean(studentId),
  });

  const { data: timetableEvents } = useQuery({
    queryKey: ['student-timetable-events'],
    queryFn: async () => {
      const res = await apiClient.get('/student/timetable/events');
      return res.data;
    },
    staleTime: 60 * 1000,
    enabled: Boolean(user),
  });
  const nextLecture = timetableEvents?.nextUpcomingLecture;

  const avatarUrl = profile?.avatar_url || user?.avatar_url || user?.avatarUrl;
  const studentFullName = profile?.full_name || user?.full_name || user?.name || '';
  const studentFirstName = studentFullName ? studentFullName.trim().split(/\s+/)[0] : (user?.username || 'John');
  const programmeName = profile?.programme_name || profile?.department_name || 'Computer Science';
  const studentLevel = profile?.level || user?.level || 200;

  // Parse path segments to generate dynamic breadcrumbs without duplicate dashboard roots
  const pathSegments = location.pathname.split('/').filter(Boolean).filter(s => s !== 'dashboard');
  const breadcrumbs = [
    { id: 'root-portal', name: 'Portal', path: '/dashboard' },
    ...pathSegments.map((segment, index) => {
      const url = `/${pathSegments.slice(0, index + 1).join('/')}`;
      const displayName = ROUTE_NAME_MAP[segment] || (segment === '1' ? 'CSC 204' : segment);
      return { id: `${segment}-${index}`, name: displayName, path: url };
    }),
  ];

  const { isDark, toggleTheme, theme } = useTheme();

  return (
    <header className="h-16 shrink-0 bg-white dark:bg-[#0f172a] border-b border-[#e2e8f0] dark:border-slate-800 px-4 sm:px-6 lg:px-8 flex items-center justify-between z-20 shadow-nav transition-colors">
      {/* 1. Mobile Menu Trigger + Breadcrumb Trail */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          aria-label="Open Navigation Drawer"
          className="p-2 -ml-2 rounded-lg text-gray-600 dark:text-gray-300 hover:text-[#0a1142] dark:hover:text-[#ffb81c] hover:bg-gray-100 dark:hover:bg-slate-800 md:hidden transition-colors"
        >
          <Menu size={22} />
        </button>

        <nav aria-label="Breadcrumb" className="min-w-0 hidden sm:block">
          <ol className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 font-medium truncate">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <li key={crumb.id} className="flex items-center gap-1.5 truncate">
                  {idx > 0 && <ChevronRight size={12} className="text-gray-400 dark:text-gray-600 shrink-0" />}
                  {isLast ? (
                    <span className="text-[#0a1142] dark:text-[#ffb81c] font-semibold truncate" aria-current="page">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link 
                      to={crumb.path} 
                      className="hover:text-[#0a1142] dark:hover:text-white transition-colors truncate"
                    >
                      {crumb.name}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>

      {/* 2. Telemetry, Theme Toggle, Notifications & User Identity Pill */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        {/* SWR Revalidation Status Badge (Zero Layout Shift Indicator) */}
        {isFetching > 0 && (
          <div 
            role="status" 
            aria-live="polite"
            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-950/60 text-[#16258f] dark:text-blue-300 border border-blue-200 dark:border-blue-800 animate-pulse"
          >
            <RefreshCw size={12} className="animate-spin text-[#16258f] dark:text-blue-300" />
            <span>Syncing Moodle...</span>
          </div>
        )}

        {/* Live Lecture Starting Soon Alert Pill */}
        {nextLecture?.isStartingSoon && (
          <Link
            to="/calendar"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-800 animate-pulse hover:bg-amber-100 transition-colors"
            title={`${nextLecture.courseCode} starts in ${nextLecture.minutesUntilStart}m in ${nextLecture.roomId}`}
          >
            <Clock size={12} className="text-amber-600 dark:text-amber-400" />
            <span>{nextLecture.courseCode} in {nextLecture.minutesUntilStart}m</span>
          </Link>
        )}

        {/* Global Dark Mode Quick Toggle Button */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          title={`Active: ${theme} (${isDark ? 'Dark' : 'Light'}). Click to toggle.`}
          className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:text-[#0a1142] dark:hover:text-[#ffb81c] hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
        >
          {isDark ? (
            <Sun size={20} className="text-[#ffb81c]" />
          ) : (
            <Moon size={20} />
          )}
        </button>

        {/* Accessible Notification Bell Trigger */}
        <button
          type="button"
          id="notification-trigger"
          onClick={() => setIsNotificationOpen(true)}
          aria-expanded={isNotificationOpen}
          aria-haspopup="dialog"
          aria-controls="notification-panel"
          aria-label={`View notifications (${unreadCount} unread, ${totalCount || 0} total)`}
          title={`Notifications: ${unreadCount} unread, ${totalCount || 0} total`}
          className="relative min-h-[44px] min-w-[44px] p-2 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 hover:text-[#0a1142] dark:hover:text-[#ffb81c] hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Bell size={20} />
          {unreadCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[20px] h-[20px] px-1 text-[10px] font-extrabold text-white bg-red-500 rounded-full ring-2 ring-white dark:ring-slate-900 shadow-sm animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : (totalCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[9px] font-bold text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-slate-700 rounded-full ring-2 ring-white dark:ring-slate-900 shadow-xs">
              {totalCount > 99 ? '99+' : totalCount}
            </span>
          ))}
        </button>

        {/* Student Profile Chip (matching template header) */}
        <Link 
          to="/profile" 
          aria-label="View Student Profile & Settings"
          className="flex items-center gap-3 pl-2 sm:pl-3 border-l border-gray-200 dark:border-slate-800 group hover:opacity-90 transition-opacity"
        >
          <div className="hidden lg:flex flex-col text-right">
            <span className="text-xs font-bold text-[#0a1142] dark:text-slate-100 group-hover:text-[#16258f] dark:group-hover:text-[#ffb81c] leading-tight transition-colors">
              Welcome, {studentFirstName}
            </span>
            <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium leading-tight">
              {programmeName} • Level {studentLevel}
            </span>
          </div>

          <div 
            className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#0a1142] to-[#16258f] text-[#ffb81c] font-bold text-xs flex items-center justify-center ring-2 ring-[#ffb81c]/50 group-hover:ring-[#ffb81c] shadow-sm transition-all overflow-hidden shrink-0"
            aria-hidden="true"
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={studentFullName || user?.username || 'Student Avatar'}
                className="w-full h-full object-cover"
              />
            ) : (
              studentFirstName ? studentFirstName.slice(0, 2).toUpperCase() : 'JD'
            )}
          </div>
        </Link>
      </div>

      {/* Accessible Off-Canvas Notification Drawer */}
      <NotificationDrawer 
        isOpen={isNotificationOpen} 
        onClose={() => setIsNotificationOpen(false)} 
      />
    </header>
  );
};
