import jwt from '../utils/jwt.js';
import { get } from '../database/index.js';
import { getUserAvailabilityStatus } from '../utils/userAccess.js';

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: '未提供认证令牌'
    });
  }

  const token = authHeader.substring(7);
  const result = jwt.verify(token);

  if (!result.valid) {
    return res.status(401).json({
      success: false,
      error: result.error === 'Token expired' ? '令牌已过期' : '无效的令牌'
    });
  }

  const user = get(
    'SELECT id, username, role, is_enabled, access_start_at, access_end_at FROM users WHERE id = ?',
    [result.payload.userId]
  );

  if (!user) {
    return res.status(401).json({
      success: false,
      error: '用户不存在'
    });
  }

  const status = getUserAvailabilityStatus(user);
  if (!status.allowed) {
    return res.status(401).json({
      success: false,
      error: status.reason
    });
  }

  req.user = {
    userId: user.id,
    username: user.username,
    role: user.role,
    is_enabled: user.is_enabled,
    access_start_at: user.access_start_at,
    access_end_at: user.access_end_at
  };
  next();
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const result = jwt.verify(token);
    if (result.valid) {
      req.user = result.payload;
    }
  }
  
  next();
}

export function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: '需要管理员权限'
    });
  }
  next();
}

export default {
  authMiddleware,
  optionalAuth,
  adminOnly
};
