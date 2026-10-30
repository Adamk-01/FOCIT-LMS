# Phase 10 Implementation Plan: Student Dashboard Enhancement & Assessment Defense Suite

**Role:** Staff Systems Architect & Zero-Trust Client Lead  
**Document Status:** ⏳ Pending Architecture Defense & Grill Sign-off  
**Subsystems:** `packages/bff` (Express BFF, PostgreSQL, Redis) ↔ `packages/frontend` (React 19, Tailwind CSS, TanStack Query)  
**Governing Standard:** The 8-8-8 Architectural Doctrine (`focit-architect`)  

---

## 1. Executive Architectural Blueprint

This milestone delivers 11 synchronized enhancements to the FOCIT LMS student portal while establishing strict RBAC quarantine and addressing critical mobile ergonomics:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT PLANE (React 19 Zero-Trust UI)                          │
│                                                                                                  │
│   Topbar & Profile:                                                                              │
│   - Propagated Student Avatar from PostgreSQL /api/student/avatar (replaces hardcoded initials)  │
│   - Global Dark Mode Toggle (light | dark | system) with zero-FOUC hydration                     │
│   - Matriculation Badge: Normalized strictly to Senate Standard YYYY/NNNNN (e.g. 2024/28682)    │
│                                                                                                  │
│   Navigation & Student Route Guard:                                                              │
│   - REMOVED: "Question Bank & AI" from student Sidebar & Topbar (Quarantined to Lecturer Role)   │
│   - ADDED: Timetable & Academic Calendar Route (/calendar) with Web Notification Permissions     │
│                                                                                                  │
│   Assessment Suite (/courses/:courseId/quizzes/:quizId):                                         │
│   - Dynamic Quiz Allocation: PRNG-shuffled question & option pools seeded by attempt UUID        │
│   - Anti-Cheat Engine: Fullscreen enforcement, visibility/blur telemetry, clipboard lockout      │
│   - Server-Authoritative Timer: Cristian's clock sync with non-bypassable expiry auto-submit     │
│                                                                                                  │
│   Assignments & Submissions (/courses/:courseId/assignments):                                    │
│   - Authoritative Assignment Ledger: View briefs, deadlines, grading criteria                   │
│   - File Upload Submission Modal: Multi-format (PDF/ZIP/DOCX), 10MB quota, mutation lock         │
│                                                                                                  │
│   Discussion Forum (/courses/:courseId/forum):                                                   │
│   - Thread Expansion: Hierarchical view of peer and faculty replies                              │
│   - Inline Reply Composer: Post response with student avatar and optimistic cache update         │
│                                                                                                  │
│   Mobile Course Registration Fix (/registration):                                                │
│   - Mobile Viewport Containment (100dvh lock) & Sticky Bottom Bar for Step 3 Senate Clearance    │
└───────────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                │ HTTPS / HttpOnly Cookie + X-Session-Nonce
                                                │ X-Idempotency-Key on all mutations
                                                ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   COMPUTE PLANE (Express BFF)                                    │
│                                                                                                  │
│   Tier 1: Tenant Security & Strict RBAC Boundary (Blocks students from /api/question-bank)      │
│   Tier 2: Assessment Allocation & Telemetry Engine (Anti-cheat infractions, seeded shuffle)     │
│   Tier 3: Assignment Storage & Submission Processing (Multer with MIME magic byte audit)          │
│   Tier 4: Timetable & Notification Scheduler API (/api/student/timetable)                        │
│   Tier 5: Threaded Forum Reply Engine with Avatar Aggregation (/api/forum/:threadId/replies)     │
│   Tier 6: Matriculation Canonicalization Engine (Strict YYYY/NNNNN Regex Boundary)               │
└───────────────────────┬──────────────────────────────────────────────┬───────────────────────────┘
                        │                                              │
                        ▼                                              ▼
