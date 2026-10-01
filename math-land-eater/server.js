'use strict';
/* 매뜨 땅먹 서버 — 외부 라이브러리 없이 Node.js 내장 모듈만 사용한다.
 * 회원가입/로그인, 지도 만들기, 학년별 서버(월드), 땅 뺏기/방어, 실시간 소식(SSE)을 담당한다. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const S = require('./public/js/shared.js');
const { buildMap } = require('./lib/mapgen.js');

const PORT = Number(process.env.PORT) || 3000;
const DEBUG_PASSWORD = process.env.DEBUG_PASSWORD || 'kim1234school';
// 운영자(게임 관리)와 개발자 계정. 비밀번호는 환경 변수로 바꿀 수 있다.
const ROLE_ACCOUNTS = {
  'game-admin': { role: 'admin', pw: process.env.ADMIN_PASSWORD || 'kim123456789' },
  'game-developer': { role: 'dev', pw: process.env.DEV_PASSWORD || 'gameStudio9876' },
};
const OFFER_HOURS = 48;   // 팔려고 내놓은 땅은 이 시간이 지나면 사라진다
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BASE_COST = 2;      // 방어가 없는 땅을 뺏을 때 풀어야 하는 문제 수
const MAX_DEF = 99;       // 한 칸의 최대 방어 수
const MAX_DEF_STEP = 20;  // 한 번에 올릴 수 있는 방어 수
const SESSION_DAYS = 30;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ---------- 지도 ----------
const MAP = buildMap({ landFile: path.join(__dirname, 'mapdata/korea-land.json'), schoolsFile: path.join(__dirname, 'mapdata/schools.txt'), cacheDir: DATA_DIR });
const L = MAP.n;
const BASE = MAP.schools;
const MAP_GZ = zlib.gzipSync(MAP.clientJSON, { level: 9 }), MAP_BIN_GZ = zlib.gzipSync(MAP.clientBin, { level: 6 });

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

// ---------- 학교 (기본 학교 + 직접 등록한 학교) ----------
const schoolKey = s => `${s.sido}|${s.sigungu}|${s.name}`;
const schoolCount = () => BASE.length + db.custom.length;
const schoolById = id => (id < BASE.length ? BASE[id] : db.custom[id - BASE.length]);
const idByKey = new Map();
const indexSchools = () => { idByKey.clear(); for (let i = schoolCount() - 1; i >= 0; i--) if (!schoolById(i).hidden) idByKey.set(schoolKey(schoolById(i)), i); }; // 같은 학교면 진짜 목록이 이긴다, 운영자가 숨긴 학교는 뺀다
indexSchools();
const publicCustom = () => db.custom.map((c, i) => ({ id: BASE.length + i, name: c.name, sido: c.sido, sigungu: c.sigungu, dong: c.dong || '', url: c.url || '' })).filter(c => idByKey.get(schoolKey(c)) === c.id);
const cleanDong = v => { const d = String(v || '').replace(/\s+/g, ''); if (d && !/^[가-힣0-9·.]{1,12}(동|읍|면|가|리)$/.test(d)) fail('동 이름은 "대치동"처럼 동·읍·면으로 끝나게 써 주세요.'); return d; };
const validUrl = u => /^https?:\/\/[^\s"'<>|;]{3,200}$/.test(u);
const profileSchool = u => (u.profile && u.profile.school && idByKey.has(u.profile.school) ? idByKey.get(u.profile.school) : -1);
// 예전 버전 프로필(학교 번호)은 학교를 다시 고르게 한다
for (const u of Object.values(db.users)) if (u.profile && !u.profile.school) u.profile = null;

// ---------- 학년별 월드 ----------
const worlds = {}; // grade → { w: 저장되는 상태, homeCell: 칸→본부 학교, clients: SSE 연결 }

function getWorld(grade) {
  if (worlds[grade]) return worlds[grade];
  let w = db.worlds[grade];
  if (!w || w.hash !== MAP.hash || !Array.isArray(w.owner) || w.owner.length !== L) {
    // 새 지도: 모든 땅은 회색 빈 땅, 학교마다 자기 위치 칸 하나만 가진다
    w = db.worlds[grade] = { hash: MAP.hash, owner: new Array(L).fill(-1), def: new Array(L).fill(0), home: [], offers: [] };
    BASE.forEach((s, i) => { w.owner[s.cell] = i; w.home[i] = s.cell; });
    save();
  }
  w.offers = w.offers || [];
  const rt = worlds[grade] = { g: grade, w, homeCell: new Int32Array(L).fill(-1), clients: new Map(), chat: [] };
  w.home.forEach((c, id) => { if (c != null && c >= 0) rt.homeCell[c] = id; });
  return rt;
}

const cellState = (rt, i) => [i, rt.w.owner[i], rt.w.def[i]];

// 직접 등록한 학교: 그 지역에서 가장 가까운 빈 땅을 본부로 준다
function ensurePlaced(rt, id) {
  const h = rt.w.home[id];
  if ((h != null && h >= 0) || id < BASE.length) return;
  const sc = schoolById(id), [x, y] = MAP.toMap(sc.lat, sc.lon);
  let best = -1, bd = Infinity;
  for (let i = 0; i < L; i++) {
    if (rt.w.owner[i] >= 0 || rt.homeCell[i] >= 0) continue;
    const d = (MAP.seedX[i] - x) ** 2 + (MAP.seedY[i] - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return;
  rt.w.owner[best] = id; rt.w.def[best] = 0; rt.w.home[id] = best; rt.homeCell[best] = id;
  save();
  broadcast(rt, { t: 'upd', school: { id, name: sc.name, sido: sc.sido, sigungu: sc.sigungu }, home: best, cells: [cellState(rt, best)], ev: { kind: 'join', sid: id, cell: best } });
}

function broadcast(rt, msg, onlySid) { // onlySid 가 있으면 그 학교 친구들에게만
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const [res, c] of rt.clients) if (onlySid == null || c.sid === onlySid) res.write(data);
}
const onlineUsers = rt => new Set([...rt.clients.values()].map(c => c.user));
const onlineCount = rt => onlineUsers(rt).size;
setInterval(() => { for (const rt of Object.values(worlds)) for (const res of rt.clients.keys()) res.write(': ping\n\n'); }, 25000);

// ---------- 로그인 ----------
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const fail = (msg, code = 400) => { throw new HttpError(code, msg); };
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sha = s => crypto.createHash('sha256').update(s).digest();
const userKey = name => 'u_' + String(name).toLowerCase();
const gradeOf = u => (u.role ? u.viewGrade || 3 : S.gradeFromBirthYear(u.birthYear)); // 운영자·개발자는 고른 학년 서버를 본다
const STAT0 = { solved: 0, captures: 0, defends: 0, steals: 0, bestStreak: 0, days: 0, dayStreak: 0, lastDay: '' };
const statsOf = u => { const st = (u.stats = u.stats || {}); for (const k in STAT0) if (st[k] == null) st[k] = STAT0[k]; return st; };
const koreaDay = (ago = 0) => new Date(Date.now() + 9 * 3600e3 - ago * 864e5).toISOString().slice(0, 10);
function attend(u) { // 출석 체크 (하루에 한 번)
  const st = statsOf(u), d = koreaDay();
  if (st.lastDay === d) return null;
  st.dayStreak = st.lastDay === koreaDay(1) ? st.dayStreak + 1 : 1;
  st.days++;
  st.lastDay = d;
  save();
  return { days: st.days, streak: st.dayStreak };
}
function newBadges(u) { // 새로 받은 배지 번호들
  const st = statsOf(u), have = new Set(u.badges = u.badges || []), out = [];
  for (const b of S.BADGES) if (!have.has(b.id) && (st[b.key] || 0) >= b.n) { u.badges.push(b.id); out.push(b.id); }
  if (out.length) save();
  return out;
}
const noteStreak = (u, v) => { const st = statsOf(u); st.bestStreak = Math.max(st.bestStreak, Math.min(1000, Math.floor(Number(v) || 0))); };
function cleanProblem(p) { // 오답 노트에 저장할 문제 (글자 길이 제한)
  if (!p || typeof p !== 'object') fail('잘못된 문제예요.');
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  const out = { q: str(p.q, 400), hint: str(p.hint, 400) };
  if (Array.isArray(p.choices)) { out.choices = p.choices.slice(0, 6).map(c => str(c, 30)); out.a = str(p.a, 30); }
  else { out.a = Number(p.a); if (!Number.isFinite(out.a)) fail('잘못된 문제예요.'); }
  if (p.unit) out.unit = str(p.unit, 10);
  if (p.frac) out.frac = true;
  if (p.simplest) out.simplest = true;
  if (!out.q) fail('잘못된 문제예요.');
  return out;
}
function publicUser(u) {
  const sid = profileSchool(u);
  return {
    username: u.username, birthYear: u.birthYear, grade: gradeOf(u), stats: statsOf(u), badges: u.badges || [], role: u.role || null,
    profile: sid >= 0 ? { schoolId: sid, semester: u.profile.semester, nickname: u.profile.nickname } : null,
  };
}

// 팔려고 내놓은 땅: 오래됐거나 이미 주인이 바뀐 것은 뺀다
function liveOffers(rt) {
  const w = rt.w, now = Date.now();
  return (w.offers = (w.offers || []).filter(o => now - o.at < OFFER_HOURS * 3600e3 && o.cells.some(c => w.owner[c] === o.from)));
}
// 운영자·개발자 계정은 서버가 켜질 때 만들어 둔다 (일반 가입으로는 이 아이디를 못 만든다)
for (const [id, r] of Object.entries(ROLE_ACCOUNTS)) {
  const key = userKey(id);
  if (!db.users[key]) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[key] = { username: id, salt, hash: hashPw(r.pw, salt), birthYear: null, role: r.role, viewGrade: 3, profile: null, stats: {}, at: Date.now() };
    save();
  } else db.users[key].role = r.role;
}

function newSession(key) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { user: key, at: Date.now(), debug: db.users[key].role === 'dev' }; // 개발자는 버그 창이 처음부터 열려 있다
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
  a.sid = profileSchool(a.u);
  if (a.sid < 0) fail('먼저 학교와 닉네임을 설정해 주세요.', 409);
  a.grade = g;
  a.rt = getWorld(g);
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
    if (/admin|develop|game_?(admin|dev)/i.test(username)) fail('운영자·개발자용 아이디는 쓸 수 없어요.');
    if (password.length < 4 || password.length > 64) fail('비밀번호는 4자 이상으로 만들어 주세요.');
    if (!Number.isInteger(birthYear)) fail('나이 인증을 위해 출생연도를 골라 주세요.');
    const g = S.gradeFromBirthYear(birthYear), sy = S.schoolYear();
    if (g < 1 || g > 6) fail(`나이 인증 실패: 초등학생(${sy - 12}~${sy - 7}년생)만 가입할 수 있어요.`);
    const key = userKey(username);
    if (hasOwn(db.users, key)) fail('이미 있는 아이디예요. 다른 아이디를 써 주세요.');
    const salt = crypto.randomBytes(16).toString('hex');
    db.users[key] = { username, salt, hash: hashPw(password, salt), birthYear, profile: null, stats: { solved: 0, captures: 0, defends: 0 }, at: Date.now() };
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
    let nickname = String(b.nickname || '').replace(/[\u0000-\u001f<>]/g, '').trim();
    if (a.u.role) nickname = S.ROLE_NICK[a.u.role];
    else if (S.RESERVED_NICK.test(nickname.replace(/\s+/g, ''))) fail('운영자·개발자 닉네임은 쓸 수 없어요. 다른 닉네임을 써 주세요.');
    if (nickname.length < 1 || nickname.length > 10) fail('닉네임은 1~10자로 써 주세요.');
    let schoolId;
    if (b.custom) {
      const di = Number(b.custom.di), d = Number.isInteger(di) ? MAP.districts[di] : null;
      if (!d) fail('학교가 있는 지역을 골라 주세요.');
      const stem = String(b.custom.name || '').replace(/\s+/g, '').replace(/(초등학교|초교|초)$/, '');
      if (!/^[가-힣A-Za-z0-9]{1,12}$/.test(stem)) fail('학교 이름은 한글·영어·숫자로 1~12자 써 주세요.');
      const sc = { name: stem + '초등학교', sido: d.sido, sigungu: d.sigungu, dong: cleanDong(b.custom.dong) };
      schoolId = idByKey.has(schoolKey(sc)) ? idByKey.get(schoolKey(sc)) : -1;
      if (schoolId < 0) {
        if (db.custom.length >= 5000) fail('더 이상 학교를 등록할 수 없어요.');
        const url = String(b.custom.url || '').trim();
        if (url && !validUrl(url)) fail('홈페이지 주소는 https:// 로 시작하게 써 주세요.');
        db.custom.push(Object.assign(sc, { lat: d.lat + (Math.random() - 0.5) * 0.04, lon: d.lon + (Math.random() - 0.5) * 0.05, url, by: a.u.username }));
        indexSchools();
        schoolId = schoolCount() - 1;
      }
    } else {
      schoolId = Number(b.schoolId);
      if (!Number.isInteger(schoolId) || schoolId < 0 || schoolId >= schoolCount()) fail('학교를 골라 주세요.');
    }
    a.u.profile = { school: schoolKey(schoolById(schoolId)), semester, nickname };
    save();
    const g = gradeOf(a.u);
    if (g >= 1 && g <= 6) ensurePlaced(getWorld(g), schoolId);
    return { user: publicUser(a.u), custom: publicCustom() };
  },

  'GET /api/world': (req, url) => {
    const a = needPlayer(req, url), w = a.rt.w, def = [], home = [];
    w.def.forEach((d, i) => { if (d > 0) def.push([i, d]); });
    for (let i = 0; i < schoolCount(); i++) home.push(w.home[i] != null ? w.home[i] : -1);
    const chat = a.rt.chat.filter(m => m.ch === 'all' || m.sid === a.sid);
    return { grade: a.grade, hash: MAP.hash, owner: w.owner, def, home, custom: publicCustom(), online: onlineCount(a.rt), chat, offers: liveOffers(a.rt), attend: attend(a.u), badges: newBadges(a.u), stats: statsOf(a.u) };
  },

  // 학교 정보: 땅, 순위, 이 학년 서버의 우리 학교 친구들
  'GET /api/school': (req, url) => {
    const a = needPlayer(req, url), id = Number(url.searchParams.get('id'));
    if (!Number.isInteger(id) || id < 0 || id >= schoolCount()) fail('학교를 찾을 수 없어요.');
    const w = a.rt.w, cnt = new Map();
    let def = 0;
    w.owner.forEach((o, i) => { if (o >= 0) cnt.set(o, (cnt.get(o) || 0) + 1); if (o === id) def += w.def[i]; });
    const land = cnt.get(id) || 0;
    let rank = 1;
    for (const v of cnt.values()) if (v > land) rank++;
    const on = onlineUsers(a.rt), members = [];
    for (const u of Object.values(db.users)) {
      if (profileSchool(u) !== id || gradeOf(u) !== a.grade) continue;
      const st = statsOf(u);
      members.push({ nick: u.profile.nickname, captures: st.captures, solved: st.solved, online: on.has(u.username), me: u === a.u });
    }
    members.sort((x, y) => y.online - x.online || y.captures - x.captures);
    const sc = schoolById(id);
    return { id, name: sc.name, sido: sc.sido, sigungu: sc.sigungu, dong: sc.dong || '', url: sc.url || '', land, rank: land ? rank : null, def, members: members.slice(0, 30), memberCount: members.length };
  },

  // 오답 노트
  'GET /api/wrong': (req, url) => ({ list: needLogin(req, url).u.wrong || [] }),
  'POST /api/wrong': (req, url, b) => {
    const a = needLogin(req, url), p = cleanProblem(b.p), list = (a.u.wrong || []).filter(x => x.p.q !== p.q);
    list.unshift({ id: crypto.randomBytes(5).toString('hex'), p, given: String(b.given || '').slice(0, 30), at: Date.now() });
    a.u.wrong = list.slice(0, 30);
    save();
    return { ok: true, count: a.u.wrong.length };
  },
  'POST /api/wrong/remove': (req, url, b) => {
    const a = needLogin(req, url);
    a.u.wrong = (a.u.wrong || []).filter(x => x.id !== b.id);
    save();
    return { ok: true, count: a.u.wrong.length };
  },

  // 연습하기: 땅과 상관없이 푼 문제를 기록에 더한다
  'POST /api/practice': (req, url, b) => {
    const a = needPlayer(req, url), st = statsOf(a.u);
    st.solved += Math.max(0, Math.min(50, Math.floor(Number(b.solved) || 0)));
    noteStreak(a.u, b.streak);
    save();
    return { stats: st, badges: newBadges(a.u) };
  },

  // 빠른 채팅 (정해진 말만, 우리 학교 / 전체)
  'POST /api/chat': (req, url, b) => {
    const a = needPlayer(req, url), m = Number(b.m), ch = b.ch === 'school' ? 'school' : 'all', now = Date.now();
    if (!Number.isInteger(m) || !S.CHAT[m]) fail('보낼 말을 골라 주세요.');
    if (now - (a.s.lastChat || 0) < 2500) fail('조금 천천히 보내 주세요.');
    a.s.lastChat = now;
    const msg = { t: 'chat', ch, sid: a.sid, by: a.u.profile.nickname, m, at: now };
    a.rt.chat.push(msg);
    if (a.rt.chat.length > 60) a.rt.chat.shift();
    broadcast(a.rt, msg, ch === 'school' ? a.sid : null);
    return { ok: true };
  },

  'POST /api/password': (req, url, b) => {
    const a = needLogin(req, url), u = a.u;
    if (!crypto.timingSafeEqual(Buffer.from(hashPw(String(b.old || ''), u.salt), 'hex'), Buffer.from(u.hash, 'hex'))) fail('지금 비밀번호가 틀렸어요.');
    const pw = String(b.password || '');
    if (pw.length < 4 || pw.length > 64) fail('새 비밀번호는 4자 이상으로 만들어 주세요.');
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPw(pw, u.salt);
    for (const [t, s] of Object.entries(db.sessions)) if (s.user === a.s.user && t !== a.token) delete db.sessions[t]; // 다른 기기는 로그아웃
    save();
    return { ok: true };
  },

  // 같은 학년 서버의 친구 순위 (땅을 많이 뺏은 순)
  'GET /api/players': (req, url) => {
    const a = needPlayer(req, url), list = [];
    for (const u of Object.values(db.users)) {
      const sid = profileSchool(u);
      if (sid < 0 || gradeOf(u) !== a.grade) continue;
      const st = statsOf(u);
      list.push({ nick: u.profile.nickname, sid, captures: st.captures, solved: st.solved, me: u === a.u });
    }
    list.sort((x, y) => y.captures - x.captures || y.solved - x.solved);
    const rank = list.findIndex(p => p.me) + 1;
    return { top: list.slice(0, 10), rank, total: list.length };
  },

  // 땅 뺏기: 닿은 땅은 2문제(방어가 있으면 방어 수), 갇혔을 때 탈출길은 2문제, 4학년부터 멀리 있는 땅은 50문제
  'POST /api/capture': (req, url, b) => {
    const a = needPlayer(req, url), { w, homeCell } = a.rt, sid = a.sid, cell = targetCell(b), prev = w.owner[cell];
    if (prev === sid) fail('이미 우리 학교 땅이에요.');
    if (homeCell[cell] >= 0) fail('학교 본부는 뺏을 수 없어요.');
    const cost = S.captureCost({ owner: w.owner, def: w.def, nb: MAP.nb, sid, cell, grade: a.grade });
    if (cost.error) fail(cost.error);
    const required = cost.cost;
    const st = statsOf(a.u);
    if (b.cheat) { if (!a.s.debug) fail('버그 창이 잠겨 있어요.', 403); }
    else {
      const solved = Number(b.solved) || 0;
      if (solved < required) return { need: required - solved, required }; // 그사이 방어가 늘었다
      st.solved += required;
      noteStreak(a.u, b.streak);
    }
    st.captures++;
    if (prev >= 0) st.steals++;
    w.owner[cell] = sid;
    w.def[cell] = 0;
    save();
    const cells = [cellState(a.rt, cell)];
    broadcast(a.rt, { t: 'upd', cells, ev: { kind: 'capture', by: a.u.profile.nickname, sid, prev, cell, far: !!cost.far, escape: !!cost.escape } });
    return { ok: true, cells, stats: st, badges: newBadges(a.u) };
  },

  // 땅 팔기: 고른 학교에 우리 땅을 내놓는다 (3학년까지는 그 학교 땅과 닿아 있어야 한다)
  'POST /api/sell': (req, url, b) => {
    const a = needPlayer(req, url), { w, homeCell } = a.rt, sid = a.sid, cell = targetCell(b), to = Number(b.to), count = Number(b.count);
    if (w.owner[cell] !== sid) fail('우리 학교 땅만 팔 수 있어요.');
    if (homeCell[cell] >= 0) fail('학교 본부는 팔 수 없어요.');
    if (!Number.isInteger(to) || to < 0 || to >= schoolCount() || to === sid || !(w.home[to] >= 0)) fail('땅을 살 학교를 골라 주세요.');
    if (!Number.isInteger(count) || count < 1 || count > 30) fail('팔 땅은 1~30칸으로 골라 주세요.');
    const cells = S.saleCells(w.owner, MAP.nb, homeCell, sid, cell, count);
    if (a.grade < S.FAR_GRADE && !S.touches(cells, w.owner, MAP.nb, to)) fail('3학년까지는 그 학교 땅과 닿아 있는 땅만 팔 수 있어요.');
    w.offers = liveOffers(a.rt).filter(o => !(o.from === sid && o.to === to) && !o.cells.some(c => cells.includes(c)));
    const offer = { id: crypto.randomBytes(5).toString('hex'), from: sid, to, cells, by: a.u.profile.nickname, at: Date.now() };
    w.offers.push(offer);
    save();
    broadcast(a.rt, { t: 'offers', items: w.offers, ev: { kind: 'sell', by: a.u.profile.nickname, sid, to, n: cells.length, cell } });
    return { ok: true, offer, offers: w.offers };
  },
  // 땅 사기: 우리 학교에 내놓은 땅을 문제 없이 가져온다
  'POST /api/buy': (req, url, b) => {
    const a = needPlayer(req, url), { w, homeCell } = a.rt, sid = a.sid, offer = liveOffers(a.rt).find(o => o.id === b.id);
    if (!offer) fail('이미 끝났거나 없는 땅 팔기예요.');
    if (offer.to !== sid) fail('우리 학교에 판 땅만 살 수 있어요.');
    const cells = [];
    for (const c of offer.cells) if (w.owner[c] === offer.from && homeCell[c] < 0) { w.owner[c] = sid; w.def[c] = 0; cells.push(cellState(a.rt, c)); }
    w.offers = w.offers.filter(o => o !== offer);
    save();
    broadcast(a.rt, { t: 'upd', cells, ev: { kind: 'buy', by: a.u.profile.nickname, sid, from: offer.from, n: cells.length, cell: offer.cells[0] } });
    broadcast(a.rt, { t: 'offers', items: w.offers });
    return { ok: true, cells, offers: w.offers };
  },
  'POST /api/sell/cancel': (req, url, b) => {
    const a = needPlayer(req, url), w = a.rt.w, offer = liveOffers(a.rt).find(o => o.id === b.id);
    if (!offer || offer.from !== a.sid) fail('우리 학교가 내놓은 땅만 취소할 수 있어요.');
    w.offers = w.offers.filter(o => o !== offer);
    save();
    broadcast(a.rt, { t: 'offers', items: w.offers });
    return { ok: true, offers: w.offers };
  },

  // 운영자·개발자: 게임 관리
  'POST /api/admin': (req, url, b) => {
    const a = needLogin(req, url), u = a.u;
    if (!u.role) fail('운영자만 할 수 있어요.', 403);
    if (b.act === 'grade') {
      const g = Number(b.grade);
      if (!Number.isInteger(g) || g < 1 || g > 6) fail('학년을 골라 주세요.');
      u.viewGrade = g;
      save();
      return { ok: true, user: publicUser(u) };
    }
    const p = needPlayer(req, url), rt = p.rt, w = rt.w, by = u.profile.nickname, changed = [];
    const clear = c => { if (rt.homeCell[c] < 0 && (w.owner[c] >= 0 || w.def[c])) { w.owner[c] = -1; w.def[c] = 0; changed.push(cellState(rt, c)); } };
    let text = '';
    if (b.act === 'notice') {
      text = String(b.text || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 100);
      if (!text) fail('공지 내용을 써 주세요.');
      broadcast(rt, { t: 'upd', ev: { kind: 'notice', by, text } });
      return { ok: true };
    } else if (b.act === 'clearCell') { const c = targetCell(b); if (rt.homeCell[c] >= 0) fail('학교 본부는 비울 수 없어요.'); clear(c); text = '땅 1칸을 비웠어요'; }
    else if (b.act === 'clearSchool' || b.act === 'hideSchool') {
      const id = Number(b.sid);
      if (!Number.isInteger(id) || id < 0 || id >= schoolCount()) fail('학교를 골라 주세요.');
      for (let c = 0; c < L; c++) if (w.owner[c] === id) clear(c);
      text = `${schoolById(id).name} 땅을 모두 비웠어요`;
      if (b.act === 'hideSchool') {
        if (id < BASE.length) fail('직접 등록한 학교만 숨길 수 있어요.');
        schoolById(id).hidden = true;
        indexSchools();
        for (const r of Object.values(worlds)) { const h = r.w.home[id]; if (h >= 0) { r.w.owner[h] = -1; r.homeCell[h] = -1; r.w.home[id] = -1; if (r === rt) changed.push(cellState(rt, h)); } }
        text = `가짜 학교 ${schoolById(id).name}를 지웠어요`;
      }
    } else if (b.act === 'clearChat') { rt.chat = []; broadcast(rt, { t: 'chatClear' }); text = '채팅을 모두 지웠어요'; }
    else if (b.act === 'resetWorld') {
      for (let c = 0; c < L; c++) clear(c);
      w.offers = [];
      broadcast(rt, { t: 'offers', items: [] });
      text = `${p.grade}학년 서버를 처음 상태로 되돌렸어요`;
    } else fail('없는 관리 기능이에요.');
    save();
    broadcast(rt, { t: 'upd', cells: changed.length <= 5000 ? changed : undefined, reload: changed.length > 5000, ev: { kind: 'admin', by, text } });
    return { ok: true, n: changed.length };
  },

  // 땅 방어: 정한 수만큼 문제를 풀면 그 수만큼 방어가 올라간다
  'POST /api/defend': (req, url, b) => {
    const a = needPlayer(req, url), { w, homeCell } = a.rt, sid = a.sid, cell = targetCell(b), amount = Number(b.amount);
    if (!Number.isInteger(amount) || amount < 1 || amount > MAX_DEF_STEP) fail(`방어 수는 1~${MAX_DEF_STEP} 사이로 골라 주세요.`);
    if (w.owner[cell] !== sid) fail('우리 학교 땅만 방어할 수 있어요.');
    if (homeCell[cell] >= 0) fail('학교 본부는 언제나 안전해요.');
    if (w.def[cell] >= MAX_DEF) fail(`방어는 최대 ${MAX_DEF}까지예요.`);
    const st = statsOf(a.u);
    if (b.cheat) { if (!a.s.debug) fail('버그 창이 잠겨 있어요.', 403); }
    else if ((Number(b.solved) || 0) < amount) fail(`문제를 ${amount}개 풀어야 방어할 수 있어요.`);
    else { st.solved += amount; noteStreak(a.u, b.streak); }
    st.defends += amount;
    w.def[cell] = Math.min(MAX_DEF, w.def[cell] + amount);
    save();
    const cells = [cellState(a.rt, cell)];
    broadcast(a.rt, { t: 'upd', cells, ev: { kind: 'defend', by: a.u.profile.nickname, sid, amount, cell } });
    return { ok: true, cells, stats: st, badges: newBadges(a.u) };
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
  rt.clients.set(res, { user: a.u.username, sid: a.sid });
  online();
  req.on('close', () => { rt.clients.delete(res); online(); });
}

// 지도 모양 (한 번 받으면 브라우저가 기억한다)
function sendMap(req, res, bin) {
  const etag = `"map-${MAP.hash}${bin ? '-bin' : ''}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
  const headers = { 'Content-Type': bin ? 'application/octet-stream' : 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: etag };
  if (wantsGzip(req)) { headers['Content-Encoding'] = 'gzip'; res.writeHead(200, headers); return res.end(bin ? MAP_BIN_GZ : MAP_GZ); }
  res.writeHead(200, headers);
  res.end(bin ? MAP.clientBin : MAP.clientJSON);
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
    if (req.method === 'GET' && url.pathname === '/api/events') return events(req, res, url);
    if (req.method === 'GET' && url.pathname === '/api/map') return sendMap(req, res);
    if (req.method === 'GET' && url.pathname === '/api/map.bin') return sendMap(req, res, true);
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
  const st = MAP.stats;
  console.log(`매뜨 땅먹 서버가 켜졌어요 → http://localhost:${PORT}`);
  console.log(`  지도: 다각형 땅 ${st.cells}칸 (바닷가 ${st.coastal}칸, 뱃길 ${st.routes}개), 학교 ${st.schools}곳, ${st.ms}ms${st.cached ? ' (저장해 둔 지도)' : ''}`);
});
