# Phase 2 Architecture & Implementation Plan: Student Dashboard & Course Registration

> **Document Version:** 1.0.0  
> **Target Subsystems:** `packages/frontend` (Screens 1 & 8) ↔ `packages/bff` (Registration & Concurrency Engine) ↔ `packages/mock-moodle`  
> **Visual Reference:** [ui_template.jpeg](file:///c:/Users/PC/Desktop/OneDrive/Documents/focit_lms/ui_template.jpeg) (Screen 1: Student Dashboard & Screen 8: Course Registration)  
> **Author:** Staff System Architect & Zero-Trust Client Lead  

---

## 1. Executive Summary & Separation of Concerns

Phase 2 operationalizes the core academic identity plane of the FOCIT LMS:
1. **Screen 1 (Student Dashboard):** Provides students with an authoritative overview of their academic identity, GPA (3.6), registered courses (5), completed units (2), active course progress, and upcoming deadlines synced with Moodle activities.
2. **Screen 8 (FOCIT Admin / Course Registration & Enrollment):** A multi-step academic registration engine where students select their Programme, Level, and Semester, select eligible core and elective courses within unit limits (minimum 15, maximum 24 units), review selections, and commit idempotent enrollment records.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        React 19 Client Plane                           │
│   Screen 1: DashboardPage.jsx            Screen 8: RegistrationPage.jsx│
│   - GPA & Units Telemetry                - 3-Step FSM Wizard Engine    │
│   - Enrolled Course Cards                - Course Selection Tally      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS (Cookie JWT + Idempotency-Key)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Express BFF Gateway                            │
│   - GET /api/student/dashboard (Metrics + Courses + Timetable Cache)   │
│   - GET /api/registration/eligible (Catalog filtered by Student Level) │
│   - POST /api/registration/submit (Dijkstra-Ordered Row-Lock Batch)    │
└───────────────────────────┬────────────────────────────────┬───────────┘
                            │ SQL (PgBouncer)                │ Outbox Event
                            ▼                                ▼
┌───────────────────────────────────────────┐  ┌─────────────────────────┐
│          PostgreSQL 16 State Plane        │  │   BullMQ Token Bucket   │
│  - Row-Level FOR UPDATE Capacity Gate     │  │   (<= 5 req/s to Moodle)│
│  - CHECK (enrolled_count <= max_capacity) │  └─────────────┬───────────┘
│  - Transactional Moodle Outbox Insert     │                │ REST (JSON)
└───────────────────────────────────────────┘                ▼
                                               ┌─────────────────────────┐
                                               │   Headless Moodle Core  │
                                               │   enrol_manual_enrol    │
                                               └─────────────────────────┘
```

---

## 2. Defending Failure Vector 1: The Client-Side Navigation Trap (The Ghost Wizard)

### 2.1 The Vulnerability Profile
A 3-step registration wizard holds unsubmitted, high-friction state:
- Selected course IDs (core + electives)
- Running unit tally (e.g. 18 / 24 units)
- Academic metadata (Department, Level, Semester)

If this state is held strictly in a transient React `useState` at the component root:
1. **Swipe-to-Go-Back:** A student on mobile swiping back on Step 3 (Review) will pop browser history out of the route, destroying all draft selections.
2. **OS Memory Eviction:** Mobile Safari and Chrome frequently suspend background tabs. Upon returning, the OS reloads the document, wiping the wizard state.
3. **Shared Terminal Contamination:** Storing unsubmitted state in a global React Context or generic `localStorage` without user/term scoping risks leaking or inheriting dirty drafts across different students using shared university computer laboratory terminals.

---

### 2.2 The Defended Solution: Dual State Partitioning (URL Router + Session Sandbox)

We partition the wizard state into two decoupled layers:

#### Layer A: URL SearchParams (`?step=1|2|3`)
- The active wizard step pointer lives strictly in the browser URL:
  - Step 1: `/registration?step=1` (Select Courses)
  - Step 2: `/registration?step=2` (Review Curriculum & Units)
  - Step 3: `/registration?step=3` (Confirm & Commit)
- **Invariant:** Browser Back and Forward buttons navigate predictably through the history stack without unmounting or tearing down the wizard session.

#### Layer B: User-and-Term-Namespaced Session Storage Sandbox
- The draft payload is written synchronously on every course selection toggle to `sessionStorage` under a compound namespace:
  ```
  Key: focit_registration_draft:${studentId}:${termId}
  Example: focit_registration_draft:student1:2026_harmattan
  ```
- **Why `sessionStorage` over `localStorage`?**
  - **Shared Terminal Defense:** `sessionStorage` is automatically destroyed when the browser tab is closed. When Student A completes their session and closes the tab in a cybercafé, Student B cannot inherit their course draft.
  - **Tab Suspension Defense:** While the tab remains open—even if suspended or refreshed by the OS—`sessionStorage` survives restarts intact.
  - **Namespace Isolation:** Because the key binds to `studentId`, even if Student B logs in within the same browser session without closing the tab, they cannot read Student A's draft.

#### Layer C: Draft Schema & Checksum Verification
```typescript
interface RegistrationDraftState {
  schemaVersion: 1;
  studentId: string;
  termId: string;
  programme: string;
  level: number;
  semester: number;
  selectedCourseIds: string[];
  totalUnits: number;
  lastModifiedEpochMs: number;
  catalogChecksum: string; // Hash of current curriculum version
}
```

#### Layer D: Transition Guards & Defensive Hydration
On mount of the `useRegistrationWizard` custom hook:
1. **Authentication Alignment:** Verify `draft.studentId === currentAuthenticatedUser.id`. If mismatched, purge immediately.
2. **TTL Expiration:** If `Date.now() - draft.lastModifiedEpochMs > 24 * 3600 * 1000`, purge stale draft.
3. **Catalog Integrity Reconciliation:** Cross-reference `draft.selectedCourseIds` against the live catalog cached via TanStack Query. If an elective was dropped or changed, silently sanitize the draft and recalculate unit totals.
4. **Step Transition Guard (Preventing Direct URL Injection):**  
   If a user types `/registration?step=3` directly with 0 selected courses in storage, the FSM guard intercepts and issues an idempotent redirect to `?step=1` with an advisory toast.
5. **Zero-Context Pollution:** The draft is encapsulated entirely within `useRegistrationWizard`. Zero global React context is touched. Upon successful HTTP 201 enrollment, the key is atomically purged from `sessionStorage`.

---

## 3. Defending Failure Vector 2: The Over-Enrollment Race Condition (Distributed Concurrency)

### 3.1 The Vulnerability Profile (TOCTOU)
Course `INF 202` has a hard cap of 150 seats. Currently 140 are enrolled. At 8:00 AM, 50 students hit "Confirm Registration" concurrently.

```
Naive Implementation (TOCTOU Failure):
TX 1: SELECT COUNT(*) FROM enrollments WHERE course_id = 'INF202'; -- Returns 140
TX 2: SELECT COUNT(*) FROM enrollments WHERE course_id = 'INF202'; -- Returns 140
...
TX 50: SELECT COUNT(*) FROM enrollments WHERE course_id = 'INF202'; -- Returns 140
-- All 50 pass the "140 < 150" check!
-- All 50 execute INSERT INTO enrollments...
-- Result: 190 students enrolled (40 students over the hard cap).
```

### 3.2 Why Table-Level Locks Are Rejected
Executing `LOCK TABLE enrollments IN EXCLUSIVE MODE` serializes all enrollments university-wide. 5,000 students registering across 7 departments become bottlenecked on a single mutex, thrashing PgBouncer pools and elevating latency from 5ms to 12,000ms.

---

### 3.3 The Defended Solution: Fine-Grained Row-Level Pessimistic Locking with Dijkstra Ordering

We enforce enrollment concurrency at the specific course row level with a database CHECK constraint as the absolute mathematical barrier.

#### Step 1: Normalized Database Schema with Capacity Check
```sql
-- Academic Catalog Table
CREATE TABLE courses (
  course_id VARCHAR(32) PRIMARY KEY,
  code VARCHAR(16) NOT NULL UNIQUE,
  title VARCHAR(128) NOT NULL,
  units INT NOT NULL CHECK (units > 0 AND units <= 6),
  max_capacity INT NOT NULL CHECK (max_capacity > 0),
  enrolled_count INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- HARD MATHEMATICAL SAFETY NET: The database engine physically rejects over-enrollment
  CONSTRAINT chk_course_capacity CHECK (enrolled_count <= max_capacity)
);

-- Durable Enrollment Ledger
CREATE TABLE enrollments (
  enrollment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id VARCHAR(64) NOT NULL,
  course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id),
  term_id VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ENROLLED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Prevent student from enrolling in the same course twice in one term
  CONSTRAINT uq_student_course_term UNIQUE (student_id, course_id, term_id)
);
```

#### Step 2: Dijkstra Resource Ordering Rule (Deadlock Prevention)
When a student registers multiple courses in a batch (e.g. `['INF202', 'CSC204', 'CSC202']`), concurrent registrations across different students requesting the same courses in arbitrary order will trigger **Deadlock (`40P01`)**.

**Invariant:** Before opening the transaction, the BFF sorts the requested course IDs in **strict lexicographical order**:
```javascript
const sortedCourseIds = [...new Set(requestedCourseIds)].sort();
```
Because every transaction in the system acquires row locks in the exact same sequence (`CSC202` → `CSC204` → `INF202`), circular wait conditions are mathematically impossible. The resource allocation graph is strictly acyclic.

#### Step 3: Atomic Transaction Sequence with Conditional Counter Increment
```sql
BEGIN;

