-- ==============================================================================
-- Migration 024: Student Portal Self-Service Activation Engine
-- Standard: Senate Matriculation Standard YYYY/NNNNN & One-Time Activation Lock
-- ==============================================================================

ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS is_activated BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE;
