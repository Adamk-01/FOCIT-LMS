/**
 * FOCIT LMS - Test-First Question Bank & Moodle Sync Interface
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Enforces Test-First Assessment Authoring:
 * 1. Primary action: Create tests for allocated courses (MCQ, True/False, Short Answer, or Mixed).
 * 2. Secondary action: Add questions inside specific tests.
 * 3. Publishing to students & duplication to practice drills with anti-memorization shuffling.
 * 4. Automated bi-directional Moodle LMS sync with outbox logging.
 */

import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useCourseTests, useTestDetail } from '../hooks/useQuestionBank';
import { useLecturerCourses } from '../hooks/useLecturerDashboard';
import { TestsInventoryPanel } from '../components/questionBank/TestsInventoryPanel';
import { TestQuestionManagerView } from '../components/questionBank/TestQuestionManagerView';
import { CreateTestModal } from '../components/questionBank/CreateTestModal';
import { AddQuestionToTestModal } from '../components/questionBank/AddQuestionToTestModal';
import { ErrorStateView } from '../components/ErrorStateView';

export function QuestionBankPage() {
  const { courseId: paramCourseId } = useParams();
  const navigate = useNavigate();
  const { data: courses = [], isLoading: isLoadingCourses } = useLecturerCourses();

  const resolvedCourseId = paramCourseId || (isLoadingCourses ? null : (courses[0]?.course_id || 'CSC204'));
  const currentCourse = courses.find((c) => c.course_id === resolvedCourseId) || {
    course_id: resolvedCourseId,
    code: resolvedCourseId,
    title: 'Course Assessments',
  };

  const [selectedTest, setSelectedTest] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAddQuestionModal, setShowAddQuestionModal] = useState(false);

  const {
    tests,
    isLoading: isTestsLoading,
    error: testsError,
    refetch: refetchTests,
    createTestMutation,
    updateStatusMutation: updateInventoryStatusMutation,
    syncTestMutation,
  } = useCourseTests(resolvedCourseId);

  const {
    test: activeTestDetail,
    questions,
    isLoading: isDetailLoading,
    refetch: refetchDetail,
    addQuestionMutation,
    deleteQuestionMutation,
    updateStatusMutation,
    duplicateAsPracticeMutation,
  } = useTestDetail(resolvedCourseId, selectedTest?.quiz_id);

  if (isLoadingCourses || !resolvedCourseId) {
    return (
      <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16 animate-pulse" aria-busy="true">
        <div className="w-48 h-4 bg-gray-200 rounded" />
        <div className="h-32 bg-gray-200 rounded-2xl" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 bg-gray-100 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (testsError) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4">
        <ErrorStateView error={testsError} onRetry={refetchTests} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16 animate-fade-in">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb Navigation" className="text-xs font-semibold text-gray-500">
        <ol className="flex items-center gap-2 flex-wrap">
          <li>
            <Link to="/dashboard" className="hover:text-[#0a1142] transition-colors">
              Dashboard
            </Link>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
          <li>
            <select
              value={resolvedCourseId}
              onChange={(e) => {
                setSelectedTest(null);
                navigate(`/courses/${encodeURIComponent(e.target.value)}/question-bank`);
              }}
              className="bg-transparent font-bold text-[#0a1142] border-none outline-none cursor-pointer text-xs"
            >
              {courses.map((c) => (
                <option key={c.course_id} value={c.course_id}>
                  {c.code || c.course_id} - {c.title}
                </option>
              ))}
            </select>
          </li>
          <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
          <li className={selectedTest ? 'text-gray-500' : 'text-[#0a1142] font-bold'}>
            <button
              onClick={() => setSelectedTest(null)}
              className="hover:underline transition-all"
            >
              Assessments & Question Bank
            </button>
          </li>
          {selectedTest && (
            <>
              <ChevronRight size={12} className="text-gray-400 shrink-0" aria-hidden="true" />
              <li className="text-[#0a1142] font-bold truncate max-w-xs" aria-current="page">
                {selectedTest.title}
              </li>
            </>
          )}
        </ol>
      </nav>

      {/* Main Content: Test Manager OR Inventory */}
      {selectedTest ? (
        <TestQuestionManagerView
          test={activeTestDetail || selectedTest}
          questions={questions}
          isLoading={isDetailLoading}
          onBack={() => {
            setSelectedTest(null);
            refetchTests();
          }}
          onOpenAddQuestion={() => setShowAddQuestionModal(true)}
          onDeleteQuestion={(qId) => deleteQuestionMutation.mutate(qId)}
          onSyncMoodle={() => syncTestMutation.mutate(selectedTest.quiz_id)}
          isSyncing={syncTestMutation.isPending && syncTestMutation.variables === selectedTest.quiz_id}
          onTogglePublish={(nextActive) => {
            updateStatusMutation.mutate({
              isActive: nextActive,
              status: nextActive ? 'ACTIVE' : 'DRAFT',
            }, {
              onSuccess: () => refetchTests(),
            });
          }}
          isPublishing={updateStatusMutation.isPending}
          onDuplicateAsPractice={() => {
            duplicateAsPracticeMutation.mutate(undefined, {
              onSuccess: () => {
                refetchTests();
                setSelectedTest(null);
              },
            });
          }}
          isDuplicating={duplicateAsPracticeMutation.isPending}
        />
      ) : (
        <TestsInventoryPanel
          tests={tests}
          isLoading={isTestsLoading}
          onOpenCreateTest={() => setShowCreateModal(true)}
          onSelectTest={(t) => setSelectedTest(t)}
          onSyncMoodle={(quizId) => syncTestMutation.mutate(quizId)}
          syncingTestId={syncTestMutation.isPending ? syncTestMutation.variables : null}
        />
      )}

      {/* Modals */}
      <CreateTestModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        courseId={resolvedCourseId}
        courseCode={currentCourse.code || currentCourse.course_id}
        onCreateTest={(payload) => {
          createTestMutation.mutate(payload, {
            onSuccess: (res) => {
              setShowCreateModal(false);
              if (res?.test) {
                setSelectedTest(res.test);
              }
            },
          });
        }}
        isPending={createTestMutation.isPending}
      />

      {selectedTest && (
        <AddQuestionToTestModal
          isOpen={showAddQuestionModal}
          onClose={() => setShowAddQuestionModal(false)}
          test={activeTestDetail || selectedTest}
          onAddQuestion={(payload) => {
            addQuestionMutation.mutate(payload, {
              onSuccess: () => {
                setShowAddQuestionModal(false);
                refetchTests();
              },
            });
          }}
          isPending={addQuestionMutation.isPending}
        />
      )}
    </div>
  );
}

export default QuestionBankPage;
