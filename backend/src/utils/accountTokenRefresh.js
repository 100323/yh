import fetch from 'node-fetch';
import { g_utils } from '../../../frontend/src/utils/bonProtocol.js';
import { get, run } from '../database/index.js';
import { encrypt, decrypt } from './crypto.js';
import { base64ToBuffer } from './binStorage.js';
import { parseTokenPayload } from './token.js';

function truncateText(value, maxLength = 120) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

function parseTimestampMs(value) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function resolveAbortController() {
  return typeof AbortController === 'function' ? AbortController : null;
}

export function shouldRefreshAccountTokenFromStoredBin(account, options = {}) {
  if (!account?.bin_encrypted || !account?.bin_iv) {
    return false;
  }

  if (options.force === true) {
    return true;
  }

  const hasStoredToken = !!(account?.token_encrypted && account?.token_iv);
  if (!hasStoredToken) {
    return true;
  }

  const ttlMs = Math.max(0, Number(options.ttlMs) || 0);
  if (!ttlMs) {
    return true;
  }

  const refreshedAtMs = parseTimestampMs(account?.token_refreshed_at || account?.updated_at);
  if (!refreshedAtMs) {
    return true;
  }

  return Date.now() - refreshedAtMs >= ttlMs;
}

function buildRefreshedTokenPayload(data = {}) {
  const now = Date.now();
  const sessId = now * 100 + Math.floor(Math.random() * 100);
  const connId = now + Math.floor(Math.random() * 10);

  return JSON.stringify({
    ...data,
    sessId,
    connId,
    isRestore: 0,
  });
}

function summarizeParsedBinPayload(payload) {
  if (payload === null || payload === undefined) {
    return {
      shape: 'empty',
      keys: [],
    };
  }

  if (typeof payload !== 'object') {
    return {
      shape: typeof payload,
      keys: [],
      valuePreview: truncateText(payload, 80),
    };
  }

  const keys = Object.keys(payload).slice(0, 20);
  return {
    shape: Array.isArray(payload) ? 'array' : 'object',
    keys,
    hasCombUser: typeof payload?.combUser === 'string' || typeof payload?.data?.combUser === 'string',
    hasPlatformExt: typeof payload?.platformExt === 'string' || typeof payload?.ext === 'string',
    hasInfo: typeof payload?.info === 'string' || typeof payload?.encryptUserInfo === 'string',
    serverId: payload?.serverId ?? payload?.sid ?? payload?.realServerId ?? null,
  };
}

export function inspectBinPayload(binBase64) {
  try {
    const binBuffer = base64ToBuffer(binBase64);
    const msg = g_utils.parse(binBuffer);
    let binData = msg?.getData?.();
    if (!binData && msg?._raw !== undefined) {
      binData = msg._raw;
    }

    return {
      ok: true,
      bytes: binBuffer.byteLength,
      parsed: summarizeParsedBinPayload(binData),
    };
  } catch (error) {
    return {
      ok: false,
      bytes: 0,
      error: truncateText(error?.message || String(error), 160),
    };
  }
}

function inspectAuthUserResponse(arrayBuffer) {
  const msg = g_utils.parse(arrayBuffer);
  const data = msg?.getData?.();
  const raw = msg?._raw && typeof msg._raw === 'object' ? msg._raw : null;

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return {
      ok: true,
      responseType: 'token',
      data,
      diagnostics: {
        cmd: raw?.cmd || null,
        resp: raw?.resp ?? null,
        keys: Object.keys(data).slice(0, 20),
      },
    };
  }

  return {
    ok: false,
    responseType: 'error',
    code: Number(raw?.code) || null,
    error: truncateText(raw?.error || '', 160) || null,
    diagnostics: {
      cmd: raw?.cmd || null,
      resp: raw?.resp ?? null,
      keys: raw ? Object.keys(raw).slice(0, 20) : [],
      parsedDataShape: data === null ? 'null' : typeof data,
    },
  };
}

export async function probeBinRefreshabilityFromBinBase64(binBase64, options = {}) {
  const binBuffer = base64ToBuffer(binBase64);
  const url = new URL('https://xxz-xyzw.hortorgames.com/login/authuser');
  url.searchParams.set('_seq', '1');
  const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
  const AbortControllerCtor = resolveAbortController();
  const controller = timeoutMs && AbortControllerCtor ? new AbortControllerCtor() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: binBuffer,
      signal: controller?.signal,
    });
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (controller?.signal?.aborted) {
      return {
        refreshable: false,
        reason: 'timeout',
        error: `BIN刷新Token超时（${timeoutMs}ms）`,
        diagnostics: {
          bin: inspectBinPayload(binBase64),
        },
      };
    }

    return {
      refreshable: false,
      reason: 'network-error',
      error: truncateText(error?.message || String(error), 160),
      diagnostics: {
        bin: inspectBinPayload(binBase64),
      },
    };
  }

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return {
      refreshable: false,
      reason: 'http-error',
      httpStatus: response.status,
      error: `BIN刷新Token失败: HTTP ${response.status}`,
      diagnostics: {
        bin: inspectBinPayload(binBase64),
      },
    };
  }

  const arrayBuffer = await response.arrayBuffer();
  let inspected;
  try {
    inspected = inspectAuthUserResponse(arrayBuffer);
  } catch (error) {
    return {
      refreshable: false,
      reason: 'parse-error',
      error: `BIN刷新Token失败: 响应解析异常 (${truncateText(error?.message || String(error), 120)})`,
      diagnostics: {
        responseBytes: arrayBuffer.byteLength,
        bin: inspectBinPayload(binBase64),
      },
    };
  }

  if (inspected.ok) {
    return {
      refreshable: true,
      token: buildRefreshedTokenPayload(inspected.data),
      data: inspected.data,
      diagnostics: {
        responseBytes: arrayBuffer.byteLength,
        authUser: inspected.diagnostics,
        bin: inspectBinPayload(binBase64),
      },
    };
  }

  return {
    refreshable: false,
    reason: 'auth-error',
    code: inspected.code,
    error: inspected.error || 'BIN刷新Token失败: 响应解析为空',
    diagnostics: {
      responseBytes: arrayBuffer.byteLength,
      authUser: inspected.diagnostics,
      bin: inspectBinPayload(binBase64),
    },
  };
}

