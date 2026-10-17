-- ==============================================================================
-- FOCIT LMS - Migration 008: Administrator Governance, Status Flags & Identity
-- ==============================================================================

BEGIN;

-- 1. Extend role constraint on staff_advisors to include ADMIN roles
ALTER TABLE staff_advisors 
DROP CONSTRAINT IF EXISTS staff_advisors_role_check;

ALTER TABLE staff_advisors 
ADD CONSTRAINT staff_advisors_role_check 
CHECK (role IN ('LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADMIN', 'SYSTEM_ADMIN'));

-- 2. Add account_status column to staff_advisors and students if not present
ALTER TABLE staff_advisors 
ADD COLUMN IF NOT EXISTS account_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' 
CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'LOCKED'));

ALTER TABLE students 
ADD COLUMN IF NOT EXISTS account_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' 
CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'LOCKED'));

-- 3. Seed default Administrator Identity (admin1)
-- Default initial password: ChangeMe123! (OWASP scrypt hashed)
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
    'admin1',
    'ADM/2026/001',
    'FOCIT System Administrator',
    'admin@focit.uniosun.edu.ng',
    'CSC',
    100,
    'SYSTEM_ADMIN',
    'f0c17a9b0123456789abcdef01234567:52669d26faf75c9cdd896ede664f8d288e17ab129fb1979fc425b0604a6c801063873ff8a8e2ee3ce5f6da3b774d07e4b3410a7288c443d7121784eb467d3590',
    TRUE,
    'ACTIVE'
)
ON CONFLICT (advisor_id) DO NOTHING;

-- 4. Search and indexing optimization for Admin Portal
CREATE INDEX IF NOT EXISTS idx_staff_advisors_role 
ON staff_advisors (role, account_status);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_action_ts 
ON identity_audit_logs (actor_id, event_type, created_at DESC);

COMMIT;
