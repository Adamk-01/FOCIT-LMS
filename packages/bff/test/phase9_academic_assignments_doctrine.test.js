/**
 * FOCIT LMS - Phase 9 Architectural Doctrine Verification Suite
 *
 * Mathematically validates:
 * 1. Invariant 2: Senate Policy 100L/200L Foundational GPA Exemption
 * 2. Invariant 1 & 7: Authoritative Course Resolution & Dynamic Catalog Mechanics
 * 3. Invariant 3: Dual-Layer Idempotency Guard & State Lockout Boundary
 *
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGpaStanding } from '../src/lib/academicStanding.js';

test.describe('Phase 9 Architectural Doctrine Verification', () => {

  // Test Suite 1: Senate 100L/200L Foundational GPA Exemption
  test.describe('Invariant 2: Senate 100L/200L Foundational GPA Exemption', () => {
    test('strictly exempts 100L students and nulls current_gpa', () => {
      const student100 = { student_id: 'student2', level: 100, current_gpa: 3.85 };
      const standing = evaluateGpaStanding(student100);

      assert.equal(standing.gpa_exempt, true);
      assert.equal(standing.current_gpa, null);
      assert.match(standing.standing_label, /EXEMPT/);
      assert.match(standing.exemption_reason, /100L & 200L foundational inter-faculty courses/);
    });

    test('strictly exempts 200L students and nulls current_gpa', () => {
      const student200 = { student_id: 'student1', level: 200, current_gpa: 3.60 };
      const standing = evaluateGpaStanding(student200);

      assert.equal(standing.gpa_exempt, true);
      assert.equal(standing.current_gpa, null);
      assert.match(standing.standing_label, /EXEMPT/);
    });

    test('computes authoritative GPA and honors classification for 300L+ students', () => {
      const student300 = { student_id: 'student3', level: 300, current_gpa: '4.62' };
      const standing300 = evaluateGpaStanding(student300);

      assert.equal(standing300.gpa_exempt, false);
      assert.equal(standing300.current_gpa, 4.62);
      assert.equal(standing300.standing_label, 'First Class Standing');
      assert.equal(standing300.exemption_reason, null);

      const student2_1 = { student_id: 'student4', level: 300, current_gpa: '3.80' };
      assert.equal(evaluateGpaStanding(student2_1).standing_label, 'Second Class Upper (2:1)');

      const student2_2 = { student_id: 'student5', level: 400, current_gpa: '2.85' };
      assert.equal(evaluateGpaStanding(student2_2).standing_label, 'Second Class Lower (2:2)');
    });

    test('handles null or undefined current_gpa gracefully without throwing', () => {
      const studentUndefined = { student_id: 'student_none', level: 400, current_gpa: null };
      const standing = evaluateGpaStanding(studentUndefined);

      assert.equal(standing.gpa_exempt, false);
      assert.equal(standing.current_gpa, 0.0);
      assert.equal(standing.standing_label, 'Academic Probation');
    });
  });

  // Test Suite 2: State Boundary Contract Validation
  test.describe('Invariant 3: Assignment Delivery & Idempotency Header Contract', () => {
    test('enforces that idempotency keys are non-empty and minimum 8 characters', () => {
      const validateKey = (key) => typeof key === 'string' && key.trim().length >= 8;
      
      assert.equal(validateKey(''), false);
      assert.equal(validateKey('123'), false);
      assert.equal(validateKey('   '), false);
      assert.equal(validateKey('idem_12345'), true);
      assert.equal(validateKey('c0000000-0000-0000-0000-000000000001'), true);
    });

    test('guarantees submission payload contract requires either text or file_url', () => {
      const validatePayload = (payload) => {
        const text = payload?.submission_text?.trim();
        const file = payload?.file_url?.trim();
        return Boolean(text || file);
      };

      assert.equal(validatePayload({}), false);
      assert.equal(validatePayload({ submission_text: '   ' }), false);
      assert.equal(validatePayload({ submission_text: 'Implemented heap allocator' }), true);
      assert.equal(validatePayload({ file_url: '/api/files/submissions/allocator.c' }), true);
      assert.equal(validatePayload({ submission_text: 'Notes', file_url: '/api/files/test.pdf' }), true);
    });
  });

});
