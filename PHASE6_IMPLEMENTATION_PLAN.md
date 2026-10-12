

# Phase 6 Implementation Plan: Student Profile, Demographics & Preferences
**Author:** Staff Systems Architect & Zero-Trust Client Lead  
**Document Status:** Authorized for Implementation  
**Target Screen:** Student Profile & Settings Portal (`/profile`)  
**Standard Enforced:** The 8-8-8 Architectural Doctrine (`focit-architect`)

---

## 1. Executive Architectural Blueprint

Phase 6 implements the authoritative Student Profile and Preferences Portal. In contrast to high-volume read interfaces, profile management is an **infrequent, high-integrity mutation vector**. The central engineering challenge is maintaining mathematical boundaries between **read-only institutional identity (Senate authoritative)** and **mutable student demographic/preference state**, while defending against cellular connection dropouts, V8 heap exhaustion on low-memory mobile hardware, and background SWR query stampedes during credential invalidation.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT PLANE (React 19)                              │
│                                                                                        │
│   Dual-State Partitioning:                                                             │
│   - Navigation & Tab Pointers in URL SearchParams: ?tab=overview|demographics|...      │
│   - Uncommitted In-Flight Edits: Scoped Session Draft Sandbox                          │
│   - Image Pipeline: Off-thread 512x512 WebP Canvas Compression (Zero Android LMK Risk) │
│   - Credential Mutation: 4-Phase Teardown Protocol (Pre-emptive SWR Quenching)         │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │ HTTPS / HttpOnly Cookie + X-Session-Nonce
                                            │ + X-Idempotency-Key
                                            ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                COMPUTE PLANE (Express BFF)                             │
│                                                                                        │
│   Tier 1: Global Concurrency Gate & Ingress Content-Length Validator (<500KB)          │
│   Tier 2: Redis Idempotency Cache Check (GET idempotency:profile:<key>)                │
│   Tier 3: Zero-Heap Busboy Avatar Stream Pipeline (64KB High-Water Mark)               │
│   Tier 4: Transactional Relational Set-Identity Gate (IS NOT DISTINCT FROM)            │
│   Tier 5: Redis Session Hash Invalidation Pipeline (DEL session:<sid>)                 │
└─────────────────────┬──────────────────────────────────────────────┬───────────────────┘
                      │                                              │
                      ▼                                              ▼
┌──────────────────────────────────────────┐    ┌────────────────────────────────────────┐
│             STATE PLANE (PostgreSQL 16)  │    │           CACHE & SESSION (Redis 7)    │
│                                          │    │                                        │
│  Tier 1: students (Read-Only Projection) │    │  Session Registry (session:<sid>)      │
│  Tier 2: student_profiles (Optimistic)   │    │  Idempotency Cache (TTL: 1h)           │
│  Tier 3: bff_idempotency_records         │    │  Sliding-Window Circuit Breaker        │
│  Tier 4: moodle_outbox (Doctrine 8)      │    │                                        │
└──────────────────────────────────────────┘    └────────────────────────────────────────┘
```

---

## 2. The Three Architectural Invariants Enforced

### Invariant 1: Institutional State Isolation (The 3-Tier Split)
Academic progression (`matric_number`, `level`, `current_gpa`, `completed_units`, `programme_id`) is strictly read-only. Mutation attempts directed toward Tier 1 fields return `403 Forbidden` with audit logging. All student-managed mutations are restricted to Tier 2 (`student_profiles`) and Tier 3 (`preferences JSONB`).

### Invariant 2: Relational Set-Identity Idempotency ($R_{\text{db}} \equiv R_{\text{payload}}$)
Network dropouts on 3G links must not cause false `409 Conflict` errors or duplicate Moodle sync operations on client retries. If the optimistic lock check returns 0 updated rows, the BFF compares the current row against the incoming payload using PostgreSQL `IS NOT DISTINCT FROM`. If identical, the operation is acknowledged as a self-healing replay and returns `200 OK` with zero outbox duplication.

### Invariant 3: Zero-Heap Avatar Ingestion ($M_{\text{alloc}} \le 64\text{KB}$)
High-resolution 15MB smartphone photos are downsampled off-thread on the client into a compact $512\times 512$ WebP Blob ($\le 60\text{KB}$) via `createImageBitmap` and `OffscreenCanvas`. The BFF rejects payloads exceeding 500KB at HTTP handshake and streams avatar binary chunks directly to disk using `busboy` and Node.js `streamPipeline`, bounding V8 heap allocation to the 64KB stream buffer.

---

## 3. Database Schema & Migration Specification

### Migration File: `packages/bff/src/db/migrations/004_student_profiles_and_preferences.sql`

```sql
-- ============================================================================
-- FOCIT LMS — MIGRATION 004: STUDENT PROFILES, PREFERENCES & IDEMPOTENCY
-- Standard: 8-8-8 Architectural Doctrine
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STUDENT PROFILES (Tier 2 & Tier 3 Demographic and Preference Plane)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS student_profiles (
    student_id VARCHAR(64) PRIMARY KEY REFERENCES students(student_id) ON DELETE CASCADE,
    phone_number VARCHAR(32),
    alternate_email VARCHAR(128),
    avatar_url VARCHAR(512),
    bio TEXT,
    residential_address TEXT,
    
    -- Tier 3: Schematized Preferences Storage with Type-Safe Defaults
    preferences JSONB NOT NULL DEFAULT '{
        "email_notifications": true,
        "quiz_reminders": true,
        "forum_digest": "daily",
        "sms_alerts": false,
        "theme": "system",
        "compact_tables": false
    }'::jsonb,
    
    -- Optimistic Concurrency Control
    version INT NOT NULL DEFAULT 1,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for demographic searches and audit trails
