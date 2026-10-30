-- Migration 019: Forum Author & Roster Representative Hardening
-- Allows academic staff to author forum threads without violating student_id foreign key constraint.
-- Rejects unresolved student authors before removing the foreign key constraint.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM forum_threads ft
    LEFT JOIN students s ON s.student_id = ft.student_id
    WHERE ft.author_role = 'STUDENT' AND s.student_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Integrity check failed: forum_threads contains student-authored records with unresolved student_id';
  END IF;
END $$;

ALTER TABLE forum_threads DROP CONSTRAINT IF EXISTS forum_threads_student_id_fkey;

-- Ensure is_course_rep column exists on enrollments
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS is_course_rep BOOLEAN DEFAULT FALSE;

-- Ensure course_uploaded_materials exists with appropriate schema
CREATE TABLE IF NOT EXISTS course_uploaded_materials (
  id SERIAL PRIMARY KEY,
  course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  file_type VARCHAR(64) DEFAULT 'DOCUMENT',
  file_size VARCHAR(32),
  uploaded_by VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_uploaded_materials_course_id ON course_uploaded_materials (course_id, created_at DESC);
