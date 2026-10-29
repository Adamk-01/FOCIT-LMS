/**
 * FOCIT BFF Proxy — Express Server Entry Point
 *
 * Middleware chain order (critical — do not reorder):
 * 1. CORS (allow frontend origin)
 * 2. Cookie parser (extract JWT from HttpOnly cookie)
 * 3. JSON body parser (for future POST endpoints)
 * 4. Global concurrency gate (Tier 1 rate limit)
 * 5. Authentication (JWT validation)
 * 6. Routes (materials, files, health)
 * 7. 404 handler
 * 8. Global error handler (must be last)
 */

import dns from 'node:dns';
import net from 'node:net';

// Ensure IPv4 resolution takes priority and disable Happy Eyeballs IPv6 stalls in Docker
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}
if (typeof net.setDefaultAutoSelectFamily === 'function') {
  net.setDefaultAutoSelectFamily(false);
}

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import config from './config.js';
import { logger } from './lib/logger.js';
import { fetchMetadataGuard } from './middleware/fetchMetadataGuard.js';
import { authMiddleware } from './middleware/auth.js';
import { globalConcurrencyGate } from './middleware/rateLimiter.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRouter from './routes/auth.js';
import materialsRouter from './routes/materials.js';
import filesRouter from './routes/files.js';
import healthRouter from './routes/health.js';
import studentDashboardRouter from './routes/studentDashboard.js';
import registrationRouter from './routes/registration.js';
import quizzesRouter from './routes/quizzes.js';
import gradesRouter from './routes/grades.js';
import forumsRouter from './routes/forums.js';
import questionBankRouter from './routes/questionBank.js';
import profileRouter from './routes/profile.js';
import adminRouter from './routes/admin.js';
import hodRouter from './routes/hod.js';
import lecturerRouter from './routes/lecturer.js';
import attendanceRouter from './routes/attendance.js';
import notificationsRouter from './routes/notifications.js';
import assignmentsRouter from './routes/assignments.js';
import studentCoursesRouter from './routes/studentCourses.js';
import { redis } from './lib/redis.js';
import { connectionTracker, setupGracefulShutdown } from './lib/gracefulShutdown.js';

const app = express();

// ─── 0. Active Connection Tracking (Zero-Downtime Draining) ──
app.use(connectionTracker);

// ─── 0.1 Structured Request Logging ──────────────────────────
app.use(pinoHttp({ 
  logger,
  // Don't log health checks aggressively in production
  autoLogging: {
    ignore: (req) => req.url === '/health'
  }
}));

// ─── 1. CORS ─────────────────────────────────────────────────
const allowedOrigins = [
  config.frontendOrigin,
  'http://localhost:5173',
  'http://localhost:5180',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5180'
];

app.use(cors({
  origin: (origin, callback) => {
    const isAppVercelOrigin = typeof origin === 'string' && /^https:\/\/focit(-[a-z0-9-]+)?\.vercel\.app$/.test(origin);
    if (!origin || allowedOrigins.includes(origin) || isAppVercelOrigin) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,  // Required for HttpOnly cookies
  methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Session-Nonce',
    'X-Requested-With',
    'X-CSRF-Token',
    'Idempotency-Key',
    'X-Idempotency-Key',
  ],
  exposedHeaders: [
    'Content-Range',
    'Accept-Ranges',
    'Content-Length',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
    'X-Session-Nonce-Sync',
  ],
}));

// ─── 2. Cookie Parser ────────────────────────────────────────
app.use(cookieParser());

// ─── 3. JSON & URL-Encoded Body Parsers (2MB ingress limit) ───
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ limit: '2mb', extended: true }));

// ─── 4. Health Check (before auth — LB probes don't have JWTs) ──
app.use('/health', healthRouter);

// ─── 5. Fetch Metadata Perimeter Guard (Platform CSRF & Subresource Isolation) ──
app.use('/api', fetchMetadataGuard);

// ─── 6. Global Concurrency Gate (Tier 1) ─────────────────────
app.use('/api', globalConcurrencyGate);

// ─── 7. Authentication Routes (Handshake, Logout, Status) ────
app.use('/api/auth', authRouter);

// ─── 8. Authentication Barrier for Protected API Endpoints ──
app.use('/api', authMiddleware);

// ─── 9. Protected Resource Routes ───────────────────────────
app.use('/api/courses', materialsRouter);
app.use('/api/courses', gradesRouter);
app.use('/api/courses', forumsRouter);
app.use('/api/courses', questionBankRouter);
app.use('/api/courses', assignmentsRouter);
app.use('/api/quizzes', quizzesRouter);
app.use('/api/files', filesRouter);
app.use('/api/student', studentDashboardRouter);
app.use('/api/student', profileRouter);
app.use('/api/student/courses', studentCoursesRouter);
app.use('/api/student/notifications', notificationsRouter);
app.use('/api/registration', registrationRouter);
app.use('/api/admin', adminRouter);
app.use('/api/hod', hodRouter);
app.use('/api/lecturer', lecturerRouter);
app.use('/api/attendance', attendanceRouter);

// ─── 8. 404 Handler ──────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.path,
  });
});

// ─── 9. Global Error Handler (must be last) ──────────────────
app.use(errorHandler);

import { unifiedOutboxWorker } from './workers/unifiedOutboxWorker.js';
import { notificationBroadcaster } from './services/notificationBroadcaster.js';
import { quizSweeperWorker } from './workers/quizSweeperWorker.js';

// ─── Network & Socket Resilience Handlers ───────────────────
process.on('uncaughtException', (err) => {
  logger.fatal({ err: err?.stack || err, code: err?.code }, '[Process] Fatal uncaught exception encountered. Terminating process.');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.warn({ reason: reason?.message || reason }, '[Process] Unhandled promise rejection');
});

// ─── Start Server ────────────────────────────────────────────
const server = app.listen(config.port, () => {
  console.log(`\n  ┌──────────────────────────────────────────┐`);
  console.log(`  │  FOCIT BFF Proxy                         │`);
  console.log(`  │  http://localhost:${config.port}                  │`);
  console.log(`  │  Moodle: ${config.moodle.baseUrl}       │`);
  console.log(`  │  Mode: ${config.nodeEnv}                    │`);
  console.log(`  └──────────────────────────────────────────┘\n`);
  
  logger.info({ port: config.port, env: config.nodeEnv }, 'BFF Proxy HTTP server initialized');
  
  // Start Unified Transactional Outbox Worker
  unifiedOutboxWorker.start();
  // Start PostgreSQL Native LISTEN / NOTIFY Notification Broadcaster
  notificationBroadcaster.start();
  // Start Official Test Auto-Zero Countdown Sweeper
  quizSweeperWorker.start();
});

// ─── Zero-Downtime Graceful Shutdown Lifecycle ───────────────
setupGracefulShutdown({
  server,
  redis,
  workers: [unifiedOutboxWorker, notificationBroadcaster, quizSweeperWorker],
  options: {
    ingressDrainDelayMs: config.nodeEnv === 'production' ? 5000 : 500,
    maxDrainWaitMs: 15000,
    hardWatchdogMs: 25000,
  },
});

export default app;
