import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api';

export const QUESTION_TYPES = [
  { id: 'ALL', label: 'All Types' },
  { id: 'MULTIPLE_CHOICE', label: 'Multiple Choice' },
  { id: 'TRUE_FALSE', label: 'True / False' },
  { id: 'SHORT_ANSWER', label: 'Short Answer' },
];

/**
 * Custom Hook: useQuestionBank
 *
 * Manages Question Bank query, authoring mutation, and atomic publish swap.
 */
export function useQuestionBank(courseId = 'CSC204') {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedTypeFilter = searchParams.get('type') || 'ALL';

  const handleFilterChange = useCallback((typeId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (typeId === 'ALL') next.delete('type');
      else next.set('type', typeId);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // 1. Fetch Question Bank Context & Active Revision
  const {
    data: bankData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['question-bank', courseId],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get(`/courses/${courseId}/question-bank`, { signal });
      return res.data;
    },
    staleTime: 30 * 1000,
  });

  const activeQuiz = bankData?.activeQuiz;
  const questions = bankData?.questions || [];
  const metrics = bankData?.metrics || { total: 0, mcq: 0, trueFalse: 0, shortAnswer: 0 };
  const courseCode = bankData?.courseCode || 'CSC 204';
  const courseTitle = bankData?.courseTitle || 'Data Structures and Algorithms';

  // Filter questions by type
  const filteredQuestions = questions.filter((q) => {
    if (selectedTypeFilter === 'ALL') return true;
    return q.type === selectedTypeFilter;
  });

  // 2. Add Question Mutation
  const addQuestionMutation = useMutation({
    mutationFn: async (payload) => {
      if (!activeQuiz?.id) throw new Error('No active assessment bank resolved');

      const res = await apiClient.post(`/courses/${courseId}/question-bank/questions`, {
        quizId: activeQuiz.id,
        questionNumber: questions.length + 1,
        ...payload,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['question-bank', courseId] });
    },
  });

  // 3. Publish Mutation
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!activeQuiz?.id) throw new Error('No active quiz to publish');
      const res = await apiClient.post(`/courses/${courseId}/question-bank/publish`, {
        targetQuizId: activeQuiz.id,
        expectedPreviousQuizId: activeQuiz.id,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['question-bank', courseId] });
    },
  });

  return {
    courseId,
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
    publishOfficialTestMutation: useMutation({
      mutationFn: async (testData) => {
        const res = await apiClient.post(`/courses/${courseId}/tests/publish`, testData);
        return res.data;
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['question-bank', courseId] });
      },
    }),
  };
}

export default useQuestionBank;
