import pool from '../src/db/index.js';
import fs from 'fs';
import path from 'path';

async function main() {
  try {
    const res = await pool.query("SELECT id, title, course_id, file_size_bytes FROM library_items WHERE id = 'c0000000-0000-0000-0000-000000000004' OR title ILIKE '%CSC 401%'");
    console.log('Results:', res.rows);
    for (const r of res.rows) {
      const p = path.resolve('.cache/library', `${r.id}.pdf`);
      console.log(r.id, r.title, 'File on disk:', p, fs.existsSync(p));
    }
    console.log('DB items found:', res.rows.length);
    for (const row of res.rows) {
      console.log('Row:', row);
      const pathsToCheck = [
        path.resolve('.cache/library', `${row.id}.pdf`),
        path.resolve('src/../.cache/library', `${row.id}.pdf`),
        path.resolve(row.file_path || ''),
      ];
      for (const p of pathsToCheck) {
        console.log(`Path: ${p} -> exists: ${fs.existsSync(p)}`);
        if (fs.existsSync(p)) {
          console.log(`Size on disk: ${fs.statSync(p).size} bytes`);
        }
      }
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await pool.end();
  }
}

main();
