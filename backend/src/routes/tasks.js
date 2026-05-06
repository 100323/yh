import { createHash } from 'crypto';
import { Router } from 'express';
import { run, get, all, addTaskConfigAuditLog, cleanupTaskLogs, getDatabase, saveDatabase, upsertTaskExecutionMarker } from '../database/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { calculateNextRunAt } from '../utils/cronSchedule.js';

const router = Router();

router.use(authMiddleware);

export const CURRENT_DEFAULT_CRON_VERSION = 4;

export const TASK_TYPES = {
  SIGN_IN: { name: '每日签到', cron: '0 8 * * *', group: 'daily' },
  LEGION_SIGN: { name: '军团签到', cron: '0 8 * * *', group: 'daily' },
  ARENA: { name: '竞技场战斗', cron: '4 12 * * *', group: 'daily' },
  TOWER: { name: '爬塔', cron: '13 12 * * *', group: 'dungeon' },
  BOSS_TOWER: { name: '咸王宝库', cron: '0 10 * * *', group: 'dungeon' },
  WEIRD_TOWER: { name: '怪异塔', cron: '13 12 * * *', group: 'dungeon' },
  WEIRD_TOWER_FREE_ITEM: { name: '怪异塔免费道具', cron: '13 12 * * *', group: 'dungeon' },
  WEIRD_TOWER_USE_ITEM: { name: '使用怪异塔道具', cron: '16 12 * * *', group: 'dungeon' },
  WEIRD_TOWER_MERGE_ITEM: { name: '怪异塔合成', cron: '16 12 * * *', group: 'dungeon' },
  LEGION_BOSS: { name: '军团BOSS', cron: '1 0 * * *', group: 'dungeon' },
  DAILY_BOSS: { name: '每日咸王', cron: '10 12 * * *', group: 'dungeon' },
  RECRUIT: { name: '武将招募', cron: '1 12 * * *', group: 'resource' },
  FRIEND_GOLD: { name: '送好友金币', cron: '1 12 * * *', group: 'daily' },
  BUY_GOLD: { name: '点金', cron: '1 12 * * *', group: 'resource' },
  FISHING: { name: '钓鱼', cron: '7 12 * * *', group: 'resource' },
  MAIL_CLAIM: { name: '领取邮件', cron: '0 8 * * *', group: 'daily' },
  HANGUP_CLAIM: { name: '领取挂机奖励', cron: '0 */8 * * *', group: 'daily' },
  STUDY: { name: '答题', cron: '1 12 * * *', group: 'daily' },
  HANGUP_ADD_TIME: { name: '一键加钟', cron: '11 */3 * * *', group: 'daily' },
  BOTTLE_RESET: { name: '重置罐子', cron: '0 */7 * * *', group: 'daily' },
  BOTTLE_CLAIM: { name: '领取罐子', cron: '13 12 * * *', group: 'daily' },
  CAR_SEND: { name: '智能发车', cron: '7 8 * * 1-3', group: 'daily' },
  CAR_CLAIM: { name: '一键收车', cron: '7 15 * * 1-3', group: 'daily' },
  BLACK_MARKET: { name: '黑市采购', cron: '4 12 * * *', group: 'daily' },
  TREASURE_CLAIM: { name: '珍宝阁领取', cron: '1 0 * * *', group: 'daily' },
  LEGACY_CLAIM: { name: '残卷收取', cron: '23 */6 * * *', group: 'daily' },
  WELFARE_CLAIM: { name: '福利奖励领取', cron: '4 12 * * *', group: 'daily' },
  DAILY_TASK_CLAIM: { name: '日周活跃奖励领取', cron: '25 12 * * *', group: 'daily' },
  DREAM: { name: '梦境', cron: '10 12 * * 0,3,6', group: 'dungeon' },
  SKIN_CHALLENGE: { name: '换皮闯关', cron: '10 12 * * *', group: 'dungeon' },
  STAR_TEMPLE: { name: '星级十殿', cron: '10 12 * * *', group: 'dungeon' },
  DREAM_PURCHASE: { name: '购买梦境商品', cron: '10 12 * * 0,3,6', group: 'dungeon' },
  PEACH_TASK: { name: '蟠桃园任务', cron: '0 10 * * *', group: 'dungeon' },
  BOX_OPEN: { name: '批量开箱', cron: '7 12 * * *', group: 'resource' },
  LEGION_STORE_FRAGMENT: { name: '购买四圣碎片', cron: '0 8 * * 1', group: 'resource' },
  GENIE_SWEEP: { name: '灯神扫荡', cron: '1 0 * * *', group: 'resource' },
  GACHA: { name: '免费扭蛋抽奖', cron: '1 0 * * 2,4,6', group: 'resource' },
};

