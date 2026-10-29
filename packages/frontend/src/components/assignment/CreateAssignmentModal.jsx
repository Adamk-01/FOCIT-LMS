import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Calendar, Award, Percent, FileText, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { apiClient } from '../../lib/api';

export function CreateAssignmentModal({ isOpen, onClose, courseId, onSuccess }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [maxPoints, setMaxPoints] = useState(100);
  const [weightPercent, setWeightPercent] = useState(10);
  const [status, setStatus] = useState('PUBLISHED');
  const [fileName, setFileName] = useState('');
  const [fileUrl, setFileUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Assignment title is required');
      return;
    }
    if (!dueDate) {
      setError('Due date is required');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.post(`/courses/${encodeURIComponent(courseId)}/assignments`, {
        title: title.trim(),
        description: description.trim(),
        due_date: new Date(dueDate).toISOString(),
        max_points: Number(maxPoints),
        weight_percent: Number(weightPercent),
        status,
        file_name: fileName.trim() || null,
        file_url: fileUrl.trim() || null,
      });

      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to publish assignment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
      <div 
        className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-[#0a1142] text-white">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-[#ffb81c]/20 rounded-xl text-[#ffb81c]">
              <FileText size={18} />
            </div>
            <div>
              <h3 className="font-bold text-base font-display">Create Course Assignment</h3>
              <p className="text-xs text-blue-200 font-mono">Course: {courseId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl">
              <AlertCircle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              Assignment Title *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Lab 2: Binary Search Trees & Graph Algorithms"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142] focus:border-transparent outline-none transition"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
              Instructions / Description
            </label>
            <textarea
              rows={3}
              placeholder="Provide assignment brief, objectives, submission format, and guidelines..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142] focus:border-transparent outline-none transition"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Due Date & Time *
              </label>
              <div className="relative">
                <input
                  type="datetime-local"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Max Points
              </label>
              <input
                type="number"
                min="1"
                max="500"
                value={maxPoints}
                onChange={(e) => setMaxPoints(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142] outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Weight (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={weightPercent}
                onChange={(e) => setWeightPercent(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142] outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Publishing Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl bg-white font-medium text-gray-800 focus:ring-2 focus:ring-[#0a1142]"
              >
                <option value="PUBLISHED">Published (Visible to Students)</option>
                <option value="DRAFT">Draft (Staff Only)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">
                Attachment Name (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Lab_Manual_02.pdf"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-gray-300 rounded-xl focus:ring-2 focus:ring-[#0a1142]"
              />
            </div>
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs font-bold shadow-md transition disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} className="animate-spin text-[#ffb81c]" />
                  <span>Publishing...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={14} className="text-[#ffb81c]" />
                  <span>Publish Assignment</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
