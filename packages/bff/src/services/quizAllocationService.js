import crypto from 'node:crypto';

/**
 * Deterministic XORShift128+ Seeded PRNG
 * Produces uniform 32-bit floats [0, 1) from a 64-character hex seed.
 */
function createPrng(seedHex) {
  // Hash seed to guarantee 128-bit state entropy
  const hash = crypto.createHash('sha256').update(seedHex).digest();
  let s0 = hash.readUInt32LE(0);
  let s1 = hash.readUInt32LE(4);
  let s2 = hash.readUInt32LE(8);
  let s3 = hash.readUInt32LE(12);

  return function nextFloat() {
    // XORShift128+ algorithm
    let t = s0 ^ (s0 << 11);
    s0 = s1;
    s1 = s2;
    s2 = s3;
    s3 = (s3 ^ (s3 >>> 19)) ^ (t ^ (t >>> 8));
    return (s3 >>> 0) / 4294967296;
  };
}

/**
 * In-place deterministic Fisher-Yates shuffle using seeded PRNG.
 */
function seededShuffle(array, prng) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Derives an attempt-scoped, unpredictable HMAC pseudo-ID for an option.
 * Blinds student DevTools inspection from detecting sequential IDs or authoring patterns.
 */
export function deriveMaskedOptionId(attemptId, questionId, rawOptionId, allocationSeed) {
  const hmac = crypto.createHmac('sha256', allocationSeed);
  hmac.update(`${attemptId}:${questionId}:${rawOptionId}`);
  return `opt_${hmac.digest('hex').slice(0, 16)}`;
}

/**
 * Builds the bidirectional mapping and shuffled questions payload for an attempt.
 *
 * @param {string} attemptId - UUID/string of the quiz attempt
 * @param {string} allocationSeed - Immutable attempt seed stored in PostgreSQL
 * @param {Array<object>} rawQuestions - Questions ordered deterministically by question_id ASC
 * @returns {{
 *   shuffledQuestions: Array<object>,
 *   forwardMap: Record<string, Record<string, string>>, // qId -> { rawOptId: maskedOptId }
 *   reverseMap: Record<string, Record<string, string>>, // qId -> { maskedOptId: rawOptId }
 * }}
 */
export function allocateQuizAttempt(attemptId, allocationSeed, rawQuestions) {
  const prng = createPrng(`${attemptId}:${allocationSeed}`);

  // 1. Deterministically shuffle questions
  const shuffledQuestionsList = seededShuffle(rawQuestions, prng);

  const forwardMap = {};
  const reverseMap = {};

  // 2. Deterministically shuffle options within each question and compute HMAC aliases
  const preparedQuestions = shuffledQuestionsList.map((q, idx) => {
    const qId = q.question_id || q.id;
    forwardMap[qId] = {};
    reverseMap[qId] = {};

    let optionsArray = [];
    if (Array.isArray(q.options)) {
      optionsArray = q.options;
    } else if (typeof q.options === 'string') {
      try {
        optionsArray = JSON.parse(q.options);
      } catch {
        optionsArray = [];
      }
    }

    // Mask each option ID with attempt-scoped HMAC
    const maskedOptions = optionsArray.map((opt) => {
      const rawOptId = String(opt.id);
      const maskedId = deriveMaskedOptionId(attemptId, qId, rawOptId, allocationSeed);

      forwardMap[qId][rawOptId] = maskedId;
      reverseMap[qId][maskedId] = rawOptId;

      return {
        id: maskedId,
        text: opt.text || opt.label || '',
      };
    });

    // Deterministically shuffle masked options
    const shuffledOptions = seededShuffle(maskedOptions, prng);

    return {
      id: qId,
      number: idx + 1,
      prompt: q.prompt,
      options: shuffledOptions,
      points: q.points || 1,
    };
  });

  return {
    shuffledQuestions: preparedQuestions,
    forwardMap,
    reverseMap,
  };
}

/**
 * Translates incoming client answers (with HMAC masked option IDs)
 * back to canonical database option IDs for PostgreSQL ACID insertion.
 *
 * @param {Array<{ questionId: string, optionId: string }>} incomingAnswers
 * @param {Record<string, Record<string, string>>} reverseMap - qId -> { maskedOptId: rawOptId }
 * @returns {Array<{ questionId: string, optionId: string }>}
 */
export function translateClientAnswersToCanonical(incomingAnswers, reverseMap) {
  if (!Array.isArray(incomingAnswers)) return [];

  return incomingAnswers.map((ans) => {
    const qId = ans.questionId;
    const rawOptionId = reverseMap[qId]?.[ans.optionId] || ans.optionId;

    return {
      questionId: qId,
      optionId: rawOptionId,
    };
  });
}
