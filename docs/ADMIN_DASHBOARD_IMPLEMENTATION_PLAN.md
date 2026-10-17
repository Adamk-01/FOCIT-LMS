# FOCIT LMS - Administrator Dashboard Implementation Plan (Full-Stack)

**Document Version:** 1.0.0  
**Owner:** Backend Lead / Administrator Domain Lead  
**Target Monorepo:** `FOCIT-LMS` (`packages/bff` & `packages/frontend`)  
**Scope:** Full-Stack Vertical Slice (Backend APIs + React UI)  

---

## 1. Domain Overview & Purpose

The **Administrator Dashboard** is the institutional command center of the FOCIT LMS platform. It provides system administrators and faculty officers with operational oversight, user management, Moodle integration health monitoring, and security auditability.

### Core Architectural Principles
1. **Separation of Concerns:** Academic identity, account lifecycle, and governance state live in FOCIT PostgreSQL. Learning delivery and course activities live in Moodle.
2. **Zero-Trust Access Control:** All administrative routes are protected by multi-factor session validation (`authMiddleware`) and strict role gating (`requireRole(['ADMIN', 'SYSTEM_ADMIN'])`).
3. **Operational Transparency:** Provides live visibility into the transactional Moodle outbox queue, enabling administrators to detect and retry failed course enrolments or synchronization jobs without touching the database directly.

---

## 2. System Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 FRONTEND (packages/frontend/src/pages)                      │
│                          AdminDashboardPage.jsx                             │
├─────────────────────┬───────────────────────┬───────────────────────────────┤
│ Tab 1: Overview     │ Tab 2: User Directory │ Tab 3: Moodle Sync & Outbox   │
│ • System Health     │ • Search & Filter     │ • Failed Enrolment Queue      │
│ • Active KPI Cards  │ • Create User Modal   │ • Manual "Retry Sync" Action  │
├─────────────────────┴───────────────────────┴───────────────────────────────┤
│ Tab 4: Security & Audit Ledger                                              │
│ • Searchable audit trail (Actor, Action, Target, IP, Timestamp)             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTPS / JSON (withCredentials: true)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                   BACKEND (packages/bff/src/routes/admin.js)                │
├─────────────────────────────────────────────────────────────────────────────┤
│ Barrier: authMiddleware + requireRole(['ADMIN', 'SYSTEM_ADMIN'])            │
│ Controller: adminController.js                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ Endpoints:                                                                  │
│ • GET   /api/admin/dashboard          (Aggregated metrics & health)         │
│ • GET   /api/admin/users              (Paginated user list)                 │
│ • POST  /api/admin/users              (Provision new student or staff)      │
│ • PATCH /api/admin/users/:id/status   (Activate/Suspend account)            │
│ • GET   /api/admin/integrations/moodle (Real-time Moodle connectivity)      │
│ • GET   /api/admin/integrations/outbox (Pending/Failed outbox queue)        │
│ • POST  /api/admin/integrations/outbox/:id/retry (Trigger immediate retry)  │
│ • GET   /api/admin/audit-logs         (Query identity_audit_logs)           │
└──────────────────────┬───────────────────────────────────────┬──────────────┘
                       │                                       │
                       ▼                                       ▼
          PostgreSQL Database (focit_db)             Moodle Learning Engine
```

---

## 3. Database Layer Updates (Migration 008)

File: `packages/bff/src/db/migrations/008_admin_governance_and_accounts.sql`

### Objectives
1. **Extend Role Definitions:** Update the `staff_advisors` role constraint to explicitly recognize `'ADMIN'` and `'SYSTEM_ADMIN'`.
2. **Seed Default Administrator Account:** Provision the primary administrative identity (`admin1`) with secure scrypt credentials so the team can log into the portal immediately.
3. **Index Optimization:** Add composite indices for fast administrative user searches and audit ledger filtering.

---

## 4. Backend Implementation Plan (`packages/bff`)

All endpoints mounted under `/api/admin` and guarded by `authMiddleware` + `requireRole(['ADMIN', 'SYSTEM_ADMIN'])`.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/admin/dashboard` | Aggregated KPIs: user counts by role, system health, pending outbox events. |
| `GET` | `/api/admin/users` | Paginated search across students and staff (filters: role, department, query). |
| `POST` | `/api/admin/users` | Provision new student or staff account with scrypt password hash. |
| `PATCH` | `/api/admin/users/:id/status` | Activate, suspend, or toggle quarantine on a user account. |
| `PATCH` | `/api/admin/users/:id/role` | Update user role or departmental scope. |
| `GET` | `/api/admin/integrations/moodle` | Real-time Moodle connectivity status, response latency, and token validation. |
| `GET` | `/api/admin/integrations/outbox` | View outbox queue (`PENDING`, `SYNCED`, `RETRYING`, `FAILED`). |
| `POST` | `/api/admin/integrations/outbox/:id/retry` | Force-trigger immediate retry of a failed outbox synchronization event. |
| `GET` | `/api/admin/audit-logs` | Paginated security audit ledger query with date and severity filters. |

---

## 5. Frontend Implementation Plan (`packages/frontend`)

### 5.1 New Page: `AdminDashboardPage.jsx`
Located at `packages/frontend/src/pages/AdminDashboardPage.jsx`.

Tabs implemented:
1. **Tab 1: Overview & Health:** KPI Cards, Infrastructure Status (DB, Redis, Moodle), quick-action controls.
2. **Tab 2: User Directory & Access Management:** Instant search, role filters, user table, "Create User" modal.
3. **Tab 3: Moodle Synchronization & Outbox Queue:** Table of outbox events, failure error inspection, "Retry Now" button.
4. **Tab 4: Security & Audit Ledger:** Chronological audit log with filter by actor/action/severity.

### 5.2 Router & Navigation Wiring
1. **Register Route in `router.jsx`:** Mount path `admin` with `AdminDashboardPage`.
2. **Add Navigation Item in `Sidebar.jsx`:** Display "Admin Portal" when `user.role === 'ADMIN'`.

---

## 6. Execution Phases & Milestones

1. **Phase 1 (Database):** Write and run migration `008_admin_governance_and_accounts.sql`.
2. **Phase 2 (Backend):** Implement `adminController.js` and `routes/admin.js`, mount in `server.js`.
3. **Phase 3 (Frontend):** Build `AdminDashboardPage.jsx` with the 4 tabs.
4. **Phase 4 (Integration):** Add `/admin` to `router.jsx` and `Sidebar.jsx`.
5. **Phase 5 (Verification):** Test full admin flow (login $\rightarrow$ overview $\rightarrow$ manage users $\rightarrow$ retry outbox).
