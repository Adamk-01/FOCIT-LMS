import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { PDFViewer } from '../components/PDFViewer';
import { useMaterials } from '../hooks/useMaterials';
import { MaterialsHeader } from '../components/materials/MaterialsHeader';
import { MaterialsGrid } from '../components/materials/MaterialsGrid';
import { ErrorStateView } from '../components/ErrorStateView';
import { downloadMaterialFile } from '../lib/fileDownload';

/**
 * Course Materials Presentation Shell
 *
 * Implements:
 * 1. Pure Dumb Presentation Shell (<180 lines strictly enforced)
 * 2. URL State Synchronization (?search=... via { replace: true })
 * 3. Instant 60fps Search Input with Debounced Flush
 * 4. SWR-Preserved Document Catalog (Zero Layout Shift during background revalidation)
 * 5. Streamed PDF Preview with Virtualized Canvas Cleanup
 * 6. Minimum WCAG 44x44px Touch Targets on all Interactive Controls
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function MaterialsPage({ courseId: propCourseId }) {
  const { courseId: paramCourseId } = useParams();
  const savedCourseId = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('focit_last_course_id') : null;
  const courseId =
    propCourseId ||
    (paramCourseId && paramCourseId !== '1'
      ? paramCourseId
      : savedCourseId && savedCourseId !== '1'
      ? savedCourseId
      : 'CSC202');

  useEffect(() => {
    if (courseId && courseId !== '1') {
      try {
        sessionStorage.setItem('focit_last_course_id', courseId);
      } catch {}
    }
  }, [courseId]);

  // 1. URL State Synchronization
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearchQuery = searchParams.get('search') || '';
  const [localSearch, setLocalSearch] = useState(urlSearchQuery);

  const [activePdfId, setActivePdfId] = useState(null);
  const [activeBuffer, setActiveBuffer] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

  // Debounced search sync to URL SearchParams
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (localSearch) next.set('search', localSearch);
          else next.delete('search');
          return next;
        },
        { replace: true }
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [localSearch, setSearchParams]);

  // 2. SWR Data Pipeline
  const {
    data: materials,
    isPending,
    isRevalidating,
    error,
    refetch,
    fetchPdfBinary,
    isPdfLoading,
  } = useMaterials({ courseId, search: urlSearchQuery });

  const handleViewPdf = useCallback(
    async (material) => {
      if (material.type === 'url') {
        window.open(material.url, '_blank', 'noopener,noreferrer');
        return;
      }
      setActivePdfId(material.id);
      const arrayBuffer = await fetchPdfBinary(material, material.url);
      if (arrayBuffer) {
        setActiveBuffer(arrayBuffer);
      } else {
        setActivePdfId(null);
        setActiveBuffer(null);
      }
    },
    [fetchPdfBinary]
  );

  const handleDownload = useCallback(async (material) => {
    setDownloadingId(material.id);
    try {
      await downloadMaterialFile(material);
    } catch {
      toast.error('Failed to download document stream.');
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const closeViewer = useCallback(() => {
    setActivePdfId(null);
    setActiveBuffer(null);
  }, []);

  if (error && !materials) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorStateView
          title="Course Materials Unavailable"
          message={error?.message || 'Could not stream learning materials for this course module.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col h-full relative pb-16">
      {/* 1. Materials Header with Search Input */}
      <MaterialsHeader
        searchQuery={localSearch}
        onSearchChange={setLocalSearch}
        isRevalidating={isRevalidating}
      />

      {/* 2. Responsive Materials Grid */}
      <MaterialsGrid
        materials={materials}
        isPending={isPending}
        activePdfId={activePdfId}
        isPdfLoading={isPdfLoading}
        downloadingId={downloadingId}
        searchQuery={urlSearchQuery}
        onView={handleViewPdf}
        onDownload={handleDownload}
      />

      {/* 3. Streamed PDF Viewer Overlay */}
      {activePdfId && activeBuffer && (
        <PDFViewer
          arrayBuffer={activeBuffer}
          title={materials?.find((m) => m.id === activePdfId)?.title}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}

export default MaterialsPage;
