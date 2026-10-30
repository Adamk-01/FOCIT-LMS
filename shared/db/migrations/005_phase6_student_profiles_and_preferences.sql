-- ==============================================================================
-- FOCIT LMS - Phase 6 Student Profiles, Preferences & Idempotency Ledger
-- Enforces:
-- 1. Tier 2 & Tier 3 Demographic/Preference Isolation from Tier 1 Academic Ledger
-- 2. Optimistic Concurrency Control (version INT) with Relational Set-Identity Check
-- 3. Ingress Idempotency Store for 3G Connection Dropout Recovery
-- ==============================================================================

BEGIN;

-- 1. Student Profiles Table
CREATE TABLE IF NOT EXISTS student_profiles (
    student_id VARCHAR(64) PRIMARY KEY REFERENCES students(student_id) ON DELETE CASCADE,
    phone_number VARCHAR(32),
    alternate_email VARCHAR(128),
    avatar_url VARCHAR(512),
    bio TEXT,
    residential_address TEXT,
    password_hash VARCHAR(256),
    preferences JSONB NOT NULL DEFAULT '{
        "email_notifications": true,
        "quiz_reminders": true,
        "forum_digest": "daily",
        "sms_alerts": false,
        "theme": "system",
        "compact_tables": false
    }'::jsonb,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_profiles_phone 
ON student_profiles(phone_number) 
WHERE phone_number IS NOT NULL;

-- 2. BFF Ingress Idempotency Records Table
CREATE TABLE IF NOT EXISTS bff_idempotency_records (
    key VARCHAR(128) PRIMARY KEY,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    endpoint VARCHAR(64) NOT NULL,
    status_code INT NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bff_idempotency_student_time 
ON bff_idempotency_records(student_id, created_at DESC);

-- 3. Seed Default Profiles for Seed Students
INSERT INTO student_profiles (student_id, phone_number, alternate_email, avatar_url, bio, residential_address, preferences, version)
SELECT 
    'student1', 
    '+234 803 123 4567', 
    'john.doe.personal@gmail.com', 
    '/api/files/avatars/student1.webp', 
    'Penultimate Computer Science student passionate about distributed systems and cloud architecture.',
    'Hostel Block B, Room 14, Osun State University Main Campus, Osogbo',
    '{
        "email_notifications": true,
        "quiz_reminders": true,
        "forum_digest": "daily",
        "sms_alerts": true,
        "theme": "system",
        "compact_tables": false
    }'::jsonb,
    1
WHERE EXISTS (SELECT 1 FROM students WHERE student_id = 'student1')
ON CONFLICT (student_id) DO NOTHING;

COMMIT;
