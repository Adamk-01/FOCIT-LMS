# Phase 4 Implementation Plan: Moodle Assessment & Social Modules
**Author:** Staff Systems Architect & Zero-Trust Client Lead  
**Document Status:** Pending Authorization  
**Target Screens:** Screen 4 (Quiz Attempt), Screen 6 (Gradebook), Screen 7 (Discussion Forum)  
**Standard Enforced:** The 8-8-8 Architectural Doctrine (`focit-architect`)

---

## 1. Executive Architectural Blueprint

Phase 4 bridges high-stakes academic evaluation with low-reliability mobile networks. Unlike passive reading of course materials, assessment state transitions are legally binding and permanent. A student losing connection at minute 15 or accidentally double-submitting with 10 seconds remaining must neither lose uncommitted work nor trigger corrupted downstream Moodle states.

```
+-----------------------------------------------------------------------------------------+
|                                    CLIENT BROWSER (V8)                                  |
|  +--------------------------------+                  +-------------------------------+  |
|  |     Monotonic Clock Anchor     |                  |    Local Resilient Outbox     |  |
|  |   performance.now() + Skew     |                  | localStorage (Scoped Sandbox) |  |
|  +---------------+----------------+                  +---------------+---------------+  |
|                  |                                                   |                  |
|                  v                                                   v                  |
|  +-----------------------------------------------------------------------------------+  |
|  |                    Quiz Attempt FSM (Screen 4: Strict Mutex)                      |  |
|  |             IDLE  ==>  RECORDING  ==>  SUBMITTING  ==>  FINALIZED                 |  |
|  +-----------------------------------------+-----------------------------------------+  |
+--------------------------------------------|--------------------------------------------+
                                             | Idempotency-Key: quiz_sub_${attemptId}
                                             | Auto-Save Heartbeat (Debounced 500ms)
                                             v
+-----------------------------------------------------------------------------------------+
|                                  EXPRESS BFF GATEWAY                                    |
|  +-----------------------------------------------------------------------------------+  |
|  |  Ingress Validation: Server Time Check (now_server <= due_at + delta_grace)       |  |
|  |  Atomic CAS Mutex: UPDATE quiz_attempts SET status='SUBMITTED' WHERE status='OPEN'|  |
|  +-----------------------------------------+-----------------------------------------+  |
+--------------------------------------------|--------------------------------------------+
                                             |
                      +----------------------+----------------------+
                      | (Synchronous ACID)                          | (Asynchronous / Outbox)
                      v                                             v
+-------------------------------------------+ +-------------------------------------------+
|          PostgreSQL 15 Core Ledger        | |           Headless Moodle Core            |
| - quiz_attempts (CAS State Machine)       | | - mod_quiz_process_attempt                |
| - quiz_answers (Idempotent Upsert)        | | - gradereport_user_get_grade_items        |
| - outbox_events (BullMQ Outbox sync)      | | - mod_forum_get_forum_discussions         |
+-------------------------------------------+ +-------------------------------------------+
```

---

## 2. Screen 4: Quiz Attempt Engine State Machine

### 2.1 The Authoritative Timer Invariant (Mathematical Clock Anchor)

#### The Vulnerability
1. Manipulating client time via OS settings or DevTools patches `Date.now()`.
2. Mobile background tab hibernation suspends `setInterval`, skewing countdown timers.

#### Mathematical Formulation
The countdown timer **never** derives its authority from client ticks. Authority resides exclusively in the server tuple:
$$\mathcal{T}_{\text{attempt}} = \langle t_{\text{started}}, \Delta t_{\text{duration}}, t_{\text{due}} \rangle \quad \text{where } t_{\text{due}} = t_{\text{started}} + \Delta t_{\text{duration}}$$

Upon initialization or page rehydration (`GET /api/quizzes/:quizId/attempts/:attemptId`):
1. **Clock Skew Calculation via Cristian's Algorithm:**
   $$\text{RTT} = t_{\text{receive}} - t_{\text{send}}$$
   $$\hat{t}_{\text{server}} = t_{\text{server\_now}} + \frac{\text{RTT}}{2}$$
   $$\text{Offset } \theta = \hat{t}_{\text{server}} - t_{\text{receive}}$$
2. **Monotonic Derivation via `performance.now()`:**
   Let $P_0$ be the high-resolution monotonic timestamp from `performance.now()` captured at $t_{\text{receive}}$.
   At any subsequent client frame $t$:
   $$t_{\text{projected\_server}}(t) = \hat{t}_{\text{server}} + (performance.now() - P_0)$$
   $$\text{Remaining}(t) = \max\left(0, t_{\text{due}} - t_{\text{projected\_server}}(t)\right)$$

`performance.now()` is strictly monotonic, unaffected by system time adjustments or NTP adjustments.