-- 1. Acquire exclusive row-level locks strictly on the sorted requested courses
-- Other courses (e.g., MTH 101, CHM 101) proceed concurrently with zero contention!
SELECT course_id, code, max_capacity, enrolled_count
FROM courses
WHERE course_id = ANY($1::varchar[])
ORDER BY course_id ASC
FOR UPDATE;

-- 2. Verify in-flight capacity for all requested courses:
-- If ANY course has (enrolled_count >= max_capacity):
-- ROLLBACK; Return 409 Conflict with details: { code: 'COURSE_FULL', course_code: 'INF 202' }

-- 3. Atomic counter increment
UPDATE courses
SET enrolled_count = enrolled_count + 1
WHERE course_id = ANY($1::varchar[])
  AND enrolled_count < max_capacity;

-- 4. Insert enrollment ledger rows
INSERT INTO enrollments (student_id, course_id, term_id, status)
SELECT $2, unnest($1::varchar[]), $3, 'ENROLLED';

-- 5. Transactional Outbox Pattern: Insert Moodle sync jobs into the same atomic transaction
INSERT INTO moodle_outbox (event_type, payload, idempotency_key)
SELECT 
  'ENROLLMENT_SYNC',
  json_build_object(
    'student_id', $2,
    'course_id', c_id,
    'term_id', $3,
    'action', 'enrol'
  ),
  $4 || ':' || c_id -- Scoped idempotency key
