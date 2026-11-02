# FOCIT LMS — Production Readiness & Deployment Guide
**Document Version:** 1.0.0  
**Target Audience:** Project Manager, Technical Lead, Backend/Frontend Engineers, DevOps/SysAdmin  
**Last Updated:** November 2026  
**System Classification:** Mission-Critical Institutional Academic Infrastructure (UNIOSUN)  

---

## 1. Executive Summary (For Project Manager & Leadership)

The **Faculty of Computing and Information Technology (FOCIT) Learning Management System (LMS)** has achieved **Production Feature Completeness**. The core academic pipelines—including student registration, course enrollment, digital library access, lecture attendance tracking with NUC 75% exam clearance rules, Moodle course synchronization, and departmental role hierarchies (Student, Course Rep, Lecturer, HOD, Admin)—are implemented and locally verified.

### Current System Health & Stability
* **Frontend:** 100% clean build and zero lint errors across 169 React 19 / Vite components (`oxlint` passed).
* **Backend:** Express Backend-For-Frontend (BFF) hardened with strict concurrency bulkheads, zero-trust input validation, and PostgreSQL 16 row-level locks (`SELECT ... FOR UPDATE`).
* **Architecture:** Unified **Modular Monolith** running against a single central database. No complex distributed microservices or fragile cross-service HTTP bridges are required.

### Target Launch Topology
```
                          ┌─────────────────────────────┐
                          │   Client Browser / Mobile   │
                          └──────────────┬──────────────┘
                                         │ HTTPS
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
                 ▼ (Static SPA)                                  ▼ (/api/* Rewrites)
    ┌───────────────────────────┐                   ┌───────────────────────────┐
    │     Vercel Edge CDN       │                   │    Render Web Service     │
    │   focit-lms.vercel.app    │                   │   focit-bff.onrender.com  │
    └───────────────────────────┘                   └─────────────┬─────────────┘
                                                                  │
              ┌───────────────────────────────────────────────────┼──────────────────────────────┐
              │                                                   │                              │
              ▼                                                   ▼                              ▼
┌───────────────────────────┐                       ┌───────────────────────────┐  ┌───────────────────────────┐
│       Neon Database       │                       │       Upstash Redis       │  │   UNIOSUN Moodle Engine   │
│  PostgreSQL 16 (Frankfurt)│                       │     Serverless (TLS)      │  │ (lms.uniosun.edu.ng:8080) │
│  - Pooled: OLTP Queries   │                       │  - Auth Nonces & Locks    │  │ - Transactional Outbox    │
│  - Direct: DDL Migrations │                       │  - Rate Limit Buckets     │  │ - Materials & Submissions │
└─────────────┬─────────────┘                       └───────────────────────────┘  └───────────────────────────┘
              │
              ▼
┌───────────────────────────┐
│   Render Worker Service   │
│       focit-worker        │
│ (Outbox & Sweeper Engine) │
└───────────────────────────┘
```

---

## 2. Architectural Ground Rules (Must-Read For All Engineers)

> [!IMPORTANT]
> **RULE 1: ONE DATABASE TO RULE THEM ALL (DO NOT SHARD)**  
> All 4 roles (**Student, Lecturer, HOD, Admin**) operate within the **exact same Neon PostgreSQL database**. Lecturer and HOD dashboards execute high-speed relational `JOIN` queries across `students`, `enrollments`, `attendance_sessions`, and `quiz_attempts`. **Never split the database into separate projects or build internal HTTP bridges between dashboards.**

> [!IMPORTANT]
> **RULE 2: SEPARATE WEB TRAFFIC FROM BACKGROUND WORKERS**  
> In production, web servers handling student HTTP requests must be completely decoupled from background cron jobs and Moodle outbox pollers. The web container must run with `RUN_EMBEDDED_WORKERS=false`, while a single dedicated background worker (`focit-worker`) executes outbox sweeps and periodic telemetry persistence.

> [!IMPORTANT]
> **RULE 3: DATABASE CONNECTION POOLING IS MANDATORY**  
> Web traffic must connect via the Neon connection pooler (`-pooler.eu-central-1.aws.neon.tech`). Direct database connections are reserved strictly for schema migrations and DDL execution.

---

## 3. What Has Been Completed & Battle-Tested

The following foundational systems are 100% finished and verified in the codebase:

