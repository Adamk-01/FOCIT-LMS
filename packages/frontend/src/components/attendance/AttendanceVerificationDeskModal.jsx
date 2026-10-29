import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Lock, 
  AlertTriangle, 
  Image as ImageIcon, 
  Clock,
  ShieldCheck,
  Save
} from 'lucide-react';
import { useAttendanceSessionDetails } from '../../hooks/useAttendance';
import { AttendanceSheetDocumentMockup } from './AttendanceSheetDocumentMockup';

export function AttendanceVerificationDeskModal({
  sessionId,
  isOpen,
  onClose,
  onSaveRecords,
  onLockSession,
  isSaving,
  isLocking,
}) {
  const { data, isLoading } = useAttendanceSessionDetails(sessionId);
  const session = data?.session;
  const initialRecords = data?.records || [];

  const [records, setRecords] = useState([]);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [imageErrorMap, setImageErrorMap] = useState({});
  const [showLockConfirm, setShowLockConfirm] = useState(false);

  useEffect(() => {
    if (initialRecords.length > 0) {
      setRecords(initialRecords);
      setHasUnsavedChanges(false);
    }
  }, [initialRecords]);

  if (!isOpen) return null;

  const handleStatusChange = (studentId, newStatus) => {
    if (session?.is_locked) return;
    setRecords((prev) =>
      prev.map((r) =>
        r.student_id === studentId ? { ...r, status: newStatus } : r
      )
    );
    setHasUnsavedChanges(true);
  };

  const handleSave = () => {
    const updates = records.map((r) => ({
      studentId: r.student_id,
      status: r.status,
      notes: r.notes || null,
    }));
    onSaveRecords(updates, () => setHasUnsavedChanges(false));
  };

  const images = Array.isArray(session?.sheet_image_urls) ? session.sheet_image_urls : [];
  const currentImageUrl = images[selectedImageIndex];
  const hasImageError = Boolean(imageErrorMap[selectedImageIndex]) || !currentImageUrl;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div 
        role="dialog" 
        aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#0a1142] text-[#ffb81c]">
              <ShieldCheck size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-[#0a1142] font-display">
                  Attendance Verification Desk: Week {session?.week_number || 1}
                </h2>
                {session?.is_locked ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                    <Lock size={12} />
                    LOCKED & SEALED
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                    <Clock size={12} />
                    PENDING LECTURER APPROVAL
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Course: {session?.course_id} • Created: {new Date(session?.session_date || Date.now()).toLocaleDateString()}
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

        {/* Sealed Status Advisory */}
        {session?.is_locked && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-5 py-2.5 flex items-center justify-between text-xs text-emerald-900 shrink-0">
            <div className="flex items-center gap-2 font-semibold">
              <Lock size={14} className="text-emerald-700 shrink-0" />
              <span>This attendance ledger is cryptographically sealed and permanently locked for NUC compliance. Records are read-only.</span>
            </div>
            <span className="text-[10px] font-bold font-mono text-emerald-800 bg-emerald-100 border border-emerald-300 px-2 py-0.5 rounded uppercase">
              Sealed
            </span>
          </div>
        )}

        {/* Content Body: Two-Column Verification Split */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 min-h-0">
          {/* Left Column: Snapped Attendance Sheets (5 cols) */}
          <div className="lg:col-span-5 bg-gray-50 border-r border-gray-200 p-5 flex flex-col gap-4 overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                <ImageIcon size={14} className="text-[#0a1142]" />
                Course Rep Snapped Sheets ({Math.max(images.length, 1)})
              </h3>
              {session?.raw_extracted_text && (
                <span className="text-[11px] text-gray-500">OCR Extracted</span>
              )}
            </div>

            <div className="space-y-3">
              <div className="aspect-[3/4] bg-black/5 rounded-xl overflow-hidden border border-gray-200 relative group flex items-center justify-center">
                {hasImageError ? (
                  <AttendanceSheetDocumentMockup
                    session={session}
                    records={records}
                    pageNumber={selectedImageIndex + 1}
                  />
                ) : (
                  <img
                    src={currentImageUrl}
                    alt={`Scanned Sheet Page ${selectedImageIndex + 1}`}
                    className="w-full h-full object-contain"
                    onError={() => setImageErrorMap((prev) => ({ ...prev, [selectedImageIndex]: true }))}
                  />
                )}
                <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded bg-black/70 text-white text-[11px] font-mono">
                  Page {selectedImageIndex + 1} of {Math.max(images.length, 1)}
                </div>
              </div>

              {/* Thumbnails */}
              {images.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {images.map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedImageIndex(idx)}
                      className={`w-14 h-18 rounded-lg overflow-hidden border-2 transition-all shrink-0 ${
                        selectedImageIndex === idx ? 'border-[#0a1142] ring-2 ring-[#0a1142]/20' : 'border-gray-200 opacity-70'
                      }`}
                    >
                      {imageErrorMap[idx] || !img ? (
                        <div className="w-full h-full bg-amber-50 flex items-center justify-center text-[9px] font-bold text-amber-900">
                          P.{idx + 1}
                        </div>
                      ) : (
                        <img 
                          src={img} 
                          alt="" 
                          className="w-full h-full object-cover" 
                          onError={() => setImageErrorMap((prev) => ({ ...prev, [idx]: true }))}
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Extracted Transcribed Text Snippet */}
            {session?.raw_extracted_text && (
              <div className="p-3 bg-white rounded-xl border border-gray-200 text-xs space-y-1">
                <p className="font-bold text-gray-700 text-[11px] uppercase tracking-wider">Raw Extracted Matrics</p>
                <p className="font-mono text-gray-600 text-[11px] max-h-24 overflow-y-auto whitespace-pre-wrap bg-gray-50 p-2 rounded">
                  {session.raw_extracted_text}
                </p>
              </div>
            )}
          </div>

          {/* Right Column: Student Attendance Ledger Table (7 cols) */}
          <div className="lg:col-span-7 p-5 flex flex-col gap-4 overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider">
                  Enrolled Students Verification Roster ({records.length})
                </h3>
                <p className="text-[11px] text-gray-500">
                  {session?.is_locked 
                    ? 'Records are permanently locked and sealed for NUC exam qualification.' 
                    : 'Toggle status between Present, Absent, or Excused based on signature verification.'}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                  {records.filter((r) => r.status === 'PRESENT').length} Present
                </span>
                <span className="font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded">
                  {records.filter((r) => r.status === 'ABSENT').length} Absent
                </span>
              </div>
            </div>

            {isLoading ? (
              <div className="p-12 text-center text-xs text-gray-400">Loading student roster...</div>
            ) : (
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-gray-50 text-gray-600 uppercase text-[10px] tracking-wider border-b border-gray-200">
                    <tr>
                      <th className="py-2.5 px-3">Student Name</th>
                      <th className="py-2.5 px-3 font-mono">Matric No</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 font-sans">
                    {records.map((r) => (
                      <tr key={r.student_id} className="hover:bg-gray-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-medium text-gray-900">
                          {r.full_name || r.student_name || `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.matric_number || r.student_id}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-gray-600 text-[11px]">
                          {r.matric_number || r.student_id}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <div className="inline-flex rounded-lg p-0.5 bg-gray-100 border border-gray-200">
                            <button
                              type="button"
                              disabled={session?.is_locked}
                              onClick={() => handleStatusChange(r.student_id, 'PRESENT')}
                              className={`px-2 py-1 rounded text-[11px] font-bold transition-all ${
                                r.status === 'PRESENT'
                                  ? 'bg-emerald-600 text-white shadow-sm'
                                  : 'text-gray-600 hover:text-emerald-700 disabled:hover:text-gray-600'
                              }`}
                            >
                              Present
                            </button>
                            <button
                              type="button"
                              disabled={session?.is_locked}
                              onClick={() => handleStatusChange(r.student_id, 'ABSENT')}
                              className={`px-2 py-1 rounded text-[11px] font-bold transition-all ${
                                r.status === 'ABSENT'
                                  ? 'bg-red-600 text-white shadow-sm'
                                  : 'text-gray-600 hover:text-red-700 disabled:hover:text-gray-600'
                              }`}
                            >
                              Absent
                            </button>
                            <button
                              type="button"
                              disabled={session?.is_locked}
                              onClick={() => handleStatusChange(r.student_id, 'EXCUSED')}
                              className={`px-2 py-1 rounded text-[11px] font-bold transition-all ${
                                r.status === 'EXCUSED'
                                  ? 'bg-amber-600 text-white shadow-sm'
                                  : 'text-gray-600 hover:text-amber-700 disabled:hover:text-gray-600'
                              }`}
                            >
                              Excused
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0">
          <div className="text-xs text-gray-500">
            {hasUnsavedChanges && (
              <span className="text-amber-700 font-semibold flex items-center gap-1">
                <AlertTriangle size={14} />
                Unsaved modifications pending.
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
            >
              Close
            </button>

            {!session?.is_locked && (
              <>
                <button
                  type="button"
                  disabled={isSaving || !hasUnsavedChanges}
                  onClick={handleSave}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-900 disabled:opacity-40 text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
                >
                  <Save size={14} />
                  <span>{isSaving ? 'Saving...' : 'Save Edits'}</span>
                </button>

                <button
                  type="button"
                  disabled={isLocking || hasUnsavedChanges}
                  title={hasUnsavedChanges ? 'Save pending adjustments before locking' : undefined}
                  onClick={() => setShowLockConfirm(true)}
                  className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-bold shadow-md transition-all cursor-pointer"
                >
                  <Lock size={14} />
                  <span>{isLocking ? 'Locking...' : 'Approve & Lock Ledger'}</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Modern In-App Lock Confirmation Dialog */}
      {showLockConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fade-in">
          <div 
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="lock-dialog-title"
            aria-describedby="lock-dialog-desc"
            className="bg-white rounded-2xl shadow-2xl border border-gray-200 max-w-md w-full p-6 space-y-5 animate-scale-in"
          >
            <div className="flex items-center gap-3.5">
              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                <ShieldCheck size={26} />
              </div>
              <div>
                <h3 id="lock-dialog-title" className="text-base font-bold text-[#0a1142]">
                  Approve & Seal Attendance Ledger
                </h3>
                <p className="text-xs text-gray-500">
                  Course: {session?.course_id} • Week {session?.week_number || 1}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900 space-y-2">
              <div className="font-bold flex items-center gap-1.5 text-amber-900">
                <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                <span>Irreversible Audit Seal</span>
              </div>
              <p id="lock-dialog-desc" className="text-amber-800 leading-relaxed text-[11px]">
                Once approved, this session ledger is cryptographically sealed (<code className="font-bold font-mono">is_locked = TRUE</code>) and cannot be modified. All verified attendances will authoritatively count toward each student's mandatory <strong>NUC 75% exam qualification</strong>.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                disabled={isLocking}
                onClick={() => setShowLockConfirm(false)}
                className="px-4 py-2 rounded-xl border border-gray-300 text-xs font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
              >
                Cancel / Keep Editing
              </button>
              <button
                type="button"
                disabled={isLocking}
                onClick={() => {
                  onLockSession(session.session_id);
                  setShowLockConfirm(false);
                }}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold shadow-md transition-all disabled:opacity-50"
              >
                {isLocking ? <Clock size={14} className="animate-spin" /> : <Lock size={14} />}
                <span>{isLocking ? 'Locking...' : 'Yes, Confirm & Lock'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

export default AttendanceVerificationDeskModal;
