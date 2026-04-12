import { randomUUID } from 'crypto';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabasePathDiagnostics, runDatabaseMaintenance, runDatabaseVacuum } from './database/index.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import taskRoutes from './routes/tasks.js';
import logRoutes from './routes/logs.js';
import weixinRoutes from './routes/weixin.js';
import statsRoutes from './routes/stats.js';
import batchSchedulerRoutes from './routes/batchScheduler.js';
import batchSettingsRoutes from './routes/batchSettings.js';
import inviteCodeRoutes from './routes/inviteCodes.js';
import adminUsersRoutes from './routes/adminUsers.js';
import { initScheduler, executeTask, stopScheduler } from './scheduler/index.js';
import { initBatchScheduler, stopBatchScheduler } from './batchScheduler/index.js';
import { authMiddleware } from './middleware/auth.js';
import { get } from './database/index.js';
import { decrypt } from './utils/crypto.js';
import config from './config/index.js';
import { preloadStudyQuestionBank } from './utils/studyQuestions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
let serverInstance = null;
let isShuttingDown = false;
let databaseMaintenanceJob = null;
let databaseVacuumJob = null;
const DATABASE_MAINTENANCE_CRON = '35 3 * * *';
const DATABASE_VACUUM_CRON = '10 4 * * 0';

