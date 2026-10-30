-- FOCIT LMS - MIGRATION 014: HOD DASHBOARD (Allocation Matrix + Clearance Desk)
BEGIN;

CREATE TABLE IF NOT EXISTS hod_course_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
    semester_id VARCHAR(32) NOT NULL REFERENCES academic_semesters(id) ON DELETE RESTRICT,
    lecturer_id VARCHAR(64) NOT NULL REFERENCES staff_advisors(advisor_id) ON DELETE RESTRICT,
    allocated_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_hod_alloc_course_semester UNIQUE (course_id, semester_id)
);

CREATE TABLE IF NOT EXISTS hod_clearance_escalations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES course_registration_batches(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ESCALATED'
        CHECK (status IN ('ESCALATED', 'HOD_CLEARED', 'REJECTED')),
    hod_remarks TEXT,
    decided_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hod_escalations_status ON hod_clearance_escalations(status);

COMMIT;
