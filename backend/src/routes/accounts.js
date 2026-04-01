import { Router } from 'express';
import { run, get, all, normalizeGameAccounts } from '../database/index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { authMiddleware } from '../middleware/auth.js';
import { parseTokenPayload } from '../utils/token.js';
import GameClient from '../utils/gameClient.js';
import config from '../config/index.js';
import { ensureDefaultTaskConfigsForAccount } from './tasks.js';
import { buildWsLogContext, normalizeDisconnectInfo, normalizeErrorMessage } from '../utils/wsDiagnostics.js';
import { warmupGameClient } from '../utils/wsWarmup.js';
import { isLikelyBase64, normalizeBase64Text } from '../utils/binStorage.js';
import { refreshAccountTokenFromStoredBin } from '../utils/accountTokenRefresh.js';

const router = Router();

router.use(authMiddleware);

function extractBinBase64(body = {}) {
  const candidates = [
    body?.binData,
    body?.binBase64,
    body?.bin_data,
    body?.bin_base64,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = normalizeBase64Text(candidate);
    if (isLikelyBase64(normalized)) {
      return normalized;
    }
  }

  return '';
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

router.get('/', (req, res) => {
  try {
    normalizeGameAccounts();

    const accounts = all(
      `SELECT id, name, ws_url, server, remark, avatar, status, import_method, source_url, created_at, updated_at, last_used_at 
       FROM game_accounts 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [req.user.userId]
    );

    res.json({
      success: true,
      data: accounts
    });
  } catch (error) {
    console.error('获取账号列表错误:', error);
    res.status(500).json({
      success: false,
      error: '获取账号列表失败'
    });
  }
});

router.get('/:id', (req, res) => {
  try {
    const account = get(
      `SELECT id, name, ws_url, server, remark, avatar, status, created_at, updated_at, last_used_at 
       FROM game_accounts 
       WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    res.json({
      success: true,
      data: account
    });
  } catch (error) {
    console.error('获取账号详情错误:', error);
    res.status(500).json({
      success: false,
      error: '获取账号详情失败'
    });
  }
});

router.post('/', async (req, res) => {
  try {
    normalizeGameAccounts();

    const { name, token, server, remark, avatar, importMethod, sourceUrl } = req.body;
    const wsUrl = typeof req.body?.wsUrl === 'string'
      ? req.body.wsUrl.trim()
      : (typeof req.body?.ws_url === 'string' ? req.body.ws_url.trim() : '');
    const binBase64 = extractBinBase64(req.body);
    const normalizedName = String(name || '').trim();

    if (!normalizedName || !token) {
      return res.status(400).json({
        success: false,
        error: '账号名称和Token不能为空'
      });
    }

    const existing = get(
      'SELECT id FROM game_accounts WHERE user_id = ? AND name = ?',
      [req.user.userId, normalizedName]
    );

    if (existing) {
      return res.status(409).json({
        success: false,
        error: '账号名称已存在',
        data: { id: existing.id }
      });
    }

    const user = get(
      'SELECT id, max_game_accounts FROM users WHERE id = ?',
      [req.user.userId]
    );

    const accountCountRow = get(
      'SELECT COUNT(*) AS total FROM game_accounts WHERE user_id = ?',
      [req.user.userId]
    );
    const currentCount = Number(accountCountRow?.total || 0);
    const maxGameAccounts = user?.max_game_accounts == null ? null : Number(user.max_game_accounts);

    if (maxGameAccounts && currentCount >= maxGameAccounts) {
      return res.status(400).json({
        success: false,
        error: `当前账号最多只能添加 ${maxGameAccounts} 个游戏账号，已达到上限`
      });
    }

    const rawTokenText = String(token).trim();
    const { encrypted, iv } = encrypt(rawTokenText);
    const encryptedBin = binBase64 ? encrypt(binBase64) : null;

    let result;
    try {
      result = run(
        `INSERT INTO game_accounts (user_id, name, token_encrypted, token_iv, bin_encrypted, bin_iv, bin_updated_at, ws_url, server, remark, avatar, import_method, source_url) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.userId,
          normalizedName,
          encrypted,
          iv,
          encryptedBin?.encrypted || null,
          encryptedBin?.iv || null,
          encryptedBin ? new Date().toISOString() : null,
          wsUrl || '',
          server || '',
          remark || '',
          avatar || '',
          importMethod || 'manual',
          sourceUrl || '',
        ]
      );
    } catch (error) {
      if (String(error?.message || '').includes('idx_game_accounts_user_name_unique')) {
        const duplicated = get(
          'SELECT id FROM game_accounts WHERE user_id = ? AND name = ?',
          [req.user.userId, normalizedName]
        );
        return res.status(409).json({
          success: false,
          error: '账号名称已存在',
          data: duplicated?.id ? { id: duplicated.id } : undefined
        });
      }
      throw error;
    }

    const accountId = Number(result.lastInsertRowid);
    const seedResult = ensureDefaultTaskConfigsForAccount(accountId);
    if (seedResult.created > 0) {
      console.log('🧩 新账号已自动初始化默认定时任务配置', {
        accountId,
        accountName: normalizedName,
        userId: req.user.userId,
        importMethod: importMethod || 'manual',
        persistedBin: !!encryptedBin,
        createdTaskConfigCount: seedResult.created,
        taskTypes: seedResult.insertedTaskTypes,
      });
      const { checkAndRunDueTasks } = await import('../scheduler/index.js');
      await checkAndRunDueTasks();
    }

    res.status(201).json({
      success: true,
      message: '账号添加成功',
      data: {
        id: accountId,
        name: normalizedName,
        server,
        remark,
        avatar,
        importMethod: importMethod || 'manual'
      }
    });
  } catch (error) {
    console.error('添加账号错误:', error);
    res.status(500).json({
      success: false,
      error: '添加账号失败'
    });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, token, server, remark, avatar, status } = req.body;
    const wsUrl = typeof req.body?.wsUrl === 'string'
      ? req.body.wsUrl.trim()
      : (typeof req.body?.ws_url === 'string' ? req.body.ws_url.trim() : undefined);
    const binBase64 = extractBinBase64(req.body);

    const account = get(
      'SELECT * FROM game_accounts WHERE id = ? AND user_id = ?',
      [id, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    if (name && name !== account.name) {
      const existing = get(
        'SELECT id FROM game_accounts WHERE user_id = ? AND name = ? AND id != ?',
        [req.user.userId, name, id]
      );

      if (existing) {
        return res.status(409).json({
          success: false,
          error: '账号名称已存在'
        });
      }
    }

    let updateFields = [];
    let updateValues = [];

    if (name) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (token) {
      const rawTokenText = String(token).trim();
      const { encrypted, iv } = encrypt(rawTokenText);
      updateFields.push('token_encrypted = ?', 'token_iv = ?');
      updateValues.push(encrypted, iv);
    }
    if (binBase64) {
      const { encrypted, iv } = encrypt(binBase64);
      updateFields.push('bin_encrypted = ?', 'bin_iv = ?', 'bin_updated_at = ?');
      updateValues.push(encrypted, iv, new Date().toISOString());
    }
    if (wsUrl !== undefined) {
      updateFields.push('ws_url = ?');
      updateValues.push(wsUrl);
    }
    if (server !== undefined) {
      updateFields.push('server = ?');
      updateValues.push(server);
    }
    if (remark !== undefined) {
      updateFields.push('remark = ?');
      updateValues.push(remark);
    }
    if (avatar !== undefined) {
      updateFields.push('avatar = ?');
      updateValues.push(avatar);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有要更新的内容'
      });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(id, req.user.userId);

    run(
      `UPDATE game_accounts SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
      updateValues
    );

    res.json({
      success: true,
      message: '账号更新成功'
    });
  } catch (error) {
    console.error('更新账号错误:', error);
    res.status(500).json({
      success: false,
      error: '更新账号失败'
    });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const account = get(
      'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    run('DELETE FROM game_accounts WHERE id = ?', [req.params.id]);

    res.json({
      success: true,
      message: '账号删除成功'
    });
  } catch (error) {
    console.error('删除账号错误:', error);
    res.status(500).json({
      success: false,
      error: '删除账号失败'
    });
  }
});

router.get('/:id/token', (req, res) => {
  try {
    const account = get(
      'SELECT token_encrypted, token_iv FROM game_accounts WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    const token = decrypt(account.token_encrypted, account.token_iv);

    res.json({
      success: true,
      data: { token }
    });
  } catch (error) {
    console.error('获取Token错误:', error);
    res.status(500).json({
      success: false,
      error: '获取Token失败'
    });
  }
});

router.post('/:id/test-connection', async (req, res) => {
  try {
    const account = get(
      'SELECT id, name, token_encrypted, token_iv, bin_encrypted, bin_iv, ws_url, server, import_method, updated_at FROM game_accounts WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.userId]
    );

    if (!account) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    const requestTokenText = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const requestWsUrlText = typeof req.body?.wsUrl === 'string'
      ? req.body.wsUrl.trim()
      : (typeof req.body?.ws_url === 'string' ? req.body.ws_url.trim() : '');
    const requestBinBase64 = extractBinBase64(req.body);
    const rawToken = requestTokenText || decrypt(account.token_encrypted, account.token_iv);
    const tokenMeta = parseTokenPayload(rawToken);
    const tokenCandidates = tokenMeta.candidates?.length ? tokenMeta.candidates : [tokenMeta.token].filter(Boolean);
    if (tokenCandidates.length === 0) {
      return res.status(400).json({
        success: false,
        error: '账号Token无效'
      });
    }

    if (req.body?.persist === true && (requestTokenText || requestWsUrlText || requestBinBase64)) {
      const updateFields = [];
      const updateValues = [];
      if (requestTokenText) {
        const { encrypted, iv } = encrypt(requestTokenText);
        updateFields.push('token_encrypted = ?', 'token_iv = ?');
        updateValues.push(encrypted, iv);
      }
      if (requestBinBase64) {
        const { encrypted, iv } = encrypt(requestBinBase64);
        updateFields.push('bin_encrypted = ?', 'bin_iv = ?', 'bin_updated_at = ?');
        updateValues.push(encrypted, iv, new Date().toISOString());
      }
      if (requestWsUrlText) {
        updateFields.push('ws_url = ?');
        updateValues.push(requestWsUrlText);
      }
      updateFields.push('updated_at = CURRENT_TIMESTAMP');
      updateValues.push(req.params.id, req.user.userId);
      run(
        `UPDATE game_accounts SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
        updateValues
      );
      console.log('💾 后端连接测试已持久化最新账号连接参数', {
        accountId: Number(account.id),
        accountName: account.name,
        importMethod: account.import_method || 'manual',
        persistedToken: !!requestTokenText,
        persistedBin: !!requestBinBase64,
        persistedWsUrl: !!requestWsUrlText,
      });
    }

    const hasStoredBin = !!requestBinBase64 || !!(account.bin_encrypted && account.bin_iv);

    const requestedTimeout = Number(req.body?.timeout);
    const roleInfoTimeout = Number.isFinite(requestedTimeout)
      ? Math.max(5000, Math.min(60000, Math.trunc(requestedTimeout)))
      : 15000;

    const startedAt = Date.now();
    let lastError = '连接测试失败';
    let lastConnectedMs = 0;
    let lastDisconnectInfo = null;
    let lastWsError = null;
    let lastHandshake = null;
    let lastWarmup = null;
    let refreshedByBin = false;

    const tryCandidates = async (candidates, tokenMetaForAttempt, context = {}) => {
      for (const [index, candidateToken] of candidates.entries()) {
      lastWarmup = null;
      lastHandshake = null;
      const wsUrl = requestWsUrlText || account.ws_url || tokenMetaForAttempt.wsUrl || '';
      const resolvedWsUrl = resolveWsUrl(wsUrl, candidateToken);
      const client = new GameClient(candidateToken, { roleId: tokenMetaForAttempt.roleId, wsUrl: resolvedWsUrl });
      let disconnectInfo = null;
      let wsErrorMessage = null;
      let unexpectedResponse = null;
      const logContext = buildWsLogContext({
        accountId: Number(account.id),
        accountName: account.name,
        roleId: tokenMetaForAttempt.roleId,
        importMethod: account.import_method || 'manual',
        updatedAt: account.updated_at || null,
        candidateIndex: index + 1,
        candidateCount: candidates.length,
        token: candidateToken,
        wsUrl: resolvedWsUrl,
        extra: {
          refreshedByBin: !!context.refreshedByBin,
        },
      });
      client.onDisconnect = (code, reason, meta) => {
        disconnectInfo = {
          code: Number(code) || 0,
          reason: String(reason || '')
        };
        console.warn('🔌 后端连接测试连接断开', {
          ...logContext,
          disconnect: normalizeDisconnectInfo(disconnectInfo),
          handshake: meta || client.lastConnectMeta || null,
        });
      };
      client.onError = (error, meta) => {
        wsErrorMessage = error?.message || String(error || '');
        console.error('❌ 后端连接测试连接报错', {
          ...logContext,
          error: normalizeErrorMessage(error),
          handshake: meta || client.lastConnectMeta || null,
        });
      };
      client.onUnexpectedResponse = (details, meta) => {
        unexpectedResponse = details;
        console.error('🚫 后端连接测试握手异常响应', {
          ...logContext,
          unexpectedResponse: details,
          handshake: meta || client.lastConnectMeta || null,
        });
      };

      try {
        console.log('🧪 开始后端连接测试', logContext);
        await client.connect();
        if (!client.isSocketOpen()) {
          throw new Error('WebSocket未连接');
        }

        const connectedMs = Date.now() - startedAt;
        lastConnectedMs = connectedMs;
        lastHandshake = client.lastConnectMeta || null;
        console.log('✅ 后端连接测试已建立WebSocket', {
          ...logContext,
          connectedMs,
          handshake: client.lastConnectMeta || null,
        });

        const warmup = await warmupGameClient(client, {
          roleInfoTimeout,
          includeRoleId: false,
        });
        lastWarmup = warmup;

        if (!client.isSocketOpen()) {
          throw new Error('WebSocket未连接');
        }

        const elapsedMs = Date.now() - startedAt;
        console.log('🔥 后端连接测试预热完成', {
          ...logContext,
          connectedMs,
          elapsedMs,
          handshake: client.lastConnectMeta || null,
          warmup,
        });

        return res.json({
          success: true,
          message: warmup.roleInfoError
            ? '后端WebSocket连接测试成功(角色信息获取失败)'
            : '后端WebSocket连接测试成功',
          data: {
            accountId: account.id,
            accountName: account.name,
            server: account.server || '',
            roleId: warmup.roleInfo?.role?.roleId || tokenMetaForAttempt.roleId || null,
            connectedMs,
            elapsedMs,
            roleName: warmup.roleInfo?.role?.name || account.name || null,
            tokenCandidateIndex: index,
            roleInfoError: warmup.roleInfoError,
            battleVersion: warmup.battleVersion,
            refreshedByBin: !!context.refreshedByBin,
          }
        });
      } catch (error) {
        lastError = error?.message || '连接测试失败';
        lastDisconnectInfo = disconnectInfo;
        lastWsError = wsErrorMessage;
        lastHandshake = client.lastConnectMeta || null;
        console.warn('⚠️ 后端连接测试候选失败', {
          ...logContext,
          error: normalizeErrorMessage(error),
          disconnect: normalizeDisconnectInfo(disconnectInfo),
          wsError: wsErrorMessage || null,
          unexpectedResponse,
          handshake: client.lastConnectMeta || null,
          warmup: lastWarmup,
        });
      } finally {
        client.disconnect();
      }
    }
    return null;
    };

    const directResult = await tryCandidates(tokenCandidates, tokenMeta, { refreshedByBin: false });
    if (directResult) {
      return directResult;
    }

    if (hasStoredBin) {
      try {
        const refreshed = await refreshAccountTokenFromStoredBin(account.id, { trigger: 'test-connection' });
        if (refreshed?.refreshed && refreshed?.token) {
          refreshedByBin = true;
          const refreshedMeta = parseTokenPayload(refreshed.token);
          const refreshedCandidates = refreshedMeta.candidates?.length
            ? refreshedMeta.candidates
            : [refreshedMeta.token].filter(Boolean);
          const retriedResult = await tryCandidates(refreshedCandidates, refreshedMeta, { refreshedByBin: true });
          if (retriedResult) {
            return retriedResult;
          }
        }
      } catch (error) {
        console.warn('⚠️ 后端连接测试通过持久化BIN刷新Token失败', {
          accountId: Number(account.id),
          accountName: account.name,
          error: normalizeErrorMessage(error),
        });
      }
    }

    const elapsedMs = Date.now() - startedAt;
    return res.status(504).json({
      success: false,
      error: `WebSocket已连接(${lastConnectedMs}ms)，但角色信息获取失败: ${lastError}`,
      data: {
        accountId: account.id,
        accountName: account.name,
        server: account.server || '',
        roleId: tokenMeta.roleId,
        connectedMs: lastConnectedMs,
        elapsedMs,
        disconnect: lastDisconnectInfo,
        wsError: lastWsError,
        handshake: lastHandshake,
        warmup: lastWarmup,
        tokenCandidateCount: tokenCandidates.length,
        refreshedByBin,
        hasStoredBin,
      }
    });
  } catch (error) {
    console.error('测试后端WebSocket连接错误:', error);
    res.status(500).json({
      success: false,
      error: error.message || '连接测试失败'
    });
  }
});

export function getDecryptedToken(accountId, userId) {
  const account = get(
    'SELECT token_encrypted, token_iv FROM game_accounts WHERE id = ? AND user_id = ?',
    [accountId, userId]
  );

  if (!account) {
    return null;
  }

  return decrypt(account.token_encrypted, account.token_iv);
}

export function getAccountById(accountId, userId) {
  return get(
    'SELECT * FROM game_accounts WHERE id = ? AND user_id = ?',
    [accountId, userId]
  );
}

export default router;
