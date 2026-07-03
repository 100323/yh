/**
 * 后端代理池配置
 */

import config from '../../config/index.js';

export const PROXY_CONFIG = {
  // 全局代理开关
  enabled: false,

  // 代理失败时是否降级到直连
  fallbackToDirect: true,

  // 代理失败重试次数
  maxRetries: 3,

  // 代理验证超时（毫秒）
  validationTimeout: 5000,

  // 代理连接超时（毫秒）
  connectionTimeout: 10000,

  // 代理池最小可用数量
  minPoolSize: 10,

  // 代理池最大数量
  maxPoolSize: 100,

  // sing-box 本地端口已由 ZenProxy 验证/绑定，这里限制单次同步数量即可
  maxValidationCandidates: 100,

  // 代理验证间隔（毫秒）
  validationInterval: 5 * 60 * 1000, // 5分钟

  // 代理使用后冷却时间（毫秒）
  proxyCooldown: 30 * 1000, // 30秒

  // 灰度发布策略
  rollout: {
    strategy: 'whitelist', // whitelist | percentage | all | none
    whitelist: [], // 使用代理的账号名称列表
    percentage: 0, // 百分比模式下的比例（0-100）
    excludeList: [] // 排除列表
  }
};

function normalizeControllerUrl(value) {
  return String(value || 'http://127.0.0.1:9090').replace(/\/+$/, '');
}

function getZenProxyApiKey() {
  return String(process.env.ZENPROXY_API_KEY || process.env.PROXY_API_KEY || '').trim();
}

function getLocalClientConfig() {
  return config.proxy?.localClient || {};
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function ensureZenProxyLocalBindings() {
  const localConfig = getLocalClientConfig();
  const controllerUrl = normalizeControllerUrl(localConfig.controllerUrl);
  const secret = String(localConfig.secret || '').trim();
  const headers = secret ? { Authorization: `Bearer ${secret}` } : {};

  let bindings = [];
  try {
    bindings = await fetchJson(`${controllerUrl}/bindings`, { headers });
  } catch (error) {
    throw new Error(`ZenProxy local client unavailable: ${error.message}`);
  }

  if (Array.isArray(bindings) && bindings.length > 0) {
    return bindings;
  }

  const apiKey = getZenProxyApiKey();
  if (!apiKey) {
    throw new Error('ZENPROXY_API_KEY is required when local bindings are empty');
  }

  const fetchBody = {
    server: localConfig.serverUrl || 'https://zenproxy.top',
    api_key: apiKey,
    count: Number(localConfig.fetchCount) || 100,
    auto_bind: true
  };
  if (localConfig.fetchCountry) {
    fetchBody.country = localConfig.fetchCountry;
  }
  if (localConfig.fetchType) {
    fetchBody.type = localConfig.fetchType;
  }
  if (localConfig.fetchChatGPT) {
    fetchBody.chatgpt = true;
  }

  const fetchResult = await fetchJson(`${controllerUrl}/fetch`, {
    method: 'POST',
    headers,
    body: JSON.stringify(fetchBody)
  });
  console.log('[ZenProxyLocal] fetch 完成', {
    added: fetchResult?.added,
    bound: fetchResult?.bound,
    message: fetchResult?.message
  });

  bindings = await fetchJson(`${controllerUrl}/bindings`, { headers });
  if (!Array.isArray(bindings) || bindings.length === 0) {
    throw new Error('ZenProxy local client returned no bindings after fetch');
  }
  return bindings;
}

function parseZenProxyLocalBindings(bindings) {
  const localConfig = getLocalClientConfig();
  const portStart = Number(localConfig.portStart) || 20001;
  const portEnd = Number(localConfig.portEnd) || 20100;

  return (Array.isArray(bindings) ? bindings : [])
    .map((binding) => {
      const port = Number(binding?.listen_port || binding?.local_port || binding?.port);
      if (!Number.isInteger(port) || port <= 0) {
        return null;
      }
      if (portStart > 0 && portEnd >= portStart && (port < portStart || port > portEnd)) {
        return null;
      }

      return {
        host: '127.0.0.1',
        port,
        protocol: 'http',
        country: 'local',
        anonymity: 'zenproxy-local',
        source: 'zenproxy-local',
        upstreamProxyId: binding.proxy_id || null,
        upstreamTag: binding.tag || null
      };
    })
    .filter(Boolean);
}

const SUPPORTED_PROXY_PROTOCOLS = new Set(['http', 'https', 'socks', 'socks4', 'socks5']);

function normalizeProxyProtocol(value, fallback = 'http') {
  const protocol = String(value || fallback || 'http')
    .trim()
    .toLowerCase()
    .replace(/:$/, '');
  return SUPPORTED_PROXY_PROTOCOLS.has(protocol) ? protocol : fallback;
}

function createParsedProxy(host, port, options = {}) {
  const normalizedHost = String(host || '').trim();
  const normalizedPort = Number(port);
  if (!normalizedHost || !Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) {
    return null;
  }

  return {
    host: normalizedHost,
    port: normalizedPort,
    protocol: normalizeProxyProtocol(options.protocol, 'http'),
    country: options.country || 'unknown',
    anonymity: options.anonymity || 'unknown',
    source: options.source || 'unknown',
    speed: options.speed || null
  };
}

function parseProxyLine(line, options = {}) {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return createParsedProxy(url.hostname, url.port, {
        ...options,
        protocol: normalizeProxyProtocol(url.protocol, options.protocol || 'http')
      });
    } catch {
      return null;
    }
  }

  const csvParts = trimmed.split(',').map((part) => part.trim()).filter(Boolean);
  if (csvParts.length >= 2 && !csvParts[0].includes(':')) {
    return createParsedProxy(csvParts[0], csvParts[1], {
      ...options,
      country: csvParts[2] || options.country,
      anonymity: csvParts[3] || options.anonymity
    });
  }

  const lastColonIndex = trimmed.lastIndexOf(':');
  if (lastColonIndex <= 0) {
    return null;
  }

  return createParsedProxy(trimmed.slice(0, lastColonIndex), trimmed.slice(lastColonIndex + 1), options);
}

