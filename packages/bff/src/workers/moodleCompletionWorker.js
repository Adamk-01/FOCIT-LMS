import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import moodlePool from '../lib/moodlePool.js';
import config from '../config.js';
import pool from '../db/index.js';

// 1. Exact Redis connection initialization for BullMQ
// maxRetriesPerRequest MUST be null for BullMQ blocking commands to function correctly
const redisConnection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
});

// The queue definition
export const completionQueue = new Queue('moodle-completion', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 10,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: true, // Keep Redis RAM clean
  },
});

// ============================================================================
// 1. JOB-PER-EVENT WORKER (The Synchronous Push)
// ============================================================================
export const completionWorker = new Worker(
  'moodle-completion',
  async (job) => {
    const { outboxId } = job.data;

    if (!outboxId) {
      throw new Error('Architectural Violation: Job payload missing outboxId');
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Precise Row-Level Locking
      const { rows } = await client.query(`
        SELECT * 
        FROM moodle_outbox 
        WHERE id = $1 AND status = 'PENDING' 
        FOR UPDATE SKIP LOCKED
      `, [outboxId]);

      if (rows.length === 0) {
        // Already processed or locked by another duplicate worker. Safely exit.
        await client.query('COMMIT');
        return;
      }

      const msg = rows[0];

      // Outbound Synchronization
      try {
        const query = new URLSearchParams({
          wstoken: config.moodle.wsToken,
          wsfunction: 'core_completion_override_activity_completion_status',
          moodlewsrestformat: 'json',
          cmid: msg.moodle_module_id || msg.moodle_course_module_id || job.data.moodleModuleId,
          newstate: msg.completion_state !== undefined ? msg.completion_state : 1
        });

        // Add userid if present in the outbox table or job data
        const userid = msg.moodle_user_id || msg.user_id || job.data.moodleUserId;
        if (userid) {
          query.append('userid', userid);
        }

        const { statusCode, body } = await moodlePool.request({
          path: `/webservice/rest/server.php`,
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: query.toString()
        });

        if (statusCode !== 200) {
          throw new Error(`Moodle returned HTTP ${statusCode}`);
        }

        const rawBody = await body.text();
        let data;
        try {
          data = JSON.parse(rawBody);
        } catch (err) {
          throw new Error(`Invalid JSON from Moodle: ${rawBody}`);
        }

        // Idempotency Trap
        if (data && data.exception) {
          if (
            data.errorcode === 'alreadycompleted' ||
            data.message.toLowerCase().includes('already marked')
          ) {
            console.warn(`[Idempotency] Outbox row ${outboxId} already completed in Moodle.`);
          } else {
            throw new Error(`Moodle API Exception: [${data.errorcode}] ${data.message}`);
          }
        }
      } catch (error) {
        // Genuine upstream failure. Bubble to BullMQ.
        // Update retry count for observability (if column exists)
        await client.query(
          `UPDATE moodle_outbox SET updated_at = NOW() WHERE id = $1`,
          [outboxId]
        ).catch(() => { });

        throw error;
      }

      // Mark FOCIT database row as PROCESSED
      // Legacy code used COMPLETED, updating to PROCESSED based on finalized architecture
      await client.query(`
        UPDATE moodle_outbox 
        SET status = 'PROCESSED', updated_at = NOW() 
        WHERE id = $1
      `, [outboxId]);

      await client.query('COMMIT');

    } catch (error) {
      await client.query('ROLLBACK');
      throw error; // Hand control back to BullMQ for precise retry orchestration
    } finally {
      client.release();
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // Strict concurrency cap to protect Event Loop
  }
);

// Worker lifecycle events for telemetry
completionWorker.on('completed', (job) => {
  console.log(`[Job ${job.id}] Outbox record ${job.data.outboxId} successfully processed.`);
});

completionWorker.on('failed', (job, err) => {
  console.error(`[Job ${job.id}] Failed processing Outbox record ${job.data.outboxId}: ${err.message}`);
});

completionWorker.on('stalled', (jobId) => {
  console.error(`[CRITICAL] Job ${jobId} stalled. Possible container OOM or Event Loop starvation.`);
});

// ============================================================================
// 2. MESSAGE RELAY SWEEPER (Crash Recovery / Eventual Consistency)
// ============================================================================
const SWEEPER_INTERVAL_MS = 60 * 1000; // Run every 1 minute

async function runRelaySweeper() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // The Grace Period: Ignore newly inserted rows
    const { rows } = await client.query(`
      SELECT id 
      FROM moodle_outbox 
      WHERE status = 'PENDING' 
        AND created_at < NOW() - INTERVAL '5 minutes'
      LIMIT 500
      FOR UPDATE SKIP LOCKED
    `);

    for (const row of rows) {
      // Deterministic Deduplication: jobId prevents enqueuing if already in queue
      await completionQueue.add(
        'moodle-completion',
        { outboxId: row.id },
        { jobId: `outbox_sync_${row.id}` }
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Sweeper Error] Failed to execute message relay:', err);
  } finally {
    client.release();
  }
}

// Start the sweeper
setInterval(runRelaySweeper, SWEEPER_INTERVAL_MS);

// ============================================================================
// 3. TELEMETRY & ALERTING HOOKS
// ============================================================================

// Monitor Undici pool stats
setInterval(() => {
  const stats = moodlePool.stats;
  if (stats && stats.queued > 0) {
    console.warn(`[CRITICAL ALERT] Undici queue depth at ${stats.queued}. Upstream Moodle connection starving.`);
  }
}, 5000);
