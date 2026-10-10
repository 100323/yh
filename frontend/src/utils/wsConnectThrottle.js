/**
 * WebSocket 连接频率闸门
 *
 * 逆向依据（咸鱼之王 0.32.0）：
 *
 *   A. 客户端自保护 FixO4eConnectErr（game/index.9cc7e.js @3128944 附近）
 *
 *      function s () { this.limit = 30; this.timeStamps = new Set() }
 *
 *      s.prototype._onWSConnected = function () {
 *        var e = this.timeStamps;
 *        e.add(DateUtil.serverTime);
 *        console.warn("ws connected:", e.size);
 *        this._checkLimit(Array.from(e));
 *      };
 *
 *      s.prototype._checkLimit = function (e) {
 *        var i = this.limit;                       // 30
 *        if (e.length < i) return;
 *        var last = e.length - 1, back = e.length - i;
 *        if (e[last] - e[back] < DateUtil.MinuteDuration) {   // 60000ms
 *          this.timeStamps.clear();
 *          LoginManager.instance.exitWhenNetClose = true;      // 主动退出游戏
 *          NetworkManager.close();
 *        }
 *      };
 *
 *      → 官方语义：**60 秒内建立第 30 条 WS 连接就会被判定为异常并主动断网退出**。
 *        开关位：C_SwitchId.NotFixWsMaskFlag（配置里可关掉这个自保护）。
 *
 *   B. 服务端封禁码（AuthUserError）
 *
 *      IPisBan        = -10008   ← IP 被封（本项目线上遇到的就是这个）
 *      RoleIsBan      = -10007
 *      ServerIsClose  = -10009
 *      RoleCntMax     = -10010
 *      Freeze         = 200600
 *      LoginInfoExpire= 200550
 *      DeleteFreezeRole = 200610
 *      ParamError     = 200020
 *
 *   C. 重连退避（LoginManager._tryReLogin）
 *
 *      delay = _tryReLoginTimes > 10 ? 60 * _tryReLoginMaxTimes : _tryReLoginMaxTimes
 *      → 前 10 次 1s 一次，之后退到 60s 一次
 *
 *   D. @o4e/core rpc 默认参数
 *
 *      connectTimeoutTotal: 1e4, connectTimeoutOnce: 3e3,
 *      connectRetryMinInterval: 1e3, heartbeatInterval: 5e3,
 *      heartbeatTimeout: 1e4, maxSendOnce: 10, maxRecvOnce: 10
 *      （启动期被覆写为 connectTimeoutTotal: 2e4, connectTimeoutOnce: 1e4）
 *
 * 本模块把这套规则做成一个可复用的闸门，**主动把连接频率压到官方阈值以下**，
 * 避免触发 A 的自保护，也避免触发 B 的 IP 封禁。
 */

/** 官方自保护阈值：60s 窗口内 30 次连接即自杀 */
export const OFFICIAL_CONNECT_LIMIT = 30;
export const OFFICIAL_CONNECT_WINDOW_MS = 60 * 1000;

/**
 * 前端默认取官方阈值的 ~93%（28）。
 *
 * 与后端不同，前端这个闸门**不是限速器，而是安全网**：
 * 正常用户一次进战场只建 1 条 WS，重连走 1s×10 → 60s 退避，
 * 一分钟内根本到不了 28 次。只有客户端出现重连风暴时才会触发，
 * 那时宁可拒绝建连也不能让浏览器撞上官方 30 次/分钟的自杀逻辑。
 */
export const DEFAULT_CONNECT_LIMIT = 28;
export const DEFAULT_CONNECT_WINDOW_MS = 60 * 1000;

/** 前端单次等待上限；超时后 fail-closed（返回 false），由调用方提示用户 */
export const DEFAULT_MAX_WAIT_MS = 15 * 1000;

/** 服务端鉴权错误码（来自 AuthUserError 枚举） */
export const AUTH_USER_ERROR = Object.freeze({
  IPisBan: -10008,
  RoleIsBan: -10007,
  ServerIsClose: -10009,
  RoleCntMax: -10010,
  Freeze: 200600,
  LoginInfoExpire: 200550,
  DeleteFreezeRole: 200610,
  ParamError: 200020,
});

/** 判断某个错误码是否为「IP 被封」 */
export function isIpBanned(code) {
  return Number(code) === AUTH_USER_ERROR.IPisBan;
}

/** 判断某个错误码是否为「账号/IP 级封禁类」错误（需要停止重连并等待） */
export function isBanLikeError(code) {
  const n = Number(code);
  return (
    n === AUTH_USER_ERROR.IPisBan ||
    n === AUTH_USER_ERROR.RoleIsBan ||
    n === AUTH_USER_ERROR.ServerIsClose ||
    n === AUTH_USER_ERROR.RoleCntMax
  );
}

/**
 * 连接频率闸门（滑动窗口计数器）
 *
 * 用法：
 *   const gate = getWsConnectThrottle();
 *   await gate.acquire('legionwar');        // 需要时自动等待
 *   const ws = new WebSocket(url);          // 建立连接
 *   gate.record('legionwar');               // 记录一次成功连接
 */
