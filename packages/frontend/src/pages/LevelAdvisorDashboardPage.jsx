/**
 * FOCIT LMS - Level Advisor Course Registration Review & Clearance Dashboard
 *
 * Implements:
 * 1. Cohort Multi-Filter Bar (Level 100-400, Status SUBMITTED/ADVISOR_APPROVED/REJECTED)
 * 2. Multi-Select Cohort Ledger with Select-All & Unit Badges
 * 3. The Mutex Disable on Bulk Actions:
 *    - Immediately disables submit button, displays deterministic spinner, and blocks interactions
 *    - Invokes POST /api/registration/advisor/batch-approve (Dijkstra-ordered DAG)
 *    - Invalidates cohort query cache on 200 OK
 * 4. Rejection Modal with Senate Audit Remarks (POST /api/registration/advisor/reject)
 *    - Idempotent Replay Resilience
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../lib/api';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  UserCheck,
  RefreshCw,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Info,
  Check,
  AlertTriangle,
  Send,
  Eye,
  X,
} from 'lucide-react';

export const LevelAdvisorDashboardPage = () => {
  const { user } = useAuth();
  const advisorId = user?.username || 'advisor1';
  const queryClient = useQueryClient();

  // Filter States
  const [selectedLevel, setSelectedLevel] = useState('200');
  const [selectedStatus, setSelectedStatus] = useState('SUBMITTED');
  const [selectedBatchIds, setSelectedBatchIds] = useState([]);

  // Inspection Drawer State (view student's selected courses)
  const [inspectingBatch, setInspectingBatch] = useState(null);

  // Rejection Modal State
  const [rejectionTarget, setRejectionTarget] = useState(null);
  const [rejectionRemarks, setRejectionRemarks] = useState('');
  const [rejectionError, setRejectionError] = useState(null);

  // 1. Fetch Cohort Data from BFF (GET /api/registration/advisor/cohort)
  const {
    data: cohortData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['advisor-cohort', selectedLevel, selectedStatus],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (selectedLevel) params.append('level', selectedLevel);
      if (selectedStatus && selectedStatus !== 'ALL') params.append('status', selectedStatus);

      const res = await apiClient.get(`/registration/advisor/cohort?${params.toString()}`, {
        signal,
      });
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const cohort = useMemo(() => cohortData?.cohort || [], [cohortData]);
  const semester = cohortData?.semester;
  const advisor = cohortData?.advisor;

  // 2. Multi-Select Handlers
  const handleToggleBatch = (batchId) => {
    setSelectedBatchIds((prev) =>
      prev.includes(batchId) ? prev.filter((id) => id !== batchId) : [...prev, batchId]
    );
  };

  const handleSelectAll = () => {
    const actionable = cohort.filter((b) => b.status === 'SUBMITTED').map((b) => b.batch_id);
    if (selectedBatchIds.length === actionable.length) {
      setSelectedBatchIds([]);
    } else {
      setSelectedBatchIds(actionable);
    }
  };

  // 3. Mutex Disable on Bulk Approval (POST /api/registration/advisor/batch-approve)
  const batchApproveMutation = useMutation({
    mutationFn: async (batchIds) => {
      const res = await apiClient.post('/registration/advisor/batch-approve', {
        batch_ids: batchIds,
      });
      return res.data;
    },
    onSuccess: () => {
      setSelectedBatchIds([]);
      queryClient.invalidateQueries({ queryKey: ['advisor-cohort'] });
    },
  });

  // 4. Rejection Mutation (POST /api/registration/advisor/reject)
  const rejectMutation = useMutation({
    mutationFn: async ({ batchId, remarks }) => {
      const res = await apiClient.post('/registration/advisor/reject', {
        batch_id: batchId,
        remarks,
      });
      return res.data;
    },
    onSuccess: () => {
      setRejectionTarget(null);
      setRejectionRemarks('');
      setRejectionError(null);
      queryClient.invalidateQueries({ queryKey: ['advisor-cohort'] });
    },
    onError: (err) => {
      setRejectionError(
        err?.response?.data?.error || err.message || 'Failed to reject registration.'
      );
    },
  });

  const handleOpenRejection = (batch) => {
    setRejectionTarget(batch);
    setRejectionRemarks('');
    setRejectionError(null);
  };

  const handleConfirmRejection = () => {
    if (!rejectionRemarks || rejectionRemarks.trim().length < 5) {
      setRejectionError('Rejection remarks must be at least 5 characters for Senate audit logging.');
      return;
    }
    rejectMutation.mutate({
      batchId: rejectionTarget.batch_id,
      remarks: rejectionRemarks.trim(),
    });
  };

  const isActionLocked = batchApproveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto pb-20">
      {/* 1. Header Banner */}
      <header className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#0a1142]/10 text-[#0a1142] mb-1">
              <ShieldCheck size={14} className="text-[#0a1142]" />
              <span>Level Advisor Governance Portal • Senate Clearance Engine</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#0a1142] font-display">
              Course Registration Clearance Cohort
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Review, endorse, or return student registration submissions for Level {selectedLevel}.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 font-bold text-gray-800">
              {semester?.name || '2026/2027 Rain Semester'}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isLoading || isActionLocked}
              className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors disabled:opacity-50"
              title="Refresh Cohort Data"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="mt-6 pt-5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mr-1 flex items-center gap-1">
              <Filter size={12} />
              Level:
            </span>
            {['100', '200', '300', '400'].map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setSelectedLevel(lvl)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  selectedLevel === lvl
                    ? 'bg-[#0a1142] text-[#ffb81c] shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {lvl} Level
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider mr-1">
              Status:
            </span>
            {[
              { id: 'SUBMITTED', label: 'Pending Review' },
              { id: 'ADVISOR_APPROVED', label: 'Approved' },
              { id: 'REJECTED', label: 'Rejected' },
              { id: 'ALL', label: 'All Batches' },
            ].map((st) => (
              <button
                key={st.id}
                type="button"
                onClick={() => setSelectedStatus(st.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  selectedStatus === st.id
                    ? 'bg-[#0a1142] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 2. Feedback Alert on Mutation Errors */}
      {batchApproveMutation.isError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs flex items-center gap-2">
          <AlertCircle size={16} className="text-red-600 shrink-0" />
          <span>
            {batchApproveMutation.error?.response?.data?.error ||
              batchApproveMutation.error?.message ||
              'Bulk approval transaction failed.'}
          </span>
        </div>
      )}

      {/* 3. Cohort Table View */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-3">
            <RefreshCw size={32} className="animate-spin text-[#0a1142]" />
            <span className="text-xs font-semibold text-gray-500">
              Querying Level Advisor cohort records...
            </span>
          </div>
        ) : cohort.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-2">
            <CheckCircle2 size={36} className="text-gray-300" />
            <h3 className="text-sm font-bold text-gray-700">No Registrations in Cohort</h3>
            <p className="text-xs text-gray-500 max-w-sm">
              There are no student registration batches matching Level {selectedLevel} with status {selectedStatus}.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead className="bg-gray-100 text-gray-700 text-xs uppercase tracking-wider font-bold border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4 w-12 text-center">
                    <input
                      type="checkbox"
                      checked={
                        cohort.filter((b) => b.status === 'SUBMITTED').length > 0 &&
                        selectedBatchIds.length ===
                          cohort.filter((b) => b.status === 'SUBMITTED').length
                      }
                      disabled={
                        cohort.filter((b) => b.status === 'SUBMITTED').length === 0 ||
                        isActionLocked
                      }
                      onChange={handleSelectAll}
                      className="w-4 h-4 rounded text-[#0a1142] focus:ring-[#0a1142] border-gray-300 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">Matric No</th>
                  <th className="py-3 px-4">Programme</th>
                  <th className="py-3 px-4">CGPA</th>
                  <th className="py-3 px-4">Units</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cohort.map((row) => {
                  const isSelected = selectedBatchIds.includes(row.batch_id);
                  const isActionable = row.status === 'SUBMITTED';

                  return (
                    <tr
                      key={row.batch_id}
                      className={`transition-colors ${
                        isSelected ? 'bg-[#0a1142]/5' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!isActionable || isActionLocked}
                          onChange={() => handleToggleBatch(row.batch_id)}
                          className="w-4 h-4 rounded text-[#0a1142] focus:ring-[#0a1142] border-gray-300 cursor-pointer disabled:opacity-40"
                        />
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-[#0a1142] block">
                          {row.student_name}
                        </span>
                        <span className="text-[11px] text-gray-500">{row.student_id}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-gray-800">
                        {row.matric_number}
                      </td>
                      <td className="py-3 px-4 text-xs text-gray-700">
                        {row.programme_name}
                      </td>
                      <td className="py-3 px-4 font-bold text-xs text-gray-800">
                        {row.current_gpa || '—'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-extrabold text-[#0a1142] text-xs">
                          {row.total_units} Units
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                            row.status === 'ADVISOR_APPROVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : row.status === 'SUBMITTED'
                              ? 'bg-amber-100 text-amber-800'
                              : row.status === 'REJECTED'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setInspectingBatch(row)}
                            className="p-1.5 rounded-lg text-gray-500 hover:text-[#0a1142] hover:bg-gray-100 transition-colors"
                            title="Inspect Registered Modules"
                          >
                            <Eye size={16} />
                          </button>

                          {isActionable && (
                            <>
                              <button
                                type="button"
                                disabled={isActionLocked}
                                onClick={() => batchApproveMutation.mutate([row.batch_id])}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
                              >
                                Endorse
                              </button>
                              <button
                                type="button"
                                disabled={isActionLocked}
                                onClick={() => handleOpenRejection(row)}
                                className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. THE MUTEX DISABLE ON BULK APPROVAL (Sticky Footer Action Bar) */}
      {selectedBatchIds.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-8 sm:w-auto z-40 bg-[#0a1142] text-white px-6 py-4 rounded-2xl shadow-2xl border border-[#ffb81c]/30 flex items-center justify-between sm:justify-start gap-6 animate-fade-in">
          <div className="flex items-center gap-3">
            <UserCheck size={20} className="text-[#ffb81c]" />
            <div>
              <span className="text-sm font-bold block">
                {selectedBatchIds.length} Student(s) Selected
              </span>
              <span className="text-[11px] text-gray-300">
                Ready for Dijkstra-ordered bulk endorsement
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isActionLocked}
              onClick={() => setSelectedBatchIds([])}
              className="px-3 py-2 rounded-xl text-xs text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={isActionLocked}
              onClick={() => batchApproveMutation.mutate(selectedBatchIds)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#ffb81c] to-[#e5a200] text-[#0a1142] text-xs font-extrabold hover:brightness-105 transition-all shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {batchApproveMutation.isPending ? (
                <>
                  <RefreshCw size={14} className="animate-spin text-[#0a1142]" />
                  <span>Securing Dijkstra Locks...</span>
                </>
              ) : (
                <>
                  <Check size={14} />
                  <span>Approve Selected ({selectedBatchIds.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* 5. Course Inspection Modal */}
      {inspectingBatch && (
        <div className="fixed inset-0 z-50 bg-[#040617]/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-gray-200 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-gray-50">
              <div>
                <h3 className="text-base font-bold text-[#0a1142]">
                  Course Matrix: {inspectingBatch.student_name}
                </h3>
                <span className="text-xs text-gray-500">
                  {inspectingBatch.matric_number} • {inspectingBatch.total_units} Total Units
                </span>
              </div>
              <button
                type="button"
                onClick={() => setInspectingBatch(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto divide-y divide-gray-100 flex-1">
              {Array.isArray(inspectingBatch.items) && inspectingBatch.items.length > 0 ? (
                inspectingBatch.items.map((item, idx) => (
                  <div key={idx} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#0a1142] text-sm">{item.code}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-gray-100 text-gray-700">
                          {item.category}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 mt-0.5">{item.title}</p>
                    </div>
                    <span className="text-xs font-bold text-gray-800">{item.units} Units</span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-gray-500 py-4 text-center">
                  No courses listed in this registration batch.
                </p>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 text-right">
              <button
                type="button"
                onClick={() => setInspectingBatch(null)}
                className="px-4 py-2 bg-[#0a1142] text-white rounded-xl text-xs font-bold"
              >
                Close Inspection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Rejection Modal with Senate Audit Remarks */}
      {rejectionTarget && (
        <div className="fixed inset-0 z-50 bg-[#040617]/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full flex flex-col shadow-2xl border border-gray-200 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-red-50/50">
              <div className="flex items-center gap-2">
                <AlertTriangle size={20} className="text-red-600" />
                <h3 className="text-base font-bold text-red-950">
                  Return Registration to Student
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRejectionTarget(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-gray-600 leading-relaxed">
                Rejecting this batch releases reserved seat capacity and returns the registration to <strong>{rejectionTarget.student_name}</strong> for modification. Mandatory descriptive remarks are written to the immutable Senate audit ledger.
              </p>

              {rejectionError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
                  {rejectionError}
                </div>
              )}

              <div>
                <label
                  htmlFor="rejection-remarks"
                  className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2"
                >
                  Senate Audit Remarks (Minimum 5 characters) *
                </label>
                <textarea
                  id="rejection-remarks"
                  rows={3}
                  value={rejectionRemarks}
                  onChange={(e) => setRejectionRemarks(e.target.value)}
                  placeholder="e.g. Please add core GST 204 Entrepreneurship before approval."
                  className="w-full text-xs p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142] focus:border-transparent outline-none resize-none"
                />
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={rejectMutation.isPending}
                onClick={() => setRejectionTarget(null)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-100"
              >
                Cancel
              </button>

              <button
                type="button"
                disabled={rejectMutation.isPending || rejectionRemarks.trim().length < 5}
                onClick={handleConfirmRejection}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex items-center gap-2"
              >
                {rejectMutation.isPending ? (
                  <>
                    <RefreshCw size={14} className="animate-spin text-white" />
                    <span>Reverting Capacity...</span>
                  </>
                ) : (
                  <span>Confirm Rejection</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
