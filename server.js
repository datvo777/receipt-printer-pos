'use strict';
/**
 * Tiệm Bill - máy chủ nhỏ chạy ở tiệm (không cần cài thư viện nào, chỉ cần Node.js).
 * - Lưu dịch vụ, bill, thống kê vào file data/db.json
 * - Phục vụ giao diện web cho iPhone / máy tính
 * - Nhận ảnh bill từ giao diện và gửi ra máy in nhiệt (USB trên Windows, LAN, hoặc CUPS trên Mac/Linux)
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const RAW_PS1 = path.join(ROOT, 'tools', 'rawprint.ps1');
const KEEP_BACKUPS = 60;

fs.mkdirSync(BACKUP_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Dữ liệu                                                             */
/* ------------------------------------------------------------------ */

function defaultDb() {
  return {
    version: 1,
    seq: 0,
    settings: {
      shopName: 'TÊN TIỆM',
      address: '',
      phone: '',
      footer: 'Cảm ơn quý khách!',
      printer: {
        mode: os.platform() === 'win32' ? 'windows' : 'cups', // windows | lan | cups
        name: '',
        ip: '',
        port: 9100,
        paperDots: 576, // khổ 80mm = 576 chấm
        feed: 4,
        cut: true,
      },
    },
    services: [
      { id: 's1', name: 'Sơn', price: 50000 },
      { id: 's2', name: 'Đắp bột', price: 100000 },
      { id: 's3', name: 'Cắt da', price: 30000 },
    ],
    bills: [],
  };
}

let db = loadDb();

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return normalizeDb(JSON.parse(raw));
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // File hỏng: giữ lại bản hỏng để không mất, rồi tạo mới
      try { fs.copyFileSync(DB_FILE, path.join(DATA_DIR, `db-hong-${Date.now()}.json`)); } catch (_) {}
      console.error('Không đọc được db.json, tạo mới:', e.message);
    }
    const fresh = defaultDb();
    writeDb(fresh);
    return fresh;
  }
}

function normalizeDb(input) {
  const d = defaultDb();
  const out = Object.assign(d, input || {});
  out.settings = Object.assign(d.settings, (input && input.settings) || {});
  out.settings.printer = Object.assign(defaultDb().settings.printer, (input && input.settings && input.settings.printer) || {});
  if (!Array.isArray(out.services)) out.services = d.services;
  if (!Array.isArray(out.bills)) out.bills = [];
  out.seq = Math.max(Number(out.seq) || 0, ...out.bills.map((b) => Number(b.no) || 0), 0);
  return out;
}

function writeDb(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function save() {
  writeDb(db);
  dailyBackup();
}

let lastBackupDay = '';
function dailyBackup() {
  const day = localParts(new Date()).day;
  if (day === lastBackupDay) {
    // trong ngày: ghi đè bản của ngày hôm nay để luôn mới nhất
  }
  lastBackupDay = day;
  try {
    fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `db-${day}.json`));
    const files = fs.readdirSync(BACKUP_DIR).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (files.length > KEEP_BACKUPS) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (e) {
    console.error('Không sao lưu được:', e.message);
  }
}

function pad(n) { return String(n).padStart(2, '0'); }
function localParts(d) {
  return {
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    month: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function cleanMoney(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
function cleanStr(v, max = 200) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, max);
}

/* ------------------------------------------------------------------ */
/* In ấn                                                               */
/* ------------------------------------------------------------------ */

let printQueue = Promise.resolve();
function enqueue(fn) {
  const run = printQueue.then(fn, fn);
  printQueue = run.catch(() => {});
  return run;
}

/** Ghép lệnh ESC/POS: ảnh 1-bit (đã đóng gói) -> raster, rồi đẩy giấy + cắt. */
function buildEscPos({ widthBytes, height, bitmap }, printerCfg) {
  const parts = [Buffer.from([0x1b, 0x40])]; // ESC @ : reset
  const BAND = 128; // chia nhỏ để máy in rẻ tiền không bị tràn bộ đệm
  for (let y = 0; y < height; y += BAND) {
    const h = Math.min(BAND, height - y);
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]));
    parts.push(bitmap.subarray(y * widthBytes, (y + h) * widthBytes));
  }
  const feed = Math.max(0, Math.min(20, Number(printerCfg.feed) || 0));
  parts.push(Buffer.from([0x1b, 0x64, feed])); // ESC d n : đẩy giấy n dòng
  if (printerCfg.cut !== false) parts.push(Buffer.from([0x1d, 0x56, 0x42, 0x00])); // GS V 66 0 : đẩy giấy rồi cắt một phần
  return Buffer.concat(parts);
}