const startupState = {
  startedAt: new Date().toISOString(),
  database: {
    status: 'pending',
    lastError: null,
    pathDiagnostics: null,
  },
  scheduler: {
    status: 'pending',
    attempts: 0,
    lastError: null,
  },
  batchScheduler: {
    status: 'pending',
    attempts: 0,
    lastError: null,
  },
  databaseMaintenance: {
    status: 'pending',
    lastRunAt: null,
    lastError: null,
  },
  databaseVacuum: {
    status: 'pending',
    lastRunAt: null,
    lastError: null,
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function getHealthStatusCode() {
  if (startupState.database.status === 'failed') {
    return 503;
  }

  return 200;
}

app.use(cors());
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((req, res, next) => {
  const headerRequestId = req.headers['x-request-id'];
  const requestId = typeof headerRequestId === 'string' && headerRequestId.trim()
    ? headerRequestId.trim()
    : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/weixin', weixinRoutes);
app.use('/api/hortor', weixinRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/batch-scheduler', batchSchedulerRoutes);
app.use('/api/batch-settings', batchSettingsRoutes);
app.use('/api/invite-codes', inviteCodeRoutes);
app.use('/api/admin/users', adminUsersRoutes);

app.get('/api/health', (req, res) => {
  res.status(getHealthStatusCode()).json({
    status: startupState.database.status === 'ready' ? 'ok' : 'starting',
    timestamp: new Date().toISOString(),
    services: {
      database: startupState.database,
      scheduler: startupState.scheduler,
      batchScheduler: startupState.batchScheduler,
    }
  });
});

app.post('/api/tasks/execute', authMiddleware, async (req, res) => {
  try {
    const { accountId, taskType } = req.body;
    
    if (!accountId || !taskType) {
      return res.status(400).json({
        success: false,
        error: '缺少必要参数'
      });
    }

    const account = get(
      'SELECT * FROM game_accounts WHERE id = ? AND user_id = ?',
      [accountId, req.user.userId]
    );
    
    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    const token = decrypt(account.token_encrypted, account.token_iv);
    
    const result = await executeTask({
      ...account,
      token,
      task_type: taskType
    });
    
    res.json({
      success: true,
      message: '任务执行成功',
      data: result
    });
  } catch (error) {
    console.error('手动执行任务错误:', error);
    res.status(500).json({
      success: false,
      error: error.message || '任务执行失败'
    });
  }
});

const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({
    success: false,
    error: '服务器内部错误'
  });
});

async function initializeBackgroundService(serviceName, stateKey, initFn, stopFn, options = {}) {
  const {
    maxRetries = 3,
    retryDelayMs = 5000,
  } = options;

  startupState[stateKey].status = 'starting';
  startupState[stateKey].lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    startupState[stateKey].attempts = attempt;
    const startedAt = Date.now();

    try {
      if (attempt > 1) {
        try {
          stopFn?.();
        } catch (stopError) {
          console.warn(`⚠️ ${serviceName} 重试前清理失败`, stopError?.message || stopError);
        }
      }

      console.log(`⏳开始初始化${serviceName}（第 ${attempt}/${maxRetries} 次）...`);
      await initFn();
      startupState[stateKey].status = 'ready';
      startupState[stateKey].lastError = null;
      console.log(`✅${serviceName} 初始化完成，用时 ${Date.now() - startedAt}ms`);
      return true;
    } catch (error) {
      startupState[stateKey].status = 'failed';
      startupState[stateKey].lastError = error?.message || String(error);
      console.error(`❌${serviceName} 初始化失败（第 ${attempt}/${maxRetries} 次）:`, error);
      if (attempt < maxRetries) {
        await sleep(retryDelayMs);
      }
    }
  }

  console.error(`❌${serviceName} 多次初始化失败，服务继续提供 API，但该模块当前不可用`);
  return false;
}

async function initializeBackgroundServices() {
  await initializeBackgroundService('定时任务调度器', 'scheduler', initScheduler, stopScheduler, {
    maxRetries: 3,
    retryDelayMs: 5000,
  });

  await initializeBackgroundService('批量任务调度器', 'batchScheduler', initBatchScheduler, stopBatchScheduler, {
    maxRetries: 3,
    retryDelayMs: 5000,
  });
}

async function runDatabaseMaintenanceTask(trigger = 'scheduled') {
  const startedAt = Date.now();
  startupState.databaseMaintenance.status = 'running';
  startupState.databaseMaintenance.lastError = null;

  try {
    await runDatabaseMaintenance();
    startupState.databaseMaintenance.status = 'ready';
    startupState.databaseMaintenance.lastRunAt = new Date().toISOString();
    console.log(`🧹 数据库日志清理完成(${trigger})，用时 ${Date.now() - startedAt}ms`);
  } catch (error) {
    startupState.databaseMaintenance.status = 'failed';
    startupState.databaseMaintenance.lastError = error?.message || String(error);
    console.error(`❌数据库日志清理失败(${trigger}):`, error);
  }
}

function initDatabaseMaintenanceJob() {
  if (databaseMaintenanceJob) {
    databaseMaintenanceJob.stop();
    databaseMaintenanceJob = null;
  }
  if (databaseVacuumJob) {
    databaseVacuumJob.stop();
    databaseVacuumJob = null;
  }

  startupState.databaseMaintenance.status = 'ready';
  startupState.databaseMaintenance.lastError = null;
  databaseMaintenanceJob = cron.schedule(DATABASE_MAINTENANCE_CRON, async () => {
    await runDatabaseMaintenanceTask('scheduled');
  }, {
    timezone: config.cron.timezone,
  });
  startupState.databaseVacuum.status = 'ready';
  startupState.databaseVacuum.lastError = null;
  databaseVacuumJob = cron.schedule(DATABASE_VACUUM_CRON, async () => {
    const startedAt = Date.now();
    startupState.databaseVacuum.status = 'running';
    startupState.databaseVacuum.lastError = null;

    try {
      await runDatabaseVacuum();
      startupState.databaseVacuum.status = 'ready';
      startupState.databaseVacuum.lastRunAt = new Date().toISOString();
      console.log(`🧼 数据库 VACUUM 完成，用时 ${Date.now() - startedAt}ms`);
    } catch (error) {
      startupState.databaseVacuum.status = 'failed';
      startupState.databaseVacuum.lastError = error?.message || String(error);
      console.error('❌数据库 VACUUM 失败:', error);
    }
  }, {
    timezone: config.cron.timezone,
  });
  console.log(`🧹 数据库日志清理已改为后台定时任务 (${DATABASE_MAINTENANCE_CRON}, ${config.cron.timezone})`);
  console.log(`🧼 数据库 VACUUM 已改为后台定时任务(${DATABASE_VACUUM_CRON}, ${config.cron.timezone})`);
}

function stopDatabaseMaintenanceJob() {
  if (databaseMaintenanceJob) {
    databaseMaintenanceJob.stop();
    databaseMaintenanceJob = null;
  }
  if (databaseVacuumJob) {
    databaseVacuumJob.stop();
    databaseVacuumJob = null;
  }
}

function logServerBootInfo() {
  console.log(`🚀 服务器运行在 http://${config.server.host}:${config.server.port}`);
  console.log('📝 API 文档:');
  console.log('   POST /api/auth/register - 用户注册');
  console.log('   POST /api/auth/login - 用户登录');
  console.log('   GET  /api/auth/me - 获取当前用户信息');
  console.log('   GET  /api/accounts - 获取账号列表');
  console.log('   POST /api/accounts - 添加账号');
  console.log('   GET  /api/tasks/types - 获取任务类型');
  console.log('   GET  /api/tasks/account/:id - 获取账号的任务配置');
  console.log('   POST /api/tasks/account/:id - 创建/更新任务配置');
  console.log('   GET  /api/logs - 获取执行日志');
  console.log('   GET  /api/batch-scheduler - 获取批量任务列表');
  console.log('   POST /api/batch-scheduler - 创建批量任务');
  console.log('ℹ️ 调度器会在端口监听成功后于后台初始化，避免启动阶段长时间阻塞导致 502');
  console.log('ℹ️ 数据库日志清理已改为后台定时任务，避免启动阶段执行全表清理');
  console.log('ℹ️ 数据库压缩（VACUUM）已移至每周后台维护，避免文件长期膨胀');
}

async function startServer() {
  try {
    startupState.database.status = 'starting';
    startupState.database.pathDiagnostics = getDatabasePathDiagnostics();
    await initDatabase();
    startupState.database.status = 'ready';
    startupState.database.lastError = null;
    startupState.database.pathDiagnostics = getDatabasePathDiagnostics();
    preloadStudyQuestionBank();
  } catch (error) {
    startupState.database.status = 'failed';
    startupState.database.lastError = error?.message || String(error);
    startupState.database.pathDiagnostics = getDatabasePathDiagnostics();
    console.error('启动服务器失败（数据库初始化）:', error);
    process.exit(1);
  }

  serverInstance = app.listen(config.server.port, config.server.host, () => {
    logServerBootInfo();
    initDatabaseMaintenanceJob();
    setImmediate(() => {
      void initializeBackgroundServices();
    });
  });

  serverInstance.on('error', (error) => {
    console.error('启动服务器失败（监听端口）:', error);
    process.exit(1);
  });
}

startServer();

async function shutdownServer(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log('\n正在关闭服务器...');
  try {
    stopScheduler();
    stopBatchScheduler();
    stopDatabaseMaintenanceJob();
    await new Promise((resolve) => {
      serverInstance?.close?.(() => resolve());
      if (!serverInstance) {
        resolve();
      }
    });
    await closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error(`关闭服务器失败（${signal}）:`, error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdownServer('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdownServer('SIGTERM');
});

