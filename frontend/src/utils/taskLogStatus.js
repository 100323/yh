const BENIGN_LOG_KEYWORDS = [
  '活动未开放',
  '不在开启时间内',
  '出了点小问题',
  '扫荡条件不满足',
  '已经选择过上阵武将了',
  '今日已领取免费奖励',
  '今天已经签到过了',
];

export function getTaskLogDisplayStatus(log) {
  const text = `${log?.message || ''} ${log?.details || ''}`;
  if (BENIGN_LOG_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return { status: 'ignored', label: '已忽略', tone: 'info' };
  }

  const status = log?.status || 'error';
  if (status === 'success') return { status, label: '成功', tone: 'success' };
  if (status === 'ignored') return { status, label: '已忽略', tone: 'info' };
  if (status === 'missed') return { status, label: '漏做', tone: 'warning' };
  return { status: 'error', label: '失败', tone: 'danger' };
}