export const LEGACY_DEFAULT_TASK_CRONS = {
  HANGUP_ADD_TIME: ['0 */3 * * *'],
  LEGACY_CLAIM: ['0 */6 * * *'],
  ARENA: ['1 12 * * *'],
  TOWER: ['1 12 * * *'],
  WEIRD_TOWER: ['1 12 * * *'],
  WEIRD_TOWER_FREE_ITEM: ['1 12 * * *'],
  WEIRD_TOWER_USE_ITEM: ['1 12 * * *'],
  WEIRD_TOWER_MERGE_ITEM: ['1 12 * * *'],
  DAILY_BOSS: ['1 12 * * *'],
  FRIEND_GOLD: ['1 12 * * *'],
  BUY_GOLD: ['1 12 * * *'],
  FISHING: ['1 12 * * *'],
  STUDY: ['1 12 * * *'],
  BOTTLE_CLAIM: ['1 12 * * *'],
  CAR_SEND: ['1 12 * * *', '7 12 * * *'],
  BLACK_MARKET: ['1 12 * * *'],
  WELFARE_CLAIM: ['1 12 * * *'],
  DAILY_TASK_CLAIM: ['1 12 * * *', '4 12 * * *'],
  DREAM: ['1 12 * * *', '10 12 * * *'],
  SKIN_CHALLENGE: ['1 12 * * *'],
  DREAM_PURCHASE: ['1 12 * * *', '10 12 * * *'],
  BOX_OPEN: ['1 12 * * *'],
  LEGION_STORE_FRAGMENT: ['1 12 * * *', '7 12 * * *'],
  RECRUIT: ['1 12 * * *'],
  CAR_CLAIM: ['1 18 * * *'],
};

export const REBALANCED_DEFAULT_TASK_CRONS = Object.fromEntries(
  Object.entries(TASK_TYPES).map(([taskType, meta]) => [taskType, meta.cron])
);

export const DEFAULT_TASK_CONFIG_SEEDS = {
  HANGUP_CLAIM: { enabled: true, config: { count: 5 } },
  HANGUP_ADD_TIME: { enabled: true, config: {} },
  BOTTLE_RESET: { enabled: true, config: {} },
  BOTTLE_CLAIM: { enabled: true, config: {} },
  LEGION_SIGN: { enabled: true, config: {} },
  FRIEND_GOLD: { enabled: true, config: { count: 3 } },
  MAIL_CLAIM: { enabled: true, config: {} },
  STUDY: { enabled: true, config: {} },
  ARENA: { enabled: true, config: { arenaFormation: 1, battleCount: 3 } },
  CAR_SEND: {
    enabled: true,
    config: {
      minCarColor: 4,
      maxRefreshAttempts: 3,
      allowGoldRefresh: false,
      fallbackSendWhenStuck: true,
      goldThreshold: 0,
      recruitThreshold: 0,
      jadeThreshold: 0,
      ticketThreshold: 0,
      matchAll: false,
    }
  },
  CAR_CLAIM: { enabled: true, config: {} },
  BUY_GOLD: { enabled: true, config: { buyNum: 3 } },
  RECRUIT: {
    enabled: true,
    config: {
      useFreeRecruit: true,
      usePaidRecruit: true,
      freeRecruitCount: 1,
      paidRecruitCount: 1,
    }
  },
  FISHING: { enabled: true, config: { type: 1, count: 3 } },
  BOX_OPEN: { enabled: true, config: { boxType: 2001, number: 10 } },
  BLACK_MARKET: { enabled: true, config: {} },
  TREASURE_CLAIM: { enabled: true, config: {} },
  LEGACY_CLAIM: { enabled: true, config: { interval: 360 } },
  TOWER: { enabled: true, config: { towerFormation: 1, maxFloors: 10 } },
  WEIRD_TOWER: { enabled: true, config: { weirdTowerFormation: 1, weirdTowerMaxFloors: 10 } },
  WEIRD_TOWER_FREE_ITEM: { enabled: true, config: {} },
  WEIRD_TOWER_USE_ITEM: { enabled: true, config: {} },
  WEIRD_TOWER_MERGE_ITEM: { enabled: true, config: {} },
  LEGION_STORE_FRAGMENT: { enabled: true, config: {} },
  LEGION_BOSS: { enabled: true, config: { bossFormation: 2, bossTimes: 2 } },
  DAILY_BOSS: { enabled: true, config: {} },
  WELFARE_CLAIM: { enabled: true, config: {} },
  DAILY_TASK_CLAIM: { enabled: true, config: {} },
  DREAM: { enabled: true, config: {} },
  SKIN_CHALLENGE: { enabled: true, config: {} },
  STAR_TEMPLE: {
    enabled: false,
    config: {
      stages: Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [
          index + 1,
          { targetStars: null, maxAttempts: null },
        ])
      ),
    },
  },
  DREAM_PURCHASE: { enabled: true, config: { purchaseList: ['1-3', '1-5', '2-6', '2-7', '3-1', '3-2', '3-7'] } },
  GENIE_SWEEP: { enabled: true, config: {} },
  GACHA: { enabled: true, config: {} },
};