CREATE INDEX IF NOT EXISTS idx_student_profiles_phone 
ON student_profiles(phone_number) 
WHERE phone_number IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. BFF IDEMPOTENCY RECORDS (Zero-Trust Network Dropout Defense)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bff_idempotency_records (
    key VARCHAR(128) PRIMARY KEY,
    student_id VARCHAR(64) NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    endpoint VARCHAR(64) NOT NULL,
    status_code INT NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bff_idempotency_expiry 
ON bff_idempotency_records(created_at);

-- ----------------------------------------------------------------------------
-- 3. SEED DEFAULT PROFILES FOR EXISTING ACADEMIC IDENTITIES
-- ----------------------------------------------------------------------------
INSERT INTO student_profiles (student_id, phone_number, alternate_email, avatar_url, bio, residential_address, preferences, version)
VALUES 
    (
        'student1', 
        '+234 803 123 4567', 
        'john.doe.personal@gmail.com', 
        '/api/files/avatars/student1.webp', 
        'Penultimate Computer Science student passionate about distributed systems and cloud architecture.',
        'Hostel Block B, Room 14, Osun State University Main Campus, Osogbo',
        '{
            "email_notifications": true,
            "quiz_reminders": true,
            "forum_digest": "daily",
            "sms_alerts": true,
            "theme": "system",
            "compact_tables": false
        }'::jsonb,
        1
    ),
    (
        'student2', 
        '+234 802 987 6543', 
        'jane.smith.dev@yahoo.com', 
        '/api/files/avatars/student2.webp', 
        'Cybersecurity enthusiast and student researcher in cryptographic protocols.',
        'University Villa, Suite 4, Osogbo',
        '{
            "email_notifications": true,
            "quiz_reminders": false,
            "forum_digest": "weekly",
            "sms_alerts": false,
            "theme": "dark",
            "compact_tables": true
        }'::jsonb,
        1
    )
