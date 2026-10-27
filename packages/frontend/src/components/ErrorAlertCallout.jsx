import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, AlertTriangle, AlertOctagon, Info, ArrowRight } from 'lucide-react';
import { resolveRemediation } from '../lib/userFriendlyMessages.js';

const SEVERITY_THEME_MAP = {
  critical: {
    container: 'bg-red-50/90 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-950 dark:text-red-200',
    iconWrapper: 'bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
    Icon: AlertOctagon,
    title: 'text-red-950 dark:text-red-100',
    problem: 'text-red-900 dark:text-red-200',
    guidanceBox: 'bg-red-100/70 dark:bg-red-900/30 border-red-200 dark:border-red-800/60 text-red-950 dark:text-red-200',
    button: 'bg-red-800 hover:bg-red-900 dark:bg-red-700 dark:hover:bg-red-600 text-white focus:ring-red-700',
    badge: 'bg-red-200 dark:bg-red-900/80 text-red-800 dark:text-red-200',
  },
  error: {
    container: 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200',
    iconWrapper: 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-300 border-red-200/60 dark:border-red-800',
    Icon: AlertCircle,
    title: 'text-red-950 dark:text-red-100',
    problem: 'text-red-800 dark:text-red-200',
    guidanceBox: 'bg-white/80 dark:bg-slate-900/80 border-red-200/60 dark:border-red-800/60 text-red-900 dark:text-red-200',
    button: 'bg-[#0a1142] hover:bg-[#16258f] dark:bg-[#ffb81c] dark:hover:bg-[#e5a200] text-white dark:text-[#0a1142] focus:ring-[#0a1142]',
    badge: 'bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300',
  },
  warning: {
    container: 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200',
    iconWrapper: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    Icon: AlertTriangle,
    title: 'text-amber-950 dark:text-amber-100',
    problem: 'text-amber-900 dark:text-amber-200',
    guidanceBox: 'bg-white/80 dark:bg-slate-900/80 border-amber-200/70 dark:border-amber-800/60 text-amber-900 dark:text-amber-200',
    button: 'bg-amber-700 hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500 text-white focus:ring-amber-600',
    badge: 'bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200',
  },
  info: {
    container: 'bg-blue-50/80 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-950 dark:text-blue-200',
    iconWrapper: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    Icon: Info,
    title: 'text-blue-950 dark:text-blue-100',
    problem: 'text-blue-900 dark:text-blue-200',
    guidanceBox: 'bg-white/80 dark:bg-slate-900/80 border-blue-200/60 dark:border-blue-800/60 text-blue-900 dark:text-blue-200',
    button: 'bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 text-white focus:ring-blue-600',
    badge: 'bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200',
  },
};

/**
 * <ErrorAlertCallout />
 *
 * Inlined RFC 7807 4-Tuple Alert Primitive
 * Implements:
 * 1. Title, Problem, Institutional Guidance ("What is needed"), and Deterministic Recovery Button
 * 2. WCAG 44x44px Touch Targets on all interactive controls
 * 3. Theme-driven severity palette ('critical' | 'error' | 'warning' | 'info')
 * 4. WAI-ARIA assertive live region with decoupled user-initiated focus recovery
 */
export function ErrorAlertCallout({
  error,
  onRetry,
  className = '',
}) {
  const navigate = useNavigate();

  if (!error) return null;

  const remediation = resolveRemediation(error);
  const severityKey = (remediation.severity && SEVERITY_THEME_MAP[remediation.severity])
    ? remediation.severity
    : 'error';
  const theme = SEVERITY_THEME_MAP[severityKey];
  const { Icon } = theme;

  const handleRecoveryClick = () => {
    const action = remediation.recoveryAction;
    if (!action) return;

    if (action.type === 'FOCUS_INPUT' && action.target) {
      const el = document.getElementById(action.target);
      if (el) {
        // Controlled focus with preventScroll avoids mobile virtual keyboard jump
        el.focus({ preventScroll: true });
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof el.select === 'function') {
          el.select();
        }
      }
    } else if (action.type === 'NAVIGATE' && action.target) {
      navigate(action.target);
    } else if (action.type === 'REAUTH') {
      navigate(action.target || '/login');
    } else if (action.type === 'RETRY' && typeof onRetry === 'function') {
      onRetry();
    }
  };

  const getActionLabel = () => {
    const action = remediation.recoveryAction;
    if (!action) return null;
    if (action.label) return action.label;
    if (action.type === 'FOCUS_INPUT') return 'Fix Input';
    if (action.type === 'NAVIGATE') return 'Review Selections';
    if (action.type === 'RETRY') return 'Try Again';
    if (action.type === 'REAUTH') return 'Sign In';
    return 'Take Action';
  };

  const actionLabel = getActionLabel();

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`rounded-xl border p-4 sm:p-5 shadow-sm transition-all duration-200 ${theme.container} ${className}`}
    >
      <div className="flex items-start gap-3.5">
        <div
          className={`w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 mt-0.5 ${theme.iconWrapper}`}
          aria-hidden="true"
        >
          <Icon className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h3 className={`text-sm font-extrabold tracking-tight font-display ${theme.title}`}>
              {remediation.title}
            </h3>
            {remediation.correlationId && (
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-semibold ${theme.badge}`}>
                Ref: {remediation.correlationId.slice(-8)}
              </span>
            )}
          </div>

          <p className={`text-xs sm:text-sm leading-relaxed mb-3 ${theme.problem}`}>
            {remediation.problem}
          </p>

          {remediation.remediation && (
            <div
              className={`rounded-lg border p-3 text-xs leading-relaxed mb-3 ${theme.guidanceBox}`}
            >
              <span className="font-bold block mb-0.5 uppercase tracking-wider text-[10px]">
                Institutional Guidance:
              </span>
              <span>{remediation.remediation}</span>
            </div>
          )}

          {remediation.recoveryAction && actionLabel && (
            <div className="pt-1 flex items-center justify-end">
              <button
                type="button"
                onClick={handleRecoveryClick}
                className={`inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-lg text-xs font-bold shadow-sm transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2 ${theme.button}`}
              >
                <span>{actionLabel}</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ErrorAlertCallout;
