import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, UserCheck, AlertCircle } from 'lucide-react';

const DEPARTMENTS = [
  { id: 'CSC', label: 'Computer Science' },
  { id: 'CYS', label: 'Cyber Security' },
  { id: 'SEN', label: 'Software Engineering' },
  { id: 'DSC', label: 'Data Science' },
  { id: 'IFS', label: 'Information Systems' },
  { id: 'IFT', label: 'Information Technology' },
  { id: 'LIS', label: 'Library & Info Science' },
];

/**
 * Edit User Modal Component
 * Allows administrators to update user's role (position), department, full name, email, or level.
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function EditUserModal({ isOpen, user, onClose, onSave, isSubmitting = false, error = null }) {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    role: '',
    departmentId: 'CSC',
    level: 100,
  });

  useEffect(() => {
    if (user) {
      setFormData({
        fullName: user.fullName || user.name || '',
        email: user.email || '',
        role: user.role || 'LECTURER',
        departmentId: user.departmentId || 'CSC',
        level: user.level || 100,
      });
    }
  }, [user]);

  if (!isOpen || !user) return null;

  const isStudent = user.role === 'STUDENT';
  const displayIdentifier = user.identifier || user.matricNumber || user.staffNumber || user.id;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'level' ? parseInt(value, 10) : value,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      userId: user.id || displayIdentifier,
      updates: {
        fullName: formData.fullName,
        email: formData.email,
        role: formData.role,
        departmentId: formData.departmentId,
        level: (isStudent || formData.role === 'LEVEL_ADVISOR') ? (parseInt(formData.level, 10) || 100) : null,
      },
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex min-h-full items-center justify-center p-4 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-title"
        className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-150 my-auto"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#0a1142]/10 text-[#0a1142] mb-1">
              <UserCheck size={12} />
              <span>Identity Governance</span>
            </div>
            <h2 id="edit-user-title" className="text-xl font-extrabold text-[#0a1142] font-display">Edit User Account</h2>
            <p className="text-xs text-gray-500 mt-0.5">Modify role, position, department, or academic contact info.</p>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-rose-600" />
              <span>{error.message || 'Failed to update user details.'}</span>
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                {isStudent ? 'Matric Number' : 'Staff Number'}
              </span>
              <p className="font-mono font-bold text-xs text-[#0a1142]">{displayIdentifier}</p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-900 border border-blue-200">
              {user.status || 'ACTIVE'}
            </span>
          </div>

          <div>
            <label htmlFor="edit-fullName" className="block text-xs font-bold text-gray-700 mb-1">Full Name</label>
            <input
              id="edit-fullName" name="fullName" type="text" required value={formData.fullName} onChange={handleChange}
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142]"
            />
          </div>

          <div>
            <label htmlFor="edit-email" className="block text-xs font-bold text-gray-700 mb-1">Institutional Email</label>
            <input
              id="edit-email" name="email" type="email" required value={formData.email} onChange={handleChange}
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-role" className="block text-xs font-bold text-gray-700 mb-1">Position / Role</label>
              {isStudent ? (
                <input
                  type="text" disabled value="Student"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-200 bg-gray-50 text-gray-500 font-semibold"
                />
              ) : (
                <select
                  id="edit-role" name="role" value={formData.role} onChange={handleChange}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142] bg-white font-medium"
                >
                  <option value="LECTURER">Lecturer</option>
                  <option value="LEVEL_ADVISOR">Level Advisor</option>
                  <option value="HOD">Head of Department (HOD)</option>
                  <option value="ADMIN">Faculty Administrator</option>
                </select>
              )}
            </div>

            <div>
              <label htmlFor="edit-departmentId" className="block text-xs font-bold text-gray-700 mb-1">Department</label>
              <select
                id="edit-departmentId" name="departmentId" value={formData.departmentId} onChange={handleChange}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142] bg-white font-medium"
              >
                {DEPARTMENTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
          </div>

          {(isStudent || formData.role === 'LEVEL_ADVISOR') && (
            <div>
              <label htmlFor="edit-level" className="block text-xs font-bold text-gray-700 mb-1">
                {isStudent ? 'Student Level' : 'Assigned Level'}
              </label>
              <select
                id="edit-level" name="level" value={formData.level || 100} onChange={handleChange}
                className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142] bg-white font-medium"
              >
                {[100, 200, 300, 400].map((lvl) => <option key={lvl} value={lvl}>{lvl} Level</option>)}
              </select>
            </div>
          )}

          {!isStudent && formData.role === 'HOD' && (
            <p className="text-[11px] text-blue-700 font-medium bg-blue-50/70 p-2.5 rounded-lg border border-blue-100">
              Note: Changing to HOD grants Head of Department course allocation and result approval authority for this department.
            </p>
          )}

          <div className="mt-2 pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
            <button
              type="button" onClick={onClose} disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit" disabled={isSubmitting}
              className="px-5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold bg-[#0a1142] hover:bg-blue-900 text-white transition-all disabled:opacity-50 shadow-sm"
            >
              {isSubmitting ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
export default EditUserModal;
