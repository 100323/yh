/**
 * 后端代理池配置
 */

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

  // 单次刷新最多验证的候选代理数量，避免免费源返回数千条导致预热长时间阻塞
  maxValidationCandidates: 600,

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

/**
 * 免费代理源配置
 */
export const PROXY_SOURCES = [
  {
    name: 'Proxifly HTTP',
    sourceId: 'proxifly-http',
    url: 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt',
    params: {},
    parser: (data) => parseProxyTextList(data, {
      defaultProtocol: 'http',
      source: 'proxifly-http'
    }),
    enabled: true
  },
  {
    name: 'Proxifly HTTPS',
    sourceId: 'proxifly-https',
    url: 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/https/data.txt',
    params: {},
    parser: (data) => parseProxyTextList(data, {
      defaultProtocol: 'https',
      source: 'proxifly-https'
    }),
    enabled: true
  },
  {
    name: 'TheSpeedX HTTP',
    sourceId: 'thespeedx-http',
    url: 'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
    params: {},
    parser: (data) => parseProxyTextList(data, {
      defaultProtocol: 'http',
      source: 'thespeedx-http'
    }),
    enabled: true
  },
  {
    name: 'theriturajps proxy-list',
    sourceId: 'theriturajps',
    url: 'https://raw.githubusercontent.com/theriturajps/proxy-list/main/proxies.txt',
    params: {},
    parser: (data) => parseProxyTextList(data, {
      defaultProtocol: 'http',
      source: 'theriturajps'
    }),
    enabled: true
  },
  {
    name: '89ip',
    sourceId: '89ip',
    url: 'http://api.89ip.cn/tqdl.html',
    params: {
      api: 1,
      num: 100,
      port: '',
      address: '',
      isp: ''
    },
    parser: (data) => parseProxyTextList(data, {
      defaultProtocol: 'http',
      source: '89ip',
      extractIpPort: true
    }),
    enabled: true
  },
  {
    name: '66ip',
    sourceId: '66ip',
    url: 'http://www.66ip.cn/nmtq.php',
    params: {
      getnum: 100,
      isp: 0,
      anonymoustype: 0,
      start: '',
      ports: '',
      export: '',
      ipaddress: '',
      area: 1,
      proxytype: 2,
      api: '66ip'
    },
    parser: (data) => parseProxyTextList(data, {
      defaultProtocol: 'http',
      source: '66ip',
      extractIpPort: true
    }),
    enabled: true
  },
  {
    name: '站大爷 ip3366',
    sourceId: 'ip3366',
    url: 'http://www.ip3366.net/free/',
    params: {
      stype: 1,
      page: 1
    },
    parser: (data) => parseProxyTableLikeData(data, {
      defaultProtocol: 'http',
      source: 'ip3366'
    }),
    enabled: true
  },
  {
    name: '快代理免费国内高匿',
    sourceId: 'kuaidaili-inha',
    url: 'https://www.kuaidaili.com/free/inha/1/',
    params: {},
    parser: (data) => parseProxyTableLikeData(data, {
      defaultProtocol: 'http',
      source: 'kuaidaili-inha'
    }),
    enabled: true
  },
  {
    name: 'ProxyList GeoNode',
    sourceId: 'geonode',
    url: 'https://proxylist.geonode.com/api/proxy-list',
    params: {
      limit: 50,
      page: 1,
      sort_by: 'lastChecked',
      sort_type: 'desc',
      protocols: 'http,https',
      anonymityLevel: 'elite,anonymous'
    },
    parser: (data) => {
      if (!data || !data.data) return [];
      return data.data.map(proxy => ({
        host: proxy.ip,
        port: proxy.port,
        protocol: proxy.protocols?.[0] || 'http',
        country: proxy.country,
        anonymity: proxy.anonymityLevel,
        speed: proxy.responseTime,
        source: 'geonode'
      }));
    },
    enabled: true
  },
  {
    name: 'r00tee HTTPS',
    sourceId: 'r00tee-https',
    url: 'https://raw.githubusercontent.com/r00tee/Proxy-List/main/Https.txt',
    params: {},
    parser: (data) => parseProxyTextList(data, {
      // 该列表名为 HTTPS，但实际多数是可 CONNECT HTTPS/WSS 的 HTTP 代理。
      defaultProtocol: 'http',
      source: 'r00tee-https',
      extractIpPort: true
    }),
    enabled: true
  },
  {
    name: 'roosterkid HTTPS',
    sourceId: 'roosterkid-https',
    url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt',
    params: {},
    parser: (data) => parseProxyTextList(data, {
      defaultProtocol: 'http',
      source: 'roosterkid-https',
      extractIpPort: true
    }),
    enabled: true
  },
  {
    name: 'Zaeem HTTPS',
    sourceId: 'zaeem-https',
    url: 'https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/https.txt',
    params: {},
    parser: (data) => parseProxyTextList(data, {
      defaultProtocol: 'http',
      source: 'zaeem-https',
      extractIpPort: true
    }),
    enabled: true
  },
  {
    name: 'ProxyScrape',
    sourceId: 'proxyscrape',
    url: 'https://api.proxyscrape.com/v2/',
    params: {
      request: 'displayproxies',
      protocol: 'http',
      timeout: 5000,
      country: 'all',
      ssl: 'all',
      anonymity: 'elite,anonymous'
    },
    parser: (data) => {
      if (!data) return [];
      // 返回的是纯文本，每行一个代理 IP:PORT
      const lines = data.trim().split('\n');
      return lines.map(line => {
        const [host, port] = line.trim().split(':');
        if (!host || !port) return null;
        return {
          host,
          port: parseInt(port),
          protocol: 'http',
          source: 'proxyscrape'
        };
      }).filter(Boolean);
    },
    enabled: true
  },
  {
    name: 'Free Proxy List',
    sourceId: 'proxy-list-download',
    url: 'https://www.proxy-list.download/api/v1/get',
    params: {
      type: 'http',
      anon: 'elite'
    },
    parser: (data) => {
      if (!data) return [];
      const lines = data.trim().split('\n');
      return lines.map(line => {
        const [host, port] = line.trim().split(':');
        if (!host || !port) return null;
        return {
          host,
          port: parseInt(port),
          protocol: 'http',
          source: 'proxy-list-download'
        };
      }).filter(Boolean);
    },
    enabled: true
  }
];

