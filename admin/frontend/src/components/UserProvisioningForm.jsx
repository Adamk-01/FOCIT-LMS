import React from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';

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
 * Form inputs for User Provisioning
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function UserProvisioningForm({ formData, onChange, onSubmit, onClose, isSubmitting, error }) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
      <div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#0a1142]/10 text-[#0a1142] mb-1">
          <ShieldCheck size={12} />
          <span>Identity Governance</span>
        </div>
        <h2 id="provision-modal-title" className="text-xl font-extrabold text-[#0a1142] font-display">Provision New User</h2>
        <p className="text-xs text-gray-500 mt-0.5">Create a student or academic staff member in the faculty directory.</p>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0 text-rose-600" />
          <span>{error.message || 'Failed to provision user. Check duplicate ID or email.'}</span>
        </div>
      )}

      <div>
        <label htmlFor="fullName" className="block text-xs font-bold text-gray-700 mb-1">Full Name</label>
        <input
          id="fullName" name="fullName" type="text" required value={formData.fullName} onChange={onChange}
          placeholder="e.g. Samuel Thomson"
          className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142]"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="identifier" className="block text-xs font-bold text-gray-700 mb-1">Matric / Staff Number</label>
          <input
            id="identifier" name="identifier" type="text" required value={formData.identifier} onChange={onChange}
            placeholder="e.g. FOCIT/2026/0421"
            className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142]"
          />
        </div>
        <div>
          <label htmlFor="role" className="block text-xs font-bold text-gray-700 mb-1">Role</label>
          <select
            id="role" name="role" value={formData.role} onChange={onChange}
            className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142] bg-white"
          >
            <option value="STUDENT">Student</option>
            <option value="LECTURER">Lecturer</option>
            <option value="LEVEL_ADVISOR">Level Advisor</option>
            <option value="ADMIN">Faculty Administrator</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="email" className="block text-xs font-bold text-gray-700 mb-1">Institutional Email</label>
          <input
            id="email" name="email" type="email" required value={formData.email} onChange={onChange}
            placeholder="e.g. s.thomson@focit.uniosun.edu.ng"
            className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142]"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-xs font-bold text-gray-700 mb-1">
            Initial Password <span className="font-normal text-gray-400">(Optional)</span>
          </label>
          <input
            id="password" name="password" type="text" value={formData.password || ''} onChange={onChange}
            placeholder="Auto-generated if blank (min 8)"
            className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="departmentId" className="block text-xs font-bold text-gray-700 mb-1">Department</label>
          <select
            id="departmentId" name="departmentId" value={formData.departmentId} onChange={onChange}
            className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142] bg-white"
          >
            {DEPARTMENTS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="assignedLevel" className="block text-xs font-bold text-gray-700 mb-1">Level</label>
          <select
            id="assignedLevel" name="assignedLevel" value={formData.assignedLevel} onChange={onChange}
            className="w-full px-3.5 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]/20 focus:border-[#0a1142] bg-white"
          >
            {[100, 200, 300, 400].map((lvl) => <option key={lvl} value={lvl}>{lvl} Level</option>)}
          </select>
        </div>
      </div>

      <div className="mt-2 pt-3 border-t border-gray-100 flex items-center justify-end gap-3">
        <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition-colors">
          Cancel
        </button>
        <button
          type="submit" disabled={isSubmitting}
          className="px-5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold bg-[#0a1142] hover:bg-blue-900 text-white transition-all disabled:opacity-50 shadow-sm"
        >
          {isSubmitting ? 'Provisioning...' : 'Provision User'}
        </button>
      </div>
    </form>
  );
}
export default UserProvisioningForm;
