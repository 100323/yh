/**
 * 战场（盐场 / 蟠桃）WebSocket 连接地址构建
 *
 * 逆向依据（咸鱼之王 0.32.0，assets/assets/game/index.9cc7e.js）：
 *
 *   1) 官方客户端在进入战场前，先向主服要一次战场信息：
 *        盐场  legion_getbattlefield  → info: { battlefieldId, sid, domainName, subType, ... }
 *        蟠桃  legion_getpayloadbf    → info: { bfId,          sid, domainName, startTime }
 *      并把 sid / domainName 交给战场专用网络对象：
 *        盐场  LegionWarNetworkData      : network.setSId(t.sid); network.setDomainName(t.domainName)
 *        蟠桃  LegionPayloadNetworkData  : network.setSId(t.sid, "payload_"); network.setDomainName(t.domainName)
 *
 *   2) 建连时（两个类实现一致）：
 *        o.prototype.connect = function () {
 *          var n = WebSocketDelegate.current.socket.connectOptions;
 *          var i = n.token, t = n.encoding, e = n.lang;
 *          var url = n.url;
 *          if (this.useDomainName) url = this.domainName;      // ← domainName 直接当完整 WS 地址用
 *          this.wsDelegate.connect({ token: i, encoding: t, url: url, lang: e, sid2: this.sId });
 *        };
 *
 *   3) 底层 @o4e 拼 query（原样保留顺序）：
 *        url + "?p=" + encodeURIComponent(connParam) + "&e=" + encoding
 *        for (k in { sid:"sid", sid2:"sid2", lang:"lang", frameSize:"fs" })
 *          if (opt[k]) url += "&" + map[k] + "=" + encodeURIComponent(opt[k])
 *
 *   ⇒ 结论：
 *     - **domainName 是战场专用服地址**，必须用它建连；主服域名（xxz-xyzw-new）只是兜底。
 *     - `sid2` 来自 `info.sid`，且**只能出现一次**（原前端拼了两遍）。
 *     - 心跳按战场族切换：盐场 war_ping{battlefieldId}，蟠桃 payload_ping{bfId}。
 *
 * 关于 domainName 的形态：服务端可能返回下列任一形态，统一归一化处理
 *   wss://host/agent      wss://host
 *   https://host/agent    https://host
 *   host/agent            host
 */

/** 兜底地址：domainName 缺失时使用（保持与原实现一致） */
export const DEFAULT_BATTLE_WS_URL = 'wss://xxz-xyzw-new.hortorgames.com/agent';

/** 战场服务默认路径（domainName 不带路径时补上） */
export const DEFAULT_BATTLE_WS_PATH = '/agent';

/**
 * 把服务端返回的 domainName 归一化成合法的 ws/wss 地址。
 *
 * @param {string} input 服务端返回的 domainName（可能带/不带协议、带/不带路径）
 * @param {object} [options]
 * @param {string} [options.path] 缺少路径时补的路径，默认 '/agent'
 * @returns {string} 归一化后的地址；无法解析时返回空串
 */
