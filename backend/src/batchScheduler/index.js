import cron from 'node-cron';
import { get, all, run } from '../database/index.js';
import { decrypt } from '../utils/crypto.js';
import GameClient from '../utils/gameClient.js';
import config from '../config/index.js';
import { updateBatchTaskRunTime, updateBatchTaskRunTimesBatch, addBatchTaskLogEntry } from '../routes/batchScheduler.js';
import { resolveStudyAnswer } from '../utils/studyQuestions.js';
import { parseTokenPayload } from '../utils/token.js';
import { calculateNextRunAt, resolveBatchCronExpression } from '../utils/cronSchedule.js';
import {
  buildCarClaimTaskMessage,
  buildCarSendTaskMessage,
  claimDailyPointWithRetry,
  didDailyTaskClaimConfirmReward,
  executeArenaScheduledTask,
  executeMailClaimScheduledTask,
  executeDailyTaskClaimScheduledTask,
  executeLegacyClaimWithAutoReopen,
  normalizeSmartSendCarOptions,
  runWithTemporaryPresetTeam,
} from '../utils/scheduledTaskHelpers.js';
import {
  runAccountTaskExclusive,
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
  isTooFastError,
  sleep,
  waitForScheduledTaskStagger,
} from '../utils/taskExecutionControl.js';
import {
  executeStudyChallenge,
} from '../utils/studyTask.js';

const scheduledBatchJobs = new Map();
const activeConnections = new Map();
const runningTasks = new Set();
let batchSchedulerRefreshJob = null;
const DAILY_REWARD_POST_RETRY_DELAY_MS = 15000;
const DAILY_REWARD_POST_RETRY_MAX_ATTEMPTS = 3;
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

function isRetryableWsError(error) {
  const message = String(error?.message || error || '');
  return message.includes('WebSocket未连接') || message.includes('WebSocket连接已断开');
}

function parseTaskConfigJson(configJson) {
  if (!configJson) {
    return {};
  }

  try {
    return JSON.parse(configJson);
  } catch {
    return {};
  }
}

function getAccountTaskConfig(accountId, taskType) {
  const row = get(
    `SELECT config_json
       FROM task_configs
      WHERE account_id = ? AND task_type = ?
      ORDER BY id DESC
      LIMIT 1`,
    [accountId, taskType]
  );

  return parseTaskConfigJson(row?.config_json);
}

