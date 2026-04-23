import { Router } from 'express';
import { run, get, all, normalizeGameAccounts, getDatabase } from '../database/index.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { authMiddleware } from '../middleware/auth.js';
import { parseTokenPayload } from '../utils/token.js';
import GameClient from '../utils/gameClient.js';
import config from '../config/index.js';
import { ensureDefaultTaskConfigsForAccount } from './tasks.js';
import { buildWsLogContext, normalizeDisconnectInfo, normalizeErrorMessage } from '../utils/wsDiagnostics.js';
import { warmupGameClient } from '../utils/wsWarmup.js';
import { base64ToBuffer, isLikelyBase64, normalizeBase64Text } from '../utils/binStorage.js';
import {
  probeAccountBinRefreshability,
  refreshAccountTokenFromStoredBin,
} from '../utils/accountTokenRefresh.js';
import { g_utils } from '../../../frontend/src/utils/bonProtocol.js';

const router = Router();
const MAX_ACCOUNT_LINEUPS = 30;

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

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function tryParseJsonString(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function normalizeAuthPayloadInput(rawInput, sourceLabel = 'launch') {
  if (!rawInput) return null;

  let parsed = rawInput;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) return null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const candidates = [
    parsed,
    parsed?.authPayload,
    parsed?.auth_payload,
    parsed?.loginPayload,
    parsed?.login_payload,
    parsed?.data,
    parsed?.rawData,
    parsed?.result,
    parsed?.payload,
    parsed?.data?.data,
    parsed?.data?.rawData,
    parsed?.meta?.data,
  ].filter(Boolean);

  for (const item of candidates) {
    const combUser = tryParseJsonString(pickFirstDefined(item?.combUser, item?.data?.combUser));
    const normalizedCandidate = combUser
      ? {
          platform: 'hortor',
          platformExt: String(pickFirstDefined(item?.platformExt, item?.platform_ext, item?.ext, 'mix')),
          info: combUser,
          serverId: null,
          scene: 0,
          referrerInfo: '',
          type: sourceLabel,
        }
      : null;

    if (normalizedCandidate) {
      return normalizedCandidate;
    }

    const info = tryParseJsonString(
      pickFirstDefined(item?.info, item?.authInfo, item?.encryptUserInfo, item?.userInfo, item?.loginInfo),
    );
    const platformExt = pickFirstDefined(item?.platformExt, item?.platform_ext, item?.ext);
    const serverIdRaw = pickFirstDefined(item?.serverId, item?.serverID, item?.sid, item?.realServerId);
    const serverId =
      serverIdRaw === null || serverIdRaw === undefined || serverIdRaw === ''
        ? null
        : Number(serverIdRaw);

    if (platformExt && info && (serverId === null || Number.isFinite(serverId))) {
      return {
        platform: String(pickFirstDefined(item?.platform, 'hortor')),
        platformExt: String(platformExt),
        info,
        serverId,
        scene: Number.isFinite(Number(item?.scene)) ? Number(item.scene) : 0,
        referrerInfo: typeof item?.referrerInfo === 'string' ? item.referrerInfo : '',
        type: typeof item?.type === 'string' && item.type.trim() ? item.type.trim() : sourceLabel,
      };
    }
  }

  return null;
}

