-- ==============================================================================
-- FOCIT LMS - Phase 10 Academic Catalog Relational Integrity & Zero-Sort Indexes
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. COMPOSITE CATALOG UNIQUE CONSTRAINT
-- ------------------------------------------------------------------------------
-- Creates a composite B-Tree index on courses (course_id, code) allowing it
-- to serve as the target for composite foreign key validation.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_courses_id_code'
    ) THEN
        ALTER TABLE courses ADD CONSTRAINT uq_courses_id_code UNIQUE (course_id, code);
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. DENORMALIZE COURSE_CODE INTO ENROLLMENTS
-- ------------------------------------------------------------------------------
ALTER TABLE enrollments 
ADD COLUMN IF NOT EXISTS course_code VARCHAR(16);

-- Backfill existing enrollments from authoritative courses catalog
UPDATE enrollments e
SET course_code = c.code
FROM courses c
WHERE e.course_id = c.course_id AND e.course_code IS NULL;

-- Guarantee non-nullability once backfilled
ALTER TABLE enrollments 
ALTER COLUMN course_code SET NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. THE RELATIONAL INTEGRITY ANCHOR: COMPOSITE FOREIGN KEY
-- ------------------------------------------------------------------------------
-- Mathematically prevents data drift: any insert or update on enrollments
-- MUST have a (course_id, course_code) pairing that exists identically in courses.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_enrollments_course_id_code'
    ) THEN
        ALTER TABLE enrollments 
        ADD CONSTRAINT fk_enrollments_course_id_code 
        FOREIGN KEY (course_id, course_code) 
        REFERENCES courses (course_id, code) 
        ON UPDATE CASCADE 
        ON DELETE RESTRICT;
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. THE ZERO-SORT PIPELINED CATALOG INDEXES
-- ------------------------------------------------------------------------------
-- Index A: Status-filtered queries (e.g., status = 'COMPLETED' or 'IN_PROGRESS')
CREATE INDEX IF NOT EXISTS idx_enrollments_student_status_code_cursor 
ON enrollments (student_id, status, course_code ASC, course_id ASC)
INCLUDE (progress_percent, grade, enrollment_id);

-- Index B: Unfiltered queries (All courses for student across transcript)
CREATE INDEX IF NOT EXISTS idx_enrollments_student_code_cursor 
ON enrollments (student_id, course_code ASC, course_id ASC)
INCLUDE (status, progress_percent, grade, enrollment_id);

COMMIT;
