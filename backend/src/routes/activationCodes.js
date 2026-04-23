import crypto from 'crypto';
import { Router } from 'express';
import { all, get, getDatabase, run } from '../database/index.js';
import { adminOnly, authMiddleware } from '../middleware/auth.js';

const router = Router();
const publicActivationRoutes = Router();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_BATCH_LIMIT = 100;

function nowIso() {
  return new Date().toISOString();
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase();
}

function normalizeFingerprint(deviceFingerprint) {
  return String(deviceFingerprint || '').trim();
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function resolveActivationRequestValue(req, ...keys) {
  const body = req?.body && typeof req.body === 'object' ? req.body : {};
  const query = req?.query && typeof req.query === 'object' ? req.query : {};
  const params = req?.params && typeof req.params === 'object' ? req.params : {};

  const candidates = [];
  for (const key of keys) {
    candidates.push(body?.[key], query?.[key], params?.[key]);
  }

  return pickFirstNonEmpty(...candidates);
}

function resolveActivationCodeFromRequest(req) {
  return normalizeCode(
    resolveActivationRequestValue(
      req,
      'code',
      'activationCode',
      'activation_code',
      'inviteCode',
      'invite_code',
    ),
  );
}

function resolveDeviceFingerprintFromRequest(req) {
  return normalizeFingerprint(
    resolveActivationRequestValue(
      req,
      'deviceFingerprint',
      'device_fingerprint',
      'fingerprint',
      'deviceId',
      'device_id',
      'deviceUniqueId',
      'device_unique_id',
      'distinctId',
      'distinct_id',
      'did',
      'androidId',
      'android_id',
    ),
  );
}

function resolveDeviceNameFromRequest(req) {
  return String(
    resolveActivationRequestValue(
      req,
      'deviceName',
      'device_name',
      'model',
      'brandModel',
      'brand_model',
    ),
  ).trim();
}

function resolveAppVersionFromRequest(req) {
  return String(
    resolveActivationRequestValue(
      req,
      'appVersion',
      'app_version',
      'version',
      'clientVersion',
      'client_version',
    ),
  ).trim();
}

function clampPositiveInteger(value, { min = 1, max = 1000, fallback = min, label = '数值' } = {}) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < min || normalized > max) {
    throw new Error(`${label}范围为${min}-${max}`);
  }
  return normalized;
}

function resolveExpiresAt(rawExpiresAt, rawExpiresInDays) {
  if (rawExpiresAt) {
    const date = new Date(rawExpiresAt);
    if (Number.isNaN(date.getTime())) {
      throw new Error('过期时间格式不正确');
    }
    return date.toISOString();
  }

  if (rawExpiresInDays === undefined || rawExpiresInDays === null || rawExpiresInDays === '') {
    return null;
  }

  const expiresInDays = Number(rawExpiresInDays);
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 3650) {
    throw new Error('有效期天数范围为1-3650');
  }

  return new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
}

function generateActivationCode() {
  let raw = '';
  for (let index = 0; index < 16; index += 1) {
    raw += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
  }
  return raw.match(/.{1,4}/g).join('-');
}

function createUniqueActivationCode(targetDb) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = generateActivationCode();
    const exists = targetDb.get('SELECT id FROM activation_codes WHERE code = ?', [code]);
    if (!exists) {
      return code;
    }
  }

  return `${crypto.randomBytes(8).toString('hex').slice(0, 16).toUpperCase().match(/.{1,4}/g).join('-')}`;
}

function isExpired(expiresAt) {
  return Boolean(expiresAt) && new Date(expiresAt).getTime() < Date.now();
}

function serializeActivationCode(row) {
  const activeBindingCount = Number(row.active_binding_count ?? row.bound_count ?? 0);
  const maxBindings = Number(row.max_bindings ?? 0);
  const remainingBindings = Math.max(0, maxBindings - activeBindingCount);
  const expired = isExpired(row.expires_at);
  const enabled = Number(row.is_active) === 1;

  return {
    ...row,
    is_active: enabled,
    max_bindings: maxBindings,
    active_binding_count: activeBindingCount,
    remainingBindings,
    isExpired: expired,
    isValid: enabled && !expired && remainingBindings > 0,
  };
}