export function normalizeDomainName(input, options = {}) {
  const path = options.path || DEFAULT_BATTLE_WS_PATH;
  let raw = String(input ?? '').trim();
  if (!raw) return '';

  // 去掉可能存在的引号包裹
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    raw = raw.slice(1, -1).trim();
  }
  if (!raw) return '';

  // 协议归一：http(s) → ws(s)；协议相对 → 补 wss；无协议 → 补 wss
  if (raw.startsWith('//')) {
    raw = `wss:${raw}`;
  } else if (/^https:\/\//i.test(raw)) {
    raw = raw.replace(/^https:/i, 'wss:');
  } else if (/^http:\/\//i.test(raw)) {
    raw = raw.replace(/^http:/i, 'ws:');
  } else if (!/^wss?:\/\//i.test(raw)) {
    raw = `wss://${raw}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  // 补路径：domainName 只给了主机时，默认打到 /agent
  if (!parsed.pathname || parsed.pathname === '/' || parsed.pathname === '') {
    parsed.pathname = path;
  }

  // 战场地址不接受 query/hash（query 由 buildBattleFieldWsUrl 统一拼）
  parsed.search = '';
  parsed.hash = '';

  return parsed.toString();
}

/**
 * 构建战场 WebSocket 地址。
 *
 * 参数顺序与官方 @o4e 一致：`?p=…&e=…&sid2=…&lang=…`
 * 使用 `encodeURIComponent`（**不是** URLSearchParams），以保持与原实现完全一致的编码语义。
 *
 * @param {object} options
 * @param {string} options.token      roleToken（对应 query 的 p）
 * @param {string} [options.sid]      战场 sid（对应 query 的 sid2），来自 info.sid
 * @param {string} [options.domainName] 服务端下发的战场专用服地址，优先使用
 * @param {string} [options.lang]     默认 'chinese'
 * @param {string} [options.encoding] 默认 'x'
 * @param {string} [options.baseUrl]  domainName 缺失时的兜底地址
 * @param {object} [options.extraParams] 额外 query（值为空则跳过）
 * @returns {{ url: string, usedDomainName: boolean, host: string, sid: string }}
 */
export function buildBattleFieldWsUrl(options = {}) {
  const {
    token,
    sid,
    domainName,
    lang = 'chinese',
    encoding = 'x',
    baseUrl = DEFAULT_BATTLE_WS_URL,
    extraParams,
  } = options;

  const normalized = normalizeDomainName(domainName);
  const usedDomainName = Boolean(normalized);
  const target = normalized || baseUrl;

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    // baseUrl 都解析不了时，退回兜底常量
    parsed = new URL(DEFAULT_BATTLE_WS_URL);
  }

  const origin = `${parsed.protocol}//${parsed.host}`;
  const pathname = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : DEFAULT_BATTLE_WS_PATH;

  const parts = [
    `p=${encodeURIComponent(token ?? '')}`,
    `e=${encodeURIComponent(encoding)}`,
  ];

  const sidValue = sid === undefined || sid === null ? '' : String(sid).trim();
  if (sidValue) {
    parts.push(`sid2=${encodeURIComponent(sidValue)}`);
  }

  parts.push(`lang=${encodeURIComponent(lang)}`);

  if (extraParams && typeof extraParams === 'object') {
    for (const [key, value] of Object.entries(extraParams)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'p' || key === 'e' || key === 'sid2' || key === 'lang') continue; // 防重复
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }

  return {
    url: `${origin}${pathname}?${parts.join('&')}`,
    usedDomainName,
    host: parsed.host,
    sid: sidValue,
  };
}

/**
 * 从战场信息对象里抽取建连所需的字段。
 * 兼容盐场（battlefieldId）与蟠桃（bfId）两套字段名。
 *
 * @param {object} info  legion_getbattlefield.info 或 legion_getpayloadbf.info
 * @param {'war'|'payload'} kind
 * @returns {{ sid: string, domainName: string, battlefieldId: string|number|null, bfId: string|number|null, raw: object }}
 */
export function pickBattleFieldInfo(info, kind = 'war') {
  const source = info && typeof info === 'object' ? info : {};
  const battlefieldId = source.battlefieldId ?? null;
  const bfId = source.bfId ?? null;

  return {
    sid: source.sid === undefined || source.sid === null ? '' : String(source.sid),
    domainName: source.domainName || '',
    battlefieldId: kind === 'war' ? battlefieldId : null,
    bfId: kind === 'payload' ? bfId : null,
    raw: source,
  };
}

/**
 * 打日志用的安全描述（不含 token）
 */
export function describeBattleFieldTarget(url) {
  try {
    const parsed = new URL(url);
    const sid2 = parsed.searchParams.get('sid2');
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}${sid2 ? ` sid2=${sid2}` : ''}`;
  } catch {
    return '(invalid url)';
  }
}

export default {
  DEFAULT_BATTLE_WS_URL,
  DEFAULT_BATTLE_WS_PATH,
  normalizeDomainName,
  buildBattleFieldWsUrl,
  pickBattleFieldInfo,
  describeBattleFieldTarget,
};
