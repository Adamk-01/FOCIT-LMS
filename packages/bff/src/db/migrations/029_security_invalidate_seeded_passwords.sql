-- ==============================================================================
-- FOCIT LMS - Migration 029: Invalidate Seed Passwords & Enforce Quarantine (F18)
-- ==============================================================================

BEGIN;

-- 1. Enforce mandatory password change for all pre-seeded student accounts
UPDATE student_profiles
SET must_change_password = TRUE
WHERE student_id IN ('student1', 'student2', 'student3', 'student4', 'student5');

-- 2. Enforce mandatory password change for all pre-seeded administrative and staff accounts
UPDATE staff_advisors
SET must_change_password = TRUE
WHERE advisor_id IN ('admin1', 'advisor1', 'advisor2', 'advisor3', 'hod1', 'lecturer1');

COMMIT;
