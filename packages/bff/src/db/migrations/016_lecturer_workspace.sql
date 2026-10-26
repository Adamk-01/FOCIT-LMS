-- ==============================================================================
-- FOCIT LMS - Phase 16: Lecturer Workspace & Class Roster Architecture
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. EXTEND STAFF ROLES CHECK TO INCLUDE LECTURER AND STAFF
-- ------------------------------------------------------------------------------
ALTER TABLE staff_advisors 
DROP CONSTRAINT IF EXISTS staff_advisors_role_check;

ALTER TABLE staff_advisors 
ADD CONSTRAINT staff_advisors_role_check 
CHECK (role IN ('LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADMIN', 'SYSTEM_ADMIN', 'LECTURER', 'STAFF', 'ADVISOR'));

COMMIT;