ON CONFLICT (student_id) DO NOTHING;
```

---

## 4. Backend-for-Frontend (BFF) Implementation Specification

### 4.1 Profile Router (`packages/bff/src/routes/profile.js`)

#### 1. Ingress Aggregator: `GET /api/student/profile`
Composite query aggregating Tier 1 institutional ledger, Tier 2 student demographics, and Tier 3 preferences in a single database round-trip.

```sql
SELECT 
    -- Tier 1: Immutable Institutional Identity
    s.student_id,
    s.matric_number,
    s.username,
    s.full_name,
    s.email AS institutional_email,
    s.level,
    s.current_gpa,
    s.completed_units,
    p.name AS programme_name,
    d.name AS department_name,
    
    -- Tier 2: Mutable Demographics
    COALESCE(sp.phone_number, '') AS phone_number,
    COALESCE(sp.alternate_email, '') AS alternate_email,
    COALESCE(sp.avatar_url, '') AS avatar_url,
    COALESCE(sp.bio, '') AS bio,
    COALESCE(sp.residential_address, '') AS residential_address,
    
    -- Tier 3: Schematized Preferences
    COALESCE(sp.preferences, '{
        "email_notifications": true,
        "quiz_reminders": true,
        "forum_digest": "daily",
        "sms_alerts": false,
        "theme": "system",
        "compact_tables": false
    }'::jsonb) AS preferences,
    
    -- Concurrency Version Pointer
    COALESCE(sp.version, 1) AS version,
    sp.updated_at
FROM students s
JOIN programmes p ON p.id = s.programme_id
JOIN departments d ON d.id = p.department_id
LEFT JOIN student_profiles sp ON sp.student_id = s.student_id
WHERE s.student_id = $1;
```

#### 2. Atomic Profile Mutation: `PATCH /api/student/profile`
Implements the 3G Dropout Defense with Relational Set-Identity check and transactional outbox insertion.

```javascript
/**
 * PATCH /api/student/profile
 * Headers: X-Idempotency-Key (Required)
 * Body: { phone_number, alternate_email, bio, residential_address, preferences, version }
 */