export class WsConnectThrottle {
  constructor(options = {}) {
    this.windowMs = Math.max(1000, Number(options.windowMs) || DEFAULT_CONNECT_WINDOW_MS);
    this.limit = Math.max(1, Number(options.limit) || DEFAULT_CONNECT_LIMIT);
    // maxWaitMs=0 是合法值（表示「不等待」），不能用 `||` 回落
    const rawMaxWait = options.maxWaitMs;
    this.maxWaitMs = (rawMaxWait === undefined || rawMaxWait === null)
      ? DEFAULT_MAX_WAIT_MS
      : Math.max(0, Number(rawMaxWait) || 0);
    /** @type {Map<string, number[]>} key → 时间戳数组 */
    this.buckets = new Map();
  }

  _prune(key, now = Date.now()) {
    const list = this.buckets.get(key);
    if (!list || !list.length) return [];
    const cutoff = now - this.windowMs;
    let idx = 0;
    while (idx < list.length && list[idx] <= cutoff) idx++;
    if (idx > 0) list.splice(0, idx);
    return list;
  }

  /** 当前窗口内已用次数 */
  used(key = 'global') {
    return this._prune(key).length;
  }

  /** 是否还能立即连接 */
  canConnect(key = 'global') {
    return this.used(key) < this.limit;
  }

  /** 距离下一次可用还需等待多少毫秒（0 表示可以立即连） */
  waitMs(key = 'global', now = Date.now()) {
    const list = this._prune(key, now);
    if (list.length < this.limit) return 0;
    const oldest = list[list.length - this.limit];
    return Math.max(0, oldest + this.windowMs - now + 1);
  }

  /**
   * 记录一次连接**尝试**。
   *
   * 计「尝试」而不是「成功」：官方自保护在 `_onWSConnected` 里 add 时间戳，
   * 而服务端侧的计数包含握手失败，所以建连前就记账更保守也更贴近真实。
   */
  record(key = 'global', at = Date.now()) {
    const list = this.buckets.get(key) || [];
    list.push(at);
    this.buckets.set(key, list);
    this._prune(key, at);
    return list.length;
  }

  /**
   * 等待到允许连接为止。
   *
   * 不做跨调用串行化：串行化会让 N 个并发调用排成队列（第 N 个要等 N×maxWaitMs），
   * 反而制造雪崩。限速只需保证「窗口内不超过 limit」，而 waitMs() 已经做到了。
   *
   * @param {string} key
   * @param {{ signal?: AbortSignal, maxWaitMs?: number }} [options]
   * @returns {Promise<boolean>} true=可以连接；false=超过 maxWaitMs 仍无空位
   */
  async acquire(key = 'global', options = {}) {
    const { signal, maxWaitMs = this.maxWaitMs } = options;
    const deadline = Date.now() + Math.max(0, maxWaitMs);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) return false;

      const delay = this.waitMs(key);
      if (delay <= 0) return true;

      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;

      await sleep(Math.min(delay, remaining, 1000));
    }
  }

  /** 清空某个 key（或全部）的计数 */
  reset(key) {
    if (key === undefined) {
      this.buckets.clear();
      return;
    }
    this.buckets.delete(key);
  }

  /** 快照，便于日志/UI */
  snapshot(key = 'global') {
    return {
      key,
      used: this.used(key),
      limit: this.limit,
      windowMs: this.windowMs,
      waitMs: this.waitMs(key),
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/** 进程内单例：主服连接与战场连接共用同一 IP 配额 */
let sharedThrottle = null;

/**
 * 取全局连接闸门（按 IP 计，所以主服 + 战场必须共用同一个实例）
 *
 * @param {object} [options] 仅首次调用时生效
 * @returns {WsConnectThrottle}
 */
export function getWsConnectThrottle(options) {
  if (!sharedThrottle) {
    const limit = Number(options?.limit);
    const windowMs = Number(options?.windowMs);
    const maxWaitMs = Number(options?.maxWaitMs);
    sharedThrottle = new WsConnectThrottle({
      limit: Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_CONNECT_LIMIT,
      windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_CONNECT_WINDOW_MS,
      maxWaitMs: Number.isFinite(maxWaitMs) && maxWaitMs > 0 ? maxWaitMs : DEFAULT_MAX_WAIT_MS,
    });
  }
  return sharedThrottle;
}

/**
 * 官方同款重连退避：前 10 次 1s，之后 60s
 * @param {number} attempt 第几次重连（从 1 开始）
 * @param {object} [options]
 * @returns {number} 延迟毫秒
 */
export function reconnectBackoffMs(attempt, options = {}) {
  const fastRetries = Number(options.fastRetries) || 10;
  const fastMs = Number(options.fastMs) || 1000;
  const slowMs = Number(options.slowMs) || 60000;
  const n = Math.max(1, Number(attempt) || 1);
  return n > fastRetries ? slowMs : fastMs;
}

export default {
  OFFICIAL_CONNECT_LIMIT,
  OFFICIAL_CONNECT_WINDOW_MS,
  DEFAULT_CONNECT_LIMIT,
  DEFAULT_CONNECT_WINDOW_MS,
  DEFAULT_MAX_WAIT_MS,
  AUTH_USER_ERROR,
  isIpBanned,
  isBanLikeError,
  WsConnectThrottle,
  getWsConnectThrottle,
  reconnectBackoffMs,
};
