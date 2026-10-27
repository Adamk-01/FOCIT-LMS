import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../lib/api';
import {
  FileText,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Upload,
  Download,
  Lock,
  RefreshCw,
  X,
  Trash2,
} from 'lucide-react';
import { toast } from 'react-toastify';

function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `idem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function formatBytes(bytes) {
  if (!bytes || Number.isNaN(Number(bytes))) return 'PDF Brief';
  const mb = Number(bytes) / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(2)} MB` : `${Math.round(Number(bytes) / 1024)} KB`;
}

export default function AssignmentsTab({ courseId }) {
  const queryClient = useQueryClient();
  const dialogRef = useRef(null);
  const fileInputRef = useRef(null);

  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [submissionText, setSubmissionText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(null);
  const [hasRemovedFile, setHasRemovedFile] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitError, setSubmitError] = useState(null);
  const isSubmittingRef = useRef(false);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['course-assignments', courseId],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get(`/courses/${encodeURIComponent(courseId)}/assignments`, { signal });
      return res.data;
    },
    staleTime: 30_000,
  });

  // Manage native <dialog> top-layer modal lifecycle
  useEffect(() => {
    const dialogNode = dialogRef.current;
    if (!dialogNode) return;

    if (selectedAssignment) {
      if (!dialogNode.open) {
        dialogNode.showModal();
      }
    } else if (dialogNode.open) {
      dialogNode.close();
    }
  }, [selectedAssignment]);

  const openSubmissionModal = (assignment) => {
    setSelectedAssignment(assignment);
    setSubmissionText(assignment.submission?.submission_text || '');
    setSelectedFile(null);
    setFileName(assignment.submission?.file_name || '');
    setFileSize(assignment.submission?.file_size_bytes || null);
    setHasRemovedFile(false);
    setIdempotencyKey(generateIdempotencyKey());
    setSubmitError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const closeSubmissionModal = () => {
    isSubmittingRef.current = false;

    // Explicitly close native HTML5 <dialog> top-layer node directly
    try {
      if (dialogRef.current && dialogRef.current.open) {
        dialogRef.current.close();
      }
    } catch (_) {}

    setSelectedAssignment(null);
    setSelectedFile(null);
    setFileName('');
    setFileSize(null);
    setHasRemovedFile(false);
    setSubmitError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setFileName('');
    setFileSize(null);
    setHasRemovedFile(true);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setSubmitError(null);
  };

  const submitMutation = useMutation({
    mutationFn: async ({ assignmentId, payload, key }) => {
      const res = await apiClient.post(
        `/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submit`,
        payload,
        {
          headers: {
            'X-Idempotency-Key': key,
          },
        }
      );
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['course-assignments', courseId] });
      toast.success(data?.message || 'Assignment submitted successfully!');
      closeSubmissionModal();
    },
    onError: (err) => {
      const errorMsg = err?.detail || err?.message || 'Submission failed';
      toast.error(errorMsg);
      setSubmitError(errorMsg);
      isSubmittingRef.current = false;
    },
  });

  const handleCancelModal = (e) => {
    e.preventDefault();
    closeSubmissionModal();
  };

  const handleDialogClick = (e) => {
    // If user clicks the native ::backdrop outside the modal form
    if (e.target === dialogRef.current) {
      closeSubmissionModal();
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setFileName('');
      setFileSize(null);
      return;
    }

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      setSubmitError('File exceeds 10MB institutional ceiling. Please compress before attaching.');
      e.target.value = '';
      return;
    }

    const validExtensions = ['.pdf', '.zip', '.docx'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!validExtensions.includes(ext)) {
      setSubmitError('Invalid file format. Only PDF (.pdf), ZIP (.zip), and Word (.docx) files are supported.');
      e.target.value = '';
      return;
    }

    setSubmitError(null);
    setSelectedFile(file);
    setFileName(file.name);
    setFileSize(file.size);
    setHasRemovedFile(false);
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!selectedAssignment || submitMutation.isPending || isSubmittingRef.current) return;

    const existingFileUrl = hasRemovedFile ? null : (selectedAssignment.submission?.file_url || null);

    if (!submissionText.trim() && !selectedFile && !existingFileUrl) {
      setSubmitError('Submission requires either written solution text or an attached file.');
      return;
    }

    isSubmittingRef.current = true;

    if (selectedFile) {
      const formData = new FormData();
      if (submissionText.trim()) {
        formData.append('submission_text', submissionText.trim());
      }
      formData.append('file', selectedFile);
      formData.append('idempotency_key', idempotencyKey);

      submitMutation.mutate({
        assignmentId: selectedAssignment.assignment_id,
        key: idempotencyKey,
        payload: formData,
      });
    } else {
      submitMutation.mutate({
        assignmentId: selectedAssignment.assignment_id,
        key: idempotencyKey,
        payload: {
          submission_text: submissionText.trim() || null,
          file_name: hasRemovedFile ? null : (fileName || null),
          file_url: existingFileUrl,
          file_size_bytes: hasRemovedFile ? null : (fileSize || null),
          remove_file: hasRemovedFile,
        },
      });
    }
  };

  // 1. Loading Skeleton State
  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading course assignments">
        {[1, 2].map((skeletonId) => (
          <div
            key={skeletonId}
            className="p-6 bg-surface rounded-xl border border-surface-border animate-pulse space-y-3"
          >
            <div className="h-5 bg-surface-alt rounded w-1/3" />
            <div className="h-4 bg-surface-alt rounded w-3/4" />
            <div className="h-4 bg-surface-alt rounded w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  // 2. Unhappy Error Boundary State
  if (isError) {
    return (
      <div
        role="alert"
        className="p-6 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl text-red-900 dark:text-red-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-sm">Unable to load course assignments</h3>
            <p className="text-xs text-red-700 dark:text-red-300 mt-1">{error?.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-surface text-red-800 dark:text-red-300 border border-red-300 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  const assignments = data?.assignments || [];

  // 3. Empty State
  if (assignments.length === 0) {
    return (
      <div className="p-12 bg-surface rounded-xl border border-surface-border text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-surface-alt text-focitText-muted flex items-center justify-center mx-auto">
          <FileText className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-focitText-primary">
          No Assignments Published Yet
        </h3>
        <p className="text-xs text-focitText-muted max-w-md mx-auto">
          The course lecturer has not published any active problem sets or practical briefs for{' '}
          <span className="font-semibold text-focitText-primary">{data?.course?.code || data?.course_code || courseId}</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {assignments.map((assignment) => {
        const sub = assignment.submission;
        const isGraded = sub?.status === 'GRADED';
        const isSubmitted = Boolean(sub);

        return (
          <article
            key={assignment.assignment_id}
            className="p-6 bg-surface rounded-xl border border-surface-border shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-base font-bold text-focitText-primary">{assignment.title}</h3>
                  {isGraded ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      GRADED ({sub.grade} / {assignment.max_points})
                    </span>
                  ) : isSubmitted ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {sub.status === 'LATE' ? 'SUBMITTED LATE' : 'SUBMITTED'}
                    </span>
                  ) : assignment.is_overdue ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-50 dark:bg-red-950/50 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      OVERDUE
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                      <Clock className="w-3.5 h-3.5" />
                      DUE SOON
                    </span>
                  )}
                </div>
                <p className="text-xs text-focitText-muted mt-1">
                  Assigned by <span className="font-semibold text-focitText-secondary">{assignment.lecturer_name}</span> • Weight:{' '}
                  <span className="font-semibold text-focitText-secondary">{assignment.weight_percent}%</span> of Final Grade ({assignment.max_points} pts)
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs text-focitText-secondary bg-surface-alt px-3 py-1.5 rounded-lg border border-surface-border shrink-0">
                <Calendar className="w-4 h-4 text-focitText-muted" />
                <span>
                  Due: <strong className="text-focitText-primary">{new Date(assignment.due_date).toLocaleString()}</strong>
                </span>
              </div>
            </div>

            <p className="text-sm text-focitText-secondary leading-relaxed whitespace-pre-line">
              {assignment.description}
            </p>

            {/* Student Existing Submission Preview */}
            {isSubmitted && sub && (
              <div className="p-3.5 rounded-xl bg-surface-alt border border-surface-border space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-focitText-secondary uppercase tracking-wider text-[10px]">Your Current Submission</span>
                  <span className="text-focitText-muted">Submitted on: {new Date(sub.submitted_at).toLocaleString()}</span>
                </div>
                {sub.submission_text && (
                  <p className="text-xs text-focitText-primary bg-surface p-2.5 rounded-lg border border-surface-border line-clamp-3">
                    {sub.submission_text}
                  </p>
                )}
                {sub.file_url && (
                  <div className="flex items-center justify-between bg-surface px-3 py-2 rounded-lg border border-surface-border text-xs">
                    <span className="font-semibold text-focitText-primary truncate max-w-xs">
                      {sub.file_name || 'Attached Submission Archive'}
                    </span>
                    <a
                      href={sub.file_url}
                      download={sub.file_name || 'submission'}
                      className="inline-flex items-center gap-1 font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 ml-2 shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download ({formatBytes(sub.file_size_bytes)})</span>
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Lecturer Feedback Callout when Graded */}
            {isGraded && sub.feedback && (
              <div className="p-4 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-950 dark:text-emerald-200 space-y-1">
                <div className="font-bold uppercase tracking-wider text-[11px] text-emerald-800 dark:text-emerald-400">
                  Lecturer Evaluation Feedback
                </div>
                <p className="text-sm">{sub.feedback}</p>
              </div>
            )}

            <div className="pt-3 border-t border-surface-border flex flex-wrap items-center justify-between gap-3">
              <div>
                {assignment.file_url && (
                  <a
                    href={assignment.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 bg-indigo-50 dark:bg-indigo-950/50 px-3 py-2 rounded-lg border border-indigo-200 dark:border-indigo-800 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{assignment.file_name || 'Download Brief'}</span>
                    <span className="text-indigo-500 font-normal">({formatBytes(assignment.file_size_bytes)})</span>
                  </a>
                )}
              </div>

              <div className="flex items-center gap-3">
                {isGraded ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-focitText-muted px-3 py-2 bg-surface-alt rounded-lg border border-surface-border">
                    <Lock className="w-3.5 h-3.5" />
                    Submission Locked (Graded)
                  </span>
                ) : assignment.status === 'CLOSED' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-focitText-muted px-3 py-2 bg-surface-alt rounded-lg border border-surface-border">
                    <Lock className="w-3.5 h-3.5" />
                    Assignment Closed
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openSubmissionModal(assignment)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[#0a1142] dark:bg-indigo-600 text-white hover:bg-[#16258f] dark:hover:bg-indigo-700 transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {isSubmitted ? 'Update Submission' : 'Submit Assignment'}
                  </button>
                )}
              </div>
            </div>
          </article>
        );
      })}

      {/* 4. Viewport-Locked Semantic <dialog> Submission Modal with Top-Layer Isolation */}
      <dialog
        ref={dialogRef}
        onClick={handleDialogClick}
        onCancel={handleCancelModal}
        onClose={closeSubmissionModal}
        className="fixed inset-0 m-auto w-[min(92vw,640px)] max-h-[min(90dvh,720px)] rounded-2xl bg-surface dark:bg-surface-elevated p-0 shadow-2xl border border-surface-border overflow-hidden backdrop:bg-black/60 backdrop:backdrop-blur-sm text-focitText-primary z-50"
        style={{ contain: 'layout paint' }}
      >
        {selectedAssignment && (
          <form onSubmit={handleFormSubmit} className="flex flex-col max-h-[min(90dvh,720px)]">
            {/* Locked Header (flex: 0 0 auto) */}
            <div className="flex-none px-6 py-4 border-b border-surface-border flex items-center justify-between bg-surface-alt">
              <div>
                <h2 className="text-base font-bold text-focitText-primary">
                  {selectedAssignment.submission ? 'Update Submission' : 'Submit Assignment'}
                </h2>
                <p className="text-xs text-focitText-muted truncate max-w-md">
                  {selectedAssignment.title}
                </p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeSubmissionModal();
                }}
                disabled={submitMutation.isPending}
                aria-label="Close submission modal"
                className="p-2 rounded-lg text-focitText-muted hover:text-focitText-primary hover:bg-surface disabled:opacity-40 disabled:pointer-events-none cursor-pointer transition-colors active:scale-95 touch-manipulation"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {/* Quarantined Scrollport (flex: 1 1 auto; min-height: 0) */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4">
              {submitError && (
                <div role="alert" className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-800 dark:text-red-300 font-medium">
                  {submitError}
                </div>
              )}

              <div>
                <label htmlFor="submission-text" className="block text-xs font-bold text-focitText-secondary uppercase tracking-wider mb-1.5">
                  Written Solution / Technical Notes
                </label>
                <textarea
                  id="submission-text"
                  rows={4}
                  value={submissionText}
                  onChange={(e) => setSubmissionText(e.target.value)}
                  placeholder="Paste your repository link, complexity analysis, or written answer here..."
                  className="w-full rounded-xl border border-surface-border bg-surface px-3.5 py-2.5 text-sm text-focitText-primary placeholder:text-focitText-muted focus:border-[#0a1142] dark:focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="submission-file" className="block text-xs font-bold text-focitText-secondary uppercase tracking-wider mb-1.5">
                  Attach Solution File (PDF, ZIP, DOCX — Max 10MB)
                </label>
                <input
                  ref={fileInputRef}
                  id="submission-file"
                  type="file"
                  accept=".pdf,.zip,.docx,application/pdf,application/zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileSelect}
                  className="block w-full text-xs text-focitText-secondary file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 dark:file:bg-slate-800 file:text-[#0a1142] dark:file:text-indigo-400 hover:file:bg-blue-100 dark:hover:file:bg-slate-700 cursor-pointer"
                />
                {fileName ? (
                  <div className="mt-2.5 p-3 rounded-xl bg-gray-50 dark:bg-slate-800/80 border border-gray-200 dark:border-slate-700 flex items-center justify-between gap-3 animate-fade-in">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                        <FileText className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-800 dark:text-slate-200 truncate">
                          {fileName}
                        </p>
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                          {formatBytes(fileSize)} • Attached
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      disabled={submitMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 hover:bg-red-100 dark:hover:bg-red-900/80 transition-colors cursor-pointer active:scale-95 touch-manipulation disabled:opacity-40 shrink-0"
                      title="Remove attached file"
                      aria-label="Remove attached file"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Remove</span>
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-focitText-muted mt-1.5">
                    Accepted formats: PDF (.pdf), Compressed Archive (.zip), or Word (.docx) up to 10MB.
                  </p>
                )}
              </div>
            </div>

            {/* Locked Footer (flex: 0 0 auto) */}
            <div className="flex-none px-6 py-4 border-t border-surface-border bg-surface-alt flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeSubmissionModal();
                }}
                disabled={submitMutation.isPending}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-focitText-secondary hover:bg-surface disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer active:scale-95 touch-manipulation"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  submitMutation.isPending || 
                  (!submissionText.trim() && !selectedFile && !(hasRemovedFile ? false : selectedAssignment.submission?.file_url))
                }
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold bg-[#0a1142] dark:bg-indigo-600 text-white hover:bg-[#16258f] dark:hover:bg-indigo-700 disabled:opacity-50 disabled:pointer-events-none transition-colors"
              >
                {submitMutation.isPending ? 'Committing to Ledger...' : 'Confirm & Submit'}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