#### Server Ingress Enforcement
The Express BFF enforces a hard deadline check:
$$\text{now}_{\text{server}} \le t_{\text{due}} + \delta_{\text{grace}} \quad (\delta_{\text{grace}} = 3000\text{ms for cellular RTT})$$
If the request arrives at $\text{now}_{\text{server}} > t_{\text{due}} + \delta_{\text{grace}}$, the submission is processed in `EXPIRED_AUTO_SUBMIT` mode; no new answers are accepted, and already-persisted answers are committed.

---

### 2.2 The Disconnect State (Resilient Client Outbox Buffer)

#### Storage Schema
Every answer selection immediately commits *synchronously* to an authenticated, isolated browser storage sandbox:
`focit_quiz_draft:${studentId}:${attemptId}`

```json
{
  "attemptId": "att_101",
  "studentId": "student1",
  "quizId": "quiz_204",
  "clientVersion": 14,
  "answers": {
    "q1": { "optionId": "opt_b", "updatedAt": 1775775620000, "synced": true },
    "q2": { "optionId": "opt_c", "updatedAt": 1775775685000, "synced": false }
  },
  "outbox": [
    { "sequence": 7, "questionId": "q2", "optionId": "opt_c", "timestamp": 1775775685000 }
  ]
}
```

#### Sync & Reconnect Flush Protocol
1. **Debounced Sync:** Radio button clicks update local state synchronously and enqueue to `outbox`. A 500ms debouncer issues `POST /api/quizzes/:quizId/attempts/:attemptId/save`.
2. **Network Interruption:**
   - If `navigator.onLine === false` or `fetch` rejects with network timeout, the UI updates its persistent badge from `Saved (Cloud)` to `Saved (Offline Storage)`.
   - The queue remains durable in `localStorage`. Page refreshes or accidental tab closes recover 100% of choices.
3. **Heartbeat Reconnection & Ingress Ownership Validation:**
   - Window `'online'` event listener + exponential backoff probe triggers an automatic flush of all unsynced items in `outbox`.
   - **Ingress Security Boundary (Relational Session Binding):**
     1. Student ID $S$ is extracted strictly from the cryptographically verified HttpOnly JWT cookie (`req.user.studentId`), NEVER from client payload or URL parameters.
     2. Attempt ID $A$ and Quiz ID $Q$ are bound relationally to Student $S$ inside the PostgreSQL ACID boundary.
   - **Relational Set-Difference CTE for Atomic Ownership & Answer Upsert:**
     ```sql
     WITH verified_attempt AS (
       -- 1. Enforce student ownership, active status, and deadline barrier
       SELECT a.attempt_id
       FROM quiz_attempts a
       WHERE a.attempt_id = $1                           -- Target attemptId
         AND a.student_id = $2                           -- Authenticated student from JWT
         AND a.quiz_id = $3                              -- Quiz ID
         AND a.status = 'IN_PROGRESS'                    -- Must be active
         AND NOW() <= (a.due_at + INTERVAL '3 seconds')  -- Grace period ceiling
     ),
     incoming_answers AS (
       -- 2. Unpack payload answers
       SELECT 
         (elem->>'questionId')::varchar AS question_id,
         (elem->>'optionId')::varchar   AS option_id
       FROM jsonb_array_elements($4::jsonb) AS elem
     ),
     illegal_questions AS (
       -- 3. Relational Set-Difference: Detect questions NOT belonging to this quiz bank
       SELECT ia.question_id
       FROM incoming_answers ia
       WHERE NOT EXISTS (
         SELECT 1 
         FROM quiz_questions qq
         WHERE qq.quiz_id = $3 AND qq.question_id = ia.question_id
       )
     ),
     guard AS (
       -- 4. Atomically gate insertion: verified attempt exists AND no illegal questions injected
       SELECT va.attempt_id
       FROM verified_attempt va
       WHERE NOT EXISTS (SELECT 1 FROM illegal_questions)
     )
     INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_option_id, updated_at)
     SELECT 
       g.attempt_id,
       ia.question_id,
       ia.option_id,
       NOW()
     FROM guard g
     CROSS JOIN incoming_answers ia
     ON CONFLICT (attempt_id, question_id) 
     DO UPDATE SET 
       selected_option_id = EXCLUDED.selected_option_id,
       updated_at = NOW()
     RETURNING quiz_attempt_answers.question_id;
     ```
   - **Zero-Trust Error Boundary:** If `rowCount === 0`, the handler queries the root cause and returns:
     - `403 Forbidden` if attempt belongs to another student.
     - `410 Gone` if quiz deadline has passed.
     - `422 Unprocessable Entity` if set-difference detected foreign question IDs.
   - On HTTP 200, the client drains the flushed sequence numbers from `outbox` and displays `All Answers Saved`.