FROM unnest($1::varchar[]) AS c_id;

COMMIT;
```

#### Concurrency & Performance Analysis
- **Lock Scope:** Exactly 1 row per course.
- **Lock Duration:** $< 2.5\text{ms}$ execution time inside PostgreSQL.
- **Queueing Behavior:** When 50 students attempt to register the remaining 10 seats of `INF 202`, their transactions queue on that single row mutex in RAM.
  - Transactions 1–10 succeed, incrementing `enrolled_count` from 140 to 150.
  - Transaction 11 acquires the lock, observes `enrolled_count = 150`, fails the condition, immediately rolls back ($< 0.2\text{ms}$), and returns `409 Course INF 202 is Full`.
  - Transactions 12–50 fail fast in identical sub-millisecond fashion.
  - Database throughput for other courses remains completely unaffected at $> 2,500\text{ QPS}$.

---

## 4. Component Blueprint: Phase 2 Frontend Architecture

### 4.1 Screen 1: Student Dashboard (`DashboardPage.jsx`)
Matching [ui_template.jpeg](file:///c:/Users/PC/Desktop/OneDrive/Documents/focit_lms/ui_template.jpeg) Screen 1:

1. **Academic Hero Banner:**
   - Welcome greeting: `Welcome, John Doe`
   - Programme & Level badge: `Computer Science | Level 200`
   - Academic Term: `2026/2027 Harmattan Semester`
2. **Key Metric Telemetry Cards:**
   - **Registered Courses:** `5` (with BookOpen icon & status)
   - **Completed Units:** `2` (with CheckCircle icon)
   - **GPA:** `3.6` (with GraduationCap gold badge)
3. **Course Overview Section:**
   - Header with `My Courses` and `View All` link.
   - List of enrolled courses:
     - `CSC 204 - Data Structures and Algorithms` (3 Units • 200 Level) → Badge: `In Progress` (Green)
     - `CSC 202 - Object-Oriented Programming` (3 Units • 200 Level) → Badge: `In Progress` (Green)
     - `MTH 101 - Calculus I` (3 Units • 100 Level) → Badge: `Not Started` (Slate)
4. **Upcoming Activities / Deadlines:**
   - Quick access to Moodle upcoming assessments with time-to-deadline tickers.

---

### 4.2 Screen 8: Course Registration & Enrollment (`CourseRegistrationPage.jsx`)
Matching [ui_template.jpeg](file:///c:/Users/PC/Desktop/OneDrive/Documents/focit_lms/ui_template.jpeg) Screen 8:

1. **Stepper Header:**
   - `1 Select Course` → `2 Review` → `3 Confirm`
   - Visual progress indicators with active gold highlight and accessible ARIA step attributes (`aria-current="step"`).
2. **Academic Filters:**
   - Programme: Dropdown (`B.Sc. Computer Science`, `B.Sc. Cyber Security`, `B.Sc. Software Engineering`, `B.Sc. Information Technology`).
   - Level: Dropdown (`100 Level`, `200 Level`, `300 Level`, `400 Level`).
   - Semester: Dropdown (`First Semester`, `Second Semester`).
   - CTA: `View Eligible Courses`.
3. **Course Selection Matrix:**
   - Table of eligible courses with checkboxes, Course Code, Title, Units, Core/Elective badge, Capacity counter (`140/150 seats`).
   - Real-time **Unit Accumulator Meter**:
     - Visual bar indicating current selected units vs min (15) and max (24) bounds.
     - Validation warnings: `Under minimum units (Current: 12, Min: 15)` or `Exceeds maximum units (Max: 24)`.
4. **Step 2 (Review):**
   - Clean summary card grouping Core vs Elective courses, total registered units, and prerequisite verification checkmarks.
5. **Step 3 (Confirm & Lock):**
   - Confirmation checklist.
   - Idempotent submit button with optimistic lock and mutation disabling:
     - Generates client UUID idempotency key: `X-Idempotency-Key: <uuid>`.
     - Displays spinner and disables user interaction during transaction execution.

---

## 5. Unhappy Path & Error Boundary Audit Matrix

| Failure Mode | Detection Vector | UX Recovery & System Invariant |
|:---|:---|:---|
| **Course Reaches Capacity Mid-Registration** | BFF returns `409 Conflict` with `{ code: 'COURSE_FULL', course_code: 'INF 202' }` | Modal displays amber alert: *"INF 202 filled up while you were reviewing. Please select an alternate elective."* Wizard moves student back to Step 1 with existing valid courses preserved. |
| **Accidental Swipe Back on Mobile** | Browser popstate event fires on `?step=3` | Route navigates to `?step=2`. State is read instantly from `sessionStorage` draft without unmounting or losing data. |
| **OS Tab Suspension & Reload** | Document reloads at `/registration` | `useRegistrationWizard` reads namespaced `sessionStorage` draft, validates checksum against cached catalog, and restores active step seamlessly. |
| **Duplicate Submit Double-Click** | User double-clicks "Confirm Registration" | Button is disabled on first click. If a cloned network packet reaches the server, `X-Idempotency-Key` returns the cached 201 response without re-executing SQL. |
| **Unit Limits Violated (<15 or >24)** | Client calculation or API payload validation | Next/Submit button remains disabled with accessible error tooltip explaining requirement. BFF rejects with 422 Unprocessable Entity. |
| **Session Expired During Review** | BFF returns `401 Unauthorized` | Auth interceptor captures draft in `sessionStorage`, prompts silent login modal or redirects to `/login`, preserving draft for re-hydration post-auth. |

---

## 6. Execution Phases for Phase 2

1. **Step 2.1 (Backend Engine):**
   - Add catalog & registration routes in `packages/bff/src/routes/registration.js`.
   - Implement sorted row-level lock transaction with atomic `enrolled_count` increment and outbox event logging.
   - Mount routes in `packages/bff/src/server.js`.
2. **Step 2.2 (Mock Moodle Course Data):**
   - Seed `packages/mock-moodle` with 200-level courses (`CSC 202`, `CSC 204`, `INF 202`, `MTH 101`, `GST 202`).
3. **Step 2.3 (Frontend Custom Hook):**
   - Implement `useRegistrationWizard.js` with `sessionStorage` sandbox, FSM transition guards, and unit accumulator.
4. **Step 2.4 (Frontend Pages):**
   - Refactor `DashboardPage.jsx` to match Screen 1 in `ui_template.jpeg` with live BFF integration.
   - Create `CourseRegistrationPage.jsx` with the 3-step wizard and unit accumulator.
   - Register routes in `packages/frontend/src/router.jsx`.
5. **Step 2.5 (Zero-Trust Validation):**
   - Execute production build and verify responsive behavior across desktop and mobile viewports.


The dark mode is not fully implemented on all pages and section, check it, and also the assignment upload and page itself is not working and showing error
And we want to add a new feature , a digital library where student can access tectbooks, materials, and other digital assets
And also past questions based on their department
Give me the plan