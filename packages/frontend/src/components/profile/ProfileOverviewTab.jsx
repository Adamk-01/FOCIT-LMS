import React from 'react';
import { ShieldCheck, Image as ImageIcon } from 'lucide-react';

/**
 * <ProfileOverviewTab />
 *
 * Tier 1 Read-only Academic Ledger & Compression Telemetry Card
 */
export function ProfileOverviewTab({ profile, compressionMetrics }) {
  return (
    <section aria-labelledby="academic-standing-heading" className="flex flex-col gap-6">
      {compressionMetrics && (
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs flex items-center justify-between text-slate-700 dark:text-slate-300">
          <div className="flex items-center gap-2">
            <ImageIcon size={16} className="text-[#0a1142] dark:text-[#ffb81c]" />
            <span>Latest Avatar Compression Telemetry:</span>
            <strong className="text-[#0a1142] dark:text-[#ffb81c]">{compressionMetrics.original}</strong> downsampled to{' '}
            <strong className="text-emerald-700 dark:text-emerald-400">{compressionMetrics.compressed}</strong>
          </div>
          <span className="text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full font-bold">
            LMK Safe (&lt;120KB)
          </span>
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-6 transition-colors">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div>
            <h2 id="academic-standing-heading" className="text-lg font-bold text-[#0a1142] dark:text-[#ffb81c]">
              Institutional Academic Record
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Authoritative student record administered by the Osun State University Academic Affairs Directorate.
            </p>
          </div>
          <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
            Tier 1 Read-Only Ledger
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Full Legal Name</span>
            <span className="text-base font-bold text-[#0a1142] dark:text-slate-100">{profile?.full_name}</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Verified against University Matriculation Registry</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Matriculation Number</span>
            <span className="text-base font-mono font-bold text-[#0a1142] dark:text-[#ffb81c]">{profile?.matric_number}</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Unique institutional identity key</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Institutional Email</span>
            <span className="text-base font-bold text-[#0a1142] dark:text-slate-100 truncate">{profile?.institutional_email}</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Primary single-sign-on conduit</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Degree Programme</span>
            <span className="text-base font-bold text-[#0a1142] dark:text-slate-100">{profile?.programme_name}</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">{profile?.department_name}</span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Academic Standing & GPA</span>
            {profile?.gpa_exempt ? (
              <div className="space-y-1">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  EXEMPT (100L/200L Inter-Faculty)
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                  Foundational inter-faculty courses excluded until 300L core progression.
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-black text-emerald-700 dark:text-emerald-400">
                    {Number(profile?.current_gpa || 0).toFixed(2)}
                  </span>
                  <span className="text-xs font-bold text-slate-500 dark:text-slate-400">/ 5.00 ({profile?.standing_label || 'Good Standing'})</span>
                </div>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">Calculated after Semester 1 moderation</span>
              </>
            )}
          </div>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Cumulative Registered Units</span>
            <span className="text-base font-bold text-[#0a1142] dark:text-slate-100">{profile?.completed_units} Units</span>
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Earned towards graduation quota</span>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-3">
          <ShieldCheck className="text-[#16258f] dark:text-[#ffb81c] shrink-0 mt-0.5" size={18} />
          <div className="leading-relaxed">
            <strong>Administrative Policy:</strong> Academic credentials cannot be modified from the student portal. If any academic details are inaccurate, please lodge a formal petition with the Faculty Officer, Faculty of Computing and Information Technology (FOCIT).
          </div>
        </div>
      </div>
    </section>
  );
}

export default ProfileOverviewTab;
