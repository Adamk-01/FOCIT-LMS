-- ==============================================================================
-- FOCIT LMS - Migration 027: Content-Addressed Storage, Upload Staging Ledger & Ingestion
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Content-Addressed Storage (CAS) Blobs Table (Deduplication & CAS Reference Ledger)
CREATE TABLE IF NOT EXISTS library_storage_blobs (
    file_hash VARCHAR(64) PRIMARY KEY, -- SHA-256 (64 hex characters)
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    mime_type VARCHAR(128) NOT NULL,
    page_count INT DEFAULT NULL,
    storage_path VARCHAR(512) NOT NULL, -- e.g., 'cas/ab/cd/abcdef123456...pdf'
    ref_count INT NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Authoritative Two-Phase Staging Ledger (Zero-Trust Binary State Boundary)
CREATE TABLE IF NOT EXISTS library_upload_staging (
    staged_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploader_id VARCHAR(64) NOT NULL,
    file_hash VARCHAR(64) NOT NULL REFERENCES library_storage_blobs(file_hash) ON DELETE CASCADE,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    mime_type VARCHAR(128) NOT NULL,
    page_count INT DEFAULT NULL,
    original_filename VARCHAR(255) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'STAGED' CHECK (status IN ('STAGED', 'COMMITTED', 'EXPIRED')),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_upload_staging_uploader 
ON library_upload_staging (uploader_id, status);

CREATE INDEX IF NOT EXISTS idx_library_upload_staging_sweep 
ON library_upload_staging (expires_at) 
WHERE status = 'STAGED';

CREATE INDEX IF NOT EXISTS idx_library_upload_staging_hash 
ON library_upload_staging (file_hash, status);

-- 3. Extend library_items with Foreign Key to CAS Blobs
ALTER TABLE library_items
ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64) REFERENCES library_storage_blobs(file_hash) ON DELETE RESTRICT,
ADD COLUMN IF NOT EXISTS original_filename VARCHAR(255) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_library_items_file_hash 
ON library_items (file_hash) 
WHERE file_hash IS NOT NULL;

-- 4. Invariant 4 Relational Constraint: Zero-Day Exam Embargo Quarantine
-- Backfill historical past papers: set embargo_until = created_at so they are released
UPDATE library_items 
SET embargo_until = created_at 
WHERE item_type IN ('SEMESTER_EXAM_PQ', 'MIDTERM_TEST_PQ') 
  AND embargo_until IS NULL;

-- Enforces that exam papers must have an explicit embargo date or remain an unreleased draft (is_published = FALSE)
ALTER TABLE library_items
DROP CONSTRAINT IF EXISTS chk_exam_pq_embargo_quarantine;

ALTER TABLE library_items
ADD CONSTRAINT chk_exam_pq_embargo_quarantine CHECK (
    item_type NOT IN ('SEMESTER_EXAM_PQ', 'MIDTERM_TEST_PQ') 
    OR embargo_until IS NOT NULL 
    OR is_published = FALSE
);

-- 5. Backfill/Seed Existing Mock Blobs for Referencing Seeded Items (Zero 404s)
-- Ingests synthetic CAS references for existing mock items that don't have file_hash yet
COMMENT ON TABLE library_storage_blobs IS 'Authoritative Content-Addressed Storage ledger with reference counting';
COMMENT ON TABLE library_upload_staging IS 'Authoritative two-phase upload staging ledger for library ingestion';

COMMIT;
