import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
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
    mutationFn: async (updatedData) => {
      const idempotencyKey = `profile_upd_${studentId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const response = await apiClient.patch('/student/profile', updatedData, {
        headers: { 'X-Idempotency-Key': idempotencyKey },
      });
      return response.data;
    },
    onMutate: async (newProfile) => {
      await queryClient.cancelQueries({ queryKey: ['student-profile', studentId] });
      const previousProfile = queryClient.getQueryData(['student-profile', studentId]);
      queryClient.setQueryData(['student-profile', studentId], (old) => ({
        ...old,
        ...newProfile,
      }));
      return { previousProfile };
    },
    onSuccess: (data) => {
      const patched = data.data || data;
      queryClient.setQueryData(['student-profile', studentId], (old) => ({
        ...old,
        ...patched,
      }));
      setFeedback({ type: 'success', message: 'Profile updated successfully.' });
      toast.success('Profile and system preferences saved successfully.');
      setConflictState(null);
    },
    onError: (err, newProfile, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData(['student-profile', studentId], context.previousProfile);
      }
      if (err.status === 409) {
        setConflictState({
          isStale: true,
          serverVersion: err.data?.server_version,
          clientVersion: newProfile.version,
        });
        setFeedback({
          type: 'warning',
          message: 'Profile was modified concurrently. Please refresh to load latest changes.',
        });
      } else {
        setFeedback({
          type: 'error',
          message: err.detail || err.message || 'Failed to update profile.',
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['student-profile', studentId] });
    },
  });

  // 2. Avatar Selection and Compression Pipeline
  const handleAvatarSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFeedback({ type: 'error', message: 'Only JPEG, PNG, and WebP images are permitted.' });
      return;
    }

    try {
      setIsCompressing(true);
      setFeedback(null);
      const originalSizeBytes = file.size;

      const compressedBlob = await downsampleAvatar(file, {
        maxDimensionPx: 512,
        targetSizeBytes: 200 * 1024,
      });

      setCompressionMetrics({
        originalSize: originalSizeBytes,
        compressedSize: compressedBlob.size,
        compressionRatio: ((1 - compressedBlob.size / originalSizeBytes) * 100).toFixed(1),
      });

      const formData = new FormData();
      formData.append('avatar', compressedBlob, 'avatar.webp');

      const response = await apiClient.post('/student/avatar', formData);
      const newAvatarUrl = response.data?.avatarUrl || response.data?.avatar_url;
      const newVersion = response.data?.version;

      queryClient.setQueryData(['student-profile', studentId], (old) => ({
        ...old,
        avatar_url: newAvatarUrl,
        version: newVersion || (old?.version ? old.version + 1 : old?.version),
      }));
      queryClient.invalidateQueries({ queryKey: ['student-profile', studentId] });

      setFeedback({
        type: 'success',
        message: `Avatar uploaded successfully. Saved ${((1 - compressedBlob.size / originalSizeBytes) * 100).toFixed(0)}% bandwidth.`,
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

    const current = (passwordForm?.currentPassword || '').trim();
    const next = (passwordForm?.newPassword || '').trim();
    const confirm = (passwordForm?.confirmPassword || '').trim();

    if (!current) {
      const msg = 'Please enter your current temporary password.';
      setFeedback({ type: 'error', message: msg });
      toast.error(msg);
      return;
    }

    if (!next) {
      const msg = 'Please enter a new password (min 8 characters).';
      setFeedback({ type: 'error', message: msg });
      toast.error(msg);
      return;
    }

    if (next.length < 8) {
      const msg = 'New password must contain at least 8 characters.';
      setFeedback({ type: 'error', message: msg });
      toast.error(msg);
      return;
    }

    if (next !== confirm) {
      const msg = 'New password and confirmation do not match.';
      setFeedback({ type: 'error', message: msg });
      toast.error(msg);
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
          currentPassword: current,
          newPassword: next,
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

      toast.success('Password updated! Redirecting to login...');

      // Phase 4: Atomic Navigation to Login Flow
      setTimeout(() => {
        window.location.replace('/login?reason=password_changed');
      }, 500);
    } catch (err) {
      setIsChangingPassword(false);
      queryClient.resumeQueries();
      const errorMsg = err.message || 'Failed to update password.';
      setFeedback({
        type: 'error',
        message: errorMsg,
      });
      toast.error(errorMsg);
    }
  };

  return {
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
  };
}

export default useProfileMutations;
