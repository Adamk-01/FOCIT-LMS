-- ==============================================================================
-- FOCIT LMS - Migration 028: Course-Level Lecturer Registration Approvals
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Create Course Item Approval Status Enumeration
DO $$ BEGIN
    CREATE TYPE course_item_status AS ENUM (
        'PENDING_LECTURER',
        'APPROVED',
        'REJECTED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Extend course_registration_items with granular lecturer approval columns
ALTER TABLE course_registration_items
  ADD COLUMN IF NOT EXISTS status course_item_status NOT NULL DEFAULT 'PENDING_LECTURER',
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(64) REFERENCES staff_advisors(advisor_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS rejected_by VARCHAR(64) REFERENCES staff_advisors(advisor_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- 3. Composite Index for fast Lecturer Queue seeks
CREATE INDEX IF NOT EXISTS idx_reg_items_lecturer_queue
  ON course_registration_items (course_id, status, created_at ASC);

-- 4. Extend enrollments table to track approving lecturer
ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS approved_by_lecturer_id VARCHAR(64) REFERENCES staff_advisors(advisor_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_notes TEXT;

-- 5. Backfill existing enrollments that are already active to APPROVED
UPDATE course_registration_items cri
SET status = 'APPROVED', approved_at = cri.created_at
FROM course_registration_batches b
WHERE b.id = cri.batch_id
  AND b.status IN ('ADVISOR_APPROVED', 'HOD_CLEARED', 'SENATE_CONFIRMED');

COMMIT;
