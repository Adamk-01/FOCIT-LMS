/**
 * FOCIT LMS — Phase 13A Process Topology Decoupling & Graceful Shutdown Test
 * Standard: The 8-8-8 Architectural Doctrine
 */
import test from 'node:test';
import assert from 'node:assert';
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, '../src/worker.js');
const bffDir = path.resolve(__dirname, '..');

test('Phase 13A: Worker Process Topology & 5-Phase Graceful Shutdown Barrier', async () => {
  const child = fork(workerPath, [], {
    cwd: bffDir,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
    silent: true,
  });

  const logs = [];

  child.stdout.on('data', (chunk) => {
    logs.push(chunk.toString());
  });

  child.stderr.on('data', (chunk) => {
    logs.push(chunk.toString());
  });

  // Give subsystems 2.5s to initialize and connect to Redis
  await new Promise((resolve) => setTimeout(resolve, 2500));

  // Dispatch SIGTERM shutdown instruction via IPC
  child.send('SIGTERM');

  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Worker shutdown barrier exceeded 10s ceiling'));
    }, 10_000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  assert.strictEqual(exitCode, 0, 'Worker process must exit cleanly with code 0');

  const combinedOutput = logs.join('');

  // Assert 5-Phase Invariants
  assert.ok(
    combinedOutput.includes('Phase 1: Cleared recurring telemetry timer'),
    'Invariant 1: Phase 1 must halt polling timers'
  );
  assert.ok(
    combinedOutput.includes('Phase 2: Awaiting in-flight outbox dispatches'),
    'Invariant 2: Phase 2 must track in-flight dispatches'
  );
  assert.ok(
    combinedOutput.includes('In-flight tasks successfully settled'),
    'Invariant 2: In-flight tasks must settle before pool close'
  );
  assert.ok(
    combinedOutput.includes('Phase 3: Executing final telemetry drain pass'),
    'Invariant 3: Phase 3 must execute final telemetry drain'
  );
  assert.ok(
    combinedOutput.includes('Phase 4: Tearing down infrastructure connections'),
    'Invariant 4: Phase 4 must execute ordered infrastructure teardown'
  );
  assert.ok(
    combinedOutput.includes('PostgreSQL connection pool drained and closed cleanly'),
    'Invariant 4a: PostgreSQL pool must close after tasks finish'
  );
  assert.ok(
    combinedOutput.includes('Redis connection closed cleanly'),
    'Invariant 4b: Redis connection must close cleanly'
  );
  assert.ok(
    combinedOutput.includes('Exiting cleanly (0)'),
    'Invariant 5: Phase 5 must terminate with exit code 0'
  );
});
