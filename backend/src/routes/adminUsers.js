import { Router } from 'express';
import { all, get, run } from '../database/index.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import { hashPassword } from '../utils/crypto.js';
import { buildUserAccessSummary, normalizeDateTimeInput } from '../utils/userAccess.js';
import {
  getSchedulerSettings,
  updateSchedulerAccountDispatchIntervalMsSetting,
  updateSchedulerMaxConcurrentAccountsSetting,
  updateSchedulerProxyAccountDispatchIntervalMsSetting,
  updateSchedulerProxyMaxConcurrentAccountsSetting,
} from '../utils/systemSettings.js';
import { proxyConfigManager } from '../utils/proxyConfigManager.js';
import { proxyPoolManager } from '../utils/proxyPool/index.js';

const router = Router();

router.use(authMiddleware, adminOnly);

const PUBLIC_BROADCAST_SETTING_KEY = 'public_broadcast_current';

function parseBroadcastValue(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const title = String(parsed.title || '').trim();
    const content = String(parsed.content || '').trim();
    if (!title || !content) return null;
    return {
      id: String(parsed.id || '').trim() || null,
      title,
      content,
      createdAt: parsed.createdAt || null,
      updatedAt: parsed.updatedAt || null,
      createdBy: parsed.createdBy || null,
      createdByName: parsed.createdByName || null,
    };
  } catch {
    return null;
  }
}

function getCurrentBroadcast() {
  const row = get(
    'SELECT value FROM system_settings WHERE key = ? LIMIT 1',
    [PUBLIC_BROADCAST_SETTING_KEY]
  );
  return parseBroadcastValue(row?.value || null);
}

async function refreshSchedulers() {
  try {
    const [{ checkAndRunDueTasks }, { checkAndRunDueBatchTasks }] = await Promise.all([
      import('../scheduler/index.js'),
      import('../batchScheduler/index.js')
    ]);
    await checkAndRunDueTasks();
    await checkAndRunDueBatchTasks();
  } catch (error) {
    console.warn('⚠️ 刷新调度器失败:', error?.message || error);
  }
}

function normalizeRole(role) {
  return role === 'admin' ? 'admin' : 'user';
}

function normalizeEnabled(value) {
  return value === false || value === 0 || value === '0' ? 0 : 1;
}

function normalizeMaxGameAccountsForCreate(value) {
  if (value === undefined || value === '') return 5;
  if (value === null) return null;
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 9999) {
    throw new Error('游戏账号数量上限需为 1-9999 的整数');
  }
  return normalized;
}

function normalizeMaxGameAccountsForUpdate(value) {
  if (value === null) return null;
  if (value === undefined || value === '') {
    throw new Error('游戏账号数量上限不能为空');
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 9999) {
    throw new Error('游戏账号数量上限需为 1-9999 的整数');
  }
  return normalized;
}

function parseAccessWindow(body) {
  const accessStartAt = normalizeDateTimeInput(body.accessStartAt ?? body.access_start_at ?? null);
  const accessEndAt = normalizeDateTimeInput(body.accessEndAt ?? body.access_end_at ?? null);

  if (accessStartAt && accessEndAt && new Date(accessStartAt) > new Date(accessEndAt)) {
    throw new Error('可用开始时间不能晚于结束时间');
  }

  return { accessStartAt, accessEndAt };
}

function serializeUser(user) {
  return {
    ...user,
    ...buildUserAccessSummary(user)
  };
}

function resolveValidationStatus(error) {
  const message = String(error?.message || '');
  return /(时间|数量上限|并发账号数|账号启动间隔|代理|百分比|发布策略)/.test(message) ? 400 : 500;
}

function getAllGameAccountNames() {
  return all(`
    SELECT DISTINCT name
    FROM game_accounts
    WHERE name IS NOT NULL AND TRIM(name) != ''
    ORDER BY name COLLATE NOCASE ASC
  `).map((row) => row.name);
}

function normalizeProxyNameList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
}

function normalizeProxySettingsPayload(body = {}) {
  const strategy = String(body?.rollout?.strategy || 'whitelist').trim();
  if (!['whitelist', 'percentage', 'all', 'none'].includes(strategy)) {
    throw new Error('代理发布策略不支持');
  }

  const percentage = Number(body?.rollout?.percentage || 0);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('代理百分比需为 0-100');
  }

  const maxRetries = Number(body?.maxRetries ?? 3);
  if (!Number.isInteger(maxRetries) || maxRetries < 1 || maxRetries > 10) {
    throw new Error('代理失败重试次数需为 1-10 的整数');
  }

  return {
    enabled: !!body.enabled,
    fallbackToDirect: body.fallbackToDirect !== false,
    maxRetries,
    rollout: {
      strategy,
      whitelist: normalizeProxyNameList(body?.rollout?.whitelist),
      percentage,
      excludeList: normalizeProxyNameList(body?.rollout?.excludeList),
    },
  };
}

