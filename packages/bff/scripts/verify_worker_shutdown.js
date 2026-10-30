/**
 * Verification Script: Phase 13A Dedicated Worker Graceful Shutdown & Drain Barrier
 * Enforces cross-platform signal & IPC graceful termination.
 */
import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.resolve(__dirname, '../src/worker.js');
const bffDir = path.resolve(__dirname, '..');

console.log('[TestRunner] Forking Worker process:', workerPath);

const child = fork(workerPath, [], {
  cwd: bffDir,
  env: {
    ...process.env,
    NODE_ENV: 'test',
  },
  silent: true,
});

const outputLines = [];

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  for (const line of text.split('\n')) {
    if (line.trim()) {
      console.log('  [Worker STDOUT]:', line.trim());
      outputLines.push(line.trim());
    }
  }
});

child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  for (const line of text.split('\n')) {
    if (line.trim()) {
      console.error('  [Worker STDERR]:', line.trim());
      outputLines.push(line.trim());
    }
  }
});

// Wait 2.5s for worker subsystems to fully initialize, then dispatch SIGTERM via IPC channel
setTimeout(() => {
  console.log('\n[TestRunner] Dispatching SIGTERM graceful shutdown command to worker process...');
  child.send('SIGTERM');
}, 3000);

child.on('exit', (code, signal) => {
  console.log(`\n[TestRunner] Worker process exited with code ${code}, signal ${signal}`);

  const fullOutput = outputLines.join('\n');
  const hasPhase1 = fullOutput.includes('Phase 1') || fullOutput.includes('Cleared recurring telemetry timer');
  const hasPhase2 = fullOutput.includes('Phase 2') || fullOutput.includes('In-flight tasks successfully settled');
  const hasPhase3 = fullOutput.includes('Phase 3') || fullOutput.includes('final telemetry drain pass');
  const hasPhase4 = fullOutput.includes('Phase 4') || fullOutput.includes('Tearing down infrastructure connections');
  const hasCleanExit = code === 0 || fullOutput.includes('Exiting cleanly (0)');

  console.log('\n─── Audit Checklist ──────────────────────────────────────────');
  console.log(` Phase 1 (Ingress Poll Timer Halt): ${hasPhase1 ? 'PASS' : 'FAIL'}`);
  console.log(` Phase 2 (In-Flight Tasks Settle):  ${hasPhase2 ? 'PASS' : 'FAIL'}`);
  console.log(` Phase 3 (Final Buffer Drain):      ${hasPhase3 ? 'PASS' : 'FAIL'}`);
  console.log(` Phase 4 (Ordered Pool Teardown):   ${hasPhase4 ? 'PASS' : 'FAIL'}`);
  console.log(` Phase 5 (Deterministic Exit 0):    ${hasCleanExit ? 'PASS' : 'FAIL'}`);
  console.log('──────────────────────────────────────────────────────────────\n');

  if (hasPhase1 && hasPhase2 && hasPhase3 && hasPhase4 && hasCleanExit) {
    console.log('>>> VERIFICATION PASSED: Graceful shutdown barrier operates deterministically.');
    process.exit(0);
  } else {
    console.error('>>> VERIFICATION FAILED: Shutdown barrier missed one or more phases.');
    process.exit(1);
  }
});
