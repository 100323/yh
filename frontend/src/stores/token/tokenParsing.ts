export const extractTokenFromPayload = (payload: any): string => {
  if (payload == null) {
    return '';
  }

  if (typeof payload === 'string') {
    return payload.trim();
  }

  if (typeof payload === 'object') {
    const candidates = [
      payload.actualToken,
      payload.token,
      payload.gameToken,
      payload.p,
      payload.data?.actualToken,
      payload.data?.token,
      payload.data?.gameToken,
      payload.body?.token,
    ];

    for (const candidate of candidates) {
      const value = String(candidate || '').trim();
      if (value) {
        return value;
      }
    }
  }

  return '';
};

export const validateToken = (token: string) => (
  String(token || '').trim().length >= 16
);

export const parseBase64Token = (tokenString: string) => {
  const raw = String(tokenString || '').trim();
  if (!raw) {
    return { success: false, error: 'token is empty' };
  }

  const direct = raw.replace(/^token:/i, '').trim();

  try {
    const parsed = JSON.parse(direct);
    const actualToken = extractTokenFromPayload(parsed);
    if (validateToken(actualToken)) {
      return { success: true, data: { actualToken, decoded: parsed } };
    }
  } catch {
    // ignore
  }

  try {
    const cleanBase64 = direct.replace(/^data:.*base64,/, '').trim();
    const decoded = atob(cleanBase64);

    try {
      const parsed = JSON.parse(decoded);
      const actualToken = extractTokenFromPayload(parsed) || decoded.trim();
      if (validateToken(actualToken)) {
        return { success: true, data: { actualToken, decoded: parsed } };
      }
    } catch {
      const actualToken = decoded.trim();
      if (validateToken(actualToken)) {
        return { success: true, data: { actualToken, decoded } };
      }
    }
  } catch {
    // ignore
  }

  if (validateToken(direct)) {
    return { success: true, data: { actualToken: direct, decoded: direct } };
  }

  return { success: false, error: 'unable to parse token' };
};
