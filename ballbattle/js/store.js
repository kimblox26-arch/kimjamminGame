'use strict';
// ===== 저장소 (localStorage + IndexedDB) / 계정 =====
const T = BB_CONFIG.TITLE;
const LS = {
  get(k, d) { try { const v = localStorage.getItem('bb_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bb_' + k, JSON.stringify(v)); return true; } catch (e) { if (typeof toast == 'function') toast('저장 공간이 부족해요'); return false; } },
};
const IDB = {
  _p: null,
  open() {
    return this._p || (this._p = new Promise((res, rej) => {
      const r = indexedDB.open('ballbox', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('b');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('b', mode); const r = fn(t.objectStore('b'));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  },
  put(k, v) { return this.tx('readwrite', s => s.put(v, k)).then(() => k); },
  get(k) { return this.tx('readonly', s => s.get(k)); },
  del(k) { return this.tx('readwrite', s => s.delete(k)); },
};
const _urls = {};
async function blobURL(k) {
  if (!k) return null; if (_urls[k]) return _urls[k];
  const b = await IDB.get(k).catch(() => null);
  return b ? (_urls[k] = URL.createObjectURL(b)) : null;
}
async function putBlob(b, prefix = 'm') { const k = prefix + '_' + uid6(); await IDB.put(k, b); return k; }
async function sha(s) {
  try { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return sha256js(s); }
}
function sha256js(str) { // crypto.subtle 이 없는 환경용
  const P = 4294967296, H = [], K = [], comp = {}; let n = 0;
  for (let c = 2; n < 64; c++) if (!comp[c]) { for (let i = 0; i < 313; i += c) comp[i] = 1; H[n] = (Math.pow(c, .5) * P) | 0; K[n++] = (Math.pow(c, 1 / 3) * P) | 0; }
  const b = new TextEncoder().encode(str), l = b.length, N = ((l + 8) >> 6) + 1 << 4, w = new Array(N).fill(0);
  for (let i = 0; i < l; i++) w[i >> 2] |= b[i] << (24 - (i % 4) * 8);
  w[l >> 2] |= 0x80 << (24 - (l % 4) * 8); w[N - 1] = l * 8;
  const r = (x, k) => (x >>> k) | (x << (32 - k)); let h = H.slice(0, 8);
  for (let i = 0; i < N; i += 16) {
    const W = []; let [a, bb, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 64; t++) {
      if (t < 16) W[t] = w[i + t] | 0; else { const x = W[t - 15], y = W[t - 2]; W[t] = (W[t - 16] + (r(x, 7) ^ r(x, 18) ^ (x >>> 3)) + W[t - 7] + (r(y, 17) ^ r(y, 19) ^ (y >>> 10))) | 0; }
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0, t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    h = h.map((x, j) => (x + [a, bb, c, d, e, f, g, hh][j]) | 0);
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
function uid6() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];

const DEV_UID = 'u_dev', DEV_HANDLE = 'greencap_roblox';
const isDev = u => !!u && (u.uid === DEV_UID || u.handle === DEV_HANDLE);
const DEV_HASH = '4c0fa6aba3a43d5a1790aa957fb80293c7bdf55b97249284d6a10328faaa7a40'; // 비밀번호는 해시로만 저장
const D = {
  users: LS.get('users', {}), skills: LS.get('skills', {}), posts: LS.get('posts', []),
  recs: LS.get('recs', []), reports: LS.get('reports', []),
};
// ===== 온라인 (다른 사람들과 같은 데이터 공유) =====
// claude.ai 에 올린 게임에서는 공유 데이터베이스를 쓰고, 그 밖에서는 이 브라우저에만 저장해요.
const NET = { ok: false, db: null, user: null, assets: null, cid: null, last: {}, q: {}, warned: false };
const SHARED = ['users', 'skills', 'posts', 'reports'], PRIV = ['pw', 'email', 'age', 'google'];
const stab = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, y) => (o[y] = x[y], o), {}) : x);
const pubOf = (k, o) => { if (k !== 'users') return o; const c = { ...o }; PRIV.forEach(f => delete c[f]); return c; };
const asMap = k => Array.isArray(D[k]) ? Object.fromEntries(D[k].map(x => [x.id, x])) : D[k];
function save(...ks) {
  ks.forEach(k => {
    if (!NET.ok || !SHARED.includes(k)) return LS.set(k, D[k]);
    const m = asMap(k);
    for (const id in m) { const j = stab(pubOf(k, m[id])); if (NET.last[k + '/' + id] !== j) { NET.last[k + '/' + id] = j; netWrite(k, id, JSON.parse(j)); } }
    for (const p in NET.last) if (p.startsWith(k + '/') && !(p.slice(k.length + 1) in m)) { delete NET.last[p]; netWrite(k, p.slice(k.length + 1), null); }
  });
}
function netWrite(k, id, data) {
  const ref = NET.db.collection(k).doc(id), q = k + '/' + id;
  NET.q[q] = (NET.q[q] || Promise.resolve()).then(() => data ? ref.set(data) : ref.delete()).catch(() => { if (!NET.warned) { NET.warned = true; toast('온라인 저장 권한이 없어요. 게임 주인에게 초대를 받아야 해요'); } });
}
const withTimeout = (p, ms) => Promise.race([Promise.resolve(p).catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
async function initNet() {
  if (!window.claude || !window.claude.use) return false;
  const db = await withTimeout(claude.use('db'), 10000); if (!db) return false;
  NET.user = await withTimeout(claude.use('user'), 5000);
  NET.assets = await withTimeout(claude.use('assets'), 5000);
  try { NET.cid = NET.user ? await NET.user.id() : null; } catch (e) { }
  const snaps = await withTimeout(Promise.all(SHARED.map(k => db.collection(k).get())), 10000);
  if (!snaps) return false;
  NET.db = db;
  SHARED.forEach((k, i) => {
    const vs = snaps[i].docs.map(d => d.data());
    if (k === 'posts' || k === 'reports') D[k] = vs.sort((a, b) => b.t - a.t); else { D[k] = {}; snaps[i].docs.forEach((d, j) => D[k][d.id] = vs[j]); }
    snaps[i].docs.forEach((d, j) => NET.last[k + '/' + d.id] = stab(vs[j]));
    db.collection(k).onSnapshot(s => applyRemote(k, s), () => { });
  });
  NET.ok = true; return true;
}
function applyRemote(k, s) {
  s.docChanges().forEach(ch => {
    const id = ch.doc.id, p = k + '/' + id, arr = Array.isArray(D[k]);
    if (ch.type === 'removed') { delete NET.last[p]; if (arr) D[k] = D[k].filter(x => x.id !== id); else delete D[k][id]; return; }
    const v = ch.doc.data(), j = stab(v); if (NET.last[p] === j) return; NET.last[p] = j;
    const cur = arr ? D[k].find(x => x.id === id) : D[k][id];
    if (cur) { const keep = {}; PRIV.forEach(f => { if (k === 'users' && f in cur) keep[f] = cur[f]; }); Object.keys(cur).forEach(x => delete cur[x]); Object.assign(cur, v, keep); }
    else if (arr) { D[k].push(v); D[k].sort((a, b) => b.t - a.t); } else D[k][id] = v;
  });
  document.dispatchEvent(new CustomEvent('netchange', { detail: k }));
}
const privRef = uid => NET.db.collection('data/users/' + NET.cid).doc(uid);
async function getPriv(uid) { if (!NET.ok || !NET.cid) return null; try { const s = await privRef(uid).get(); return s.exists ? s.data() : null; } catch (e) { return null; } }
function setPriv(uid, o) { if (NET.ok && NET.cid) privRef(uid).set(o).catch(() => { }); }
// 영상·사진: 내 기기(IndexedDB) + 온라인 공유(assets)
async function shareBlob(key) {
  if (!NET.ok || !NET.assets) return null;
  try { const b = await IDB.get(key); if (!b) return null; return (await NET.assets.upload(b)).id; } catch (e) { return null; }
}
async function mediaSrc(m) { if (!m) return null; return (m.key && await blobURL(m.key)) || (m.asset ? '/_blob/' + m.asset : null); }
let SESSION = LS.get('session', null);
function me() { return D.users[SESSION] || null; }
function setSession(id) { SESSION = id; LS.set('session', id); }
function byHandle(h) {
  h = String(h || '').trim().toLowerCase().replace(/^@/, '');
  return Object.values(D.users).find(u => u.handle.toLowerCase() === h);
}
const HANDLE_RE = /^[a-zA-Z0-9_.]{2,24}$/;
function handleErr(h, selfUid) {
  h = String(h || '').trim().replace(/^@/, '');
  if (!HANDLE_RE.test(h) || h.endsWith('.')) return '틱톡 아이디 형식이 아니에요 (영문·숫자·_·. 2~24자)';
  const o = byHandle(h); if (o && o.uid !== selfUid) return '이미 사용 중인 아이디예요';
  return '';
}
function mkSkill(owner, name, color, comps, cd, extra = {}) {
  const s = Object.assign({ id: 's_' + uid6(), owner, name, color, comps, cd, lv: 1, shared: false, sound: 'pop', media: null, fused: false, created: Date.now() }, extra);
  D.skills[s.id] = s; return s;
}
function newUser(o) {
  const u = Object.assign({ uid: 'u_' + uid6(), avatar: '', banner: null, bio: '', coins: 0, wins: 0, losses: 0, subs: [], following: [], equipped: [], created: Date.now() }, o);
  D.users[u.uid] = u; save('users'); return u;
}
function loadout(u) {
  return (u.equipped || []).map(id => D.skills[id]).filter(s => s && (s.owner === u.uid || s.shared) && !(D.users[s.owner] || {}).banned).slice(0, 3);
}
// 프로필 사진이 아직 없으면 하얀색
let _white = '';
function avatarSrc(u) {
  if (!u) return ''; if (u.avatar) return u.avatar;
  if (!_white) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64); _white = c.toDataURL(); }
  return _white;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function nameHTML(u) {
  return `<span class="nm">${esc(u.nick)}</span>${isDev(u) ? BADGE + '<span class="devtag">개발자</span>' : ''}`;
}
function fmtN(n) { n = n || 0; if (n >= 1e4) return (n / 1e4).toFixed(1).replace('.0', '') + '만'; return n.toLocaleString(); }
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '방금'; if (s < 3600) return Math.floor(s / 60) + '분 전'; if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}
const likeCount = p => p.likes.length + (p.botLikes || 0);
function userLikes(u) { return D.posts.filter(p => p.uid === u.uid).reduce((a, p) => a + likeCount(p), 0); }
