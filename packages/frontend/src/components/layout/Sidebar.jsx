import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users, 
  RefreshCw, 
  BookOpen, 
  FileText, 
  HelpCircle, 
  Sparkles, 
  Award, 
  MessagesSquare, 
  ClipboardCheck, 
  LogOut, 
  ChevronLeft, 
  ChevronRight, 
  ShieldCheck, 
  UserCog, 
  Calendar,
  Library,
  X,
  Lock
} from 'lucide-react';
import { useExamLock } from '../../contexts/ExamLockContext';

export const NAV_ITEMS = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
    badge: null,
    screenNumber: '1',
  },
  {
    id: 'courses',
    name: 'My Courses',
    to: '/courses',
    icon: BookOpen,
    badge: null,
    screenNumber: '2',
  },
  {
    id: 'materials',
    name: 'Digital Library',
    to: '/library',
    icon: Library,
    badge: 'Vault',
    screenNumber: '3',
    resolveRoute: () => '/library',
    resolveBadge: () => 'Vault',
  },
  {
    id: 'quizzes',
    name: 'Quiz Assessment',
    to: '/courses?focus=quizzes',
    icon: HelpCircle,
    badge: 'Active',
    screenNumber: '4',
    resolveRoute: (courseId) => courseId 
      ? `/courses/${encodeURIComponent(courseId)}?tab=quizzes`
      : '/courses?focus=quizzes',
    resolveBadge: () => 'Active',
  },
  {
    id: 'timetable',
    name: 'Timetable & Calendar',
    to: '/calendar',
    icon: Calendar,
    badge: null,
    screenNumber: '5',
  },
  {
    id: 'question-bank',
    name: 'Question Bank & AI',
    to: '/question-bank',
    icon: Sparkles,
    badge: 'Faculty',
    screenNumber: '5A',
    lecturerOnly: true,
  },
  {
    id: 'gradebook',
    name: 'Gradebook',
    to: '/courses?focus=grades',
    icon: Award,
    badge: null,
    screenNumber: '6',
    resolveRoute: (courseId) => courseId 
      ? `/courses/${encodeURIComponent(courseId)}?tab=grades`
      : '/courses?focus=grades',
  },
  {
    id: 'forum',
    name: 'Discussion Forum',
    to: '/courses?focus=forum',
    icon: MessagesSquare,
    badge: null,
    screenNumber: '7',
    resolveRoute: (courseId) => courseId 
      ? `/courses/${encodeURIComponent(courseId)}?tab=forum`
      : '/courses?focus=forum',
  },
  {
    id: 'registration',
    name: 'Course Registration',
    to: '/registration',
    icon: ClipboardCheck,
    badge: 'FOCIT',
    screenNumber: '8',
  },
  {
    id: 'advisor-review',
    name: 'Level Advisor Review',
    to: '/advisor/registrations',
    icon: ShieldCheck,
    badge: 'Advisor',
    screenNumber: '8A',
    advisorOnly: true,
  },
  {
    id: 'admin-portal',
    name: 'Admin Portal',
    to: '/admin',
    icon: ShieldCheck,
    badge: 'Admin',
    screenNumber: 'ADM',
    adminOnly: true,
  },
  {
    id: 'profile',
    name: 'Profile & Settings',
    to: '/profile',
    icon: UserCog,
    badge: null,
    screenNumber: '9',
  },
];

