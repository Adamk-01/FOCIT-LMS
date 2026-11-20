-- ==============================================================================
-- FOCIT LMS - Add semester_id to Quizzes Table
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

ALTER TABLE quizzes 
ADD COLUMN IF NOT EXISTS semester_id VARCHAR(32) REFERENCES academic_semesters(id);

CREATE INDEX IF NOT EXISTS idx_quizzes_course_semester 
ON quizzes (course_id, semester_id);

COMMIT;
