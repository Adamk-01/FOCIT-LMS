import React, { useState, useRef, useEffect } from 'react';
import { X, Send, RefreshCw, MessageCircle, Clock, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';

/**
 * <ThreadRepliesModal />
 *
 * Fullscreen/Viewport-constrained Discussion Thread & Replies Stream
 * Implements:
 * 1. Thread topic details with author avatar image
 * 2. Hierarchical replies list with peer & faculty avatar propagation
 * 3. Sticky bottom reply composer with mutation lock and validation
 * 4. Dark mode styling
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function ThreadRepliesModal({
  isOpen,
  onClose,
  thread,
  replies = [],
  isLoadingReplies = false,
  onPostReply,
  isPosting = false,
  postError = null,
  courseCode = 'CSC 204',
}) {
  const dialogRef = useRef(null);
  const composerRef = useRef(null);
  const isSubmittingRef = useRef(false);
  const [replyText, setReplyText] = useState('');
  const { user } = useAuth();

  // Fetch current user's avatar for the composer
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

  const currentUserAvatar = profile?.avatar_url || user?.avatar_url;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && thread) {
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
  }, [isOpen, thread]);

  const handleClose = () => {
    if (isPosting || isSubmittingRef.current) return;
    setReplyText('');
    onClose();
  };

  const handleCancel = (e) => {
    if (isPosting || isSubmittingRef.current) {
      e.preventDefault();
      return;
    }
    handleClose();
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = replyText.trim();
    if (!text || isPosting || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    onPostReply(text, () => {
      setReplyText('');
      isSubmittingRef.current = false;
    });
  };

  if (!isOpen || !thread) return null;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-modal="true"
      aria-labelledby="thread-dialog-title"
      className="fixed inset-0 m-auto w-[min(94vw,760px)] h-[min(92dvh,760px)] max-h-[min(92dvh,760px)] flex flex-col p-0 overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-gray-200 dark:border-slate-800 text-inherit backdrop:bg-black/60 backdrop:backdrop-blur-sm animate-fade-in transition-colors"
      style={{ contain: 'layout paint' }}
    >
      {thread && (
        <div className="flex flex-col h-full max-h-[min(92dvh,760px)]">
        {/* 1. Header (flex: 0 0 auto) */}
        <div className="flex-none px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 flex items-center justify-between">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 font-medium">
              <span className="font-bold text-[#0a1142] dark:text-[#ffb81c]">{courseCode}</span>
              <span>•</span>
              <span>Discussion Thread</span>
            </div>
            <h2 id="thread-dialog-title" className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate mt-0.5 font-display">
              {thread.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close discussion thread"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-slate-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* 2. Quarantined Scrollport (flex: 1 1 auto; min-height: 0) */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-6 text-gray-800 dark:text-gray-200 -webkit-overflow-scrolling: touch;">
          {/* Main Original Thread Topic Card */}
          <article className="p-5 rounded-2xl bg-slate-50/90 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/60 space-y-4">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#0a1142] text-[#ffb81c] font-bold text-xs flex items-center justify-center overflow-hidden ring-2 ring-[#ffb81c]/50 shrink-0">
                  {thread.author?.avatarUrl ? (
                    <img src={thread.author.avatarUrl} alt={thread.author.name} className="w-full h-full object-cover" />
                  ) : (
                    thread.author?.initials || 'ST'
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-1.5 font-bold text-gray-900 dark:text-white">
                    <span>{thread.author?.name || 'Anonymous Student'}</span>
                    {thread.author?.role === 'LECTURER' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#0a1142] text-[#ffb81c] dark:bg-[#ffb81c] dark:text-[#0a1142]">
                        FACULTY
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    Topic Creator
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1 text-gray-400 text-xs shrink-0">
                <Clock size={12} />
                <span>{new Date(thread.createdAt || thread.lastPostAt).toLocaleString()}</span>
              </div>
            </div>

            <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-line">
              {thread.body}
            </p>
          </article>

          {/* Section Divider */}
          <div className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-slate-800">
            <MessageCircle size={16} className="text-[#0a1142] dark:text-[#ffb81c]" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300">
              Peer & Faculty Replies ({replies.length})
            </h3>
          </div>

          {/* Error Banner */}
          {postError && (
            <div role="alert" className="p-3.5 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300 font-medium">
              {postError}
            </div>
          )}

          {/* Replies Stream */}
          {isLoadingReplies ? (
            <div className="py-8 flex flex-col items-center justify-center gap-2 text-gray-400">
              <RefreshCw size={24} className="animate-spin text-[#0a1142] dark:text-[#ffb81c]" />
              <span className="text-xs">Loading discussion replies...</span>
            </div>
          ) : replies.length === 0 ? (
            <div className="p-8 text-center rounded-xl bg-slate-50/50 dark:bg-slate-800/20 border border-dashed border-gray-200 dark:border-slate-700 space-y-1">
              <p className="text-xs font-bold text-gray-600 dark:text-gray-300">No replies posted yet</p>
              <p className="text-[11px] text-gray-400">Be the first to share your thoughts or provide an answer.</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {replies.map((reply) => (
                <div
                  key={reply.id}
                  className="p-4 rounded-xl bg-white dark:bg-slate-800/80 border border-gray-200/80 dark:border-slate-700/60 shadow-xs space-y-2.5 transition-colors"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#0a1142] text-[#ffb81c] font-bold text-[10px] flex items-center justify-center overflow-hidden ring-1 ring-gray-200 dark:ring-slate-700 shrink-0">
                        {reply.author?.avatarUrl ? (
                          <img src={reply.author.avatarUrl} alt={reply.author.name} className="w-full h-full object-cover" />
                        ) : (
                          reply.author?.initials || 'ST'
                        )}
                      </div>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {reply.author?.name}
                      </span>
                      {reply.author?.role === 'LECTURER' && (
                        <span className="px-2 py-0.2 rounded-full text-[9px] font-extrabold bg-[#0a1142] text-[#ffb81c] dark:bg-[#ffb81c] dark:text-[#0a1142]">
                          FACULTY
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-gray-400">
                      {new Date(reply.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-gray-700 dark:text-gray-300 leading-relaxed pl-8 whitespace-pre-line">
                    {reply.body}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 3. Docked Sticky Composer Footer (flex: 0 0 auto; sticky bottom-0) */}
        <form
          onSubmit={handleSubmit}
          className="flex-none p-4 sm:p-5 border-t border-gray-100 dark:border-slate-800 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur-md sticky bottom-0 z-10 flex items-start gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.03)] pb-[calc(1rem+env(safe-area-inset-bottom,0px))]"
        >
          {/* Current Student Avatar */}
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#0a1142] to-[#16258f] text-[#ffb81c] font-bold text-xs flex items-center justify-center overflow-hidden ring-2 ring-[#ffb81c]/50 shrink-0 mt-1">
            {currentUserAvatar ? (
              <img src={currentUserAvatar} alt="My Avatar" className="w-full h-full object-cover" />
            ) : (
              user?.username ? user.username.slice(0, 2).toUpperCase() : 'ME'
            )}
          </div>

          <div className="flex-1 min-w-0">
            <textarea
              ref={composerRef}
              rows={2}
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Contribute your reply to this discussion topic..."
              className="w-full rounded-xl border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3.5 py-2 text-xs sm:text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:border-[#0a1142] dark:focus:border-[#ffb81c] focus:outline-none resize-none transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={isPosting || !replyText.trim()}
            className="min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl bg-[#0a1142] dark:bg-[#ffb81c] text-white dark:text-[#0a1142] font-bold text-xs flex items-center justify-center gap-1.5 shadow-md hover:bg-[#16258f] dark:hover:bg-[#ffd060] transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {isPosting ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <>
                <Send size={15} />
                <span className="hidden sm:inline">Reply</span>
              </>
            )}
          </button>
        </form>
      </div>
    )}
  </dialog>
);
}

export default ThreadRepliesModal;
