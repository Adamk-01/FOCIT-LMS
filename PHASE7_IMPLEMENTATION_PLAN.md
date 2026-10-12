# Phase 7 Implementation Plan: Course Registration Approval & Senate Clearance Engine

**Author:** Staff Systems Architect & Zero-Trust Client Lead  
**Document Status:** Authorized for Implementation  
**Target Subsystems:** `packages/bff` (State Plane & Concurrency Engine) ↔ `packages/frontend` (Wizard & Advisor Portals)  
**Standard Enforced:** The 8-8-8 Architectural Doctrine (`focit-architect`)  
**Target Milestone:** Phase 7 — Multi-Role Academic Approval Lifecycle & Senate Clearance Engine

---

## 1. Executive Architectural Blueprint

Phase 7 establishes the authoritative Academic Governance Plane for the FOCIT LMS. In Nigerian university administration (Osun State University Senate Regulations), student enrollment is not an immediate self-service insertion into the academic ledger. It is a multi-actor, legally binding administrative state machine governed by the Senate:

$$\text{DRAFT} \xrightarrow[\text{Student}]{\text{Save Draft}} \text{SUBMITTED} \xrightarrow[\text{Level Advisor}]{\text{Review}} \text{ADVISOR\_APPROVED} \xrightarrow[\text{HOD}]{\text{Clear}} \text{HOD\_CLEARED} \xrightarrow[\text{Senate}]{\text{Endorse}} \text{SENATE\_CONFIRMED}$$

$$\text{SUBMITTED} \lor \text{ADVISOR\_APPROVED} \xrightarrow[\text{Advisor / HOD}]{\text{Reject with Remarks}} \text{REJECTED} \xrightarrow[\text{Student}]{\text{Revise}} \text{DRAFT}$$

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT PLANE (React 19)                              │
│                                                                                        │
│   Student Registration Wizard (/registration):                                         │
│   - URL SearchParams (?step=1|2|3) + Nonce-Scoped sessionStorage Sandbox               │
│   - Visual Unit Gauge (15 Min / 24 Max) + Timetable Conflict Detector                  │
│                                                                                        │
│   Advisor Governance Portal (/advisor/registrations):                                  │
│   - Cohort Filter (?level=200&programme=CSC&status=SUBMITTED)                         │
│   - Deterministic Bulk Approval Action + Rejection Modal with Senate Audit Remarks     │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTPS / HttpOnly Cookie + X-Session-Nonce
                                            │ + X-Idempotency-Key
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                COMPUTE PLANE (Express BFF)                             │
│                                                                                        │
│   Tier 1: Payload Cardinality Sanitizer (DISTINCT unnest($1))                         │
│   Tier 2: Relational Set-Difference CTE Engine (R \ E(S) ACID Barrier)                 │
│   Tier 3: Decoupled Credit Bound Gate ([0, 24] Draft vs [15, 24] Submission)           │
│   Tier 4: Dijkstra Topological Resource Sorter (Deadlock-Free Lock DAG)                │
│   Tier 5: Outbox Enqueueing Pipeline (BullMQ Integration Ledger)                       │
└─────────────────────┬──────────────────────────────────────────────┬───────────────────┘
                      │                                              │
                      ▼                                              ▼
