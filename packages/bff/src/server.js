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
app.use(cors({
  origin: config.frontendOrigin,
  credentials: true,  // Required for HttpOnly cookies
  methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Session-Nonce',
    'X-Requested-With',
    'X-CSRF-Token',
  ],
  exposedHeaders: [
    'Content-Range',
    'Accept-Ranges',
    'Content-Length',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'Retry-After',
  ],
}));

// ─── 2. Cookie Parser ────────────────────────────────────────
app.use(cookieParser());

// ─── 3. JSON Body Parser ─────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

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
app.use('/api/files', filesRouter);

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

// ─── Start Server ────────────────────────────────────────────
const server = app.listen(config.port, () => {
  console.log(`\n  ┌──────────────────────────────────────────┐`);
  console.log(`  │  FOCIT BFF Proxy                         │`);
  console.log(`  │  http://localhost:${config.port}                  │`);
  console.log(`  │  Moodle: ${config.moodle.baseUrl}       │`);
  console.log(`  │  Mode: ${config.nodeEnv}                    │`);
  console.log(`  └──────────────────────────────────────────┘\n`);
  
  logger.info({ port: config.port, env: config.nodeEnv }, 'BFF Proxy HTTP server initialized');
});

// ─── Zero-Downtime Graceful Shutdown Lifecycle ───────────────
setupGracefulShutdown({
  server,
  redis,
  options: {
    ingressDrainDelayMs: config.nodeEnv === 'production' ? 5000 : 500,
    maxDrainWaitMs: 15000,
    hardWatchdogMs: 25000,
  },
});

export default app;
