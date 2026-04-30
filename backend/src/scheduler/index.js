import cron from 'node-cron';
import {
  getEnabledTasks,
  updateTaskRunTime,
  updateTaskRunTimesBatch,
  markTaskRunTime,
  addTaskLog,
  ensureDefaultTaskConfigsForAllAccounts,
  rebalanceDefaultTaskCronExpressions,
} from '../routes/tasks.js';
import { get, all } from '../database/index.js';
import { decrypt } from '../utils/crypto.js';
import GameClient from '../utils/gameClient.js';
import config from '../config/index.js';
import { resolveStudyAnswer } from '../utils/studyQuestions.js';
import { parseTokenPayload } from '../utils/token.js';
import { calculateNextRunAt, parseCronField } from '../utils/cronSchedule.js';
import {
  buildCarClaimTaskMessage,
  buildCarSendTaskMessage,
  executeArenaScheduledTask,
  executeMailClaimScheduledTask,
  executeDailyTaskClaimScheduledTask,
  executeLegacyClaimWithAutoReopen,
  normalizeSmartSendCarOptions,
  runWithTemporaryPresetTeam,
} from '../utils/scheduledTaskHelpers.js';
import {
  runAccountTaskExclusive,
  isAccountTaskRunning,
  registerAccountClient,
  unregisterAccountClient,
  runTaskTypeThrottled,
} from '../utils/accountTaskCoordinator.js';
import { getUserAvailabilityStatus } from '../utils/userAccess.js';
import {
  buildWsLogContext,
  normalizeDisconnectInfo,
  normalizeErrorMessage,
} from '../utils/wsDiagnostics.js';
import { warmupGameClient } from '../utils/wsWarmup.js';
import { getRefreshedTokenSessionFromStoredBin } from '../utils/accountTokenRefresh.js';
import {
  getSensitiveTaskRetryConfig,
  getWsReconnectRetryConfig,
  computeDeterministicDelayMs,
  isTooFastError,
  sleep,
} from '../utils/taskExecutionControl.js';
import {
  executeStudyChallenge,
} from '../utils/studyTask.js';

const activeConnections = new Map();
const scheduledJobs = new Map();
const connectionPromises = new Map();
const dailyRewardFlushState = new Map();
const pendingAccountTaskBatches = new Map();
let schedulerRefreshJob = null;
let dailyCatchupJob = null;
const DAILY_REWARD_FLUSH_DELAY_MS = 15000;
const DAILY_REWARD_RETRY_DELAY_MS = 30000;
const DAILY_REWARD_MAX_RETRIES = 3;
const ACCOUNT_BATCH_MIN_DELAY_MS = 1500;
const DAILY_POINT_TASK_ID_MAP = {
  SIGN_IN: [1],
  HANGUP_ADD_TIME: [2],
  FRIEND_GOLD: [3],
  RECRUIT: [4],
  HANGUP_CLAIM: [5],
  BUY_GOLD: [6],
  BOX_OPEN: [7],
  ARENA: [8],
  BOTTLE_RESET: [9],
  BOTTLE_CLAIM: [9],
  BLACK_MARKET: [12],
};

const DAILY_REWARD_DIRTY_TASKS = new Set([
  'SIGN_IN',
  'FRIEND_GOLD',
  'RECRUIT',
  'BUY_GOLD',
  'BOX_OPEN',
  'ARENA',
  'BOTTLE_CLAIM',
  'BLACK_MARKET'
]);
const SENSITIVE_TASK_TYPES = new Set(['HANGUP_ADD_TIME', 'LEGACY_CLAIM']);
const TASK_EXTRA_CRON_EXPRESSIONS = {
  LEGION_STORE_FRAGMENT: ['0 10 * * 0'],
};
const DAILY_CATCHUP_CRON = '15 19 * * *';
const DAILY_CATCHUP_CUTOFF_HOUR = 19;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const STAR_TEMPLE_BOSS_IDS = [1, 2, 3, 4, 5, 6, 7, 8];
const STAR_TEMPLE_COMMAND_DELAY_MS = 300;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getShanghaiDateParts(date = new Date()) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    dayOfWeek: shifted.getUTCDay(),
  };
}

