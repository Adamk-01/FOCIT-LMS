-- ==============================================================================
-- FOCIT LMS - MIGRATION 007: IDENTITY & SECURITY AUDIT LEDGER (WORM DEFENSE)
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

-- 1. ADD CREDENTIAL LIFECYCLE COLUMNS
ALTER TABLE student_profiles 
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE staff_advisors 
ADD COLUMN IF NOT EXISTS password_hash VARCHAR(256),
ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. CREATE IDENTITY & SECURITY AUDIT LEDGER
CREATE TABLE IF NOT EXISTS identity_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    actor_role VARCHAR(32) NOT NULL DEFAULT 'STUDENT',
    target_id VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL DEFAULT 'CREDENTIALS',
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(64),
    prev_state_hash VARCHAR(64),
    new_state_hash VARCHAR(64),
    prev_entry_hash VARCHAR(64),
    entry_hash VARCHAR(64) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_identity_audit_temporal 
ON identity_audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_identity_audit_target 
ON identity_audit_logs (target_id, event_type, created_at DESC);

-- 3. LAYER 2 WORM IMMUTABILITY TRIGGER
CREATE OR REPLACE FUNCTION enforce_audit_ledger_immutability()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'SECURITY AUDIT VIOLATION: identity_audit_logs is strictly append-only. UPDATE and DELETE operations are forbidden by Senate Directive.'
    USING ERRCODE = '55000'; -- object_not_modifiable
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_identity_audit_no_update_delete ON identity_audit_logs;
CREATE TRIGGER trg_identity_audit_no_update_delete
BEFORE UPDATE OR DELETE ON identity_audit_logs
FOR EACH STATEMENT
EXECUTE FUNCTION enforce_audit_ledger_immutability();

-- 4. LAYER 1 ROLE PRIVILEGE STRIPPING (PostgreSQL RBAC Boundary)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'focit_user') THEN
        REVOKE UPDATE, DELETE, TRUNCATE ON identity_audit_logs FROM focit_user;
        GRANT SELECT, INSERT ON identity_audit_logs TO focit_user;
    END IF;
END $$;

-- 5. SEED INITIAL CRYPTOGRAPHIC PASSWORDS (scrypt standard for 'password123')
-- Hash: f0c17a9b0123456789abcdef01234567:52669d26faf75c9cdd896ede664f8d288e17ab129fb1979fc425b0604a6c801063873ff8a8e2ee3ce5f6da3b774d07e4b3410a7288c443d7121784eb467d3590
UPDATE student_profiles
SET 
    password_hash = 'f0c17a9b0123456789abcdef01234567:52669d26faf75c9cdd896ede664f8d288e17ab129fb1979fc425b0604a6c801063873ff8a8e2ee3ce5f6da3b774d07e4b3410a7288c443d7121784eb467d3590',
    must_change_password = CASE WHEN student_id = 'student2' THEN TRUE ELSE FALSE END
WHERE student_id IN ('student1', 'student2', 'student3', 'student4', 'student5');

UPDATE staff_advisors
SET 
    password_hash = 'f0c17a9b0123456789abcdef01234567:52669d26faf75c9cdd896ede664f8d288e17ab129fb1979fc425b0604a6c801063873ff8a8e2ee3ce5f6da3b774d07e4b3410a7288c443d7121784eb467d3590',
    must_change_password = FALSE
WHERE advisor_id IN ('advisor1', 'advisor2', 'advisor3', 'hod1');
