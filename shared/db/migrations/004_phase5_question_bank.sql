-- ==============================================================================
-- FOCIT LMS - Phase 5 Question Bank & Copy-On-Write Concurrency Schema
-- Enforces:
-- 1. Partial Unique Index (uq_one_active_quiz_per_course) preventing split-brain
-- 2. JSONB Membership CHECK Constraint (chk_correct_option_exists_in_options)
-- 3. Database Engine Immutability Trigger (trg_quiz_question_immutability_guard)
-- ==============================================================================

BEGIN;

-- 1. Alter quizzes to add versioning and active attempt pointer
ALTER TABLE quizzes 
ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_active_for_new_attempts BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. Enforce the Partial Unique Index: Exactly one active quiz pointer per course
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_quiz_per_course 
ON quizzes (course_id) 
WHERE (is_active_for_new_attempts = TRUE);

-- 3. Alter quiz_questions to add question type and explanation
ALTER TABLE quiz_questions 
ADD COLUMN IF NOT EXISTS type VARCHAR(32) NOT NULL DEFAULT 'MULTIPLE_CHOICE',
ADD COLUMN IF NOT EXISTS explanation TEXT;

-- 4. Enforce Option Membership CHECK Constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_correct_option_exists_in_options'
    ) THEN
        ALTER TABLE quiz_questions
        ADD CONSTRAINT chk_correct_option_exists_in_options
        CHECK (options @> jsonb_build_array(jsonb_build_object('id', correct_option_id)));
    END IF;
END $$;

-- 5. Immutability Trigger Guard
CREATE OR REPLACE FUNCTION trg_enforce_quiz_question_immutability()
RETURNS TRIGGER AS $$
DECLARE
    attempts_count INT;
BEGIN
    SELECT COUNT(*) INTO attempts_count
    FROM quiz_attempts
    WHERE quiz_id = OLD.quiz_id;

    IF attempts_count > 0 THEN
        RAISE EXCEPTION 'Academic Integrity Invariant: Cannot mutate question % while parent quiz % has recorded student attempts. Create a revision instead.',
            OLD.question_id, OLD.quiz_id
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quiz_question_immutability_guard ON quiz_questions;
CREATE TRIGGER trg_quiz_question_immutability_guard
BEFORE UPDATE OR DELETE ON quiz_questions
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_quiz_question_immutability();

COMMIT;