router.get('/settings/scheduler', (req, res) => {
  try {
    res.json({
      success: true,
      data: getSchedulerSettings(),
    });
  } catch (error) {
    console.error('获取调度设置错误:', error);
    res.status(500).json({
      success: false,
      error: '获取调度设置失败',
    });
  }
});

router.put('/settings/scheduler', (req, res) => {
  try {
    const body = req.body || {};
    const hasCamel = Object.prototype.hasOwnProperty.call(body, 'maxConcurrentAccounts');
    const hasSnake = Object.prototype.hasOwnProperty.call(body, 'max_concurrent_accounts');
    const rawMaxConcurrentAccounts = hasCamel
      ? req.body.maxConcurrentAccounts
      : (hasSnake ? req.body.max_concurrent_accounts : undefined);
    const hasIntervalMs = Object.prototype.hasOwnProperty.call(body, 'accountDispatchIntervalMs');
    const hasIntervalSeconds = Object.prototype.hasOwnProperty.call(body, 'accountDispatchIntervalSeconds');
    const hasIntervalSnake = Object.prototype.hasOwnProperty.call(body, 'account_dispatch_interval_ms');
    const rawAccountDispatchIntervalMs = hasIntervalMs
      ? body.accountDispatchIntervalMs
      : (hasIntervalSeconds
        ? Number(body.accountDispatchIntervalSeconds) * 1000
        : (hasIntervalSnake ? body.account_dispatch_interval_ms : undefined));
    const hasProxyCamel = Object.prototype.hasOwnProperty.call(body, 'proxyMaxConcurrentAccounts');
    const hasProxySnake = Object.prototype.hasOwnProperty.call(body, 'proxy_max_concurrent_accounts');
    const rawProxyMaxConcurrentAccounts = hasProxyCamel
      ? body.proxyMaxConcurrentAccounts
      : (hasProxySnake ? body.proxy_max_concurrent_accounts : undefined);
    const hasProxyIntervalMs = Object.prototype.hasOwnProperty.call(body, 'proxyAccountDispatchIntervalMs');
    const hasProxyIntervalSeconds = Object.prototype.hasOwnProperty.call(body, 'proxyAccountDispatchIntervalSeconds');
    const hasProxyIntervalSnake = Object.prototype.hasOwnProperty.call(body, 'proxy_account_dispatch_interval_ms');
    const rawProxyAccountDispatchIntervalMs = hasProxyIntervalMs
      ? body.proxyAccountDispatchIntervalMs
      : (hasProxyIntervalSeconds
        ? Number(body.proxyAccountDispatchIntervalSeconds) * 1000
        : (hasProxyIntervalSnake ? body.proxy_account_dispatch_interval_ms : undefined));

    if (
      rawMaxConcurrentAccounts === undefined &&
      rawAccountDispatchIntervalMs === undefined &&
      rawProxyMaxConcurrentAccounts === undefined &&
      rawProxyAccountDispatchIntervalMs === undefined
    ) {
      return res.status(400).json({
        success: false,
        error: '缺少调度配置',
      });
    }

    const updated = {};
    if (rawMaxConcurrentAccounts !== undefined) {
      updated.maxConcurrentAccounts = updateSchedulerMaxConcurrentAccountsSetting(rawMaxConcurrentAccounts);
    }
    if (rawAccountDispatchIntervalMs !== undefined) {
      updated.accountDispatchIntervalMs = updateSchedulerAccountDispatchIntervalMsSetting(rawAccountDispatchIntervalMs);
      updated.accountDispatchIntervalSeconds = Math.round(updated.accountDispatchIntervalMs / 1000);
    }
    if (rawProxyMaxConcurrentAccounts !== undefined) {
      updated.proxyMaxConcurrentAccounts = updateSchedulerProxyMaxConcurrentAccountsSetting(rawProxyMaxConcurrentAccounts);
    }
    if (rawProxyAccountDispatchIntervalMs !== undefined) {
      updated.proxyAccountDispatchIntervalMs = updateSchedulerProxyAccountDispatchIntervalMsSetting(rawProxyAccountDispatchIntervalMs);
      updated.proxyAccountDispatchIntervalSeconds = Math.round(updated.proxyAccountDispatchIntervalMs / 1000);
    }

    res.json({
      success: true,
      message: '调度设置已更新',
      data: {
        ...getSchedulerSettings(),
        ...updated,
      },
    });
  } catch (error) {
    console.error('更新调度设置错误:', error);
    res.status(resolveValidationStatus(error)).json({
      success: false,
      error: error.message || '更新调度设置失败',
    });
  }
});

