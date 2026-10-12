/**
 * FOCIT LMS - Student Course Registration Wizard (Module 8)
 *
 * Implements:
 * 1. Physical Viewport Lock (100dvh + contain: layout paint on course matrix scrollport)
 * 2. Dual-State Sandbox Execution (?step=1|2|3 in URL, unsubmitted payload in sessionStorage)
 * 3. Dynamic Visual Unit Gauge ([15, 24] Senate Credit Bounds)
 * 4. Governance Lifecycle Tracker for SUBMITTED & ADVISOR_APPROVED states
 * 5. Rejection remarks resolution with idempotent resubmission
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRegistrationWizard } from '../hooks/useRegistrationWizard';
import {
  CheckCircle2,
  Circle,
  ChevronRight,
  ChevronLeft,
  AlertCircle,
  BookOpen,
  ShieldCheck,
  Lock,
  RefreshCw,
  Sparkles,
  Info,
  Clock,
  Check,
  AlertTriangle,
  FileCheck2,
  BookmarkCheck,
  Calendar,
} from 'lucide-react';

export const CourseRegistrationPage = () => {
  const { user } = useAuth();
  const studentId = user?.username || 'student1';

  const {
    activeStep,
    goToNextStep,
    goToPreviousStep,
    setStep,

    // Entities
    student,
    semester,
    batch,
    eligibleCatalog,
    selectedCourseIds,
    selectedCourses,

    // Status Flags
    batchStatus,
    isDraft,
    isSubmitted,
    isApproved,
    isRejected,
    isLocked,
    rejectionRemarks,

    // Credit Math
    totalSelectedUnits,
    minFloor,
    maxCeiling,
    isUnderMinimum,
    isOverMaximum,
    unitsDeficit,
    unitsSurplus,

    // Actions
    toggleCourse,
    selectAllCore,
    clearDraft,

    // Mutations
    saveDraft,
    isSavingDraft,
    saveDraftSuccess,
    saveDraftError,

    submitRegistration,
    isSubmitting,
    submitSuccess,
    submitError,

    isLoading,
    isError,
    error,
    refetch,
  } = useRegistrationWizard(studentId);

  // Filter state for category filtering
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Filter courses
  const filteredCatalog = eligibleCatalog.filter((course) => {
    const matchesCategory =
      categoryFilter === 'ALL' || course.category === categoryFilter;
    const matchesSearch =
      course.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      course.title.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142]" />
        <p className="text-sm font-semibold text-gray-600">
          Loading active semester and academic curriculum...
        </p>
      </div>
    );
  }

  // 2. Error State
  if (isError) {
    return (
      <div className="max-w-2xl mx-auto my-8 p-6 bg-red-50 border border-red-200 rounded-2xl shadow-sm text-center">
        <AlertCircle size={40} className="mx-auto text-red-600 mb-3" />
        <h2 className="text-lg font-bold text-red-900 mb-1">
          Registration Service Unavailable
        </h2>
        <p className="text-sm text-red-700 mb-4">
          {error?.response?.data?.error ||
            error?.message ||
            'Failed to retrieve academic registration catalog.'}
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="px-5 py-2.5 bg-[#0a1142] text-white text-sm font-bold rounded-xl shadow hover:bg-[#16258f] transition-all"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  // 3. Locked / Submitted Clearance Tracker View
  if (isSubmitted || isApproved) {
    return (
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        {/* Clearance Banner */}
        <div className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm">
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
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                Academic Clearance Status
              </span>
              <h1 className="text-xl sm:text-2xl font-extrabold text-[#0a1142]">
                {isApproved
                  ? 'Course Registration Endorsed by Level Advisor'
                  : 'Registration Submitted — Awaiting Advisor Clearance'}
              </h1>
            </div>
          </div>

          <p className="text-sm text-gray-600 mb-6">
            {isApproved
              ? 'Your course registration has been formally endorsed by your Level Advisor and synced with the academic ledger and Moodle.'
              : 'Your registration batch is locked in the SUBMITTED state. Your Level Advisor is reviewing your course matrix.'}
          </p>

          {/* Governance Stepper */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs">
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
        <div className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
            <div>
              <h2 className="text-base font-bold text-[#0a1142]">
                Registered Modules ({batch?.total_units || 0} Total Units)
              </h2>
              <span className="text-xs text-gray-500">
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
                    <span className="font-bold text-[#0a1142] text-sm">
                      {c.code}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-gray-100 text-gray-700">
                      {c.category}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{c.title}</p>
                </div>
                <span className="text-xs font-bold text-gray-800">
                  {c.units} Units
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 4. Interactive Registration Wizard (DRAFT & REJECTED states)
  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto h-full">
      {/* Rejection Alert Banner */}
      {isRejected && (
        <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 shadow-sm flex items-start gap-3">
          <AlertTriangle size={24} className="text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-amber-950">
              Registration Returned for Modification by Level Advisor
            </h3>
            <p className="text-xs text-amber-800 mt-1">
              <strong>Remarks:</strong> {rejectionRemarks || 'Please review curriculum requirements.'}
            </p>
            <p className="text-xs text-amber-700 mt-2">
              Your previous seat reservations have been safely reverted. Modify your course selection below and resubmit for approval.
            </p>
          </div>
        </div>
      )}

      {/* Header & Stepper */}
      <header className="bg-white rounded-2xl p-6 border border-gray-200 shadow-sm shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5 mb-5">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#0a1142]/10 text-[#0a1142] mb-1">
              <ShieldCheck size={14} className="text-[#0a1142]" />
              <span>FOCIT Academic Administration • Screen 8</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#0a1142] font-display">
              Course Registration & Senate Clearance
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Select accredited courses for {semester?.name || 'Active Session'}.
            </p>
          </div>

          {/* Unit Indicator Badge */}
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-gray-500 block">
                Credit Load
              </span>
              <span
                className={`text-lg font-extrabold ${
                  isUnderMinimum
                    ? 'text-amber-600'
                    : isOverMaximum
                    ? 'text-red-600'
                    : 'text-emerald-700'
                }`}
              >
                {totalSelectedUnits} / {maxCeiling} Units
              </span>
            </div>
          </div>
        </div>

        {/* 3-Step Visual Progress Stepper */}
        <nav aria-label="Registration Steps" className="max-w-xl mx-auto">
          <ol className="flex items-center w-full">
            <li className="flex-1 flex items-center">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex items-center gap-2 group text-left focus:outline-none"
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    activeStep >= 1
                      ? 'bg-[#0a1142] text-[#ffb81c]'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  1
                </span>
                <span
                  className={`text-xs font-semibold ${
                    activeStep === 1 ? 'text-[#0a1142]' : 'text-gray-500'
                  }`}
                >
                  Select
                </span>
              </button>
              <div
                className={`flex-1 h-0.5 mx-3 ${
                  activeStep > 1 ? 'bg-[#0a1142]' : 'bg-gray-200'
                }`}
              />
            </li>

            <li className="flex-1 flex items-center">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={selectedCourseIds.length === 0}
                className="flex items-center gap-2 group text-left focus:outline-none disabled:opacity-40"
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    activeStep >= 2
                      ? 'bg-[#0a1142] text-[#ffb81c]'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  2
                </span>
                <span
                  className={`text-xs font-semibold ${
                    activeStep === 2 ? 'text-[#0a1142]' : 'text-gray-500'
                  }`}
                >
                  Review
                </span>
              </button>
              <div
                className={`flex-1 h-0.5 mx-3 ${
                  activeStep > 2 ? 'bg-[#0a1142]' : 'bg-gray-200'
                }`}
              />
            </li>

            <li className="flex items-center">
              <button
                type="button"
                onClick={() => setStep(3)}
                disabled={selectedCourseIds.length === 0}
                className="flex items-center gap-2 group text-left focus:outline-none disabled:opacity-40"
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    activeStep === 3
                      ? 'bg-[#0a1142] text-[#ffb81c]'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  3
                </span>
                <span
                  className={`text-xs font-semibold ${
                    activeStep === 3 ? 'text-[#0a1142]' : 'text-gray-500'
                  }`}
                >
                  Submit
                </span>
              </button>
            </li>
          </ol>
        </nav>
      </header>

      {/* Dynamic Visual Unit Gauge */}
      <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm shrink-0">
        <div className="flex items-center justify-between text-xs mb-2">
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <BookOpen size={16} className="text-[#0a1142]" />
            <span>Senate Unit Meter:</span>
            <span
              className={`px-2 py-0.5 rounded text-[11px] ${
                isUnderMinimum
                  ? 'bg-amber-100 text-amber-800'
                  : isOverMaximum
                  ? 'bg-red-100 text-red-800'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {isUnderMinimum
                ? `Need ${unitsDeficit} more unit(s) for final submission (Min: 15)`
                : isOverMaximum
                ? `Exceeds max ceiling by ${unitsSurplus} unit(s) (Max: ${maxCeiling})`
                : 'Optimal Unit Range (15 - 24 units)'}
            </span>
          </div>
          <span className="text-gray-500 font-semibold">{totalSelectedUnits} / {maxCeiling} Units</span>
        </div>

        {/* Visual Progress Bar */}
        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden relative border border-gray-200">
          {/* Minimum Floor Marker (15 units) */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-gray-400 z-10"
            style={{ left: `${(minFloor / maxCeiling) * 100}%` }}
            title="15 Units Minimum Senate Threshold"
          />
          {/* Fill Bar */}
          <div
            className={`h-full transition-all duration-300 ${
              isUnderMinimum
                ? 'bg-amber-400'
                : isOverMaximum
                ? 'bg-red-500'
                : 'bg-emerald-500'
            }`}
            style={{
              width: `${Math.min(100, (totalSelectedUnits / maxCeiling) * 100)}%`,
            }}
          />
        </div>
      </div>

      {/* STEP 1: COURSE SELECTION MATRIX */}
      {activeStep === 1 && (
        <div className="flex flex-col flex-1 min-h-0 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Matrix Controls & Filters */}
          <div className="p-4 sm:p-5 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllCore}
                className="px-3 py-1.5 rounded-lg bg-[#0a1142] text-[#ffb81c] text-xs font-bold hover:bg-[#16258f] transition-colors shadow-sm"
              >
                Select All Core
              </button>
              <button
                type="button"
                onClick={clearDraft}
                className="px-3 py-1.5 rounded-lg bg-gray-200 text-gray-700 text-xs font-semibold hover:bg-gray-300 transition-colors"
              >
                Clear Selection
              </button>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5">
              {['ALL', 'CORE', 'ELECTIVE', 'GENERAL'].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                    categoryFilter === cat
                      ? 'bg-[#0a1142] text-white shadow-sm'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* COURSE MATRIX TABLE: Physical Viewport Lock Flex Child with contain: layout paint */}
          <div
            className="flex-1 overflow-y-auto overflow-x-auto min-h-0"
            style={{ contain: 'layout paint' }}
          >
            <table className="w-full text-left border-collapse text-sm">
              <thead className="sticky top-0 bg-gray-100 text-gray-700 text-xs uppercase tracking-wider font-bold z-10 border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4 w-12 text-center">Select</th>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Title</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4">Units</th>
                  <th className="py-3 px-4">Seats</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredCatalog.map((course) => {
                  const isSelected = selectedCourseIds.includes(course.course_id);
                  const isFull = course.enrolled_count >= course.max_capacity;

                  return (
                    <tr
                      key={course.course_id}
                      onClick={() => !isFull && toggleCourse(course.course_id)}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[#0a1142]/5 font-medium'
                          : 'hover:bg-gray-50'
                      } ${isFull ? 'opacity-50 cursor-not-allowed bg-gray-50' : ''}`}
                    >
                      <td className="py-3 px-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={isFull}
                          onChange={() => toggleCourse(course.course_id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 rounded text-[#0a1142] focus:ring-[#0a1142] border-gray-300 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 font-bold text-[#0a1142]">
                        {course.code}
                      </td>
                      <td className="py-3 px-4 text-gray-800">
                        {course.title}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                            course.category === 'CORE'
                              ? 'bg-blue-100 text-blue-800'
                              : course.category === 'ELECTIVE'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-gray-100 text-gray-800'
                          }`}
                        >
                          {course.category}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-gray-800">
                        {course.units}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-xs font-semibold ${
                            isFull ? 'text-red-600 font-bold' : 'text-gray-600'
                          }`}
                        >
                          {course.enrolled_count} / {course.max_capacity}
                          {isFull && ' (FULL)'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Sticky Bottom Action Bar */}
          <div className="p-4 sm:p-5 bg-gray-50 border-t border-gray-200 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => saveDraft()}
                disabled={isSavingDraft}
                className="px-4 py-2 rounded-xl bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-xs font-bold transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
              >
                {isSavingDraft ? (
                  <RefreshCw size={14} className="animate-spin text-gray-500" />
                ) : (
                  <FileCheck2 size={14} className="text-[#0a1142]" />
                )}
                <span>{saveDraftSuccess ? 'Draft Saved ✓' : 'Save Draft'}</span>
              </button>

              <span className="text-xs text-gray-500 hidden sm:inline">
                {selectedCourseIds.length} course(s) selected
              </span>
            </div>

            <button
              type="button"
              onClick={goToNextStep}
              disabled={selectedCourseIds.length === 0 || isOverMaximum}
              className="px-5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs sm:text-sm font-bold flex items-center gap-2 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Proceed to Review</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: CURRICULUM REVIEW */}
      {activeStep === 2 && (
        <section className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-6">
          <div className="border-b border-gray-100 pb-4">
            <h2 className="text-lg sm:text-xl font-bold text-[#0a1142]">
              Curriculum Review & Credit Summary
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Verify your selected modules before final submission to Level Advisor.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
              <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">
                Total Courses
              </span>
              <p className="text-2xl font-extrabold text-[#0a1142] mt-1">
                {selectedCourses.length} Modules
              </p>
            </div>

            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200">
              <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">
                Accumulated Load
              </span>
              <p className="text-2xl font-extrabold text-[#0a1142] mt-1">
                {totalSelectedUnits} Units
              </p>
            </div>
          </div>

          {/* Selected Modules Breakdown */}
          <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
            {selectedCourses.map((c) => (
              <div
                key={c.course_id}
                className="p-3.5 flex items-center justify-between bg-white hover:bg-gray-50/50"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#0a1142] text-sm">
                      {c.code}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-gray-100 text-gray-700">
                      {c.category}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{c.title}</p>
                </div>
                <span className="text-xs font-bold text-gray-800">
                  {c.units} Units
                </span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={goToPreviousStep}
              className="px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 text-xs sm:text-sm font-semibold flex items-center gap-1.5 transition-colors"
            >
              <ChevronLeft size={16} />
              <span>Back to Selection</span>
            </button>

            <button
              type="button"
              onClick={goToNextStep}
              disabled={isUnderMinimum || isOverMaximum}
              className="px-5 py-2.5 rounded-xl bg-[#0a1142] hover:bg-[#16258f] text-white text-xs sm:text-sm font-bold flex items-center gap-1.5 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Continue to Confirmation</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </section>
      )}

      {/* STEP 3: CONFIRMATION & ATOMIC COMMIT */}
      {activeStep === 3 && (
        <section className="bg-white rounded-2xl p-6 sm:p-8 border border-gray-200 shadow-sm space-y-6">
          <div className="border-b border-gray-100 pb-4">
            <h2 className="text-lg sm:text-xl font-bold text-[#0a1142]">
              Final Senate Registration Commitment
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Committing your registration reserves seat capacity and routes to Level Advisor.
            </p>
          </div>

          {submitError && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs space-y-1">
              <div className="flex items-center gap-2 font-bold text-red-900">
                <AlertCircle size={16} />
                <span>Registration Submission Failed</span>
              </div>
              <p>
                {submitError?.response?.data?.error ||
                  submitError?.message ||
                  'Failed to commit registration.'}
              </p>
            </div>
          )}

          <div className="p-5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
            <p className="font-bold flex items-center gap-1.5 text-amber-950">
              <Info size={16} />
              Academic Regulations Declaration
            </p>
            <p className="leading-relaxed">
              I formally declare that I am registering for{' '}
              <strong>{totalSelectedUnits} credit units</strong> across{' '}
              <strong>{selectedCourses.length} courses</strong> for this session.
              I understand that seat capacity will be reserved upon submission and modifications require Level Advisor remarks.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={goToPreviousStep}
              disabled={isSubmitting}
              className="w-full sm:w-auto px-4 py-2 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 text-xs sm:text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <ChevronLeft size={16} />
              <span>Back to Review</span>
            </button>

            <button
              type="button"
              onClick={() => submitRegistration()}
              disabled={isSubmitting || isUnderMinimum || isOverMaximum}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#0a1142] to-[#16258f] hover:from-[#070c2e] hover:to-[#0a1142] text-[#ffb81c] font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={16} className="animate-spin text-[#ffb81c]" />
                  <span>Securing Dijkstra Locks...</span>
                </>
              ) : (
                <>
                  <Lock size={16} />
                  <span>Submit for Level Advisor Clearance</span>
                </>
              )}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};
