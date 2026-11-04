-- ==============================================================================
-- FOCIT LMS - Phase 19: Attendance OTP HMAC Security & Immutable Indices
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Dual-Tiered L2 Persistence Columns for Ephemeral OTP
ALTER TABLE attendance_sessions
  ADD COLUMN IF NOT EXISTS active_otp_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP WITH TIME ZONE;

-- 2. Immutable Partial Index for Active Sessions Lookup
-- Predicate must be IMMUTABLE (SQLSTATE 42P17): cannot use NOW()
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_otp_active
  ON attendance_sessions (course_id, session_id)
  WHERE is_locked = FALSE AND active_otp_hash IS NOT NULL;

-- 3. Composite Index for Microsecond Delta Polling & MVCC Lookback Scans
-- Eliminates sequential heap scans and in-memory sort buffers under concurrent monitor load
CREATE INDEX IF NOT EXISTS idx_attendance_records_session_marked
  ON attendance_records (session_id, marked_at ASC);

COMMIT;
