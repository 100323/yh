import { Router } from 'express';
import { get, all } from '../database/index.js';
import { authMiddleware } from '../middleware/auth.js';
import { getScheduledJobs, getActiveConnections } from '../scheduler/index.js';
import { getScheduledBatchJobs, getActiveBatchConnections } from '../batchScheduler/index.js';
import { getAccountTaskCoordinatorStatus } from '../utils/accountTaskCoordinator.js';
import { getNextRunAt, resolveBatchCronExpression, isNextRunPendingToday } from '../utils/cronSchedule.js';

const router = Router();

router.use(authMiddleware);

const BENIGN_FAILURE_KEYWORDS = [
  '模块未开启',
  '活动未开放',
  '不在开启时间内',
  '出了点小问题',
  '扫荡条件不满足',
  '已经选择过上阵武将了',
  '今日已领取免费奖励',
  '今天已经签到过了',
];
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

function buildIgnoredFailureCondition(alias) {
  const messageExpr = `COALESCE(${alias}.message, '')`;
  const detailsExpr = `COALESCE(${alias}.details, '')`;
  const keywordConditions = BENIGN_FAILURE_KEYWORDS
    .map((keyword) => `(${messageExpr} LIKE '%${keyword}%' OR ${detailsExpr} LIKE '%${keyword}%')`)
    .join(' OR ');

  return `(${alias}.status = 'ignored' OR (${alias}.status = 'error' AND (${keywordConditions})))`;
}

function formatSqliteUtcDateTime(date) {
  return new Date(date.getTime()).toISOString().slice(0, 19).replace('T', ' ');
}

function getShanghaiTodayUtcRange(now = new Date()) {
  const shanghaiNow = new Date(now.getTime() + SHANGHAI_UTC_OFFSET_MS);
  const startUtcMs = Date.UTC(
    shanghaiNow.getUTCFullYear(),
    shanghaiNow.getUTCMonth(),
    shanghaiNow.getUTCDate(),
    0,
    0,
    0,
    0,
  ) - SHANGHAI_UTC_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;

  return {
    start: formatSqliteUtcDateTime(new Date(startUtcMs)),
    end: formatSqliteUtcDateTime(new Date(endUtcMs)),
  };
}

router.get('/overview', (req, res) => {
  try {
    const userId = req.user.userId;
    const ignoredFailureConditionSingle = buildIgnoredFailureCondition('tl');
    const ignoredFailureConditionBatch = buildIgnoredFailureCondition('btl');

    const accountCount = get(
      'SELECT COUNT(*) as count FROM game_accounts WHERE user_id = ?',
      [userId]
    );

    const enabledSingleTaskCount = get(
      `SELECT COUNT(*) as count
       FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE ga.user_id = ? AND tc.enabled = 1`,
      [userId]
    );

    const enabledBatchTaskCount = get(
      `SELECT COUNT(*) as count
       FROM batch_scheduled_tasks
       WHERE user_id = ? AND enabled = 1`,
      [userId]
    );

    const todayRange = getShanghaiTodayUtcRange();
    const todaySingleLogCount = get(
      `SELECT COUNT(*) as count
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? AND tl.created_at >= ? AND tl.created_at < ?`,
      [userId, todayRange.start, todayRange.end]
    );

    const todayBatchLogCount = get(
      `SELECT COUNT(*) as count
       FROM batch_task_logs btl
       JOIN batch_scheduled_tasks bst ON btl.batch_task_id = bst.id
       WHERE bst.user_id = ? AND btl.created_at >= ? AND btl.created_at < ?`,
      [userId, todayRange.start, todayRange.end]
    );

    const enabledSingleTasks = all(
      `SELECT tc.cron_expression, tc.next_run_at
       FROM task_configs tc 
       JOIN game_accounts ga ON tc.account_id = ga.id 
       WHERE ga.user_id = ? AND tc.enabled = 1`,
      [userId]
    );

    const enabledBatchTasks = all(
      `SELECT run_type, run_time, cron_expression, next_run_at
       FROM batch_scheduled_tasks
       WHERE user_id = ? AND enabled = 1`,
      [userId]
    );

    const pendingSingleTaskCount = enabledSingleTasks.filter((task) =>
      isNextRunPendingToday(getNextRunAt(task.cron_expression, task.next_run_at), 'Asia/Shanghai')
    ).length;

    const pendingBatchTaskCount = enabledBatchTasks.filter((task) =>
      isNextRunPendingToday(getNextRunAt(resolveBatchCronExpression(task), task.next_run_at), 'Asia/Shanghai')
    ).length;

    const failedSingleTaskCount = get(
      `SELECT COUNT(*) as count
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? AND tl.status = 'error' AND tl.created_at >= ? AND tl.created_at < ? AND NOT ${ignoredFailureConditionSingle}`,
      [userId, todayRange.start, todayRange.end]
    );

    const failedBatchTaskCount = get(
      `SELECT COUNT(*) as count
       FROM batch_task_logs btl
       JOIN batch_scheduled_tasks bst ON btl.batch_task_id = bst.id
       WHERE bst.user_id = ? AND btl.status = 'error' AND btl.created_at >= ? AND btl.created_at < ? AND NOT ${ignoredFailureConditionBatch}`,
      [userId, todayRange.start, todayRange.end]
    );

    const successSingleTaskCount = get(
      `SELECT COUNT(*) as count
       FROM task_logs tl 
       JOIN game_accounts ga ON tl.account_id = ga.id 
       WHERE ga.user_id = ? AND tl.status = 'success' AND tl.created_at >= ? AND tl.created_at < ?`,
      [userId, todayRange.start, todayRange.end]
    );

    const successBatchTaskCount = get(
      `SELECT COUNT(*) as count
       FROM batch_task_logs btl
       JOIN batch_scheduled_tasks bst ON btl.batch_task_id = bst.id
       WHERE bst.user_id = ? AND btl.status = 'success' AND btl.created_at >= ? AND btl.created_at < ?`,
      [userId, todayRange.start, todayRange.end]
    );

    res.json({
      success: true,
      data: {
        accountCount: accountCount?.count || 0,
        enabledTaskCount: (enabledSingleTaskCount?.count || 0) + (enabledBatchTaskCount?.count || 0),
        todayLogCount: (todaySingleLogCount?.count || 0) + (todayBatchLogCount?.count || 0),
        pendingTaskCount: pendingSingleTaskCount + pendingBatchTaskCount,
        failedTaskCount: (failedSingleTaskCount?.count || 0) + (failedBatchTaskCount?.count || 0),
        successTaskCount: (successSingleTaskCount?.count || 0) + (successBatchTaskCount?.count || 0)
      }
    });
  } catch (error) {
    console.error('获取统计概览错误:', error);
    res.status(500).json({
      success: false,
      error: '获取统计概览失败'
    });
  }
});