function formatShanghaiLocalDateTime(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second ?? 0)}`;
}

function toShanghaiLocalDateTimeString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return formatShanghaiLocalDateTime(getShanghaiDateParts(date));
}

function buildWsTokenPayload(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return '';

  const now = Date.now();
  const sessId = now * 100 + Math.floor(Math.random() * 100);
  const connId = now + Math.floor(Math.random() * 10);

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.roleToken) {
      return JSON.stringify({
        ...parsed,
        sessId,
        connId,
        isRestore: 0,
        version: parsed.version || config.game.clientVersion,
      });
    }
  } catch {
    // ignore
  }

  return JSON.stringify({
    roleToken: raw,
    sessId,
    connId,
    isRestore: 0,
    version: config.game.clientVersion,
  });
}

function resolveWsUrl(wsUrl, token) {
  const raw = typeof wsUrl === 'string' ? wsUrl.trim() : '';
  const payload = buildWsTokenPayload(token);
  if (!raw) {
    return `${config.game.wsUrl}?p=${encodeURIComponent(payload)}&e=x&lang=chinese`;
  }
  if (raw.includes('{token}')) {
    return raw.replace(/\{token\}/g, encodeURIComponent(payload));
  }
  try {
    const url = new URL(raw);
    url.searchParams.set('p', payload);
    if (!url.searchParams.has('e')) url.searchParams.set('e', 'x');
    if (!url.searchParams.has('lang')) url.searchParams.set('lang', 'chinese');
    return url.toString();
  } catch {
    // 继续走兼容拼接
  }
  if (raw.includes('p=')) {
    return raw.replace(/([?&])p=[^&]*/i, `$1p=${encodeURIComponent(payload)}`);
  }
  const sep = raw.includes('?') ? '&' : '?';
  return `${raw}${sep}p=${encodeURIComponent(payload)}&e=x&lang=chinese`;
}

function getTaskCronExpressions(task) {
  const primaryCron = String(task?.cron_expression || '').trim();
  const extras = TASK_EXTRA_CRON_EXPRESSIONS[String(task?.task_type || '').trim()] || [];
  return Array.from(new Set([primaryCron, ...extras].filter(Boolean)));
}

function getTaskCronSignature(task) {
  return getTaskCronExpressions(task).join('||');
}

function getTaskNextRunAt(task) {
  const nextRuns = getTaskCronExpressions(task)
    .map((cronExpression) => calculateNextRunAt(cronExpression))
    .filter(Boolean)
    .sort();
  return nextRuns[0] || null;
}

function shouldIgnoreFailure(error) {
  const message = String(error?.message || '');
  return [
    '模块未开启',
    '活动未开放',
    '不在开启时间内',
    '出了点小问题',
    '扫荡条件不满足',
    '已经选择过上阵武将了',
    '今日已领取免费奖励',
    '今天已经签到过了',
  ].some((keyword) => message.includes(keyword));
}

function isRetryableWsError(error) {
  const message = String(error?.message || error || '');
  return message.includes('WebSocket未连接') || message.includes('WebSocket连接已断开');
}

function getCronExecutionSlotsForToday(cronExpression, now = new Date()) {
  const parts = String(cronExpression || '').trim().split(/\s+/);
  if (parts.length !== 5) return [];

  const [minuteField, hourField, dayOfMonthField, monthField, dayOfWeekField] = parts;
  const minutes = parseCronField(minuteField, 0, 59);
  const hours = parseCronField(hourField, 0, 23);
  const daysOfMonth = parseCronField(dayOfMonthField, 1, 31);
  const months = parseCronField(monthField, 1, 12);
  const daysOfWeek = parseCronField(dayOfWeekField, 0, 7).map((value) => (value === 7 ? 0 : value));
  const shanghaiParts = getShanghaiDateParts(now);
  const todayMonth = shanghaiParts.month;
  const todayDayOfMonth = shanghaiParts.day;
  const todayDayOfWeek = shanghaiParts.dayOfWeek;

  if (
    !minutes.length ||
    !hours.length ||
    !daysOfMonth.length ||
    !months.length ||
    !daysOfWeek.length ||
    !months.includes(todayMonth) ||
    !daysOfMonth.includes(todayDayOfMonth) ||
    !daysOfWeek.includes(todayDayOfWeek)
  ) {
    return [];
  }

  const pairs = [];

  for (const hour of hours) {
    for (const minute of minutes) {
      pairs.push({ hour, minute, cronExpression });
    }
  }

  return pairs.sort((a, b) => (a.hour - b.hour) || (a.minute - b.minute));
}

function getTodayTaskLogSnapshots(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return new Map();
  }

  const uniquePairs = new Map();
  tasks.forEach((task) => {
    const accountId = Number(task?.account_id || 0);
    const taskType = String(task?.task_type || '').trim();
    if (!accountId || !taskType) return;
    uniquePairs.set(`${accountId}_${taskType}`, { accountId, taskType });
  });

  if (uniquePairs.size === 0) {
    return new Map();
  }

  const whereClauses = [];
  const params = [];
  uniquePairs.forEach(({ accountId, taskType }) => {
    whereClauses.push('(account_id = ? AND task_type = ?)');
    params.push(accountId, taskType);
  });

  const rows = all(
    `SELECT account_id, task_type, status, message, created_at,
            datetime(created_at, '+8 hours') AS local_created_at
       FROM task_logs
      WHERE datetime(created_at, '+8 hours') >= date('now', '+8 hours')
        AND datetime(created_at, '+8 hours') < datetime(date('now', '+8 hours'), '+1 day')
        AND (${whereClauses.join(' OR ')})
      ORDER BY created_at DESC, id DESC`,
    params,
  );

  const snapshotMap = new Map();
  for (const row of rows) {
    const key = `${row.account_id}_${row.task_type}`;
    if (!snapshotMap.has(key)) {
      snapshotMap.set(key, row);
    }
  }
  return snapshotMap;
}

function getTodayTaskExecutionMarkerSnapshots() {
  const rows = all(
    `SELECT account_id, task_type, latest_status, latest_message, latest_details, executed_at,
            datetime(executed_at, '+8 hours') AS local_executed_at
       FROM task_execution_markers
      WHERE business_date = date('now', '+8 hours')
      ORDER BY datetime(executed_at) DESC, id DESC`,
  );

  const snapshotMap = new Map();
  for (const row of rows) {
    const key = `${row.account_id}_${row.task_type}`;
    if (!snapshotMap.has(key)) {
      snapshotMap.set(key, row);
    }
  }
  return snapshotMap;
}

function getLatestDueSlotForToday(task, now = new Date()) {
  const cronExpressions = getTaskCronExpressions(task);
  if (cronExpressions.length === 0) {
    return null;
  }

  const pairs = cronExpressions.flatMap((cronExpression) => getCronExecutionSlotsForToday(cronExpression, now));
  if (pairs.length === 0) {
    return null;
  }

  const catchupGraceMs = Math.max(0, Number(config?.scheduler?.staggerWindowMs) || 0);
  const readyBoundary = new Date(now.getTime() - catchupGraceMs);
  const nowLocal = formatShanghaiLocalDateTime(getShanghaiDateParts(readyBoundary));
  const shanghaiParts = getShanghaiDateParts(now);
  let latestSlot = null;

  for (const { hour, minute } of pairs) {
    const slot = `${shanghaiParts.year}-${pad2(shanghaiParts.month)}-${pad2(shanghaiParts.day)} ${pad2(hour)}:${pad2(minute)}:00`;
    if (slot <= nowLocal && (!latestSlot || slot > latestSlot)) {
      latestSlot = slot;
    }
  }

  return latestSlot;
}

function collectDailyCatchupTasks(tasks, cutoffHour = DAILY_CATCHUP_CUTOFF_HOUR, now = new Date()) {
  const todayMarkerSnapshots = getTodayTaskExecutionMarkerSnapshots();
  const tasksWithoutMarker = tasks.filter((task) => {
    const key = `${task.account_id}_${task.task_type}`;
    return !todayMarkerSnapshots.has(key);
  });
  const todayLogSnapshots = getTodayTaskLogSnapshots(tasksWithoutMarker);
  const missingTasks = [];
  const failedTasks = [];

  for (const task of tasks) {
    const key = `${task.account_id}_${task.task_type}`;
    const latestMarker = todayMarkerSnapshots.get(key);
    const latestLog = latestMarker ? null : todayLogSnapshots.get(key);
    const latestDueSlot = getLatestDueSlotForToday(task, now);
    if (!latestDueSlot) {
      continue;
    }
    const latestMarkerAt = latestMarker?.local_executed_at || null;
    const latestLogAt = latestLog?.local_created_at || null;
    const lastRunAt = toShanghaiLocalDateTimeString(task?.last_run_at || null);
    const latestEvidenceAt = [latestMarkerAt, latestLogAt, lastRunAt]
      .filter(Boolean)
      .sort()
      .at(-1) || null;
    const latestStatus = String(latestMarker?.latest_status || latestLog?.status || '');
    const latestMessage = latestMarker?.latest_message || latestLog?.message || '';

    if (!latestEvidenceAt) {
      missingTasks.push({
        ...task,
        catchupReason: 'missing_today_log',
        catchupExpectedAt: latestDueSlot,
      });
      continue;
    }

    if (latestDueSlot && latestEvidenceAt < latestDueSlot) {
      missingTasks.push({
        ...task,
        catchupReason: 'missing_latest_due_slot',
        catchupExpectedAt: latestDueSlot,
        catchupLastMessage: latestMessage,
        catchupLastLogAt: latestMarkerAt || latestLogAt,
      });
      continue;
    }

    if (latestStatus === 'error') {
      failedTasks.push({
        ...task,
        catchupReason: 'latest_error',
        catchupExpectedAt: latestDueSlot,
        catchupLastMessage: latestMessage,
        catchupLastLogAt: latestMarkerAt || latestLogAt,
      });
    }
  }

  return {
    missingTasks,
    failedTasks,
    tasks: [...missingTasks, ...failedTasks],
  };
}

function getTaskAccountId(task) {
  return Number(task?.account_id ?? task?.id ?? 0);
}

function getTaskAccountName(task) {
  return task?.account_name || task?.name || `账号${getTaskAccountId(task) || '未知'}`;
}

function getTaskCatchupEligibility(taskId) {
  const normalizedTaskId = Number(taskId);
  if (!Number.isInteger(normalizedTaskId) || normalizedTaskId <= 0) {
    return null;
  }

  return get(
    `SELECT tc.id, tc.enabled, ga.status AS account_status, COALESCE(u.is_enabled, 1) AS user_enabled
       FROM task_configs tc
       JOIN game_accounts ga ON tc.account_id = ga.id
       JOIN users u ON ga.user_id = u.id
      WHERE tc.id = ?`,
    [normalizedTaskId],
  );
}

function getScheduledTaskBatchItemKey(task) {
  if (task?.id) {
    return `task:${task.id}`;
  }
  return `account:${getTaskAccountId(task)}:type:${String(task?.task_type || '').trim()}`;
}

function getAccountBatchSlotKey(date = new Date()) {
  const parts = getShanghaiDateParts(date);
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function getAccountBatchDelayMs(task, source = 'scheduler', now = new Date()) {
  const maxDelayMs = Math.max(0, Number(config?.scheduler?.staggerWindowMs) || 0);
  const deterministicDelayMs = computeDeterministicDelayMs(
    `${source}:${getTaskAccountId(task)}:${getAccountBatchSlotKey(now)}`,
    maxDelayMs,
  );

  if (maxDelayMs <= 0) {
    return ACCOUNT_BATCH_MIN_DELAY_MS;
  }

  return Math.max(ACCOUNT_BATCH_MIN_DELAY_MS, deterministicDelayMs);
}

function ensurePendingAccountTaskBatch(task, source = 'scheduler') {
  const accountId = getTaskAccountId(task);
  if (!accountId) {
    throw new Error('缺少账号ID，无法加入账号批次队列');
  }

  if (!pendingAccountTaskBatches.has(accountId)) {
    pendingAccountTaskBatches.set(accountId, {
      accountId,
      accountName: getTaskAccountName(task),
      items: new Map(),
      sequence: 0,
      timer: null,
      scheduledAt: null,
      lastSource: source,
    });
  }

  const entry = pendingAccountTaskBatches.get(accountId);
  entry.accountName = getTaskAccountName(task);
  entry.lastSource = source || entry.lastSource || 'scheduler';
  return entry;
}

function clearPendingAccountTaskBatchTimer(entry) {
  if (entry?.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  if (entry) {
    entry.scheduledAt = null;
  }
}

function cleanupPendingAccountTaskBatch(accountId) {
  const entry = pendingAccountTaskBatches.get(accountId);
  if (!entry) return;
  if (entry.items.size > 0 || entry.timer) {
    return;
  }
  pendingAccountTaskBatches.delete(accountId);
}

function schedulePendingAccountTaskBatch(entry, delayMs) {
  if (!entry || entry.timer) {
    return;
  }

  const normalizedDelay = Math.max(0, Number(delayMs) || 0);
  entry.scheduledAt = Date.now() + normalizedDelay;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    entry.scheduledAt = null;
    void flushPendingAccountTaskBatch(entry.accountId);
  }, normalizedDelay);
}

function parseTaskConfig(task) {
  if (!task?.config_json) {
    return {};
  }
  return JSON.parse(task.config_json);
}

function buildTaskConnectionContext(task) {
  const accountId = getTaskAccountId(task);
  const accountName = getTaskAccountName(task);
  const rawToken = task?.token || decrypt(task?.token_encrypted, task?.token_iv);
  const tokenMeta = parseTokenPayload(rawToken);
  const tokenCandidates = tokenMeta.candidates?.length
    ? tokenMeta.candidates
    : [tokenMeta.token].filter(Boolean);

  if (tokenCandidates.length === 0) {
    throw new Error('账号Token无效，无法建立WebSocket连接');
  }

  return {
    accountId,
    accountName,
    tokenMeta,
    tokenCandidates,
    wsUrl: task?.ws_url || tokenMeta.wsUrl || '',
    importMethod: task?.account_import_method || null,
    updatedAt: task?.account_updated_at || null,
  };
}

function getLatestScheduledAccountSnapshot(accountId) {
  const snapshot = get(
    `SELECT
       ga.id AS account_id,
       ga.user_id,
       ga.name AS account_name,
       ga.token_encrypted,
       ga.token_iv,
       ga.ws_url,
       ga.import_method AS account_import_method,
       ga.updated_at AS account_updated_at,
       ga.status AS account_status
     FROM game_accounts ga
     WHERE ga.id = ?
     LIMIT 1`,
    [accountId]
  );

  if (!snapshot) {
    throw new Error('游戏账号不存在或已被删除');
  }

  if (String(snapshot.account_status || 'active') !== 'active') {
    throw new Error('游戏账号已停用');
  }

  return snapshot;
}

function mergeTaskWithLatestAccountSnapshot(task, snapshot) {
  return {
    ...task,
    account_id: Number(snapshot?.account_id || task?.account_id || task?.id || 0),
    user_id: snapshot?.user_id ?? task?.user_id,
    name: snapshot?.account_name || task?.name,
    account_name: snapshot?.account_name || task?.account_name || task?.name,
    token_encrypted: snapshot?.token_encrypted ?? task?.token_encrypted,
    token_iv: snapshot?.token_iv ?? task?.token_iv,
    ws_url: snapshot?.ws_url ?? task?.ws_url,
    account_import_method: snapshot?.account_import_method ?? task?.account_import_method,
    account_updated_at: snapshot?.account_updated_at ?? task?.account_updated_at,
  };
}

function shouldAbortAccountBatchOnError(error) {
  const message = String(error?.message || error || '');
  return (
    message.includes('所属用户不可用') ||
    message.includes('游戏账号已停用') ||
    message.includes('游戏账号不存在或已被删除')
  );
}

function markScheduledTaskSuccess(task, result) {
  const accountId = getTaskAccountId(task);
  addTaskLog(
    accountId,
    task.task_type,
    'success',
    result?.message || '执行成功',
    JSON.stringify(result?.data || {})
  );
  if (task.id) {
    markTaskRunTime(task.id, new Date().toISOString(), calculateNextRunAt(task.cron_expression));
  }
  console.log(`✅ 任务执行成功: ${getTaskAccountName(task)} - ${task.task_type}`);
}

function markScheduledTaskFailure(task, error) {
  const accountId = getTaskAccountId(task);
  const accountName = getTaskAccountName(task);
  console.error(`❌ 任务执行失败: ${accountName} - ${task.task_type}:`, error.message);
  addTaskLog(
    accountId,
    task.task_type,
    shouldIgnoreFailure(error) ? 'ignored' : 'error',
    error.message,
    error?.details ? JSON.stringify(error.details) : null
  );
  if (task.id) {
    markTaskRunTime(task.id, new Date().toISOString(), calculateNextRunAt(task.cron_expression));
  }
}

async function ensureTaskUserAvailable(task) {
  const user = get(
    'SELECT id, username, role, is_enabled, access_start_at, access_end_at FROM users WHERE id = ?',
    [task.user_id]
  );
  const userStatus = getUserAvailabilityStatus(user);
  if (!userStatus.allowed) {
    throw new Error(`所属用户不可用，任务已停止：${userStatus.reason}`);
  }
}

async function executeScheduledTaskWithClient(task, context = {}) {
  const accountId = getTaskAccountId(task);
  const accountName = getTaskAccountName(task);
  const taskType = task.task_type;
  const source = context.source || 'scheduler';
  const throwOnError = context.throwOnError === true;
  let currentClient = null;

  try {
    await ensureTaskUserAvailable(task);
    const taskConfig = parseTaskConfig(task);
    currentClient = await context.ensureClient();
    const execution = await executeTaskWithFlowControl({
      accountId,
      accountName,
      taskType,
      taskConfig,
      client: currentClient,
      source,
      reconnect: context.reconnect,
    });
    currentClient = execution.client;
    const result = execution.result;

    await claimDailyPointRewardsByTask(currentClient, taskType, taskConfig);
    updateDailyRewardFlushAfterTask(accountId, {
      taskType,
      accountName,
      tokenCandidates: context.connectionContext?.tokenCandidates || [],
      roleId: context.connectionContext?.tokenMeta?.roleId ?? null,
      wsUrl: context.connectionContext?.wsUrl || '',
      importMethod: context.connectionContext?.importMethod || null,
      updatedAt: context.connectionContext?.updatedAt || null,
    });

    markScheduledTaskSuccess(task, result);
    return {
      ok: true,
      task,
      result,
      client: currentClient,
    };
  } catch (error) {
    markScheduledTaskFailure(task, error);
    error.__scheduledTaskLogged = true;
    if (throwOnError) {
      throw error;
    }
    return {
      ok: false,
      task,
      error: error?.message || String(error),
      client: currentClient,
    };
  }
}

function resolveScheduledTaskBatchWaiters(item, outcome) {
  for (const resolve of item.waiters) {
    resolve(outcome);
  }
  item.waiters.length = 0;
}

async function executeAccountTaskBatch(batchItems, context = {}) {
  const firstTask = batchItems[0]?.task;
  const accountId = getTaskAccountId(firstTask);
  const accountName = getTaskAccountName(firstTask);

  return runAccountTaskExclusive(accountId, async () => {
    console.log('🚀 开始账号批次执行', {
      accountId,
      accountName,
      source: context.source || 'scheduler',
      taskCount: batchItems.length,
      taskTypes: batchItems.map((item) => item.task.task_type),
    });

    let connectionContext = null;
    let batchClient = null;
    let processedItemCount = 0;
    let shouldRunBatchFinalizer = true;

    try {
      const batchSeedTask = mergeTaskWithLatestAccountSnapshot(
        firstTask,
        getLatestScheduledAccountSnapshot(accountId)
      );
      await ensureTaskUserAvailable(batchSeedTask);
      connectionContext = buildTaskConnectionContext(batchSeedTask);

      const ensureBatchClient = async () => {
        if (batchClient?.isSocketOpen?.()) {
          return batchClient;
        }
        batchClient = await ensureConnectedClient(
          accountId,
          accountName,
          connectionContext.tokenCandidates,
          connectionContext.tokenMeta?.roleId ?? null,
          connectionContext.wsUrl,
          {
            importMethod: connectionContext.importMethod,
            updatedAt: connectionContext.updatedAt,
          }
        );
        return batchClient;
      };

      const reconnectBatchClient = async (taskType = null) => {
        console.warn('🔁 批次任务检测到连接已断开，准备重连', {
          accountId,
          accountName,
          taskType,
          source: context.source || 'scheduler',
        });
        forceDisconnectClient(accountId);
        batchClient = await ensureConnectedClient(
          accountId,
          accountName,
          connectionContext.tokenCandidates,
          connectionContext.tokenMeta?.roleId ?? null,
          connectionContext.wsUrl,
          {
            importMethod: connectionContext.importMethod,
            updatedAt: connectionContext.updatedAt,
          }
        );
        return batchClient;
      };

      for (let index = 0; index < batchItems.length; index += 1) {
        const item = batchItems[index];
        const latestTask = mergeTaskWithLatestAccountSnapshot(
          item.task,
          getLatestScheduledAccountSnapshot(accountId)
        );
        const outcome = await executeScheduledTaskWithClient(latestTask, {
          source: context.source || 'scheduler',
          ensureClient: ensureBatchClient,
          reconnect: async () => await reconnectBatchClient(latestTask.task_type),
          connectionContext,
        });

        if (outcome.client) {
          batchClient = outcome.client;
        }
        resolveScheduledTaskBatchWaiters(item, outcome);
        processedItemCount += 1;

        if (!outcome.ok && shouldAbortAccountBatchOnError(outcome.error)) {
          shouldRunBatchFinalizer = false;
          for (const pendingItem of batchItems.slice(index + 1)) {
            markScheduledTaskFailure(pendingItem.task, new Error(outcome.error));
            resolveScheduledTaskBatchWaiters(pendingItem, {
              ok: false,
              task: pendingItem.task,
              error: outcome.error,
              client: batchClient,
            });
            processedItemCount += 1;
          }
          break;
        }
      }

      if (shouldRunBatchFinalizer && batchClient?.isSocketOpen?.()) {
        await flushDailyRewardClaimOnClient(
          accountId,
          batchClient,
          {
            accountName,
            tokenCandidates: connectionContext.tokenCandidates,
            roleId: connectionContext.tokenMeta?.roleId ?? null,
            wsUrl: connectionContext.wsUrl,
            importMethod: connectionContext.importMethod,
            updatedAt: connectionContext.updatedAt,
          },
          async () => await reconnectBatchClient('DAILY_TASK_CLAIM'),
          'batch-finalize'
        );
      }
    } catch (error) {
      console.error('❌ 账号批次执行初始化失败', {
        accountId,
        accountName,
        source: context.source || 'scheduler',
        error: error?.message || String(error),
      });

      for (const item of batchItems.slice(processedItemCount)) {
        markScheduledTaskFailure(item.task, error);
        resolveScheduledTaskBatchWaiters(item, {
          ok: false,
          task: item.task,
          error: error?.message || String(error),
          client: batchClient,
        });
      }
    } finally {
      forceDisconnectClient(accountId);
      console.log('🧹 账号批次执行结束，连接已断开', {
        accountId,
        accountName,
        source: context.source || 'scheduler',
      });
    }
  });
}

async function flushPendingAccountTaskBatch(accountId) {
  const entry = pendingAccountTaskBatches.get(accountId);
  if (!entry) {
    return null;
  }

  clearPendingAccountTaskBatchTimer(entry);

  if (entry.items.size === 0) {
    cleanupPendingAccountTaskBatch(accountId);
    return null;
  }

  const batchItems = Array.from(entry.items.values())
    .sort((a, b) => a.order - b.order);
  entry.items.clear();

  try {
    return await executeAccountTaskBatch(batchItems, {
      source: entry.lastSource || 'scheduler',
    });
  } finally {
    if (entry.items.size === 0 && !entry.timer) {
      cleanupPendingAccountTaskBatch(accountId);
    } else if (entry.items.size > 0 && !entry.timer) {
      schedulePendingAccountTaskBatch(entry, ACCOUNT_BATCH_MIN_DELAY_MS);
    }
  }
}

function enqueueAccountTaskBatch(task, options = {}) {
  const source = options.source || 'scheduler';
  const entry = ensurePendingAccountTaskBatch(task, source);
  const batchItemKey = getScheduledTaskBatchItemKey(task);

  if (!entry.items.has(batchItemKey)) {
    entry.items.set(batchItemKey, {
      key: batchItemKey,
      task: { ...task },
      order: entry.sequence++,
      waiters: [],
    });
  } else {
    const existingItem = entry.items.get(batchItemKey);
    existingItem.task = {
      ...existingItem.task,
      ...task,
    };
  }

  const item = entry.items.get(batchItemKey);
  const outcomePromise = new Promise((resolve) => {
    item.waiters.push(resolve);
  });

  if (!entry.timer) {
    const delayMs = options.immediate === true
      ? 0
      : getAccountBatchDelayMs(task, source, options.now instanceof Date ? options.now : new Date());

    console.log('📥 定时任务已加入账号批次队列', {
      accountId: entry.accountId,
      accountName: entry.accountName,
      taskType: task.task_type || null,
      source,
      delayMs,
      pendingTaskCount: entry.items.size,
    });

    schedulePendingAccountTaskBatch(entry, delayMs);
  }

  return outcomePromise;
}

async function runCatchupTask(task) {
  const latestTaskState = getTaskCatchupEligibility(task?.id);
  if (!latestTaskState || !latestTaskState.enabled) {
    console.log('⏭️ 跳过补偿任务：定时任务已关闭', {
      accountId: task.account_id ?? null,
      accountName: task.account_name || task.name || null,
      taskType: task.task_type || null,
      taskId: task?.id ?? null,
    });
    return {
      ok: true,
      skipped: true,
      reason: 'task_disabled',
      taskId: task?.id ?? null,
      accountId: task.account_id ?? null,
      taskType: task.task_type || null,
    };
  }

  if (latestTaskState.account_status !== 'active' || !Number(latestTaskState.user_enabled)) {
    console.log('⏭️ 跳过补偿任务：账号或用户不可用', {
      accountId: task.account_id ?? null,
      accountName: task.account_name || task.name || null,
      taskType: task.task_type || null,
      taskId: task?.id ?? null,
      accountStatus: latestTaskState.account_status || null,
      userEnabled: !!Number(latestTaskState.user_enabled),
    });
    return {
      ok: true,
      skipped: true,
      reason: 'task_unavailable',
      taskId: task?.id ?? null,
      accountId: task.account_id ?? null,
      taskType: task.task_type || null,
    };
  }

  console.log('🛟 开始补偿排队任务', {
    accountId: task.account_id ?? null,
    accountName: task.account_name || task.name || null,
    taskType: task.task_type || null,
    catchupReason: task.catchupReason,
    expectedAt: task.catchupExpectedAt || null,
    lastMessage: task.catchupLastMessage || null,
    lastLogAt: task.catchupLastLogAt || null,
  });

  return await enqueueAccountTaskBatch(task, {
    source: 'scheduler-catchup',
    now: new Date(),
  });
}

export async function runDailyTaskCatchup(options = {}) {
  const {
    cutoffHour = DAILY_CATCHUP_CUTOFF_HOUR,
    now = new Date(),
  } = options;

  const tasks = getEnabledTasks();
  const catchup = collectDailyCatchupTasks(tasks, cutoffHour, now);

  console.log('🛟 每日任务补偿检查完成', {
    cutoffHour,
    candidateTaskCount: catchup.tasks.length,
    missingCount: catchup.missingTasks.length,
    failedCount: catchup.failedTasks.length,
  });

  if (catchup.tasks.length === 0) {
    return {
      total: 0,
      missingCount: 0,
      failedCount: 0,
      successCount: 0,
      errorCount: 0,
    };
  }

  const groupedTasks = catchup.tasks.reduce((acc, task) => {
    const accountId = getTaskAccountId(task);
    if (!acc.has(accountId)) {
      acc.set(accountId, []);
    }
    acc.get(accountId).push(task);
    return acc;
  }, new Map());

  console.log('🛟 每日任务补偿开始执行', {
    total: catchup.tasks.length,
    accountCount: groupedTasks.size,
  });

  const groupedResults = await Promise.all(
    Array.from(groupedTasks.values()).map(async (tasksOfAccount) => {
      const promises = tasksOfAccount.map((task) => runCatchupTask(task));
      return await Promise.all(promises);
    })
  );

  const results = groupedResults.flat();
  const successCount = results.filter((item) => item?.ok).length;
  const errorCount = results.length - successCount;

  console.log('🛟 每日任务补偿执行结束', {
    total: results.length,
    successCount,
    errorCount,
    missingCount: catchup.missingTasks.length,
    failedCount: catchup.failedTasks.length,
  });

  return {
    total: results.length,
    successCount,
    errorCount,
    missingCount: catchup.missingTasks.length,
    failedCount: catchup.failedTasks.length,
    results,
  };
}

function discardInactiveClient(accountId, accountName, client, reason) {
  console.warn('🧹 丢弃不可复用的定时任务连接', {
    accountId,
    accountName,
    reason,
    connection: client?.getConnectionStateSummary?.() || null,
  });
  activeConnections.delete(accountId);
  unregisterAccountClient(accountId, client);
  try {
    client?.disconnect?.();
  } catch {
    // ignore
  }
}

async function reconnectCurrentClient(client, label = '任务') {
  const accountId = Number(client?.accountId);
  const accountName = client?.accountName || null;

  try {
    client.disconnect();
  } catch {
    // ignore
  }

  if (Number.isFinite(accountId) && accountId > 0) {
    activeConnections.delete(accountId);
    unregisterAccountClient(accountId, client);
  }

  const connectAndWarmup = async () => {
    await client.connect();
    if (!client.isSocketOpen()) {
      throw new Error('WebSocket未连接');
    }

    if (Number.isFinite(accountId) && accountId > 0) {
      activeConnections.set(accountId, client);
      registerAccountClient(accountId, client);
    }

    const warmup = await warmupGameClient(client, {
      roleInfoTimeout: 8000,
      includeRoleId: false,
    });
    console.log(`🔥 ${label}重连预热完成`, {
      accountId: accountId || null,
      accountName,
      handshake: client.lastConnectMeta || null,
      warmup,
    });

    if (!client.isSocketOpen()) {
      throw new Error('WebSocket未连接');
    }

    return client;
  };

  try {
    return await connectAndWarmup();
  } catch (error) {
    if (Number.isFinite(accountId) && accountId > 0) {
      activeConnections.delete(accountId);
      unregisterAccountClient(accountId, client);
    }

    console.warn(`⚠️ ${label}重连失败，尝试通过后端持久化BIN刷新Token`, {
      accountId: accountId || null,
      accountName,
      error: normalizeErrorMessage(error),
      handshake: client?.lastConnectMeta || null,
    });

    if (!Number.isFinite(accountId) || accountId <= 0) {
      throw error;
    }

    const refreshed = await getRefreshedTokenSessionFromStoredBin(accountId, {
      trigger: 'scheduler-reconnect',
      currentWsUrl: client?.wsUrl || '',
    });

    if (!refreshed?.refreshed || !refreshed?.candidates?.length) {
      throw error;
    }

    const refreshedToken = refreshed.tokenMeta?.token || refreshed.token;
    client.token = refreshedToken;
    client.roleId = refreshed.roleId || client.roleId || null;
    client.wsUrl = resolveWsUrl(refreshed.wsUrl || client.wsUrl || '', refreshedToken);

    console.log(`♻️ ${label}已切换为后端BIN刷新后的Token重连`, {
      accountId,
      accountName,
      roleId: client.roleId ?? null,
      handshake: client?.lastConnectMeta || null,
    });

    try {
      client.disconnect();
    } catch {
      // ignore
    }

    return await connectAndWarmup();
  }
}

async function recruitWithReconnect(client, recruitType, mode, maxReconnectRetries = 1) {
  let attempt = 0;

  while (attempt <= maxReconnectRetries) {
    try {
      const result = await client.recruitHero(recruitType);
      return { ok: true, mode, recruitType, result, retried: attempt };
    } catch (error) {
      const message = String(error?.message || `${mode}招募失败`);
      if (!isRetryableWsError(message) || attempt >= maxReconnectRetries) {
        return { ok: false, mode, recruitType, error: message, retried: attempt };
      }

      attempt += 1;
      console.warn(`🔁 ${mode}招募遇到连接断开，准备重连后重试 (${attempt}/${maxReconnectRetries})`);
      await reconnectCurrentClient(client, `${mode}招募`);
    }
  }

  return { ok: false, mode, recruitType, error: `${mode}招募失败`, retried: maxReconnectRetries };
}

export async function initScheduler() {
  console.log('🕐 初始化定时任务调度器...');

  const seedResult = await ensureDefaultTaskConfigsForAllAccounts();
  if (seedResult.created > 0) {
    console.log('🧩 已为现有账号补齐默认定时任务配置', {
      accountCount: seedResult.accountCount,
      createdTaskConfigCount: seedResult.created,
      accounts: seedResult.details,
    });
  }

  const cronRebalanceResult = await rebalanceDefaultTaskCronExpressions();
  if (cronRebalanceResult.updated > 0) {
    console.log('🕒 已迁移默认任务 cron 分布，缓解中午洪峰', {
      updated: cronRebalanceResult.updated,
      details: cronRebalanceResult.details,
    });
  }
  if (cronRebalanceResult.skippedUnknown > 0) {
    console.log('🕒 发现历史默认 cron 配置缺少自定义标记，已跳过自动迁移以避免误改用户设置', {
      skippedUnknown: cronRebalanceResult.skippedUnknown,
      details: cronRebalanceResult.skippedDetails,
    });
  }
  
  const tasks = getEnabledTasks();
  console.log(`📋 找到 ${tasks.length} 个启用的任务`);
  const startupRunTimeUpdates = [];
  let scheduledCount = 0;

  for (const task of tasks) {
    const scheduled = scheduleTask(task, {
      persistNextRun: false,
      logScheduled: false,
    });
    if (scheduled?.scheduled) {
      scheduledCount += 1;
      if (scheduled.nextRunAt) {
        startupRunTimeUpdates.push({
          taskId: task.id,
          nextRunAt: scheduled.nextRunAt,
        });
      }
    }
  }

  if (startupRunTimeUpdates.length > 0) {
    await updateTaskRunTimesBatch(startupRunTimeUpdates);
  }

  if (scheduledCount > 0) {
    console.log('📅 已完成定时任务批量注册', {
      scheduledCount,
      nextRunAtPersistedCount: startupRunTimeUpdates.length,
    });
  }

  if (schedulerRefreshJob) {
    schedulerRefreshJob.stop();
    schedulerRefreshJob = null;
  }
  schedulerRefreshJob = cron.schedule('* * * * *', async () => {
    await checkAndRunDueTasks();
  }, {
    timezone: config.cron.timezone
  });

  if (dailyCatchupJob) {
    dailyCatchupJob.stop();
    dailyCatchupJob = null;
  }
  dailyCatchupJob = cron.schedule(DAILY_CATCHUP_CRON, async () => {
    await runDailyTaskCatchup({
      cutoffHour: DAILY_CATCHUP_CUTOFF_HOUR,
    });
  }, {
    timezone: config.cron.timezone,
  });

  console.log('✅ 定时任务调度器初始化完成');
}

export function scheduleTask(task, options = {}) {
  const {
    persistNextRun = true,
    logScheduled = true,
  } = options;
  const jobKey = `${task.account_id}_${task.task_type}`;
  
  if (scheduledJobs.has(jobKey)) {
    const existing = scheduledJobs.get(jobKey);
    (existing.jobs || []).forEach((job) => job.stop());
    scheduledJobs.delete(jobKey);
  }

  if (!task.enabled) {
    return { scheduled: false, nextRunAt: null };
  }

  try {
    const cronExpressions = getTaskCronExpressions(task);
    const cronSignature = getTaskCronSignature(task);
    const nextRunAt = getTaskNextRunAt(task);
    const jobs = cronExpressions.map((cronExpression) => cron.schedule(cronExpression, async () => {
      try {
        console.log('⏰ 定时任务命中', {
          accountId: task.account_id ?? null,
          accountName: task.account_name || task.name || null,
          taskType: task.task_type || null,
          cronExpression,
        });
        await enqueueAccountTaskBatch(task, {
          source: 'scheduler',
          now: new Date(),
        });
      } finally {
        updateTaskRunTime(task.id, getTaskNextRunAt(task));
      }
    }, {
      timezone: config.cron.timezone
    }));

    scheduledJobs.set(jobKey, {
      jobs,
      cronSignature
    });
    
    if (persistNextRun) {
      updateTaskRunTime(task.id, nextRunAt);
    }
    
    if (logScheduled) {
      console.log(`📅 已调度任务: ${task.account_name} - ${task.task_type} (${cronExpressions.join(' | ')})`);
    }
    return { scheduled: true, nextRunAt };
  } catch (error) {
    console.error(`❌ 调度任务失败: ${task.account_name} - ${task.task_type}:`, error.message);
    return { scheduled: false, nextRunAt: null, error };
  }
}

export async function checkAndRunDueTasks() {
  const tasks = getEnabledTasks();
  const enabledTaskMap = new Map(
    tasks.map(task => [`${task.account_id}_${task.task_type}`, task])
  );

  for (const [jobKey, scheduled] of scheduledJobs) {
    const task = enabledTaskMap.get(jobKey);
    if (!task) {
      (scheduled.jobs || []).forEach((job) => job.stop());
      scheduledJobs.delete(jobKey);
      continue;
    }

    if (scheduled.cronSignature !== getTaskCronSignature(task)) {
      scheduleTask(task);
    }
  }

  for (const [jobKey, task] of enabledTaskMap) {
    if (!scheduledJobs.has(jobKey)) {
      scheduleTask(task);
    }
  }
}

export async function executeTask(task) {
  const accountId = getTaskAccountId(task);
  const accountName = getTaskAccountName(task);

  if (!accountId) {
    throw new Error('缺少账号ID，无法执行任务');
  }

  return runAccountTaskExclusive(accountId, async () => {
    console.log(`🚀 开始执行任务: ${accountName} - ${task.task_type}`);
    try {
      await ensureTaskUserAvailable(task);
      const connectionContext = buildTaskConnectionContext(task);
      let client = null;

      const ensureClient = async () => {
        if (client?.isSocketOpen?.()) {
          return client;
        }
        client = await ensureConnectedClient(
          accountId,
          accountName,
          connectionContext.tokenCandidates,
          connectionContext.tokenMeta?.roleId ?? null,
          connectionContext.wsUrl,
          {
            importMethod: connectionContext.importMethod,
            updatedAt: connectionContext.updatedAt,
          }
        );
        return client;
      };

      const outcome = await executeScheduledTaskWithClient(task, {
        source: 'scheduler',
        ensureClient,
        reconnect: async () => {
          console.warn(`🔁 检测到连接已断开，重连后重试: ${accountName} - ${task.task_type}`);
          forceDisconnectClient(accountId);
          client = await ensureConnectedClient(
            accountId,
            accountName,
            connectionContext.tokenCandidates,
            connectionContext.tokenMeta?.roleId ?? null,
            connectionContext.wsUrl,
            {
              importMethod: connectionContext.importMethod,
              updatedAt: connectionContext.updatedAt,
            }
          );
          return client;
        },
        connectionContext,
        throwOnError: true,
      });

      return outcome.result;
    } catch (error) {
      if (!error?.__scheduledTaskLogged) {
        markScheduledTaskFailure(task, error);
      }
      throw error;
    }
  });
}

async function executeTaskWithFlowControl({
  accountId,
  accountName,
  taskType,
  taskConfig,
  client,
  source,
  reconnect,
}) {
  const retryConfig = getSensitiveTaskRetryConfig();
  const wsRetryConfig = getWsReconnectRetryConfig();
  const allowTooFastRetry = SENSITIVE_TASK_TYPES.has(taskType);
  let currentClient = client;
  let wsRetryCount = 0;
  let tooFastRetryCount = 0;

  while (true) {
    try {
      const result = await runTaskTypeThrottled(taskType, {
        accountId,
        accountName,
        source,
      }, async () => await runTaskByType(currentClient, taskType, taskConfig, {
        accountId,
        accountName,
        source,
        reconnect: async () => {
          currentClient = await reconnect();
          return currentClient;
        },
      }));
      return { client: currentClient, result };
    } catch (error) {
      if (isRetryableWsError(error) && wsRetryCount < wsRetryConfig.maxRetries) {
        wsRetryCount += 1;
        const retryDelayMs = Math.min(
          wsRetryConfig.maxDelayMs,
          wsRetryConfig.baseDelayMs * (2 ** (wsRetryCount - 1))
        );
        console.warn('🔁 定时任务触发 WebSocket 重连重试', {
          accountId,
          accountName,
          taskType,
          source,
          retry: wsRetryCount,
          maxRetries: wsRetryConfig.maxRetries,
          retryDelayMs,
          error: normalizeErrorMessage(error),
        });
        if (retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }
        currentClient = await reconnect();
        continue;
      }

      if (allowTooFastRetry && isTooFastError(error) && tooFastRetryCount < retryConfig.maxRetries) {
        tooFastRetryCount += 1;
        const retryDelayMs = Math.min(
          retryConfig.maxDelayMs,
          retryConfig.baseDelayMs * (2 ** (tooFastRetryCount - 1))
        );
        console.warn('⏳ 敏感任务触发操作过快，退避后重试', {
          accountId,
          accountName,
          taskType,
          source,
          retry: tooFastRetryCount,
          maxRetries: retryConfig.maxRetries,
          retryDelayMs,
          error: normalizeErrorMessage(error),
        });
        await sleep(retryDelayMs);
        continue;
      }

      throw error;
    }
  }
}

async function claimDailyPointRewardsByTask(client, taskType, taskConfig = {}) {
  const configTaskIds = Array.isArray(taskConfig?.dailyPointTaskIds)
    ? taskConfig.dailyPointTaskIds
    : (typeof taskConfig?.dailyPointTaskIds === 'string'
      ? taskConfig.dailyPointTaskIds.split(',').map((v) => Number(v.trim()))
      : []);
  const mappedIds = DAILY_POINT_TASK_ID_MAP[taskType] || [];
  const taskIds = [...new Set([...mappedIds, ...configTaskIds])]
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v > 0);

  for (const taskId of taskIds) {
    try {
      await client.claimDailyPoint(taskId);
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch {
      // 忽略“已领取/未达成”等错误，不影响主任务结果
    }
  }
}

function ensureDailyRewardFlushEntry(accountId) {
  const todayKey = getDateKey();
  if (!dailyRewardFlushState.has(accountId)) {
    dailyRewardFlushState.set(accountId, {
      dirty: false,
      timer: null,
      flushingPromise: null,
      retryCount: 0,
      dateKey: todayKey,
      accountName: `账号${accountId}`,
      tokenCandidates: [],
      roleId: null,
      wsUrl: '',
      importMethod: null,
      updatedAt: null,
    });
  }

  const entry = dailyRewardFlushState.get(accountId);
  if (entry.dateKey !== todayKey) {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.dirty = false;
    entry.timer = null;
    entry.flushingPromise = null;
    entry.retryCount = 0;
    entry.dateKey = todayKey;
  }
  return entry;
}

function updateDailyRewardFlushAfterTask(accountId, context = {}) {
  const entry = ensureDailyRewardFlushEntry(accountId);
  entry.accountName = context.accountName || entry.accountName;
  entry.tokenCandidates = Array.isArray(context.tokenCandidates) ? [...context.tokenCandidates] : entry.tokenCandidates;
  entry.roleId = context.roleId ?? entry.roleId;
  entry.wsUrl = typeof context.wsUrl === 'string' ? context.wsUrl : entry.wsUrl;
  entry.importMethod = context.importMethod ?? entry.importMethod;
  entry.updatedAt = context.updatedAt ?? entry.updatedAt;
  entry.retryCount = 0;

  if (context.taskType === 'DAILY_TASK_CLAIM') {
    clearDailyRewardFlush(accountId);
    return;
  }

  if (!DAILY_REWARD_DIRTY_TASKS.has(context.taskType)) {
    return;
  }

  entry.dirty = true;
  if (entry.timer) {
    clearTimeout(entry.timer);
  }
  entry.timer = setTimeout(() => {
    void flushDailyRewardClaim(accountId, 'debounced');
  }, DAILY_REWARD_FLUSH_DELAY_MS);
}

function clearDailyRewardFlush(accountId) {
  const entry = ensureDailyRewardFlushEntry(accountId);
  entry.dirty = false;
  entry.retryCount = 0;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
}

function scheduleDailyRewardFlushRetry(entry, accountId, reason = 'retry') {
  if (entry.retryCount < DAILY_REWARD_MAX_RETRIES && !entry.timer) {
    entry.retryCount += 1;
    entry.timer = setTimeout(() => {
      void flushDailyRewardClaim(accountId, reason);
    }, DAILY_REWARD_RETRY_DELAY_MS);
    return;
  }

  if (entry.retryCount >= DAILY_REWARD_MAX_RETRIES) {
    entry.dirty = false;
    entry.retryCount = 0;
    addTaskLog(accountId, 'DAILY_TASK_CLAIM', 'ignored', '自动收尾补领已停止重试，等待下次任务重新触发');
  }
}

async function flushDailyRewardClaimOnClient(
  accountId,
  client,
  flushContext = {},
  reconnect,
  reason = 'batch-finalize'
) {
  const entry = ensureDailyRewardFlushEntry(accountId);
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  if (!entry.dirty || !client?.isSocketOpen?.()) {
    return false;
  }

  try {
    const execution = await executeTaskWithFlowControl({
      accountId,
      accountName: flushContext.accountName || entry.accountName || `账号${accountId}`,
      taskType: 'DAILY_TASK_CLAIM',
      taskConfig: {},
      client,
      source: 'scheduler-batch-finalize',
      reconnect,
    });
    const currentClient = execution.client;
    const result = execution.result;

    entry.dirty = false;
    entry.retryCount = 0;
    const claimedCount = Number(result?.data?.claimedCount || 0);
    const flushMessage = claimedCount > 0
      ? `自动收尾补领完成: ${result.message || '每日任务奖励领取完成'}`
      : `自动收尾检查完成: ${result.message || '没有可领取的每日任务奖励'}`;
    addTaskLog(
      accountId,
      'DAILY_TASK_CLAIM',
      'success',
      flushMessage,
      JSON.stringify({
        autoFlush: true,
        reason,
        ...(result.data || {}),
      })
    );
    console.log(`✅ ${flushMessage}: ${flushContext.accountName || entry.accountName}`);
    return currentClient;
  } catch (error) {
    entry.dirty = true;
    console.error(`❌ 自动收尾补领失败: ${flushContext.accountName || entry.accountName}:`, error.message);
    addTaskLog(
      accountId,
      'DAILY_TASK_CLAIM',
      'error',
      `自动收尾补领失败: ${error.message}`,
      error?.details ? JSON.stringify({
        autoFlush: true,
        reason,
        ...(error.details || {}),
      }) : null
    );
    scheduleDailyRewardFlushRetry(entry, accountId, 'retry');
    return false;
  }
}

async function flushDailyRewardClaim(accountId, reason = 'debounced') {
  const entry = ensureDailyRewardFlushEntry(accountId);
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  if (!entry.dirty) {
    return false;
  }

  if (isAccountTaskRunning(accountId)) {
    entry.timer = setTimeout(() => {
      void flushDailyRewardClaim(accountId, reason);
    }, 5000);
    return false;
  }

  if (entry.flushingPromise) {
    return await entry.flushingPromise;
  }

  const flushContext = {
    accountName: entry.accountName,
    tokenCandidates: Array.isArray(entry.tokenCandidates) ? [...entry.tokenCandidates] : [],
    roleId: entry.roleId,
    wsUrl: entry.wsUrl || '',
    importMethod: entry.importMethod || null,
    updatedAt: entry.updatedAt || null,
  };

  entry.flushingPromise = runAccountTaskExclusive(accountId, async () => {
    try {
      if (!entry.dirty) {
        return false;
      }
      if (!flushContext.tokenCandidates.length) {
        return false;
      }

      console.log(`🎁 开始自动收尾补领: ${flushContext.accountName} (${reason})`);
      let client = await ensureConnectedClient(
        accountId,
        flushContext.accountName,
        flushContext.tokenCandidates,
        flushContext.roleId,
        flushContext.wsUrl,
        {
          importMethod: flushContext.importMethod,
          updatedAt: flushContext.updatedAt,
        }
      );
      let result;
      try {
        result = await executeDailyTaskClaim(client, {});
      } catch (error) {
        if (isRetryableWsError(error)) {
          console.warn(`🔁 自动补领检测到连接断开，重连后重试: ${flushContext.accountName}`);
          forceDisconnectClient(accountId);
          client = await ensureConnectedClient(
            accountId,
            flushContext.accountName,
            flushContext.tokenCandidates,
            flushContext.roleId,
            flushContext.wsUrl,
            {
              importMethod: flushContext.importMethod,
              updatedAt: flushContext.updatedAt,
            }
          );
          result = await executeDailyTaskClaim(client, {});
        } else {
          throw error;
        }
      }

      entry.dirty = false;
      entry.retryCount = 0;
      const claimedCount = Number(result?.data?.claimedCount || 0);
      const flushMessage = claimedCount > 0
        ? `自动收尾补领完成: ${result.message || '每日任务奖励领取完成'}`
        : `自动收尾检查完成: ${result.message || '没有可领取的每日任务奖励'}`;
      addTaskLog(
        accountId,
        'DAILY_TASK_CLAIM',
        'success',
        flushMessage,
        JSON.stringify({
          autoFlush: true,
          reason,
          ...(result.data || {})
        })
      );
      console.log(`✅ ${flushMessage}: ${flushContext.accountName}`);
      return true;
    } catch (error) {
      entry.dirty = true;
      console.error(`❌ 自动收尾补领失败: ${flushContext.accountName}:`, error.message);
      addTaskLog(
        accountId,
        'DAILY_TASK_CLAIM',
        'error',
        `自动收尾补领失败: ${error.message}`,
        error?.details ? JSON.stringify({
          autoFlush: true,
          reason,
          ...(error.details || {}),
        }) : null
      );
      scheduleDailyRewardFlushRetry(entry, accountId, 'retry');
      return false;
    } finally {
      entry.flushingPromise = null;
    }
  });

  return await entry.flushingPromise;
}

function getDateKey() {
  const parts = getShanghaiDateParts(new Date());
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

function parseTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function evaluateReusableClient(client) {
  if (!client?.isSocketOpen?.()) {
    return {
      reusable: false,
      reason: 'readyState 非 OPEN 或 connected 标记失效',
    };
  }

  const now = Date.now();
  const maxIdleMs = Number(config?.scheduler?.reusableConnection?.maxIdleMs) || 600000;
  const maxAgeMs = Number(config?.scheduler?.reusableConnection?.maxAgeMs) || 1800000;
  const openedAt = parseTimestamp(client?.lastConnectMeta?.openedAt || client?.lastConnectMeta?.startedAt);
  const lastMessageAt = parseTimestamp(client?.lastMessageAt);

  if (lastMessageAt && maxIdleMs > 0) {
    const idleMs = now - lastMessageAt;
    if (idleMs > maxIdleMs) {
      return {
        reusable: false,
        reason: `连接空闲过久(${idleMs}ms > ${maxIdleMs}ms)`,
      };
    }
  }

  if (openedAt && maxAgeMs > 0) {
    const ageMs = now - openedAt;
    if (ageMs > maxAgeMs) {
      return {
        reusable: false,
        reason: `连接存活过久(${ageMs}ms > ${maxAgeMs}ms)`,
      };
    }
  }

  return {
    reusable: true,
    reason: null,
  };
}

function forceDisconnectClient(accountId) {
  const client = activeConnections.get(accountId);
  if (!client) return;
  console.warn('🧹 强制断开旧WebSocket连接', {
    accountId,
    accountName: client.accountName || null,
    connected: !!client.isSocketOpen?.(),
    connection: client.getConnectionStateSummary?.() || null,
  });
  try {
    client.disconnect();
  } catch (error) {
    console.warn(`⚠️ 断开旧连接失败: 账号${accountId}`, error.message);
  } finally {
    activeConnections.delete(accountId);
    unregisterAccountClient(accountId, client);
  }
}

async function ensureConnectedClient(accountId, accountName, tokenCandidates, roleId = null, wsUrl = '', extraContext = {}) {
  const existing = activeConnections.get(accountId);
  if (existing?.isSocketOpen?.()) {
    const reuseCheck = evaluateReusableClient(existing);
    if (reuseCheck.reusable) {
      console.log('♻️ 复用已有WebSocket连接', {
        accountId,
        accountName,
        roleId: roleId ?? null,
        importMethod: extraContext.importMethod || null,
        updatedAt: extraContext.updatedAt || null,
        connection: existing.getConnectionStateSummary?.() || null,
      });
      return existing;
    }

    discardInactiveClient(accountId, accountName, existing, reuseCheck.reason);
  } else if (existing) {
    discardInactiveClient(accountId, accountName, existing, 'readyState 非 OPEN 或 connected 标记失效');
  }

  if (connectionPromises.has(accountId)) {
    return await connectionPromises.get(accountId);
  }

  const connectPromise = (async () => {
    const maxRetries = 3;
    let lastError = null;
    let currentCandidates = Array.isArray(tokenCandidates) ? [...tokenCandidates] : [];
    let currentRoleId = roleId;
    let currentWsUrl = wsUrl;
    let refreshedByBin = false;

    for (let refreshRound = 0; refreshRound <= 1; refreshRound += 1) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        for (const [candidateIndex, token] of currentCandidates.entries()) {
          const resolvedWsUrl = resolveWsUrl(currentWsUrl, token);
          const client = new GameClient(token, { roleId: currentRoleId, wsUrl: resolvedWsUrl });
          client.accountId = accountId;
          client.accountName = accountName;
          let disconnectInfo = null;
          let wsErrorMessage = null;
          let unexpectedResponse = null;
          const logContext = buildWsLogContext({
            accountId,
            accountName,
            roleId: currentRoleId,
            importMethod: extraContext.importMethod || null,
            updatedAt: extraContext.updatedAt || null,
            attempt,
            maxRetries,
            candidateIndex: candidateIndex + 1,
            candidateCount: currentCandidates.length,
            token,
            wsUrl: resolvedWsUrl,
            extra: {
              refreshedByBin,
            },
          });

          client.onDisconnect = (code, reason, meta) => {
            disconnectInfo = { code, reason };
            console.warn('🔌 定时任务连接断开', {
              ...logContext,
              disconnect: normalizeDisconnectInfo(disconnectInfo),
              handshake: meta || client.lastConnectMeta || null,
            });
            activeConnections.delete(accountId);
            unregisterAccountClient(accountId, client);
          };

          client.onError = (error, meta) => {
            wsErrorMessage = normalizeErrorMessage(error);
            console.error('❌ 定时任务连接错误', {
              ...logContext,
              error: wsErrorMessage,
              handshake: meta || client.lastConnectMeta || null,
            });
            activeConnections.delete(accountId);
            unregisterAccountClient(accountId, client);
          };

          client.onUnexpectedResponse = (details, meta) => {
            unexpectedResponse = details;
            console.error('🚫 定时任务握手异常响应', {
              ...logContext,
              unexpectedResponse: details,
              handshake: meta || client.lastConnectMeta || null,
            });
          };

          try {
            console.log('🔄 尝试建立定时任务WebSocket连接', logContext);
            await client.connect();
            if (!client.isSocketOpen()) {
              throw new Error('WebSocket未连接');
            }
            activeConnections.set(accountId, client);
            registerAccountClient(accountId, client);
            console.log('✅ 定时任务WebSocket连接成功', {
              ...logContext,
              handshake: client.lastConnectMeta || null,
            });
            const warmup = await warmupGameClient(client, {
              roleInfoTimeout: 8000,
              includeRoleId: false,
            });
            console.log('🔥 定时任务连接预热完成', {
              ...logContext,
              handshake: client.lastConnectMeta || null,
              warmup,
            });
            if (!client.isSocketOpen()) {
              throw new Error('WebSocket未连接');
            }
            return client;
          } catch (error) {
            lastError = error;
            console.warn('⚠️ 定时任务候选Token连接失败', {
              ...logContext,
              error: normalizeErrorMessage(error),
              disconnect: normalizeDisconnectInfo(disconnectInfo),
              wsError: wsErrorMessage || null,
              unexpectedResponse,
              handshake: client.lastConnectMeta || null,
            });
            client.disconnect();
            activeConnections.delete(accountId);
            unregisterAccountClient(accountId, client);
          }
        }

        console.error('⚠️ 定时任务连接批次失败', {
          accountId,
          accountName,
          roleId: currentRoleId ?? null,
          importMethod: extraContext.importMethod || null,
          updatedAt: extraContext.updatedAt || null,
          attempt,
          maxRetries,
          refreshedByBin,
          error: normalizeErrorMessage(lastError),
        });
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }

      if (refreshedByBin) {
        break;
      }

      try {
        const refreshed = await getRefreshedTokenSessionFromStoredBin(accountId, {
          trigger: 'scheduler-connect',
          currentWsUrl,
        });
        if (refreshed?.refreshed && refreshed?.candidates?.length) {
          currentCandidates = refreshed.candidates;
          currentRoleId = refreshed.roleId || currentRoleId;
          currentWsUrl = refreshed.wsUrl || currentWsUrl || '';
          refreshedByBin = true;
          console.log('♻️ 定时任务连接已切换为后端BIN刷新后的Token重试', {
            accountId,
            accountName,
            roleId: currentRoleId ?? null,
            importMethod: extraContext.importMethod || null,
            updatedAt: extraContext.updatedAt || null,
            candidateCount: currentCandidates.length,
          });
          continue;
        }
      } catch (error) {
        console.warn('⚠️ 定时任务连接通过持久化BIN刷新Token失败', {
          accountId,
          accountName,
          error: normalizeErrorMessage(error),
        });
      }
      break;
    }

    throw new Error(lastError?.message || 'WebSocket连接失败');
  })();

  connectionPromises.set(accountId, connectPromise);
  try {
    return await connectPromise;
  } finally {
    connectionPromises.delete(accountId);
  }
}

async function runTaskByType(client, taskType, config, context = {}) {
  switch (taskType) {
    case 'SIGN_IN':
      return await executeSignIn(client);
    
    case 'LEGION_SIGN':
      return await executeLegionSignIn(client);
    
    case 'ARENA':
      return await executeArena(client, config);
    
    case 'TOWER':
      return await executeTower(client, config);
    
    case 'BOSS_TOWER':
      return await executeBossTower(client, config);
    
    case 'WEIRD_TOWER':
      return await executeWeirdTower(client, config);

    case 'WEIRD_TOWER_FREE_ITEM':
      return await executeWeirdTowerFreeItem(client, config);

    case 'WEIRD_TOWER_USE_ITEM':
      return await executeWeirdTowerUseItem(client, config);

    case 'WEIRD_TOWER_MERGE_ITEM':
      return await executeWeirdTowerMergeItem(client, config);
    
    case 'LEGION_BOSS':
      return await executeLegionBoss(client, config);
    
    case 'RECRUIT':
      return await executeRecruit(client, config);

    case 'FRIEND_GOLD':
      return await executeFriendGold(client, config);

    case 'BUY_GOLD':
      return await executeBuyGold(client, config);
    
    case 'FISHING':
      return await executeFishing(client, config);
    
    case 'MAIL_CLAIM':
      return await executeMailClaim(client);
    
    case 'HANGUP_CLAIM':
      return await executeHangupClaim(client, config);
    
    case 'STUDY':
      return await executeStudy(client, config);
    
    case 'HANGUP_ADD_TIME':
      return await executeHangupAddTime(client, config);
    
    case 'BOTTLE_RESET':
      return await executeBottleReset(client, config);
    
    case 'BOTTLE_CLAIM':
      return await executeBottleClaim(client, config);
    
    case 'CAR_SEND':
      return await executeCarSend(client, config);
    
    case 'CAR_CLAIM':
      return await executeCarClaim(client, config);
    
    case 'BLACK_MARKET':
      return await executeBlackMarket(client, config);
    
    case 'TREASURE_CLAIM':
      return await executeTreasureClaim(client, config);
    
    case 'LEGACY_CLAIM':
      return await executeLegacyClaim(client, config, context);

    case 'LEGACY_REOPEN':
      return await executeLegacyReopen(client, config);
    
    case 'WELFARE_CLAIM':
      return await executeWelfareClaim(client, config);
    
    case 'DAILY_TASK_CLAIM':
      return await executeDailyTaskClaim(client, config);
    
    case 'DAILY_BOSS':
      return await executeDailyBoss(client, config);
    
    case 'DREAM':
      return await executeDream(client, config);
    
    case 'SKIN_CHALLENGE':
      return await executeSkinChallenge(client, config);

    case 'STAR_TEMPLE':
      return await executeStarTemple(client, config);
    
    case 'PEACH_TASK':
      return await executePeachTask(client, config);
    
    case 'BOX_OPEN':
      return await executeBoxOpen(client, config);

    case 'LEGION_STORE_FRAGMENT':
      return await executeLegionStoreFragment(client, config);
    
    case 'GENIE_SWEEP':
      return await executeGenieSweep(client, config);
    
    case 'DREAM_PURCHASE':
      return await executeDreamPurchase(client, config);

    default:
      throw new Error(`未知任务类型: ${taskType}`);
  }
}

async function executeSignIn(client) {
  try {
    const result = await client.signIn();
    return { message: '每日签到成功', data: result };
  } catch (error) {
    if (error.message.includes('已经签到')) {
      return { message: '今日已签到', data: {} };
    }
    throw error;
  }
}

async function executeLegionSignIn(client) {
  try {
    const result = await client.legionSignIn();
    return { message: '军团签到成功', data: result };
  } catch (error) {
    if (error.message.includes('未加入俱乐部')) {
      return { message: '未加入军团，跳过签到', data: {} };
    }
    throw error;
  }
}

async function executeArena(client, config) {
  return executeArenaScheduledTask(client, config);
}

async function executeTower(client, config) {
  return runWithTemporaryPresetTeam(client, config?.towerFormation, '爬塔', () =>
    executeTowerCore(client, config)
  );
}

async function executeTowerCore(client, config = {}) {
  const { maxFloors = 10 } = config;
  const results = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  await client.ensureBattleVersion();

  const claimPendingTowerReward = async () => {
    let rewardFloor = 0;
    try {
      const roleInfo = await client.getRoleInfo(8000);
      const towerId = Number(roleInfo?.role?.tower?.id || 0);
      rewardFloor = Math.floor(towerId / 10);
    } catch {
      // 忽略角色信息刷新失败
    }

    if (rewardFloor <= 0) return false;
    await client.claimTowerReward(rewardFloor);
    return true;
  };
  
  for (let i = 0; i < maxFloors; i++) {
    try {
      const result = await client.startTowerFight();
      results.push(result);
      await sleep(500);
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('已经全部通关') || message.includes('能量不足')) {
        break;
      }
      if (message.includes('上座塔的奖励未领取')) {
        try {
          const claimed = await claimPendingTowerReward();
          if (claimed) {
            results.push({ info: '已自动领取爬塔奖励，继续挑战' });
            await sleep(600);
            continue;
          }
          results.push({ error: '上座塔的奖励未领取，且自动领取失败' });
        } catch (claimError) {
          results.push({ error: `上座塔的奖励未领取，自动领取失败: ${claimError.message}` });
        }
        continue;
      }
      results.push({ error: message || '未知错误' });
    }
  }

  const successCount = results.filter(item => !item?.error).length;
  if (successCount === 0 && results.length > 0) {
    const firstError = results.find(item => item?.error)?.error || '未知错误';
    throw new Error(`爬塔执行失败: ${firstError}`);
  }

  return { message: `爬塔完成 (${successCount}层)`, data: { results, successCount } };
}

async function executeBossTower(client, config) {
  await client.ensureBattleVersion();
  try {
    const result = await client.startBossFight();
    return { message: '咸王宝库挑战成功', data: result };
  } catch (error) {
    if (error.message.includes('次数')) {
      return { message: '今日挑战次数已用完', data: {} };
    }
    throw error;
  }
}

async function executeWeirdTower(client, config) {
  return runWithTemporaryPresetTeam(client, config?.weirdTowerFormation, '怪异塔', () =>
    executeWeirdTowerCore(client, config)
  );
}

async function executeWeirdTowerCore(client, config = {}) {
  const results = [];
  let successCount = 0;
  const maxFloors = Math.min(100, Math.max(1, Number(config?.weirdTowerMaxFloors ?? 100) || 100));
  
  // 获取怪异塔信息
  let towerInfo;
  try {
    towerInfo = await client.sendWithPromise('evotower_getinfo', {}, 8000);
  } catch (error) {
    return { message: `获取怪异塔信息失败: ${error.message}`, data: { results: [], successCount: 0 } };
  }
  
  let currentEnergy = towerInfo?.evoTower?.energy || 0;
  if (currentEnergy <= 0) {
    return { message: '怪异塔能量不足', data: { results: [], successCount: 0, energy: 0 } };
  }
  
  let count = 0;
  let consecutiveFailures = 0;
  
  while (currentEnergy > 0 && count < maxFloors) {
    try {
      // 准备战斗
      await client.sendWithPromise('evotower_readyfight', {}, 5000);
      
      // 战斗
      const fightResult = await client.sendWithPromise('evotower_fight', { 
        battleNum: 1, 
        winNum: 1 
      }, 10000);
      
      count++;
      successCount++;
      consecutiveFailures = 0;
      results.push({ floor: count, ok: true, result: fightResult });
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 获取最新信息
      const newInfo = await client.sendWithPromise('evotower_getinfo', {}, 5000);
      
      // 检查并领取每日任务奖励
      if (newInfo?.evoTower?.taskClaimMap) {
        const now = new Date();
        const year = now.getFullYear().toString().slice(2);
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');
        const dateKey = `${year}${month}${day}`;
        const dailyTasks = newInfo.evoTower.taskClaimMap[dateKey] || {};
        
        for (const taskId of [1, 2, 3]) {
          if (!dailyTasks[taskId]) {
            try {
              await client.sendWithPromise('evotower_claimtask', { taskId }, 2000);
            } catch (e) {
              // 忽略领取失败
            }
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      }
      
      // 检查是否通关10层，领取通关奖励
      const towerId = newInfo?.evoTower?.towerId || 0;
      const floor = (towerId % 10) + 1;
      if (fightResult?.winList?.[0] === true && floor === 1) {
        try {
          await client.sendWithPromise('evotower_claimreward', {}, 5000);
        } catch (e) {
          // 忽略领取失败
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // 刷新能量
      currentEnergy = newInfo?.evoTower?.energy || 0;
      
    } catch (error) {
      consecutiveFailures++;
      results.push({ floor: count + 1, ok: false, error: error.message });
      
      if (consecutiveFailures >= 3) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return { 
    message: `怪异塔爬塔完成 (${successCount}/${count}次)`, 
    data: { results, successCount, totalFloors: count, maxFloors } 
  };
}

async function executeWeirdTowerFreeItem(client, config) {
  const info = await client.sendWithPromise('mergebox_getinfo', { actType: 1 }, 5000);
  const freeEnergy = Number(info?.mergeBox?.freeEnergy || 0) || 0;
  if (freeEnergy <= 0) {
    return { message: '暂无怪异塔免费道具可领取', data: { freeEnergy: 0 } };
  }

  const result = await client.sendWithPromise('mergebox_claimfreeenergy', { actType: 1 }, 5000);
  return { message: `怪异塔免费道具领取完成 (${freeEnergy}个)`, data: { freeEnergy, result } };
}

async function executeWeirdTowerUseItem(client, config) {
  const infoRes = await client.sendWithPromise('mergebox_getinfo', { actType: 1 }, 5000);
  const towerInfoRes = await client.sendWithPromise('evotower_getinfo', {}, 5000);

  if (!infoRes?.mergeBox) {
    throw new Error('获取怪异塔活动信息失败');
  }

  let costTotalCnt = Number(infoRes.mergeBox.costTotalCnt || 0) || 0;
  let lotteryLeftCnt = Number(towerInfoRes?.evoTower?.lotteryLeftCnt || 0) || 0;
  if (lotteryLeftCnt <= 0) {
    return { message: '没有剩余怪异塔道具可使用', data: { processedCount: 0 } };
  }

  let processedCount = 0;
  while (lotteryLeftCnt > 0) {
    let pos = { gridX: 6, gridY: 3 };
    if (costTotalCnt < 2) {
      pos = { gridX: 4, gridY: 5 };
    } else if (costTotalCnt < 102) {
      pos = { gridX: 7, gridY: 3 };
    }

    await client.sendWithPromise('mergebox_openbox', { actType: 1, pos }, 5000);
    costTotalCnt += 1;
    lotteryLeftCnt -= 1;
    processedCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await client.sendWithPromise('mergebox_claimcostprogress', { actType: 1 }, 5000).catch(() => null);
  return { message: `使用怪异塔道具完成 (${processedCount}次)`, data: { processedCount } };
}

async function executeWeirdTowerMergeItem(client, config) {
  let mergedCount = 0;
  let claimedRewardCount = 0;
  const MAX_LOOPS = 20;

  for (let loopCount = 0; loopCount < MAX_LOOPS; loopCount += 1) {
    const infoRes = await client.sendWithPromise('mergebox_getinfo', { actType: 1 }, 5000);
    if (!infoRes?.mergeBox) {
      throw new Error('获取怪异塔合成信息失败');
    }

    if (infoRes.mergeBox.taskMap) {
      const taskMap = infoRes.mergeBox.taskMap;
      const taskClaimMap = infoRes.mergeBox.taskClaimMap || {};
      for (const taskId of Object.keys(taskMap)) {
        if (taskMap[taskId] !== 0 && !taskClaimMap[taskId]) {
          const claimed = await client.sendWithPromise(
            'mergebox_claimmergeprogress',
            { actType: 1, taskId: Number(taskId) },
            2000,
          ).catch(() => null);
          if (claimed) {
            claimedRewardCount += 1;
          }
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    }

    const gridMap = infoRes.mergeBox.gridMap || {};
    const groupedItems = {};
    for (const xStr of Object.keys(gridMap)) {
      for (const yStr of Object.keys(gridMap[xStr] || {})) {
        const item = gridMap[xStr][yStr];
        if (item?.gridConfId == 0 && item?.gridItemId > 0 && !item?.isLock) {
          const key = String(item.gridItemId);
          if (!groupedItems[key]) {
            groupedItems[key] = [];
          }
          groupedItems[key].push({ x: Number(xStr), y: Number(yStr) });
        }
      }
    }

    const hasPotentialMerge = Object.values(groupedItems).some((group) => Array.isArray(group) && group.length >= 2);
    if (!hasPotentialMerge) {
      if (mergedCount === 0 && claimedRewardCount === 0) {
        return { message: '当前没有可合成的怪异塔物品', data: { mergedCount: 0, claimedRewardCount: 0 } };
      }
      return { message: `怪异塔合成完成 (${mergedCount}次合成, ${claimedRewardCount}次领奖)`, data: { mergedCount, claimedRewardCount } };
    }

    const isLevel8OrAbove = Boolean(infoRes.mergeBox.taskMap?.['251212208']);
    if (isLevel8OrAbove) {
      await client.sendWithPromise('mergebox_automergeitem', { actType: 1 }, 10000);
      mergedCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }

    let loopMerged = 0;
    for (const group of Object.values(groupedItems)) {
      while (Array.isArray(group) && group.length >= 2) {
        const source = group.shift();
        const target = group.shift();
        await client.sendWithPromise(
          'mergebox_mergeitem',
          {
            actType: 1,
            sourcePos: { gridX: source.x, gridY: source.y },
            targetPos: { gridX: target.x, gridY: target.y },
          },
          1000,
        ).catch(() => null);
        loopMerged += 1;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (loopMerged === 0) {
      break;
    }
    mergedCount += loopMerged;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return { message: `怪异塔合成完成 (${mergedCount}次合成, ${claimedRewardCount}次领奖)`, data: { mergedCount, claimedRewardCount } };
}

async function executeLegionBoss(client, config) {
  await client.ensureBattleVersion();
  const bossTimes = Math.max(0, Number(config?.bossTimes ?? 2) || 0);
  const bossFormation = Number(config?.bossFormation ?? 1) || 1;
  const results = [];
  let successCount = 0;
  let switchedFormation = false;
  let originalFormation = null;

  if (bossTimes <= 0) {
    return {
      message: '军团BOSS已关闭（挑战次数为0）',
      data: { results, successCount, bossTimes, bossFormation },
    };
  }

  try {
    const teamInfo = await client.getPresetTeamInfo();
    originalFormation = teamInfo?.presetTeamInfo?.useTeamId;
    console.log(`[军团BOSS] 当前阵容: ${originalFormation}, 目标阵容: ${bossFormation}`);
    
    if (originalFormation !== bossFormation) {
      console.log(`[军团BOSS] 切换阵容 ${originalFormation} -> ${bossFormation}`);
      await client.savePresetTeam(bossFormation);
      switchedFormation = true;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.warn(`[军团BOSS] 阵容切换失败，使用当前阵容: ${error.message}`);
  }
  
  for (let i = 0; i < bossTimes; i++) {
    try {
      const result = await client.startLegionBossFight();
      results.push({ round: i + 1, ok: true, result });
      successCount++;
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      if (error.message.includes('次数') || error.message.includes('未加入')) {
        results.push({ round: i + 1, ok: false, error: error.message, stop: true });
        break;
      }
      results.push({ round: i + 1, ok: false, error: error.message });
    }
  }

  if (switchedFormation && originalFormation) {
    try {
      console.log(`[军团BOSS] 恢复原阵容: ${bossFormation} -> ${originalFormation}`);
      await client.savePresetTeam(originalFormation);
    } catch (error) {
      console.warn(`[军团BOSS] 恢复原阵容失败: ${error.message}`);
    }
  }
  
  return { 
    message: `军团BOSS挑战完成 (${successCount}/${bossTimes}次)`, 
    data: { results, successCount, bossTimes, bossFormation } 
  };
}

async function executeRecruit(client, config) {
  const results = [];
  const maxReconnectRetries = Math.max(0, Number(config?.reconnectRetries ?? 1) || 0);

  const hasNewSwitches = config?.useFreeRecruit !== undefined || config?.usePaidRecruit !== undefined;
  if (hasNewSwitches) {
    const rawFreeRecruitCount = Math.max(0, Number(config?.freeRecruitCount ?? 1) || 0);
    const rawPaidRecruitCount = Math.max(0, Number(config?.paidRecruitCount ?? 1) || 0);
    const useFreeRecruit = config?.useFreeRecruit !== false && rawFreeRecruitCount > 0;
    const usePaidRecruit = config?.usePaidRecruit !== false && rawPaidRecruitCount > 0;
    const freeRecruitCount = useFreeRecruit ? Math.max(1, rawFreeRecruitCount || 1) : 0;
    const paidRecruitCount = usePaidRecruit ? Math.max(1, rawPaidRecruitCount || 1) : 0;

    if (!useFreeRecruit && !usePaidRecruit) {
      return { message: '招募已关闭（免费/付费都未启用）', data: { results: [], successCount: 0, totalCount: 0 } };
    }

    if (useFreeRecruit) {
      for (let i = 0; i < freeRecruitCount; i++) {
        const result = await recruitWithReconnect(client, 3, 'free', maxReconnectRetries);
        results.push(result);
        if (!result.ok) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }

    if (usePaidRecruit) {
      for (let i = 0; i < paidRecruitCount; i++) {
        const result = await recruitWithReconnect(client, 1, 'paid', maxReconnectRetries);
        results.push(result);
        if (!result.ok) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  } else {
    // 兼容旧配置：按 recruitType/count 执行
    const recruitType = Number(config?.recruitType ?? 1) || 1;
    const count = Math.max(1, Number(config?.count ?? 2) || 2);
    for (let i = 0; i < count; i++) {
      const result = await recruitWithReconnect(client, recruitType, 'legacy', maxReconnectRetries);
      results.push(result);
      if (!result.ok) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '招募失败');
  }
  return { message: `招募完成 (${successCount}/${results.length}次)`, data: { results, successCount, totalCount: results.length } };
}

async function executeFriendGold(client, config) {
  const count = Math.max(1, Number(config?.count || config?.friendGoldCount || 3));
  const results = [];
  for (let i = 0; i < count; i++) {
    try {
      const result = await client.sendFriendGold(0);
      results.push({ ok: true, result });
    } catch (error) {
      results.push({ ok: false, error: error.message });
      if (String(error.message || '').includes('次数') || String(error.message || '').includes('上限')) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '送好友金币失败');
  }
  return { message: `送好友金币完成 (${successCount}/${results.length})`, data: { results, successCount, count } };
}

async function executeBuyGold(client, config) {
  const buyNum = Math.max(1, Number(config?.buyNum || config?.buyGoldTimes || 3));
  const results = [];
  for (let i = 0; i < buyNum; i++) {
    try {
      const result = await client.buyGold(1);
      results.push({ ok: true, result });
    } catch (error) {
      results.push({ ok: false, error: error.message });
      if (String(error.message || '').includes('次数') || String(error.message || '').includes('不足')) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '点金执行失败');
  }
  return { message: `点金完成 (${successCount}/${results.length})`, data: { buyNum, results, successCount } };
}

async function executeFishing(client, config) {
  const { count = 3, type = 1 } = config;
  const results = [];
  
  for (let i = 0; i < count; i++) {
    try {
      const result = await client.fishing(1, type);
      results.push({ ok: true, result });
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      if (error.message.includes('次数')) {
        break;
      }
      results.push({ ok: false, error: error.message });
    }
  }

  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '钓鱼失败');
  }
  return { message: `钓鱼完成 (${successCount}/${results.length}次)`, data: { results, successCount, count, type } };
}

async function executeMailClaim(client) {
  return executeMailClaimScheduledTask(client);
}

async function executeHangupClaim(client, config) {
  const count = Math.max(1, Number(config?.count || config?.hangupClaimCount || 5));
  const results = [];
  for (let i = 0; i < count; i++) {
    try {
      const result = await client.claimHangupReward();
      results.push({ ok: true, result });
    } catch (error) {
      results.push({ ok: false, error: error.message });
      if (error.message.includes('频繁')) {
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '挂机奖励领取失败');
  }
  return { message: `挂机奖励领取完成 (${successCount}/${results.length})`, data: { results, successCount, count } };
}

async function executeStudy(client, config) {
  return await executeStudyChallenge(client, {
    maxStudyAttempts: 3,
    answerDelayMs: 300,
    answerToRewardDelayMs: 1500,
    rewardDelayMs: 200,
    logContext: {
      accountId: client.accountId ?? null,
      accountName: client.accountName || null,
      source: 'scheduler',
    },
    findAnswer: resolveStudyAnswer,
  });
}

async function executeHangupAddTime(client, config) {
  try {
    const result = await client.addHangupTime();
    return { message: '加钟成功', data: result };
  } catch (error) {
    if (error.message.includes('次数')) {
      return { message: '今日加钟次数已用完', data: {} };
    }
    throw error;
  }
}

async function executeBottleReset(client, config) {
  try {
    const result = await client.resetBottles();
    return { message: '罐子重置成功', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeBottleClaim(client, config) {
  try {
    const result = await client.claimAllBottles();
    return { message: '罐子领取成功', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeCarSend(client, config) {
  try {
    const result = await client.smartSendCar(normalizeSmartSendCarOptions(config));
    return { message: buildCarSendTaskMessage(result), data: result };
  } catch (error) {
    throw error;
  }
}

async function executeCarClaim(client, config) {
  try {
    const result = await client.claimAllCars();
    return { message: buildCarClaimTaskMessage(result), data: result };
  } catch (error) {
    throw error;
  }
}

async function executeBlackMarket(client, config) {
  const results = [];

  try {
    const result = await client.blackMarketPurchase();
    results.push({ ok: true, command: 'store_purchase', mode: 'purchase_list', result });
    return { message: '使用游戏采购清单成功', data: { results, successCount: 1, mode: 'purchase_list' } };
  } catch (error) {
    const message = String(error?.message || '黑市采购失败');
    results.push({ ok: false, command: 'store_purchase', mode: 'purchase_list', error: message });

    if (!message.includes('商店采购未开启')) {
      throw new Error(message);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 250));

  try {
    const result = await client.directStoreBuy(1);
    results.push({
      ok: true,
      command: 'store_buy',
      mode: 'fallback',
      goodsId: 1,
      itemName: '青铜宝箱',
      quantity: 1,
      displayName: '购买青铜宝箱*1',
      result,
    });

    return {
      message: '黑市采购未开启，已兜底购买青铜宝箱*1',
      data: { results, successCount: 1, fallbackUsed: true, goodsId: 1 },
    };
  } catch (error) {
    const message = String(error?.message || '黑市采购失败');
    results.push({
      ok: false,
      command: 'store_buy',
      mode: 'fallback',
      goodsId: 1,
      itemName: '青铜宝箱',
      quantity: 1,
      displayName: '购买青铜宝箱*1',
      error: message,
    });
    throw new Error(message);
  }
}

async function executeTreasureClaim(client, config) {
  try {
    const result = await client.claimTreasureFreeReward();
    return { message: '珍宝阁领取完成', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeLegacyClaim(client, config, context = {}) {
  return executeLegacyClaimWithAutoReopen(client, config, context);
}

async function executeLegacyReopen(client, config) {
  const result = await client.reopenLegacyHangup();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const latestLegacyInfo = await client.getLegacyInfo().catch(() => null);

  return {
    message: '残卷挂机重新开启成功',
    data: {
      ...result,
      latestLegacyInfo,
    },
  };
}

async function executeWelfareClaim(client, config) {
  const results = [];
  const rewards = [
    { name: '福利签到', cmd: 'system_signinreward' },
    { name: '俱乐部签到', cmd: 'legion_signin' },
    { name: '领取每日礼包', cmd: 'discount_claimreward', params: { discountId: 1 } },
    { name: '领取每日免费奖励', cmd: 'collection_claimfreereward' },
    { name: '领取免费礼包', cmd: 'card_claimreward', params: { cardId: 1 } },
    { name: '领取永久卡礼包', cmd: 'card_claimreward', params: { cardId: 4003 } },
  ];
  
  for (const reward of rewards) {
    try {
      const result = await client.sendWithPromise(reward.cmd, reward.params || {});
      results.push({ name: reward.name, ok: true, result });
    } catch (error) {
      results.push({ name: reward.name, ok: false, error: error.message });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  
  const successCount = results.filter((x) => x.ok).length;
  return { 
    message: `福利奖励领取完成 (${successCount}/${results.length})`, 
    data: { results, successCount } 
  };
}

async function executeDailyTaskClaim(client, config) {
  return executeDailyTaskClaimScheduledTask(client, config);
}

function getTodayBossId() {
  const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];
  const dayOfWeek = new Date().getDay();
  return DAY_BOSS_MAP[dayOfWeek];
}

async function executeDailyBoss(client, config) {
  await client.ensureBattleVersion();
  const todayBossId = getTodayBossId();
  const results = [];
  let successCount = 0;
  const maxAttempts = 5;
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await client.startDailyBossFight(todayBossId);
      results.push({ round: i + 1, ok: true, result });
      successCount++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      if (error.message.includes('次数') || error.message.includes('已挑战')) {
        results.push({ round: i + 1, ok: false, error: error.message, stop: true });
        break;
      }
      results.push({ round: i + 1, ok: false, error: error.message });
    }
  }
  
  return { 
    message: `每日咸王挑战完成 (${successCount}/${results.length}次)`, 
    data: { results, successCount, bossId: todayBossId } 
  };
}

async function executeDream(client, config) {
  const result = await client.startDreamBattle();
  if (result.skipped) {
    return { message: result.reason, data: result };
  }
  return { message: '梦境挑战完成', data: result };
}

async function executeSkinChallenge(client, config) {
  const result = await client.startSkinChallenge();
  if (result.skipped) {
    return { message: result.reason, data: result };
  }
  const clearedCount = result.clearedCount || 0;
  return { message: `换皮闯关完成 (通关${clearedCount}个BOSS)`, data: result };
}

function getStarTemplePresetType(bossId) {
  return 100 + Number(bossId || 1);
}

function getStarTempleCurrentStars(info, bossId) {
  const roleNMExt = info?.roleNMExt || {};
  const completeMap = roleNMExt.starBossCompleteMap || {};
  const completedStarMap = completeMap[bossId] || completeMap[String(bossId)] || {};
  return Object.keys(completedStarMap).filter((key) => completedStarMap[key]).length;
}

function getStarTempleStageConfig(config = {}, bossId) {
  const stages = config?.stages && typeof config.stages === 'object' ? config.stages : {};
  return stages[bossId] || stages[String(bossId)] || null;
}

function hasStarTemplePresetTeam(presetTeam) {
  const teamInfo = presetTeam?.teamInfo || {};
  return Object.values(teamInfo).some((hero) => Number(hero?.heroId || hero?.id || 0) > 0);
}

function buildStarTempleBattleTeamMap(presetTeam) {
  const teamInfo = presetTeam?.teamInfo || {};
  const battleTeam = new Map();

  for (let slot = 0; slot < 5; slot += 1) {
    const hero = teamInfo[slot] || teamInfo[String(slot)] || null;
    battleTeam.set(slot, Number(hero?.heroId || hero?.id || 0) || 0);
  }

  if (![...battleTeam.values()].some((heroId) => heroId > 0)) {
    throw new Error('该账号暂无十殿预设阵容，不能挑战');
  }

  return battleTeam;
}

async function loadStarTempleContext(client, bossId) {
  let roleId = Number(client?.roleId || 0);
  if (!roleId) {
    const roleInfo = await client.getRoleInfo(10000);
    roleId = Number(roleInfo?.role?.roleId || roleInfo?.roleId || roleInfo?.id || 0);
  }

  if (roleId) {
    await client.getNightmareRoleInfo(roleId, 10000).catch(() => null);
    await sleep(STAR_TEMPLE_COMMAND_DELAY_MS);
  }

  const info = await client.getStarTempleInfo(10000);
  await sleep(STAR_TEMPLE_COMMAND_DELAY_MS);

  const presetType = getStarTemplePresetType(bossId);
  const presetResult = await client.getPresetTeamByTypes([presetType], 10000);
  const presetTeamMap =
    presetResult?.presetTeamMap ||
    presetResult?.presetTeamInfo?.presetTeamMap ||
    presetResult?.presetTeamInfo ||
    {};
  const presetTeam = presetTeamMap[presetType] || presetTeamMap[String(presetType)] || null;

  return {
    roleId,
    info,
    presetType,
    presetTeam,
  };
}

function addStarTempleTaskStageLog(client, message, details = null, status = 'info') {
  if (!client?.accountId) return;
  addTaskLog(client.accountId, 'STAR_TEMPLE', status, message, details ? JSON.stringify(details) : null);
}

async function executeStarTemple(client, config = {}) {
  const stageResults = [];
  const roleInfo = await client.getRoleInfo(10000).catch(() => null);
  if (roleInfo?.role?.roleId || roleInfo?.roleId || roleInfo?.id) {
    client.roleId = Number(roleInfo?.role?.roleId || roleInfo?.roleId || roleInfo?.id || 0);
  }

  for (const bossId of STAR_TEMPLE_BOSS_IDS) {
    const stageConfig = getStarTempleStageConfig(config, bossId);
    const targetStars = Number(stageConfig?.targetStars);
    const maxAttempts = Number(stageConfig?.maxAttempts);

    if (!Number.isInteger(targetStars) || !Number.isInteger(maxAttempts) || targetStars <= 0 || maxAttempts <= 0) {
      const message = `第 ${bossId} 关：未配置目标星级或挑战次数，结束任务`;
      addStarTempleTaskStageLog(client, message, { bossId, stageConfig }, 'info');
      stageResults.push({ bossId, status: 'stopped', reason: 'missing_config' });
      break;
    }

    const context = await loadStarTempleContext(client, bossId);
    const currentStars = getStarTempleCurrentStars(context.info, bossId);
    if (currentStars >= targetStars) {
      const message = `第 ${bossId} 关：已达目标${targetStars}星，跳过`;
      addStarTempleTaskStageLog(client, message, { bossId, targetStars, currentStars }, 'ignored');
      stageResults.push({ bossId, status: 'skipped', targetStars, currentStars });
      continue;
    }

    if (!hasStarTemplePresetTeam(context.presetTeam)) {
      const message = `第 ${bossId} 关：无预设阵容，结束任务`;
      addStarTempleTaskStageLog(client, message, { bossId, presetType: context.presetType }, 'info');
      stageResults.push({ bossId, status: 'stopped', reason: 'missing_preset' });
      break;
    }

    if (bossId > 1) {
      const previousStars = getStarTempleCurrentStars(context.info, bossId - 1);
      if (previousStars <= 0) {
        const message = `第 ${bossId} 关：当前不可挑战，结束任务`;
        addStarTempleTaskStageLog(client, message, { bossId, previousStars }, 'info');
        stageResults.push({ bossId, status: 'stopped', reason: 'not_unlocked' });
        break;
      }
    }

    const battleTeam = buildStarTempleBattleTeamMap(context.presetTeam);
    const lordWeaponId = Number(context.presetTeam?.weapon?.weaponId || 0) || 0;
    let bestStars = currentStars;
    let success = false;
    let attemptsUsed = 0;

    await client.calcPresetTeamPower(context.presetType, battleTeam, lordWeaponId, 10000).catch(() => null);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attemptsUsed = attempt;
      const result = await client.startStarTempleBoss(
        bossId,
        battleTeam,
        lordWeaponId,
        context.presetType,
        15000
      );

      const attemptStars = Array.isArray(result?.nowStarIdxList)
        ? result.nowStarIdxList.map((item) => Number(item)).filter((item) => !Number.isNaN(item)).length
        : (result?.isWin ? targetStars : 0);
      bestStars = Math.max(bestStars, attemptStars);
      if (bestStars >= targetStars) {
        success = true;
        break;
      }
      await sleep(STAR_TEMPLE_COMMAND_DELAY_MS);
    }

    if (success) {
      const message = `第 ${bossId} 关：挑战${attemptsUsed}次，达到${bestStars}星`;
      addStarTempleTaskStageLog(client, message, {
        bossId,
        attemptsUsed,
        bestStars,
        targetStars,
      }, 'success');
      stageResults.push({ bossId, status: 'success', attemptsUsed, bestStars, targetStars });
      continue;
    }

    const message = `第 ${bossId} 关：挑战${attemptsUsed}次，最高${bestStars}星，未达目标${targetStars}星，继续下一关`;
    addStarTempleTaskStageLog(client, message, {
      bossId,
      attemptsUsed,
      bestStars,
      targetStars,
    }, 'info');
    stageResults.push({ bossId, status: 'continue', attemptsUsed, bestStars, targetStars });
  }

  const successCount = stageResults.filter((item) => item.status === 'success').length;
  const skippedCount = stageResults.filter((item) => item.status === 'skipped').length;
  return {
    message: `星级十殿任务完成 (达标${successCount}关, 跳过${skippedCount}关)`,
    data: {
      stageResults,
      successCount,
      skippedCount,
    },
  };
}

async function executeDreamPurchase(client, config) {
  const purchaseList = config?.purchaseList || [];
  if (!Array.isArray(purchaseList) || purchaseList.length === 0) {
    return { message: '购买清单为空，跳过购买', data: {} };
  }
  const result = await client.buyDreamItems(purchaseList);
  if (result.skipped) {
    return { message: result.reason, data: result };
  }
  return { message: `梦境购买完成 (成功${result.successCount}/${result.results?.length || 0})`, data: result };
}

async function executePeachTask(client, config) {
  try {
    const result = await client.claimPeachTasks();
    return { message: '蟠桃园任务领取完成', data: result };
  } catch (error) {
    throw error;
  }
}

async function executeBoxOpen(client, config) {
  const itemId = Number(config?.boxType ?? config?.itemId ?? 2001) || 2001;
  const totalCount = Math.max(1, Number(config?.number ?? config?.count ?? 3) || 3);
  const batchSize = 10;
  const fullBatches = Math.floor(totalCount / batchSize);
  const remainder = totalCount % batchSize;
  const results = [];

  await client.getRoleInfo(8000).catch(() => {});
  for (let i = 0; i < fullBatches; i++) {
    const result = await client.openBox(itemId, batchSize);
    results.push({ ok: true, number: batchSize, result });
    await new Promise((resolve) => setTimeout(resolve, 220));
  }
  if (remainder > 0) {
    const result = await client.openBox(itemId, remainder);
    results.push({ ok: true, number: remainder, result });
  }
  try {
    await client.claimBoxPointReward();
  } catch {
    // 积分奖励领取失败不影响主流程
  }

  return {
    message: `开箱完成 (itemId=${itemId}, number=${totalCount})`,
    data: { itemId, number: totalCount, requestCount: results.length, results }
  };
}

async function executeLegionStoreFragment(client, config) {
  try {
    const result = await client.sendWithPromise('legion_storebuygoods', { id: 6 }, 5000);
    return { message: '购买四圣碎片成功', data: result };
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('俱乐部商品购买数量超出上限')) {
      return { message: '本周已购买过四圣碎片', data: {} };
    }
    if (message.includes('物品不存在')) {
      return { message: '盐锭不足或未加入军团，无法购买四圣碎片', data: {} };
    }
    throw error;
  }
}

async function executeGenieSweep(client, config) {
  const result = await client.genieDailySweep(config);
  if (result?.skipped) {
    return { message: `灯神扫荡跳过: ${result.reason}`, data: result };
  }

  const sweptNames = (result?.sweepResults || [])
    .filter((item) => item.success)
    .map((item) => item.name)
    .join('、');
  const sweptSummary = sweptNames || '无';
  return {
    message: `灯神扫荡完成 (扫荡:${sweptSummary}, 领取扫荡券:${result?.claimedTickets || 0}次)`,
    data: result,
  };
}

export function stopScheduler() {
  if (schedulerRefreshJob) {
    schedulerRefreshJob.stop();
    schedulerRefreshJob = null;
  }

  if (dailyCatchupJob) {
    dailyCatchupJob.stop();
    dailyCatchupJob = null;
  }

  for (const [, { jobs = [] }] of scheduledJobs) {
    jobs.forEach((job) => job.stop());
  }
  scheduledJobs.clear();
  connectionPromises.clear();

  for (const entry of pendingAccountTaskBatches.values()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
  }
  pendingAccountTaskBatches.clear();
  
  for (const entry of dailyRewardFlushState.values()) {
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
  }
  dailyRewardFlushState.clear();
  
  for (const [accountId, client] of activeConnections) {
    client.disconnect();
    unregisterAccountClient(accountId, client);
  }
  activeConnections.clear();
  
  console.log('🛑 定时任务调度器已停止');
}

export function getActiveConnections() {
  return activeConnections;
}

export function getScheduledJobs() {
  return scheduledJobs;
}

export default {
  initScheduler,
  scheduleTask,
  executeTask,
  runDailyTaskCatchup,
  stopScheduler,
  getActiveConnections,
  getScheduledJobs
};
