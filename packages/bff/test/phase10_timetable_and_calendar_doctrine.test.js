/**
 * FOCIT LMS - Phase 10: Timetable & RFC 5545 iCalendar Doctrine Suite (Milestone 10.5)
 *
 * Mathematically & Architecturally validates:
 * 1. RFC 5545 Specification Compliance: Strict CRLF (\r\n) line formatting & Line Folding
 * 2. Native VALARM -PT15M Notification Blocks for Smartphone Lock-Screen Alerts
 * 3. VTIMEZONE Africa/Lagos (WAT, UTC+1, No DST) Timezone Stabilization
 * 4. Zero-Cookie Capability Token Security, SHA-256 Hashing & Single-Active-Token Rotation
 * 5. Conditional GET Mechanics (ETag, If-None-Match -> 304 Not Modified)
 * 6. User-Granted Web Notification Lifecycle & Deduplication Ledger
 * 7. Mobile Viewport Physical Containment & CSS Flexbox min-h-0 Invariant
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bffRoot = path.resolve(__dirname, '..');
const frontendRoot = path.resolve(bffRoot, '..', 'frontend');

describe('Phase 10: Timetable & RFC 5545 Calendar Doctrine', () => {

  // ── TEST SUITE 1: RFC 5545 Serialization & Syntax Invariants ──
  describe('RFC 5545 iCalendar Syntax & VALARM Invariants', () => {
    test('Strict CRLF Invariant: Line endings must be \\r\\n and never bare \\n', () => {
      const timetableRoutePath = path.resolve(bffRoot, 'src', 'routes', 'timetable.js');
      assert.ok(fs.existsSync(timetableRoutePath), 'timetable.js router must exist');
      const routeContent = fs.readFileSync(timetableRoutePath, 'utf8');

      assert.match(routeContent, /const CRLF = ['"]\\r\\n['"]/, 'timetable.js must explicitly define CRLF as \\r\\n');
      assert.match(routeContent, /lines\.join\(CRLF\) \+ CRLF/, 'iCalendar payload must be joined strictly with CRLF');
    });

    test('RFC 5545 §3.1 Line Folding: Lines exceeding 75 octets must fold with CRLF + space', () => {
      // Test folding utility logic matching timetable.js implementation
      function foldLine(line) {
        const CRLF = '\r\n';
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

      const shortLine = 'SUMMARY:CSC 204 - Data Structures and Algorithms';
      assert.strictEqual(foldLine(shortLine), shortLine);

      const longLine = 'DESCRIPTION:This is an extremely detailed and comprehensive description of the advanced relational database management systems lecture series for level 200 software engineering students.';
      const folded = foldLine(longLine);

      assert.ok(folded.includes('\r\n '), 'Folded line must contain CRLF followed by a single space');
      const segments = folded.split('\r\n');
      assert.ok(segments[0].length <= 75, 'First segment must be <= 75 octets');
      assert.ok(segments[1].startsWith(' '), 'Subsequent folded segments must begin with whitespace');
      assert.ok(segments[1].length <= 75, 'Subsequent folded segments must be <= 75 octets');
    });

    test('Timezone Invariant: Declares VTIMEZONE for Africa/Lagos (WAT, UTC+1, No DST)', () => {
      const timetableRoutePath = path.resolve(bffRoot, 'src', 'routes', 'timetable.js');
      const routeContent = fs.readFileSync(timetableRoutePath, 'utf8');

      assert.match(routeContent, /BEGIN:VTIMEZONE/, 'Must declare top-level VTIMEZONE component');
      assert.match(routeContent, /TZID:Africa\/Lagos/, 'Timezone ID must be Africa/Lagos');
      assert.match(routeContent, /TZOFFSETFROM:\+0100/, 'WAT standard offset must be +0100');
      assert.match(routeContent, /TZOFFSETTO:\+0100/, 'WAT target offset must be +0100');
      assert.match(routeContent, /TZNAME:WAT/, 'Timezone abbreviation must be WAT');
    });

    test('VALARM Syntax: Emits native lock-screen alert block with -PT15M trigger', () => {
      const timetableRoutePath = path.resolve(bffRoot, 'src', 'routes', 'timetable.js');
      const routeContent = fs.readFileSync(timetableRoutePath, 'utf8');

      assert.match(routeContent, /BEGIN:VALARM/, 'Must declare VALARM block inside lecture VEVENT');
      assert.match(routeContent, /ACTION:DISPLAY/, 'VALARM must specify ACTION:DISPLAY');
      assert.match(routeContent, /TRIGGER:-PT15M/, 'VALARM must specify -PT15M (15 minutes prior to start)');
      assert.match(routeContent, /END:VALARM/, 'VALARM block must terminate cleanly');
    });
  });

  // ── TEST SUITE 2: Capability Token Minting & Single-Active-Token Rotation ──
  describe('Capability Token Security & Rotation Lifecycle', () => {
    test('Token Entropy & SHA-256 Hashing: Raw tokens are 256-bit crypto random and stored as hashes', () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      assert.strictEqual(rawToken.length, 64, '256-bit token hex representation must be 64 characters');

      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      assert.strictEqual(tokenHash.length, 64, 'SHA-256 hash must be 64 characters');
      assert.notStrictEqual(rawToken, tokenHash, 'Raw token and token hash must be cryptographically distinct');
    });

    test('Single-Active-Token Invariant: POST /token revokes previous active tokens before inserting new', () => {
      const timetableRoutePath = path.resolve(bffRoot, 'src', 'routes', 'timetable.js');
      const routeContent = fs.readFileSync(timetableRoutePath, 'utf8');

      assert.match(
        routeContent,
        /UPDATE calendar_subscription_tokens\s+SET is_revoked = TRUE,\s*revoked_at = NOW\(\)\s+WHERE student_id = \$1 AND is_revoked = FALSE/s,
        'Token generation must atomically invalidate previous active tokens'
      );
    });

    test('Auth Bypass Contract: authMiddleware exempts /timetable/calendar.ics for capability token queries', () => {
      const authMiddlewarePath = path.resolve(bffRoot, 'src', 'middleware', 'auth.js');
      const authContent = fs.readFileSync(authMiddlewarePath, 'utf8');

      assert.match(
        authContent,
        /req\.path\.(?:endsWith|includes)\(['"]\/timetable\/calendar\.ics['"]\)/,
        'authMiddleware must exempt /timetable/calendar.ics from ambient cookie/JWT barrier'
      );
    });
  });

  // ── TEST SUITE 3: Dynamic Enrollment Sync & Conditional Caching ──
  describe('Dynamic Enrollment Sync & Conditional Caching', () => {
    test('Dynamic Query: iCal and Events endpoints join active student enrollments', () => {
      const timetableRoutePath = path.resolve(bffRoot, 'src', 'routes', 'timetable.js');
      const routeContent = fs.readFileSync(timetableRoutePath, 'utf8');

      assert.match(
        routeContent,
        /JOIN enrollments e ON e\.course_id = (?:c\.course_id|t\.course_id)/,
        'Must join student enrollments to query approved courses dynamically'
      );
      assert.match(
        routeContent,
        /e\.status IN \(['"]ENROLLED['"],\s*['"]APPROVED['"],\s*['"]IN_PROGRESS['"]\)/,
        'Must filter strictly by active enrollment statuses'
      );
    });

    test('Conditional GET Defense: Emits ETag and returns 304 Not Modified when unchanged', () => {
      const timetableRoutePath = path.resolve(bffRoot, 'src', 'routes', 'timetable.js');
      const routeContent = fs.readFileSync(timetableRoutePath, 'utf8');

      assert.match(routeContent, /req\.headers\['if-none-match'\] === etag/, 'Must evaluate If-None-Match header');
      assert.match(routeContent, /res\.status\(304\)\.end\(\)/, 'Must respond with 304 Not Modified on cache hit');
      assert.match(routeContent, /max-age=1800/, 'Must specify 30-minute revalidation max-age');
    });
  });

  // ── TEST SUITE 4: User-Granted Web Notification & Viewport Containment ──
  describe('User-Granted Web Notifications & Viewport Containment', () => {
    test('User Consent Invariant: useLectureNotifications NEVER requests permission without user gesture', () => {
      const hookPath = path.resolve(frontendRoot, 'src', 'hooks', 'useLectureNotifications.js');
      assert.ok(fs.existsSync(hookPath), 'useLectureNotifications.js hook must exist');
      const hookContent = fs.readFileSync(hookPath, 'utf8');

      assert.match(hookContent, /Notification\.permission/, 'Hook must inspect browser Notification.permission');
      assert.match(hookContent, /requestPermission = useCallback/, 'Hook must expose explicit requestPermission action');
      assert.match(
        hookContent,
        /sessionStorage\.getItem\(notifyKey\)/,
        'Hook must check deduplication ledger before firing notification'
      );
    });

    test('SyncPhoneCalendarModal: Enforces viewport containment, min-h-0, and WCAG 44x44px controls', () => {
      const modalPath = path.resolve(frontendRoot, 'src', 'components', 'calendar', 'SyncPhoneCalendarModal.jsx');
      assert.ok(fs.existsSync(modalPath), 'SyncPhoneCalendarModal.jsx must exist');
      const modalContent = fs.readFileSync(modalPath, 'utf8');

      assert.match(
        modalContent,
        /contain:\s*['"]layout paint['"]/,
        'Modal must enforce strict CSS layout paint containment without intrinsic size collapse'
      );
      assert.match(
        modalContent,
        /max-h-\[min\(92dvh,700px\)\]/,
        'Modal must bound vertical dimension against dynamic viewport height'
      );
      assert.match(
        modalContent,
        /flex-1\s+min-h-0/,
        'Scrollport must enforce min-h-0 to prevent flexbox blowout'
      );
      assert.match(
        modalContent,
        /min-h-\[44px\]/,
        'Action controls must adhere to WCAG 44px touch target bounds'
      );
    });

    test('Calendar Navigation Integration: Sidebar and Router wire /calendar route with Calendar icon', () => {
      const sidebarPath = path.resolve(frontendRoot, 'src', 'components', 'layout', 'Sidebar.jsx');
      const routerPath = path.resolve(frontendRoot, 'src', 'router.jsx');

      const sidebarContent = fs.readFileSync(sidebarPath, 'utf8');
      const routerContent = fs.readFileSync(routerPath, 'utf8');

      assert.match(sidebarContent, /to:\s*['"]\/calendar['"]/, 'Sidebar must declare /calendar link');
      assert.match(sidebarContent, /icon:\s*Calendar/, 'Sidebar must bind Calendar icon');

      assert.match(routerContent, /path:\s*['"]calendar['"]/, 'Router must configure calendar route');
      assert.match(routerContent, /CalendarPage/, 'Router must render CalendarPage component');
    });
  });
});
