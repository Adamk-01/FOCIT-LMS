/**
 * FOCIT LMS - PostgreSQL Native LISTEN / NOTIFY Notification Broadcaster
 * Standard: The 8-8-8 Architectural Doctrine (focit-architect)
 *
 * Implements Option B:
 * - A single dedicated PostgreSQL client holding LISTEN 'focit_notifications'.
 * - Cross-container notification fanout with ZERO extra infrastructure.
 * - Non-blocking event dispatch to local SSE streams in activeStudentSockets.
 * - Resilient auto-reconnection with exponential backoff and jitter.
 */

import pg from 'pg';
import { activeStudentSockets } from '../routes/notifications.js';
import { logger } from '../lib/logger.js';
import { pool } from '../db/index.js';

const { Client } = pg;
const CHANNEL_NAME = 'focit_notifications';

class NotificationBroadcaster {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isStopping = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
  }

  async start() {
    if (this.isConnected || this.isStopping) return;

    const connectionString =
      process.env.DATABASE_URL ||
      'postgresql://focit_user:focit_password@127.0.0.1:5432/focit_db';

    try {
      this.client = new Client({
        connectionString,
        connectionTimeoutMillis: 10000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10000,
      });

      this.client.on('error', (err) => {
        logger.warn({ err: err?.message || err }, '[PostgresListen] Dedicated listener socket error');
        this.scheduleReconnect();
      });

      this.client.on('end', () => {
        if (!this.isStopping) {
          logger.warn('[PostgresListen] Dedicated listener socket closed unexpectedly');
          this.scheduleReconnect();
        }
      });

      this.client.on('notification', (msg) => {
        if (msg.channel === CHANNEL_NAME) {
          this.handleNotification(msg.payload);
        }
      });

      await this.client.connect();
      await this.client.query(`LISTEN ${CHANNEL_NAME}`);
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info({ channel: CHANNEL_NAME }, '[PostgresListen] Subscribed to PostgreSQL notification bus');
    } catch (err) {
      logger.warn({ err: err?.message || err }, '[PostgresListen] Failed to establish LISTEN connection');
      this.scheduleReconnect();
    }
  }

  handleNotification(rawPayload) {
    try {
      const payload = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload;
      if (!payload || !payload.student_id) return;

      const targetSockets = activeStudentSockets.get(payload.student_id);
      if (targetSockets && targetSockets.size > 0) {
        const sseChunk = `id: ${payload.sequence_id || Date.now()}\ndata: ${JSON.stringify(payload)}\n\n`;
        for (const res of targetSockets) {
          try {
            res.write(sseChunk);
          } catch (writeErr) {
            logger.warn({ err: writeErr?.message, studentId: payload.student_id }, '[SSE] Socket delivery error');
          }
        }
      }
    } catch (parseErr) {
      logger.error({ parseErr: parseErr?.message }, '[PostgresListen] Malformed notification payload received');
    }
  }

  scheduleReconnect() {
    if (this.isStopping || this.reconnectTimer) return;
    this.isConnected = false;

    if (this.client) {
      const oldClient = this.client;
      this.client = null;
      try {
        oldClient.removeAllListeners();
        // Prevent unhandled error event if socket resets during TLS teardown
        oldClient.on('error', () => {});
        oldClient.end().catch(() => {});
      } catch {
        // ignore cleanup error
      }
    }

    this.reconnectAttempts++;
    const delayMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts) + Math.random() * 500, 15000);
    logger.info({ attempt: this.reconnectAttempts, delayMs }, '[PostgresListen] Scheduling reconnect to notification bus');

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      await this.start();
    }, delayMs);
  }

  /**
   * Emits a notification payload to the distributed PostgreSQL notification bus.
   * Can be invoked from any container instance or worker.
   */
  async broadcast(payload) {
    // Decouple pg_notify from caller transaction to prevent transaction abort/poisoning
    const jsonStr = JSON.stringify(payload);
    if (Buffer.byteLength(jsonStr, 'utf8') >= 7900) {
      logger.warn('[PostgresListen] Payload exceeds pg_notify payload threshold; skipped broadcast');
      return;
    }
    try {
      await pool.query('SELECT pg_notify($1, $2)', [CHANNEL_NAME, jsonStr]);
    } catch (err) {
      logger.warn({ err: err?.message || err }, '[PostgresListen] pg_notify emission error');
    }
  }

  async stop() {
    this.isStopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      const oldClient = this.client;
      this.client = null;
      try {
        oldClient.removeAllListeners();
        oldClient.on('error', () => {});
        await oldClient.end().catch(() => {});
        logger.info('[PostgresListen] Dedicated listener socket terminated cleanly');
      } catch (err) {
        logger.warn({ err: err?.message || err }, '[PostgresListen] Error during socket closure');
      }
    }
    this.isConnected = false;
  }
}

export const notificationBroadcaster = new NotificationBroadcaster();
