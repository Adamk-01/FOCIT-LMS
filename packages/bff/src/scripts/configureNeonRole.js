import { directPool } from '../db/index.js';

async function configureRole() {
  try {
    console.log('[Neon Role Config] Setting statement_timeout = 8000ms on focit_db_owner...');
    await directPool.query("ALTER ROLE focit_db_owner SET statement_timeout = '8000ms';");
    const check = await directPool.query("SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'focit_db_owner'");
    console.log('[Neon Role Config] Role configuration updated:', check.rows[0]);
  } catch (err) {
    console.error('[Neon Role Config] Failed:', err);
  } finally {
    await directPool.end();
  }
}

configureRole();
