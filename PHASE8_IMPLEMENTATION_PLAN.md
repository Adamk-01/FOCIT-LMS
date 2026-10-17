# Phase 8 Implementation Plan: Real-Time Notification Engine & Production Hardening

**Author:** Staff Systems Architect & Zero-Trust Client Lead  
**Document Status:** Defended & Finalized for Implementation  
**Target Subsystems:** `packages/bff` (Authoritative Notification Ledger & SSE Socket Registry) ↔ `packages/frontend` (Infinite Keyset Cache & Viewport Containment)  
**Standard Enforced:** The 8-8-8 Architectural Doctrine (`focit-architect`)  
**Target Milestone:** Phase 8 — Real-Time Notification Engine, Event Fan-Out & Production Readiness Hardening  

---

## 1. Executive Architectural Blueprint

In an academic institution like Osun State University (UNIOSUN), asynchronous events dictate student progression:
1. **Academic Governance Transitions:** Level Advisor approval, Senate clearance, or registration rejection with required remedial remarks.
2. **Pedagogical Telemetry:** Quiz deadlines, new lecture notes uploaded to Moodle, continuous assessment release.
3. **Identity & Security Alerts:** Credential rotation prompts, password change mandates, anomalous login attempts.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT PLANE (React 19)                              │
│                                                                                        │
│   Topbar Accessible Notification Trigger:                                              │
│   - Live Unread Counter Badge (single source of truth in React Query meta cache)        │
│   - ARIA-compliant dialog/drawer trigger (`aria-expanded`, `aria-controls`)            │
│                                                                                        │
│   Zero-Trust Notification Panel / Slide-Over Drawer:                                   │
│   - Keyset-based Infinite Query (`useInfiniteQuery` via TanStack React Query)          │
│   - State Hierarchy: URL-synced tab filter (?notif_tab=all|unread|academic|security)   │
│   - Viewport Containment: Quarantined inside GPU compositor (`100dvh`, isolate)        │
│   - Snapshot-Guarded Mutation: Read-all transmits `read_up_to` timestamp barrier       │
│   - Real-Time Ingress: EventSource with Lookback Reconnect & Set-based dedupe          │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTPS / HttpOnly Cookie + X-Session-Nonce
                                            │ SSE /api/student/notifications/stream
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                COMPUTE PLANE (Express BFF)                             │
│                                                                                        │
│   Tier 1: Tenant Security Boundary (student_id derived strictly from verified JWT)     │
│   Tier 2: Monotonic Keyset Cursor Pagination (sequence_id < $cursor)                   │
│   Tier 3: Snapshot-Bounded Read-All (WHERE student_id = $1 AND created_at <= $barrier) │
│   Tier 4: Connection Registry Map<string, Set<Response>> (Zero EventEmitter leaks)     │
│   Tier 5: EventSource SSE Stream with Monotonic Sequence Catch-Up & 15s Heartbeat      │
│   Tier 6: Transactional Outbox / Post-Commit Emit (Guarantees ACID Visibility)         │
└─────────────────────┬──────────────────────────────────────────────┬───────────────────┘
                      │                                              │
                      ▼                                              ▼
