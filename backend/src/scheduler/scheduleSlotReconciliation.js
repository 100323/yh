import { findLatestDueScheduleSlot } from './scheduleDueSlot.js';
import { queueScheduleSlot, settleScheduleSlot } from './scheduleSlotLedger.js';

export const SCHEDULE_SLOT_RECONCILE_SOURCE = 'scheduler-reconcile';
export const SCHEDULE_SLOT_RECONCILE_MESSAGE = '任务漏做：定时回调未触发，已由分钟对账重新入队';

function writeLogSafely(addLog, ...args) {
  try {
    addLog?.(...args);
  } catch {
    // A diagnostic log must never prevent the durable task from being dispatched.
  }
}

function parseDatabaseTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return Number.NaN;
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = hasExplicitZone ? raw : `${raw.replace(' ', 'T')}Z`;
  return Date.parse(normalized);
}

function recordEnqueueFailure({ database, slot, error, addLog, settleSlot }) {
  const message = `任务漏做：分钟对账入队失败：${error?.message || String(error)}`;
  settleSlot(database, slot.id, { outcome: 'error', message });
  writeLogSafely(addLog, slot.accountId, slot.taskType, 'missed', message);
}

export function reconcileMissingScheduleSlots(options = {}) {
  const {
    database,
    tasks = [],
    instanceId,
    now = new Date(),
    graceMs = 60_000,
    lookbackDays = 1,
    maxLookbackMs = 60 * 60 * 1000,
    notBefore = null,
    seenSlots = new Map(),
    getCronExpressions = (task) => [task?.cron_expression],
    queueSlot = queueScheduleSlot,
    settleSlot = settleScheduleSlot,
    enqueueTask,
    addLog,
  } = options;
  const result = {
    scannedCount: Array.isArray(tasks) ? tasks.length : 0,
    dueCount: 0,
    createdCount: 0,
    duplicateCount: 0,
    cachedCount: 0,
    failedCount: 0,
  };

  if (!database || !Array.isArray(tasks) || typeof enqueueTask !== 'function') {
    return result;
  }
  const notBeforeTime = parseDatabaseTimestamp(notBefore);

  for (const task of tasks) {
    let dueSlot;
    try {
      dueSlot = findLatestDueScheduleSlot(getCronExpressions(task), {
        now,
        graceMs,
        lookbackDays,
        maxLookbackMs,
      });
    } catch {
      result.failedCount += 1;
      continue;
    }
    if (!dueSlot) continue;

    result.dueCount += 1;
    const taskConfigId = Number(task?.id);
    if (seenSlots.get(taskConfigId) === dueSlot.scheduledAt) {
      result.cachedCount += 1;
      continue;
    }
    if (Number.isFinite(notBeforeTime) && Date.parse(dueSlot.scheduledAt) < notBeforeTime) {
      seenSlots.set(taskConfigId, dueSlot.scheduledAt);
      continue;
    }
    const createdAt = parseDatabaseTimestamp(task?.created_at);
    if (Number.isFinite(createdAt) && createdAt > Date.parse(dueSlot.scheduledAt)) {
      seenSlots.set(taskConfigId, dueSlot.scheduledAt);
      continue;
    }

    try {
      const queued = queueSlot(database, {
        taskConfigId,
        accountId: Number(task?.account_id),
        taskType: task?.task_type,
        scheduledAt: dueSlot.scheduledAt,
        source: SCHEDULE_SLOT_RECONCILE_SOURCE,
        instanceId,
      });
      seenSlots.set(taskConfigId, dueSlot.scheduledAt);

      if (!queued.created) {
        result.duplicateCount += 1;
        continue;
      }

      result.createdCount += 1;
      writeLogSafely(
        addLog,
        queued.slot.accountId,
        queued.slot.taskType,
        'missed',
        SCHEDULE_SLOT_RECONCILE_MESSAGE,
      );

      try {
        const pending = enqueueTask(task, {
          source: SCHEDULE_SLOT_RECONCILE_SOURCE,
          now,
          scheduleSlot: queued.slot,
        });
        Promise.resolve(pending).catch((error) => {
          recordEnqueueFailure({ database, slot: queued.slot, error, addLog, settleSlot });
        });
      } catch (error) {
        result.failedCount += 1;
        recordEnqueueFailure({ database, slot: queued.slot, error, addLog, settleSlot });
      }
    } catch (error) {
      result.failedCount += 1;
      writeLogSafely(
        addLog,
        Number(task?.account_id),
        task?.task_type,
        'missed',
        `任务漏做：分钟对账创建槽位失败：${error?.message || String(error)}`,
      );
    }
  }

  return result;
}
