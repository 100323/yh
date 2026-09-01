import { all, get, run } from '../database/index.js';
import {
  buildDeferredRunIdentity,
  DEFERRED_RUN_CLAIM_LEASE_MS,
  getSaturdayBlackoutReleaseAt,
  normalizeSaturdaySchedulerPolicy,
  sortDeferredRuns,
} from './saturdaySchedulerBlackout.js';

function toShanghaiBusinessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function toIsoString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid deferred-run timestamp');
  }
  return date.toISOString();
}

export function getSaturdaySchedulerPolicy(userId) {
  const row = get(
    'SELECT saturday_blackout_enabled FROM scheduler_execution_policies WHERE user_id = ? LIMIT 1',
    [userId],
  );
  return normalizeSaturdaySchedulerPolicy(row || {});
}

export function updateSaturdaySchedulerPolicy(userId, saturdayBlackoutEnabled) {
  const normalized = normalizeSaturdaySchedulerPolicy({ saturdayBlackoutEnabled });
  run(
    `INSERT INTO scheduler_execution_policies (user_id, saturday_blackout_enabled, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       saturday_blackout_enabled = excluded.saturday_blackout_enabled,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, normalized.saturdayBlackoutEnabled ? 1 : 0],
  );
  return normalized;
}

export function deferScheduledRun({
  userId,
  source,
  taskConfigId = null,
  batchTaskId = null,
  accountId = null,
  taskType = null,
  plannedAt = new Date(),
  now = new Date(),
} = {}) {
  const plannedAtIso = toIsoString(plannedAt);
  const businessDate = toShanghaiBusinessDate(plannedAt);
  const deferredIdentity = buildDeferredRunIdentity({
    businessDate,
    source,
    taskConfigId,
    batchTaskId,
    plannedAt: plannedAtIso,
  });
  const releaseAt = getSaturdayBlackoutReleaseAt(now).toISOString();

  run(
    `INSERT INTO scheduler_deferred_runs (
       deferred_identity, user_id, source, task_config_id, batch_task_id,
       account_id, task_type, planned_at, release_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(deferred_identity) DO NOTHING`,
    [
      deferredIdentity,
      userId,
      source,
      taskConfigId,
      batchTaskId,
      accountId,
      taskType,
      plannedAtIso,
      releaseAt,
    ],
  );

  return get(
    'SELECT * FROM scheduler_deferred_runs WHERE deferred_identity = ? LIMIT 1',
    [deferredIdentity],
  );
}

export function listReplayableDeferredRuns(now = new Date()) {
  const staleClaimCutoff = new Date(now.getTime() - DEFERRED_RUN_CLAIM_LEASE_MS);
  run(
    `UPDATE scheduler_deferred_runs
        SET status = 'pending', claimed_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE status = 'running' AND datetime(claimed_at) <= datetime(?)`,
    [toIsoString(staleClaimCutoff)],
  );

  const rows = all(
    `SELECT * FROM scheduler_deferred_runs
      WHERE status = 'pending' AND datetime(release_at) <= datetime(?)
      ORDER BY datetime(planned_at) ASC, id ASC`,
    [toIsoString(now)],
  );
  return sortDeferredRuns(rows);
}

export function claimDeferredRun(id, now = new Date()) {
  const result = run(
    `UPDATE scheduler_deferred_runs
        SET status = 'running', claimed_at = ?, attempt_count = attempt_count + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`,
    [toIsoString(now), id],
  );
  return Number(result?.changes || 0) === 1;
}

export function completeDeferredRun(id) {
  run(
    `UPDATE scheduler_deferred_runs
        SET status = 'completed', completed_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'running'`,
    [id],
  );
}

export function releaseDeferredRun(id, error) {
  run(
    `UPDATE scheduler_deferred_runs
        SET status = 'pending', claimed_at = NULL, last_error = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'running'`,
    [String(error?.message || error || 'Deferred run failed').slice(0, 500), id],
  );
}
