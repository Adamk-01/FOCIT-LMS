import React, { useState } from 'react';
import { 
  FileText, 
  Download, 
  Eye, 
  ExternalLink, 
  BookOpen, 
  CheckCircle2, 
  Clock, 
  Loader2,
  Calendar,
  Layers,
  GraduationCap
} from 'lucide-react';
import { Link } from 'react-router-dom';

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatItemType(type) {
  if (!type) return 'DOCUMENT';
  return type
    .replace(/_PQ$/, ' PAST QUESTION')
    .replace(/_/g, ' ')
    .toUpperCase();
}

export function LibraryItemCard({ item, onPreview, onDownload }) {
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownloadClick = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      await onDownload(item);
    } finally {
      setIsDownloading(false);
    }
  };

  const isTextbook = item.category_id === 'textbooks' || item.item_type?.includes('TEXTBOOK');
  const isCourse = item.category_id === 'courses';

  return (
    <article className="flex flex-col h-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden hover:border-indigo-400 dark:hover:border-indigo-500/60 hover:shadow-xl hover:shadow-indigo-500/5 transition-all duration-200 group">
      {/* 1. Header & Badge Ribbon */}
      <div className="p-5 sm:p-6 pb-3">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Primary Classification Pill */}
            <span className="px-2.5 py-1 rounded-lg text-[10px] sm:text-[11px] font-bold tracking-wider uppercase bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/50">
              {formatItemType(item.item_type)}
            </span>

            {/* Course Code Tag */}
            {item.course_id && (
              <span className="px-2.5 py-1 rounded-lg text-[10px] sm:text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                {item.course_id}
              </span>
            )}

            {/* Department Tag (if no course code) */}
            {item.department_id && !item.course_id && (
              <span className="px-2.5 py-1 rounded-lg text-[10px] sm:text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {item.department_id}
              </span>
            )}

            {/* Academic Level */}
            {item.level && (
              <span className="px-2.5 py-1 rounded-lg text-[10px] sm:text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                {item.level}L
              </span>
            )}

            {/* Stale Cache Visual Provenance Warning */}
            {item.is_stale && (
              <span 
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                title="Served from SWR cache due to upstream Moodle timeout"
              >
                <Clock className="w-3 h-3" />
                <span>Cached</span>
              </span>
            )}
          </div>

          {/* Featured / Verified Stamp */}
          {item.is_featured && (
            <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200/60 dark:border-emerald-800/40">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Verified</span>
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
          {item.title}
        </h3>

        {/* Author / Publisher / Session Details */}
        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 line-clamp-1 flex items-center gap-1.5 flex-wrap">
          {item.author && (
            <span>By <strong className="font-medium text-slate-700 dark:text-slate-300">{item.author}</strong></span>
          )}
          {item.publication_year && <span>({item.publication_year})</span>}
          {item.academic_session && (
            <span className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-300">
              <Calendar className="w-3 h-3 text-indigo-500" />
              <span>{item.academic_session} • {item.semester_number === 1 ? 'Harmattan' : 'Rain'}</span>
            </span>
          )}
        </div>
      </div>

      {/* 2. Visual Cover Art if Textbook */}
      {isTextbook && item.cover_image_url && (
        <div className="px-5 sm:px-6 mb-3">
          <div className="h-40 w-full rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-800 relative border border-slate-100 dark:border-slate-800 shadow-inner">
            <img 
              src={item.cover_image_url} 
              alt={`Cover for ${item.title}`}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
            />
          </div>
        </div>
      )}

      {/* 3. Description Snippet */}
      {item.description && (
        <div className="px-5 sm:px-6 text-xs text-slate-600 dark:text-slate-400 line-clamp-2 mb-4 leading-relaxed">
          {item.description}
        </div>
      )}

      {/* 4. Metadata Metrics Strip */}
      <div className="mt-auto px-5 sm:px-6 py-3 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/40 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-3 font-medium">
          <span title="File size">{formatBytes(item.file_size_bytes)}</span>
          {item.page_count && <span>• {item.page_count} pages</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5" title="Reading Views">
            <Eye className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold">{item.view_count || 0}</span>
          </span>
          <span className="flex items-center gap-1.5" title="Downloads">
            <Download className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-semibold">{item.download_count || 0}</span>
          </span>
        </div>
      </div>

      {/* 5. Action Footer Buttons */}
      <div className="p-3 sm:p-4 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2.5 bg-white dark:bg-slate-900">
        {/* Primary: Preview / Read Online Button */}
        <button
          type="button"
          onClick={() => onPreview(item)}
          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm shadow-indigo-600/20 transition-all cursor-pointer"
        >
          <Eye className="w-4 h-4" />
          <span>Read Online</span>
        </button>

        {/* Mutation-Locked Download Button */}
        <button
          type="button"
          onClick={handleDownloadClick}
          disabled={isDownloading}
          aria-label={`Download ${item.title}`}
          className="inline-flex items-center justify-center p-2.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
          title="Download PDF"
        >
          {isDownloading ? (
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
          ) : (
            <Download className="w-4 h-4" />
          )}
        </button>

        {/* Course Room Jump Action */}
        {isCourse && item.course_id && (
          <Link
            to={`/courses/${encodeURIComponent(item.course_id)}?tab=materials`}
            className="inline-flex items-center justify-center p-2.5 text-xs font-semibold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            title="Open in Course Room"
          >
            <ExternalLink className="w-4 h-4" />
          </Link>
        )}
      </div>
    </article>
  );
}
