/**
 * FOCIT LMS - Digital Library Administrative Curation Cockpit (AdminLibraryPage)
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements:
 * 1. Invariant 1: Physical Viewport Containment (`100dvh` lock without document-level reflows).
 * 2. Invariant 2: Dual-State Partitioning (URL SearchParams is Single Source of Truth).
 * 3. Zero-Trust Client: Unhappy path defense, skeletons, mutation locks, and accessible semantic controls.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAdminLibrary } from '../../hooks/useAdminLibrary';
import { LibraryAdminStatsHeader } from '../../components/admin/library/LibraryAdminStatsHeader';
import { LibraryAdminFilterBar } from '../../components/admin/library/LibraryAdminFilterBar';
import { LibraryAdminTable } from '../../components/admin/library/LibraryAdminTable';
import { LibraryIngestModal } from '../../components/admin/library/LibraryIngestModal';
import { ErrorStateView } from '../../components/ErrorStateView';

export function AdminLibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isHod = user?.role === 'HOD';

  // 1. Dual-State Partitioning: URL SearchParams Single Source of Truth
  const category = searchParams.get('category') || 'all';
  const status = searchParams.get('status') || 'all';
  const departmentId = isHod ? user?.department_id : (searchParams.get('departmentId') || '');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const queryTerm = searchParams.get('q') || '';

  // Local state for debounced search and modal
  const [searchInput, setSearchInput] = useState(queryTerm);
  const [isIngestModalOpen, setIsIngestModalOpen] = useState(false);

  // Sync search input if URL changes externally
  useEffect(() => {
    setSearchInput(queryTerm);
  }, [queryTerm]);

  // Debounced Search Sync to URL (350ms debounce)
  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchInput !== queryTerm) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          if (searchInput.trim()) {
            next.set('q', searchInput.trim());
          } else {
            next.delete('q');
          }
          next.set('page', '1');
          return next;
        }, { replace: true });
      }
    }, 350);

    return () => clearTimeout(handler);
  }, [searchInput, queryTerm, setSearchParams]);

  // Atomic Filter Change Handlers (Guarantees Invariant 2: page resets to 1)
  const handleCategoryChange = useCallback((newCat) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newCat && newCat !== 'all') {
        next.set('category', newCat);
      } else {
        next.delete('category');
      }
      next.set('page', '1');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleStatusChange = useCallback((newStatus) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newStatus && newStatus !== 'all') {
        next.set('status', newStatus);
      } else {
        next.delete('status');
      }
      next.set('page', '1');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleDepartmentChange = useCallback((newDept) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newDept) {
        next.set('departmentId', newDept);
      } else {
        next.delete('departmentId');
      }
      next.set('page', '1');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleResetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      if (isHod && user?.department_id) {
        next.set('departmentId', user.department_id);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams, isHod, user]);

  const handlePageChange = useCallback((newPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(newPage));
      return next;
    });
  }, [setSearchParams]);

  // Hook Integration
  const {
    items,
    pagination,
    stats,
    isLoading,
    isStatsLoading,
    isError,
    error,
    refetchItems,
    refetchStats,
    uploadBinary,
    cancelUpload,
    isUploading,
    uploadProgress,
    uploadError,
    commitItem,
    isCommitting,
    commitError,
    updateItem,
    isUpdating,
    deleteItem,
    isDeleting,
    runReaper,
    isReaping,
  } = useAdminLibrary({
    category,
    status,
    departmentId,
    search: queryTerm,
    page,
    limit: 20,
  });

  // Action Handlers
  const handleTogglePublish = async (item) => {
    try {
      const nextState = !item.is_published;
      await updateItem({ id: item.id, updates: { isPublished: nextState } });
      toast.success(nextState ? `"${item.title}" is now published.` : `"${item.title}" archived to draft.`);
    } catch (err) {
      toast.error(err.message || 'Failed to update publication status.');
    }
  };

  const handleHardPurge = async (item) => {
    const confirmMessage = `Are you certain you want to permanently purge "${item.title}"?\n\nThis will remove the catalog item and decrement CAS blob reference counts.`;
    if (!window.confirm(confirmMessage)) return;

    try {
      await deleteItem({ id: item.id, purge: true });
      toast.success(`"${item.title}" permanently purged from library.`);
    } catch (err) {
      toast.error(err.message || 'Failed to purge material.');
    }
  };

  const handleRunReaper = async () => {
    try {
      const res = await runReaper();
      toast.success(`Orphan reaper completed: ${res.reapedBlobsCount || 0} unreferenced blobs reaped.`);
    } catch (err) {
      toast.error(err.message || 'Failed to run orphan reaper.');
    }
  };

  return (
    <main
      className="h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 p-4 sm:p-6 lg:p-8 space-y-6"
      style={{ contain: 'layout paint', overscrollBehaviorY: 'contain' }}
    >
      {/* 1. Metrics & Storage Quota Banner */}
      <LibraryAdminStatsHeader
        stats={stats}
        isLoading={isStatsLoading}
        onRefresh={() => {
          refetchItems();
          refetchStats();
        }}
        onRunReaper={handleRunReaper}
        isReaping={isReaping}
      />

      {/* 2. Multi-Dimensional Filter Bar */}
      <LibraryAdminFilterBar
        searchQuery={searchInput}
        onSearchChange={setSearchInput}
        category={category}
        onCategoryChange={handleCategoryChange}
        status={status}
        onStatusChange={handleStatusChange}
        departmentId={departmentId}
        onDepartmentChange={handleDepartmentChange}
        onOpenUpload={() => setIsIngestModalOpen(true)}
        onResetFilters={handleResetFilters}
        canFilterDepartment={!isHod}
      />

      {/* 3. Error Boundary View */}
      {isError && (
        <ErrorStateView
          title="Failed to Load Library Catalog"
          message={error?.message || 'Database connection error.'}
          onRetry={refetchItems}
        />
      )}

      {/* 4. High-Density Curation Data Grid */}
      <LibraryAdminTable
        items={items}
        isLoading={isLoading}
        onTogglePublish={handleTogglePublish}
        onHardPurge={handleHardPurge}
        isUpdating={isUpdating}
        isDeleting={isDeleting}
      />

      {/* 5. Pagination Bar */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-500">
          <div>
            Showing page <span className="font-semibold text-slate-900 dark:text-white">{pagination.page}</span> of{' '}
            <span className="font-semibold text-slate-900 dark:text-white">{pagination.totalPages}</span> ({pagination.total} total items)
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => handlePageChange(pagination.page - 1)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>

            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => handlePageChange(pagination.page + 1)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 6. Two-Phase CAS Ingestion Modal */}
      <LibraryIngestModal
        isOpen={isIngestModalOpen}
        onClose={() => setIsIngestModalOpen(false)}
        onUploadBinary={uploadBinary}
        onCommitItem={async (payload) => {
          await commitItem(payload);
          toast.success('Document successfully committed to Digital Library!');
          setIsIngestModalOpen(false);
        }}
        onCancelUpload={cancelUpload}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
        uploadError={uploadError}
        isCommitting={isCommitting}
        commitError={commitError}
      />
    </main>
  );
}

export default AdminLibraryPage;

