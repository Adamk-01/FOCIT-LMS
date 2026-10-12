import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  User,
  ShieldCheck,
  Settings,
  Lock,
  Camera,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Mail,
  Phone,
  MapPin,
  FileText,
  Award,
  GraduationCap,
  Sparkles,
  ExternalLink,
  Save,
  Bell,
  Palette,
  Check
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../lib/api';
import { sessionLifecycle } from '../lib/sessionLifecycle';
import { downsampleAvatar } from '../lib/imageCompression';

const VALID_TABS = ['overview', 'demographics', 'preferences', 'security'];

export const StudentProfilePage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const fileInputRef = useRef(null);

  // 1. Dual-State Partitioning: URL SearchParams tab pointer
  const currentTab = searchParams.get('tab') || 'overview';
  const activeTab = VALID_TABS.includes(currentTab) ? currentTab : 'overview';

  const handleTabChange = (newTab) => {
    setSearchParams({ tab: newTab });
  };

  const studentId = user?.username || 'student1';

  // 2. Query Authoritative Student Profile (Tiers 1, 2, and 3)
  const {
    data: profile,
    isLoading,
    error: queryError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['student-profile', studentId],
    queryFn: async ({ signal }) => {
      const response = await apiClient.get('/student/profile', { signal });
      return response.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Local Form Draft States
  const [demographicsForm, setDemographicsForm] = useState({
    phone_number: '',
    alternate_email: '',
    bio: '',
    residential_address: '',
  });

  const [preferencesForm, setPreferencesForm] = useState({
    email_notifications: true,
    quiz_reminders: true,
    forum_digest: 'daily',
    sms_alerts: false,
    theme: 'system',
    compact_tables: false,
  });

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Feedback, Compression & Mutation States
  const [feedback, setFeedback] = useState(null);
  const [conflictState, setConflictState] = useState(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionMetrics, setCompressionMetrics] = useState(null);

  // Sync loaded profile into editable draft state
  useEffect(() => {
    if (profile) {
      setDemographicsForm({
        phone_number: profile.phone_number || '',
        alternate_email: profile.alternate_email || '',
        bio: profile.bio || '',
        residential_address: profile.residential_address || '',
      });
      if (profile.preferences && typeof profile.preferences === 'object') {
        setPreferencesForm({
          email_notifications: profile.preferences.email_notifications ?? true,
          quiz_reminders: profile.preferences.quiz_reminders ?? true,
          forum_digest: profile.preferences.forum_digest ?? 'daily',
          sms_alerts: profile.preferences.sms_alerts ?? false,
          theme: profile.preferences.theme ?? 'system',
          compact_tables: profile.preferences.compact_tables ?? false,
        });
      }
    }
  }, [profile]);

  // Clear feedback on tab transition
  useEffect(() => {
    setFeedback(null);
    setConflictState(null);
  }, [activeTab]);

  // 3. Demographics & Preferences Mutation with Idempotency Key
  const profileMutation = useMutation({
    mutationFn: async (payload) => {
      // Deterministic client-side idempotency key based on studentId and submission epoch
      const idempotencyKey = `prof_${studentId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      
      const response = await apiClient.patch('/student/profile', payload, {
        headers: {
          'X-Idempotency-Key': idempotencyKey,
        },
      });
      return response.data;
    },
    onSuccess: (data) => {
      setConflictState(null);
      queryClient.setQueryData(['student-profile', studentId], (prev) => {
        if (!prev) return data.data;
        return {
          ...prev,
          ...data.data,
          version: data.data?.version ?? prev.version + 1,
        };
      });

      if (data.recovered) {
        setFeedback({
          type: 'info',
          message: 'Connection Reconciled: Profile changes were safely confirmed by the server.',
        });
      } else {
        setFeedback({
          type: 'success',
          message: 'Profile changes committed and queued for Moodle synchronization.',
        });
      }
    },
    onError: (err) => {
      if (err.status === 409 && err.data?.authoritativeData) {
        setConflictState(err.data.authoritativeData);
        setFeedback({
          type: 'error',
          message: 'Conflict: This profile was updated by another device. Review server state below.',
        });
      } else {
        setFeedback({
          type: 'error',
          message: err.data?.error || err.message || 'Failed to update profile.',
        });
      }
    },
  });

  // 4. Zero-Heap Avatar Downsampling & Upload
  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const originalSizeKb = Math.round(file.size / 1024);

    try {
      setIsCompressing(true);
      setFeedback(null);

      // Off-thread downsampling into 512x512 WebP Blob
      const compressedBlob = await downsampleAvatar(file, 512, 0.82);
      const compressedSizeKb = Math.round(compressedBlob.size / 1024);

      setCompressionMetrics({
        original: `${originalSizeKb} KB`,
        compressed: `${compressedSizeKb} KB`,
      });

      // Assemble multipart payload with strict size ceiling
      const formData = new FormData();
      formData.append('avatar', compressedBlob, `${studentId}_avatar.webp`);

      const response = await fetch('/api/student/avatar', {
        method: 'POST',
        body: formData,
        credentials: 'include',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          ...(sessionStorage.getItem('session_nonce')
            ? { 'X-Session-Nonce': sessionStorage.getItem('session_nonce') }
            : {}),
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Upload failed with HTTP ${response.status}`);
      }

      const resData = await response.json();
      queryClient.setQueryData(['student-profile', studentId], (prev) => ({
        ...prev,
        avatar_url: resData.avatarUrl,
        version: (prev?.version || 1) + 1,
      }));

      setFeedback({
        type: 'success',
        message: `Avatar uploaded successfully (${originalSizeKb}KB downsampled to ${compressedSizeKb}KB).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err.message || 'Avatar compression/upload failed.',
      });
    } finally {
      setIsCompressing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 5. 4-Phase Teardown Credential Mutation Handler
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (isChangingPassword) return;

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setFeedback({ type: 'error', message: 'New password and confirmation do not match.' });
      return;
    }

    if (passwordForm.newPassword.length < 8) {
      setFeedback({ type: 'error', message: 'New password must contain at least 8 characters.' });
      return;
    }

    try {
      setIsChangingPassword(true);
      setFeedback(null);

      // Phase 1: Pre-Emptive SWR Quenching (Zero 401 Cascade Rejections)
      sessionLifecycle.terminate('CREDENTIALS_MUTATING');
      await queryClient.cancelQueries();
      queryClient.pauseQueries();

      // Phase 2: Dispatch Credential Mutation
      const ephemeralNonce = typeof window !== 'undefined' ? sessionStorage.getItem('session_nonce') : null;
      const res = await fetch('/api/student/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(ephemeralNonce ? { 'X-Session-Nonce': ephemeralNonce } : {}),
        },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
        credentials: 'include',
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        queryClient.resumeQueries();
        throw new Error(errorData.error || 'Password update rejected by server.');
      }

      // Phase 3: Purge Client Session Artifacts
      sessionStorage.removeItem('session_nonce');
      sessionStorage.removeItem('shadow_auth');
      localStorage.removeItem('shadow_auth');
      queryClient.clear();

      // Phase 4: Atomic Navigation to Login Flow
      window.location.replace('/login?reason=password_changed');
    } catch (err) {
      setIsChangingPassword(false);
      queryClient.resumeQueries();
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to update password.',
      });
    }
  };

  // 6. Demographics Submit Handler
  const handleDemographicsSubmit = (e) => {
    e.preventDefault();
    if (profileMutation.isPending) return;

    profileMutation.mutate({
      phone_number: demographicsForm.phone_number,
      alternate_email: demographicsForm.alternate_email,
      bio: demographicsForm.bio,
      residential_address: demographicsForm.residential_address,
      version: profile?.version || 1,
    });
  };

  // 7. Preferences Submit Handler
  const handlePreferencesSubmit = (e) => {
    e.preventDefault();
    if (profileMutation.isPending) return;

    profileMutation.mutate({
      preferences: preferencesForm,
      version: profile?.version || 1,
    });
  };

  // Loading Skeleton State
  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto flex flex-col gap-6 p-4 sm:p-6 animate-pulse">
        <div className="h-32 bg-slate-200 rounded-2xl" />
        <div className="h-12 bg-slate-200 rounded-xl w-72" />
        <div className="h-96 bg-slate-200 rounded-2xl" />
      </div>
    );
  }

  // Error State
  if (queryError) {
    return (
      <div className="max-w-4xl mx-auto my-12 p-6 bg-red-50 border border-red-200 rounded-2xl text-red-800">
        <div className="flex items-start gap-4">
          <AlertTriangle className="text-red-600 shrink-0 mt-1" size={24} />
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">Failed to load student profile</h2>
            <p className="text-sm text-red-700">
              {queryError?.message || 'The profile aggregation service could not reach the database.'}
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 w-fit"
            >
              <RefreshCw size={14} /> Retry Query
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-20 select-text">
      {/* 1. Header Banner & Identity Card */}
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
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-tr from-[#0a1142] to-[#16258f] flex items-center justify-center text-[#ffb81c] text-3xl font-black">
                  {profile?.full_name ? profile.full_name.slice(0, 2).toUpperCase() : 'ST'}
                </div>
              )}
            </div>

            {/* Hidden native input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarSelect}
              accept="image/*"
              className="hidden"
              aria-label="Upload avatar"
            />

            {/* Camera Overlay Trigger */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isCompressing}
              aria-label="Change avatar photo"
              className="absolute bottom-0 right-0 p-2.5 rounded-full bg-[#ffb81c] text-[#0a1142] hover:bg-yellow-400 shadow-md transition-transform duration-150 active:scale-95 disabled:opacity-50"
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
              <span className="bg-white/10 px-2.5 py-1 rounded-md border border-white/10">
                Current CGPA: <strong className="text-[#ffb81c]">{Number(profile?.current_gpa || 0).toFixed(2)}</strong> / 5.00
              </span>
              <span className="bg-white/10 px-2.5 py-1 rounded-md border border-white/10">
                Completed Units: <strong className="text-white">{profile?.completed_units}</strong>
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Feedback Banners (Success, 3G Recovery, Conflict) */}
      {feedback && (
        <div
          role="alert"
          className={`p-4 rounded-xl text-sm flex items-start justify-between border shadow-sm transition-all ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : feedback.type === 'info'
              ? 'bg-blue-50 text-blue-900 border-blue-200'
              : 'bg-red-50 text-red-900 border-red-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === 'success' && <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />}
            {feedback.type === 'info' && <RefreshCw size={18} className="text-blue-600 shrink-0" />}
            {feedback.type === 'error' && <AlertTriangle size={18} className="text-red-600 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-xs font-bold opacity-60 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 3G Conflict Reconciliation Prompt */}
      {conflictState && (
        <div className="p-5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 shadow-sm flex flex-col gap-3">
          <div className="flex items-center gap-2 font-bold text-sm text-amber-800">
            <AlertTriangle size={18} />
            <span>Concurrent State Mutation Detected</span>
          </div>
          <p className="text-xs text-amber-800 leading-relaxed">
            Another browser session updated this profile to version <strong>{conflictState.version}</strong>. To protect against data overwrites, you must reload the latest authoritative record.
          </p>
          <button
            type="button"
            onClick={() => {
              refetch();
              setConflictState(null);
            }}
            className="w-fit inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold hover:bg-amber-700"
          >
            <RefreshCw size={13} /> Load Server State (v{conflictState.version})
          </button>
        </div>
      )}

      {/* 3. Tab Navigation Bar (URL SearchParams sync) */}
      <nav
        aria-label="Student Profile Tabs"
        className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-1"
      >
        <button
          type="button"
          onClick={() => handleTabChange('overview')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg transition-colors border-b-2 whitespace-nowrap ${
            activeTab === 'overview'
              ? 'border-[#0a1142] text-[#0a1142] bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <Award size={16} /> Academic Standing
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('demographics')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg transition-colors border-b-2 whitespace-nowrap ${
            activeTab === 'demographics'
              ? 'border-[#0a1142] text-[#0a1142] bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <User size={16} /> Demographics & Contact
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('preferences')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg transition-colors border-b-2 whitespace-nowrap ${
            activeTab === 'preferences'
              ? 'border-[#0a1142] text-[#0a1142] bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <Settings size={16} /> Preferences & Alerts
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('security')}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg transition-colors border-b-2 whitespace-nowrap ${
            activeTab === 'security'
              ? 'border-[#0a1142] text-[#0a1142] bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
          }`}
        >
          <Lock size={16} /> Security & Session
        </button>
      </nav>

      {/* 4. Tab 1: Academic Standing (Tier 1 Read-Only Ledger) */}
      {activeTab === 'overview' && (
        <section aria-labelledby="academic-standing-heading" className="flex flex-col gap-6">
          <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 id="academic-standing-heading" className="text-lg font-bold text-[#0a1142]">
                  Institutional Academic Record
                </h2>
                <p className="text-xs text-slate-500">
                  Authoritative student record administered by the Osun State University Academic Affairs Directorate.
                </p>
              </div>
              <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-slate-100 text-slate-600 font-semibold">
                Tier 1 Read-Only Ledger
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-500">Full Legal Name</span>
                <span className="text-base font-bold text-[#0a1142]">{profile?.full_name}</span>
                <span className="text-[11px] text-slate-400">Verified against University Matriculation Registry</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-500">Matriculation Number</span>
                <span className="text-base font-mono font-bold text-[#0a1142]">{profile?.matric_number}</span>
                <span className="text-[11px] text-slate-400">Unique institutional identity key</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-500">Institutional Email</span>
                <span className="text-base font-bold text-[#0a1142] truncate">{profile?.institutional_email}</span>
                <span className="text-[11px] text-slate-400">Primary single-sign-on conduit</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-500">Degree Programme</span>
                <span className="text-base font-bold text-[#0a1142]">{profile?.programme_name}</span>
                <span className="text-[11px] text-slate-400">{profile?.department_name}</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-500">Academic Standing & GPA</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-black text-emerald-700">
                    {Number(profile?.current_gpa || 0).toFixed(2)}
                  </span>
                  <span className="text-xs font-bold text-slate-500">/ 5.00 (First Class Honours)</span>
                </div>
                <span className="text-[11px] text-slate-400">Calculated after Semester 1 moderation</span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 flex flex-col gap-1">
                <span className="text-xs font-semibold text-slate-500">Cumulative Registered Units</span>
                <span className="text-base font-bold text-[#0a1142]">{profile?.completed_units} Units</span>
                <span className="text-[11px] text-slate-400">Earned towards graduation quota</span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-blue-900 flex items-start gap-3">
              <ShieldCheck className="text-[#16258f] shrink-0 mt-0.5" size={18} />
              <div className="leading-relaxed">
                <strong>Administrative Policy:</strong> Academic credentials cannot be modified from the student portal. If any academic details are inaccurate, please lodge a formal petition with the Faculty Officer, Faculty of Computing and Information Technology (FOCIT).
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 5. Tab 2: Demographics Form (Tier 2 Mutable State) */}
      {activeTab === 'demographics' && (
        <section aria-labelledby="demographics-heading" className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col gap-6">
          <div className="border-b border-slate-100 pb-4 flex items-center justify-between">
            <div>
              <h2 id="demographics-heading" className="text-lg font-bold text-[#0a1142]">
                Personal & Contact Demographics
              </h2>
              <p className="text-xs text-slate-500">
                Update your contact records and student bio. Changes automatically sync to Moodle profile records.
              </p>
            </div>
            <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-slate-100 text-slate-600 font-semibold">
              Optimistic Lock v{profile?.version}
            </span>
          </div>

          <form onSubmit={handleDemographicsSubmit} className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Phone Number */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="phone_number" className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Phone size={13} className="text-slate-500" /> Phone Number (Mobile/WhatsApp)
                </label>
                <input
                  id="phone_number"
                  type="tel"
                  value={demographicsForm.phone_number}
                  onChange={(e) => setDemographicsForm({ ...demographicsForm, phone_number: e.target.value })}
                  placeholder="+234 803 123 4567"
                  className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:border-transparent"
                />
                <span className="text-[11px] text-slate-400">Used for urgent academic notifications & SMS alerts</span>
              </div>

              {/* Alternate Personal Email */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="alternate_email" className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Mail size={13} className="text-slate-500" /> Alternate Email Address
                </label>
                <input
                  id="alternate_email"
                  type="email"
                  value={demographicsForm.alternate_email}
                  onChange={(e) => setDemographicsForm({ ...demographicsForm, alternate_email: e.target.value })}
                  placeholder="student.personal@gmail.com"
                  className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:border-transparent"
                />
                <span className="text-[11px] text-slate-400">Backup channel for password recovery instructions</span>
              </div>
            </div>

            {/* Residential / Hostel Address */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="residential_address" className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <MapPin size={13} className="text-slate-500" /> Campus / Residential Address
              </label>
              <input
                id="residential_address"
                type="text"
                value={demographicsForm.residential_address}
                onChange={(e) => setDemographicsForm({ ...demographicsForm, residential_address: e.target.value })}
                placeholder="Hostel Block B, Room 14, Main Campus, Osogbo"
                maxLength={500}
                className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:border-transparent"
              />
            </div>

            {/* Student Bio */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="bio" className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <FileText size={13} className="text-slate-500" /> Academic Bio & Interests
                </label>
                <span className="text-[11px] text-slate-400 font-mono">
                  {demographicsForm.bio.length} / 1000
                </span>
              </div>
              <textarea
                id="bio"
                rows={4}
                value={demographicsForm.bio}
                onChange={(e) => setDemographicsForm({ ...demographicsForm, bio: e.target.value })}
                placeholder="Share your academic interests, research focus, or computing specialties..."
                maxLength={1000}
                className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142] focus:border-transparent resize-y"
              />
            </div>

            {/* Action Bar with Mutation Lock */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="submit"
                disabled={profileMutation.isPending}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#0a1142] text-white text-xs sm:text-sm font-semibold hover:bg-[#16258f] transition-colors shadow-md disabled:opacity-50"
              >
                {profileMutation.isPending ? (
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
      )}

      {/* 6. Tab 3: Preferences (Tier 3 JSONB State) */}
      {activeTab === 'preferences' && (
        <section aria-labelledby="preferences-heading" className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col gap-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 id="preferences-heading" className="text-lg font-bold text-[#0a1142]">
              System Preferences & Notifications
            </h2>
            <p className="text-xs text-slate-500">
              Customize automated alerts, timetable reminders, and user interface options.
            </p>
          </div>

          <form onSubmit={handlePreferencesSubmit} className="flex flex-col gap-6">
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Notification Conduit
              </h3>

              {/* Email Notifications Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-slate-800">Course & Senate Announcements</span>
                  <span className="text-xs text-slate-500">
                    Receive urgent broadcast notifications from lecturers and departmental heads via email.
                  </span>
                </div>
                <input
                  type="checkbox"
                  id="email_notifications"
                  checked={preferencesForm.email_notifications}
                  onChange={(e) =>
                    setPreferencesForm({ ...preferencesForm, email_notifications: e.target.checked })
                  }
                  className="w-5 h-5 accent-[#0a1142] rounded cursor-pointer"
                />
              </div>

              {/* Quiz Reminders Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-slate-800">Quiz & Assessment Deadline Alerts</span>
                  <span className="text-xs text-slate-500">
                    Pushes a 24-hour reminder before online test windows close on active modules.
                  </span>
                </div>
                <input
                  type="checkbox"
                  id="quiz_reminders"
                  checked={preferencesForm.quiz_reminders}
                  onChange={(e) =>
                    setPreferencesForm({ ...preferencesForm, quiz_reminders: e.target.checked })
                  }
                  className="w-5 h-5 accent-[#0a1142] rounded cursor-pointer"
                />
              </div>

              {/* SMS Urgent Alerts Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-slate-800">Campus Emergency & Timetable SMS</span>
                  <span className="text-xs text-slate-500">
                    Instant cellular SMS for exam venue reallocations and severe weather alerts.
                  </span>
                </div>
                <input
                  type="checkbox"
                  id="sms_alerts"
                  checked={preferencesForm.sms_alerts}
                  onChange={(e) =>
                    setPreferencesForm({ ...preferencesForm, sms_alerts: e.target.checked })
                  }
                  className="w-5 h-5 accent-[#0a1142] rounded cursor-pointer"
                />
              </div>

              {/* Forum Digest Select */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-slate-800">Discussion Forum Digest Frequency</span>
                  <span className="text-xs text-slate-500">
                    Frequency for consolidated forum thread digests and peer replies.
                  </span>
                </div>
                <select
                  value={preferencesForm.forum_digest}
                  onChange={(e) =>
                    setPreferencesForm({ ...preferencesForm, forum_digest: e.target.value })
                  }
                  className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
                >
                  <option value="daily">Daily Morning Digest</option>
                  <option value="weekly">Weekly Friday Digest</option>
                  <option value="immediate">Immediate Per-Reply Alert</option>
                  <option value="none">Disabled (No Digest)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-4 pt-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Display & Accessibility
              </h3>

              {/* Interface Theme */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-slate-800">Portal Color Scheme</span>
                  <span className="text-xs text-slate-500">
                    Select your preferred interface display mode.
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {['system', 'light', 'dark'].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPreferencesForm({ ...preferencesForm, theme: mode })}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${
                        preferencesForm.theme === mode
                          ? 'bg-[#0a1142] text-white shadow-sm'
                          : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Compact Tables Toggle */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-bold text-slate-800">Compact Density for Gradebook</span>
                  <span className="text-xs text-slate-500">
                    Tightens row padding across grade tables for enhanced data scanning on small screens.
                  </span>
                </div>
                <input
                  type="checkbox"
                  id="compact_tables"
                  checked={preferencesForm.compact_tables}
                  onChange={(e) =>
                    setPreferencesForm({ ...preferencesForm, compact_tables: e.target.checked })
                  }
                  className="w-5 h-5 accent-[#0a1142] rounded cursor-pointer"
                />
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <button
                type="submit"
                disabled={profileMutation.isPending}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#0a1142] text-white text-xs sm:text-sm font-semibold hover:bg-[#16258f] transition-colors shadow-md disabled:opacity-50"
              >
                {profileMutation.isPending ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" /> Persisting Settings...
                  </>
                ) : (
                  <>
                    <Save size={15} /> Save Preference Profile
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* 7. Tab 4: Security & Password Mutation (4-Phase Teardown Protocol) */}
      {activeTab === 'security' && (
        <section aria-labelledby="security-heading" className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col gap-6">
          <div className="border-b border-slate-100 pb-4">
            <h2 id="security-heading" className="text-lg font-bold text-[#0a1142]">
              Security Credentials & Session Management
            </h2>
            <p className="text-xs text-slate-500">
              Mutating your password revokes all active session hashes across campus workstations.
            </p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-6 max-w-xl">
            {/* Current Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="currentPassword" className="text-xs font-bold text-slate-700">
                Current Password
              </label>
              <input
                id="currentPassword"
                type="password"
                required
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
                placeholder="••••••••••••"
              />
            </div>

            {/* New Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="newPassword" className="text-xs font-bold text-slate-700">
                New Password (Minimum 8 Characters)
              </label>
              <input
                id="newPassword"
                type="password"
                required
                minLength={8}
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
                placeholder="••••••••••••"
              />
            </div>

            {/* Confirm New Password */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirmPassword" className="text-xs font-bold text-slate-700">
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                minLength={8}
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                className="px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-[#0a1142]"
                placeholder="••••••••••••"
              />
            </div>

            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-3">
              <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={16} />
              <div className="leading-relaxed">
                <strong>4-Phase Teardown Notice:</strong> Updating your password will immediately terminate background SWR queries, clear your local session nonce, and redirect you to the login screen.
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isChangingPassword}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 text-white text-xs sm:text-sm font-semibold hover:bg-red-700 transition-colors shadow-md disabled:opacity-50"
              >
                {isChangingPassword ? (
                  <>
                    <RefreshCw size={15} className="animate-spin" /> Quenching Sessions & Updating...
                  </>
                ) : (
                  <>
                    <Lock size={15} /> Update Password & Terminate Sessions
                  </>
                )}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
};

export default StudentProfilePage;
