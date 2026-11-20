-- ==============================================================================
-- FOCIT LMS - Migration 027: Universal Notification System for Students & Staff
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Drop foreign key constraint referencing students table so staff advisors can also receive notifications
ALTER TABLE student_notifications 
DROP CONSTRAINT IF EXISTS student_notifications_student_id_fkey;

COMMIT;
