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
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 3001,
        DB_PATH: './data/xyzw.db',

        // Replace these before production use.
        JWT_SECRET: 'replace_with_a_strong_jwt_secret',
        ENCRYPTION_KEY: 'replace_with_a_strong_32_byte_key',

        GAME_CLIENT_VERSION: '2.3.9-wx',
        GAME_BATTLE_VERSION: 241201,
        MAX_CONCURRENT_ACCOUNTS: 5,
      },
    },
  ],
};
