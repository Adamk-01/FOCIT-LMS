import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedLayout } from './layouts/ProtectedLayout';
import { RouteErrorBoundary } from './components/RouteErrorBoundary';
import { MaterialsPage } from './pages/MaterialsPage';

import { LoginPage } from './pages/LoginPage';

const DashboardView = () => <div className="p-8">Dashboard Content (Mock)</div>;

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
        element: <DashboardView />,
        errorElement: <RouteErrorBoundary />,
      },
      {
        path: 'courses/:courseId/materials',
        element: <MaterialsPage />,
        errorElement: <RouteErrorBoundary />,
      }
    ]
  }
]);
