import React from 'react';
import { useRouteError } from 'react-router-dom';

export const RouteErrorBoundary = () => {
  const error = useRouteError();

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-red-50 border border-red-200 rounded-lg">
      <h2 className="text-xl font-bold text-red-700 mb-2">Module Load Failure</h2>
      <p className="text-red-600 mb-4">
        {error?.message || 'An unexpected error occurred while loading this section.'}
      </p>
      <button 
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-[#0a1142] text-white font-medium rounded hover:bg-[#0a1142]/90 focus:ring-2 focus:ring-[#ffb81c] focus:outline-none"
      >
        Reload Module
      </button>
    </div>
  );
};
