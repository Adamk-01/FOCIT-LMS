import React, { Suspense, lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { ProtectedLayout } from './layouts/ProtectedLayout';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { RoleGuard } from './components/RoleGuard';
import { CourseDetailPage } from './pages/CourseDetailPage';
import { QuizAttemptPage } from './pages/QuizAttemptPage';
import { GradebookPage } from './pages/GradebookPage';
import { ForumPage } from './pages/ForumPage';
import { DashboardPage } from './pages/DashboardPage';
import { CourseRegistrationPage } from './pages/CourseRegistrationPage';
import { StudentProfilePage } from './pages/StudentProfilePage';
import { CalendarPage } from './pages/CalendarPage';
import { CoursesPage } from './pages/CoursesPage';
import { LoginPage } from './pages/LoginPage';

// ─── Code-Split Lazily Loaded Role & Heavy Modules for Ultra-Low Latency ───────
const QuestionBankPage = lazy(() => import('./pages/QuestionBankPage'));
const DigitalLibraryPage = lazy(() => import('./pages/DigitalLibraryPage'));
const AdminDashboardPage = lazy(() => import('./pages/AdminDashboardPage'));
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage'));
const AdminOutboxPage = lazy(() => import('./pages/admin/AdminOutboxPage'));
const AdminAuditPage = lazy(() => import('./pages/admin/AdminAuditPage'));
const AdminProfilePage = lazy(() => import('./pages/admin/AdminProfilePage'));
const HodDashboardPage = lazy(() => import('./pages/HodDashboardPage'));
const LecturerDashboardPage = lazy(() => import('./pages/LecturerDashboardPage'));
const LevelAdvisorDashboardPage = lazy(() => import('./pages/LevelAdvisorDashboardPage'));

function LazyWrapper({ children }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px] text-gray-400">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-[#0a1142] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-semibold text-gray-500 font-mono">Loading workspace module...</span>
          </div>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

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
  if (role === 'LECTURER') return <Navigate to="/lecturer" replace />;
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
    if (role === 'LECTURER') return <Navigate to="/lecturer" replace />;
    if (['LEVEL_ADVISOR', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF'].includes(role)) {
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
        element: (
          <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN']}>
            <LazyWrapper><AdminDashboardPage /></LazyWrapper>
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'hod',
        element: (
          <RoleRouteGuard allowedRoles={['HOD', 'ADMIN', 'SYSTEM_ADMIN']}>
            <LazyWrapper><HodDashboardPage /></LazyWrapper>
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'lecturer',
        element: (
          <RoleRouteGuard allowedRoles={['LECTURER', 'LEVEL_ADVISOR', 'HOD', 'ADMIN', 'SYSTEM_ADMIN']}>
            <LazyWrapper><LecturerDashboardPage /></LazyWrapper>
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'admin/users',
        element: (
          <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN']}>
            <LazyWrapper><AdminUsersPage /></LazyWrapper>
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'admin/outbox',
        element: (
          <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN']}>
            <LazyWrapper><AdminOutboxPage /></LazyWrapper>
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'admin/audit',
        element: (
          <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN']}>
            <LazyWrapper><AdminAuditPage /></LazyWrapper>
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'admin/profile',
        element: (
          <RoleRouteGuard allowedRoles={['ADMIN', 'SYSTEM_ADMIN', 'LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADVISOR', 'STAFF', 'LECTURER']}>
            <LazyWrapper><AdminProfilePage /></LazyWrapper>
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'calendar',
        element: <CalendarPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'timetable',
        element: <Navigate to="/calendar" replace />,
      },
      {
        path: 'library',
        element: <LazyWrapper><DigitalLibraryPage /></LazyWrapper>,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'digital-library',
        element: <Navigate to="/library" replace />,
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
            <LazyWrapper><LevelAdvisorDashboardPage /></LazyWrapper>
          </RoleRouteGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      // Registration Clearance & Advisor URL Aliases
      {
        path: 'advisor',
        element: <Navigate to="/advisor/registrations" replace />,
      },
      {
        path: 'advisor/registration',
        element: <Navigate to="/advisor/registrations" replace />,
      },
      {
        path: 'advisor-registration',
        element: <Navigate to="/advisor/registrations" replace />,
      },
      {
        path: 'clearance',
        element: <Navigate to="/advisor/registrations" replace />,
      },
      {
        path: 'registration/clearance',
        element: <Navigate to="/advisor/registrations" replace />,
      },
      {
        path: 'profile',
        element: <RoleRouteGuard allowedRoles={['STUDENT']}><StudentProfilePage /></RoleRouteGuard>,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses',
        element: <CoursesPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId',
        element: <CourseDetailPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/materials',
        element: <CourseDetailPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/assignments',
        element: <CourseDetailPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/quizzes/:quizId/attempts/:attemptId',
        element: <QuizAttemptPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/quizzes/:quizId',
        element: <QuizAttemptPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/quizzes',
        element: <CourseDetailPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/grades',
        element: <GradebookPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/forum',
        element: <ForumPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/question-bank',
        element: (
          <RoleGuard allowedRoles={['LECTURER', 'FACULTY', 'ADMIN']}>
            <LazyWrapper><QuestionBankPage /></LazyWrapper>
          </RoleGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'question-bank',
        element: (
          <RoleGuard allowedRoles={['LECTURER', 'FACULTY', 'ADMIN']}>
            <LazyWrapper><QuestionBankPage /></LazyWrapper>
          </RoleGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'lecturer/question-bank',
        element: (
          <RoleGuard allowedRoles={['LECTURER', 'FACULTY', 'ADMIN']}>
            <LazyWrapper><QuestionBankPage /></LazyWrapper>
          </RoleGuard>
        ),
        errorElement: <RouteErrorBoundary />,
      }
    ]
  }
]);

export default router;