export const Sidebar = ({ 
  isExpanded, 
  onToggle, 
  isMobile = false, 
  onCloseMobile, 
  user, 
  onLogout,
  isExamLocked: propExamLocked = false,
}) => {
  const location = useLocation();
  const { isExamLocked: contextExamLocked } = useExamLock();
  const isExamLocked = Boolean(propExamLocked || contextExamLocked);

  // Extract or retrieve contextual course ID:
  // 1. Direct course route match e.g. /courses/CSC202...
  // 2. Or last viewed course stored in sessionStorage (focit_last_course_id)
  const contextualCourseId = React.useMemo(() => {
    const match = location.pathname.match(/^\/courses\/([^/?#]+)/);
    if (match && match[1] && match[1] !== 'materials' && match[1] !== 'quizzes') {
      const routeCourse = match[1];
      if (routeCourse !== '1') {
        try {
          sessionStorage.setItem('focit_last_course_id', routeCourse);
        } catch {}
        return routeCourse;
      }
    }
    try {
      const saved = sessionStorage.getItem('focit_last_course_id');
      if (saved && saved !== '1') return saved;
    } catch {}
    return null;
  }, [location.pathname]);

  const role = String(user?.role || 'STUDENT').toUpperCase();
  const isAdmin = ['ADMIN', 'SYSTEM_ADMIN'].includes(role);
  const isHod = role === 'HOD';
  const isLecturer = role === 'LECTURER';
  const isAdvisor = ['ADVISOR', 'LEVEL_ADVISOR', 'DEAN', 'STAFF'].includes(role);

  let navItems = [];
  if (isAdmin) {
    navItems = [
      {
        name: 'Admin Control Plane',
        to: '/admin',
        icon: LayoutDashboard,
        badge: 'Admin',
        screenNumber: 'ADM',
      },
      {
        name: 'Registration Clearance',
        to: '/advisor/registrations',
        icon: ShieldCheck,
        badge: 'Senate',
        screenNumber: '8A',
      },
      {
        name: 'User Directory',
        to: '/admin/users',
        icon: Users,
        badge: null,
        screenNumber: 'USR',
      },
      {
        name: 'Moodle Outbox Sync',
        to: '/admin/outbox',
        icon: RefreshCw,
        badge: 'Sync',
        screenNumber: 'OUT',
      },
      {
        name: 'Security Audit Ledger',
        to: '/admin/audit',
        icon: FileText,
        badge: null,
        screenNumber: 'AUD',
      },
      {
        name: 'Profile & Security',
        to: '/admin/profile',
        icon: UserCog,
        badge: null,
        screenNumber: 'PRF',
      },
    ];
  } else if (isHod) {
    navItems = [
      {
        name: 'HOD Dashboard',
        to: '/hod',
        icon: LayoutDashboard,
        badge: 'HOD',
        screenNumber: 'HOD',
      },
      {
        name: 'Lecturer Workspace',
        to: '/lecturer',
        icon: BookOpen,
        badge: 'Faculty',
        screenNumber: 'LEC',
      },
      {
        name: 'Registration Clearance',
        to: '/advisor/registrations',
        icon: ShieldCheck,
        badge: 'Senate',
        screenNumber: '8A',
      },
      {
        name: 'Question Bank & AI',
        to: '/question-bank',
        icon: Sparkles,
        badge: 'AI',
        screenNumber: '5',
      },
      {
        name: 'Profile & Security',
        to: '/admin/profile',
        icon: UserCog,
        badge: null,
        screenNumber: 'PRF',
      },
    ];
  } else if (isLecturer) {
    navItems = [
      {
        name: 'Lecturer Workspace',
        to: '/lecturer',
        icon: BookOpen,
        badge: 'Faculty',
        screenNumber: 'LEC',
      },
      {
        name: 'Question Bank & AI',
        to: '/question-bank',
        icon: Sparkles,
        badge: 'AI',
        screenNumber: '5',
      },
      {
        name: 'Profile & Security',
        to: '/admin/profile',
        icon: UserCog,
        badge: null,
        screenNumber: 'PRF',
      },
    ];
  } else if (isAdvisor) {
    navItems = [
      {
        name: 'Advisor Review',
        to: '/advisor/registrations',
        icon: ShieldCheck,
        badge: 'Advisor',
        screenNumber: '8A',
      },
      {
        name: 'Lecturer Workspace',
        to: '/lecturer',
        icon: BookOpen,
        badge: 'Faculty',
        screenNumber: 'LEC',
      },
      {
        name: 'Question Bank & AI',
        to: '/question-bank',
        icon: Sparkles,
        badge: 'AI',
        screenNumber: '5',
      },
      {
        name: 'Profile & Security',
        to: '/admin/profile',
        icon: UserCog,
        badge: null,
        screenNumber: 'PRF',
      },
    ];
  } else {
    navItems = [
      {
        name: 'Dashboard',
        to: '/dashboard',
        icon: LayoutDashboard,
        badge: null,
        screenNumber: '1',
      },
      {
        name: 'My Courses',
        to: '/courses',
        icon: BookOpen,
        badge: null,
        screenNumber: '2',
      },
      {
        name: 'Digital Library',
        to: '/library',
        icon: Library,
        badge: 'Vault',
        screenNumber: '3',
      },
      {
        name: 'Quiz Assessment',
        to: contextualCourseId 
          ? `/courses/${encodeURIComponent(contextualCourseId)}?tab=quizzes`
          : '/courses?focus=quizzes',
        icon: HelpCircle,
        badge: 'Active',
        screenNumber: '4',
      },
      {
        name: 'Timetable & Calendar',
        to: '/calendar',
        icon: Calendar,
        badge: null,
        screenNumber: '5',
      },
      {
        name: 'Gradebook',
        to: contextualCourseId 
          ? `/courses/${encodeURIComponent(contextualCourseId)}?tab=grades`
          : '/courses?focus=grades',
        icon: Award,
        badge: null,
        screenNumber: '6',
      },
      {
        name: 'Discussion Forum',
        to: contextualCourseId 
          ? `/courses/${encodeURIComponent(contextualCourseId)}?tab=forum`
          : '/courses?focus=forum',
        icon: MessagesSquare,
        badge: null,
        screenNumber: '7',
      },
      {
        name: 'Course Registration',
        to: '/registration',
        icon: ClipboardCheck,
        badge: 'FOCIT',
        screenNumber: '8',
      },
      {
        name: 'Profile & Settings',
        to: '/profile',
        icon: UserCog,
        badge: null,
        screenNumber: '9',
      },
    ];
  }

  const visibleNavItems = navItems;

  const isItemActive = (itemTo) => {
    const [targetPath, targetQuery] = itemTo.split('?');
    if (targetQuery) {
      const targetParams = new URLSearchParams(targetQuery);
      const currentParams = new URLSearchParams(location.search);
      const targetTab = targetParams.get('tab');
      const currentTab = currentParams.get('tab');
      if (targetTab) {
        return location.pathname === targetPath && currentTab === targetTab;
      }
      const targetFocus = targetParams.get('focus');
      const currentFocus = currentParams.get('focus');
      if (targetFocus) {
        return location.pathname === targetPath && currentFocus === targetFocus;
      }
    }
    if (targetPath === '/courses') {
      return location.pathname === '/courses' && !location.search;
    }
    if (targetPath === '/dashboard') {
      return location.pathname === '/dashboard' || location.pathname === '/';
    }
    return location.pathname === targetPath;
  };

  return (
    <div className="flex flex-col h-full bg-[#0a1142] text-white select-none">
      {/* 1. Brand & Crest Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-[#16258f]/40 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <img 
            src="/faculty-logo.jpg" 
            alt="FOCITSA UNIOSUN Logo" 
            className="w-9 h-9 rounded-full object-cover ring-2 ring-[#ffb81c]/60 shadow-md shrink-0" 
          />
          {(isExpanded || isMobile) && (
            <div className="min-w-0 flex flex-col">
              <span className="font-extrabold text-base tracking-tight text-white truncate font-display">
                FOCIT <span className="text-[#ffb81c]">LMS</span>
              </span>
              <span className="text-[10px] text-gray-300 tracking-wider truncate uppercase font-medium">
                UNIOSUN Faculty
              </span>
            </div>
          )}
        </div>

        {/* Desktop Collapse Toggle / Mobile Close Trigger */}
        {isMobile ? (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close Navigation Drawer"
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-label={isExpanded ? 'Collapse Navigation Sidebar' : 'Expand Navigation Sidebar'}
            className="p-1.5 rounded-lg text-gray-300 hover:text-[#ffb81c] hover:bg-white/10 transition-colors hidden md:flex items-center justify-center cursor-pointer"
          >
            {isExpanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        )}
      </div>

      
      {/* Exam In-Progress Navigation Lock Banner */}
      {isExamLocked && (
        <div className="mx-3 mt-3 mb-1 p-2.5 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs flex items-center gap-2 select-none animate-pulse">
          <Lock size={16} className="shrink-0 text-amber-400" />
          {(isExpanded || isMobile) && (
            <div className="min-w-0">
              <p className="font-bold text-[11px] leading-tight text-amber-300">Exam in Progress</p>
              <p className="text-[10px] text-amber-400/80 leading-tight">Navigation Locked</p>
            </div>
          )}
        </div>
      )}

      {/* 2. Navigation Item Stack */}
      <nav 
        aria-label="LMS Primary Navigation" 
        className={`flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden min-h-0 ${isExamLocked ? "opacity-30 pointer-events-none cursor-not-allowed select-none filter grayscale" : ""}`}
      >
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = isItemActive(item.to);
          return (
            <Link
              key={item.name}
              to={isExamLocked ? "#" : item.to}
              onClick={(e) => {
                if (isExamLocked) {
                  e.preventDefault();
                  return;
                }
                if (isMobile && onCloseMobile) {
                  onCloseMobile();
                }
              }}
              tabIndex={isExamLocked ? -1 : 0}
              aria-disabled={isExamLocked ? "true" : undefined}
              title={!isExpanded && !isMobile ? item.name : undefined}
              className={`
                group relative flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-150
                ${isActive 
                  ? 'bg-gradient-to-r from-[#ffb81c] to-[#e5a200] text-[#0a1142] font-semibold shadow-md shadow-[#ffb81c]/20' 
                  : 'text-gray-200 hover:text-white hover:bg-white/10'}
                ${!isExpanded && !isMobile ? 'justify-center px-0' : ''}
              `}
            >
              <Icon 
                size={20} 
                className={`shrink-0 transition-transform duration-150 ${
                  isActive ? 'text-[#0a1142]' : 'text-gray-300 group-hover:text-white'
                }`} 
              />

              {(isExpanded || isMobile) && (
                <div className="flex-1 flex items-center justify-between min-w-0">
                  <span className="truncate">{item.name}</span>
                  {item.badge && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                      isActive 
                        ? 'bg-[#0a1142]/20 text-[#0a1142]' 
                        : item.badge === 'AI' 
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-400/30' 
                          : 'bg-white/15 text-gray-200'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </div>
              )}

              {/* Accessible tooltip for collapsed rail mode */}
              {!isExpanded && !isMobile && (
                <div className="absolute left-full ml-3 px-2.5 py-1 bg-[#040617] text-white text-xs rounded-md shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 border border-white/10">
                  {item.name}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* 3. Session Security & User Info Footer */}
      <div className="p-3 border-t border-[#16258f]/40 bg-[#070c2e]/60 shrink-0">
        {(isExpanded || isMobile) && (
          <div className="px-2 py-2 mb-2 flex items-center justify-between text-xs text-gray-300 bg-white/5 rounded-lg border border-white/5">
            <div className="flex items-center gap-2 truncate">
              <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
              <span className="truncate">{user?.username || user?.matric_number || 'student1'}</span>
            </div>
            <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">
              {['ADMIN', 'SYSTEM_ADMIN'].includes(String(user?.role || '').toUpperCase())
                ? (user?.role === 'SYSTEM_ADMIN' ? 'SysAdmin' : 'Admin')
                : user?.level
                  ? `Level ${user.level}`
                  : (user?.role || 'Level 200')}
            </span>
          </div>
        )}

        <button
          type="button"
          disabled={isExamLocked}
          onClick={isExamLocked ? undefined : onLogout}
          aria-label="Sign Out of Session"
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-red-300 hover:text-red-200 hover:bg-red-500/20 transition-colors cursor-pointer
            ${!isExpanded && !isMobile ? 'justify-center px-0' : ''}
          `}
          title={!isExpanded && !isMobile ? 'Sign Out' : undefined}
        >
          <LogOut size={18} className="shrink-0" />
          {(isExpanded || isMobile) && <span>Sign Out</span>}
        </button>
      </div>
    </div>
  );
};

