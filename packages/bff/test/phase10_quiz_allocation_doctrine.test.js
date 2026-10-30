import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateQuizAttempt,
  translateClientAnswersToCanonical,
  deriveMaskedOptionId,
} from '../src/services/quizAllocationService.js';

describe('Phase 10: Deterministic Quiz Allocation & HMAC Masking Doctrine', () => {
  const sampleQuestions = [
    {
      question_id: 'q_101',
      prompt: 'What is the time complexity of binary search?',
      options: [
        { id: 'opt_1', text: 'O(log n)' },
        { id: 'opt_2', text: 'O(n)' },
        { id: 'opt_3', text: 'O(n log n)' },
        { id: 'opt_4', text: 'O(1)' },
      ],
      points: 2,
    },
    {
      question_id: 'q_102',
      prompt: 'Which data structure uses LIFO order?',
      options: [
        { id: 'opt_5', text: 'Stack' },
        { id: 'opt_6', text: 'Queue' },
        { id: 'opt_7', text: 'Heap' },
        { id: 'opt_8', text: 'Tree' },
      ],
      points: 2,
    },
    {
      question_id: 'q_103',
      prompt: 'What is an ACID invariant in databases?',
      options: [
        { id: 'opt_9', text: 'Atomicity' },
        { id: 'opt_10', text: 'Asynchrony' },
        { id: 'opt_11', text: 'Availability' },
        { id: 'opt_12', text: 'Aggregation' },
      ],
      points: 2,
    },
  ];

  // ── TEST 1: Deterministic Idempotency Across Page Reloads ──
  test('Deterministic Shuffling: Same attemptId + allocationSeed produces identical question & option order across reloads', () => {
    const attemptId = 'att_test_12345';
    const seed = 'a1b2c3d4e5f67890123456789abcdef0a1b2c3d4e5f67890123456789abcdef0';

    const run1 = allocateQuizAttempt(attemptId, seed, sampleQuestions);
    const run2 = allocateQuizAttempt(attemptId, seed, sampleQuestions);

    // Question order must be strictly deterministic
    assert.deepStrictEqual(
      run1.shuffledQuestions.map((q) => q.id),
      run2.shuffledQuestions.map((q) => q.id),
      'Question sequence must be identical across reloads'
    );

    // Option order within each question must be strictly deterministic
    for (let i = 0; i < run1.shuffledQuestions.length; i++) {
      const q1 = run1.shuffledQuestions[i];
      const q2 = run2.shuffledQuestions[i];
      assert.deepStrictEqual(
        q1.options.map((o) => o.id),
        q2.options.map((o) => o.id),
        `Option order for question ${q1.id} must match across reloads`
      );
    }
  });

  // ── TEST 2: Permutation Diversity Across Different Students ──
  test('Entropy Separation: Different student attempts receive distinct HMAC option IDs and permutations', () => {
    const attempt1 = 'att_student_1';
    const seed1 = '1111111111111111111111111111111111111111111111111111111111111111';

    const attempt2 = 'att_student_2';
    const seed2 = '2222222222222222222222222222222222222222222222222222222222222222';

    const res1 = allocateQuizAttempt(attempt1, seed1, sampleQuestions);
    const res2 = allocateQuizAttempt(attempt2, seed2, sampleQuestions);

    // HMAC masked option IDs for the same raw choice (opt_1) must be completely different
    const masked1 = res1.forwardMap['q_101']['opt_1'];
    const masked2 = res2.forwardMap['q_101']['opt_1'];

    assert.notStrictEqual(masked1, masked2, 'Different attempts must receive non-correlatable HMAC option IDs');
    assert.match(masked1, /^opt_[a-f0-9]{16}$/, 'Option ID must match HMAC format opt_<16 hex>');
    assert.match(masked2, /^opt_[a-f0-9]{16}$/);

    // Verify raw DB IDs are not leaked in client payload
    for (const q of res1.shuffledQuestions) {
      for (const opt of q.options) {
        assert.ok(!opt.id.startsWith('opt_1') || opt.id.length === 20, 'Raw DB IDs must not leak to client');
      }
    }
  });

  // ── TEST 3: Bidirectional Ingress/Egress Translation ──
  test('Bidirectional Translation: HMAC masked answers translate perfectly back to canonical DB IDs', () => {
    const attemptId = 'att_test_roundtrip';
    const seed = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    const { shuffledQuestions, forwardMap, reverseMap } = allocateQuizAttempt(
      attemptId,
      seed,
      sampleQuestions
    );

    // Simulate student selecting option 0 on question 0 and option 1 on question 1
    const studentSelectedAnswers = [
      {
        questionId: shuffledQuestions[0].id,
        optionId: shuffledQuestions[0].options[0].id, // HMAC masked ID
      },
      {
        questionId: shuffledQuestions[1].id,
        optionId: shuffledQuestions[1].options[1].id, // HMAC masked ID
      },
    ];

    // Ingress translation valve in BFF
    const canonicalAnswers = translateClientAnswersToCanonical(
      studentSelectedAnswers,
      reverseMap
    );

    assert.strictEqual(canonicalAnswers.length, 2);

    // Verify translated IDs match the raw IDs in sampleQuestions
    const q0RawQuestion = sampleQuestions.find((q) => q.question_id === studentSelectedAnswers[0].questionId);
    const expectedRawOption0 = reverseMap[q0RawQuestion.question_id][studentSelectedAnswers[0].optionId];
    assert.strictEqual(canonicalAnswers[0].optionId, expectedRawOption0);
    assert.ok(
      q0RawQuestion.options.some((o) => o.id === canonicalAnswers[0].optionId),
      'Translated answer must map directly to raw DB option ID'
    );

    // Re-egress forward translation restores exact client masked ID
    const reMasked = forwardMap[canonicalAnswers[0].questionId][canonicalAnswers[0].optionId];
    assert.strictEqual(reMasked, studentSelectedAnswers[0].optionId, 'R(F(id)) must be identity');
  });
});
