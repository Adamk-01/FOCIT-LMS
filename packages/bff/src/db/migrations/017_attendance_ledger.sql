-- ==============================================================================
-- FOCIT LMS - Phase 17: Hybrid Attendance Ledger & Sheet Scan Verification Schema
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. COURSE REPRESENTATIVES APPOINTMENTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_representatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    semester_id VARCHAR(32) NOT NULL REFERENCES academic_semesters(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    appointed_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_course_rep_semester UNIQUE (course_id, semester_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_course_rep_student 
ON course_representatives (student_id, semester_id);

-- ------------------------------------------------------------------------------
-- 2. ATTENDANCE SESSIONS TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    semester_id VARCHAR(32) NOT NULL REFERENCES academic_semesters(id) ON DELETE RESTRICT,
    week_number INT NOT NULL CHECK (week_number >= 1 AND week_number <= 15),
    session_date DATE NOT NULL DEFAULT CURRENT_DATE,
    session_mode VARCHAR(32) NOT NULL DEFAULT 'SHEET_SCAN'
        CHECK (session_mode IN ('ROLL_CALL', 'CODE_OTP', 'SHEET_SCAN', 'REP_DIRECT')),
    created_by VARCHAR(64) NOT NULL,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    locked_by VARCHAR(64),
    locked_at TIMESTAMP WITH TIME ZONE,
    sheet_image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_extracted_text TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_course_week_semester UNIQUE (course_id, semester_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_lookup 
ON attendance_sessions (course_id, semester_id, week_number);

-- ------------------------------------------------------------------------------
-- 3. ATTENDANCE INDIVIDUAL STUDENT RECORDS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES attendance_sessions(session_id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'ABSENT' 
        CHECK (status IN ('PRESENT', 'ABSENT', 'EXCUSED')),
    verification_method VARCHAR(32) NOT NULL DEFAULT 'SHEET_SCAN'
        CHECK (verification_method IN ('ROLL_CALL', 'CODE_OTP', 'SHEET_SCAN', 'MANUAL_OVERRIDE')),
    confidence_score NUMERIC(4, 3) DEFAULT 1.000,
    marked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_session_student_attendance UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_student 
ON attendance_records (student_id, session_id, status);

-- ------------------------------------------------------------------------------
-- 4. SEED SAMPLE COURSE REP FOR CSC204
-- ------------------------------------------------------------------------------
INSERT INTO course_representatives (course_id, semester_id, student_id, appointed_by)
SELECT 'CSC204', s.id, 'student1', 'lecturer1'
FROM academic_semesters s
WHERE s.is_registration_open = TRUE
LIMIT 1
ON CONFLICT (course_id, semester_id, student_id) DO NOTHING;

COMMIT;
