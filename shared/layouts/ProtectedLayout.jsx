import React, { useState, useEffect } from 'react';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import { useAuth, AuthState } from '../contexts/AuthContext';
import { Sidebar } from '../components/layout/Sidebar';
import { Topbar } from '../components/layout/Topbar';
import { QuarantineBoundary } from '../components/QuarantineBoundary';

/**
 * Mathematically Rigid Protected Layout Shell
 *
 * Enforces:
 * - 100dvh root viewport lock (eliminates mobile browser chrome oscillation)
 * - Zero CLS layout stability with isolated scrollport in <main>
 * - min-w-0 flex container to prevent wide tables (e.g. Gradebook) from blowing out the viewport
 * - Desktop collapsible rail + Mobile GPU-composited drawer with accessibility modal trapping
 */
export const ProtectedLayout = () => {
  const { status, user, logout } = useAuth();
  const location = useLocation();

  // Desktop rail expansion state (persisted across sessions)
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem('focit_sidebar_expanded');
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  // Mobile drawer state (ephemeral overlay)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('focit_sidebar_expanded', JSON.stringify(isSidebarExpanded));
    } catch {
      // Defensive fallback against storage quota/private browsing issues
    }
  }, [isSidebarExpanded]);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileDrawerOpen(false);
  }, [location.pathname]);

  // Handle escape key to close mobile drawer
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isMobileDrawerOpen) {
        setIsMobileDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMobileDrawerOpen]);

  // Render Institutional Quarantine Boundary if session revocation failed
  if (status === AuthState.QUARANTINED) {
    return <QuarantineBoundary />;
  }

  // Redirect to login if unauthenticated
  if (status === AuthState.UNAUTHENTICATED) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Quarantined session enforcement (mandatory password reset before accessing any academic tools)
  const isQuarantined = user?.scope === 'RESET_ONLY' || user?.mustChangePassword;
  const role = String(user?.role || '').toUpperCase();
  const isStaff = ['ADMIN', 'SYSTEM_ADMIN', 'LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF', 'LECTURER'].includes(role);
  const targetPath = isStaff ? '/admin/profile' : '/profile';
  if (isQuarantined && location.pathname !== targetPath) {
    return <Navigate to={isStaff ? '/admin/profile' : '/profile?tab=security'} replace />;
  }

  return (
    <div className="flex h-screen h-[100dvh] w-screen overflow-hidden bg-[#f8fafc]">
      {/* 1. Desktop Fixed-Position Rail Sidebar */}
      <aside 
        className={`hidden md:flex flex-col bg-[#0a1142] text-white shrink-0 transition-all duration-200 ease-in-out border-r border-[#16258f]/40 z-30 select-none ${
          isSidebarExpanded ? 'w-64' : 'w-20'
        }`}
        aria-label="Desktop Navigation"
      >
        <Sidebar 
          isExpanded={isSidebarExpanded}
          onToggle={() => setIsSidebarExpanded((prev) => !prev)}
          user={user}
          onLogout={logout}
        />
      </aside>

      {/* 2. Mobile Drawer Navigation Overlay */}
      {/* Accessible Backdrop */}
      <div 
        className={`fixed inset-0 bg-[#040617]/70 backdrop-blur-sm z-40 transition-opacity duration-200 md:hidden ${
          isMobileDrawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsMobileDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile Drawer Panel (GPU composited transform) */}
      <aside 
        role="dialog"
        aria-modal="true"
        aria-label="Mobile Navigation Drawer"
        className={`fixed inset-y-0 left-0 w-72 max-w-[85vw] bg-[#0a1142] text-white z-50 flex flex-col shadow-2xl transition-transform duration-200 ease-in-out md:hidden ${
          isMobileDrawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar 
          isExpanded={true}
          isMobile={true}
          onCloseMobile={() => setIsMobileDrawerOpen(false)}
          user={user}
          onLogout={logout}
        />
      </aside>

      {/* 3. Mathematical Workspace Plane (flex-col, min-w-0 anti-blowout) */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Topbar: Fixed 64px height invariant (flex-shrink: 0) */}
        <Topbar 
          onOpenMobileDrawer={() => setIsMobileDrawerOpen(true)}
          user={user}
        />

        {/* Main Content Area: Isolated Independent Scrollport */}
        <main 
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 overscroll-y-contain focus:outline-none bg-[#f8fafc]"

        >
          <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
};