export async function transformTokenFromBinBase64(binBase64, options = {}) {
  const result = await probeBinRefreshabilityFromBinBase64(binBase64, options);
  if (result?.refreshable && result?.token) {
    return result.token;
  }

  if (result?.code) {
    throw new Error(`BIN刷新Token失败: ${result.code}${result.error ? ` ${result.error}` : ''}`);
  }

  throw new Error(result?.error || 'BIN刷新Token失败: 响应解析为空');
}

export async function probeAccountBinRefreshability(accountId, options = {}) {
  const numericAccountId = Number(accountId);
  if (!Number.isInteger(numericAccountId) || numericAccountId <= 0) {
    throw new Error('无效的账号ID');
  }

  const account = options.account && Number(options.account?.id) === numericAccountId
    ? options.account
    : get(
      `SELECT id, name, token_encrypted, token_iv, token_refreshed_at, bin_encrypted, bin_iv, import_method, updated_at, bin_updated_at
       FROM game_accounts
       WHERE id = ?`,
      [numericAccountId]
    );

  if (!account) {
    throw new Error('账号不存在');
  }

  if (!account.bin_encrypted || !account.bin_iv) {
    return {
      refreshable: false,
      reason: 'missing-bin',
      account,
      error: '账号未保存BIN数据',
      diagnostics: {
        bin: null,
      },
    };
  }

  const binBase64 = decrypt(account.bin_encrypted, account.bin_iv);
  const result = await probeBinRefreshabilityFromBinBase64(binBase64, options);

  return {
    ...result,
    account,
  };
}

export async function refreshAccountTokenFromStoredBin(accountId, options = {}) {
  const numericAccountId = Number(accountId);
  if (!Number.isInteger(numericAccountId) || numericAccountId <= 0) {
    throw new Error('无效的账号ID');
  }

  const account = options.account && Number(options.account?.id) === numericAccountId
    ? options.account
    : get(
      `SELECT id, name, token_encrypted, token_iv, token_refreshed_at, bin_encrypted, bin_iv, import_method, updated_at, bin_updated_at
     FROM game_accounts
     WHERE id = ?`,
      [numericAccountId]
    );

  if (!account) {
    throw new Error('账号不存在');
  }

  if (!account.bin_encrypted || !account.bin_iv) {
    return {
      refreshed: false,
      reason: 'missing-bin',
      account,
      token: account.token_encrypted && account.token_iv
        ? decrypt(account.token_encrypted, account.token_iv)
        : '',
    };
  }

  const probeResult = await probeAccountBinRefreshability(numericAccountId, {
    ...options,
    account,
  });
  if (!probeResult?.refreshable || !probeResult?.token) {
    if (probeResult?.code) {
      throw new Error(`BIN刷新Token失败: ${probeResult.code}${probeResult.error ? ` ${probeResult.error}` : ''}`);
    }
    throw new Error(probeResult?.error || 'BIN刷新Token失败: 响应解析为空');
  }

  const token = probeResult.token;
  const { encrypted, iv } = encrypt(token);

  run(
    `UPDATE game_accounts
     SET token_encrypted = ?, token_iv = ?, token_refreshed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [encrypted, iv, numericAccountId]
  );

  console.log('♻️ 已通过后端持久化BIN刷新账号Token', {
    accountId: numericAccountId,
    accountName: account.name || null,
    importMethod: account.import_method || null,
    trigger: options.trigger || null,
    previousUpdatedAt: account.updated_at || null,
    previousTokenRefreshedAt: account.token_refreshed_at || null,
    binUpdatedAt: account.bin_updated_at || null,
  });

  return {
    refreshed: true,
    token,
    account,
  };
}

export async function getRefreshedTokenSessionFromStoredBin(accountId, options = {}) {
  const refreshed = await refreshAccountTokenFromStoredBin(accountId, options);
  if (!refreshed?.refreshed || !refreshed?.token) {
    return {
      ...refreshed,
      refreshed: false,
      tokenMeta: null,
      candidates: [],
      roleId: null,
      wsUrl: options.currentWsUrl || '',
    };
  }

  const tokenMeta = parseTokenPayload(refreshed.token);
  const candidates = tokenMeta.candidates?.length
    ? tokenMeta.candidates
    : [tokenMeta.token].filter(Boolean);

  return {
    ...refreshed,
    tokenMeta,
    candidates,
    roleId: tokenMeta.roleId ?? null,
    wsUrl: options.currentWsUrl || tokenMeta.wsUrl || '',
  };
}
