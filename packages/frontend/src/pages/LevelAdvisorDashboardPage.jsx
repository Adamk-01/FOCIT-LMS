import React from 'react';
import { useAdvisorCohort } from '../hooks/useAdvisorCohort';
import { AdvisorHeaderFilter } from '../components/advisor/AdvisorHeaderFilter';
import { CohortLedgerTable } from '../components/advisor/CohortLedgerTable';
import { BulkApprovalBar } from '../components/advisor/BulkApprovalBar';
import { BatchInspectionDialog } from '../components/advisor/BatchInspectionDialog';
import { BatchRejectionDialog } from '../components/advisor/BatchRejectionDialog';
import { ErrorAlertCallout } from '../components/ErrorAlertCallout';
import { ErrorStateView } from '../components/ErrorStateView';

/**
 * Level Advisor Course Registration Review & Clearance Dashboard Shell
 *
 * Implements:
 * 1. Pure Dumb Presentation Shell (<180 lines strictly enforced)
 * 2. URL SearchParams Cohort Filtering (?level=200&status=SUBMITTED via { replace: true })
 * 3. Multi-Select Cohort Ledger with Select-All & Status Badges
 * 4. Mutex-Locked Bulk Approval Bar (Dijkstra-ordered transactional endorsement)
 * 5. Native HTML Top Layer Dialogs for Course Inspection & Rejection
 * 6. Mandatory Senate Audit Remarks Validation (minimum 5 non-whitespace chars)
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function LevelAdvisorDashboardPage() {
  const {
    cohort,
    semester,
    isLoading,
    isError,
    error,
    refetch,
    selectedLevel,
    setSelectedLevel,
    selectedStatus,
    setSelectedStatus,
    selectedBatchIds,
    setSelectedBatchIds,
    handleToggleBatch,
    handleSelectAll,
    inspectingBatch,
    setInspectingBatch,
    rejectionTarget,
    setRejectionTarget,
    rejectionRemarks,
    setRejectionRemarks,
    rejectionError,
    handleOpenRejection,
    handleConfirmRejection,
    batchApproveMutation,
    rejectMutation,
    isActionLocked,
  } = useAdvisorCohort();

  if (isError && !cohort.length) {
    return (
      <div className="max-w-7xl mx-auto py-12 px-4">
        <ErrorStateView
          title="Cohort Records Unavailable"
          message={error?.message || 'Failed to load level advisor registration cohort.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-20">
      {/* 1. Header Filter Banner */}
      <AdvisorHeaderFilter
        semesterName={semester?.name || '2026/2027 Rain Semester'}
        selectedLevel={selectedLevel}
        onSelectLevel={setSelectedLevel}
        selectedStatus={selectedStatus}
        onSelectStatus={setSelectedStatus}
        onRefresh={() => refetch()}
        isLoading={isLoading}
        isActionLocked={isActionLocked}
      />

      {/* 2. Mutation Error Callouts */}
      {batchApproveMutation.isError && (
        <ErrorAlertCallout
          error={batchApproveMutation.error}
          onRetry={() => batchApproveMutation.mutate(selectedBatchIds)}
        />
      )}

      {/* 3. Cohort Ledger Table */}
      <CohortLedgerTable
        cohort={cohort}
        selectedBatchIds={selectedBatchIds}
        onToggleBatch={handleToggleBatch}
        onSelectAll={handleSelectAll}
        onInspect={setInspectingBatch}
        onEndorse={(batchId) => batchApproveMutation.mutate([batchId])}
        onReject={handleOpenRejection}
        isLoading={isLoading}
        isActionLocked={isActionLocked}
        selectedLevel={selectedLevel}
        selectedStatus={selectedStatus}
      />

      {/* 4. Sticky Bulk Endorsement Bar */}
      <BulkApprovalBar
        selectedCount={selectedBatchIds.length}
        onCancel={() => setSelectedBatchIds([])}
        onApprove={() => batchApproveMutation.mutate(selectedBatchIds)}
        isPending={batchApproveMutation.isPending}
        isActionLocked={isActionLocked}
      />

      {/* 5. Course Inspection Top Layer Dialog */}
      <BatchInspectionDialog
        batch={inspectingBatch}
        onClose={() => setInspectingBatch(null)}
      />

      {/* 6. Senate Audit Rejection Top Layer Dialog */}
      <BatchRejectionDialog
        target={rejectionTarget}
        remarks={rejectionRemarks}
        onChangeRemarks={setRejectionRemarks}
        onConfirm={handleConfirmRejection}
        onClose={() => setRejectionTarget(null)}
        isPending={rejectMutation.isPending}
        error={rejectionError}
      />
    </div>
  );
}

export default LevelAdvisorDashboardPage;
