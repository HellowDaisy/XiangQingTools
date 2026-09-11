/* 相亲契合度 · 托管版后端
 * 纯 Node 标准库，无第三方依赖。
 * 功能：静态托管 hosted.html + 房间/答卷 JSON API（文件持久化）。
 * 运行：node server.js  （可用环境变量 PORT 指定端口）
 * 部署：本机/局域网直跑，或上传到 Render / Railway / Glitch 等托管平台。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'rooms.json');
const HTML_FILE = path.join(__dirname, 'hosted.html');

let rooms = {};
try { rooms = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (_) { rooms = {}; }

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rooms, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function roomId() { return crypto.randomBytes(3).toString('hex'); }

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

function sanitizeAnswers(raw) {
  // 只保留当前问卷用到的题目标识；值保留原始类型
  const known = new Set(['age','place','edu','job','habit','hobby','conspend','out','soc','tidy',
    'fwork','fmoney','fplan','ffamily','fchild','pee','pfeel','pspon','pnew',
    'parg','rmarry','rmoney','rhouse','rbound','rstep']);
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) {
      if (known.has(k) && (typeof raw[k] === 'number' || Array.isArray(raw[k]))) out[k] = raw[k];
    }
  }
  return out;
}

function stat(room) {
  const a = room.a, b = room.b;
  return { filledA: !!(a && Object.keys(a).length), filledB: !!(b && Object.keys(b).length) };
}

const server = http.createServer(async (req, res) => {
  let url = req.url.split('?')[0];
  const method = req.method;

  if (method === 'OPTIONS') { send(res, 204, {}); return; }

  // ---- API 路由 ----
  if (url === '/api/room/new' && method === 'GET') {
    const id = roomId();
    rooms[id] = { created: Date.now(), a: {}, b: {} };
    save();
    send(res, 200, { room: id });
    return;
  }

  let m;
  if ((m = url.match(/^\/api\/room\/([a-f0-9]{6})$/)) && method === 'GET') {
    const room = rooms[m[1]];
    if (!room) { send(res, 404, { error: 'room_not_found' }); return; }
    send(res, 200, { room: m[1], a: room.a, b: room.b, ...stat(room) });
    return;
  }

  if ((m = url.match(/^\/api\/room\/([a-f0-9]{6})\/(a|b)$/)) && method === 'POST') {
    const room = rooms[m[1]];
    if (!room) { send(res, 404, { error: 'room_not_found' }); return; }
    const body = await readBody(req);
    room[m[2]] = sanitizeAnswers(body.answers);
    save();
    send(res, 200, { ok: true, ...stat(room) });
    return;
  }

  if (url === '/api/health' && method === 'GET') { send(res, 200, { ok: true }); return; }

  // ---- 静态页面 ----
  if (url === '/' || url === '/index.html') {
    url = '/hosted.html';
  }
  if (url === '/hosted.html') {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { send(res, 500, { error: 'html_missing' }); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  send(res, 404, { error: 'not_found' });
});

server.listen(PORT, () => {
  console.log('相亲契合度托管版已启动');
  console.log('本机地址:  http://localhost:' + PORT);
  try {
    const os = require('os');
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const ni of nets[name]) {
        if (ni.family === 'IPv4' && !ni.internal) {
          console.log('局域网地址: http://' + ni.address + ':' + PORT + '   （可发给同一 WiFi 下的人）');
        }
      }
    }
  } catch (_) {}
  console.log('要外网访问：用 cloudflared/ngrok 隧道，或部署到 Render 等平台。');
});