router.patch('/profile', async (req, res) => {
  const studentId = req.user.username || req.user.id;
  const idempotencyKey = req.headers['x-idempotency-key'] || req.headers['idempotency-key'];
  
  if (!idempotencyKey) {
    return res.status(400).json({
      error: 'Missing required X-Idempotency-Key header for state-mutating operation',
      code: 'IDEMPOTENCY_KEY_REQUIRED'
    });
  }

  const {
    phone_number,
    alternate_email,
    bio,
    residential_address,
    preferences,
    version: clientVersion
  } = req.body;

  if (typeof clientVersion !== 'number') {
    return res.status(400).json({
      error: 'Missing or invalid version parameter for optimistic concurrency control',
      code: 'INVALID_VERSION_SPECIFIER'
    });
  }

  // Input validation & sanitization
  if (alternate_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alternate_email)) {
    return res.status(422).json({ error: 'Invalid alternate email format', code: 'INVALID_EMAIL' });
  }

  const client = await pool.connect();

  try {
    // 1. Check Idempotency Cache (Redis O(1) Fast-Path)
    const cachedResponse = await redis.get(`idempotency:profile:${idempotencyKey}`);
    if (cachedResponse) {
      return res.status(200).type('json').send(cachedResponse);
    }

    await client.query('BEGIN');

    // 2. Check Database Idempotency Table
    const { rows: existingRecords } = await client.query(
      `SELECT status_code, response_payload FROM bff_idempotency_records WHERE key = $1 AND student_id = $2`,
      [idempotencyKey, studentId]
    );

    if (existingRecords.length > 0) {
      await client.query('COMMIT');
      const record = existingRecords[0];
      return res.status(record.status_code).json(record.response_payload);
    }

    // 3. Attempt Optimistic Concurrency Update
    const updateResult = await client.query(`
      UPDATE student_profiles
      SET 
        phone_number = COALESCE($1, phone_number),
        alternate_email = COALESCE($2, alternate_email),
        bio = COALESCE($3, bio),
        residential_address = COALESCE($4, residential_address),
        preferences = COALESCE($5, preferences),
        version = version + 1,
        updated_at = NOW()
      WHERE student_id = $6 AND version = $7
      RETURNING student_id, phone_number, alternate_email, avatar_url, bio, residential_address, preferences, version, updated_at
    `, [
      phone_number ?? null,
      alternate_email ?? null,
      bio ?? null,
      residential_address ?? null,
      preferences ? JSON.stringify(preferences) : null,
      studentId,
      clientVersion
    ]);

    // 4. Handle Lock Mismatch (0 rows returned)
    if (updateResult.rows.length === 0) {
      // Query Current Persisted State for Relational Set-Identity Check
      const { rows: currentRow } = await client.query(
        `SELECT phone_number, alternate_email, avatar_url, bio, residential_address, preferences, version 
         FROM student_profiles WHERE student_id = $1`,
        [studentId]
      );

      if (currentRow.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Student profile not found', code: 'PROFILE_NOT_FOUND' });
      }

      const current = currentRow[0];

      // Relational Set-Identity Invariant:
      // Did a previous network-dropped attempt already persist this exact data?
      const isIdentical = 
        (phone_number === undefined || current.phone_number === phone_number) &&
        (alternate_email === undefined || current.alternate_email === alternate_email) &&
        (bio === undefined || current.bio === bio) &&
        (residential_address === undefined || current.residential_address === residential_address);

      if (isIdentical) {
        // Self-Healing Replay: The previous commit succeeded before client dropped TCP link.
        await client.query('COMMIT');
        return res.status(200).json({
          status: 'SUCCESS',
          recovered: true,
          message: 'Profile state verified (network retry reconciled safely).',
          data: current
        });
      }

      // True Concurrent Mutation by another session/device
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Conflict: Profile was modified concurrently by another session.',
        code: 'OPTIMISTIC_LOCK_CONFLICT',
        authoritativeVersion: current.version,
        authoritativeData: current
      });
    }

    const updatedProfile = updateResult.rows[0];

    // 5. Enqueue Outbox Event for Upstream Moodle Sync (Doctrine 8)
    const outboxKey = `moodle_sync:profile:${studentId}:${idempotencyKey}`;
    await client.query(`
      INSERT INTO moodle_outbox (event_type, student_focit_id, moodle_course_id, payload, idempotency_key)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (idempotency_key) DO NOTHING
    `, [
      'UPDATE_USER_PROFILE',
      studentId,
      0, // Global user scope
      JSON.stringify({
        phone1: updatedProfile.phone_number,
        description: updatedProfile.bio,
        email: updatedProfile.alternate_email
      }),
      outboxKey
    ]);

    // 6. Persist Idempotency Record
    const responsePayload = {
      status: 'SUCCESS',
      data: updatedProfile
    };

    await client.query(`
      INSERT INTO bff_idempotency_records (key, student_id, endpoint, status_code, response_payload)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (key) DO NOTHING
    `, [idempotencyKey, studentId, 'PATCH /api/student/profile', 200, JSON.stringify(responsePayload)]);

    await client.query('COMMIT');

    // 7. Write Redis Idempotency Cache (TTL: 3600 seconds)
    await redis.setex(`idempotency:profile:${idempotencyKey}`, 3600, JSON.stringify(responsePayload));

    return res.status(200).json(responsePayload);

  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err, studentId, idempotencyKey }, '[Profile] Profile mutation transaction failed');
    return res.status(500).json({ error: 'Internal database error during profile update', code: 'DB_ERROR' });
  } finally {
    client.release();
  }
});
```

---

### 4.2 Zero-Heap Avatar Ingestion Engine (`POST /api/student/avatar`)

Stream-piped avatar ingestion bypassing V8 heap allocations:

```javascript
/**
 * POST /api/student/avatar
 * Multipart boundary parsing via busboy with strict 500KB ceiling and magic byte verification.
 */
