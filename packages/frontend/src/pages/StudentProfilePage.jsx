/**
 * FOCIT LMS - Student Profile Management Shell
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Invariants Enforced:
 * 1. State Partitioning: Tab selection (?tab=overview|demographics|preferences|security) in URL SearchParams
 * 2. Zero V8 Heap Blowup: Avatar downsampling off-thread with center-crop & Safari fallback (<120KB)
 * 3. 4-Phase Teardown Credential Mutation Protocol
 * 4. Dumb Presentation Shell: Under 180 lines (173 lines)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../lib/api';
import { useProfileMutations } from '../hooks/useProfileMutations';
import { applyAllPreferences } from '../lib/preferencesManager';
import { ProfileHeader } from '../components/profile/ProfileHeader';
import { ProfileTabsNav, PROFILE_TABS } from '../components/profile/ProfileTabsNav';
import { ProfileOverviewTab } from '../components/profile/ProfileOverviewTab';
import { ProfileDemographicsTab } from '../components/profile/ProfileDemographicsTab';
import { ProfilePreferencesTab } from '../components/profile/ProfilePreferencesTab';
import { ProfileSecurityTab } from '../components/profile/ProfileSecurityTab';
import { ProfileFeedbackBanner } from '../components/profile/ProfileFeedbackBanner';
import { ErrorStateView } from '../components/ErrorStateView';

const VALID_TABS = PROFILE_TABS.map((t) => t.id);

export function StudentProfilePage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const studentId = user?.student_id || user?.id || user?.username;

  // 1. Dual-State Partitioning: URL SearchParams tab pointer
  const currentTab = searchParams.get('tab') || 'overview';
  const activeTab = VALID_TABS.includes(currentTab) ? currentTab : 'overview';

  const handleTabChange = useCallback((newTab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newTab === 'overview') next.delete('tab');
      else next.set('tab', newTab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 2. Query Authoritative Student Profile
  const {
    data: profile,
    isLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: ['student-profile', studentId],
    queryFn: async ({ signal }) => {
      const response = await apiClient.get('/student/profile', { signal });
      return response.data;
    },
    enabled: Boolean(studentId),
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

  // 3. Profile Mutations Hook
  const {
    fileInputRef,
    feedback,
    setFeedback,
    conflictState,
    setConflictState,
    isCompressing,
    compressionMetrics,
    isChangingPassword,
    profileMutation,
    handleAvatarSelect,
    handlePasswordSubmit,
  } = useProfileMutations({ studentId });

  // Sync loaded profile into editable draft state and apply runtime preferences
  useEffect(() => {
    if (profile) {
      setDemographicsForm({
        phone_number: profile.phone_number || '',
        alternate_email: profile.alternate_email || '',
        bio: profile.bio || '',
        residential_address: profile.residential_address || '',
      });
      if (profile.preferences && typeof profile.preferences === 'object') {
        const loadedPrefs = {
          email_notifications: profile.preferences.email_notifications ?? true,
          quiz_reminders: profile.preferences.quiz_reminders ?? true,
          forum_digest: profile.preferences.forum_digest ?? 'daily',
          sms_alerts: profile.preferences.sms_alerts ?? false,
          theme: profile.preferences.theme ?? 'system',
          compact_tables: profile.preferences.compact_tables ?? false,
        };
        setPreferencesForm(loadedPrefs);
        applyAllPreferences(loadedPrefs);
      }
    }
  }, [profile]);

  useEffect(() => {
    setFeedback(null);
  }, [activeTab, setFeedback]);

  if (!studentId) {
    return (
      <div className="max-w-4xl mx-auto my-12 p-6">
        <ErrorStateView
          title="Session Required"
          message="Authenticated student credentials required to view profile settings."
        />
      </div>
    );
  }

  // Loading Skeleton State
  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto flex flex-col gap-6 p-4 sm:p-6 animate-pulse" aria-busy="true">
        <div className="h-32 bg-slate-200 dark:bg-slate-800 rounded-2xl" />
        <div className="h-12 bg-slate-200 dark:bg-slate-800 rounded-xl w-72" />
        <div className="h-96 bg-slate-200 dark:bg-slate-800 rounded-2xl" />
      </div>
    );
  }

  // Error State
  if (queryError) {
    return (
      <div className="max-w-4xl mx-auto my-12 p-6">
        <ErrorStateView
          title="Profile Synchronization Halted"
          message={queryError.message || 'Unable to retrieve your authoritative profile from the Senate ledger.'}
          onRetry={refetch}
        />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 p-4 sm:p-6 pb-20">
      {/* 1. Hero Header */}
      <ProfileHeader
        profile={profile}
        fileInputRef={fileInputRef}
        onAvatarSelect={handleAvatarSelect}
        isCompressing={isCompressing}
      />

      {/* 2. Feedback Banners & Conflict Prompts */}
      <ProfileFeedbackBanner
        feedback={feedback}
        conflictState={conflictState}
        onDismissFeedback={() => setFeedback(null)}
        onResolveConflict={() => {
          refetch();
          if (setConflictState) setConflictState(null);
        }}
      />

      {/* 3. Navigation Tabs */}
      <ProfileTabsNav activeTab={activeTab} onTabChange={handleTabChange} />

      {/* 4. Tab Content Router */}
      {activeTab === 'overview' && (
        <ProfileOverviewTab profile={profile} compressionMetrics={compressionMetrics} />
      )}

      {activeTab === 'demographics' && (
        <ProfileDemographicsTab
          form={demographicsForm}
          onChange={setDemographicsForm}
          onSubmit={(e) => {
            e.preventDefault();
            if (!profileMutation.isPending) {
              profileMutation.mutate({ ...demographicsForm, version: profile?.version || 1 });
            }
          }}
          isPending={profileMutation.isPending}
          version={profile?.version}
        />
      )}

      {activeTab === 'preferences' && (
        <ProfilePreferencesTab
          form={preferencesForm}
          onChange={(newForm) => {
            setPreferencesForm(newForm);
            applyAllPreferences(newForm, false);
          }}
          onSubmit={(e) => {
            e.preventDefault();
            if (!profileMutation.isPending) {
              profileMutation.mutate(
                { preferences: preferencesForm, version: profile?.version || 1 },
                {
                  onSuccess: () => {
                    applyAllPreferences(preferencesForm, true);
                  },
                }
              );
            }
          }}
          isPending={profileMutation.isPending}
        />
      )}

      {activeTab === 'security' && (
        <ProfileSecurityTab
          form={passwordForm}
          onChange={setPasswordForm}
          feedback={feedback}
          onSubmit={(e) => {
            e.preventDefault();
            handlePasswordSubmit(passwordForm);
          }}
          isChangingPassword={isChangingPassword}
        />
      )}
    </div>
  );
}

export default StudentProfilePage;
