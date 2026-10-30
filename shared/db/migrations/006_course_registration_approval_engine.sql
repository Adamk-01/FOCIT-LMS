-- ==============================================================================
-- FOCIT LMS - MIGRATION 006: COURSE REGISTRATION APPROVAL & CLEARANCE ENGINE
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. REGISTRATION BATCH STATUS ENUMERATION
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE registration_batch_status AS ENUM (
        'DRAFT',
        'SUBMITTED',
        'ADVISOR_APPROVED',
        'HOD_CLEARED',
        'SENATE_CONFIRMED',
        'REJECTED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------------------------
-- 2. STAFF ADVISORS & FACULTY OFFICERS (Academic Governance Identities)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_advisors (
    advisor_id VARCHAR(64) PRIMARY KEY,
    staff_number VARCHAR(32) NOT NULL UNIQUE,
    full_name VARCHAR(128) NOT NULL,
    email VARCHAR(128) NOT NULL UNIQUE,
    department_id VARCHAR(32) NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    assigned_level INT NOT NULL CHECK (assigned_level IN (100, 200, 300, 400)),
    role VARCHAR(32) NOT NULL DEFAULT 'LEVEL_ADVISOR' CHECK (role IN ('LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_advisors_lookup 
ON staff_advisors (department_id, assigned_level, role);

-- ------------------------------------------------------------------------------
-- 3. COURSE REGISTRATION BATCHES (The Governance State Plane)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_registration_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    semester_id VARCHAR(32) NOT NULL REFERENCES academic_semesters(id) ON DELETE RESTRICT,
    status registration_batch_status NOT NULL DEFAULT 'DRAFT',
    total_units INT NOT NULL DEFAULT 0 CHECK (total_units >= 0 AND total_units <= 30),
    dean_waiver BOOLEAN NOT NULL DEFAULT FALSE,
    dean_waiver_reason TEXT,
    
    -- Actor Signatures & Timestamps
    submitted_at TIMESTAMP WITH TIME ZONE,
    advisor_id VARCHAR(64),
    advisor_approved_at TIMESTAMP WITH TIME ZONE,
    hod_id VARCHAR(64),
    hod_cleared_at TIMESTAMP WITH TIME ZONE,
    senate_id VARCHAR(64),
    senate_confirmed_at TIMESTAMP WITH TIME ZONE,
    
    -- Rejection Metadata
    rejection_remarks TEXT,
    rejected_by VARCHAR(64),
    rejected_at TIMESTAMP WITH TIME ZONE,
    
    -- Optimistic Concurrency Control
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Invariant: Exactly one active registration batch per student per semester
    CONSTRAINT uq_student_semester_batch UNIQUE (student_id, semester_id)
);

CREATE INDEX IF NOT EXISTS idx_reg_batches_advisor_lookup 
ON course_registration_batches (status, semester_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reg_batches_student_term 
ON course_registration_batches (student_id, semester_id);

-- ------------------------------------------------------------------------------
-- 4. COURSE REGISTRATION ITEMS (The Staged Course Selection Set)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_registration_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES course_registration_batches(id) ON DELETE CASCADE,
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
    units INT NOT NULL CHECK (units >= 1 AND units <= 6),
    category VARCHAR(16) NOT NULL CHECK (category IN ('CORE', 'ELECTIVE', 'GENERAL')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Invariant: No duplicate courses within a registration batch
    CONSTRAINT uq_batch_course UNIQUE (batch_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_reg_items_batch 
ON course_registration_items (batch_id);

CREATE INDEX IF NOT EXISTS idx_reg_items_course 
ON course_registration_items (course_id);

-- ------------------------------------------------------------------------------
-- 5. COURSE REGISTRATION AUDIT LOGS (Immutable Senate Audit Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_registration_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES course_registration_batches(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL, -- 'DRAFT_SAVED', 'SUBMITTED', 'ADVISOR_APPROVED', 'REJECTED', etc.
    previous_status registration_batch_status,
    new_status registration_batch_status NOT NULL,
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_audit_batch 
ON course_registration_audit_logs (batch_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_reg_audit_student 
ON course_registration_audit_logs (student_id, created_at DESC);

-- ==============================================================================
-- 6. REALISTIC ACADEMIC SEED EXPANSION (Phase 7 Multi-Level Test Conditions)
-- ==============================================================================

-- A. Additional Realistic Courses Across Levels (Rain Semester 2026)
INSERT INTO courses (
    course_id, code, title, department_id, level, semester_number, units, category, max_capacity, enrolled_count, moodle_course_id, description
)
VALUES
    -- 100 Level Rain Semester
    ('CSC102', 'CSC 102', 'Introduction to Problem Solving & Algorithms', 'CSC', 100, 2, 3, 'CORE', 200, 110, 18, 'Algorithmic paradigms, pseudocode, recursion, sorting and searching techniques in modern C.'),
    ('MTH102', 'MTH 102', 'Calculus II & Analytical Geometry', 'CSC', 100, 2, 3, 'CORE', 200, 140, 19, 'Integration techniques, improper integrals, sequences, series, polar coordinates, conic sections.'),
    ('PHY102', 'PHY 102', 'General Physics II (Electricity & Magnetism)', 'CSC', 100, 2, 3, 'CORE', 200, 130, 20, 'Electrostatics, Gauss law, magnetic fields, Ampere law, electromagnetic induction and alternating currents.'),
    
    -- 200 Level Additional Elective & Cross-Departmental
    ('CYS204', 'CYS 204', 'Defensive Cyber Architecture & Firewalls', 'CYS', 200, 2, 3, 'CORE', 80, 42, 21, 'Perimeter defense, packet filtering, DMZ architectures, stateful firewalls, intrusion detection.'),
    
    -- 300 Level Rain Semester
    ('CSC306', 'CSC 306', 'Web Application Architectures & Cloud APIs', 'CSC', 300, 2, 3, 'ELECTIVE', 100, 65, 22, 'RESTful services, event-driven backends, asynchronous I/O, WebSockets, client-side frameworks.'),
    
    -- 400 Level Rain Semester (Critical for ACADEMIC_LEVEL_CEILING_BREACH tests)
    ('CSC404', 'CSC 404', 'Compiler Construction & Syntax Analysis', 'CSC', 400, 2, 3, 'CORE', 75, 48, 23, 'Lexical analysis, top-down and bottom-up parsing, intermediate code representation, code generation.'),
    ('CSC406', 'CSC 406', 'Human-Computer Interaction & Accessibility', 'CSC', 400, 2, 3, 'ELECTIVE', 75, 52, 24, 'Heuristic evaluation, WCAG compliance, user experience testing, zero-trust interface designs.')
ON CONFLICT (course_id) DO UPDATE SET 
    title = EXCLUDED.title,
    units = EXCLUDED.units,
    category = EXCLUDED.category,
    max_capacity = EXCLUDED.max_capacity,
    enrolled_count = EXCLUDED.enrolled_count;

-- B. Mock Students with Varying Academic Levels & Departments
INSERT INTO students (
    student_id, matric_number, username, full_name, email, programme_id, level, current_gpa, completed_units
)
VALUES
    -- student2: Freshman 100 Level
    ('student2', 'FOCIT/2025/0104', 'student2', 'Jane Smith', 'jane.smith@focit.uniosun.edu.ng', 'BSC_CSC', 100, 4.10, 18),
    -- student3: Penultimate 300 Level
    ('student3', 'FOCIT/2023/0088', 'student3', 'Babatunde Adeleke', 'b.adeleke@focit.uniosun.edu.ng', 'BSC_CSC', 300, 3.45, 78),
    -- student4: Final Year 400 Level (Graduating Senior)
    ('student4', 'FOCIT/2022/0019', 'student4', 'Chioma Okonkwo', 'c.okonkwo@focit.uniosun.edu.ng', 'BSC_CSC', 400, 4.72, 114),
    -- student5: 200 Level Cyber Security (Cross-Department testing)
    ('student5', 'FOCIT/2024/0155', 'student5', 'Aminu Garba', 'a.garba@focit.uniosun.edu.ng', 'BSC_CYS', 200, 3.20, 39)
ON CONFLICT (student_id) DO UPDATE SET 
    full_name = EXCLUDED.full_name,
    level = EXCLUDED.level,
    current_gpa = EXCLUDED.current_gpa,
    completed_units = EXCLUDED.completed_units;

-- C. Seed Profiles for New Students
INSERT INTO student_profiles (
    student_id, phone_number, alternate_email, avatar_url, bio, residential_address, preferences, version
)
VALUES
    ('student2', '+234 802 987 6543', 'jane.smith.personal@gmail.com', '/api/files/avatars/student2.webp', '100L Freshman passionate about algorithmic thinking.', 'Hostel Block A, Room 05, Osun State University, Osogbo', '{"email_notifications": true, "theme": "system"}'::jsonb, 1),
    ('student3', '+234 805 111 2233', 'babatunde.a@yahoo.com', '/api/files/avatars/student3.webp', '300L student researcher in distributed consensus.', 'University Gardens, Suite 12, Osogbo', '{"email_notifications": true, "theme": "dark"}'::jsonb, 1),
    ('student4', '+234 807 444 5566', 'chioma.o@outlook.com', '/api/files/avatars/student4.webp', '400L First Class Honours candidate and software architect.', 'Hostel Block C, Room 22, Osogbo', '{"email_notifications": true, "theme": "system"}'::jsonb, 1),
    ('student5', '+234 809 777 8899', 'aminu.g@gmail.com', '/api/files/avatars/student5.webp', '200L Cyber Security analyst and reverse engineering enthusiast.', 'College Road, No 14, Osogbo', '{"email_notifications": true, "theme": "dark"}'::jsonb, 1)
ON CONFLICT (student_id) DO NOTHING;

-- D. Staff Advisors & Department Officers
INSERT INTO staff_advisors (
    advisor_id, staff_number, full_name, email, department_id, assigned_level, role
)
VALUES
    ('advisor1', 'FOCIT/STF/2018/014', 'Dr. Folashade Ayanwale', 'f.ayanwale@focit.uniosun.edu.ng', 'CSC', 200, 'LEVEL_ADVISOR'),
    ('advisor2', 'FOCIT/STF/2020/032', 'Dr. Emmanuel Olaniyi', 'e.olaniyi@focit.uniosun.edu.ng', 'CSC', 100, 'LEVEL_ADVISOR'),
    ('advisor3', 'FOCIT/STF/2019/021', 'Dr. Adeola Durojaiye', 'a.durojaiye@focit.uniosun.edu.ng', 'CSC', 300, 'LEVEL_ADVISOR'),
    ('hod1', 'FOCIT/STF/2012/003', 'Prof. Kehinde Adegboye', 'k.adegboye@focit.uniosun.edu.ng', 'CSC', 400, 'HOD')
ON CONFLICT (advisor_id) DO UPDATE SET 
    full_name = EXCLUDED.full_name,
    role = EXCLUDED.role;

-- E. Initial Registration Batches for Cohort Testing
-- 1. student1: Clean DRAFT in 2026_RAIN ready for student registration testing
INSERT INTO course_registration_batches (
    id, student_id, semester_id, status, total_units, version
)
VALUES (
    'b0000000-0000-0000-0000-000000000001'::uuid,
    'student1',
    '2026_RAIN',
    'DRAFT',
    0,
    1
)
ON CONFLICT (student_id, semester_id) DO UPDATE SET 
    status = EXCLUDED.status,
    total_units = EXCLUDED.total_units;

-- 2. student2 (100L): Pre-seeded in SUBMITTED state (15 units) for advisor2 approval test
INSERT INTO course_registration_batches (
    id, student_id, semester_id, status, total_units, submitted_at, version
)
VALUES (
    'b0000000-0000-0000-0000-000000000002'::uuid,
    'student2',
    '2026_RAIN',
    'SUBMITTED',
    15,
    NOW() - INTERVAL '2 hours',
    1
)
ON CONFLICT (student_id, semester_id) DO UPDATE SET 
    status = EXCLUDED.status,
    total_units = EXCLUDED.total_units;

INSERT INTO course_registration_items (batch_id, course_id, units, category)
VALUES 
    ('b0000000-0000-0000-0000-000000000002'::uuid, 'CSC102', 3, 'CORE'),
    ('b0000000-0000-0000-0000-000000000002'::uuid, 'MTH102', 3, 'CORE'),
    ('b0000000-0000-0000-0000-000000000002'::uuid, 'PHY102', 3, 'CORE'),
    ('b0000000-0000-0000-0000-000000000002'::uuid, 'GST202', 2, 'GENERAL'),
    ('b0000000-0000-0000-0000-000000000002'::uuid, 'GST204', 2, 'GENERAL')
ON CONFLICT (batch_id, course_id) DO NOTHING;

-- 3. student5 (200L CYS): Pre-seeded in SUBMITTED state (17 units) for advisor1 bulk approval test
INSERT INTO course_registration_batches (
    id, student_id, semester_id, status, total_units, submitted_at, version
)
VALUES (
    'b0000000-0000-0000-0000-000000000005'::uuid,
    'student5',
    '2026_RAIN',
    'SUBMITTED',
    17,
    NOW() - INTERVAL '1 hour',
    1
)
ON CONFLICT (student_id, semester_id) DO UPDATE SET 
    status = EXCLUDED.status,
    total_units = EXCLUDED.total_units;

INSERT INTO course_registration_items (batch_id, course_id, units, category)
VALUES 
    ('b0000000-0000-0000-0000-000000000005'::uuid, 'CYS202', 3, 'ELECTIVE'),
    ('b0000000-0000-0000-0000-000000000005'::uuid, 'CYS204', 3, 'CORE'),
    ('b0000000-0000-0000-0000-000000000005'::uuid, 'CSC204', 3, 'CORE'),
    ('b0000000-0000-0000-0000-000000000005'::uuid, 'CSC202', 3, 'CORE'),
    ('b0000000-0000-0000-0000-000000000005'::uuid, 'GST202', 2, 'GENERAL')
ON CONFLICT (batch_id, course_id) DO NOTHING;

COMMIT;
