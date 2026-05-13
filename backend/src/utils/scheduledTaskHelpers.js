const MAIL_CATEGORIES = [0, 4, 5];
const DEFAULT_DAILY_TASK_IDS = Array.from({ length: 10 }, (_, index) => index + 1);
const DAILY_POINT_FULL_THRESHOLD = 100;
const DAILY_POINT_CLAIMABLE_TASKS = [
  { claimTaskId: 1, completeKey: 1, requiredProgress: 1 },
  { claimTaskId: 2, completeKey: 2, requiredProgress: 1 },
  { claimTaskId: 3, completeKey: 3, requiredProgress: 3 },
  { claimTaskId: 4, completeKey: 4, requiredProgress: 2 },
  { claimTaskId: 5, completeKey: 5, requiredProgress: 5 },
  { claimTaskId: 6, completeKey: 6, requiredProgress: 3 },
  { claimTaskId: 7, completeKey: 7, requiredProgress: 3 },
  { claimTaskId: 8, completeKey: 13, requiredProgress: 1 },
  { claimTaskId: 9, completeKey: 14, requiredProgress: 1 },
  { claimTaskId: 10, completeKey: 12, requiredProgress: 1 },
];
const DAILY_REWARD_THRESHOLDS = [20, 40, 60, 80, 100];
const WEEKLY_REWARD_THRESHOLDS = [100, 200, 300, 400, 500, 600, 700];
const DAILY_POINT_CLAIM_DELAY_MS = 1500;
const DAILY_POINT_RATE_LIMIT_COOLDOWN_MS = 3000;
const DAILY_POINT_TOO_FAST_RETRY_DELAYS_MS = [1200, 2500, 5000];
const NOOP_ERROR_PATTERNS = [
  '没有可领取',
  '已经领取',
  '已领取',
  '今日已领取',
  '已经签到',
  '已签到',
  '任务未达成',
  '无效的ID',
  '不存在',
  '条件不满足',
  '次数已达上限',
  '已完成',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeNonNegativeNumber(value, fallback = 0) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return Math.max(0, Number(fallback) || 0);
  }
  return Math.max(0, normalized);
}

function normalizeErrorMessage(error) {
  return String(error?.message || error || '未知错误');
}

function isLegacyReentryRequiredError(error) {
  const message = normalizeErrorMessage(error);
  return (
    message.includes('新赛季已开启，请重新进入本功能') ||
    message.includes('WebSocket未连接')
  );
}

function isNoopError(error) {
  const message = normalizeErrorMessage(error);
  return NOOP_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function isTooFastError(error) {
  return normalizeErrorMessage(error).includes('操作过快');
}

function isConnectionStateError(error) {
  const message = normalizeErrorMessage(error);
  return message.includes('WebSocket未连接') || message.includes('WebSocket连接已断开');
}

function stableClone(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    return value.map((item) => stableClone(item, seen));
  }
  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const output = {};
    for (const key of Object.keys(value).sort()) {
      output[key] = stableClone(value[key], seen);
    }
    seen.delete(value);
    return output;
  }
  return value;
}

function stableStringify(value) {
  try {
    return JSON.stringify(stableClone(value));
  } catch {
    return '';
  }
}

function createDetailedError(message, details = null) {
  const error = new Error(message);
  if (details && typeof details === 'object') {
    error.details = details;
  }
  return error;
}

function normalizeRewardMap(value) {
  return value && typeof value === 'object' ? value : {};
}

function getPendingRewardIds(point, rewardMap, thresholds) {
  const currentPoint = Math.max(0, Number(point) || 0);
  const claimedMap = normalizeRewardMap(rewardMap);
  return thresholds
    .map((threshold, index) => ({ rewardId: index + 1, threshold }))
    .filter(({ rewardId, threshold }) => currentPoint >= threshold && claimedMap[rewardId] !== true)
    .map(({ rewardId }) => rewardId);
}