| Capability | Technical Implementation | Status |
| :--- | :--- | :--- |
| **Phase 19 Attendance Engine** | 3-Ring Course Rep provenance guards, faculty-lock immutability, sub-session multi-entry aggregation, and medical excuse zero-division protection. | Verified |
| **NUC 75% Exam Eligibility** | Deterministic relational math calculating eligible vs. disqualified students based on official NUC criteria. | Verified |
| **In-Process Concurrency Bulkhead** | Node.js semaphore gate capping Staff/HOD/Admin heavy analytical queries at $\le 5$ connections, guaranteeing $\ge 15$ of 20 pool connections for student check-ins and tests. | Verified |
| **3-Tier Timeout Hierarchy** | Enforces strict cancellation ordering ($8\text{s Tx} < 12\text{s Role} < 15\text{s Driver}$) to eliminate zombie database locks without dropping client TCP sockets. | Verified |
| **Transactional Outbox Engine** | Reliable Moodle dispatch engine using PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED` for zero-loss background syncing. | Verified |
| **Zero-Trust Security Barrier** | Sec-Fetch metadata cross-origin isolation, CSRF double-submit protection, and cryptographically signed HttpOnly JWT cookies. | Verified |
| **Graceful Zero-Downtime Drain** | Coordinated SIGTERM lifecycle that drains in-flight HTTP requests and database sockets within 15 seconds before process termination. | Verified |

---

## 4. Production Checklist: What Still Needs To Be Done

This actionable checklist identifies every open item required before opening the system to UNIOSUN staff and students.

### Responsibility Matrix & Timeline

```
Legend: [CRITICAL] = Blocker for Public Launch | [HIGH] = Required Week 1 | [MEDIUM] = Operational Polish
```

| ID | Task Description | Owner | Priority | Target Date | Status |
| :---: | :--- | :---: | :---: | :---: | :---: |
| **SEC-1** | Add Reverse Proxy Trust to Express BFF (`trust proxy = 1`) | Backend | **CRITICAL** | Day 1 | **Done** |
| **DB-1** | Disable Neon Scale-to-Zero (`suspend_timeout: 0`) on Production | DevOps | **CRITICAL** | Day 1 | Pending |
| **DB-2** | Configure Role Statement Timeout (`ALTER ROLE ... SET statement_timeout = '12s'`) | Backend / DBA | **CRITICAL** | Day 1 | Pending |
| **DB-3** | Run Production Schema Migrations on Direct Connection | DevOps | **CRITICAL** | Day 1 | Pending |
| **SEC-2** | Invalidate Default Passwords & Force First-Login Reset | Backend / DBA | **CRITICAL** | Day 2 | Pending |
| **RED-1** | Provision Managed Upstash Redis Cluster (TLS Enabled) | DevOps | **CRITICAL** | Day 2 | Pending |
| **LMS-1** | Connect Real UNIOSUN Moodle Endpoint & Inject WS Token | DevOps / PM | **CRITICAL** | Day 2 | Pending |
| **OPS-1** | Deploy BFF Web Service & Dedicated Worker to Render | DevOps | **CRITICAL** | Day 3 | Pending |
| **OPS-2** | Deploy React Frontend to Vercel & Verify API Proxy Rewrites | Frontend | **CRITICAL** | Day 3 | Pending |
| **STO-1** | Setup S3 / Cloudflare R2 Storage for PDF Documents & Sheets | Backend | **HIGH** | Day 4 | Pending |
| **MON-1** | Connect Sentry Error Monitoring & Uptime Kuma Health Probes | DevOps | **HIGH** | Day 4 | Pending |
| **TST-1** | End-to-End Role Verification Walkthrough (All 4 Portals) | QA / PM | **CRITICAL** | Day 5 | Pending |

---

## 5. Detailed Technical Action Items

### Action Item 1: Neon PostgreSQL Production Branch Configuration
* **Why:** In development, Neon auto-pauses compute after 5 minutes of inactivity. In production, a cold start takes 3–5 seconds, causing mobile clients to timeout.
* **Steps for DevOps / DBA:**
  1. Open the [Neon Console](https://console.neon.tech).
  2. Select the `Focit_database` project and switch to the `production` branch.
  3. Navigate to **Compute settings** and set **Scale to zero** to **Disabled** (`suspend_timeout: 0`).
  4. Ensure compute size is set to at least **1 CU** (Compute Unit: 1 vCPU, 4GB RAM) for launch week.
  5. Open the SQL Editor and execute the statement timeout safeguard:
     ```sql
     ALTER ROLE focit_user SET statement_timeout = '12000ms';
     ```
  6. Execute the pre-flight migration on the direct connection:
     ```bash
     npm run db:migrate -w packages/bff
     ```

### Action Item 2: Managed Redis Provisioning (Upstash)
* **Why:** The BFF uses Redis for single-flight distributed locking, session nonce tracking, and rate limiting. A local container will wipe sessions whenever restarted.
* **Steps for DevOps:**
  1. Create an **Upstash Redis** database located in **Frankfurt (AWS `eu-central-1`)** to be co-located with Neon (<2ms RTT).
  2. Enable **TLS (rediss://)**.
  3. Copy the rediss connection string:
     `rediss://default:your_upstash_token@your-endpoint.upstash.io:6379`
  4. Ensure eviction policy is set to `volatile-lru` or `allkeys-lru` with a memory cap of $\ge 256\text{MB}$.

