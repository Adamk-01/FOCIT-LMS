import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { useAuth } from '../contexts/AuthContext';

export const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  // Cascading Invalidation notification (e.g. UPSTREAM_EXPIRED bounce)
  useEffect(() => {
    const reason = searchParams.get('reason');
    if (reason === 'session_timeout') {
      toast.info('Your session has expired or was terminated. Please authenticate again.');
    }
  }, [searchParams]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!studentId.trim() || !password) {
      toast.warn('Please provide both Student ID and Password.');
      return;
    }

    setIsAuthenticating(true); // Mutation lock
    try {
      await login({ studentId: studentId.trim(), password });
      toast.success('Authentication successful');

      // Preserve origin location if redirected by ProtectedLayout
      const destination = location.state?.from?.pathname || '/dashboard';
      navigate(destination, { replace: true });
    } catch (err) {
      const message =
        err.data?.message ||
        err.data?.error ||
        err.message ||
        'Authentication failed. Please verify credentials.';
      toast.error(message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        {/* Institutional Branding */}
        <h1 className="text-3xl font-extrabold text-[#0a1142] tracking-tight">UNIOSUN FOCIT</h1>
        <p className="mt-2 text-sm text-gray-600">Integrated Academic Digital Ecosystem</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-md sm:rounded-lg sm:px-10 border-t-4 border-[#ffb81c]">
          <form className="space-y-6" onSubmit={handleSubmit} noValidate>
            <fieldset disabled={isAuthenticating} className="space-y-4">
              <legend className="sr-only">Student Login Credentials</legend>

              <div>
                <label htmlFor="studentId" className="block text-sm font-medium text-gray-700">
                  Student ID / Matric Number
                </label>
                <div className="mt-1">
                  <input
                    id="studentId"
                    name="studentId"
                    type="text"
                    required
                    autoComplete="username"
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    placeholder="e.g. 2021/12345"
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-[#0a1142] focus:border-[#0a1142] sm:text-sm transition"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <div className="mt-1">
                  <input
                    id="password"
                    name="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-[#0a1142] focus:border-[#0a1142] sm:text-sm transition"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isAuthenticating}
                  className="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-semibold text-[#0a1142] bg-[#ffb81c] hover:bg-[#e5a619] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0a1142] disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {isAuthenticating ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-[#0a1142]/30 border-t-[#0a1142] rounded-full animate-spin" aria-hidden="true" />
                      Authenticating...
                    </span>
                  ) : (
                    'Secure Login'
                  )}
                </button>
              </div>
            </fieldset>
          </form>
        </div>
      </div>
    </main>
  );
};
