export function extractGameToken(rawToken) {
  return parseTokenPayload(rawToken).token;
}

export function extractRoleId(rawToken) {
  return parseTokenPayload(rawToken).roleId;
}

export function parseTokenPayload(rawToken) {
  if (!rawToken) return { token: '', roleId: null, candidates: [], wsUrl: '' };

  const tokenText = String(rawToken).trim();
  if (!tokenText) return { token: '', roleId: null, candidates: [], wsUrl: '' };

  const parsed = tryParseJson(tokenText);
  if (parsed) {
    return buildTokenMeta(parsed, tokenText);
  }

  const decoded = decodeBase64Token(tokenText);
  if (decoded) {
    const decodedParsed = tryParseJson(decoded);
    if (decodedParsed) {
      return buildTokenMeta(decodedParsed, decoded, tokenText);
    }
    const candidates = dedupeTokens([decoded, tokenText]);
    return { token: candidates[0] || '', roleId: null, candidates, wsUrl: '' };
  }

  return { token: tokenText, roleId: null, candidates: [tokenText], wsUrl: '' };
}

function buildTokenMeta(parsed, rawText, fallbackText = '') {
  const roleId = normalizeRoleId(
    parsed?.roleId ?? parsed?.roleid ?? parsed?.rid ?? parsed?.uid
  );
  const wsUrl = typeof parsed?.wsUrl === 'string'
    ? parsed.wsUrl
    : (typeof parsed?.ws_url === 'string'
      ? parsed.ws_url
      : (typeof parsed?.wsURL === 'string' ? parsed.wsURL : ''));
  const candidates = dedupeTokens([
    rawText,
    parsed?.token,
    parsed?.gameToken,
    parsed?.roleToken,
    fallbackText
  ]);
  const primary = candidates[0] || '';

  return { token: primary, roleId, candidates, wsUrl };
}

function tryParseJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function decodeBase64Token(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  const cleaned = trimmed.replace(/^data:.*base64,/, '').trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned) || cleaned.length < 12) {
    return null;
  }
  try {
    const decoded = Buffer.from(cleaned, 'base64').toString('utf8').trim();
    if (!decoded) return null;
    return decoded;
  } catch {
    return null;
  }
}

function normalizeRoleId(value) {
  if (value === null || value === undefined) return null;
  const roleId = Number(value);
  if (!Number.isFinite(roleId) || roleId <= 0) return null;
  return Math.trunc(roleId);
}

function dedupeTokens(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const token = value.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}
