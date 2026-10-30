import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

/**
 * RoleGuard Component (Milestone 10.8)
 * Restricts sensitive routes (e.g. Question Bank) to authorized roles (LECTURER, FACULTY, ADMIN).
 * Unauthorized students are redirected to /dashboard.
 */
export function RoleGuard({ allowedRoles = [], children, fallback = '/dashboard' }) {
  const { user, status } = useAuth();

  if (status === 'PENDING') {
    return null;
  }

  const userRole = String(user?.role || 'STUDENT').toUpperCase();
  const normalizedAllowed = allowedRoles.map((r) => String(r).toUpperCase());

  if (!normalizedAllowed.includes(userRole)) {
    return <Navigate to={fallback} replace />;
  }

  return children;
}

export default RoleGuard;