┌──────────────────────────────────────────┐    ┌────────────────────────────────────────┐
│             STATE PLANE (PostgreSQL 16)  │    │           CACHE & SESSION (Redis 7)    │
│                                          │    │                                        │
│  - course_registration_batches (FSM)     │    │  Session Registry (session:<sid>)      │
│  - course_registration_items             │    │  Idempotency Cache (TTL: 1h)           │
│  - course_registration_audit_logs        │    │  Capacity Telemetry Cache              │
│  - courses (chk_course_capacity)         │    │                                        │
│  - moodle_outbox                         │    │                                        │
└──────────────────────────────────────────┘    └────────────────────────────────────────┘
```

---

## 2. The Four Architectural Invariants Enforced

### Invariant 1: Ingress Cardinality Sanitization & Set-Difference ($R \setminus \mathcal{E}(S)$)
A client submitting duplicate course identifiers (e.g. `['CSC204', 'CSC204', 'CSC204']`) must not corrupt the cumulative unit math or create duplicate item tuples. The ingress CTE enforces `SELECT DISTINCT unnest($1::varchar[]) AS course_id` at the SQL boundary. The candidate set is then subtracted from the active eligible universe $\mathcal{E}(S)$ in a single database round-trip; any non-empty difference triggers HTTP 422 with a structured breakdown (`ACADEMIC_LEVEL_CEILING_BREACH`, `COURSE_ALREADY_PASSED`, `DEPARTMENTAL_CURRICULUM_VIOLATION`).

### Invariant 2: Lifecycle-Decoupled Cumulative Credit Bounds
Credit bounds are evaluated against the projected semester total ($U_{\text{projected}} = \sum u_i$):
* **State `DRAFT`:** $0 \le U_{\text{projected}} \le 24$ (Allows incremental student drafting while strictly capping capacity hoarding).
* **State `SUBMITTED`:** $15 \le U_{\text{projected}} \le 24$ (Strict Senate floor/ceiling enforcement). If Dean's Waiver is flagged ($\mathcal{W}_{\text{dean}} = \text{TRUE}$), the ceiling expands to $27$ units.
* **Capacity Isolation:** Course quotas (`courses.enrolled_count`) are locked and reserved strictly upon entering `SUBMITTED`. `DRAFT` items consume zero physical seat capacity.

### Invariant 3: Dijkstra Resource Ordering DAG (Zero-Deadlock Invariant)
When an advisor approves 150 students simultaneously, multi-row locks across `course_registration_batches`, `students`, and `courses` must be acquired in **strict ascending lexicographical order** (`ids.sort()`). This guarantees that concurrent transactions form a Directed Acyclic Graph (DAG) in the PostgreSQL lock manager, mathematically eliminating `40P01` deadlocks.

### Invariant 4: Dual-State Partitioning with Ephemeral Nonce Sandbox
Wizard progression lives in URL SearchParams (`?step=1|2|3`), while in-flight course selections are sandboxed inside `sessionStorage` scoped to `focit_reg_draft:${studentId}:${termId}`. The sandbox embeds the login session nonce. If a student logs out or another student logs in on the same browser terminal (campus cybercafé hazard), the sandbox fails the nonce signature and is purged instantly.

---

## 3. Database Schema & Migration Specification

### Migration File: `packages/bff/src/db/migrations/006_course_registration_approval_engine.sql`

```sql
-- ==============================================================================
-- FOCIT LMS - MIGRATION 006: COURSE REGISTRATION APPROVAL & CLEARANCE ENGINE
-- Standard: The 8-8-8 Architectural Doctrine (focit-architect)
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. REGISTRATION BATCH STATUS ENUMERATION
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE registration_batch_status AS ENUM (
        'DRAFT',
        'SUBMITTED',
        'ADVISOR_APPROVED',
        'HOD_CLEARED',
        'SENATE_CONFIRMED',
        'REJECTED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ------------------------------------------------------------------------------
-- 2. COURSE REGISTRATION BATCHES (The Governance State Plane)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_registration_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    semester_id VARCHAR(32) NOT NULL REFERENCES academic_semesters(id) ON DELETE RESTRICT,
    status registration_batch_status NOT NULL DEFAULT 'DRAFT',
    total_units INT NOT NULL DEFAULT 0 CHECK (total_units >= 0 AND total_units <= 30),
    dean_waiver BOOLEAN NOT NULL DEFAULT FALSE,
    dean_waiver_reason TEXT,
    
    -- Actor Signatures & Timestamps
    submitted_at TIMESTAMP WITH TIME ZONE,
    advisor_id VARCHAR(64),
    advisor_approved_at TIMESTAMP WITH TIME ZONE,
    hod_id VARCHAR(64),
    hod_cleared_at TIMESTAMP WITH TIME ZONE,
    senate_id VARCHAR(64),
    senate_confirmed_at TIMESTAMP WITH TIME ZONE,
    
    -- Rejection Metadata
    rejection_remarks TEXT,
    rejected_by VARCHAR(64),
    rejected_at TIMESTAMP WITH TIME ZONE,
    
    -- Optimistic Concurrency Control
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Invariant: Exactly one active registration batch per student per semester
    CONSTRAINT uq_student_semester_batch UNIQUE (student_id, semester_id)
);

