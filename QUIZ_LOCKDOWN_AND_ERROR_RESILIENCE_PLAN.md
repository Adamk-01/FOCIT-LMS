# Assessment Lockdown & Zero-Chrome Proctoring Architecture Plan

**Role:** Staff Systems Architect & Zero-Trust Client Lead  
**Document Status:** ✅ Approved with Staff Constraints  
**Subsystems:** `packages/frontend` (React 19, Tailwind CSS, TanStack Query, Context API) ↔ `packages/bff` (Express, PostgreSQL 16)  
**Governing Standard:** The 8-8-8 Architectural Doctrine (`focit-architect`)  

---

## 1. Executive Problem Statement & Architectural Flaws

The assessment subsystem had four critical architectural deficiencies:

1. **Navigation Chrome Leakage:** When an assessment attempt is active, `ProtectedLayout` only dimmed the sidebar with `opacity-25` and left `Topbar` fully rendered. This violated physical viewport containment (`100dvh` lock) and allowed students to inspect layout headers, access theme toggles, or be distracted during high-stakes summative exams.
2. **Orphaned Anti-Cheat Proctoring Engine:** `useAntiCheat.js` and `ProctoringCurtainModal.jsx` were authored with anomaly scoring and two-strike fullscreen escalation, but were never hooked into `QuizAttemptPage.jsx`.
3. **Formative vs. Summative Coupling:** Naive lockdown logic coupled untimed self-study drills (`SELF_PRACTICE`) to summative exam lockdowns (`OFFICIAL_TEST`), threatening to terminate students reviewing course materials.
4. **Mobile Fullscreen Lockout & MVCC Race Conditions:** iOS Safari does not support element-level WHATWG Fullscreen API, requiring progressive viewport degradation. Additionally, `/save` used a plain `SELECT` without `FOR UPDATE`, creating a window where late auto-saves could bypass concurrent `/submit` locks under PostgreSQL `READ COMMITTED`.

---

## 2. The Architectural State Machine

```
                              [ Page Mount ]
                                    │
                       GET /quizzes/:id/attempts/:aid
                                    │
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
    [ Error State ]                                [ Success: Attempt Loaded ]
    • Keep Topbar/Sidebar                          • Check attempt.status & quiz.quiz_type
    • Show ErrorAlertCallout + Retry/Exit           │
                                   ┌────────────────┴────────────────┐
                                   ▼                                 ▼
                         [ status: 'SUBMITTED' ]           [ status: 'IN_PROGRESS' ]
                         • isExamLocked: false             • Evaluate Proctoring Policy
                         • Exit Fullscreen                           │
                         • QuizFinalizedView               ┌─────────┴─────────┐
                                                           ▼                   ▼
                                                  [ 'SELF_PRACTICE' ]   [ 'OFFICIAL_TEST' ]
                                                  • Unproctored         • isExamLocked: true
                                                  • Chrome visible      • Topbar/Sidebar HIDDEN
                                                  • No curtains         • Check isFullscreenSupported()
                                                  • No 2-strike kill           │
                                                                       ┌───────┴───────┐
                                                                       ▼               ▼
                                                                [ Supported ]     [ iOS / Unsupported ]
                                                                • NEEDS_FULLSCREEN • Direct to ACTIVE
                                                                • User Tap Gate   • CSS 100dvh Lock
                                                                       │          • Passive monitoring
                                                              (User clicks)
                                                                       │
                                                                       ▼
                                                             [ State: ACTIVE ]
                                                             • 100dvh Viewport Containment
                                                             • Monotonic Cristian Timer
                                                             • Scoped sessionStorage commit
                                                             • Passive Anti-Cheat active
                                                                       │
                                               ┌───────────────────────┼───────────────────────┐
                                               ▼                       ▼                       ▼
                                      [ Window Blur / Tab ]   [ Fullscreen Exit ]     [ Network Drop ]
                                      • Grace timer: 15s      • Strike 1: Curtain     • syncStatus: 'OFFLINE'
                                      • Escalate to Strike 1    (SUSPENDED_AWAY)      • Answers in sessionStorage
                                      • Stream telemetry      • Strike 2: Forced      • Flush on 'online'
                                                                Auto-Submit           • Abort in-flight /save
```

---

## 3. The 4 Engineering Constraints

