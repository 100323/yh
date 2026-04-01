import fetch from 'node-fetch';
import { g_utils } from '../../../frontend/src/utils/bonProtocol.js';
import { get, run } from '../database/index.js';
import { encrypt, decrypt } from './crypto.js';
import { base64ToBuffer } from './binStorage.js';
import { parseTokenPayload } from './token.js';

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

export async function transformTokenFromBinBase64(binBase64) {
  const binBuffer = base64ToBuffer(binBase64);
  const url = new URL('https://xxz-xyzw.hortorgames.com/login/authuser');
  url.searchParams.set('_seq', '1');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: binBuffer,
  });

  if (!response.ok) {
    throw new Error(`BIN刷新Token失败: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const msg = g_utils.parse(arrayBuffer);
  const data = msg?.getData?.();

  if (!data || typeof data !== 'object') {
    throw new Error('BIN刷新Token失败: 响应解析为空');
  }

  return buildRefreshedTokenPayload(data);
}

export async function refreshAccountTokenFromStoredBin(accountId, options = {}) {
  const numericAccountId = Number(accountId);
  if (!Number.isInteger(numericAccountId) || numericAccountId <= 0) {
    throw new Error('无效的账号ID');
  }

  const account = get(
    `SELECT id, name, token_encrypted, token_iv, bin_encrypted, bin_iv, import_method, updated_at, bin_updated_at
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

  const binBase64 = decrypt(account.bin_encrypted, account.bin_iv);
  const token = await transformTokenFromBinBase64(binBase64);
  const { encrypted, iv } = encrypt(token);

  run(
    `UPDATE game_accounts
     SET token_encrypted = ?, token_iv = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [encrypted, iv, numericAccountId]
  );

  console.log('♻️ 已通过后端持久化BIN刷新账号Token', {
    accountId: numericAccountId,
    accountName: account.name || null,
    importMethod: account.import_method || null,
    trigger: options.trigger || null,
    previousUpdatedAt: account.updated_at || null,
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
