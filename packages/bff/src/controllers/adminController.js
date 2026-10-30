/**
 * FOCIT LMS - Administrator Controller
 *
 * Implements the administrative control plane:
 * 1. System & infrastructure monitoring (Database, Redis, Moodle)
 * 2. User directory & account provisioning (Students & Staff)
 * 3. Account status lifecycle (Active / Suspended)
 * 4. Moodle synchronization & outbox queue inspection
 * 5. Security & identity audit log inspection
 */

import crypto from 'node:crypto';
import { pool } from '../db/index.js';
import { redis } from '../lib/redis.js';
import { logger } from '../lib/logger.js';
import config from '../config.js';
import { hashPassword } from '../lib/passwords.js';
import { recordIdentityAuditLog } from '../lib/auditLogger.js';

/**
 * Safely and reliably purges all active Redis sessions belonging to a specific user.
 * Combines direct indexed set lookup (user_sessions:<userId>) and cursor-based SCAN fallback.
 *
 * @param {string} userId - Canonical user/student/advisor ID
 * @returns {Promise<{ success: boolean, purgedCount: number, error?: string }>}
 */
async function purgeUserSessions(userId) {
  if (!userId) return { success: true, purgedCount: 0 };
  const targetId = String(userId);
  const keysToDelete = new Set();

  try {
    // 1. Direct indexed set lookup
    const indexedSessionIds = await redis.smembers(`user_sessions:${targetId}`).catch(() => []);
    if (Array.isArray(indexedSessionIds)) {
      for (const sid of indexedSessionIds) {
        keysToDelete.add(`session:${sid}`);
      }
      keysToDelete.add(`user_sessions:${targetId}`);
    }

    // 2. Cursor-based SCAN fallback for existing or unindexed sessions
    let cursor = '0';
    do {
      const [nextCursor, matchedKeys] = await redis.scan(cursor, 'MATCH', 'session:*', 'COUNT', 100);
      cursor = nextCursor;

      if (matchedKeys && matchedKeys.length > 0) {
        const sessionKeys = matchedKeys.filter((k) => !k.startsWith('user_sessions:'));
        if (sessionKeys.length > 0) {
          const pipeline = redis.pipeline();
          for (const key of sessionKeys) {
            pipeline.hget(key, 'userId');
          }
          const batchResults = await pipeline.exec();
          if (batchResults) {
            batchResults.forEach(([cmdErr, storedUserId], idx) => {
              if (!cmdErr && storedUserId === targetId) {
                keysToDelete.add(sessionKeys[idx]);
              }
            });
          }
        }
      }
    } while (cursor !== '0');

    let deletedCount = 0;
    if (keysToDelete.size > 0) {
      deletedCount = await redis.del(...Array.from(keysToDelete));
    }
    return { success: true, purgedCount: deletedCount };
  } catch (err) {
    logger.error({ err: err?.message || err, userId: targetId }, '[AdminController] Error purging user sessions from Redis');
    return { success: false, purgedCount: 0, error: err?.message || 'Redis session deletion failed' };
  }
}

/**
 * 1. GET /api/admin/dashboard
 * Aggregated platform metrics, role distribution, and live infrastructure health.
 */
