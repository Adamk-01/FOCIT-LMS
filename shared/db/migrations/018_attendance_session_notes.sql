-- ==============================================================================
-- FOCIT LMS - Phase 18: Attendance Session Remarks / Hall Notes
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

ALTER TABLE attendance_sessions 
ADD COLUMN IF NOT EXISTS notes TEXT;

COMMIT;
