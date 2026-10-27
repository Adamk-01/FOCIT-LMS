import React from 'react';
import { Phone, Mail, MapPin, FileText, RefreshCw, Save } from 'lucide-react';

/**
 * <ProfileDemographicsTab />
 *
 * Tier 2 Mutable State - Demographics Form
 */
export function ProfileDemographicsTab({
  form,
  onChange,
  onSubmit,
  isPending,
  version = 1,
}) {
  return (
    <section aria-labelledby="demographics-heading" className="bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col gap-6 transition-colors">
      <div className="border-b border-slate-100 dark:border-slate-800 pb-4 flex items-center justify-between">
        <div>
          <h2 id="demographics-heading" className="text-lg font-bold text-[#0a1142] dark:text-[#ffb81c]">
            Personal & Contact Demographics
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Update your contact records and student bio. Changes automatically sync to Moodle profile records.
          </p>
        </div>
        <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
          Optimistic Lock v{version}
        </span>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Phone Number */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="phone_number" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Phone size={13} className="text-slate-500 dark:text-slate-400" /> Phone Number (Mobile/WhatsApp)
            </label>
            <input
              id="phone_number"
              type="tel"
              value={form.phone_number}
              onChange={(e) => onChange({ ...form, phone_number: e.target.value })}
              placeholder="+234 803 123 4567"
              className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-[#ffb81c] focus:border-transparent"
            />
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Used for urgent academic notifications & SMS alerts</span>
          </div>

          {/* Alternate Personal Email */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="alternate_email" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Mail size={13} className="text-slate-500 dark:text-slate-400" /> Alternate Email Address
            </label>
            <input
              id="alternate_email"
              type="email"
              value={form.alternate_email}
              onChange={(e) => onChange({ ...form, alternate_email: e.target.value })}
              placeholder="student.personal@gmail.com"
              className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-[#ffb81c] focus:border-transparent"
            />
            <span className="text-[11px] text-slate-400 dark:text-slate-500">Backup channel for password recovery instructions</span>
          </div>
        </div>

        {/* Residential / Hostel Address */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="residential_address" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <MapPin size={13} className="text-slate-500 dark:text-slate-400" /> Campus / Residential Address
          </label>
          <input
            id="residential_address"
            type="text"
            value={form.residential_address}
            onChange={(e) => onChange({ ...form, residential_address: e.target.value })}
            placeholder="Hostel Block B, Room 14, Main Campus, Osogbo"
            maxLength={500}
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-[#ffb81c] focus:border-transparent"
          />
        </div>

        {/* Student Bio */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="bio" className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <FileText size={13} className="text-slate-500 dark:text-slate-400" /> Academic Bio & Interests
            </label>
            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
              {form.bio.length} / 1000
            </span>
          </div>
          <textarea
            id="bio"
            rows={4}
            value={form.bio}
            onChange={(e) => onChange({ ...form, bio: e.target.value })}
            placeholder="Share your academic interests, research focus, or computing specialties..."
            maxLength={1000}
            className="px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] dark:focus:ring-[#ffb81c] focus:border-transparent resize-y"
          />
        </div>

        {/* Action Bar with Mutation Lock */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#0a1142] dark:bg-[#ffb81c] text-white dark:text-[#0a1142] text-xs sm:text-sm font-semibold hover:bg-[#16258f] dark:hover:bg-yellow-400 transition-colors shadow-md disabled:opacity-50 min-h-[44px]"
          >
            {isPending ? (
              <>
                <RefreshCw size={15} className="animate-spin" /> Saving Changes...
              </>
            ) : (
              <>
                <Save size={15} /> Save Demographic Records
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}

export default ProfileDemographicsTab;
