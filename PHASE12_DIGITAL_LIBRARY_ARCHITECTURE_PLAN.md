# Phase 12 Implementation Plan: Digital Library Categorization & Resource Vault

**Role:** Staff Systems Architect & Zero-Trust Client Lead  
**Document Status:** ✅ APPROVED (Post-Grill Authorization) — Implementation in Progress  
**Subsystems:** `packages/bff` (Express BFF, PostgreSQL 16, LRU Disk Cache) ↔ `packages/frontend` (React 19, Tailwind CSS, TanStack Query)  
**Governing Standard:** The 8-8-8 Architectural Doctrine (`focit-architect`)  

---

## 1. Executive Architectural Blueprint

Currently, navigating to `/library` or clicking "Digital Library" in the sidebar issues a blind redirect to `/courses?focus=materials`. This collapses the faculty's intellectual repository into a single course-filtered materials list, obscuring faculty-wide textbooks, past examination papers, departmental handbooks, and cross-course academic resources.

This Phase 12 milestone decouples and elevates the **Digital Library** into a first-class, multi-dimensional academic repository divided into four core categories:
1. **Course Materials & Lecture Compendium:** Course-indexed lecture notes, slide decks, and lab handouts with instant bidirectional navigation to active course rooms (`/courses/:courseId?tab=materials`).
2. **Textbooks & E-Books:** Curated reference monographs, core textbooks, and recommended reading categorized by department, academic level, and subject domain.
3. **Past Question Vault (PQ Vault):** Indexed repository of past semester examination papers, mid-semester test papers, and marking schemes filterable by Session, Semester, Level, and Course Code.
4. **Faculty Academic Resources:** Global institutional documents including Student Handbooks, SIWES/SWEP logbook guidelines, Final Year Project (FYP) dissertation LaTeX/Word templates, academic calendars, and department laboratory policies.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT PLANE (React 19 Zero-Trust UI)                                 │
│                                                                                                         │
│  Digital Library Hub (/library):                                                                        │
│  - URL SearchParams State Partitioning: ?category=courses|textbooks|past_questions|resources            │
│  - Multi-Dimensional Filter Bar: Course Selector, Dept Filter, Level (100L-400L), Academic Session, Query │
│  - Category 1: Course Materials Browser with Course Cards & Direct Jump into Course Rooms               │
│  - Category 2: Textbooks Catalog with Cover Art, ISBN, Author, Level & Streaming PDF Reader             │
│  - Category 3: PQ Vault with Session/Semester Matrix (Harmattan / Rain) & Watermarked Verification      │
│  - Category 4: Faculty Resources (Handbooks, SIWES, FYP LaTeX Templates, Lab Guides)                   │
│  - Dual Modal Preview: Virtualized PDF Streaming Viewer + Mutation-Locked Download Engine              │
└────────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
                                                     │ HTTPS / HttpOnly Cookie + Session Nonce
                                                     │ HTTP Range: bytes=start-end (206 Partial Content)
                                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        COMPUTE PLANE (Express BFF)                                      │
│                                                                                                         │
│  Route: /api/library                                                                                    │
│  - Tier 1: RBAC & Exam Embargo Quarantine (Blocks unreleased exam papers from student ingress)          │
│  - Tier 2: Full-Text Search Engine (PostgreSQL tsvector / GIN Indexing with TS_RANK ranking)            │
│  - Tier 3: Course Material Aggregator (Federates Moodle course files with local PostgreSQL repository)  │
│  - Tier 4: Zero-Heap Binary Stream Controller (fs.createReadStream -> 206 Partial Content Pipeline)    │
│  - Tier 5: LRU Disk Cache & ETag Validation (304 Not Modified load-shedding for repeated views)         │
└───────────────────────────┬─────────────────────────────────────────────┬───────────────────────────────┘
                            │                                             │
                            ▼                                             ▼
