import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

/**
 * FOCIT LMS - Administrator Control Plane Custom Hook
 *
 * Implements:
 * 1. Live SWR polling for infrastructure telemetry, metrics & outbox queue
 * 2. Optimistic mutations for registration window toggle and outbox event retries
 * 3. User provisioning with Option B single-reveal temporary password capture
 * 4. User lifecycle status updates (ACTIVE <-> SUSPENDED)
 * 5. Modal dialog state management for Provisioning, Cohort Ingestion & Audit Ledger
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function useAdminDashboard() {
  const queryClient = useQueryClient();

  // 1. Local UI & Filter States
  const [outboxFilter, setOutboxFilter] = useState('ALL');
  const [isProvisionModalOpen, setIsProvisionModalOpen] = useState(false);
  const [provisionResult, setProvisionResult] = useState(null);
  const [isCohortModalOpen, setIsCohortModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isUserDirectoryModalOpen, setIsUserDirectoryModalOpen] = useState(false);

  // 2. Fetch Dashboard Overview & Live Telemetry (10s polling interval)
  const {
    data: overviewData,
    isLoading: isOverviewLoading,
    isError: isOverviewError,
    error: overviewError,
    refetch: refetchOverview,
  } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/dashboard');
      return res.data?.data || res.data || {};
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });

  // 3. Fetch Outbox & Synchronization Queue (5s polling interval)
  const {
    data: outboxData,
    isLoading: isOutboxLoading,
    isError: isOutboxError,
    error: outboxError,
    refetch: refetchOutbox,
  } = useQuery({
    queryKey: ['admin', 'outbox', outboxFilter],
    queryFn: async () => {
      const statusParam = outboxFilter !== 'ALL' ? `?status=${outboxFilter}` : '';
      const res = await apiClient.get(`/admin/integrations/outbox${statusParam}`);
      return res.data?.data || res.data || {};
    },
    refetchInterval: 5000,
    staleTime: 3000,
  });

  // 4. Fetch User Directory (Paginated & Filterable)
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState('ALL');
  const [userPage, setUserPage] = useState(1);

  const {
    data: usersData,
    isLoading: isUsersLoading,
    refetch: refetchUsers,
  } = useQuery({
    queryKey: ['admin', 'users', userSearch, userRoleFilter, userPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(userPage),
        limit: '20',
      });
      if (userSearch.trim()) params.append('search', userSearch.trim());
      if (userRoleFilter !== 'ALL') params.append('role', userRoleFilter);
      const res = await apiClient.get(`/admin/users?${params.toString()}`);
      return res.data?.data || res.data || {};
    },
    staleTime: 5000,
  });

  // 5. Fetch Security Audit Logs (Paginated & Filterable)
  const [auditEventType, setAuditEventType] = useState('ALL');
  const [auditPage, setAuditPage] = useState(1);

  const {
    data: auditData,
    isLoading: isAuditLoading,
    refetch: refetchAudit,
  } = useQuery({
    queryKey: ['admin', 'audit-logs', auditEventType, auditPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(auditPage),
        limit: '25',
      });
      if (auditEventType && auditEventType !== 'ALL') {
        params.append('eventType', auditEventType);
      }
      const res = await apiClient.get(`/admin/audit-logs?${params.toString()}`);
      return res.data?.data || res.data || {};
    },
    staleTime: 5000,
  });

  // 6. Mutation: Toggle Registration Window
  const toggleRegistrationWindowMutation = useMutation({
    mutationFn: async ({ semesterId, isOpen }) => {
      const res = await apiClient.patch(
        `/admin/academic-semesters/${encodeURIComponent(semesterId)}/registration-window`,
        { isOpen }
      );
      return res.data;
    },
    onMutate: async ({ isOpen }) => {
      await queryClient.cancelQueries({ queryKey: ['admin', 'dashboard'] });
      const previousOverview = queryClient.getQueryData(['admin', 'dashboard']);
      if (previousOverview) {
        queryClient.setQueryData(['admin', 'dashboard'], {
          ...previousOverview,
          activeSemester: {
            ...(previousOverview.activeSemester || {}),
            isRegistrationOpen: isOpen,
          },
        });
      }
      return { previousOverview };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousOverview) {
        queryClient.setQueryData(['admin', 'dashboard'], context.previousOverview);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  // 7. Mutation: Retry Outbox Sync Event
  const retryOutboxMutation = useMutation({
    mutationFn: async (eventId) => {
      const res = await apiClient.post(`/admin/integrations/outbox/${encodeURIComponent(eventId)}/retry`);
      return res.data;
    },
    onMutate: async (eventId) => {
      await queryClient.cancelQueries({ queryKey: ['admin', 'outbox', outboxFilter] });
      const prevOutbox = queryClient.getQueryData(['admin', 'outbox', outboxFilter]);
      if (prevOutbox?.moodleSyncQueue) {
        queryClient.setQueryData(['admin', 'outbox', outboxFilter], {
          ...prevOutbox,
          moodleSyncQueue: prevOutbox.moodleSyncQueue.map((item) =>
            item.id === eventId ? { ...item, status: 'PENDING' } : item
          ),
        });
      }
      return { prevOutbox };
    },
    onError: (_err, _variables, context) => {
      if (context?.prevOutbox) {
        queryClient.setQueryData(['admin', 'outbox', outboxFilter], context.prevOutbox);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'outbox'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  // 8. Mutation: Provision New User
  const provisionUserMutation = useMutation({
    mutationFn: async (userData) => {
      const res = await apiClient.post('/admin/users', userData);
      return res.data?.data || res.data;
    },
    onSuccess: (data) => {
      setProvisionResult(data);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  // 9. Mutation: Update Account Status (ACTIVE <-> SUSPENDED)
  const toggleUserStatusMutation = useMutation({
    mutationFn: async ({ userId, status }) => {
      const res = await apiClient.patch(`/admin/users/${encodeURIComponent(userId)}/status`, { status });
      return res.data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'dashboard'] });
    },
  });

  // 9b. Mutation: Reset User Temporary Password
  const resetUserPasswordMutation = useMutation({
    mutationFn: async ({ userId, password }) => {
      const res = await apiClient.post(`/admin/users/${encodeURIComponent(userId)}/reset-password`, { password });
      return res.data?.data || res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'audit-logs'] });
    },
  });

  // 10. Handlers
  const handleToggleRegistrationWindow = useCallback(
    (semesterId, currentIsOpen) => {
      if (!semesterId) return;
      toggleRegistrationWindowMutation.mutate({
        semesterId,
        isOpen: !currentIsOpen,
      });
    },
    [toggleRegistrationWindowMutation]
  );

  const handleOpenProvisionModal = useCallback(() => {
    setProvisionResult(null);
    provisionUserMutation.reset();
    setIsProvisionModalOpen(true);
  }, [provisionUserMutation]);

  const handleCloseProvisionModal = useCallback(() => {
    setIsProvisionModalOpen(false);
    setProvisionResult(null);
    provisionUserMutation.reset();
  }, [provisionUserMutation]);

  return {
    // Data
    overview: overviewData,
    outbox: outboxData,
    users: usersData,
    auditLogs: auditData,

    // Loading & Error States
    isLoading: isOverviewLoading,
    isError: isOverviewError,
    error: overviewError,
    isOutboxLoading,
    isOutboxError,
    outboxError,
    isUsersLoading,
    isAuditLoading,

    // Outbox Filtering
    outboxFilter,
    setOutboxFilter,

    // User Directory Filtering
    userSearch,
    setUserSearch,
    userRoleFilter,
    setUserRoleFilter,
    userPage,
    setUserPage,

    // Audit Ledger Filtering & Pagination
    auditEventType,
    setAuditEventType,
    auditPage,
    setAuditPage,
    refetchAudit,

    // Modals & Drawers
    isProvisionModalOpen,
    openProvisionModal: handleOpenProvisionModal,
    closeProvisionModal: handleCloseProvisionModal,
    provisionResult,
    isCohortModalOpen,
    setIsCohortModalOpen,
    isAuditModalOpen,
    setIsAuditModalOpen,
    isUserDirectoryModalOpen,
    setIsUserDirectoryModalOpen,

    // Mutations & Actions
    handleToggleRegistrationWindow,
    retryOutbox: (id) => retryOutboxMutation.mutateAsync(id),
    isRetryingOutbox: retryOutboxMutation.isPending,
    provisionUser: (data) => provisionUserMutation.mutate(data),
    isProvisioning: provisionUserMutation.isPending,
    provisionError: provisionUserMutation.error,
    toggleUserStatus: (userId, status) => toggleUserStatusMutation.mutate({ userId, status }),
    isTogglingStatus: toggleUserStatusMutation.isPending,
    statusError: toggleUserStatusMutation.error,
    resetUserPassword: (userId, password) => resetUserPasswordMutation.mutateAsync({ userId, password }),
    isResettingPassword: resetUserPasswordMutation.isPending,
    resetPasswordError: resetUserPasswordMutation.error,

    // Manual Refresh
    refetchAll: () => {
      refetchOverview();
      refetchOutbox();
      refetchUsers();
    },
  };
}