┌──────────────────────────────────────────┐    ┌────────────────────────────────────────┐
│             STATE PLANE (PostgreSQL 16)  │    │           CACHE & REALTIME (Redis 7)   │
│                                          │    │                                        │
│  - student_notifications (Audit Ledger)  │    │  Redis Channel: notification_events    │
│  - sequence_id (BIGSERIAL Monotonic Seq) │    │  Multiplexed Singleton Subscriber      │
│  - idx_notif_student_unread_seq (Partial)│    │  Direct Socket Registry Dispatch       │
│  - pg_advisory_xact_lock (Gap Immunity)  │    │  Post-Commit Emission Barrier          │
└──────────────────────────────────────────┘    └────────────────────────────────────────┘
```

---

## 2. Invariant Defense: Concurrency, Indirection & Out-of-Order Commits

### Reality 1: Strictly Monotonic Sequence Catch-Up (`sequence_id BIGSERIAL`)
* **The Vulnerability:** `DEFAULT gen_random_uuid()` produces a UUIDv4, which is non-monotonic and cryptographically distributed across 128-bit space. Lexicographically evaluating `id > $lastEventId` is mathematically flawed and corrupts connection recovery upon network reconnection.
* **The Monotonic Architecture:** 
  The schema implements a dual-identifier strategy:
  1. `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`: Externally addressable, cryptographically unguessable entity ID for REST mutations and client key identity.
  2. `sequence_id BIGSERIAL NOT NULL UNIQUE`: Strictly monotonic, 64-bit integer engine sequence.
* **The Wire Contract:** The SSE stream emits `id: ${notification.sequence_id}`.

### Reality 2: Partial Indexing Against Hidden $\mathcal{O}(N)$ Scans
* **The Vulnerability:** A composite index `(student_id, created_at DESC, id DESC)` forces PostgreSQL to linearly scan backward through thousands of historical read rows when filtering `is_read = FALSE`, thrashing database I/O during registration bursts.
* **The Partial Index Strategy:**
  In production, $\ge 98\%$ of notifications in the ledger are historical read records. The active unread set is tiny ($0 \le N_{\text{unread}} \le 20$).
  We establish a dedicated **PostgreSQL Partial Index**:
  ```sql
  CREATE INDEX idx_notif_student_unread_seq 
  ON student_notifications (student_id, sequence_id DESC) 
  WHERE is_read = FALSE;
  ```
  * **Zero Read-Row Storage:** Contains only unread records. Fits entirely within L1 cache / shared buffers.
  * **Instantaneous Seek:** The unread query `WHERE student_id = $1 AND is_read = FALSE ORDER BY sequence_id DESC` executes an immediate index-only scan, bypassing historical read data entirely ($\mathcal{O}(1)$ performance).
  * **Write Efficiency:** Mutations to `is_read = TRUE` cleanly evict the tuple from the partial index without bloating the table index.
  * **General Index for "All" Tab:**
  ```sql
  CREATE INDEX idx_notif_student_all_seq 
  ON student_notifications (student_id, sequence_id DESC);
  ```

### Reality 3: Zero-Leak SSE Socket Registry (`Map<string, Set<Response>>`)
* **The Vulnerability:** Attaching per-client handlers to a global Node.js `EventEmitter` trips `MaxListenersExceededWarning` when students open multiple tabs, and risks uncollected closures if sockets drop abruptly.
* **The Connection Registry Pattern:**
  We eliminate `EventEmitter` in favor of an explicit **Socket Connection Registry**:
  ```javascript
  const activeStudentSockets = new Map(); // studentId -> Set<res>
  ```
  1. **Direct Fan-Out:** When Redis receives a message from `notification_events`, it executes an $\mathcal{O}(1)$ Map lookup and writes directly to active response streams.
  2. **Bounded Connection Concurrency:** If `sockets.size >= 10`, incoming streams are rejected with HTTP 429 (`Too Many Concurrent Streams`).
  3. **Deterministic Teardown:** On `req.on('close')`, unhooks socket and prunes empty student entries from V8 memory.

### Reality 4: The Out-of-Order Commit Hole (`nextval()` Sequence Gap Immunity)
* **The Vulnerability:** PostgreSQL `nextval()` allocates sequence numbers atomically outside transaction boundaries. If Transaction A takes `sequence_id = 100` and Transaction B takes `101`, but B commits before A, a client fetching during that millisecond advances `Last-Event-ID = 101`. When A commits a millisecond later, the client will never look back for 100, dropping the notification permanently.
* **The Triad Architectural Defense:**
  1. **Per-Student Transactional Advisory Lock (`pg_advisory_xact_lock`):**
     During notification creation inside the write transaction, we acquire:
     ```sql
     SELECT pg_advisory_xact_lock(hashtext('notif_lock:' || $student_id));
     ```
     Because this lock is scoped specifically to the target student and held until transaction commit/rollback, concurrent transactions generating notifications for the *same student* are serialized in commit order. Transaction B cannot pull `sequence_id = 101` and commit before Transaction A (100) commits.
     Different students (`student1`, `student2`) hash to distinct 64-bit integer lock keys and run 100% in parallel with zero lock contention.
  2. **Post-Commit Redis Emission Barrier:**
     Redis messages are NEVER published inside the database transaction block. They are emitted strictly in a `client.on('commit')` post-commit callback (or via BullMQ outbox worker), guaranteeing that when Redis receives the event, the record is physically committed and visible to `READ COMMITTED` queries.
  3. **Bounded Lookback Catch-Up Window with UUID Deduplication:**
     When a client reconnects with `Last-Event-ID: $lastEventSeq`, the catch-up query does not execute a hard strict cut `> $lastEventSeq`. It queries:
     ```sql
     SELECT id, sequence_id, category, priority, title, body, action_url, metadata, is_read, created_at
     FROM student_notifications
     WHERE student_id = $1 
       AND sequence_id > GREATEST(0::bigint, $2::bigint - 10)
     ORDER BY sequence_id ASC
     LIMIT 100;
     ```
     The client's connection layer receives the catch-up array and passes each item through an in-memory `Set<UUID>`. Any duplicate items from the 10-sequence lookback safety window are discarded in $\mathcal{O}(1)$ time, while any lagging commit is immediately captured and reconciled into the UI.

---

## 3. Database Schema: Migration 008

### File: `packages/bff/src/db/migrations/008_notifications_and_audit_stream.sql`

```sql
BEGIN;

