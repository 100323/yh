module.exports = {
  apps: [
    {
      name: 'xyzw-backend',
      cwd: './backend',
      script: 'src/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      // 原 512M：RSS 长期在 430~543MB 徘徊，整点任务洪峰时频繁触及上限触发重启，
      // 而每次重启都会丢失重启窗口内到期的定时任务。先放宽上限止血，
      // 同时需要抓 heapdump 定位 RSS 持续增长的真实来源（未执行）。
      max_memory_restart: '1G',
      // 生产密钥（JWT_SECRET / ENCRYPTION_KEY）不写入版本库，统一由 backend/.env 提供。
      // .env 已被 .gitignore 忽略；--env-file-if-exists 在文件缺失时只提示、不中断启动。
      // ⚠️ 部署前必须先创建 backend/.env 并写入这两个变量，否则 NODE_ENV=production 会直接启动失败。
      node_args: ['--env-file-if-exists=.env'],
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        DB_PATH: './data/xyzw.db',
        // 数据库实际位于 backend/data/ 内（项目目录），生产环境必须显式放行，否则启动即崩溃
        ALLOW_PROJECT_LOCAL_DB_PATH: process.env.ALLOW_PROJECT_LOCAL_DB_PATH || '1',

        // JWT_SECRET / ENCRYPTION_KEY 一律由 backend/.env 注入。
        // 切勿在此处写死真实值；也不要写占位符回落 —— 占位符会让 Node 的 --env-file
        // 认为变量已存在而不覆盖，导致进程用占位符启动并直接失败。

        GAME_CLIENT_VERSION: '2.3.9-wx',
        GAME_BATTLE_VERSION: 241201,
        MAX_CONCURRENT_ACCOUNTS: 5,
        // 方向A：延长连接复用，避免跨档期反复重连（原 600000/1800000）
        WS_REUSE_MAX_IDLE_MS: process.env.WS_REUSE_MAX_IDLE_MS || '3600000',
        WS_REUSE_MAX_AGE_MS: process.env.WS_REUSE_MAX_AGE_MS || '14400000',
        // 整点任务洪峰削峰：把执行时刻分散到 0~5 分钟窗口内，触发时间点保持不变。
        // 取值权衡：代码默认 600000（10 分钟）削峰更彻底，但会拉长单次连接占用窗口；
        // 120000（2 分钟）连接释放快但削峰不足。折中取 300000（5 分钟）。
        SCHEDULER_STAGGER_WINDOW_MS: process.env.SCHEDULER_STAGGER_WINDOW_MS || '300000',
        SCHEDULER_OBSERVABILITY_ENABLED: process.env.SCHEDULER_OBSERVABILITY_ENABLED || '1',
        SCHEDULER_OBSERVABILITY_FLUSH_INTERVAL_MS: process.env.SCHEDULER_OBSERVABILITY_FLUSH_INTERVAL_MS || '10000',
        SCHEDULER_OBSERVABILITY_SLOW_COMMAND_MS: process.env.SCHEDULER_OBSERVABILITY_SLOW_COMMAND_MS || '5000',
        SCHEDULER_OBSERVABILITY_RETENTION_DAYS: process.env.SCHEDULER_OBSERVABILITY_RETENTION_DAYS || '3',
        SCHEDULER_OBSERVABILITY_MAX_METRIC_KEYS: process.env.SCHEDULER_OBSERVABILITY_MAX_METRIC_KEYS || '20000',
        SCHEDULER_OBSERVABILITY_MAX_ANOMALY_BUFFER: process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_BUFFER || '5000',
        SCHEDULER_OBSERVABILITY_MAX_ANOMALY_ROWS: process.env.SCHEDULER_OBSERVABILITY_MAX_ANOMALY_ROWS || '50000',
        ZENPROXY_API_KEY: process.env.ZENPROXY_API_KEY || '',
        ZENPROXY_COUNTRIES: process.env.ZENPROXY_COUNTRIES || '',
        ZENPROXY_LOCAL_CLIENT_ENABLED: process.env.ZENPROXY_LOCAL_CLIENT_ENABLED || '1',
        ZENPROXY_LOCAL_CONTROLLER_URL: process.env.ZENPROXY_LOCAL_CONTROLLER_URL || 'http://127.0.0.1:9090',
        ZENPROXY_LOCAL_SECRET: process.env.ZENPROXY_LOCAL_SECRET || 'xyzw-zenproxy-local',
        ZENPROXY_SERVER_URL: process.env.ZENPROXY_SERVER_URL || 'https://zenproxy.top',
        ZENPROXY_FETCH_COUNT: process.env.ZENPROXY_FETCH_COUNT || '100',
        ZENPROXY_FETCH_COUNTRY: process.env.ZENPROXY_FETCH_COUNTRY || '',
        ZENPROXY_FETCH_TYPE: process.env.ZENPROXY_FETCH_TYPE || '',
        ZENPROXY_FETCH_CHATGPT: process.env.ZENPROXY_FETCH_CHATGPT || '',
        ZENPROXY_PORT_START: process.env.ZENPROXY_PORT_START || '20001',
        ZENPROXY_PORT_END: process.env.ZENPROXY_PORT_END || '20100',
        PROXY_VALIDATION_URL: process.env.PROXY_VALIDATION_URL || 'https://httpbin.org/ip',
        PROXY_VALIDATION_TIMEOUT_MS: process.env.PROXY_VALIDATION_TIMEOUT_MS || '10000',
        PROXY_VALIDATION_CONCURRENCY: process.env.PROXY_VALIDATION_CONCURRENCY || '10',
        PROXY_VALIDATION_MAX_RESPONSE_MS: process.env.PROXY_VALIDATION_MAX_RESPONSE_MS || '15000',
        PROXY_VALIDATION_TLS_HOST: process.env.PROXY_VALIDATION_TLS_HOST || 'xxz-xyzw-new.hortorgames.com',
        PROXY_VALIDATION_TLS_PORT: process.env.PROXY_VALIDATION_TLS_PORT || '443',
      },
    },
    {
      name: 'zenproxy-singbox',
      cwd: './zenproxy-runtime',
      script: './sing-box',
      args: 'run -c config.json',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