┌───────────────────────────────────────────────────┐     ┌───────────────────────────────────────────────┐
│            STATE PLANE (PostgreSQL 16)            │     │           STORAGE & CACHE SUBSYSTEM           │
│                                                   │     │                                               │
│  - library_categories (taxonomy, metadata, icons) │     │  - Bounded LRU Disk Cache (2GB quota)         │
│  - library_items (textbooks, PQs, handbooks, etc.)│     │  - SingleFlight Coalescing (stampede guard)   │
│  - library_downloads (telemetry & audit ledger)   │     │  - Ephemeral Stored Artifacts & Static Slices │
│  - GIN tsvector full-text index                   │     │  - Streaming Chunks (zero Node.js heap leaks) │
└───────────────────────────────────────────────────┘     └───────────────────────────────────────────────┘
```

---

## 2. The 8-8-8 Invariant Defense Matrix

| Invariant | Doctrine Requirement | System Defense in Phase 12 |
| :--- | :--- | :--- |
| **1. Viewport Containment** | `100dvh` lock without document-level reflows | Quarantine the Digital Library inside `<main className="h-full overflow-y-auto">` with `contain: layout paint; overscroll-behavior-y: contain`. |
| **2. Dual-State Partitioning** | Navigation in URL; uncommitted state in session | Category (`?category=`), Course (`?course=`), Level (`?level=`), Session (`?session=`), and Query (`?q=`) live in URL SearchParams with debounced `{ replace: true }`. |
| **3. Resource Ordering** | Lexicographical lock order (Dijkstra Rule) | `metricsBuffer` flushes sort `item_id` lexicographically before building `UNNEST` arrays (`[...metricsBuffer.entries()].sort(([a],[b]) => a.localeCompare(b))`), guaranteeing zero `40P01` deadlock cycles across concurrent workers. |
| **4. Relational Boundary** | Acidic access checks & embargo enforcement | Index predicates use `WHERE is_published = TRUE` (engine-immutable) and cluster `embargo_until ASC NULLS FIRST` in B-Tree leaves for index-only filtering without heap thrashing. |
| **5. Cumulative Units / Quota** | Bounded storage & bandwidth protection | File uploads enforce a strict 25MB ceiling on PDFs/documents. Chunked streaming enforces backpressure with a 64KB highWaterMark buffer. |
| **6. Composite Aggregator** | Fan-out with graceful degradation | `/api/library/items?category=courses` merges PostgreSQL faculty materials with upstream Moodle course modules using `Promise.allSettled(1500ms)`, emitting `meta._degraded: true` with stale cache annotations on timeout. |
| **7. Single-Flight & SWR** | Stampede prevention on binary/catalog reads | Repeated catalog requests hit L1 SWR cache ($<3\text{ms}$). Concurrent misses coalesce via `singleFlight.do()`. Telemetry sliding leases live in memory ($<0.1\text{ms}$). |
| **8. Transactional Outbox & Write-Behind** | Durable asynchronous operations | View counters are decoupled into `library_item_metrics` and micro-batched every 10s. Zero `UPDATE` locks or dead tuples are generated on `library_items` during HTTP reads. |

---

## 3. Database Schema Design: Migration `015_digital_library_catalog_and_pqs.sql`

```sql
-- Migration 015: Digital Library Taxonomy, Textbooks, Past Questions, Metrics & Audit
BEGIN;