┌──────────────────────────────────────────────┐    ┌──────────────────────────────────────────────┐
│          STATE PLANE (PostgreSQL 16)         │    │           CACHE & SESSION (Redis 7)          │
│                                              │    │                                              │
│  - quiz_attempts (telemetry_log, seed, score)│    │  Session Hash + Ephemeral Nonce              │
│  - course_assignments & submissions          │    │  Single-Flight Coalescing Engine             │
│  - forum_replies (threaded relational tree)  │    │  Bounded L1 Cache with SWR Mechanics         │
│  - timetables & academic_calendar_events     │    │  Active Exam Attempt State & Timer Cache     │
│  - students (avatar_url, matric_number)      │    │                                              │
└──────────────────────────────────────────────┘    └──────────────────────────────────────────────┘
```

---

## 2. Invariant Defense: Concurrency, Boundaries & Ergonometric Physics

### Invariant 1: Anti-Cheat & Assessment Integrity Boundary
* **The Vulnerability:** Students taking online tests can open new tabs, search answers, paste copied code, or exit fullscreen without consequences. If client-side timers or checks are relied upon, an adversary can pause JavaScript execution in DevTools to stop the clock.
* **Architectural Defense:**
  - **Fullscreen Lock:** Attempt initialization requests WHATWG Fullscreen API (`document.documentElement.requestFullscreen()`). An overlay curtain activates immediately if fullscreen is exited, pausing interactive input until re-engaged.
  - **Telemetry Ingestion:** `visibilitychange`, `blur`, and `fullscreenchange` events stream infraction timestamps to `POST /api/quizzes/:quizId/attempts/:attemptId/telemetry`.
  - **Hard Violation Threshold:** 3 unacknowledged tab/window switches trigger immediate forced submission with status `'FLAGGED_ACADEMIC_DISHONESTY'`.
  - **Clipboard Lockout:** `copy`, `paste`, `cut`, and `contextmenu` events are intercepted via `preventDefault()` inside the assessment viewport.

### Invariant 2: Server-Authoritative Timer & Clock Skew Resilience
* **The Vulnerability:** Client system clocks are untrusted (students can adjust their OS time backwards to gain extra exam time).
* **Architectural Defense:**
  - Timer expiration is computed strictly from PostgreSQL `quiz_attempts.started_at + quiz.duration_minutes`.
  - Client countdown uses **Cristian's Algorithm** with RTT compensation: `estimatedServerNow = serverNow + (RTT / 2)`.
  - Monotonic elapsed time is measured using `performance.now()` against the initial sync anchor, rendering OS clock tampering ineffective.
  - Expiry triggers an atomic auto-commit payload; if the student fails to submit, the backend background worker expires and grades the attempt at $T_{\text{due}} + 15\text{s}$ leeway.

### Invariant 3: Dynamic Quiz Allocation (Fisher-Yates Deterministic Shuffle)
* **The Vulnerability:** If all students receive questions in identical order with identical option keys, screen-sharing or adjacent seating allows coordinated cheating.
* **Architectural Defense:**
  - Each attempt receives a cryptographically secure random seed stored in `quiz_attempts.allocation_seed`.
  - Questions and options are shuffled server-side using a seeded PRNG (XORShift128+) so that:
    1. Question ordering is uniquely randomized per student attempt.
    2. Option choices (A, B, C, D) are uniquely shuffled per question per student.
    3. The mapping is deterministic and fully auditable by lecturers and external examiners upon dispute.

### Invariant 4: Assignment Upload & MIME Magic-Byte Verification
* **The Vulnerability:** Allowing arbitrary file uploads exposes the server to PHP/executable webshells, zip bombs, and disk exhaustion.
* **Architectural Defense:**
  - Multer middleware limits payloads to 10MB strictly in temporary disk/memory storage.
  - File signature (magic bytes) inspection via `file-type` verifies actual binary MIME type (`application/pdf`, `application/zip`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`). Renamed `.exe` files are rejected with HTTP 422.
  - Submissions enforce an atomic PostgreSQL upsert on `(assignment_id, student_id)` guarded by `X-Idempotency-Key` to prevent duplicate or conflicting submissions.

### Invariant 5: Global Dark Mode Architecture (Zero-FOUC & OS Sync)
* **The Vulnerability:** Naive dark mode toggles cause a "flash of unstyled content" (FOUC) on page reload, where a bright white screen flashes before React mounts and reads `localStorage`.
* **Architectural Defense:**
  - Inline head script executes synchronously in `index.html` before DOM render, reading `localStorage.getItem('focit_theme')` or evaluating `window.matchMedia('(prefers-color-scheme: dark)')` and setting class `dark` on `<html>`.
  - Complete semantic CSS variable mapping and Tailwind `dark:` color palettes across all components (surfaces, borders, typography, inputs, badges).
  - Syncs to student preferences in PostgreSQL upon change.

