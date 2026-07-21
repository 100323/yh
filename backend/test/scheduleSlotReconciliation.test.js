import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileMissingScheduleSlots } from '../src/scheduler/scheduleSlotReconciliation.js';

function createLedger() {
  let nextId = 1;
  const rows = new Map();
  return {
    database: {},
    queueSlot(_database, entry) {
      const key = `${entry.taskConfigId}:${entry.scheduledAt}`;
      if (rows.has(key)) return { created: false, slot: rows.get(key) };
      const slot = {
        id: nextId++,
        taskConfigId: entry.taskConfigId,
        accountId: entry.accountId,
        taskType: entry.taskType,
        scheduledAt: entry.scheduledAt,
        source: entry.source,
        instanceId: entry.instanceId,
        status: 'queued',
      };
      rows.set(key, slot);
      return { created: true, slot };
    },
    markStarted(taskConfigId, scheduledAt) {
      rows.get(`${taskConfigId}:${scheduledAt}`).status = 'started';
    },
    rows,
  };
}

function task(id, overrides = {}) {
  return {
    id,
    account_id: id + 10_000,
    task_type: 'GENIE_SWEEP',
    cron_expression: '0 0 * * *',
    ...overrides,
  };
}

function reconcile(ledger, tasks, overrides = {}) {
  return reconcileMissingScheduleSlots({
    database: ledger.database,
    queueSlot: ledger.queueSlot,
    tasks,
    instanceId: 'boot-current',
    now: new Date('2026-07-18T16:02:00.000Z'),
    graceMs: 60_000,
    getCronExpressions: (entry) => [entry.cron_expression],
    enqueueTask: () => undefined,
    ...overrides,
  });
}

test('minute reconciliation creates and dispatches all 778 missing slots from one peak minute', () => {
  const ledger = createLedger();
  const tasks = Array.from({ length: 778 }, (_, index) => task(index + 1));
  const enqueued = [];
  const logs = [];
  const result = reconcile(ledger, tasks, {
    enqueueTask: (entry, options) => enqueued.push({ entry, options }),
    addLog: (...args) => logs.push(args),
  });

  assert.deepEqual(result, {
    scannedCount: 778,
    dueCount: 778,
    createdCount: 778,
    duplicateCount: 0,
    cachedCount: 0,
    failedCount: 0,
  });
  assert.equal(ledger.rows.size, 778);
  assert.equal(new Set(enqueued.map(({ options }) => options.scheduleSlot.id)).size, 778);
  assert.equal(enqueued.every(({ options }) => options.source === 'scheduler-reconcile'), true);
  assert.equal(logs.length, 778);
  assert.equal(logs.every(([, , status, message]) => status === 'missed' && message.includes('分钟对账')), true);
});

test('reconciliation uses the durable unique key after restart and never replays an existing started slot', () => {
  const ledger = createLedger();
  const existing = ledger.queueSlot(ledger.database, {
      taskConfigId: 1,
      accountId: 10_001,
      taskType: 'GENIE_SWEEP',
      scheduledAt: '2026-07-18T16:00:00.000Z',
      source: 'scheduler',
      instanceId: 'boot-old',
  }).slot;
  ledger.markStarted(1, '2026-07-18T16:00:00.000Z');
  const enqueued = [];

  const result = reconcile(ledger, [task(1)], {
    seenSlots: new Map(),
    enqueueTask: (...args) => enqueued.push(args),
  });

  assert.equal(result.createdCount, 0);
  assert.equal(result.duplicateCount, 1);
  assert.equal(enqueued.length, 0);
  assert.equal(existing.status, 'started');
});

test('reconciliation dispatches only the latest due cycle and caches the checked durable key', () => {
  const ledger = createLedger();
  const seenSlots = new Map();
  const enqueued = [];
  const multiCycleTask = task(1, { cron_expression: '0 0,6,8 * * *' });
  const options = {
    now: new Date('2026-07-19T00:48:00.000Z'),
    seenSlots,
    enqueueTask: (entry, enqueueOptions) => enqueued.push({ entry, enqueueOptions }),
  };

  const first = reconcile(ledger, [multiCycleTask], options);
  const second = reconcile(ledger, [multiCycleTask], options);

  assert.equal(first.createdCount, 1);
  assert.equal(second.cachedCount, 1);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].enqueueOptions.scheduleSlot.scheduledAt, '2026-07-19T00:00:00.000Z');
  assert.deepEqual(Array.from(ledger.rows.values()).map(({ scheduledAt }) => scheduledAt), [
    '2026-07-19T00:00:00.000Z',
  ]);
});

test('reconciliation logging failure cannot prevent a missing slot from being dispatched', () => {
  const ledger = createLedger();
  const enqueued = [];
  const result = reconcile(ledger, [task(1)], {
    addLog: () => {
      throw new Error('log unavailable');
    },
    enqueueTask: (entry) => enqueued.push(entry.id),
  });

  assert.equal(result.createdCount, 1);
  assert.deepEqual(enqueued, [1]);
});

test('reconciliation does not backfill a slot from before the task configuration existed', () => {
  const ledger = createLedger();
  const enqueued = [];
  const result = reconcile(ledger, [task(1, {
    created_at: '2026-07-18 16:01:30',
  })], {
    enqueueTask: (...args) => enqueued.push(args),
  });

  assert.equal(result.createdCount, 0);
  assert.equal(ledger.rows.size, 0);
  assert.equal(enqueued.length, 0);
});

test('first activation watermark prevents pre-release tasks from being replayed', () => {
  const ledger = createLedger();
  const enqueued = [];
  const result = reconcile(ledger, [task(1)], {
    notBefore: '2026-07-18T16:01:30.000Z',
    enqueueTask: (...args) => enqueued.push(args),
  });

  assert.equal(result.createdCount, 0);
  assert.equal(ledger.rows.size, 0);
  assert.equal(enqueued.length, 0);
});
