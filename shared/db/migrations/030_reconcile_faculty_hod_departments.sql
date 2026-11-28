-- Migration 030: Reconcile Faculty Staff & HOD Department Assignments
-- Standard: The 8-8-8 Architectural Doctrine & Authoritative State Boundaries

BEGIN;

-- 1. Correct Dr. Fatima Bello to Cyber Security (CYS)
UPDATE staff_advisors 
SET department_id = 'CYS' 
WHERE staff_number = 'FOCIT/HOD/CYS/002';

-- 2. Correct Dr. Kenneth Okeke to Software Engineering (SEN)
UPDATE staff_advisors 
SET department_id = 'SEN' 
WHERE staff_number = 'UNIOSUN/STF/8821' OR staff_number = 'FOCIT/HOD/SEN/003';

-- 3. Assign Prof. Kehinde Adegboye to Library & Information Science (LIS) as HOD
UPDATE staff_advisors 
SET department_id = 'LIS', assigned_level = NULL 
WHERE staff_number = 'FOCIT/STF/2012/003' OR advisor_id = 'hod1';

-- 4. Correct lecturer and advisor departments based on institutional rosters
UPDATE staff_advisors 
SET department_id = 'SEN' 
WHERE staff_number = 'FOCIT/LEC/SEN/014';

UPDATE staff_advisors 
SET department_id = 'CYS' 
WHERE staff_number = 'STF/CYS/2025/007';

UPDATE staff_advisors 
SET department_id = 'DSC' 
WHERE staff_number = 'FOCIT/2026/0589';

COMMIT;
