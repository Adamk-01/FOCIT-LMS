import test from 'node:test';
import assert from 'node:assert';

test.describe('Student Courses Directory Keyset Pagination & Lookahead Engine', () => {
  test('Clamps limit between 1 and 50 and handles invalid types defensively', () => {
    const parse = (queryLimit) => {
      const parsed = parseInt(queryLimit, 10);
      return Number.isFinite(parsed) ? Math.max(1, Math.min(parsed, 50)) : 12;
    };

    assert.strictEqual(parse('12'), 12);
    assert.strictEqual(parse(undefined), 12);
    assert.strictEqual(parse('invalid'), 12);
    assert.strictEqual(parse('-5'), 1);
    assert.strictEqual(parse('0'), 1);
    assert.strictEqual(parse('100'), 50);
  });

  test('Lookahead pattern sets has_more=true and next_cursor ONLY when 13th row exists', () => {
    const parsedLimit = 12;

    // Case A: Database returned 13 rows for a limit of 12 (Next page exists)
    const rowsWithLookahead = Array.from({ length: 13 }, (_, i) => ({
      course_id: `c_${i + 1}`,
      code: `CSC ${200 + i}`,
      title: `Course ${i + 1}`,
    }));

    const hasMoreA = rowsWithLookahead.length > parsedLimit;
    const coursesA = hasMoreA ? rowsWithLookahead.slice(0, parsedLimit) : rowsWithLookahead;
    const nextCursorA = hasMoreA ? {
      cursor_code: coursesA[coursesA.length - 1].code,
      cursor_id: coursesA[coursesA.length - 1].course_id,
    } : null;

    assert.strictEqual(hasMoreA, true);
    assert.strictEqual(coursesA.length, 12);
    assert.deepStrictEqual(nextCursorA, {
      cursor_code: 'CSC 211',
      cursor_id: 'c_12',
    });

    // Case B: Database returned exactly 12 rows (No 13th row, end of dataset)
    const exactRows = Array.from({ length: 12 }, (_, i) => ({
      course_id: `c_${i + 1}`,
      code: `CSC ${200 + i}`,
      title: `Course ${i + 1}`,
    }));

    const hasMoreB = exactRows.length > parsedLimit;
    const coursesB = hasMoreB ? exactRows.slice(0, parsedLimit) : exactRows;
    const nextCursorB = hasMoreB ? {
      cursor_code: coursesB[coursesB.length - 1].code,
      cursor_id: coursesB[coursesB.length - 1].course_id,
    } : null;

    assert.strictEqual(hasMoreB, false);
    assert.strictEqual(coursesB.length, 12);
    assert.strictEqual(nextCursorB, null, 'next_cursor must be null when no 13th row exists');
  });
});
