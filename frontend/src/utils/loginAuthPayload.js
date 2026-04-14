function toCleanString(value) {
  return String(value ?? '').trim();
}

function pickFirstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
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

export function normalizeLoginAuthPayload(rawPayload = null, sourceLabel = 'launch') {
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
    payload.data?.data,
    payload.data?.rawData,
    payload.meta?.data,
  ].filter(Boolean);

  for (const item of candidates) {
    const combUser = tryParseJsonString(pickFirstDefined(item?.combUser, item?.data?.combUser));
    if (combUser) {
      return {
        platform: 'hortor',
        platformExt: toCleanString(pickFirstDefined(item?.platformExt, item?.platform_ext, item?.ext, 'mix')) || 'mix',
        info: combUser,
        serverId: null,
        scene: 0,
        referrerInfo: '',
        type: sourceLabel,
      };
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
        platform: toCleanString(pickFirstDefined(item?.platform, 'hortor')) || 'hortor',
        platformExt: toCleanString(platformExt),
        info,
        serverId,
        scene: Number.isFinite(Number(item?.scene)) ? Number(item.scene) : 0,
        referrerInfo: toCleanString(item?.referrerInfo),
        type: toCleanString(item?.type || sourceLabel) || sourceLabel,
      };
    }
  }

  return null;
}

export function buildLaunchContextFromAuthPayload(rawPayload = null, source = 'launch') {
  const authPayload = normalizeLoginAuthPayload(rawPayload, source);
  if (!authPayload) return null;

  return {
    source,
    capturedAt: new Date().toISOString(),
    authPayload,
  };
}
