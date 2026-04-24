const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

// ── Load .env (no dotenv dependency) ──────────────────
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && !k.startsWith('#') && k.trim()) {
      if (!process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim();
    }
  });
}

const PORT           = parseInt(process.env.PORT) || 2250;
const NOTIFY_IDS     = (process.env.NOTIFY_IDS    || '').split(',').map(s => s.trim()).filter(Boolean);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Z1488Z';
const WORKER_URL     = (process.env.WORKER_URL    || '').replace(/\/$/, '');

const DATA_FILE = path.join(__dirname, 'projects.json');
const UPLOADS   = path.join(__dirname, 'uploads');

// ── Отправка через CF Worker (обход блокировки Telegram) ──
function sendViaWorker(ids, text) {
  if (!WORKER_URL || !ids.length) {
    console.log('[notify] WORKER_URL или ids не заданы');
    return Promise.resolve();
  }
  const body = JSON.stringify({ ids, text });
  return new Promise((resolve) => {
    const workerUrl = new URL(WORKER_URL + '/notify');
    const req = https.request({
      hostname: workerUrl.hostname,
      path:     workerUrl.pathname,
      method:   'POST',
      headers:  {
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(body),
        'x-notify-secret': WEBHOOK_SECRET,
      },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', e => { console.error('[notify]', e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

function notifyAll(text) {
  return sendViaWorker(NOTIFY_IDS, text);
}

if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);

const DEFAULTS = [
  { id:1, name:'E-commerce', desc:'Интернет-магазин с чистым чекаутом. Без лишнего — только путь к покупке. Быстрая загрузка, понятный UX, высокая конверсия.', type:'e-commerce', focus:'conversion', link:'', imageUrls:[], gradient:0, stats:[{k:'конверсия',v:'+38%'},{k:'тип',v:'shop'},{k:'срок',v:'21 д.'}] },
  { id:2, name:'SaaS Product', desc:'Дашборд, онбординг, личный кабинет. Интерфейс, который не мешает работать. Продуманная архитектура компонентов.', type:'saas', focus:'retention', link:'', imageUrls:[], gradient:1, stats:[{k:'retention',v:'+61%'},{k:'тип',v:'saas'},{k:'фокус',v:'retention'}] },
  { id:3, name:'Mobile-first', desc:'Тач-оптимизация, быстрая загрузка, жест вместо клика. Телефон — главный экран. Core Web Vitals в зелёной зоне.', type:'mobile', focus:'speed', link:'', imageUrls:[], gradient:2, stats:[{k:'LCP',v:'0.8s'},{k:'тип',v:'mobile'},{k:'CLS',v:'0'}] },
  { id:4, name:'Editorial / Media', desc:'Лонгриды, редакционная типографика, контент как главный герой. SEO-оптимизация и читаемость на любом устройстве.', type:'media', focus:'content', link:'', imageUrls:[], gradient:3, stats:[{k:'время',v:'+4 мин'},{k:'тип',v:'media'},{k:'SEO',v:'top-3'}] },
  { id:5, name:'Edtech-платформа', desc:'Сайт-воронка и платформа обучения. Когортные запуски, прогресс, понятные состояния для студентов и преподавателей.', type:'platform', focus:'retention', link:'', imageUrls:[], gradient:4, stats:[{k:'фокус',v:'retention'},{k:'тип',v:'platform'},{k:'срок',v:'30 д.'}] },
];

function getProjects() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.length ? list : DEFAULTS;
  } catch { return DEFAULTS; }
}

function saveProjects(list) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

// Seed defaults on startup if needed
try {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const list = JSON.parse(raw);
  if (!Array.isArray(list) || list.length === 0) saveProjects(DEFAULTS);
} catch { saveProjects(DEFAULTS); }

// ── Multipart parser ──────────────────────────────────
function parseMultipart(buf, boundary) {
  const sep = Buffer.from('--' + boundary);
  const parts = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = buf.indexOf(sep, pos);
    if (start === -1) break;
    pos = start + sep.length;
    if (buf[pos] === 45 && buf[pos+1] === 45) break; // --
    if (buf[pos] === 13) pos += 2; // \r\n
    // headers
    const headEnd = buf.indexOf(Buffer.from('\r\n\r\n'), pos);
    if (headEnd === -1) break;
    const headers = buf.slice(pos, headEnd).toString();
    pos = headEnd + 4;
    const nextSep = buf.indexOf(sep, pos);
    const dataEnd = nextSep === -1 ? buf.length : nextSep - 2; // strip \r\n before sep
    const data = buf.slice(pos, dataEnd);
    pos = nextSep === -1 ? buf.length : nextSep;
    const nameMatch = headers.match(/name="([^"]+)"/);
    const fileMatch = headers.match(/filename="([^"]*)"/);
    const ctMatch   = headers.match(/Content-Type:\s*(\S+)/i);
    if (nameMatch) parts.push({
      name: nameMatch[1],
      filename: fileMatch ? fileMatch[1] : null,
      contentType: ctMatch ? ctMatch[1] : 'text/plain',
      data
    });
  }
  return parts;
}

