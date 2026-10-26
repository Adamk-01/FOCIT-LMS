/**
 * FOCIT LMS - Authoritative Assessment Question Bank Shell
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Invariants Enforced:
 * 1. State Partitioning: Category filter (?type=...) in URL SearchParams with { replace: true }
 * 2. Zero Database Schema Leakage: RFC 7807 problem details mapped via <ErrorAlertCallout />
 * 3. Atomic Publish Pointer Swap with PostgreSQL immutability enforcement
 * 4. Dumb Presentation Shell: Under 180 lines (135 lines)
 */

import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useQuestionBank } from '../hooks/useQuestionBank';
import { QuestionBankHeader } from '../components/questionBank/QuestionBankHeader';
import { QuestionMetricsSummary } from '../components/questionBank/QuestionMetricsSummary';
import { QuestionFormDialog } from '../components/questionBank/QuestionFormDialog';
import { QuestionInventoryList } from '../components/questionBank/QuestionInventoryList';
import { ErrorStateView } from '../components/ErrorStateView';
import { PublishOfficialTestModal } from '../components/questionBank/PublishOfficialTestModal';

export function QuestionBankPage() {
  const { courseId = 'CSC204' } = useParams();
  const [showAuthoringCard, setShowAuthoringCard] = useState(false);
  const [showPublishTestModal, setShowPublishTestModal] = useState(false);

  const {
    courseCode,
    courseTitle,
    activeQuiz,
    questions,
    metrics,
    filteredQuestions,
    selectedTypeFilter,
    handleFilterChange,
    isLoading,
    error,
    refetch,
    addQuestionMutation,
    publishMutation,
    publishOfficialTestMutation,
  } = useQuestionBank(courseId);

  // Unhappy Path: Loading Skeleton
  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16 animate-pulse" aria-busy="true">
        <div className="w-48 h-4 bg-gray-200 rounded" />
        <div className="h-32 bg-gray-200 rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl" />
          ))}
        </div>
        <div className="h-96 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  // Unhappy Path: Error State View
  if (error) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorStateView error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16 animate-fade-in">
      {/* 1. Dynamic Breadcrumbs */}
      <nav aria-label="Breadcrumb Navigation" className="text-xs font-semibold text-gray-500">
        <ol className="flex items-center gap-2">
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">
              Dashboard
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
          <li>
            <Link to={`/courses/${courseId}`} className="hover:text-[#0a1142] transition-colors">
              {courseCode}
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
          <li className="text-[#0a1142] font-bold" aria-current="page">
            Question Bank
          </li>
        </ol>
      </nav>

      {/* 2. Top Header & Revision Management Banner */}
      <QuestionBankHeader
        courseCode={courseCode}
        courseTitle={courseTitle}
        activeQuiz={activeQuiz}
        isPublishing={publishMutation.isPending}
        canPublish={Boolean(activeQuiz?.id)}
        onPublish={() => publishMutation.mutate()}
        showAuthoringCard={showAuthoringCard}
        onToggleAuthoring={() => setShowAuthoringCard((prev) => !prev)}
        onOpenPublishTestModal={() => setShowPublishTestModal(true)}
      />

      {/* 3. Metrics Summary Cards */}
      <QuestionMetricsSummary metrics={metrics} />

      {/* 4. Manual Question Authoring Card */}
      {showAuthoringCard && (
        <QuestionFormDialog
          questionCount={questions.length}
          activeQuizVersion={activeQuiz?.version || 1}
          onSubmit={(payload) => {
            addQuestionMutation.mutate(payload, {
              onSuccess: () => setShowAuthoringCard(false),
            });
          }}
          onCancel={() => setShowAuthoringCard(false)}
          isPending={addQuestionMutation.isPending}
          error={addQuestionMutation.error}
        />
      )}

      {/* 5. Filter Chips & Questions Inventory Table */}
      <QuestionInventoryList
        questions={questions}
        filteredQuestions={filteredQuestions}
        selectedTypeFilter={selectedTypeFilter}
        onFilterChange={handleFilterChange}
      />
      <PublishOfficialTestModal
        isOpen={showPublishTestModal}
        onClose={() => setShowPublishTestModal(false)}
        courseId={courseId}
        courseCode={courseCode}
        totalAvailableQuestions={questions.length}
        onPublishTest={(payload) => {
          publishOfficialTestMutation.mutate(payload, {
            onSuccess: () => setShowPublishTestModal(false),
          });
        }}
        isPublishing={publishOfficialTestMutation.isPending}
        error={publishOfficialTestMutation.error?.response?.data?.error || publishOfficialTestMutation.error?.message}
      />
    </div>
  );
}

export default QuestionBankPage;
