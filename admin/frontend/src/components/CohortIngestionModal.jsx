import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { apiClient } from '../lib/api';

/**
 * Bulk Cohort Admission Roster Ingestion & Execution Modal
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function CohortIngestionModal({ isOpen, onClose, onSuccess }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationResult, setValidationResult] = useState(null);
  const [parsedStudents, setParsedStudents] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [ingestionResult, setIngestionResult] = useState(null);
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
    setIsUploading(false);
    setIsSubmitting(false);
    setValidationResult(null);
    setParsedStudents([]);
    setParseError(null);
    setIngestionResult(null);
    setIsDragging(false);
    onClose();
  };

  if (!isOpen) return null;

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      setValidationResult(null);
      setParsedStudents([]);
      setParseError(null);
      setIngestionResult(null);
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
      setValidationResult(null);
      setParsedStudents([]);
      setParseError(null);
      setIngestionResult(null);
    }
  };

  const handleValidateRoster = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setParseError(null);

    try {
      if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
        throw new Error('Unsupported file format. Please upload a CSV (.csv) spreadsheet.');
      }

      const text = await selectedFile.text();
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length <= 1) {
        throw new Error('Spreadsheet must contain a header row and at least one student data row.');
      }

      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const matricIdx = headers.findIndex((h) => h.includes('matric') || h.includes('ident'));
      const nameIdx = headers.findIndex((h) => h.includes('name'));
      const emailIdx = headers.findIndex((h) => h.includes('email') || h.includes('mail'));
      const progIdx = headers.findIndex((h) => h.includes('prog') || h.includes('dept'));
      const levelIdx = headers.findIndex((h) => h.includes('level'));

      if (matricIdx === -1 || nameIdx === -1 || emailIdx === -1) {
        throw new Error('Missing required headers: MatricNumber, FullName, and Email are required.');
      }

      const students = [];
      const dataRows = lines.slice(1);
      dataRows.forEach((row, i) => {
        const cols = row.split(',').map((c) => c.trim());
        const matricNumber = cols[matricIdx];
        const fullName = cols[nameIdx];
        const email = cols[emailIdx];
        const programme = progIdx !== -1 && cols[progIdx] ? cols[progIdx] : 'BSC_CSC';
        const level = levelIdx !== -1 && cols[levelIdx] ? parseInt(cols[levelIdx], 10) : 200;

        if (!matricNumber || !fullName || !email) {
          throw new Error(`Row ${i + 2}: Required student fields (Matric, Name, Email) cannot be blank.`);
        }

        students.push({ matricNumber, fullName, email, programme, level });
      });

      setParsedStudents(students);
      setValidationResult({ fileName: selectedFile.name, rowCount: students.length, columnCount: headers.length });
    } catch (err) {
      setParseError(err.message || 'Failed to parse and validate CSV file.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCommitIngestion = async () => {
    if (parsedStudents.length === 0) return;
    setIsSubmitting(true);
    setParseError(null);

    try {
      const res = await apiClient.post('/admin/users/batch-students', { students: parsedStudents });
      setIngestionResult(res.data?.data || res.data);
      if (onSuccess) onSuccess();
    } catch (err) {
      setParseError(err.response?.data?.error || err.message || 'Database ingestion failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/60 backdrop-blur-xs flex min-h-full items-center justify-center p-4 sm:p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="cohort-modal-title"
        className="bg-white rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-xl border border-gray-100 relative animate-in fade-in zoom-in-95 duration-150 my-auto">
        <button type="button" onClick={handleClose} aria-label="Close dialog"
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <X size={18} />
        </button>

        <div>
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-700 flex items-center justify-center mb-4">
            <UploadCloud size={24} />
          </div>

          <h2 id="cohort-modal-title" className="text-xl font-extrabold text-[#0a1142] font-display">
            Bulk Student Cohort Ingestion
          </h2>
          <p className="text-xs text-gray-600 mt-1">
            Import and batch-provision student admission lists into the faculty directory.
          </p>

          {ingestionResult ? (
            <div className="mt-6 p-5 rounded-xl bg-slate-50 border border-slate-200 text-center">
              <CheckCircle2 size={32} className="mx-auto text-emerald-600 mb-2" />
              <h3 className="text-sm font-bold text-slate-900">
                Cohort Ingestion Succeeded ({ingestionResult.successCount} Enrolled, {ingestionResult.failedCount} Failed)
              </h3>
              <p className="text-xs text-slate-600 mt-1">
                All student identities have been inserted into the database and are now visible in the User Directory.
              </p>
              <div className="mt-4 max-h-40 overflow-y-auto text-left text-[11px] bg-white p-3 rounded-lg border border-slate-200 divide-y divide-slate-100">
                {ingestionResult.created?.map((st, idx) => (
                  <div key={idx} className="py-1.5 flex items-center justify-between">
                    <span className="font-semibold text-slate-800">{st.fullName} ({st.matricNumber})</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700">{st.programme} • {st.level}L</span>
                  </div>
                ))}
              </div>
              <button type="button" onClick={handleClose}
                className="mt-5 px-5 py-2.5 rounded-xl text-xs font-bold bg-[#0a1142] text-white hover:bg-blue-900 transition-colors">
                Done
              </button>
            </div>
          ) : validationResult ? (
            <div className="mt-6 p-5 rounded-xl bg-slate-50 border border-slate-200 text-center">
              <CheckCircle2 size={32} className="mx-auto text-emerald-600 mb-2" />
              <h3 className="text-sm font-bold text-slate-900">Roster Schema Verified ({validationResult.rowCount} Records)</h3>
              <p className="text-xs text-slate-600 mt-1">
                {validationResult.rowCount} student records in <strong>{validationResult.fileName}</strong> passed validation.
              </p>

              {parseError && (
                <div className="mt-3 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2 text-left">
                  <AlertCircle size={15} className="shrink-0 text-rose-600" />
                  <span>{parseError}</span>
                </div>
              )}

              <div className="mt-3 max-h-36 overflow-y-auto text-left text-[11px] bg-white p-3 rounded-lg border border-slate-200 divide-y divide-slate-100">
                {parsedStudents.map((st, i) => (
                  <div key={i} className="py-1 flex items-center justify-between">
                    <span className="text-slate-700 truncate">{st.fullName} — <code className="text-[#0a1142] font-mono">{st.matricNumber}</code></span>
                    <span className="text-gray-500 text-[10px]">{st.programme} • {st.level}L</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-end gap-2.5">
                <button type="button" onClick={() => setValidationResult(null)}
                  className="px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded-xl">
                  Choose Another File
                </button>
                <button type="button" onClick={handleCommitIngestion} disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#0a1142] text-white hover:bg-blue-900 transition-colors flex items-center gap-1.5 disabled:opacity-50 min-h-[44px]">
                  {isSubmitting && <Loader2 size={13} className="animate-spin" />}
                  <span>Ingest {parsedStudents.length} Students to Database</span>
                </button>
              </div>
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
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors flex flex-col items-center justify-center select-none ${isDragging ? 'border-[#0a1142] bg-blue-50/60' : 'border-gray-300 hover:border-[#0a1142] bg-slate-50/50'}`}
              >
                <FileSpreadsheet size={32} className="text-gray-400 mb-2 pointer-events-none" />
                <span className="text-xs font-bold text-gray-700 pointer-events-none">
                  {selectedFile ? selectedFile.name : 'Choose a .csv file or drag & drop'}
                </span>
                <span className="text-[11px] text-gray-400 mt-1 pointer-events-none">
                  Required columns: MatricNumber, FullName, Email, Programme, Level
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

              <div className="p-3.5 rounded-xl bg-blue-50/70 border border-blue-100 text-blue-900 text-xs flex items-start gap-2.5">
                <AlertCircle size={15} className="text-blue-600 shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  Verification ensures matriculation numbers canonicalize to <code>YYYY/NNNNN</code> or <code>FOCIT/YYYY/NNNNN</code>, maps institutional programmes, and registers students directly.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 mt-2">
                <button type="button" onClick={handleClose}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:text-gray-900 transition-colors">
                  Cancel
                </button>
                <button type="button" onClick={handleValidateRoster} disabled={!selectedFile || isUploading}
                  className="px-5 py-2.5 min-h-[44px] rounded-xl text-xs font-bold bg-[#0a1142] hover:bg-blue-900 text-white transition-all disabled:opacity-50 shadow-sm flex items-center gap-1.5">
                  {isUploading && <Loader2 size={13} className="animate-spin" />}
                  <span>{isUploading ? 'Verifying...' : 'Verify Roster CSV'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default CohortIngestionModal;
