/**
 * Child Worker Process for Phase 13E Concurrency & Contender Coalescing Stress Test
 * Executed via child_process.fork() to test true OS-level multi-process coalescing.
 */

import { DistributedSingleFlight } from '../../src/lib/distributedSingleFlight.js';

let flight = null;
let upstreamCalls = 0;

process.on('message', async (msg) => {
  try {
    if (msg.action === 'INIT') {
      flight = new DistributedSingleFlight({
        defaultTimeoutMs: 10000,
        defaultContenderTimeoutMs: 6000,
      });

      // Ensure both command client and subscriber singleton are connected
      await flight.ensureConnected();

      if (process.send) {
        process.send({
          status: 'READY',
          workerId: msg.workerId,
          pid: process.pid,
        });
      }
      return;
    }

    if (msg.action === 'FIRE') {
      const { key, requestCount = 65, simulateLatencyMs = 80 } = msg;

      const slowMoodleFetch = async (signal) => {
        upstreamCalls++;
        await new Promise((resolve) => setTimeout(resolve, simulateLatencyMs));
        return {
          courseId: 'CSC401',
          title: 'Advanced Distributed Systems & Consensus',
          units: 3,
          data: 'verified_course_syllabus_content',
          fetchedAt: Date.now(),
          winnerPid: process.pid,
        };
      };

      // Invariant 1: Launch 65+ concurrent requests within this OS process simultaneously
      const callers = Array.from({ length: requestCount }, (_, idx) =>
        flight.do(key, slowMoodleFetch).then((data) => ({
          callerIdx: idx,
          data,
        }))
      );

      const activeKeysDuringBurst = [...flight.activeKeys];
      const results = await Promise.all(callers);
      const activeKeysAfter = [...flight.activeKeys];

      const firstData = results[0]?.data;
      const allIdentical = results.every(
        (r) => r.data && r.data.courseId === 'CSC401' && r.data.fetchedAt === firstData?.fetchedAt
      );

      if (process.send) {
        process.send({
          status: 'DONE',
          workerId: msg.workerId,
          pid: process.pid,
          upstreamCalls,
          settledCount: results.length,
          activeKeysDuringBurst,
          activeKeysAfter,
          sampleData: firstData,
          allIdentical,
        });
      }
      return;
    }

    if (msg.action === 'SHUTDOWN') {
      if (flight) {
        await flight.close();
      }
      try {
        const { redis } = await import('../../src/lib/redis.js');
        if (redis) {
          await redis.quit().catch(() => redis.disconnect());
        }
      } catch {}
      process.exit(0);
    }
  } catch (err) {
    if (process.send) {
      process.send({
        status: 'ERROR',
        workerId: msg.workerId,
        pid: process.pid,
        error: err?.message || String(err),
        stack: err?.stack,
      });
    }
  }
});
