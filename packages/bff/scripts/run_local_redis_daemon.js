/**
 * Standalone Local Redis Daemon
 * Provides high-performance in-memory RESP2 Redis emulation on port 6379
 * for local development and load testing.
 */

import { MiniRedisServer } from '../test/helpers/miniRedisServer.js';

const port = parseInt(process.env.PORT || '6379', 10);
const server = new MiniRedisServer(port);

await server.start();
console.log(`\n  ┌──────────────────────────────────────────┐`);
console.log(`  │  FOCIT In-Memory Redis Daemon            │`);
console.log(`  │  redis://127.0.0.1:${port}                 │`);
console.log(`  └──────────────────────────────────────────┘\n`);

process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await server.close();
  process.exit(0);
});