export function didDailyTaskClaimConfirmReward(result = {}) {
  const data = result?.data && typeof result.data === 'object' ? result.data : {};
  if (data.dailyRewardPending === true || data.weeklyRewardPending === true) {
    return false;
  }
  if (data.dailyRewardPending === false && data.weeklyRewardPending === false) {
    return true;
  }
  if (data.dailyRewardClaimed === true) {
    return true;
  }

  const results = Array.isArray(data.results) ? data.results : [];
  return results.some((item) => {
    if (!item?.ok) return false;
    const name = String(item?.name || '');
    return name.includes('日常任务宝箱');
  });
}

export async function claimDailyPointWithRetry(client, taskId, options = {}) {
  const retryDelays = Array.isArray(options.retryDelays)
    ? options.retryDelays
    : DAILY_POINT_TOO_FAST_RETRY_DELAYS_MS;
  let attempt = 0;

  while (true) {
    try {
      return await client.claimDailyPoint(taskId);
    } catch (error) {
      if (!isTooFastError(error) || attempt >= retryDelays.length) {
        throw error;
      }

      await sleep(Math.max(0, Number(retryDelays[attempt]) || 0));
      attempt += 1;
    }
  }
}

function normalizeFormationId(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 6) {
    return null;
  }
  return normalized;
}

function resolveCurrentPresetTeamId(teamInfo) {
  return Number(
    teamInfo?.presetTeamInfo?.useTeamId ??
      teamInfo?.useTeamId ??
      teamInfo?.presetTeam?.useTeamId ??
      0
  ) || null;
}

export async function runWithTemporaryPresetTeam(client, formation, label, action) {
  const targetFormation = normalizeFormationId(formation);
  if (!targetFormation) {
    return action();
  }

  let originalFormation = null;
  let switchedFormation = false;
  const taskLabel = label || '任务';

  try {
    const teamInfo = await client.getPresetTeamInfo();
    originalFormation = resolveCurrentPresetTeamId(teamInfo);

    if (originalFormation !== targetFormation) {
      console.log(`[${taskLabel}] 切换阵容 ${originalFormation || '未知'} -> ${targetFormation}`);
      await client.savePresetTeam(targetFormation);
      switchedFormation = true;
      await sleep(500);
    }
  } catch (error) {
    console.warn(`[${taskLabel}] 阵容切换失败，使用当前阵容: ${normalizeErrorMessage(error)}`);
  }

  try {
    return await action();
  } finally {
    if (switchedFormation && originalFormation) {
      try {
        console.log(`[${taskLabel}] 恢复原阵容 ${targetFormation} -> ${originalFormation}`);
        await client.savePresetTeam(originalFormation);
      } catch (error) {
        console.warn(`[${taskLabel}] 恢复原阵容失败: ${normalizeErrorMessage(error)}`);
      }
    }
  }
}

function pickArenaTargetId(target) {
  if (!target || typeof target !== 'object') {
    return null;
  }

  return Number(
    target.roleId ??
      target.roleid ??
      target.targetId ??
      target.id ??
      target.uid ??
      0
  ) || null;
}

function isArenaTargetCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const targetId = pickArenaTargetId(value);
  if (!targetId) {
    return false;
  }

  const keys = Object.keys(value);
  return (
    'targetId' in value ||
    'roleId' in value ||
    'roleid' in value ||
    keys.some((key) =>
      ['name', 'nick', 'nickname', 'rank', 'score', 'power', 'fight', 'server', 'level'].includes(
        key.toLowerCase()
      )
    )
  );
}

