// PM2 — менеджер процессов Node.js
// Установка:  npm install -g pm2
// Запуск:     pm2 start ecosystem.config.js
// Рестарт:    pm2 restart dvaplus
// Логи:       pm2 logs dvaplus
// Автозапуск: pm2 startup && pm2 save

const path = require('path');

// Загружаем .env вручную (без dotenv — Node.js 18+)
const fs   = require('fs');
const env  = {};
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8')
    .split('\n')
    .forEach(line => {
      const [k, ...v] = line.split('=');
      if (k && !k.startsWith('#')) env[k.trim()] = v.join('=').trim();
    });
}

module.exports = {
  apps: [
    {
      name:             'dvaplus',
      script:           'server.js',
      instances:        1,
      autorestart:      true,
      watch:            false,
      max_memory_restart: '256M',
      env: {
        NODE_ENV:        'production',
        PORT:            env.PORT            || 2250,
        BOT_TOKEN:       env.BOT_TOKEN       || '',
        NOTIFY_IDS:      env.NOTIFY_IDS      || '',
        WEBHOOK_SECRET:  env.WEBHOOK_SECRET  || '',
        DOMAIN:          env.DOMAIN          || '',
        ADMIN_PASSWORD:  env.ADMIN_PASSWORD  || 'Z1488Z',
      },
      log_date_format:  'YYYY-MM-DD HH:mm:ss',
      error_file:       'logs/err.log',
      out_file:         'logs/out.log',
      merge_logs:       true,
    },
  ],
};