function normalizeLaunchContextInput(body = {}) {
  const rawContext =
    body?.launchContext ??
    body?.launch_context ??
    body?.launchPayload ??
    body?.launch_payload ??
    null;

  if (!rawContext) {
    return null;
  }

  let parsed = rawContext;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed) {
      return null;
    }

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = {
        search: trimmed,
      };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const safeQuery =
    parsed.query && typeof parsed.query === 'object' && !Array.isArray(parsed.query)
      ? Object.fromEntries(
          Object.entries(parsed.query)
            .map(([key, value]) => [String(key || '').trim(), value == null ? '' : String(value)])
            .filter(([key]) => key)
        )
      : {};

  const normalized = {
    href: typeof parsed.href === 'string' ? parsed.href.trim() : '',
    origin: typeof parsed.origin === 'string' ? parsed.origin.trim() : '',
    pathname: typeof parsed.pathname === 'string' ? parsed.pathname.trim() : '',
    search: typeof parsed.search === 'string' ? parsed.search.trim() : '',
    hash: typeof parsed.hash === 'string' ? parsed.hash.trim() : '',
    query: safeQuery,
    userId:
      typeof parsed.userId === 'string'
        ? parsed.userId.trim()
        : (typeof parsed.uid === 'string' ? parsed.uid.trim() : ''),
    uid: typeof parsed.uid === 'string' ? parsed.uid.trim() : '',
    platform: typeof parsed.platform === 'string' ? parsed.platform.trim() : '',
    platformExt: typeof parsed.platformExt === 'string' ? parsed.platformExt.trim() : '',
    source: typeof parsed.source === 'string' ? parsed.source.trim() : '',
    capturedAt:
      typeof parsed.capturedAt === 'string' && parsed.capturedAt.trim()
        ? parsed.capturedAt.trim()
        : new Date().toISOString(),
  };

  const authPayload = normalizeAuthPayloadInput(
    pickFirstDefined(
      parsed.authPayload,
      parsed.auth_payload,
      parsed.loginPayload,
      parsed.login_payload,
      body?.authPayload,
      body?.auth_payload,
    ),
    typeof normalized.source === 'string' && normalized.source ? normalized.source : 'launch',
  );
  if (authPayload) {
    normalized.authPayload = authPayload;
  }

  if (!normalized.search && Object.keys(normalized.query).length > 0) {
    const params = new URLSearchParams();
    Object.entries(normalized.query).forEach(([key, value]) => {
      if (key) params.set(key, value);
    });
    const text = params.toString();
    normalized.search = text ? `?${text}` : '';
  }

  if (!normalized.userId) {
    normalized.userId = normalized.query.userId || normalized.query.uid || '';
  }

  if (!normalized.uid) {
    normalized.uid = normalized.query.uid || normalized.query.userId || '';
  }

  if (
    !normalized.search &&
    !normalized.href &&
    Object.keys(normalized.query).length === 0 &&
    !normalized.userId
  ) {
    return null;
  }

  return normalized;
}

function extractAuthPayloadFromBinBase64(binBase64, sourceLabel = 'bin') {
  if (!binBase64) return null;

  try {
    const binBuffer = base64ToBuffer(binBase64);
    const binMsg = g_utils.parse(binBuffer);
    let binData = binMsg?.getData?.();
    if (!binData && binMsg?._raw) {
      binData = { ...binMsg._raw };
    }
    return normalizeAuthPayloadInput(binData, sourceLabel);
  } catch (error) {
    console.warn('⚠️ 解析 BIN 登录载荷失败', {
      source: sourceLabel,
      error: error?.message || String(error),
    });
    return null;
  }
}

