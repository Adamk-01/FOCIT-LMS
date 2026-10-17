import React from 'react';
import { BookmarkCheck, Clock, CheckCircle2, Circle } from 'lucide-react';

/**
 * <RegistrationClearanceTracker />
 *
 * Clearance status tracker displayed when a student's registration batch
 * is in SUBMITTED or ADVISOR_APPROVED state.
 */
export function RegistrationClearanceTracker({
  batchStatus = 'SUBMITTED',
  isApproved = false,
  student,
  batch,
  selectedCourses = [],
}) {
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6 animate-fade-in">
      {/* Clearance Banner */}
      <div className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200/80 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <span
            className={`p-2.5 rounded-xl ${
              isApproved
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {isApproved ? <BookmarkCheck size={28} /> : <Clock size={28} />}
          </span>
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 font-sans">
              Academic Clearance Status
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-[#0a1142] font-display">
              {isApproved
                ? 'Course Registration Endorsed by Level Advisor'
                : 'Registration Submitted — Awaiting Advisor Clearance'}
            </h1>
          </div>
        </div>

        <p className="text-sm text-gray-600 mb-6 font-sans leading-relaxed">
          {isApproved
            ? 'Your course registration has been formally endorsed by your Level Advisor and synced with the academic ledger and Moodle.'
            : 'Your registration batch is locked in the SUBMITTED state. Your Level Advisor is currently reviewing your course matrix.'}
        </p>

        {/* Governance Stepper */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs font-sans">
          <div className="flex items-center gap-2 text-emerald-700 font-bold">
            <CheckCircle2 size={16} />
            <span>1. Draft (Done)</span>
          </div>
          <div className="flex items-center gap-2 text-emerald-700 font-bold">
            <CheckCircle2 size={16} />
            <span>2. Submitted (Done)</span>
          </div>
          <div
            className={`flex items-center gap-2 font-bold ${
              isApproved ? 'text-emerald-700' : 'text-amber-600'
            }`}
          >
            {isApproved ? <CheckCircle2 size={16} /> : <Clock size={16} />}
            <span>3. Advisor Endorsement</span>
          </div>
          <div className="flex items-center gap-2 text-gray-400 font-medium">
            <Circle size={16} />
            <span>4. Senate Cleared</span>
          </div>
        </div>
      </div>

      {/* Enrolled Courses Matrix */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200/80 shadow-sm">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
          <div>
            <h2 className="text-base font-black text-[#0a1142] font-display">
              Registered Modules ({batch?.total_units || 0} Total Units)
            </h2>
            <span className="text-xs text-gray-500 font-sans">
              Matric: {student?.matric_number} • Level: {student?.level}
            </span>
          </div>
          <span
            className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
              isApproved
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {batchStatus}
          </span>
        </div>

        <div className="divide-y divide-gray-100">
          {selectedCourses.map((c) => (
            <div
              key={c.course_id}
              className="py-3 flex items-center justify-between"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-black text-[#0a1142] text-sm font-display">
                    {c.code}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-gray-100 text-gray-700 uppercase tracking-wider font-sans">
                    {c.category}
                  </span>
                </div>
                <p className="text-xs text-gray-600 font-sans">{c.title}</p>
              </div>
              <span className="text-xs font-bold text-gray-800 font-display">
                {c.units} Units
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default RegistrationClearanceTracker;
