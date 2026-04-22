import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');
const configuredDbPath = String(config.database.path || './data/xyzw.db').trim();
const dbPath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(backendRoot, configuredDbPath);

let rawDb = null;
let db = null;

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  max_game_accounts INTEGER DEFAULT 5,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);

CREATE TABLE IF NOT EXISTS game_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  token_encrypted TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  token_refreshed_at DATETIME,
  bin_encrypted TEXT,
  bin_iv TEXT,
  bin_updated_at DATETIME,
  launch_context_encrypted TEXT,
  launch_context_iv TEXT,
  launch_context_updated_at DATETIME,
  ws_url TEXT,
  server TEXT,
  remark TEXT,
  avatar TEXT,
  status TEXT DEFAULT 'active',
  import_method TEXT DEFAULT 'manual',
  source_url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  enabled INTEGER DEFAULT 0,
  cron_expression TEXT,
  cron_is_customized INTEGER,
  default_cron_version INTEGER,
  config_json TEXT,
  last_run_at DATETIME,
  next_run_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_execution_markers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  business_date TEXT NOT NULL,
  latest_status TEXT NOT NULL,
  latest_message TEXT,
  latest_details TEXT,
  executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, task_type, business_date)
);

CREATE TABLE IF NOT EXISTS task_config_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT,
  account_id INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  source TEXT,
  task_type TEXT,
  baseline_revision TEXT,
  before_revision TEXT,
  after_revision TEXT,
  payload_json TEXT,
  summary_json TEXT,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ws_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  status TEXT DEFAULT 'disconnected',
  connected_at DATETIME,
  last_message_at DATETIME,
  error_message TEXT,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batch_scheduled_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  run_type TEXT NOT NULL DEFAULT 'daily',
  run_time TEXT,
  cron_expression TEXT,
  selected_account_ids TEXT NOT NULL,
  selected_task_types TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_run_at DATETIME,
  next_run_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batch_task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_task_id INTEGER NOT NULL,
  account_id INTEGER,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_task_id) REFERENCES batch_scheduled_tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_batch_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  template_id INTEGER,
  settings_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS batch_task_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  settings_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  lineup_key TEXT NOT NULL,
  name TEXT NOT NULL,
  team_id INTEGER NOT NULL DEFAULT 1,
  saved_at INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE,
  UNIQUE (account_id, lineup_key)
);

CREATE TABLE IF NOT EXISTS invite_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  max_uses INTEGER DEFAULT 1,
  used_count INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_game_accounts_user ON game_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_task_configs_account ON task_configs(account_id);