export async function getDashboardOverview(req, res, next) {
  try {
    // 1. Database Health & Latency
    const dbStart = Date.now();
    await pool.query('SELECT 1');
    const dbLatencyMs = Date.now() - dbStart;

    // 2. Aggregate Entity Counts
    const [
      studentsCountRes,
      staffCountRes,
      coursesCountRes,
      pendingBatchesRes,
      roleDistributionRes,
      departmentsRes,
      semesterRes,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM students'),
      pool.query('SELECT COUNT(*)::int AS count FROM staff_advisors'),
      pool.query('SELECT COUNT(*)::int AS count FROM courses'),
      pool.query("SELECT COUNT(*)::int AS count FROM course_registration_batches WHERE status = 'SUBMITTED'"),
      pool.query(`
        SELECT role, COUNT(*)::int AS count 
        FROM staff_advisors 
        GROUP BY role
      `),
      pool.query('SELECT COUNT(*)::int AS count FROM departments'),
      pool.query(`
        SELECT id, name, is_registration_open
        FROM academic_semesters
        ORDER BY id DESC LIMIT 1
      `),
    ]);

    const semesterRow = semesterRes.rows[0];
    const activeSemester = semesterRow
      ? {
          id: semesterRow.id,
          name: semesterRow.name,
          isRegistrationOpen: Boolean(semesterRow.is_registration_open),
        }
      : null;

    // 3. Redis Health
    const redisStatus = redis.status === 'ready' || redis.status === 'connect' ? 'UP' : 'DEGRADED';

    // 4. Moodle Health Ping
    let moodleHealth = {
      status: 'UNKNOWN',
      baseUrl: config.moodle.baseUrl,
      latencyMs: null,
    };
    try {
      const moodleStart = Date.now();
      const response = await fetch(`${config.moodle.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);

      moodleHealth.latencyMs = Date.now() - moodleStart;
      if (!response) {
        moodleHealth.status = 'DOWN';
      } else if (response.ok) {
        moodleHealth.status = 'UP';
      } else {
        moodleHealth.status = 'DEGRADED';
      }
    } catch {
      moodleHealth.status = 'DOWN';
    }

    // 5. Outbox & Batch Metrics (Registration Batches & Moodle Integration Queue)
    const [outboxStatsRes, moodleOutboxStatsRes] = await Promise.all([
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft,
          COUNT(*) FILTER (WHERE status = 'SUBMITTED')::int AS pending,
          COUNT(*) FILTER (WHERE status IN ('ADVISOR_APPROVED', 'HOD_CLEARED', 'SENATE_CONFIRMED'))::int AS approved,
          COUNT(*) FILTER (WHERE status = 'REJECTED')::int AS rejected
        FROM course_registration_batches
      `),
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'PENDING')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'PROCESSING')::int AS processing,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
          COUNT(*) FILTER (WHERE status = 'FAILED')::int AS failed
        FROM moodle_outbox
      `),
    ]);

    // Format role distribution
    const roles = {
      STUDENT: studentsCountRes.rows[0]?.count || 0,
      LEVEL_ADVISOR: 0,
      HOD: 0,
      DEAN: 0,
      SENATE_OFFICER: 0,
      ADMIN: 0,
      SYSTEM_ADMIN: 0,
    };
    for (const row of roleDistributionRes.rows) {
      roles[row.role] = row.count;
    }

    return res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalStudents: studentsCountRes.rows[0]?.count || 0,
          totalStaff: staffCountRes.rows[0]?.count || 0,
          totalCourses: coursesCountRes.rows[0]?.count || 0,
          totalDepartments: departmentsRes.rows[0]?.count || 0,
          pendingRegistrationBatches: pendingBatchesRes.rows[0]?.count || 0,
        },
        activeSemester,
        roleDistribution: roles,
        systemHealth: {
          database: { status: 'UP', latencyMs: dbLatencyMs },
          redis: { status: redisStatus },
          moodle: moodleHealth,
        },
        registrationQueue: outboxStatsRes.rows[0] || {
          draft: 0,
          pending: 0,
          approved: 0,
          rejected: 0,
        },
        moodleOutbox: moodleOutboxStatsRes.rows[0] || {
          pending: 0,
          processing: 0,
          completed: 0,
          failed: 0,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, '[AdminController] Error loading dashboard overview');
    return next(err);
  }
}

/**
 * 2. GET /api/admin/users
 * Search and paginated listing across students and staff members.
 */
export async function listUsers(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${String(req.query.search).trim()}%` : null;
    const roleFilter = req.query.role ? String(req.query.role).toUpperCase() : null;
    const deptFilter = req.query.department ? String(req.query.department).toUpperCase() : null;

    let queryText = '';
    const queryParams = [];

    // Unified Union Query across students and staff_advisors
    queryText = `
      WITH unified_users AS (
        SELECT 
          s.student_id AS id,
          s.matric_number AS identifier,
          s.full_name AS full_name,
          s.email AS email,
          'STUDENT' AS role,
          p.department_id AS department_id,
          s.level AS level,
          COALESCE(s.account_status, 'ACTIVE') AS status,
          s.created_at AS created_at
        FROM students s
        LEFT JOIN programmes p ON p.id = s.programme_id
        UNION ALL
        SELECT 
          sa.advisor_id AS id,
          sa.staff_number AS identifier,
          sa.full_name AS full_name,
          sa.email AS email,
          sa.role AS role,
          sa.department_id AS department_id,
          sa.assigned_level AS level,
          COALESCE(sa.account_status, 'ACTIVE') AS status,
          sa.created_at AS created_at
        FROM staff_advisors sa
      )
      SELECT * FROM unified_users
      WHERE 1=1
    `;

    if (search) {
      queryParams.push(search);
      queryText += ` AND (identifier ILIKE $${queryParams.length} OR full_name ILIKE $${queryParams.length} OR email ILIKE $${queryParams.length})`;
    }

    if (roleFilter && roleFilter !== 'ALL') {
      queryParams.push(roleFilter);
      queryText += ` AND role = $${queryParams.length}`;
    }

    if (deptFilter && deptFilter !== 'ALL') {
      queryParams.push(deptFilter);
      queryText += ` AND department_id = $${queryParams.length}`;
    }

    // Count Total
    const countSql = `SELECT COUNT(*)::int AS total FROM (${queryText}) AS filtered`;
    const countRes = await pool.query(countSql, queryParams);
    const total = countRes.rows[0]?.total || 0;

    // Apply Sorting and Pagination
    queryParams.push(limit, offset);
    queryText += ` ORDER BY created_at DESC LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;

    const usersRes = await pool.query(queryText, queryParams);

    return res.status(200).json({
      success: true,
      data: {
        users: usersRes.rows.map((u) => ({
          id: u.id,
          identifier: u.identifier,
          fullName: u.full_name,
          email: u.email,
          role: u.role,
          departmentId: u.department_id,
          level: u.level,
          status: u.status,
          createdAt: u.created_at,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    logger.error({ err }, '[AdminController] Error listing users');
    return next(err);
  }
}

function resolveDepartmentId(dept) {
  if (!dept) return 'CSC';
  const clean = String(dept).toUpperCase().replace(/^D-/, '');
  const map = {
    'CS': 'CSC',
    'CSC': 'CSC',
    'CY': 'CYS',
    'CYS': 'CYS',
    'SE': 'SEN',
    'SEN': 'SEN',
    'DS': 'DSC',
    'DSC': 'DSC',
    'IS': 'IFS',
    'IFS': 'IFS',
    'IT': 'IFT',
    'IFT': 'IFT',
    'LIS': 'LIS',
  };
  return map[clean] || clean;
}

/**
 * 3. POST /api/admin/users
 * Provision a new Student or Staff user with an initial password and audit trail.
 */
export async function createUser(req, res, next) {
  let client;
  let inTransaction = false;

  try {
    const {
      role = 'STUDENT',
      identifier,
      fullName,
      email,
      departmentId,
      level,
      assignedLevel,
      password,
    } = req.body || {};

    if (!identifier || !fullName || !email || !departmentId) {
      return res.status(400).json({
        error: 'Missing required fields: identifier, fullName, email, departmentId required',
        code: 'VALIDATION_FAILED',
      });
    }

    const normalizedRole = String(role).toUpperCase();
    const candidateLevel = parseInt(level || assignedLevel, 10) || 100;
    const resolvedDeptId = resolveDepartmentId(departmentId);
    const resolvedProgId = `BSC_${resolvedDeptId}`;

    // Strict Role Allowlist Validation
    const ALLOWED_ROLES = ['STUDENT', 'LEVEL_ADVISOR', 'HOD', 'DEAN', 'ADMIN', 'SYSTEM_ADMIN'];
    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        error: `Invalid role: ${role}. Permitted roles: ${ALLOWED_ROLES.join(', ')}`,
        code: 'INVALID_ROLE',
      });
    }

    // Restrict provisioning SYSTEM_ADMIN accounts strictly to existing SYSTEM_ADMIN callers
    if (normalizedRole === 'SYSTEM_ADMIN' && req.user?.role !== 'SYSTEM_ADMIN') {
      return res.status(403).json({
        error: 'Only a System Administrator can provision another SYSTEM_ADMIN account',
        code: 'FORBIDDEN_PROVISION_SYSTEM_ADMIN',
      });
    }

    // Restrict provisioning ADMIN accounts to administrators (ADMIN or SYSTEM_ADMIN)
    if (normalizedRole === 'ADMIN' && !['ADMIN', 'SYSTEM_ADMIN'].includes(req.user?.role)) {
      return res.status(403).json({
        error: 'Only administrators can provision an administrator account',
        code: 'FORBIDDEN_PROVISION_ADMIN',
      });
    }

    // Cryptographically secure temporary password generation:
    // When no password is provided by the administrator, generate a high-entropy 12-char random string.
    // Static and predictable fallbacks like 'ChangeMe123!' are strictly eliminated across all environments.
    const initialPassword = password && String(password).trim().length >= 8 
      ? String(password).trim() 
      : crypto.randomBytes(9).toString('base64url') + '!A1';

    // Hash initial password using OWASP scrypt
    const passwordHash = await hashPassword(initialPassword);

    client = await pool.connect();
    await client.query('BEGIN');
    inTransaction = true;

    let createdId;
    if (normalizedRole === 'STUDENT') {
      const studentId = `student_${identifier.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
      createdId = studentId;

      await client.query(
        `
        INSERT INTO students (student_id, matric_number, username, full_name, email, programme_id, level, account_status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
        `,
        [studentId, identifier, identifier, fullName, email, resolvedProgId, candidateLevel]
      );

      await client.query(
        `
        INSERT INTO student_profiles (student_id, password_hash, must_change_password)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (student_id) DO UPDATE SET password_hash = EXCLUDED.password_hash
        `,
        [studentId, passwordHash]
      );

      // Enqueue Outbox Event for Upstream Moodle User Provisioning (Doctrine 8)
      await client.query(
        `
        INSERT INTO integration_outbox_events (
          aggregate_type, aggregate_id, event_type, payload, idempotency_key
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (idempotency_key) DO NOTHING
        `,
        [
          'STUDENT',
          studentId,
          'USER_PROVISION_REQUESTED',
          JSON.stringify({
            student_id: studentId,
            matric_number: identifier,
            full_name: fullName,
            email,
          }),
          `moodle_provision:${studentId}`,
        ]
      );
    } else {
      const advisorId = `staff_${identifier.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}`;
      createdId = advisorId;

      await client.query(
        `
        INSERT INTO staff_advisors (
          advisor_id, staff_number, full_name, email, department_id, assigned_level, role, password_hash, must_change_password, account_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, 'ACTIVE')
        `,
        [advisorId, identifier, fullName, email, resolvedDeptId, candidateLevel, normalizedRole, passwordHash]
      );
    }

    // Append to immutable security audit ledger
    await recordIdentityAuditLog(client, {
      eventType: 'ADMIN_USER_PROVISIONED',
      actorId: req.user?.id || 'admin1',
      actorRole: req.user?.role || 'ADMIN',
      targetId: createdId,
      targetType: 'USER_ACCOUNT',
      ipAddress: req.ip,
      metadata: { role: normalizedRole, identifier, email, departmentId },
    });

    await client.query('COMMIT');
    inTransaction = false;

    logger.info({ createdId, role: normalizedRole }, '[AdminController] User account provisioned');

    return res.status(201).json({
      success: true,
      data: {
        message: 'User created successfully',
        // Intentional One-Time Credential Provisioning:
        // Returns the temporary password strictly once to the administrator so it can be securely
        // communicated to the user (FOCIT LMS has no integration with the central school portal).
        // The account is locked in must_change_password = TRUE state until the user resets it.
        temporaryPassword: initialPassword,
        mustChangePassword: true,
        user: {
          id: createdId,
          identifier,
          fullName,
          email,
          role: normalizedRole,
          departmentId,
          level: candidateLevel,
          status: 'ACTIVE',
        },
      },
    });
  } catch (err) {
    if (client && inTransaction) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        logger.error({ rollbackErr }, '[AdminController] Rollback failed');
      }
    }
    logger.error({ err }, '[AdminController] Error creating user');
    if (err.code === '23505') {
      const isEmail = String(err.constraint || err.detail || '').toLowerCase().includes('email');
      const isMatric = String(err.constraint || err.detail || '').toLowerCase().includes('matric');
      let msg = 'A user with this matric/staff number or email already exists';
      if (isEmail) {
        msg = `The email address '${email}' is already registered to another user.`;
      } else if (isMatric) {
        msg = `The matric/staff number '${identifier}' is already registered.`;
      }
      return res.status(409).json({
        error: msg,
        code: 'USER_ALREADY_EXISTS',
      });
    }
    return next(err);
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * 4. PATCH /api/admin/users/:id/status
 * Toggle account status between ACTIVE and SUSPENDED.
 */
