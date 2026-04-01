import { Router } from 'express';
import { run, get, all } from '../database/index.js';
import { hashPassword, verifyPassword } from '../utils/crypto.js';
import jwt from '../utils/jwt.js';
import { authMiddleware } from '../middleware/auth.js';
import { validateInviteCode, useInviteCode } from './inviteCodes.js';
import { buildUserAccessSummary, getUserAvailabilityStatus } from '../utils/userAccess.js';

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { username, password, inviteCode } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖'
      });
    }

    if (!inviteCode) {
      return res.status(400).json({
        success: false,
        error: '璇疯緭鍏ラ個璇风爜'
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
        error: '鐢ㄦ埛鍚嶅凡瀛樺湪'
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
      message: '娉ㄥ唽鎴愬姛',
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
    console.error('娉ㄥ唽閿欒:', error);
    res.status(500).json({
      success: false,
      error: '娉ㄥ唽澶辫触'
    });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖'
      });
    }

    const user = get('SELECT * FROM users WHERE username = ?', [username]);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        error: '鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒'
      });
    }

    if (!verifyPassword(password, user.password_hash, user.salt)) {
      return res.status(401).json({
        success: false,
        error: '鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒'
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
      message: '鐧诲綍鎴愬姛',
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
    console.error('鐧诲綍閿欒:', error);
    res.status(500).json({
      success: false,
      error: '鐧诲綍澶辫触'
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
    console.error('鑾峰彇鐢ㄦ埛淇℃伅閿欒:', error);
    res.status(500).json({
      success: false,
      error: '鑾峰彇鐢ㄦ埛淇℃伅澶辫触'
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
      return res.status(401).json({
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
      message: '瀵嗙爜淇敼鎴愬姛'
    });
  } catch (error) {
    console.error('淇敼瀵嗙爜閿欒:', error);
    res.status(500).json({
      success: false,
      error: '淇敼瀵嗙爜澶辫触'
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
    console.error('鍒锋柊浠ょ墝閿欒:', error);
    res.status(500).json({
      success: false,
      error: '鍒锋柊浠ょ墝澶辫触'
    });
  }
});

export default router;

