import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { initializeScheduleSlotSchema, markScheduleSlotStarted, queueScheduleSlot } from '../src/scheduler/scheduleSlotLedger.js';
import {
  recordRecoveredEnqueueFailure,
  recoverQueuedScheduleSlots,
} from '../src/scheduler/scheduleSlotRecovery.js';

function createDb() {
  const db = new Database(':memory:');
  initializeScheduleSlotSchema(db);
  return db;
}

function queue(db, overrides = {}) {
  return queueScheduleSlot(db, {
    taskConfigId: 1,
    accountId: 2,
    taskType: 'GENIE_SWEEP',
    scheduledAt: '2026-07-18T00:01:00.000Z',
    source: 'scheduler',
    instanceId: 'old-boot',
    ...overrides,
  }).slot;
}

test('recoverQueuedScheduleSlots re-enqueues prior queued slots and logs unavailable tasks without replaying started slots', async () => {
  const db = createDb();
  try {
    const recoverable = queue(db);
    const unavailable = queue(db, { taskConfigId: 2, taskType: 'LEGION_BOSS' });
    const started = queue(db, { taskConfigId: 3, taskType: 'TREASURE_CLAIM' });
    markScheduleSlotStarted(db, started.id, { instanceId: 'old-boot' });

    const enqueued = [];
    const logs = [];
    const result = await recoverQueuedScheduleSlots({
      database: db,
      instanceId: 'new-boot',
      cutoff: '2026-07-15T00:00:00.000Z',
      loadTask: (taskConfigId) => (taskConfigId === 1 ? { id: 1, account_id: 2, task_type: 'GENIE_SWEEP' } : null),
      enqueueTask: async (task, options) => {
        enqueued.push({ task, options });
      },
      addLog: (accountId, taskType, status, message) => logs.push({ accountId, taskType, status, message }),
    });

    assert.deepEqual(result, { recoveredCount: 1, unavailableCount: 1, interruptedCount: 1 });
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].task.id, 1);
    assert.equal(enqueued[0].options.source, 'scheduler-recovery');
    assert.equal(enqueued[0].options.scheduleSlot.id, recoverable.id);
    assert.deepEqual(logs, [
      {
        accountId: 2,
        taskType: 'GENIE_SWEEP',
        status: 'missed',
        message: '任务漏做：服务重启后已重新入队',
      },
      {
        accountId: 2,
        taskType: 'LEGION_BOSS',
        status: 'missed',
        message: '任务漏做：服务重启后任务配置不可用，未自动恢复',
      },
      {
        accountId: 2,
        taskType: 'TREASURE_CLAIM',
        status: 'missed',
        message: '任务漏做：服务重启时任务已开始，未自动重放',
      },
    ]);
    assert.deepEqual(
      db.prepare('SELECT status, message FROM scheduler_task_slots WHERE id = ?').get(started.id),
      { status: 'error', message: '任务漏做：服务重启时任务已开始，未自动重放' },
    );
  } finally {
    db.close();
  }
});

test('recoverQueuedScheduleSlots drains more than one recovery page', async () => {
  const db = createDb();
  try {
    for (let taskConfigId = 1; taskConfigId <= 501; taskConfigId += 1) {
      queue(db, { taskConfigId, accountId: taskConfigId + 1000 });
    }

    const enqueued = [];
    const result = await recoverQueuedScheduleSlots({
      database: db,
      instanceId: 'new-boot',
      cutoff: '2026-07-15T00:00:00.000Z',
      loadTask: (taskConfigId) => ({ id: taskConfigId, account_id: taskConfigId + 1000, task_type: 'GENIE_SWEEP' }),
      enqueueTask: async (task) => enqueued.push(task.id),
    });

    assert.equal(result.recoveredCount, 501);
    assert.equal(enqueued.length, 501);
  } finally {
    db.close();
  }
});

test('recovery logging failure cannot prevent a queued task from being re-enqueued', async () => {
  const db = createDb();
  try {
    const recoverable = queue(db);
    const enqueued = [];
    const result = await recoverQueuedScheduleSlots({
      database: db,
      instanceId: 'new-boot',
      cutoff: '2026-07-15T00:00:00.000Z',
      loadTask: () => ({ id: 1, account_id: 2, task_type: 'GENIE_SWEEP' }),
      enqueueTask: async (task) => enqueued.push(task.id),
      addLog: () => {
        throw new Error('log unavailable');
      },
    });

    assert.deepEqual(result, { recoveredCount: 1, unavailableCount: 0, interruptedCount: 0 });
    assert.deepEqual(enqueued, [1]);
    assert.equal(db.prepare('SELECT status FROM scheduler_task_slots WHERE id = ?').get(recoverable.id).status, 'queued');
  } finally {
    db.close();
  }
});

test('background enqueue rejection settles the slot and writes a missed log', () => {
  const db = createDb();
  try {
    const recoverable = queue(db);
    const logs = [];

    recordRecoveredEnqueueFailure({
      database: db,
      slot: recoverable,
      error: new Error('account queue rejected'),
      addLog: (accountId, taskType, status, message) => logs.push({ accountId, taskType, status, message }),
    });

    assert.deepEqual(
      db.prepare('SELECT status, message FROM scheduler_task_slots WHERE id = ?').get(recoverable.id),
      { status: 'error', message: '任务恢复入队后执行失败：account queue rejected' },
    );
    assert.deepEqual(logs, [{
      accountId: 2,
      taskType: 'GENIE_SWEEP',
      status: 'missed',
      message: '任务恢复入队后执行失败：account queue rejected',
    }]);
  } finally {
    db.close();
  }
});
