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
    battleVersion: Number(process.env.GAME_BATTLE_VERSION) || 241201
  },
  cron: {
    timezone: 'Asia/Shanghai'
  },
  scheduler: {
    maxConcurrentAccounts: Number(process.env.MAX_CONCURRENT_ACCOUNTS) || 3,
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
      LEGACY_CLAIM: Number(process.env.LEGACY_CLAIM_THROTTLE_MS) || 4000,
    },
    sensitiveTaskRetry: {
      maxRetries: Number(process.env.SENSITIVE_TASK_MAX_RETRIES) || 2,
      baseDelayMs: Number(process.env.SENSITIVE_TASK_RETRY_BASE_DELAY_MS) || 3000,
      maxDelayMs: Number(process.env.SENSITIVE_TASK_RETRY_MAX_DELAY_MS) || 8000,
    }
  }
};

export default config;

