import config from '../config/index.js';
import {
  getSchedulerAccountDispatchIntervalMsSetting,
  getSchedulerMaxConcurrentAccountsSetting,
} from './systemSettings.js';

const accountTaskChains = new Map();
const accountClients = new Map();
const queuedAccounts = [];
const taskTypeChains = new Map();
const taskTypeNextAllowedAt = new Map();
let activeAccountExecutions = 0;
let queuedDispatchTimer = null;
let queuedDispatchScheduledAt = null;

function normalizeAccountId(accountId) {
  return String(accountId);
}

function getMaxConcurrentAccounts() {
  try {
    return getSchedulerMaxConcurrentAccountsSetting();
  } catch {
    const value = Number(config?.scheduler?.maxConcurrentAccounts || 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 3;
  }
}

function getTaskTypeThrottleMs(taskType) {
  const value = Number(config?.scheduler?.sensitiveTaskThrottleMs?.[String(taskType || '')] || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getAccountDispatchIntervalMs() {
  try {
    return getSchedulerAccountDispatchIntervalMsSetting();
  } catch {
    const value = Number(config?.scheduler?.accountDispatchIntervalMs || 0);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 8000;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function scheduleQueuedAccountDispatch(delayMs = getAccountDispatchIntervalMs()) {
  if (queuedDispatchTimer || queuedAccounts.length === 0) {
    return;
  }
  if (activeAccountExecutions >= getMaxConcurrentAccounts()) {
    return;
  }

  const normalizedDelay = Math.max(0, Number(delayMs) || 0);
  queuedDispatchScheduledAt = Date.now() + normalizedDelay;
  queuedDispatchTimer = setTimeout(() => {
    queuedDispatchTimer = null;
    queuedDispatchScheduledAt = null;
    dispatchQueuedAccounts();
  }, normalizedDelay);
}

function dispatchQueuedAccounts() {
  const limit = getMaxConcurrentAccounts();
  while (activeAccountExecutions < limit && queuedAccounts.length > 0) {
    const queued = queuedAccounts.shift();
    activeAccountExecutions += 1;
    queued.resolve();
  }

  if (queuedAccounts.length > 0 && activeAccountExecutions < limit) {
    scheduleQueuedAccountDispatch();
  }
}

async function acquireGlobalAccountSlot(accountId) {
  const key = normalizeAccountId(accountId);
  const limit = getMaxConcurrentAccounts();

  if (activeAccountExecutions < limit && queuedAccounts.length === 0) {
    activeAccountExecutions += 1;
    return;
  }

  await new Promise((resolve) => {
    queuedAccounts.push({
      accountId: key,
      queuedAt: Date.now(),
      resolve,
    });
    scheduleQueuedAccountDispatch();
  });
}

function releaseGlobalAccountSlot() {
  activeAccountExecutions = Math.max(0, activeAccountExecutions - 1);
  scheduleQueuedAccountDispatch();
}

export async function runAccountTaskExclusive(accountId, taskExecutor) {
  const key = normalizeAccountId(accountId);
  const previous = accountTaskChains.get(key) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      await acquireGlobalAccountSlot(key);
      try {
        return await taskExecutor();
      } finally {
        releaseGlobalAccountSlot();
      }
    });

  accountTaskChains.set(key, current);
  try {
    return await current;
  } finally {
    if (accountTaskChains.get(key) === current) {
      accountTaskChains.delete(key);
    }
  }
}

export async function runTaskTypeThrottled(taskType, context = {}, taskExecutor) {
  const normalizedTaskType = String(taskType || '').trim();
  const throttleMs = getTaskTypeThrottleMs(normalizedTaskType);
  if (!normalizedTaskType || throttleMs <= 0) {
    return await taskExecutor();
  }

  const previous = taskTypeChains.get(normalizedTaskType) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      const waitMs = Math.max(0, (taskTypeNextAllowedAt.get(normalizedTaskType) || 0) - Date.now());
      if (waitMs > 0) {
        console.log('⏳ 敏感任务节流等待', {
          taskType: normalizedTaskType,
          throttleMs,
          waitMs,
          accountId: context.accountId ?? null,
          accountName: context.accountName || null,
          source: context.source || null,
        });
        await sleep(waitMs);
      }

      taskTypeNextAllowedAt.set(normalizedTaskType, Date.now() + throttleMs);
      return await taskExecutor();
    });

  taskTypeChains.set(normalizedTaskType, current);
  try {
    return await current;
  } finally {
    if (taskTypeChains.get(normalizedTaskType) === current) {
      taskTypeChains.delete(normalizedTaskType);
    }
  }
}

export function isAccountTaskRunning(accountId) {
  return accountTaskChains.has(normalizeAccountId(accountId));
}

export function registerAccountClient(accountId, client) {
  if (!client) return;
  const key = normalizeAccountId(accountId);
  const existingSet = accountClients.get(key) || new Set();

  for (const existingClient of existingSet) {
    if (existingClient === client) continue;
    try {
      existingClient.disconnect?.();
    } catch {
      // ignore
    }
    existingSet.delete(existingClient);
  }

  existingSet.add(client);
  accountClients.set(key, existingSet);
}

export function unregisterAccountClient(accountId, client = null) {
  const key = normalizeAccountId(accountId);
  if (!accountClients.has(key)) {
    return;
  }

  if (!client) {
    accountClients.delete(key);
    return;
  }

  const clientSet = accountClients.get(key);
  clientSet.delete(client);
  if (clientSet.size === 0) {
    accountClients.delete(key);
  }
}

export function getAccountTaskCoordinatorStatus() {
  return {
    maxConcurrentAccounts: getMaxConcurrentAccounts(),
    accountDispatchIntervalMs: getAccountDispatchIntervalMs(),
    activeAccountExecutions,
    queuedAccountExecutions: queuedAccounts.length,
    queuedDispatchScheduledAt,
    runningAccountChains: accountTaskChains.size,
    queuedAccounts: queuedAccounts.map((item) => item.accountId),
    throttledTaskTypes: Array.from(taskTypeNextAllowedAt.entries()).map(([taskType, nextAllowedAt]) => ({
      taskType,
      nextAllowedAt,
    })),
  };
}

export function clearAccountTaskCoordinator() {
  accountTaskChains.clear();
  accountClients.clear();
  taskTypeChains.clear();
  taskTypeNextAllowedAt.clear();
  queuedAccounts.length = 0;
  activeAccountExecutions = 0;
  if (queuedDispatchTimer) {
    clearTimeout(queuedDispatchTimer);
    queuedDispatchTimer = null;
  }
  queuedDispatchScheduledAt = null;
}
