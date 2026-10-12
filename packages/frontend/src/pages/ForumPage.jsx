import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  MessagesSquare, 
  ChevronRight, 
  Plus, 
  Search, 
  Clock, 
  MessageCircle, 
  AlertCircle, 
  RefreshCw, 
  Send
} from 'lucide-react';
import { apiClient } from '../lib/api';

export const ForumPage = () => {
  const { courseId = 'CSC204' } = useParams();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [showNewTopicModal, setShowNewTopicModal] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicBody, setNewTopicBody] = useState('');

  // 1. Fetch Course Discussion Threads
  const { 
    data: forumData, 
    isLoading, 
    error, 
    refetch 
  } = useQuery({
    queryKey: ['course-forum', courseId],
    queryFn: async () => {
      const res = await apiClient.get(`/courses/${courseId}/forum`);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const threads = forumData?.threads || [];
  const courseCode = forumData?.courseCode || 'CSC 204';
  const courseTitle = forumData?.courseTitle || 'Data Structures and Algorithms';

  // Filter threads by search term
  const filteredThreads = threads.filter((t) => 
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.author.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 2. Mutation for creating a new topic with anti-spam defense
  const createTopicMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/courses/${courseId}/forum/threads`, {
        title: newTopicTitle,
        body: newTopicBody,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-forum', courseId] });
      setNewTopicTitle('');
      setNewTopicBody('');
      setShowNewTopicModal(false);
    },
  });

  const isPosting = createTopicMutation.isPending;

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] mx-auto" />
        <p className="text-gray-600 font-medium">Synchronizing forum discussions with Moodle...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-8 bg-red-50 border border-red-200 rounded-2xl text-center space-y-4">
        <AlertCircle size={40} className="text-red-600 mx-auto" />
        <h2 className="text-lg font-bold text-red-900">Discussion Forum Unavailable</h2>
        <p className="text-sm text-red-700">
          {error?.response?.data?.error || 'A network error occurred while loading course discussions.'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="px-5 py-2.5 bg-[#0a1142] text-white rounded-xl text-xs font-bold"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* 1. Dynamic Breadcrumbs (Screen 7 in ui_template.jpeg) */}
      <nav aria-label="Breadcrumb Navigation" className="text-xs font-semibold text-gray-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">
              Dashboard
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" />
          <li>
            <Link to={`/courses/${courseId}`} className="hover:text-[#0a1142] transition-colors">
              {courseCode}
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" />
          <li className="text-[#0a1142] font-bold" aria-current="page">
            Discussion Forum
          </li>
        </ol>
      </nav>

      {/* 2. Top Banner Header (Screen 7 in template) */}
      <header className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#0a1142] border border-[#ffb81c]/30">
            <MessagesSquare size={14} className="text-[#0a1142]" />
            <span>STUDENT & FACULTY ACADEMIC DISCOURSE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#0a1142] font-display">
            Discussion Forum: {courseCode} — {courseTitle}
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 font-medium">
            Collaborate on algorithmic derivations, lab exercises, and assessment questions.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowNewTopicModal(true)}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition-all shrink-0"
        >
          <Plus size={16} className="text-[#ffb81c]" />
          <span>Add a new discussion topic</span>
        </button>
      </header>

      {/* 3. Search & Filter Bar */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search discussions, topics, or authors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:bg-white transition-all"
          />
        </div>

        <div className="text-xs text-gray-500 font-medium">
          Showing <span className="font-bold text-[#0a1142]">{filteredThreads.length}</span> topics
        </div>
      </div>

      {/* 4. Discussion Thread List (Screen 7 in ui_template.jpeg) */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-card overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#0a1142] font-display">
            Active Discussion Topics
          </h2>
          <span className="text-xs text-gray-500 font-medium">
            Synchronized with Headless Moodle Forum Core
          </span>
        </div>

        {filteredThreads.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <MessagesSquare size={36} className="text-gray-300 mx-auto" />
            <p className="text-sm font-semibold text-gray-700">No discussion topics found</p>
            <p className="text-xs text-gray-500">Be the first to start an academic discussion in this module.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredThreads.map((thread) => (
              <article 
                key={thread.id} 
                className="p-6 hover:bg-gray-50/70 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <h3 className="text-base font-bold text-[#0a1142] hover:text-[#16258f] transition-colors truncate">
                    {thread.title}
                  </h3>
                  <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                    {thread.body}
                  </p>

                  <div className="flex items-center gap-3 pt-1 text-xs text-gray-500 font-medium">
                    {/* Author Avatar Pill */}
                    <div className="inline-flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-full bg-[#0a1142] text-[#ffb81c] font-bold text-[10px] flex items-center justify-center">
                        {thread.author.initials}
                      </div>
                      <span className="text-gray-800 font-semibold">{thread.author.name}</span>
                      {thread.author.role === 'LECTURER' && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-[#0a1142] text-[#ffb81c]">
                          FACULTY
                        </span>
                      )}
                    </div>

                    <span>•</span>
                    <span className="flex items-center gap-1">
                      <Clock size={12} className="text-gray-400" />
                      <span>{new Date(thread.lastPostAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                  </div>
                </div>

                {/* Reply Counter Badge */}
                <div className="flex sm:flex-col items-center justify-between sm:justify-center gap-2 sm:gap-1 shrink-0 min-w-[80px] bg-gray-50 p-2.5 sm:p-3 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#0a1142]">
                    <MessageCircle size={14} className="text-[#0a1142]" />
                    <span>{thread.repliesCount}</span>
                  </div>
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
                    Replies
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* 5. Add Discussion Topic Modal */}
      {showNewTopicModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forum-modal-title"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-gray-200">
            <div className="space-y-1">
              <h3 id="forum-modal-title" className="text-xl font-bold text-[#0a1142] font-display">
                New Discussion Topic
              </h3>
              <p className="text-xs text-gray-600">
                Post an academic question or discussion prompt to the {courseCode} community.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                createTopicMutation.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <label htmlFor="topic-title" className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Subject / Topic Title
                </label>
                <input
                  id="topic-title"
                  type="text"
                  required
                  placeholder="e.g. Asymptotic Bounds on Hash Table Probing"
                  value={newTopicTitle}
                  onChange={(e) => setNewTopicTitle(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:bg-white transition-all font-medium"
                />
              </div>

              <div>
                <label htmlFor="topic-body" className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                  Message Body
                </label>
                <textarea
                  id="topic-body"
                  required
                  rows={4}
                  placeholder="Elaborate on your question or discussion context..."
                  value={newTopicBody}
                  onChange={(e) => setNewTopicBody(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:bg-white transition-all font-medium resize-none"
                />
              </div>

              {createTopicMutation.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                  {createTopicMutation.error?.response?.data?.error || 'Failed to post topic. Please wait before retrying.'}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewTopicModal(false)}
                  disabled={isPosting}
                  className="px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 text-xs font-bold hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPosting || !newTopicTitle.trim() || !newTopicBody.trim()}
                  className={`
                    px-6 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition-all flex items-center gap-2
                    ${isPosting ? 'opacity-70 cursor-not-allowed pointer-events-none' : ''}
                  `}
                >
                  {isPosting ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>Posting Topic...</span>
                    </>
                  ) : (
                    <>
                      <Send size={14} className="text-[#ffb81c]" />
                      <span>Post to Forum</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
