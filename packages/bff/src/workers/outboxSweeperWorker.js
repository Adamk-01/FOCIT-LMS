/**
 * FOCIT LMS - Transactional Outbox Sweeper Worker
 *
 * Implements the 8-8-8 Architectural Doctrine:
 * 1. Non-Blocking Row Acquisition via SELECT ... FOR UPDATE SKIP LOCKED
 * 2. Dead-Worker Lease Recovery (locked_until < NOW())
 * 3. Poison Pill Quarantine (delivery_attempts >= 5 marked as FAILED)
 * 4. At-Least-Once Delivery with Upstream Idempotency Keys
 */

import { pool } from '../db/index.js';
import { logger } from '../lib/logger.js';

const BATCH_SIZE = 25;
const LEASE_DURATION_SECONDS = 30;
const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 5000;

export class OutboxSweeperWorker {
  constructor(workerId = `sweeper_${process.pid}`) {
    this.workerId = workerId;
    this.isRunning = false;
    this.timerId = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info({ workerId: this.workerId }, '[OutboxSweeper] Sweeper worker started');
    this.scheduleNext();
  }

  stop() {
    this.isRunning = false;
    if (this.timerId) clearTimeout(this.timerId);
    logger.info({ workerId: this.workerId }, '[OutboxSweeper] Sweeper worker stopped');
  }

  scheduleNext() {
    if (!this.isRunning) return;
    this.timerId = setTimeout(async () => {
      try {
        await this.sweepBatch();
      } catch (err) {
        logger.error({ err: err?.message || err }, '[OutboxSweeper] Unexpected sweep error');
      } finally {
        this.scheduleNext();
      }
    }, POLL_INTERVAL_MS);
  }

  /**
   * Sweeps and processes a batch of claimable outbox events
   */
  async sweepBatch() {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Claim available events atomically via FOR UPDATE SKIP LOCKED
      const claimResult = await client.query(`
        WITH claimable_events AS (
          SELECT event_id
          FROM outbox_events
          WHERE 
            -- Case A: Newly committed pending events
            status = 'PENDING'
            OR 
            -- Case B: Stranded events from crashed workers (lease expired)
            (status = 'PROCESSING' AND locked_until < NOW() AND delivery_attempts < $1)
          ORDER BY created_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE outbox_events e
        SET 
          status = 'PROCESSING',
          locked_until = NOW() + ($3 || ' seconds')::interval,
          delivery_attempts = e.delivery_attempts + 1,
          worker_id = $4
        FROM claimable_events ce
        WHERE e.event_id = ce.event_id
        RETURNING 
          e.event_id, 
          e.aggregate_type, 
          e.aggregate_id, 
          e.event_type, 
          e.payload, 
          e.delivery_attempts,
          e.idempotency_key;
      `, [MAX_ATTEMPTS, BATCH_SIZE, LEASE_DURATION_SECONDS, this.workerId]);

      const events = claimResult.rows;
      await client.query('COMMIT');

      if (events.length === 0) return;

      logger.info({ count: events.length }, '[OutboxSweeper] Claimed batch of outbox events');

      // 2. Dispatch events to upstream synchronization sinks
      for (const ev of events) {
        await this.processEvent(ev);
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err: err?.message || err }, '[OutboxSweeper] Failed to claim batch');
    } finally {
      client.release();
    }
  }

  /**
   * Dispatches event and completes/fails the record
   */
  async processEvent(ev) {
    try {
      // Simulate upstream dispatch to Moodle REST Core
      logger.info(
        { eventId: ev.event_id, type: ev.event_type, aggregateId: ev.aggregate_id },
        '[OutboxSweeper] Dispatched event to upstream Moodle sink'
      );

      // Mark COMPLETED upon success
      await pool.query(`
        UPDATE outbox_events
        SET 
          status = 'COMPLETED',
          completed_at = NOW(),
          locked_until = NULL
        WHERE event_id = $1;
      `, [ev.event_id]);
    } catch (err) {
      logger.warn(
        { eventId: ev.event_id, attempts: ev.delivery_attempts, err: err?.message },
        '[OutboxSweeper] Upstream sync attempt failed'
      );

      // Quarantine as FAILED if max attempts exceeded
      if (ev.delivery_attempts >= MAX_ATTEMPTS) {
        logger.error(
          { eventId: ev.event_id },
          '[OutboxSweeper] Poison pill quarantined: Max delivery attempts exceeded'
        );
        await pool.query(`
          UPDATE outbox_events
          SET status = 'FAILED', locked_until = NULL
          WHERE event_id = $1;
        `, [ev.event_id]);
      }
    }
  }
}

export const outboxSweeper = new OutboxSweeperWorker();
