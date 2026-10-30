import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ProvisionSuccessView } from './ProvisionSuccessView';
import { UserProvisioningForm } from './UserProvisioningForm';

/**
 * User Provisioning Modal Shell
 *
 * Implements:
 * 1. Accessible modal dialog overlay
 * 2. State routing: UserProvisioningForm vs ProvisionSuccessView (Option B)
 *
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function UserProvisioningModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting = false,
  error = null,
  result = null,
}) {
  const [formData, setFormData] = useState({
    fullName: '',
    identifier: '',
    email: '',
    password: '',
    departmentId: 'CSC',
    role: 'STUDENT',
    assignedLevel: 100,
  });

  if (!isOpen) return null;

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: name === 'assignedLevel' ? parseInt(value, 10) : value,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      level: parseInt(formData.level || formData.assignedLevel, 10) || 100,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex min-h-full items-center justify-center p-4 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="provision-modal-title"
        className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-150 my-auto"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>

        {result?.temporaryPassword ? (
          <ProvisionSuccessView
            result={result}
            fallbackData={formData}
            onClose={onClose}
          />
        ) : (
          <UserProvisioningForm
            formData={formData}
            onChange={handleChange}
            onSubmit={handleSubmit}
            onClose={onClose}
            isSubmitting={isSubmitting}
            error={error}
          />
        )}
      </div>
    </div>,
    document.body
  );
}
export default UserProvisioningModal;
