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
  dashboard: 'Dashboard',
  courses: 'My Courses',
  materials: 'Learning Materials',
  quizzes: 'Quiz Assessment',
  grades: 'Gradebook',
  forum: 'Discussion Forum',
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

        {/* Student Profile Chip (matching template header) */}
        <Link 
          to="/profile" 
          aria-label="View Student Profile & Settings"
          className="flex items-center gap-3 pl-2 sm:pl-3 border-l border-gray-200 group hover:opacity-90 transition-opacity"
        >
          <div className="hidden lg:flex flex-col text-right">
            <span className="text-xs font-bold text-[#0a1142] group-hover:text-[#16258f] leading-tight transition-colors">
              {user?.username ? `Welcome, ${user.username}` : 'Welcome, John Doe'}
            </span>
            <span className="text-[11px] text-gray-500 font-medium leading-tight">
              Computer Science • Level 200
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
