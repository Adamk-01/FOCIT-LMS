-- FOCIT LMS - Migration 025: Add updated_at column to staff_advisors
-- Ensures consistency with audit timestamps and administrative password resets.

ALTER TABLE staff_advisors 
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
