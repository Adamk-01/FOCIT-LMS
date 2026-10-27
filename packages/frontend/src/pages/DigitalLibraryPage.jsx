import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api.js';
import { downloadMaterialFile } from '../lib/fileDownload.js';
import { LibraryHero } from '../components/library/LibraryHero.jsx';
import { LibraryCategoryBar } from '../components/library/LibraryCategoryBar.jsx';
import { MultiDimensionalFilterBar } from '../components/library/MultiDimensionalFilterBar.jsx';
import { LibraryItemCard } from '../components/library/LibraryItemCard.jsx';
import { LibraryEmptyState } from '../components/library/LibraryEmptyState.jsx';
import { LibraryGridSkeleton } from '../components/library/LibraryGridSkeleton.jsx';
import { ErrorStateView } from '../components/ErrorStateView.jsx';
import { AlertTriangle, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';

// Lazy-load PDF viewer chunk to decouple 1.5MB PDF.js bundle from the main page payload (Invariant 6 & Grill Checkpoint #8)
const PDFViewerModal = lazy(() => import('../components/library/PDFViewerModal.jsx'));

export function DigitalLibraryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  // 1. Dual-State Partitioning (URL SearchParams is Single Source of Truth)
  const category = searchParams.get('category') || 'courses';
  const courseId = searchParams.get('courseId') || '';
  const departmentId = searchParams.get('departmentId') || '';
  const level = searchParams.get('level') || '';
  const session = searchParams.get('session') || '';
  const semester = searchParams.get('semester') || '';
  const itemType = searchParams.get('itemType') || '';
  const queryTerm = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));

  // Local state for debounced search input & modal preview
  const [searchInput, setSearchInput] = useState(queryTerm);
  const [previewItem, setPreviewItem] = useState(null);
  const [isRevalidatingMoodle, setIsRevalidatingMoodle] = useState(false);

  // Synchronize local search input if URL changes externally
  useEffect(() => {
    setSearchInput(queryTerm);
  }, [queryTerm]);

  // Debounced search sync to URL SearchParams (350ms debounce)
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
          // Invariant 2: Atomically reset page=1 on query mutation
          next.set('page', '1');
          return next;
        }, { replace: true });
      }
    }, 350);

    return () => clearTimeout(handler);
  }, [searchInput, queryTerm, setSearchParams]);

  // Atomic Filter Mutation Handler (Guarantees Invariant 2: Always resets page=1)
  const handleFilterChange = useCallback((key, value) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      // Always reset page to 1 when changing filters to prevent out-of-bounds offset pagination
      next.set('page', '1');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Category Tab Selection
  const handleSelectCategory = useCallback((newCategory) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('category', newCategory);
      // Reset contextual filters that belong to other categories
      if (newCategory !== 'courses') next.delete('courseId');
      if (newCategory !== 'past_questions') {
        next.delete('session');
        next.delete('semester');
      }
      if (newCategory !== 'faculty_resources') next.delete('itemType');
      // Invariant 2: Atomically reset pagination
      next.set('page', '1');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Clear all active filters
  const handleResetFilters = useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams();
      next.set('category', category); // Keep current category
      return next;
    }, { replace: true });
    setSearchInput('');
  }, [category, setSearchParams]);

  const hasActiveFilters = Boolean(
    departmentId || level || session || semester || courseId || itemType || queryTerm
  );

  // 2. Data Fetching: Taxonomy Categories
  const { data: categories = [] } = useQuery({
    queryKey: ['library-categories'],
    queryFn: async () => {
      const res = await apiClient.get('/library/categories');
      return res.data?.data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // 3. Data Fetching: Courses Catalog (for Course picker in Course Materials tab)
  const { data: courseCatalog = [] } = useQuery({
    queryKey: ['library-courses-catalog'],
    queryFn: async () => {
      const res = await apiClient.get('/library/courses/catalog');
      return res.data?.data || [];
    },
    staleTime: 5 * 60 * 1000,
  });

  // 4. Data Fetching: Repository Items
  const itemsParams = useMemo(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (courseId) params.set('courseId', courseId);
    if (departmentId) params.set('departmentId', departmentId);
    if (level) params.set('level', level);
    if (session) params.set('session', session);
    if (semester) params.set('semester', semester);
    if (itemType) params.set('itemType', itemType);
    if (queryTerm) params.set('q', queryTerm);
    params.set('page', String(page));
    params.set('limit', '12');
    return params.toString();
  }, [category, courseId, departmentId, level, session, semester, itemType, queryTerm, page]);

  const {
    data: itemsResponse,
    isLoading,
    isError,
    error,
    refetch: refetchItems,
  } = useQuery({
    queryKey: ['library-items', itemsParams],
    queryFn: async () => {
      const res = await apiClient.get(`/library/items?${itemsParams}`);
      return res.data;
    },
    staleTime: 60 * 1000,
  });

  const items = itemsResponse?.data || [];
  const meta = itemsResponse?.meta || { total: 0, totalPages: 1, page: 1, _degraded: false };

  // Manual retry handler for degraded Moodle sync
  const handleRetryMoodleSync = async () => {
    setIsRevalidatingMoodle(true);
    try {
      await refetchItems();
    } finally {
      setIsRevalidatingMoodle(false);
    }
  };

  // Secure File Download with Mutation Lock
  const handleDownload = async (item) => {
    const downloadUrl = `/api/library/items/${item.id}/stream?download=true`;
    await downloadMaterialFile({
      url: downloadUrl,
      title: item.title,
      filename: `${item.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`,
    });
  };

  // Active Category Name
  const activeCategoryObj = categories.find((c) => c.id === category);
  const activeCategoryName = activeCategoryObj?.name || 'Academic Repository';

  return (
    <div className="space-y-6 sm:space-y-7 pb-12">
      {/* 1. Header Hero with Live Search & Statistics Chips */}
        <LibraryHero
          searchQuery={searchInput}
          onSearchChange={setSearchInput}
          totalCount={meta.total}
          activeCategoryName={activeCategoryName}
        />

        {/* 2. Taxonomy Category Tabs (<nav>) */}
        <LibraryCategoryBar
          categories={categories}
          activeCategoryId={category}
          onSelectCategory={handleSelectCategory}
        />

        {/* 3. Multi-Dimensional Filter Bar */}
        <MultiDimensionalFilterBar
          category={category}
          departmentId={departmentId}
          level={level}
          session={session}
          semester={semester}
          courseId={courseId}
          itemType={itemType}
          courseCatalog={courseCatalog}
          onFilterChange={handleFilterChange}
          onResetFilters={handleResetFilters}
          hasActiveFilters={hasActiveFilters}
        />

        {/* 4. Graceful Degradation Banner (Invariant 6 Composite Aggregation) */}
        {meta._degraded && (
          <div 
            role="status" 
            aria-live="polite"
            className="flex items-center justify-between p-3.5 mb-6 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 text-xs sm:text-sm animate-in fade-in"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
              <span>
                Upstream Moodle course room sync timed out (&gt;1,500ms). Displaying verified faculty repository items 
                {meta.sources?.moodle?.staleFallback ? ' and cached course notes.' : '.'}
              </span>
            </div>
            <button
              type="button"
              onClick={handleRetryMoodleSync}
              disabled={isRevalidatingMoodle}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 font-semibold transition-colors disabled:opacity-50 shrink-0"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isRevalidatingMoodle ? 'animate-spin' : ''}`} />
              <span>{isRevalidatingMoodle ? 'Re-syncing...' : 'Re-sync'}</span>
            </button>
          </div>
        )}

        {/* 5. Main Content Area */}
        {isLoading ? (
          <LibraryGridSkeleton count={8} />
        ) : isError ? (
          <ErrorStateView
            error={error}
            onRetry={refetchItems}
            title="Failed to Load Library Repository"
            message="Could not retrieve academic resources from the faculty database. Please check your connection and retry."
          />
        ) : items.length === 0 ? (
          <LibraryEmptyState
            searchQuery={queryTerm}
            onClearFilters={handleResetFilters}
          />
        ) : (
          <>
            {/* Card Grid (Spacious 1/2/3 Column Layout) */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 sm:gap-7">
              {items.map((item) => (
                <LibraryItemCard
                  key={item.id}
                  item={item}
                  onPreview={setPreviewItem}
                  onDownload={handleDownload}
                />
              ))}
            </div>

            {/* Deterministic Pagination Bar */}
            {meta.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 mt-8 pt-4 pb-6">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Showing page <span className="font-semibold text-slate-900 dark:text-white">{page}</span> of{' '}
                  <span className="font-semibold text-slate-900 dark:text-white">{meta.totalPages}</span> ({meta.total} total items)
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleFilterChange('page', String(page - 1))}
                    disabled={page <= 1}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </button>

                  <div className="flex items-center gap-1">
                    {Array.from({ length: meta.totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === meta.totalPages || Math.abs(p - page) <= 1)
                      .map((p, idx, arr) => (
                        <React.Fragment key={p}>
                          {idx > 0 && p - arr[idx - 1] > 1 && (
                            <span className="px-1 text-xs text-slate-400">…</span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleFilterChange('page', String(p))}
                            className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors ${
                              p === page
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                            }`}
                          >
                            {p}
                          </button>
                        </React.Fragment>
                      ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleFilterChange('page', String(page + 1))}
                    disabled={page >= meta.totalPages}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* 6. PDF Streaming Preview Modal (Code-Split Lazy Chunk Boundary) */}
        {previewItem && (
          <Suspense fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm" role="status" aria-live="polite">
              <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-slate-900 border border-slate-800 text-white shadow-2xl">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm font-medium text-slate-300">Initializing PDF Reader...</span>
              </div>
            </div>
          }>
            <PDFViewerModal
              item={previewItem}
              onClose={() => setPreviewItem(null)}
              onDownload={handleDownload}
            />
          </Suspense>
        )}
    </div>
  );
}

export default DigitalLibraryPage;
