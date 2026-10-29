import React, { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import { 
  Menu, 
  Bell, 
  RefreshCw, 
  ChevronRight, 
  User 
} from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationDrawer } from '../NotificationDrawer';

const ROUTE_NAME_MAP = {
  admin: 'Admin Portal',
  users: 'User Directory',
  outbox: 'Moodle Outbox Sync',
  audit: 'Security Audit Ledger',
  profile: 'Profile & Security',
  dashboard: 'Dashboard',
  courses: 'Course Catalog',
  materials: 'Learning Materials',
  quizzes: 'Quiz Assessment',
  grades: 'Gradebook',
  forum: 'Discussion Forum',
  registration: 'Course Registration',
  advisor: 'Advisor Portal',
  registrations: 'Senate Review Queue',
  lecturer: 'Lecturer Portal',
  'question-bank': 'Question Bank & AI',
};

export const Topbar = ({ onOpenMobileDrawer, user }) => {
  const location = useLocation();
  const isFetching = useIsFetching();
  const { unreadCount, totalCount } = useNotifications();
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  const role = String(user?.role || '').toUpperCase();
  const isAdmin = ['ADMIN', 'SYSTEM_ADMIN'].includes(role);
  const isLecturer = role === 'LECTURER';
  const isAdvisor = ['LEVEL_ADVISOR', 'ADVISOR'].includes(role);
  const isHod = ['HOD', 'DEAN'].includes(role);

  const rootCrumb = isAdmin
    ? { id: 'root-portal', name: 'Admin Portal', path: '/admin' }
    : isLecturer
    ? { id: 'root-portal', name: 'Lecturer Workspace', path: '/lecturer' }
    : isAdvisor
    ? { id: 'root-portal', name: 'Advisor Portal', path: '/advisor/registrations' }
    : { id: 'root-portal', name: 'Portal', path: '/dashboard' };

  // For admin routes like /admin/users, skip repeating the root "admin" segment in breadcrumbs
  const pathSegments = location.pathname
    .split('/')
    .filter(Boolean)
    .filter((s, idx) => !(idx === 0 && (s === 'admin' || s === 'dashboard' || s === 'advisor' || s === 'lecturer' || s === 'hod')));

  const breadcrumbs = [
    rootCrumb,
    ...pathSegments.map((segment, index) => {
      const fullSubPath = location.pathname.split('/').slice(0, index + 2).join('/');
      const displayName = ROUTE_NAME_MAP[segment] || (segment === '1' ? 'CSC 204' : segment);
      return { id: `${segment}-${index}`, name: displayName, path: fullSubPath };
    }),
  ];

  return (
    <header className="h-16 shrink-0 bg-white border-b border-[#e2e8f0] px-4 sm:px-6 lg:px-8 flex items-center justify-between z-20 shadow-nav">
      {/* 1. Mobile Menu Trigger + Breadcrumb Trail */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          aria-label="Open Navigation Drawer"
          className="p-2 -ml-2 rounded-lg text-gray-600 hover:text-[#0a1142] hover:bg-gray-100 md:hidden transition-colors"
        >
          <Menu size={22} />
        </button>

        <nav aria-label="Breadcrumb" className="min-w-0 hidden sm:block">
          <ol className="flex items-center gap-1.5 text-xs text-gray-500 font-medium truncate">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <li key={crumb.id} className="flex items-center gap-1.5 truncate">
                  {idx > 0 && <ChevronRight size={12} className="text-gray-400 shrink-0" />}
                  {isLast ? (
                    <span className="text-[#0a1142] font-semibold truncate" aria-current="page">
                      {crumb.name}
                    </span>
                  ) : (
                    <Link 
                      to={crumb.path} 
                      className="hover:text-[#0a1142] transition-colors truncate"
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

      {/* 2. Telemetry, Notifications & User Identity Pill */}
      <div className="flex items-center gap-3 sm:gap-4 shrink-0">
        {/* SWR Revalidation Status Badge (Zero Layout Shift Indicator) */}
        {isFetching > 0 && (
          <div 
            role="status" 
            aria-live="polite"
            className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-[#16258f] border border-blue-200 animate-pulse"
          >
            <RefreshCw size={12} className="animate-spin text-[#16258f]" />
            <span>Syncing Moodle...</span>
          </div>
        )}

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
          className="relative p-2 rounded-full text-gray-500 hover:text-[#0a1142] hover:bg-gray-100 transition-colors"
        >
          <Bell size={20} />
          {unreadCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[20px] h-[20px] px-1 text-[10px] font-extrabold text-white bg-red-500 rounded-full ring-2 ring-white shadow-sm animate-pulse">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : (totalCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[9px] font-bold text-gray-700 bg-gray-200 rounded-full ring-2 ring-white shadow-xs">
              {totalCount > 99 ? '99+' : totalCount}
            </span>
          ))}
        </button>

        {/* Identity & Profile Chip */}
        <Link 
          to={isAdmin ? '/admin/profile' : isAdvisor ? '/advisor/registrations' : '/profile'} 
          aria-label={isAdmin ? 'View Admin Profile' : isAdvisor ? 'View Advisor Review' : isLecturer ? 'View Lecturer Profile' : 'View Student Profile'}
          className="flex items-center gap-3 pl-2 sm:pl-3 border-l border-gray-200 group hover:opacity-90 transition-opacity"
        >
          <div className="hidden lg:flex flex-col text-right">
            <span className="text-xs font-bold text-[#0a1142] group-hover:text-[#16258f] leading-tight transition-colors">
              {user?.username ? `Welcome, ${user.username}` : 'Welcome, User'}
            </span>
            <span className="text-[11px] text-gray-500 font-medium leading-tight">
              {isAdmin ? 'Faculty Administration • System Control Plane' : isLecturer ? 'Academic Staff • Lecturer' : isAdvisor ? 'Academic Staff • Faculty Registry' : 'Computer Science • Level 200'}
            </span>
          </div>

          <div 
            className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#0a1142] to-[#16258f] text-[#ffb81c] font-bold text-xs flex items-center justify-center ring-2 ring-[#ffb81c]/50 group-hover:ring-[#ffb81c] shadow-sm transition-all"
            aria-hidden="true"
          >
            {user?.username ? user.username.slice(0, 2).toUpperCase() : 'JD'}
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
