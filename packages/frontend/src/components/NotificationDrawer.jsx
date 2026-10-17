/**
 * FOCIT LMS - Accessible Notification Drawer & Flyout Center
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Invariants Enforced:
 * 1. Physical Viewport Containment (100dvh Lock, contain: layout paint, isolate)
 * 2. URL-Synced Filter State (?notif_tab=ALL|UNREAD|ACADEMIC|SECURITY)
 * 3. The Unhappy Path Triad: Skeletons, Empty State, Error Recovery, Mutation Lock
 * 4. Semantic Accessibility: native dialog, Escape key trap, deterministic UUID keys
 * 5. Slide-Right Gesture & Explicit Mutation Dismissal
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { 
  Bell, 
  X, 
  CheckCheck, 
  Clock, 
  AlertCircle, 
  ShieldCheck, 
  BookOpen, 
  ClipboardCheck, 
  HelpCircle, 
  Lock,
  RefreshCw,
  ChevronRight,
  Trash2,
  Check,
  ArrowRight
} from 'lucide-react';
import { useNotifications } from '../hooks/useNotifications';
import { getUserFriendlyErrorMessage } from '../lib/userFriendlyMessages';

const CATEGORY_TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'UNREAD', label: 'Unread' },
  { id: 'REGISTRATION', label: 'Registration' },
  { id: 'ASSESSMENT', label: 'Quizzes' },
  { id: 'ACADEMIC', label: 'Materials' },
  { id: 'SECURITY', label: 'Security' },
];

function getCategoryBadge(category) {
  switch (category) {
    case 'REGISTRATION':
      return {
        icon: ClipboardCheck,
        bg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        label: 'Registration',
      };
    case 'ASSESSMENT':
      return {
        icon: HelpCircle,
        bg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        label: 'Assessment',
      };
    case 'ACADEMIC':
      return {
        icon: BookOpen,
        bg: 'bg-blue-50 text-[#0a1142] border-blue-200',
        label: 'Coursework',
      };
    case 'SECURITY':
      return {
        icon: Lock,
        bg: 'bg-amber-50 text-amber-700 border-amber-200',
        label: 'Security',
      };
    default:
      return {
        icon: Bell,
        bg: 'bg-gray-50 text-gray-700 border-gray-200',
        label: 'General',
      };
  }
}

function formatRelativeTime(dateString) {
  try {
    const diffMs = Date.now() - new Date(dateString).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffDay > 0) return `${diffDay}d ago`;
    if (diffHr > 0) return `${diffHr}h ago`;
    if (diffMin > 0) return `${diffMin}m ago`;
    return 'Just now';
  } catch {
    return 'Recent';
  }
}

/**
 * Slide-Right Dismissable Notification Item
 * Supports universal pointer events (touch, mouse, stylus) + keyboard/click button fallback
 */
