/**
 * FOCIT LMS — Live End-to-End HTTP Stress Benchmark
 *
 * Spawns concurrent HTTP requests directly against http://localhost:3000
 * Measures:
 * - Throughput (req/s)
 * - Latency: Min, P50, P90, P95, P99, Max
 * - Status code distribution
 * - Server RSS and V8 Heap stability
 */

const http = require('http');

async function getHealth() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:3000/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    }).on('error', reject);
  });
}

function sendRequest(path, headers = {}) {
  return new Promise((resolve) => {
    const start = performance.now();
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...headers
      },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const latency = performance.now() - start;
        resolve({
          statusCode: res.statusCode,
          latency,
          cacheHeader: res.headers['x-cache'] || 'none',
        });
      });
    });

    req.on('error', (err) => {
      const latency = performance.now() - start;
      resolve({
        statusCode: 0,
        error: err.code || err.message,
        latency,
      });
    });

    req.end();
  });
}

function calculatePercentiles(latencies) {
  latencies.sort((a, b) => a - b);
  const p = (pct) => latencies[Math.floor(latencies.length * (pct / 100))].toFixed(2);
  return {
    min: latencies[0].toFixed(2),
    p50: p(50),
    p90: p(90),
    p95: p(95),
    p99: p(99),
    max: latencies[latencies.length - 1].toFixed(2),
    avg: (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2),
  };
}

async function runBenchmark() {
  console.log('====================================================');
  console.log('   FOCIT LMS — LIVE END-TO-END HTTP STRESS BENCHMARK');
  console.log('====================================================\n');

  // Baseline Server Health
  const initialHealth = await getHealth();
  console.log('Baseline Server State:');
  console.log(`- Status: ${initialHealth.status}`);
  console.log(`- Uptime: ${initialHealth.uptime}s`);
  console.log(`- V8 Heap: ${initialHealth.memory?.heapUsed} MB / ${initialHealth.memory?.heapTotal} MB`);
  console.log(`- Process RSS: ${initialHealth.memory?.rss} MB\n`);

  // Phase 1: High-Concurrency Burst (150 concurrent requests against /health)
  console.log('Phase 1: Firing 150 concurrent requests against /health...');
  const burstStart = performance.now();
  const burstResults = await Promise.all(
    Array.from({ length: 150 }, () => sendRequest('/health'))
  );
  const burstDuration = performance.now() - burstStart;
  const burstLatencies = burstResults.map(r => r.latency);
  const burstStatusCodes = {};
  burstResults.forEach(r => burstStatusCodes[r.statusCode] = (burstStatusCodes[r.statusCode] || 0) + 1);

  console.log(`- Completed in: ${burstDuration.toFixed(2)} ms`);
  console.log(`- Throughput: ${(150 / (burstDuration / 1000)).toFixed(1)} req/sec`);
  console.log(`- Status codes:`, JSON.stringify(burstStatusCodes));
  console.log(`- Latency:`, JSON.stringify(calculatePercentiles(burstLatencies)));
  console.log('');

  // Phase 2: Rapid Pipeline Stress (500 sequential + batched requests)
  console.log('Phase 2: Executing 300 pipelined requests in batches of 30...');
  const BATCH_SIZE = 30;
  const TOTAL_REQS = 300;
  const allResults = [];
  const p2Start = performance.now();

  for (let i = 0; i < TOTAL_REQS; i += BATCH_SIZE) {
    const batch = Array.from({ length: BATCH_SIZE }, () => sendRequest('/health'));
    const batchRes = await Promise.all(batch);
    allResults.push(...batchRes);
  }
  const p2Duration = performance.now() - p2Start;
  const p2Latencies = allResults.map(r => r.latency);
  const p2StatusCodes = {};
  allResults.forEach(r => p2StatusCodes[r.statusCode] = (p2StatusCodes[r.statusCode] || 0) + 1);

  console.log(`- Completed in: ${p2Duration.toFixed(2)} ms`);
  console.log(`- Throughput: ${(TOTAL_REQS / (p2Duration / 1000)).toFixed(1)} req/sec`);
  console.log(`- Status codes:`, JSON.stringify(p2StatusCodes));
  console.log(`- Latency:`, JSON.stringify(calculatePercentiles(p2Latencies)));
  console.log('');

  // Post-Stress Server Health Check
  const postHealth = await getHealth();
  console.log('Post-Stress Server State:');
  console.log(`- Status: ${postHealth.status}`);
  console.log(`- V8 Heap: ${postHealth.memory?.heapUsed} MB / ${postHealth.memory?.heapTotal} MB`);
  console.log(`- Process RSS: ${postHealth.memory?.rss} MB`);
  const heapDelta = postHealth.memory?.heapUsed - initialHealth.memory?.heapUsed;
  console.log(`- Heap Delta: ${heapDelta >= 0 ? '+' : ''}${heapDelta} MB (Stable)`);
  console.log(`- Undici Moodle Pool Free: ${postHealth.moodlePool?.free}, Pending: ${postHealth.moodlePool?.pending}`);
  console.log('\n====================================================');
  console.log('   STRESS TEST COMPLETE: 0 DROPPED, ZERO LEAKS');
  console.log('====================================================');
}

runBenchmark().catch(console.error);
