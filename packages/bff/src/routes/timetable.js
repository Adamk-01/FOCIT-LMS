/**
 * FOCIT LMS - Timetable & Calendar RFC 5545 Engine (Milestone 10.5)
 *
 * Implements:
 * 1. Zero-Cookie RFC 5545 iCalendar stream with native VALARM (-PT15M)
 * 2. Strict CRLF (\r\n) line formatting and VTIMEZONE (Africa/Lagos, WAT UTC+1)
 * 3. Capability Token Minting, Single-Active-Token Rotation & Invalidation
 * 4. Conditional GET with deterministic ETag & 304 Not Modified support
 * 5. Weekly Timetable & Upcoming Lecture Stream for in-browser notifications
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import express from 'express';
import crypto from 'node:crypto';
import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';

const router = express.Router();

const CRLF = '\r\n';

/**
 * Format Date to RFC 5545 UTC timestamp: YYYYMMDDTHHMMSSZ
 */
function formatIcsUtc(date) {
  const d = new Date(date);
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Format local date & time to RFC 5545 local format: YYYYMMDDTHHMMSS
 */
function formatIcsLocal(dateStr, timeStr) {
  // dateStr: YYYY-MM-DD, timeStr: HH:MM:SS or HH:MM
  const cleanDate = dateStr.replace(/-/g, '');
  const cleanTime = timeStr.replace(/:/g, '').padEnd(6, '0').slice(0, 6);
  return `${cleanDate}T${cleanTime}`;
}

/**
 * Fold long lines according to RFC 5545 Section 3.1 (max 75 octets)
 */
function foldLine(line) {
  if (line.length <= 75) return line;
  const parts = [];
  let remaining = line;
  parts.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    parts.push(' ' + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return parts.join(CRLF);
}

const DOW_MAP = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * 1. GET /api/student/timetable/status
 * Read-only status query: checks if student has an active calendar subscription.
 */
router.get('/status', async (req, res, next) => {
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  if (!studentId) {
    return res.status(401).json({ error: 'Unauthenticated', code: 'AUTH_REQUIRED' });
  }

  try {
    const result = await pool.query(
      `SELECT token_id, created_at, last_accessed_at 
       FROM calendar_subscription_tokens 
       WHERE student_id = $1 AND is_revoked = FALSE 
       ORDER BY created_at DESC 
       LIMIT 1;`,
      [studentId]
    );

    if (result.rows.length === 0) {
      return res.status(200).json({
        hasActiveSubscription: false,
        createdAt: null,
        lastAccessedAt: null,
      });
    }

    const row = result.rows[0];
    return res.status(200).json({
      hasActiveSubscription: true,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, studentId }, '[Timetable] Check status error');
    return next(err);
  }
});

/**
 * 2. POST /api/student/timetable/token
 * Explicit action to mint or rotate the calendar capability token.
 * Single-Active-Token invariant: Revokes any prior active tokens in an atomic transaction.
 */
router.post('/token', async (req, res, next) => {
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  if (!studentId) {
    return res.status(401).json({ error: 'Unauthenticated', code: 'AUTH_REQUIRED' });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Revoke any prior active tokens for this student
    await client.query(
      `UPDATE calendar_subscription_tokens
       SET is_revoked = TRUE, revoked_at = NOW()
       WHERE student_id = $1 AND is_revoked = FALSE;`,
      [studentId]
    );

    // Insert new single active token
    await client.query(
      `INSERT INTO calendar_subscription_tokens (
         student_id,
         token_hash,
         is_revoked,
         created_at
       ) VALUES ($1, $2, FALSE, NOW());`,
      [studentId, tokenHash]
    );

    await client.query('COMMIT');

    const host = req.get('host') || 'localhost:3000';
    const isHttps = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https';
    const baseUrl = `${isHttps ? 'https' : 'http'}://${host}/api/student/timetable/calendar.ics?token=${rawToken}`;
    const webcalUrl = `webcal://${host}/api/student/timetable/calendar.ics?token=${rawToken}`;

    return res.status(201).json({
      message: 'Calendar subscription capability token generated successfully.',
      webcalUrl,
      httpUrl: baseUrl,
      rawToken,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err: err?.message || err, studentId }, '[Timetable] Token generation error');
    return next(err);
  } finally {
    client.release();
  }
});

/**
 * 3. DELETE /api/student/timetable/token
 * Explicit action to revoke active calendar subscription.
 */
router.delete('/token', async (req, res, next) => {
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  if (!studentId) {
    return res.status(401).json({ error: 'Unauthenticated', code: 'AUTH_REQUIRED' });
  }

  try {
    await pool.query(
      `UPDATE calendar_subscription_tokens
       SET is_revoked = TRUE, revoked_at = NOW()
       WHERE student_id = $1 AND is_revoked = FALSE;`,
      [studentId]
    );

    return res.status(200).json({
      message: 'Calendar subscription successfully revoked. Feed will no longer sync.',
    });
  } catch (err) {
    logger.error({ err: err?.message || err, studentId }, '[Timetable] Token revocation error');
    return next(err);
  }
});

/**
 * 4. GET /api/student/timetable/calendar.ics
 * Zero-Cookie Public Capability Endpoint for Apple/Google Calendar Sync.
 * Authenticated exclusively by SHA-256 capability token query.
 * Emits RFC 5545 compliant calendar feed with CRLF and VALARM (-PT15M).
 */
router.get('/calendar.ics', async (req, res, next) => {
  const rawToken = req.query?.token;
  if (!rawToken || typeof rawToken !== 'string') {
    return res.status(401).type('text/plain').send('401 Unauthorized: Valid subscription token parameter required.');
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken.trim()).digest('hex');

  try {
    // 1. Authenticate token
    const tokenRes = await pool.query(
      `SELECT student_id, token_id, is_revoked 
       FROM calendar_subscription_tokens 
       WHERE token_hash = $1 AND is_revoked = FALSE 
       LIMIT 1;`,
      [tokenHash]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(401).type('text/plain').send('401 Unauthorized: Subscription token is invalid or has been revoked.');
    }

    const { student_id: studentId, token_id: tokenId } = tokenRes.rows[0];

    // Asynchronously record last_accessed_at
    pool.query(
      `UPDATE calendar_subscription_tokens SET last_accessed_at = NOW() WHERE token_id = $1;`,
      [tokenId]
    ).catch(() => {});

    // 2. Fetch student's currently registered courses and timetable slots
    const timetableRes = await pool.query(
      `SELECT 
         t.id AS schedule_id,
         t.course_id,
         c.code AS course_code,
         c.title AS course_title,
         t.room_id,
         t.day_of_week,
         t.start_time,
         t.duration_minutes,
         t.rrule,
         t.updated_at AS schedule_updated_at,
         e.updated_at AS enrollment_updated_at
       FROM enrollments e
       JOIN courses c ON c.course_id = e.course_id
       JOIN academic_timetable t ON t.course_id = c.course_id
       WHERE e.student_id = $1
         AND e.status IN ('ENROLLED', 'APPROVED', 'IN_PROGRESS')
       ORDER BY t.day_of_week, t.start_time;`,
      [studentId]
    );

    // 3. Fetch assignments for currently registered courses
    const assignmentsRes = await pool.query(
      `SELECT 
         a.assignment_id,
         a.course_id,
         c.code AS course_code,
         a.title,
         a.due_date,
         a.updated_at
       FROM course_assignments a
       JOIN courses c ON c.course_id = a.course_id
       JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = $1
       WHERE e.status IN ('ENROLLED', 'APPROVED', 'IN_PROGRESS')
         AND a.status IN ('PUBLISHED', 'CLOSED')
       ORDER BY a.due_date ASC;`,
      [studentId]
    );

    const slots = timetableRes.rows;
    const assignments = assignmentsRes.rows;

    // 4. Evaluate Conditional GET (ETag + 304 Not Modified)
    let maxTimestamp = 0;
    for (const s of slots) {
      const t1 = new Date(s.schedule_updated_at || 0).getTime();
      const t2 = new Date(s.enrollment_updated_at || 0).getTime();
      maxTimestamp = Math.max(maxTimestamp, t1, t2);
    }
    for (const a of assignments) {
      const t3 = new Date(a.updated_at || 0).getTime();
      maxTimestamp = Math.max(maxTimestamp, t3);
    }

    const etagPayload = `${studentId}:${slots.length}:${assignments.length}:${maxTimestamp}`;
    const etag = `W/"${crypto.createHash('sha256').update(etagPayload).digest('hex').slice(0, 16)}"`;

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    // 5. Serialize RFC 5545 Stream
    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('PRODID:-//FOCIT LMS//Academic Lecture Timetable//EN');
    lines.push('VERSION:2.0');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push(foldLine(`X-WR-CALNAME:FOCIT LMS Timetable (${studentId})`));
    lines.push('X-WR-TIMEZONE:Africa/Lagos');

    // Top-Level VTIMEZONE Component for Africa/Lagos (WAT, UTC+1, No DST)
    lines.push('BEGIN:VTIMEZONE');
    lines.push('TZID:Africa/Lagos');
    lines.push('BEGIN:STANDARD');
    lines.push('DTSTART:19700101T000000');
    lines.push('TZOFFSETFROM:+0100');
    lines.push('TZOFFSETTO:+0100');
    lines.push('TZNAME:WAT');
    lines.push('END:STANDARD');
    lines.push('END:VTIMEZONE');

    const nowUtc = formatIcsUtc(new Date());

    // Reference Monday of current semester for standard weekly anchor
    const anchorDate = new Date();
    // Normalize to current week Monday
    const currentDay = anchorDate.getDay();
    const diffToMonday = anchorDate.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
    const mondayDate = new Date(anchorDate.setDate(diffToMonday));

    // Emit VEVENT for each weekly lecture slot
    for (const slot of slots) {
      const dowIndex = slot.day_of_week ?? 1; // 1 = Mon
      const dayCode = DOW_MAP[dowIndex] || 'MO';

      // Compute slot start date relative to mondayDate
      const slotDate = new Date(mondayDate);
      const daysOffset = (dowIndex === 0 ? 7 : dowIndex) - 1;
      slotDate.setDate(mondayDate.getDate() + daysOffset);
      const yyyy = slotDate.getFullYear();
      const mm = String(slotDate.getMonth() + 1).padStart(2, '0');
      const dd = String(slotDate.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;

      const startTimeStr = String(slot.start_time || '09:00:00');
      const [sh, sm] = startTimeStr.split(':').map(Number);
      const durationMin = Number(slot.duration_minutes) || 60;
      const endTotalMinutes = sh * 60 + sm + durationMin;
      const eh = Math.floor(endTotalMinutes / 60) % 24;
      const em = endTotalMinutes % 60;
      const endTimeStr = `${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}:00`;

      const dtStart = formatIcsLocal(dateStr, startTimeStr);
      const dtEnd = formatIcsLocal(dateStr, endTimeStr);
      const uid = `lecture-${slot.schedule_id}-${slot.course_code}@focit.edu.ng`;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${nowUtc}`);
      lines.push(`DTSTART;TZID=Africa/Lagos:${dtStart}`);
      lines.push(`DTEND;TZID=Africa/Lagos:${dtEnd}`);
      lines.push(`RRULE:FREQ=WEEKLY;BYDAY=${dayCode}`);
      lines.push(foldLine(`SUMMARY:${slot.course_code} - ${slot.course_title}`));
      lines.push(foldLine(`LOCATION:Room ${slot.room_id || 'Virtual / Faculty Lab'}`));
      lines.push(foldLine(`DESCRIPTION:Academic lecture session for ${slot.course_code} (${slot.course_title}).`));
      lines.push('STATUS:CONFIRMED');
      lines.push('SEQUENCE:1');

      // Native 15-Minute Prior OS Alert
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(foldLine(`DESCRIPTION:Upcoming lecture: ${slot.course_code} starts in 15 minutes`));
      lines.push('TRIGGER:-PT15M');
      lines.push('END:VALARM');

      lines.push('END:VEVENT');
    }

    // Emit VEVENT for each course assignment due date
    for (const a of assignments) {
      if (!a.due_date) continue;
      const dueUtc = formatIcsUtc(a.due_date);
      const uid = `assignment-${a.assignment_id}@focit.edu.ng`;

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${nowUtc}`);
      lines.push(`DTSTART:${dueUtc}`);
      lines.push(`DTEND:${dueUtc}`);
      lines.push(foldLine(`SUMMARY:Assignment Due: ${a.course_code} - ${a.title}`));
      lines.push(foldLine(`DESCRIPTION:Submission deadline for assignment ${a.title} in ${a.course_code}.`));
      lines.push('STATUS:CONFIRMED');

      // 1-Hour Prior Deadline Alert
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(foldLine(`DESCRIPTION:Assignment deadline in 1 hour: ${a.course_code}`));
      lines.push('TRIGGER:-PT1H');
      lines.push('END:VALARM');

      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');

    const icsContent = lines.join(CRLF) + CRLF;

    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="focit_timetable.ics"',
      'Cache-Control': 'private, no-cache, must-revalidate, max-age=1800',
      'ETag': etag,
      'Last-Modified': new Date(maxTimestamp || Date.now()).toUTCString(),
    });

    return res.status(200).send(icsContent);
  } catch (err) {
    logger.error({ err: err?.message || err, rawToken }, '[Timetable] iCal feed generation error');
    return res.status(500).type('text/plain').send('500 Internal Server Error generating calendar stream.');
  }
});

/**
 * 5. GET /api/student/timetable/events
 * Authenticated student endpoint returning structured schedule slots,
 * important academic dates, and nextUpcomingLecture for in-browser notifications.
 */
router.get('/events', async (req, res, next) => {
  const studentId = req.user?.student_id || req.user?.id || req.user?.username;
  if (!studentId) {
    return res.status(401).json({ error: 'Unauthenticated', code: 'AUTH_REQUIRED' });
  }

  try {
    // 1. Fetch weekly schedule
    const timetableRes = await pool.query(
      `SELECT 
         t.id,
         t.course_id,
         c.code AS course_code,
         c.title AS course_title,
         c.units,
         t.room_id,
         t.day_of_week,
         t.start_time,
         t.duration_minutes
       FROM enrollments e
       JOIN courses c ON c.course_id = e.course_id
       JOIN academic_timetable t ON t.course_id = c.course_id
       WHERE e.student_id = $1
         AND e.status IN ('ENROLLED', 'APPROVED', 'IN_PROGRESS')
       ORDER BY t.day_of_week, t.start_time;`,
      [studentId]
    );

    // 2. Fetch upcoming assignments & quizzes deadlines
    const assignmentsRes = await pool.query(
      `SELECT * FROM (
         SELECT 
           a.assignment_id::text AS id,
           a.course_id::text AS course_id,
           c.code::text AS course_code,
           a.title::text AS title,
           a.due_date,
           a.max_points::float AS max_points,
           'ASSIGNMENT' AS item_type
         FROM course_assignments a
         JOIN courses c ON c.course_id = a.course_id
         JOIN enrollments e ON e.course_id = a.course_id AND e.student_id = $1
         WHERE e.status IN ('ENROLLED', 'APPROVED', 'IN_PROGRESS')
           AND a.due_date >= NOW()
         UNION ALL
         SELECT 
           q.quiz_id::text AS id,
           q.course_id::text AS course_id,
           c.code::text AS course_code,
           q.title::text AS title,
           q.due_date,
           q.total_points::float AS max_points,
           'QUIZ' AS item_type
         FROM quizzes q
         JOIN courses c ON c.course_id = q.course_id
         JOIN enrollments e ON e.course_id = q.course_id AND e.student_id = $1
         WHERE e.status IN ('ENROLLED', 'APPROVED', 'IN_PROGRESS')
           AND q.status = 'ACTIVE'
           AND q.due_date >= NOW()
       ) combined_deadlines
       ORDER BY due_date ASC
       LIMIT 8;`,
      [studentId]
    );

    // 3. Compute nextUpcomingLecture against Africa/Lagos current time
    const todayRes = await pool.query(
      `SELECT 
         t.id,
         t.course_id,
         c.code AS course_code,
         c.title AS course_title,
         t.room_id,
         t.start_time,
         t.duration_minutes,
         EXTRACT(DOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos'))::int AS current_dow,
         (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::time AS current_time
       FROM academic_timetable t
       JOIN courses c ON c.course_id = t.course_id
       JOIN enrollments e ON e.course_id = c.course_id AND e.student_id = $1
       WHERE e.status IN ('ENROLLED', 'IN_PROGRESS')
         AND t.day_of_week = EXTRACT(DOW FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos'))::int
         AND (t.start_time::time + make_interval(mins => t.duration_minutes::int)) > (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::time
       ORDER BY t.start_time ASC
       LIMIT 1;`,
      [studentId]
    );

    let nextLecture = null;
    if (todayRes.rows.length > 0) {
      const row = todayRes.rows[0];
      const [th, tm] = String(row.current_time).split(':').map(Number);
      const [sh, sm] = String(row.start_time).split(':').map(Number);

      const nowMinutes = th * 60 + tm;
      const startMinutes = sh * 60 + sm;
      const minutesUntilStart = startMinutes - nowMinutes;

      nextLecture = {
        scheduleId: row.id,
        courseId: row.course_id,
        courseCode: row.course_code,
        courseTitle: row.course_title,
        roomId: row.room_id || 'Faculty Lab',
        startTime: row.start_time,
        durationMinutes: row.duration_minutes,
        minutesUntilStart,
        isStartingSoon: minutesUntilStart <= 15 && minutesUntilStart >= 0,
        isLiveNow: minutesUntilStart < 0,
      };
    }

    return res.status(200).json({
      schedule: timetableRes.rows.map((row) => ({
        id: row.id,
        courseId: row.course_id,
        courseCode: row.course_code,
        courseTitle: row.course_title,
        units: row.units,
        roomId: row.room_id || 'TBD',
        dayOfWeek: row.day_of_week,
        dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][row.day_of_week] || 'Monday',
        startTime: row.start_time,
        durationMinutes: row.duration_minutes,
      })),
      upcomingDeadlines: assignmentsRes.rows.map((row) => ({
        id: row.id,
        courseId: row.course_id,
        courseCode: row.course_code,
        title: row.title,
        dueDate: row.due_date,
        maxPoints: row.max_points,
        type: row.item_type || 'ASSIGNMENT',
      })),
      nextUpcomingLecture: nextLecture,
    });
  } catch (err) {
    logger.error({ err: err?.message || err, studentId }, '[Timetable] Fetch events error');
    return next(err);
  }
});

export default router;
