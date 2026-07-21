import { sanitizeObservationMessage } from '../observability/schedulerObservationCore.js';

const SETTLED_OUTCOMES = new Set(['success', 'ignored', 'error']);

function normalizePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return number;
}

function normalizeIdentifier(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized.slice(0, 160);
}

function normalizeTimestamp(value, label) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RangeError(`${label} is invalid`);
  return new Date(timestamp).toISOString();
}

function normalizeMessage(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return sanitizeObservationMessage(value, 300) || null;
}

function toSlot(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    taskConfigId: Number(row.task_config_id),
    accountId: Number(row.account_id),
    taskType: String(row.task_type || ''),
    scheduledAt: String(row.scheduled_at || ''),
    source: String(row.source || ''),
    instanceId: String(row.instance_id || ''),
    status: String(row.status || ''),
    recoveryCount: Number(row.recovery_count || 0),
    requeuedAt: row.requeued_at ?? null,
    message: row.message ?? null,
  };
}

function runStatement(targetDb, sql, params = []) {
  if (typeof targetDb?.prepare === 'function') {
    return targetDb.prepare(sql).run(...params);
  }
  return targetDb.run(sql, params);
}

function getStatement(targetDb, sql, params = []) {
  if (typeof targetDb?.prepare === 'function') {
    return targetDb.prepare(sql).get(...params);
  }
  return targetDb.get(sql, params);
}

function allStatement(targetDb, sql, params = []) {
  if (typeof targetDb?.prepare === 'function') {
    return targetDb.prepare(sql).all(...params);
  }
  return targetDb.all(sql, params);
}

const SLOT_COLUMNS = `
  id, task_config_id, account_id, task_type, scheduled_at, source, instance_id,
  status, recovery_count, requeued_at, message
`;

export function initializeScheduleSlotSchema(targetDb) {
  targetDb.exec(`
    CREATE TABLE IF NOT EXISTS scheduler_task_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_config_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      scheduled_at DATETIME NOT NULL,
      source TEXT NOT NULL,
      instance_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      recovery_count INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      requeued_at DATETIME,
      started_at DATETIME,
      settled_at DATETIME,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(task_config_id, scheduled_at)
    );
    CREATE INDEX IF NOT EXISTS idx_scheduler_task_slots_recovery
      ON scheduler_task_slots(status, scheduled_at, instance_id);
    CREATE INDEX IF NOT EXISTS idx_scheduler_task_slots_account
      ON scheduler_task_slots(account_id, scheduled_at);
  `);
  const columns = targetDb.prepare('PRAGMA table_info(scheduler_task_slots)').all();
  if (!columns.some((column) => column.name === 'requeued_at')) {
    targetDb.exec('ALTER TABLE scheduler_task_slots ADD COLUMN requeued_at DATETIME');
  }
}

export function queueScheduleSlot(targetDb, entry) {
  const taskConfigId = normalizePositiveInteger(entry?.taskConfigId, 'taskConfigId');
  const accountId = normalizePositiveInteger(entry?.accountId, 'accountId');
  const taskType = normalizeIdentifier(entry?.taskType, 'taskType');
  const scheduledAt = normalizeTimestamp(entry?.scheduledAt, 'scheduledAt');
  const source = normalizeIdentifier(entry?.source, 'source');
  const instanceId = normalizeIdentifier(entry?.instanceId, 'instanceId');

  const inserted = runStatement(targetDb, `
    INSERT INTO scheduler_task_slots (
      task_config_id, account_id, task_type, scheduled_at, source, instance_id, status
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued')
    ON CONFLICT(task_config_id, scheduled_at) DO NOTHING
  `, [taskConfigId, accountId, taskType, scheduledAt, source, instanceId]);

  const row = getStatement(targetDb, `
    SELECT ${SLOT_COLUMNS}
      FROM scheduler_task_slots
     WHERE task_config_id = ? AND scheduled_at = ?
  `, [taskConfigId, scheduledAt]);

  return { created: inserted.changes === 1, slot: toSlot(row) };
}

export function claimRecoverableQueuedSlots(targetDb, { instanceId, cutoff, limit = 500 } = {}) {
  const normalizedInstanceId = normalizeIdentifier(instanceId, 'instanceId');
  const normalizedCutoff = normalizeTimestamp(cutoff, 'cutoff');
  const normalizedLimit = Math.min(5_000, normalizePositiveInteger(limit, 'limit'));
  const transaction = targetDb.transaction(() => {
    const candidates = allStatement(targetDb, `
      SELECT ${SLOT_COLUMNS}
        FROM scheduler_task_slots
       WHERE status = 'queued'
         AND scheduled_at >= ?
         AND instance_id <> ?
       ORDER BY scheduled_at ASC, id ASC
       LIMIT ?
    `, [normalizedCutoff, normalizedInstanceId, normalizedLimit]);

    const claim = (id) => runStatement(targetDb, `
      UPDATE scheduler_task_slots
         SET instance_id = ?, source = 'scheduler-recovery', recovery_count = recovery_count + 1,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'queued' AND instance_id <> ?
    `, [normalizedInstanceId, id, normalizedInstanceId]);
    const recovered = [];
    for (const candidate of candidates) {
      if (claim(candidate.id).changes === 1) {
        recovered.push(toSlot(getStatement(targetDb, `SELECT ${SLOT_COLUMNS} FROM scheduler_task_slots WHERE id = ?`, [candidate.id])));
      }
    }
    return recovered;
  });

  return transaction();
}