router.get('/system-status', (req, res) => {
  try {
    const scheduledJobs = getScheduledJobs();
    const scheduledBatchJobs = getScheduledBatchJobs();
    const activeConnections = getActiveConnections();
    const activeBatchConnections = getActiveBatchConnections();
    const coordinatorStatus = getAccountTaskCoordinatorStatus();

    const combinedConnectionIds = new Set([
      ...Array.from(activeConnections.keys()).map((id) => String(id)),
      ...Array.from(activeBatchConnections.keys()).map((id) => String(id)),
    ]);

    const schedulerStatus = {
      status: 'running',
      totalJobs: scheduledJobs.size + scheduledBatchJobs.size,
      activeConnections: combinedConnectionIds.size,
      accountConcurrency: coordinatorStatus,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage()
    };

    const serviceStatus = {
      database: 'connected',
      scheduler: (scheduledJobs.size + scheduledBatchJobs.size) > 0 ? 'active' : 'idle',
      websocket: combinedConnectionIds.size > 0 ? 'connected' : 'disconnected'
    };

    const jobs = [];
    for (const [key, job] of scheduledJobs) {
      const [accountId, taskType] = key.split('_');
      jobs.push({
        accountId: parseInt(accountId),
        taskType,
        status: 'scheduled',
        source: 'single'
      });
    }

    for (const [taskId, job] of scheduledBatchJobs) {
      jobs.push({
        taskId: Number(taskId),
        taskType: 'BATCH_TASK',
        status: 'scheduled',
        source: 'batch',
        nextRun: job?.nextRun || null
      });
    }

    const connections = [];
    for (const [accountId, client] of activeConnections) {
      connections.push({
        accountId,
        status: client?.isSocketOpen?.() ? 'connected' : 'disconnected',
        readyState: client?.getConnectionStateSummary?.()?.readyState || null,
      });
    }

    res.json({
      success: true,
      data: {
        scheduler: schedulerStatus,
        service: serviceStatus,
        jobs,
        connections,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('获取系统状态错误:', error);
    res.status(500).json({
      success: false,
      error: '获取系统状态失败'
    });
  }
});

router.get('/task-summary', (req, res) => {
  try {
    const userId = req.user.userId;
    const { days = 7 } = req.query;
    const ignoredFailureConditionSingle = buildIgnoredFailureCondition('tl');

    const taskSummary = all(
      `SELECT 
        tl.task_type,
        COUNT(*) as total_count,
        SUM(CASE WHEN tl.status = 'success' THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN tl.status = 'error' AND NOT ${ignoredFailureConditionSingle} THEN 1 ELSE 0 END) as error_count,
        MAX(tl.created_at) as last_run
       FROM task_logs tl
       JOIN game_accounts ga ON tl.account_id = ga.id
       WHERE ga.user_id = ? AND tl.created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY tl.task_type
       ORDER BY total_count DESC`,
      [userId, days]
    );

    res.json({
      success: true,
      data: taskSummary
    });
  } catch (error) {
    console.error('获取任务摘要错误:', error);
    res.status(500).json({
      success: false,
      error: '获取任务摘要失败'
    });
  }
});

router.get('/recent-activities', (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 10 } = req.query;

    const activities = all(
      `SELECT 
        tl.*,
        ga.name as account_name
       FROM task_logs tl
       JOIN game_accounts ga ON tl.account_id = ga.id
       WHERE ga.user_id = ?
       ORDER BY tl.created_at DESC
       LIMIT ?`,
      [userId, parseInt(limit)]
    );

    res.json({
      success: true,
      data: activities
    });
  } catch (error) {
    console.error('获取最近活动错误:', error);
    res.status(500).json({
      success: false,
      error: '获取最近活动失败'
    });
  }
});

export default router;
