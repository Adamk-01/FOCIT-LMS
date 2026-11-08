-- ==============================================================================
-- FOCIT LMS - Phase 20: Ephemeral Passcode Ingress Lease & Lockout Circuit Breaker
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Ingress Lease & Circuit Breaker Tracking Columns
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_ticket_id UUID,
  ADD COLUMN IF NOT EXISTS active_ticket_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS ticket_opened_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS is_locked_out BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS locked_out_at TIMESTAMP WITH TIME ZONE;

-- 2. Partial Index for Active Lease Resolution & Sweep
CREATE INDEX IF NOT EXISTS idx_attendance_records_active_ticket
  ON attendance_records (session_id, student_id, active_ticket_id)
  WHERE active_ticket_id IS NOT NULL;

-- 3. Partial Index for Fast Student Lockout Lookups
CREATE INDEX IF NOT EXISTS idx_attendance_records_lockout
  ON attendance_records (session_id, student_id)
  WHERE is_locked_out = TRUE;

COMMIT;

