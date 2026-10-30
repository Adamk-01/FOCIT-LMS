-- ==============================================================================
-- FOCIT LMS - Phase 18 Test-First Question Bank & Moodle Synchronization Suite
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- 1. Extend Quizzes table with Question Format, Moodle Sync, and Creator tracking
ALTER TABLE quizzes 
ADD COLUMN IF NOT EXISTS question_format VARCHAR(32) NOT NULL DEFAULT 'MIXED'
    CHECK (question_format IN ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'SHORT_ANSWER', 'MIXED')),
ADD COLUMN IF NOT EXISTS sync_to_moodle BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS created_by VARCHAR(64);

-- 2. Create Moodle Quiz Mapping Table
CREATE TABLE IF NOT EXISTS moodle_quiz_mappings (
    focit_quiz_id VARCHAR(32) PRIMARY KEY REFERENCES quizzes(quiz_id) ON DELETE CASCADE,
    moodle_quiz_id INT NOT NULL,
    moodle_course_id INT NOT NULL,
    moodle_cmid INT,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('PENDING', 'SYNCED', 'FAILED')),
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sync_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_moodle_quiz_mappings_status 
ON moodle_quiz_mappings (sync_status);

-- 3. Create Moodle Question Mapping Table
CREATE TABLE IF NOT EXISTS moodle_question_mappings (
    focit_question_id VARCHAR(32) PRIMARY KEY REFERENCES quiz_questions(question_id) ON DELETE CASCADE,
    moodle_question_id INT NOT NULL,
    moodle_quiz_id INT,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'SYNCED' CHECK (sync_status IN ('PENDING', 'SYNCED', 'FAILED')),
    last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sync_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_moodle_question_mappings_quiz 
ON moodle_question_mappings (moodle_quiz_id, sync_status);

-- 4. Update quiz_questions constraint to support SHORT_ANSWER without synthetic options
ALTER TABLE quiz_questions 
DROP CONSTRAINT IF EXISTS chk_correct_option_exists_in_options;

ALTER TABLE quiz_questions
ADD CONSTRAINT chk_correct_option_exists_in_options
CHECK (
    type = 'SHORT_ANSWER' 
    OR options @> jsonb_build_array(jsonb_build_object('id', correct_option_id))
);

COMMIT;
