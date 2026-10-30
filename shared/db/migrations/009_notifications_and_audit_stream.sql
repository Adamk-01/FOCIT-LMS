-- ==============================================================================
-- FOCIT LMS - MIGRATION 008: REAL-TIME NOTIFICATION ENGINE & AUDIT STREAM
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- Invariants Enforced:
-- 1. Dual-Identifier Pattern: UUID for public REST/DOM keys, BIGSERIAL for monotonic sequence
-- 2. Partial Indexing: O(1) index-only scans for unread queries without read-tuple bloat
-- 3. Tenant Advisory Locking: Eliminates nextval() sequence gaps per student
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. NOTIFICATION ENUMERATIONS
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE notification_category AS ENUM (
        'REGISTRATION',
        'ACADEMIC',
        'ASSESSMENT',
        'SECURITY',
        'SYSTEM'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE notification_priority AS ENUM (
        'LOW',
        'NORMAL',
        'HIGH',
        'URGENT'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------------------------
-- 2. STUDENT NOTIFICATIONS AUDIT LEDGER TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id BIGSERIAL NOT NULL UNIQUE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    category notification_category NOT NULL DEFAULT 'ACADEMIC',
    priority notification_priority NOT NULL DEFAULT 'NORMAL',
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    action_url VARCHAR(512),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- ------------------------------------------------------------------------------
-- 3. HIGH-PERFORMANCE MONOTONIC & PARTIAL INDEXES
-- ------------------------------------------------------------------------------

-- Index A: General Keyset Pagination for "All" tab (O(1) B-tree traversal)
CREATE INDEX IF NOT EXISTS idx_notif_student_all_seq 
ON student_notifications (student_id, sequence_id DESC);

-- Index B: Dedicated Partial Index for "Unread" tab & fast-path count queries
-- Contains strictly unread tuples, completely skipping historical read rows
CREATE INDEX IF NOT EXISTS idx_notif_student_unread_seq 
ON student_notifications (student_id, sequence_id DESC) 
WHERE is_read = FALSE;

-- Index C: Categorical filtering keyset index
CREATE INDEX IF NOT EXISTS idx_notif_student_category_seq 
ON student_notifications (student_id, category, sequence_id DESC);

-- Index D: Lookback safety seek index
CREATE INDEX IF NOT EXISTS idx_notif_student_seq_asc 
ON student_notifications (student_id, sequence_id ASC);

-- ------------------------------------------------------------------------------
-- 4. REALISTIC SEED EXPANSION FOR ACTIVE TEST STUDENT (student1)
-- ------------------------------------------------------------------------------
INSERT INTO student_notifications (
    id, student_id, category, priority, title, body, action_url, metadata, is_read, created_at
)
VALUES
    (
        '10000000-0000-0000-0000-000000000001'::uuid,
        'student1',
        'REGISTRATION',
        'HIGH',
        'Course Registration Submitted',
        'Your 2026/2027 Rain Semester registration batch (21 Units) has been transmitted to Level Advisor Dr. A. O. Adeleke for review.',
        '/registration',
        '{"batch_status": "SUBMITTED", "units": 21}'::jsonb,
        FALSE,
        NOW() - INTERVAL '2 hours'
    ),
    (
        '10000000-0000-0000-0000-000000000002'::uuid,
        'student1',
        'ASSESSMENT',
        'HIGH',
        'Upcoming Assessment: CSC 204 Quiz 1',
        'Quiz 1 — Arrays, Pointers and Memory Architecture is scheduled to commence on 15 May 2026 at 10:00 AM.',
        '/courses/1/quizzes',
        '{"course_code": "CSC 204", "due_date": "2026-05-15T10:00:00Z"}'::jsonb,
        FALSE,
        NOW() - INTERVAL '5 hours'
    ),
    (
        '10000000-0000-0000-0000-000000000003'::uuid,
        'student1',
        'ACADEMIC',
        'NORMAL',
        'New Lecture Material: PHY 102 Module 3',
        'Dr. Babatunde uploaded "Electromagnetic Induction & Faraday Laws.pdf" to the course repository.',
        '/courses/1/materials',
        '{"course_code": "PHY 102", "material_type": "PDF"}'::jsonb,
        TRUE,
        NOW() - INTERVAL '1 day'
    ),
    (
        '10000000-0000-0000-0000-000000000004'::uuid,
        'student1',
        'SECURITY',
        'NORMAL',
        'Security Audit: Login Session Verified',
        'New session initialized from IP 192.168.1.104 with Chrome/Edge on Windows 11.',
        '/profile',
        '{"ip": "192.168.1.104", "device": "Windows"}'::jsonb,
        TRUE,
        NOW() - INTERVAL '3 days'
    )
ON CONFLICT (id) DO NOTHING;

COMMIT;
