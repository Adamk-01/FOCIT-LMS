import React from 'react';
import { X, Search, AlertCircle } from 'lucide-react';

/**
 * User Directory & Lifecycle Management Modal
 *
 * Implements:
 * 1. Searchable student & staff directory
 * 2. Role filters (STUDENT, LECTURER, LEVEL_ADVISOR, ADMIN)
 * 3. Status toggles (ACTIVE <-> SUSPENDED)
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */
export function UserDirectoryModal({
  isOpen,
  onClose,
  users = [],
  isLoading = false,
  searchTerm = '',
  onSearchChange,
  roleFilter = 'ALL',
  onRoleFilterChange,
  onToggleStatus,
  isToggling = false,
  error = null,
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-directory-title"
        className="bg-white rounded-2xl max-w-4xl w-full p-6 sm:p-8 shadow-xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-150 max-h-[85vh] flex flex-col"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="pb-4 border-b border-gray-100">
          <h2 id="user-directory-title" className="text-xl font-extrabold text-[#0a1142] font-display">
            User Directory & Access Control
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Search academic identities, view assigned roles, and toggle active/suspended statuses.
          </p>

          {/* Filters Bar */}
          <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Search by name, matric number, or email..."
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142]"
              />
            </div>

            <div className="inline-flex items-center gap-1.5 p-1 bg-gray-100 rounded-xl shrink-0 w-full sm:w-auto">
              {['ALL', 'STUDENT', 'LECTURER', 'LEVEL_ADVISOR', 'ADMIN'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onRoleFilterChange(r)}
                  className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                    roleFilter === r
                      ? 'bg-white text-[#0a1142] shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {r === 'ALL' ? 'All' : r === 'LEVEL_ADVISOR' ? 'Advisors' : r}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle size={14} className="shrink-0 text-rose-600" />
              <span>{error.message || 'Action failed. Please check permissions.'}</span>
            </div>
          )}
        </div>

        {/* User Table */}
        <div className="mt-4 flex-1 overflow-y-auto overflow-x-auto">
          {isLoading ? (
            <div className="py-12 text-center text-xs text-gray-400">Loading directory records...</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400">No matching users found.</div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <th className="py-2.5 px-3">Name / Identity</th>
                  <th className="py-2.5 px-3">Identifier</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u) => {
                  const isActive = (u.accountStatus || u.status || 'ACTIVE').toUpperCase() === 'ACTIVE';

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-gray-900">{u.fullName}</div>
                        <div className="text-[11px] text-gray-500">{u.email}</div>
                      </td>
                      <td className="py-3 px-3 font-mono font-medium text-gray-700">
                        {u.identifier || u.matricNumber || u.staffNumber}
                      </td>
                      <td className="py-3 px-3">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-800">
                          {u.role}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}>
                          {isActive ? 'ACTIVE' : 'SUSPENDED'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          disabled={isToggling}
                          onClick={() => onToggleStatus(u.id, isActive ? 'SUSPENDED' : 'ACTIVE')}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all border ${
                            isActive
                              ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                          }`}
                        >
                          {isActive ? 'Suspend' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors min-h-[44px]"
          >
            Close Directory
          </button>
        </div>
      </div>
    </div>
  );
}