function serializeBinding(row) {
  return {
    ...row,
    is_active: Number(row.is_active) === 1,
  };
}

function getActiveBindingCount(targetDb, activationCodeId) {
  return Number(
    targetDb.get(
      'SELECT COUNT(*) AS count FROM activation_code_bindings WHERE activation_code_id = ? AND is_active = 1',
      [activationCodeId],
    )?.count || 0,
  );
}

function syncBoundCount(targetDb, activationCodeId) {
  const activeBindingCount = getActiveBindingCount(targetDb, activationCodeId);
  targetDb.run(
    'UPDATE activation_codes SET bound_count = ?, updated_at = ? WHERE id = ?',
    [activeBindingCount, nowIso(), activationCodeId],
  );
  return activeBindingCount;
}

function validateActivationCodeForPublic(codeRow) {
  if (!codeRow) {
    return { success: false, status: 404, error: '激活码不存在' };
  }
  if (Number(codeRow.is_active) !== 1) {
    return { success: false, status: 403, error: '激活码已禁用' };
  }
  if (isExpired(codeRow.expires_at)) {
    return { success: false, status: 403, error: '激活码已过期' };
  }
  return { success: true };
}

function performActivation({ code, deviceFingerprint, deviceName, appVersion }) {
  const transaction = getDatabase().transaction((payload) => {
    const normalizedCode = normalizeCode(payload.code);
    const normalizedFingerprint = normalizeFingerprint(payload.deviceFingerprint);
    const normalizedDeviceName = String(payload.deviceName || '').trim().slice(0, 120);
    const normalizedAppVersion = String(payload.appVersion || '').trim().slice(0, 60);
    const timestamp = nowIso();

    const activationCode = get(
      'SELECT * FROM activation_codes WHERE code = ?',
      [normalizedCode],
    );

    const validation = validateActivationCodeForPublic(activationCode);
    if (!validation.success) {
      return validation;
    }

    const existingBinding = get(
      `SELECT *
       FROM activation_code_bindings
       WHERE activation_code_id = ? AND device_fingerprint = ? AND is_active = 1
       ORDER BY id DESC
       LIMIT 1`,
      [activationCode.id, normalizedFingerprint],
    );

    if (existingBinding) {
      run(
        `UPDATE activation_code_bindings
         SET last_check_at = ?, device_name = ?, app_version = ?
         WHERE id = ?`,
        [timestamp, normalizedDeviceName || existingBinding.device_name, normalizedAppVersion || existingBinding.app_version, existingBinding.id],
      );
      const activeBindingCount = syncBoundCount(getDatabase(), activationCode.id);
      return {
        success: true,
        status: 200,
        data: {
          status: 'activated',
          code: normalizedCode,
          deviceAuthorized: true,
          activeBindingCount,
          maxBindings: Number(activationCode.max_bindings || 0),
        },
      };
    }

    const activeBindingCount = syncBoundCount(getDatabase(), activationCode.id);
    if (activeBindingCount >= Number(activationCode.max_bindings || 0)) {
      return {
        success: false,
        status: 403,
        error: '激活码已达到绑定上限',
      };
    }

    const insertResult = run(
      `INSERT INTO activation_code_bindings (
        activation_code_id,
        device_fingerprint,
        device_name,
        app_version,
        activated_at,
        last_check_at,
        is_active
      ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [activationCode.id, normalizedFingerprint, normalizedDeviceName || null, normalizedAppVersion || null, timestamp, timestamp],
    );

    const nextBoundCount = activeBindingCount + 1;
    run(
      'UPDATE activation_codes SET bound_count = ?, updated_at = ? WHERE id = ?',
      [nextBoundCount, timestamp, activationCode.id],
    );

    return {
      success: true,
      status: 200,
      data: {
        status: 'activated',
        code: normalizedCode,
        deviceAuthorized: true,
        bindingId: insertResult.lastInsertRowid,
        activeBindingCount: nextBoundCount,
        maxBindings: Number(activationCode.max_bindings || 0),
      },
    };
  });

  return transaction({ code, deviceFingerprint, deviceName, appVersion });
}

function performVerification({ code, deviceFingerprint }) {
  const transaction = getDatabase().transaction((payload) => {
    const normalizedCode = normalizeCode(payload.code);
    const normalizedFingerprint = normalizeFingerprint(payload.deviceFingerprint);
    const timestamp = nowIso();

    const activationCode = get('SELECT * FROM activation_codes WHERE code = ?', [normalizedCode]);
    const validation = validateActivationCodeForPublic(activationCode);
    if (!validation.success) {
      return validation;
    }

    const activeBinding = get(
      `SELECT *
       FROM activation_code_bindings
       WHERE activation_code_id = ? AND device_fingerprint = ? AND is_active = 1
       ORDER BY id DESC
       LIMIT 1`,
      [activationCode.id, normalizedFingerprint],
    );

    if (!activeBinding) {
      return {
        success: false,
        status: 403,
        error: '当前设备未授权',
      };
    }

    run(
      'UPDATE activation_code_bindings SET last_check_at = ? WHERE id = ?',
      [timestamp, activeBinding.id],
    );

    const activeBindingCount = syncBoundCount(getDatabase(), activationCode.id);

    return {
      success: true,
      status: 200,
      data: {
        status: 'verified',
        code: normalizedCode,
        deviceAuthorized: true,
        activeBindingCount,
        maxBindings: Number(activationCode.max_bindings || 0),
      },
    };
  });

  return transaction({ code, deviceFingerprint });
}

router.use(authMiddleware, adminOnly);

router.get('/list', (req, res) => {
  try {
    const codes = all(`
      SELECT
        ac.*,
        u.username AS created_by_name,
        COALESCE(binding_stats.active_binding_count, 0) AS active_binding_count
      FROM activation_codes ac
      LEFT JOIN users u ON ac.created_by = u.id
      LEFT JOIN (
        SELECT activation_code_id, COUNT(*) AS active_binding_count
        FROM activation_code_bindings
        WHERE is_active = 1
        GROUP BY activation_code_id
      ) binding_stats ON binding_stats.activation_code_id = ac.id
      ORDER BY datetime(ac.created_at) DESC, ac.id DESC
    `);

    res.json({
      success: true,
      data: codes.map(serializeActivationCode),
    });
  } catch (error) {
    console.error('获取激活码列表错误:', error);
    res.status(500).json({
      success: false,
      error: '获取激活码列表失败',
    });
  }
});

router.post('/generate', (req, res) => {
  try {
    const maxBindings = clampPositiveInteger(req.body?.maxBindings, {
      min: 1,
      max: 1000,
      fallback: 1,
      label: '绑定次数',
    });
    const expiresAt = resolveExpiresAt(req.body?.expiresAt, req.body?.expiresInDays);
    const remark = String(req.body?.remark || '').trim().slice(0, 200) || null;
    const timestamp = nowIso();
    const code = createUniqueActivationCode(getDatabase());

    const result = run(
      `INSERT INTO activation_codes (
        code,
        max_bindings,
        bound_count,
        created_by,
        created_at,
        updated_at,
        expires_at,
        remark,
        is_active
      ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, 1)`,
      [code, maxBindings, req.user.userId, timestamp, timestamp, expiresAt, remark],
    );

    res.status(201).json({
      success: true,
      data: serializeActivationCode({
        id: result.lastInsertRowid,
        code,
        max_bindings: maxBindings,
        bound_count: 0,
        active_binding_count: 0,
        created_by: req.user.userId,
        created_by_name: req.user.username,
        created_at: timestamp,
        updated_at: timestamp,
        expires_at: expiresAt,
        remark,
        is_active: 1,
      }),
    });
  } catch (error) {
    console.error('生成激活码错误:', error);
    res.status(/范围|格式/.test(String(error?.message || '')) ? 400 : 500).json({
      success: false,
      error: error.message || '生成激活码失败',
    });
  }
});

router.post('/batch-generate', (req, res) => {
  try {
    const count = clampPositiveInteger(req.body?.count, {
      min: 1,
      max: DEFAULT_BATCH_LIMIT,
      fallback: 10,
      label: '批量生成数量',
    });
    const maxBindings = clampPositiveInteger(req.body?.maxBindings, {
      min: 1,
      max: 1000,
      fallback: 1,
      label: '绑定次数',
    });
    const expiresAt = resolveExpiresAt(req.body?.expiresAt, req.body?.expiresInDays);
    const remarkPrefix = String(req.body?.remarkPrefix || '').trim().slice(0, 160);
    const timestamp = nowIso();
    const createdCodes = [];

    const transaction = getDatabase().transaction(() => {
      for (let index = 0; index < count; index += 1) {
        const code = createUniqueActivationCode(getDatabase());
        const remark = remarkPrefix ? `${remarkPrefix}${index + 1}` : null;
        const result = run(
          `INSERT INTO activation_codes (
            code,
            max_bindings,
            bound_count,
            created_by,
            created_at,
            updated_at,
            expires_at,
            remark,
            is_active
          ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, 1)`,
          [code, maxBindings, req.user.userId, timestamp, timestamp, expiresAt, remark],
        );

        createdCodes.push(serializeActivationCode({
          id: result.lastInsertRowid,
          code,
          max_bindings: maxBindings,
          bound_count: 0,
          active_binding_count: 0,
          created_by: req.user.userId,
          created_by_name: req.user.username,
          created_at: timestamp,
          updated_at: timestamp,
          expires_at: expiresAt,
          remark,
          is_active: 1,
        }));
      }
    });

    transaction();

    res.status(201).json({
      success: true,
      data: createdCodes,
    });
  } catch (error) {
    console.error('批量生成激活码错误:', error);
    res.status(/范围|格式/.test(String(error?.message || '')) ? 400 : 500).json({
      success: false,
      error: error.message || '批量生成激活码失败',
    });
  }
});

router.get('/:id/bindings', (req, res) => {
  try {
    const activationCode = get(
      'SELECT id, code FROM activation_codes WHERE id = ?',
      [req.params.id],
    );

    if (!activationCode) {
      return res.status(404).json({
        success: false,
        error: '激活码不存在',
      });
    }

    const bindings = all(
      `SELECT
         acb.*,
         u.username AS unbound_by_name
       FROM activation_code_bindings acb
       LEFT JOIN users u ON acb.unbound_by = u.id
       WHERE acb.activation_code_id = ?
       ORDER BY acb.is_active DESC, datetime(acb.activated_at) DESC, acb.id DESC`,
      [req.params.id],
    );

    res.json({
      success: true,
      data: {
        activationCode,
        bindings: bindings.map(serializeBinding),
      },
    });
  } catch (error) {
    console.error('获取激活码绑定列表错误:', error);
    res.status(500).json({
      success: false,
      error: '获取绑定设备列表失败',
    });
  }
});

router.put('/:id/toggle', (req, res) => {
  try {
    const activationCode = get('SELECT * FROM activation_codes WHERE id = ?', [req.params.id]);
    if (!activationCode) {
      return res.status(404).json({
        success: false,
        error: '激活码不存在',
      });
    }

    const nextStatus = Number(activationCode.is_active) === 1 ? 0 : 1;
    run(
      'UPDATE activation_codes SET is_active = ?, updated_at = ? WHERE id = ?',
      [nextStatus, nowIso(), req.params.id],
    );

    res.json({
      success: true,
      message: nextStatus === 1 ? '激活码已启用' : '激活码已禁用',
    });
  } catch (error) {
    console.error('切换激活码状态错误:', error);
    res.status(500).json({
      success: false,
      error: '切换激活码状态失败',
    });
  }
});

router.post('/:id/unbind/:bindingId', (req, res) => {
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 200) || null;

    const transaction = getDatabase().transaction(() => {
      const activationCode = get('SELECT * FROM activation_codes WHERE id = ?', [req.params.id]);
      if (!activationCode) {
        return { success: false, status: 404, error: '激活码不存在' };
      }

      const binding = get(
        'SELECT * FROM activation_code_bindings WHERE id = ? AND activation_code_id = ?',
        [req.params.bindingId, req.params.id],
      );

      if (!binding) {
        return { success: false, status: 404, error: '绑定记录不存在' };
      }

      if (Number(binding.is_active) !== 1) {
        return { success: false, status: 400, error: '该绑定已失效，无需重复清绑' };
      }

      run(
        `UPDATE activation_code_bindings
         SET is_active = 0, unbound_at = ?, unbound_by = ?, unbind_reason = ?
         WHERE id = ?`,
        [nowIso(), req.user.userId, reason, req.params.bindingId],
      );

      const activeBindingCount = syncBoundCount(getDatabase(), Number(req.params.id));
      return {
        success: true,
        status: 200,
        data: { activeBindingCount },
      };
    });

    const result = transaction();
    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        error: result.error,
      });
    }

    res.json({
      success: true,
      message: '设备绑定已清除',
      data: result.data,
    });
  } catch (error) {
    console.error('清绑激活设备错误:', error);
    res.status(500).json({
      success: false,
      error: '清绑失败',
    });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const transaction = getDatabase().transaction(() => {
      const activationCode = get('SELECT * FROM activation_codes WHERE id = ?', [req.params.id]);
      if (!activationCode) {
        return { success: false, status: 404, error: '激活码不存在' };
      }

      run('DELETE FROM activation_code_bindings WHERE activation_code_id = ?', [req.params.id]);
      run('DELETE FROM activation_codes WHERE id = ?', [req.params.id]);
      return { success: true };
    });

    const result = transaction();
    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        error: result.error,
      });
    }

    res.json({
      success: true,
      message: '激活码已删除',
    });
  } catch (error) {
    console.error('删除激活码错误:', error);
    res.status(500).json({
      success: false,
      error: '删除激活码失败',
    });
  }
});

function handlePublicActivate(req, res) {
  try {
    const code = resolveActivationCodeFromRequest(req);
    const deviceFingerprint = resolveDeviceFingerprintFromRequest(req);
    const deviceName = resolveDeviceNameFromRequest(req);
    const appVersion = resolveAppVersionFromRequest(req);

    if (!code) {
      return res.status(400).json({
        success: false,
        error: '请输入激活码',
      });
    }

    if (!deviceFingerprint) {
      console.warn('激活接口缺少设备标识', {
        bodyKeys: Object.keys(req.body || {}),
        queryKeys: Object.keys(req.query || {}),
      });
      return res.status(400).json({
        success: false,
        error: '缺少设备标识',
      });
    }

    const result = performActivation({ code, deviceFingerprint, deviceName, appVersion });
    res.status(result.status).json(result.success ? { success: true, data: result.data } : { success: false, error: result.error });
  } catch (error) {
    console.error('公开激活接口错误:', error);
    res.status(500).json({
      success: false,
      error: '激活失败，请稍后重试',
    });
  }
}

function handlePublicVerify(req, res) {
  try {
    const code = resolveActivationCodeFromRequest(req);
    const deviceFingerprint = resolveDeviceFingerprintFromRequest(req);

    if (!code) {
      return res.status(400).json({
        success: false,
        error: '请输入激活码',
      });
    }

    if (!deviceFingerprint) {
      console.warn('校验接口缺少设备标识', {
        bodyKeys: Object.keys(req.body || {}),
        queryKeys: Object.keys(req.query || {}),
      });
      return res.status(400).json({
        success: false,
        error: '缺少设备标识',
      });
    }

    const result = performVerification({ code, deviceFingerprint });
    res.status(result.status).json(result.success ? { success: true, data: result.data } : { success: false, error: result.error });
  } catch (error) {
    console.error('公开校验接口错误:', error);
    res.status(500).json({
      success: false,
      error: '校验失败，请稍后重试',
    });
  }
}

publicActivationRoutes.post('/activate', handlePublicActivate);
publicActivationRoutes.get('/activate', handlePublicActivate);
publicActivationRoutes.post('/verify', handlePublicVerify);
publicActivationRoutes.get('/verify', handlePublicVerify);

export { publicActivationRoutes };
export default router;
