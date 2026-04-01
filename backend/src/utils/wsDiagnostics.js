import crypto from 'crypto';

export function truncate(value, maxLength = 120) {
  const text = String(value || '');
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

export function summarizeHeaders(headers = {}, maxEntries = 12) {
  if (!headers || typeof headers !== 'object') {
    return {};
  }

  const preferredKeys = [
    'server',
    'content-type',
    'content-length',
    'cf-cache-status',
    'cf-ray',
    'location',
    'set-cookie',
    'sec-websocket-accept',
    'sec-websocket-version',
    'www-authenticate',
    'x-powered-by',
  ];

  const entries = [];
  const pushEntry = (key) => {
    if (!key || entries.length >= maxEntries) {
      return;
    }
    const value = headers[key];
    if (value === undefined) {
      return;
    }
    entries.push([
      key,
      Array.isArray(value)
        ? value.map((item) => truncate(item, 120))
        : truncate(value, 160),
    ]);
  };

  preferredKeys.forEach(pushEntry);

  Object.keys(headers).forEach((key) => {
    if (entries.length >= maxEntries || preferredKeys.includes(key)) {
      return;
    }
    pushEntry(key);
  });

  return Object.fromEntries(entries);
}

export function getTokenFingerprint(token) {
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) {
    return {
      length: 0,
      preview: 'empty',
      hash: 'empty'
    };
  }

  return {
    length: raw.length,
    preview: raw.length > 24
      ? `${raw.slice(0, 12)}...${raw.slice(-8)}`
      : raw,
    hash: crypto.createHash('sha1').update(raw).digest('hex').slice(0, 12)
  };
}

export function summarizeWsUrl(wsUrl) {
  const raw = typeof wsUrl === 'string' ? wsUrl.trim() : '';
  if (!raw) {
    return {
      provided: false,
      mode: 'default'
    };
  }

  try {
    const url = new URL(raw);
    const queryKeys = [...url.searchParams.keys()].filter((key) => key !== 'p');
    return {
      provided: true,
      origin: url.origin,
      path: url.pathname,
      hasTokenParam: url.searchParams.has('p'),
      queryKeys
    };
  } catch {
    const [pathPart, queryPart = ''] = raw.split('?');
    const queryKeys = queryPart
      .split('&')
      .map((item) => item.split('=')[0]?.trim())
      .filter((key) => key && key !== 'p');

    return {
      provided: true,
      raw: truncate(pathPart, 120),
      hasTokenParam: queryPart.includes('p='),
      queryKeys
    };
  }
}

export function normalizeDisconnectInfo(disconnectInfo) {
  if (!disconnectInfo) {
    return null;
  }

  return {
    code: Number(disconnectInfo.code) || 0,
    reason: truncate(disconnectInfo.reason || '', 120)
  };
}

export function normalizeErrorMessage(error) {
  if (!error) {
    return '未知错误';
  }

  if (error instanceof Error) {
    return error.message || error.name || '未知错误';
  }

  return String(error);
}

export function buildWsLogContext(context = {}) {
  const {
    accountId,
    accountName,
    roleId,
    importMethod,
    updatedAt,
    attempt,
    maxRetries,
    candidateIndex,
    candidateCount,
    token,
    wsUrl,
    extra = {},
  } = context;

  return {
    accountId: accountId ?? null,
    accountName: accountName || null,
    roleId: roleId ?? null,
    importMethod: importMethod || null,
    updatedAt: updatedAt || null,
    attempt: attempt ?? null,
    maxRetries: maxRetries ?? null,
    candidateIndex: candidateIndex ?? null,
    candidateCount: candidateCount ?? null,
    token: getTokenFingerprint(token),
    ws: summarizeWsUrl(wsUrl),
    ...extra,
  };
}
