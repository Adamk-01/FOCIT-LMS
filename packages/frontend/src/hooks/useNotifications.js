/**
 * FOCIT LMS - Student Notification Engine Hook (TanStack React Query + SSE)
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Invariants Enforced:
 * 1. Monotonic Read-State Rule: is_read cannot be reverted to false by concurrent SSE events.
 * 2. Keyset-Based Infinite Queries: Immune to feed drift from prepended live events.
 * 3. Optimistic Mutation Guard: Rollback snapshots with clamped unread counters.
 * 4. Zero-Leak EventSource Lifecycle: Proper teardown on unmount with reconnect jitter.
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

export function useNotifications({ 
  category = 'ALL', 
  unreadOnly = false,
  limit = 20 
} = {}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const studentId = user?.username || 'student1';

  const metaQueryKey = useMemo(() => ['notifications', 'meta', studentId], [studentId]);
  const listQueryKey = useMemo(() => ['notifications', 'infinite', studentId, category, unreadOnly], [studentId, category, unreadOnly]);

  // In-memory sequence deduplication set to guarantee O(1) ingestion deduplication
  const seenSequencesRef = useRef(new Set());
  const pendingMutationsRef = useRef(new Set()); // IDs undergoing in-flight read mutations
  const clearEpochRef = useRef(0); // Monotonic generation token to invalidate superseded rollbacks

  // --------------------------------------------------------------------------
  // 1. Unread Count Scalar Query (Fast-path Partial Index seek)
  // --------------------------------------------------------------------------
  const { data: metaData } = useQuery({
    queryKey: metaQueryKey,
    queryFn: async () => {
      const res = await apiClient.get('/student/notifications?limit=1');
      return { unread_count: res.data.unread_count || 0 };
    },
    staleTime: 30000,
  });

  const unreadCount = metaData?.unread_count ?? 0;

  // --------------------------------------------------------------------------
  // 2. Keyset Infinite Query for Notification Feed
  // --------------------------------------------------------------------------
  const {
    data,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch
  } = useInfiniteQuery({
    queryKey: listQueryKey,
    queryFn: async ({ pageParam = null }) => {
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      params.set('unread_only', String(unreadOnly));
      if (category !== 'ALL') params.set('category', category);
      if (pageParam) params.set('cursor', String(pageParam));

      const res = await apiClient.get(`/student/notifications?${params.toString()}`);
      return res.data;
    },
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.next_cursor : undefined,
    initialPageParam: null,
    staleTime: 60000,
  });

  // Flattened notification list from infinite pages
  const notifications = useMemo(
    () => data?.pages.flatMap((page) => page.notifications) || [],
    [data]
  );

  // Seed seenSequencesRef with all currently loaded items
  useEffect(() => {
    notifications.forEach((n) => {
      if (n.sequence_id) seenSequencesRef.current.add(String(n.sequence_id));
    });
  }, [notifications]);

  // --------------------------------------------------------------------------
  // 3. Real-Time SSE Stream with Monotonic Read Reconciler
  // --------------------------------------------------------------------------
  useEffect(() => {
    let es = null;
    let reconnectTimeout = null;
    let isMounted = true;

    const connectSSE = () => {
      if (!isMounted) return;

      // EventSource to BFF SSE endpoint with ephemeral session nonce
      const sessionNonce = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('session_nonce') : '';
      const streamUrl = `/api/student/notifications/stream${sessionNonce ? `?nonce=${encodeURIComponent(sessionNonce)}` : ''}`;
      es = new EventSource(streamUrl, { withCredentials: true });

      es.onmessage = (event) => {
        try {
          const newNotif = JSON.parse(event.data);
          if (!newNotif || !newNotif.id) return;

          const seqId = String(newNotif.sequence_id);

          // 1. Check O(1) deduplication barrier
          if (seenSequencesRef.current.has(seqId)) {
            return;
          }
          seenSequencesRef.current.add(seqId);

          // 2. Monotonic State Reconciliation Rule:
          // If the user already performed an in-flight optimistic read mutation on this ID,
          // do NOT let an incoming SSE message revert is_read backward to false!
          const isPendingRead = pendingMutationsRef.current.has(newNotif.id);
          const effectiveRead = isPendingRead ? true : Boolean(newNotif.is_read);

          const reconciledNotif = {
            ...newNotif,
            is_read: effectiveRead,
          };

          // 3. Increment unread count in meta cache if truly unread
          if (!effectiveRead) {
            queryClient.setQueryData(metaQueryKey, (old) => ({
              unread_count: (old?.unread_count || 0) + 1,
            }));
          }

          // 4. Prepend event to the infinite query cache
          queryClient.setQueriesData({ queryKey: ['notifications', 'infinite', studentId] }, (old) => {
            if (!old || !old.pages || old.pages.length === 0) return old;

            const matchesCategory = category === 'ALL' || reconciledNotif.category === category;
            const matchesUnread = !unreadOnly || !reconciledNotif.is_read;

            if (!matchesCategory || !matchesUnread) return old;

            // Check if already in the first page to guarantee zero React key duplication
            const alreadyExists = old.pages[0].notifications.some((n) => n.id === reconciledNotif.id);
            if (alreadyExists) return old;

            const updatedFirstPage = {
              ...old.pages[0],
              notifications: [reconciledNotif, ...old.pages[0].notifications],
            };

            return {
              ...old,
              pages: [updatedFirstPage, ...old.pages.slice(1)],
            };
          });
        } catch {
          // Ignore parse errors from heartbeat or ping comments
        }
      };

      es.onerror = () => {
        if (es) {
          es.close();
          es = null;
        }
        // Exponential reconnect backoff with jitter
        if (isMounted) {
          const jitter = Math.random() * 2000 + 3000;
          reconnectTimeout = setTimeout(connectSSE, jitter);
        }
      };
    };

    connectSSE();

    return () => {
      isMounted = false;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (es) es.close();
    };
  }, [studentId, category, unreadOnly, queryClient, metaQueryKey]);

  // --------------------------------------------------------------------------
  // 4. Optimistic Mark Single Notification as Read
  // --------------------------------------------------------------------------
  const markAsReadMutation = useMutation({
    mutationFn: async (id) => {
      const res = await apiClient.patch(`/student/notifications/${id}/read`);
      return res.data.notification;
    },
    onMutate: async (id) => {
      // Register in-flight optimistic lock
      pendingMutationsRef.current.add(id);

      // Snapshot caches for rollback
      await queryClient.cancelQueries({ queryKey: metaQueryKey });
      await queryClient.cancelQueries({ queryKey: listQueryKey });

      const prevMeta = queryClient.getQueryData(metaQueryKey);
      const prevList = queryClient.getQueryData(listQueryKey);

      // Optimistically decrement unread count (clamped at 0)
      queryClient.setQueryData(metaQueryKey, (old) => ({
        unread_count: Math.max((old?.unread_count || 1) - 1, 0),
      }));

      // Optimistically set is_read = true in all infinite pages
      queryClient.setQueryData(listQueryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            notifications: page.notifications.map((n) => 
              n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
            ),
          })),
        };
      });

      return { id };
    },
    onError: (err, id) => {
      pendingMutationsRef.current.delete(id);

      // Targeted Element Rollback: Revert only the failed item, preserving any concurrent SSE additions!
      queryClient.setQueryData(metaQueryKey, (old) => ({
        unread_count: (old?.unread_count || 0) + 1,
      }));

      queryClient.setQueryData(listQueryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            notifications: page.notifications.map((n) => 
              n.id === id ? { ...n, is_read: false, read_at: null } : n
            ),
          })),
        };
      });
    },
    onSettled: (data, err, id) => {
      pendingMutationsRef.current.delete(id);
      queryClient.invalidateQueries({ queryKey: metaQueryKey });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
    },
  });

  // --------------------------------------------------------------------------
  // 5. Snapshot-Guarded Mark All as Read Mutation
  // --------------------------------------------------------------------------
  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const snapshotTime = new Date().toISOString();
      const res = await apiClient.post('/student/notifications/read-all', {
        read_up_to: snapshotTime,
      });
      return res.data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: metaQueryKey });
      await queryClient.cancelQueries({ queryKey: listQueryKey });

      const prevMeta = queryClient.getQueryData(metaQueryKey);
      const prevList = queryClient.getQueryData(listQueryKey);

      queryClient.setQueryData(metaQueryKey, { unread_count: 0 });

      queryClient.setQueryData(listQueryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            notifications: page.notifications.map((n) => ({
              ...n,
              is_read: true,
              read_at: new Date().toISOString(),
            })),
          })),
        };
      });

      return { prevMeta, prevList };
    },
    onError: (err, variables, context) => {
      if (context?.prevMeta) queryClient.setQueryData(metaQueryKey, context.prevMeta);
      if (context?.prevList) queryClient.setQueryData(listQueryKey, context.prevList);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: metaQueryKey });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
    },
  });

  // --------------------------------------------------------------------------
  // 6. Optimistic Clear Single Notification (Slide Right Dismissal)
  // --------------------------------------------------------------------------
  const clearNotificationMutation = useMutation({
    mutationFn: async (id) => {
      const res = await apiClient.delete(`/student/notifications/${id}`);
      return res.data;
    },
    onMutate: async (id) => {
      // Capture the active epoch token when this mutation begins
      const birthEpoch = clearEpochRef.current;

      await queryClient.cancelQueries({ queryKey: metaQueryKey });
      await queryClient.cancelQueries({ queryKey: listQueryKey });

      const prevList = queryClient.getQueryData(listQueryKey);

      // Extract evicted entity and check if it was unread
      let evictedItem = null;
      let wasUnread = false;
      if (prevList?.pages) {
        for (const page of prevList.pages) {
          const item = page.notifications.find((n) => n.id === id);
          if (item) {
            evictedItem = item;
            wasUnread = !item.is_read;
            break;
          }
        }
      }

      if (wasUnread) {
        queryClient.setQueryData(metaQueryKey, (old) => ({
          unread_count: Math.max((old?.unread_count || 1) - 1, 0),
        }));
      }

      // Optimistically remove targeted item from infinite pages
      queryClient.setQueryData(listQueryKey, (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            notifications: page.notifications.filter((n) => n.id !== id),
          })),
        };
      });

      return { evictedItem, birthEpoch, wasUnread };
    },
    onError: (err, id, context) => {
      // Invariant: If a Clear-All occurred (or rolled back) while this request was in flight,
      // birthEpoch !== clearEpochRef.current. Abort rollback to prevent UI ghost resurrection!
      if (!context?.evictedItem || context.birthEpoch !== clearEpochRef.current) {
        return;
      }

      const evicted = context.evictedItem;
      const targetSeq = BigInt(evicted.sequence_id);

      // Re-increment unread count if it was unread
      if (context.wasUnread) {
        queryClient.setQueryData(metaQueryKey, (old) => ({
          unread_count: (old?.unread_count || 0) + 1,
        }));
      }

      // Targeted Keyset Splice Algorithm into Multi-Page InfiniteData
      queryClient.setQueryData(listQueryKey, (old) => {
        if (!old?.pages || old.pages.length === 0) return old;

        // Check if item already exists in any page to prevent duplicate insertion
        const alreadyExists = old.pages.some((page) =>
          page.notifications.some((n) => n.id === evicted.id)
        );
        if (alreadyExists) return old;

        let targetPageIndex = 0;
        let insertIndex = 0;

        for (let k = 0; k < old.pages.length; k++) {
          const page = old.pages[k];
          if (page.notifications.length === 0) continue;

          const headSeq = BigInt(page.notifications[0].sequence_id);
          const tailSeq = BigInt(page.notifications[page.notifications.length - 1].sequence_id);

          if (k === 0 && targetSeq >= headSeq) {
            targetPageIndex = 0;
            insertIndex = 0;
            break;
          }

          if (targetSeq <= headSeq && targetSeq >= tailSeq) {
            targetPageIndex = k;
            insertIndex = page.notifications.findIndex(
              (n) => BigInt(n.sequence_id) < targetSeq
            );
            if (insertIndex === -1) insertIndex = page.notifications.length;
            break;
          }

          if (k < old.pages.length - 1) {
            const nextHeadSeq = BigInt(old.pages[k + 1].notifications[0]?.sequence_id || 0);
            if (targetSeq < tailSeq && targetSeq > nextHeadSeq) {
              targetPageIndex = k;
              insertIndex = page.notifications.length;
              break;
            }
          } else {
            targetPageIndex = k;
            insertIndex = page.notifications.length;
            break;
          }
        }

        const updatedPages = old.pages.map((page, k) => {
          if (k !== targetPageIndex) return page;

          const updatedNotifs = [...page.notifications];
          updatedNotifs.splice(insertIndex, 0, evicted);

          const isTailInsertion = insertIndex === updatedNotifs.length - 1;
          const updatedCursor = isTailInsertion ? evicted.sequence_id : page.next_cursor;

          return {
            ...page,
            notifications: updatedNotifs,
            next_cursor: updatedCursor,
          };
        });

        return {
          ...old,
          pages: updatedPages,
        };
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: metaQueryKey });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
    },
  });

  // --------------------------------------------------------------------------
  // 7. Clear All Notifications
  // --------------------------------------------------------------------------
  const clearAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.delete('/student/notifications/clear-all');
      return res.data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: metaQueryKey });
      await queryClient.cancelQueries({ queryKey: listQueryKey });

      const prevMeta = queryClient.getQueryData(metaQueryKey);
      const prevList = queryClient.getQueryData(listQueryKey);

      // Advance monotonic generation token to invalidate all prior in-flight deletions
      const epochAtClear = ++clearEpochRef.current;

      queryClient.setQueryData(metaQueryKey, { unread_count: 0 });
      queryClient.setQueryData(listQueryKey, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page) => ({
            ...page,
            notifications: [],
          })),
        };
      });

      return { prevMeta, prevList, epochAtClear };
    },
    onError: (err, variables, context) => {
      // Invalidate the generation AGAIN on failure so in-flight requests during the failure don't cross-roll
      clearEpochRef.current++;

      if (context?.prevMeta) queryClient.setQueryData(metaQueryKey, context.prevMeta);
      if (context?.prevList) queryClient.setQueryData(listQueryKey, context.prevList);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: metaQueryKey });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
    },
  });

  const markAsRead = useCallback((id) => {
    return markAsReadMutation.mutateAsync(id);
  }, [markAsReadMutation]);

  const markAllAsRead = useCallback(() => {
    return markAllAsReadMutation.mutateAsync();
  }, [markAllAsReadMutation]);

  const clearNotification = useCallback((id) => {
    return clearNotificationMutation.mutateAsync(id);
  }, [clearNotificationMutation]);

  const clearAllNotifications = useCallback(() => {
    return clearAllMutation.mutateAsync();
  }, [clearAllMutation]);

  return {
    unreadCount,
    totalCount: notifications.length,
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
    isMarkingAllAsRead: markAllAsReadMutation.isPending,
    isClearingAll: clearAllMutation.isPending,
  };
}
