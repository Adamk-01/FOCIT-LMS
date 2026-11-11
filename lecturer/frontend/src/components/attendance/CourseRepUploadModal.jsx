import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Camera, FileText, CheckCircle, Trash2, Image as ImageIcon, Loader2 } from 'lucide-react';
import { apiClient } from '../../lib/api';

/**
 * Resizes and compresses an image client-side to ensure fast mobile uploads
 * and prevent memory bloat. Returns a binary Blob.
 */
function compressImageToBlob(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDimension = 1600;

        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.82);
      };
      img.onerror = () => resolve(file);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

export function CourseRepUploadModal({
  isOpen,
  onClose,
  courseId,
  courseCode,
  sessionsPerWeek = 6,
  onUpload,
  onSuccess,
  isUploading = false,
}) {
  const [weekNumber, setWeekNumber] = useState(1);
  const [subSession, setSubSession] = useState(1);
  const [uploadedImages, setUploadedImages] = useState([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [notes, setNotes] = useState('');
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const maxSubSessions = Math.min(6, Math.max(1, sessionsPerWeek || 6));

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsProcessingFiles(true);
    setUploadError(null);
    try {
      const newUploads = [];
      for (const f of files) {
        const blob = await compressImageToBlob(f);

        // Step 1: Request Mode 4 Direct Capability Ticket (HMAC Signed)
        const ticketRes = await apiClient.post(
          `/attendance/courses/${encodeURIComponent(courseId)}/upload-ticket`,
          {
            weekNumber: Number(weekNumber),
            subSession: Number(subSession),
            fileName: f.name || 'sheet.jpg',
            mimeType: 'image/jpeg',
          }
        );
        const { objectKey, uploadUrl } = ticketRes.data;

        // Step 2: Stream binary JPEG blob directly to presigned upload endpoint
        const uploadResponse = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Direct binary upload failed with status ${uploadResponse.status}`);
        }

        newUploads.push({
          id: Math.random().toString(36).slice(2),
          name: f.name,
          objectKey,
          url: URL.createObjectURL(blob),
        });
      }
      setUploadedImages((prev) => [...prev, ...newUploads]);
    } catch (err) {
      console.error('Sheet upload handshake error:', err);
      const errMsg = err?.response?.data?.error || err?.message || 'Failed to stage attendance sheet image';
      setUploadError(errMsg);
    } finally {
      setIsProcessingFiles(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveImage = (id) => {
    setUploadedImages((prev) => prev.filter((img) => img.id !== id));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const objectKeys = uploadedImages.map((img) => img.objectKey).filter(Boolean);
    if (objectKeys.length === 0) {
      setUploadError('Please select and upload at least one physical attendance sheet photo.');
      return;
    }

    const payload = {
      weekNumber: Number(weekNumber),
      subSession: Number(subSession),
      sheetImageUrls: objectKeys,
      notes: notes.trim(),
    };

    if (onUpload) {
      onUpload(payload);
    } else {
      try {
        await apiClient.post(`/attendance/courses/${encodeURIComponent(courseId)}/upload-scanned-sheet`, payload);
        onSuccess?.();
        onClose();
      } catch (err) {
        setUploadError(err?.response?.data?.error || err.message || 'Failed to submit attendance sheet');
      }
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        role="dialog" 
        aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-lg w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white/95 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-700">
              <Camera size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#0a1142] font-display">
                Submit Class Attendance Sheet
              </h2>
              <p className="text-xs text-gray-500">
                Mode 4 Physical-to-Digital Flow • Course Rep Upload
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {uploadError && (
            <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2">
              <span className="font-bold">Upload Failed:</span>
              <span>{uploadError}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Week Number *
              </label>
              <select
                value={weekNumber}
                disabled={uploadedImages.length > 0 || isProcessingFiles}
                onChange={(e) => setWeekNumber(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142] bg-white text-gray-800 disabled:bg-gray-100 disabled:text-gray-500 cursor-pointer disabled:cursor-not-allowed"
              >
                {Array.from({ length: 15 }, (_, i) => i + 1).map((w) => (
                  <option key={w} value={w}>
                    Week {w}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
                Sub-Session (1–{maxSubSessions}) *
              </label>
              <select
                value={subSession}
                disabled={uploadedImages.length > 0 || isProcessingFiles}
                onChange={(e) => setSubSession(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142] bg-white text-gray-800 disabled:bg-gray-100 disabled:text-gray-500 cursor-pointer disabled:cursor-not-allowed"
              >
                {Array.from({ length: maxSubSessions }, (_, i) => i + 1).map((s) => (
                  <option key={s} value={s}>
                    Session {s} {s === 1 ? '(Lecture)' : s === 2 ? '(Lab / Tut)' : `(Session ${s})`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {uploadedImages.length > 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 p-2 rounded-xl border border-amber-200">
              🔒 Week and session slot are locked to the staged sheet images. Remove staged sheets if you need to select a different week or sub-session.
            </p>
          )}

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Physical Sheet Photos *
            </label>
            
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              capture="environment"
              onChange={handleFileSelect}
              className="hidden"
              id="sheet-camera-upload"
            />

            <div
              onClick={() => {
                if (!isProcessingFiles) fileInputRef.current?.click();
              }}
              className="border-2 border-dashed border-gray-300 rounded-2xl p-6 text-center cursor-pointer hover:border-[#0a1142] hover:bg-blue-50/20 transition-all flex flex-col items-center justify-center gap-2"
            >
              <div className="p-3 bg-gray-100 rounded-full text-gray-600">
                {isProcessingFiles ? (
                  <Loader2 size={24} className="animate-spin text-blue-600" />
                ) : (
                  <Upload size={24} />
                )}
              </div>
              <p className="text-xs font-bold text-gray-700">
                {isProcessingFiles ? 'Staging & Uploading Sheet...' : 'Take Photo or Choose Images'}
              </p>
              <p className="text-[11px] text-gray-500">
                Direct capability-ticket upload (Multi-page JPEG, PNG)
              </p>
            </div>

            {/* Thumbnail Preview Strip */}
            {uploadedImages.length > 0 && (
              <div className="mt-3 flex items-center gap-2.5 overflow-x-auto pb-1">
                {uploadedImages.map((img, idx) => (
                  <div key={img.id} className="relative group shrink-0 w-18 h-24 rounded-lg overflow-hidden border border-gray-300 shadow-xs">
                    <img src={img.url} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/75 text-white text-[9px] font-mono text-center py-0.5">
                      Page {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveImage(img.id);
                      }}
                      className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full opacity-90 hover:opacity-100 shadow-xs cursor-pointer"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Lecturer Briefing Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Wet weather attendance drop; verified with lab log"
              className="w-full px-4 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading || isProcessingFiles}
              className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-800 rounded-xl hover:bg-gray-100 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading || isProcessingFiles || uploadedImages.length === 0}
              className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-[#0a1142] rounded-xl hover:bg-[#16258f] transition disabled:opacity-50 shadow-md cursor-pointer disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Transmitting Sheet...</span>
                </>
              ) : (
                <>
                  <CheckCircle size={14} />
                  <span>Transmit to Verification Desk</span>
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

export default CourseRepUploadModal;