router.get('/settings/proxy', async (req, res) => {
  try {
    await proxyConfigManager.ensureLoaded();
    if (await proxyConfigManager.isEnabled()) {
      proxyPoolManager.ensureInitializedInBackground('admin-proxy-settings');
    }
    res.json({
      success: true,
      data: {
        ...proxyConfigManager.getStats(),
        accountNames: getAllGameAccountNames(),
      },
    });
  } catch (error) {
    console.error('获取代理发布策略错误:', error);
    res.status(500).json({
      success: false,
      error: '获取代理发布策略失败',
    });
  }
});

router.put('/settings/proxy', async (req, res) => {
  try {
    const config = normalizeProxySettingsPayload(req.body || {});
    await proxyConfigManager.updateConfig(config);
    res.json({
      success: true,
      message: '代理发布策略已更新',
      data: {
        ...proxyConfigManager.getStats(),
        accountNames: getAllGameAccountNames(),
      },
    });
  } catch (error) {
    console.error('更新代理发布策略错误:', error);
    res.status(resolveValidationStatus(error)).json({
      success: false,
      error: error.message || '更新代理发布策略失败',
    });
  }
});

router.post('/settings/proxy/warmup', async (req, res) => {
  try {
    const warmup = proxyPoolManager.startWarmup();

    res.json({
      success: true,
      message: warmup.running ? '代理池预热已启动' : '代理池预热已完成',
      data: {
        ...proxyConfigManager.getStats(),
        warmup,
        accountNames: getAllGameAccountNames(),
      },
    });
  } catch (error) {
    console.error('预热代理池错误:', error);
    res.status(500).json({
      success: false,
      error: error.message || '预热代理池失败',
    });
  }
});

router.get('/broadcast', (req, res) => {
  try {
    res.json({
      success: true,
      data: getCurrentBroadcast(),
    });
  } catch (error) {
    console.error('获取公共通知错误:', error);
    res.status(500).json({
      success: false,
      error: '获取公共通知失败',
    });
  }
});

router.put('/broadcast', (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const content = String(req.body?.content || '').trim();

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        error: '标题和正文不能为空',
      });
    }

    const now = new Date().toISOString();
    const payload = {
      id: `broadcast_${Date.now()}`,
      title,
      content,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user.userId,
      createdByName: req.user.username,
    };

    run(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
      [PUBLIC_BROADCAST_SETTING_KEY, JSON.stringify(payload)]
    );

    res.json({
      success: true,
      message: '公共通知已发布',
      data: payload,
    });
  } catch (error) {
    console.error('保存公共通知错误:', error);
    res.status(500).json({
      success: false,
      error: '保存公共通知失败',
    });
  }
});

router.delete('/broadcast', (req, res) => {
  try {
    run('DELETE FROM system_settings WHERE key = ?', [PUBLIC_BROADCAST_SETTING_KEY]);
    res.json({
      success: true,
      message: '公共通知已清空',
    });
  } catch (error) {
    console.error('清空公共通知错误:', error);
    res.status(500).json({
      success: false,
      error: '清空公共通知失败',
    });
  }
});

router.get('/', (req, res) => {
  try {
    const users = all(`
      SELECT
        u.id,
        u.username,
        u.role,
        u.created_at,
        u.last_login,
        u.is_enabled,
        u.access_start_at,
        u.access_end_at,
        u.max_game_accounts,
        COUNT(ga.id) AS game_account_count
      FROM users u
      LEFT JOIN game_accounts ga ON ga.user_id = u.id
      GROUP BY u.id
      ORDER BY
        CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END,
        datetime(u.created_at) DESC,
        u.id DESC
    `);

    res.json({
      success: true,
      data: users.map(serializeUser)
    });
  } catch (error) {
    console.error('获取用户列表错误:', error);
    res.status(500).json({
      success: false,
      error: '获取用户列表失败'
    });
  }
});