### Invariant 6: Academic Timetable & Browser Web Notification Engine
* **The Vulnerability:** Students miss lectures due to lack of timely alerts; polling notifications drains mobile battery.
* **Architectural Defense:**
  - Authoritative timetable endpoint `GET /api/student/timetable` aggregates lecture slots for the student's enrolled courses.
  - Zero-Trust Client uses the native Web Notifications API (`Notification.requestPermission()`).
  - An in-browser scheduling worker compares client wall time against next lecture start time; triggers a native notification 15 minutes prior to class with course code, room/link, and lecturer name.

### Invariant 7: Forum Threaded Replies & Universal Avatar Propagation
* **The Vulnerability:** Students cannot view responses or converse in discussions; uploaded profile photos are ignored in forum threads and the global Topbar, breaking student identity.
* **Architectural Defense:**
  - Dedicated table `course_forum_replies` referencing `parent_id` (supporting 2-level threaded discussions).
  - `GET /api/courses/:courseId/forum` and `GET /api/courses/:courseId/forum/:threadId/replies` join `students` table to return `author.avatar_url`.
  - `Topbar.jsx` subscribes to authoritative `user.avatar_url` from AuthContext / Profile Query, rendering the high-res circular photo with fallback to initials.

### Invariant 8: Senate Standard Matriculation Syntax (`YYYY/NNNNN`)
* **The Vulnerability:** Inconsistent matric formats (`FOCIT/2024/0042`, `2024-28682`, `CSC/2024/99`) break indexing, CSV export/import, and authentication lookups.
* **Architectural Defense:**
  - Institutional Standard: `^\d{4}\/\d{4,6}$` (e.g. `2024/28682`).
  - Strict input masks and backend sanitizers normalize loose inputs (e.g., `2024-28682` or `2024/028682`) into canonical `2024/28682`.
  - Validation error returns RFC 7807 problem details with clear remediation instructions.

### Invariant 9: Mobile Course Registration Viewport Containment (`100dvh` Fix)
* **The Vulnerability:** On mobile devices (iOS Safari, Android Chrome), dynamic browser address bars push the registration declaration modal or step buttons off-screen. Students cannot scroll down to check the declaration box or click "Submit for Clearance".
* **Architectural Defense:**
  - Enforce `100dvh` lock on modal with `max-h-[85dvh]` and inner container `overflow-y-auto`.
  - Action footer is converted to a sticky, elevated bottom bar (`sticky bottom-0 bg-white/95 backdrop-blur-md`) guaranteeing that "Back" and "Submit" buttons remain visible and clickable regardless of scroll position or virtual keyboard state.

### Invariant 10: Strict RBAC Decoupling: Question Bank Quarantined to Faculty
* **The Vulnerability:** Students viewing or accessing Question Bank routes exposes assessment authoring tools and draft question pools.
* **Architectural Defense:**
  - Purge "Question Bank & AI" from student navigation (`Sidebar.jsx` and `Topbar.jsx`).
  - Student role attempting to access `/question-bank` is intercepted by React Router `RequireRole('LECTURER')` and redirected to `/dashboard`.
  - BFF middleware returns HTTP 403 Forbidden on any `/api/question-bank` invocation by non-faculty tokens.

---

## 3. Subsystem Implementation Breakdown

### Milestone 10.1: Anti-Cheat & Assessment Telemetry Engine
* **Files:**
  - `packages/frontend/src/hooks/useAntiCheat.js` (NEW)
  - `packages/frontend/src/pages/QuizAttemptPage.jsx`
  - `packages/bff/src/routes/quizzes.js`
  - `packages/bff/src/db/migrations/010_phase10_student_enhancements.sql` (NEW)
* **Capabilities:**
  1. Fullscreen lifecycle manager with exit warning dialog and countdown to auto-lock.
  2. Tab visibility watcher (`visibilitychange`, `window.onblur`) logging infractions.
  3. Clipboard suppression (`copy`, `cut`, `paste`, `contextmenu` blocked).
  4. Server telemetry endpoint recording count and timestamps of blur events.

