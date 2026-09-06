const SHANGHAI_TIMEZONE = 'Asia/Shanghai';
const DEFERRED_RUN_CLAIM_LEASE_MS = 15 * 60 * 1000;
const AUTOMATIC_SOURCES = new Set(['scheduler', 'scheduler-catchup', 'batch']);

function getShanghaiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(date);

  return Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
}

function toBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (value === false || value === 0 || value === '0' || value === 'false') {
    return false;
  }
  return true;
}

export function isSaturdaySchedulerBlackout(date = new Date()) {
  const parts = getShanghaiDateParts(date);
  return parts.weekday === 'Sat' && Number(parts.hour) === 20;
}

export function getSaturdayBlackoutReleaseAt(date = new Date()) {
  const parts = getShanghaiDateParts(date);
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    13,
    0,
    0,
  ));
}

export function getSaturdayBlackoutDelayMs(now = new Date()) {
  if (!isSaturdaySchedulerBlackout(now)) {
    return 0;
  }
  return Math.max(0, getSaturdayBlackoutReleaseAt(now).getTime() - now.getTime());
}

export function getDeferredRunClaimExpiresAt(claimedAt) {
  const claimedAtDate = claimedAt instanceof Date ? claimedAt : new Date(claimedAt);
  if (Number.isNaN(claimedAtDate.getTime())) {
    throw new Error('Invalid deferred-run claim timestamp');
  }
  return new Date(claimedAtDate.getTime() + DEFERRED_RUN_CLAIM_LEASE_MS);
}

export function normalizeSaturdaySchedulerPolicy(policy = {}) {
  return {
    saturdayBlackoutEnabled: toBoolean(
      policy.saturdayBlackoutEnabled ?? policy.saturday_blackout_enabled,
      true,
    ),
  };
}

export function shouldDeferAutomaticExecution({
  source,
  policy,
  now = new Date(),
} = {}) {
  return AUTOMATIC_SOURCES.has(source)
    && normalizeSaturdaySchedulerPolicy(policy).saturdayBlackoutEnabled
    && isSaturdaySchedulerBlackout(now);
}

export function buildDeferredRunIdentity({
  businessDate,
  source,
  taskConfigId = null,
  batchTaskId = null,
  plannedAt,
} = {}) {
  return [
    String(businessDate || ''),
    String(source || ''),
    taskConfigId ?? '',
    batchTaskId ?? '',
    String(plannedAt || ''),
  ].join('|');
}

export function sortDeferredRuns(records = []) {
  return [...records].sort((left, right) => {
    const plannedAtOrder = String(left?.planned_at || left?.plannedAt || '')
      .localeCompare(String(right?.planned_at || right?.plannedAt || ''));
    if (plannedAtOrder !== 0) {
      return plannedAtOrder;
    }
    return Number(left?.id || 0) - Number(right?.id || 0);
  });
}

export { DEFERRED_RUN_CLAIM_LEASE_MS, SHANGHAI_TIMEZONE };
