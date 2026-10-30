BEGIN;

-- 1. Milestone 10.7: Normalize existing legacy matric numbers before applying CHECK constraint
-- Converts 'FOCIT/2024/0042' or '2024-28682' -> '2024/0042' or '2024/28682'
UPDATE students
SET matric_number = regexp_replace(matric_number, '^.*(\d{4})[-/](\d{4,6})$', '\1/\2')
WHERE matric_number !~ '^\d{4}/\d{4,6}$';

ALTER TABLE students
  DROP CONSTRAINT IF EXISTS chk_senate_matric_format,
  ADD CONSTRAINT chk_senate_matric_format
  CHECK (matric_number ~ '^\d{4}/\d{4,6}$');

-- 2. Milestone 10.1 & 10.2: Assessment Telemetry & Deterministic Seed Columns
ALTER TABLE quiz_attempts
  ADD COLUMN IF NOT EXISTS allocation_seed VARCHAR(64),
  ADD COLUMN IF NOT EXISTS telemetry_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS anomaly_score SMALLINT NOT NULL DEFAULT 0 CHECK (anomaly_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS proctor_review_status VARCHAR(32) NOT NULL DEFAULT 'CLEAR'
    CHECK (proctor_review_status IN ('CLEAR', 'SUBMITTED_PENDING_REVIEW', 'CLEARED_BY_LECTURER', 'PENALIZED'));

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_review_status
  ON quiz_attempts (quiz_id, proctor_review_status)
  WHERE proctor_review_status = 'SUBMITTED_PENDING_REVIEW';

-- 3. Milestone 10.3 & Invariant 8: Idempotency Keys Ledger
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(64) PRIMARY KEY,
  student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  request_hash CHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  response_code SMALLINT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_cleanup ON idempotency_keys (created_at);

-- 4. Milestone 10.5: Zero-Cookie Calendar Subscription Capability Tokens
CREATE TABLE IF NOT EXISTS calendar_subscription_tokens (
  token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

COMMIT;
