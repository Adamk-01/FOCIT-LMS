-- ==============================================================================
-- FOCIT LMS - MIGRATION 009: DEPARTMENT PERSONALISATION, ASSIGNMENTS & GPA EXEMPTION
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. COURSE ASSIGNMENTS (Lecturer Assessment Delivery Plane)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_assignments (
    assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    lecturer_name VARCHAR(128) NOT NULL,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    max_points NUMERIC(5, 2) NOT NULL DEFAULT 100.00 CHECK (max_points > 0),
    weight_percent INT NOT NULL DEFAULT 10 CHECK (weight_percent >= 0 AND weight_percent <= 100),
    file_url TEXT,
    file_name VARCHAR(255),
    file_size_bytes BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT', 'PUBLISHED', 'CLOSED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_course_due 
ON course_assignments (course_id, due_date ASC);

-- ------------------------------------------------------------------------------
-- 2. STUDENT ASSIGNMENT SUBMISSIONS (Authoritative Student Work Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_assignment_submissions (
    submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES course_assignments(assignment_id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    submission_text TEXT,
    file_url TEXT,
    file_name VARCHAR(255),
    file_size_bytes BIGINT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    grade NUMERIC(5, 2),
    feedback TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'GRADED', 'LATE')),
    CONSTRAINT uq_student_assignment UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_student 
ON student_assignment_submissions (student_id, assignment_id);

-- ------------------------------------------------------------------------------
-- 3. EXPAND ACADEMIC CATALOG: 100L RAIN COURSES & DEPARTMENTAL CORES
-- ------------------------------------------------------------------------------
-- Insert 100L Rain Semester courses (Level 100, Semester 2)
INSERT INTO courses (
    course_id, code, title, department_id, level, semester_number, units, category, max_capacity, enrolled_count, moodle_course_id, description
)
VALUES
    -- 100L Rain Semester Foundations
    ('CSC102', 'CSC 102', 'Problem Solving & Structured Programming', 'CSC', 100, 2, 3, 'CORE', 250, 210, 21, 'Fundamental algorithmic design, pseudocode, control structures, modular programming, and debugging techniques.'),
    ('MTH102', 'MTH 102', 'Calculus II & Vectors', 'CSC', 100, 2, 3, 'CORE', 250, 215, 22, 'Techniques of integration, partial fractions, limits of sequences, polar coordinates, and vector geometry in 3D.'),
    ('PHY102', 'PHY 102', 'General Physics II (Electricity & Magnetism)', 'CSC', 100, 2, 3, 'CORE', 250, 220, 23, 'Electrostatics, Coulomb law, Gauss law, magnetic fields, Ampere law, electromagnetic induction, and circuits.'),
    ('GST112', 'GST 112', 'Use of English II & Communication Skills', 'CSC', 100, 2, 2, 'GENERAL', 350, 240, 24, 'Academic writing, listening comprehension, rhetorical analysis, public speaking, and institutional correspondence.'),
    ('GST114', 'GST 114', 'Philosophy, Logic & Human Existence', 'CSC', 100, 2, 2, 'GENERAL', 350, 235, 25, 'Foundations of logic, truth tables, fallacies, ethical theories, existentialism, and human society.'),
    ('BIO102', 'BIO 102', 'General Biology II (Plant & Animal Physiology)', 'CSC', 100, 2, 3, 'ELECTIVE', 200, 80, 26, 'Cell biology, respiration, photosynthesis, genetics, homeostasis, and ecological biodiversity.'),
    ('CHM102', 'CHM 102', 'General Chemistry II (Physical & Organic Chemistry)', 'CSC', 100, 2, 3, 'ELECTIVE', 200, 75, 27, 'Chemical thermodynamics, kinetics, equilibria, aliphatic hydrocarbons, and functional group reactions.')
ON CONFLICT (course_id) DO UPDATE SET
    title = EXCLUDED.title,
    units = EXCLUDED.units,
    category = EXCLUDED.category,
    max_capacity = EXCLUDED.max_capacity,
    enrolled_count = EXCLUDED.enrolled_count,
    moodle_course_id = EXCLUDED.moodle_course_id,
    description = EXCLUDED.description;

-- Insert & Update 200L Department Core Courses for Cyber Security, Software Engineering, Info Systems, Data Science
INSERT INTO courses (
    course_id, code, title, department_id, level, semester_number, units, category, max_capacity, enrolled_count, moodle_course_id, description
)
VALUES
    ('CYS202', 'CYS 202', 'Fundamentals of Cyber Security', 'CYS', 200, 2, 3, 'CORE', 120, 65, 6, 'Core security principles, CIA triad, symmetric/asymmetric encryption, hash functions, and network defense models.'),
    ('CYS204', 'CYS 204', 'Computer Networks & Defense Protocols', 'CYS', 200, 2, 3, 'CORE', 120, 55, 28, 'TCP/IP architecture, packet analysis, subnetting, firewall configuration, IDS/IPS, and cryptographic tunneling.'),
    ('SEN202', 'SEN 202', 'Software Requirements & Modelling', 'SEN', 200, 2, 3, 'CORE', 100, 58, 7, 'Formal requirements engineering, UML statecharts, agile user stories, software verification, and traceability matrices.'),
    ('SEN204', 'SEN 204', 'Software Construction & Architecture', 'SEN', 200, 2, 3, 'CORE', 100, 48, 29, 'Software design patterns, architectural styles, modularity, refactoring, code quality metrics, and test-driven development.'),
    ('INF202', 'INF 202', 'Information Systems Analysis & Design', 'IFS', 200, 2, 3, 'CORE', 150, 140, 3, 'Systems development life cycle, enterprise process modelling, requirement engineering, and lab database design.'),
    ('INF204', 'INF 204', 'Enterprise Database Management', 'IFS', 200, 2, 3, 'CORE', 120, 65, 30, 'Enterprise schema architecture, query optimization, concurrency control, distributed databases, and data warehousing.'),
    ('DSC202', 'DSC 202', 'Introduction to Data Science & R', 'DSC', 200, 2, 3, 'CORE', 100, 45, 8, 'Exploratory data analysis, statistical computing, tidyverse data wrangling, and supervised regression modelling.'),
    ('DSC204', 'DSC 204', 'Applied Statistical Inference & Python', 'DSC', 200, 2, 3, 'CORE', 100, 42, 31, 'Probability distributions, hypothesis testing, ANOVA, nonparametric tests, and data science computation with NumPy/Pandas.'),
    ('IFT202', 'IFT 202', 'Internet Technologies & Web Architecture', 'IFT', 200, 2, 3, 'CORE', 120, 50, 32, 'HTTP protocol mechanics, modern DOM rendering, client-server security, RESTful web services, and cloud hosting.'),
    ('LIS202', 'LIS 202', 'Information Organization & Metadata', 'LIS', 200, 2, 3, 'CORE', 120, 40, 33, 'Classification schemes, Dublin Core metadata standards, cataloguing, indexing, and digital library repositories.')
ON CONFLICT (course_id) DO UPDATE SET
    title = EXCLUDED.title,
    department_id = EXCLUDED.department_id,
    category = EXCLUDED.category,
    max_capacity = EXCLUDED.max_capacity,
    enrolled_count = EXCLUDED.enrolled_count,
    moodle_course_id = EXCLUDED.moodle_course_id,
    description = EXCLUDED.description;

-- ------------------------------------------------------------------------------
-- 4. SEED SAMPLE COURSE ASSIGNMENTS (Lecturer uploads)
-- ------------------------------------------------------------------------------
INSERT INTO course_assignments (
    assignment_id, course_id, title, description, lecturer_name, due_date, max_points, weight_percent, file_url, file_name, file_size_bytes, status
)
VALUES
    (
        'a0000000-0000-0000-0000-000000000001'::uuid,
        'CSC204',
        'Assignment 1 — Memory Layout & Heap Allocations',
        'Implement a custom memory allocator in C/C++ supporting malloc(), free(), and realloc() using a doubly-linked free list with first-fit strategy. Analyze pointer arithmetic and heap fragmentation.',
        'Prof. O. B. Alade',
        NOW() + INTERVAL '7 days',
        100.00,
        15,
        '/api/files/assignments/csc204_assignment_1_brief.pdf',
        'csc204_assignment_1_brief.pdf',
        1428576,
        'PUBLISHED'
    ),
    (
        'a0000000-0000-0000-0000-000000000002'::uuid,
        'CSC204',
        'Assignment 2 — Graph Traversals & Minimum Spanning Trees',
        'Construct a graph representation using adjacency lists. Implement Dijkstra algorithm for single-source shortest paths and Kruskal algorithm for Minimum Spanning Trees using a Disjoint Set Union (DSU) data structure.',
        'Prof. O. B. Alade',
        NOW() + INTERVAL '14 days',
        100.00,
        15,
        '/api/files/assignments/csc204_assignment_2_brief.pdf',
        'csc204_assignment_2_brief.pdf',
        1854210,
        'PUBLISHED'
    ),
    (
        'a0000000-0000-0000-0000-000000000003'::uuid,
        'CSC202',
        'Assignment 1 — Enterprise Design Patterns & Polymorphism',
        'Model an institutional banking system in Java enforcing the Factory, Observer, and Strategy design patterns. Ensure strict encapsulation, abstract contracts, and thread-safe collections.',
        'Dr. K. A. Adebayo',
        NOW() + INTERVAL '10 days',
        100.00,
        15,
        '/api/files/assignments/csc202_assignment_1_brief.pdf',
        'csc202_assignment_1_brief.pdf',
        982400,
        'PUBLISHED'
    ),
    (
        'a0000000-0000-0000-0000-000000000004'::uuid,
        'CYS202',
        'Assignment 1 — Cryptographic Primitives & Hash Collision Defense',
        'Analyze RSA key generation, AES-256 GCM encryption, and SHA-256 HMAC message integrity verification. Provide Python or Go implementations defending against chosen-plaintext attacks.',
        'Dr. M. O. Babatunde',
        NOW() + INTERVAL '5 days',
        100.00,
        20,
        '/api/files/assignments/cys202_assignment_1_brief.pdf',
        'cys202_assignment_1_brief.pdf',
        1124500,
        'PUBLISHED'
    ),
    (
        'a0000000-0000-0000-0000-000000000005'::uuid,
        'CSC102',
        'Assignment 1 — Algorithmic Flow & Modular Functions',
        'Develop structured programs using modular functions and loops to solve quadratic equations and array sorting algorithms without using built-in libraries.',
        'Dr. T. S. Olatunji',
        NOW() + INTERVAL '8 days',
        100.00,
        15,
        '/api/files/assignments/csc102_assignment_1_brief.pdf',
        'csc102_assignment_1_brief.pdf',
        642100,
        'PUBLISHED'
    )
ON CONFLICT (assignment_id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    due_date = EXCLUDED.due_date,
    file_name = EXCLUDED.file_name;

-- ------------------------------------------------------------------------------
-- 5. SEED INITIAL SUBMISSION FOR STUDENT1
-- ------------------------------------------------------------------------------
INSERT INTO student_assignment_submissions (
    submission_id, assignment_id, student_id, submission_text, file_url, file_name, file_size_bytes, submitted_at, grade, feedback, status
)
VALUES (
    'b0000000-0000-0000-0000-000000000001'::uuid,
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'student1',
    'Custom heap allocator implemented with explicit free-list segregated fit in C99. Passed all valgrind memory leak verification tests.',
    '/api/files/submissions/student1_csc204_allocator.c',
    'student1_csc204_allocator.c',
    24500,
    NOW() - INTERVAL '2 days',
    92.50,
    'Superb implementation of first-fit boundary tags. Minor pointer alignment padding can be optimized on 64-bit boundaries.',
    'GRADED'
)
ON CONFLICT (assignment_id, student_id) DO UPDATE SET
    grade = EXCLUDED.grade,
    status = EXCLUDED.status,
    feedback = EXCLUDED.feedback;

-- Phase 9 Doctrine Guard: Ensure idempotency_key exists on student_assignment_submissions
ALTER TABLE student_assignment_submissions 
ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_submissions_idempotency 
ON student_assignment_submissions (student_id, idempotency_key) 
WHERE idempotency_key IS NOT NULL;

COMMIT;