const MIME = {
  '.html':'text/html;charset=utf-8', '.js':'application/javascript',
  '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg',
  '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const send = (data, code = 200) => {
    if (res.headersSent) return;
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  const readBody = () => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  (async () => {
    try {

      // POST /webhook  — Telegram webhook (входящие сообщения боту)
      if (req.method === 'POST' && pathname === '/webhook') {
        const secret = req.headers['x-telegram-bot-api-secret-token'];
        if (WEBHOOK_SECRET && secret !== WEBHOOK_SECRET) {
          res.writeHead(403); return res.end('Forbidden');
        }
        const buf = await readBody();
        try {
          const update = JSON.parse(buf.toString());
          // Автоответ на /start и /id
          const msg = update.message;
          if (msg && msg.text) {
            if (msg.text === '/start' || msg.text === '/id') {
              await sendViaWorker([String(msg.chat.id)],
                `<b>ДваПлюс — бот заявок</b>\n\nВаш Chat ID: <code>${msg.chat.id}</code>`
              );
            }
          }
        } catch (e) { console.error('[webhook parse]', e.message); }
        res.writeHead(200); return res.end('ok');
      }

      // POST /api/contact  — отправка заявки с сайта
      if (req.method === 'POST' && pathname === '/api/contact') {
        const buf  = await readBody();
        const data = JSON.parse(buf.toString() || '{}');

        const name    = (data.name    || '').slice(0, 200);
        const contact = (data.contact || '').slice(0, 200);
        const message = (data.message || '').slice(0, 2000);
        const budget  = (data.budget  || '').slice(0, 100);

        if (!name && !contact && !message) {
          return send({ error: 'empty' }, 400);
        }

        const now  = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        const text = [
          `<b>Новая заявка с сайта</b>`,
          ``,
          `<b>Имя:</b> ${name  || '—'}`,
          `<b>Контакт:</b> ${contact || '—'}`,
          `<b>Проект:</b> ${message || '—'}`,
          `<b>Бюджет:</b> ${budget  || '—'}`,
          ``,
          `<i>${now} МСК</i>`,
        ].join('\n');

        if (NOTIFY_IDS.length) {
          notifyAll(text).catch(e => console.error('[notify]', e.message));
        } else {
          console.log('[contact] нет NOTIFY_IDS, заявка не отправлена в TG');
        }

        console.log(`[contact] ${name} / ${contact} / бюджет: ${budget}`);
        return send({ ok: true });
      }

      // GET /api/projects
      if (req.method === 'GET' && pathname === '/api/projects') {
        return send(getProjects());
      }

      // POST /api/upload  — upload one image, returns { url }
      if (req.method === 'POST' && pathname === '/api/upload') {
        const buf = await readBody();
        const ct  = req.headers['content-type'] || '';
        const bm  = ct.match(/boundary=(.+)$/);
        if (!bm) return send({ error: 'no boundary' }, 400);
        const parts = parseMultipart(buf, bm[1].trim());
        const file  = parts.find(p => p.filename);
        if (!file || !file.filename) return send({ error: 'no file' }, 400);
        const ext   = path.extname(file.filename).toLowerCase() || '.jpg';
        const fname = Date.now() + '_' + Math.random().toString(36).slice(2) + ext;
        fs.writeFileSync(path.join(UPLOADS, fname), file.data);
        return send({ url: '/uploads/' + fname });
      }

      // POST /api/projects
      if (req.method === 'POST' && pathname === '/api/projects') {
        const buf  = await readBody();
        const data = JSON.parse(buf.toString() || '{}');
        if (!data.name) return send({ error: 'no name' }, 400);
        const list = getProjects();
        const p = {
          id: Date.now(),
          name: data.name, desc: data.desc || '',
          type: data.type || 'custom', focus: data.focus || '—',
          link: data.link || '', imageUrls: data.imageUrls || [],
          gradient: list.length % 5,
          stats: data.stats || [{ k: 'тип', v: data.type || 'custom' }, { k: 'фокус', v: data.focus || '—' }],
        };
        list.push(p);
        saveProjects(list);
        return send(p);
      }

      // PUT /api/projects/:id
      if (req.method === 'PUT' && pathname.startsWith('/api/projects/')) {
        const id   = parseInt(pathname.split('/').pop());
        const buf  = await readBody();
        const data = JSON.parse(buf.toString() || '{}');
        const list = getProjects();
        const idx  = list.findIndex(p => p.id === id);
        if (idx === -1) return send({ error: 'not found' }, 404);
        Object.assign(list[idx], {
          name:      data.name      ?? list[idx].name,
          desc:      data.desc      ?? list[idx].desc,
          type:      data.type      ?? list[idx].type,
          focus:     data.focus     ?? list[idx].focus,
          link:      data.link      ?? list[idx].link,
          imageUrls: data.imageUrls ?? list[idx].imageUrls,
          stats:     data.stats     ?? list[idx].stats,
        });
        saveProjects(list);
        return send(list[idx]);
      }

      // DELETE /api/projects/:id
      if (req.method === 'DELETE' && pathname.startsWith('/api/projects/')) {
        const id = parseInt(pathname.split('/').pop());
        saveProjects(getProjects().filter(p => p.id !== id));
        return send({ ok: true });
      }

      // GET /api/preview?url=...  — server-side proxy for thum.io
      if (req.method === 'GET' && pathname === '/api/preview') {
        const targetUrl = parsed.query.url;
        if (!targetUrl) return send({ error: 'no url' }, 400);
        const apiUrl = 'https://api.microlink.io/?url=' + encodeURIComponent(targetUrl) + '&screenshot=true&embed=screenshot.url';
        await new Promise((resolve, reject) => {
          const req2 = https.get(apiUrl, { timeout: 30000 }, (tRes) => {
            if (tRes.statusCode >= 400) {
              tRes.resume();
              reject(new Error('preview service returned ' + tRes.statusCode));
              return;
            }
            const ct = tRes.headers['content-type'] || 'image/jpeg';
            if (!res.headersSent) {
              res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'public,max-age=3600', 'Access-Control-Allow-Origin': '*' });
            }
            tRes.pipe(res);
            tRes.on('end', resolve);
            tRes.on('error', reject);
          });
          req2.on('error', reject);
          req2.on('timeout', () => { req2.destroy(); reject(new Error('timeout')); });
        });
        return;
      }

      // Static: /uploads/*
      if (pathname.startsWith('/uploads/')) {
        const fp = path.join(UPLOADS, pathname.slice(9));
        if (fs.existsSync(fp)) {
          const ext = path.extname(fp).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
          return res.end(fs.readFileSync(fp));
        }
        return send({ error: 'not found' }, 404);
      }

      // Static files
      let fp = pathname === '/' ? '/index.html' : pathname;
      fp = path.join(__dirname, fp);
      if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
        const ext = path.extname(fp).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
        return res.end(fs.readFileSync(fp));
      }

      send({ error: 'not found' }, 404);

    } catch (e) {
      console.error('[ERROR]', req.method, pathname, e.message);
      if (!res.headersSent) { res.writeHead(500); res.end('server error'); }
    }
  })();
});

server.listen(PORT, () => console.log(`✓  http://localhost:${PORT}`));
