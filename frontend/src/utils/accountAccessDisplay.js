const DAY_MS = 24 * 60 * 60 * 1000;

export function parseAccessDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text) return null;

  const normalized = /^\d+$/.test(text)
    ? Number(text)
    : (text.includes('T') ? text : text.replace(' ', 'T'));
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatAccessDate(value) {
  const date = parseAccessDate(value);
  if (!date) return '不限';

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatMonthDay(value) {
  const date = parseAccessDate(value);
  if (!date) return '';

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  }).format(date).replace(/\//g, '-');
}

export function buildAccountAccessDisplay(user, now = new Date()) {
  const enabled = Number(user?.is_enabled ?? 1) === 1;
  const startAt = parseAccessDate(user?.access_start_at);
  const endAt = parseAccessDate(user?.access_end_at);
  const maxGameAccounts = user?.max_game_accounts ?? user?.maxGameAccounts ?? null;

  const base = {
    username: user?.username || '未登录',
    startText: startAt ? formatAccessDate(startAt) : '不限',
    endText: endAt ? formatAccessDate(endAt) : '不限',
    maxGameAccountsText: maxGameAccounts ? `${maxGameAccounts} 个` : '不限',
  };

  if (!enabled) {
    return {
      ...base,
      headerLabel: '已禁用',
      statusText: '已禁用',
      tagType: 'danger',
    };
  }

  if (startAt && now < startAt) {
    return {
      ...base,
      headerLabel: '未开始',
      statusText: '未到开始时间',
      tagType: 'warning',
    };
  }

  if (!endAt) {
    return {
      ...base,
      headerLabel: '永久有效',
      statusText: '永久有效',
      tagType: 'success',
    };
  }

  const remainingMs = endAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return {
      ...base,
      headerLabel: '已过期',
      statusText: '已过期',
      tagType: 'danger',
    };
  }

  const remainingDays = Math.ceil(remainingMs / DAY_MS);
  if (remainingDays <= 1) {
    return {
      ...base,
      headerLabel: '今日到期',
      statusText: '24小时内到期',
      tagType: 'warning',
    };
  }

  if (remainingDays <= 7) {
    return {
      ...base,
      headerLabel: `剩余 ${remainingDays} 天`,
      statusText: `剩余 ${remainingDays} 天`,
      tagType: 'warning',
    };
  }

  return {
    ...base,
    headerLabel: `到期 ${formatMonthDay(endAt)}`,
    statusText: `可用至 ${base.endText}`,
    tagType: 'info',
  };
}
