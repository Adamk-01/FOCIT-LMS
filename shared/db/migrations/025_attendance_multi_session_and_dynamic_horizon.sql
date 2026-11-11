-- ==============================================================================
-- FOCIT LMS - Phase 25: Multi-Session Sub-Slots & Dynamic Horizon Telemetry
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Add course session frequency & planned semester contact totals
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS sessions_per_week INT NOT NULL DEFAULT 1 
    CHECK (sessions_per_week >= 1 AND sessions_per_week <= 6),
  ADD COLUMN IF NOT EXISTS total_planned_sessions INT NOT NULL DEFAULT 15 
    CHECK (total_planned_sessions >= 1);

-- 2. Add sub-session slot (1-4) to attendance_sessions
ALTER TABLE attendance_sessions
  ADD COLUMN IF NOT EXISTS sub_session INT NOT NULL DEFAULT 1 
    CHECK (sub_session >= 1 AND sub_session <= 4);

-- 3. Replace single-session-per-week constraint with sub-session composite constraint
ALTER TABLE attendance_sessions
  DROP CONSTRAINT IF EXISTS uq_course_week_semester;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_course_week_subsession_semester'
  ) THEN
    ALTER TABLE attendance_sessions
      ADD CONSTRAINT uq_course_week_subsession_semester
      UNIQUE (course_id, semester_id, week_number, sub_session);
  END IF;
END $$;

-- 4. Update index for fast lookup including sub_session
DROP INDEX IF EXISTS idx_attendance_sessions_lookup;
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_lookup 
ON attendance_sessions (course_id, semester_id, week_number, sub_session);

COMMIT;

