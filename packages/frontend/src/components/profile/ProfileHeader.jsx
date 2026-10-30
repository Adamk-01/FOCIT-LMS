import React from 'react';
import { ShieldCheck, RefreshCw, Camera } from 'lucide-react';

/**
 * <ProfileHeader />
 *
 * Identity hero header with avatar upload trigger, matric number, level, and Senate verification.
 */
export function ProfileHeader({
  profile,
  fileInputRef,
  onAvatarSelect,
  isCompressing,
}) {
  return (
    <header className="relative bg-gradient-to-r from-[#0a1142] via-[#101b60] to-[#16258f] rounded-2xl p-6 sm:p-8 text-white shadow-lg overflow-hidden border border-[#16258f]/40">
      <div className="absolute top-0 right-0 w-96 h-96 bg-[#ffb81c]/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />
      
      <div className="relative z-10 flex flex-col sm:flex-row items-center sm:items-start gap-6">
        {/* Avatar Area with Off-Thread Downsampler */}
        <div className="relative group shrink-0">
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden ring-4 ring-[#ffb81c]/70 shadow-xl bg-slate-800 flex items-center justify-center">
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt={profile.full_name}
                className="w-full h-full object-cover"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-tr from-[#0a1142] to-[#16258f] flex items-center justify-center text-[#ffb81c] text-3xl font-black">
                {profile?.full_name ? profile.full_name.slice(0, 2).toUpperCase() : 'ST'}
              </div>
            )}
          </div>

          {/* Hidden native file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={onAvatarSelect}
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            aria-label="Upload avatar"
          />

          {/* Camera Overlay Trigger */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isCompressing}
            aria-label="Change avatar photo"
            className="absolute bottom-0 right-0 p-2.5 rounded-full bg-[#ffb81c] text-[#0a1142] hover:bg-yellow-400 shadow-md transition-transform duration-150 active:scale-95 disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            {isCompressing ? <RefreshCw size={16} className="animate-spin" /> : <Camera size={16} />}
          </button>
        </div>

        {/* Student Identity Information */}
        <div className="flex-1 text-center sm:text-left min-w-0">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 mb-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight truncate">
              {profile?.full_name || 'Student Identity'}
            </h1>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#ffb81c]/20 text-[#ffb81c] border border-[#ffb81c]/30">
              <ShieldCheck size={12} /> Senate Verified
            </span>
          </div>

          <p className="text-slate-300 text-sm font-medium mb-3">
            {profile?.programme_name} • {profile?.department_name}
          </p>

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-4 text-xs text-slate-300">
            <span className="font-mono bg-white/10 px-2.5 py-1 rounded-md border border-white/10">
              Matric: <strong className="text-white">{profile?.matric_number}</strong>
            </span>
            <span className="bg-white/10 px-2.5 py-1 rounded-md border border-white/10">
              Level: <strong className="text-white">{profile?.level} Level</strong>
            </span>
            {profile?.gpa_exempt ? (
              <span className="bg-amber-400/20 text-[#ffb81c] px-2.5 py-1 rounded-md border border-[#ffb81c]/30 font-bold">
                EXEMPT (100L/200L Inter-Faculty)
              </span>
            ) : (
              <span className="bg-white/10 px-2.5 py-1 rounded-md border border-white/10">
                Current CGPA: <strong className="text-[#ffb81c]">{Number(profile?.current_gpa || 0).toFixed(2)}</strong> / 5.00
              </span>
            )}
            <span className="bg-white/10 px-2.5 py-1 rounded-md border border-white/10">
              Completed Units: <strong className="text-white">{profile?.completed_units}</strong>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

export default ProfileHeader;