function discardInactiveClient(accountId, accountName, client, reason) {
  console.warn('🧹 丢弃不可复用的批量任务连接', {
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
    console.log(`🔥 ${label}批量任务重连预热完成`, {
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

    console.warn(`⚠️ ${label}批量任务重连失败，尝试通过后端持久化BIN刷新Token`, {
      accountId: accountId || null,
      accountName,
      error: normalizeErrorMessage(error),
      handshake: client?.lastConnectMeta || null,
    });

    if (!Number.isFinite(accountId) || accountId <= 0) {
      throw error;
    }

    const refreshed = await getRefreshedTokenSessionFromStoredBin(accountId, {
      trigger: 'batch-reconnect',
      currentWsUrl: client?.wsUrl || '',
    });

    if (!refreshed?.refreshed || !refreshed?.candidates?.length) {
      throw error;
    }

    const refreshedToken = refreshed.tokenMeta?.token || refreshed.token;
    client.token = refreshedToken;
    client.roleId = refreshed.roleId || client.roleId || null;
    client.wsUrl = resolveWsUrl(refreshed.wsUrl || client.wsUrl || '', refreshedToken);

    console.log(`♻️ ${label}批量任务已切换为后端BIN刷新后的Token重连`, {
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

export async function initBatchScheduler() {
  console.log('🕐 初始化批量任务调度器...');
  
  const tasks = all(
    `SELECT bst.*
     FROM batch_scheduled_tasks bst
     JOIN users u ON bst.user_id = u.id
     WHERE bst.enabled = 1
       AND COALESCE(u.is_enabled, 1) = 1
       AND (u.access_start_at IS NULL OR datetime(u.access_start_at) <= datetime('now'))
       AND (u.access_end_at IS NULL OR datetime(u.access_end_at) >= datetime('now'))`
  );
  
  console.log(`📋 找到 ${tasks.length} 个启用的批量任务`);
  const startupRunTimeUpdates = [];
  let scheduledCount = 0;

  for (const task of tasks) {
    const scheduled = scheduleBatchTask(task, {
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
    await updateBatchTaskRunTimesBatch(startupRunTimeUpdates);
  }

  if (scheduledCount > 0) {
    console.log('📅 已完成批量任务批量注册', {
      scheduledCount,
      nextRunAtPersistedCount: startupRunTimeUpdates.length,
    });
  }

  if (batchSchedulerRefreshJob) {
    batchSchedulerRefreshJob.stop();
    batchSchedulerRefreshJob = null;
  }
  batchSchedulerRefreshJob = cron.schedule('* * * * *', async () => {
    await checkAndRunDueBatchTasks();
  }, {
    timezone: config.cron.timezone
  });

  console.log('✅ 批量任务调度器初始化完成');
}

export function scheduleBatchTask(task, options = {}) {
  const {
    persistNextRun = true,
    logScheduled = true,
  } = options;
  const taskId = Number(task.id);

  if (scheduledBatchJobs.has(taskId)) {
    const existingJob = scheduledBatchJobs.get(taskId);
    if (existingJob.job) {
      existingJob.job.stop();
    }
  }

  if (!task.enabled) {
    return { scheduled: false, nextRunAt: null };
  }

  const cronExpression = resolveBatchCronExpression(task);
  if (!cronExpression) {
    console.error(`❌ 批量任务 ${task.name} 没有有效的调度配置`);
    return;
  }

  try {
    const nextRunAt = calculateNextRunAt(cronExpression);
    const job = cron.schedule(cronExpression, async () => {
      try {
        await waitForScheduledTaskStagger({
          scope: 'batch',
          taskId,
          taskName: task.name || null,
          taskType: 'BATCH',
          cronExpression,
        });
        await executeBatchTask(task);
      } finally {
        const nextRunAt = calculateNextRunAt(cronExpression);
        const scheduled = scheduledBatchJobs.get(taskId);
        if (scheduled) {
          scheduled.nextRun = nextRunAt;
        }
        updateBatchTaskRunTime(taskId, new Date().toISOString(), nextRunAt);
      }
    }, {
      timezone: config.cron.timezone
    });

    scheduledBatchJobs.set(taskId, {
      job,
      cronExpression,
      nextRun: nextRunAt
    });

    if (persistNextRun) {
      updateBatchTaskRunTime(taskId, null, nextRunAt);
    }
    
    if (logScheduled) {
      console.log(`📅 已调度批量任务: ${task.name} (${cronExpression})`);
    }
    return { scheduled: true, nextRunAt };
  } catch (error) {
    console.error(`❌ 调度批量任务失败: ${task.name}:`, error.message);
    return { scheduled: false, nextRunAt: null, error };
  }
}

export function unscheduleBatchTask(taskId) {
  const normalizedTaskId = Number(taskId);
  if (scheduledBatchJobs.has(normalizedTaskId)) {
    const { job } = scheduledBatchJobs.get(normalizedTaskId);
    if (job) {
      job.stop();
    }
    scheduledBatchJobs.delete(normalizedTaskId);
    console.log(`🗑️ 已取消调度批量任务: ${normalizedTaskId}`);
  }
}

export async function checkAndRunDueBatchTasks() {
  const tasks = all(
    `SELECT bst.*
     FROM batch_scheduled_tasks bst
     JOIN users u ON bst.user_id = u.id
     WHERE bst.enabled = 1
       AND COALESCE(u.is_enabled, 1) = 1
       AND (u.access_start_at IS NULL OR datetime(u.access_start_at) <= datetime('now'))
       AND (u.access_end_at IS NULL OR datetime(u.access_end_at) >= datetime('now'))`
  );
  
  const enabledTaskIds = new Set(tasks.map((task) => Number(task.id)));
  for (const existingTaskId of scheduledBatchJobs.keys()) {
    if (!enabledTaskIds.has(Number(existingTaskId))) {
      unscheduleBatchTask(existingTaskId);
    }
  }

  for (const task of tasks) {
    if (!scheduledBatchJobs.has(Number(task.id))) {
      scheduleBatchTask(task);
    }
  }
}

export async function executeBatchTask(task) {
  if (runningTasks.has(task.id)) {
    console.log(`⏭️ 批量任务 ${task.name} 正在运行中，跳过`);
    return;
  }

  runningTasks.add(task.id);
  
  console.log(`🚀 开始执行批量任务: ${task.name}`);
  
  addBatchTaskLogEntry(task.id, null, 'BATCH_START', 'info', `开始执行批量任务: ${task.name}`);

  try {
    const user = get(
      'SELECT id, username, role, is_enabled, access_start_at, access_end_at FROM users WHERE id = ?',
      [task.user_id]
    );
    const userStatus = getUserAvailabilityStatus(user);
    if (!userStatus.allowed) {
      addBatchTaskLogEntry(task.id, null, 'BATCH_ERROR', 'error', `所属用户不可用，批量任务已停止：${userStatus.reason}`);
      return;
    }

    const accountIds = JSON.parse(task.selected_account_ids || '[]');
    const taskTypes = JSON.parse(task.selected_task_types || '[]');

    const accounts = all(
      `SELECT id, name, token_encrypted, token_iv, ws_url, server, import_method, updated_at
       FROM game_accounts
       WHERE id IN (${accountIds.map(() => '?').join(',')}) AND status = 'active'`,
      accountIds
    );

    if (accounts.length === 0) {
      addBatchTaskLogEntry(task.id, null, 'BATCH_ERROR', 'error', '没有可用的账号');
      return;
    }

    const accountExecutions = accounts.map((account) =>
      runAccountTaskExclusive(account.id, async () => {
        const rawToken = decrypt(account.token_encrypted, account.token_iv);
        const tokenMeta = parseTokenPayload(rawToken);
        const tokenCandidates = tokenMeta.candidates?.length
          ? tokenMeta.candidates
          : [tokenMeta.token].filter(Boolean);
        if (tokenCandidates.length === 0) {
          addBatchTaskLogEntry(task.id, account.id, 'TOKEN_ERROR', 'error', '账号Token无效，已跳过');
          return;
        }
        const accountWsUrl = account?.ws_url || tokenMeta.wsUrl || '';
        let dailyRewardDirty = false;

        for (const taskType of taskTypes) {
          try {
            const result = await executeTaskForAccount(task.id, account, taskType, tokenCandidates, tokenMeta.roleId, accountWsUrl);
            if (taskType === 'DAILY_TASK_CLAIM') {
              dailyRewardDirty = dailyRewardDirty && !didDailyTaskClaimConfirmReward(result);
            } else if (DAILY_REWARD_DIRTY_TASKS.has(taskType)) {
              dailyRewardDirty = true;
            }
          } catch (error) {
            console.error(`❌ 账号 ${account.name} 执行任务 ${taskType} 失败:`, error.message);
            addBatchTaskLogEntry(
              task.id,
              account.id,
              taskType,
              shouldIgnoreFailure(error) ? 'ignored' : 'error',
              error.message,
              error?.details ? JSON.stringify(error.details) : null
            );
          }
        }

        if (dailyRewardDirty) {
          try {
            const rewardResult = await executePostTaskRewardsForAccount(
              account,
              tokenCandidates,
              tokenMeta.roleId,
              accountWsUrl,
              {
                importMethod: account.import_method || null,
                updatedAt: account.updated_at || null,
              }
            );
            addBatchTaskLogEntry(
              task.id,
              account.id,
              'TASK_REWARD',
              'success',
              rewardResult?.message || '收尾补领奖励检查完成'
            );
          } catch (error) {
            addBatchTaskLogEntry(
              task.id,
              account.id,
              'TASK_REWARD',
              shouldIgnoreFailure(error) ? 'ignored' : 'error',
              error.message || '收尾补领失败',
              error?.details ? JSON.stringify(error.details) : null
            );
          }
        }
      }).catch((error) => {
        console.error(`❌ 批量任务账号执行失败: ${account.name}:`, error.message);
        addBatchTaskLogEntry(task.id, account.id, 'ACCOUNT_ERROR', shouldIgnoreFailure(error) ? 'ignored' : 'error', error.message || '账号执行失败');
      })
    );

    await Promise.allSettled(accountExecutions);

    const nextRun = calculateNextRunAt(resolveBatchCronExpression(task));
    const scheduled = scheduledBatchJobs.get(Number(task.id));
    if (scheduled) {
      scheduled.nextRun = nextRun;
    }
    updateBatchTaskRunTime(task.id, new Date().toISOString(), nextRun);
    
    addBatchTaskLogEntry(task.id, null, 'BATCH_END', 'success', `批量任务执行完成: ${task.name}`);
    
    console.log(`✅ 批量任务执行完成: ${task.name}`);
  } catch (error) {
    console.error(`❌ 批量任务执行失败: ${task.name}:`, error.message);
    addBatchTaskLogEntry(task.id, null, 'BATCH_ERROR', 'error', error.message);
  } finally {
    runningTasks.delete(task.id);
  }
}

async function executeTaskForAccount(batchTaskId, account, taskType, tokenCandidates, roleId = null, wsUrl = '') {
  const taskConfig = getAccountTaskConfig(account.id, taskType);
  let client = await ensureBatchClient(account, tokenCandidates, roleId, wsUrl, {
    importMethod: account.import_method || null,
    updatedAt: account.updated_at || null,
  });
  const execution = await executeTaskWithFlowControl({
    accountId: account.id,
    accountName: account.name,
    taskType,
    taskConfig,
    client,
    source: 'batch',
    reconnect: async () => {
      console.warn(`🔁 批量任务检测到连接已断开，重连后重试: ${account.name} - ${taskType}`);
      activeConnections.delete(account.id);
      client.disconnect();
      return await ensureBatchClient(account, tokenCandidates, roleId, wsUrl, {
        importMethod: account.import_method || null,
        updatedAt: account.updated_at || null,
      });
    },
  });
  client = execution.client;
  const result = execution.result;
  await claimDailyPointRewardsByTask(client, taskType, taskConfig);
  
  addBatchTaskLogEntry(batchTaskId, account.id, taskType, 'success', result.message || '执行成功', JSON.stringify(result.data || {}));
  
  return result;
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
  const allowTooFastRetry = SENSITIVE_TASK_TYPES.has(taskType);
  let currentClient = client;
  let wsRetried = false;
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
      if (isRetryableWsError(error) && !wsRetried) {
        wsRetried = true;
        currentClient = await reconnect();
        continue;
      }

      if (allowTooFastRetry && isTooFastError(error) && tooFastRetryCount < retryConfig.maxRetries) {
        tooFastRetryCount += 1;
        const retryDelayMs = Math.min(
          retryConfig.maxDelayMs,
          retryConfig.baseDelayMs * (2 ** (tooFastRetryCount - 1))
        );
        console.warn('⏳ 批量敏感任务触发操作过快，退避后重试', {
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

async function ensureBatchClient(account, tokenCandidates, roleId = null, wsUrl = '', extraContext = {}) {
  let client = activeConnections.get(account.id);

  if (client?.isSocketOpen?.()) {
    console.log('♻️ 复用批量任务已有WebSocket连接', {
      accountId: account.id,
      accountName: account.name,
      roleId: roleId ?? null,
      importMethod: extraContext.importMethod || null,
      updatedAt: extraContext.updatedAt || null,
      connection: client.getConnectionStateSummary?.() || null,
    });
    return client;
  }
  if (client) {
    discardInactiveClient(account.id, account.name, client, 'readyState 非 OPEN 或 connected 标记失效');
  }

  let connected = false;
  let lastError = null;
  let currentCandidates = Array.isArray(tokenCandidates) ? [...tokenCandidates] : [];
  let currentRoleId = roleId;
  let currentWsUrl = wsUrl;
  let refreshedByBin = false;

  for (let refreshRound = 0; refreshRound <= 1; refreshRound += 1) {
    for (const [candidateIndex, token] of currentCandidates.entries()) {
      const resolvedWsUrl = resolveWsUrl(currentWsUrl, token);
      const candidateClient = new GameClient(token, { roleId: currentRoleId, wsUrl: resolvedWsUrl });
      candidateClient.accountId = account.id;
      candidateClient.accountName = account.name;
      let disconnectInfo = null;
      let wsErrorMessage = null;
      let unexpectedResponse = null;
      const logContext = buildWsLogContext({
        accountId: account.id,
        accountName: account.name,
        roleId: currentRoleId,
        importMethod: extraContext.importMethod || null,
        updatedAt: extraContext.updatedAt || null,
        candidateIndex: candidateIndex + 1,
        candidateCount: currentCandidates.length,
        token,
        wsUrl: resolvedWsUrl,
        extra: {
          refreshedByBin,
        },
      });
      candidateClient.onDisconnect = (code, reason, meta) => {
        disconnectInfo = { code, reason };
        console.warn('🔌 批量任务连接断开', {
          ...logContext,
          disconnect: normalizeDisconnectInfo(disconnectInfo),
          handshake: meta || candidateClient.lastConnectMeta || null,
        });
        activeConnections.delete(account.id);
        unregisterAccountClient(account.id, candidateClient);
      };

      candidateClient.onError = (error, meta) => {
        wsErrorMessage = normalizeErrorMessage(error);
        console.error('❌ 批量任务连接错误', {
          ...logContext,
          error: wsErrorMessage,
          handshake: meta || candidateClient.lastConnectMeta || null,
        });
        activeConnections.delete(account.id);
        unregisterAccountClient(account.id, candidateClient);
      };

      candidateClient.onUnexpectedResponse = (details, meta) => {
        unexpectedResponse = details;
        console.error('🚫 批量任务握手异常响应', {
          ...logContext,
          unexpectedResponse: details,
          handshake: meta || candidateClient.lastConnectMeta || null,
        });
      };

      try {
        console.log('🔄 尝试建立批量任务WebSocket连接', logContext);
        await candidateClient.connect();
        if (!candidateClient.isSocketOpen()) {
          throw new Error('WebSocket未连接');
        }
        activeConnections.set(account.id, candidateClient);
        registerAccountClient(account.id, candidateClient);
        console.log('✅ 批量任务WebSocket连接成功', {
          ...logContext,
          handshake: candidateClient.lastConnectMeta || null,
        });
        const warmup = await warmupGameClient(candidateClient, {
          roleInfoTimeout: 8000,
          includeRoleId: false,
        });
        console.log('🔥 批量任务连接预热完成', {
          ...logContext,
          handshake: candidateClient.lastConnectMeta || null,
          warmup,
        });
        if (!candidateClient.isSocketOpen()) {
          throw new Error('WebSocket未连接');
        }
        client = candidateClient;
        connected = true;
        break;
      } catch (error) {
        lastError = error;
        console.warn('⚠️ 批量任务候选Token连接失败', {
          ...logContext,
          error: normalizeErrorMessage(error),
          disconnect: normalizeDisconnectInfo(disconnectInfo),
          wsError: wsErrorMessage || null,
          unexpectedResponse,
          handshake: candidateClient.lastConnectMeta || null,
        });
        candidateClient.disconnect();
        activeConnections.delete(account.id);
        unregisterAccountClient(account.id, candidateClient);
      }
    }

    if (connected && client) {
      break;
    }

    if (refreshedByBin) {
      break;
    }

    try {
      const refreshed = await getRefreshedTokenSessionFromStoredBin(account.id, {
        trigger: 'batch-connect',
        currentWsUrl,
      });
      if (refreshed?.refreshed && refreshed?.candidates?.length) {
        currentCandidates = refreshed.candidates;
        currentRoleId = refreshed.roleId || currentRoleId;
        currentWsUrl = refreshed.wsUrl || currentWsUrl || '';
        refreshedByBin = true;
        console.log('♻️ 批量任务连接已切换为后端BIN刷新后的Token重试', {
          accountId: account.id,
          accountName: account.name,
          roleId: currentRoleId ?? null,
          importMethod: extraContext.importMethod || null,
          updatedAt: extraContext.updatedAt || null,
          candidateCount: currentCandidates.length,
        });
        continue;
      }
    } catch (error) {
      console.warn('⚠️ 批量任务连接通过持久化BIN刷新Token失败', {
        accountId: account.id,
        accountName: account.name,
        error: normalizeErrorMessage(error),
      });
    }
    break;
  }

  if (!connected || !client) {
    console.error('⚠️ 批量任务WebSocket连接失败', {
      accountId: account.id,
      accountName: account.name,
      roleId: currentRoleId ?? null,
      importMethod: extraContext.importMethod || null,
      updatedAt: extraContext.updatedAt || null,
      refreshedByBin,
      error: normalizeErrorMessage(lastError),
    });
    throw new Error(lastError?.message || 'WebSocket连接失败');
  }

  await new Promise(resolve => setTimeout(resolve, 1000));
  return client;
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
      await claimDailyPointWithRetry(client, taskId);
      await sleep(900);
    } catch {
      // 忽略“已领取/未达成”等错误，不影响主任务结果
    }
  }
}

async function executePostTaskRewardsForAccount(account, tokenCandidates, roleId = null, wsUrl = '', extraContext = {}) {
  let client = await ensureBatchClient(account, tokenCandidates, roleId, wsUrl, extraContext);
  let lastResult = null;

  for (let attempt = 1; attempt <= DAILY_REWARD_POST_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      lastResult = await executeDailyTaskClaim(client, {});
      if (didDailyTaskClaimConfirmReward(lastResult) || attempt >= DAILY_REWARD_POST_RETRY_MAX_ATTEMPTS) {
        return lastResult;
      }
      await sleep(DAILY_REWARD_POST_RETRY_DELAY_MS);
    } catch (error) {
      if (!isRetryableWsError(error)) {
        throw error;
      }
      if (attempt >= DAILY_REWARD_POST_RETRY_MAX_ATTEMPTS) {
        throw error;
      }
      console.warn(`🔁 批量任务收尾补领检测到连接已断开，重连后重试: ${account.name}`);
      activeConnections.delete(account.id);
      client.disconnect();
      client = await ensureBatchClient(account, tokenCandidates, roleId, wsUrl, extraContext);
    }
  }

  return lastResult || { message: '收尾补领奖励检查完成', data: { claimedCount: 0 } };
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

    case 'DAILY_TASK_CLAIM':
      return await executeDailyTaskClaim(client, config);
    
    case 'DREAM':
      return await executeDream(client, config);
    
    case 'SKIN_CHALLENGE':
      return await executeSkinChallenge(client, config);
    
    case 'PEACH_TASK':
      return await executePeachTask(client, config);
    
    case 'BOX_OPEN':
      return await executeBoxOpen(client, config);
    
    case 'GENIE_SWEEP':
      return await executeGenieSweep(client, config);

    case 'GACHA':
      return await executeGacha(client, config);
    
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
  return runWithTemporaryPresetTeam(client, config?.towerFormation, '批量爬塔', () =>
    executeTowerCore(client, config)
  );
}

async function executeTowerCore(client, config = {}) {
  const { maxFloors = 10 } = config;
  const results = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  return runWithTemporaryPresetTeam(client, config?.weirdTowerFormation, '批量怪异塔', () =>
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
    if (originalFormation !== bossFormation) {
      await client.savePresetTeam(bossFormation);
      switchedFormation = true;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.warn(`[批量军团BOSS] 阵容切换失败，使用当前阵容: ${error.message}`);
  }

  for (let i = 0; i < bossTimes; i++) {
    try {
      const result = await client.startLegionBossFight();
      results.push({ round: i + 1, ok: true, result });
      successCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      const message = String(error?.message || '军团BOSS挑战失败');
      if (message.includes('次数') || message.includes('未加入')) {
        results.push({ round: i + 1, ok: false, error: message, stop: true });
        break;
      }
      results.push({ round: i + 1, ok: false, error: message });
    }
  }

  if (switchedFormation && originalFormation) {
    try {
      await client.savePresetTeam(originalFormation);
    } catch (error) {
      console.warn(`[批量军团BOSS] 恢复原阵容失败: ${error.message}`);
    }
  }

  return {
    message: `军团BOSS挑战完成 (${successCount}/${bossTimes}次)`,
    data: { results, successCount, bossTimes, bossFormation },
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

async function executeGacha(client, config = {}) {
  const num = Math.max(1, Number(config?.num ?? config?.count ?? 1) || 1);
  const isGroup = config?.isGroup === true;
  const results = [];

  await client.getGachaInfo();
  await new Promise((resolve) => setTimeout(resolve, 200));

  try {
    const result = await client.drawGachaReward(isGroup, num);
    results.push({ ok: true, result });
  } catch (error) {
    results.push({ ok: false, error: error.message });
  }

  const successCount = results.filter((x) => x.ok).length;
  if (successCount === 0 && results.length > 0) {
    throw new Error(results[0].error || '扭蛋抽奖失败');
  }

  return {
    message: `扭蛋抽奖完成 (${successCount}/${results.length}次)`,
    data: { results, successCount, num, isGroup },
  };
}

async function executeMailClaim(client) {
  return executeMailClaimScheduledTask(client);
}

async function executeDailyTaskClaim(client, config) {
  return executeDailyTaskClaimScheduledTask(client, config);
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
      source: 'batch',
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

async function executeDream(client, config) {
  throw new Error('梦境后端自动执行暂未接入');
}

async function executeSkinChallenge(client, config) {
  throw new Error('换皮闯关后端自动执行暂未接入');
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

export function stopBatchScheduler() {
  if (batchSchedulerRefreshJob) {
    batchSchedulerRefreshJob.stop();
    batchSchedulerRefreshJob = null;
  }

  for (const [taskId, { job }] of scheduledBatchJobs) {
    job.stop();
  }
  scheduledBatchJobs.clear();
  
  for (const [accountId, client] of activeConnections) {
    client.disconnect();
    unregisterAccountClient(accountId, client);
  }
  activeConnections.clear();
  
  console.log('🛑 批量任务调度器已停止');
}

export function getScheduledBatchJobs() {
  return scheduledBatchJobs;
}

export function getActiveBatchConnections() {
  return activeConnections;
}

export default {
  initBatchScheduler,
  scheduleBatchTask,
  unscheduleBatchTask,
  executeBatchTask,
  stopBatchScheduler,
  getScheduledBatchJobs,
  getActiveBatchConnections
};
