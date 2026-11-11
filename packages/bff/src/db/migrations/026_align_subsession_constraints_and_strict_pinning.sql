-- ==============================================================================
-- FOCIT LMS - Phase 26: Sub-Session Constraint Alignment & Strict Key Pinning
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Align sub_session constraint on attendance_sessions (1-6) with courses.sessions_per_week
ALTER TABLE attendance_sessions
  DROP CONSTRAINT IF EXISTS attendance_sessions_sub_session_check;

ALTER TABLE attendance_sessions
  DROP CONSTRAINT IF EXISTS chk_attendance_sessions_sub_session;

ALTER TABLE attendance_sessions
  ADD CONSTRAINT chk_attendance_sessions_sub_session
  CHECK (sub_session >= 1 AND sub_session <= 6);

-- 2. Scoped trigger function to enforce sub_session <= courses.sessions_per_week
-- Uses FOR KEY SHARE on courses to serialize against frequency updates without deadlocking
CREATE OR REPLACE FUNCTION validate_session_subslot_bounds()
RETURNS TRIGGER AS $$
DECLARE
  v_max_slots INT;
BEGIN
  SELECT sessions_per_week INTO v_max_slots
  FROM courses
  WHERE course_id = NEW.course_id
  FOR KEY SHARE;

  IF v_max_slots IS NOT NULL AND NEW.sub_session > v_max_slots THEN
    RAISE EXCEPTION 'Sub-session index % exceeds configured course session frequency % for course %',
      NEW.sub_session, v_max_slots, NEW.course_id
      USING ERRCODE = '23514'; -- check_violation
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Scope trigger strictly to mutations of sub_session and course_id
-- Prevents locking historical sessions (is_locked = TRUE) from failing if sessions_per_week was reduced
DROP TRIGGER IF EXISTS trg_validate_session_subslot_bounds ON attendance_sessions;

CREATE TRIGGER trg_validate_session_subslot_bounds
BEFORE INSERT OR UPDATE OF sub_session, course_id
ON attendance_sessions
FOR EACH ROW
EXECUTE FUNCTION validate_session_subslot_bounds();

COMMIT;