### Milestone 10.2: Server-Authoritative Timer & Dynamic Quiz Allocation
* **Files:**
  - `packages/bff/src/services/quizAllocationService.js` (NEW)
  - `packages/bff/src/routes/quizzes.js`
  - `packages/frontend/src/hooks/useQuizAttempt.js`
* **Capabilities:**
  1. Seeded PRNG question/option shuffle per student attempt.
  2. Time remaining calculated server-side; client Cristian's algorithm skew offset.
  3. Two-latch auto-submit mutex executing zero-trust submit upon countdown expiry.

### Milestone 10.3: Course Assignment Delivery & File Upload Ledger
* **Files:**
  - `packages/bff/src/routes/assignments.js` (NEW)
  - `packages/bff/src/middleware/fileUpload.js` (NEW)
  - `packages/frontend/src/pages/AssignmentsPage.jsx` (NEW)
  - `packages/frontend/src/components/assignments/AssignmentSubmissionModal.jsx` (NEW)
  - `packages/frontend/src/components/assignments/AssignmentCard.jsx` (NEW)
* **Capabilities:**
  1. Authoritative assignment list for enrolled courses.
  2. Secure file upload (PDF/ZIP/DOCX $\le 10\text{MB}$) with magic-byte validation.
  3. Real-time submission status (Submitted, Graded, Late) with idempotency lock.

### Milestone 10.4: Dark Mode System
* **Files:**
  - `packages/frontend/index.html` (inline anti-FOUC script)
  - `packages/frontend/src/contexts/ThemeContext.jsx` (NEW)
  - `packages/frontend/src/components/layout/Topbar.jsx` (theme toggle button)
  - `packages/frontend/src/index.css` (Tailwind dark theme variable definitions)
* **Capabilities:**
  1. Three-way mode: `light`, `dark`, `system`.
  2. Zero-FOUC script prior to React hydration.
  3. Semantic dark mode styles across cards, tables, inputs, sidebars, and modals.

### Milestone 10.5: Academic Calendar & Lecture Notification Engine
* **Files:**
  - `packages/bff/src/routes/timetable.js` (NEW)
  - `packages/frontend/src/pages/CalendarPage.jsx` (NEW)
  - `packages/frontend/src/hooks/useClassNotifications.js` (NEW)
  - `packages/frontend/src/components/calendar/WeeklyTimetableView.jsx` (NEW)
* **Capabilities:**
  1. Aggregated weekly timetable for registered courses + semester milestone events.
  2. Native browser Notification permission request banner.
  3. Scheduled client-side notification trigger 15 minutes before scheduled lectures.

### Milestone 10.6: Threaded Forum Replies & Universal Avatar Propagation
* **Files:**
  - `packages/bff/src/routes/forum.js`
  - `packages/frontend/src/components/forum/ForumThreadList.jsx`
  - `packages/frontend/src/components/forum/ThreadRepliesModal.jsx` (NEW)
  - `packages/frontend/src/components/layout/Topbar.jsx`
* **Capabilities:**
  1. View replies to any discussion topic.
  2. Submit threaded reply with mutation lock and optimistic cache update.
  3. Student's uploaded avatar image rendered in Topbar, forum topics, and replies.

### Milestone 10.7: Matriculation Format Standardizer (`YYYY/NNNNN`)
* **Files:**
  - `packages/bff/src/services/ingestionService.js`
  - `packages/bff/src/db/seed.js`
  - `packages/frontend/src/pages/LoginPage.jsx`
  - `packages/frontend/src/lib/userFriendlyMessages.js`
* **Capabilities:**
  1. Standardize regex: `/^\d{4}\/\d{4,6}$/` (Example: `2024/28682`).
  2. Update seed records and test suites to standard matriculation syntax.
  3. Input sanitization in login and profile forms.

### Milestone 10.8: Student Navigation Cleansing (Remove Question Bank)
* **Files:**
  - `packages/frontend/src/components/layout/Sidebar.jsx`
  - `packages/frontend/src/components/layout/Topbar.jsx`
  - `packages/frontend/src/router.jsx`
* **Capabilities:**
  1. Remove "Question Bank & AI" from student sidebar navigation.
  2. Add RBAC guard so only `LECTURER` or `ADMIN` roles can access `/question-bank`.