-- 1. Notification Category Enumeration
DO $$ BEGIN
    CREATE TYPE notification_category AS ENUM (
        'REGISTRATION',
        'ACADEMIC',
        'ASSESSMENT',
        'SECURITY',
        'SYSTEM'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Notification Priority Enumeration
DO $$ BEGIN
    CREATE TYPE notification_priority AS ENUM (
        'LOW',
        'NORMAL',
        'HIGH',
        'URGENT'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Student Notifications Ledger Table
CREATE TABLE IF NOT EXISTS student_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id BIGSERIAL NOT NULL UNIQUE,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    category notification_category NOT NULL DEFAULT 'ACADEMIC',
    priority notification_priority NOT NULL DEFAULT 'NORMAL',
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    action_url VARCHAR(512),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- 4. Monotonic Keyset & Partial Indexes
CREATE INDEX IF NOT EXISTS idx_notif_student_all_seq 
ON student_notifications (student_id, sequence_id DESC);

CREATE INDEX IF NOT EXISTS idx_notif_student_unread_seq 
ON student_notifications (student_id, sequence_id DESC) 
WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_notif_student_category_seq 
ON student_notifications (student_id, category, sequence_id DESC);

-- 5. Realistic Seed Data for Seed Student (student1)
INSERT INTO student_notifications (
    id, student_id, category, priority, title, body, action_url, metadata, is_read, created_at
)
VALUES
    (
        '10000000-0000-0000-0000-000000000001'::uuid,
        'student1',
        'REGISTRATION',
        'HIGH',
        'Course Registration Submitted',
        'Your 2026/2027 Rain Semester registration batch (21 Units) has been transmitted to Level Advisor Dr. A. O. Adeleke for review.',
        '/registration',
        '{"batch_status": "SUBMITTED", "units": 21}'::jsonb,
        FALSE,
        NOW() - INTERVAL '2 hours'
    ),
    (
        '10000000-0000-0000-0000-000000000002'::uuid,
        'student1',
        'ASSESSMENT',
        'HIGH',
        'Upcoming Assessment: CSC 204 Quiz 1',
        'Quiz 1 — Arrays, Pointers and Memory Architecture is scheduled to commence on 15 May 2026 at 10:00 AM.',
        '/courses/1/quizzes',
        '{"course_code": "CSC 204", "due_date": "2026-05-15T10:00:00Z"}'::jsonb,
        FALSE,
        NOW() - INTERVAL '5 hours'
    ),
    (
        '10000000-0000-0000-0000-000000000003'::uuid,
        'student1',
        'ACADEMIC',
        'NORMAL',
        'New Lecture Material: PHY 102 Module 3',
        'Dr. Babatunde uploaded "Electromagnetic Induction & Faraday Laws.pdf" to the course repository.',
        '/courses/1/materials',
        '{"course_code": "PHY 102", "material_type": "PDF"}'::jsonb,
        TRUE,
        NOW() - INTERVAL '1 day'
    ),
    (
        '10000000-0000-0000-0000-000000000004'::uuid,
        'student1',
        'SECURITY',
        'NORMAL',
        'Security Audit: Login Session Verified',
        'New session initialized from IP 192.168.1.104 with Chrome/Edge on Windows 11.',
        '/profile',
        '{"ip": "192.168.1.104", "device": "Windows"}'::jsonb,
        TRUE,
        NOW() - INTERVAL '3 days'
    );

COMMIT;
```

---

## 4. Backend BFF API Specification (`packages/bff/src/routes/notifications.js`)

1. **`GET /api/student/notifications`:**
   * Keyset query with `?cursor=<sequence_id>&limit=20&unread_only=false&category=ALL`.
   * Unread scalar computed via partial index: `SELECT COUNT(*) FROM student_notifications WHERE student_id = $1 AND is_read = FALSE`.
2. **`GET /api/student/notifications/stream`:**
   * Managed via `activeStudentSockets` Map registry.
   * Monotonic `sequence_id` catch-up via `Last-Event-ID` with bounded 10-sequence lookback.
3. **`PATCH /api/student/notifications/:id/read`:**
   * Atomic student-scoped update.
4. **`POST /api/student/notifications/read-all`:**
   * Snapshot-guarded update with `read_up_to` timestamp.
