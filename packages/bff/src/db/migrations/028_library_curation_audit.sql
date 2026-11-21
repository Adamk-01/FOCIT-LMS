-- Migration 028: Digital Library Curation Audit Ledger
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)

BEGIN;

CREATE TABLE IF NOT EXISTS library_curation_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID, -- Kept independent of FK so audit logs survive hard purges
    actor_id VARCHAR(64) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(32) NOT NULL CHECK (action IN ('UPLOAD', 'METADATA_UPDATE', 'EMBARGO_SET', 'PUBLISH_TOGGLE', 'HARD_PURGE')),
    changes_json JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45) NOT NULL,
    user_agent VARCHAR(512),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_curation_audit_item 
ON library_curation_audit (item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_library_curation_audit_actor 
ON library_curation_audit (actor_id, created_at DESC);

COMMIT;