### Action Item 3: Neutralize Default Seed Passwords
* **Why:** Seed accounts currently use default development credentials (`password123`).
* **Steps for Backend / Security:**
  1. Run this SQL query directly in Neon production before user onboarding:
     ```sql
     -- Force all existing accounts to change password upon initial login
     UPDATE student_profiles SET must_change_password = TRUE;
     
     -- Verify zero plain-text passwords exist
     SELECT COUNT(*) FROM student_profiles WHERE password_hash NOT LIKE '$2b$%';
     ```

### Action Item 4: Cloud Object Storage Setup (PDFs & Attendance Sheets)
* **Why:** Render web containers use ephemeral local disk storage. Any uploaded student assignments, attendance CSV sheets, or digital library PDFs saved in `.cache/` will be deleted on every redeployment.
* **Steps for Backend Team:**
  1. Provision an **AWS S3** bucket or **Cloudflare R2** bucket named `focit-lms-production`.
  2. Configure `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` in the BFF config.
  3. Direct all file uploads and digital library downloads through presigned URLs.

### Action Item 5: Real Institutional Moodle Integration
* **Why:** The system is currently pointing to a mock Moodle container.
* **Steps for Project Manager & DevOps:**
  1. Obtain the official UNIOSUN Moodle Web Services Token from the University ICT Centre.
  2. Verify that the token has permissions for:
     * `core_course_get_courses`
     * `core_course_get_contents`
     * `mod_assign_get_assignments`
     * `mod_assign_save_grade`
  3. Update `MOODLE_BASE_URL` to `https://lms.uniosun.edu.ng`.
  4. Update `MOODLE_WS_TOKEN` in the production environment vault.

---

## 6. Step-by-Step Production Deployment Runbook

### Step 1: Prepare Database Environment Variables
Gather your Neon connection strings:
* **Pooled URL (for web traffic):**  
  `postgresql://focit_user:PASS@ep-xyz-pooler.eu-central-1.aws.neon.tech/focit_db?sslmode=require`
* **Direct URL (for migrations):**  
  `postgresql://focit_user:PASS@ep-xyz.eu-central-1.aws.neon.tech/focit_db?sslmode=require`

