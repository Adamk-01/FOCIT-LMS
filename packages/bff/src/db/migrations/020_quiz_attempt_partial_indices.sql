-- ==============================================================================
-- 020_quiz_attempt_partial_indices.sql
-- FOCIT LMS - Two-Tier Assessment Partial Unique Index Realignment
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 0. Ensure is_practice column exists defensively on quiz_attempts
ALTER TABLE quiz_attempts 
ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT FALSE;

-- 1. Drop over-broad active_or_sealed index from migration 016
DROP INDEX IF EXISTS uq_quiz_attempt_active_or_sealed;

-- 2. Drop legacy single-attempt index from migration 015 if present
DROP INDEX IF EXISTS uq_attempt_student_official_quiz;

-- 3. Strict Summative Invariant: Exactly one official attempt per lifetime per student
CREATE UNIQUE INDEX IF NOT EXISTS uq_attempt_student_official_sealed
ON quiz_attempts (student_id, quiz_id)
WHERE (is_practice = FALSE AND status != 'ABANDONED');

-- 4. Concurrency Invariant: At most ONE active (IN_PROGRESS) attempt at any second
CREATE UNIQUE INDEX IF NOT EXISTS uq_attempt_student_active_session
ON quiz_attempts (student_id, quiz_id)
WHERE (status = 'IN_PROGRESS');

COMMIT;
