import { Router } from 'express';
import { run, get, all, cleanupBatchTaskLogs, getDatabase, saveDatabase } from '../database/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { scheduleBatchTask, unscheduleBatchTask, executeBatchTask } from '../batchScheduler/index.js';

const router = Router();

router.use(authMiddleware);

export const BATCH_TASK_TYPES = {
  SIGN_IN: { name: '每日签到', group: 'daily' },
  LEGION_SIGN: { name: '军团签到', group: 'daily' },
  ARENA: { name: '竞技场战斗', group: 'daily' },
  TOWER: { name: '爬塔', group: 'dungeon' },
  BOSS_TOWER: { name: '咸王宝库', group: 'dungeon' },
  WEIRD_TOWER: { name: '怪异塔', group: 'dungeon' },
  LEGION_BOSS: { name: '军团BOSS', group: 'dungeon' },
  RECRUIT: { name: '武将招募', group: 'resource' },
  FRIEND_GOLD: { name: '送好友金币', group: 'daily' },
  BUY_GOLD: { name: '点金', group: 'resource' },
  FISHING: { name: '钓鱼', group: 'resource' },
  MAIL_CLAIM: { name: '领取邮件', group: 'daily' },
  HANGUP_CLAIM: { name: '领取挂机奖励', group: 'daily' },
  STUDY: { name: '答题', group: 'daily' },
  HANGUP_ADD_TIME: { name: '一键加钟', group: 'daily' },
  BOTTLE_RESET: { name: '重置罐子', group: 'daily' },
  BOTTLE_CLAIM: { name: '领取罐子', group: 'daily' },
  CAR_SEND: { name: '智能发车', group: 'daily' },
  CAR_CLAIM: { name: '一键收车', group: 'daily' },
  BLACK_MARKET: { name: '黑市采购', group: 'daily' },
  TREASURE_CLAIM: { name: '珍宝阁领取', group: 'daily' },
  LEGACY_CLAIM: { name: '残卷收取', group: 'daily' },
  DREAM: { name: '梦境', group: 'dungeon' },
  SKIN_CHALLENGE: { name: '换皮闯关', group: 'dungeon' },
  PEACH_TASK: { name: '蟠桃园任务', group: 'dungeon' },
  BOX_OPEN: { name: '批量开箱', group: 'resource' },
  GENIE_SWEEP: { name: '灯神扫荡', group: 'resource' },
  GACHA: { name: '免费扭蛋抽奖', group: 'resource' },
};

router.get('/types', (req, res) => {
  const types = Object.entries(BATCH_TASK_TYPES).map(([key, value]) => ({
    type: key,
    name: value.name,
    group: value.group || 'other'
  }));

  res.json({
    success: true,
    data: types
  });
});