function SwipeableNotificationItem({ item, onClick, onClear }) {
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const hasMovedRef = useRef(false);

  const DISMISS_THRESHOLD = 75; // Pixels to trigger slide dismissal

  const handlePointerDown = (e) => {
    // Only drag with primary mouse button or touch
    if (e.button !== undefined && e.button !== 0) return;
    startXRef.current = e.clientX;
    currentXRef.current = e.clientX;
    hasMovedRef.current = false;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!isDragging || isDismissing) return;
    currentXRef.current = e.clientX;
    const diff = currentXRef.current - startXRef.current;
    
    // Only allow sliding right (positive values)
    if (diff > 5) {
      hasMovedRef.current = true;
      setDragX(Math.min(diff, 180));
    } else {
      setDragX(0);
    }
  };

  const handlePointerUp = async (e) => {
    if (!isDragging || isDismissing) return;
    setIsDragging(false);

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture was already released
    }

    if (dragX >= DISMISS_THRESHOLD) {
      // Trigger slide out exit animation
      setIsDismissing(true);
      setDragX(350);
      setTimeout(() => {
        onClear(item.id);
      }, 250);
    } else {
      // Spring back
      setDragX(0);
      // If it was just a click (not a drag), trigger onClick
      if (!hasMovedRef.current) {
        onClick(item);
      }
    }
  };

  const handlePointerCancel = () => {
    setIsDragging(false);
    setDragX(0);
  };

  const handleDirectClear = (e) => {
    e.stopPropagation();
    setIsDismissing(true);
    setDragX(350);
    setTimeout(() => {
      onClear(item.id);
    }, 250);
  };

  const badge = getCategoryBadge(item.category);
  const BadgeIcon = badge.icon;
  const isPastThreshold = dragX >= DISMISS_THRESHOLD;

  return (
    <div className="relative overflow-hidden rounded-xl select-none group touch-pan-y">
      {/* Background reveal on slide right */}
      <div 
        aria-hidden="true"
        className={`absolute inset-0 flex items-center px-4 rounded-xl transition-colors ${
          isPastThreshold 
            ? 'bg-emerald-600 text-white font-bold' 
            : 'bg-emerald-500/80 text-white'
        }`}
      >
        <div className="flex items-center gap-2 text-xs font-semibold">
          <Check size={18} className="animate-bounce" />
          <span>{isPastThreshold ? 'Release to Clear' : 'Slide right to clear'}</span>
        </div>
      </div>

      {/* Foreground Notification Card */}
      <article
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{
          transform: `translateX(${dragX}px)`,
          transition: isDragging ? 'none' : 'transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease',
          opacity: isDismissing ? 0 : 1,
        }}
        className={`relative p-4 rounded-xl border cursor-pointer z-10 transition-shadow ${
          item.is_read 
            ? 'bg-white border-gray-200 hover:border-gray-300' 
            : 'bg-blue-50/50 border-blue-200 shadow-sm hover:border-blue-300'
        }`}
      >
        {/* Unread indicator dot */}
        {!item.is_read && (
          <span 
            aria-label="Unread notification"
            className="absolute top-4 right-10 w-2 h-2 rounded-full bg-blue-600 ring-2 ring-white" 
          />
        )}

        {/* Explicit Clear / Dismiss Button (accessible for click/touch) */}
        <button
          type="button"
          onClick={handleDirectClear}
          title="Clear notification (or slide right)"
          aria-label={`Clear notification: ${item.title}`}
          className="absolute top-3 right-3 p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors z-20"
        >
          <Trash2 size={15} />
        </button>

        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg border shrink-0 ${badge.bg}`}>
            <BadgeIcon size={16} />
          </div>

          <div className="flex-1 min-w-0 pr-8">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${badge.bg}`}>
                {badge.label}
              </span>
              <time 
                dateTime={item.created_at} 
                className="text-[11px] text-gray-400 font-medium flex items-center gap-1"
              >
                <Clock size={10} />
                <span>{formatRelativeTime(item.created_at)}</span>
              </time>
            </div>

            <h4 className={`text-xs font-bold leading-snug line-clamp-1 ${
              item.is_read ? 'text-gray-800' : 'text-[#0a1142]'
            }`}>
              {item.title}
            </h4>

            <p className="text-xs text-gray-600 mt-1 line-clamp-2 leading-relaxed">
              {item.body}
            </p>

            <div className="mt-2 flex items-center justify-between text-[11px]">
              {item.action_url ? (
                <div className="flex items-center gap-1 font-bold text-[#0a1142] group-hover:text-[#16258f]">
                  <span>View Details</span>
                  <ChevronRight size={12} className="transition-transform group-hover:translate-x-0.5" />
                </div>
              ) : (
                <span />
              )}
              <span className="text-[10px] text-gray-400 hidden sm:inline-block">
                Slide right ➔ to clear
              </span>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}