function sendLan(buf, ip, port) {
  return new Promise((resolve, reject) => {
    if (!ip) return reject(new Error('Chưa nhập địa chỉ IP máy in (vào Cài đặt).'));
    const sock = net.createConnection({ host: ip, port: Number(port) || 9100 });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      sock.destroy();
      err ? reject(err) : resolve();
    };
    sock.setTimeout(8000, () => finish(new Error(`Không kết nối được máy in ${ip}:${port || 9100} (quá thời gian). Kiểm tra dây mạng và địa chỉ IP.`)));
    sock.on('error', (e) => finish(new Error(`Không kết nối được máy in ${ip}:${port || 9100} (${e.code || e.message}).`)));
    sock.on('connect', () => {
      sock.write(buf, (err) => {
        if (err) return finish(err);
        sock.end();
      });
    });
    sock.on('close', () => finish());
  });
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, Object.assign({ timeout: 20000, windowsHide: true }, opts), (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').toString().trim() || 'Lỗi không rõ'));
      resolve(stdout.toString());
    });
  });
}

async function sendWindows(buf, printerName) {
  if (!printerName) throw new Error('Chưa chọn máy in (vào Cài đặt → Máy in).');
  const file = path.join(TMP_DIR, `job-${Date.now()}.bin`);
  fs.writeFileSync(file, buf);
  try {
    await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RAW_PS1, '-Printer', printerName, '-File', file]);
  } finally {
    fs.unlink(file, () => {});
  }
}

async function sendCups(buf, printerName) {
  const file = path.join(TMP_DIR, `job-${Date.now()}.bin`);
  fs.writeFileSync(file, buf);
  try {
    const args = printerName ? ['-d', printerName, '-o', 'raw', file] : ['-o', 'raw', file];
    await run('lp', args);
  } finally {
    fs.unlink(file, () => {});
  }
}

function sendToPrinter(buf, cfg) {
  switch (cfg.mode) {
    case 'lan': return sendLan(buf, cfg.ip, cfg.port);
    case 'windows': return sendWindows(buf, cfg.name);
    case 'cups': return sendCups(buf, cfg.name);
    default: return Promise.reject(new Error('Chưa chọn cách kết nối máy in.'));
  }
}