router.get('/', (req, res) => {
  try {
    const tasks = all(
      `SELECT * FROM batch_scheduled_tasks WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.userId]
    );

    const parsedTasks = tasks.map(task => ({
      ...task,
      enabled: !!task.enabled,
      selectedAccountIds: JSON.parse(task.selected_account_ids || '[]'),
      selectedTaskTypes: JSON.parse(task.selected_task_types || '[]')
    }));

    res.json({
      success: true,
      data: parsedTasks
    });
  } catch (error) {
    console.error('获取批量任务列表错误:', error);
    res.status(500).json({
      success: false,
      error: '获取批量任务列表失败'
    });
  }
});

router.get('/:id', (req, res) => {
  try {
    const task = get(
      'SELECT * FROM batch_scheduled_tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    res.json({
      success: true,
      data: {
        ...task,
        enabled: !!task.enabled,
        selectedAccountIds: JSON.parse(task.selected_account_ids || '[]'),
        selectedTaskTypes: JSON.parse(task.selected_task_types || '[]')
      }
    });
  } catch (error) {
    console.error('获取批量任务详情错误:', error);
    res.status(500).json({
      success: false,
      error: '获取批量任务详情失败'
    });
  }
});

router.post('/', (req, res) => {
  try {
    const { name, runType, runTime, cronExpression, selectedAccountIds, selectedTaskTypes, enabled } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: '任务名称不能为空'
      });
    }

    if (!selectedAccountIds || selectedAccountIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请选择至少一个账号'
      });
    }

    if (!selectedTaskTypes || selectedTaskTypes.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请选择至少一个任务类型'
      });
    }

    if (runType === 'daily' && !runTime) {
      return res.status(400).json({
        success: false,
        error: '请选择运行时间'
      });
    }

    if (runType === 'cron' && !cronExpression) {
      return res.status(400).json({
        success: false,
        error: '请输入Cron表达式'
      });
    }

    const accountIdsJson = JSON.stringify(selectedAccountIds);
    const taskTypesJson = JSON.stringify(selectedTaskTypes);

    const result = run(
      `INSERT INTO batch_scheduled_tasks (user_id, name, run_type, run_time, cron_expression, selected_account_ids, selected_task_types, enabled) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.userId, name, runType || 'daily', runTime || null, cronExpression || null, accountIdsJson, taskTypesJson, enabled !== false ? 1 : 0]
    );

    const newTask = get('SELECT * FROM batch_scheduled_tasks WHERE id = ?', [result.lastInsertRowid]);

    if (newTask.enabled) {
      scheduleBatchTask(newTask);
    }

    res.status(201).json({
      success: true,
      message: '批量任务创建成功',
      data: {
        ...newTask,
        enabled: !!newTask.enabled,
        selectedAccountIds: JSON.parse(newTask.selected_account_ids || '[]'),
        selectedTaskTypes: JSON.parse(newTask.selected_task_types || '[]')
      }
    });
  } catch (error) {
    console.error('创建批量任务错误:', error);
    res.status(500).json({
      success: false,
      error: '创建批量任务失败'
    });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, runType, runTime, cronExpression, selectedAccountIds, selectedTaskTypes, enabled } = req.body;

    const existingTask = get(
      'SELECT * FROM batch_scheduled_tasks WHERE id = ? AND user_id = ?',
      [id, req.user.userId]
    );

    if (!existingTask) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    const updateFields = [];
    const updateValues = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (runType !== undefined) {
      updateFields.push('run_type = ?');
      updateValues.push(runType);
    }
    if (runTime !== undefined) {
      updateFields.push('run_time = ?');
      updateValues.push(runTime);
    }
    if (cronExpression !== undefined) {
      updateFields.push('cron_expression = ?');
      updateValues.push(cronExpression);
    }
    if (selectedAccountIds !== undefined) {
      updateFields.push('selected_account_ids = ?');
      updateValues.push(JSON.stringify(selectedAccountIds));
    }
    if (selectedTaskTypes !== undefined) {
      updateFields.push('selected_task_types = ?');
      updateValues.push(JSON.stringify(selectedTaskTypes));
    }
    if (enabled !== undefined) {
      updateFields.push('enabled = ?');
      updateValues.push(enabled ? 1 : 0);
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
      `UPDATE batch_scheduled_tasks SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    const updatedTask = get('SELECT * FROM batch_scheduled_tasks WHERE id = ?', [id]);

    unscheduleBatchTask(id);
    if (updatedTask.enabled) {
      scheduleBatchTask(updatedTask);
    }

    res.json({
      success: true,
      message: '批量任务更新成功',
      data: {
        ...updatedTask,
        enabled: !!updatedTask.enabled,
        selectedAccountIds: JSON.parse(updatedTask.selected_account_ids || '[]'),
        selectedTaskTypes: JSON.parse(updatedTask.selected_task_types || '[]')
      }
    });
  } catch (error) {
    console.error('更新批量任务错误:', error);
    res.status(500).json({
      success: false,
      error: '更新批量任务失败'
    });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const task = get(
      'SELECT id FROM batch_scheduled_tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    unscheduleBatchTask(req.params.id);
    run('DELETE FROM batch_scheduled_tasks WHERE id = ?', [req.params.id]);

    res.json({
      success: true,
      message: '批量任务删除成功'
    });
  } catch (error) {
    console.error('删除批量任务错误:', error);
    res.status(500).json({
      success: false,
      error: '删除批量任务失败'
    });
  }
});

router.post('/:id/execute', async (req, res) => {
  try {
    const task = get(
      'SELECT * FROM batch_scheduled_tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    executeBatchTask(task).catch(err => {
      console.error('执行批量任务错误:', err);
    });

    res.json({
      success: true,
      message: '批量任务已开始执行'
    });
  } catch (error) {
    console.error('执行批量任务错误:', error);
    res.status(500).json({
      success: false,
      error: '执行批量任务失败'
    });
  }
});

router.get('/:id/logs', (req, res) => {
  try {
    const { limit = 50 } = req.query;

    const task = get(
      'SELECT id FROM batch_scheduled_tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (!task) {
      return res.status(404).json({
        success: false,
        error: '任务不存在'
      });
    }

    const logs = all(
      `SELECT btl.*, ga.name as account_name 
       FROM batch_task_logs btl 
       LEFT JOIN game_accounts ga ON btl.account_id = ga.id
       WHERE btl.batch_task_id = ? 
       ORDER BY btl.created_at DESC 
       LIMIT ?`,
      [req.params.id, parseInt(limit)]
    );

    res.json({
      success: true,
      data: logs
    });
  } catch (error) {
    console.error('获取批量任务日志错误:', error);
    res.status(500).json({
      success: false,
      error: '获取批量任务日志失败'
    });
  }
});

export function getEnabledBatchTasksForScheduler() {
  return all(
    `SELECT bst.*, u.username 
     FROM batch_scheduled_tasks bst
     JOIN users u ON bst.user_id = u.id
     WHERE bst.enabled = 1`
  );
}

export function updateBatchTaskRunTime(taskId, lastRunAt, nextRunAt) {
  run(
    'UPDATE batch_scheduled_tasks SET last_run_at = ?, next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [lastRunAt, nextRunAt, taskId]
  );
}

export async function updateBatchTaskRunTimesBatch(updates = []) {
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
      'UPDATE batch_scheduled_tasks SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [item.nextRunAt, item.taskId]
    );
  });
  await saveDatabase();
  return normalized.length;
}

const BATCH_TASK_LOG_DETAILS_MAX_LENGTH = 1000;

function normalizeBatchTaskLogDetails(status, details) {
  if (details === null || details === undefined || details === '') {
    return null;
  }

  if (status === 'success' || status === 'info') {
    return null;
  }

  const raw = typeof details === 'string' ? details : JSON.stringify(details);
  if (!raw) {
    return null;
  }

  if (raw.length <= BATCH_TASK_LOG_DETAILS_MAX_LENGTH) {
    return raw;
  }

  const omitted = raw.length - BATCH_TASK_LOG_DETAILS_MAX_LENGTH;
  return `${raw.slice(0, BATCH_TASK_LOG_DETAILS_MAX_LENGTH)}...[已截断${omitted}字符]`;
}

export function addBatchTaskLogEntry(batchTaskId, accountId, taskType, status, message, details = null) {
  run(
    'INSERT INTO batch_task_logs (batch_task_id, account_id, task_type, status, message, details) VALUES (?, ?, ?, ?, ?, ?)',
    [batchTaskId, accountId, taskType, status, message, normalizeBatchTaskLogDetails(status, details)]
  );
  cleanupBatchTaskLogs(undefined, batchTaskId);
}

export default router;