export async function updateUserStatus(req, res, next) {
  const { id } = req.params;
  const { status } = req.body || {};

  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return res.status(400).json({
      error: 'Missing or invalid user identifier',
      code: 'INVALID_USER_ID',
    });
  }

  // Strict String Type and Enum Validation
  if (!status || typeof status !== 'string' || !['ACTIVE', 'SUSPENDED', 'LOCKED'].includes(status.trim().toUpperCase())) {
    return res.status(400).json({
      error: 'Invalid status. Must be a string with value ACTIVE, SUSPENDED, or LOCKED',
      code: 'INVALID_STATUS',
    });
  }

  const normalizedStatus = status.trim().toUpperCase();
  const searchId = id.trim();

  try {
    // 1. Resolve target user from staff_advisors or students to obtain canonical identifiers
    let userType = null;
    let resolvedUser = null;

    const staffRes = await pool.query(
      `SELECT advisor_id, staff_number, email, role, account_status FROM staff_advisors 
       WHERE advisor_id = $1 OR staff_number = $1 OR email = $1`,
      [searchId]
    );

    if (staffRes.rows.length > 0) {
      userType = 'STAFF';
      resolvedUser = staffRes.rows[0];
    } else {
      const studentRes = await pool.query(
        `SELECT student_id, matric_number, username, email, account_status FROM students 
         WHERE student_id = $1 OR matric_number = $1 OR username = $1 OR email = $1`,
        [searchId]
      );
      if (studentRes.rows.length > 0) {
        userType = 'STUDENT';
        resolvedUser = studentRes.rows[0];
      }
    }

    if (!resolvedUser) {
      return res.status(404).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    // 2. Reliable Self-Status Guard:
    // Block an admin from suspending or locking their own active account,
    // regardless of whether they passed advisor_id, staff_number, username, or email.
    if (normalizedStatus === 'SUSPENDED' || normalizedStatus === 'LOCKED') {
      const isSelf = req.user && (
        (userType === 'STAFF' && (
          req.user.id === resolvedUser.advisor_id ||
          req.user.username === resolvedUser.advisor_id ||
          req.user.username === resolvedUser.staff_number ||
          req.user.email === resolvedUser.email
        )) ||
        (userType === 'STUDENT' && (
          req.user.id === resolvedUser.student_id ||
          req.user.username === resolvedUser.username ||
          req.user.username === resolvedUser.matric_number ||
          req.user.email === resolvedUser.email
        ))
      );

      if (isSelf) {
        return res.status(400).json({
          error: 'Administrators cannot suspend or lock their own active account',
          code: 'CANNOT_SUSPEND_SELF',
        });
      }

      // Prevent suspending or locking the last active SYSTEM_ADMIN
      if (userType === 'STAFF' && resolvedUser.role === 'SYSTEM_ADMIN') {
        const countRes = await pool.query(
          "SELECT COUNT(*)::int AS count FROM staff_advisors WHERE role = 'SYSTEM_ADMIN' AND account_status = 'ACTIVE'"
        );
        const activeSysadminCount = countRes.rows[0]?.count || 0;
        if (activeSysadminCount <= 1) {
          return res.status(400).json({
            error: 'Cannot suspend or lock the last active System Administrator.',
            code: 'CANNOT_SUSPEND_LAST_SYSTEM_ADMIN',
          });
        }
      }
    }

    // 3. Mutate record using canonical primary key
    const canonicalId = userType === 'STAFF' ? resolvedUser.advisor_id : resolvedUser.student_id;
    if (userType === 'STAFF') {
      await pool.query(
        `UPDATE staff_advisors SET account_status = $1 WHERE advisor_id = $2`,
        [normalizedStatus, canonicalId]
      );
    } else {
      await pool.query(
        `UPDATE students SET account_status = $1 WHERE student_id = $2`,
        [normalizedStatus, canonicalId]
      );
    }

    // 4. Invalidate active sessions in Redis if account is suspended or locked
    let sessionPurgeResult = null;
    if (normalizedStatus === 'SUSPENDED' || normalizedStatus === 'LOCKED') {
      sessionPurgeResult = await purgeUserSessions(canonicalId);
      if (sessionPurgeResult.success) {
        logger.info({ canonicalId, userType, purgedCount: sessionPurgeResult.purgedCount }, '[AdminController] Purged active sessions for suspended user');
      } else {
        logger.warn({ canonicalId, userType, error: sessionPurgeResult.error }, '[AdminController] Session revocation failed due to Redis error');
      }
    }

    // 5. Record audit event
    await recordIdentityAuditLog(pool, {
      eventType: 'ADMIN_USER_STATUS_CHANGED',
      actorId: req.user?.id || 'admin1',
      actorRole: req.user?.role || 'ADMIN',
      targetId: canonicalId,
      targetType: userType === 'STAFF' ? 'STAFF_ADVISOR' : 'STUDENT',
      ipAddress: req.ip,
      metadata: { 
        previousStatus: resolvedUser.account_status,
        newStatus: normalizedStatus, 
        providedIdentifier: searchId,
        sessionsRevoked: sessionPurgeResult ? sessionPurgeResult.success : undefined,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        id: canonicalId,
        status: normalizedStatus,
        sessionsRevoked: sessionPurgeResult ? sessionPurgeResult.success : undefined,
        message: sessionPurgeResult && !sessionPurgeResult.success
          ? `User status updated to ${normalizedStatus}, but active sessions could not be revoked from session store.`
          : `User status successfully updated to ${normalizedStatus}`,
      },
    });
  } catch (err) {
    logger.error({ err, id }, '[AdminController] Error updating user status');
    return next(err);
  }
}

