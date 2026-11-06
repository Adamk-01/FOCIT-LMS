-- ==============================================================================
-- FOCIT LMS - Phase 22 Multi-Lecturer Course Allocation Schema
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. ADD ROLE CLASSIFICATION COLUMN (PRIMARY VS SECONDARY / CO-LECTURER)
-- ------------------------------------------------------------------------------
ALTER TABLE hod_course_allocations 
ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT TRUE;

-- Remove temporary DEFAULT TRUE after backfill so future co-lecturer allocations do not default to primary
ALTER TABLE hod_course_allocations 
ALTER COLUMN is_primary DROP DEFAULT;

-- ------------------------------------------------------------------------------
-- 2. DROP LEGACY SINGLE-LECTURER UNIQUE CONSTRAINT
-- ------------------------------------------------------------------------------
ALTER TABLE hod_course_allocations 
DROP CONSTRAINT IF EXISTS uq_hod_alloc_course_semester;

-- ------------------------------------------------------------------------------
-- 3. PERMIT MULTIPLE CO-LECTURERS (UNIQUE PER LECTURER PER COURSE PER SEMESTER)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'uq_hod_alloc_course_lecturer_semester'
    ) THEN
        ALTER TABLE hod_course_allocations 
        ADD CONSTRAINT uq_hod_alloc_course_lecturer_semester 
        UNIQUE (course_id, semester_id, lecturer_id);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. BUSINESS RULE: STRICTLY ONE PRIMARY LECTURER PER COURSE PER SEMESTER
-- ------------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_hod_alloc_single_primary_per_semester 
ON hod_course_allocations (course_id, semester_id) 
WHERE is_primary = TRUE;

-- ------------------------------------------------------------------------------
-- 5. PERFORMANCE LOOKUP INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_hod_alloc_course_sem 
ON hod_course_allocations (course_id, semester_id);

CREATE INDEX IF NOT EXISTS idx_hod_alloc_lecturer 
ON hod_course_allocations (lecturer_id, semester_id);

COMMIT;