CREATE INDEX IF NOT EXISTS idx_task_logs_account ON task_logs(account_id);
CREATE INDEX IF NOT EXISTS idx_task_logs_created ON task_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_task_execution_markers_account_date ON task_execution_markers(account_id, business_date);
CREATE INDEX IF NOT EXISTS idx_task_execution_markers_date ON task_execution_markers(business_date);
CREATE INDEX IF NOT EXISTS idx_task_config_audit_logs_account_created ON task_config_audit_logs(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_config_audit_logs_request ON task_config_audit_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_batch_scheduled_tasks_user ON batch_scheduled_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_batch_task_logs_task ON batch_task_logs(batch_task_id);
CREATE INDEX IF NOT EXISTS idx_account_batch_settings_account ON account_batch_settings(account_id);
CREATE INDEX IF NOT EXISTS idx_batch_task_templates_user ON batch_task_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_account_lineups_account ON account_lineups(account_id);
CREATE INDEX IF NOT EXISTS idx_account_lineups_account_team ON account_lineups(account_id, team_id);
`;

const TASK_LOG_RETENTION_DAYS = 30;
const TASK_LOG_MAX_PER_ACCOUNT = 50;
const BATCH_LOG_MAX_PER_TASK = 2000;
const TASK_CONFIG_AUDIT_RETENTION_DAYS = 90;
const TASK_CONFIG_AUDIT_MAX_PER_ACCOUNT = 500;

function normalizeParams(params = []) {
  if (Array.isArray(params)) return params;
  if (params === undefined || params === null) return [];
  return [params];
}

function isPathInside(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeStringify(value) {
  if (value === undefined) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ serializationError: error?.message || String(error) });
  }
}

export function getDatabasePathDiagnostics() {
  const parentDir = path.dirname(dbPath);
  const exists = fs.existsSync(dbPath);
  const parentExists = fs.existsSync(parentDir);
  let parentWritable = false;
  let fileSize = 0;

  try {
    if (parentExists) {
      fs.accessSync(parentDir, fs.constants.R_OK | fs.constants.W_OK);
      parentWritable = true;
    }
  } catch {
    parentWritable = false;
  }

  try {
    if (exists) {
      fileSize = Number(fs.statSync(dbPath)?.size || 0);
    }
  } catch {
    fileSize = 0;
  }

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    configuredDbPath,
    explicitDbPath: Boolean(String(process.env.DB_PATH || '').trim()),
    resolvedDbPath: dbPath,
    parentDir,
    parentExists,
    parentWritable,
    exists,
    fileSize,
    isInsideBackendRoot: isPathInside(backendRoot, dbPath),
    backendRoot,
  };
}

function validateDatabasePathOrThrow(diagnostics = getDatabasePathDiagnostics()) {
  const isProduction = diagnostics.nodeEnv === 'production';
  const allowProjectLocalDb = String(process.env.ALLOW_PROJECT_LOCAL_DB_PATH || '').trim() === '1';
  const allowDbCreate = String(process.env.ALLOW_DB_CREATE || '').trim() === '1';

  console.log('🗃️ 数据库路径诊断', {
    nodeEnv: diagnostics.nodeEnv,
    configuredDbPath: diagnostics.configuredDbPath,
    resolvedDbPath: diagnostics.resolvedDbPath,
    parentDir: diagnostics.parentDir,
    parentExists: diagnostics.parentExists,
    parentWritable: diagnostics.parentWritable,
    exists: diagnostics.exists,
    fileSize: diagnostics.fileSize,
    isInsideBackendRoot: diagnostics.isInsideBackendRoot,
    explicitDbPath: diagnostics.explicitDbPath,
  });

  if (isProduction && !diagnostics.explicitDbPath) {
    throw new Error('[database] DB_PATH must be explicitly set when NODE_ENV=production');
  }

  if (isProduction && diagnostics.isInsideBackendRoot && !allowProjectLocalDb) {
    throw new Error(`[database] resolved DB_PATH points inside the project directory (${diagnostics.resolvedDbPath}). This is risky during deployments. Move it to a persistent mount or set ALLOW_PROJECT_LOCAL_DB_PATH=1 only if you are sure.`);
  }

  if (!diagnostics.parentExists) {
    if (isProduction && !allowDbCreate) {
      throw new Error(`[database] parent directory does not exist: ${diagnostics.parentDir}. In production you must pre-create/mount it, or set ALLOW_DB_CREATE=1 for first-time initialization.`);
    }
    return diagnostics;
  }

  if (!diagnostics.parentWritable) {
    throw new Error(`[database] parent directory is not writable: ${diagnostics.parentDir}`);
  }

  if (isProduction && !diagnostics.exists && !allowDbCreate) {
    throw new Error(`[database] sqlite file does not exist yet: ${diagnostics.resolvedDbPath}. Pre-create/mount it, or set ALLOW_DB_CREATE=1 for first-time initialization.`);
  }

  return diagnostics;
}

function runStatement(database, sql, params = []) {
  const stmt = database.prepare(sql);
  return stmt.run(...normalizeParams(params));
}

function getStatement(database, sql, params = []) {
  const stmt = database.prepare(sql);
  return stmt.get(...normalizeParams(params)) ?? null;
}

function allStatement(database, sql, params = []) {
  const stmt = database.prepare(sql);
  return stmt.all(...normalizeParams(params));
}

function getShanghaiBusinessDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function createDatabaseAdapter(database) {
  return {
    run(sql, params = []) {
      return runStatement(database, sql, params);
    },
    get(sql, params = []) {
      return getStatement(database, sql, params);
    },
    all(sql, params = []) {
      return allStatement(database, sql, params);
    },
    transaction(fn) {
      return database.transaction(fn);
    },
  };
}

function getTableColumns(tableName) {
  return new Set(
    rawDb
      .prepare(`PRAGMA table_info('${tableName}')`)
      .all()
      .map((row) => String(row?.name || '').toLowerCase())
      .filter(Boolean),
  );
}

export async function initDatabase() {
  if (rawDb) return db;

  const startedAt = Date.now();
  let dirty = false;
  const pathDiagnostics = validateDatabasePathOrThrow();
  const fileExists = pathDiagnostics.exists;

  console.log('🗃️ initDatabase[1/5] 检查数据目录...');
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    dirty = true;
  }

  console.log('🗃️ initDatabase[2/5] 打开 SQLite 数据库...', {
    dbPath,
    exists: fileExists,
  });
  rawDb = new Database(dbPath);
  rawDb.pragma('foreign_keys = ON');
  rawDb.pragma('busy_timeout = 5000');
  db = createDatabaseAdapter(rawDb);

  console.log('🗃️ initDatabase[3/5] 应用基础 schema...');
  rawDb.exec(schema);
  if (!fileExists) {
    dirty = true;
  }

  console.log('🗃️ initDatabase[4/5] 检查并补齐表结构...');
  dirty = ensureUsersSchema() || dirty;
  dirty = ensureGameAccountSchema() || dirty;
  dirty = ensureTaskConfigSchema() || dirty;
  dirty = ensureTaskExecutionMarkerSchema() || dirty;
  dirty = ensureSystemSettingsSchema() || dirty;

  console.log('🗃️ initDatabase[5/5] 执行数据规范化...');
  const normalizeResult = normalizeGameAccounts();
  dirty = normalizeResult.changed || dirty;
  dirty = backfillTaskExecutionMarkersIfNeeded() || dirty;

  if (dirty) {
    console.log('💾 initDatabase 检测到结构/数据变更，better-sqlite3 已实时持久化，无需额外导出保存');
  } else {
    console.log('🪶 initDatabase 未检测到结构/数据变更，跳过保存');
  }

  console.log(`✅ 数据库初始化完成: ${dbPath}（用时 ${Date.now() - startedAt}ms）`);
  return db;
}

function ensureUsersSchema() {
  let changed = false;
  try {
    const columns = getTableColumns('users');

    if (!columns.has('is_enabled')) {
      rawDb.exec('ALTER TABLE users ADD COLUMN is_enabled INTEGER DEFAULT 1');
      rawDb.exec('UPDATE users SET is_enabled = 1 WHERE is_enabled IS NULL');
      changed = true;
    }

    if (!columns.has('access_start_at')) {
      rawDb.exec('ALTER TABLE users ADD COLUMN access_start_at DATETIME');
      changed = true;
    }

    if (!columns.has('access_end_at')) {
      rawDb.exec('ALTER TABLE users ADD COLUMN access_end_at DATETIME');
      changed = true;
    }

    if (!columns.has('max_game_accounts')) {
      rawDb.exec('ALTER TABLE users ADD COLUMN max_game_accounts INTEGER DEFAULT 5');
      rawDb.exec('UPDATE users SET max_game_accounts = 5 WHERE max_game_accounts IS NULL');
      changed = true;
    }
  } catch (error) {
    console.warn('⚠️ 检查 users 表结构失败:', error?.message || error);
  }
  return changed;
}

function ensureGameAccountSchema() {
  let changed = false;
  try {
    const columns = getTableColumns('game_accounts');
    if (!columns.has('ws_url')) {
      rawDb.exec('ALTER TABLE game_accounts ADD COLUMN ws_url TEXT');
      changed = true;
    }
    if (!columns.has('bin_encrypted')) {
      rawDb.exec('ALTER TABLE game_accounts ADD COLUMN bin_encrypted TEXT');
      changed = true;
    }
    if (!columns.has('token_refreshed_at')) {
      rawDb.exec('ALTER TABLE game_accounts ADD COLUMN token_refreshed_at DATETIME');
      changed = true;
    }
    if (!columns.has('bin_iv')) {
      rawDb.exec('ALTER TABLE game_accounts ADD COLUMN bin_iv TEXT');
      changed = true;
    }
    if (!columns.has('bin_updated_at')) {
      rawDb.exec('ALTER TABLE game_accounts ADD COLUMN bin_updated_at DATETIME');
      changed = true;
    }
    if (!columns.has('launch_context_encrypted')) {
      rawDb.exec('ALTER TABLE game_accounts ADD COLUMN launch_context_encrypted TEXT');
      changed = true;
    }
    if (!columns.has('launch_context_iv')) {
      rawDb.exec('ALTER TABLE game_accounts ADD COLUMN launch_context_iv TEXT');
      changed = true;
    }
    if (!columns.has('launch_context_updated_at')) {
      rawDb.exec('ALTER TABLE game_accounts ADD COLUMN launch_context_updated_at DATETIME');
      changed = true;
    }
  } catch (error) {
    console.warn('⚠️ 检查 game_accounts 表结构失败:', error?.message || error);
  }
  return changed;
}

function ensureTaskConfigSchema() {
  let changed = false;
  try {
    const columns = getTableColumns('task_configs');

    if (!columns.has('cron_is_customized')) {
      rawDb.exec('ALTER TABLE task_configs ADD COLUMN cron_is_customized INTEGER');
      changed = true;
    }

    if (!columns.has('default_cron_version')) {
      rawDb.exec('ALTER TABLE task_configs ADD COLUMN default_cron_version INTEGER');
      changed = true;
    }
  } catch (error) {
    console.warn('⚠️ 检查 task_configs 表结构失败:', error?.message || error);
  }
  return changed;
}

function ensureTaskExecutionMarkerSchema() {
  let changed = false;
  try {
    rawDb.exec(`CREATE TABLE IF NOT EXISTS task_execution_markers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      business_date TEXT NOT NULL,
      latest_status TEXT NOT NULL,
      latest_message TEXT,
      latest_details TEXT,
      executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES game_accounts(id) ON DELETE CASCADE,
      UNIQUE (account_id, task_type, business_date)
    )`);
    rawDb.exec('CREATE INDEX IF NOT EXISTS idx_task_execution_markers_account_date ON task_execution_markers(account_id, business_date)');
    rawDb.exec('CREATE INDEX IF NOT EXISTS idx_task_execution_markers_date ON task_execution_markers(business_date)');
  } catch (error) {
    console.warn('⚠️ 检查 task_execution_markers 表结构失败:', error?.message || error);
  }
  return changed;
}

function backfillTaskExecutionMarkersIfNeeded() {
  let changed = false;
  try {
    const markerCount = Number(
      getStatement(rawDb, 'SELECT COUNT(*) AS total FROM task_execution_markers')?.total || 0
    );
    if (markerCount > 0) {
      return false;
    }

    const rows = allStatement(
      rawDb,
      `SELECT account_id, task_type, status, message, details, created_at
         FROM task_logs
        WHERE created_at >= datetime('now', '-${TASK_LOG_RETENTION_DAYS} days')
        ORDER BY datetime(created_at) ASC, id ASC`
    );

    rows.forEach((row) => {
      upsertTaskExecutionMarker(rawDb, row.account_id, row.task_type, row.status, row.message, row.details, row.created_at);
    });

    changed = rows.length > 0;
  } catch (error) {
    console.warn('⚠️ 回填 task_execution_markers 失败:', error?.message || error);
  }
  return changed;
}

function ensureSystemSettingsSchema() {
  let changed = false;
  try {
    rawDb.exec(`CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    const existingSchedulerConcurrency = getStatement(
      rawDb,
      "SELECT value FROM system_settings WHERE key = 'scheduler_max_concurrent_accounts' LIMIT 1"
    );

    if (!existingSchedulerConcurrency) {
      const defaultValue = String(Number(config?.scheduler?.maxConcurrentAccounts) || 3);
      runStatement(
        rawDb,
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ('scheduler_max_concurrent_accounts', ?, CURRENT_TIMESTAMP)`,
        [defaultValue],
      );
      changed = true;
    }
  } catch (error) {
    console.warn('⚠️ 检查 system_settings 表结构失败:', error?.message || error);
  }
  return changed;
}

export function normalizeGameAccounts(targetDb = getDatabase()) {
  let changed = false;
  try {
    const duplicateGroups = all(
      `SELECT user_id, name, COUNT(*) AS total, GROUP_CONCAT(id) AS ids
       FROM game_accounts
       GROUP BY user_id, name
       HAVING COUNT(*) > 1`
    );

    duplicateGroups.forEach((group) => {
      const ids = String(group.ids || '')
        .split(',')
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
        .sort((a, b) => a - b);

      if (ids.length <= 1) {
        return;
      }

      changed = true;
      const keepId = ids[0];
      const duplicateIds = ids.slice(1);

      duplicateIds.forEach((duplicateId) => {
        targetDb.run('UPDATE task_configs SET account_id = ? WHERE account_id = ?', [keepId, duplicateId]);
        targetDb.run('UPDATE task_logs SET account_id = ? WHERE account_id = ?', [keepId, duplicateId]);
        targetDb.run('UPDATE batch_task_logs SET account_id = ? WHERE account_id = ?', [keepId, duplicateId]);

        const keepWsConnection = get('SELECT id FROM ws_connections WHERE account_id = ?', [keepId]);
        if (keepWsConnection) {
          targetDb.run('DELETE FROM ws_connections WHERE account_id = ?', [duplicateId]);
        } else {
          targetDb.run('UPDATE ws_connections SET account_id = ? WHERE account_id = ?', [keepId, duplicateId]);
        }

        targetDb.run('DELETE FROM game_accounts WHERE id = ?', [duplicateId]);
      });
    });

    targetDb.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_game_accounts_user_name_unique ON game_accounts(user_id, name)');
  } catch (error) {
    console.warn('⚠️ 规范化 game_accounts 数据失败:', error?.message || error);
  }
  return { changed };
}

export function cleanupTaskLogs(targetDb = getDatabase(), accountId = null) {
  try {
    targetDb.run(`DELETE FROM task_logs WHERE created_at < datetime('now', '-${TASK_LOG_RETENTION_DAYS} days')`);
    const accountRows = accountId
      ? [{ account_id: accountId }]
      : all('SELECT DISTINCT account_id FROM task_logs');

    accountRows.forEach((row) => {
      const normalizedAccountId = Number(row?.account_id || 0);
      if (!normalizedAccountId) return;
      targetDb.run(
        `DELETE FROM task_logs
         WHERE id IN (
           SELECT id FROM task_logs
           WHERE account_id = ?
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT -1 OFFSET ${TASK_LOG_MAX_PER_ACCOUNT}
         )`,
        [normalizedAccountId],
      );
    });
  } catch (error) {
    console.warn('⚠️ 清理 task_logs 失败:', error?.message || error);
  }
}

export function cleanupBatchTaskLogs(targetDb = getDatabase(), batchTaskId = null) {
  try {
    targetDb.run(`DELETE FROM batch_task_logs WHERE created_at < datetime('now', '-${TASK_LOG_RETENTION_DAYS} days')`);
    const taskRows = batchTaskId
      ? [{ batch_task_id: batchTaskId }]
      : all('SELECT DISTINCT batch_task_id FROM batch_task_logs');

    taskRows.forEach((row) => {
      const normalizedTaskId = Number(row?.batch_task_id || 0);
      if (!normalizedTaskId) return;
      targetDb.run(
        `DELETE FROM batch_task_logs
         WHERE id IN (
           SELECT id FROM batch_task_logs
           WHERE batch_task_id = ?
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT -1 OFFSET ${BATCH_LOG_MAX_PER_TASK}
         )`,
        [normalizedTaskId],
      );
    });
  } catch (error) {
    console.warn('⚠️ 清理 batch_task_logs 失败:', error?.message || error);
  }
}

export function addTaskConfigAuditLog(targetDb = rawDb, entry = {}) {
  const normalizedAccountId = Number(entry.accountId || 0);
  if (!normalizedAccountId) {
    return;
  }

  runStatement(
    targetDb,
    `INSERT INTO task_config_audit_logs (
       request_id,
       account_id,
       user_id,
       action,
       status,
       source,
       task_type,
       baseline_revision,
       before_revision,
       after_revision,
       payload_json,
       summary_json,
       error_message,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      entry.requestId ? String(entry.requestId) : null,
      normalizedAccountId,
      entry.userId ? Number(entry.userId) : null,
      String(entry.action || 'unknown'),
      String(entry.status || 'unknown'),
      entry.source ? String(entry.source) : null,
      entry.taskType ? String(entry.taskType) : null,
      entry.baselineRevision ? String(entry.baselineRevision) : null,
      entry.beforeRevision ? String(entry.beforeRevision) : null,
      entry.afterRevision ? String(entry.afterRevision) : null,
      safeStringify(entry.payload),
      safeStringify(entry.summary),
      entry.errorMessage ? String(entry.errorMessage) : null,
    ]
  );
}