export function parseProxyTextList(data, options = {}) {
  return String(data || '')
    .split(/\r?\n/)
    .map((line) => parseProxyLine(line, options))
    .filter(Boolean);
}

export function parseProxyJsonList(data, options = {}) {
  const payload = typeof data === 'string' ? JSON.parse(data) : data;
  const items = Array.isArray(payload)
    ? payload
    : (
        payload?.proxies
        || payload?.data
        || payload?.items
        || payload?.result
        || []
      );

  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      if (typeof item === 'string') {
        return parseProxyLine(item, options);
      }

      if (!item || typeof item !== 'object') {
        return null;
      }

      return createParsedProxy(item.host || item.ip || item.proxyHost, item.port || item.proxyPort, {
        ...options,
        protocol: item.protocol || item.type || item.scheme || options.protocol,
        country: item.country || item.countryCode || options.country,
        anonymity: item.anonymity || item.anonymous || options.anonymity,
        speed: item.speed || item.responseTime || item.timeout || null
      });
    })
    .filter(Boolean);
}

export function parseGeoNodeProxyList(data, options = {}) {
  const payload = typeof data === 'string' ? JSON.parse(data) : data;
  const items = Array.isArray(payload) ? payload : (payload?.data || []);
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item) => {
      const protocols = Array.isArray(item?.protocols) ? item.protocols : [item?.protocol];
      return createParsedProxy(item?.ip || item?.host, item?.port, {
        ...options,
        protocol: protocols.find(Boolean) || options.protocol || 'http',
        country: item?.country || item?.countryCode || options.country,
        anonymity: item?.anonymityLevel || item?.anonymity || options.anonymity,
        speed: item?.speed || item?.responseTime || null
      });
    })
    .filter(Boolean);
}

/**
 * 代理源配置
 *
 * 当前使用 ZenProxy 本地客户端模式：
 * 1. sing-box-zenproxy 从 https://zenproxy.top 拉取 vmess/vless/trojan 等节点；
 * 2. sing-box-zenproxy 批量绑定为 127.0.0.1:20001+ 本地 HTTP/SOCKS5 端口；
 * 3. 项目只读取这些本地端口，避免直接处理多种代理协议。
 */
