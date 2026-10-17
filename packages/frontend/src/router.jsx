import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedLayout } from './layouts/ProtectedLayout';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { CourseDetailPage } from './pages/CourseDetailPage';
import { MaterialsPage } from './pages/MaterialsPage';
import { QuizAttemptPage } from './pages/QuizAttemptPage';
import { GradebookPage } from './pages/GradebookPage';
import { ForumPage } from './pages/ForumPage';
import { QuestionBankPage } from './pages/QuestionBankPage';
import { DashboardPage } from './pages/DashboardPage';
import { CourseRegistrationPage } from './pages/CourseRegistrationPage';
import { LevelAdvisorDashboardPage } from './pages/LevelAdvisorDashboardPage';
import { StudentProfilePage } from './pages/StudentProfilePage';
import { CoursesPage } from './pages/CoursesPage';
import { LoginPage } from './pages/LoginPage';

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
      {
        index: true,
        element: <Navigate to="/dashboard" replace />
      },
      {
        path: 'dashboard',
        element: <DashboardPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'registration',
        element: <CourseRegistrationPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'advisor/registrations',
        element: <LevelAdvisorDashboardPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'profile',
        element: <StudentProfilePage />,
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
        path: 'courses/:courseId/quizzes/:quizId',
        element: <QuizAttemptPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/quizzes',
        element: <QuizAttemptPage />,
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
        element: <QuestionBankPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'question-bank',
        element: <QuestionBankPage />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'lecturer/question-bank',
        element: <QuestionBankPage />,
        errorElement: <RouteErrorBoundary />,
      }
    ]
  }
]);
