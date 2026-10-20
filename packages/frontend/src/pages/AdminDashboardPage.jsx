import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAdminDashboard } from '../hooks/useAdminDashboard';
import { AdminHeroBanner } from '../components/admin/AdminHeroBanner';
import { AdminMetricsGrid } from '../components/admin/AdminMetricsGrid';
import { AdminOutboxQueueCard } from '../components/admin/AdminOutboxQueueCard';
import { AdminQuickActionsCard } from '../components/admin/AdminQuickActionsCard';
import { UserProvisioningModal } from '../components/admin/UserProvisioningModal';
import { CohortIngestionModal } from '../components/admin/CohortIngestionModal';
import { SecurityAuditModal } from '../components/admin/SecurityAuditModal';
import { UserDirectoryModal } from '../components/admin/UserDirectoryModal';
import { ErrorStateView } from '../components/ErrorStateView';
import { ErrorAlertCallout } from '../components/ErrorAlertCallout';

/**
 * Administrator Governance Cockpit & Control Plane Page Shell
 *
 * Implements:
 * 1. Pure Dumb Presentation Shell (<180 lines strictly enforced)
 * 2. Signature dark navy hero banner with registration window toggle and provision trigger
 * 3. 3 spacious telemetry cards (Students, Staff, Moodle Integration Engine)
 * 4. Balanced 2-column lower workspace (Moodle Outbox Synchronization + Quick Actions)
 * 5. Modals for User Provisioning (Option B temporary password), Cohort Ingestion, and Audit Ledger
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function AdminDashboardPage() {
  const {
    overview,
    outbox,
    users,
    auditLogs,
    isLoading,
    isError,
    error,
    refetchAll,
    outboxFilter,
    setOutboxFilter,
    retryOutbox,
    isRetryingOutbox,
    handleToggleRegistrationWindow,
    isProvisionModalOpen,
    openProvisionModal,
    closeProvisionModal,
    provisionUser,
    isProvisioning,
    provisionError,
    provisionResult,
    isCohortModalOpen,
    setIsCohortModalOpen,
    isAuditModalOpen,
    setIsAuditModalOpen,
    isAuditLoading,
    isUserDirectoryModalOpen,
    setIsUserDirectoryModalOpen,
    userSearch,
    setUserSearch,
    userRoleFilter,
    setUserRoleFilter,
    toggleUserStatus,
    isTogglingStatus,
    statusError,
    isUsersLoading,
  } = useAdminDashboard();

  const { user } = useAuth();
  const role = String(user?.role || '').toUpperCase();
  if (user && !['ADMIN', 'SYSTEM_ADMIN'].includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (isError && !overview) {
    return (
      <div className="max-w-7xl mx-auto py-12 px-4">
        <ErrorStateView
          title="Admin Control Plane Unavailable"
          message={error?.message || 'Could not connect to faculty administrative backend.'}
          onRetry={() => refetchAll()}
        />
      </div>
    );
  }

  const metrics = overview?.metrics || {};
  const activeSemester = overview?.activeSemester || {};
  const systemHealth = overview?.systemHealth || {};
  const queue = outbox?.moodleSyncQueue || [];

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-8 pb-16">
      {/* 1. Inline Degradation Notice if Error Occurred */}
      {isError && (
        <ErrorAlertCallout
          error={error}
          onRetry={() => refetchAll()}
          className="text-xs"
        />
      )}

      {/* 2. Signature Hero Banner */}
      <AdminHeroBanner
        semesterId={activeSemester?.id || ''}
        semesterName={activeSemester?.name || 'No Active Academic Semester'}
        isRegistrationOpen={activeSemester?.isRegistrationOpen ?? false}
        onToggleWindow={handleToggleRegistrationWindow}
        onOpenProvisionModal={openProvisionModal}
      />

      {/* 3. Spacious 3-Card Metrics Telemetry Grid */}
      <AdminMetricsGrid
        totalStudents={metrics?.totalStudents ?? 0}
        totalStaff={metrics?.totalStaff ?? 0}
        moodleStatus={systemHealth?.moodle?.status || 'UNKNOWN'}
      />

      {/* 4. Balanced 2-Column Operational Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column (7/12 cols ~ 60%): Moodle Outbox Queue */}
        <div className="lg:col-span-7 h-full">
          <AdminOutboxQueueCard
            queue={queue}
            filter={outboxFilter}
            onFilterChange={setOutboxFilter}
            onRetry={retryOutbox}
            isRetrying={isRetryingOutbox}
            totalCount={outbox?.total || queue.length}
          />
        </div>

        {/* Right Column (5/12 cols ~ 40%): Quick Governance Actions */}
        <div className="lg:col-span-5 h-full">
          <AdminQuickActionsCard
            onOpenCohortModal={() => setIsCohortModalOpen(true)}
            onOpenAuditModal={() => setIsAuditModalOpen(true)}
            onOpenUserDirectory={() => setIsUserDirectoryModalOpen(true)}
          />
        </div>
      </div>

      {/* 5. Modals & Dialogs */}
      <UserProvisioningModal
        isOpen={isProvisionModalOpen}
        onClose={closeProvisionModal}
        onSubmit={provisionUser}
        isSubmitting={isProvisioning}
        error={provisionError}
        result={provisionResult}
      />

      <CohortIngestionModal
        isOpen={isCohortModalOpen}
        onClose={() => setIsCohortModalOpen(false)}
      />

      <SecurityAuditModal
        isOpen={isAuditModalOpen}
        onClose={() => setIsAuditModalOpen(false)}
        logs={auditLogs?.logs || []}
        isLoading={isAuditLoading}
      />

      <UserDirectoryModal
        isOpen={isUserDirectoryModalOpen}
        onClose={() => setIsUserDirectoryModalOpen(false)}
        users={users?.users || []}
        isLoading={isUsersLoading}
        searchTerm={userSearch}
        onSearchChange={setUserSearch}
        roleFilter={userRoleFilter}
        onRoleFilterChange={setUserRoleFilter}
        onToggleStatus={toggleUserStatus}
        isToggling={isTogglingStatus}
        error={statusError}
      />
    </div>
  );
}
export default AdminDashboardPage;
