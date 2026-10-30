-- ==============================================================================
-- FOCIT LMS - Phase 15 Two-Tier Assessment Architecture (Practice vs Official Tests)
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. EXTEND QUIZZES TABLE WITH TIER DISCRIMINATOR & AUTO-ZERO POLICY
-- ------------------------------------------------------------------------------
ALTER TABLE quizzes 
ADD COLUMN IF NOT EXISTS quiz_type VARCHAR(32) NOT NULL DEFAULT 'SELF_PRACTICE' 
CHECK (quiz_type IN ('SELF_PRACTICE', 'OFFICIAL_TEST'));

ALTER TABLE quizzes 
ADD COLUMN IF NOT EXISTS auto_zero BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE quizzes 
ADD COLUMN IF NOT EXISTS window_open_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE quizzes 
ADD COLUMN IF NOT EXISTS window_close_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_quizzes_type_course 
ON quizzes (course_id, quiz_type, status);

-- ------------------------------------------------------------------------------
-- 2. EXTEND QUIZ_ATTEMPTS WITH PRACTICE FLAG & AUTO-ZERO AUDIT TRAIL
-- ------------------------------------------------------------------------------
ALTER TABLE quiz_attempts 
ADD COLUMN IF NOT EXISTS is_practice BOOLEAN NOT NULL DEFAULT FALSE;

-- Drop obsolete single-attempt constraint if present so practice attempts are unconstrained
ALTER TABLE quiz_attempts 
DROP CONSTRAINT IF EXISTS uq_attempt_student_quiz;

-- Re-establish strict single-attempt invariant ONLY for official summative tests
CREATE UNIQUE INDEX IF NOT EXISTS uq_attempt_student_official_quiz 
ON quiz_attempts (student_id, quiz_id) 
WHERE is_practice = FALSE;

-- Acceleration index for the background auto-zero worker query
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_auto_zero_sweep 
ON quiz_attempts (status, due_at) 
WHERE status = 'IN_PROGRESS';

-- ------------------------------------------------------------------------------
-- 3. SEED COURSE-LEVEL SELF-PRACTICE QUIZZES FOR ACTIVE CATALOG
-- ------------------------------------------------------------------------------
-- Replace old single active quiz constraint so it only restricts OFFICIAL_TEST
DROP INDEX IF EXISTS uq_one_active_quiz_per_course;

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_quiz_per_course 
ON quizzes (course_id) 
WHERE (is_active_for_new_attempts = TRUE AND quiz_type = 'OFFICIAL_TEST');

-- Ensure each primary course has a dedicated SELF_PRACTICE quiz entry
INSERT INTO quizzes (quiz_id, course_id, title, description, duration_minutes, total_points, status, quiz_type, auto_zero, is_active_for_new_attempts)
SELECT 
    'practice_' || LOWER(REPLACE(c.course_id, ' ', '_')),
    c.course_id,
    c.code || ' Self-Practice Assessment',
    'Interactive, untimed practice questions for ' || c.title || '. Non-graded formative review.',
    0, -- 0 indicates untimed practice
    0.00, -- 0 points toward GPA
    'ACTIVE',
    'SELF_PRACTICE',
    FALSE,
    FALSE
FROM courses c
WHERE c.is_active = TRUE
ON CONFLICT (quiz_id) DO UPDATE SET
    quiz_type = 'SELF_PRACTICE',
    auto_zero = FALSE,
    is_active_for_new_attempts = FALSE;

COMMIT;
