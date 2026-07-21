import {
  claimRecoverableQueuedSlots,
  markScheduleSlotRequeued,
  settleInterruptedStartedSlots,
  settleScheduleSlot,
} from './scheduleSlotLedger.js';

const UNAVAILABLE_MESSAGE = '任务漏做：服务重启后任务配置不可用，未自动恢复';
const RECOVERED_MESSAGE = '任务漏做：服务重启后已重新入队';
const INTERRUPTED_MESSAGE = '任务漏做：服务重启时任务已开始，未自动重放';

function writeLogSafely(addLog, ...args) {
  try {
    addLog?.(...args);
  } catch {
    // Recovery must not depend on the optional observation log path.
  }
}

export function recordRecoveredEnqueueFailure({ database, slot, error, addLog } = {}) {
  const message = `任务恢复入队后执行失败：${error?.message || String(error)}`;
  settleScheduleSlot(database, slot.id, { outcome: 'error', message });
  writeLogSafely(addLog, slot.accountId, slot.taskType, 'missed', message);
  return message;
}

export async function recoverQueuedScheduleSlots({
  database,
  instanceId,
  cutoff,
  loadTask,
  enqueueTask,
  addLog,
} = {}) {
  let recoveredCount = 0;
  let unavailableCount = 0;
  let interruptedCount = 0;

  const writeLog = (...args) => writeLogSafely(addLog, ...args);

  while (true) {
    const slots = claimRecoverableQueuedSlots(database, { instanceId, cutoff });
    if (slots.length === 0) break;

    for (const slot of slots) {
      try {
        const task = await loadTask(slot.taskConfigId);
        if (!task) {
          settleScheduleSlot(database, slot.id, { outcome: 'ignored', message: UNAVAILABLE_MESSAGE });
          writeLog(slot.accountId, slot.taskType, 'missed', UNAVAILABLE_MESSAGE);
          unavailableCount += 1;
          continue;
        }

        writeLog(slot.accountId, slot.taskType, 'missed', RECOVERED_MESSAGE);
        await enqueueTask(task, {
          source: 'scheduler-recovery',
          scheduleSlot: slot,
        });
        markScheduleSlotRequeued(database, slot.id, { instanceId });
        recoveredCount += 1;
      } catch (error) {
        const message = `任务恢复入队失败：${error?.message || String(error)}`;
        settleScheduleSlot(database, slot.id, { outcome: 'error', message });
        writeLog(slot.accountId, slot.taskType, 'missed', message);
      }
    }
  }

  while (true) {
    const interruptedSlots = settleInterruptedStartedSlots(database, {
      instanceId,
      cutoff,
      message: INTERRUPTED_MESSAGE,
    });
    if (interruptedSlots.length === 0) break;
    for (const slot of interruptedSlots) {
      writeLog(slot.accountId, slot.taskType, 'missed', INTERRUPTED_MESSAGE);
      interruptedCount += 1;
    }
  }

  return { recoveredCount, unavailableCount, interruptedCount };
}
