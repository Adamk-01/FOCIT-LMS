import React from 'react';
import { Search } from 'lucide-react';

/**
 * Course Materials Header with Live SWR Sync Indicator & Debounced Search
 *
 * Implements:
 * 1. Title with background revalidation pulse indicator
 * 2. Instant 60fps search input with WCAG minimum 44px touch targets
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function MaterialsHeader({
  searchQuery = '',
  onSearchChange,
  isRevalidating = false,
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-[#0a1142] font-display">Course Materials</h1>
          {isRevalidating && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" aria-hidden="true" />
              Syncing in background...
            </span>
          )}
        </div>
        <p className="text-gray-500 mt-1 text-sm font-medium">Securely streamed via FOCIT LMS</p>
      </div>

      <div className="relative max-w-md w-full">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search size={18} className="text-gray-400" aria-hidden="true" />
        </div>
        <input
          type="text"
          className="block w-full min-h-[44px] pl-10 pr-3 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142] focus:border-[#0a1142] transition-colors text-sm"
          placeholder="Search lectures, slides..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search course materials"
        />
      </div>
    </div>
  );
}

export default MaterialsHeader;
