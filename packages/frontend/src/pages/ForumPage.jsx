import React from 'react';
import { useParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useForumThreads } from '../hooks/useForumThreads';
import { ForumHeader } from '../components/forum/ForumHeader';
import { ForumSearchBar } from '../components/forum/ForumSearchBar';
import { ForumThreadList } from '../components/forum/ForumThreadList';
import { NewTopicDialog } from '../components/forum/NewTopicDialog';
import { ThreadRepliesModal } from '../components/forum/ThreadRepliesModal';
import { ErrorStateView } from '../components/ErrorStateView';

/**
 * Course Discussion Forum Presentation Shell
 *
 * Implements:
 * 1. Pure Dumb Presentation Shell (<180 lines strictly enforced)
 * 2. URL SearchParams Topic Filter (?search=... via { replace: true })
 * 3. Moodle-Synchronized Active Discussion Topics Feed
 * 4. Native HTML Top Layer <dialog> Modal for New Topics with Anti-Spam Mutex
 * 5. Minimum WCAG 44x44px Touch Targets on all Interactive Controls
 * 6. Thread Replies Modal with author avatar propagation
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function ForumPage() {
  const { courseId = 'CSC204' } = useParams();

  const {
    threads,
    courseCode,
    courseTitle,
    searchQuery,
    setSearchQuery,
    showNewTopicModal,
    setShowNewTopicModal,
    newTopicTitle,
    setNewTopicTitle,
    newTopicBody,
    setNewTopicBody,
    handleCreateTopic,
    isPosting,
    postError,
    selectedThread,
    setSelectedThread,
    replies,
    isLoadingReplies,
    handlePostReply,
    isPostingReply,
    postReplyError,
    isLoading,
    isError,
    error,
    refetch,
  } = useForumThreads({ courseId });

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto p-12 text-center space-y-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] dark:text-[#ffb81c] mx-auto" aria-hidden="true" />
        <p className="text-gray-600 dark:text-gray-300 font-medium">Synchronizing forum discussions with Moodle...</p>
      </div>
    );
  }

  if (isError && threads.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorStateView
          title="Discussion Forum Unavailable"
          message={error?.message || 'A network error occurred while loading course discussions.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* 1. Breadcrumbs and Banner Header */}
      <ForumHeader
        courseId={courseId}
        courseCode={courseCode}
        courseTitle={courseTitle}
        onOpenNewTopic={() => setShowNewTopicModal(true)}
      />

      {/* 2. Search & Filter Bar */}
      <ForumSearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filteredCount={threads.length}
      />

      {/* 3. Discussion Thread List */}
      <ForumThreadList threads={threads} onSelectThread={setSelectedThread} />

      {/* 4. New Discussion Topic Top Layer Dialog */}
      <NewTopicDialog
        isOpen={showNewTopicModal}
        onClose={() => setShowNewTopicModal(false)}
        onSubmit={handleCreateTopic}
        title={newTopicTitle}
        onChangeTitle={setNewTopicTitle}
        body={newTopicBody}
        onChangeBody={setNewTopicBody}
        isPosting={isPosting}
        error={postError}
        courseCode={courseCode}
      />

      {/* 5. Thread Replies Stream Modal */}
      <ThreadRepliesModal
        isOpen={Boolean(selectedThread)}
        onClose={() => setSelectedThread(null)}
        thread={selectedThread}
        replies={replies}
        isLoadingReplies={isLoadingReplies}
        onPostReply={handlePostReply}
        isPosting={isPostingReply}
        postError={postReplyError}
        courseCode={courseCode}
      />
    </div>
  );
}

export default ForumPage;
