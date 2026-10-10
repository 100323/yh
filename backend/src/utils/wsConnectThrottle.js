/**
 * 后端 WebSocket 连接频率闸门
 *
 * 逆向依据（咸鱼之王 0.32.0 客户端）：
 *
 *   1) 客户端自保护 FixO4eConnectErr：
 *        60 秒内建立第 30 条 WS 连接 → 主动断网退出游戏
 *        （开关位 C_SwitchId.NotFixWsMaskFlag 可关闭该自保护）
 *
 *   2) 服务端封禁码 AuthUserError：
 *        IPisBan         = -10008   ← IP 被封
 *        RoleIsBan       = -10007
 *        ServerIsClose   = -10009
 *        RoleCntMax      = -10010
 *
 *   3) @o4e/core rpc 默认参数：
 *        connectTimeoutTotal 1e4 / connectTimeoutOnce 3e3
 *        connectRetryMinInterval 1e3 / heartbeatInterval 5e3 / heartbeatTimeout 1e4
 *
 * 后端批量跑账号时，所有出站连接默认共用同一个出口 IP，
 * 因此必须把「单位时间内的建连次数」压到官方阈值之下，
 * 否则会同时触发客户端自保护和 IPisBan。
 *
 * 关键设计：按 **出口 IP（代理）分桶**。走代理的账号各自独立计数，
 * 直连（direct）的账号共用服务器公网 IP 的配额——这正是线上
 * 「39 次 direct vs 58 次 proxy」里 direct 那部分的风险来源。
 */

/** 官方自保护阈值 */
export const OFFICIAL_CONNECT_LIMIT = 30;
export const OFFICIAL_CONNECT_WINDOW_MS = 60 * 1000;

/** 默认取官方阈值 80%，留余量 */
export const DEFAULT_CONNECT_LIMIT = 24;
export const DEFAULT_CONNECT_WINDOW_MS = 60 * 1000;

/**
 * 单次等待上限（毫秒）。
 *
 * 这是本模块最重要的安全阀：闸门**只延迟、不阻断**。
 * 超时后 fail-open（放行 + 打警告），绝不抛异常、绝不让任务挂死。
 * 即使闸门误判，最坏结果也只是建连速率略高于 limit，
 * 而 limit 本身已取官方自杀阈值(30)的 80%，仍有安全余量。
 */
export const DEFAULT_MAX_WAIT_MS = 30 * 1000;

/** 服务端鉴权错误码 */
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

export function isIpBanned(code) {
  return Number(code) === AUTH_USER_ERROR.IPisBan;
}

