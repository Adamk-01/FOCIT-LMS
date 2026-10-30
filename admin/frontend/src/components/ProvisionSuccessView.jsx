import React, { useState } from 'react';
import { Key, Check, Copy, AlertCircle } from 'lucide-react';

/**
 * Option B Single-Reveal Credential Screen
 *
 * Implements:
 * 1. Single-reveal display of cryptographic temporary password
 * 2. Instant clipboard copy with visual confirmation
 * 3. OWASP-compliant forced change warning
 *
 * Standard: The 8-8-8 Architectural Doctrine (<180 lines)
 */
export function ProvisionSuccessView({ result, fallbackData, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const handleCopy = async () => {
    if (!result?.temporaryPassword) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(result.temporaryPassword);
        setCopied(true);
        setCopyError(false);
        setTimeout(() => setCopied(false), 2000);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 2500);
    }
  };

  return (
    <div>
      <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
        <Key size={24} />
      </div>

      <h2 id="provision-modal-title" className="text-xl font-extrabold text-[#0a1142] font-display">
        Account Provisioned Successfully
      </h2>

      <p className="text-xs text-gray-600 mt-1">
        The account for <strong>{result.user?.fullName || fallbackData.fullName}</strong> ({result.user?.identifier || fallbackData.identifier}) has been initialized.
      </p>

      {/* Generated Temporary Password Box */}
      <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200">
        <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
          One-Time Temporary Password
        </span>
        <div className="flex items-center justify-between gap-3">
          <code className="text-base font-mono font-bold text-[#0a1142] tracking-wider select-all">
            {result.temporaryPassword}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#0a1142] text-white hover:bg-blue-900 transition-colors"
          >
            {copied ? (
              <>
                <Check size={14} className="text-emerald-400" />
                <span>Copied!</span>
              </>
            ) : copyError ? (
              <span className="text-amber-300">Copy Failed</span>
            ) : (
              <>
                <Copy size={14} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Security Policy Alert */}
      <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-amber-800 text-xs">
        <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <p>
          <strong>Security Notice:</strong> This temporary password is only displayed once and is not stored in plaintext. Advise the user to sign in and immediately change their password.
        </p>
      </div>

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors min-h-[44px]"
        >
          Close & Finish
        </button>
      </div>
    </div>
  );
}