CREATE INDEX IF NOT EXISTS idx_reg_batches_advisor_lookup 
ON course_registration_batches (status, semester_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reg_batches_student_term 
ON course_registration_batches (student_id, semester_id);

-- ------------------------------------------------------------------------------
-- 3. COURSE REGISTRATION ITEMS (The Staged Course Selection Set)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_registration_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES course_registration_batches(id) ON DELETE CASCADE,
    course_id VARCHAR(32) NOT NULL REFERENCES courses(course_id) ON DELETE RESTRICT,
    units INT NOT NULL CHECK (units >= 1 AND units <= 6),
    category VARCHAR(16) NOT NULL CHECK (category IN ('CORE', 'ELECTIVE', 'GENERAL')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Invariant: No duplicate courses within a registration batch
    CONSTRAINT uq_batch_course UNIQUE (batch_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_reg_items_batch 
ON course_registration_items (batch_id);

CREATE INDEX IF NOT EXISTS idx_reg_items_course 
ON course_registration_items (course_id);

-- ------------------------------------------------------------------------------
-- 4. COURSE REGISTRATION AUDIT LOGS (Immutable Senate Audit Ledger)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS course_registration_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    batch_id UUID NOT NULL REFERENCES course_registration_batches(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    action VARCHAR(32) NOT NULL, -- 'DRAFT_SAVED', 'SUBMITTED', 'ADVISOR_APPROVED', 'REJECTED', etc.
    previous_status registration_batch_status,
    new_status registration_batch_status NOT NULL,
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_audit_batch 
ON course_registration_audit_logs (batch_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_reg_audit_student 
ON course_registration_audit_logs (student_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 5. SEED INITIAL BATCH FOR TEST STUDENT (student1)
-- ------------------------------------------------------------------------------
INSERT INTO course_registration_batches (
    id, student_id, semester_id, status, total_units, version
)
SELECT 
    'a0000000-0000-0000-0000-000000000001'::uuid,
    'student1',
    '2026_HARMATTAN',
    'DRAFT',
    0,
    1
WHERE EXISTS (SELECT 1 FROM students WHERE student_id = 'student1')
  AND EXISTS (SELECT 1 FROM academic_semesters WHERE id = '2026_HARMATTAN')
ON CONFLICT (student_id, semester_id) DO NOTHING;

COMMIT;
```

---

## 4. Backend-for-Frontend (BFF) Route Specifications

All routes are mounted under `/api/registration` and enforce the `fetchMetadataGuard` and `authMiddleware`.

### 4.1 Route Endpoints Summary

| Endpoint | Method | Role | Idempotency | Description |
| :--- | :--- | :--- | :--- | :--- |
| `/api/registration/current` | `GET` | Student | No | Returns active batch status, candidate catalog, and items |
| `/api/registration/draft` | `PUT` | Student | Header | Idempotent draft update ($0 \le U \le 24$, zero seat locking) |
| `/api/registration/submit` | `POST` | Student | Header | Atomic Set-Difference check, seat capacity locking, status $\to$ `SUBMITTED` |
| `/api/registration/advisor/cohort` | `GET` | Advisor | No | Paginated cohort list filtered by level, programme, status |
| `/api/registration/advisor/batch-approve` | `POST` | Advisor | Header | Dijkstra-ordered multi-student batch approval |
| `/api/registration/advisor/reject` | `POST` | Advisor | Header | Rejection with required remarks; capacity release; status $\to$ `REJECTED` |

---

### 4.2 Controller Implementation: `packages/bff/src/controllers/registrationController.js`

```javascript
/**
 * FOCIT LMS - Academic Registration Controller
 * Enforces the 8-8-8 Architectural Doctrine
 */

import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';

/**
 * 1. PUT /api/registration/draft
 * Idempotently saves or updates student's uncommitted draft courses.
 */
export async function saveRegistrationDraft(req, res) {
  const studentId = req.user.username || req.user.id;
  const { course_ids: rawCourseIds } = req.body || {};
  const idempotencyKey = req.headers['x-idempotency-key'];

  if (!Array.isArray(rawCourseIds)) {
    return res.status(400).json({ error: 'course_ids must be an array', code: 'INVALID_PAYLOAD' });
  }

  // Deduplicate and sanitize payload
  const courseIds = [...new Set(rawCourseIds)].sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Fetch active semester
    const termRes = await client.query(
      `SELECT id, semester_number FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    if (termRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Registration is closed', code: 'REGISTRATION_CLOSED' });
    }
    const semesterId = termRes.rows[0].id;
    const semesterNumber = termRes.rows[0].semester_number;

    // 2. Lock / Fetch Registration Batch
    let batchRes = await client.query(
      `SELECT id, status, version FROM course_registration_batches 
       WHERE student_id = $1 AND semester_id = $2 FOR UPDATE`,
      [studentId, semesterId]
    );

    let batchId;
    let currentVersion = 1;

    if (batchRes.rows.length === 0) {
      const newBatch = await client.query(
        `INSERT INTO course_registration_batches (student_id, semester_id, status, version)
         VALUES ($1, $2, 'DRAFT', 1) RETURNING id, status, version`,
        [studentId, semesterId]
      );
      batchId = newBatch.rows[0].id;
    } else {
      const batch = batchRes.rows[0];
      if (batch.status !== 'DRAFT' && batch.status !== 'REJECTED') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Cannot modify draft while in status ${batch.status}`,
          code: 'REGISTRATION_LOCKED',
        });
      }
      batchId = batch.id;
      currentVersion = batch.version;
    }

    // 3. Compute Draft Units & Verify Ceiling Cap (0 <= U <= 24)
    const coursesRes = await client.query(
      `SELECT course_id, units, category FROM courses WHERE course_id = ANY($1::varchar[]) AND is_active = TRUE`,
      [courseIds]
    );

    const totalUnits = coursesRes.rows.reduce((sum, c) => sum + c.units, 0);
    if (totalUnits > 24) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Draft exceeds maximum allowed ceiling of 24 units (attempted: ${totalUnits})`,
        code: 'MAX_CREDIT_CEILING_EXCEEDED',
      });
    }

    // 4. Atomic Replace of Draft Items
    await client.query(`DELETE FROM course_registration_items WHERE batch_id = $1`, [batchId]);

    if (coursesRes.rows.length > 0) {
      const insertValues = [];
      const params = [batchId];
      coursesRes.rows.forEach((c, idx) => {
        const offset = idx * 3 + 2;
        params.push(c.course_id, c.units, c.category);
        insertValues.push(`($1, $${offset}, $${offset + 1}, $${offset + 2})`);
      });

      await client.query(
        `INSERT INTO course_registration_items (batch_id, course_id, units, category)
         VALUES ${insertValues.join(', ')}`,
        params
      );
    }

    // 5. Update Batch Total Units & Monotonic Version
    const updatedBatch = await client.query(
      `UPDATE course_registration_batches 
       SET total_units = $1, status = 'DRAFT', version = version + 1, updated_at = NOW()
       WHERE id = $2 RETURNING id, status, total_units, version, updated_at`,
      [totalUnits, batchId]
    );

    // 6. Audit Trail Logging
    await client.query(
      `INSERT INTO course_registration_audit_logs (batch_id, student_id, actor_id, action, previous_status, new_status, metadata)
       VALUES ($1, $2, $2, 'DRAFT_SAVED', 'DRAFT', 'DRAFT', $3)`,
      [batchId, studentId, JSON.stringify({ course_ids: courseIds, total_units: totalUnits })]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'SUCCESS',
      message: 'Registration draft updated successfully',
      batch: updatedBatch.rows[0],
      items: coursesRes.rows,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, studentId }, '[Registration] Failed to save draft');
    return res.status(500).json({ error: 'Internal database error saving draft', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
}

/**
 * 2. POST /api/registration/submit
 * Atomically validates Set-Difference CTE, enforces credit bounds, locks seats,
 * and advances batch status to 'SUBMITTED'.
 */
export async function submitRegistration(req, res) {
  const studentId = req.user.username || req.user.id;
  const { course_ids: rawCourseIds } = req.body || {};
  const idempotencyKey = req.headers['x-idempotency-key'];

  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'Missing required X-Idempotency-Key header for state submission',
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
  }

  if (!Array.isArray(rawCourseIds) || rawCourseIds.length === 0) {
    return res.status(400).json({
      error: 'Payload must contain a non-empty array of course_ids',
      code: 'INVALID_PAYLOAD',
    });
  }

  // Dijkstra Lexicographical Sort on Course IDs
  const courseIds = [...new Set(rawCourseIds)].sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Resolve Active Term
    const termRes = await client.query(
      `SELECT id, semester_number FROM academic_semesters WHERE is_registration_open = TRUE LIMIT 1`
    );
    if (termRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Registration is closed', code: 'REGISTRATION_CLOSED' });
    }
    const semesterId = termRes.rows[0].id;
    const semesterNumber = termRes.rows[0].semester_number;

    // 2. Lock Registration Batch & Student Tuple
    const batchRes = await client.query(
      `SELECT id, status, version, dean_waiver FROM course_registration_batches 
       WHERE student_id = $1 AND semester_id = $2 FOR UPDATE`,
      [studentId, semesterId]
    );

    if (batchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No active registration draft found', code: 'BATCH_NOT_FOUND' });
    }

    const batch = batchRes.rows[0];
    if (batch.status !== 'DRAFT' && batch.status !== 'REJECTED') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Registration is already in state ${batch.status}`,
        code: 'REGISTRATION_ALREADY_COMMITTED',
      });
    }

    // 3. Relational Set-Difference CTE Engine with DISTINCT Ingress Guard
    const cteRes = await client.query(
      `
      WITH 
      candidate_set AS (
        SELECT DISTINCT unnest($1::varchar[]) AS course_id
      ),
      student_context AS (
        SELECT s.student_id, s.level AS student_level, p.department_id, s.programme_id
        FROM students s
        JOIN programmes p ON p.id = s.programme_id
        WHERE s.student_id = $2
      ),
      eligible_universe AS (
        SELECT c.course_id, c.units, c.category, c.max_capacity, c.enrolled_count
        FROM courses c
        CROSS JOIN student_context sc
        WHERE c.is_active = TRUE
          AND c.semester_number = $3
          AND c.level <= sc.student_level
          AND (
            c.department_id = sc.department_id
            OR c.category IN ('GENERAL', 'ELECTIVE')
          )
          AND NOT EXISTS (
            SELECT 1 FROM enrollments e
            WHERE e.student_id = sc.student_id
              AND e.course_id = c.course_id
              AND e.status = 'COMPLETED'
              AND (e.grade >= 40.00 OR e.grade IS NULL)
          )
      ),
      set_difference_violations AS (
        SELECT 
          cs.course_id,
          CASE 
            WHEN c.course_id IS NULL THEN 'COURSE_NOT_FOUND'
            WHEN c.is_active = FALSE THEN 'COURSE_INACTIVE'
            WHEN c.semester_number != $3 THEN 'SEMESTER_MISMATCH'
            WHEN c.level > sc.student_level THEN 'ACADEMIC_LEVEL_CEILING_BREACH'
            WHEN EXISTS (
              SELECT 1 FROM enrollments e 
              WHERE e.student_id = sc.student_id 
                AND e.course_id = cs.course_id 
                AND e.status = 'COMPLETED' 
                AND (e.grade >= 40.00 OR e.grade IS NULL)
            ) THEN 'COURSE_ALREADY_PASSED'
            ELSE 'DEPARTMENTAL_CURRICULUM_VIOLATION'
          END AS violation_code
        FROM candidate_set cs
        CROSS JOIN student_context sc
        LEFT JOIN courses c ON c.course_id = cs.course_id
        WHERE cs.course_id NOT IN (SELECT course_id FROM eligible_universe)
      )
      SELECT course_id, violation_code FROM set_difference_violations;
      `,
      [courseIds, studentId, semesterNumber]
    );

    // Fail-fast on any Set-Difference violation
    if (cteRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Registration contains ineligible courses',
        code: 'ELIGIBILITY_VIOLATION',
        violations: cteRes.rows,
      });
    }

    // 4. Cumulative Credit Bounds Check
    const validCourses = await client.query(
      `SELECT course_id, units, category FROM courses WHERE course_id = ANY($1::varchar[])`,
      [courseIds]
    );

    const projectedUnits = validCourses.rows.reduce((sum, c) => sum + c.units, 0);
    const maxCeiling = batch.dean_waiver ? 27 : 24;

    if (projectedUnits < 15) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Senate credit floor violation: Minimum 15 units required (selected: ${projectedUnits})`,
        code: 'MIN_CREDIT_FLOOR_VIOLATION',
        projectedUnits,
      });
    }

    if (projectedUnits > maxCeiling) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Credit ceiling violation: Maximum ${maxCeiling} units exceeded (selected: ${projectedUnits})`,
        code: 'MAX_CREDIT_CEILING_EXCEEDED',
        projectedUnits,
        maxCeiling,
      });
    }

    // 5. Dijkstra Row-Lock Acquisition on Courses to Prevent Over-Enrollment Race Conditions
    const lockedCourses = await client.query(
      `SELECT course_id, max_capacity, enrolled_count 
       FROM courses 
       WHERE course_id = ANY($1::varchar[])
       ORDER BY course_id ASC
       FOR UPDATE`,
      [courseIds]
    );

    for (const c of lockedCourses.rows) {
      if (c.enrolled_count >= c.max_capacity) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Course ${c.course_id} has reached maximum seat capacity (${c.max_capacity})`,
          code: 'COURSE_CAPACITY_EXCEEDED',
          course_id: c.course_id,
        });
      }
    }

    // 6. Atomic Capacity Increment
    await client.query(
      `UPDATE courses 
       SET enrolled_count = enrolled_count + 1 
       WHERE course_id = ANY($1::varchar[])`,
      [courseIds]
    );

    // 7. Update Registration Items
    await client.query(`DELETE FROM course_registration_items WHERE batch_id = $1`, [batch.id]);

    const insertValues = [];
    const params = [batch.id];
    validCourses.rows.forEach((c, idx) => {
      const offset = idx * 3 + 2;
      params.push(c.course_id, c.units, c.category);
      insertValues.push(`($1, $${offset}, $${offset + 1}, $${offset + 2})`);
    });

    await client.query(
      `INSERT INTO course_registration_items (batch_id, course_id, units, category)
       VALUES ${insertValues.join(', ')}`,
      params
    );

    // 8. Advance State to SUBMITTED
    const updatedBatch = await client.query(
      `UPDATE course_registration_batches 
       SET status = 'SUBMITTED', total_units = $1, submitted_at = NOW(), version = version + 1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [projectedUnits, batch.id]
    );

    // 9. Enqueue Audit Trail & Outbox Notification
    await client.query(
      `INSERT INTO course_registration_audit_logs (batch_id, student_id, actor_id, action, previous_status, new_status, metadata)
       VALUES ($1, $2, $2, 'SUBMITTED', $3, 'SUBMITTED', $4)`,
      [batch.id, studentId, batch.status, JSON.stringify({ courses: courseIds, total_units: projectedUnits })]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'SUCCESS',
      message: 'Course registration successfully submitted for Level Advisor endorsement',
      batch: updatedBatch.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, studentId }, '[Registration] Failed to submit registration');
    return res.status(500).json({ error: 'Failed to commit registration', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
}

/**
 * 3. POST /api/registration/advisor/batch-approve
 * Level Advisor cohort bulk approval using Dijkstra resource ordering.
 */
export async function batchApproveRegistrations(req, res) {
  const advisorId = req.user.username || req.user.id;
  const { batch_ids: rawBatchIds } = req.body || {};

  if (!Array.isArray(rawBatchIds) || rawBatchIds.length === 0) {
    return res.status(400).json({ error: 'batch_ids must be a non-empty array', code: 'INVALID_PAYLOAD' });
  }

  // Dijkstra Lexicographical Sort on UUIDs
  const batchIds = [...new Set(rawBatchIds)].sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock Target Registration Batches in Lexicographical Order
    const lockedBatches = await client.query(
      `SELECT id, student_id, semester_id, status, total_units 
       FROM course_registration_batches 
       WHERE id = ANY($1::uuid[])
       ORDER BY id ASC
       FOR UPDATE`,
      [batchIds]
    );

    const validSubmissions = lockedBatches.rows.filter(b => b.status === 'SUBMITTED');
    if (validSubmissions.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'No candidate batches currently in SUBMITTED state for approval',
        code: 'NO_VALID_BATCHES',
      });
    }

    const validBatchIds = validSubmissions.map(b => b.id);
    const studentIds = [...new Set(validSubmissions.map(b => b.student_id))].sort();

    // 2. Lock Student Tuples in Lexicographical Order
    await client.query(
      `SELECT student_id FROM students WHERE student_id = ANY($1::varchar[]) ORDER BY student_id ASC FOR UPDATE`,
      [studentIds]
    );

    // 3. Batch Update Status to ADVISOR_APPROVED
    await client.query(
      `UPDATE course_registration_batches 
       SET status = 'ADVISOR_APPROVED', advisor_id = $1, advisor_approved_at = NOW(), version = version + 1, updated_at = NOW()
       WHERE id = ANY($2::uuid[])`,
      [advisorId, validBatchIds]
    );

    // 4. Commit Authoritative Enrollments in Bulk
    await client.query(
      `
      INSERT INTO enrollments (student_id, course_id, semester_id, status)
      SELECT 
        b.student_id,
        cri.course_id,
        b.semester_id,
        'ENROLLED'
      FROM course_registration_items cri
      JOIN course_registration_batches b ON b.id = cri.batch_id
      WHERE b.id = ANY($1::uuid[])
      ON CONFLICT (student_id, course_id, semester_id) 
      DO UPDATE SET status = 'ENROLLED';
      `,
      [validBatchIds]
    );

    // 5. Enqueue Moodle Outbox Events for Upstream Sync
    await client.query(
      `
      INSERT INTO moodle_outbox (event_type, student_focit_id, moodle_course_id, payload, idempotency_key)
      SELECT 
        'ENROLLMENT_SYNC',
        b.student_id,
        COALESCE(c.moodle_course_id, 0),
        jsonb_build_object('student_id', b.student_id, 'course_code', c.code, 'semester_id', b.semester_id),
        'moodle_sync:' || b.student_id || ':' || cri.course_id || ':' || b.semester_id
      FROM course_registration_items cri
      JOIN course_registration_batches b ON b.id = cri.batch_id
      JOIN courses c ON c.course_id = cri.course_id
      WHERE b.id = ANY($1::uuid[])
      ON CONFLICT (idempotency_key) DO NOTHING;
      `,
      [validBatchIds]
    );

    // 6. Write Bulk Audit Logs
    const auditValues = validSubmissions.map((b, i) => {
      return `('${b.id}', '${b.student_id}', '${advisorId}', 'ADVISOR_APPROVED', 'SUBMITTED', 'ADVISOR_APPROVED')`;
    });
    await client.query(
      `INSERT INTO course_registration_audit_logs (batch_id, student_id, actor_id, action, previous_status, new_status)
       VALUES ${auditValues.join(', ')}`
    );

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'SUCCESS',
      approvedCount: validBatchIds.length,
      approvedBatchIds: validBatchIds,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, advisorId }, '[Advisor] Bulk approval transaction failed');
    return res.status(500).json({ error: 'Bulk approval transaction failed', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
}

/**
 * 4. POST /api/registration/advisor/reject
 * Rejects a submitted batch, records Senate audit remarks, and releases seat capacity.
 */
export async function rejectRegistration(req, res) {
  const advisorId = req.user.username || req.user.id;
  const { batch_id: batchId, remarks } = req.body || {};

  if (!batchId || !remarks || remarks.trim().length < 5) {
    return res.status(400).json({
      error: 'batch_id and descriptive remarks (minimum 5 characters) are required for rejection',
      code: 'INVALID_REJECTION_PAYLOAD',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Lock Target Batch
    const batchRes = await client.query(
      `SELECT id, student_id, status FROM course_registration_batches WHERE id = $1 FOR UPDATE`,
      [batchId]
    );

    if (batchRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Registration batch not found', code: 'BATCH_NOT_FOUND' });
    }

    const batch = batchRes.rows[0];
    if (batch.status !== 'SUBMITTED' && batch.status !== 'ADVISOR_APPROVED') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: `Cannot reject batch in status ${batch.status}`,
        code: 'INVALID_STATE_TRANSITION',
      });
    }

    // 2. Fetch Associated Course IDs to Release Seat Capacity
    const itemsRes = await client.query(
      `SELECT course_id FROM course_registration_items WHERE batch_id = $1`,
      [batchId]
    );
    const courseIds = itemsRes.rows.map(r => r.course_id).sort();

    // 3. Decrement Course Capacities
    if (courseIds.length > 0) {
      await client.query(
        `UPDATE courses 
         SET enrolled_count = GREATEST(0, enrolled_count - 1) 
         WHERE course_id = ANY($1::varchar[])`,
        [courseIds]
      );
    }

    // 4. Transition Batch State to REJECTED
    await client.query(
      `UPDATE course_registration_batches 
       SET status = 'REJECTED', rejection_remarks = $1, rejected_by = $2, rejected_at = NOW(), version = version + 1, updated_at = NOW()
       WHERE id = $3`,
      [remarks.trim(), advisorId, batchId]
    );

    // 5. Audit Trail Logging
    await client.query(
      `INSERT INTO course_registration_audit_logs (batch_id, student_id, actor_id, action, previous_status, new_status, remarks)
       VALUES ($1, $2, $3, 'REJECTED', $4, 'REJECTED', $5)`,
      [batchId, batch.student_id, advisorId, batch.status, remarks.trim()]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      status: 'SUCCESS',
      message: 'Registration returned to student with remarks. Course capacities released.',
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, batchId }, '[Advisor] Rejection transaction failed');
    return res.status(500).json({ error: 'Failed to process rejection', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
}
```

---

## 5. React 19 Client Component Tree & UX Architecture

### 5.1 Component Hierarchy

```
packages/frontend/src/
├── pages/
│   ├── CourseRegistrationPage.jsx         # Multi-step Student Registration Wizard
│   └── LevelAdvisorDashboardPage.jsx      # Advisor Cohort Review & Bulk Approval
├── components/
│   ├── registration/
│   │   ├── WizardStepper.jsx              # URL-synced breadcrumb stepper (?step=1|2|3)
│   │   ├── CourseMatrixTable.jsx          # Core vs Elective selection with instant unit tally
│   │   ├── UnitGaugeMeter.jsx             # Visual SVG gauge (15 Floor / 24 Ceiling indicator)
│   │   ├── TimetableConflictAlert.jsx     # Overlapping RRULE clash detector
│   │   ├── SenateSignOffCard.jsx          # Confirmation & digital pledge sign-off
│   │   └── RegistrationStatusBanner.jsx   # Dynamic status pill (Draft/Submitted/Approved/Rejected)
│   └── advisor/
│       ├── CohortFilterBar.jsx            # Level & Programme dropdowns + Status facet pills
│       ├── CohortRegistrationTable.jsx    # Multi-select batch rows with sortable unit counts
│       ├── BulkApprovalFloatingBar.jsx    # Sticky bottom bar with Dijkstra "Approve Selected"
│       └── RejectionRemarksModal.jsx      # Accessible <dialog> requiring Senate rationale
└── hooks/
    ├── useCourseRegistrationDraft.js      # Session-sandboxed dual-state management hook
    └── useAdvisorCohort.js                # TanStack Query SWR hook with optimistic cache updates
```

---

### 5.2 The Dual-State Sandboxing Hook (`useCourseRegistrationDraft.js`)

```javascript
/**
 * Zero-Trust Session Sandbox Hook
 * Enforces Dual-State Partitioning with Ephemeral Nonce Signature Check
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function useCourseRegistrationDraft(termId = '2026_HARMATTAN') {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const studentId = user?.username || 'student1';
  const activeNonce = sessionStorage.getItem('session_nonce') || '';

  const sandboxKey = `focit_reg_draft:${studentId}:${termId}`;

  // 1. Navigation Step Pointer in URL
  const currentStep = parseInt(searchParams.get('step') || '1', 10);
  const setStep = useCallback((step) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('step', String(step));
      return next;
    }, { replace: false });
  }, [setSearchParams]);

  // 2. In-Flight Selection State Hydration
  const [selectedCourseIds, setSelectedCourseIds] = useState(() => {
    try {
      const raw = sessionStorage.getItem(sandboxKey);
      if (!raw) return [];
      const envelope = JSON.parse(raw);
      // Quarantined Nonce Validation: Protect against shared terminal pollution
      if (envelope.sessionNonce !== activeNonce || envelope.studentId !== studentId) {
        sessionStorage.removeItem(sandboxKey);
        return [];
      }
      return envelope.selectedCourseIds || [];
    } catch {
      return [];
    }
  });

  // 3. Synced Persistence to Scoped sessionStorage
  useEffect(() => {
    if (selectedCourseIds.length === 0) return;
    const envelope = {
      studentId,
      termId,
      sessionNonce: activeNonce,
      selectedCourseIds,
      updatedAt: Date.now(),
    };
    sessionStorage.setItem(sandboxKey, JSON.stringify(envelope));
  }, [selectedCourseIds, studentId, termId, activeNonce, sandboxKey]);

  // 4. Clear Sandbox on Final Commitment
  const clearDraft = useCallback(() => {
    sessionStorage.removeItem(sandboxKey);
    setSelectedCourseIds([]);
  }, [sandboxKey]);

  return {
    currentStep,
    setStep,
    selectedCourseIds,
    setSelectedCourseIds,
    clearDraft,
  };
}
```

---

## 6. Verification Protocol & Comprehensive Test Plan

### 6.1 Automated Doctrine Unit Suite (`packages/bff/test/phase7_registration_doctrine.test.js`)

Validates all physical state constraints under `node --test`:
1. **Sanitized Cardinality Invariant:** `candidate_set` with duplicate IDs (`['CSC204', 'CSC204']`) evaluates distinct count and correct unit math.
2. **Relational Set-Difference Invariant:** Submitting a 400-level course while registered as 200-level aborts with `ACADEMIC_LEVEL_CEILING_BREACH`.
3. **Completed Course Exclusion Invariant:** Submitting a passed course (`grade >= 40.00`) aborts with `COURSE_ALREADY_PASSED`.
4. **Decoupled Credit Bounds Invariant:**
   - `PUT /draft` with 12 units succeeds (status `DRAFT`).
   - `POST /submit` with 12 units fails with `MIN_CREDIT_FLOOR_VIOLATION`.
   - `POST /submit` with 26 units fails with `MAX_CREDIT_CEILING_EXCEEDED`.
   - `POST /submit` with 26 units and `dean_waiver = TRUE` succeeds.
5. **Dijkstra Resource Ordering DAG:** Simultaneous approval bursts of overlapping cohort subsets execute with zero `40P01` deadlocks across 50 concurrent transactions.
6. **Capacity Reservation Invariant:** Seat capacity increments on `SUBMITTED`, decrements on `REJECTED`, and never increments on `DRAFT`.

---

### 6.2 Browser Subagent Verification Matrix

| Actor | Test Journey | Pass Criteria |
| :--- | :--- | :--- |
| **Student** | Draft Course Selection | Select 3 courses (9 units) $\to$ Save Draft $\to$ Toast confirmation, Lock badge `DRAFT`, capacity unreserved |
| **Student** | Floor Barrier Enforcement | Attempt submit with 9 units $\to$ Rejected with inline alert: "Minimum 15 units required" |
| **Student** | Full Submission Journey | Select 6 courses (18 units) $\to$ Step 2 (Review) $\to$ Step 3 (Sign) $\to$ Submit $\to$ Status pill `SUBMITTED` |
| **Advisor** | Cohort Review Portal | Log in as advisor $\to$ View cohort table $\to$ Filter by `SUBMITTED` $\to$ Student batch visible |
| **Advisor** | Rejection with Remarks | Select batch $\to$ Click Reject $\to$ Enter remarks "Take core GST202" $\to$ Student status updates to `REJECTED` |
| **Advisor** | Dijkstra Batch Approval | Select 10 student submissions $\to$ Click "Approve Selected" $\to$ Enrollments created, Moodle outbox events enqueued |

---

## 7. Execution Timeline & Task Sequencing

1. **Step 1 (State Plane):** Execute database migration `006_course_registration_approval_engine.sql` and update seed runner.
2. **Step 2 (Compute Plane):** Implement route controllers and wire endpoints into `packages/bff/src/routes/registration.js`.
3. **Step 3 (Doctrinal Tests):** Author and verify `phase7_registration_doctrine.test.js` passing 100% green.
4. **Step 4 (Client Plane):** Build `useCourseRegistrationDraft`, update `CourseRegistrationPage.jsx`, and create `LevelAdvisorDashboardPage.jsx`.
5. **Step 5 (E2E Integration):** Run interactive browser subagent validating end-to-end multi-role approval workflow.
