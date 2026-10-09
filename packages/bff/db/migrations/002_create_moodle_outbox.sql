-- Migration: 002_create_moodle_outbox.sql
-- Enforces the Transactional Outbox Pattern for Moodle API integration

CREATE TABLE IF NOT EXISTS moodle_outbox (
  id SERIAL PRIMARY KEY,
  
  -- Context
  student_focit_id VARCHAR(50) NOT NULL,
  moodle_module_id INTEGER NOT NULL,
  
  -- State Machine: PENDING -> PROCESSING -> COMPLETED (or FAILED)
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  
  -- Tracking
  payload JSONB,
  retry_count INTEGER DEFAULT 0,
  
  -- Audit Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- CRITICAL: Partial index to strictly optimize the SKIP LOCKED sweep query.
-- The worker cron will ONLY scan this index, bypassing the massive history of COMPLETED rows.
CREATE INDEX idx_moodle_outbox_sweep ON moodle_outbox (created_at) WHERE status = 'PENDING';