router.get('/:id/accounts', (req, res) => {
  try {
    const { id } = req.params;
    const user = get('SELECT id, username FROM users WHERE id = ?', [id]);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    const accounts = all(
      `SELECT id, name, server, status, created_at, updated_at, last_used_at
       FROM game_accounts
       WHERE user_id = ?
       ORDER BY datetime(created_at) DESC, id DESC`,
      [id]
    );

    res.json({
      success: true,
      data: {
        user: {
          id: Number(user.id),
          username: user.username
        },
        accounts
      }
    });
  } catch (error) {
    console.error('获取用户游戏账号列表错误:', error);
    res.status(500).json({
      success: false,
      error: '获取用户游戏账号列表失败'
    });
  }
});

router.get('/:id/logs', (req, res) => {
  try {
    const { id } = req.params;
    const { accountId, taskType, status, limit = 30, offset = 0 } = req.query;
    const user = get('SELECT id, username FROM users WHERE id = ?', [id]);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    let sql = `
      SELECT tl.*, ga.name AS account_name
      FROM task_logs tl
      JOIN game_accounts ga ON tl.account_id = ga.id
      WHERE ga.user_id = ?
    `;
    const params = [id];

    if (accountId) {
      const account = get(
        'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
        [accountId, id]
      );
      if (!account) {
        return res.status(404).json({
          success: false,
          error: '游戏账号不存在'
        });
      }
      sql += ' AND tl.account_id = ?';
      params.push(accountId);
    }

    if (taskType) {
      sql += ' AND tl.task_type = ?';
      params.push(taskType);
    }

    if (status) {
      sql += ' AND tl.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY datetime(tl.created_at) DESC, tl.id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const logs = all(sql, params);

    let countSql = `
      SELECT COUNT(*) AS total
      FROM task_logs tl
      JOIN game_accounts ga ON tl.account_id = ga.id
      WHERE ga.user_id = ?
    `;
    const countParams = [id];

    if (accountId) {
      countSql += ' AND tl.account_id = ?';
      countParams.push(accountId);
    }

    if (taskType) {
      countSql += ' AND tl.task_type = ?';
      countParams.push(taskType);
    }

    if (status) {
      countSql += ' AND tl.status = ?';
      countParams.push(status);
    }

    const countResult = get(countSql, countParams);

    res.json({
      success: true,
      data: {
        user: {
          id: Number(user.id),
          username: user.username
        },
        logs
      },
      total: Number(countResult?.total || 0)
    });
  } catch (error) {
    console.error('获取用户日志错误:', error);
    res.status(500).json({
      success: false,
      error: '获取用户日志失败'
    });
  }
});

router.post('/', (req, res) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const role = normalizeRole(req.body.role);
    const isEnabled = normalizeEnabled(req.body.isEnabled ?? req.body.is_enabled);
    const hasCamelMaxGameAccounts = Object.prototype.hasOwnProperty.call(req.body, 'maxGameAccounts');
    const hasSnakeMaxGameAccounts = Object.prototype.hasOwnProperty.call(req.body, 'max_game_accounts');
    const rawMaxGameAccounts = hasCamelMaxGameAccounts
      ? req.body.maxGameAccounts
      : (hasSnakeMaxGameAccounts ? req.body.max_game_accounts : undefined);
    const maxGameAccounts = normalizeMaxGameAccountsForCreate(rawMaxGameAccounts);
    const { accessStartAt, accessEndAt } = parseAccessWindow(req.body);

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '用户名和密码不能为空'
      });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({
        success: false,
        error: '用户名长度需要在3-20个字符之间'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: '密码长度至少6个字符'
      });
    }

    const existingUser = get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: '用户名已存在'
      });
    }

    const { hash, salt } = hashPassword(password);
    const result = run(
      `INSERT INTO users (username, password_hash, salt, role, is_enabled, access_start_at, access_end_at, max_game_accounts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, hash, salt, role, isEnabled, accessStartAt, accessEndAt, maxGameAccounts]
    );

    const createdUser = get(
      `SELECT id, username, role, created_at, last_login, is_enabled, access_start_at, access_end_at, max_game_accounts
       FROM users WHERE id = ?`,
      [result.lastInsertRowid]
    );

    res.status(201).json({
      success: true,
      message: '用户创建成功',
      data: serializeUser({
        ...createdUser,
        game_account_count: 0
      })
    });
  } catch (error) {
    console.error('创建用户错误:', error);
    res.status(resolveValidationStatus(error)).json({
      success: false,
      error: error.message || '创建用户失败'
    });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = get('SELECT * FROM users WHERE id = ?', [id]);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    const updateFields = [];
    const updateValues = [];

    if (req.body.username !== undefined) {
      const username = String(req.body.username || '').trim();
      if (!username) {
        return res.status(400).json({
          success: false,
          error: '用户名不能为空'
        });
      }
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({
          success: false,
          error: '用户名长度需要在3-20个字符之间'
        });
      }
      const existingUser = get('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          error: '用户名已存在'
        });
      }
      updateFields.push('username = ?');
      updateValues.push(username);
    }

    if (req.body.password) {
      const password = String(req.body.password);
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          error: '密码长度至少6个字符'
        });
      }
      const { hash, salt } = hashPassword(password);
      updateFields.push('password_hash = ?', 'salt = ?');
      updateValues.push(hash, salt);
    }

    if (req.body.role !== undefined) {
      const role = normalizeRole(req.body.role);
      if (Number(id) === req.user.userId && role !== 'admin') {
        return res.status(400).json({
          success: false,
          error: '不能取消当前登录管理员的管理员权限'
        });
      }
      updateFields.push('role = ?');
      updateValues.push(role);
    }

    if (req.body.maxGameAccounts !== undefined || req.body.max_game_accounts !== undefined) {
      const hasCamelMaxGameAccounts = Object.prototype.hasOwnProperty.call(req.body, 'maxGameAccounts');
      const hasSnakeMaxGameAccounts = Object.prototype.hasOwnProperty.call(req.body, 'max_game_accounts');
      const rawMaxGameAccounts = hasCamelMaxGameAccounts
        ? req.body.maxGameAccounts
        : (hasSnakeMaxGameAccounts ? req.body.max_game_accounts : undefined);
      const maxGameAccounts = normalizeMaxGameAccountsForUpdate(rawMaxGameAccounts);
      updateFields.push('max_game_accounts = ?');
      updateValues.push(maxGameAccounts);
    }

    if (req.body.isEnabled !== undefined || req.body.is_enabled !== undefined) {
      const isEnabled = normalizeEnabled(req.body.isEnabled ?? req.body.is_enabled);
      if (Number(id) === req.user.userId && isEnabled !== 1) {
        return res.status(400).json({
          success: false,
          error: '不能禁用当前登录管理员账号'
        });
      }
      updateFields.push('is_enabled = ?');
      updateValues.push(isEnabled);
    }

    if (
      req.body.accessStartAt !== undefined ||
      req.body.access_start_at !== undefined ||
      req.body.accessEndAt !== undefined ||
      req.body.access_end_at !== undefined
    ) {
      const { accessStartAt, accessEndAt } = parseAccessWindow({
        accessStartAt: req.body.accessStartAt !== undefined ? req.body.accessStartAt : user.access_start_at,
        accessEndAt: req.body.accessEndAt !== undefined ? req.body.accessEndAt : user.access_end_at,
        access_start_at: req.body.access_start_at !== undefined ? req.body.access_start_at : user.access_start_at,
        access_end_at: req.body.access_end_at !== undefined ? req.body.access_end_at : user.access_end_at
      });

      updateFields.push('access_start_at = ?', 'access_end_at = ?');
      updateValues.push(accessStartAt, accessEndAt);
    }

    if (!updateFields.length) {
      return res.status(400).json({
        success: false,
        error: '没有可更新的内容'
      });
    }

    updateValues.push(id);
    run(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
    await refreshSchedulers();

    const updatedUser = get(
      `SELECT id, username, role, created_at, last_login, is_enabled, access_start_at, access_end_at, max_game_accounts
       FROM users WHERE id = ?`,
      [id]
    );
    const accountCountRow = get('SELECT COUNT(*) AS total FROM game_accounts WHERE user_id = ?', [id]);

    res.json({
      success: true,
      message: '用户更新成功',
      data: serializeUser({
        ...updatedUser,
        game_account_count: Number(accountCountRow?.total || 0)
      })
    });
  } catch (error) {
    console.error('更新用户错误:', error);
    res.status(resolveValidationStatus(error)).json({
      success: false,
      error: error.message || '更新用户失败'
    });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = get('SELECT id, username, role FROM users WHERE id = ?', [id]);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    if (Number(id) === req.user.userId) {
      return res.status(400).json({
        success: false,
        error: '不能删除当前登录管理员账号'
      });
    }

    run('DELETE FROM users WHERE id = ?', [id]);
    await refreshSchedulers();

    res.json({
      success: true,
      message: `用户 ${user.username} 已删除`
    });
  } catch (error) {
    console.error('删除用户错误:', error);
    res.status(500).json({
      success: false,
      error: '删除用户失败'
    });
  }
});

export default router;
