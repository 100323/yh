import { Router } from 'express';
import { run, get, all } from '../database/index.js';
import { authMiddleware, adminOnly } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

function generateInviteCode(length = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

router.post('/generate', authMiddleware, adminOnly, (req, res) => {
  try {
    const { maxUses = 1, expiresInDays } = req.body;

    if (maxUses < 1 || maxUses > 1000) {
      return res.status(400).json({
        success: false,
        error: '使用次数限制范围为1-1000'
      });
    }

    const code = generateInviteCode();
    
    let expiresAt = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    }

    const result = run(
      'INSERT INTO invite_codes (code, max_uses, created_by, expires_at) VALUES (?, ?, ?, ?)',
      [code, maxUses, req.user.userId, expiresAt]
    );

    res.status(201).json({
      success: true,
      data: {
        id: result.lastInsertRowid,
        code,
        maxUses,
        usedCount: 0,
        expiresAt,
        createdAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('生成邀请码错误:', error);
    res.status(500).json({
      success: false,
      error: '生成邀请码失败'
    });
  }
});

router.post('/batch-generate', authMiddleware, adminOnly, (req, res) => {
  try {
    const { count = 1, maxUses = 1, expiresInDays } = req.body;

    if (count < 1 || count > 100) {
      return res.status(400).json({
        success: false,
        error: '批量生成数量范围为1-100'
      });
    }

    if (maxUses < 1 || maxUses > 1000) {
      return res.status(400).json({
        success: false,
        error: '使用次数限制范围为1-1000'
      });
    }

    let expiresAt = null;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
    }

    const codes = [];
    for (let i = 0; i < count; i++) {
      const code = generateInviteCode();
      const result = run(
        'INSERT INTO invite_codes (code, max_uses, created_by, expires_at) VALUES (?, ?, ?, ?)',
        [code, maxUses, req.user.userId, expiresAt]
      );
      codes.push({
        id: result.lastInsertRowid,
        code,
        maxUses,
        usedCount: 0,
        expiresAt
      });
    }

    res.status(201).json({
      success: true,
      data: codes
    });
  } catch (error) {
    console.error('批量生成邀请码错误:', error);
    res.status(500).json({
      success: false,
      error: '批量生成邀请码失败'
    });
  }
});

router.get('/list', authMiddleware, adminOnly, (req, res) => {
  try {
    const codes = all(`
      SELECT ic.*, u.username as created_by_name
      FROM invite_codes ic
      LEFT JOIN users u ON ic.created_by = u.id
      ORDER BY ic.created_at DESC
    `);

    res.json({
      success: true,
      data: codes.map(code => ({
        ...code,
        is_active: code.is_active === 1,
        remainingUses: code.max_uses - code.used_count,
        isExpired: code.expires_at && new Date(code.expires_at) < new Date(),
        isValid: code.is_active === 1 && 
                 (!code.expires_at || new Date(code.expires_at) >= new Date()) && 
                 code.used_count < code.max_uses
      }))
    });
  } catch (error) {
    console.error('获取邀请码列表错误:', error);
    res.status(500).json({
      success: false,
      error: '获取邀请码列表失败'
    });
  }
});

router.delete('/:id', authMiddleware, adminOnly, (req, res) => {
  try {
    const { id } = req.params;

    const code = get('SELECT * FROM invite_codes WHERE id = ?', [id]);
    if (!code) {
      return res.status(404).json({
        success: false,
        error: '邀请码不存在'
      });
    }

    run('DELETE FROM invite_codes WHERE id = ?', [id]);

    res.json({
      success: true,
      message: '邀请码已删除'
    });
  } catch (error) {
    console.error('删除邀请码错误:', error);
    res.status(500).json({
      success: false,
      error: '删除邀请码失败'
    });
  }
});

router.put('/:id/toggle', authMiddleware, adminOnly, (req, res) => {
  try {
    const { id } = req.params;

    const code = get('SELECT * FROM invite_codes WHERE id = ?', [id]);
    if (!code) {
      return res.status(404).json({
        success: false,
        error: '邀请码不存在'
      });
    }

    const newStatus = code.is_active === 1 ? 0 : 1;
    run('UPDATE invite_codes SET is_active = ? WHERE id = ?', [newStatus, id]);

    res.json({
      success: true,
      message: newStatus === 1 ? '邀请码已启用' : '邀请码已禁用'
    });
  } catch (error) {
    console.error('切换邀请码状态错误:', error);
    res.status(500).json({
      success: false,
      error: '切换邀请码状态失败'
    });
  }
});

export function validateInviteCode(code) {
  if (!code) {
    return { valid: false, error: '请输入邀请码' };
  }

  const inviteCode = get('SELECT * FROM invite_codes WHERE code = ?', [code]);

  if (!inviteCode) {
    return { valid: false, error: '邀请码不存在' };
  }

  if (inviteCode.is_active !== 1) {
    return { valid: false, error: '邀请码已被禁用' };
  }

  if (inviteCode.expires_at && new Date(inviteCode.expires_at) < new Date()) {
    return { valid: false, error: '邀请码已过期' };
  }

  if (inviteCode.used_count >= inviteCode.max_uses) {
    return { valid: false, error: '邀请码已达到使用上限' };
  }

  return { valid: true, inviteCode };
}

export function useInviteCode(code) {
  run(
    'UPDATE invite_codes SET used_count = used_count + 1 WHERE code = ?',
    [code]
  );
}

export default router;
