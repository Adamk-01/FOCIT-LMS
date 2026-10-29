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
    enabled: Boolean(courseId),
    staleTime: 30 * 1000,
  });

  const activeQuiz = bankData?.activeQuiz;
  const questions = bankData?.questions || [];
  const metrics = bankData?.metrics || { total: 0, mcq: 0, trueFalse: 0, shortAnswer: 0 };
  const courseCode = bankData?.courseCode || (courseId ? courseId : '');
  const courseTitle = bankData?.courseTitle || '';

  // Filter questions by type
  const filteredQuestions = questions.filter((q) => {
    if (selectedTypeFilter === 'ALL') return true;
    return q.type === selectedTypeFilter;
  });

  // 2. Add Question Mutation
  const addQuestionMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post(`/courses/${courseId}/question-bank/questions`, {
        quizId: activeQuiz?.id,
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

export function useCourseTests(courseId) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['course-tests', courseId],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get(`/courses/${courseId}/tests`, { signal });
      return res.data?.tests || [];
    },
    enabled: Boolean(courseId),
    staleTime: 10 * 1000,
  });

  const createTestMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post(`/courses/${courseId}/tests`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-tests', courseId] });
      queryClient.invalidateQueries({ queryKey: ['question-bank', courseId] });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ quizId, isActive, status }) => {
      const res = await apiClient.put(`/courses/${courseId}/tests/${quizId}/status`, { isActive, status });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-tests', courseId] });
    },
  });

  const syncTestMutation = useMutation({
    mutationFn: async (quizId) => {
      const res = await apiClient.post(`/courses/${courseId}/tests/${quizId}/sync-moodle`, {});
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-tests', courseId] });
      queryClient.invalidateQueries({ queryKey: ['test-detail'] });
    },
  });

  return {
    tests: data || [],
    isLoading,
    error,
    refetch,
    createTestMutation,
    updateStatusMutation,
    syncTestMutation,
  };
}

export function useTestDetail(courseId, quizId) {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['test-detail', courseId, quizId],
    queryFn: async ({ signal }) => {
      const res = await apiClient.get(`/courses/${courseId}/tests/${quizId}`, { signal });
      return res.data;
    },
    enabled: Boolean(courseId && quizId),
    staleTime: 10 * 1000,
  });

  const addQuestionMutation = useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post(`/courses/${courseId}/tests/${quizId}/questions`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-detail', courseId, quizId] });
      queryClient.invalidateQueries({ queryKey: ['course-tests', courseId] });
    },
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: async (questionId) => {
      const res = await apiClient.delete(`/courses/${courseId}/tests/${quizId}/questions/${questionId}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-detail', courseId, quizId] });
      queryClient.invalidateQueries({ queryKey: ['course-tests', courseId] });
    },
  });

  const syncMoodleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/courses/${courseId}/tests/${quizId}/sync-moodle`, {});
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-detail', courseId, quizId] });
      queryClient.invalidateQueries({ queryKey: ['course-tests', courseId] });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ isActive, status }) => {
      const res = await apiClient.put(`/courses/${courseId}/tests/${quizId}/status`, { isActive, status });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['test-detail', courseId, quizId] });
      queryClient.invalidateQueries({ queryKey: ['course-tests', courseId] });
    },
  });

  const duplicateAsPracticeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/courses/${courseId}/tests/${quizId}/duplicate-as-practice`, {});
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-tests', courseId] });
    },
  });

  return {
    test: data?.test,
    questions: data?.questions || [],
    isLoading,
    error,
    refetch,
    addQuestionMutation,
    deleteQuestionMutation,
    syncMoodleMutation,
    updateStatusMutation,
    duplicateAsPracticeMutation,
  };
}

export default useQuestionBank;