### Milestone 10.9: Mobile Course Registration Viewport Containment & Submit Fix
* **Files:**
  - `packages/frontend/src/components/registration/RegistrationDeclarationModal.jsx`
  - `packages/frontend/src/pages/CourseRegistrationPage.jsx`
* **Capabilities:**
  1. `max-h-[85dvh]` with scrollable content container.
  2. Sticky bottom bar for declaration checkbox and submission button.
  3. Full mobile Safari and Chrome touch target compliance ($\ge 44\times 44\text{px}$).

### Milestone 10.10: Upcoming Pedagogical AI Companion (Roadmap & Architectural Specs)
* **Files:** `docs/AI_TUTOR_ARCHITECTURE_SPEC.md`
* **Status:** Marked as **UPCOMING (Phase 11)**. No runtime code generated in Phase 10 per user directive. Outlines RAG pipeline against lecture slides/transcripts using local/cloud embeddings.

---

## 4. The Pre-Generation Architectural Grill

In accordance with the **8-8-8 Architectural Doctrine (`focit-architect`)**, here is the rigorous architectural interrogation:

1. **Ingress & Authoritative State Boundary:**
   - *Question:* During a quiz attempt, does the client calculate remaining time or determine whether an attempt is expired?
   - *Defense:* The client NEVER decides expiration. PostgreSQL holds `started_at` and `duration_minutes`. The BFF rejects any answer submission where `NOW() > started_at + duration_minutes + 15s`. The client timer is purely an informational projection calibrated via Cristian's algorithm.

2. **Concurrency & Deadlock Audit:**
   - *Question:* If 200 students submit their assignment or quiz at the final deadline second, how are deadlocks avoided?
   - *Defense:* Submissions are keyed on `(assignment_id, student_id)` and `(quiz_id, attempt_id)`. Each row mutation locks strictly the student's own record. No table-level locks or multi-row foreign keys are locked out-of-order.

3. **Physical Viewport & Mobile Compositor:**
   - *Question:* Why could mobile students not submit course registration previously, and how does the new layout guarantee visibility?
   - *Defense:* The previous `<dialog>` was unconstrained on mobile viewports; when dynamic address bars expanded, the modal grew past `100vh` without `overflow-y-auto`, hiding the submit button below the fold. The fix uses `max-h-[85dvh]` with `overflow-y-auto` and a `sticky bottom-0` action bar.

4. **Network Latency & Graceful Degradation:**
   - *Question:* If the student's cellular network drops during an exam or assignment upload, what happens?
   - *Defense:* Quiz answers are autosaved into an authenticated `sessionStorage` sandbox (`focit_quiz_draft:${studentId}:${attemptId}`). When offline, a visual pill displays "OFFLINE - Answers Cached Locally". Reconnection automatically flushes unsaved deltas using `X-Idempotency-Key`.

5. **Unhappy Path & Mutation Locks:**
   - *Question:* What prevents double-submission if a student rapidly taps the assignment upload or declaration submit button?
   - *Defense:* Synchronous `useRef` mutex locks the button before any asynchronous Promise dispatch. The submit button is immediately disabled and displays a spinning progress indicator.

6. **File Upload Security & Memory Limits:**
   - *Question:* Can an adversary crash Node.js by uploading a 2GB file or malicious script?
   - *Defense:* Multer enforces an in-memory/stream limit of 10MB. Files are verified against binary signatures (magic bytes) using `file-type`. Executable scripts (`.sh`, `.exe`, `.php`, `.js`) are rejected before disk persist.

7. **Matriculation Canonicalization Boundary:**
   - *Question:* What happens if an older student account or spreadsheet contains `FOCIT/2024/0042`?
   - *Defense:* The canonicalization sanitizer extracts the year and numeric student ID (`2024/0042`), validating against `^\d{4}\/\d{4,6}$`. Loose legacy formats are normalized transparently.

8. **Semantic Accessibility & DOM Reconciliation:**
   - *Question:* Are discussion forum replies and quiz questions accessible?
   - *Defense:* All replies are semantic `<article>` tags within an `<ol role="feed">`. Dynamic list keys use immutable UUIDs (`reply.id`, `question.id`). Interactive buttons provide ARIA expanded and controls attributes.
