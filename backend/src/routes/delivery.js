import { Router } from 'express';
import crypto from 'crypto';
import { run, get } from '../database/index.js';
import { normalizeRegisteredUserAccessDays } from '../utils/inviteCodeAccess.js';

const router = Router();
const DELIVERY_CODE_LENGTH = 8;
const DELIVERY_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateInviteCode(length = DELIVERY_CODE_LENGTH) {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += DELIVERY_CODE_CHARS.charAt(Math.floor(Math.random() * DELIVERY_CODE_CHARS.length));
  }
  return code;
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function resolveCreatorUserId() {
  const admin = get(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1",
  );
  if (admin?.id) {
    return admin.id;
  }

  const user = get('SELECT id FROM users ORDER BY id ASC LIMIT 1');
  return user?.id || null;
}

function insertInviteCode({ creatorUserId, accessDays }) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = generateInviteCode();
    try {
      run(
        'INSERT INTO invite_codes (code, max_uses, created_by, registered_user_access_days) VALUES (?, ?, ?, ?)',
        [code, 1, creatorUserId, accessDays],
      );
      return code;
    } catch (error) {
      if (!String(error?.message || '').includes('UNIQUE')) {
        throw error;
      }
    }
  }

  throw new Error('failed to generate a unique invite code');
}

function buildDeliveryMessage(code) {
  const publicUrl = String(process.env.PROJECT_PUBLIC_URL || '').trim() || 'http://193.112.151.193';
  return `您的邀请码：${code}\n访问地址：${publicUrl}\n请打开访问地址完成注册使用。`;
}

router.post('/xianyu/invite-code', (req, res) => {
  try {
    const expectedSecret = String(process.env.XIAN_YU_DELIVERY_SECRET || '').trim();
    if (!expectedSecret) {
      return res.status(503).json({
        success: false,
        error: 'delivery secret is not configured',
      });
    }

    if (!timingSafeEqualString(req.body?.secret, expectedSecret)) {
      return res.status(401).json({
        success: false,
        error: 'invalid delivery secret',
      });
    }

    const accessDays = normalizeRegisteredUserAccessDays(req.body?.accessDays);
    const creatorUserId = resolveCreatorUserId();
    if (!creatorUserId) {
      return res.status(500).json({
        success: false,
        error: 'no user is available to create invite codes',
      });
    }

    const code = insertInviteCode({ creatorUserId, accessDays });
    const message = buildDeliveryMessage(code);

    return res.json({
      success: true,
      data: {
        code,
        message,
        accessDays,
        orderId: req.body?.orderId || null,
        goodsId: req.body?.goodsId || null,
        accountId: req.body?.accountId || null,
      },
    });
  } catch (error) {
    if (String(error?.message || '').includes('注册账号有效期')) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }

    console.error('Xianyu delivery invite-code failed:', error);
    return res.status(500).json({
      success: false,
      error: 'failed to create invite code',
    });
  }
});

export default router;
