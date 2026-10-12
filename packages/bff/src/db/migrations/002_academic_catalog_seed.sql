-- ==============================================================================
-- FOCIT LMS - Phase 2 Academic Catalog & Registration Schema + Seed Script
-- Faculty: Faculty of Computing & Information Technology (FOCIT) — UNIOSUN
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. DEPARTMENTS & PROGRAMMES (Academic Hierarchy)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(32) PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS programmes (
    id VARCHAR(32) PRIMARY KEY,
    department_id VARCHAR(32) NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    code VARCHAR(16) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    duration_years INT NOT NULL DEFAULT 4,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 2. ACADEMIC SESSIONS & SEMESTERS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS academic_sessions (
    id VARCHAR(32) PRIMARY KEY, -- e.g., '2026/2027'
    name VARCHAR(64) NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academic_semesters (
    id VARCHAR(32) PRIMARY KEY, -- e.g., '2026_HARMATTAN', '2026_RAIN'
    session_id VARCHAR(32) NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
    semester_number INT NOT NULL CHECK (semester_number IN (1, 2)), -- 1 = Harmattan, 2 = Rain
    name VARCHAR(64) NOT NULL,
    is_registration_open BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 3. COURSES (The Academic Catalog)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courses (
    course_id VARCHAR(32) PRIMARY KEY,
    code VARCHAR(16) NOT NULL UNIQUE,
    title VARCHAR(128) NOT NULL,
    department_id VARCHAR(32) NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    level INT NOT NULL CHECK (level IN (100, 200, 300, 400)),
    semester_number INT NOT NULL CHECK (semester_number IN (1, 2)),
    units INT NOT NULL CHECK (units >= 1 AND units <= 6),
    category VARCHAR(16) NOT NULL CHECK (category IN ('CORE', 'ELECTIVE', 'GENERAL')),
    max_capacity INT NOT NULL CHECK (max_capacity > 0),
    enrolled_count INT NOT NULL DEFAULT 0,
    moodle_course_id INT, -- Cross-system mapping to Headless Moodle course instance
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Absolute Mathematical Safety Net: Physical rejection of over-enrollment
    CONSTRAINT chk_course_capacity CHECK (enrolled_count <= max_capacity)
);

CREATE INDEX IF NOT EXISTS idx_courses_filter 
ON courses (level, semester_number, is_active);

CREATE INDEX IF NOT EXISTS idx_courses_dept 
ON courses (department_id);

-- ------------------------------------------------------------------------------
-- 4. STUDENTS (Academic Identity Plane)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    student_id VARCHAR(64) PRIMARY KEY, -- Maps to auth user ID (e.g. 'student1')
    matric_number VARCHAR(32) NOT NULL UNIQUE,
    username VARCHAR(64) NOT NULL UNIQUE,
    full_name VARCHAR(128) NOT NULL,
    email VARCHAR(128) NOT NULL UNIQUE,
    programme_id VARCHAR(32) NOT NULL REFERENCES programmes(id) ON DELETE RESTRICT,
    level INT NOT NULL DEFAULT 200 CHECK (level IN (100, 200, 300, 400)),
    current_gpa NUMERIC(3, 2) NOT NULL DEFAULT 0.00 CHECK (current_gpa >= 0.00 AND current_gpa <= 5.00),
    completed_units INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 5. ENROLLMENTS (Durable Academic Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollments (
    enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
    semester_id VARCHAR(32) NOT NULL REFERENCES academic_semesters(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'ENROLLED' CHECK (status IN ('ENROLLED', 'IN_PROGRESS', 'COMPLETED', 'DROPPED')),
    progress_percent INT NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
    grade NUMERIC(5, 2),
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Invariant: A student cannot be enrolled in the same course twice in one semester
    CONSTRAINT uq_student_course_semester UNIQUE (student_id, course_id, semester_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_student 
ON enrollments (student_id, semester_id);

CREATE INDEX IF NOT EXISTS idx_enrollments_course 
ON enrollments (course_id);

-- ------------------------------------------------------------------------------
-- 6. TRANSACTIONAL MOODLE OUTBOX (Idempotent Integration Event Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moodle_outbox (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL DEFAULT 'ENROLLMENT_SYNC',
    student_focit_id VARCHAR(64) NOT NULL,
    moodle_course_id INT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    payload JSONB NOT NULL,
    retry_count INT DEFAULT 0,
    idempotency_key VARCHAR(128) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_moodle_outbox_sweep 
ON moodle_outbox (created_at) WHERE status = 'PENDING';

-- ==============================================================================
-- SEED DATA: POPULATING THE FOCIT ACADEMIC CATALOG
-- ==============================================================================

-- 1. Departments (7 FOCIT Faculties)
INSERT INTO departments (id, code, name, description)
VALUES 
    ('CSC', 'CSC', 'Department of Computer Science', 'Core computing, algorithms, distributed systems, and computational theory.'),
    ('CYS', 'CYS', 'Department of Cyber Security', 'Network defence, cryptography, digital forensics, and ethical hacking.'),
    ('SEN', 'SEN', 'Department of Software Engineering', 'Large-scale software architecture, SDLC, DevOps, and verification.'),
    ('DSC', 'DSC', 'Department of Data Science', 'Machine learning, big data analytics, statistical computing, and AI.'),
    ('IFS', 'IFS', 'Department of Information Systems', 'Enterprise architecture, business informatics, and database systems.'),
    ('IFT', 'IFT', 'Department of Information Technology', 'Cloud infrastructure, virtualization, IT systems administration.'),
    ('LIS', 'LIS', 'Department of Library & Information Science', 'Information retrieval, digital archives, and knowledge governance.')
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- 2. Programmes
INSERT INTO programmes (id, department_id, code, name, duration_years)
VALUES 
    ('BSC_CSC', 'CSC', 'B.Sc. CSC', 'B.Sc. Computer Science', 4),
    ('BSC_CYS', 'CYS', 'B.Sc. CYS', 'B.Sc. Cyber Security', 4),
    ('BSC_SEN', 'SEN', 'B.Sc. SEN', 'B.Sc. Software Engineering', 4),
    ('BSC_DSC', 'DSC', 'B.Sc. DSC', 'B.Sc. Data Science', 4),
    ('BSC_IFS', 'IFS', 'B.Sc. IFS', 'B.Sc. Information Systems', 4),
    ('BSC_IFT', 'IFT', 'B.Sc. IFT', 'B.Sc. Information Technology', 4),
    ('BSC_LIS', 'LIS', 'B.Sc. LIS', 'B.Sc. Library & Information Science', 4)
ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name;

-- 3. Academic Sessions & Semesters
INSERT INTO academic_sessions (id, name, is_current)
VALUES ('2026/2027', '2026/2027 Academic Session', TRUE)
ON CONFLICT (id) DO UPDATE SET is_current = TRUE;

INSERT INTO academic_semesters (id, session_id, semester_number, name, is_registration_open)
VALUES 
    ('2026_HARMATTAN', '2026/2027', 1, '2026/2027 Harmattan (First) Semester', FALSE),
    ('2026_RAIN', '2026/2027', 2, '2026/2027 Rain (Second) Semester', TRUE)
ON CONFLICT (id) DO UPDATE SET is_registration_open = EXCLUDED.is_registration_open;

-- 4. Realistic Course Catalog (Spanning 100 to 400 Levels)
INSERT INTO courses (
    course_id, code, title, department_id, level, semester_number, units, category, max_capacity, enrolled_count, moodle_course_id, description
)
VALUES
    -- 200 Level Rain Semester (Primary registration testing target)
    ('CSC204', 'CSC 204', 'Data Structures and Algorithms', 'CSC', 200, 2, 3, 'CORE', 150, 142, 1, 'Advanced data structures: balanced binary search trees, hash tables, heaps, graph traversals, and algorithmic complexity analysis.'),
    ('CSC202', 'CSC 202', 'Object-Oriented Programming', 'CSC', 200, 2, 3, 'CORE', 150, 138, 2, 'Design patterns, polymorhpism, inheritance, abstract classes, Java memory models, and enterprise OOP paradigms.'),
    ('INF202', 'INF 202', 'Information Systems Analysis & Design', 'IFS', 200, 2, 3, 'CORE', 150, 140, 3, 'Systems development life cycle, UML modelling, requirement engineering, and lab database design. Capped at 150 seats.'),
    ('MTH202', 'MTH 202', 'Mathematical Methods II & Linear Algebra', 'CSC', 200, 2, 3, 'CORE', 200, 120, 4, 'Vector spaces, eigenvalues, eigenvectors, matrix decompositions, and differential equations for computing.'),
    ('CSC206', 'CSC 206', 'Computer Architecture & Organization', 'CSC', 200, 2, 3, 'CORE', 150, 95, 5, 'Instruction set architecture, pipelining, memory hierarchy, cache coherence, and digital logic design.'),
    ('CYS202', 'CYS 202', 'Fundamentals of Cyber Security', 'CYS', 200, 2, 3, 'ELECTIVE', 100, 65, 6, 'Security principles, symmetric/asymmetric encryption, hash functions, and network threat models.'),
    ('SEN202', 'SEN 202', 'Software Requirements & Modelling', 'SEN', 200, 2, 3, 'ELECTIVE', 100, 58, 7, 'Formal specifications, agile user stories, software verification, and traceability matrices.'),
    ('DSC202', 'DSC 202', 'Introduction to Data Science & R', 'DSC', 200, 2, 3, 'ELECTIVE', 80, 45, 8, 'Exploratory data analysis, statistical tests, data wrangling with tidyverse, and linear regression.'),
    ('GST202', 'GST 202', 'Peace & Conflict Resolution', 'CSC', 200, 2, 2, 'GENERAL', 350, 210, 9, 'Theories of peace studies, arbitration, mediation, and communal conflict analysis.'),
    ('GST204', 'GST 204', 'Entrepreneurship & Innovation', 'CSC', 200, 2, 2, 'GENERAL', 350, 205, 10, 'Business feasibility studies, venture capital models, enterprise formation in developing nations.'),

    -- 100 Level Foundations (Prerequisites & Transcripts)
    ('CSC101', 'CSC 101', 'Introduction to Computer Science', 'CSC', 100, 1, 3, 'CORE', 250, 240, 11, 'Binary logic, von Neumann architecture, flowcharts, and introductory structured programming.'),
    ('MTH101', 'MTH 101', 'Calculus I', 'CSC', 100, 1, 3, 'CORE', 250, 210, 12, 'Functions, limits, continuity, differential calculus, and applications of derivatives.'),
    ('PHY101', 'PHY 101', 'General Physics I (Mechanics & Properties)', 'CSC', 100, 1, 3, 'CORE', 250, 225, 13, 'Vectors, kinematics, Newton laws, rotational motion, thermodynamics.'),

    -- 300 Level Upper Division
    ('CSC302', 'CSC 302', 'Operating Systems & System Programming', 'CSC', 300, 2, 3, 'CORE', 120, 85, 14, 'Kernel structures, process synchronization, paging, virtual memory, and POSIX threads.'),
    ('CSC304', 'CSC 304', 'Database Systems & SQL Optimization', 'CSC', 300, 2, 3, 'CORE', 120, 90, 15, 'Relational algebra, query planners, indexing, ACID transactions, and NoSQL engines.'),

    -- 400 Level Capstone Tier
    ('CSC402', 'CSC 402', 'Distributed Systems & Cloud Computing', 'CSC', 400, 2, 3, 'CORE', 90, 62, 16, 'Consensus algorithms, Raft, Paxos, RPC frameworks, microservices, and CAP theorem.'),
    ('CSC499', 'CSC 499', 'Final Year Research Capstone Project', 'CSC', 400, 2, 6, 'CORE', 100, 75, 17, 'Independent scientific research, system engineering, defense before academic departmental panel.')
ON CONFLICT (course_id) DO UPDATE SET 
    title = EXCLUDED.title,
    units = EXCLUDED.units,
    category = EXCLUDED.category,
    max_capacity = EXCLUDED.max_capacity,
    enrolled_count = EXCLUDED.enrolled_count,
    moodle_course_id = EXCLUDED.moodle_course_id;

-- 5. Default Student Seed (Matching Screen 1: John Doe, Level 200, GPA 3.60)
INSERT INTO students (
    student_id, matric_number, username, full_name, email, programme_id, level, current_gpa, completed_units
)
VALUES (
    'student1',
    'FOCIT/2024/0042',
    'student1',
    'John Doe',
    'john.doe@focit.uniosun.edu.ng',
    'BSC_CSC',
    200,
    3.60,
    42
)
ON CONFLICT (student_id) DO UPDATE SET 
    full_name = EXCLUDED.full_name,
    current_gpa = EXCLUDED.current_gpa,
    completed_units = EXCLUDED.completed_units;

-- 6. Initial Active Enrollments for John Doe (Mirroring Screen 1 in ui_template.jpeg)
-- Screen 1 shows:
-- - Registered Courses: 5
-- - Completed Units: 2 courses completed (or 42 units completed transcript)
-- - GPA: 3.6
-- - Enrolled Courses list:
--     CSC 204 (In Progress, 45%)
--     CSC 202 (In Progress, 30%)
--     MTH 101 (Completed, 100%)
--     GST 202 (In Progress, 60%)
--     CSC 206 (In Progress, 25%)
INSERT INTO enrollments (student_id, course_id, semester_id, status, progress_percent, grade)
VALUES 
    ('student1', 'CSC204', '2026_RAIN', 'IN_PROGRESS', 45, NULL),
    ('student1', 'CSC202', '2026_RAIN', 'IN_PROGRESS', 30, NULL),
    ('student1', 'MTH101', '2026_HARMATTAN', 'COMPLETED', 100, 86.00),
    ('student1', 'GST202', '2026_RAIN', 'IN_PROGRESS', 60, NULL),
    ('student1', 'CSC206', '2026_RAIN', 'IN_PROGRESS', 25, NULL)
ON CONFLICT (student_id, course_id, semester_id) DO UPDATE SET 
    status = EXCLUDED.status,
    progress_percent = EXCLUDED.progress_percent,
    grade = EXCLUDED.grade;

COMMIT;
