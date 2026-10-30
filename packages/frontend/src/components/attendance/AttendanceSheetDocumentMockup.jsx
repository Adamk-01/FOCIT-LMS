import React from 'react';
import { FileCheck, ShieldAlert, ShieldCheck } from 'lucide-react';

/**
 * AttendanceSheetDocumentMockup
 *
 * High-fidelity preview representing attendance register records.
 * Labeled with clear DIGITAL PREVIEW badges to avoid presenting simulated data as sealed facts.
 */
export function AttendanceSheetDocumentMockup({ session, records = [], pageNumber = 1 }) {
  const pageSize = 10;
  const displayRecords = records.slice((pageNumber - 1) * pageSize, pageNumber * pageSize);
  const formattedDate = session?.session_date 
    ? new Date(session.session_date).toLocaleDateString(undefined, { dateStyle: 'medium' })
    : 'Pending Date';
  const isLocked = Boolean(session?.is_locked);

  return (
    <div className="w-full h-full bg-[#fcfbf9] text-gray-900 p-4 sm:p-5 rounded-xl border border-amber-200/80 shadow-md flex flex-col justify-between font-mono text-[10px] select-none relative overflow-hidden">
      {/* Background Document Watermark */}
      <div 
        aria-hidden="true" 
        className="absolute inset-0 flex items-center justify-center opacity-[0.04] pointer-events-none text-5xl font-black rotate-[-25deg] text-gray-900"
      >
        DIGITAL PREVIEW
      </div>

      {/* Institutional Document Header with Simulation Notice */}
      <div className="border-b-2 border-gray-800 pb-2 text-center space-y-0.5 relative z-10">
        <div className="inline-block px-2 py-0.5 mb-1 bg-amber-100 border border-amber-300 rounded text-[8px] font-bold text-amber-900 tracking-wider uppercase">
          Digital Simulation Preview
        </div>
        <h4 className="font-extrabold text-[12px] tracking-wider text-[#0a1142] uppercase font-sans">
          Osun State University
        </h4>
        <p className="text-[10px] text-gray-700 font-semibold uppercase tracking-wide">
          Faculty of Computing & Information Technology
        </p>
        <div className="inline-flex items-center gap-1 bg-[#0a1142] text-white px-2.5 py-0.5 rounded text-[9px] font-bold mt-1">
          <FileCheck size={11} className="text-[#ffb81c]" />
          <span>COURSE ATTENDANCE REGISTER • WEEK {session?.week_number || 1}</span>
        </div>
      </div>

      {/* Register Metadata Strip */}
      <div className="grid grid-cols-3 gap-1 text-[9px] text-gray-700 py-1.5 border-b border-dashed border-gray-300 relative z-10">
        <div>
          <span className="text-gray-500">Course:</span>{' '}
          <strong className="text-[#0a1142] font-bold">{session?.course_id || 'N/A'}</strong>
        </div>
        <div className="text-center">
          <span className="text-gray-500">Date:</span>{' '}
          <strong className="text-gray-800">{formattedDate}</strong>
        </div>
        <div className="text-right">
          <span className="text-gray-500">Mode:</span>{' '}
          <strong className="text-blue-900 font-bold">{session?.session_mode || 'DIGITAL'}</strong>
        </div>
      </div>

      {/* Student Sign-in Table */}
      <div className="flex-1 my-2 overflow-hidden border border-gray-300 rounded bg-white shadow-xs relative z-10">
        <table className="w-full text-left text-[9px] border-collapse">
          <thead className="bg-gray-100 text-gray-800 font-bold uppercase text-[8px] tracking-wider border-b border-gray-300">
            <tr>
              <th className="py-1 px-1.5 w-6 text-center">#</th>
              <th className="py-1 px-2">Matriculation No.</th>
              <th className="py-1 px-2">Verification</th>
              <th className="py-1 px-2 text-center">Audit Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 font-sans">
            {displayRecords.map((r, idx) => {
              const rowNum = (pageNumber - 1) * pageSize + idx + 1;
              const isPresent = r.status === 'PRESENT';
              return (
                <tr key={r.student_id || idx} className="hover:bg-amber-50/50 transition-colors">
                  <td className="py-1 px-1.5 text-center text-gray-400 font-mono text-[8px]">{rowNum}</td>
                  <td className="py-1 px-2 font-mono font-bold text-gray-900">{r.matric_number || r.student_id}</td>
                  <td className="py-1 px-2 font-mono text-gray-600 text-[9px]">
                    {r.verification_method || (isPresent ? 'DIGITAL_CHECKIN' : 'UNMARKED')}
                  </td>
                  <td className="py-1 px-2 text-center">
                    {isPresent ? (
                      <span className="inline-block px-1.5 py-0.2 rounded text-[8px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200">
                        PRESENT
                      </span>
                    ) : (
                      <span className="inline-block px-1.5 py-0.2 rounded text-[8px] font-bold text-red-700 bg-red-50 border border-red-200">
                        ABSENT
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Audit Verification Stamps */}
      <div className="pt-2 border-t-2 border-gray-800 flex items-center justify-between text-[8px] text-gray-600 relative z-10">
        <div className="flex items-center gap-1.5">
          {isLocked ? (
            <>
              <ShieldCheck size={12} className="text-emerald-700" />
              <span className="text-emerald-800 font-bold">Ledger Status: Sealed by Lecturer</span>
            </>
          ) : (
            <>
              <ShieldAlert size={12} className="text-amber-700" />
              <span className="text-amber-800 font-bold">Ledger Status: Draft / Unverified</span>
            </>
          )}
        </div>
        <div className="font-mono text-gray-500">
          Page {pageNumber} • {isLocked ? 'Registry Sealed' : 'Unsealed Draft'}
        </div>
      </div>
    </div>
  );
}

export default AttendanceSheetDocumentMockup;
