import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  claimRecoverableQueuedSlots,
  cleanupScheduleSlots,
  initializeScheduleSlotSchema,
  markScheduleSlotStarted,
  markScheduleSlotRequeued,
  queryScheduleSlotSummary,
  queueScheduleSlot,
  settleInterruptedStartedSlots,
  settleScheduleSlot,
} from '../src/scheduler/scheduleSlotLedger.js';

function createLedger() {
  const db = new Database(':memory:');
  initializeScheduleSlotSchema(db);
  return db;
}

function slot(overrides = {}) {
  return {
    taskConfigId: 10,
    accountId: 20,
    taskType: 'GENIE_SWEEP',
    scheduledAt: '2026-07-18T00:01:00.000Z',
    source: 'scheduler',
    instanceId: 'boot-a',
    ...overrides,
  };
}

test('queueScheduleSlot keeps one durable slot per task configuration and schedule minute', () => {
  const db = createLedger();
  try {
    const first = queueScheduleSlot(db, slot());
    const duplicate = queueScheduleSlot(db, slot({ source: 'scheduler-recovery', instanceId: 'boot-b' }));

    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.slot.id, first.slot.id);
    assert.equal(duplicate.slot.status, 'queued');
    assert.equal(duplicate.slot.instanceId, 'boot-a');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM scheduler_task_slots').get().count, 1);
  } finally {
    db.close();
  }
});

test('queryScheduleSlotSummary returns only bounded recovery state counts', () => {
  const db = createLedger();
  try {
    const recovered = queueScheduleSlot(db, slot()).slot;
    const interrupted = queueScheduleSlot(db, slot({ taskConfigId: 11, taskType: 'TREASURE_CLAIM' })).slot;
    markScheduleSlotStarted(db, interrupted.id, { instanceId: 'boot-a' });
    const unavailable = queueScheduleSlot(db, slot({ taskConfigId: 12, taskType: 'LEGION_BOSS' })).slot;
    claimRecoverableQueuedSlots(db, {
      instanceId: 'boot-b',
      cutoff: '2026-07-15T00:00:00.000Z',
    });
    markScheduleSlotRequeued(db, recovered.id, { instanceId: 'boot-b' });
    settleInterruptedStartedSlots(db, {
      instanceId: 'boot-b',
      cutoff: '2026-07-15T00:00:00.000Z',
      message: '任务漏做：服务重启时任务已开始，未自动重放',
    });
    settleScheduleSlot(db, unavailable.id, {
      outcome: 'ignored',
      message: '任务漏做：服务重启后任务配置不可用，未自动恢复',
    });

    assert.deepEqual(queryScheduleSlotSummary(db, {
      cutoff: '2026-07-15T00:00:00.000Z',
    }), {
      totalCount: 3,
      queuedCount: 1,
      startedCount: 0,
      successCount: 0,
      ignoredCount: 1,
      errorCount: 1,
      recoveredCount: 1,
      interruptedCount: 1,
      unavailableCount: 1,
    });
    assert.equal(recovered.id > 0, true);
  } finally {
    db.close();
  }
});

test('new scheduler instance claims only queued slots left by a previous instance once', () => {
  const db = createLedger();
  try {
    const queued = queueScheduleSlot(db, slot()).slot;
    const started = queueScheduleSlot(db, slot({ taskConfigId: 11, taskType: 'LEGION_BOSS' })).slot;
    markScheduleSlotStarted(db, started.id, { instanceId: 'boot-a' });

    const recovered = claimRecoverableQueuedSlots(db, {
      instanceId: 'boot-b',
      cutoff: '2026-07-15T00:00:00.000Z',
    });

    assert.deepEqual(recovered.map((entry) => entry.id), [queued.id]);
    assert.equal(recovered[0].instanceId, 'boot-b');
    assert.equal(recovered[0].recoveryCount, 1);
    assert.deepEqual(claimRecoverableQueuedSlots(db, {
      instanceId: 'boot-b',
      cutoff: '2026-07-15T00:00:00.000Z',
    }), []);
    assert.equal(db.prepare('SELECT status FROM scheduler_task_slots WHERE id = ?').get(started.id).status, 'started');
  } finally {
    db.close();
  }
});

test('settled slots retain their outcome while cleanup removes only records older than three days', () => {
  const db = createLedger();
  try {
    const old = queueScheduleSlot(db, slot({ scheduledAt: '2026-07-10T00:01:00.000Z' })).slot;
    const current = queueScheduleSlot(db, slot({
      taskConfigId: 11,
      taskType: 'TREASURE_CLAIM',
      scheduledAt: '2026-07-17T00:01:00.000Z',
    })).slot;

    markScheduleSlotStarted(db, current.id, { instanceId: 'boot-a' });
    settleScheduleSlot(db, current.id, { outcome: 'ignored', message: '活动未开放' });
    cleanupScheduleSlots(db, { cutoff: '2026-07-15T00:00:00.000Z' });

    assert.equal(db.prepare('SELECT id FROM scheduler_task_slots WHERE id = ?').get(old.id), undefined);
    assert.deepEqual(
      db.prepare('SELECT status, message FROM scheduler_task_slots WHERE id = ?').get(current.id),
      { status: 'ignored', message: '活动未开放' },
    );
  } finally {
    db.close();
  }
});
