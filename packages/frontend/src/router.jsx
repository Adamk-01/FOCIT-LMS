import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { ProtectedLayout } from './layouts/ProtectedLayout';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { CourseDetailPage } from './pages/CourseDetailPage';
import { QuizAttemptPage } from './pages/QuizAttemptPage';
import { GradebookPage } from './pages/GradebookPage';
import { ForumPage } from './pages/ForumPage';
import { QuestionBankPage } from './pages/QuestionBankPage';
import { DashboardPage } from './pages/DashboardPage';
import { CourseRegistrationPage } from './pages/CourseRegistrationPage';
import { LevelAdvisorDashboardPage } from './pages/LevelAdvisorDashboardPage';
import { StudentProfilePage } from './pages/StudentProfilePage';
import { CoursesPage } from './pages/CoursesPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminOutboxPage } from './pages/admin/AdminOutboxPage';
import { AdminAuditPage } from './pages/admin/AdminAuditPage';
import { AdminProfilePage } from './pages/admin/AdminProfilePage';
import { HodDashboardPage } from './pages/HodDashboardPage';
import { LoginPage } from './pages/LoginPage';

/**
 * Dynamic Root Index Redirector based on Authenticated Role
 */
function RootIndexRedirect() {
  const { user } = useAuth();
  const role = String(user?.role || 'STUDENT').toUpperCase();
  const isStaffRole = ['ADMIN', 'SYSTEM_ADMIN', 'LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF', 'LECTURER'].includes(role);

  if (user?.mustChangePassword || user?.scope === 'RESET_ONLY') {
    return <Navigate to={isStaffRole ? '/admin/profile' : '/profile?tab=security'} replace />;
  }
  if (['ADMIN', 'SYSTEM_ADMIN'].includes(role)) return <Navigate to="/admin" replace />;
  if (role === 'HOD') return <Navigate to="/hod" replace />;
  if (isStaffRole) {
    return <Navigate to="/advisor/registrations" replace />;
  }
  return <Navigate to="/dashboard" replace />;
}

/**
 * Declarative Role-Based Route Barrier
 */
function RoleRouteGuard({ allowedRoles, fallbackPath, children }) {
  const { user } = useAuth();
  const role = String(user?.role || '').toUpperCase();
  if (allowedRoles && !allowedRoles.includes(role)) {
    if (fallbackPath) return <Navigate to={fallbackPath} replace />;
    if (['ADMIN', 'SYSTEM_ADMIN'].includes(role)) return <Navigate to="/admin" replace />;
    if (role === 'HOD') return <Navigate to="/hod" replace />;
    if (['LEVEL_ADVISOR', 'DEAN', 'ADVISOR', 'STAFF', 'LECTURER'].includes(role)) {
      return <Navigate to="/advisor/registrations" replace />;
    }
    if (role === 'STUDENT') return <Navigate to="/dashboard" replace />;
    return <Navigate to="/login" replace />;
  }
  return children;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/',
    element: <ProtectedLayout />,
    errorElement: (
      <ProtectedLayout>
        <RouteErrorBoundary />
      </ProtectedLayout>
    ),
    children: [
      { index: true, element: <RootIndexRedirect /> },
      {
        path: 'dashboard',
        element: <RoleRouteGuard allowedRoles={['STUDENT']}><DashboardPage /></RoleRouteGuard>,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'admin',
        element: <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN']}><AdminDashboardPage /></RoleRouteGuard>,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'hod',
        element: <RoleRouteGuard allowedRoles={['HOD', 'ADMIN', 'SYSTEM_ADMIN']}><HodDashboardPage /></RoleRouteGuard>,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'admin/users',
        element: <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN']}><AdminUsersPage /></RoleRouteGuard>,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'admin/outbox',
        element: <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN']}><AdminOutboxPage /></RoleRouteGuard>,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'admin/audit',
        element: <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN']}><AdminAuditPage /></RoleRouteGuard>,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'admin/profile',
        element: (
          <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN', 'LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF', 'LECTURER']}>
            <AdminProfilePage />
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'registration',
        element: <RoleRouteGuard allowedRoles={['STUDENT']}><CourseRegistrationPage /></RoleRouteGuard>,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'advisor/registrations',
        element: (
          <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN', 'LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF', 'LECTURER']}>
            <LevelAdvisorDashboardPage />
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'profile',
        element: <RoleRouteGuard allowedRoles={['STUDENT']}><StudentProfilePage /></RoleRouteGuard>,
        errorElement: <RouteErrorBoundary />,
      },
      { path: 'courses', element: <CoursesPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'courses/:courseId', element: <CourseDetailPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'courses/:courseId/materials', element: <CourseDetailPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'courses/:courseId/quizzes/:quizId', element: <QuizAttemptPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'courses/:courseId/quizzes', element: <QuizAttemptPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'courses/:courseId/grades', element: <GradebookPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'courses/:courseId/forum', element: <ForumPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'courses/:courseId/question-bank', element: <QuestionBankPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'question-bank', element: <QuestionBankPage />, errorElement: <RouteErrorBoundary /> },
      { path: 'lecturer/question-bank', element: <QuestionBankPage />, errorElement: <RouteErrorBoundary /> },
    ],
  },
]);