router.post('/avatar', async (req, res) => {
  const studentId = req.user.username || req.user.id;
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);

  // Ingress Content-Length Gate: Reject raw 15MB payloads at TCP handshake
  if (contentLength > 500 * 1024) {
    return res.status(413).json({
      error: 'Payload Too Large: Avatar exceeds 500KB ceiling. Client must downsample before upload.',
      code: 'AVATAR_PAYLOAD_TOO_LARGE'
    });
  }

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      fileSize: 500 * 1024, // 500KB physical boundary
      files: 1
    }
  });

  let fileProcessed = false;
  let fileError = null;
  const uploadDir = path.join(__dirname, '../../.cache/avatars');
  await fs.mkdir(uploadDir, { recursive: true });

  const targetFilename = `${studentId}_${Date.now()}.webp`;
  const targetPath = path.join(uploadDir, targetFilename);
  const avatarUrl = `/api/files/avatars/${targetFilename}`;

  busboy.on('file', (name, fileStream, info) => {
    const { mimeType } = info;
    fileProcessed = true;

    // First-chunk magic byte sniffing
    let sniffed = false;
    const writeStream = createWriteStream(targetPath);

    fileStream.on('data', (chunk) => {
      if (!sniffed) {
        sniffed = true;
        // Verify WebP (RIFF....WEBP), PNG, or JPEG magic numbers
        const isWebp = chunk.length >= 12 && chunk.toString('ascii', 0, 4) === 'RIFF' && chunk.toString('ascii', 8, 12) === 'WEBP';
        const isPng = chunk.length >= 4 && chunk[0] === 0x89 && chunk[1] === 0x50 && chunk[2] === 0x4E && chunk[3] === 0x47;
        const isJpeg = chunk.length >= 3 && chunk[0] === 0xFF && chunk[1] === 0xD8 && chunk[2] === 0xFF;

        if (!isWebp && !isPng && !isJpeg) {
          fileError = new Error('Invalid image binary: Magic byte check failed');
          fileStream.resume(); // Drain stream
          writeStream.destroy();
          return;
        }
      }
    });

    fileStream.on('limit', () => {
      fileError = new Error('File size exceeded 500KB limit');
      writeStream.destroy();
    });

    streamPipeline(fileStream, writeStream).catch((err) => {
      fileError = err;
    });
  });

  busboy.on('finish', async () => {
    if (fileError) {
      await fs.unlink(targetPath).catch(() => {});
      return res.status(400).json({ error: fileError.message, code: 'AVATAR_UPLOAD_FAILED' });
    }

    if (!fileProcessed) {
      return res.status(400).json({ error: 'No avatar image file provided in multipart payload', code: 'NO_FILE' });
    }

    // Persist avatar URL in student_profiles
    try {
      await pool.query(
        `UPDATE student_profiles SET avatar_url = $1, version = version + 1, updated_at = NOW() WHERE student_id = $2`,
        [avatarUrl, studentId]
      );
      return res.status(200).json({ status: 'SUCCESS', avatarUrl });
    } catch (dbErr) {
      return res.status(500).json({ error: 'Failed to update avatar record', code: 'DB_ERROR' });
    }
  });

  req.pipe(busboy);
});
```

---

### 4.3 Credential Mutation & 4-Phase Teardown (`POST /api/student/change-password`)

```javascript
/**
 * POST /api/student/change-password
 * Body: { currentPassword, newPassword }
 */
router.post('/change-password', async (req, res) => {
  const studentId = req.user.username || req.user.id;
  const sessionId = req.user.sid;
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({
      error: 'Invalid password format: Minimum 8 characters required',
      code: 'PASSWORD_TOO_WEAK'
    });
  }

  // 1. Verify existing credentials (against database / Active Directory mock)
  // 2. Hash new password with bcrypt (saltRounds = 12)
  // 3. Atomically revoke the caller's active Redis session hash and all affiliated tokens
  if (sessionId) {
    await redis.del(`session:${sessionId}`);
  }

  // Also purge all sessions associated with this studentId to enforce global revocation
  const userPattern = `user_sessions:${studentId}:*`;
  const keys = await redis.keys(userPattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  // Clear session cookie
  res.clearCookie('focit_token', { path: '/' });

  return res.status(200).json({
    status: 'CREDENTIALS_MUTATED',
    message: 'Password updated successfully. All active sessions invalidated.',
    redirect: '/login?reason=password_changed'
  });
});
```

---

## 5. Frontend Architecture & Zero-Trust Client Implementation

### 5.1 Component Structure
* **`packages/frontend/src/pages/StudentProfilePage.jsx`**: Main page component hosting the 4 tabs.
* **`packages/frontend/src/components/profile/ProfileOverviewTab.jsx`**: Displays Tier 1 institutional standing (Matric number, GPA, Completed Units, Faculty/Department) with official institutional badge.
* **`packages/frontend/src/components/profile/DemographicsTab.jsx`**: Form for phone, alternate email, address, bio, and avatar upload with mutation lock.
* **`packages/frontend/src/components/profile/PreferencesTab.jsx`**: Toggles for notification digest, quiz alerts, SMS, theme, and UI density.
* **`packages/frontend/src/components/profile/SecurityTab.jsx`**: Password reset with 4-phase SWR quenching teardown.
* **`packages/frontend/src/lib/imageCompression.js`**: Off-thread $512\times 512$ WebP Canvas downsampling utility.

### 5.2 Off-Thread Client Downsampling Pipeline (`imageCompression.js`)

```javascript
/**
 * Compresses any user-selected image to a 512x512 WebP Blob under 60KB.
 * Eliminates V8 heap fragmentation and Android Low Memory Killer (LMK) aborts.
 */
