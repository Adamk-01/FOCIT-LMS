-- ==============================================================================
-- FOCIT LMS - Phase 16: Lecturer Workspace & Class Roster Architecture
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. EXTEND STAFF ROLES CHECK TO INCLUDE LECTURER AND STAFF
-- ------------------------------------------------------------------------------
ALTER TABLE staff_advisors 
DROP CONSTRAINT IF EXISTS staff_advisors_role_check;

ALTER TABLE staff_advisors 
ADD CONSTRAINT staff_advisors_role_check 
CHECK (role IN ('LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADMIN', 'SYSTEM_ADMIN', 'LECTURER', 'STAFF', 'ADVISOR'));

-- ------------------------------------------------------------------------------
-- 2. SEED SAMPLE LECTURER ACCOUNT IF NOT PRESENT
-- ------------------------------------------------------------------------------
-- Default password: ChangeMe123! (OWASP scrypt hashed)
INSERT INTO staff_advisors (
    advisor_id, 
    staff_number, 
    full_name, 
    email, 
    department_id, 
    assigned_level, 
    role, 
    password_hash, 
    must_change_password, 
    account_status
)
VALUES (
    'lecturer1',
    'FOCIT/STF/2026/001',
    'Dr. Adebayo O. Adeleke',
    'lecturer1@focit.uniosun.edu.ng',
    'CSC',
    200,
    'LECTURER',
    'f0c17a9b0123456789abcdef01234567:52669d26faf75c9cdd896ede664f8d288e17ab129fb1979fc425b0604a6c801063873ff8a8e2ee3ce5f6da3b774d07e4b3410a7288c443d7121784eb467d3590',
    FALSE,
    'ACTIVE'
)
ON CONFLICT (advisor_id) DO UPDATE SET
    role = 'LECTURER',
    department_id = 'CSC',
    password_hash = EXCLUDED.password_hash;

-- Ensure sample courses are allocated to lecturer1 for current term
INSERT INTO hod_course_allocations (course_id, semester_id, lecturer_id, allocated_by)
SELECT c.course_id, s.id, 'lecturer1', 'hod_csc'
FROM courses c
CROSS JOIN (SELECT id FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1) s
WHERE c.code IN ('CSC 201', 'CSC 202', 'CSC 203', 'CSC 204', 'CSC 205', 'CSC201', 'CSC202', 'CSC203', 'CSC204', 'CSC205')
ON CONFLICT (course_id, semester_id) DO UPDATE SET
    lecturer_id = 'lecturer1';

COMMIT;