export function cleanupTaskConfigAuditLogs(targetDb = getDatabase(), accountId = null) {
  try {
    targetDb.run(`DELETE FROM task_config_audit_logs WHERE created_at < datetime('now', '-${TASK_CONFIG_AUDIT_RETENTION_DAYS} days')`);
    const accountRows = accountId
      ? [{ account_id: accountId }]
      : all('SELECT DISTINCT account_id FROM task_config_audit_logs');

    accountRows.forEach((row) => {
      const normalizedAccountId = Number(row?.account_id || 0);
      if (!normalizedAccountId) return;
      targetDb.run(
        `DELETE FROM task_config_audit_logs
         WHERE id IN (
           SELECT id FROM task_config_audit_logs
           WHERE account_id = ?
           ORDER BY datetime(created_at) DESC, id DESC
           LIMIT -1 OFFSET ${TASK_CONFIG_AUDIT_MAX_PER_ACCOUNT}
         )`,
        [normalizedAccountId],
      );
    });
  } catch (error) {
    console.warn('⚠️ 清理 task_config_audit_logs 失败:', error?.message || error);
  }
}

export function upsertTaskExecutionMarker(targetDb = rawDb, accountId, taskType, status, message = null, details = null, executedAt = new Date()) {
  const normalizedAccountId = Number(accountId || 0);
  const normalizedTaskType = String(taskType || '').trim();
  const businessDate = getShanghaiBusinessDate(executedAt);
  if (!normalizedAccountId || !normalizedTaskType || !businessDate) {
    return;
  }

  const executedAtValue = executedAt instanceof Date
    ? executedAt.toISOString()
    : new Date(executedAt).toISOString();

  if (!executedAtValue || executedAtValue === 'Invalid Date') {
    return;
  }

  runStatement(
    targetDb,
    `INSERT INTO task_execution_markers (
       account_id,
       task_type,
       business_date,
       latest_status,
       latest_message,
       latest_details,
       executed_at,
       updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(account_id, task_type, business_date) DO UPDATE SET
       latest_status = excluded.latest_status,
       latest_message = excluded.latest_message,
       latest_details = excluded.latest_details,
       executed_at = excluded.executed_at,
       updated_at = CURRENT_TIMESTAMP
     WHERE datetime(excluded.executed_at) >= datetime(task_execution_markers.executed_at)`,
    [
      normalizedAccountId,
      normalizedTaskType,
      businessDate,
      String(status || 'unknown'),
      message ?? null,
      details ?? null,
      executedAtValue,
    ],
  );
}

