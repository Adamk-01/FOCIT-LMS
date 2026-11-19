import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import { 
  CheckCircle2, 
  XCircle, 
  Clock, 
  AlertCircle, 
  UserCheck, 
  Search, 
  Filter, 
  CheckCheck,
  RefreshCw
} from 'lucide-react';

export function CourseRegistrationApprovalsPanel({ courses = [], selectedCourseId, onSelectCourseId }) {
  const queryClient = useQueryClient();
  const [filterStatus, setFilterStatus] = useState('PENDING'); // 'PENDING' | 'ALL' | 'APPROVED' | 'REJECTED'
  const [searchTerm, setSearchTerm] = useState('');
  const [rejectingItem, setRejectingItem] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);

  const activeCourseId = selectedCourseId || courses[0]?.course_id;

  // 1. Fetch Registrations Queue for Selected Course
  const { 
    data: queueData, 
    isLoading, 
    isFetching,
    error, 
    refetch 
  } = useQuery({
    queryKey: ['lecturer-course-registrations', activeCourseId],
    queryFn: async () => {
      if (!activeCourseId) return null;
      const res = await apiClient.get(`/lecturer/courses/${encodeURIComponent(activeCourseId)}/registrations`);
      return res.data;
    },
    enabled: Boolean(activeCourseId),
    staleTime: 10000,
  });

  // 2. Accept Mutation
  const acceptMutation = useMutation({
    mutationFn: async (itemId) => {
      const res = await apiClient.post(`/lecturer/courses/${encodeURIComponent(activeCourseId)}/registrations/${encodeURIComponent(itemId)}/accept`);
      return res.data;
    },
    onSuccess: (data) => {
      setActionSuccess(data.message || 'Registration accepted successfully');
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['lecturer-course-registrations', activeCourseId] });
      queryClient.invalidateQueries({ queryKey: ['lecturer-courses'] });
      setTimeout(() => setActionSuccess(null), 4000);
    },
    onError: (err) => {
      setActionError(err.response?.data?.error || 'Failed to accept registration');
    },
  });

  // 3. Reject Mutation
  const rejectMutation = useMutation({
    mutationFn: async ({ itemId, reason }) => {
      const res = await apiClient.post(`/lecturer/courses/${encodeURIComponent(activeCourseId)}/registrations/${encodeURIComponent(itemId)}/reject`, {
        reason,
      });
      return res.data;
    },
    onSuccess: (data) => {
      setActionSuccess(data.message || 'Registration rejected');
      setActionError(null);
      setRejectingItem(null);
      setRejectionReason('');
      queryClient.invalidateQueries({ queryKey: ['lecturer-course-registrations', activeCourseId] });
      queryClient.invalidateQueries({ queryKey: ['lecturer-courses'] });
      setTimeout(() => setActionSuccess(null), 4000);
    },
    onError: (err) => {
      setActionError(err.response?.data?.error || 'Failed to reject registration');
    },
  });

  // 4. Batch Accept Mutation
  const batchAcceptMutation = useMutation({
    mutationFn: async (itemIds) => {
      const res = await apiClient.post(`/lecturer/courses/${encodeURIComponent(activeCourseId)}/registrations/batch-accept`, {
        itemIds,
      });
      return res.data;
    },
    onSuccess: (data) => {
      setActionSuccess(`Successfully accepted ${data.acceptedCount} registration(s)`);
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['lecturer-course-registrations', activeCourseId] });
      queryClient.invalidateQueries({ queryKey: ['lecturer-courses'] });
      setTimeout(() => setActionSuccess(null), 4000);
    },
    onError: (err) => {
      setActionError(err.response?.data?.error || 'Failed to batch accept registrations');
    },
  });

  const registrations = queueData?.registrations || [];
  const counts = queueData?.counts || { pending: 0, approved: 0, rejected: 0, total: 0 };
  const currentCourse = queueData?.course || courses.find(c => c.course_id === activeCourseId);

  // Filter registrations
  const filteredRegistrations = registrations.filter((reg) => {
    // Status filter
    if (filterStatus === 'PENDING' && reg.status !== 'PENDING_LECTURER') return false;
    if (filterStatus === 'APPROVED' && reg.status !== 'APPROVED') return false;
    if (filterStatus === 'REJECTED' && reg.status !== 'REJECTED') return false;

    // Search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchName = (reg.full_name || '').toLowerCase().includes(term);
      const matchMatric = (reg.matric_number || '').toLowerCase().includes(term);
      const matchProg = (reg.programme_name || '').toLowerCase().includes(term);
      return matchName || matchMatric || matchProg;
    }
    return true;
  });

  const pendingItemIds = registrations.filter(r => r.status === 'PENDING_LECTURER').map(r => r.item_id);

  return (
    <div className="space-y-6">
      {/* Header & Course Switcher */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <UserCheck className="text-[#0a1142]" size={22} />
            <h2 className="text-lg font-bold text-gray-900 font-display">
              Course Registration Clearance Desk
            </h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Authoritative approval authority: Only assigned primary and co-lecturers can accept or decline students for this course.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="course-select" className="text-xs font-semibold text-gray-700 shrink-0">
            Select Course:
          </label>
          <select
            id="course-select"
            value={activeCourseId || ''}
            onChange={(e) => onSelectCourseId(e.target.value)}
            className="text-xs font-bold bg-gray-50 border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-[#0a1142] focus:outline-hidden"
          >
            {courses.map((c) => (
              <option key={c.course_id} value={c.course_id}>
                {c.code} — {c.title} {c.pending_registrations_count ? `(${c.pending_registrations_count} Pending)` : ''}
              </option>
            ))}
          </select>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh queue"
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw size={16} className={isFetching ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-amber-800">Pending Review</p>
            <p className="text-2xl font-black text-amber-900 mt-0.5">{counts.pending}</p>
          </div>
          <Clock className="text-amber-600" size={24} />
        </div>

        <div className="bg-green-50/70 border border-green-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-green-800">Accepted & Enrolled</p>
            <p className="text-2xl font-black text-green-900 mt-0.5">{counts.approved}</p>
          </div>
          <CheckCircle2 className="text-green-600" size={24} />
        </div>

        <div className="bg-red-50/70 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-red-800">Declined</p>
            <p className="text-2xl font-black text-red-900 mt-0.5">{counts.rejected}</p>
          </div>
          <XCircle className="text-red-600" size={24} />
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-700">Course Capacity</p>
            <p className="text-xl font-bold text-slate-900 mt-0.5">
              {currentCourse?.enrolled_count ?? 0} / {currentCourse?.max_capacity ?? 100}
            </p>
          </div>
          <span className="text-xs font-bold px-2 py-1 rounded bg-slate-200 text-slate-700">
            {Math.round(((currentCourse?.enrolled_count ?? 0) / (currentCourse?.max_capacity || 100)) * 100)}%
          </span>
        </div>
      </div>

      {/* Feedback Alerts */}
      {actionSuccess && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-xs font-semibold text-green-800 flex items-center gap-2">
          <CheckCircle2 size={16} />
          <span>{actionSuccess}</span>
        </div>
      )}

      {actionError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs font-semibold text-red-800 flex items-center gap-2">
          <AlertCircle size={16} />
          <span>{actionError}</span>
        </div>
      )}

      {/* Filters & Actions Bar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilterStatus('PENDING')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filterStatus === 'PENDING'
                ? 'bg-[#0a1142] text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Pending ({counts.pending})
          </button>
          <button
            onClick={() => setFilterStatus('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filterStatus === 'ALL'
                ? 'bg-[#0a1142] text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All Applicants ({counts.total})
          </button>
          <button
            onClick={() => setFilterStatus('APPROVED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filterStatus === 'APPROVED'
                ? 'bg-[#0a1142] text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Accepted ({counts.approved})
          </button>
          <button
            onClick={() => setFilterStatus('REJECTED')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              filterStatus === 'REJECTED'
                ? 'bg-[#0a1142] text-white shadow-xs'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Declined ({counts.rejected})
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <input
              type="text"
              placeholder="Search student or matric..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full text-xs pl-8 pr-3 py-2 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0a1142] focus:outline-hidden"
            />
          </div>

          {pendingItemIds.length > 0 && (
            <button
              onClick={() => batchAcceptMutation.mutate(pendingItemIds)}
              disabled={batchAcceptMutation.isPending}
              className="bg-green-700 hover:bg-green-800 text-white text-xs font-bold py-2 px-3 rounded-lg flex items-center gap-1.5 shadow-xs transition-colors shrink-0"
            >
              <CheckCheck size={14} />
              <span>Accept All ({pendingItemIds.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Registrations Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-gray-500 text-xs">Loading course registration requests...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-600 text-xs font-semibold">
            {error.response?.data?.error || 'Failed to load registration applications.'}
          </div>
        ) : filteredRegistrations.length === 0 ? (
          <div className="p-12 text-center text-gray-500">
            <UserCheck className="mx-auto text-gray-300 mb-2" size={32} />
            <p className="text-sm font-semibold text-gray-700">No course registration records found</p>
            <p className="text-xs text-gray-400 mt-1">
              {filterStatus === 'PENDING' ? 'All student applications have been reviewed.' : 'No applicants match the current filter criteria.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4">Student Details</th>
                  <th className="py-3 px-4">Matric Number</th>
                  <th className="py-3 px-4">Level & Programme</th>
                  <th className="py-3 px-4">Cumulative CGPA</th>
                  <th className="py-3 px-4">Submitted At</th>
                  <th className="py-3 px-4">Approval Status</th>
                  <th className="py-3 px-4 text-right">Instructor Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRegistrations.map((reg) => (
                  <tr key={reg.item_id} className="hover:bg-gray-50/70 transition-colors">
                    <td className="py-3.5 px-4 font-semibold text-gray-900">
                      <div>{reg.full_name}</div>
                      <div className="text-[11px] font-normal text-gray-500">{reg.email}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-gray-800">
                      {reg.matric_number}
                    </td>
                    <td className="py-3.5 px-4 text-gray-600">
                      <span className="font-semibold">{reg.level} Level</span> • {reg.programme_name}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-bold text-gray-900">{reg.current_gpa ? Number(reg.current_gpa).toFixed(2) : '3.50'}</span>
                    </td>
                    <td className="py-3.5 px-4 text-gray-500 text-[11px]">
                      {new Date(reg.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3.5 px-4">
                      {reg.status === 'PENDING_LECTURER' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock size={11} /> Pending Lecturer
                        </span>
                      )}
                      {reg.status === 'APPROVED' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-green-50 text-green-700 border border-green-200">
                          <CheckCircle2 size={11} /> Accepted & Enrolled
                        </span>
                      )}
                      {reg.status === 'REJECTED' && (
                        <div>
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-red-50 text-red-700 border border-red-200">
                            <XCircle size={11} /> Declined
                          </span>
                          {reg.rejection_reason && (
                            <p className="text-[10px] text-red-600 mt-0.5 line-clamp-1 italic" title={reg.rejection_reason}>
                              "{reg.rejection_reason}"
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      {reg.status === 'PENDING_LECTURER' ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => acceptMutation.mutate(reg.item_id)}
                            disabled={acceptMutation.isPending}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold px-2.5 py-1.5 rounded-md transition-colors text-[11px]"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => {
                              setRejectingItem(reg);
                              setRejectionReason('');
                            }}
                            className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold px-2.5 py-1.5 rounded-md transition-colors text-[11px]"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-[11px] font-medium">Decided</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Rejection Modal */}
      {rejectingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-gray-100 space-y-4">
            <div className="flex items-center gap-2 text-red-700 font-bold">
              <AlertCircle size={20} />
              <h3 className="text-base font-display">Decline Course Registration</h3>
            </div>

            <p className="text-xs text-gray-600">
              You are declining <span className="font-bold text-gray-900">{rejectingItem.full_name}</span> ({rejectingItem.matric_number}) for this course. Please provide an academic or logistical reason.
            </p>

            <div>
              <label htmlFor="reject-reason" className="block text-xs font-bold text-gray-700 mb-1">
                Reason for Decline:
              </label>
              <textarea
                id="reject-reason"
                rows={3}
                placeholder="e.g. Prerequisites not met, laboratory section capacity full, or departmental recommendation..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="w-full text-xs p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:outline-hidden"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectingItem(null)}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (rejectionReason.trim().length >= 3) {
                    rejectMutation.mutate({ itemId: rejectingItem.item_id, reason: rejectionReason.trim() });
                  }
                }}
                disabled={rejectionReason.trim().length < 3 || rejectMutation.isPending}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50"
              >
                {rejectMutation.isPending ? 'Declining...' : 'Confirm Decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