-- 1. Taxonomy Categories
CREATE TABLE IF NOT EXISTS library_categories (
    id VARCHAR(32) PRIMARY KEY, -- 'courses', 'textbooks', 'past_questions', 'faculty_resources'
    slug VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    icon_name VARCHAR(64) NOT NULL DEFAULT 'BookOpen',
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed core categories
INSERT INTO library_categories (id, slug, name, description, icon_name, display_order)
VALUES 
  ('courses', 'courses', 'Course Materials', 'Lecture notes, slide decks, and lab handouts organized by enrolled courses and faculty catalog', 'FolderOpen', 1),
  ('textbooks', 'textbooks', 'Textbooks & E-Books', 'Approved textbooks, reference monographs, and computing literature', 'BookOpen', 2),
  ('past_questions', 'past-questions', 'Past Questions Vault', 'Official UNIOSUN semester examination and test papers spanning past academic sessions', 'FileCheck', 3),
  ('faculty_resources', 'resources', 'Faculty Resources', 'Departmental handbooks, SIWES guidelines, FYP LaTeX templates, and academic policies', 'Award', 4)
ON CONFLICT (id) DO NOTHING;

-- 2. Library Items Repository (Immutable Metadata + Full-Text Search)
CREATE TABLE IF NOT EXISTS library_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id VARCHAR(32) NOT NULL REFERENCES library_categories(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    author VARCHAR(255),
    publisher VARCHAR(255),
    publication_year INT,
    edition VARCHAR(64),
    isbn VARCHAR(32),
    
    -- Academic Dimensions
    course_id VARCHAR(32) REFERENCES courses(course_id) ON DELETE SET NULL,
    department_id VARCHAR(32) REFERENCES departments(id) ON DELETE SET NULL,
    level INT CHECK (level IN (100, 200, 300, 400, 500)),
    academic_session VARCHAR(32), -- e.g., '2023/2024', '2024/2025'
    semester_number INT CHECK (semester_number IN (1, 2)), -- 1 = Harmattan, 2 = Rain
    
    -- Item Classification
    item_type VARCHAR(64) NOT NULL CHECK (
        item_type IN (
            'LECTURE_NOTE', 
            'LAB_MANUAL', 
            'TEXTBOOK', 
            'REFERENCE_BOOK', 
            'SEMESTER_EXAM_PQ', 
            'MIDTERM_TEST_PQ', 
            'HANDBOOK', 
            'RESEARCH_TEMPLATE', 
            'CURRICULUM_GUIDE', 
            'POLICY_DOCUMENT'
        )
    ),
    
    -- File Storage & Binary Metadata
    file_url VARCHAR(1024) NOT NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
    page_count INT DEFAULT NULL,
    cover_image_url VARCHAR(1024) DEFAULT NULL,
    
    -- Security & Publication Status
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    embargo_until TIMESTAMPTZ DEFAULT NULL,
    uploaded_by VARCHAR(64) DEFAULT 'faculty_admin',
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Search vector (English stemming)
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('english', 
            title || ' ' || 
            COALESCE(description, '') || ' ' || 
            COALESCE(author, '') || ' ' || 
            COALESCE(publisher, '') || ' ' || 
            COALESCE(course_id, '') || ' ' || 
            COALESCE(academic_session, '')
        )
    ) STORED
);

