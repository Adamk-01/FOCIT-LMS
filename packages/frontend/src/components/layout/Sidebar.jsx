import React from 'react';
import { NavLink } from 'react-router-dom';
import { 
  LayoutDashboard, 
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
  X
} from 'lucide-react';

export const NAV_ITEMS = [
  {
    name: 'Dashboard',
    to: '/dashboard',
    icon: LayoutDashboard,
    badge: null,
    screenNumber: '1',
  },
  {
    name: 'Course Overview',
    to: '/courses/1',
    icon: BookOpen,
    badge: null,
    screenNumber: '2',
  },
  {
    name: 'Learning Materials',
    to: '/courses/1/materials',
    icon: FileText,
    badge: 'Moodle',
    screenNumber: '3',
  },
  {
    name: 'Quiz Assessment',
    to: '/courses/1/quizzes',
    icon: HelpCircle,
    badge: 'Active',
    screenNumber: '4',
  },
  {
    name: 'Question Bank & AI',
    to: '/lecturer/question-bank',
    icon: Sparkles,
    badge: 'AI',
    screenNumber: '5',
  },
  {
    name: 'Gradebook',
    to: '/courses/1/grades',
    icon: Award,
    badge: null,
    screenNumber: '6',
  },
  {
    name: 'Discussion Forum',
    to: '/courses/1/forum',
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
    name: 'Level Advisor Review',
    to: '/advisor/registrations',
    icon: ShieldCheck,
    badge: 'Advisor',
    screenNumber: '8A',
  },
  {
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
  onLogout 
}) => {
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
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={20} />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-label={isExpanded ? 'Collapse Navigation Sidebar' : 'Expand Navigation Sidebar'}
            className="p-1.5 rounded-lg text-gray-300 hover:text-[#ffb81c] hover:bg-white/10 transition-colors hidden md:flex items-center justify-center"
          >
            {isExpanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        )}
      </div>

      {/* 2. Navigation Item Stack */}
      <nav 
        aria-label="LMS Primary Navigation" 
        className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden min-h-0"
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={isMobile ? onCloseMobile : undefined}
              title={!isExpanded && !isMobile ? item.name : undefined}
              className={({ isActive }) => `
                group relative flex items-center gap-3 px-3 py-2.5 rounded-xl font-medium text-sm transition-all duration-150
                ${isActive 
                  ? 'bg-gradient-to-r from-[#ffb81c] to-[#e5a200] text-[#0a1142] font-semibold shadow-md shadow-[#ffb81c]/20' 
                  : 'text-gray-200 hover:text-white hover:bg-white/10'}
                ${!isExpanded && !isMobile ? 'justify-center px-0' : ''}
              `}
            >
              {({ isActive }) => (
                <>
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
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* 3. Session Security & User Info Footer */}
      <div className="p-3 border-t border-[#16258f]/40 bg-[#070c2e]/60 shrink-0">
        {(isExpanded || isMobile) && (
          <div className="px-2 py-2 mb-2 flex items-center justify-between text-xs text-gray-300 bg-white/5 rounded-lg border border-white/5">
            <div className="flex items-center gap-2 truncate">
              <ShieldCheck size={14} className="text-emerald-400 shrink-0" />
              <span className="truncate">{user?.username || 'student1'}</span>
            </div>
            <span className="text-[10px] text-amber-400 font-semibold uppercase tracking-wider">Level 200</span>
          </div>
        )}

        <button
          type="button"
          onClick={onLogout}
          aria-label="Sign Out of Session"
          className={`
            w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium text-red-300 hover:text-red-200 hover:bg-red-500/20 transition-colors
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