function resolveArenaTargets(payload, depth = 0, visited = new WeakSet()) {
  if (!payload || depth > 5) {
    return [];
  }

  if (Array.isArray(payload)) {
    const direct = payload.filter((item) => isArenaTargetCandidate(item));
    if (direct.length > 0) {
      return direct;
    }

    for (const item of payload) {
      const nested = resolveArenaTargets(item, depth + 1, visited);
      if (nested.length > 0) {
        return nested;
      }
    }

    return [];
  }

  if (typeof payload !== 'object') {
    return [];
  }

  if (visited.has(payload)) {
    return [];
  }
  visited.add(payload);

  if (isArenaTargetCandidate(payload)) {
    return [payload];
  }

  const prioritizedKeys = [
    'rankList',
    'roleList',
    'targets',
    'targetList',
    'list',
    'arenaList',
    'enemyList',
    'opponentList',
    'roles',
    'data',
    'body',
    'result',
    'arena',
    'arenaInfo',
  ];

  for (const key of prioritizedKeys) {
    if (!(key in payload)) continue;
    const nested = resolveArenaTargets(payload[key], depth + 1, visited);
    if (nested.length > 0) {
      return nested;
    }
  }

  for (const value of Object.values(payload)) {
    const nested = resolveArenaTargets(value, depth + 1, visited);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
}

function describePayloadKeys(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  return Object.keys(payload).slice(0, 10).join(', ');
}

export function normalizeSmartSendCarOptions(config = {}) {
  const source = config && typeof config === 'object' ? config : {};

  return {
    minCarColor: normalizeNonNegativeNumber(source.minCarColor ?? 4, 4),
    maxRefreshAttempts: normalizeNonNegativeNumber(source.maxRefreshAttempts ?? 3, 3),
    allowGoldRefresh: source.allowGoldRefresh === true,
    fallbackSendWhenStuck: source.fallbackSendWhenStuck !== false,
    goldThreshold: normalizeNonNegativeNumber(source.goldThreshold ?? 0, 0),
    recruitThreshold: normalizeNonNegativeNumber(source.recruitThreshold ?? 0, 0),
    jadeThreshold: normalizeNonNegativeNumber(source.jadeThreshold ?? 0, 0),
    ticketThreshold: normalizeNonNegativeNumber(source.ticketThreshold ?? 0, 0),
    matchAll: source.matchAll === true,
  };
}

export function buildCarSendTaskMessage(result = {}) {
  const sendCount = Math.max(0, Number(result?.sendCount) || 0);
  const sendFailureCount = Math.max(0, Number(result?.sendFailureCount) || 0);
  const skippedCount = Math.max(0, Number(result?.skippedCount) || 0);
  const refreshedCount = Math.max(0, Number(result?.refreshedCount) || 0);
  const helperSkippedCount = Array.isArray(result?.skippedCars)
    ? result.skippedCars.filter((item) => item?.helperRequired === true).length
    : 0;

  const parts = [
    `成功${sendCount}`,
    `失败${sendFailureCount}`,
    `跳过${skippedCount}`,
    `刷新${refreshedCount}`,
  ];
  if (helperSkippedCount > 0) {
    parts.push(`护卫不足跳过${helperSkippedCount}`);
  }
  return `智能发车完成（${parts.join('，')}）`;
}

export function buildCarClaimTaskMessage(result = {}) {
  const claimCount = Math.max(0, Number(result?.claimCount) || 0);
  const claimFailureCount = Math.max(0, Number(result?.claimFailureCount) || 0);
  return `收车完成（成功${claimCount}，失败${claimFailureCount}）`;
}

async function getDailyTaskState(client) {
  const roleInfo = await client.getRoleInfo(8000);
  const dailyTask = roleInfo?.role?.dailyTask || {};
  const completeMap = dailyTask?.complete && typeof dailyTask.complete === 'object'
    ? dailyTask.complete
    : {};

  const readyTaskIds = Object.entries(completeMap)
    .filter(([, value]) => Number(value) === -1 || value === true)
    .map(([key]) => Number(key))
    .filter((value) => Number.isFinite(value) && DEFAULT_DAILY_TASK_IDS.includes(value))
    .sort((a, b) => a - b);

  return {
    fingerprint: stableStringify(dailyTask),
    dailyPoint: Number(dailyTask?.dailyPoint || 0),
    weekPoint: Number(dailyTask?.weekPoint || 0),
    completeMap,
    dailyReward: normalizeRewardMap(dailyTask?.dailyReward),
    weekReward: normalizeRewardMap(dailyTask?.weekReward),
    readyTaskIds,
    raw: dailyTask,
  };
}

function isDailyPointTaskClaimable(completeValue, requiredProgress = 1) {
  if (completeValue === -1) {
    return false;
  }
  if (completeValue === true) {
    return true;
  }
  const progress = Number(completeValue);
  return Number.isFinite(progress) && progress >= Math.max(1, Number(requiredProgress) || 1);
}

function resolveClaimableDailyPointTaskIds(state) {
  if (!state) {
    return [];
  }
  if (Number(state.dailyPoint || 0) >= DAILY_POINT_FULL_THRESHOLD) {
    return [];
  }

  const completeMap = state.completeMap && typeof state.completeMap === 'object'
    ? state.completeMap
    : {};

  return DAILY_POINT_CLAIMABLE_TASKS
    .filter(({ completeKey, requiredProgress }) =>
      isDailyPointTaskClaimable(completeMap[completeKey], requiredProgress)
    )
    .map(({ claimTaskId }) => claimTaskId);
}

async function tryClaim(results, label, action) {
  try {
    const result = await action();
    results.push({ name: label, ok: true, result });
    return { ok: true, noop: false };
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const noop = isNoopError(message);
    results.push({ name: label, ok: false, error: message, noop });
    return { ok: false, noop, error: message };
  }
}

async function tryClaimWithExtraNoopPatterns(results, label, action, extraNoopPatterns = []) {
  try {
    const result = await action();
    results.push({ name: label, ok: true, result });
    return { ok: true, noop: false };
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const noop = isNoopError(message) || extraNoopPatterns.some((pattern) => message.includes(pattern));
    results.push({ name: label, ok: false, error: message, noop });
    return { ok: false, noop, error: message };
  }
}

export async function executeArenaScheduledTask(client, config = {}) {
  return runWithTemporaryPresetTeam(client, config?.arenaFormation, '竞技场', () =>
    executeArenaScheduledTaskCore(client, config)
  );
}

async function executeArenaScheduledTaskCore(client, config = {}) {
  const { battleCount = 3 } = config;
  const results = [];

  await client.ensureBattleVersion();

  for (let i = 0; i < battleCount; i++) {
    try {
      await client.startArenaArea();
    } catch {
      // 忽略开场失败，继续尝试拉取目标
    }

    let targetsResp = null;
    let targets = [];

    try {
      targetsResp = await client.getArenaTargets(false);
      targets = resolveArenaTargets(targetsResp);
    } catch {
      // 忽略，下面继续刷新兜底
    }

    if (targets.length === 0) {
      try {
        targetsResp = await client.getArenaTargets(true);
        targets = resolveArenaTargets(targetsResp);
      } catch {
        // 忽略刷新失败
      }
    }

    if (targets.length === 0) {
      const suffix = describePayloadKeys(targetsResp);
      results.push({
        target: 'unknown',
        ok: false,
        error: suffix ? `未找到竞技场数据（响应字段: ${suffix}）` : '未找到竞技场数据',
      });
      break;
    }

    const target = targets[0];
    const targetId = pickArenaTargetId(target);
    if (!targetId) {
      results.push({ target: 'unknown', ok: false, error: '未找到可用的竞技场目标' });
      break;
    }

    try {
      const result = await client.startArenaFight(targetId);
      results.push({
        target: target.name || target.nickName || target.nickname || targetId,
        ok: true,
        result,
      });
    } catch (error) {
      results.push({
        target: target.name || target.nickName || target.nickname || targetId,
        ok: false,
        error: normalizeErrorMessage(error),
      });
    }

    await sleep(600);
  }

  const successCount = results.filter((item) => item.ok).length;
  if (results.length === 0) {
    throw new Error('未找到可用的竞技场目标');
  }
  if (successCount === 0) {
    throw new Error(results.find((item) => item?.error)?.error || '竞技场战斗失败');
  }

  return {
    message: `竞技场战斗完成 (${successCount}/${results.length}场)`,
    data: { results, successCount },
  };
}

export async function executeMailClaimScheduledTask(client) {
  let beforeState = null;
  try {
    beforeState = await client.getMailList();
  } catch {
    // 读取邮件列表失败不阻断后续领取
  }

  const results = [];
  let successCount = 0;

  for (const category of MAIL_CATEGORIES) {
    const claimResult = await tryClaim(
      results,
      `邮件分类${category}`,
      () => client.claimAllMail(category)
    );
    if (claimResult.ok) {
      successCount += 1;
    }
    await sleep(150);
  }

  let afterState = null;
  try {
    afterState = await client.getMailList();
  } catch {
    // 忽略校验失败
  }

  const changed =
    beforeState && afterState
      ? stableStringify(beforeState) !== stableStringify(afterState)
      : null;
  const hardErrors = results.filter((item) => !item.ok && !item.noop);

  if (successCount === 0) {
    if (hardErrors.length > 0) {
      throw new Error(hardErrors[0].error || '邮件领取失败');
    }

    return {
      message: '没有可领取的邮件',
      data: { results, changed },
    };
  }

  if (changed === false) {
    return {
      message: '未检测到邮件变化，可能没有可领取附件',
      data: { results, changed, successCount },
    };
  }

  return {
    message: `邮件领取完成 (${successCount}/${MAIL_CATEGORIES.length}类)`,
    data: { results, successCount, changed },
  };
}

export async function executeDailyTaskClaimScheduledTask(client) {
  let beforeState = null;
  try {
    beforeState = await getDailyTaskState(client);
  } catch {
    // 忽略前置状态读取失败
  }

  const results = [];
  let successCount = 0;
  let pointClaimInterrupted = false;
  let pointClaimInterruptedReason = null;

  const taskIds = resolveClaimableDailyPointTaskIds(beforeState)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((a, b) => a - b);

  for (const taskId of taskIds) {
    try {
      await claimDailyPointWithRetry(client, taskId, { retryDelays: [] });
      results.push({ name: `任务奖励${taskId}`, ok: true });
      successCount += 1;
    } catch (error) {
      const message = normalizeErrorMessage(error);
      const shouldDefer = isTooFastError(error) || isConnectionStateError(error);
      results.push({
        name: `任务奖励${taskId}`,
        ok: false,
        error: message,
        noop: shouldDefer || isNoopError(message),
        deferred: shouldDefer,
      });

      if (shouldDefer) {
        pointClaimInterrupted = true;
        pointClaimInterruptedReason = message;
        break;
      }
    }
    await sleep(DAILY_POINT_CLAIM_DELAY_MS);
  }

  if (pointClaimInterrupted && client?.isSocketOpen?.()) {
    await sleep(DAILY_POINT_RATE_LIMIT_COOLDOWN_MS);
  }

  let dailyRewardResult = { ok: false, noop: true, skipped: true };
  if (client?.isSocketOpen?.() !== false) {
    dailyRewardResult = await tryClaimWithExtraNoopPatterns(
      results,
      '日常任务宝箱(自动)',
      () => client.claimDailyReward(0),
      ['出了点小问题，请尝试重启游戏解决～', '操作过快']
    );
  } else {
    results.push({
      name: '日常任务宝箱(自动)',
      ok: false,
      noop: true,
      skipped: true,
      deferred: true,
      error: '点数领取触发限速后连接已断开，跳过本次日活宝箱领取',
    });
  }
  if (dailyRewardResult.ok) {
    successCount += 1;
  }
  await sleep(120);

  let weeklyRewardResult = { ok: false, noop: true, skipped: true };
  if (client?.isSocketOpen?.() !== false) {
    weeklyRewardResult = await tryClaimWithExtraNoopPatterns(
      results,
      '周常任务宝箱(自动)',
      () => client.claimWeeklyReward(0),
      ['出了点小问题，请尝试重启游戏解决～', '操作过快']
    );
  } else {
    results.push({
      name: '周常任务宝箱(自动)',
      ok: false,
      noop: true,
      skipped: true,
      deferred: true,
      error: '点数领取触发限速后连接已断开，跳过本次周活宝箱领取',
    });
  }
  if (weeklyRewardResult.ok) {
    successCount += 1;
  }
  await sleep(120);

  let afterState = null;
  try {
    afterState = await getDailyTaskState(client);
  } catch {
    // 忽略后置状态读取失败
  }

  const hardErrors = results.filter((item) => !item.ok && !item.noop);
  const changed =
    beforeState && afterState
      ? beforeState.fingerprint !== afterState.fingerprint
      : null;
  const dailyRewardPendingIds = afterState
    ? getPendingRewardIds(afterState.dailyPoint, afterState.dailyReward, DAILY_REWARD_THRESHOLDS)
    : [];
  const weeklyRewardPendingIds = afterState
    ? getPendingRewardIds(afterState.weekPoint, afterState.weekReward, WEEKLY_REWARD_THRESHOLDS)
    : [];
  const dailyRewardPending = dailyRewardPendingIds.length > 0;
  const weeklyRewardPending = weeklyRewardPendingIds.length > 0;

  if (successCount === 0) {
    if (hardErrors.length > 0) {
      throw createDetailedError(
        hardErrors[0].error || '每日任务奖励领取失败',
        {
          results,
          claimedCount: 0,
          changed,
          beforeDailyPoint: beforeState?.dailyPoint ?? null,
          afterDailyPoint: afterState?.dailyPoint ?? null,
          beforeWeekPoint: beforeState?.weekPoint ?? null,
          afterWeekPoint: afterState?.weekPoint ?? null,
          checkedTaskIds: taskIds,
          hardErrors,
          dailyRewardClaimed: dailyRewardResult.ok,
          weeklyRewardClaimed: weeklyRewardResult.ok,
          dailyRewardPending,
          weeklyRewardPending,
          dailyRewardPendingIds,
          weeklyRewardPendingIds,
          pointClaimInterrupted,
          pointClaimInterruptedReason,
        }
      );
    }

    return {
      message: pointClaimInterrupted
        ? '日周活跃奖励触发限速，已延后到下次兜底'
        : '没有可领取的每日任务奖励',
      data: {
        results,
        claimedCount: 0,
        changed,
        beforeDailyPoint: beforeState?.dailyPoint ?? null,
        afterDailyPoint: afterState?.dailyPoint ?? null,
        beforeWeekPoint: beforeState?.weekPoint ?? null,
        afterWeekPoint: afterState?.weekPoint ?? null,
        checkedTaskIds: taskIds,
        dailyRewardClaimed: dailyRewardResult.ok,
        weeklyRewardClaimed: weeklyRewardResult.ok,
        dailyRewardPending,
        weeklyRewardPending,
        dailyRewardPendingIds,
        weeklyRewardPendingIds,
        pointClaimInterrupted,
        pointClaimInterruptedReason,
      },
    };
  }

  return {
    message: `每日任务奖励领取完成 (${successCount}/${results.length})`,
    data: {
      results,
      claimedCount: successCount,
      changed,
      beforeDailyPoint: beforeState?.dailyPoint ?? null,
      afterDailyPoint: afterState?.dailyPoint ?? null,
      beforeWeekPoint: beforeState?.weekPoint ?? null,
      afterWeekPoint: afterState?.weekPoint ?? null,
      checkedTaskIds: taskIds,
      dailyRewardClaimed: dailyRewardResult.ok,
      weeklyRewardClaimed: weeklyRewardResult.ok,
      dailyRewardPending,
      weeklyRewardPending,
      dailyRewardPendingIds,
      weeklyRewardPendingIds,
      pointClaimInterrupted,
      pointClaimInterruptedReason,
    },
  };
}

export async function executeLegacyClaimWithAutoReopen(client, config = {}, context = {}) {
  let currentClient = client;
  const LEGACY_REENTRY_AFTER_ENTER_DELAY_MS = 1500;
  const LEGACY_REENTRY_AFTER_INFO_DELAY_MS = 1500;
  const LEGACY_REENTRY_AFTER_BEGIN_DELAY_MS = 2500;
  const LEGACY_REENTRY_VERIFY_DELAY_MS = 2000;

  const claimLegacyScrollsWithSoftRetry = async () => {
    try {
      return await currentClient.claimLegacyScrolls();
    } catch (error) {
      const message = normalizeErrorMessage(error);
      if (!message.includes('出了点小问题')) {
        throw error;
      }

      await sleep(700);
      await currentClient.getRoleInfo(8000).catch(() => {});
      return currentClient.claimLegacyScrolls();
    }
  };

  const reconnectForLegacyReentry = async (reason) => {
    if (typeof context.reconnect !== 'function') {
      return false;
    }

    console.warn('🔁 残卷功能要求重新进入，断开并重连后再开启', {
      accountId: context.accountId ?? null,
      accountName: context.accountName || '',
      reason,
    });
    currentClient = await context.reconnect();
    await sleep(LEGACY_REENTRY_AFTER_ENTER_DELAY_MS);
    return true;
  };

  const reopenLegacyHangupWithVerify = async (retryCount = 0, hasReconnected = false) => {
    const MAX_REOPEN_RETRIES = 2;
    const verifyDelayMs = LEGACY_REENTRY_VERIFY_DELAY_MS;
    const retryDelayMs = 1000 + retryCount * 1000;
    try {
      await currentClient.getLegacyInfo().catch(() => {});
      await sleep(LEGACY_REENTRY_AFTER_INFO_DELAY_MS);
      const reopenResult = await currentClient.reopenLegacyHangup({
        verifyAttempts: 6,
        verifyDelayMs: LEGACY_REENTRY_VERIFY_DELAY_MS,
        beginSettleDelayMs: LEGACY_REENTRY_AFTER_BEGIN_DELAY_MS,
      });
      console.log(`⏳ 残卷开启后等待状态稳定 ${verifyDelayMs}ms (第${retryCount + 1}次尝试)`);
      await sleep(verifyDelayMs);
      const latestLegacyInfo = await currentClient.getLegacyInfo().catch(() => null);
      return {
        ...reopenResult,
        latestLegacyInfo,
        reconnected: hasReconnected,
      };
    } catch (error) {
      const message = normalizeErrorMessage(error);
      console.warn(`⚠️ 残卷开启失败 (第${retryCount + 1}次尝试):`, message);

      if (!hasReconnected && isLegacyReentryRequiredError(error)) {
        const reconnected = await reconnectForLegacyReentry(message);
        if (reconnected) {
          return reopenLegacyHangupWithVerify(retryCount, true);
        }
      }

      if (retryCount < MAX_REOPEN_RETRIES) {
        console.log(`🔁 ${retryDelayMs}ms 后重试残卷开启...`);
        await sleep(retryDelayMs);
        return reopenLegacyHangupWithVerify(retryCount + 1, hasReconnected);
      }

      error.details = {
        ...(error.details || {}),
        legacyContext: error.legacyContext || null,
        phase: 'legacy_auto_reopen',
        reconnected: hasReconnected,
      };
      throw error;
    }
  };

  await currentClient.getLegacyInfo().catch(() => {});
  try {
    const result = await claimLegacyScrollsWithSoftRetry();
    return { message: '残卷收取完成', data: result };
  } catch (error) {
    const message = normalizeErrorMessage(error);
    console.log('📜 残卷收取失败，错误信息:', message);

    if (message.includes('新赛季已开启，请重新进入本功能')) {
      console.log('🔄 检测到新赛季已开启，执行残卷重新进入并开启流程...');
      const reconnected = await reconnectForLegacyReentry(message);
      const reopenResult = await reopenLegacyHangupWithVerify(0, reconnected);
      console.log('✅ 残卷新赛季开启成功，跳过本次收取');
      return {
        message: '残卷新赛季开启成功',
        data: {
          reopenResult,
          skippedClaimAfterReopen: true,
          skippedReason: 'new_season_reopen_has_no_claimable_scrolls',
        },
      };
    }
    throw error;
  }
}