### Step 2: Deploy Web Service to Render
1. Log into [Render.com](https://render.com).
2. Create a new **Web Service** connected to the GitHub repository: `Adamk-01/FOCIT-LMS`.
3. Set the following build and run configurations:
   * **Name:** `focit-bff`
   * **Region:** `Frankfurt (EU Central)`
   * **Branch:** `Main`
   * **Root Directory:** *(leave blank / repo root)*
   * **Runtime:** `Node`
   * **Build Command:** `npm install`
   * **Start Command:** `npm run start -w packages/bff`
4. Add all required Environment Variables (see Section 7 below).
5. Set **Health Check Path** to: `/health`.

### Step 3: Deploy Dedicated Worker Service to Render
1. In Render, create a new **Background Worker**.
2. Connect to the same repository `Adamk-01/FOCIT-LMS`.
3. Configure settings:
   * **Name:** `focit-worker`
   * **Region:** `Frankfurt (EU Central)`
   * **Build Command:** `npm install`
   * **Start Command:** `npm run start:worker -w packages/bff`
4. Copy the exact same environment variables from the web service, but ensure `RUN_EMBEDDED_WORKERS=false` is set on the web service so only this worker processes outbox batches.

### Step 4: Deploy Frontend SPA to Vercel
1. Log into [Vercel.com](https://vercel.com).
2. Import project from GitHub: `Adamk-01/FOCIT-LMS`.
3. Configure project settings:
   * **Framework Preset:** `Vite`
   * **Root Directory:** `packages/frontend`
   * **Build Command:** `npm run build`
   * **Output Directory:** `dist`
4. In `packages/frontend/vercel.json`, ensure the proxy destination matches your live Render BFF URL:
   ```json
   {
     "rewrites": [
       {
         "source": "/api/:path*",
         "destination": "https://focit-bff.onrender.com/api/:path*"
       },
       {
         "source": "/(.*)",
         "destination": "/index.html"
       }
     ]
   }
   ```
5. Deploy and verify that the custom domain (e.g., `lms.focit.uniosun.edu.ng`) is assigned.

---

## 7. Master Environment Variables Reference

Use this exact key-value mapping to configure Render, Vercel, and local staging:

| Environment Variable | Target Service | Sensitivity | Description & Recommended Production Value |
| :--- | :--- | :---: | :--- |
| `NODE_ENV` | BFF & Worker | Low | Set strictly to `production`. |
| `PORT` | BFF Web | Low | `3000` (Render sets this automatically). |
| `DATABASE_URL` | BFF & Worker | **HIGH** | Neon **Pooled** connection string (`ep-...-pooler...`). |
| `DIRECT_DATABASE_URL` | BFF & Worker | **HIGH** | Neon **Direct** connection string (`ep-...` without `-pooler`). |
| `REDIS_URL` | BFF & Worker | **HIGH** | Upstash TLS URL (`rediss://default:token@...upstash.io:6379`). |
| `FRONTEND_ORIGIN` | BFF Web | Medium | Production frontend URL, e.g. `https://focit-lms.vercel.app`. |
| `JWT_SECRET` | BFF Web | **CRITICAL** | Minimum 64-character random string (`openssl rand -hex 32`). |
| `JWT_ISSUER` | BFF Web | Low | `focit-lms`. |
| `JWT_AUDIENCE` | BFF Web | Low | `focit-materials`. |
| `EDGE_TICKET_SECRET` | BFF Web | **CRITICAL** | Minimum 64-character random string (`openssl rand -hex 32`). |
| `MOODLE_BASE_URL` | BFF & Worker | Medium | `https://lms.uniosun.edu.ng`. |
| `MOODLE_WS_TOKEN` | BFF & Worker | **CRITICAL** | Official UNIOSUN Web Services Token. |
| `MOODLE_POOL_MAX_CONNECTIONS`| BFF Web | Low | `50` (Undici HTTP/1.1 socket pool ceiling). |
| `RUN_EMBEDDED_WORKERS` | BFF Web | Low | Set to `false` on web nodes; background handled by worker. |
| `CACHE_DIR` | BFF Web | Low | Local cache path (e.g., `/tmp/focit-cache` or mounted volume). |

---

## 8. Post-Deployment Verification (Smoke Test Checklist)

Once deployed, the QA lead and developers must execute this 10-point end-to-end verification walkthrough:

- [ ] **1. Public Health Check:** `GET https://focit-bff.onrender.com/health` returns HTTP 200 with `status: "healthy"` and memory statistics.
- [ ] **2. SSL & Cookie Inspection:** Log in via `POST /api/auth/login`. Verify response sets `focit_token` with `HttpOnly`, `Secure`, `SameSite=Strict`, and `Path=/`.
- [ ] **3. Student Portal Verification:** Access student dashboard. Verify course allocations, attendance percentage (NUC 75% indicator), and timetables load without error.
- [ ] **4. Lecturer Portal Verification:** Log in as lecturer. Verify enrolled student cohorts appear under courses, and attendance QR/code session creation works.
- [ ] **5. HOD Portal Verification:** Log in as HOD. Verify department-wide course allocation matrices and lecturer assignments render cleanly.
- [ ] **6. Admin Portal Verification:** Log in as Admin. Verify system audit logs and student enrollment managers render without timeouts.
- [ ] **7. Bulkhead Gate Protection:** Verify that 10 concurrent requests to `/api/admin/reports` do not block student attendance check-ins or quiz attempts.
- [ ] **8. Moodle Transactional Outbox:** Trigger an assignment grade submission. Confirm event is inserted into PostgreSQL `outbox_events` and worker dispatches it to Moodle.
- [ ] **9. Forced Password Change:** Log in with an account having `must_change_password: true`. Verify that non-profile routes are blocked until password is reset.
- [ ] **10. Graceful Shutdown Test:** Issue a test redeployment on Render. Verify zero dropped in-flight requests during the 15-second drain window.

---

## 9. Contacts & Incident Escalation

* **Lead Architect / Backend Engineering:** FOCIT LMS Core Engineering Team
* **Frontend Engineering Lead:** React / Client Applications Team
* **Project Manager:** FOCIT LMS Project Office
* **Institutional Liaison:** UNIOSUN Directorate of Information and Communication Technology (DICT)
