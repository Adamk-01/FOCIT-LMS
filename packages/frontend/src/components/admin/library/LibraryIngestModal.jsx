import React, { useState, useEffect, useRef } from 'react';
import { X, UploadCloud, FileText, CheckCircle2, AlertTriangle, Clock, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';

const VALID_EXTENSIONS = ['.pdf', '.docx', '.epub', '.zip'];
const MAX_BYTES = 150 * 1024 * 1024; // 150MB

export function LibraryIngestModal({
  isOpen,
  onClose,
  onUploadBinary,
  onCommitItem,
  onCancelUpload,
  isUploading,
  uploadProgress,
  uploadError,
  isCommitting,
  commitError,
}) {
  const { user } = useAuth();
  const draftKey = `focit_lib_admin_draft:${user?.id || 'default'}`;

  // Step 1: Binary Staging State
  const [file, setFile] = useState(null);
  const [stagedTicket, setStagedTicket] = useState(null);
  const [validationError, setValidationError] = useState(null);
  const fileInputRef = useRef(null);

  // Step 2: Academic Dimensions Form State
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    categoryId: 'textbooks',
    itemType: 'TEXTBOOK',
    author: '',
    publisher: '',
    publicationYear: new Date().getFullYear(),
    edition: '',
    isbn: '',
    courseId: '',
    departmentId: user?.role === 'HOD' ? user?.department_id : 'CSC',
    level: 200,
    academicSession: '2024/2025',
    semesterNumber: 1,
    isFeatured: false,
    isPublished: true,
    embargoUntil: '',
  });

  // Rehydrate draft from sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        setFormData((prev) => ({ ...prev, ...parsed }));
      }
    } catch (_) {}
  }, [draftKey]);

  // Sync draft to sessionStorage
  const updateField = (field, value) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value };
      try {
        sessionStorage.setItem(draftKey, JSON.stringify(next));
      } catch (_) {}
      return next;
    });
  };

  if (!isOpen) return null;

  // File Selection & Drag-and-Drop Handler
  const handleFileDrop = (e) => {
    e.preventDefault();
    if (isUploading) return;
    const droppedFile = e.dataTransfer ? e.dataTransfer.files[0] : e.target.files[0];
    if (!droppedFile) return;

    const ext = `.${droppedFile.name.split('.').pop().toLowerCase()}`;
    if (!VALID_EXTENSIONS.includes(ext)) {
      setValidationError(`Invalid file format. Permitted: ${VALID_EXTENSIONS.join(', ')}`);
      return;
    }

    if (droppedFile.size > MAX_BYTES) {
      setValidationError('File exceeds the 150MB single-upload ceiling.');
      return;
    }

    setValidationError(null);
    setFile(droppedFile);

    // Auto-fill title if empty
    if (!formData.title) {
      const cleanTitle = droppedFile.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      updateField('title', cleanTitle);
    }
  };

  // Execute Step 1: Upload Binary to Staging
  const handleStartUpload = async () => {
    if (!file) return;
    try {
      const ticket = await onUploadBinary(file);
      setStagedTicket(ticket);
    } catch (err) {
      // Handled by hook error state
    }
  };

  // Execute Step 2: Relational Metadata Commit
  const handleSubmitMetadata = async (e) => {
    e.preventDefault();
    if (!stagedTicket || isCommitting) return;

    const payload = {
      stagedId: stagedTicket.staged_id || stagedTicket.stagedId,
      ...formData,
      departmentId: user?.role === 'HOD' ? user?.department_id : formData.departmentId,
      embargoUntil: formData.embargoUntil ? new Date(formData.embargoUntil).toISOString() : null,
    };

    try {
      await onCommitItem(payload);
      // Clear draft on success
      sessionStorage.removeItem(draftKey);
      handleClose();
    } catch (err) {
      // Handled by hook error state
    }
  };

  const handleClose = () => {
    if (isUploading) {
      onCancelUpload();
    }
    setFile(null);
    setStagedTicket(null);
    setValidationError(null);
    onClose();
  };

  const isExamPQ = ['SEMESTER_EXAM_PQ', 'MIDTERM_TEST_PQ'].includes(formData.itemType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ingest-modal-title"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 id="ingest-modal-title" className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <UploadCloud className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
              Ingest Digital Library Material
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Two-Phase Content-Addressed Storage (CAS) Ingestion Valve
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Phase Tracker */}
          <div className="flex items-center justify-center gap-4 text-xs font-semibold">
            <span className={`flex items-center gap-1.5 ${stagedTicket ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}>
              <span className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-[11px] font-bold">1</span>
              Binary Stream & CAS Staging
            </span>
            <span className="text-slate-300 dark:text-slate-700">→</span>
            <span className={`flex items-center gap-1.5 ${stagedTicket ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
              <span className="w-5 h-5 rounded-full border-2 flex items-center justify-center text-[11px] font-bold">2</span>
              Academic Dimensions Commit
            </span>
          </div>

          {/* STEP 1: BINARY STREAM UPLOAD */}
          {!stagedTicket ? (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => !isUploading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
                  file
                    ? 'border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20'
                    : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50 dark:bg-slate-800/50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.epub,.zip"
                  onChange={handleFileDrop}
                  className="hidden"
                />

                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="p-3 bg-indigo-100 dark:bg-indigo-900/50 rounded-full text-indigo-600 dark:text-indigo-400">
                    <FileText className="w-6 h-6" />
                  </div>
                  {file ? (
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{file.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB • Ready to stream
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        Drop textbook, exam paper, or document here, or <span className="text-indigo-600 dark:text-indigo-400 underline">browse</span>
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Supports PDF, Word (.docx), EPUB, ZIP (up to 150MB)
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress & Error Displays */}
              {isUploading && (
                <div className="space-y-2 p-3 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                      Streaming to CAS Quarantined Spool...
                    </span>
                    <span className="font-bold text-indigo-600 dark:text-indigo-400">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden">
                    <div className="bg-indigo-600 h-full transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}

              {(validationError || uploadError) && (
                <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 text-xs rounded-lg border border-rose-200 dark:border-rose-900">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{validationError || uploadError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!file || isUploading}
                  onClick={handleStartUpload}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Streaming ({uploadProgress}%)...
                    </>
                  ) : (
                    'Proceed to Staging'
                  )}
                </button>
              </div>
            </div>
          ) : (
            /* STEP 2: METADATA & ACADEMIC DIMENSIONS FORM */
            <form onSubmit={handleSubmitMetadata} className="space-y-4">
              <div className="flex items-center gap-2 p-2.5 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 text-xs rounded-lg border border-emerald-200 dark:border-emerald-900">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  CAS Spool Verified: SHA-256 <code className="font-mono">{stagedTicket.file_hash?.slice(0, 16)}...</code> ({(stagedTicket.file_size_bytes / (1024 * 1024)).toFixed(2)} MB)
                </span>
              </div>

              {/* Title & Author */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Material Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => updateField('title', e.target.value)}
                    placeholder="e.g. Introduction to Algorithms (4th Edition)"
                    className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Author / Creator
                  </label>
                  <input
                    type="text"
                    value={formData.author}
                    onChange={(e) => updateField('author', e.target.value)}
                    placeholder="e.g. Thomas H. Cormen, et al."
                    className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Category & Item Classification */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Catalog Category *
                  </label>
                  <select
                    value={formData.categoryId}
                    onChange={(e) => updateField('categoryId', e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="textbooks">Textbooks & E-Books</option>
                    <option value="courses">Course Materials</option>
                    <option value="past_questions">Past Questions Vault</option>
                    <option value="faculty_resources">Faculty Resources</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Classification Type *
                  </label>
                  <select
                    value={formData.itemType}
                    onChange={(e) => updateField('itemType', e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="TEXTBOOK">Textbook</option>
                    <option value="REFERENCE_BOOK">Reference Book</option>
                    <option value="LECTURE_NOTE">Lecture Note / Slide Deck</option>
                    <option value="LAB_MANUAL">Lab Manual</option>
                    <option value="SEMESTER_EXAM_PQ">Semester Examination Paper</option>
                    <option value="MIDTERM_TEST_PQ">Mid-Semester Test Paper</option>
                    <option value="HANDBOOK">Departmental Handbook</option>
                    <option value="RESEARCH_TEMPLATE">Research / LaTeX Template</option>
                    <option value="POLICY_DOCUMENT">Faculty Policy Document</option>
                  </select>
                </div>
              </div>

              {/* Course & Department Dimensions */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Course Code (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.courseId}
                    onChange={(e) => updateField('courseId', e.target.value.toUpperCase())}
                    placeholder="e.g. CSC201"
                    className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg uppercase focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Department
                  </label>
                  <select
                    disabled={user?.role === 'HOD'}
                    value={formData.departmentId}
                    onChange={(e) => updateField('departmentId', e.target.value)}
                    className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                  >
                    <option value="CSC">Computer Science</option>
                    <option value="IFT">Information Technology</option>
                    <option value="SWE">Software Engineering</option>
                    <option value="CYB">Cybersecurity</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Level
                  </label>
                  <select
                    value={formData.level}
                    onChange={(e) => updateField('level', parseInt(e.target.value, 10))}
                    className="w-full text-xs px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value={100}>100 Level</option>
                    <option value={200}>200 Level</option>
                    <option value={300}>300 Level</option>
                    <option value={400}>400 Level</option>
                    <option value={500}>500 Level</option>
                  </select>
                </div>
              </div>

              {/* Zero-Day Exam Embargo Quarantine Field */}
              {isExamPQ && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-xl space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                    <Clock className="w-4 h-4" />
                    Zero-Day Exam Quarantine Scheduler (Invariant 4)
                  </div>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Examination papers cannot be published without a quarantine date. Students cannot access or stream this paper until after the embargo timestamp expires.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Embargo Lift Date & Time (UTC) *
                    </label>
                    <input
                      type="datetime-local"
                      required={formData.isPublished}
                      value={formData.embargoUntil}
                      onChange={(e) => updateField('embargoUntil', e.target.value)}
                      className="text-xs px-3 py-2 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-lg focus:ring-2 focus:ring-amber-500"
                    />
                  </div>
                </div>
              )}

              {/* Publication Status & Flags */}
              <div className="flex items-center gap-6 pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isPublished}
                    onChange={(e) => updateField('isPublished', e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  Publish Immediately (Subject to Embargo)
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.isFeatured}
                    onChange={(e) => updateField('isFeatured', e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                  />
                  Featured Resource
                </label>
              </div>

              {commitError && (
                <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 text-xs rounded-lg border border-rose-200 dark:border-rose-900">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{commitError?.detail || commitError?.message || 'Failed to commit material metadata.'}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setStagedTicket(null)}
                  disabled={isCommitting}
                  className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Back to Binary
                </button>
                <button
                  type="submit"
                  disabled={isCommitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
                >
                  {isCommitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Committing Ledger...
                    </>
                  ) : (
                    'Commit & Ingest to Library'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