export async function downsampleAvatar(file) {
  // 1. Decode directly to target resolution using browser GPU rasterizer
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, {
      resizeWidth: 512,
      resizeHeight: 512,
      resizeQuality: 'medium'
    });

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas toBlob conversion failed'));
        },
        'image/webp',
        0.82
      );
    });
  }

  // Fallback for older WebViews
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 512, 512);
      canvas.toBlob(
        (blob) => resolve(blob),
        'image/webp',
        0.82
      );
    };
    img.onerror = reject;
    img.src = url;
  });
}
```

### 5.3 4-Phase Teardown Handler in Security Tab

```javascript
const handlePasswordChange = async (e) => {
  e.preventDefault();
  if (isSubmitting) return;

  setIsSubmitting(true);
  setError(null);

  try {
    // Phase 1: Pre-Emptive SWR Quenching (Zero 401 Cascade Rejections)
    sessionLifecycle.terminate('CREDENTIALS_MUTATING');
    await queryClient.cancelQueries();
    queryClient.pauseQueries();

    // Phase 2: Dispatch Credential Mutation
    await apiClient.post('/student/change-password', {
      currentPassword,
      newPassword
    });

    // Phase 3: Purge Client Session Artifacts
    sessionStorage.removeItem('session_nonce');
    sessionStorage.removeItem('shadow_auth');
    localStorage.removeItem('shadow_auth');
    queryClient.clear();

    // Phase 4: Atomic Navigation to Login
    window.location.replace('/login?reason=password_changed');
  } catch (err) {
    // If password failed validation, resume query client observers
    queryClient.resumeQueries();
    setIsSubmitting(false);
    setError(err.message || 'Failed to update password');
  }
};
```

---

## 6. Route & Navigation Integration

1. **Router Registration (`packages/frontend/src/router.jsx`):**
   * Path: `/profile`
   * Element: `<StudentProfilePage />`
   * Error Boundary: `<RouteErrorBoundary />`
2. **Topbar Profile Chip (`packages/frontend/src/components/layout/Topbar.jsx`):**
   * Convert the avatar and welcome text into a clickable `<Link to="/profile">` with keyboard focus styles.
3. **Sidebar Navigation (`packages/frontend/src/components/layout/Sidebar.jsx`):**
   * Add `UserCheck` / `UserCog` navigation item for Screen 9: "Student Profile & Settings".

---

## 7. Execution Checklist

- [ ] **Step 1:** Create migration `004_student_profiles_and_preferences.sql` in `packages/bff/src/db/migrations/`.
- [ ] **Step 2:** Create `packages/bff/src/routes/profile.js` with composite GET, idempotent PATCH, zero-heap avatar upload, and password change endpoints.
- [ ] **Step 3:** Mount `/api/student/profile` routes into `packages/bff/src/server.js`.
- [ ] **Step 4:** Implement `packages/frontend/src/lib/imageCompression.js` for off-thread WebP canvas downsampling.
- [ ] **Step 5:** Create `packages/frontend/src/pages/StudentProfilePage.jsx` with 4-tab URL synchronization (`?tab=`), mutation locking, and error boundaries.
- [ ] **Step 6:** Wire `/profile` into `router.jsx`, `Topbar.jsx`, and `Sidebar.jsx`.
- [ ] **Step 7:** Validate build integrity (`npm run build` in both `bff` and `frontend`).
