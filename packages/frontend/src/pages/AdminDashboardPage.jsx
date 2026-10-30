import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useAdminDashboard } from '../hooks/useAdminDashboard';
import { AdminHeroBanner } from '../components/admin/AdminHeroBanner';
import { AdminMetricsGrid } from '../components/admin/AdminMetricsGrid';
import { AdminOutboxQueueCard } from '../components/admin/AdminOutboxQueueCard';
import { AdminQuickActionsCard } from '../components/admin/AdminQuickActionsCard';
import { UserProvisioningModal } from '../components/admin/UserProvisioningModal';
import { CohortIngestionModal } from '../components/admin/CohortIngestionModal';
import { ErrorStateView } from '../components/ErrorStateView';
import { ErrorAlertCallout } from '../components/ErrorAlertCallout';

/**
 * Administrator Governance Cockpit & Control Plane Overview Shell
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function AdminDashboardPage() {
  const navigate = useNavigate();
  const {
    overview, outbox, isLoading, isError, error, refetchAll,
    outboxFilter, setOutboxFilter, retryOutbox, isRetryingOutbox, handleToggleRegistrationWindow,
    isProvisionModalOpen, openProvisionModal, closeProvisionModal, provisionUser, isProvisioning,
    provisionError, provisionResult, isCohortModalOpen, setIsCohortModalOpen,
  } = useAdminDashboard();

  const { user } = useAuth();
  const role = String(user?.role || '').toUpperCase();
  if (user && !['ADMIN', 'SYSTEM_ADMIN'].includes(role)) {
    if (role === 'HOD') {
      return <Navigate to="/hod" replace />;
    }
    if (['LEVEL_ADVISOR', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF', 'LECTURER'].includes(role)) {
      return <Navigate to="/lecturer" replace />;
    }
    return <Navigate to="/dashboard" replace />;
  }

  if (isError && !overview) {
    return (
      <div className="max-w-7xl mx-auto py-12 px-4">
        <ErrorStateView title="Admin Control Plane Unavailable" message={error?.message || 'Backend connection failed.'} onRetry={() => refetchAll()} />
      </div>
    );
  }

  const metrics = overview?.metrics || {};
  const activeSemester = overview?.activeSemester || {};
  const queue = outbox?.moodleSyncQueue || [];

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-8 pb-16">
      {isError && <ErrorAlertCallout error={error} onRetry={() => refetchAll()} className="text-xs" />}

      <AdminHeroBanner
        semesterId={activeSemester?.id || ''}
        semesterName={activeSemester?.name || 'No Active Academic Semester'}
        isRegistrationOpen={activeSemester?.isRegistrationOpen ?? false}
        onToggleWindow={handleToggleRegistrationWindow}
        onOpenProvisionModal={openProvisionModal}
      />

      <AdminMetricsGrid
        totalStudents={metrics?.totalStudents ?? 0}
        totalStaff={metrics?.totalStaff ?? 0}
        moodleStatus={overview?.systemHealth?.moodle?.status || 'UNKNOWN'}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
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
        <div className="lg:col-span-5 h-full">
          <AdminQuickActionsCard
            onOpenCohortModal={() => setIsCohortModalOpen(true)}
            onOpenAuditModal={() => navigate('/admin/audit')}
            onOpenUserDirectory={() => navigate('/admin/users')}
          />
        </div>
      </div>

      <UserProvisioningModal
        isOpen={isProvisionModalOpen}
        onClose={closeProvisionModal}
        onSubmit={provisionUser}
        isSubmitting={isProvisioning}
        error={provisionError}
        result={provisionResult}
      />

      <CohortIngestionModal isOpen={isCohortModalOpen} onClose={() => setIsCohortModalOpen(false)} />
    </div>
  );
}
export default AdminDashboardPage;
