# FOCIT LMS: UI Ergonomics & Error Remediation Architecture Plan
**Document Version:** 2.0.0 (Post-Staff Architectural Review & RFC 7807 Alignment)  
**Architect:** Staff-Level Systems Architect & Zero-Trust Client Lead  
**Scope:** Express BFF Anti-Corruption Boundary, RFC 7807 Dynamic Remediation Engine, Viewport Containment Physics, Dual-State Partitioning, and Component Decomposition  

---

## 1. Executive Problem Statement & Architectural Audit

A rigorous cross-examination against the **FOCIT 8-8-8 Architectural Doctrine**, **IETF RFC 7807 (Problem Details for HTTP APIs)**, and **W3C CSS Containment Level 2** identified five critical vulnerabilities in previous design drafts:

1. **Database Schema Leakage into Client Bundles (Violates Zero-Trust & RFC 7807):**
   Prior drafts improperly mapped raw PostgreSQL constraint names (`chk_max_credit_limit_24`, `chk_min_credit_limit_15`, `chk_course_capacity`) and SQLSTATE codes (`40P01`) inside frontend client files. Physical database identifiers must **never** cross the network perimeter into the browser. The Express BFF [`errorHandler.js`](file:///c:/Users/PC/Desktop/OneDrive/Documents/focit_lms/packages/bff/src/middleware/errorHandler.js) must act as a strict anti-corruption layer, abstracting relational mechanics into clean, stable application error codes and RFC 7807 payloads.

2. **Static Strings vs. Server-Authoritative Telemetry (Violates Invariant 5):**
   A static string lookup fails **Invariant 5 (Cumulative Projected Unit Bounds)**. The backend computes $U_{\text{projected}} = U_{\text{existing}} + U_{\text{delta}}$. The BFF must pass dynamic machine-readable telemetry (`projectedUnits`, `maxCeiling`, `minimumRequired`) via RFC 7807 extension fields, which the frontend formats into exact unit deltas without client-side calculation drift.

3. **Lock Ordering Misplacement (Violates Invariant 3):**
   Dijkstra resource ordering (`ORDER BY course_id ASC`) is strictly an **authoritative database transaction invariant** enforced in PostgreSQL prior to acquiring `SELECT ... FOR UPDATE` row locks. It cannot be delegated to a client hook (`useRegistrationWizard()`) where an attacker could bypass it via `curl`. Furthermore, transient lock contention (`40P01` / `40001`) must be absorbed transparently via backend retry loops with exponential backoff and jitter—never surfaced to a student as a manual "retry" prompt.

4. **Incomplete Dual-State Partitioning (Violates Invariant 2):**
   The registration wizard must enforce strict dual-state partitioning: navigation progression (`?step=1|2|3`, `?filter=ALL|CORE|ELECTIVE`) lives in URL `SearchParams`, while uncommitted transient drafts live in a strictly isolated, student- and semester-scoped `sessionStorage` namespace (`focit_reg_draft:${studentId}:${semesterId}`) to prevent cross-account pollution on shared campus workstations.

5. **Non-Idempotent Mutation Retries on Unstable Campus Networks:**
   Network drops on 3G/2G connections after server commits can cause duplicate submissions if naive retry buttons are clicked. All state-mutating requests (`/submit`, `/draft`, `/quiz/submit`) must generate and persist an `Idempotency-Key` tied to the specific transaction intent.

---

## 2. Phase 1: Authoritative RFC 7807 Remediation Engine

### 2.1 The BFF Anti-Corruption Boundary
The BFF [`errorHandler.js`](file:///c:/Users/PC/Desktop/OneDrive/Documents/focit_lms/packages/bff/src/middleware/errorHandler.js) strictly translates PostgreSQL constraints and SQLSTATE errors into sanitized RFC 7807 problem details. **Zero raw schema identifiers (`chk_*`, `uq_*`, `fk_*`) escape across the boundary.**

```json
{
  "type": "https://focit.uniosun.edu.ng/errors/max-credit-ceiling-exceeded",
  "title": "Maximum Credit Ceiling Exceeded",
  "status": 422,
  "code": "MAX_CREDIT_CEILING_EXCEEDED",
  "detail": "Your proposed course registration exceeds the approved semester credit limit.",
  "projectedUnits": 27,
  "maxCeiling": 24,
  "excessUnits": 3,
  "correlationId": "err_98a7c2f0"
}
```

### 2.2 Client Ingress Normalization (`apiClient`)
In [`api.js`](file:///c:/Users/PC/Desktop/OneDrive/Documents/focit_lms/packages/frontend/src/lib/api.js), `ApiError` extracts all RFC 7807 standard and extension properties:

```javascript
export class ApiError extends Error {
  constructor(message, status, data, response) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.response = response;
    
    // RFC 7807 Standard Fields
    this.code = data?.code || 'UNKNOWN_ERROR';
    this.title = data?.title || 'System Notification';
    this.detail = data?.detail || data?.message || data?.error || message;
    this.correlationId = data?.correlationId || response?.headers?.get('x-correlation-id');
    
    // Server Telemetry Extensions
    this.projectedUnits = data?.projectedUnits;
    this.maxCeiling = data?.maxCeiling;
    this.minimumRequired = data?.minimumRequired;
    this.violations = data?.violations;
    this.courseId = data?.course_id;
  }
}
```

### 2.3 Dynamic Remediation Resolver (`userFriendlyMessages.js`)
The client resolver maps **only** application-level enum codes. Handlers receive the full `ApiError` instance to format precise, dynamic remediation instructions:

```javascript
export const REMEDIATION_REGISTRY = {
  // ── Authentication & Session ──
  INVALID_CREDENTIALS: () => ({
    title: 'Authentication Failed',
    problem: 'The Matric Number or password entered does not match university records.',
    remediation: 'Check your matric number format (e.g. 2021/12345) and re-enter your password.',
    severity: 'error',
    recoveryAction: { type: 'FOCUS_INPUT', target: 'studentId' }
  }),

  UPSTREAM_EXPIRED: () => ({
    title: 'Session Expired',
    problem: 'Your secure session has timed out due to institutional safety policies.',
    remediation: 'Please sign in again to resume your academic tasks.',
    severity: 'warning',
    recoveryAction: { type: 'REAUTH', target: '/login' }
  }),

  // ── Registration & Academic Invariants (Dynamic Telemetry) ──
  MAX_CREDIT_CEILING_EXCEEDED: (err) => {
    const projected = err.projectedUnits;
    const max = err.maxCeiling || 24;
    const excess = projected ? projected - max : null;
    return {
      title: 'Credit Ceiling Exceeded',
      problem: projected 
        ? `Your selected courses total ${projected} credit units, which exceeds the University Senate limit of ${max} units.`
        : 'Your course selection exceeds the maximum semester credit limit.',
      remediation: excess
        ? `Please deselect at least ${excess} credit unit${excess > 1 ? 's' : ''} to proceed with submission.`
        : 'Please deselect one or more courses to bring your total within the approved limit.',
      severity: 'error',
      recoveryAction: { type: 'NAVIGATE', label: 'Review Course Selections', target: '?step=1' }
    };
  },

  MIN_CREDIT_FLOOR_VIOLATION: (err) => {
    const projected = err.projectedUnits;
    const min = err.minimumRequired || 15;
    const needed = projected ? min - projected : null;
    return {
      title: 'Minimum Credit Floor Required',
      problem: projected 
        ? `Your selection contains only ${projected} credit units. Senate regulations require a minimum of ${min} units for regular registration.`
        : 'Your selection contains fewer than the mandatory minimum credit units.',
      remediation: needed
        ? `Please select at least ${needed} more credit unit${needed > 1 ? 's' : ''} before submitting.`
        : 'Please add additional approved core or elective courses before final submission.',
      severity: 'error',
      recoveryAction: { type: 'NAVIGATE', label: 'Browse Eligible Courses', target: '?step=1' }
    };
  },

  COURSE_CAPACITY_EXCEEDED: (err) => ({
    title: 'Course Enrollment Full',
    problem: `Course ${err.courseId || ''} has reached its approved seat capacity for this term.`,
    remediation: 'Please select an alternative elective module or consult your Level Advisor for quota allocation.',
    severity: 'warning',
    recoveryAction: { type: 'NAVIGATE', label: 'Select Alternate Course', target: '?step=1' }
  }),

  ELIGIBILITY_VIOLATION: (err) => {
    const count = err.violations?.length || 1;
    return {
      title: 'Course Eligibility Restriction',
      problem: `Your submission contains ${count} course${count > 1 ? 's' : ''} that do not meet departmental eligibility or prerequisites.`,
      remediation: 'Review the flagged courses in your list and remove ineligible modules before re-submitting.',
      severity: 'error',
      recoveryAction: { type: 'NAVIGATE', label: 'Review Flagged Courses', target: '?step=1' }
    };
  },

  // ── Network & Load-Shedding ──
  RATE_LIMIT_EXCEEDED: () => ({
    title: 'Request Rate Limit Exceeded',
    problem: 'You are submitting requests too quickly for the campus gateway.',
    remediation: 'Please pause for a few seconds before trying again.',
    severity: 'warning'
  }),

  NETWORK_ERROR: () => ({
    title: 'Campus Gateway Unreachable',
    problem: 'The browser cannot establish a connection to the FOCIT portal server.',
    remediation: 'Check your Wi-Fi or mobile network connection and retry.',
    severity: 'error',
    recoveryAction: { type: 'RETRY', label: 'Check Connection' }
  })
};
```

---

## 3. Phase 2: Dual-State Wizard Architecture & Concurrency Defense

### 3.1 Concurrency & Resource Ordering (Backend Authority)
- **Invariant 3 (Dijkstra Resource Ordering):**
  - All multi-row locking across courses is executed strictly within PostgreSQL transactions inside [`registrationController.js`](file:///c:/Users/PC/Desktop/OneDrive/Documents/focit_lms/packages/bff/src/controllers/registrationController.js) using:
    ```sql
    SELECT course_id, max_capacity, enrolled_count 
    FROM courses 
    WHERE course_id = ANY($1::varchar[])
    ORDER BY course_id ASC
    FOR UPDATE;
    ```
  - **Zero client involvement:** The React client passes requested IDs; the backend guarantees deterministic lexicographical lock acquisition.
  - **40P01 / 40001 Jittered Retry Wrapper:**
    Transient serialization failures under burst surges are trapped in a backend retry wrapper with bounded exponential backoff (`Math.random() * 50ms`), completely transparent to the user.

### 3.2 Dual-State Partitioning (Invariant 2)
The 764-line [`CourseRegistrationPage.jsx`](file:///c:/Users/PC/Desktop/OneDrive/Documents/focit_lms/packages/frontend/src/pages/CourseRegistrationPage.jsx) is decomposed into dumb presentation components powered by a clean custom hook:

```
src/
  pages/
    CourseRegistrationPage.jsx        (Dumb layout shell < 180 lines)
  components/registration/
    RegistrationStepIndicator.jsx     (Pure navigation indicator)
    AvailableCoursesTable.jsx         (Course catalog with search & filters)
    SelectedCoursesSummary.jsx        (Unit counter & balance indicator)
    RegistrationDeclarationModal.jsx  (Accessible <dialog> with idempotency lock)
  hooks/
    useRegistrationWizard.js          (Dual-state partitioning engine)
```

**State Division:**
1. **URL `SearchParams`:**
   - `?step=1|2|3`
   - `?filter=ALL|CORE|ELECTIVE`
   - `?search=...`
   - Zero sensitive PII; enables seamless back/forward browser navigation.
2. **Authenticated Scoped `sessionStorage` Sandbox:**
   - Scope key: `focit_reg_draft:${user.studentId}:${currentSemesterId}`
   - Flushed on account switch, logout, or session expiry.
   - If a different matric number is detected in local state, the foreign draft is instantly wiped.
3. **Idempotency Guard:**
   - Generating a unique client-side transaction token (`crypto.randomUUID()`) per registration attempt sent in the `Idempotency-Key` HTTP header.

---

## 4. Phase 3: W3C Viewport Physics & Ergonomics

### 4.1 Two-Tier Viewport Containment (`LoginPage.jsx` & Protected Views)
To eliminate mobile keyboard oscillation and dynamic URL bar thrashing:

1. **Outer Viewport Lock (Canvas):**
   ```css
   position: fixed;
   inset: 0;
   height: 100dvh;
   max-height: 100dvh;
   overflow: hidden;
   margin: 0;
   padding: 0;
   ```
2. **Inner Isolated Scrollport (Plane):**
   ```css
   height: 100%;
   overflow-y: auto;
   overflow-x: hidden;
   overscroll-behavior-y: contain;
   contain: layout paint;
   isolation: isolate;
   -webkit-overflow-scrolling: touch;
   ```
   - `contain: layout paint` isolates reflow calculations when the virtual keyboard engages.
   - `isolation: isolate` guarantees clean z-index compositing without GPU texture thrashing.

### 4.2 Typographic Hierarchy & Touch Target Standards
- **Inter (`--font-sans`):** Base line-height 1.5, form inputs, dense tabular data. High-contrast `#0f172a` (13.8:1 contrast on white).
- **Merriweather (`--font-heading`):** University crest titles, degree declarations, formal policy alerts.
- **Outfit (`--font-display`):** Telemetry badges (`24 / 24 Units`), course codes (`CSC 204`).
- **WCAG $44\times 44\text{px}$ Rule:** All clickable controls enforce `min-h-[44px]` and `min-w-[44px]` touch targets.

---

## 5. Phase 4: Zero-Trust UI Primitives

### 5.1 `<ErrorAlertCallout />` (Inlined Form & Step Feedback)
- Displays structured 4-tuple error:
  - Header with contextual icon and title.
  - Problem text in clear English.
  - **"What is needed"** box with explicit institutional guidance.
  - Deterministic recovery button (`<button type="button">`).

### 5.2 `<ErrorStateView />` (Full Scrollport Replacement)
- Completely replaces legacy [`ErrorState.jsx`](file:///c:/Users/PC/Desktop/OneDrive/Documents/focit_lms/packages/frontend/src/components/ErrorState.jsx).
- Replaces brute-force `window.location.reload()` with non-destructive React Query `refetch()` triggers.
- Redacts database internals; presents an IT Support correlation token (`Ref: err_...`).