function getTaskDefaultCronVersion(taskType) {
  return TASK_TYPES[taskType] ? CURRENT_DEFAULT_CRON_VERSION : 1;
}

function getTaskDefaultConfigJson(taskType) {
  const seed = DEFAULT_TASK_CONFIG_SEEDS[taskType] || {};
  return JSON.stringify(seed.config || {});
}

function normalizeRecruitTaskConfig(config = {}) {
  const next = { ...(config || {}) };

  const rawPaidCount = Math.max(0, Number(next.paidRecruitCount ?? (next.usePaidRecruit === false ? 0 : 1)) || 0);
  const usePaidRecruit = next.usePaidRecruit !== false && rawPaidCount > 0;

  next.useFreeRecruit = next.useFreeRecruit !== false;
  next.usePaidRecruit = usePaidRecruit;
  next.freeRecruitCount = Math.max(1, Number(next.freeRecruitCount ?? 1) || 1);
  next.paidRecruitCount = usePaidRecruit ? Math.max(1, rawPaidCount || 1) : 0;

  return next;
}

function normalizeStarTempleTaskConfig(config = {}) {
  const rawStages = config?.stages && typeof config.stages === 'object'
    ? config.stages
    : {};

  return {
    stages: Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => {
        const stageId = index + 1;
        const stageConfig = rawStages[stageId] || rawStages[String(stageId)] || {};
        const targetStars = Number(stageConfig?.targetStars);
        const maxAttempts = Number(stageConfig?.maxAttempts);
        return [
          stageId,
          {
            targetStars: Number.isInteger(targetStars) && targetStars >= 1 && targetStars <= 3
              ? targetStars
              : null,
            maxAttempts: Number.isInteger(maxAttempts) && maxAttempts >= 1
              ? maxAttempts
              : null,
          },
        ];
      })
    ),
  };
}

function normalizeFormationValue(value, fallback = 1) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 6) {
    return fallback;
  }
  return normalized;
}

function normalizeTaskConfigPayload(taskType, config = {}) {
  if (!config || typeof config !== 'object') {
    return config || {};
  }

  if (taskType === 'RECRUIT') {
    return normalizeRecruitTaskConfig(config);
  }

  if (taskType === 'STAR_TEMPLE') {
    return normalizeStarTempleTaskConfig(config);
  }

  if (taskType === 'ARENA') {
    return {
      ...(config || {}),
      arenaFormation: normalizeFormationValue(config.arenaFormation, 1),
      battleCount: Math.max(1, Math.min(10, Number(config.battleCount ?? 3) || 3)),
    };
  }

  if (taskType === 'TOWER') {
    return {
      ...(config || {}),
      towerFormation: normalizeFormationValue(config.towerFormation, 1),
      maxFloors: Math.max(1, Math.min(100, Number(config.maxFloors ?? 10) || 10)),
    };
  }

  if (taskType === 'WEIRD_TOWER') {
    return {
      ...(config || {}),
      weirdTowerFormation: normalizeFormationValue(config.weirdTowerFormation, 1),
      weirdTowerMaxFloors: Math.max(1, Math.min(100, Number(config.weirdTowerMaxFloors ?? config.maxFloors ?? 10) || 10)),
    };
  }

  return config;
}

function stableSortValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableSortValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableSortValue(value[key]);
      return acc;
    }, {});
  }

  return value;
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

function getAccountTaskConfigRows(accountId, targetDb = getDatabase()) {
  return targetDb.all(
    `SELECT id, account_id, task_type, enabled, cron_expression, config_json, last_run_at, next_run_at, created_at, updated_at
       FROM task_configs
      WHERE account_id = ?
      ORDER BY task_type ASC, id ASC`,
    [accountId]
  );
}

