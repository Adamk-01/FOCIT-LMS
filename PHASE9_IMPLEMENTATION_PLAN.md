# Phase 9 Implementation Plan: Department Course Personalisation, Foundational GPA Exemption & Assignment Delivery Engine

**Role:** Staff Systems Architect & Zero-Trust Client Lead  
**Document Status:** Pending Architecture Defense & Grill Sign-off  
**Subsystems:** `packages/bff` (Express BFF, PostgreSQL, Redis) ↔ `packages/frontend` (React 19, TanStack Query)  
**Governing Standard:** The 8-8-8 Architectural Doctrine (`focit-architect`)  

---

## 1. Executive Architectural Blueprint

This milestone delivers four interconnected academic governance planes:
1. **Department & Level-Personalized Course Engine:** Enforces dynamic, database-driven course recommendations segmented by Department Core, Faculty Electives, and University General Studies. Eliminates all mock/hardcoded course arrays across the BFF.
2. **Foundational Level (100L/200L) GPA Exemption:** Suppresses and marks exempt CGPA computations for 100L and 200L students who take inter-faculty courses outside the Faculty of Computing, enforcing Senate policy that Faculty CGPA begins at 300L departmental specialization.
3. **Lecturer Assignment Delivery & Submission Engine:** Establishes an authoritative ACID schema (`course_assignments` and `student_assignment_submissions`) and BFF routes, enabling students to view uploaded assignments, attached briefs, due dates, and submit solutions with mutation locks.
4. **End-to-End Course Access & Attendance Telemetry:** Guarantees that enrolled/registered students can seamlessly access course overviews, materials, live classes (Zoom/timetable), quizzes, and assignments across all 7 faculty departments.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT PLANE (React 19)                              │
│                                                                                        │
│   Dashboard & Profile:                                                                 │
│   - GPA Telemetry: Conditionally renders "EXEMPT (100L/200L Inter-Faculty)" badge      │
│   - My Courses List: Rendered strictly from authoritative /api/courses DB query        │
│                                                                                        │
│   Registration Wizard:                                                                 │
│   - Recommends courses segmented by: Department Core, Approved Electives, GST          │
│   - Dual-State Partitioning (URL SearchParams + sessionStorage sandbox)                │
│                                                                                        │
│   Course Detail Suite (/courses/:courseId):                                            │
│   - Tab Navigation: Overview | Materials | Assignments | Quizzes | Forum | Grades      │
│   - Assignments Tab: Zero-trust list, due date alerts, brief download, submission modal│
│   - Attend Class: Dynamic live lecture integration & timetabled calendar view          │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTPS / HttpOnly Cookie + X-Session-Nonce
                                            │ X-Idempotency-Key on mutations
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                COMPUTE PLANE (Express BFF)                             │
│                                                                                        │
│   Tier 1: Tenant Security & Enrollment Authorization Boundary                          │
│   Tier 2: Dynamic Course Resolver (eliminates mockDb in /api/courses & materials.js)   │
│   Tier 3: Academic Standing Evaluator (Level < 300 -> gpa_exempt: true, gpa: null)     │
│   Tier 4: Assignment Management API (/api/courses/:courseId/assignments)               │
│   Tier 5: Relational Set-Difference CTE Engine (Dijkstra ordered course registration)  │
└─────────────────────┬──────────────────────────────────────────────┬───────────────────┘
                      │                                              │
                      ▼                                              ▼
