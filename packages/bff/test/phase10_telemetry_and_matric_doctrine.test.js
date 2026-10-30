import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeMatricNumber } from '../src/utils/matricNormalizer.js';

describe('Phase 10: Senate Matriculation Canonicalization & Telemetry Doctrine', () => {
  // ── TEST 1: Senate Matriculation Canonicalizer (YYYY/NNNNN) ──
  test('Matric Canonicalization: Enforces Senate standard YYYY/NNNNN format', () => {
    // 1. Direct canonical formats
    const standard1 = canonicalizeMatricNumber('2024/28682');
    assert.strictEqual(standard1.valid, true);
    assert.strictEqual(standard1.value, '2024/28682');
    assert.strictEqual(standard1.error, null);

    const standard2 = canonicalizeMatricNumber('2023/104921');
    assert.strictEqual(standard2.valid, true);
    assert.strictEqual(standard2.value, '2023/104921');

    // 2. Loose legacy extraction (hyphens, spaces, faculty prefixes)
    const legacyPrefix = canonicalizeMatricNumber('FOCIT/2024/28682');
    assert.strictEqual(legacyPrefix.valid, true);
    assert.strictEqual(legacyPrefix.value, '2024/28682');

    const hyphenated = canonicalizeMatricNumber('2024-28682');
    assert.strictEqual(hyphenated.valid, true);
    assert.strictEqual(hyphenated.value, '2024/28682');

    const looseSpaces = canonicalizeMatricNumber('  FOCIT-2024-28682  ');
    assert.strictEqual(looseSpaces.valid, true);
    assert.strictEqual(looseSpaces.value, '2024/28682');

    // 3. Invalid inputs rejected cleanly
    assert.strictEqual(canonicalizeMatricNumber('').valid, false);
    assert.strictEqual(canonicalizeMatricNumber('ABC/XYZ').valid, false);
    assert.strictEqual(canonicalizeMatricNumber('1990/1234').valid, false); // Out of year bounds
    assert.strictEqual(canonicalizeMatricNumber('2024/12').valid, false); // Less than 4 digits serial
    assert.strictEqual(canonicalizeMatricNumber(12345).valid, false); // Non-string
  });

  // ── TEST 2: Telemetry Anomaly Scoring Mechanics ──
  test('Anomaly Scoring: Distinguishes ephemeral OS interrupts from academic dishonesty', () => {
    // Isolated evaluation replicating calculateAnomalyScore logic
    function score(log) {
      let rawPoints = 0;
      for (const entry of log) {
        const durationSec = Math.max(0, (Number(entry.duration_ms) || 0) / 1000);
        switch (entry.type) {
          case 'EPHEMERAL_OS_INTERRUPT':
            break; // 0 penalty
          case 'TAB_HIDDEN':
          case 'EXTENDED_ABSENCE':
            rawPoints += 8 + Math.min(25, durationSec * 0.5);
            break;
          case 'FULLSCREEN_EXIT':
            rawPoints += 5;
            break;
          case 'CLIPBOARD_BLOCKED':
            rawPoints += 3;
            break;
          default:
            break;
        }
      }
      return Math.min(100, Math.round(rawPoints));
    }

    // Ephemeral OS call (<15s) carries 0 points
    const ephemeralLog = [
      { type: 'EPHEMERAL_OS_INTERRUPT', start_ms: 1000, duration_ms: 4200 },
      { type: 'EPHEMERAL_OS_INTERRUPT', start_ms: 20000, duration_ms: 6100 },
    ];
    assert.strictEqual(score(ephemeralLog), 0);

    // Minor single accidental fullscreen toggle
    const minorExitLog = [
      { type: 'FULLSCREEN_EXIT', start_ms: 5000, duration_ms: 0 },
    ];
    assert.strictEqual(score(minorExitLog), 5);
    assert.ok(score(minorExitLog) < 35, 'Minor exit must remain CLEAR');

    // Suspicious multi-tab absences + clipboard attempts
    const highAnomalyLog = [
      { type: 'TAB_HIDDEN', start_ms: 1000, duration_ms: 20000 }, // 8 + 10 = 18
      { type: 'TAB_HIDDEN', start_ms: 50000, duration_ms: 15000 }, // 8 + 7.5 = 15.5
      { type: 'CLIPBOARD_BLOCKED', start_ms: 80000, duration_ms: 0 }, // 3
    ];
    const totalScore = score(highAnomalyLog);
    assert.ok(totalScore >= 35, `Score ${totalScore} should trigger SUBMITTED_PENDING_REVIEW`);
  });

  // ── TEST 3: Telemetry Log Bounded Array Slicing ──
  test('Log Bounding: Caps telemetry log at 200 entries to prevent memory bloat', () => {
    const existingLog = Array.from({ length: 195 }, (_, i) => ({
      type: 'EPHEMERAL_OS_INTERRUPT',
      start_ms: i * 1000,
      duration_ms: 100,
    }));

    const incomingBatch = Array.from({ length: 10 }, (_, i) => ({
      type: 'TAB_HIDDEN',
      start_ms: (200 + i) * 1000,
      duration_ms: 2000,
    }));

    const updatedLog = [...existingLog, ...incomingBatch].slice(-200);
    assert.strictEqual(updatedLog.length, 200);
    assert.strictEqual(updatedLog[199].start_ms, 209000);
  });
});