function getTaskConfigsRevision(rows = []) {
  const payload = rows.map((row) => ({
    taskType: String(row.task_type || ''),
    enabled: Number(row.enabled || 0),
    cronExpression: String(row.cron_expression || ''),
    config: stableSortValue(parseTaskConfigJson(row.config_json)),
  }));

  return createHash('sha1')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function getAccountTaskConfigRevision(accountId, targetDb = getDatabase()) {
  return getTaskConfigsRevision(getAccountTaskConfigRows(accountId, targetDb));
}

function summarizeTaskConfigPayload(tasks = []) {
  return tasks.map((item) => ({
    taskType: String(item?.taskType || item?.task_type || ''),
    enabled: item?.enabled === undefined ? null : !!item.enabled,
    cronExpression: item?.cronExpression || item?.cron_expression || null,
  }));
}

function recordTaskConfigAudit(entry = {}) {
  try {
    addTaskConfigAuditLog(undefined, entry);
  } catch (error) {
    console.warn('⚠️ 写入任务配置审计日志失败:', error?.message || error);
  }
}

function buildTaskConfigAuditContext(req, accountId, extra = {}) {
  return {
    requestId: req?.requestId || null,
    accountId: Number(accountId || 0),
    userId: Number(req?.user?.userId || 0) || null,
    source: extra.source || 'tasks_route',
    ...extra,
  };
}

function insertDefaultTaskConfig(targetDb, accountId, taskType, seed = {}) {
  const taskMeta = TASK_TYPES[taskType];
  if (!taskMeta) {
    return false;
  }

  targetDb.run(
    `INSERT INTO task_configs (account_id, task_type, enabled, cron_expression, cron_is_customized, default_cron_version, config_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      accountId,
      taskType,
      seed.enabled ? 1 : 0,
      seed.cronExpression || taskMeta.cron,
      0,
      getTaskDefaultCronVersion(taskType),
      JSON.stringify(seed.config || {}),
    ]
  );
  return true;
}

export function ensureDefaultTaskConfigsForAccount(accountId, targetDb = getDatabase(), options = {}) {
  const { persist = true } = options;
  const normalizedAccountId = Number(accountId);
  if (!Number.isInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    return { created: 0, insertedTaskTypes: [] };
  }

  const existingTaskTypes = new Set(
    all('SELECT task_type FROM task_configs WHERE account_id = ?', [normalizedAccountId])
      .map((row) => String(row.task_type || ''))
      .filter(Boolean)
  );

  const insertedTaskTypes = [];
  for (const [taskType, seed] of Object.entries(DEFAULT_TASK_CONFIG_SEEDS)) {
    if (existingTaskTypes.has(taskType)) {
      continue;
    }
    if (insertDefaultTaskConfig(targetDb, normalizedAccountId, taskType, seed)) {
      insertedTaskTypes.push(taskType);
    }
  }

  if (insertedTaskTypes.length > 0 && persist) {
    void saveDatabase();
  }

  return {
    created: insertedTaskTypes.length,
    insertedTaskTypes,
  };
}

export async function ensureDefaultTaskConfigsForAllAccounts(targetDb = getDatabase()) {
  const accounts = all('SELECT id FROM game_accounts');
  let created = 0;
  const details = [];

  accounts.forEach((account) => {
    const result = ensureDefaultTaskConfigsForAccount(account.id, targetDb, { persist: false });
    if (result.created > 0) {
      created += result.created;
      details.push({
        accountId: Number(account.id),
        insertedTaskTypes: result.insertedTaskTypes,
      });
    }
  });

  if (created > 0) {
    await saveDatabase();
  }

  return {
    accountCount: accounts.length,
    created,
    details,
  };
}

export async function rebalanceDefaultTaskCronExpressions() {
  let updated = 0;
  const details = [];
  let skippedUnknown = 0;
  const skippedDetails = [];

  for (const [taskType, legacyCronSource] of Object.entries(LEGACY_DEFAULT_TASK_CRONS)) {
    const targetCron = REBALANCED_DEFAULT_TASK_CRONS[taskType];
    const sourceCrons = Array.isArray(legacyCronSource) ? legacyCronSource : [legacyCronSource];
    if (!targetCron || sourceCrons.includes(targetCron)) {
      continue;
    }

    const normalizedSourceCrons = Array.from(new Set(sourceCrons.filter(Boolean)));
    if (normalizedSourceCrons.length === 0) {
      continue;
    }

    const seed = DEFAULT_TASK_CONFIG_SEEDS[taskType];
    const defaultEnabled = seed?.enabled ? 1 : 0;
    const defaultConfigJson = getTaskDefaultConfigJson(taskType);

    const cronPlaceholders = normalizedSourceCrons.map(() => '?').join(', ');

    const eligibleRows = all(
      `SELECT id FROM task_configs
        WHERE task_type = ?
          AND cron_expression IN (${cronPlaceholders})
          AND (
            (
              cron_is_customized = 0
              AND default_cron_version IS NOT NULL
              AND default_cron_version < ?
            )
            OR (
              (
                cron_is_customized = 0
                OR cron_is_customized IS NULL
              )
              AND default_cron_version IS NULL
              AND enabled = ?
              AND COALESCE(config_json, '{}') = ?
            )
          )`,
      [taskType, ...normalizedSourceCrons, CURRENT_DEFAULT_CRON_VERSION, defaultEnabled, defaultConfigJson],
    );

    const unknownRows = all(
      `SELECT id FROM task_configs
        WHERE task_type = ?
          AND cron_expression IN (${cronPlaceholders})
          AND (
            (
              (
                cron_is_customized = 0
                OR cron_is_customized IS NULL
              )
              AND default_cron_version IS NULL
              AND (
                enabled != ?
                OR COALESCE(config_json, '{}') != ?
              )
            )
            OR (
              cron_is_customized != 0
              AND default_cron_version IS NULL
            )
          )`,
      [taskType, ...normalizedSourceCrons, defaultEnabled, defaultConfigJson],
    );

    if (eligibleRows.length === 0 && unknownRows.length === 0) {
      continue;
    }

    if (eligibleRows.length > 0) {
      const nextRunAt = calculateNextRunAt(targetCron);
      run(
        `UPDATE task_configs
            SET cron_expression = ?, next_run_at = ?, cron_is_customized = 0, default_cron_version = ?, updated_at = CURRENT_TIMESTAMP
          WHERE task_type = ?
            AND cron_expression IN (${cronPlaceholders})
            AND (
              (
                cron_is_customized = 0
                AND default_cron_version IS NOT NULL
                AND default_cron_version < ?
              )
              OR (
                (
                  cron_is_customized = 0
                  OR cron_is_customized IS NULL
                )
                AND default_cron_version IS NULL
                AND enabled = ?
                AND COALESCE(config_json, '{}') = ?
              )
            )`,
        [
          targetCron,
          nextRunAt,
          CURRENT_DEFAULT_CRON_VERSION,
          taskType,
          ...normalizedSourceCrons,
          CURRENT_DEFAULT_CRON_VERSION,
          defaultEnabled,
          defaultConfigJson,
        ],
      );

      updated += eligibleRows.length;
      details.push({
        taskType,
        from: normalizedSourceCrons,
        to: targetCron,
        affectedCount: eligibleRows.length,
      });
    }

    if (unknownRows.length > 0) {
      skippedUnknown += unknownRows.length;
      skippedDetails.push({
        taskType,
        cronExpression: normalizedSourceCrons,
        skippedCount: unknownRows.length,
      });
    }
  }

  if (updated > 0) {
    await saveDatabase();
  }

  return {
    updated,
    details,
    skippedUnknown,
    skippedDetails,
  };
}

router.get('/types', (req, res) => {
  const types = Object.entries(TASK_TYPES).map(([key, value]) => ({
    type: key,
    name: value.name,
    defaultCron: value.cron,
    group: value.group || 'other'
  }));

  res.json({
    success: true,
    data: types
  });
});

router.get('/account/:accountId', (req, res) => {
  try {
    const { accountId } = req.params;

    const account = get(
      'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
      [accountId, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    ensureDefaultTaskConfigsForAccount(accountId);

    const configs = getAccountTaskConfigRows(accountId);
    const revision = getTaskConfigsRevision(configs);
    const parsedConfigs = configs.map((config) => ({
      ...config,
      enabled: !!config.enabled,
      config: parseTaskConfigJson(config.config_json)
    }));

    res.json({
      success: true,
      data: {
        items: parsedConfigs,
        revision,
      }
    });
  } catch (error) {
    console.error('获取任务配置错误:', error);
    res.status(500).json({
      success: false,
      error: '获取任务配置失败'
    });
  }
});

router.put('/account/:accountId/batch', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { tasks, baselineRevision = null } = req.body || {};

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供要保存的任务配置列表'
      });
    }

    const account = get(
      'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
      [accountId, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    ensureDefaultTaskConfigsForAccount(accountId);

    const db = getDatabase();
    let beforeRevision = null;
    const saveBatch = db.transaction((taskList) => {
      const currentRevision = getAccountTaskConfigRevision(accountId, db);
      beforeRevision = currentRevision;
      if (baselineRevision && baselineRevision !== currentRevision) {
        const conflictError = new Error('TASK_CONFIG_CONFLICT');
        conflictError.code = 'TASK_CONFIG_CONFLICT';
        conflictError.currentRevision = currentRevision;
        throw conflictError;
      }

      const existingRows = getAccountTaskConfigRows(accountId, db);
      const existingByTaskType = new Map(existingRows.map((row) => [row.task_type, row]));

      taskList.forEach((taskItem) => {
        const taskType = String(taskItem?.taskType || '').trim();
        if (!taskType || !TASK_TYPES[taskType]) {
          const typeError = new Error(`INVALID_TASK_TYPE:${taskType}`);
          typeError.code = 'INVALID_TASK_TYPE';
          throw typeError;
        }

        const cronExpression = taskItem?.cronExpression || TASK_TYPES[taskType].cron;
        const normalizedConfig = normalizeTaskConfigPayload(taskType, taskItem?.config);
        const configJson = JSON.stringify(normalizedConfig || {});
        const cronIsCustomized = Number(cronExpression !== TASK_TYPES[taskType].cron);
        const defaultCronVersion = cronIsCustomized ? null : getTaskDefaultCronVersion(taskType);
        const existing = existingByTaskType.get(taskType);

        if (existing) {
          db.run(
            `UPDATE task_configs
                SET enabled = ?,
                    cron_expression = ?,
                    cron_is_customized = ?,
                    default_cron_version = ?,
                    config_json = ?,
                    updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
            [
              taskItem?.enabled ? 1 : 0,
              cronExpression,
              cronIsCustomized,
              defaultCronVersion,
              configJson,
              existing.id,
            ]
          );
          return;
        }

        db.run(
          `INSERT INTO task_configs (account_id, task_type, enabled, cron_expression, cron_is_customized, default_cron_version, config_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [accountId, taskType, taskItem?.enabled ? 1 : 0, cronExpression, cronIsCustomized, defaultCronVersion, configJson]
        );
      });
    });

    saveBatch(tasks);

    const { checkAndRunDueTasks } = await import('../scheduler/index.js');
    await checkAndRunDueTasks();

    const afterRevision = getAccountTaskConfigRevision(accountId);
    recordTaskConfigAudit(buildTaskConfigAuditContext(req, accountId, {
      action: 'batch_save',
      status: 'success',
      baselineRevision,
      beforeRevision,
      afterRevision,
      payload: { tasks },
      summary: {
        updatedCount: tasks.length,
        tasks: summarizeTaskConfigPayload(tasks),
      },
    }));

    res.json({
      success: true,
      message: '任务配置已批量保存',
      data: {
        updatedCount: tasks.length,
        revision: afterRevision,
      }
    });
  } catch (error) {
    if (error?.code === 'TASK_CONFIG_CONFLICT') {
      recordTaskConfigAudit(buildTaskConfigAuditContext(req, accountId, {
        action: 'batch_save',
        status: 'conflict',
        baselineRevision,
        beforeRevision: error.currentRevision || beforeRevision || null,
        afterRevision: error.currentRevision || null,
        payload: { tasks },
        summary: {
          updatedCount: Array.isArray(tasks) ? tasks.length : 0,
          tasks: summarizeTaskConfigPayload(tasks),
        },
        errorMessage: 'revision_conflict',
      }));
      return res.status(409).json({
        success: false,
        error: '任务配置已被其他页面或设备更新，请刷新后重试',
        data: {
          currentRevision: error.currentRevision || null,
        }
      });
    }

    if (error?.code === 'INVALID_TASK_TYPE') {
      recordTaskConfigAudit(buildTaskConfigAuditContext(req, accountId, {
        action: 'batch_save',
        status: 'rejected',
        baselineRevision,
        beforeRevision,
        payload: { tasks },
        summary: {
          updatedCount: Array.isArray(tasks) ? tasks.length : 0,
          tasks: summarizeTaskConfigPayload(tasks),
        },
        errorMessage: error?.message || 'invalid_task_type',
      }));
      return res.status(400).json({
        success: false,
        error: '提交中包含无效的任务类型'
      });
    }

    recordTaskConfigAudit(buildTaskConfigAuditContext(req, accountId, {
      action: 'batch_save',
      status: 'error',
      baselineRevision,
      beforeRevision,
      payload: { tasks },
      summary: {
        updatedCount: Array.isArray(tasks) ? tasks.length : 0,
        tasks: summarizeTaskConfigPayload(tasks),
      },
      errorMessage: error?.message || String(error),
    }));
    console.error('批量保存任务配置错误:', error);
    res.status(500).json({
      success: false,
      error: '批量保存任务配置失败'
    });
  }
});

router.post('/account/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { taskType, enabled, cronExpression, config, baselineRevision = null } = req.body;

    if (!baselineRevision) {
      recordTaskConfigAudit(buildTaskConfigAuditContext(req, accountId, {
        action: 'single_save',
        status: 'rejected',
        taskType,
        payload: { enabled, cronExpression, config },
        summary: { tasks: summarizeTaskConfigPayload([{ taskType, enabled, cronExpression }]) },
        errorMessage: 'missing_baseline_revision',
      }));
      return res.status(409).json({
        success: false,
        error: '任务配置保存接口已升级，请刷新页面后重试'
      });
    }

    if (!taskType || !TASK_TYPES[taskType]) {
      return res.status(400).json({
        success: false,
        error: '无效的任务类型'
      });
    }

    const account = get(
      'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
      [accountId, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    ensureDefaultTaskConfigsForAccount(accountId);
    const currentRevision = getAccountTaskConfigRevision(accountId);
    if (baselineRevision !== currentRevision) {
      recordTaskConfigAudit(buildTaskConfigAuditContext(req, accountId, {
        action: 'single_save',
        status: 'conflict',
        taskType,
        baselineRevision,
        beforeRevision: currentRevision,
        afterRevision: currentRevision,
        payload: { enabled, cronExpression, config },
        summary: { tasks: summarizeTaskConfigPayload([{ taskType, enabled, cronExpression }]) },
        errorMessage: 'revision_conflict',
      }));
      return res.status(409).json({
        success: false,
        error: '任务配置已被其他页面或设备更新，请刷新后重试',
        data: {
          currentRevision,
        }
      });
    }

    const existing = get(
      'SELECT id, task_type FROM task_configs WHERE account_id = ? AND task_type = ?',
      [accountId, taskType]
    );

    const cron = cronExpression || TASK_TYPES[taskType].cron;
    const normalizedConfig = normalizeTaskConfigPayload(taskType, config);
    const configJson = normalizedConfig ? JSON.stringify(normalizedConfig) : null;
    const cronIsCustomized = Number(cron !== TASK_TYPES[taskType].cron);
    const defaultCronVersion = cronIsCustomized ? null : getTaskDefaultCronVersion(taskType);

    if (existing) {
      const updateFields = [
        'enabled = ?',
        'cron_expression = ?',
        'config_json = ?',
      ];
      const updateValues = [
        enabled ? 1 : 0,
        cron,
        configJson,
      ];

      updateFields.push('cron_is_customized = ?');
      updateValues.push(cronIsCustomized);
      updateFields.push('default_cron_version = ?');
      updateValues.push(defaultCronVersion);

      updateValues.push(existing.id);

      run(
        `UPDATE task_configs
         SET ${updateFields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        updateValues
      );

      const { checkAndRunDueTasks } = await import('../scheduler/index.js');
      await checkAndRunDueTasks();

      const afterRevision = getAccountTaskConfigRevision(accountId);
      recordTaskConfigAudit(buildTaskConfigAuditContext(req, accountId, {
        action: 'single_save',
        status: 'success',
        taskType,
        baselineRevision,
        beforeRevision: currentRevision,
        afterRevision,
        payload: { enabled, cronExpression: cron, config: normalizedConfig },
        summary: { tasks: summarizeTaskConfigPayload([{ taskType, enabled, cronExpression: cron }]) },
      }));

      res.json({
        success: true,
        message: '任务配置更新成功',
        data: {
          revision: afterRevision,
        }
      });
    } else {
      const result = run(
        `INSERT INTO task_configs (account_id, task_type, enabled, cron_expression, cron_is_customized, default_cron_version, config_json) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [accountId, taskType, enabled ? 1 : 0, cron, cronIsCustomized, defaultCronVersion, configJson]
      );

      const { checkAndRunDueTasks } = await import('../scheduler/index.js');
      await checkAndRunDueTasks();

      const afterRevision = getAccountTaskConfigRevision(accountId);
      recordTaskConfigAudit(buildTaskConfigAuditContext(req, accountId, {
        action: 'single_save',
        status: 'success',
        taskType,
        baselineRevision,
        beforeRevision: currentRevision,
        afterRevision,
        payload: { enabled, cronExpression: cron, config: normalizedConfig },
        summary: { tasks: summarizeTaskConfigPayload([{ taskType, enabled, cronExpression: cron }]) },
      }));

      res.status(201).json({
        success: true,
        message: '任务配置创建成功',
        data: {
          id: result.lastInsertRowid,
          revision: afterRevision,
        }
      });
    }
  } catch (error) {
    recordTaskConfigAudit(buildTaskConfigAuditContext(req, req.params?.accountId, {
      action: 'single_save',
      status: 'error',
      taskType: req.body?.taskType,
      baselineRevision: req.body?.baselineRevision || null,
      payload: {
        enabled: req.body?.enabled,
        cronExpression: req.body?.cronExpression,
        config: req.body?.config,
      },
      summary: { tasks: summarizeTaskConfigPayload([{
        taskType: req.body?.taskType,
        enabled: req.body?.enabled,
        cronExpression: req.body?.cronExpression,
      }]) },
      errorMessage: error?.message || String(error),
    }));
    console.error('创建/更新任务配置错误:', error);
    res.status(500).json({
      success: false,
      error: '操作失败'
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { enabled, cronExpression, config } = req.body;

    const taskConfig = get(
      `SELECT tc.id, tc.task_type FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE tc.id = ? AND ga.user_id = ?`,
      [id, req.user.userId]
    );

    if (!taskConfig) {
      return res.status(404).json({
        success: false,
        error: '任务配置不存在'
      });
    }

    const updateFields = [];
    const updateValues = [];

    if (enabled !== undefined) {
      updateFields.push('enabled = ?');
      updateValues.push(enabled ? 1 : 0);
    }
    if (cronExpression !== undefined) {
      updateFields.push('cron_expression = ?');
      updateValues.push(cronExpression);
      updateFields.push('cron_is_customized = ?');
      const cronIsCustomized = Number(cronExpression !== TASK_TYPES[taskConfig.task_type]?.cron);
      updateValues.push(cronIsCustomized);
      updateFields.push('default_cron_version = ?');
      updateValues.push(cronIsCustomized ? null : getTaskDefaultCronVersion(taskConfig.task_type));
    }
    if (config !== undefined) {
      updateFields.push('config_json = ?');
      updateValues.push(JSON.stringify(normalizeTaskConfigPayload(taskConfig.task_type, config)));
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有要更新的内容'
      });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(id);

    run(
      `UPDATE task_configs SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    const { checkAndRunDueTasks } = await import('../scheduler/index.js');
    await checkAndRunDueTasks();

    res.json({
      success: true,
      message: '任务配置更新成功'
    });
  } catch (error) {
    console.error('更新任务配置错误:', error);
    res.status(500).json({
      success: false,
      error: '更新任务配置失败'
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const taskConfig = get(
      `SELECT tc.id FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE tc.id = ? AND ga.user_id = ?`,
      [req.params.id, req.user.userId]
    );

    if (!taskConfig) {
      return res.status(404).json({
        success: false,
        error: '任务配置不存在'
      });
    }

    run('DELETE FROM task_configs WHERE id = ?', [req.params.id]);

    const { checkAndRunDueTasks } = await import('../scheduler/index.js');
    await checkAndRunDueTasks();

    res.json({
      success: true,
      message: '任务配置删除成功'
    });
  } catch (error) {
    console.error('删除任务配置错误:', error);
    res.status(500).json({
      success: false,
      error: '删除任务配置失败'
    });
  }
});

router.get('/logs/:accountId', (req, res) => {
  try {
    const { accountId } = req.params;
    const { limit = 50, taskType } = req.query;

    const account = get(
      'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
      [accountId, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    let sql = 'SELECT * FROM task_logs WHERE account_id = ?';
    const params = [accountId];

    if (taskType) {
      sql += ' AND task_type = ?';
      params.push(taskType);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));

    const logs = all(sql, params);

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('获取任务日志错误:', error);
    res.status(500).json({
      success: false,
      error: '获取任务日志失败'
    });
  }
});

export function getEnabledTasks() {
  return all(
    `SELECT tc.*, ga.user_id, ga.name as account_name, ga.token_encrypted, ga.token_iv, ga.server, ga.ws_url,
            ga.import_method AS account_import_method, ga.updated_at AS account_updated_at
     FROM task_configs tc
     JOIN game_accounts ga ON tc.account_id = ga.id
     JOIN users u ON ga.user_id = u.id
     WHERE tc.enabled = 1
       AND ga.status = 'active'
       AND COALESCE(u.is_enabled, 1) = 1
       AND (u.access_start_at IS NULL OR datetime(u.access_start_at) <= datetime('now'))
       AND (u.access_end_at IS NULL OR datetime(u.access_end_at) >= datetime('now'))`
  );
}

export function updateTaskRunTime(taskId, nextRunAt) {
  run(
    'UPDATE task_configs SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [nextRunAt, taskId]
  );
}

export async function updateTaskRunTimesBatch(updates = []) {
  const normalized = updates
    .map((item) => ({
      taskId: Number(item?.taskId),
      nextRunAt: item?.nextRunAt ?? null,
    }))
    .filter((item) => Number.isInteger(item.taskId) && item.taskId > 0);

  if (normalized.length === 0) {
    return 0;
  }

  const db = getDatabase();
  normalized.forEach((item) => {
    db.run(
      'UPDATE task_configs SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [item.nextRunAt, item.taskId]
    );
  });
  await saveDatabase();
  return normalized.length;
}

export function markTaskRunTime(taskId, lastRunAt, nextRunAt) {
  run(
    'UPDATE task_configs SET last_run_at = ?, next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [lastRunAt, nextRunAt, taskId]
  );
}

const TASK_LOG_DETAILS_MAX_LENGTH = 1000;

function normalizeTaskLogDetails(status, details) {
  if (details === null || details === undefined || details === '') {
    return null;
  }

  if (status === 'success') {
    return null;
  }

  const raw = typeof details === 'string' ? details : JSON.stringify(details);
  if (!raw) {
    return null;
  }

  if (raw.length <= TASK_LOG_DETAILS_MAX_LENGTH) {
    return raw;
  }

  const omitted = raw.length - TASK_LOG_DETAILS_MAX_LENGTH;
  return `${raw.slice(0, TASK_LOG_DETAILS_MAX_LENGTH)}...[已截断${omitted}字符]`;
}

export function addTaskLog(accountId, taskType, status, message, details = null) {
  const normalizedDetails = normalizeTaskLogDetails(status, details);
  const info = run(
    'INSERT INTO task_logs (account_id, task_type, status, message, details) VALUES (?, ?, ?, ?, ?)',
    [accountId, taskType, status, message, normalizedDetails]
  );
  upsertTaskExecutionMarker(undefined, accountId, taskType, status, message, normalizedDetails);
  cleanupTaskLogs(undefined, accountId);
  return info;
}

export default router;
