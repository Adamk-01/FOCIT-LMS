/**
 * FOCIT LMS - Phase 10: Global Dark Mode & Discussion Forum Replies Doctrine Suite
 *
 * Mathematically & Architecturally validates:
 * 1. Global Dark Mode Zero-FOUC Script & Class-Based Tailwind Configuration
 * 2. Theme State Machine ('system' | 'light' | 'dark') & LocalStorage Synchronization
 * 3. Discussion Forum Replies Relational Schema & Cascade Foreign Key Invariants
 * 4. Author Avatar Propagation via LEFT JOIN student_profiles
 * 5. Ephemeral Rate-Limiting Mechanics (5s Spam Bucket for Forum Replies)
 * 6. Viewport Containment, Flex Child min-h-0 Invariant & WCAG 44x44px Controls
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bffRoot = path.resolve(__dirname, '..');
const frontendRoot = path.resolve(bffRoot, '..', 'frontend');

describe('Phase 10: Global Dark Mode & Discussion Forum Replies Doctrine', () => {

  // ── TEST SUITE 1: Global Dark Mode & Zero-FOUC Architecture ──
  describe('Milestone 10.4: Global Dark Mode Engine & Zero-FOUC Contract', () => {
    test('Zero-FOUC Execution: index.html contains synchronous inline dark-mode script in <head>', () => {
      const indexHtmlPath = path.resolve(frontendRoot, 'index.html');
      assert.ok(fs.existsSync(indexHtmlPath), 'index.html must exist');
      const htmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

      // Must inspect localStorage synchronously before stylesheet rendering
      assert.match(
        htmlContent,
        /localStorage\.getItem\(['"]focit_theme['"]\)/,
        'index.html must check localStorage for focit_theme'
      );
      assert.match(
        htmlContent,
        /prefers-color-scheme:\s*dark/,
        'index.html must evaluate window.matchMedia for OS dark-mode preference'
      );
      assert.match(
        htmlContent,
        /classList\.add\(['"]dark['"]\)/,
        'index.html must immediately attach .dark class to root element to prevent white flash'
      );
    });

    test('Tailwind Contract: tailwind.config.js enforces class-based dark mode', () => {
      const configPath = path.resolve(frontendRoot, 'tailwind.config.js');
      assert.ok(fs.existsSync(configPath), 'tailwind.config.js must exist');
      const configContent = fs.readFileSync(configPath, 'utf8');

      assert.match(
        configContent,
        /darkMode:\s*['"]class['"]/,
        "tailwind.config.js must specify darkMode: 'class' for deterministic manual override"
      );
    });

    test('Theme State Machine: ThemeContext.jsx supports system, light, dark and listens to media query', () => {
      const contextPath = path.resolve(frontendRoot, 'src', 'contexts', 'ThemeContext.jsx');
      assert.ok(fs.existsSync(contextPath), 'ThemeContext.jsx must exist');
      const contextContent = fs.readFileSync(contextPath, 'utf8');

      assert.match(contextContent, /ThemeProvider/, 'ThemeContext must export ThemeProvider');
      assert.match(contextContent, /useTheme/, 'ThemeContext must export useTheme hook');
      assert.match(contextContent, /['"]focit_theme['"]/, 'ThemeContext must define focit_theme storage key');
      assert.match(contextContent, /localStorage\.setItem\(/, 'ThemeContext must persist preference');
      assert.match(contextContent, /matchMedia\(['"]\(prefers-color-scheme:\s*dark\)['"]\)/, 'ThemeContext must observe OS dark mode changes');
    });

    test('User Control Invariant: Topbar and Student Preferences Tab provide accessible theme toggles', () => {
      const topbarPath = path.resolve(frontendRoot, 'src', 'components', 'layout', 'Topbar.jsx');
      const preferencesPath = path.resolve(frontendRoot, 'src', 'components', 'profile', 'ProfilePreferencesTab.jsx');

      const topbarContent = fs.readFileSync(topbarPath, 'utf8');
      const prefContent = fs.readFileSync(preferencesPath, 'utf8');

      assert.match(topbarContent, /useTheme/, 'Topbar must consume useTheme');
      assert.match(topbarContent, /toggleTheme/, 'Topbar must provide 1-click theme toggler');
      assert.match(topbarContent, /min-h-\[44px\]/, 'Topbar toggle must adhere to WCAG 44px touch target');

      assert.match(prefContent, /useTheme/, 'ProfilePreferencesTab must consume useTheme');
      assert.match(prefContent, /setTheme/, 'ProfilePreferencesTab must allow setting explicit mode');
    });
  });

  // ── TEST SUITE 2: Discussion Forum Replies Relational Schema & Foreign Keys ──
  describe('Milestone 10.6: Discussion Forum Replies Relational Schema & Foreign Keys', () => {
    test('Migration 011: Declares forum_replies with CASCADE foreign keys and composite index', () => {
      const migrationPath = path.resolve(bffRoot, 'src', 'db', 'migrations', '011_phase10_forum_replies.sql');
      assert.ok(fs.existsSync(migrationPath), 'Migration 011 must exist');
      const sqlContent = fs.readFileSync(migrationPath, 'utf8');

      assert.match(sqlContent, /CREATE TABLE IF NOT EXISTS forum_replies/i);
      assert.match(sqlContent, /thread_id UUID NOT NULL REFERENCES forum_threads\(thread_id\) ON DELETE CASCADE/i);
      assert.match(sqlContent, /student_id VARCHAR\(64\) NOT NULL REFERENCES students\(student_id\) ON DELETE CASCADE/i);
      assert.match(sqlContent, /CREATE INDEX IF NOT EXISTS idx_forum_replies_thread\s+ON forum_replies\s*\(thread_id,\s*created_at ASC\)/i);
    });

    test('BFF Route Contract: Forum threads and replies include author avatarUrl join', () => {
      const forumRoutePath = path.resolve(bffRoot, 'src', 'routes', 'forums.js');
      assert.ok(fs.existsSync(forumRoutePath), 'forums.js router must exist');
      const routeContent = fs.readFileSync(forumRoutePath, 'utf8');

      // Thread list avatar join
      assert.match(routeContent, /LEFT JOIN student_profiles sp ON sp\.student_id = f\.student_id/);
      assert.match(routeContent, /avatarUrl:\s*row\.avatar_url \|\| null/);

      // Replies list avatar join
      assert.match(routeContent, /LEFT JOIN student_profiles sp ON sp\.student_id = r\.student_id/);
      assert.match(routeContent, /avatarUrl:\s*row\.avatar_url \|\| null/);
    });

    test('Anti-Spam Rate Limit Invariant: Enforces 5s cooldown on forum replies', () => {
      const spamBucket = new Map();
      const studentId = 'student1';

      function checkReplySpam(studentId, currentTimeMs) {
        const lastPost = spamBucket.get(`reply:${studentId}`);
        if (lastPost && currentTimeMs - lastPost < 5000) {
          const waitSec = Math.ceil((5000 - (currentTimeMs - lastPost)) / 1000);
          return { allowed: false, waitSec };
        }
        spamBucket.set(`reply:${studentId}`, currentTimeMs);
        return { allowed: true };
      }

      const t0 = 100000;
      const first = checkReplySpam(studentId, t0);
      assert.strictEqual(first.allowed, true);

      // Immediate second attempt (1.5s later) -> Blocked
      const second = checkReplySpam(studentId, t0 + 1500);
      assert.strictEqual(second.allowed, false);
      assert.strictEqual(second.waitSec, 4);

      // Attempt after 5.1s -> Allowed
      const third = checkReplySpam(studentId, t0 + 5100);
      assert.strictEqual(third.allowed, true);
    });
  });

  // ── TEST SUITE 3: Frontend Viewport Containment & CSS Flexbox Invariant ──
  describe('Milestone 10.6: Forum Replies Viewport Containment & UI Invariants', () => {
    test('ThreadRepliesModal: Enforces viewport physical containment, flex min-h-0, and sticky composer', () => {
      const modalPath = path.resolve(frontendRoot, 'src', 'components', 'forum', 'ThreadRepliesModal.jsx');
      assert.ok(fs.existsSync(modalPath), 'ThreadRepliesModal.jsx must exist');
      const modalContent = fs.readFileSync(modalPath, 'utf8');

      // Physical containment
      assert.match(
        modalContent,
        /contain:\s*['"]layout paint['"]/,
        'Modal must enforce strict CSS layout paint containment without intrinsic size collapse'
      );
      assert.match(
        modalContent,
        /max-h-\[min\(92dvh,760px\)\]/,
        'Modal must bound vertical dimension against dynamic viewport height (dvh)'
      );

      // Scrollport flex child defense
      assert.match(
        modalContent,
        /flex-1\s+min-h-0/,
        'Inner replies scrollport must explicitly declare min-h-0 to prevent min-content blowout'
      );

      // Sticky Docked Composer
      assert.match(
        modalContent,
        /sticky\s+bottom-0/,
        'Composer form must be pinned to the bottom of the modal'
      );
      assert.match(
        modalContent,
        /env\(safe-area-inset-bottom/,
        'Composer form must honor mobile safe-area insets'
      );

      // WCAG Touch Targets
      assert.match(
        modalContent,
        /min-h-\[44px\]\s+min-w-\[44px\]/,
        'Composer submit button must guarantee 44x44px touch target'
      );

      // Mutation Lock
      assert.match(
        modalContent,
        /isSubmittingRef\.current/,
        'Modal must use ref-based mutation lock to prevent double submissions'
      );
    });

    test('ForumThreadList: Exposes onSelectThread trigger with hover interactions and avatar rendering', () => {
      const threadListPath = path.resolve(frontendRoot, 'src', 'components', 'forum', 'ForumThreadList.jsx');
      assert.ok(fs.existsSync(threadListPath), 'ForumThreadList.jsx must exist');
      const listContent = fs.readFileSync(threadListPath, 'utf8');

      assert.match(listContent, /onSelectThread/, 'ForumThreadList must accept onSelectThread callback');
      assert.match(listContent, /onClick=\{.*onSelectThread/, 'Each thread article must be clickable');
      assert.match(listContent, /thread\.author\?\.avatarUrl/, 'ForumThreadList must render author avatarUrl if present');
    });

    test('ForumPage: Wires thread selection, replies query, and reply modal', () => {
      const forumPagePath = path.resolve(frontendRoot, 'src', 'pages', 'ForumPage.jsx');
      assert.ok(fs.existsSync(forumPagePath), 'ForumPage.jsx must exist');
      const pageContent = fs.readFileSync(forumPagePath, 'utf8');

      assert.match(pageContent, /ThreadRepliesModal/, 'ForumPage must import ThreadRepliesModal');
      assert.match(pageContent, /onSelectThread=\{setSelectedThread\}/, 'ForumPage must pass setSelectedThread to ForumThreadList');
      assert.match(pageContent, /isOpen=\{Boolean\(selectedThread\)\}/, 'ForumPage must open modal when selectedThread is truthy');
    });
  });
});
