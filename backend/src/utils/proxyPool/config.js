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
