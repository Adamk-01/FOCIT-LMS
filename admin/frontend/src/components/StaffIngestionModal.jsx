import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, Users, Loader2 } from 'lucide-react';
import { apiClient } from '../lib/api';

/**
 * Bulk Faculty Staff Roster Ingestion & Validation Modal
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function StaffIngestionModal({ isOpen, onClose, onSuccess }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [parsedStaff, setParsedStaff] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [submissionResult, setSubmissionResult] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Global window dragover/drop preventer: stops browser from downloading or navigating to dropped files
  useEffect(() => {
    if (!isOpen) return;

    const preventDefaults = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener('dragover', preventDefaults);
    window.addEventListener('drop', preventDefaults);

    return () => {
      window.removeEventListener('dragover', preventDefaults);
      window.removeEventListener('drop', preventDefaults);
    };
  }, [isOpen]);

  const handleClose = () => {
    setSelectedFile(null);
    setIsParsing(false);
    setIsSubmitting(false);
    setParsedStaff([]);
    setParseError(null);
    setSubmissionResult(null);
    setIsDragging(false);
    onClose();
  };

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setParsedStaff([]);
      setParseError(null);
      setSubmissionResult(null);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0]);
      setParsedStaff([]);
      setParseError(null);
      setSubmissionResult(null);
    }
  };

  const handleValidateRoster = async () => {
    if (!selectedFile) return;
    setIsParsing(true);
    setParseError(null);

    try {
      if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
        throw new Error('Unsupported format. Please upload a CSV (.csv) file.');
      }

      const text = await selectedFile.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) {
        throw new Error('Spreadsheet must contain a header row and at least one staff row.');
      }

      const rawHeaders = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const staffIdIdx = rawHeaders.findIndex((h) => h.includes('staff') || h.includes('id') || h.includes('ident'));
      const nameIdx = rawHeaders.findIndex((h) => h.includes('name'));
      const emailIdx = rawHeaders.findIndex((h) => h.includes('email') || h.includes('mail'));
      const roleIdx = rawHeaders.findIndex((h) => h.includes('role'));
      const deptIdx = rawHeaders.findIndex((h) => h.includes('dept') || h.includes('department') || h.includes('prog'));

      if (staffIdIdx === -1 || nameIdx === -1 || emailIdx === -1) {
        throw new Error('Required headers missing. Must include StaffNumber (or ID), FullName, and Email.');
      }

      const records = [];
      const dataRows = lines.slice(1);
      dataRows.forEach((row, i) => {
        const cols = row.split(',').map((c) => c.trim());
        const staffNumber = cols[staffIdIdx];
        const fullName = cols[nameIdx];
        const email = cols[emailIdx];
        const rawRole = roleIdx !== -1 && cols[roleIdx] ? cols[roleIdx].toUpperCase() : 'LECTURER';
        const role = ['HOD', 'LECTURER', 'LEVEL_ADVISOR', 'ADMIN'].includes(rawRole) ? rawRole : 'LECTURER';
        const department = deptIdx !== -1 && cols[deptIdx] ? cols[deptIdx].toUpperCase() : 'CSC';

        if (!staffNumber || !fullName || !email) {
          throw new Error(`Row ${i + 2}: Staff number, full name, and email cannot be blank.`);
        }

        records.push({ staffNumber, fullName, email, role, department });
      });

      setParsedStaff(records);
    } catch (err) {
      setParseError(err.message || 'Failed to parse staff CSV file.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleCommitIngestion = async () => {
    if (parsedStaff.length === 0) return;
    setIsSubmitting(true);
    setParseError(null);

    try {
      const res = await apiClient.post('/admin/users/batch-staff', { staff: parsedStaff });
      setSubmissionResult(res.data?.data || res.data);
      if (onSuccess) onSuccess();
    } catch (err) {
      setParseError(err.response?.data?.error || err.message || 'Failed to provision staff roster.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex min-h-full items-center justify-center p-4 sm:p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="staff-modal-title"
        className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-8 shadow-xl border border-gray-100 relative my-auto animate-in fade-in zoom-in-95 duration-150">
        <button type="button" onClick={handleClose} aria-label="Close dialog"
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <X size={18} />
        </button>

        <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center mb-4">
          <Users size={24} />
        </div>

        <h2 id="staff-modal-title" className="text-xl font-extrabold text-[#0a1142] font-display">
          Bulk Faculty Staff Ingestion
        </h2>
        <p className="text-xs text-gray-600 mt-1">
          Import and batch-provision academic staff rosters (HODs, Lecturers, and Level Advisors).
        </p>

        {submissionResult ? (
          <div className="mt-6 p-5 rounded-xl bg-slate-50 border border-slate-200 text-center">
            <CheckCircle2 size={32} className="mx-auto text-emerald-600 mb-2" />
            <h3 className="text-sm font-bold text-slate-900">
              Staff Ingestion Completed ({submissionResult.successCount} Success, {submissionResult.failedCount} Failed)
            </h3>
            <p className="text-xs text-slate-600 mt-1">
              Staff accounts have been registered and security credentials initialized.
            </p>
            <div className="mt-4 max-h-40 overflow-y-auto text-left text-[11px] bg-white p-3 rounded-lg border border-slate-200 divide-y divide-slate-100">
              {submissionResult.created?.map((s, idx) => (
                <div key={idx} className="py-1.5 flex items-center justify-between">
                  <span className="font-semibold text-slate-800">{s.fullName} ({s.staffNumber})</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700">{s.role} • {s.department}</span>
                </div>
              ))}
            </div>
            <button type="button" onClick={handleClose}
              className="mt-5 px-5 py-2.5 rounded-xl text-xs font-bold bg-[#0a1142] text-white hover:bg-blue-900 transition-colors">
              Close
            </button>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-4">
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors flex flex-col items-center justify-center select-none ${isDragging ? 'border-indigo-600 bg-indigo-50/70' : 'border-gray-300 hover:border-indigo-600 bg-slate-50/50'}`}
            >
              <FileSpreadsheet size={32} className="text-gray-400 mb-2 pointer-events-none" />
              <span className="text-xs font-bold text-gray-700 pointer-events-none">
                {selectedFile ? selectedFile.name : 'Choose staff CSV file or drag & drop'}
              </span>
              <span className="text-[11px] text-gray-400 mt-1 pointer-events-none">
                Headers: StaffNumber, FullName, Email, Role (HOD/LECTURER), Department
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>

            {parseError && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                <AlertCircle size={15} className="shrink-0 text-rose-600" />
                <span>{parseError}</span>
              </div>
            )}

            {parsedStaff.length > 0 && (
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-800">Preview: {parsedStaff.length} Staff Member(s)</span>
                  <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">Schema Verified</span>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1 text-[11px] divide-y divide-slate-100">
                  {parsedStaff.map((st, i) => (
                    <div key={i} className="pt-1 flex items-center justify-between">
                      <span className="text-slate-700 truncate">{st.fullName} — <code className="text-[#0a1142] font-mono">{st.staffNumber}</code></span>
                      <span className="font-semibold text-indigo-700 text-[10px]">{st.role} ({st.department})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2.5 mt-2">
              <button type="button" onClick={handleClose} className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl">
                Cancel
              </button>
              {parsedStaff.length === 0 ? (
                <button type="button" onClick={handleValidateRoster} disabled={!selectedFile || isParsing}
                  className="px-5 py-2 text-xs font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-1.5 min-h-[44px]">
                  {isParsing && <Loader2 size={13} className="animate-spin" />}
                  <span>Verify Roster</span>
                </button>
              ) : (
                <button type="button" onClick={handleCommitIngestion} disabled={isSubmitting}
                  className="px-5 py-2 text-xs font-bold bg-[#0a1142] text-white rounded-xl hover:bg-blue-900 disabled:opacity-50 transition-colors flex items-center gap-1.5 min-h-[44px]">
                  {isSubmitting && <Loader2 size={13} className="animate-spin" />}
                  <span>Provision {parsedStaff.length} Staff Records</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default StaffIngestionModal;
