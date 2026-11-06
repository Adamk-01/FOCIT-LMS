-- ==============================================================================
-- Migration 023: Enforce UNIOSUN 5-Digit Matriculation Format
-- Standard: Senate Matriculation Standard YYYY/NNNNN (e.g. 2023/47162)
-- ==============================================================================

ALTER TABLE students 
DROP CONSTRAINT IF EXISTS chk_students_matric_format;

ALTER TABLE students 
ADD CONSTRAINT chk_students_matric_format 
CHECK (matric_number ~ '^[0-9]{4}/[0-9]{5}$');
