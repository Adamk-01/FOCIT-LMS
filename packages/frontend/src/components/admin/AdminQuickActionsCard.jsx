import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, UploadCloud, ShieldAlert, Users, ChevronRight } from 'lucide-react';

/**
 * Admin Quick Actions Card
 *
 * Implements:
 * 1. 3 spacious, clickable action tiles matching the approved mockup
 * 2. Visual icons, clear headings, explanatory subtext, and chevron navigation
 * 3. Deep-links to Level Advisor review and opens focused administrative modals
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function AdminQuickActionsCard({
  onOpenCohortModal,
  onOpenAuditModal,
  onOpenUserDirectory,
}) {
  const navigate = useNavigate();

  return (
    <div className="bg-white rounded-2xl p-6 sm:p-7 border border-gray-200/80 shadow-sm flex flex-col h-full">
      {/* Header */}
      <div className="pb-5 border-b border-gray-100">
        <h2 className="text-base sm:text-lg font-bold text-[#0a1142] font-display">
          Quick Administrative Actions
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Frequently used governance and compliance tasks
        </p>
      </div>

      {/* Action Tiles */}
      <div className="mt-4 flex flex-col gap-3 flex-1 justify-center">
        {/* Action 1: Registration Clearance */}
        <button
          type="button"
          onClick={() => navigate('/advisor/registrations')}
          className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-[#0a1142]/40 hover:bg-slate-50/80 transition-all flex items-center justify-between group touch-manipulation min-h-[56px]"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0 group-hover:bg-[#0a1142] group-hover:text-white transition-colors">
              <ClipboardCheck size={20} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-gray-900 group-hover:text-[#0a1142]">
                Course Registration Clearance
              </h3>
              <p className="text-[11px] text-gray-500">
                Review advisor endorsements & Senate clearance
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-400 group-hover:text-[#0a1142] transition-transform group-hover:translate-x-0.5" />
        </button>

        {/* Action 2: Bulk Cohort Ingestion */}
        <button
          type="button"
          onClick={onOpenCohortModal}
          className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-[#0a1142]/40 hover:bg-slate-50/80 transition-all flex items-center justify-between group touch-manipulation min-h-[56px]"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 shrink-0 group-hover:bg-[#0a1142] group-hover:text-white transition-colors">
              <UploadCloud size={20} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-gray-900 group-hover:text-[#0a1142]">
                Bulk Cohort Ingestion
              </h3>
              <p className="text-[11px] text-gray-500">
                Import admission roster spreadsheet (CSV)
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-400 group-hover:text-[#0a1142] transition-transform group-hover:translate-x-0.5" />
        </button>

        {/* Action 3: Security Audit Ledger */}
        <button
          type="button"
          onClick={onOpenAuditModal}
          className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-[#0a1142]/40 hover:bg-slate-50/80 transition-all flex items-center justify-between group touch-manipulation min-h-[56px]"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 shrink-0 group-hover:bg-[#0a1142] group-hover:text-white transition-colors">
              <ShieldAlert size={20} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-gray-900 group-hover:text-[#0a1142]">
                Security Audit Ledger
              </h3>
              <p className="text-[11px] text-gray-500">
                Inspect immutable Senate identity logs
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-400 group-hover:text-[#0a1142] transition-transform group-hover:translate-x-0.5" />
        </button>

        {/* Action 4: User Directory & Permissions */}
        <button
          type="button"
          onClick={onOpenUserDirectory}
          className="w-full text-left p-4 rounded-xl border border-gray-200 hover:border-[#0a1142]/40 hover:bg-slate-50/80 transition-all flex items-center justify-between group touch-manipulation min-h-[56px]"
        >
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-700 shrink-0 group-hover:bg-[#0a1142] group-hover:text-white transition-colors">
              <Users size={20} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-gray-900 group-hover:text-[#0a1142]">
                User Directory & Accounts
              </h3>
              <p className="text-[11px] text-gray-500">
                Search students, staff, and toggle account statuses
              </p>
            </div>
          </div>
          <ChevronRight size={16} className="text-gray-400 group-hover:text-[#0a1142] transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
