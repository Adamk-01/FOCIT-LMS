-- ==============================================================================
-- FOCIT LMS - Phase 21 Quizzes Tier Schema Alignment
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

-- ------------------------------------------------------------------------------
-- 2. BACKFILL EXISTING SUMMATIVE EXAMS TO OFFICIAL_TEST
-- ------------------------------------------------------------------------------
UPDATE quizzes 
SET quiz_type = 'OFFICIAL_TEST' 
WHERE quiz_id NOT LIKE 'practice_%';

-- ------------------------------------------------------------------------------
-- 3. CREATE COMPOSITE LOOKUP INDEX FOR PERFORMANCE
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_quizzes_type_course 
ON quizzes (course_id, quiz_type, status);

COMMIT;

