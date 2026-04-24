#!/usr/bin/env python3
"""
ДваПлюс — Telegram бот
Polling через Cloudflare Worker (обход блокировки Telegram на VPS)
"""
import os
import logging
from pathlib import Path
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes

# ── Загрузка .env ──────────────────────────────────────
env_file = Path(__file__).parent / '.env'
if env_file.exists():
    for line in env_file.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, _, v = line.partition('=')
            os.environ.setdefault(k.strip(), v.strip())

BOT_TOKEN  = os.environ.get('BOT_TOKEN', '')
NOTIFY_IDS = [x.strip() for x in os.environ.get('NOTIFY_IDS', '').split(',') if x.strip()]
WORKER_URL = os.environ.get('WORKER_URL', '').rstrip('/')

# ── Логи ───────────────────────────────────────────────
logging.basicConfig(
    format='%(asctime)s [BOT] %(levelname)s %(message)s',
    level=logging.INFO
)
log = logging.getLogger(__name__)


# ── Команды ────────────────────────────────────────────
async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    chat_id = update.effective_chat.id
    await update.message.reply_html(
        f'<b>ДваПлюс — бот заявок</b>\n\n'
        f'Ваш Chat ID: <code>{chat_id}</code>\n\n'
        f'Добавьте его в NOTIFY_IDS в .env'
    )
    log.info(f'/start от {chat_id}')


# ── Запуск ─────────────────────────────────────────────
def main():
    if not BOT_TOKEN:
        log.error('BOT_TOKEN не задан в .env')
        return

    builder = Application.builder().token(BOT_TOKEN)

    # CF Worker как прокси — VPS не может достучаться до Telegram напрямую
    if WORKER_URL:
        builder = builder.base_url(f'{WORKER_URL}/bot')
        log.info(f'Прокси: {WORKER_URL}')
    else:
        log.warning('WORKER_URL не задан, подключение напрямую')

    app = builder.build()
    app.add_handler(CommandHandler('start', cmd_start))
    app.add_handler(CommandHandler('id',    cmd_start))

    log.info('Бот запущен (polling)')
    app.run_polling(drop_pending_updates=True)


if __name__ == '__main__':
    main()
