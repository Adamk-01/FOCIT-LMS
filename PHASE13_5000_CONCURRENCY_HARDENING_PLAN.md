# Phase 13 Implementation Plan: 5,000 Concurrent Users Hardening Architecture

**Role:** Staff Systems Architect & Zero-Trust Client Lead  
**Governing Standard:** The 8-8-8 Architectural Doctrine (`focit-architect`)  
**Target Workload:** 5,000 Concurrent Active Users / 3,330 RPS Peak Burst / 1.6 Gbps Peak PDF Egress  
**Subsystems:** `packages/bff` (Web Plane & Worker Plane), `Redis 7`, `PostgreSQL 16` (via PgBouncer), `Cloudflare Edge Workers` (R2 Vault)  

---

## 1. Executive Problem & Failure-Mode Analysis

Auditing the deployment architecture against 5,000 concurrent users exposed three critical distributed systems landmines in naive horizontal scaling:
1. **Redis TCP Socket Exhaustion & Lock Race:** Spawning `redis.duplicate()` per cache-miss waiting request exhausts Redis client connections (`EMFILE`). Unconditional `DEL` risks deleting another worker's lock upon upstream timeouts, while uncoordinated Pub/Sub creates lost-wakeup race conditions.
2. **Telemetry Staging Overwrite Trap:** Naive `RENAME focit:metrics:views focit:metrics:views:flushing` destroys unflushed metrics if a previous worker crashed mid-flush, and throws unhandled exceptions during idle traffic windows.
3. **Multi-Range PDF Streaming Failure:** Labeling edge tickets as "single-use" breaks Mozilla `PDF.js` on chunk #2 (`xref` trailer), preventing linearized PDF navigation and document rendering.

This Phase 13 plan provides the exact, production-grade technical solutions to eliminate these failure modes permanently.

---

## 2. Core Architectural Solutions

### 2.1 Solution 1: Zero-Socket-Leak Two-Layer Coalescer (`DistributedSingleFlight`)

To prevent socket exhaustion and TOCTOU wakeups across 8 clustered workers:
* **Layer 1 (Process-Local Mutex):** A process-local `Map<string, Promise<any>>` deduplicates concurrent requests *within* each Node.js event loop before Redis is touched. If 60 requests hit Worker #1 for the same course, only 1 request reaches Redis.
* **Layer 2 (Worker-Level Singleton Redis Subscriber):** Exactly **one** persistent Redis connection (`redisSub`) is opened per worker process and shared via an in-memory `EventEmitter`. Zero calls to `redis.duplicate()`.
* **Safe Lock Release via Lua Script:** Locks are bound to a cryptographically unique worker token (`token = ${process.pid}:${crypto.randomUUID()}`). The lock is released strictly if the stored token matches the caller:
  ```lua
  if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
  else
      return 0
  end
  ```
* **Double-Checked Locking against Lost Wakeup:** After subscribing to the Redis channel, the worker immediately checks L2 Redis cache. If the leader finished during the subscription network round-trip, the worker resolves immediately from L2 without waiting for the Pub/Sub event.

```
Incoming Requests (e.g. 500 across 8 workers)
      │
      ▼
[ Layer 1: In-Process Map<string, Promise> ] ──In-Flight──► Join Existing Local Promise
      │
   1 per Worker (Max 8 requests)
      ▼
[ Layer 2: Redis SET lockKey token PX 3000 NX ]
      ├─── Winner (1 Worker) ──► Fetch Moodle ──► SET L2 ──► PUBLISH channel ──► Safe Lua DEL
      │
      └─── Contenders (7 Workers)
             │
             ├── Subscribe to channel on SINGLETON redisSub
             ├── Double-check L2 cache (solves lost-wakeup TOCTOU)
             └── Await Pub/Sub message or 2,500ms fallback timeout
```

---

### 2.2 Solution 2: Crash-Safe Redis Flush Recovery Protocol

To guarantee zero data loss and prevent `RENAME` overwrite traps:
1. **Startup & Pre-Flush Orphan Inspection:**
   Before executing a new buffer rotation, the worker verifies if `focit:metrics:views:flushing` exists. If present, it drains the orphaned hash directly into PostgreSQL before rotating new keys.
2. **Atomic Swap Lua Script:**
   The rotation of active metrics to staging is governed by an atomic Lua script that avoids overwriting existing staging keys and handles idle windows gracefully:
   ```lua
   -- KEYS[1]: Active Hash ('focit:metrics:views')
   -- KEYS[2]: Staging Hash ('focit:metrics:views:flushing')
   if redis.call("EXISTS", KEYS[2]) == 1 then
       return -1 -- Staging key already exists from interrupted crash; drain first!
   end
   if redis.call("EXISTS", KEYS[1]) == 0 then
       return 0  -- Idle window: nothing to flush
   end
   redis.call("RENAME", KEYS[1], KEYS[2])
   return 1      -- Successfully rotated
   ```