export const PROXY_SOURCES = [
  {
    name: 'ZenProxy Local Client',
    sourceId: 'zenproxy-local',
    url: 'local://zenproxy/bindings',
    params: {},
    fetcher: async () => {
      const bindings = await ensureZenProxyLocalBindings();
      return parseZenProxyLocalBindings(bindings);
    },
    parser: (data) => parseZenProxyLocalBindings(data),
    enabled: true
  },
  {
    name: 'ProxyScrape Live Mirror',
    sourceId: 'proxyscrape-all',
    url: 'https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/all/data.json',
    parser: (data) => parseProxyJsonList(data, {
      source: 'proxyscrape-all',
      protocol: 'http'
    }),
    enabled: true
  },
  {
    name: 'ProxyScrape HTTP',
    sourceId: 'proxyscrape-http',
    url: 'https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/http/data.txt',
    parser: (data) => parseProxyTextList(data, {
      source: 'proxyscrape-http',
      protocol: 'http'
    }),
    enabled: true
  },
  {
    name: 'ProxyScrape SOCKS5',
    sourceId: 'proxyscrape-socks5',
    url: 'https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/protocols/socks5/data.txt',
    parser: (data) => parseProxyTextList(data, {
      source: 'proxyscrape-socks5',
      protocol: 'socks5'
    }),
    enabled: true
  },
  {
    name: 'GeoNode Last Checked',
    sourceId: 'geonode-last-checked',
    url: 'https://proxylist.geonode.com/api/proxy-list',
    params: {
      limit: 500,
      page: 1,
      sort_by: 'lastChecked',
      sort_type: 'desc',
      protocols: 'http,https,socks4,socks5'
    },
    parser: (data) => parseGeoNodeProxyList(data, {
      source: 'geonode-last-checked',
      protocol: 'http'
    }),
    enabled: true
  },
  {
    name: 'VPSLab Elite Proxies',
    sourceId: 'vpslab-elite',
    url: 'https://cdn.jsdelivr.net/gh/VPSLabCloud/VPSLab-Free-Proxy-List@main/all_elite.txt',
    parser: (data) => parseProxyTextList(data, {
      source: 'vpslab-elite',
      protocol: 'http'
    }),
    enabled: true
  },
  {
    name: 'VPSLab SOCKS5 Proxies',
    sourceId: 'vpslab-socks5',
    url: 'https://cdn.jsdelivr.net/gh/VPSLabCloud/VPSLab-Free-Proxy-List@main/socks5_all.txt',
    parser: (data) => parseProxyTextList(data, {
      source: 'vpslab-socks5',
      protocol: 'socks5'
    }),
    enabled: true
  },
  {
    name: 'IPLocate Free Proxies',
    sourceId: 'iplocate-all',
    url: 'https://cdn.jsdelivr.net/gh/iplocate/free-proxy-list@main/all-proxies.txt',
    parser: (data) => parseProxyTextList(data, {
      source: 'iplocate-all',
      protocol: 'http'
    }),
    enabled: true
  },
  {
    name: 'Proxifly Free Proxies',
    sourceId: 'proxifly-all',
    url: 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/all/data.txt',
    parser: (data) => parseProxyTextList(data, {
      source: 'proxifly-all',
      protocol: 'http'
    }),
    enabled: true
  }
];

/**
 * 代理验证配置
 */
export const VALIDATION_CONFIG = {
  // 验证目标URL
  testUrl: process.env.PROXY_VALIDATION_URL || 'https://httpbin.org/ip',

  // 验证超时
  timeout: Number(process.env.PROXY_VALIDATION_TIMEOUT_MS) || 10000,

  // 并发验证数量
  concurrency: Number(process.env.PROXY_VALIDATION_CONCURRENCY) || 10,

  // 验证成功的最大响应时间（毫秒）
  maxResponseTime: Number(process.env.PROXY_VALIDATION_MAX_RESPONSE_MS) || 15000,

  // 游戏 WebSocket 实际目标；配置后会以 CONNECT + TLS 握手作为可用性标准。
  tlsHost: process.env.PROXY_VALIDATION_TLS_HOST || 'xxz-xyzw-new.hortorgames.com',
  tlsPort: Number(process.env.PROXY_VALIDATION_TLS_PORT) || 443
};
