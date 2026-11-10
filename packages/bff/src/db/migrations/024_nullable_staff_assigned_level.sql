-- FOCIT LMS - Migration 024: Relax assigned_level constraint on staff_advisors
-- Permitting NULL for staff members (Lecturers, HODs, Admins, Advisors) who are not tied to a single student level.

ALTER TABLE staff_advisors 
    ALTER COLUMN assigned_level DROP NOT NULL;

ALTER TABLE staff_advisors 
    DROP CONSTRAINT IF EXISTS staff_advisors_assigned_level_check;

ALTER TABLE staff_advisors 
    ADD CONSTRAINT staff_advisors_assigned_level_check 
    CHECK (assigned_level IS NULL OR assigned_level IN (100, 200, 300, 400));