export function markScheduleSlotStarted(targetDb, slotId, { instanceId } = {}) {
  const id = normalizePositiveInteger(slotId, 'slotId');
  const normalizedInstanceId = normalizeIdentifier(instanceId, 'instanceId');
  runStatement(targetDb, `
    UPDATE scheduler_task_slots
       SET status = 'started', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'queued' AND instance_id = ?
  `, [id, normalizedInstanceId]);
}

export function markScheduleSlotRequeued(targetDb, slotId, { instanceId } = {}) {
  const id = normalizePositiveInteger(slotId, 'slotId');
  const normalizedInstanceId = normalizeIdentifier(instanceId, 'instanceId');
  return runStatement(targetDb, `
    UPDATE scheduler_task_slots
       SET requeued_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'queued' AND instance_id = ?
  `, [id, normalizedInstanceId]).changes === 1;
}

export function settleInterruptedStartedSlots(targetDb, {
  instanceId,
  cutoff,
  message,
  limit = 500,
} = {}) {
  const normalizedInstanceId = normalizeIdentifier(instanceId, 'instanceId');
  const normalizedCutoff = normalizeTimestamp(cutoff, 'cutoff');
  const normalizedMessage = normalizeMessage(message);
  const normalizedLimit = Math.min(5_000, normalizePositiveInteger(limit, 'limit'));
  const transaction = targetDb.transaction(() => {
    const candidates = allStatement(targetDb, `
      SELECT ${SLOT_COLUMNS}
        FROM scheduler_task_slots
       WHERE status = 'started'
         AND scheduled_at >= ?
         AND instance_id <> ?
       ORDER BY scheduled_at ASC, id ASC
       LIMIT ?
    `, [normalizedCutoff, normalizedInstanceId, normalizedLimit]);
    const interrupted = [];

    for (const candidate of candidates) {
      const updated = runStatement(targetDb, `
        UPDATE scheduler_task_slots
           SET status = 'error', message = ?, settled_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'started' AND instance_id <> ?
      `, [normalizedMessage, candidate.id, normalizedInstanceId]);
      if (updated.changes === 1) interrupted.push({ ...candidate, status: 'error', message: normalizedMessage });
    }

    return interrupted.map(toSlot);
  });

  return transaction();
}

export function settleScheduleSlot(targetDb, slotId, { outcome, message } = {}) {
  const id = normalizePositiveInteger(slotId, 'slotId');
  if (!SETTLED_OUTCOMES.has(outcome)) throw new RangeError('outcome is invalid');
  runStatement(targetDb, `
    UPDATE scheduler_task_slots
       SET status = ?, message = ?, settled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status IN ('queued', 'started')
  `, [outcome, normalizeMessage(message), id]);
}

export function cleanupScheduleSlots(targetDb, { cutoff } = {}) {
  const normalizedCutoff = normalizeTimestamp(cutoff, 'cutoff');
  return runStatement(targetDb, 'DELETE FROM scheduler_task_slots WHERE scheduled_at < ?', [normalizedCutoff]).changes;
}

export function queryScheduleSlotSummary(targetDb, { cutoff } = {}) {
  const normalizedCutoff = normalizeTimestamp(cutoff, 'cutoff');
  const row = getStatement(targetDb, `
    SELECT COUNT(*) AS total_count,
           SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued_count,
           SUM(CASE WHEN status = 'started' THEN 1 ELSE 0 END) AS started_count,
           SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
           SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) AS ignored_count,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
           SUM(CASE WHEN requeued_at IS NOT NULL THEN 1 ELSE 0 END) AS recovered_count,
           SUM(CASE WHEN message = '任务漏做：服务重启时任务已开始，未自动重放' THEN 1 ELSE 0 END) AS interrupted_count,
           SUM(CASE WHEN message = '任务漏做：服务重启后任务配置不可用，未自动恢复' THEN 1 ELSE 0 END) AS unavailable_count
      FROM scheduler_task_slots
     WHERE scheduled_at >= ?
  `, [normalizedCutoff]) || {};

  return {
    totalCount: Number(row.total_count || 0),
    queuedCount: Number(row.queued_count || 0),
    startedCount: Number(row.started_count || 0),
    successCount: Number(row.success_count || 0),
    ignoredCount: Number(row.ignored_count || 0),
    errorCount: Number(row.error_count || 0),
    recoveredCount: Number(row.recovered_count || 0),
    interruptedCount: Number(row.interrupted_count || 0),
    unavailableCount: Number(row.unavailable_count || 0),
  };
}
