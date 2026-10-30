/**
 * FOCIT LMS - Student Course Registration Page (Milestone 3 Shell < 180 lines)
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useRegistrationWizard } from '../hooks/useRegistrationWizard';
import { RegistrationStepIndicator } from '../components/registration/RegistrationStepIndicator';
import { AvailableCoursesTable } from '../components/registration/AvailableCoursesTable';
import { SelectedCoursesSummary } from '../components/registration/SelectedCoursesSummary';
import { RegistrationDeclarationModal } from '../components/registration/RegistrationDeclarationModal';
import { RegistrationClearanceTracker } from '../components/registration/RegistrationClearanceTracker';
import { ErrorStateView } from '../components/ErrorStateView';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export const CourseRegistrationPage = () => {
  const { user } = useAuth();
  const studentId = user?.username || 'student1';

  const {
    activeStep, setStep, goToNextStep, goToPreviousStep,
    categoryFilter, setCategoryFilter, searchQuery, setSearchQuery,
    student, semester, batch, eligibleCatalog, selectedCourseIds, selectedCourses,
    batchStatus, isSubmitted, isApproved, isRejected, rejectionRemarks,
    totalSelectedUnits, minFloor, maxCeiling, isUnderMinimum, isOverMaximum, unitsDeficit, unitsSurplus,
    toggleCourse, selectAllCore, clearDraft,
    saveDraft, isSavingDraft, saveDraftSuccess,
    submitRegistration, isSubmitting, submitError,
    isLoading, isError, error, refetch,
  } = useRegistrationWizard(studentId);

  // 1. Loading State
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <RefreshCw size={36} className="animate-spin text-[#0a1142] dark:text-blue-400" aria-hidden="true" />
        <p className="text-sm font-bold text-gray-700 dark:text-slate-300 font-sans">
          Loading academic curriculum and registration profile...
        </p>
      </div>
    );
  }

  // 2. Error State (Non-Destructive Zero-Trust ErrorStateView)
  if (isError) {
    return <ErrorStateView error={error} onRetry={refetch} />;
  }

  // 3. Locked / Submitted Clearance Tracker View
  if (isSubmitted || isApproved) {
    return (
      <RegistrationClearanceTracker
        batchStatus={batchStatus}
        isApproved={isApproved}
        student={student}
        batch={batch}
        selectedCourses={selectedCourses}
      />
    );
  }

  // 4. Interactive Registration Wizard (DRAFT & REJECTED states)
  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto h-full animate-fade-in">
      {/* Rejection Alert Banner */}
      {isRejected && (
        <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 text-amber-900 dark:text-amber-200 shadow-sm flex items-start gap-3">
          <AlertTriangle size={24} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0 font-sans">
            <h3 className="text-sm font-black text-amber-950 dark:text-amber-100 font-display">
              Registration Returned for Modification by Level Advisor
            </h3>
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
              <strong>Remarks:</strong> {rejectionRemarks || 'Please review curriculum requirements.'}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">
              Your previous seat reservations have been safely reverted. Modify your course selection below and resubmit for approval.
            </p>
          </div>
        </div>
      )}

      {/* Stepper Navigation Header with Senate Unit Meter */}
      <RegistrationStepIndicator
        activeStep={activeStep}
        setStep={setStep}
        selectedCount={selectedCourseIds.length}
        totalUnits={totalSelectedUnits}
        minFloor={minFloor}
        maxCeiling={maxCeiling}
        isUnderMinimum={isUnderMinimum}
        isOverMaximum={isOverMaximum}
        unitsDeficit={unitsDeficit}
        unitsSurplus={unitsSurplus}
        semesterName={semester?.name || 'Active Session'}
      />

      {/* Step 1: Course Selection Matrix */}
      {activeStep === 1 && (
        <AvailableCoursesTable
          catalog={eligibleCatalog}
          selectedCourseIds={selectedCourseIds}
          toggleCourse={toggleCourse}
          selectAllCore={selectAllCore}
          clearDraft={clearDraft}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSaveDraft={saveDraft}
          isSavingDraft={isSavingDraft}
          saveDraftSuccess={saveDraftSuccess}
          onProceed={goToNextStep}
          isOverMaximum={isOverMaximum}
          studentLevel={student?.level || 200}
        />
      )}

      {/* Step 2: Curriculum Review & Credit Summary */}
      {activeStep === 2 && (
        <SelectedCoursesSummary
          selectedCourses={selectedCourses}
          totalUnits={totalSelectedUnits}
          minFloor={minFloor}
          maxCeiling={maxCeiling}
          isUnderMinimum={isUnderMinimum}
          isOverMaximum={isOverMaximum}
          unitsDeficit={unitsDeficit}
          unitsSurplus={unitsSurplus}
          onBack={goToPreviousStep}
          onProceed={goToNextStep}
          onRemoveCourse={toggleCourse}
        />
      )}

      {/* Step 3: Confirmation & Atomic Commit */}
      {activeStep === 3 && (
        <RegistrationDeclarationModal
          selectedCourses={selectedCourses}
          totalUnits={totalSelectedUnits}
          onSubmit={submitRegistration}
          isSubmitting={isSubmitting}
          submitError={submitError}
          onBack={goToPreviousStep}
          isUnderMinimum={isUnderMinimum}
          isOverMaximum={isOverMaximum}
        />
      )}
    </div>
  );
};

export default CourseRegistrationPage;
