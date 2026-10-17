import React from 'react';
import { FileText, Download, Eye, ExternalLink } from 'lucide-react';

/**
 * Course Materials Responsive Grid
 *
 * Implements:
 * 1. SWR-preserved materials catalog (Zero Layout Shift)
 * 2. Skeleton fallback for initial hydration
 * 3. Empty state with contextual query feedback
 * 4. Document preview and stream download triggers with WCAG 44px touch targets
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function MaterialsGrid({
  materials = null,
  isPending = false,
  activePdfId = null,
  isPdfLoading = false,
  downloadingId = null,
  searchQuery = '',
  onView,
  onDownload,
}) {
  // 1. Initial Skeleton
  if (isPending && !materials) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-label="Loading materials">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex flex-col items-start gap-4">
            <div className="w-12 h-12 bg-gray-200 rounded-xl animate-pulse" />
            <div className="w-3/4 h-5 bg-gray-200 rounded animate-pulse" />
            <div className="w-1/2 h-4 bg-gray-100 rounded animate-pulse mb-4" />
            <div className="flex gap-2 w-full mt-auto">
              <div className="h-11 bg-gray-100 rounded-xl flex-1 animate-pulse" />
              <div className="h-11 bg-gray-100 rounded-xl w-12 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 2. Empty State
  if (!isPending && materials?.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6 text-gray-400">
          <FileText size={32} aria-hidden="true" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">No materials found</h3>
        <p className="text-gray-500 max-w-sm text-sm">
          {searchQuery
            ? `No documents matched your search "${searchQuery}".`
            : 'Your instructor has not published any materials for this module yet.'}
        </p>
      </div>
    );
  }

  // 3. Populated Grid
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {materials?.map((material) => {
        const isCurrentPdfLoading = isPdfLoading && activePdfId === material.id;
        const isCurrentDownloading = downloadingId === material.id;
        const isUrl = material.type === 'url';

        return (
          <article
            key={material.id}
            className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-shadow group flex flex-col"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-[#0a1142]/5 rounded-xl text-[#0a1142]">
                <FileText size={24} aria-hidden="true" />
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 bg-gray-100 text-gray-700 rounded-full">
                {(material.type || 'PDF').toUpperCase()}
              </span>
            </div>

            <h3 className="font-bold text-gray-900 text-base mb-1 line-clamp-2" title={material.title}>
              {material.title}
            </h3>
            <p className="text-xs text-gray-500 mb-6">
              Added {material.createdAt ? new Date(material.createdAt).toLocaleDateString() : 'Recently'}
            </p>

            <div className="mt-auto flex gap-3">
              <button
                type="button"
                onClick={() => onView(material)}
                disabled={isCurrentPdfLoading}
                className="flex-1 min-h-[44px] flex items-center justify-center gap-2 bg-[#0a1142] hover:bg-[#16258f] text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-colors focus:ring-2 focus:ring-[#ffb81c] focus:outline-none disabled:opacity-70 touch-manipulation"
                aria-label={`View ${material.title}`}
              >
                {isCurrentPdfLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    {isUrl ? <ExternalLink size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                    <span>{isUrl ? 'Open Resource' : 'View Document'}</span>
                  </>
                )}
              </button>

              {!isUrl && (
                <button
                  type="button"
                  onClick={() => onDownload(material)}
                  disabled={isCurrentDownloading}
                  className="min-w-[44px] min-h-[44px] p-2.5 border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-600 rounded-xl transition-colors focus:ring-2 focus:ring-[#ffb81c] focus:outline-none disabled:opacity-50 touch-manipulation flex items-center justify-center"
                  aria-label={`Download ${material.title}`}
                  title="Download PDF"
                >
                  {isCurrentDownloading ? (
                    <div className="w-4 h-4 border-2 border-gray-600/30 border-t-gray-600 rounded-full animate-spin" />
                  ) : (
                    <Download size={18} aria-hidden="true" />
                  )}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default MaterialsGrid;
