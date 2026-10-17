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
} from 'lucide-react';

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

  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [submissionText, setSubmissionText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [submitError, setSubmitError] = useState(null);

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
    setFileName(assignment.submission?.file_name || '');
    setFileSize(assignment.submission?.file_size_bytes || null);
    setIdempotencyKey(generateIdempotencyKey());
    setSubmitError(null);
  };

  const closeSubmissionModal = () => {
    setSelectedAssignment(null);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-assignments', courseId] });
      closeSubmissionModal();
    },
    onError: (err) => {
      setSubmitError(err.message);
    },
  });

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setFileSize(file.size);
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!selectedAssignment || submitMutation.isPending) return;

    const cleanFileName = fileName.trim();
    const simulatedFileUrl = cleanFileName
      ? `/api/files/submissions/${encodeURIComponent(courseId)}/${encodeURIComponent(cleanFileName)}`
      : null;

    submitMutation.mutate({
      assignmentId: selectedAssignment.assignment_id,
      key: idempotencyKey,
      payload: {
        submission_text: submissionText.trim(),
        file_name: cleanFileName || null,
        file_url: simulatedFileUrl,
        file_size_bytes: fileSize || null,
      },
    });
  };

  // 1. Loading Skeleton State
  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading course assignments">
        {[1, 2].map((skeletonId) => (
          <div
            key={skeletonId}
            className="p-6 bg-white rounded-xl border border-slate-200 animate-pulse space-y-3"
          >
            <div className="h-5 bg-slate-200 rounded w-1/3" />
            <div className="h-4 bg-slate-100 rounded w-3/4" />
            <div className="h-4 bg-slate-100 rounded w-1/2" />
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
        className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-sm">Unable to load course assignments</h3>
            <p className="text-xs text-red-700 mt-1">{error?.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-white text-red-800 border border-red-300 hover:bg-red-100 transition-colors"
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
      <div className="p-12 bg-white rounded-xl border border-slate-200 text-center space-y-3">
        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
          <FileText className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-800">
          No Assignments Published Yet
        </h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          The course lecturer has not published any active problem sets or practical briefs for{' '}
          <span className="font-semibold text-slate-700">{data?.course_code || courseId}</span>.
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
            className="p-6 bg-white rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h3 className="text-base font-bold text-slate-900">{assignment.title}</h3>
                  {isGraded ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      GRADED ({sub.grade} / {assignment.max_points})
                    </span>
                  ) : isSubmitted ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {sub.status === 'LATE' ? 'SUBMITTED LATE' : 'SUBMITTED'}
                    </span>
                  ) : assignment.is_overdue ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-50 text-red-800 border border-red-200">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      OVERDUE
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                      <Clock className="w-3.5 h-3.5" />
                      DUE SOON
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Assigned by <span className="font-semibold text-slate-700">{assignment.lecturer_name}</span> • Weight:{' '}
                  <span className="font-semibold text-slate-700">{assignment.weight_percent}%</span> of Final Grade ({assignment.max_points} pts)
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 shrink-0">
                <Calendar className="w-4 h-4 text-slate-400" />
                <span>
                  Due: <strong className="text-slate-800">{new Date(assignment.due_date).toLocaleString()}</strong>
                </span>
              </div>
            </div>

            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {assignment.description}
            </p>

            {/* Lecturer Feedback Callout when Graded */}
            {isGraded && sub.feedback && (
              <div className="p-4 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-950 space-y-1">
                <div className="font-bold uppercase tracking-wider text-[11px] text-emerald-800">
                  Lecturer Evaluation Feedback
                </div>
                <p className="text-sm">{sub.feedback}</p>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
              <div>
                {assignment.file_url && (
                  <a
                    href={assignment.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-xs font-semibold text-indigo-700 hover:text-indigo-900 bg-indigo-50 px-3 py-2 rounded-lg border border-indigo-200 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{assignment.file_name || 'Download Brief'}</span>
                    <span className="text-indigo-500 font-normal">({formatBytes(assignment.file_size_bytes)})</span>
                  </a>
                )}
              </div>

              <div className="flex items-center gap-3">
                {isGraded ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 px-3 py-2 bg-slate-100 rounded-lg">
                    <Lock className="w-3.5 h-3.5" />
                    Submission Locked (Graded)
                  </span>
                ) : assignment.status === 'CLOSED' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 px-3 py-2 bg-slate-100 rounded-lg">
                    <Lock className="w-3.5 h-3.5" />
                    Assignment Closed
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => openSubmissionModal(assignment)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold bg-[#0a1142] text-white hover:bg-[#16258f] transition-colors cursor-pointer"
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

      {/* 4. Viewport-Locked Semantic <dialog> Submission Modal (Invariant 1) */}
      <dialog
        ref={dialogRef}
        onClose={closeSubmissionModal}
        className="fixed inset-0 m-auto w-[min(92vw,640px)] max-h-[min(90dvh,720px)] rounded-2xl bg-white p-0 shadow-2xl border border-slate-200 overflow-hidden backdrop:bg-slate-900/50 backdrop:backdrop-blur-xs"
        style={{ contain: 'layout paint size' }}
      >
        {selectedAssignment && (
          <form onSubmit={handleFormSubmit} className="flex flex-col max-h-[min(90dvh,720px)]">
            {/* Locked Header (flex: 0 0 auto) */}
            <div className="flex-none px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {selectedAssignment.submission ? 'Update Submission' : 'Submit Assignment'}
                </h2>
                <p className="text-xs text-slate-500 truncate max-w-md">
                  {selectedAssignment.title}
                </p>
              </div>
              <button
                type="button"
                onClick={closeSubmissionModal}
                aria-label="Close submission modal"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quarantined Scrollport (flex: 1 1 auto; min-height: 0) */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4">
              {submitError && (
                <div role="alert" className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 font-medium">
                  {submitError}
                </div>
              )}

              <div>
                <label htmlFor="submission-text" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Written Solution / Technical Notes
                </label>
                <textarea
                  id="submission-text"
                  rows={5}
                  value={submissionText}
                  onChange={(e) => setSubmissionText(e.target.value)}
                  placeholder="Paste your repository link, complexity analysis, or written answer here..."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0a1142] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="submission-file" className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Attach Solution Archive / Source File
                </label>
                <input
                  id="submission-file"
                  type="file"
                  onChange={handleFileSelect}
                  className="block w-full text-xs text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-[#0a1142] hover:file:bg-blue-100"
                />
                {fileName && (
                  <p className="text-xs text-emerald-700 font-medium mt-2">
                    Selected file: <strong>{fileName}</strong> ({formatBytes(fileSize)})
                  </p>
                )}
              </div>
            </div>

            {/* Locked Footer (flex: 0 0 auto) */}
            <div className="flex-none px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeSubmissionModal}
                disabled={submitMutation.isPending}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-200/70 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitMutation.isPending || (!submissionText.trim() && !fileName.trim())}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold bg-[#0a1142] text-white hover:bg-[#16258f] disabled:opacity-50 disabled:pointer-events-none transition-colors"
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
