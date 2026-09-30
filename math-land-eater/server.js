'use strict';
/* 매뜨 땅먹 서버 — 외부 라이브러리 없이 Node.js 내장 모듈만 사용한다.
 * 회원가입/로그인, 학년별 서버(월드), 땅 뺏기/방어, 실시간 소식(SSE)을 담당한다. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const S = require('./public/js/shared.js');

const PORT = Number(process.env.PORT) || 3000;
const DEBUG_PASSWORD = process.env.DEBUG_PASSWORD || 'kim1234school';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BASE_COST = 2;      // 방어가 없는 땅을 뺏을 때 풀어야 하는 문제 수
const MAX_DEF = 99;       // 한 칸의 최대 방어 수
const MAX_DEF_STEP = 20;  // 한 번에 올릴 수 있는 방어 수
const SESSION_DAYS = 30;

const grid = S.buildGrid();
const L = grid.cc.length;
const BASE = S.baseSchools();
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------- 저장 ----------
const db = { users: {}, sessions: {}, custom: [], worlds: {} };
try { Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); }
catch (e) { if (e.code !== 'ENOENT') { console.error('data/db.json 을 읽을 수 없어요:', e.message); process.exit(1); } }

let saveTimer = null;
const save = () => { if (!saveTimer) saveTimer = setTimeout(saveNow, 800); };
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db));
  fs.renameSync(DB_FILE + '.tmp', DB_FILE);
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (saveTimer) saveNow(); process.exit(0); });

for (const [t, s] of Object.entries(db.sessions)) if (Date.now() - s.at > SESSION_DAYS * 864e5) delete db.sessions[t];

// ---------- 학교 ----------
const schoolCount = () => BASE.length + db.custom.length;
const schoolById = id => (id < BASE.length ? BASE[id] : db.custom[id - BASE.length]);
const publicCustom = () => db.custom.map((c, i) => ({ id: BASE.length + i, name: c.name, sido: c.sido, sigungu: c.sigungu }));

// ---------- 학년별 월드 ----------
const worlds = {}; // grade → { w: 저장되는 상태, homeCell: 칸→본부 학교, clients: SSE 연결 }

function nearestCell(lat, lon, ok) {
  const p = S.latLonToCR(lat, lon), c0 = Math.round(p.c), r0 = Math.round(p.r);
  for (let rad = 0; rad < Math.max(grid.cols, grid.rows); rad++) {
    let best = -1, bd = Infinity;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
      const c = c0 + dx, r = r0 + dy;
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      const k = grid.idx[r * grid.cols + c], d = dx * dx + dy * dy;
      if (k >= 0 && d < bd && ok(k)) { bd = d; best = k; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

// 학교 본부 자리를 정하고, 둘레의 빈 땅을 처음 땅으로 준다. 바뀐 칸 목록을 돌려준다.
function placeSchool(rt, id) {
  const { w, homeCell } = rt, sc = schoolById(id);
  // 다른 학교 본부와 바로 붙지 않는 빈 땅을 먼저 찾는다
  let cell = nearestCell(sc.lat, sc.lon, k => w.owner[k] < 0 && !S.neighbors(grid, k, true).some(n => homeCell[n] >= 0));
  if (cell < 0) cell = nearestCell(sc.lat, sc.lon, k => w.owner[k] < 0);
  if (cell < 0) cell = nearestCell(sc.lat, sc.lon, k => homeCell[k] < 0);
  if (cell < 0) return [];
  w.owner[cell] = id; w.def[cell] = 0; w.home[id] = cell; homeCell[cell] = id;
  return [cell];
}
// 본부 둘레의 빈 땅을 한 칸씩 돌아가며 나눠 준다 (학교가 몰린 도시에서도 공평하게)
function giveStartLand(rt, ids) {
  const { w } = rt, out = [];
  for (let round = 0; round < 4; round++) for (const id of ids) {
    const n = S.neighbors(grid, w.home[id], false).find(k => w.owner[k] < 0);
    if (n !== undefined) { w.owner[n] = id; out.push(n); }
  }
  return out;
}

function getWorld(grade) {
  if (worlds[grade]) return worlds[grade];
  let w = db.worlds[grade];
  const fresh = !w || !Array.isArray(w.owner) || w.owner.length !== L;
  if (fresh) w = db.worlds[grade] = { owner: new Array(L).fill(-1), def: new Array(L).fill(0), home: [] };
  const rt = worlds[grade] = { w, homeCell: new Int32Array(L).fill(-1), clients: new Map() };
  if (fresh) {
    for (const s of BASE) placeSchool(rt, s.id);
    giveStartLand(rt, BASE.map(s => s.id));
    save();
  } else {
    w.home.forEach((c, id) => { if (c != null && c >= 0) rt.homeCell[c] = id; });
  }
  return rt;
}

const cellState = (rt, i) => [i, rt.w.owner[i], rt.w.def[i]];

function ensurePlaced(rt, id) {
  const h = rt.w.home[id];
  if (h != null && h >= 0) return;
  const cells = placeSchool(rt, id);
  if (!cells.length) return;
  cells.push(...giveStartLand(rt, [id]));
  save();
  const sc = schoolById(id), home = rt.w.home[id];
  broadcast(rt, { t: 'upd', school: { id, name: sc.name, sido: sc.sido, sigungu: sc.sigungu }, home, cells: cells.map(i => cellState(rt, i)), ev: { kind: 'join', sid: id, cell: home } });
}

function broadcast(rt, msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of rt.clients.keys()) res.write(data);
}
const onlineCount = rt => new Set(rt.clients.values()).size;
setInterval(() => { for (const rt of Object.values(worlds)) for (const res of rt.clients.keys()) res.write(': ping\n\n'); }, 25000);

// ---------- 로그인 ----------
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (msg, code = 400) => { throw new HttpError(code, msg); };
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sha = s => crypto.createHash('sha256').update(s).digest();
const userKey = name => 'u_' + String(name).toLowerCase();
const gradeOf = u => S.gradeFromBirthYear(u.birthYear);
const publicUser = u => ({ username: u.username, birthYear: u.birthYear, grade: gradeOf(u), profile: u.profile || null });

function newSession(key) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { user: key, at: Date.now(), debug: false };
  save();
  return { token, user: publicUser(db.users[key]) };
}
function getAuth(req, url) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  const s = token && hasOwn(db.sessions, token) ? db.sessions[token] : null;
  const u = s && hasOwn(db.users, s.user) ? db.users[s.user] : null;
  return u ? { token, s, u } : null;
}
function needLogin(req, url) {
  const a = getAuth(req, url);
  if (!a) fail('로그인이 필요해요.', 401);
  return a;
}
function needPlayer(req, url) {
  const a = needLogin(req, url), g = gradeOf(a.u);
  if (g < 1 || g > 6) fail('초등학생(1~6학년)만 플레이할 수 있어요.', 403);
  if (!a.u.profile) fail('먼저 학교와 닉네임을 설정해 주세요.', 409);
  a.grade = g;
  a.rt = getWorld(g);
  a.sid = a.u.profile.schoolId;
  ensurePlaced(a.rt, a.sid);
  return a;
}
function targetCell(b) {
  const cell = Number(b.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell >= L) fail('땅을 다시 골라 주세요.');
  return cell;
}

// ---------- API ----------
const routes = {
  'POST /api/signup': (req, url, b) => {
    const username = String(b.username || '').trim(), password = String(b.password || ''), birthYear = Number(b.birthYear);
    if (!/^[A-Za-z0-9_]{4,16}$/.test(username)) fail('아이디는 영어·숫자 4~16자로 만들어 주세요.');
    if (password.length < 4 || password.length > 64) fail('비밀번호는 4자 이상으로 만들어 주세요.');
    if (!Number.isInteger(birthYear)) fail('나이 인증을 위해 출생연도를 골라 주세요.');
    const g = S.gradeFromBirthYear(birthYear), sy = S.schoolYear();
    if (g < 1 || g > 6) fail(`나이 인증 실패: 초등학생(${sy - 12}~${sy - 7}년생)만 가입할 수 있어요.`);
    const key = userKey(username);
    if (hasOwn(db.users, key)) fail('이미 있는 아이디예요. 다른 아이디를 써 주세요.');
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[key] = { username, salt, hash: hashPw(password, salt), birthYear, profile: null, at: Date.now() };
    return newSession(key);
  },

  'POST /api/login': (req, url, b) => {
    const key = userKey(b.username || ''), u = hasOwn(db.users, key) ? db.users[key] : null;
    const ok = u && crypto.timingSafeEqual(Buffer.from(hashPw(String(b.password || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'));
    if (!ok) fail('아이디 또는 비밀번호가 틀렸어요.');
    return newSession(key);
  },

  'POST /api/logout': (req, url) => {
    const a = getAuth(req, url);
    if (a) { delete db.sessions[a.token]; save(); }
    return { ok: true };
  },

  'GET /api/me': (req, url) => {
    const a = needLogin(req, url);
    return { user: publicUser(a.u), debug: !!a.s.debug };
  },

  'GET /api/schools': () => ({ custom: publicCustom() }),

  'POST /api/profile': (req, url, b) => {
    const a = needLogin(req, url);
    const semester = Number(b.semester);
    if (semester !== 1 && semester !== 2) fail('학기를 골라 주세요.');
    const nickname = String(b.nickname || '').replace(/[\u0000-\u001f<>]/g, '').trim();
    if (nickname.length < 1 || nickname.length > 10) fail('닉네임은 1~10자로 써 주세요.');
    let schoolId;
    if (b.custom) {
      const di = Number(b.custom.di), d = Number.isInteger(di) ? S.DISTRICTS[di] : null;
      if (!d) fail('학교가 있는 지역을 골라 주세요.');
      const stem = String(b.custom.name || '').replace(/\s+/g, '').replace(/(초등학교|초교|초)$/, '');
      if (!/^[가-힣A-Za-z0-9]{1,12}$/.test(stem)) fail('학교 이름은 한글·영어·숫자로 1~12자 써 주세요.');
      const name = stem + '초등학교', same = s => s.name === name && s.sido === d.sido && s.sigungu === d.sigungu;
      const base = BASE.find(same);
      if (base) schoolId = base.id;
      else {
        let ci = db.custom.findIndex(same);
        if (ci < 0) {
          if (db.custom.length >= 5000) fail('더 이상 학교를 등록할 수 없어요.');
          db.custom.push({ name, sido: d.sido, sigungu: d.sigungu, lat: d.lat + (Math.random() - 0.5) * 0.08, lon: d.lon + (Math.random() - 0.5) * 0.1, by: a.u.username });
          ci = db.custom.length - 1;
        }
        schoolId = BASE.length + ci;
      }
    } else {
      schoolId = Number(b.schoolId);
      if (!Number.isInteger(schoolId) || schoolId < 0 || schoolId >= schoolCount()) fail('학교를 골라 주세요.');
    }
    a.u.profile = { schoolId, semester, nickname };
    save();
    const g = gradeOf(a.u);
    if (g >= 1 && g <= 6) ensurePlaced(getWorld(g), schoolId);
    return { user: publicUser(a.u), custom: publicCustom() };
  },

  'GET /api/world': (req, url) => {
    const a = needPlayer(req, url), w = a.rt.w, def = [], home = [];
    w.def.forEach((d, i) => { if (d > 0) def.push([i, d]); });
    for (let i = 0; i < schoolCount(); i++) home.push(w.home[i] != null ? w.home[i] : -1);
    return { grade: a.grade, landCount: L, owner: w.owner, def, home, custom: publicCustom(), online: onlineCount(a.rt) };
  },

  // 땅 뺏기: 우리 땅과 닿은 칸만, 방어가 없으면 2문제, 있으면 방어 수만큼 풀어야 한다
  'POST /api/capture': (req, url, b) => {
    const a = needPlayer(req, url), { w, homeCell } = a.rt, sid = a.sid, cell = targetCell(b), prev = w.owner[cell];
    if (prev === sid) fail('이미 우리 학교 땅이에요.');
    if (homeCell[cell] >= 0) fail('학교 본부는 뺏을 수 없어요.');
    if (!S.neighbors(grid, cell, true).some(n => w.owner[n] === sid)) fail('우리 학교 땅과 닿아 있는 땅만 뺏을 수 있어요.');
    const required = prev < 0 ? BASE_COST : Math.max(BASE_COST, w.def[cell]);
    if (b.cheat) { if (!a.s.debug) fail('버그 창이 잠겨 있어요.', 403); }
    else {
      const solved = Number(b.solved) || 0;
      if (solved < required) return { need: required - solved, required }; // 그사이 방어가 늘었다
    }
    w.owner[cell] = sid;
    w.def[cell] = 0;
    save();
    const cells = [cellState(a.rt, cell)];
    broadcast(a.rt, { t: 'upd', cells, ev: { kind: 'capture', by: a.u.profile.nickname, sid, prev, cell } });
    return { ok: true, cells };
  },

  // 땅 방어: 정한 수만큼 문제를 풀면 그 수만큼 방어가 올라간다
  'POST /api/defend': (req, url, b) => {
    const a = needPlayer(req, url), { w, homeCell } = a.rt, sid = a.sid, cell = targetCell(b), amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_DEF_STEP) fail(`방어 수는 1~${MAX_DEF_STEP} 사이로 골라 주세요.`);
    if (w.owner[cell] !== sid) fail('우리 학교 땅만 방어할 수 있어요.');
    if (homeCell[cell] >= 0) fail('학교 본부는 언제나 안전해요.');
    if (w.def[cell] >= MAX_DEF) fail(`방어는 최대 ${MAX_DEF}까지예요.`);
    if (b.cheat) { if (!a.s.debug) fail('버그 창이 잠겨 있어요.', 403); }
    else if ((Number(b.solved) || 0) < amount) fail(`문제를 ${amount}개 풀어야 방어할 수 있어요.`);
    w.def[cell] = Math.min(MAX_DEF, w.def[cell] + amount);
    save();
    const cells = [cellState(a.rt, cell)];
    broadcast(a.rt, { t: 'upd', cells, ev: { kind: 'defend', by: a.u.profile.nickname, sid, amount, cell } });
    return { ok: true, cells };
  },

  'POST /api/debug/unlock': (req, url, b) => {
    const a = needLogin(req, url);
    if (!crypto.timingSafeEqual(sha(String(b.password || '')), sha(DEBUG_PASSWORD))) fail('비밀번호가 틀렸어요.');
    a.s.debug = true;
    save();
    return { ok: true };
  },
};

// 실시간 소식 (Server-Sent Events)
function events(req, res, url) {
  let a;
  try { a = needPlayer(req, url); } catch (e) { return send(req, res, e.code || 500, { error: e.message }); }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const rt = a.rt, online = () => broadcast(rt, { t: 'online', n: onlineCount(rt) });
  rt.clients.set(res, a.u.username);
  online();
  req.on('close', () => { rt.clients.delete(res); online(); });
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const wantsGzip = req => /\bgzip\b/.test(req.headers['accept-encoding'] || '');

function send(req, res, code, obj) {
  let body = Buffer.from(JSON.stringify(obj));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  if (body.length > 1024 && wantsGzip(req)) { body = zlib.gzipSync(body); headers['Content-Encoding'] = 'gzip'; }
  res.writeHead(code, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 16384) { reject(new HttpError(413, '보낸 내용이 너무 커요.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) || {} : {}); }
      catch { reject(new HttpError(400, '잘못된 요청이에요.')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, url) {
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 페이지예요.'); }
    const type = MIME[path.extname(file)] || 'application/octet-stream', headers = { 'Content-Type': type, 'Cache-Control': 'no-cache' };
    if (/^text\//.test(type) && wantsGzip(req)) { data = zlib.gzipSync(data); headers['Content-Encoding'] = 'gzip'; }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (url.pathname === '/api/events' && req.method === 'GET') return events(req, res, url);
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(req, res, 404, { error: '없는 기능이에요.' });
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      send(req, res, 200, await handler(req, url, body));
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      send(req, res, e instanceof HttpError ? e.code : 500, { error: e instanceof HttpError ? e.message : '서버 오류가 났어요.' });
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, url);
}).listen(PORT, () => {
  console.log(`매뜨 땅먹 서버가 켜졌어요 → http://localhost:${PORT}  (땅 ${L}칸, 학교 ${BASE.length}곳)`);
});