---

### 2.2.1 Physical Viewport Lock & Mobile CLS Mitigation (Screen 4 Layout)
1. **The 100dvh Dynamic Viewport Anchor:**
   - Root document layout locked via:
     ```css
     html, body {
       height: 100dvh;
       max-height: 100dvh;
       overflow: hidden;
       position: fixed;
       width: 100%;
       margin: 0;
       padding: 0;
       touch-action: pan-x pan-y;
     }
     ```
2. **Interactive Widget Protection Against Virtual Keyboard:**
   - HTML meta viewport specifies:
     `<meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content, maximum-scale=1.0, user-scalable=no">`
   - Prevents the on-screen keyboard from resizing the document root or shifting the pinned timer header.
3. **Three-Track Layout Containment (`contain: layout paint size`):**
   - **Header Track (Timer & Title):** `height: 64px; flex-shrink: 0; contain: strict;` pinned via GPU compositing (`transform: translate3d(0, 0, 0)`).
   - **Question Scrollport Track:** `flex: 1 1 0%; min-height: 0; overflow-y: auto; contain: layout paint; overscroll-behavior-y: contain;`
   - **Footer Action Track:** `height: 72px; flex-shrink: 0; contain: strict;`
4. **Touch Manipulation & Deterministic Sizing:**
   - Radio option labels have explicit geometric constraints (`min-height: 56px`, `box-sizing: border-box`, `touch-action: manipulation`).
   - Completely eliminates the 300ms mobile tap delay and prevents Cumulative Layout Shift (**CLS = 0.000**).

---

### 2.2.2 V8 Heap Constraints & Android Low Memory Killer (LMK) Defense
1. **DOM Question Virtualization:**
   - The Quiz Attempt interface renders only the **currently active question** in the DOM tree, keeping off-screen questions unmounted.
2. **Single-Page PDF Canvas Recycling:**
   - For case-study attachments, the PDF viewer enforces a maximum memory pool of **2 rendered pages** (current + next).
   - Off-screen `<canvas>` contexts are actively zeroed:
     ```javascript
     canvas.width = 1;
     canvas.height = 1;
     context.clearRect(0, 0, 1, 1);
     ```
   - Releases OpenGL textures and V8 backing buffers immediately.
3. **Blob URL Revocation:**
   - Any attachment retrieved as a `Blob` registers with an `ActiveBlobRegistry` and calls `URL.revokeObjectURL(url)` upon component unmount, capping tab memory footprint to $< 35\text{MB}$.

---

### 2.3 The Submission Mutex (Double-Click & Concurrency Defense)

#### Client FSM Transition Lock
```
  [ RECORDING ]
        |
        | User clicks "Finish Attempt..." / Timer hits 0
        v
  [ CONFIRM_MODAL ]
        |
        | User clicks "Confirm & Submit"
        v
  [ SUBMITTING ] <--- MUTEX ENGAGED:
        |             - button.disabled = true
        |             - pointer-events: none
        |             - autoSaveAbortController.abort() (terminates auto-save race)
        |
        +---- Success (HTTP 200) ----> [ FINALIZED / RESULT_VIEW ]
        |
        +---- Transient Network Error -> [ SUBMIT_RETRY_READY ]
```

#### Deterministic Idempotency Key
Client sends:
`Idempotency-Key: quiz_submit_${attemptId}_v1`

#### Backend Atomic State Transition (CAS)
In PostgreSQL:
```sql
UPDATE quiz_attempts
SET status = 'SUBMITTED',
    submitted_at = NOW()
WHERE attempt_id = $1 
  AND status = 'IN_PROGRESS'
RETURNING attempt_id, score, total_points;
```

- **First Request:** Tuple is in `'IN_PROGRESS'`. The update succeeds (`rowCount === 1`). The BFF finalizes the score, emits the Outbox event to sync with Moodle, and returns HTTP 200 with receipt.
- **Concurrent Request (Frantic Double-Click):** Tuple is already `'SUBMITTED'`. The update matches 0 rows. The BFF intercepts `rowCount === 0`, checks if the attempt is already `'SUBMITTED'`, and returns the existing submission receipt with HTTP 200 without re-executing grading or Moodle sync.

---

## 3. Screen 6: Gradebook Engine (Screen 6 in `ui_template.jpeg`)

### 3.1 Data Flow & Schema Contract
Aggregates student assessment grades from PostgreSQL with fallback to Moodle `gradereport_user_get_grade_items`.

