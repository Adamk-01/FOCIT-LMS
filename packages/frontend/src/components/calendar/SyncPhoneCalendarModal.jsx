import React, { useState, useRef, useEffect } from 'react';
import { X, Calendar, Smartphone, RefreshCw, Copy, Check, ExternalLink, ShieldCheck, AlertCircle, Trash2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

/**
 * <SyncPhoneCalendarModal />
 *
 * Implements:
 * 1. Native HTML <dialog> top layer with strict CSS layout containment
 * 2. Status inspection: Checks if student holds an active calendar subscription token
 * 3. Explicit student action to mint or rotate capability tokens (Single-Active-Token invariant)
 * 4. 1-Tap webcal:// launch for Apple Calendar / Google Calendar / Outlook
 * 5. Clipboard copy with confirmed visual feedback
 * 6. Revocation action to terminate feed access
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function SyncPhoneCalendarModal({ isOpen, onClose }) {
  const dialogRef = useRef(null);
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [feedUrls, setFeedUrls] = useState(null);

  // Manage native dialog open/close lifecycle
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        try {
          dialog.showModal();
        } catch (_) {}
      }
    } else if (dialog.open) {
      try {
        dialog.close();
      } catch (_) {}
    }
  }, [isOpen]);

  // 1. Fetch Subscription Status (Read-Only)
  const { data: status, isLoading: isLoadingStatus } = useQuery({
    queryKey: ['timetable-subscription-status'],
    queryFn: async () => {
      const res = await apiClient.get('/student/timetable/status');
      return res.data;
    },
    enabled: isOpen,
    staleTime: 30 * 1000,
  });

  // 2. Mint or Rotate Token Mutation
  const tokenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/student/timetable/token');
      return res.data;
    },
    onSuccess: (data) => {
      setFeedUrls(data);
      queryClient.invalidateQueries({ queryKey: ['timetable-subscription-status'] });
    },
  });

  // 3. Revoke Token Mutation
  const revokeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.delete('/student/timetable/token');
      return res.data;
    },
    onSuccess: () => {
      setFeedUrls(null);
      queryClient.invalidateQueries({ queryKey: ['timetable-subscription-status'] });
    },
  });

  const handleCopy = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
  };

  const handleClose = () => {
    if (tokenMutation.isPending || revokeMutation.isPending) return;
    onClose();
  };

  if (!isOpen) return null;

  const hasActive = status?.hasActiveSubscription;
  const isPending = tokenMutation.isPending || revokeMutation.isPending;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleClose}
      aria-modal="true"
      aria-labelledby="sync-calendar-title"
      className="fixed inset-0 m-auto w-[min(94vw,620px)] max-h-[min(92dvh,700px)] flex flex-col p-0 overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-gray-200 dark:border-slate-800 text-inherit backdrop:bg-slate-900/60 backdrop:backdrop-blur-xs animate-fade-in transition-colors"
      style={{ contain: 'layout paint' }}
    >
      <div className="flex flex-col h-full max-h-[min(92dvh,700px)]">
        {/* Header (flex-none) */}
        <div className="flex-none px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0a1142] dark:bg-[#ffb81c] text-[#ffb81c] dark:text-[#0a1142] flex items-center justify-center shadow-sm">
              <Smartphone size={20} />
            </div>
            <div>
              <h2 id="sync-calendar-title" className="text-base sm:text-lg font-bold text-gray-900 dark:text-white font-display">
                Sync Timetable with Phone
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Native Apple Calendar, Google Calendar & Outlook integration
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close sync modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Body (flex-1 min-h-0) */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-5 text-gray-800 dark:text-gray-200 -webkit-overflow-scrolling: touch;">
          {/* Feature Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 space-y-1">
              <span className="font-bold text-[#0a1142] dark:text-[#ffb81c] flex items-center gap-1.5">
                <ShieldCheck size={14} /> 15-Minute Lock-Screen Alert
              </span>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                Your phone will automatically alert you 15 minutes before every lecture begins.
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 space-y-1">
              <span className="font-bold text-[#0a1142] dark:text-[#ffb81c] flex items-center gap-1.5">
                <Calendar size={14} /> Dynamic Enrollment Sync
              </span>
              <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                When you add or drop courses, your phone calendar updates automatically in the background.
              </p>
            </div>
          </div>

          {/* Active Subscription Banner */}
          {hasActive && !feedUrls && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-300">
                <ShieldCheck size={16} className="text-emerald-600 dark:text-emerald-400" />
                <span>Active Subscription Feed Connected</span>
              </div>
              <p className="text-xs text-emerald-800/80 dark:text-emerald-400/90 leading-relaxed">
                Your phone calendar is already subscribed and receiving automated lecture updates.
                {status.lastAccessedAt && (
                  <span className="block mt-1 text-[11px] text-emerald-700 dark:text-emerald-400/70">
                    Last synced by your device: {new Date(status.lastAccessedAt).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
          )}

          {/* Minted Feed URL Display */}
          {feedUrls && (
            <div className="space-y-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
              <label className="block text-xs font-bold text-gray-700 dark:text-gray-300">
                Your Personal iCalendar (.ics) Feed URL:
              </label>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={feedUrls.webcalUrl}
                  className="flex-1 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono text-gray-800 dark:text-gray-200 select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(feedUrls.webcalUrl)}
                  title="Copy Feed URL"
                  className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-gray-700 dark:text-gray-200 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
                >
                  {copied ? <Check size={15} className="text-emerald-500" /> : <Copy size={15} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              {/* Direct 1-Tap Subscribe Button */}
              <a
                href={feedUrls.webcalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0a1142] dark:bg-[#ffb81c] text-white dark:text-[#0a1142] font-bold text-xs flex items-center justify-center gap-2 shadow-md hover:bg-[#16258f] dark:hover:bg-[#ffd060] transition-all"
              >
                <ExternalLink size={16} />
                <span>Open in Calendar App (1-Tap Subscribe)</span>
              </a>
            </div>
          )}

          {/* Action Trigger Section */}
          <div className="pt-2 border-t border-gray-100 dark:border-slate-800 space-y-3">
            <button
              type="button"
              disabled={isPending}
              onClick={() => tokenMutation.mutate()}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0a1142] dark:bg-[#ffb81c] text-white dark:text-[#0a1142] font-bold text-xs flex items-center justify-center gap-2 shadow-md hover:bg-[#16258f] dark:hover:bg-[#ffd060] transition-all disabled:opacity-50"
            >
              {tokenMutation.isPending ? (
                <RefreshCw size={16} className="animate-spin" />
              ) : hasActive ? (
                <>
                  <RefreshCw size={16} />
                  <span>Rotate & Generate New Feed URL</span>
                </>
              ) : (
                <>
                  <Calendar size={16} />
                  <span>Generate Calendar Subscription Feed</span>
                </>
              )}
            </button>

            {hasActive && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  if (confirm('Revoke this calendar subscription? Your phone calendar will stop receiving updates.')) {
                    revokeMutation.mutate();
                  }
                }}
                className="w-full min-h-[44px] px-4 py-2 rounded-xl text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} />
                <span>Revoke Active Subscription</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

export default SyncPhoneCalendarModal;
