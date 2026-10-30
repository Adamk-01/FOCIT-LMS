-- ==============================================================================
-- FOCIT LMS - Phase 1 Architectural Database Migrations
-- Tables: announcements, academic_timetable, timetable_exceptions
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. ANNOUNCEMENTS (The SSE Replay Ledger)
-- ------------------------------------------------------------------------------
-- Utilizing BIGSERIAL guarantees a strictly monotonic sequence for the primary key.
-- This is mathematically critical for the SSE EventSource 'Last-Event-ID' catch-up
-- logic to function during network tunnel drops.
CREATE TABLE IF NOT EXISTS announcements (
    id BIGSERIAL PRIMARY KEY,
    course_id INT NOT NULL,
    lecturer_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index explicitly tailored for the SSE Replay catch-up query: 
-- SELECT * FROM announcements WHERE id > ? ORDER BY id ASC
CREATE INDEX IF NOT EXISTS idx_announcements_id_ordered ON announcements (id ASC);
CREATE INDEX IF NOT EXISTS idx_announcements_course_id ON announcements (course_id);

-- ------------------------------------------------------------------------------
-- 2. ACADEMIC TIMETABLE (The RRULE Master Series)
-- ------------------------------------------------------------------------------
-- Eliminates row duplication by representing a 12-week schedule as a single immutable record.
CREATE TABLE IF NOT EXISTS academic_timetable (
    id SERIAL PRIMARY KEY,
    course_id INT NOT NULL,
    lecturer_id INT NOT NULL,
    room_id INT, -- Nullable for virtual classes
    first_occurrence_start TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INT NOT NULL,
    rrule VARCHAR(255) NOT NULL, -- e.g., 'FREQ=WEEKLY;BYDAY=TU,TH;COUNT=24'
    exclusion_dates DATE[] DEFAULT '{}', -- Array of dates for cancelled/moved classes
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timetable_course_id ON academic_timetable (course_id);

-- ------------------------------------------------------------------------------
-- 3. TIMETABLE EXCEPTIONS (The Mutation Binder)
-- ------------------------------------------------------------------------------
-- Handles one-off rescheduled classes without severing the relational link
-- to the original parent syllabus schedule.
CREATE TABLE IF NOT EXISTS timetable_exceptions (
    id SERIAL PRIMARY KEY,
    parent_series_id INT NOT NULL REFERENCES academic_timetable(id) ON DELETE CASCADE,
    original_occurrence_date DATE NOT NULL, -- The exact RRULE instance being mutated
    new_start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    new_duration_minutes INT NOT NULL,
    new_room_id INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Absolute constraint: A specific instance of a parent series can only be mutated once
    CONSTRAINT unique_exception_per_occurrence UNIQUE (parent_series_id, original_occurrence_date)
);

COMMIT;
