/**
 * 任务失败的「可忽略」关键字单一来源。
 *
 * 命中该列表的失败会被视为**业务态**而非故障，产生两个效果：
 *   1. 执行结果记为 `ignored`（而非 `error`），错误率统计不受污染；
 *   2. 补偿链路视其为 **terminal**（见 scheduler/index.js 的
 *      `isTerminalCatchupErrorMessage`），**不再重试补做**。
 *
 * ⚠️ 新增关键字前必须确认：该失败是否真的「重试也没用」。
 *    加进本列表 == 主动放弃这类任务的补偿机会。
 *    如果失败是「用户操作后即可恢复」（例如需要重新登录、重新进入某功能），
 *    则不应加入本列表，否则会永久漏做。
 *
 * 历史：本列表原先在 `scheduler/index.js` 与 `batchScheduler/index.js` 各有一份
 * 逐字重复的副本，`routes/stats.js` 还有一份子集，导致新增关键字时容易漏改。
 * 现统一到此处。
 */
export const IGNORED_FAILURE_KEYWORDS = [
  '模块未开启',
  '活动未开放',
  '不在开启时间内',
  '不在蟠桃大会报名时间内',
  '不在盐场报名时间内',
  '出了点小问题',
  '扫荡条件不满足',
  '已经选择过上阵武将了',
  '今日已领取免费奖励',
  '今天已经签到过了',
  '冷却时间未过',
  '物品不存在',
  // 赛季切换期间残卷收取不可做，重进游戏也不改变，重试无意义（LEGACY_CLAIM 高频命中）
  '新赛季已开启',
];

export function shouldIgnoreFailure(error) {
  const message = String(error?.message || '');
  return IGNORED_FAILURE_KEYWORDS.some((keyword) => message.includes(keyword));
}

export default shouldIgnoreFailure;
