import { useState, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

/**
 * Course Discussion Forum Controller Hook
 *
 * Implements:
 * 1. Synchronized URL SearchParams query (?search=... via { replace: true })
 * 2. Fetching Moodle-synchronized discussion threads
 * 3. Mutation for creating new discussion topics with anti-spam mutation lock
 * 4. Deterministic query cache invalidation on successful publish
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function useForumThreads({ courseId }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const searchQuery = searchParams.get('search') || '';

  const setSearchQuery = useCallback(
    (q) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (q) next.set('search', q);
          else next.delete('search');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [showNewTopicModal, setShowNewTopicModal] = useState(false);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicBody, setNewTopicBody] = useState('');

  // 1. Fetch Course Discussion Threads
  const {
    data: forumData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['course-forum', courseId],
    queryFn: async () => {
      const res = await apiClient.get(`/courses/${courseId}/forum`);
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const threads = useMemo(() => forumData?.threads || [], [forumData?.threads]);
  const courseCode = forumData?.courseCode || 'CSC 204';
  const courseTitle = forumData?.courseTitle || 'Data Structures and Algorithms';

  // Filter threads by search term
  const filteredThreads = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return threads;
    return threads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q) ||
        t.author?.name?.toLowerCase().includes(q)
    );
  }, [threads, searchQuery]);

  // 2. Mutation for creating a new topic
  const createTopicMutation = useMutation({
    mutationFn: async ({ title, body }) => {
      const res = await apiClient.post(`/courses/${courseId}/forum/threads`, {
        title,
        body,
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

  const handleCreateTopic = useCallback(
    (e) => {
      if (e) e.preventDefault();
      if (!newTopicTitle.trim() || !newTopicBody.trim()) return;
      createTopicMutation.mutate({
        title: newTopicTitle.trim(),
        body: newTopicBody.trim(),
      });
    },
    [newTopicTitle, newTopicBody, createTopicMutation]
  );

  return {
    threads: filteredThreads,
    totalThreadsCount: threads.length,
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
    createTopicMutation,
    isPosting: createTopicMutation.isPending,
    postError: createTopicMutation.error,
    isLoading,
    isError,
    error,
    refetch,
  };
}

export default useForumThreads;