async function listPrinters() {
  try {
    if (os.platform() === 'win32') {
      const out = await run('powershell.exe', ['-NoProfile', '-Command', '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Printer | Select-Object -ExpandProperty Name']);
      return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    const out = await run('lpstat', ['-e']);
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Thống kê                                                            */
/* ------------------------------------------------------------------ */

function statsFor(month) {
  const bills = db.bills.filter((b) => b.month === month);
  const revenue = bills.reduce((s, b) => s + b.total, 0);
  const byService = new Map();
  const byDay = new Map();
  for (const b of bills) {
    byDay.set(b.day, (byDay.get(b.day) || { day: b.day, customers: 0, revenue: 0 }));
    const d = byDay.get(b.day);
    d.customers += 1;
    d.revenue += b.total;
    for (const it of b.items) {
      const key = it.name;
      const cur = byService.get(key) || { name: key, count: 0, revenue: 0 };
      cur.count += it.qty;
      cur.revenue += it.price * it.qty;
      byService.set(key, cur);
    }
  }
  return {
    month,
    customers: bills.length,
    revenue,
    average: bills.length ? Math.round(revenue / bills.length) : 0,
    services: [...byService.values()].sort((a, b) => b.revenue - a.revenue),
    days: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    months: [...new Set(db.bills.map((b) => b.month))].sort().reverse(),
  };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Dữ liệu quá lớn'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (_) { reject(Object.assign(new Error('JSON không hợp lệ'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

function publicSettings() {
  return db.settings;
}

async function handleApi(req, res, url) {
  const m = req.method;
  const p = url.pathname;

  if (m === 'GET' && p === '/api/state') {
    return sendJson(res, 200, {
      settings: publicSettings(),
      services: db.services,
      info: { ips: lanAddresses(), port: PORT, platform: os.platform(), hostname: os.hostname() },
    });
  }

  if (m === 'GET' && p === '/api/printers') {
    return sendJson(res, 200, { printers: await listPrinters() });
  }

  if (m === 'PUT' && p === '/api/services') {
    const body = await readBody(req);
    if (!Array.isArray(body.services)) return sendJson(res, 400, { error: 'Thiếu danh sách dịch vụ' });
    const seen = new Set();
    db.services = body.services.slice(0, 300).map((s, i) => {
      let id = cleanStr(s.id, 40) || `s${Date.now().toString(36)}${i}`;
      while (seen.has(id)) id += 'x';
      seen.add(id);
      return { id, name: cleanStr(s.name, 80).trim() || 'Dịch vụ', price: cleanMoney(s.price) };
    });
    save();
    return sendJson(res, 200, { services: db.services });
  }

  if (m === 'PUT' && p === '/api/settings') {
    const b = await readBody(req);
    const s = db.settings;
    s.shopName = cleanStr(b.shopName, 60);
    s.address = cleanStr(b.address, 120);
    s.phone = cleanStr(b.phone, 40);
    s.footer = cleanStr(b.footer, 160);
    const bp = b.printer || {};
    const mode = ['windows', 'lan', 'cups'].includes(bp.mode) ? bp.mode : s.printer.mode;
    s.printer = {
      mode,
      name: cleanStr(bp.name, 120),
      ip: cleanStr(bp.ip, 60).trim(),
      port: Math.min(65535, Math.max(1, Number(bp.port) || 9100)),
      paperDots: [384, 512, 576, 640].includes(Number(bp.paperDots)) ? Number(bp.paperDots) : 576,
      feed: Math.min(20, Math.max(0, Number(bp.feed) || 0)),
      cut: bp.cut !== false,
    };
    save();
    return sendJson(res, 200, { settings: s });
  }

  if (m === 'GET' && p === '/api/bills') {
    const month = url.searchParams.get('month');
    const list = (month ? db.bills.filter((b) => b.month === month) : db.bills.slice(-200))
      .slice()
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return sendJson(res, 200, { bills: list });
  }

  if (m === 'POST' && p === '/api/bills') {
    const b = await readBody(req);
    if (!Array.isArray(b.items) || !b.items.length) return sendJson(res, 400, { error: 'Chưa chọn dịch vụ nào.' });
    const items = b.items.slice(0, 100).map((it) => ({
      name: cleanStr(it.name, 80).trim() || 'Dịch vụ',
      price: cleanMoney(it.price),
      qty: Math.min(999, Math.max(1, Math.round(Number(it.qty) || 1))),
    }));
    const now = new Date();
    const lp = localParts(now);
    db.seq += 1;
    const bill = {
      id: `b${now.getTime().toString(36)}${db.seq}`,
      no: db.seq,
      createdAt: now.toISOString(),
      day: lp.day,
      month: lp.month,
      time: lp.time,
      items,
      total: items.reduce((s, it) => s + it.price * it.qty, 0),
      note: cleanStr(b.note, 120).trim(),
    };
    db.bills.push(bill);
    save();
    return sendJson(res, 201, { bill });
  }

  const del = p.match(/^\/api\/bills\/([\w-]+)$/);
  if (m === 'DELETE' && del) {
    const before = db.bills.length;
    db.bills = db.bills.filter((b) => b.id !== del[1]);
    if (db.bills.length === before) return sendJson(res, 404, { error: 'Không tìm thấy bill.' });
    save();
    return sendJson(res, 200, { ok: true });
  }

  if (m === 'GET' && p === '/api/stats') {
    const month = url.searchParams.get('month') || localParts(new Date()).month;
    return sendJson(res, 200, statsFor(month));
  }

  if (m === 'POST' && p === '/api/print') {
    const b = await readBody(req, 12 * 1024 * 1024);
    const width = Number(b.width);
    const height = Number(b.height);
    if (!(width > 0 && width % 8 === 0 && width <= 832) || !(height > 0 && height <= 8000)) {
      return sendJson(res, 400, { error: 'Kích thước ảnh bill không hợp lệ.' });
    }
    const bitmap = Buffer.from(String(b.data || ''), 'base64');
    const widthBytes = width / 8;
    if (bitmap.length !== widthBytes * height) return sendJson(res, 400, { error: 'Dữ liệu ảnh bill bị thiếu.' });
    const cfg = db.settings.printer;
    const payload = buildEscPos({ widthBytes, height, bitmap }, cfg);
    try {
      await enqueue(() => sendToPrinter(payload, cfg));
      return sendJson(res, 200, { ok: true, bytes: payload.length });
    } catch (e) {
      return sendJson(res, 502, { error: e.message });
    }
  }

  if (m === 'GET' && p === '/api/backup') {
    const day = localParts(new Date()).day;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="tiem-bill-backup-${day}.json"`,
      'Cache-Control': 'no-store',
    });
    return res.end(JSON.stringify(db, null, 2));
  }

  if (m === 'POST' && p === '/api/restore') {
    const b = await readBody(req, 30 * 1024 * 1024);
    if (!b || !Array.isArray(b.services) || !Array.isArray(b.bills) || typeof b.settings !== 'object') {
      return sendJson(res, 400, { error: 'File sao lưu không đúng định dạng.' });
    }
    try { fs.copyFileSync(DB_FILE, path.join(DATA_DIR, `db-truoc-khi-khoi-phuc-${Date.now()}.json`)); } catch (_) {}
    db = normalizeDb(b);
    save();
    return sendJson(res, 200, { ok: true, bills: db.bills.length });
  }

  return sendJson(res, 404, { error: 'Không tìm thấy' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== PUBLIC_DIR) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.message || 'Lỗi máy chủ' });
    else res.end();
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nCổng ${PORT} đang được dùng. Có thể app đã chạy sẵn ở cửa sổ khác. Hãy tắt cửa sổ cũ rồi chạy lại.\n`);
  } else {
    console.error(e);
  }
  process.exit(e.code === 'EADDRINUSE' ? 2 : 1);
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('==============================================');
  console.log('  TIỆM BILL đang chạy');
  console.log('  Mở trên iPhone (cùng WiFi) bằng Safari:');
  if (ips.length) ips.forEach((ip) => console.log(`     http://${ip}:${PORT}`));
  else console.log('     (chưa thấy địa chỉ mạng, kiểm tra WiFi/dây mạng)');
  console.log(`  Mở trên máy này:  http://localhost:${PORT}`);
  console.log('  Đừng tắt cửa sổ này khi đang bán hàng.');
  console.log('==============================================');
});

process.on('uncaughtException', (e) => console.error('Lỗi:', e));
process.on('unhandledRejection', (e) => console.error('Lỗi:', e));
