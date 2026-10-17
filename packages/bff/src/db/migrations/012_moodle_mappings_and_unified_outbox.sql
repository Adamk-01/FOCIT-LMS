-- ==============================================================================
-- FOCIT LMS - Phase 11 Moodle Identity Mappings & Unified Integration Outbox
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. MOODLE USER MAPPINGS (FOCIT User UUID <-> Moodle User ID)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moodle_user_mappings (
    focit_user_id VARCHAR(64) PRIMARY KEY REFERENCES students(student_id) ON DELETE CASCADE,
    moodle_user_id INT NOT NULL UNIQUE,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('PENDING', 'SYNCED', 'FAILED')),
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moodle_user_mappings_status 
ON moodle_user_mappings (sync_status);

-- ------------------------------------------------------------------------------
-- 2. MOODLE COURSE MAPPINGS (FOCIT Course Offering <-> Moodle Course ID)
-- ------------------------------------------------------------------------------
DROP TABLE IF EXISTS moodle_course_mappings CASCADE;

CREATE TABLE moodle_course_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    focit_course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    semester_id VARCHAR(32) NOT NULL REFERENCES academic_semesters(id) ON DELETE CASCADE,
    moodle_course_id INT NOT NULL,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('PENDING', 'SYNCED', 'FAILED')),
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_course_semester_mapping UNIQUE (focit_course_id, semester_id)
);

CREATE INDEX IF NOT EXISTS idx_moodle_course_mappings_status 
ON moodle_course_mappings (sync_status);

CREATE INDEX IF NOT EXISTS idx_moodle_course_mappings_lookup 
ON moodle_course_mappings (focit_course_id, semester_id);

-- ------------------------------------------------------------------------------
-- 3. UNIFIED INTEGRATION OUTBOX EVENTS (Consolidates outbox_events & moodle_outbox)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_outbox_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL, -- 'STUDENT', 'COURSE_REGISTRATION', 'QUIZ_SUBMISSION', 'STUDENT_PROFILE'
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,     -- 'USER_PROVISION_REQUESTED', 'ENROLLMENT_SYNC', 'ACTIVITY_COMPLETED', 'PROFILE_SYNC'
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    delivery_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMP WITH TIME ZONE,
    worker_id VARCHAR(64),
    idempotency_key VARCHAR(128) UNIQUE,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure last_error exists if table was already created
ALTER TABLE integration_outbox_events ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_integration_outbox_sweep 
ON integration_outbox_events (created_at) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_integration_outbox_lease 
ON integration_outbox_events (status, locked_until) WHERE status = 'PROCESSING';

-- ------------------------------------------------------------------------------
-- 4. HARD RELATIONAL CONSTRAINTS & TIMETABLE SCHEMA ALIGNMENT
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    -- Align academic_timetable course_id to VARCHAR(32) matching courses(course_id)
    ALTER TABLE academic_timetable ALTER COLUMN course_id TYPE VARCHAR(32);

    -- Add day_of_week and start_time columns if they don't exist
    ALTER TABLE academic_timetable ADD COLUMN IF NOT EXISTS day_of_week INT CHECK (day_of_week >= 0 AND day_of_week <= 6);
    ALTER TABLE academic_timetable ADD COLUMN IF NOT EXISTS start_time TIME;

    -- Check course units [1, 6]
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_course_units') THEN
        ALTER TABLE courses ADD CONSTRAINT chk_course_units CHECK (units >= 1 AND units <= 6);
    END IF;

    -- Check course level [100, 200, 300, 400]
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_course_level') THEN
        ALTER TABLE courses ADD CONSTRAINT chk_course_level CHECK (level IN (100, 200, 300, 400));
    END IF;

    -- Check semester number [1, 2]
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_course_semester') THEN
        ALTER TABLE courses ADD CONSTRAINT chk_course_semester CHECK (semester_number IN (1, 2));
    END IF;

    -- Check timetable duration [30, 240 minutes]
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_timetable_duration') THEN
        ALTER TABLE academic_timetable ADD CONSTRAINT chk_timetable_duration CHECK (duration_minutes >= 30 AND duration_minutes <= 240);
    END IF;
END $$;


-- ------------------------------------------------------------------------------
-- 5. SEED INITIAL USER & COURSE MAPPINGS
-- ------------------------------------------------------------------------------
-- Seed initial mappings for test students
INSERT INTO moodle_user_mappings (focit_user_id, moodle_user_id, sync_status)
VALUES
    ('student1', 1, 'SYNCED'),
    ('student2', 2, 'SYNCED'),
    ('student3', 3, 'SYNCED'),
    ('student4', 4, 'SYNCED'),
    ('student5', 5, 'SYNCED')
ON CONFLICT (focit_user_id) DO NOTHING;

-- Seed initial mappings for courses with an existing moodle_course_id
INSERT INTO moodle_course_mappings (focit_course_id, semester_id, moodle_course_id, sync_status)
SELECT c.course_id, COALESCE(s.id, '2026_RAIN'), c.moodle_course_id, 'SYNCED'
FROM courses c
CROSS JOIN (
    SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1
) s
WHERE c.moodle_course_id IS NOT NULL
ON CONFLICT (focit_course_id, semester_id) DO UPDATE SET moodle_course_id = EXCLUDED.moodle_course_id;

-- Seed initial academic timetable entries
INSERT INTO academic_timetable (
    course_id, lecturer_id, room_id, first_occurrence_start, duration_minutes, rrule, day_of_week, start_time
)
SELECT 'CSC204', 1, 101, NOW(), 90, 'FREQ=WEEKLY;BYDAY=TH;COUNT=14', EXTRACT(DOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos'))::int, '23:59:00'::time
WHERE NOT EXISTS (SELECT 1 FROM academic_timetable WHERE course_id = 'CSC204');

COMMIT;

