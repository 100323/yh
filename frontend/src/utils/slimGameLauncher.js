const SLIM_GAME_PATH = '/slim-game/index.html';
const SLIM_GAME_ENTRY_PATH = '/slim-game/entry';
const SLIM_LAUNCH_STORAGE_PREFIX = 'xyzw-slim-launch:';
const SLIM_LAUNCH_TTL_MS = 15 * 60 * 1000;
const SLIM_LAST_ACCOUNT_KEY = 'xyzw-slim-launch-account';
const SLIM_RECENT_ACCOUNTS_KEY = 'xyzw-slim-launch-accounts';
const SLIM_RECENT_ACCOUNTS_LIMIT = 10;

function getSafeStorage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

function toCleanString(value) {
  return String(value ?? '').trim();
}

function normalizeBase64(base64Text) {
  return toCleanString(base64Text).replace(/\s+/g, '');
}

function base64ToHex(base64Text) {
  const normalized = normalizeBase64(base64Text);
  if (!normalized) return '';

  try {
    const binary = atob(normalized);
    let hex = '';
    for (let index = 0; index < binary.length; index += 1) {
      hex += binary.charCodeAt(index).toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    return '';
  }
}

function normalizeSearchText(searchText) {
  const text = toCleanString(searchText);
  if (!text) return '';
  return text.startsWith('?') ? text : `?${text}`;
}

function tryParseJsonString(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeAuthPayload(rawPayload = null) {
  if (!rawPayload) return null;

  let payload = rawPayload;
  if (typeof payload === 'string') {
    const text = payload.trim();
    if (!text) return null;
    try {
      payload = JSON.parse(text);
    } catch {
      return null;
    }
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const candidates = [
    payload,
    payload.authPayload,
    payload.auth_payload,
    payload.loginPayload,
    payload.login_payload,
    payload.data,
    payload.rawData,
    payload.result,
    payload.payload,
  ].filter(Boolean);

  for (const item of candidates) {
    const info = tryParseJsonString(
      pickFirstDefined(item.info, item.authInfo, item.encryptUserInfo, item.userInfo, item.loginInfo),
    );
    const platformExt = pickFirstDefined(item.platformExt, item.platform_ext, item.ext);
    const serverIdRaw = pickFirstDefined(item.serverId, item.serverID, item.sid, item.realServerId);
    const serverId =
      serverIdRaw === null || serverIdRaw === undefined || serverIdRaw === ''
        ? null
        : Number(serverIdRaw);

    if (platformExt && info && (serverId === null || Number.isFinite(serverId))) {
      return {
        platform: toCleanString(item.platform || 'hortor'),
        platformExt: toCleanString(platformExt),
        info,
        serverId,
        scene: Number.isFinite(Number(item.scene)) ? Number(item.scene) : 0,
        referrerInfo: toCleanString(item.referrerInfo),
        type: toCleanString(item.type || 'launch'),
      };
    }
  }

  return null;
}

function normalizeLaunchContext(launchContext = null) {
  if (!launchContext || typeof launchContext !== 'object' || Array.isArray(launchContext)) {
    return null;
  }

  const query =
    launchContext.query && typeof launchContext.query === 'object' && !Array.isArray(launchContext.query)
      ? Object.fromEntries(
          Object.entries(launchContext.query)
            .map(([key, value]) => [toCleanString(key), toCleanString(value)])
            .filter(([key]) => key),
        )
      : {};

  let search = normalizeSearchText(launchContext.search);
  if (!search && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      params.set(key, value);
    });
    const queryText = params.toString();
    search = queryText ? `?${queryText}` : '';
  }

  return {
    href: toCleanString(launchContext.href),
    origin: toCleanString(launchContext.origin),
    pathname: toCleanString(launchContext.pathname),
    search,
    hash: toCleanString(launchContext.hash),
    query,
    userId:
      toCleanString(launchContext.userId) ||
      toCleanString(launchContext.uid) ||
      toCleanString(query.userId) ||
      toCleanString(query.uid),
    uid:
      toCleanString(launchContext.uid) ||
      toCleanString(launchContext.userId) ||
      toCleanString(query.uid) ||
      toCleanString(query.userId),
    platform: toCleanString(launchContext.platform),
    platformExt: toCleanString(launchContext.platformExt),
    source: toCleanString(launchContext.source),
    capturedAt: toCleanString(launchContext.capturedAt),
  };
}

function pruneExpiredSlimLaunches(storage) {
  if (!storage) return;

  const now = Date.now();

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key || !key.startsWith(SLIM_LAUNCH_STORAGE_PREFIX)) continue;

    try {
      const payload = JSON.parse(storage.getItem(key) || '{}');
      const createdAt = Number(payload?.createdAt || 0);
      if (!createdAt || now - createdAt > SLIM_LAUNCH_TTL_MS) {
        storage.removeItem(key);
      }
    } catch {
      storage.removeItem(key);
    }
  }
}

