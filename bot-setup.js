/**
 * bot-setup.js — регистрация вебхука Telegram
 *
 * Запустить ОДИН раз после деплоя:
 *   node bot-setup.js
 *
 * Что делает:
 *   1. Регистрирует webhook URL в Telegram (ваш домен/webhook)
 *   2. Выводит информацию о боте
 */

'use strict';

const https = require('https');

// Загрузка .env без dotenv
const fs   = require('fs');
const path = require('path');
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && !k.startsWith('#') && k.trim()) {
      process.env[k.trim()] = v.join('=').trim();
    }
  });
}

const BOT_TOKEN      = process.env.BOT_TOKEN;
const DOMAIN         = process.env.DOMAIN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!BOT_TOKEN || !DOMAIN) {
  console.error('[ERROR] Заполните BOT_TOKEN и DOMAIN в .env');
  process.exit(1);
}

function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body || {});
    const req = https.request({
      hostname: 'api.telegram.org',
      path:     `/bot${BOT_TOKEN}/${method}`,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  // Инфо о боте
  const me = await tgRequest('getMe');
  if (!me.ok) { console.error('Ошибка getMe:', me); process.exit(1); }
  console.log(`\nБот: @${me.result.username} (id: ${me.result.id})`);

  // Регистрируем webhook
  const webhookUrl = `https://${DOMAIN}/webhook`;
  const result = await tgRequest('setWebhook', {
    url:          webhookUrl,
    secret_token: WEBHOOK_SECRET || undefined,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  });

  if (result.ok) {
    console.log(`\nWebhook зарегистрирован: ${webhookUrl}`);
    console.log('Готово. Бот принимает заявки.\n');
  } else {
    console.error('\nОшибка setWebhook:', result);
  }

  // Текущий статус вебхука
  const info = await tgRequest('getWebhookInfo', {});
  console.log('Статус вебхука:', JSON.stringify(info.result, null, 2));
}

main().catch(console.error);
