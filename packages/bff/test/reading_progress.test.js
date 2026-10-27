import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { pool } from '../src/db/index.js';

test('CROSS-DEVICE READING PROGRESS: ACID Ledger & GREATEST Invariant', async () => {
  const studentId = `test_student_${Date.now()}`;
  
  // 1. Fetch an existing library item ID from the database or create a dummy item
  const { rows: itemRows } = await pool.query('SELECT id FROM library_items LIMIT 1');
  assert.ok(itemRows.length > 0, 'Database must contain at least one library item');
  const itemId = itemRows[0].id;

  // 2. Query initial reading progress (should be empty for new student)
  const { rows: initialRows } = await pool.query(`
    SELECT last_page, max_page_reached, total_pages, percentage
    FROM library_reading_progress
    WHERE student_id = $1 AND item_id = $2;
  `, [studentId, itemId]);

  assert.strictEqual(initialRows.length, 0, 'New student must have no previous reading record');

  // 3. Student reads to Page 142 out of 800 (18% read) on Laptop
  const page1 = 142;
  const totalPages = 800;

  await pool.query(`
    INSERT INTO library_reading_progress (
      student_id, item_id, last_page, max_page_reached, total_pages, percentage, updated_at
    )
    VALUES (
      $1, $2, $3::integer, $3::integer, $4::integer, 
      CASE WHEN $4::integer IS NOT NULL AND $4::integer > 0 THEN LEAST(100, ROUND(($3::numeric / $4::numeric) * 100)::int) ELSE 0 END, 
      NOW()
    )
    ON CONFLICT (student_id, item_id) DO UPDATE SET
      last_page = EXCLUDED.last_page,
      max_page_reached = GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page),
      total_pages = COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages),
      percentage = CASE 
        WHEN COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages) IS NOT NULL 
             AND COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages) > 0 
        THEN LEAST(100, ROUND(
          (GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page)::numeric 
           / COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages)::numeric) * 100
        )::int)
        ELSE library_reading_progress.percentage
      END,
      updated_at = NOW();
  `, [studentId, itemId, page1, totalPages]);

  // 4. Student logs out. 7 hours later, student logs in on Phone and queries progress
  const { rows: phoneRows } = await pool.query(`
    SELECT last_page, max_page_reached, total_pages, percentage
    FROM library_reading_progress
    WHERE student_id = $1 AND item_id = $2;
  `, [studentId, itemId]);

  assert.strictEqual(phoneRows.length, 1);
  assert.strictEqual(phoneRows[0].last_page, 142, 'Cross-device resumption: phone must resume at page 142');
  assert.strictEqual(phoneRows[0].max_page_reached, 142);
  assert.strictEqual(phoneRows[0].percentage, 18);

  // 5. On Phone, student flips backward to Page 50 to review an earlier theorem
  const page2 = 50;

  await pool.query(`
    INSERT INTO library_reading_progress (
      student_id, item_id, last_page, max_page_reached, total_pages, percentage, updated_at
    )
    VALUES (
      $1, $2, $3::integer, $3::integer, $4::integer, 
      CASE WHEN $4::integer IS NOT NULL AND $4::integer > 0 THEN LEAST(100, ROUND(($3::numeric / $4::numeric) * 100)::int) ELSE 0 END, 
      NOW()
    )
    ON CONFLICT (student_id, item_id) DO UPDATE SET
      last_page = EXCLUDED.last_page,
      max_page_reached = GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page),
      total_pages = COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages),
      percentage = CASE 
        WHEN COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages) IS NOT NULL 
             AND COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages) > 0 
        THEN LEAST(100, ROUND(
          (GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page)::numeric 
           / COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages)::numeric) * 100
        )::int)
        ELSE library_reading_progress.percentage
      END,
      updated_at = NOW();
  `, [studentId, itemId, page2, totalPages]);

  // 6. Verify GREATEST Invariant: last_page is 50, but max_page_reached remains 142, AND percentage stays 18%!
  const { rows: reviewedRows } = await pool.query(`
    SELECT last_page, max_page_reached, percentage
    FROM library_reading_progress
    WHERE student_id = $1 AND item_id = $2;
  `, [studentId, itemId]);

  assert.strictEqual(reviewedRows[0].last_page, 50, 'Current position updated to page 50');
  assert.strictEqual(reviewedRows[0].max_page_reached, 142, 'GREATEST invariant preserves highest page completed');
  assert.strictEqual(reviewedRows[0].percentage, 18, 'Monotonic percentage invariant: flipping backward does NOT regress percentage');

  // 7. Verify Invariant 6 (Composite Aggregator): single-query composite ticket lookup
  const { rows: compositeRows } = await pool.query(`
    SELECT 
      li.id, 
      li.title,
      rp.last_page,
      rp.max_page_reached,
      rp.percentage
    FROM library_items li
    LEFT JOIN library_reading_progress rp 
      ON rp.item_id = li.id AND rp.student_id = $2
    WHERE li.id = $1
    LIMIT 1;
  `, [itemId, studentId]);

  assert.strictEqual(compositeRows.length, 1);
  assert.strictEqual(compositeRows[0].last_page, 50);
  assert.strictEqual(compositeRows[0].max_page_reached, 142);
  assert.strictEqual(compositeRows[0].percentage, 18);

  // 8. Verify HOT Optimization: Check table fillfactor is 85 and no secondary index contains updated_at
  const { rows: tableOpts } = await pool.query(`
    SELECT reloptions 
    FROM pg_class 
    WHERE relname = 'library_reading_progress';
  `);
  assert.ok(tableOpts.length > 0);
  const options = tableOpts[0].reloptions || [];
  assert.ok(options.includes('fillfactor=85'), 'Table must be configured with fillfactor=85 for HOT updates');

  const { rows: indexCols } = await pool.query(`
    SELECT i.relname AS index_name, a.attname AS column_name
    FROM pg_class t
    JOIN pg_index ix ON t.oid = ix.indrelid
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE t.relname = 'library_reading_progress' AND a.attname = 'updated_at';
  `);
  assert.strictEqual(indexCols.length, 0, 'Zero indexes must reference updated_at for 100% HOT compliance');

  // 9. Verify Upper-Bound Clamping & chk_reading_progress_bounds Constraint Enforcement (Grill Checkpoint #7)
  const poisonStudentId = `poison_${Date.now()}`;
  const poisonedPage = 9999;
  const boundedTotal = 120;

  // 9a. Application/SQL clamping: page 9999 against totalPages 120 clamps last_page to 120
  await pool.query(`
    INSERT INTO library_reading_progress (
      student_id, item_id, last_page, max_page_reached, total_pages, percentage, updated_at
    )
    VALUES (
      $1, $2, 
      LEAST($3::integer, COALESCE(NULLIF($4::integer, 0), $3::integer)), 
      LEAST($3::integer, COALESCE(NULLIF($4::integer, 0), $3::integer)), 
      $4::integer, 
      CASE WHEN $4::integer IS NOT NULL AND $4::integer > 0 THEN LEAST(100, ROUND(($3::numeric / $4::numeric) * 100)::int) ELSE 0 END, 
      NOW()
    )
    ON CONFLICT (student_id, item_id) DO UPDATE SET
      last_page = LEAST(EXCLUDED.last_page, COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages, EXCLUDED.last_page)),
      max_page_reached = LEAST(
        GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page),
        COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages, GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page))
      ),
      total_pages = COALESCE(EXCLUDED.total_pages, library_reading_progress.total_pages),
      percentage = 100,
      updated_at = NOW();
  `, [poisonStudentId, itemId, poisonedPage, boundedTotal]);

  const { rows: clampedRows } = await pool.query(`
    SELECT last_page, max_page_reached, total_pages, percentage
    FROM library_reading_progress
    WHERE student_id = $1 AND item_id = $2;
  `, [poisonStudentId, itemId]);

  assert.strictEqual(clampedRows[0].last_page, 120, 'last_page must be strictly clamped to total_pages (120), never 9999');
  assert.strictEqual(clampedRows[0].max_page_reached, 120, 'max_page_reached must be strictly clamped to total_pages (120)');

  // 9b. Database CHECK Constraint Defense: Bypassing clamp throws SQLSTATE 23514
  await assert.rejects(
    async () => {
      await pool.query(`
        INSERT INTO library_reading_progress (
          student_id, item_id, last_page, max_page_reached, total_pages, percentage, updated_at
        )
        VALUES ($1, $2, 5000, 5000, 100, 100, NOW());
      `, [`raw_bypass_${Date.now()}`, itemId]);
    },
    (err) => {
      assert.strictEqual(err.code, '23514', 'PostgreSQL must reject un-clamped inserts via chk_reading_progress_bounds');
      return true;
    }
  );

  // 10. Empirical PostgreSQL 16 HOT Update Verification via pg_stat_user_tables
  await pool.query('SELECT pg_stat_force_next_flush();');
  const { rows: [baseStat] } = await pool.query(`
    SELECT COALESCE(n_tup_hot_upd, 0)::int AS hot_upd, COALESCE(n_tup_upd, 0)::int AS total_upd
    FROM pg_stat_user_tables
    WHERE relname = 'library_reading_progress';
  `);
  const initialHot = baseStat.hot_upd;

  // Execute 5 rapid sequential page progress updates on the test record
  for (let p = 10; p <= 15; p++) {
    await pool.query(`
      INSERT INTO library_reading_progress (
        student_id, item_id, last_page, max_page_reached, total_pages, percentage, updated_at
      )
      VALUES ($1, $2, $3::integer, $3::integer, 800, 2, NOW())
      ON CONFLICT (student_id, item_id) DO UPDATE SET
        last_page = EXCLUDED.last_page,
        max_page_reached = GREATEST(library_reading_progress.max_page_reached, EXCLUDED.last_page),
        updated_at = NOW();
    `, [studentId, itemId, p]);
  }

  // Force PostgreSQL 16 shared memory stats flush to disk
  await pool.query('SELECT pg_stat_force_next_flush();');
  const { rows: [afterStat] } = await pool.query(`
    SELECT COALESCE(n_tup_hot_upd, 0)::int AS hot_upd, COALESCE(n_tup_upd, 0)::int AS total_upd
    FROM pg_stat_user_tables
    WHERE relname = 'library_reading_progress';
  `);
  const finalHot = afterStat.hot_upd;

  assert.ok(
    finalHot > initialHot,
    `Empirical PostgreSQL HOT verification failed: initialHot=${initialHot}, finalHot=${finalHot}. n_tup_hot_upd must increase on in-place heap updates!`
  );

  // Cleanup test entries
  await pool.query('DELETE FROM library_reading_progress WHERE student_id IN ($1, $2)', [studentId, poisonStudentId]);
});