/**
 * 4.1 PATCH /api/admin/users/:id/role
 * Update role or governance scope for an academic officer or administrator.
 */
export async function updateUserRole(req, res, next) {
  const { id } = req.params;
  const { role } = req.body || {};

  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return res.status(400).json({
      error: 'Missing or invalid staff identifier',
      code: 'INVALID_USER_ID',
    });
  }

  if (!role) {
    return res.status(400).json({
      error: 'Missing required field: role',
      code: 'ROLE_REQUIRED',
    });
  }

  const normalizedRole = String(role).toUpperCase();
  const VALID_STAFF_ROLES = ['LEVEL_ADVISOR', 'HOD', 'DEAN', 'SENATE_OFFICER', 'ADMIN', 'SYSTEM_ADMIN'];

  if (!VALID_STAFF_ROLES.includes(normalizedRole)) {
    return res.status(400).json({
      error: `Invalid role: ${role}. Permitted staff roles: ${VALID_STAFF_ROLES.join(', ')}`,
      code: 'INVALID_ROLE',
    });
  }

  const searchId = id.trim();

  try {
    // 1. Fetch staff advisor record first to resolve canonical IDs and current role
    const staffRes = await pool.query(
      `SELECT advisor_id, staff_number, email, role FROM staff_advisors 
       WHERE advisor_id = $1 OR staff_number = $1 OR email = $1`,
      [searchId]
    );

    if (staffRes.rowCount === 0) {
      return res.status(404).json({
        error: 'Staff advisor or administrator not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const targetStaff = staffRes.rows[0];

    // 2. Reliable Self-Demotion Guard:
    // Prevent an admin from demoting themselves and losing administrative access,
    // matching against canonical advisor_id, staff_number, and email.
    const isSelf = req.user && (
      req.user.id === targetStaff.advisor_id ||
      req.user.username === targetStaff.advisor_id ||
      req.user.username === targetStaff.staff_number ||
      req.user.email === targetStaff.email
    );

    if (isSelf && normalizedRole !== 'ADMIN' && normalizedRole !== 'SYSTEM_ADMIN') {
      return res.status(400).json({
        error: 'Administrators cannot remove their own administrative privileges',
        code: 'CANNOT_DEMOTE_SELF',
      });
    }

    // Prevent demoting the last active SYSTEM_ADMIN to a lower tier (by self or any administrator)
    if (targetStaff.role === 'SYSTEM_ADMIN' && normalizedRole !== 'SYSTEM_ADMIN') {
      const countRes = await pool.query(
        "SELECT COUNT(*)::int AS count FROM staff_advisors WHERE role = 'SYSTEM_ADMIN' AND account_status = 'ACTIVE'"
      );
      const activeSysadminCount = countRes.rows[0]?.count || 0;
      if (activeSysadminCount <= 1) {
        return res.status(400).json({
          error: 'Cannot demote the last active System Administrator. At least one active SYSTEM_ADMIN must exist.',
          code: 'CANNOT_DEMOTE_LAST_SYSTEM_ADMIN',
        });
      }
    }

    // 3. Privilege Escalation Barrier: Only a SYSTEM_ADMIN can grant or modify SYSTEM_ADMIN
    if (normalizedRole === 'SYSTEM_ADMIN' && req.user?.role !== 'SYSTEM_ADMIN') {
      return res.status(403).json({
        error: 'Only a System Administrator can grant SYSTEM_ADMIN privileges',
        code: 'FORBIDDEN_ELEVATE_SYSTEM_ADMIN',
      });
    }

    if (targetStaff.role === 'SYSTEM_ADMIN' && req.user?.role !== 'SYSTEM_ADMIN') {
      return res.status(403).json({
        error: 'Only a System Administrator can alter an existing SYSTEM_ADMIN role',
        code: 'FORBIDDEN_MODIFY_SYSTEM_ADMIN',
      });
    }

    // 4. Update role using canonical advisor_id
    await pool.query(
      `UPDATE staff_advisors SET role = $1 WHERE advisor_id = $2`,
      [normalizedRole, targetStaff.advisor_id]
    );

    // Invalidate active sessions in Redis to immediately revoke stale permissions and force re-login
    const sessionPurgeResult = await purgeUserSessions(targetStaff.advisor_id);
    if (sessionPurgeResult.success) {
      logger.info({ advisorId: targetStaff.advisor_id, newRole: normalizedRole, purgedCount: sessionPurgeResult.purgedCount }, '[AdminController] Purged active sessions following role change');
    } else {
      logger.warn({ advisorId: targetStaff.advisor_id, error: sessionPurgeResult.error }, '[AdminController] Failed to purge active sessions following role change');
    }

    // 5. Record audit event
    await recordIdentityAuditLog(pool, {
      eventType: 'ADMIN_USER_ROLE_CHANGED',
      actorId: req.user?.id || 'admin1',
      actorRole: req.user?.role || 'ADMIN',
      targetId: targetStaff.advisor_id,
      targetType: 'STAFF_ADVISOR',
      ipAddress: req.ip,
      metadata: { 
        previousRole: targetStaff.role,
        newRole: normalizedRole, 
        providedIdentifier: searchId,
        sessionsRevoked: sessionPurgeResult.success,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        id: targetStaff.advisor_id,
        role: normalizedRole,
        sessionsRevoked: sessionPurgeResult.success,
        message: sessionPurgeResult.success
          ? `User role successfully updated to ${normalizedRole}. Active sessions revoked.`
          : `User role updated to ${normalizedRole}, but active sessions could not be revoked from session store.`,
      },
    });
  } catch (err) {
    logger.error({ err, id }, '[AdminController] Error updating user role');
    return next(err);
  }
}

/**
 * 4c. POST /api/admin/users/:id/reset-password
 * Administrative password reset for students and staff.
 * Issues a cryptographically secure temporary password, marks must_change_password=TRUE,
 * purges active sessions, and appends an immutable audit log entry.
 */
export async function resetUserPassword(req, res, next) {
  const { id } = req.params;
  const { password } = req.body || {};
  let client;

  try {
    if (!id) {
      return res.status(400).json({ error: 'User identifier required', code: 'VALIDATION_FAILED' });
    }

    const cleanId = String(id).trim();

    // 1. Resolve user in students or staff_advisors
    let isStudent = true;
    const studentRes = await pool.query(
      `SELECT student_id, matric_number, username, full_name, email FROM students WHERE student_id = $1 OR matric_number = $1 OR username = $1`,
      [cleanId]
    );

    let target = studentRes.rows[0];
    if (!target) {
      const staffRes = await pool.query(
        `SELECT advisor_id AS student_id, staff_number AS matric_number, advisor_id AS username, full_name, email, role FROM staff_advisors WHERE advisor_id = $1 OR staff_number = $1 OR email = $1`,
        [cleanId]
      );
      if (staffRes.rows[0]) {
        isStudent = false;
        target = staffRes.rows[0];
      }
    }

    if (!target) {
      return res.status(404).json({ error: 'User not found in academic registry', code: 'USER_NOT_FOUND' });
    }

    // Role-Based Privilege Escalation Guard:
    // Only SYSTEM_ADMIN can reset passwords for administrator accounts (ADMIN or SYSTEM_ADMIN)
    if (!isStudent && ['ADMIN', 'SYSTEM_ADMIN'].includes(target.role) && req.user?.role !== 'SYSTEM_ADMIN') {
      return res.status(403).json({
        error: 'Only a System Administrator can reset passwords for administrator accounts',
        code: 'FORBIDDEN_RESET_PRIVILEGED_PASSWORD',
      });
    }

    const newPassword = password && String(password).trim().length >= 8
      ? String(password).trim()
      : crypto.randomBytes(9).toString('base64url') + '!A1';

    const passwordHash = await hashPassword(newPassword);

    client = await pool.connect();
    await client.query('BEGIN');

    if (isStudent) {
      await client.query(
        `INSERT INTO student_profiles (student_id, password_hash, must_change_password, updated_at)
         VALUES ($1, $2, TRUE, NOW())
         ON CONFLICT (student_id) DO UPDATE 
         SET password_hash = EXCLUDED.password_hash, must_change_password = TRUE, updated_at = NOW()`,
        [target.student_id, passwordHash]
      );
    } else {
      await client.query(
        `UPDATE staff_advisors SET password_hash = $1, must_change_password = TRUE, updated_at = NOW() WHERE advisor_id = $2`,
        [passwordHash, target.student_id]
      );
    }

    await client.query('COMMIT');

    // Purge active sessions in Redis
    await purgeUserSessions(target.student_id);

    // Audit log
    await recordIdentityAuditLog(pool, {
      eventType: 'ADMIN_PASSWORD_RESET',
      actorId: req.user?.username || req.user?.id || 'admin1',
      actorRole: req.user?.role || 'ADMIN',
      targetId: target.student_id,
      targetType: 'CREDENTIALS',
      ipAddress: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
      userAgent: req.headers['user-agent'] || 'admin-portal',
      metadata: { identifier: target.matric_number, isStudent },
    }).catch((e) => logger.warn({ e }, '[AdminController] Failed to record password reset audit log'));

    return res.json({
      success: true,
      message: `Temporary password reset successfully for ${target.full_name}`,
      temporaryPassword: newPassword,
      user: {
        id: target.student_id,
        identifier: target.matric_number,
        fullName: target.full_name,
      },
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    logger.error({ err, id }, '[AdminController] Failed to reset user password');
    return next(err);
  } finally {
    if (client) client.release();
  }
}

/**
 * 5. GET /api/admin/integrations/moodle
 * Real-time Moodle connectivity inspection and pool diagnostics.
 */
export async function getMoodleHealth(req, res, next) {
  try {
    const start = Date.now();
    let status = 'UNKNOWN';
    let latencyMs = null;
    let statusCode = null;

    try {
      const response = await fetch(`${config.moodle.baseUrl}/health`, {
        signal: AbortSignal.timeout(4000),
      });
      latencyMs = Date.now() - start;
      statusCode = response.status;
      status = response.ok ? 'HEALTHY' : 'UNHEALTHY';
    } catch (fetchErr) {
      status = 'UNREACHABLE';
      latencyMs = Date.now() - start;
    }

    return res.status(200).json({
      success: true,
      data: {
        service: 'Moodle Learning Engine',
        status,
        baseUrl: config.moodle.baseUrl,
        statusCode,
        latencyMs,
        tokenConfigured: Boolean(config.moodle.wsToken),
        connectionPool: {
          maxConnections: config.pool.maxConnections,
          connectTimeoutMs: config.pool.connectTimeoutMs,
        },
      },
    });
  } catch (err) {
    logger.error({ err }, '[AdminController] Error inspecting Moodle health');
    return next(err);
  }
}

/**
 * 6. GET /api/admin/integrations/outbox
 * Query the course registration synchronization outbox queue.
 */
export async function getOutboxEvents(req, res, next) {
  try {
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;

    let query = `
      SELECT 
        b.id AS batch_id,
        b.student_id,
        s.matric_number,
        s.full_name AS student_name,
        b.semester_id,
        b.status,
        b.total_units,
        b.created_at,
        b.updated_at
      FROM course_registration_batches b
      JOIN students s ON s.student_id = b.student_id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'ALL') {
      if (status === 'APPROVED') {
        query += ` AND b.status::text IN ('ADVISOR_APPROVED', 'HOD_CLEARED', 'SENATE_CONFIRMED')`;
      } else {
        params.push(status);
        query += ` AND b.status::text = $${params.length}`;
      }
    }

    query += ` ORDER BY b.updated_at DESC LIMIT 50`;

    const [batchResult, moodleResult, integrationResult] = await Promise.all([
      pool.query(query, params),
      pool.query(`
        SELECT 
          o.id,
          o.event_type,
          o.student_focit_id,
          s.matric_number,
          s.full_name AS student_name,
          o.moodle_course_id,
          c.code AS course_code,
          o.status,
          o.payload,
          o.retry_count,
          o.created_at,
          o.updated_at
        FROM moodle_outbox o
        LEFT JOIN students s ON s.student_id = o.student_focit_id
        LEFT JOIN courses c ON c.moodle_course_id = o.moodle_course_id
        ORDER BY o.updated_at DESC LIMIT 50
      `),
      pool.query(`
        SELECT 
          event_id,
          aggregate_type,
          aggregate_id,
          event_type,
          payload,
          status,
          delivery_attempts,
          last_error,
          created_at,
          updated_at
        FROM integration_outbox_events
        ORDER BY updated_at DESC LIMIT 50
      `).catch(() => ({ rows: [], rowCount: 0 })),
    ]);

    const formatOutboxEventType = (type) => {
      if (!type) return 'Course Enrollment Sync';
      switch (type) {
        case 'USER_PROVISION_REQUESTED':
          return 'User Provisioning';
        case 'ENROLLMENT_SYNC':
        case 'COURSE_ENROLLMENT_REQUESTED':
          return 'Course Enrollment Sync';
        case 'COURSE_REGISTRATION_SUBMITTED':
          return 'Registration Batch Sync';
        case 'GRADE_SYNC_REQUESTED':
          return 'Gradebook Sync';
        case 'ACTIVITY_COMPLETED':
          return 'Activity Completion Sync';
        case 'MOODLE_QUIZ_SYNC':
          return 'Moodle Quiz Sync';
        case 'MOODLE_QUESTION_SYNC':
          return 'Quiz Question Sync';
        default:
          return String(type)
            .toLowerCase()
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
      }
    };

    const formattedMoodleQueue = [
      ...moodleResult.rows.map((m) => {
        const actionLabel = formatOutboxEventType(m.event_type);
        const targetLabel = m.student_name
          ? `${m.student_name} (${m.matric_number || m.student_focit_id})`
          : (m.matric_number || m.student_focit_id || 'Moodle Core Sync');

        return {
          id: String(m.id),
          eventType: m.event_type,
          action: actionLabel,
          type: actionLabel,
          studentId: m.student_focit_id,
          matricNumber: m.matric_number,
          studentName: m.student_name,
          targetStudent: targetLabel,
          courseCode: m.course_code,
          status: m.status,
          retryCount: m.retry_count,
          payload: m.payload,
          createdAt: m.created_at,
          updatedAt: m.updated_at,
          timestamp: m.created_at || m.updated_at,
        };
      }),
      ...integrationResult.rows.map((io) => {
        const studentName = io.payload?.full_name || io.payload?.name;
        const matric = io.payload?.matric_number || io.aggregate_id;
        const course = io.payload?.course_code || io.payload?.course_id;
        const actionLabel = formatOutboxEventType(io.event_type);

        let targetLabel = 'Integration Pipeline';
        if (io.event_type === 'MOODLE_QUIZ_SYNC') {
          const title = io.payload?.title || io.payload?.quizTitle || 'Assessment Test';
          targetLabel = `${title} • ${course || io.aggregate_id}`;
        } else if (io.event_type === 'MOODLE_QUESTION_SYNC') {
          const qText = io.payload?.prompt ? io.payload.prompt.slice(0, 35) + '...' : 'Question Item';
          targetLabel = `${qText} • ${course || ''}`;
        } else if (studentName && matric) {
          targetLabel = `${studentName} (${matric})`;
        } else if (studentName) {
          targetLabel = studentName;
        } else if (matric && course) {
          targetLabel = `${matric} • ${course}`;
        } else if (matric) {
          targetLabel = matric;
        }

        return {
          id: String(io.event_id),
          eventType: io.event_type,
          action: actionLabel,
          type: actionLabel,
          aggregateType: io.aggregate_type,
          aggregateId: io.aggregate_id,
          studentId: io.aggregate_id,
          matricNumber: matric,
          studentName: studentName || io.aggregate_type,
          targetStudent: targetLabel,
          courseCode: course || io.aggregate_type,
          status: io.status === 'PROCESSING' ? 'RETRYING' : io.status,
          retryCount: io.delivery_attempts,
          lastError: io.last_error,
          payload: io.payload,
          createdAt: io.created_at,
          updatedAt: io.updated_at,
          timestamp: io.created_at || io.updated_at,
        };
      }),
    ];

    formattedMoodleQueue.sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || a.timestamp || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || b.timestamp || 0).getTime();
      return timeB - timeA;
    });

    return res.status(200).json({
      success: true,
      data: {
        events: batchResult.rows.map((row) => ({
          batchId: row.batch_id,
          studentId: row.student_id,
          matricNumber: row.matric_number,
          studentName: row.student_name,
          semesterId: row.semester_id,
          status: row.status,
          totalUnits: row.total_units,
          updatedAt: row.updated_at,
        })),
        moodleSyncQueue: formattedMoodleQueue,
        integrationEvents: integrationResult.rows,
        total: formattedMoodleQueue.length,
      },
    });
  } catch (err) {
    logger.error({ err }, '[AdminController] Error querying outbox queue');
    return next(err);
  }
}

/**
 * 7. POST /api/admin/integrations/outbox/:id/retry
 * Reset state on a course registration batch or transactional Moodle outbox event to re-trigger synchronization.
 */
export async function retryOutboxEvent(req, res, next) {
  const { id } = req.params;

  if (!id || typeof id !== 'string' || id.trim().length === 0) {
    return res.status(400).json({
      error: 'Missing or invalid identifier',
      code: 'INVALID_IDENTIFIER',
    });
  }

  const cleanId = id.trim();
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isUuid = UUID_REGEX.test(cleanId);
  const isInteger = /^\d+$/.test(cleanId);

  if (!isUuid && !isInteger) {
    return res.status(400).json({
      error: 'Invalid identifier format. Expected a valid UUID for registration batches or integer for Moodle outbox events.',
      code: 'INVALID_IDENTIFIER_FORMAT',
    });
  }

  try {
    if (isInteger) {
      // 1. Fetch existing Moodle outbox event to resolve dynamic previous status
      const existingRes = await pool.query(
        'SELECT id, event_type, student_focit_id, status FROM moodle_outbox WHERE id = $1',
        [parseInt(cleanId, 10)]
      );

      if (existingRes.rowCount === 0) {
        return res.status(404).json({
          error: 'Moodle outbox event not found',
          code: 'OUTBOX_EVENT_NOT_FOUND',
        });
      }

      const existingEvent = existingRes.rows[0];
      const previousStatus = existingEvent.status;

      if (!['FAILED', 'PROCESSING', 'COMPLETED', 'SYNCED'].includes(previousStatus)) {
        return res.status(400).json({
          error: `Cannot retry outbox event with status '${previousStatus}'. Only FAILED, PROCESSING, COMPLETED, or SYNCED events can be retried.`,
          code: 'OUTBOX_STATUS_NOT_RETRYABLE',
          currentStatus: previousStatus,
        });
      }

      const moodleRes = await pool.query(
        `
        UPDATE moodle_outbox
        SET status = 'PENDING', retry_count = 0, updated_at = NOW()
        WHERE id = $1
        RETURNING id, event_type, student_focit_id, status, retry_count
        `,
        [parseInt(cleanId, 10)]
      );

      await recordIdentityAuditLog(pool, {
        eventType: 'ADMIN_OUTBOX_RETRY_TRIGGERED',
        actorId: req.user?.id || 'admin1',
        actorRole: req.user?.role || 'ADMIN',
        targetId: cleanId,
        targetType: 'MOODLE_OUTBOX',
        ipAddress: req.ip,
        metadata: { newStatus: 'PENDING', previousStatus },
      });

      return res.status(200).json({
        success: true,
        data: {
          message: 'Moodle outbox event reset to PENDING for worker reprocessing',
          event: moodleRes.rows[0],
        },
      });
    }

    // 2. If UUID, check integration_outbox_events first
    const existingIntegrationRes = await pool.query(
      `SELECT event_id, event_type, aggregate_id, status, locked_until FROM integration_outbox_events WHERE event_id = $1`,
      [cleanId]
    ).catch(() => ({ rowCount: 0, rows: [] }));

    if (existingIntegrationRes.rowCount > 0) {
      const existing = existingIntegrationRes.rows[0];
      const previousIntegrationStatus = existing.status;
      const isLeaseActive = previousIntegrationStatus === 'PROCESSING' && existing.locked_until && new Date(existing.locked_until) > new Date();

      if (isLeaseActive) {
        return res.status(409).json({
          error: 'Cannot retry integration event while an active worker lease is currently processing it.',
          code: 'OUTBOX_LEASE_ACTIVE',
          lockedUntil: existing.locked_until,
        });
      }

      if (!['FAILED', 'DEAD_LETTER', 'PROCESSING', 'COMPLETED', 'SYNCED'].includes(previousIntegrationStatus)) {
        return res.status(400).json({
          error: `Cannot retry integration event with status '${previousIntegrationStatus}'. Only FAILED, DEAD_LETTER, COMPLETED, or expired PROCESSING events can be retried.`,
          code: 'OUTBOX_STATUS_NOT_RETRYABLE',
          currentStatus: previousIntegrationStatus,
        });
      }

      const integrationRes = await pool.query(
        `
        UPDATE integration_outbox_events
        SET status = 'PENDING', delivery_attempts = 0, locked_until = NULL, last_error = NULL, updated_at = NOW()
        WHERE event_id = $1
          AND (
            status IN ('FAILED', 'DEAD_LETTER', 'COMPLETED', 'SYNCED')
            OR (status = 'PROCESSING' AND (locked_until IS NULL OR locked_until <= NOW()))
          )
        RETURNING event_id, event_type, aggregate_id, status
        `,
        [cleanId]
      );

      if (integrationRes.rowCount === 0) {
        return res.status(409).json({
          error: 'Could not retry integration event: an active worker claimed the lease concurrently.',
          code: 'OUTBOX_CONCURRENT_MUTATION',
        });
      }

      await recordIdentityAuditLog(pool, {
        eventType: 'ADMIN_OUTBOX_RETRY_TRIGGERED',
        actorId: req.user?.id || 'admin1',
        actorRole: req.user?.role || 'ADMIN',
        targetId: cleanId,
        targetType: 'INTEGRATION_OUTBOX',
        ipAddress: req.ip,
        metadata: { newStatus: 'PENDING', previousStatus: previousIntegrationStatus },
      });

      return res.status(200).json({
        success: true,
        data: {
          message: 'Integration outbox event reset to PENDING for worker reprocessing',
          event: integrationRes.rows[0],
        },
      });
    }

    // 3. Otherwise, retry registration batch (UUID)
    const existingBatchRes = await pool.query(
      `SELECT id, status, student_id FROM course_registration_batches WHERE id = $1`,
      [cleanId]
    );

    if (existingBatchRes.rowCount === 0) {
      return res.status(404).json({
        error: 'Registration batch not found',
        code: 'BATCH_NOT_FOUND',
      });
    }

    const previousBatchStatus = existingBatchRes.rows[0].status;

    if (!['DRAFT', 'REJECTED'].includes(previousBatchStatus)) {
      return res.status(400).json({
        error: `Cannot re-trigger synchronization on a batch with status '${previousBatchStatus}'`,
        code: 'BATCH_STATUS_TERMINAL',
        currentStatus: previousBatchStatus,
      });
    }

    const result = await pool.query(
      `
      UPDATE course_registration_batches
      SET status = 'SUBMITTED', updated_at = NOW()
      WHERE id = $1
      RETURNING id, student_id, status
      `,
      [cleanId]
    );

    await recordIdentityAuditLog(pool, {
      eventType: 'ADMIN_OUTBOX_RETRY_TRIGGERED',
      actorId: req.user?.id || 'admin1',
      actorRole: req.user?.role || 'ADMIN',
      targetId: cleanId,
      targetType: 'REGISTRATION_BATCH',
      ipAddress: req.ip,
      metadata: { newStatus: 'SUBMITTED', previousStatus: previousBatchStatus },
    });

    return res.status(200).json({
      success: true,
      data: {
        message: 'Outbox event status reset to SUBMITTED for worker reprocessing',
        batch: result.rows[0],
      },
    });
  } catch (err) {
    logger.error({ err, id }, '[AdminController] Error retrying outbox event');
    return next(err);
  }
}

/**
 * 8. GET /api/admin/audit-logs
 * Fetch immutable security audit logs with pagination and filters.
 */
export async function getAuditLogs(req, res, next) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;
    const actorId = req.query.actorId ? `%${String(req.query.actorId).trim()}%` : null;
    const eventType = req.query.eventType ? String(req.query.eventType).trim() : null;

    let queryText = `SELECT * FROM identity_audit_logs WHERE 1=1`;
    const params = [];

    if (actorId) {
      params.push(actorId);
      queryText += ` AND actor_id ILIKE $${params.length}`;
    }

    if (eventType && eventType !== 'ALL') {
      params.push(eventType);
      queryText += ` AND event_type = $${params.length}`;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM (${queryText}) AS filtered`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    params.push(limit, offset);
    queryText += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(queryText, params);

    return res.status(200).json({
      success: true,
      data: {
        logs: result.rows.map((row) => ({
          id: row.id,
          eventType: row.event_type,
          actorId: row.actor_id,
          actorRole: row.actor_role,
          targetId: row.target_id,
          targetEntity: row.target_type,
          ipAddress: row.ip_address,
          details: row.metadata,
          metadata: row.metadata,
          prevEntryHash: row.prev_entry_hash,
          entryHash: row.entry_hash,
          createdAt: row.created_at,
          timestamp: row.created_at,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (err) {
    logger.error({ err }, '[AdminController] Error fetching audit logs');
    return next(err);
  }
}

/**
 * 9. GET /api/admin/academic-semesters
 * List all academic semesters with session metadata and registration window status.
 */
export async function getAcademicSemesters(req, res, next) {
  try {
    const result = await pool.query(`
      SELECT 
        sem.id AS semester_id,
        sem.name AS semester_name,
        sem.semester_number,
        sem.is_registration_open,
        sem.created_at,
        sess.id AS session_id,
        sess.name AS session_name,
        sess.is_current AS is_current_session
      FROM academic_semesters sem
      JOIN academic_sessions sess ON sess.id = sem.session_id
      ORDER BY sess.id DESC, sem.semester_number ASC
    `);

    return res.status(200).json({
      success: true,
      data: {
        semesters: result.rows.map((r) => ({
          semesterId: r.semester_id,
          semesterName: r.semester_name,
          semesterNumber: r.semester_number,
          isRegistrationOpen: r.is_registration_open,
          sessionId: r.session_id,
          sessionName: r.session_name,
          isCurrentSession: r.is_current_session,
          createdAt: r.created_at,
        })),
        total: result.rowCount,
      },
    });
  } catch (err) {
    logger.error({ err }, '[AdminController] Error fetching academic semesters');
    return next(err);
  }
}

/**
 * 10. PATCH /api/admin/academic-semesters/:id/registration-window
 * Open or close course registration for a specific academic semester.
 */
export async function toggleRegistrationWindow(req, res, next) {
  const { id } = req.params;
  const { isOpen } = req.body || {};

  // Validate semester ID format and length (VARCHAR(32))
  if (
    !id ||
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    id.trim().length > 32 ||
    !/^[a-zA-Z0-9_-]+$/.test(id.trim())
  ) {
    return res.status(400).json({
      error: 'Invalid semester ID format. Expected an alphanumeric identifier up to 32 characters.',
      code: 'INVALID_SEMESTER_ID',
    });
  }

  if (typeof isOpen !== 'boolean') {
    return res.status(400).json({
      error: 'Missing or invalid boolean field: isOpen',
      code: 'VALIDATION_FAILED',
    });
  }

  const cleanId = id.trim();

  try {
    const result = await pool.query(
      `
      UPDATE academic_semesters
      SET is_registration_open = $1
      WHERE id = $2
      RETURNING id, name, is_registration_open
      `,
      [isOpen, cleanId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Academic semester not found',
        code: 'SEMESTER_NOT_FOUND',
      });
    }

    // Record audit event
    await recordIdentityAuditLog(pool, {
      eventType: isOpen ? 'ADMIN_REGISTRATION_WINDOW_OPENED' : 'ADMIN_REGISTRATION_WINDOW_CLOSED',
      actorId: req.user?.id || 'admin1',
      actorRole: req.user?.role || 'ADMIN',
      targetId: cleanId,
      targetType: 'ACADEMIC_SEMESTER',
      ipAddress: req.ip,
      metadata: { isRegistrationOpen: isOpen },
    });

    logger.info({ semesterId: cleanId, isRegistrationOpen: isOpen }, '[AdminController] Registration window toggled');

    return res.status(200).json({
      success: true,
      data: {
        semesterId: cleanId,
        isRegistrationOpen: isOpen,
        message: `Course registration successfully ${isOpen ? 'OPENED' : 'CLOSED'} for semester ${cleanId}`,
      },
    });
  } catch (err) {
    logger.error({ err, id }, '[AdminController] Error toggling registration window');
    return next(err);
  }
}
