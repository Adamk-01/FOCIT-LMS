import React from 'react';
import { FileText, Eye, Download, ShieldAlert, CheckCircle, Clock, Trash2, Globe, Lock, ExternalLink } from 'lucide-react';
import { useAuth } from '../../../contexts/AuthContext';

export function LibraryAdminTable({
  items,
  isLoading,
  onTogglePublish,
  onHardPurge,
  onPreviewItem,
  isUpdating,
  isDeleting,
}) {
  const { user } = useAuth();
  const isSystemAdmin = user?.role === 'SYSTEM_ADMIN';

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center shadow-sm">
        <FileText className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">No Library Materials Found</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
          No resources match the active category and filter criteria. Adjust your search or ingest a new document.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
              <th className="py-3 px-4">Title & Classification</th>
              <th className="py-3 px-3">Category</th>
              <th className="py-3 px-3">Dimensions</th>
              <th className="py-3 px-3">Storage & CAS</th>
              <th className="py-3 px-3">Status & Embargo</th>
              <th className="py-3 px-3 text-center">Telemetry</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {items.map((item) => {
              const isEmbargoed = item.is_published && item.embargo_until && new Date(item.embargo_until) > new Date();
              const isDraft = !item.is_published;
              const isLive = item.is_published && (!item.embargo_until || new Date(item.embargo_until) <= new Date());
              const sizeMb = (item.file_size_bytes / (1024 * 1024)).toFixed(1);

              return (
                <tr key={item.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                  {/* Title & File */}
                  <td className="py-3 px-4 max-w-xs">
                    <div className="font-semibold text-slate-900 dark:text-white truncate" title={item.title}>
                      {item.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {item.author || item.original_filename || 'Unknown Author'}
                    </div>
                  </td>

                  {/* Category */}
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50">
                      {item.category_id}
                    </span>
                  </td>

                  {/* Academic Dimensions */}
                  <td className="py-3 px-3">
                    <div className="text-slate-700 dark:text-slate-300 font-medium">
                      {item.course_id || item.department_id || 'Faculty'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {item.level ? `${item.level}L` : ''} {item.academic_session ? `• ${item.academic_session}` : ''}
                    </div>
                  </td>

                  {/* Storage & CAS */}
                  <td className="py-3 px-3">
                    <div className="text-slate-700 dark:text-slate-300 font-medium">{sizeMb} MB</div>
                    <div className="text-[10px] text-slate-400 font-mono" title={`CAS Ref Count: ${item.cas_ref_count || 1}`}>
                      refs: {item.cas_ref_count || 1} • {item.page_count ? `${item.page_count}p` : 'doc'}
                    </div>
                  </td>

                  {/* Status & Embargo */}
                  <td className="py-3 px-3">
                    {isEmbargoed ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900">
                        <Clock className="w-3 h-3" />
                        Embargoed until {new Date(item.embargo_until).toLocaleDateString()}
                      </span>
                    ) : isLive ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900">
                        <CheckCircle className="w-3 h-3" />
                        Live
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                        <Lock className="w-3 h-3" />
                        Draft
                      </span>
                    )}
                  </td>

                  {/* Telemetry */}
                  <td className="py-3 px-3 text-center">
                    <div className="inline-flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1" title="Views">
                        <Eye className="w-3 h-3 text-slate-400" />
                        {item.view_count || 0}
                      </span>
                      <span className="inline-flex items-center gap-1" title="Downloads">
                        <Download className="w-3 h-3 text-slate-400" />
                        {item.download_count || 0}
                      </span>
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 text-right">
                    <div className="inline-flex items-center gap-1">
                      {/* Stream Preview */}
                      <a
                        href={`/api/library/items/${item.id}/stream`}
                        target="_blank"
                        rel="noreferrer"
                        className="p-1.5 text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        title="Stream Document in New Tab"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>

                      {/* Publish Toggle */}
                      <button
                        type="button"
                        onClick={() => onTogglePublish(item)}
                        disabled={isUpdating}
                        className={`p-1.5 rounded-lg transition-colors ${
                          item.is_published
                            ? 'text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20'
                            : 'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
                        }`}
                        title={item.is_published ? 'Unpublish to Draft' : 'Publish to Catalog'}
                      >
                        <Globe className="w-3.5 h-3.5" />
                      </button>

                      {/* Hard Purge (SYSTEM_ADMIN only) */}
                      {isSystemAdmin && (
                        <button
                          type="button"
                          onClick={() => onHardPurge(item)}
                          disabled={isDeleting}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors"
                          title="Hard Purge (Permanent Removal)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

