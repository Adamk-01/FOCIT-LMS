import React, { useState } from 'react';
import { X, Upload, Camera, FileText, CheckCircle, AlertCircle } from 'lucide-react';

export function CourseRepUploadModal({
  isOpen,
  onClose,
  courseId,
  courseCode,
  onUpload,
  isUploading,
}) {
  const [weekNumber, setWeekNumber] = useState(1);
  const [imageUrlsText, setImageUrlsText] = useState('');
  const [matricNumbersText, setMatricNumbersText] = useState('');
  const [notes, setNotes] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const sheetImageUrls = imageUrlsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // If no custom URLs provided, provide sample placeholder photo
    const finalImageUrls = sheetImageUrls.length > 0 
      ? sheetImageUrls 
      : [`https://placehold.co/600x800/0a1142/ffffff?text=${encodeURIComponent(courseCode || 'Course')}+Week+${weekNumber}+Attendance+Sheet`];

    onUpload({
      weekNumber: Number(weekNumber),
      sheetImageUrls: finalImageUrls,
      rawExtractedText: matricNumbersText.trim(),
      notes: notes.trim(),
    });
  };

  return (
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
          <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-200/60 text-xs text-blue-900 space-y-1">
            <p className="font-bold">Instructions for Course Representative:</p>
            <p className="leading-relaxed">
              After students check their names and sign the sheet in class, snap clear photos of each page. Enter the matric numbers or transcription below. The system will map enrolled students and notify your lecturer to review and lock the ledger.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Lecture Week Number *
            </label>
            <input
              type="number"
              min="1"
              max="16"
              required
              value={weekNumber}
              onChange={(e) => setWeekNumber(e.target.value)}
              className="w-full px-4 py-2.5 text-sm rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Sheet Photo URLs (one per line)
            </label>
            <textarea
              rows={2}
              value={imageUrlsText}
              onChange={(e) => setImageUrlsText(e.target.value)}
              placeholder="https://... (Leave blank to use camera capture simulation)"
              className="w-full px-4 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Extracted Matric Numbers / Signatures *
            </label>
            <textarea
              rows={4}
              required
              value={matricNumbersText}
              onChange={(e) => setMatricNumbersText(e.target.value)}
              placeholder="Paste matric numbers of attendees (separated by space, comma, or newline)&#10;e.g. 2021/CSC/001, 2021/CSC/002, 2021/CSC/005"
              className="w-full px-4 py-2 text-xs font-mono rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            />
            <span className="text-[11px] text-gray-400">
              Matches students enrolled in {courseCode || courseId}. Matched = Present; Unmatched = Absent.
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">
              Remarks / Hall Notes
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Lecture held in ETF Hall A, verified by Course Rep"
              className="w-full px-4 py-2 text-xs rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all"
            >
              <Upload size={14} />
              <span>{isUploading ? 'Uploading & Parsing...' : 'Submit to Lecturer'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CourseRepUploadModal;
