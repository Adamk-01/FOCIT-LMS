import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';
import { sessionLifecycle } from '../lib/sessionLifecycle';
import { downsampleAvatar } from '../lib/imageCompression';

/**
 * Custom Hook: useProfileMutations
 *
 * Separates profile business logic from UI layout:
 * 1. Demographics & preferences patch with client-side idempotency keys
 * 2. Zero-heap off-thread avatar compression & upload (LMK immune)
 * 3. 4-phase credential teardown protocol
 */
export function useProfileMutations({ studentId }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);

  const [feedback, setFeedback] = useState(null);
  const [conflictState, setConflictState] = useState(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionMetrics, setCompressionMetrics] = useState(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // 1. Demographics & Preferences Mutation
  const profileMutation = useMutation({
    mutationFn: async (payload) => {
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
          version: data.data?.version ?? (prev.version || 1) + 1,
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

  // 2. Avatar Selection, Off-Thread Compression & Upload
  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const originalSizeKb = Math.round(file.size / 1024);

    try {
      setIsCompressing(true);
      setFeedback(null);

      // Off-thread downsampling with center-crop and Safari WebP fallback
      const compressedBlob = await downsampleAvatar(file, 512, 0.82);
      const compressedSizeKb = Math.round(compressedBlob.size / 1024);

      setCompressionMetrics({
        original: `${originalSizeKb} KB`,
        compressed: `${compressedSizeKb} KB`,
      });

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

  // 3. 4-Phase Teardown Credential Mutation
  const handlePasswordSubmit = async (passwordForm) => {
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

      // Phase 1: Pre-Emptive SWR Quenching
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

  return {
    fileInputRef,
    feedback,
    setFeedback,
    conflictState,
    isCompressing,
    compressionMetrics,
    isChangingPassword,
    profileMutation,
    handleAvatarSelect,
    handlePasswordSubmit,
  };
}

export default useProfileMutations;
