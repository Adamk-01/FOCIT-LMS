-- ==============================================================================
-- FOCIT LMS - MIGRATION 014: PHASE 11A ASSIGNMENT HARDENING & SUBMISSION GUARANTEES
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Ensure idempotency_key column exists with proper constraints
ALTER TABLE student_assignment_submissions 
ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

-- 2. Add compound index for high-speed idempotency lookups
CREATE INDEX IF NOT EXISTS idx_submissions_student_idempotency 
ON student_assignment_submissions (student_id, idempotency_key);

-- 3. Verify and reinforce unique constraint on (assignment_id, student_id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uq_student_assignment'
    ) THEN
        ALTER TABLE student_assignment_submissions 
        ADD CONSTRAINT uq_student_assignment UNIQUE (assignment_id, student_id);
    END IF;
END $$;

COMMIT;