function mergeLaunchContextWithBinAuth(rawLaunchContext, binBase64, sourceLabel = 'bin') {
  const normalizedLaunchContext =
    rawLaunchContext && typeof rawLaunchContext === 'object' && !Array.isArray(rawLaunchContext)
      ? { ...rawLaunchContext }
      : null;

  const existingAuthPayload = normalizeAuthPayloadInput(
    normalizedLaunchContext?.authPayload ||
      normalizedLaunchContext?.auth_payload ||
      normalizedLaunchContext,
    typeof normalizedLaunchContext?.source === 'string' && normalizedLaunchContext.source
      ? normalizedLaunchContext.source
      : sourceLabel,
  );

  if (existingAuthPayload) {
    return {
      ...(normalizedLaunchContext || {}),
      authPayload: existingAuthPayload,
    };
  }

  const binAuthPayload = extractAuthPayloadFromBinBase64(binBase64, sourceLabel);
  if (!binAuthPayload) {
    return normalizedLaunchContext;
  }

  return {
    ...(normalizedLaunchContext || {}),
    source:
      typeof normalizedLaunchContext?.source === 'string' && normalizedLaunchContext.source.trim()
        ? normalizedLaunchContext.source.trim()
        : sourceLabel,
    capturedAt:
      typeof normalizedLaunchContext?.capturedAt === 'string' && normalizedLaunchContext.capturedAt.trim()
        ? normalizedLaunchContext.capturedAt.trim()
        : new Date().toISOString(),
    authPayload: binAuthPayload,
  };
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

function persistConnectionInputsForAccount(account, userId, options = {}) {
  const requestTokenText = typeof options?.token === 'string' ? options.token.trim() : '';
  const requestWsUrlText = typeof options?.wsUrl === 'string' ? options.wsUrl.trim() : '';
  const requestBinBase64 = typeof options?.binBase64 === 'string' ? options.binBase64.trim() : '';
  const markTokenRefreshedAt = options?.markTokenRefreshedAt === true;
  if (!(requestTokenText || requestWsUrlText || requestBinBase64)) {
    return false;
  }

  const updateFields = [];
  const updateValues = [];
  if (requestTokenText) {
    const { encrypted, iv } = encrypt(requestTokenText);
    updateFields.push('token_encrypted = ?', 'token_iv = ?');
    updateValues.push(encrypted, iv);
    if (markTokenRefreshedAt) {
      updateFields.push('token_refreshed_at = ?');
      updateValues.push(new Date().toISOString());
    }
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
  updateValues.push(account.id, userId);
  run(
    `UPDATE game_accounts SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
    updateValues
  );

  return {
    persistedToken: !!requestTokenText,
    persistedBin: !!requestBinBase64,
    persistedWsUrl: !!requestWsUrlText,
  };
}

function getBinRefreshFriendlyReason(probeResult = {}) {
  if (probeResult?.refreshable) {
    return '服务器侧可自动续Token，适合长期定时任务。';
  }

  if (probeResult?.reason === 'missing-bin') {
    return '当前账号没有保存可供服务器续期的 BIN 数据。';
  }

  if (probeResult?.reason === 'timeout') {
    return '服务器侧续Token请求超时，本次无法确认 BIN 是否稳定可续。建议改用 BIN多角色导入 重新导入后再使用定时任务。';
  }

  if (probeResult?.reason === 'network-error' || probeResult?.reason === 'http-error') {
    return '服务器侧续Token请求异常，本次检测失败。建议改用 BIN多角色导入 重新导入后再使用定时任务。';
  }

  if (Number(probeResult?.code) === 200020) {
    return '当前账号可临时登录，但服务器侧无法自动续 Token。建议改用 BIN多角色导入 重新导入，这样通常可以避免后续定时任务再次掉线。';
  }

  if (probeResult?.reason === 'auth-error') {
    return '游戏服务端拒绝了这份 BIN，服务器侧无法自动续Token。建议改用 BIN多角色导入 重新导入后再使用定时任务。';
  }

  return '服务器侧当前无法用这份 BIN 自动续 Token。建议改用 BIN多角色导入 重新导入后再使用定时任务。';
}

function normalizeLineupPayload(lineup = {}) {
  const lineupId = String(lineup?.id ?? lineup?.lineupKey ?? '').trim();
  const lineupName = String(lineup?.name ?? '').trim();
  const teamId = Number(lineup?.teamId ?? lineup?.team_id ?? 1);
  const savedAt = Number(lineup?.savedAt ?? lineup?.saved_at ?? Date.now());

  if (!lineupId || !lineupName || !Number.isInteger(teamId) || teamId <= 0) {
    return null;
  }

  return {
    ...lineup,
    id: lineupId,
    name: lineupName,
    teamId,
    savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
    applying: false,
  };
}

function parseStoredLineup(row) {
  try {
    const payload = JSON.parse(row?.payload_json || '{}');
    const normalized = normalizeLineupPayload({
      ...payload,
      id: payload?.id || row?.lineup_key,
      name: payload?.name || row?.name,
      teamId: payload?.teamId ?? row?.team_id,
      savedAt: payload?.savedAt ?? row?.saved_at,
    });
    return normalized;
  } catch (error) {
    console.warn('⚠️ 解析账号阵容记录失败，已跳过', {
      accountId: Number(row?.account_id) || null,
      lineupKey: row?.lineup_key || null,
      error: error?.message || String(error || ''),
    });
    return null;
  }
}

function getOwnedAccountId(accountId, userId) {
  const normalizedAccountId = Number(accountId);
  if (!Number.isInteger(normalizedAccountId) || normalizedAccountId <= 0) {
    return null;
  }

  const account = get(
    'SELECT id FROM game_accounts WHERE id = ? AND user_id = ?',
    [normalizedAccountId, userId]
  );

  return account ? normalizedAccountId : null;
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
    const launchContext = mergeLaunchContextWithBinAuth(normalizeLaunchContextInput(req.body), binBase64, 'bin');
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
    const encryptedLaunchContext = launchContext ? encrypt(JSON.stringify(launchContext)) : null;

    let result;
    try {
      result = run(
        `INSERT INTO game_accounts (
          user_id,
          name,
          token_encrypted,
          token_iv,
          token_refreshed_at,
          bin_encrypted,
          bin_iv,
          bin_updated_at,
          launch_context_encrypted,
          launch_context_iv,
          launch_context_updated_at,
          ws_url,
          server,
          remark,
          avatar,
          import_method,
          source_url
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.userId,
          normalizedName,
          encrypted,
          iv,
          new Date().toISOString(),
          encryptedBin?.encrypted || null,
          encryptedBin?.iv || null,
          encryptedBin ? new Date().toISOString() : null,
          encryptedLaunchContext?.encrypted || null,
          encryptedLaunchContext?.iv || null,
          encryptedLaunchContext ? new Date().toISOString() : null,
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
    const launchContext = mergeLaunchContextWithBinAuth(normalizeLaunchContextInput(req.body), binBase64, 'bin');

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
      updateFields.push('token_encrypted = ?', 'token_iv = ?', 'token_refreshed_at = ?');
      updateValues.push(encrypted, iv, new Date().toISOString());
    }
    if (binBase64) {
      const { encrypted, iv } = encrypt(binBase64);
      updateFields.push('bin_encrypted = ?', 'bin_iv = ?', 'bin_updated_at = ?');
      updateValues.push(encrypted, iv, new Date().toISOString());
    }
    if (launchContext) {
      const { encrypted, iv } = encrypt(JSON.stringify(launchContext));
      updateFields.push('launch_context_encrypted = ?', 'launch_context_iv = ?', 'launch_context_updated_at = ?');
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

router.get('/:id/lineups', (req, res) => {
  try {
    const accountId = getOwnedAccountId(req.params.id, req.user.userId);
    if (!accountId) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    const rows = all(
      `SELECT id, account_id, lineup_key, name, team_id, saved_at, payload_json
       FROM account_lineups
       WHERE account_id = ?
       ORDER BY saved_at DESC, id DESC`,
      [accountId]
    );

    const lineups = rows
      .map(parseStoredLineup)
      .filter(Boolean);

    res.json({
      success: true,
      data: lineups
    });
  } catch (error) {
    console.error('获取账号阵容列表错误:', error);
    res.status(500).json({
      success: false,
      error: '获取账号阵容失败'
    });
  }
});

router.put('/:id/lineups', (req, res) => {
  try {
    const accountId = getOwnedAccountId(req.params.id, req.user.userId);
    if (!accountId) {
      return res.status(404).json({
        success: false,
        error: '账号不存在'
      });
    }

    const inputLineups = Array.isArray(req.body?.lineups) ? req.body.lineups : [];
    const normalizedLineups = inputLineups
      .map(normalizeLineupPayload)
      .filter(Boolean);

    if (normalizedLineups.length !== inputLineups.length) {
      return res.status(400).json({
        success: false,
        error: '阵容数据格式不正确'
      });
    }

    if (normalizedLineups.length > MAX_ACCOUNT_LINEUPS) {
      return res.status(400).json({
        success: false,
        error: `每个账号最多只能保存 ${MAX_ACCOUNT_LINEUPS} 套阵容`
      });
    }

    const db = getDatabase();
    const replaceLineups = db.transaction((lineups) => {
      db.run('DELETE FROM account_lineups WHERE account_id = ?', [accountId]);

      for (const lineup of lineups) {
        db.run(
          `INSERT INTO account_lineups (account_id, lineup_key, name, team_id, saved_at, payload_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [
            accountId,
            lineup.id,
            lineup.name,
            lineup.teamId,
            lineup.savedAt,
            JSON.stringify({
              ...lineup,
              applying: false,
            }),
          ]
        );
      }
    });

    replaceLineups(normalizedLineups);

    res.json({
      success: true,
      message: '账号阵容已保存',
      data: normalizedLineups
    });
  } catch (error) {
    console.error('保存账号阵容错误:', error);
    res.status(500).json({
      success: false,
      error: '保存账号阵容失败'
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

router.get('/:id/launch-payload', async (req, res) => {
  try {
    const account = get(
      `SELECT id, name, token_encrypted, token_iv, bin_encrypted, bin_iv,
              token_refreshed_at, launch_context_encrypted, launch_context_iv, ws_url, server
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

    let token = decrypt(account.token_encrypted, account.token_iv);
    let tokenSource = 'stored-token';

    const shouldRefreshFromBin = !!(account.bin_encrypted && account.bin_iv);

    if (shouldRefreshFromBin) {
      try {
        const refreshed = await refreshAccountTokenFromStoredBin(account.id, {
          trigger: 'slim-launch',
          account,
        });
        if (refreshed?.refreshed && refreshed?.token) {
          token = refreshed.token;
          tokenSource = 'refreshed-from-bin';
        }
      } catch (error) {
        console.warn('⚠️ slim 启动前 BIN 刷新 Token 失败，回退到已存 Token', {
          accountId: account.id,
          accountName: account.name || null,
          error: error?.message || String(error),
        });
      }
    }

    const binData = account.bin_encrypted && account.bin_iv
      ? decrypt(account.bin_encrypted, account.bin_iv)
      : '';
    let launchContext = null;
    if (account.launch_context_encrypted && account.launch_context_iv) {
      try {
        launchContext = JSON.parse(
          decrypt(account.launch_context_encrypted, account.launch_context_iv) || '{}'
        );
      } catch (error) {
        console.warn('⚠️ 解析账号启动上下文失败，已忽略', {
          accountId: account.id,
          error: error?.message || String(error),
        });
      }
    }
    launchContext = mergeLaunchContextWithBinAuth(launchContext, binData, 'bin');
    const authPayload =
      normalizeAuthPayloadInput(
        launchContext?.authPayload || launchContext?.auth_payload || launchContext,
        'launch',
      ) ||
      extractAuthPayloadFromBinBase64(binData, 'bin');

    res.json({
      success: true,
      data: {
        accountId: account.id,
        name: account.name || '',
        server: account.server || '',
        wsUrl: account.ws_url || '',
        token,
        tokenSource,
        binData,
        hasBin: !!binData,
        launchContext,
        authPayload,
      }
    });
  } catch (error) {
    console.error('获取 slim 启动数据错误:', error);
    res.status(500).json({
      success: false,
      error: '获取启动数据失败'
    });
  }
});

router.post('/:id/test-bin-refresh', async (req, res) => {
  try {
    let account = get(
      `SELECT id, name, token_encrypted, token_iv, token_refreshed_at, bin_encrypted, bin_iv, ws_url, server, import_method, updated_at, bin_updated_at
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

    const requestTokenText = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const requestWsUrlText = typeof req.body?.wsUrl === 'string'
      ? req.body.wsUrl.trim()
      : (typeof req.body?.ws_url === 'string' ? req.body.ws_url.trim() : '');
    const requestBinBase64 = extractBinBase64(req.body);

    if (req.body?.persist === true) {
      const persisted = persistConnectionInputsForAccount(account, req.user.userId, {
        token: requestTokenText,
        wsUrl: requestWsUrlText,
        binBase64: requestBinBase64,
        markTokenRefreshedAt: false,
      });
      if (persisted) {
        console.log('💾 后端BIN续期检测已持久化最新账号连接参数', {
          accountId: Number(account.id),
          accountName: account.name,
          importMethod: account.import_method || 'manual',
          ...persisted,
        });
        account = get(
          `SELECT id, name, token_encrypted, token_iv, token_refreshed_at, bin_encrypted, bin_iv, ws_url, server, import_method, updated_at, bin_updated_at
           FROM game_accounts
           WHERE id = ? AND user_id = ?`,
          [req.params.id, req.user.userId]
        );
      }
    }

    const probeResult = await probeAccountBinRefreshability(account.id, {
      account,
      timeoutMs: Math.max(3000, Math.min(30000, Number(req.body?.timeout) || 8000)),
    });

    const diagnostics = {
      code: probeResult?.code || null,
      reason: probeResult?.reason || null,
      error: probeResult?.error || null,
      responseBytes: probeResult?.diagnostics?.responseBytes || null,
      authUser: probeResult?.diagnostics?.authUser || null,
      bin: probeResult?.diagnostics?.bin || null,
    };
    const friendlyReason = getBinRefreshFriendlyReason(probeResult);

    if (probeResult?.refreshable) {
      console.log('🧪 BIN自动续期检测成功', {
        accountId: Number(account.id),
        accountName: account.name,
        importMethod: account.import_method || 'manual',
        diagnostics,
      });
    } else {
      console.warn('⚠️ BIN自动续期检测失败', {
        accountId: Number(account.id),
        accountName: account.name,
        importMethod: account.import_method || 'manual',
        diagnostics,
      });
    }

    return res.json({
      success: true,
      message: probeResult?.refreshable ? '服务器侧可自动续Token' : '服务器侧无法自动续Token',
      data: {
        accountId: Number(account.id),
        accountName: account.name,
        importMethod: account.import_method || 'manual',
        refreshable: !!probeResult?.refreshable,
        friendlyReason,
        code: probeResult?.code || null,
        error: probeResult?.error || null,
        reason: probeResult?.reason || null,
        checkedAt: new Date().toISOString(),
        diagnostics,
      }
    });
  } catch (error) {
    console.error('检测BIN自动续期能力错误:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || '检测BIN自动续期能力失败'
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

    if (req.body?.persist === true) {
      const persisted = persistConnectionInputsForAccount(account, req.user.userId, {
        token: requestTokenText,
        wsUrl: requestWsUrlText,
        binBase64: requestBinBase64,
        markTokenRefreshedAt: false,
      });
      if (persisted) {
        console.log('💾 后端连接测试已持久化最新账号连接参数', {
          accountId: Number(account.id),
          accountName: account.name,
          importMethod: account.import_method || 'manual',
          ...persisted,
        });
      }
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
