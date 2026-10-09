import React, { useState, useEffect } from 'react';
import { Outlet, Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth, AuthState } from '../contexts/AuthContext';
import { Menu, X, Book, LayoutDashboard, LogOut } from 'lucide-react';

export const ProtectedLayout = () => {
  const { status, logout } = useAuth();
  const location = useLocation();
  
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    const saved = localStorage.getItem('focit_sidebar_expanded');
    return saved !== null ? JSON.parse(saved) : true;
  });

  useEffect(() => {
    localStorage.setItem('focit_sidebar_expanded', JSON.stringify(isSidebarOpen));
  }, [isSidebarOpen]);

  if (status === AuthState.UNAUTHENTICATED) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <aside 
        className={`flex flex-col bg-[#0a1142] text-white transition-all duration-300 ${
          isSidebarOpen ? 'w-64' : 'w-20'
        }`}
        aria-label="Main Navigation"
      >
        <div className="flex items-center justify-between p-4 border-b border-white/10 h-16">
          <span className={`font-bold text-[#ffb81c] truncate ${!isSidebarOpen && 'hidden'}`}>
            FOCIT LMS
          </span>
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            aria-expanded={isSidebarOpen}
            aria-controls="sidebar-nav"
            aria-label="Toggle Navigation Sidebar"
            className="p-2 text-white hover:text-[#ffb81c] focus:outline-none focus:ring-2 focus:ring-[#ffb81c] mx-auto"
          >
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav id="sidebar-nav" className="flex-1 px-2 py-4 space-y-2 overflow-y-auto">
          <Link to="/dashboard" className="flex items-center p-2 rounded hover:bg-white/10 text-gray-300 hover:text-white transition-colors">
            <LayoutDashboard size={20} className="shrink-0" />
            <span className={`ml-4 ${!isSidebarOpen && 'hidden'}`}>Dashboard</span>
          </Link>
          <Link to="/courses/1/materials" className="flex items-center p-2 rounded hover:bg-white/10 text-gray-300 hover:text-white transition-colors">
            <Book size={20} className="shrink-0" />
            <span className={`ml-4 ${!isSidebarOpen && 'hidden'}`}>Materials</span>
          </Link>
        </nav>

        <div className="p-2 border-t border-white/10">
          <button
            onClick={logout}
            className="flex items-center w-full p-2 rounded hover:bg-red-500/20 text-gray-300 hover:text-red-400 transition-colors"
            aria-label="Secure Logout"
          >
            <LogOut size={20} className="shrink-0" />
            <span className={`ml-4 ${!isSidebarOpen && 'hidden'}`}>Logout</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto relative">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