3. **Dijkstra-Ordered PostgreSQL Commit:**
   The staging keys are fetched via `HGETALL`, sorted lexicographically by `item_id`, and committed via an `UNNEST` query. Upon successful `COMMIT`, the worker issues `DEL focit:metrics:views:flushing`.

---

### 2.3 Solution 3: Multi-Range Edge Capability Token (Scoped Session Lease)

To support Mozilla `PDF.js` linearized multi-range transport without permitting open URL sharing:
1. **Token Semantics:**
   The Edge Ticket is an **ephemeral capability lease** valid for the document reading session (15–30 minutes), NOT a single-use byte token.
2. **Cryptographic Claims:**
   ```json
   {
     "iid": "3b2e1f40-8b1a-4c2d-9e3f-1a2b3c4d5e6f",
     "sub": "student_01",
     "exp": 1772186400,
     "fps": "hmac_sha256(UserAgent + ClientSubnet, SECRET)"
   }
   ```
3. **Cloudflare Edge Worker Execution:**
   - **Verification:** Evaluates `exp > NOW()` and verifies `crypto.subtle.verify(...)` for the HMAC signature and client subnet fingerprint in $<0.5\text{ms}$.
   - **Cache Key Normalization:** Strips `ticket`, `exp`, and `sub` query parameters from the Cloudflare cache key. The cache key is strictly `https://cdn.focit.uniosun.edu.ng/vault/items/:id/stream`.
   - **RFC 9110 Multi-Range Support:** Cloudflare serves cached 64KB byte-slices (`206 Partial Content`) directly from edge SSD/RAM for all 300+ requests generated by `PDF.js` as the student navigates pages.
   - **Renewal:** The React 19 frontend automatically requests a new capability ticket every 10 minutes in the background while the viewer modal remains open.

---

## 3. Implementation Blueprint & Execution Phases

### Phase 13A: 12-Factor Process Topology Decoupling
* **Deliverable:** Split `packages/bff/src/server.js` into stateless HTTP server and create `packages/bff/src/worker.js` for background outbox sweeps and telemetry persistence.
* **Key Tasks:**
  1. Remove `unifiedOutboxWorker.start()` and `setInterval(flushMetricsBuffer)` from `server.js`.
  2. Implement `packages/bff/src/worker.js` as a dedicated entrypoint running the outbox worker and the crash-safe Redis telemetry persister.
  3. Update `docker-compose.yml` and `render.yaml` to run distinct `web` and `worker` services.

### Phase 13B: Two-Layer Distributed Single-Flight & Undici Partitioning
* **Deliverable:** Implement `packages/bff/src/lib/distributedSingleFlight.js`.
* **Key Tasks:**
  1. Construct Layer 1 in-process `Map<string, Promise>`.
  2. Instantiate a shared process-wide `redisSub` singleton with an in-memory subscription dispatcher.
  3. Implement atomic Lua acquisition (`SET ... NX`) and safe token release.
  4. Dynamically partition Undici connection pool per worker in `config.js`.
  5. Refactor `/api/courses` routes to consume `distributedSingleFlight`.

### Phase 13C: Crash-Safe Redis Telemetry Pipeline
* **Deliverable:** Implement `packages/bff/src/services/telemetryBufferService.js`.
* **Key Tasks:**
  1. Refactor `recordTelemetry()` in `packages/bff/src/routes/library.js` to execute Redis `HINCRBY` and `XADD`.
  2. Implement `drainFlushingBuffer()` with crash-recovery inspection.
  3. Implement atomic Lua swap script (`swapActiveToFlushing`).
  4. Implement lexicographical Dijkstra sort before executing PostgreSQL `UNNEST` upserts.

### Phase 13D: Cloudflare Edge Capability Token & Vault Stream
* **Deliverable:** Implement Edge Ticket Issuer in BFF and Cloudflare Worker handler.
* **Key Tasks:**
  1. Add `GET /api/library/items/:id/ticket` in `packages/bff/src/routes/library.js` with student authorization, enrollment, and embargo checks.
  2. Generate HMAC-SHA256 capability ticket with client fingerprinting.
  3. Deploy Cloudflare Edge Worker script validating HMAC and normalizing RFC 9111 cache keys (`public, s-maxage=604800, max-age=0, must-revalidate`).
  4. Update `PDFViewerModal.jsx` and `fileDownload.js` to consume the edge ticket URL and handle sliding-window renewal.

### Phase 13E: Load Verification & Stress Testing
* **Deliverable:** End-to-end multi-worker benchmark script simulating 500 concurrent students hitting cached and uncached course materials, past question downloads, and outbox batch commits.
* **Verification Metrics:**
  - Zero Redis socket exhaustion (`EMFILE`).
  - Zero lost Pub/Sub wakeups.
  - Zero data loss during worker crash/restart simulation.
  - All multi-range requests in `PDF.js` succeed with `206 Partial Content`.
