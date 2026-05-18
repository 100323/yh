/**
 * 应用配置
 */
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

const DEVELOPMENT_DEFAULTS = {
  JWT_SECRET: 'development-only-jwt-secret-change-me',
  ENCRYPTION_KEY: 'development-only-encryption-key-change-me',
};

const PLACEHOLDER_SECRETS = new Set([
  'replace_with_a_strong_jwt_secret',
  'replace_with_a_strong_32_byte_key',
]);

function resolveRequiredSecret(envName) {
  const rawValue = String(process.env[envName] || '').trim();
  const hasConfiguredValue = rawValue !== '' && !PLACEHOLDER_SECRETS.has(rawValue);

  if (hasConfiguredValue) {
    return rawValue;
  }

  if (isProduction) {
    throw new Error(`[config] ${envName} must be set to a strong non-placeholder value when NODE_ENV=production`);
  }

  return DEVELOPMENT_DEFAULTS[envName];
}

export const config = {
  server: {
    port: process.env.PORT || 3001,
    host: process.env.HOST || '0.0.0.0'
  },
  jwt: {
    secret: resolveRequiredSecret('JWT_SECRET'),
    expiresIn: '7d'
  },
  encryption: {
    key: resolveRequiredSecret('ENCRYPTION_KEY'),
    ivLength: 16
  },
  database: {
    path: process.env.DB_PATH || './data/xyzw.db'
  },
  game: {
    wsUrl: 'wss://xxz-xyzw-new.hortorgames.com/agent',
    heartbeatInterval: 30000,
    reconnectDelay: 5000,
    clientVersion: process.env.GAME_CLIENT_VERSION || '2.3.9-wx',
    battleVersion: Number(process.env.GAME_BATTLE_VERSION) || 241201,
    launchTokenRefreshTtlMs: Number(process.env.GAME_LAUNCH_TOKEN_REFRESH_TTL_MS) || 15 * 60 * 1000,
    launchTokenRefreshTimeoutMs: Number(process.env.GAME_LAUNCH_TOKEN_REFRESH_TIMEOUT_MS) || 4000,
  },
  cron: {
    timezone: 'Asia/Shanghai'
  },
  scheduler: {
    maxConcurrentAccounts: Number(process.env.MAX_CONCURRENT_ACCOUNTS) || 3,
    proxyMaxConcurrentAccounts: Number(process.env.PROXY_MAX_CONCURRENT_ACCOUNTS) || 2,
    accountDispatchIntervalMs: Number(process.env.ACCOUNT_DISPATCH_INTERVAL_MS) || 8000,
    proxyAccountDispatchIntervalMs: Number(process.env.PROXY_ACCOUNT_DISPATCH_INTERVAL_MS) || 12000,
    dailyCatchupMaxConcurrency: Number(process.env.DAILY_CATCHUP_MAX_CONCURRENCY) || 2,
    staggerWindowMs: Number(process.env.SCHEDULER_STAGGER_WINDOW_MS) || 600000,
    reusableConnection: {
      maxIdleMs: Number(process.env.WS_REUSE_MAX_IDLE_MS) || 600000,
      maxAgeMs: Number(process.env.WS_REUSE_MAX_AGE_MS) || 1800000,
    },
    wsReconnectRetry: {
      maxRetries: Number(process.env.WS_RECONNECT_MAX_RETRIES) || 2,
      baseDelayMs: Number(process.env.WS_RECONNECT_BASE_DELAY_MS) || 1500,
      maxDelayMs: Number(process.env.WS_RECONNECT_MAX_DELAY_MS) || 5000,
    },
    sensitiveTaskThrottleMs: {
      HANGUP_ADD_TIME: Number(process.env.HANGUP_ADD_TIME_THROTTLE_MS) || 3000,
      LEGACY_CLAIM: Number(process.env.LEGACY_CLAIM_THROTTLE_MS) || 8000,
    },
    sensitiveTaskRetry: {
      maxRetries: Number(process.env.SENSITIVE_TASK_MAX_RETRIES) || 2,
      baseDelayMs: Number(process.env.SENSITIVE_TASK_RETRY_BASE_DELAY_MS) || 3000,
      maxDelayMs: Number(process.env.SENSITIVE_TASK_RETRY_MAX_DELAY_MS) || 8000,
    }
  },
  proxy: {
    zenProxyApiKeyConfigured: Boolean(String(process.env.ZENPROXY_API_KEY || process.env.PROXY_API_KEY || '').trim()),
    zenProxyCountries: String(process.env.ZENPROXY_COUNTRIES || '')
      .split(',')
      .map(item => item.trim().toUpperCase())
      .filter(Boolean),
    localClient: {
      enabled: String(process.env.ZENPROXY_LOCAL_CLIENT_ENABLED || '1').trim() !== '0',
      controllerUrl: process.env.ZENPROXY_LOCAL_CONTROLLER_URL || 'http://127.0.0.1:9090',
      secret: process.env.ZENPROXY_LOCAL_SECRET || 'xyzw-zenproxy-local',
      serverUrl: process.env.ZENPROXY_SERVER_URL || 'https://zenproxy.top',
      fetchCount: Number(process.env.ZENPROXY_FETCH_COUNT) || 100,
      fetchCountry: process.env.ZENPROXY_FETCH_COUNTRY || '',
      fetchType: process.env.ZENPROXY_FETCH_TYPE || '',
      fetchChatGPT: String(process.env.ZENPROXY_FETCH_CHATGPT || '').trim() === '1',
      portStart: Number(process.env.ZENPROXY_PORT_START) || 20001,
      portEnd: Number(process.env.ZENPROXY_PORT_END) || 20100,
    }
  }
};

export default config;
