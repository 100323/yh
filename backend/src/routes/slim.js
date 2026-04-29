import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

const DEFAULT_PLATFORM = 'hortor';
const DEFAULT_VERSION = '0.32.0-ios';
const MANIFEST_ORIGIN = 'https://xxz-xyzw.hortorgames.com';
const MANIFEST_PATH = '/login/manifest';
const CACHE_TTL_MS = 30 * 1000;

let manifestCache = null;

function normalizeString(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeManifestPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const body = payload.body && typeof payload.body === 'object' ? payload.body : payload;
  const rawBundleVers = body.bundleVers;
  const bundleVers = typeof rawBundleVers === 'string'
    ? parseJsonText(rawBundleVers)
    : rawBundleVers;

  if (!bundleVers || typeof bundleVers !== 'object') {
    return null;
  }

  const codeVersion = typeof body.codeVersion === 'string' && body.codeVersion
    ? body.codeVersion
    : typeof bundleVers.codeVersion === 'string'
      ? bundleVers.codeVersion
      : '';

  return {
    bundleVers,
    codeVersion,
    dataVers: typeof body.dataVers === 'string' ? body.dataVers : '',
    dataBundleVer: typeof body.dataBundleVer === 'string' ? body.dataBundleVer : '',
    serverUrl: typeof body.serverUrl === 'string' ? body.serverUrl : '',
    battleVersion: body.battleVersion ?? null,
    raw: payload,
  };
}

function buildManifestUrl(req) {
  const platform = encodeURIComponent(normalizeString(req.query.platform, DEFAULT_PLATFORM));
  const version = encodeURIComponent(normalizeString(req.query.version, DEFAULT_VERSION));
  return `${MANIFEST_ORIGIN}${MANIFEST_PATH}?platform=${platform}&version=${version}`;
}

async function loadUpstreamManifest(req) {
  const upstreamUrl = buildManifestUrl(req);
  const response = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 12; WebView) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Mobile Safari/537.36',
    },
    body: '',
  });

  const text = await response.text();
  const parsed = parseJsonText(text);
  const normalized = normalizeManifestPayload(parsed);

  if (!response.ok) {
    throw new Error(`manifest upstream HTTP ${response.status}`);
  }

  if (!normalized) {
    throw new Error(`manifest upstream returned invalid payload: ${text.slice(0, 80)}`);
  }

  return {
    ...normalized,
    upstreamUrl,
    fetchedAt: new Date().toISOString(),
  };
}

async function handleManifest(req, res) {
  try {
    const bypassCache = String(req.query.force || '') === '1';
    const cacheKey = `${normalizeString(req.query.platform, DEFAULT_PLATFORM)}:${normalizeString(req.query.version, DEFAULT_VERSION)}`;

    if (!bypassCache && manifestCache && manifestCache.key === cacheKey && Date.now() - manifestCache.cachedAt < CACHE_TTL_MS) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      return res.json({
        success: true,
        via: 'cache',
        ...manifestCache.data,
      });
    }

    const data = await loadUpstreamManifest(req);
    manifestCache = {
      key: cacheKey,
      cachedAt: Date.now(),
      data,
    };

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.json({
      success: true,
      via: 'upstream-post',
      ...data,
    });
  } catch (error) {
    console.error('slim manifest proxy failed:', error);
    return res.status(502).json({
      success: false,
      error: error?.message || 'manifest proxy failed',
    });
  }
}

router.get('/manifest', handleManifest);
router.post('/manifest', handleManifest);

export default router;
