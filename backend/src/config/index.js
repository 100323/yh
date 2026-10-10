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

function clamp(value, min, max, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(max, Math.max(min, numericValue));
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
    // 主服地址。可用 GAME_WS_URL 覆盖（不同环境/灰度域名不同）。
    // 注意：盐场/蟠桃的战场专用服**不在这里**，要用服务端下发的 domainName
    //（legion_getbattlefield.info.domainName / legion_getpayloadbf.info.domainName），
    // 见 backend/src/utils/gameClient.js 的 domainName 选项。
    wsUrl: process.env.GAME_WS_URL || 'wss://xxz-xyzw-new.hortorgames.com/agent',
    heartbeatInterval: 30000,
    reconnectDelay: 5000,
    clientVersion: process.env.GAME_CLIENT_VERSION || '2.3.9-wx',
    battleVersion: Number(process.env.GAME_BATTLE_VERSION) || 241201,
    launchTokenRefreshTtlMs: Number(process.env.GAME_LAUNCH_TOKEN_REFRESH_TTL_MS) || 15 * 60 * 1000,
    launchTokenRefreshTimeoutMs: Number(process.env.GAME_LAUNCH_TOKEN_REFRESH_TIMEOUT_MS) || 4000,
    // 连接频率闸门：官方客户端 60s 内建 30 条 WS 会主动断网退出，
    // 服务端另有 IPisBan(-10008)。
    //
    // 2026-10-10 实测校准（服务器 11 小时日志，7786 个握手）：
    //   · 直连建连稳态 28 次/分钟、整点峰值 70 次/分钟、极端 135 次/分钟；
    //   · 连续 7 天（10-04~10-10）error 日志中 IPisBan/RoleIsBan/踢下线 均为 0 次。
    //   → 原来的 limit=24 低于实测稳态均值，闸门几乎每个整点都饱和，
    //     而 fail-open 又会在 30s 后放行，等于「只加延迟、不降速率」。
    //   故把 limit 放宽到 90（覆盖实测整点峰值 70 + 余量），让它只当
    //   **病态熔断器**（拦未来可能的 1 秒重连 10 次级风暴），不再当限速器。
    //
    // 闸门只延迟不阻断：单次最多等 maxWaitMs，超时 fail-open 放行并打警告，
    // 不会抛异常、不会让任务失败。maxWaitMs 由 30s 收紧到 10s——
    // limit 放宽后正常几乎不触发，真触发时也不该让任务等 30s。
    connectThrottle: {
      enabled: String(process.env.WS_CONNECT_THROTTLE_ENABLED || '1').trim() !== '0',
      limit: Number(process.env.WS_CONNECT_THROTTLE_LIMIT) || 90,
      windowMs: Number(process.env.WS_CONNECT_THROTTLE_WINDOW_MS) || 60000,
      maxWaitMs: Number(process.env.WS_CONNECT_THROTTLE_MAX_WAIT_MS) || 10000,
    },
  },
  cron: {
    timezone: 'Asia/Shanghai'
  },
  observability: {
    enabled: String(process.env.SCHEDULER_OBSERVABILITY_ENABLED || '0') === '1',
    flushIntervalMs: clamp(process.env.SCHEDULER_OBSERVABILITY_FLUSH_INTERVAL_MS, 1000, 60000, 10000),
    slowCommandMs: clamp(process.env.SCHEDULER_OBSERVABILITY_SLOW_COMMAND_MS, 1000, 30000, 5000),
    retentionDays: clamp(process.env.SCHEDULER_OBSERVABILITY_RETENTION_DAYS, 1, 3, 3),
    maxMetricKeys: clamp(process.env.SCHEDULER_OBSERVABILITY_MAX_METRIC_KEYS, 1000, 100000, 20000),
    maxAnomalyBuffer: clamp(process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_BUFFER, 100, 20000, 5000),
    maxAnomalyRows: clamp(process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_ROWS, 1000, 50000, 50000)
  },
  scheduler: {
    maxConcurrentAccounts: Number(process.env.MAX_CONCURRENT_ACCOUNTS) || 3,
    proxyMaxConcurrentAccounts: Number(process.env.PROXY_MAX_CONCURRENT_ACCOUNTS) || 2,
    accountDispatchIntervalMs: Number(process.env.ACCOUNT_DISPATCH_INTERVAL_MS) || 8000,
    proxyAccountDispatchIntervalMs: Number(process.env.PROXY_ACCOUNT_DISPATCH_INTERVAL_MS) || 12000,
    dailyCatchupMaxConcurrency: Number(process.env.DAILY_CATCHUP_MAX_CONCURRENCY) || 2,
    staggerWindowMs: Number(process.env.SCHEDULER_STAGGER_WINDOW_MS) || 600000,
    // 调度器"注册对账"心跳（checkAndRunDueTasks）：只做停用移除 / cron 变更重注册 / 新任务注册，
    // **不执行任务**，所以间隔只影响"UI 改配置后多久生效"。
    // 由每分钟放宽到每 3 分钟，省掉每分钟一次的全表查询 + 5000+ 次 cron 签名拼接比较。
    // 注意：已注册的 cron job 各自独立触发，与本心跳无关，改大不会漏做任务。
    refreshCron: process.env.SCHEDULER_REFRESH_CRON || '*/3 * * * *',
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
    taskTypeMaxConcurrency: {
      GENIE_SWEEP: Number(process.env.GENIE_SWEEP_MAX_CONCURRENT_TASKS) || 2,
      GENIE_SWEEP_DEEP_SEA: Number(process.env.GENIE_SWEEP_MAX_CONCURRENT_TASKS) || 2,
    },
    taskTypeCommandThrottleMs: {
      GENIE_SWEEP: Number(process.env.GENIE_SWEEP_COMMAND_THROTTLE_MS) || 5000,
      GENIE_SWEEP_DEEP_SEA: Number(process.env.GENIE_SWEEP_COMMAND_THROTTLE_MS) || 5000,
    },
    // 「操作过快，请稍后重试」的退避重试。
    // 2026-10-10 由 2 次/3s 基准/8s 上限 放宽到 3 次/5s 基准/30s 上限：
    // 线上实测该错误集中在整点洪峰（04:00–04:05），原 3s/6s 的退避太短，
    // 重试仍落在同一段限频窗口内。新退避为 5s → 10s → 20s，更可能跨出限频窗口。
    sensitiveTaskRetry: {
      maxRetries: Number(process.env.SENSITIVE_TASK_MAX_RETRIES) || 3,
      baseDelayMs: Number(process.env.SENSITIVE_TASK_RETRY_BASE_DELAY_MS) || 5000,
      maxDelayMs: Number(process.env.SENSITIVE_TASK_RETRY_MAX_DELAY_MS) || 30000,
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
