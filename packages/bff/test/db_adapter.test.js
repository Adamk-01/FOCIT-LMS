import test from 'node:test';
import assert from 'node:assert';
import { DatabaseAdapter, traceStorage } from '../src/db/index.js';

class MockPgPool {
  constructor() {
    this.queriesExecuted = [];
    this.clientsConnected = 0;
    this.clientsReleased = 0;
  }

  async query(textOrConfig, params) {
    this.queriesExecuted.push({ textOrConfig, params });
    return { rows: [{ id: 1, name: 'Test Course' }], rowCount: 1 };
  }

  async connect() {
    this.clientsConnected++;
    const self = this;
    const clientQueries = [];

    return {
      queryHistory: clientQueries,
      async query(text, params) {
        clientQueries.push({ text, params });
        return { rows: [], rowCount: 0 };
      },
      release() {
        self.clientsReleased++;
      },
    };
  }

  async end() {
    return Promise.resolve();
  }
}

test('DatabaseAdapter.query: Decorates Unnamed Queries with Tail SQL Comment', async () => {
  const mockPool = new MockPgPool();
  const db = new DatabaseAdapter(mockPool);

  // 1. Without active trace context: Query text remains unchanged
  await db.query('SELECT * FROM courses WHERE id = $1', [10]);
  assert.strictEqual(mockPool.queriesExecuted.length, 1);
  assert.strictEqual(
    mockPool.queriesExecuted[0].textOrConfig,
    'SELECT * FROM courses WHERE id = $1'
  );

  // 2. With active trace context: Tail comment is appended for live pg_stat_activity visibility
  await traceStorage.run({ traceId: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' }, async () => {
    await db.query('SELECT * FROM courses WHERE id = $1', [20]);
  });

  assert.strictEqual(mockPool.queriesExecuted.length, 2);
  assert.strictEqual(
    mockPool.queriesExecuted[1].textOrConfig,
    "SELECT * FROM courses WHERE id = $1 /*traceparent='00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'*/"
  );
  assert.deepStrictEqual(mockPool.queriesExecuted[1].params, [20]);
});

test('DatabaseAdapter.query: Preserves Named Prepared Statements Without Comment Mutation', async () => {
  const mockPool = new MockPgPool();
  const db = new DatabaseAdapter(mockPool);

  const namedConfig = {
    name: 'get_course_by_id',
    text: 'SELECT * FROM courses WHERE id = $1',
    values: [1],
  };

  // Even within active trace context, named prepared statements MUST NOT be mutated
  await traceStorage.run({ traceId: '00-active-trace-id' }, async () => {
    await db.query(namedConfig);
  });

  assert.strictEqual(mockPool.queriesExecuted.length, 1);
  // Exact object and text preserved to prevent node-postgres prepared statement cache collision
  assert.strictEqual(mockPool.queriesExecuted[0].textOrConfig.name, 'get_course_by_id');
  assert.strictEqual(
    mockPool.queriesExecuted[0].textOrConfig.text,
    'SELECT * FROM courses WHERE id = $1'
  );
});

test('DatabaseAdapter.transaction: Pipelines BEGIN + SET LOCAL in 1 RTT and Auto-Rolls Back', async () => {
  const mockPool = new MockPgPool();
  const db = new DatabaseAdapter(mockPool);

  const traceId = '00-deadlock-trace-test-123';

  // 1. Successful Transaction Execution
  let capturedClient = null;
  const result = await traceStorage.run({ traceId }, async () => {
    return db.transaction(async (client) => {
      capturedClient = client;
      await client.query('UPDATE courses SET active = true WHERE id = $1', [10]);
      return 'SUCCESS';
    });
  });

  assert.strictEqual(result, 'SUCCESS');
  assert.strictEqual(mockPool.clientsConnected, 1);
  assert.strictEqual(mockPool.clientsReleased, 1);

  // Inspect the wire sequence executed by the transactional client:
  // Step 1: Pipelined multi-statement BEGIN + SET LOCAL (1 single RTT)
  assert.strictEqual(
    capturedClient.queryHistory[0].text,
    "BEGIN; SET LOCAL application_name = 'focit_bff:00-deadlock-trace-test-123'"
  );
  // Step 2: Mutation query
  assert.strictEqual(
    capturedClient.queryHistory[1].text,
    'UPDATE courses SET active = true WHERE id = $1'
  );
  // Step 3: COMMIT (PostgreSQL engine automatically restores application_name baseline)
  assert.strictEqual(capturedClient.queryHistory[2].text, 'COMMIT');

  // 2. Transaction Rollback on Failure
  let failedClient = null;
  await assert.rejects(
    () =>
      traceStorage.run({ traceId }, async () => {
        return db.transaction(async (client) => {
          failedClient = client;
          await client.query('SELECT 1');
          throw new Error('Deadlock detected (40P01)');
        });
      }),
    /Deadlock detected/
  );

  assert.strictEqual(mockPool.clientsConnected, 2);
  assert.strictEqual(mockPool.clientsReleased, 2);
  // Must execute ROLLBACK and release socket cleanly
  assert.strictEqual(failedClient.queryHistory[failedClient.queryHistory.length - 1].text, 'ROLLBACK');
});