export function isBanLikeError(code) {
  const n = Number(code);
  return (
    n === AUTH_USER_ERROR.IPisBan ||
    n === AUTH_USER_ERROR.RoleIsBan ||
    n === AUTH_USER_ERROR.ServerIsClose ||
    n === AUTH_USER_ERROR.RoleCntMax
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export class WsConnectThrottle {
  constructor(options = {}) {
    this.windowMs = Math.max(1000, Number(options.windowMs) || DEFAULT_CONNECT_WINDOW_MS);
    this.limit = Math.max(1, Number(options.limit) || DEFAULT_CONNECT_LIMIT);
    // 注意不能用 `Number(x) || 默认值`：maxWaitMs=0 是合法值（表示「不等待」），
    // 用 || 会被当成 falsy 而回落成默认值。
    const rawMaxWait = options.maxWaitMs;
    this.maxWaitMs = (rawMaxWait === undefined || rawMaxWait === null)
      ? DEFAULT_MAX_WAIT_MS
      : Math.max(0, Number(rawMaxWait) || 0);
    this.enabled = options.enabled !== false;
    /** @type {Map<string, number[]>} */
    this.buckets = new Map();
    this.stats = { acquired: 0, delayed: 0, failOpen: 0, totalWaitMs: 0 };
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

  used(key) {
    return this._prune(key).length;
  }

  canConnect(key) {
    return this.used(key) < this.limit;
  }

  waitMs(key, now = Date.now()) {
    const list = this._prune(key, now);
    if (list.length < this.limit) return 0;
    const oldest = list[list.length - this.limit];
    return Math.max(0, oldest + this.windowMs - now + 1);
  }

  /**
   * 记录一次连接**尝试**。
   *
   * 注意是「尝试」而不是「成功」：服务端限频计的是请求次数，
   * 握手被拒（HTTP 500 / 401）同样会被计数，所以必须在建连前记账，
   * 否则连续失败的重试会绕过闸门。
   */
  record(key, at = Date.now()) {
    const list = this.buckets.get(key) || [];
    list.push(at);
    this.buckets.set(key, list);
    this._prune(key, at);
    return list.length;
  }

  /**
   * 等待到允许连接为止。
   *
   * **只延迟、不阻断**：
   *   - 有空位 → 立即返回 true
   *   - 需等待且总时长 ≤ maxWaitMs → 等待后返回 true
   *   - 超过 maxWaitMs → fail-open，打警告并返回 true（不抛异常、不挂死任务）
   *
   * 不做跨调用串行化：串行化会让 N 个并发调用排成队列（第 N 个要等 N×maxWaitMs），
   * 在高并发下反而制造雪崩。限速只需要「窗口内不超过 limit」，
   * 而 waitMs() 已保证这一点——窗口没满时多个调用者同时放行是正确的。
   *
   * @param {string} key 出口标识（'direct' 或 'proxy:host:port'）
   * @param {{ maxWaitMs?: number, signal?: AbortSignal, logger?: object, label?: string }} [options]
   * @returns {Promise<boolean>} 恒为 true，保留返回值仅为调用方语义清晰
   */
  async acquire(key, options = {}) {
    if (!this.enabled) return true;

    const {
      maxWaitMs = this.maxWaitMs,
      signal,
      logger = console,
      label = '',
    } = options;

    const deadline = Date.now() + Math.max(0, maxWaitMs);
    let waitedMs = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) {
        this.stats.failOpen++;
        return true;
      }

      const delay = this.waitMs(key);
      if (delay <= 0) {
        if (waitedMs > 0) this.stats.delayed++;
        this.stats.acquired++;
        this.stats.totalWaitMs += waitedMs;
        return true;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        // 到达等待上限 → fail-open，绝不阻断业务
        this.stats.failOpen++;
        logger.warn?.(
          `[WsThrottle] ${key}${label ? ` (${label})` : ''} 已达 ${this.limit} 次/${this.windowMs}ms，`
          + `等待 ${waitedMs}ms 仍无空位，放行本次连接（fail-open，不阻断任务）`
        );
        return true;
      }

      const step = Math.min(delay, remaining, 1000);
      await sleep(step);
      waitedMs += step;
    }
  }

  reset(key) {
    if (key === undefined) {
      this.buckets.clear();
      return;
    }
    this.buckets.delete(key);
  }

  snapshot(key) {
    const keys = key === undefined ? Array.from(this.buckets.keys()) : [key];
    return keys.map((k) => ({
      key: k,
      used: this.used(k),
      limit: this.limit,
      windowMs: this.windowMs,
      waitMs: this.waitMs(k),
    }));
  }
}

/** 进程内单例 */
let shared = null;

/**
 * 取全局连接闸门
 * @param {{ limit?: number, windowMs?: number, maxWaitMs?: number, enabled?: boolean }} [options] 仅首次调用生效
 */
export function getWsConnectThrottle(options) {
  if (!shared) {
    shared = new WsConnectThrottle({
      limit: Number(options?.limit) > 0 ? Number(options.limit) : DEFAULT_CONNECT_LIMIT,
      windowMs: Number(options?.windowMs) > 0 ? Number(options.windowMs) : DEFAULT_CONNECT_WINDOW_MS,
      maxWaitMs: Number(options?.maxWaitMs) > 0 ? Number(options.maxWaitMs) : DEFAULT_MAX_WAIT_MS,
      enabled: options?.enabled !== false,
    });
  }
  return shared;
}

/**
 * 由代理配置推导闸门分桶 key。
 * 直连（无代理）时全部落到 'direct'，共用服务器公网 IP 的配额。
 */
export function resolveThrottleKey(proxy) {
  if (!proxy || !proxy.host) return 'direct';
  return `proxy:${proxy.host}:${proxy.port || 0}`;
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
  resolveThrottleKey,
};