-- 3. Narrow Fixed-Width Metrics Ledger (Heap-Only Tuples / HOT Optimized)
CREATE TABLE IF NOT EXISTS library_item_metrics (
    item_id UUID PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
    view_count BIGINT NOT NULL DEFAULT 0,
    download_count BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Append-Only Audit Ledger
CREATE TABLE IF NOT EXISTS library_downloads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
    student_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(16) NOT NULL CHECK (event_type IN ('VIEW', 'DOWNLOAD')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. High-Selectivity B-Tree & GIN Indexes (NULLS FIRST Clustered)
CREATE INDEX IF NOT EXISTS idx_library_items_category_published 
    ON library_items (category_id, embargo_until ASC NULLS FIRST, created_at DESC)
    WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_library_items_course 
    ON library_items (course_id) 
    WHERE course_id IS NOT NULL AND is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_library_items_pq_lookup 
    ON library_items (category_id, academic_session, semester_number, level, course_id, embargo_until ASC NULLS FIRST)
    WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_library_items_textbooks 
    ON library_items (category_id, department_id, level, embargo_until ASC NULLS FIRST)
    WHERE is_published = TRUE;

CREATE INDEX IF NOT EXISTS idx_library_items_search_vector 
    ON library_items USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS idx_library_downloads_item_created 
    ON library_downloads (item_id, created_at DESC);

COMMIT;
```

---

## 4. Backend Ingress Architecture (`packages/bff/src/routes/library.js`)

### Endpoints Specification:

1. `GET /api/library/categories`
   - Returns all 4 categories with active aggregate counts, badges, and icon definitions.
   - SWR cached for 10 minutes.

2. `GET /api/library/items`
   - **Query Parameters:**
     * `category`: `'courses' | 'textbooks' | 'past_questions' | 'faculty_resources'` (defaults to `'courses'`)
     * `courseId`: Canonical course code (e.g., `'CSC202'`)
     * `departmentId`: Department filter (e.g., `'CSC'`)
     * `level`: Academic level (`100 | 200 | 300 | 400`)
     * `session`: Academic session (e.g., `'2023/2024'`)
     * `semester`: `1 | 2`
     * `q`: Full-text search term
     * `page`: 1-indexed pagination (default 1)
     * `limit`: Page size (default 12, max 50)
   - **SQL Implementation:** Dynamic parameterized query utilizing GIN `websearch_to_tsquery('english', $q)` with `ts_rank` relevance ordering when `q` is supplied, joined with `library_item_metrics`.
   - **Security Filter:** Strict enforcement of `WHERE is_published = TRUE AND (embargo_until IS NULL OR embargo_until <= NOW())`.

3. `GET /api/library/courses/catalog`
   - Returns student's enrolled courses + all departmental faculty courses annotated with material counts and direct links.
   - Merges PostgreSQL course files with Moodle course modules via `Promise.allSettled(1500ms)`. Emits `meta._degraded: true` on timeout with stale cached modules.

4. `GET /api/library/items/:id/stream`
   - **Zero-Heap RFC 9110 Streaming Engine:**
     * No `Range` header: streams `0` to `fileSize - 1` with status `200 OK` and `'Accept-Ranges': 'bytes'`.
     * Valid `Range: bytes=start-end`: validates `0 <= start <= end < fileSize` and returns `206 Partial Content`.
     * Out-of-bounds `Range`: returns `416 Range Not Satisfiable` with `Content-Range: bytes */${fileSize}`.
   - **Socket Teardown & EMFILE Prevention:**
     * Instantiates an explicit `AbortController` wired to `req.once('aborted', ...)` and `res.once('close', ...)`.
     * Passes `{ signal: ac.signal }` to `pipeline(readStream, res, { signal: ac.signal })`.
   - **Telemetry Sliding Lease & Write-Behind:**
     * Deduplicates inline reads via 30-minute memory lease (`view:${studentId}:${itemId}`).
     * Deduplicates downloads via 60-second debounce (`download:${studentId}:${itemId}`).
     * Enqueues into in-memory `metricsBuffer` with Dijkstra-ordered batch flush into `library_item_metrics`. Zero `UPDATE` locks during HTTP request.

---

## 5. Frontend Zero-Trust Client Plane (`packages/frontend/src/pages/DigitalLibraryPage.jsx`)

### Component Architecture & Hierarchy:

```
DigitalLibraryPage (Dumb Coordinator / URL Synchronizer)
│
├── LibraryHero (Search Bar, Faculty Badge, Stat Chips)
│
├── LibraryCategoryBar (Accessible <nav> Tabs: Course Materials | Textbooks | PQ Vault | Resources)
│
├── Multi-Dimensional Filter Deck:
│   ├── CourseMaterialsFilterDeck (Course Selector, Department, Level)
│   ├── TextbooksFilterDeck (Department, Level, Subject Area)
│   ├── PastQuestionsFilterDeck (Session 2020-2024, Semester Harmattan/Rain, Course Code)
│   └── FacultyResourcesFilterDeck (Document Type: Handbooks, Templates, Guides)
│
├── LibraryContentGrid:
│   ├── Loading State: SkeletonGrid (12 animated card placeholders, zero layout shift)
│   ├── Empty State: LibraryEmptyState (Contextual icon, clear query button, request material link)
│   ├── Error State: ErrorStateView (RFC 7807 telemetry, retry button)
│   └── Data State: Responsive Card Grid (3 columns desktop, 2 tablet, 1 mobile)
│       ├── CourseMaterialCard (Quick Jump to /courses/:id?tab=materials)
│       ├── TextbookCard (Cover Art, ISBN, Authors, Read Online, Download)
│       ├── PastQuestionCard (Session, Semester Badge, Verified Stamp, Read/Download)
│       └── FacultyResourceCard (Type pill, Format icon, LaTeX/Word download)
│
├── PDFViewerModal (Lazy loaded streaming PDF reader with virtualized canvas cleanup)
└── PaginationBar (Deterministic page navigation with bounds checking)
```

### URL State Synchronizer Contract:
All active filters map directly to URL search parameters:
- Category: `/library?category=past_questions`
- Search: `/library?category=textbooks&q=computer+networks`
- Specific Course: `/library?category=courses&course=CSC202`
- Past Question Matrix: `/library?category=past_questions&session=2023%2F2024&semester=1&course=CSC204`

Updating any input triggers an immediate debounced URL replace (`{ replace: true }`), safeguarding the student's browser history stack while making every view directly bookmarkable and shareable.

---

## 6. The Edge Case & Failure-Mode Audit

1. **Memory Exhaustion (Node.js Heap OOM):**
   - *Risk:* 100 students simultaneously downloading a 50MB textbook PDF using `res.send(fs.readFileSync(...))` would consume $5\text{GB}$ of RAM, crashing the Node.js process.
   - *Mitigation:* Zero buffering. All binary deliveries use `node:fs` `createReadStream(filePath, { start, end })` piped directly to `res` using `streamPipeline`. Peak memory footprint is $<64\text{KB}$ per active connection.

2. **Exam Paper Leakage (TOCTOU & Academic Dishonesty):**
   - *Risk:* A lecturer uploads an upcoming semester examination paper for moderation, which immediately appears in the student's PQ Vault before the exam date.
   - *Mitigation:* Schema mandates `embargo_until TIMESTAMPTZ`. Query boundary explicitly filters out any document where `embargo_until > NOW()` or `is_published = FALSE`.

3. **Missing or Corrupted Storage Assets (HTTP 404 / 500):**
   - *Risk:* Metadata row exists in PostgreSQL, but file on disk was pruned by LRU cache or not found.
   - *Mitigation:* Non-destructive fallback. If the physical file is missing, the endpoint emits RFC 7807 problem details with `code: 'FILE_NOT_FOUND'`, and the UI displays a clean error banner with an automated "Re-sync from Academic Cloud" action rather than breaking the page.

4. **Double-Click Download Storms & Socket Teardown:**
   - *Risk:* A student on a slow campus 3G network clicks the download button 6 times rapidly, or closes the tab/modal mid-stream.
   - *Mitigation:* True Stream-Lifecycle Mutation Lock (`IDLE` -> `CONNECTING` -> `STREAMING` -> `SETTLED`) bound to an `AbortController`. When the modal closes, `abortController.abort()` runs, propagating to Express where `ac.signal` tears down the `pipeline()` and invokes `readStream.destroy()` (`uv_fs_close`), guaranteeing zero open file handle leaks (`EMFILE`).

---

## 7. Post-Grill Architectural Decisions (Authorized)

1. **Course Option Landing Behavior:**
   - **Adopted: Option A (Hybrid).** Inline preview inside the library with a prominent **"Open Course Room"** jump action to `/courses/:courseId?tab=materials`. Preserves search state in URL SearchParams without jarring context shifts.
2. **Catalog Seed:**
   - **Authorized.** Dedicated idempotent migration/script (`ON CONFLICT DO NOTHING`) generating valid multi-page PDF byte structures to test HTTP `206 Partial Content` slicing (`bytes=0-1024`).
3. **Sidebar Route Alignment:**
   - **Authorized.** `/library` is the canonical route for `DigitalLibraryPage`; `/digital-library` acts strictly as `<Navigate replace to="/library" />`.
4. **PostgreSQL 16 B-Tree Null Clustering:**
   - In `idx_library_items_pq_lookup` and `idx_library_items_textbooks`, trailing column is defined as `embargo_until ASC NULLS FIRST` with `WHERE is_published = TRUE`, clustering un-embargoed items at the front of index leaves for instant selectivity.
5. **Dijkstra Resource Ordering on Metrics Flush:**
   - Buffer flush lexicographically sorts `item_id` before constructing `UNNEST` arrays, eliminating `40P01` deadlocks during concurrent multi-worker flushes.

---

## 8. Execution Sequence & Phased Verification Gates

1. **Phase 12A: PostgreSQL Schema Migration & Catalog Seed**
   - Execute `015_digital_library_catalog_and_pqs.sql` creating `library_categories`, `library_items`, and GIN indexes.
   - Seed representative computing textbooks (Computer Networks, Algorithms, Software Engineering), Past Questions (CSC 201, 202, 204 across 2022/2023 & 2023/2024 sessions), and Faculty Resources (Student Handbook, FYP Template).
2. **Phase 12B: Express BFF API & Stream Engine**
   - Implement `packages/bff/src/routes/library.js`.
   - Wire `/api/library/categories`, `/api/library/items`, and `/api/library/items/:id/stream` with HTTP Range `206 Partial Content`.
   - Register the route in `packages/bff/src/index.js`.
3. **Phase 12C: React 19 Digital Library Page & Components**
   - Build `DigitalLibraryPage.jsx` with category navigation tabs, multi-dimensional filter bar, and search debouncing.
   - Build reusable component deck: `LibraryCategoryBar`, `CourseMaterialsView`, `TextbooksView`, `PastQuestionsView`, `FacultyResourcesView`.
   - Update `router.jsx` replacing the redirect with `<DigitalLibraryPage />`.
   - Update `Sidebar.jsx` to route directly to `/library`.
4. **Phase 12D: Production Build & Browser E2E Verification**
   - Run `npm run build` in `packages/frontend` ensuring zero TypeScript/JSX errors.
   - Perform end-to-end browser testing verifying all 4 categories, course filtering, past question filtering, search, and PDF preview/download actions.
