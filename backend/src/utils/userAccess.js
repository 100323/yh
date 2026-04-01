function parseDateTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;

  const normalized = /^\d+$/.test(text)
    ? Number(text)
    : (text.includes('T') ? text : text.replace(' ', 'T'));

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function normalizeDateTimeInput(value) {
  if (value === null || value === undefined || value === '') return null;

  const date = value instanceof Date ? value : parseDateTime(value);
  if (!date) {
    throw new Error('时间格式无效');
  }

  return date.toISOString();
}

export function getUserAvailabilityStatus(user, now = new Date()) {
  if (!user) {
    return {
      allowed: false,
      reason: '用户不存在'
    };
  }

  if (Number(user.is_enabled ?? 1) !== 1) {
    return {
      allowed: false,
      reason: '账号已被禁用'
    };
  }

  const startAt = parseDateTime(user.access_start_at);
  if (startAt && now < startAt) {
    return {
      allowed: false,
      reason: `账号将在 ${startAt.toLocaleString('zh-CN', { hour12: false })} 后可用`
    };
  }

  const endAt = parseDateTime(user.access_end_at);
  if (endAt && now > endAt) {
    return {
      allowed: false,
      reason: '账号可用时间已结束'
    };
  }

  return {
    allowed: true
  };
}

export function buildUserAccessSummary(user) {
  const status = getUserAvailabilityStatus(user);
  return {
    is_enabled: Number(user?.is_enabled ?? 1) === 1,
    access_start_at: user?.access_start_at || null,
    access_end_at: user?.access_end_at || null,
    access_allowed: status.allowed,
    access_message: status.allowed ? '可用' : status.reason
  };
}

export default {
  normalizeDateTimeInput,
  getUserAvailabilityStatus,
  buildUserAccessSummary
};
