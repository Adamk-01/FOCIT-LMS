-- ==============================================================================
-- FOCIT LMS - Phase 12 Timetable GiST Exclusion Constraint & Ingestion Schema
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Enable btree_gist extension for composite scalar + range exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Add generated column minute_range to academic_timetable
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'academic_timetable' AND column_name = 'minute_range'
    ) THEN
        ALTER TABLE academic_timetable 
        ADD COLUMN minute_range int4range 
        GENERATED ALWAYS AS (
            int4range(
                EXTRACT(HOUR FROM start_time)::int * 60 + EXTRACT(MINUTE FROM start_time)::int,
                EXTRACT(HOUR FROM start_time)::int * 60 + EXTRACT(MINUTE FROM start_time)::int + duration_minutes
            )
        ) STORED;
    END IF;
END $$;

-- 3. Add GiST exclusion constraint to prevent overlapping room bookings on the same day
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_timetable_room_slot') THEN
        ALTER TABLE academic_timetable
        ADD CONSTRAINT uq_timetable_room_slot
        EXCLUDE USING gist (
            room_id WITH =,
            day_of_week WITH =,
            minute_range WITH &&
        )
        WHERE (room_id IS NOT NULL);
    END IF;
END $$;

COMMIT;