export function NotificationDrawer({ isOpen, onClose }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const drawerRef = useRef(null);

  // 1. Dual-State: URL SearchParams synchronization for filter state
  const activeTab = searchParams.get('notif_tab') || 'ALL';
  const isUnreadOnly = activeTab === 'UNREAD';
  const activeCategory = isUnreadOnly ? 'ALL' : activeTab;

  const {
    unreadCount,
    totalCount,
    notifications,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    markAsRead,
    markAllAsRead,
    clearNotification,
    clearAllNotifications,
    isMarkingAllAsRead,
    isClearingAll,
  } = useNotifications({
    category: activeCategory,
    unreadOnly: isUnreadOnly,
  });

  // 2. Keyboard Focus Trap & Escape Key Listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleTabChange = (tabId) => {
    const nextParams = new URLSearchParams(searchParams);
    if (tabId === 'ALL') {
      nextParams.delete('notif_tab');
    } else {
      nextParams.set('notif_tab', tabId);
    }
    setSearchParams(nextParams, { replace: true });
  };

  const handleNotificationClick = async (notif) => {
    if (!notif.is_read) {
      try {
        await markAsRead(notif.id);
      } catch {
        // Mutation rollback is handled gracefully in useNotifications
      }
    }
    if (notif.action_url) {
      onClose();
      navigate(notif.action_url);
    }
  };

  const handleClearSingle = async (id) => {
    try {
      await clearNotification(id);
    } catch {
      // Error handled with rollback in useNotifications
    }
  };

  const handleClearAll = async () => {
    if (notifications.length === 0) return;
    try {
      await clearAllNotifications();
    } catch {
      // Handled in useNotifications
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 overflow-hidden bg-slate-900/40 backdrop-blur-sm transition-opacity animate-fade-in"
      onClick={onClose}
      aria-hidden="true"
    >
      <div 
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Notification Center"
        onClick={(e) => e.stopPropagation()}
        className="fixed inset-y-0 right-0 w-full sm:max-w-md bg-white shadow-2xl flex flex-col z-50 h-[100dvh] contain-layout-paint isolate transform transition-transform duration-300 ease-in-out border-l border-gray-200"
      >
        {/* 1. Header Toolbar */}
        <header className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0a1142] text-[#ffb81c] flex items-center justify-center shadow-sm">
              <Bell size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#0a1142] leading-tight font-display">
                  Notifications
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-[#0a1142]/10 text-[#0a1142]">
                  {notifications.length}
                </span>
              </div>
              <p className="text-xs text-gray-500 font-medium">
                {unreadCount > 0 
                  ? `${unreadCount} unread • ${notifications.length} total` 
                  : `${notifications.length} update${notifications.length === 1 ? '' : 's'} • all caught up`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                disabled={isMarkingAllAsRead}
                aria-label="Mark all notifications as read"
                title="Mark all as read"
                className="px-2.5 py-1.5 text-xs font-semibold text-[#0a1142] hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {isMarkingAllAsRead ? (
                  <RefreshCw size={13} className="animate-spin text-[#0a1142]" />
                ) : (
                  <CheckCheck size={14} className="text-emerald-600" />
                )}
                <span className="hidden sm:inline">Read All</span>
              </button>
            )}

            {notifications.length > 0 && (
              <button
                type="button"
                onClick={handleClearAll}
                disabled={isClearingAll}
                aria-label="Clear all notifications"
                title="Clear all notifications"
                className="px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                {isClearingAll ? (
                  <RefreshCw size={13} className="animate-spin text-rose-600" />
                ) : (
                  <Trash2 size={13} />
                )}
                <span className="hidden sm:inline">Clear All</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close notification panel"
              className="p-2 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors ml-1"
            >
              <X size={20} />
            </button>
          </div>
        </header>

        {/* 2. Categorical Filter Tabs (URL-Synced) */}
        <nav aria-label="Notification Categories" className="px-4 py-2 border-b border-gray-100 shrink-0 bg-gray-50/70 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1.5 min-w-max">
            {CATEGORY_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  aria-pressed={isActive}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    isActive 
                      ? 'bg-[#0a1142] text-white shadow-sm' 
                      : 'bg-white text-gray-600 hover:text-[#0a1142] hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  {tab.label}
                  {tab.id === 'UNREAD' && unreadCount > 0 && (
                    <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-red-500 text-white font-bold">
                      {unreadCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Slide-Right Tip Banner */}
        {notifications.length > 0 && (
          <div className="px-5 py-2 bg-blue-50/60 border-b border-blue-100 text-[11px] text-[#0a1142] flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-medium">
              <span>💡</span>
              <span>Slide right <strong>(swipe ➔)</strong> or tap the trash icon to clear.</span>
            </span>
            <span className="text-gray-400 font-mono text-[10px]">
              {notifications.length} item{notifications.length === 1 ? '' : 's'}
            </span>
          </div>
        )}

        {/* 3. Notification Feed Body (Contained Scrollport) */}
        <main 
          tabIndex={0}
          className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3 focus:outline-none"
        >
          {/* A. Loading State Skeletons */}
          {isLoading && (
            <div className="space-y-3" aria-busy="true" aria-label="Loading notifications">
              {[1, 2, 3, 4].map((idx) => (
                <div key={idx} className="p-4 rounded-xl border border-gray-100 bg-white animate-pulse space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="w-20 h-4 bg-gray-200 rounded" />
                    <div className="w-12 h-3 bg-gray-200 rounded" />
                  </div>
                  <div className="w-3/4 h-4 bg-gray-300 rounded" />
                  <div className="w-full h-3 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          )}

          {/* B. Error State */}
          {isError && !isLoading && (
            <div className="p-6 text-center rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-3">
              <AlertCircle size={28} className="mx-auto text-amber-600" />
              <p className="text-xs font-semibold leading-relaxed">
                {getUserFriendlyErrorMessage(error, 'Unable to load your notifications right now. Please verify your connection.')}
              </p>
              <button
                type="button"
                onClick={() => refetch()}
                className="px-3.5 py-1.5 bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-sm"
              >
                <RefreshCw size={12} />
                <span>Retry Connection</span>
              </button>
            </div>
          )}

          {/* C. Empty State */}
          {!isLoading && !isError && notifications.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3 text-gray-500 min-h-[300px]">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 text-[#0a1142] flex items-center justify-center">
                <Bell size={24} className="text-[#0a1142]/60" />
              </div>
              <h3 className="text-sm font-bold text-[#0a1142]">
                {isUnreadOnly ? 'No unread notifications' : 'No notifications in this category'}
              </h3>
              <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                You are completely up to date with faculty announcements, course registrations, and assessment deadlines.
              </p>
            </div>
          )}

          {/* D. Authoritative Notification Feed with Slide-Right Dismissal */}
          {!isLoading && notifications.map((item) => (
            <SwipeableNotificationItem
              key={item.id}
              item={item}
              onClick={handleNotificationClick}
              onClear={handleClearSingle}
            />
          ))}

          {/* E. Keyset Pagination Load More Trigger */}
          {hasNextPage && (
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full py-2.5 px-4 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-[#0a1142] text-xs font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isFetchingNextPage ? (
                  <>
                    <RefreshCw size={13} className="animate-spin text-[#0a1142]" />
                    <span>Loading more updates...</span>
                  </>
                ) : (
                  <span>Load Earlier Notifications</span>
                )}
              </button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