```typescript
interface GradeItem {
  id: string;
  name: string; // e.g. "Quiz 1: Arrays and Lists"
  category: 'QUIZ' | 'ASSIGNMENT' | 'MIDTERM' | 'FINAL_EXAM';
  weightPercent: number; // e.g. 10%
  grade: number; // e.g. 8.5
  maxGrade: number; // e.g. 10.0
  percentage: number; // 85%
  letter: 'A' | 'B' | 'C' | 'D' | 'F';
  feedback: string;
  status: 'GRADED' | 'PENDING' | 'EXEMPT';
}

interface CourseGradebookReport {
  courseId: string;
  courseCode: string;
  studentId: string;
  currentScore: number; // Weighted cumulative %
  letterGrade: string;
  items: GradeItem[];
  _degraded: boolean;
}
```

### 3.2 Thundering Herd Mitigation: Single-Flight Coalescing & SWR Cache
When 1,000 students query grades at semester end, naive direct calls to Moodle PHP `gradereport_user_get_grade_items` saturate worker threads and exhaust database connections.

1. **Tiered L1/L2 Stale-While-Revalidate (SWR) Cache:**
   - Key format: `gradebook:${courseId}:${studentId}`.
   - **FRESH_TTL (60s):** Serves cached grade payload in $<2\text{ms}$ with `X-Cache: HIT-FRESH`.
   - **STALE_TTL (15m):** Serves stale payload in $<5\text{ms}$ with `X-Cache: HIT-STALE` while dispatching background revalidation.
2. **Single-Flight Coalescing Mutex (`singleFlight.do`):**
   - Concurrent requests for the same student/course key are coalesced into a single upstream Promise:
     `flightKey = gradebook_fetch:${courseId}:${studentId}`.
   - Eliminates duplicate in-flight requests; all 1,000 callers share the single upstream resolution.
3. **Decoupled Ingress Ceiling & Graceful Degradation:**
   - Client ingress timeout capped at **2,000ms**.
   - If upstream Moodle takes $>2,000\text{ms}$ or fails, the BFF returns the durable PostgreSQL grade ledger snapshot with `_degraded: true` and `Warning: 110 - "Stale Grades"` header.
   - Upstream Moodle connection pool is protected from saturation.

### 3.3 Accessible UI & Resilience
- High-contrast table with semantic `<caption>`, `<thead>`, `<tbody>`, `scope="col"`, and `scope="row"`.
- Badges formatted with FOCIT design tokens:
  - $\ge 70\%$: Deep Navy / Gold Badge (A).
  - $60-69\%$: Indigo Badge (B).
  - $50-59\%$: Slate Badge (C).
  - $< 50\%$: Rose Badge (F).

---

## 4. Screen 7: Discussion Forum Engine (Screen 7 in `ui_template.jpeg`)

### 4.1 Topology & Concurrency
- **Thread List:** Displays topics, author crests, reply count badges, and last active timestamp.
- **Optimistic Posting:** Adding a discussion topic or reply updates the UI optimistically with a `_pending: true` flag.
- **BFF Anti-Spam Rate Limit:** Implements a token-bucket rate limiter: max 1 new post per 30 seconds per student to prevent spam floods on campus networks.
- **Durable Storage:** Threads are stored in PostgreSQL with asynchronous synchronization to Moodle's `mod_forum_add_discussion_post`.

---

## 5. Implementation Roadmap & Milestones

1. **Milestone 4.1: BFF Backend Endpoints**
   - `packages/bff/src/routes/quizzes.js`:
     - `GET /api/quizzes/:quizId/attempts/:attemptId` (includes `server_now` and Cristian skew synchronization).
     - `POST /api/quizzes/:quizId/attempts/:attemptId/save` (idempotent upsert of uncommitted answers).
     - `POST /api/quizzes/:quizId/attempts/:attemptId/submit` (atomic CAS submission mutex).
   - `packages/bff/src/routes/grades.js`:
     - `GET /api/courses/:courseId/grades` (composite gradebook aggregator).
   - `packages/bff/src/routes/forums.js`:
     - `GET /api/courses/:courseId/forum` (thread aggregator).
     - `POST /api/courses/:courseId/forum/threads` (anti-spam thread creation).

2. **Milestone 4.2: Frontend Components**
   - `QuizAttemptPage.jsx` (Screen 4):
     - `useQuizTimer`: Monotonic high-resolution clock anchor hook.
     - `useQuizOutbox`: Local storage persistence and automatic flush worker.
     - Accessible Question Grid (1 to 10), radio selection, and "Finish attempt..." modal with mutation locks.
   - `GradebookPage.jsx` (Screen 6): Accessible tabular grade matrix and weighted progress bar.
   - `ForumPage.jsx` (Screen 7): Thread list, reply counters, and "+ New discussion topic" modal.

3. **Milestone 4.3: Router Integration & Verification**
   - Register routes in `router.jsx`.
   - Production bundle compilation check (`npm run build`).
