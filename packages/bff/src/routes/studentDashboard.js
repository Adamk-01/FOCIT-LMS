import express from 'express';
import { EventEmitter } from 'events';
import IORedis from 'ioredis';
import { Piscina } from 'piscina';
import path from 'path';
import os from 'node:os';
import pool from '../db/index.js';
import config from '../config.js';

const router = express.Router();

// ============================================================================
// 1. SSE MULTIPLEXER SETUP
// ============================================================================
// We establish a SINGLE Redis subscriber for the entire Node.js process to 
// prevent connection exhaustion, regardless of how many students are streaming.
const redisSubscriber = new IORedis(config.redis.url);
const redisCache = new IORedis(config.redis.url);

export const announcementEmitter = new EventEmitter();
announcementEmitter.setMaxListeners(5000); // Scale up for concurrent university traffic

redisSubscriber.subscribe('course_announcements', (err) => {
  if (err) console.error('[Redis] Failed to subscribe to announcements channel');
});

redisSubscriber.on('message', (channel, message) => {
  if (channel === 'course_announcements') {
    try {
      const payload = JSON.parse(message);
      // Fan out the message strictly to the memory references listening to this specific course
      announcementEmitter.emit(`course_${payload.course_id}`, payload);
    } catch (e) {
      console.error('[SSE] Invalid announcement payload', e);
    }
  }
});

// ============================================================================
// 2. THE SSE ENDPOINT (State Recovery + Garbage Collection)
// ============================================================================
router.get('/announcements/stream/:courseId', async (req, res) => {
  const { courseId } = req.params;
  const lastEventId = req.headers['last-event-id'];

  // 1. Initialize HTTP Headers for EventSource
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Bypasses Nginx buffering
  });

  // 2. The Database Catch-Up (State Recovery)
  // If the TCP tunnel dropped and the browser is re-connecting, fetch guaranteed 
  // missed events from the PostgreSQL durable ledger BEFORE attaching to the live stream.
  if (lastEventId) {
    try {
      const { rows: missedEvents } = await pool.query(`
        SELECT id, title, body, created_at 
        FROM announcements 
        WHERE course_id = $1 AND id > $2 
        ORDER BY id ASC
      `, [courseId, lastEventId]);

      for (const event of missedEvents) {
        res.write(`id: ${event.id}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (err) {
      console.error(`[SSE Catch-up Error] ${err.message}`);
    }
  }

  // 3. The Closure Handler
  const sendPayload = (payload) => {
    res.write(`id: ${payload.id}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Bind this client specifically to their course's local emitter channel
  const eventName = `course_${courseId}`;
  announcementEmitter.on(eventName, sendPayload);

  // 4. The Keep-Alive Heartbeat
  // Pushes a blank comment every 15s to keep idle sockets open across firewalls/proxies.
  const heartbeatTimer = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  // 5. The V8 Memory Leak Defense (Teardown Sequence)
  // When the OS signals that the client dropped the connection, execute strict garbage collection.
  req.on('close', () => {
    clearInterval(heartbeatTimer);
    announcementEmitter.removeListener(eventName, sendPayload);
    res.end(); // Safely seal the writable stream
  });
});

// ============================================================================
// 3. THE WORKER THREAD POOL SETUP
// ============================================================================
// We instantiate a dedicated thread pool to isolate CPU-bound tasks away from the main thread.
const rruleWorkerPool = new Piscina({
  filename: path.resolve(process.cwd(), 'src/workers/rruleExpander.js'),
  minThreads: 2,
  maxThreads: Math.max(2, os.cpus().length - 1)
});

// ============================================================================
// 4. THE TIMETABLE ENDPOINT (Cache + Worker Delegation)
// ============================================================================
router.get('/timetable/:courseId', async (req, res) => {
  const { courseId } = req.params;
  const { weekStart } = req.query; // Format: YYYY-MM-DD

  if (!weekStart) {
    return res.status(400).json({ error: 'weekStart query parameter is required' });
  }

  const cacheKey = `timetable:${courseId}:week:${weekStart}`;

  try {
    // 1. Redis Read-Through Cache (O(1) Main Thread Bypass)
    const cachedData = await redisCache.get(cacheKey);
    if (cachedData) {
      // 99% of requests exit here without ever touching Postgres or burning CPU.
      return res.status(200).type('json').send(cachedData);
    }

    // 2. Cache Miss: Query Immutable RRULE from PostgreSQL
    const { rows: timetableRules } = await pool.query(`
      SELECT id, rrule, duration_minutes, room_id, exclusion_dates
      FROM academic_timetable 
      WHERE course_id = $1
    `, [courseId]);

    if (timetableRules.length === 0) {
      return res.status(200).json([]); 
    }

    // Pull associated exceptions for this specific parent series
    const { rows: exceptions } = await pool.query(`
      SELECT parent_series_id, original_occurrence_date, new_start_time, new_duration_minutes, new_room_id 
      FROM timetable_exceptions 
      WHERE parent_series_id = ANY($1)
    `, [timetableRules.map(r => r.id)]);

    // 3. Worker Thread Delegation (Event Loop Defense)
    // We eject the raw data strings to a background thread to perform the heavy calendar expansion.
    // The main thread is instantly freed up to serve other students.
    const expandedSchedule = await rruleWorkerPool.run({
      rules: timetableRules,
      exceptions: exceptions,
      weekStart: weekStart
    });

    // 4. Update Cache (TTL 24 Hours) and Return Payload
    await redisCache.setex(cacheKey, 86400, JSON.stringify(expandedSchedule));
    
    return res.status(200).json(expandedSchedule);

  } catch (err) {
    console.error(`[Timetable Error] ${err.message}`);
    return res.status(500).json({ error: 'Failed to generate timetable' });
  }
});

export default router;