function parseProxyTextList(data, options = {}) {
  if (!data) return [];

  const defaultProtocol = options.defaultProtocol || 'http';
  const source = options.source || 'text-list';
  const raw = String(data);
  const lines = options.extractIpPort
    ? Array.from(raw.matchAll(/(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/g)).map(match => match[0])
    : raw.split(/\r?\n/);

  return lines.map((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) return null;

    let protocol = defaultProtocol;
    let hostPort = trimmed;
    const protocolMatch = trimmed.match(/^([a-z0-9]+):\/\/(.+)$/i);
    if (protocolMatch) {
      protocol = protocolMatch[1].toLowerCase();
      hostPort = protocolMatch[2];
    }

    hostPort = hostPort.split(/[/?#]/)[0].trim();

    const ipv6Match = hostPort.match(/^\[([^\]]+)\]:(\d{2,5})$/);
    const genericMatch = hostPort.match(/^(.+):(\d{2,5})$/);
    const host = ipv6Match ? ipv6Match[1] : genericMatch?.[1];
    const port = ipv6Match ? ipv6Match[2] : genericMatch?.[2];
    if (!host || !port) return null;

    return {
      host,
      port: parseInt(port, 10),
      protocol,
      source
    };
  }).filter(Boolean);
}

function parseProxyTableLikeData(data, options = {}) {
  if (!data) return [];

  const raw = String(data);
  const source = options.source || 'table-list';
  const defaultProtocol = options.defaultProtocol || 'http';
  const proxies = new Map();

  const pushProxy = (host, port, protocol = defaultProtocol) => {
    const normalizedHost = String(host || '').trim();
    const normalizedPort = Number(port);
    if (!normalizedHost || !Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) {
      return;
    }
    proxies.set(`${normalizedHost}:${normalizedPort}`, {
      host: normalizedHost,
      port: normalizedPort,
      protocol: String(protocol || defaultProtocol).toLowerCase(),
      source
    });
  };

  // 兼容 IP:PORT 纯文本。
  parseProxyTextList(raw, {
    defaultProtocol,
    source,
    extractIpPort: true
  }).forEach(proxy => pushProxy(proxy.host, proxy.port, proxy.protocol));

  // 兼容常见 HTML 表格：同一行里 IP 后面的第一个 2-5 位数字通常就是端口。
  raw.split(/<tr[\s>]/i).forEach((row) => {
    const ipMatch = row.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    if (!ipMatch) return;

    const afterIp = row.slice((ipMatch.index || 0) + ipMatch[0].length);
    const portMatch = afterIp.match(/(?:>|^|[^\d])(\d{2,5})(?=<|[^\d]|$)/);
    if (!portMatch) return;

    let protocol = defaultProtocol;
    const protocolText = row.match(/\b(HTTP|HTTPS|SOCKS4|SOCKS5)\b/i)?.[1];
    if (protocolText) {
      protocol = protocolText.toLowerCase();
    }

    pushProxy(ipMatch[1], portMatch[1], protocol);
  });

  return Array.from(proxies.values());
}

/**
 * 代理验证配置
 */
export const VALIDATION_CONFIG = {
  // 验证目标URL
  testUrl: 'https://www.baidu.com',

  // 验证超时
  timeout: 4000,

  // 并发验证数量
  concurrency: 30,

  // 验证成功的最大响应时间（毫秒）
  maxResponseTime: 5000
};
