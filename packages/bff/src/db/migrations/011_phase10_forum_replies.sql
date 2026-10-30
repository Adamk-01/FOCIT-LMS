-- ==============================================================================
-- FOCIT LMS - MIGRATION 011: DISCUSSION FORUM REPLIES & AVATAR PROPAGATION
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS forum_replies (
    reply_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES forum_threads(thread_id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    author_name VARCHAR(128) NOT NULL,
    author_role VARCHAR(32) NOT NULL DEFAULT 'STUDENT',
    body TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forum_replies_thread 
ON forum_replies (thread_id, created_at ASC);

-- Seed initial replies on CSC204 threads if threads exist
INSERT INTO forum_replies (thread_id, student_id, author_name, author_role, body, created_at)
SELECT 
    t.thread_id,
    'student2',
    'Jane Smith',
    'STUDENT',
    'Great explanation! For doubly linked lists, keep in mind that maintaining the prev pointer adds an auxiliary memory overhead of one pointer per node, but gives O(1) node deletion if you already hold a direct pointer to the target node.',
    NOW() - INTERVAL '1 hour'
FROM forum_threads t
WHERE t.course_id = 'CSC204'
LIMIT 1
ON CONFLICT DO NOTHING;

-- Synchronize reply counts for any seeded threads
UPDATE forum_threads t
SET replies_count = (
    SELECT COUNT(*) FROM forum_replies r WHERE r.thread_id = t.thread_id
);

COMMIT;