function createLaunchKey(accountId) {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return `${SLIM_LAUNCH_STORAGE_PREFIX}${toCleanString(accountId) || 'unknown'}:${suffix}`;
}

function createLaunchPayload(account = {}) {
  const launchContext = normalizeLaunchContext(account.launchContext);
  const authPayload = normalizeAuthPayload(account.authPayload || launchContext?.authPayload || launchContext);
  return {
    accountId: toCleanString(account.id),
    name: toCleanString(account.name),
    server: toCleanString(account.server),
    wsUrl: toCleanString(account.wsUrl),
    token: toCleanString(account.token),
    binData: toCleanString(account.binData),
    userId:
      toCleanString(account.userId) ||
      toCleanString(account.uid) ||
      toCleanString(launchContext?.userId) ||
      toCleanString(launchContext?.uid),
    launchContext,
    authPayload,
    createdAt: Date.now(),
  };
}

function buildStoredAccountRecord(account = {}, createdAt = Date.now()) {
  const accountId = toCleanString(account.id);
  const name = toCleanString(account.name);
  const server = toCleanString(account.server);
  const wsUrl = toCleanString(account.wsUrl);
  const token = toCleanString(account.token);
  const binBase64 = normalizeBase64(account.binData);
  const binHex = base64ToHex(binBase64);
  const fileNameBase = name || server || accountId || 'account';

  return {
    accountId,
    name,
    server,
    wsUrl,
    token,
    userId:
      toCleanString(account.userId) ||
      toCleanString(account.uid) ||
      toCleanString(account.launchContext?.userId) ||
      toCleanString(account.launchContext?.uid),
    createdAt,
    fileName: `${fileNameBase}.bin`,
    binBase64,
    binHex,
    content: binHex,
    contentEncoding: binHex ? 'hex' : (binBase64 ? 'base64' : ''),
    hasBin: !!binBase64,
  };
}

function persistStableSlimLaunchAccount(storage, account = {}) {
  if (!storage) return;

  const record = buildStoredAccountRecord(account);

  try {
    storage.setItem(SLIM_LAST_ACCOUNT_KEY, JSON.stringify(record));

    const currentList = JSON.parse(storage.getItem(SLIM_RECENT_ACCOUNTS_KEY) || '[]');
    const recentAccounts = Array.isArray(currentList) ? currentList : [];
    const deduped = recentAccounts.filter((item) => {
      const currentId = toCleanString(item?.accountId || item?.id);
      return currentId && currentId !== record.accountId;
    });

    deduped.unshift(record);
    storage.setItem(
      SLIM_RECENT_ACCOUNTS_KEY,
      JSON.stringify(deduped.slice(0, SLIM_RECENT_ACCOUNTS_LIMIT)),
    );
  } catch {
    // ignore localStorage quota / serialization failures
  }
}

function buildSlimGameUrl(launchKey, account = {}, options = {}) {
  const slimEntryTicket = toCleanString(account.slimEntryTicket);
  const url = new URL(slimEntryTicket ? SLIM_GAME_ENTRY_PATH : SLIM_GAME_PATH, window.location.origin);
  const sessionId = toCleanString(options.sessionId);
  const embed = options.embed === true || options.embed === '1';

  url.searchParams.set('launchKey', launchKey);

  if (embed) {
    url.searchParams.set('embed', '1');
  }

  if (sessionId) {
    url.searchParams.set('sessionId', sessionId);
  }

  if (slimEntryTicket) {
    url.searchParams.set('ticket', slimEntryTicket);
  }

  return url.toString();
}

export function prepareSlimGameLaunch(account = {}, options = {}) {
  const payload = createLaunchPayload(account);
  if (!payload.token) {
    throw new Error('当前账号缺少可用 Token，无法进入游戏');
  }

  const storage = getSafeStorage();
  if (!storage) {
    throw new Error('当前浏览器无法访问本地存储，无法进入游戏');
  }

  pruneExpiredSlimLaunches(storage);
  persistStableSlimLaunchAccount(storage, payload);

  const launchKey = createLaunchKey(payload.accountId);
  storage.setItem(launchKey, JSON.stringify(payload));

  const launchUrl = buildSlimGameUrl(launchKey, account, options);

  return {
    launchKey,
    launchUrl,
    payload,
    sessionId: toCleanString(options.sessionId),
    openedInNewWindow: false,
  };
}

export function openSlimGameWithAccount(account = {}, options = {}) {
  const prepared = prepareSlimGameLaunch(account, options);
  const anchor = document.createElement('a');
  anchor.href = prepared.launchUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  return {
    ...prepared,
    openedInNewWindow: true,
  };
}

export { SLIM_GAME_PATH, SLIM_LAUNCH_STORAGE_PREFIX, SLIM_LAUNCH_TTL_MS };
