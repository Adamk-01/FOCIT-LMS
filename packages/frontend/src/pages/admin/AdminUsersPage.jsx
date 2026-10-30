import React, { useState } from 'react';
import { Search, UserPlus, AlertCircle, Key } from 'lucide-react';
import { useAdminDashboard } from '../../hooks/useAdminDashboard';
import { UserProvisioningModal } from '../../components/admin/UserProvisioningModal';
import { SuspendConfirmationModal } from '../../components/admin/SuspendConfirmationModal';
import { ResetPasswordModal } from '../../components/admin/ResetPasswordModal';

/**
 * Faculty User Directory & Identity Management Page
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function AdminUsersPage() {
  const {
    users, isUsersLoading, userSearch, setUserSearch, userRoleFilter, setUserRoleFilter,
    toggleUserStatus, isTogglingStatus, statusError, isProvisionModalOpen, openProvisionModal,
    closeProvisionModal, provisionUser, isProvisioning, provisionError, provisionResult,
    resetUserPassword, isResettingPassword,
  } = useAdminDashboard();

  const [userToSuspend, setUserToSuspend] = useState(null);
  const [userToResetPassword, setUserToResetPassword] = useState(null);

  const handleConfirmSuspend = async () => {
    if (!userToSuspend) return;
    const targetId = userToSuspend.id;
    setUserToSuspend(null);
    await toggleUserStatus(targetId, 'SUSPENDED');
  };

  const userList = users?.users || [];

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-200">
        <div>
          <h1 className="text-2xl font-black text-[#0a1142] font-display">User Directory & Accounts</h1>
          <p className="text-xs text-gray-500 mt-1">Search academic identities, view roles, and govern active/suspended statuses</p>
        </div>
        <button
          type="button" onClick={openProvisionModal}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0a1142] hover:bg-blue-900 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
        >
          <UserPlus size={16} />
          <span>+ Provision New User</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200/80 shadow-xs flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text" value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search by name, matric number, or email..."
            className="w-full pl-9 pr-4 py-2.5 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142]"
          />
        </div>
        <div className="inline-flex items-center gap-1.5 p-1 bg-gray-100 rounded-xl shrink-0 w-full sm:w-auto">
          {['ALL', 'STUDENT', 'LECTURER', 'LEVEL_ADVISOR', 'ADMIN'].map((r) => (
            <button
              key={r} type="button" onClick={() => setUserRoleFilter(r)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${userRoleFilter === r ? 'bg-white text-[#0a1142] shadow-xs' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {r === 'ALL' ? 'All Roles' : r === 'LEVEL_ADVISOR' ? 'Advisors' : r}
            </button>
          ))}
        </div>
      </div>

      {statusError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0 text-rose-600" />
          <span>{statusError.message || 'Operation failed. Action blocked by security barrier.'}</span>
        </div>
      )}

      {/* User Table Card */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          {isUsersLoading ? (
            <div className="py-16 text-center text-xs text-gray-400">Loading directory records...</div>
          ) : userList.length === 0 ? (
            <div className="py-16 text-center text-xs text-gray-400">No matching user records found.</div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 bg-slate-50/50">
                  <th className="py-3 px-4">User & Contact</th>
                  <th className="py-3 px-4">ID / Matric</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {userList.map((u, idx) => {
                  const isSuspended = u.status === 'SUSPENDED';
                  const isActive = u.status === 'ACTIVE';
                  const displayName = u.fullName || u.name || '—';
                  const displayIdentifier = u.identifier || u.matricNumber || '—';

                  return (
                    <tr key={u.id || displayIdentifier || idx} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900 text-sm tracking-tight">{displayName}</div>
                        <div className="text-xs font-semibold text-slate-600">{u.email || '—'}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900 text-xs">{displayIdentifier}</td>
                      <td className="py-3.5 px-4">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-100">{u.role}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          isSuspended ? 'bg-rose-50 text-rose-700 border border-rose-200' : isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-gray-100 text-gray-600'
                        }`}>
                          {u.status || 'UNKNOWN'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button" onClick={() => setUserToResetPassword(u)}
                            title="Reset Temporary Password"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                          >
                            <Key size={12} className="text-amber-600" />
                            <span>Reset Pass</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => isSuspended ? toggleUserStatus(u.id, 'ACTIVE') : setUserToSuspend(u)}
                            disabled={isTogglingStatus || !u.status}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors disabled:opacity-50 ${
                              isSuspended ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                            }`}
                          >
                            {isSuspended ? 'Activate' : 'Suspend'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <UserProvisioningModal
        isOpen={isProvisionModalOpen} onClose={closeProvisionModal}
        onSubmit={provisionUser} isSubmitting={isProvisioning}
        error={provisionError} result={provisionResult}
      />
      <SuspendConfirmationModal
        isOpen={Boolean(userToSuspend)} user={userToSuspend}
        onClose={() => setUserToSuspend(null)} onConfirm={handleConfirmSuspend}
        isSubmitting={isTogglingStatus}
      />
      <ResetPasswordModal
        isOpen={Boolean(userToResetPassword)} user={userToResetPassword}
        onClose={() => setUserToResetPassword(null)} onReset={resetUserPassword}
        isSubmitting={isResettingPassword}
      />
    </div>
  );
}
export default AdminUsersPage;
