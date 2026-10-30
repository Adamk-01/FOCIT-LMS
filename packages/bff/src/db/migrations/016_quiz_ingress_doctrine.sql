-- ==============================================================================
-- 016_quiz_ingress_doctrine.sql
-- FOCIT LMS - Quiz Ingress & Retake Doctrine Migration
--
-- Implements:
-- 1. Partial Unique Index: uq_quiz_attempt_active_or_sealed
--    Enforces at most ONE active or finalized attempt per (student_id, quiz_id),
--    while allowing attempts marked 'ABANDONED' (via dev/lecturer resets) to be ignored.
-- 2. Stale Seed Data Remediation:
--    Marks 'att_csc204_john' as 'ABANDONED' so student1 can immediately initiate a
--    clean, live assessment attempt.
--
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

-- Drop the previous non-partial table constraint if present
ALTER TABLE quiz_attempts DROP CONSTRAINT IF EXISTS uq_attempt_student_quiz;

-- Drop obsolete index if present
DROP INDEX IF EXISTS idx_quiz_attempts_student;

-- Create partial unique index covering all active and finalized attempts
CREATE UNIQUE INDEX IF NOT EXISTS uq_quiz_attempt_active_or_sealed 
ON quiz_attempts (student_id, quiz_id) 
WHERE status != 'ABANDONED';

-- Fast student-course attempt lookup index
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student_quiz 
ON quiz_attempts (student_id, quiz_id);

-- Clean up the stale seed attempt row so dev environments unblock immediately
UPDATE quiz_attempts 
SET status = 'ABANDONED', 
    submitted_at = NOW(),
    submission_mode = 'DEV_RESET_CLEANUP'
WHERE attempt_id = 'att_csc204_john';

