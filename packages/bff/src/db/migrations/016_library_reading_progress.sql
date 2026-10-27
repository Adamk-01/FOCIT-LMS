-- ============================================================================
-- Migration 016: Digital Library Cross-Device Reading Progress Ledger
-- ============================================================================
-- Implements Phase 13 Cross-Device Reading Continuity under the 8-8-8 Doctrine:
-- 1. Single Source of Truth in ACID PostgreSQL (eliminates localStorage sync drift).
-- 2. HOT-Optimized narrow table for high-frequency debounced page updates.
-- 3. Idempotent UPSERT with GREATEST() progression guarantee.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS library_reading_progress (
    student_id VARCHAR(64) NOT NULL,
    item_id UUID NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
    last_page INT NOT NULL DEFAULT 1 CHECK (last_page >= 1),
    max_page_reached INT NOT NULL DEFAULT 1 CHECK (max_page_reached >= 1),
    total_pages INT DEFAULT NULL,
    percentage INT NOT NULL DEFAULT 0 CHECK (percentage >= 0 AND percentage <= 100),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (student_id, item_id),
    CONSTRAINT chk_reading_progress_bounds CHECK (
        total_pages IS NULL OR (total_pages >= 1 AND last_page <= total_pages AND max_page_reached <= total_pages)
    )
) WITH (fillfactor = 85);

-- Ensure true HOT optimization: DROP any secondary index indexing updated_at.
-- Lookups by student_id are already fully covered by the composite PRIMARY KEY (student_id, item_id) B-tree prefix.
DROP INDEX IF EXISTS idx_reading_progress_student;

-- Invariant: Add boundary check constraint if table already existed
ALTER TABLE library_reading_progress 
    DROP CONSTRAINT IF EXISTS chk_reading_progress_bounds;
ALTER TABLE library_reading_progress 
    ADD CONSTRAINT chk_reading_progress_bounds CHECK (
        total_pages IS NULL OR (total_pages >= 1 AND last_page <= total_pages AND max_page_reached <= total_pages)
    );

COMMIT;

