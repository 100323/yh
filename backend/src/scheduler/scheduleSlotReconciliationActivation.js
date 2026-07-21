export const SCHEDULER_RECONCILIATION_ACTIVATED_AT_KEY = 'scheduler_reconciliation_activated_at';

export function resolveSchedulerReconciliationActivatedAt({
  now = new Date(),
  getValue,
  setValue,
} = {}) {
  const stored = typeof getValue === 'function'
    ? getValue(SCHEDULER_RECONCILIATION_ACTIVATED_AT_KEY, null)
    : null;
  const storedTime = Date.parse(stored);
  if (Number.isFinite(storedTime)) {
    return new Date(storedTime).toISOString();
  }

  const activation = now instanceof Date ? new Date(now) : new Date(now || Date.now());
  if (Number.isNaN(activation.getTime())) {
    throw new RangeError('scheduler reconciliation activation time is invalid');
  }
  const activatedAt = activation.toISOString();
  if (typeof setValue !== 'function') {
    throw new TypeError('scheduler reconciliation activation cannot be persisted');
  }
  setValue(SCHEDULER_RECONCILIATION_ACTIVATED_AT_KEY, activatedAt);
  return activatedAt;
}