### 1. `useAntiCheat.js` Modification Scope
- **`enabled` flag gate:** When `quiz.quiz_type !== 'OFFICIAL_TEST'` or when disabled, tear down all event listeners, bypass initial modal, and set `lockdownState = 'ACTIVE'`.
- **`isFullscreenSupported()` feature check:**
  ```javascript
  const isFullscreenSupported = () => {
    if (typeof document === 'undefined') return false;
    return Boolean(
      document.fullscreenEnabled ||
      document.webkitFullscreenEnabled ||
      document.mozFullScreenEnabled ||
      document.msFullscreenEnabled
    );
  };
  ```
  On iOS Safari or viewports where this returns `false`, bypass `NEEDS_FULLSCREEN` on mount, avoid calling `requestFullscreen()`, but retain `visibilitychange`, `blur`, and clipboard lockouts.

### 2. `sessionStorage` Array Normalization Before `/submit`
- `sessionStorage` stores `answers` as a dictionary map: `{ [questionId]: { optionId, synced, updatedAt } }`.
- PostgreSQL `jsonb_array_elements($2::jsonb)` requires a flat JSON array `[{ questionId, optionId }]`.
- `triggerSubmit` extracts the latest uncommitted answers from `sessionStorage` and normalizes:
  ```javascript
  const rawAnswers = parsedSession?.answers || selectedAnswers;
  const answersArray = Object.entries(rawAnswers).map(([qId, val]) => ({
    questionId: qId,
    optionId: typeof val === 'object' ? val.optionId : val,
  }));
  ```

### 3. Strict Latching Discipline (`isFinalizedRef` vs. `inFlightSubmitMutexRef`)
- **During in-flight request:** `inFlightSubmitMutexRef.current = true`. This blocks duplicate submit clicks and suppresses `/save` offline toasts.
- **`isFinalizedRef.current`:** Must **NEVER** be set to `true` optimistically before the network returns. It is only flipped to `true` upon receiving HTTP 200 (or HTTP 200 with `ALREADY_SUBMITTED`).
- If network drops during submit, `inFlightSubmitMutexRef.current` releases in `finally`, allowing the student to retry submission when the connection restores without losing `sessionStorage` draft data.

### 4. PostgreSQL CTE Row-Level Lock Serialization (`FOR UPDATE`)
- In `packages/bff/src/routes/quizzes.js:664-672`, update `verified_attempt` to lock the row:
  ```sql
  WITH verified_attempt AS (
    SELECT a.attempt_id
    FROM quiz_attempts a
    WHERE a.attempt_id = $1
      AND a.student_id = $2
      AND a.quiz_id = $3
      AND a.status = 'IN_PROGRESS'
      AND NOW() <= (a.due_at + INTERVAL '3 seconds')
    FOR UPDATE
  )
  ```
- This guarantees that a concurrent `POST /save` blocks on an in-flight `POST /submit` row lock. When `/submit` commits `status = 'SUBMITTED'`, PostgreSQL's `READ COMMITTED` EvalPlanQual re-evaluates `status = 'IN_PROGRESS'`, drops the row, and causes `/save` to roll back with HTTP 409.

---

## 4. Subsystems to Modify

1. **`packages/bff/src/routes/quizzes.js`**: Add `FOR UPDATE` to `verified_attempt` in `/save` endpoint.
2. **`packages/frontend/src/hooks/useAntiCheat.js`**:
   - Add `isFullscreenSupported()` check.
   - Respect `enabled` prop for `SELF_PRACTICE` unproctored mode.
   - Avoid infinite `NEEDS_FULLSCREEN` trap on mobile Safari.
3. **`packages/frontend/src/hooks/useQuizAttempt.js`**:
   - Normalize `sessionStorage` answers to array `[{ questionId, optionId }]` before `/submit`.
   - Pass `submissionMode` parameter through `triggerSubmit`.
   - Latch `inFlightSubmitMutexRef` during mutation, and only latch `isFinalized` post-HTTP 200.
   - Ignore 409 from `/save` when attempt is finalizing.
4. **`packages/frontend/src/layouts/ProtectedLayout.jsx`**:
   - Completely hide `<aside>` (desktop & mobile) and `<Topbar>` when `isExamLocked === true`.
   - Expand main scrollport to `h-full w-full p-2 sm:p-4 max-w-none`.
5. **`packages/frontend/src/pages/QuizAttemptPage.jsx`**:
   - Discriminate between `SELF_PRACTICE` and `OFFICIAL_TEST`.
   - Wire `useExamLock()` for active summative tests; release on unmount or finalization.
   - Wire `useAntiCheat()` and render `ProctoringCurtainModal` for proctored tests.
   - Guard unhappy path: keep chrome visible on fatal fetch errors (`!attempt` or `fetchError`).
