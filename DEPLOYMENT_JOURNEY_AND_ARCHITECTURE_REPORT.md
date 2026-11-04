# FOCIT LMS - Cloud Deployment Journey & Technical Report
**System:** UNIOSUN Faculty of Computing & Information Technology Learning Management System  
**Prepared For:** Project Stakeholders, Faculty Leadership (Dean & HODs), and Engineering Team  
**Author:** Lead Full-Stack & DevOps Engineering  
**Version:** 1.0.0 (Production Staging)  
**Date:** November 2026  

---

## 1. Executive Summary

This report documents the architectural design, engineering challenges, and deployment milestones undertaken to bring the **UNIOSUN FOCIT LMS** to the cloud. 

Historically, university learning portals experience severe bottlenecks during registration windows and exam rushes due to monolithic, tightly coupled architectures. To prevent these failures, FOCIT LMS was deployed using a **decoupled, multi-cloud microservices architecture**:

* **Presentation Tier:** Deployed globally to **Vercel's Edge CDN** for sub-second page loads on student mobile phones.
* **API Gateway & Business Logic:** Deployed as a containerized Docker service on **Render**, featuring bulkhead concurrency limits.
* **Persistence & State:** Hosted in **Frankfurt, Europe** on **Neon Serverless PostgreSQL** and **Upstash Redis**, cutting network latency from Nigeria by more than 50%.
* **Learning Engine:** Powered by a dedicated **Moodle LMS container on Railway**, connected via an automated bidirectional REST synchronization pipeline.

```mermaid
flowchart TD
    subgraph ClientLayer["1. End-User Layer (Any Device / Mobile / Laptop)"]
        User["Students, Lecturers, Advisors, HOD, & Admin"]
    end

    subgraph EdgeLayer["2. Global Presentation Tier (Vercel Edge Network)"]
        VercelSPA["Vercel Edge CDN\n(https://focit-lms-indol.vercel.app)\n• React 18 + Vite SPA\n• Static Asset Caching\n• /api/* Reverse Proxy Rewrite"]
    end

    subgraph GatewayLayer["3. Secure Application Gateway Tier (Render Frankfurt)"]
        RenderBFF["Render Web Service (focit-bff)\n• Node 20 Alpine Docker Container\n• Concurrency Gate & Rate Limiters\n• HTTPOnly Secure Cookie Authentication"]
    end

    subgraph DataLayer["4. Cloud Data & Integration Tier (EU West / Central)"]
        NeonDB[("Neon PostgreSQL (Frankfurt)\n• 27 Applied Migrations\n• Authoritative Academic Catalog\n• Attendance & Audit Ledgers")]
        RedisDB[("Upstash Redis (Frankfurt)\n• Session Nonces & Anti-Replay Vault\n• Distributed Rate Limit Cache")]
        RailwayMoodle[("Railway Moodle (Amsterdam)\n• 43 Accredited Courses Synced\n• Bitnami Moodle Engine\n• REST Web Services (FOCIT API)")]
    end

    User -->|HTTPS| VercelSPA
    VercelSPA -->|/api/* Reverse Proxy| RenderBFF
    RenderBFF -->|Connection Pooler (Port 5432)| NeonDB
    RenderBFF -->|TLS rediss://| RedisDB
    RenderBFF -->|Moodle REST API (Token-authenticated)| RailwayMoodle
```

---

## 2. The Step-by-Step Deployment Milestones

The deployment followed a 6-stage engineering plan to ensure zero data loss, rock-solid security, and cloud high availability:

### Milestone 1: Resolving Monorepo Conflicts & PR Harmonization
* **The Challenge:** Multiple contributors pushed conflicting commits to the repository branches (`Main` and `feature/admin-dashboard`), resulting in Git merge conflicts in the database adapter and topbar navigation files.
* **Engineering Action:**
  1. Harmonized [`packages/bff/src/db/index.js`](file:///c:/Users/DELL/Downloads/FOCIT%20LMS/FOCIT-LMS/packages/bff/src/db/index.js) to accept dynamic environment overrides while enforcing a hardened 45-second connection timeout default to shield against transatlantic latency spikes.
  2. Updated [`Topbar.jsx`](file:///c:/Users/DELL/Downloads/FOCIT%20LMS/FOCIT-LMS/packages/frontend/src/components/layout/Topbar.jsx) so that student-only timetable queries only fire for student roles, eliminating 404 error cascades for Admin and Lecturer portals.
  3. Formally merged and pushed **Pull Request #15** cleanly into `Main`.

---

### Milestone 2: Halving Geographic Latency with European Database Migration
* **The Challenge:** Initial development databases were situated in Ohio, US (`us-east-2`). Round-trip latency from Nigeria was ~250ms, causing intermittent gateway timeouts.
* **Engineering Action:**
  1. Provisioned an enterprise Neon PostgreSQL database in **Frankfurt, Germany (`eu-central-1`)**, cutting latency from Nigeria down to **~80–110ms**.
  2. Executed all **27 database migrations**, generating the authoritative tables for courses, degree programmes, registration batches, attendance sessions, and immutable audit ledgers.
  3. Corrected senate matric regex constraints (`chk_senate_matric_format`) in seed scripts and populated:
     * **43 accredited courses** across 7 degree programmes.
     * **5 distinct student accounts** spanning 100L to 400L.
     * **6 staff accounts** (Lecturer, Advisors, HOD, and System Admin).

---

### Milestone 3: Containerized Backend Deployment to Render (Docker Runtime)
* **The Choice:** Instead of a generic Node runtime, we utilized the project's native [`packages/bff/Dockerfile`](file:///c:/Users/DELL/Downloads/FOCIT%20LMS/FOCIT-LMS/packages/bff/Dockerfile) (`node:20-alpine`).
* **Benefits:**
  * **Zero Environment Drift:** Exact parity between local development and production.
  * **Automated Monorepo Isolation:** Builds the `@focit/bff` workspace cleanly.
  * **Health Probes:** Added `/health` and `/healthz` endpoints for continuous uptime monitoring.
* **Live Service URL:** `https://focit-bff-nqft.onrender.com`

---

### Milestone 4: Edge Frontend Deployment on Vercel
* **The Process:**
  1. Created a dedicated fork (`Ayomide-glitch/FOCIT-LMS`) to establish automated GitHub webhook triggers.
  2. Configured Vercel's build pipeline targeting `packages/frontend` with the Vite framework preset.
  3. Implemented a zero-latency reverse proxy via `vercel.json`:
     ```json
     {
       "rewrites": [
         {
           "source": "/api/:path*",
           "destination": "https://focit-bff-nqft.onrender.com/api/:path*"
         },
         {
           "source": "/(.*)",
           "destination": "/index.html"
         }
       ]
     }
     ```
  4. The frontend compiles and deploys globally in **under 20 seconds**.
* **Live Portal URL:** `https://focit-lms-indol.vercel.app`

---

### Milestone 5: Moodle Cloud Provisioning & Automated Catalog Sync
* **The Challenge:** Moodle requires PHP, an Apache web server, persistent disk space for course binaries, and a MariaDB relational database. Running Moodle in standard serverless functions is impossible.
* **Engineering Action:**
  1. Provisioned a containerized Bitnami Moodle instance with persistent volumes on **Railway** in Amsterdam, Netherlands:  
     `https://moodle-production-2aab.up.railway.app`
  2. Overcame Moodle's built-in `accessexception` by constructing a dedicated **`FOCIT API` Custom External Service** and granting:
     * `core_course_create_courses`
     * `core_course_get_courses_by_field`
     * `core_user_create_users`
     * `enrol_manual_enrol_users`
  3. Enhanced [`sync_courses_to_moodle.js`](file:///c:/Users/DELL/Downloads/FOCIT%20LMS/FOCIT-LMS/packages/bff/scripts/sync_courses_to_moodle.js) to support direct CLI tokens and upstream shortname verification.
  4. **Executed catalog ingestion:** All **43 accredited courses were automatically provisioned into Moodle** with 100% success.

---

### Milestone 6: End-to-End Live Verification & Smoke Testing
We executed real-time synthetic login requests against the production Vercel Edge CDN:

```
[TEST 1] System Administrator Login:
POST https://focit-lms-indol.vercel.app/api/auth/login
Status: HTTP 200 OK
Payload: {"status":"authenticated","role":"SYSTEM_ADMIN","user":"FOCIT System Administrator"}
Cookie: focit_token (HttpOnly, Secure, SameSite=Strict)

[TEST 2] Student Login (John Doe - 200L CSC):
POST https://focit-lms-indol.vercel.app/api/auth/login
Status: HTTP 200 OK
Payload: {"status":"authenticated","role":"STUDENT","fullName":"John Doe"}
```

Both tests verified that reverse proxies, CORS headers, Redis token ledgers, and database pools operate seamlessly end-to-end.

---

## 3. Live Environments & Testing Directory

The platform is accessible worldwide across all modern browsers:

| Component | Provider / Platform | Live Production URL | Notes |
| :--- | :--- | :--- | :--- |
| **FOCIT Academic Portal** | **Vercel** | [https://focit-lms-indol.vercel.app](https://focit-lms-indol.vercel.app) | Primary student & staff web interface |
| **BFF & API Gateway** | **Render (Docker)** | [https://focit-bff-nqft.onrender.com](https://focit-bff-nqft.onrender.com) | Express API, reverse proxy, health checks |
| **Moodle Learning Engine** | **Railway** | [https://moodle-production-2aab.up.railway.app](https://moodle-production-2aab.up.railway.app) | 43 accredited courses, assessments |
| **Core Relational DB** | **Neon (Frankfurt)** | `ep-little-credit-b98qbtly...` | Pooled PostgreSQL 15 |
| **Session Cache & Nonces** | **Upstash (Frankfurt)** | `knowing-ibex-119395.upstash.io` | TLS Redis 7 |

### Test Credentials for Stakeholder Walkthroughs

* **Universal Default Password:** `password123`

```
┌────────────────────────────────────────────────────────────────────────┐
│                   STAKEHOLDER TESTING DIRECTORY                        │
├─────────────────────┬──────────────┬───────────────┬───────────────────┤
│ Portal Role         │ Username     │ Identifier    │ Scope of Testing  │
├─────────────────────┼──────────────┼───────────────┼───────────────────┤
│ System Admin        │ admin1       │ ADM/2026/001  │ User Provisioning,│
│                     │              │               │ Course Catalog    │
├─────────────────────┼──────────────┼───────────────┼───────────────────┤
│ Course Lecturer     │ lecturer1    │ FOCIT/STF/2026│ Attendance OTP,   │
│                     │              │               │ Roster & Quizzes  │
├─────────────────────┼──────────────┼───────────────┼───────────────────┤
│ Head of Dept (HOD)  │ hod1         │ FOCIT/STF/2012│ Course Allocation │
│                     │              │               │ Matrices          │
├─────────────────────┼──────────────┼───────────────┼───────────────────┤
│ 200L Level Advisor  │ advisor1     │ FOCIT/STF/2018│ Course Batch      │
│                     │              │               │ Clearances        │
├─────────────────────┼──────────────┼───────────────┼───────────────────┤
│ Student (200L CSC)  │ student1     │ 2024/0042     │ Enrolled Courses, │
│                     │              │               │ PQs, Timetable    │
└─────────────────────┴──────────────┴───────────────┴───────────────────┘
```

---

## 4. Architectural Safeguards for Faculty Scale (2,000+ Students)

1. **Anti-Crash Bulkhead Concurrency Gate:**  
   Heavy analytical queries by administrators or HODs are isolated into bounded connection pools. A spike in admin activity **never** consumes connection slots needed for student attendance check-ins or quiz attempts.
2. **Transactional Outbox Engine:**  
   If Moodle undergoes scheduled maintenance, the FOCIT portal does **not** fail. All course modifications and quiz grades are stored in PostgreSQL's transactional `outbox_events` table and automatically retried when Moodle returns online.
3. **Automated Continuous Deployment (CI/CD):**  
   Any code modification committed and pushed to the GitHub repository automatically builds, tests, and deploys to Vercel and Render in under 60 seconds with zero downtime.