export function cleanupTaskExecutionMarkers(targetDb = getDatabase()) {
  try {
    targetDb.run(
      `DELETE FROM task_execution_markers
       WHERE business_date < date('now', '+8 hours', '-${TASK_LOG_RETENTION_DAYS} days')`
    );
  } catch (error) {
    console.warn('⚠️ 清理 task_execution_markers 失败:', error?.message || error);
  }
}

export function cleanupLogTables(targetDb = getDatabase()) {
  cleanupTaskLogs(targetDb);
  cleanupBatchTaskLogs(targetDb);
  cleanupTaskExecutionMarkers(targetDb);
  cleanupTaskConfigAuditLogs(targetDb);
}

export async function runDatabaseMaintenance() {
  cleanupLogTables();
}

export async function runDatabaseVacuum() {
  rawDb.exec('VACUUM');
}

export async function saveDatabase() {
  return false;
}

export async function flushDatabaseWrites() {
  return false;
}

export function getDatabase() {
  if (!db) {
    throw new Error('数据库未初始化');
  }
  return db;
}

export async function closeDatabase() {
  if (rawDb) {
    rawDb.close();
    rawDb = null;
    db = null;
  }
}

export function run(sql, params = []) {
  const info = runStatement(rawDb, sql, params);
  return {
    changes: Number(info?.changes || 0),
    lastInsertRowid: info?.lastInsertRowid ?? null,
  };
}

export function get(sql, params = []) {
  return getStatement(rawDb, sql, params);
}

export function all(sql, params = []) {
  return allStatement(rawDb, sql, params);
}

export default {
  initDatabase,
  saveDatabase,
  flushDatabaseWrites,
  getDatabase,
  closeDatabase,
  getDatabasePathDiagnostics,
  run,
  get,
  all,
  normalizeGameAccounts,
  upsertTaskExecutionMarker,
  addTaskConfigAuditLog,
  cleanupTaskLogs,
  cleanupBatchTaskLogs,
  cleanupTaskExecutionMarkers,
  cleanupTaskConfigAuditLogs,
  cleanupLogTables,
  runDatabaseMaintenance,
  runDatabaseVacuum,
};