┌──────────────────────────────────────────┐    ┌────────────────────────────────────────┐
│             STATE PLANE (PostgreSQL 16)  │    │           CACHE & SESSION (Redis 7)    │
│                                          │    │                                        │
│  - course_assignments (Lecturer briefs)  │    │  Session Hash + Ephemeral Nonce        │
│  - student_assignment_submissions (ACID) │    │  Single-Flight Coalescing Engine       │
│  - courses (Expanded 100L-400L catalog)  │    │  Bounded L1 Cache with SWR Mechanics   │
│  - enrollments & registration_batches    │    │                                        │
└──────────────────────────────────────────┘    └────────────────────────────────────────┘
```

---

## 2. Invariant Defense: Concurrency, Boundaries & Exemption Physics

### Invariant 1: Authoritative Database Catalog (Eliminating Mock Fallbacks)
* **The Vulnerability:** `packages/bff/src/routes/materials.js` currently serves `GET /api/courses` from a hardcoded array of three static courses (`CSC 204`, `CSC 202`, `MTH 101`), ignoring student enrollments in PostgreSQL. Similarly, `resolveMoodleCourseId` contains a static 3-entry dictionary, throwing fatal 500 errors if a student navigates to `INF 202`, `SEN 202`, or `GST 202`.
* **Architectural Defense:**
  - `GET /api/courses` queries PostgreSQL `enrollments e JOIN courses c ON c.course_id = e.course_id` filtered strictly by authenticated `student_id` and active semester.
  - `resolveMoodleCourseId` queries `courses.moodle_course_id` directly from PostgreSQL with in-memory memoization.

### Invariant 2: Level 100/200 GPA Exemption Physics
* **The Vulnerability:** Displaying `0.00` or a generic `3.60` mock GPA for 100L/200L students misrepresents their academic standing, as foundational courses are taken across multiple university faculties before departmental matriculation.
* **Architectural Defense:**
  - In `studentDashboard.js`, `profile.js`, and advisor cohort queries:
    ```javascript
    const isGpaExempt = student.level < 300;
    const gpaResponse = isGpaExempt ? {
      current_gpa: null,
      gpa_exempt: true,
      exemption_reason: '100L & 200L foundational inter-faculty courses are excluded from Faculty CGPA computation until 300L departmental core progression.'
    } : {
      current_gpa: parseFloat(student.current_gpa),
      gpa_exempt: false,
    };
    ```
  - In frontend cards: Accessible badge rendering `EXEMPT (Foundational Level)` with semantic ARIA tooltips.

### Invariant 3: Lecturer Assignment Upload Ledger & Student Submissions
* **The Vulnerability:** Without an authoritative schema, assignments cannot support deadlines, grading weights, file attachments, or student submission idempotency. Double-submitting on cellular network drops could cause duplicate submission rows or overwrite graded submissions.
* **Architectural Defense:**
  - `course_assignments` table with UUIDv4 PK, `course_id`, `due_date`, `max_points`, `file_url`, `status`.
  - `student_assignment_submissions` table with unique constraint `UNIQUE (assignment_id, student_id)`.
  - Submission mutations enforce `X-Idempotency-Key` headers and prevent modification once status transitions to `'GRADED'`.

### Invariant 4: Department-Personalized Course Recommendations
* **The Vulnerability:** When `2026_RAIN` semester is active, 100-level students have zero available courses because catalog seeds only included Harmattan (Semester 1) courses. Furthermore, core courses for Cyber Security (CYS), Software Engineering (SEN), and Information Systems (IFS) were incomplete or miscategorized.
* **Architectural Defense:**
  - Migration 009 expands the academic catalog across all 7 departments for both Harmattan and Rain semesters:
    - 100L Rain: CSC 102, MTH 102, PHY 102, GST 112, GST 114, BIO 102, CHM 102.
    - 200L Rain: Department-specific core (CSC 202/204, CYS 202/204, SEN 202/204, INF 202/204, DSC 202/204), plus GST 202/204.
    - 300L & 400L advanced tracks for each department.
  - Course registration API dynamically groups eligible courses into:
    - `department_core`: Mandatory for the student's department.
    - `faculty_electives`: Inter-department computing electives.
    - `general_studies`: Compulsory University-wide courses (GST).

---

## 3. Database Migration Specification (`009_academic_personalisation_and_assignments.sql`)

### 1. `course_assignments`
```sql
CREATE TABLE IF NOT EXISTS course_assignments (
    assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    lecturer_name VARCHAR(128) NOT NULL,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    max_points NUMERIC(5, 2) NOT NULL DEFAULT 100.00 CHECK (max_points > 0),
    weight_percent INT NOT NULL DEFAULT 10 CHECK (weight_percent >= 0 AND weight_percent <= 100),
    file_url TEXT,
    file_name VARCHAR(255),
    file_size_bytes BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT', 'PUBLISHED', 'CLOSED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assignments_course_due 
ON course_assignments (course_id, due_date ASC);
```

### 2. `student_assignment_submissions`
```sql
CREATE TABLE IF NOT EXISTS student_assignment_submissions (
    submission_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES course_assignments(assignment_id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    submission_text TEXT,
    file_url TEXT,
    file_name VARCHAR(255),
    file_size_bytes BIGINT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    grade NUMERIC(5, 2),
    feedback TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'GRADED', 'LATE')),
    CONSTRAINT uq_student_assignment UNIQUE (assignment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_student 
ON student_assignment_submissions (student_id, assignment_id);
```

### 3. Catalog Seed Expansion
- Seeds 100-level Rain Semester courses (CSC102, MTH102, PHY102, GST112, GST114).
- Seeds department core courses for CYS, SEN, DSC, IFS, IFT, LIS across 100L and 200L.
- Seeds real assignments for courses (e.g. CSC204, CSC202, CYS202, INF202).
- Seeds initial submissions for student test personas.

---

## 4. API Wire Contracts

### `GET /api/courses`
Returns authoritative list of enrolled courses for the logged-in student.
```json
{
  "data": [
    {
      "id": 1,
      "course_id": "CSC204",
      "code": "CSC 204",
      "title": "Data Structures and Algorithms",
      "department": "Department of Computer Science",
      "department_id": "CSC",
      "level": 200,
      "units": 3,
      "category": "CORE",
      "progress_percent": 45,
      "enrollment_status": "IN_PROGRESS",
      "moodle_course_id": 1
    }
  ],
  "total": 1,
  "student": {
    "student_id": "student1",
    "level": 200,
    "department": "Department of Computer Science"
  }
}
```

### `GET /api/courses/:courseId/assignments`
Returns assignments for a course with student-specific submission status.
```json
{
  "course_id": "CSC204",
  "course_code": "CSC 204",
  "assignments": [
    {
      "assignment_id": "a0000000-0000-0000-0000-000000000001",
      "title": "Assignment 1 — Memory Layout & Heap Allocations",
      "description": "Implement a custom memory allocator in C/C++ verifying pointer arithmetic and fragmentation.",
      "lecturer_name": "Prof. O. B. Alade",
      "due_date": "2026-05-20T23:59:59Z",
      "max_points": 100.0,
      "weight_percent": 15,
      "file_url": "/api/files/assignments/csc204_assign1_brief.pdf",
      "file_name": "csc204_assign1_brief.pdf",
      "file_size_bytes": 1048576,
      "status": "PUBLISHED",
      "is_overdue": false,
      "submission": {
        "submission_id": "s0000000-0000-0000-0000-000000000001",
        "submitted_at": "2026-05-18T14:30:00Z",
        "status": "GRADED",
        "grade": 92.5,
        "feedback": "Excellent cache-line alignment logic.",
        "file_name": "student1_csc204_allocator.c"
      }
    }
  ]
}
```

### `POST /api/courses/:courseId/assignments/:assignmentId/submit`
Submits a student assignment with zero-trust idempotency.
- Headers: `X-Session-Nonce`, `X-Idempotency-Key`
- Payload: `{ "submission_text": "...", "file_url": "...", "file_name": "..." }`
- Response: `201 Created` with submission payload.

---

## 5. Frontend Component Architecture

### `packages/frontend/src/components/course/AssignmentsTab.jsx`
- Replaces generic fallback in `CourseDetailPage.jsx`.
- **States:**
  - Loading: Skeleton cards matching university design system.
  - Empty: Semantic illustration ("No assignments currently assigned by the lecturer").
  - Error: Error boundary with retry action.
  - Interactive: Accordion / list of assignments with status badges (`Due Soon`, `Submitted`, `Graded`, `Overdue`).
  - Submission Drawer/Modal: Accessible `<dialog>` with keyboard trap, file upload simulator, text input, and double-submit mutation lock.

### `packages/frontend/src/pages/DashboardPage.jsx` & `StudentProfilePage.jsx`
- Evaluates `metrics.gpa_exempt` or `student.level < 300`.
- If true: renders golden/amber pill:
  `<span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">EXEMPT (100L/200L Inter-Faculty)</span>`
- Renders informational trigger explaining UNIOSUN faculty CGPA policy.

---

## 6. Execution Verification Protocol
1. **Unit & Integration Suite:**
   - Test 100L student login (`student2`): catalog recommendations contain 100L Rain courses, GPA is `null` with `gpa_exempt: true`.
   - Test 200L CYS student login (`student5`): catalog recommendations prioritize Cyber Security core courses, GPA is `null` with `gpa_exempt: true`.
   - Test 300L student login (`student3`): catalog recommendations contain 300L core, GPA is computed (`3.45`).
   - Test assignment listing and submission: enrolled student views lecturer assignment, submits, rejects duplicate when graded.
   - Test non-enrolled student: accessing assignments for an un-enrolled course returns `403 Forbidden`.
