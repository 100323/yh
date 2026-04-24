import { Router } from 'express';
import { run, get, all } from '../database/index.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import jwt from '../utils/jwt.js';
import { authMiddleware } from '../middleware/auth.js';
import { validateInviteCode, useInviteCode } from './inviteCodes.js';
import { buildUserAccessSummary, getUserAvailabilityStatus } from '../utils/userAccess.js';
import { createSlimEntryTicket } from '../utils/slimEntryTicketStore.js';

const router = Router();
const PUBLIC_BROADCAST_SETTING_KEY = 'public_broadcast_current';

function parseBroadcastValue(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const title = String(parsed.title || '').trim();
    const content = String(parsed.content || '').trim();
    if (!title || !content) return null;
    return {
      id: String(parsed.id || '').trim() || null,
      title,
      content,
      createdAt: parsed.createdAt || null,
      updatedAt: parsed.updatedAt || null,
      createdBy: parsed.createdBy || null,
      createdByName: parsed.createdByName || null,
    };
  } catch {
    return null;
  }
}

router.post('/register', async (req, res) => {
  try {
    const { username, password, inviteCode } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '用户名和密码不能为空'
      });
    }

    if (!inviteCode) {
      return res.status(400).json({
        success: false,
        error: '请输入邀请码'
      });
    }

    const codeValidation = validateInviteCode(inviteCode);
    if (!codeValidation.valid) {
      return res.status(400).json({
        success: false,
        error: codeValidation.error
      });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({
        success: false,
        error: '用户名长度需要在 3-20 个字符之间'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: '密码长度至少需要 6 个字符'
      });
    }

    const existingUser = get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(409).json({
        success: false,
        error: '用户名已存在'
      });
    }

    const { hash, salt } = hashPassword(password);

    const result = run(
      'INSERT INTO users (username, password_hash, salt, role, max_game_accounts) VALUES (?, ?, ?, ?, ?)',
      [username, hash, salt, 'user', 5]
    );

    useInviteCode(inviteCode);

    const token = jwt.sign({
      userId: result.lastInsertRowid,
      username,
      role: 'user'
    });

    res.status(201).json({
      success: true,
      message: '注册成功',
      data: {
        token,
        user: {
          id: result.lastInsertRowid,
          username,
          role: 'user'
        }
      }
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({
      success: false,
      error: '注册失败'
    });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '用户名和密码不能为空'
      });
    }

    const user = get('SELECT * FROM users WHERE username = ?', [username]);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: '用户名或密码错误'
      });
    }

    if (!verifyPassword(password, user.password_hash, user.salt)) {
      return res.status(401).json({
        success: false,
        error: '用户名或密码错误'
      });
    }

    const accessStatus = getUserAvailabilityStatus(user);
    if (!accessStatus.allowed) {
      return res.status(403).json({
        success: false,
        error: accessStatus.reason
      });
    }

    run(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );

    const token = jwt.sign({
      userId: user.id,
      username: user.username,
      role: user.role
    });

    res.json({
      success: true,
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role
        }
      }
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({
      success: false,
      error: '登录失败'
    });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  try {
    const user = get(
      'SELECT id, username, role, created_at, last_login, is_enabled, access_start_at, access_end_at, max_game_accounts FROM users WHERE id = ?',
      [req.user.userId]
    );
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    res.json({
      success: true,
      data: {
        ...user,
        ...buildUserAccessSummary(user)
      }
    });
  } catch (error) {
    console.error('获取用户信息错误:', error);
    res.status(500).json({
      success: false,
      error: '获取用户信息失败'
    });
  }
});

router.get('/broadcast/current', authMiddleware, (req, res) => {
  try {
    const row = get(
      'SELECT value FROM system_settings WHERE key = ? LIMIT 1',
      [PUBLIC_BROADCAST_SETTING_KEY]
    );
    res.json({
      success: true,
      data: parseBroadcastValue(row?.value || null),
    });
  } catch (error) {
    console.error('获取当前公共通知错误:', error);
    res.status(500).json({
      success: false,
      error: '获取当前公共通知失败',
    });
  }
});

router.post('/change-password', authMiddleware, (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: '旧密码和新密码不能为空'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: '新密码长度至少需要 6 个字符'
      });
    }

    const user = get('SELECT * FROM users WHERE id = ?', [req.user.userId]);
    
    if (!verifyPassword(oldPassword, user.password_hash, user.salt)) {
      return res.status(400).json({
        success: false,
        error: '旧密码错误'
      });
    }

    const { hash, salt } = hashPassword(newPassword);
    
    run(
      'UPDATE users SET password_hash = ?, salt = ? WHERE id = ?',
      [hash, salt, req.user.userId]
    );

    res.json({
      success: true,
      message: '密码修改成功'
    });
  } catch (error) {
    console.error('修改密码错误:', error);
    res.status(500).json({
      success: false,
      error: '修改密码失败'
    });
  }
});

router.post('/logout', (_req, res) => {
  res.json({
    success: true,
    message: '退出登录成功'
  });
});
router.post('/refresh-token', authMiddleware, (req, res) => {
  try {
    const token = jwt.sign({
      userId: req.user.userId,
      username: req.user.username,
      role: req.user.role
    });

    res.json({
      success: true,
      data: { token }
    });
  } catch (error) {
    console.error('刷新令牌错误:', error);
    res.status(500).json({
      success: false,
      error: '刷新令牌失败'
    });
  }
});

router.post('/slim-entry-ticket', authMiddleware, (req, res) => {
  try {
    const { ticket, expiresInMs } = createSlimEntryTicket({
      userId: req.user.userId,
    });

    res.json({
      success: true,
      message: 'Slim 入口票据创建成功',
      data: {
        ticket,
        expiresInMs,
      },
    });
  } catch (error) {
    console.error('创建 slim 入口票据失败:', error);
    res.status(500).json({
      success: false,
      error: '创建游戏入口票据失败',
    });
  }
});

export default router;
