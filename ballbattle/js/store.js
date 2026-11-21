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
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function uid6() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
const rnd = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rnd(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];

const DEV_UID = 'u_dev';
const DEV_HASH = '4c0fa6aba3a43d5a1790aa957fb80293c7bdf55b97249284d6a10328faaa7a40'; // 비밀번호는 해시로만 저장
const D = {
  users: LS.get('users', {}), skills: LS.get('skills', {}), posts: LS.get('posts', []),
  recs: LS.get('recs', []), reports: LS.get('reports', []),
};
function save(...ks) { ks.forEach(k => LS.set(k, D[k])); }
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
function giveStarter(u) {
  const a = mkSkill(u.uid, '파이어볼', '#ff6a3d', ['proj'], 5, { sound: 'pop' });
  const b = mkSkill(u.uid, '돌진', '#3dd6ff', ['dash'], 6, { sound: 'whoosh' });
  u.equipped = [a.id, b.id];
}
function newUser(o) {
  const u = Object.assign({ uid: 'u_' + uid6(), avatar: '', banner: null, bio: '', coins: 0, wins: 0, losses: 0, subs: [], following: [], equipped: [], created: Date.now() }, o);
  D.users[u.uid] = u; giveStarter(u); save('users', 'skills'); return u;
}
function loadout(u) {
  return (u.equipped || []).map(id => D.skills[id]).filter(s => s && (s.owner === u.uid || s.shared) && !(D.users[s.owner] || {}).banned).slice(0, 3);
}
// 기본 아바타 (사진이 없을 때 자동 생성)
const _av = {};
function avatarSrc(u) {
  if (!u) return ''; if (u.avatar) return u.avatar; if (_av[u.uid]) return _av[u.uid];
  let h = 0; for (const ch of u.handle) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const hue = h % 360, g = x.createLinearGradient(0, 0, 128, 128);
  g.addColorStop(0, `hsl(${hue},80%,62%)`); g.addColorStop(1, `hsl(${(hue + 60) % 360},80%,45%)`);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#ffe0bd'; x.beginPath(); x.arc(64, 74, 40, 0, 7); x.fill();
  x.fillStyle = '#222'; x.beginPath(); x.ellipse(50, 70, 5, 8, 0, 0, 7); x.ellipse(78, 70, 5, 8, 0, 0, 7); x.fill();
  x.strokeStyle = '#222'; x.lineWidth = 4; x.lineCap = 'round'; x.beginPath(); x.arc(64, 82, 14, .2 * Math.PI, .8 * Math.PI); x.stroke();
  x.fillStyle = `hsl(${(hue + 180) % 360},70%,42%)`; x.beginPath(); x.ellipse(64, 46, 42, 22, 0, Math.PI, 0); x.fill(); x.fillRect(18, 44, 92, 8);
  return _av[u.uid] = c.toDataURL();
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function nameHTML(u) {
  return `<span class="nm">${esc(u.nick)}</span>${u.dev ? BADGE + '<span class="devtag">개발자</span>' : ''}${u.bot ? '<span class="aitag">AI</span>' : ''}`;
}
function fmtN(n) { n = n || 0; if (n >= 1e4) return (n / 1e4).toFixed(1).replace('.0', '') + '만'; return n.toLocaleString(); }
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '방금'; if (s < 3600) return Math.floor(s / 60) + '분 전'; if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  return Math.floor(s / 86400) + '일 전';
}
const likeCount = p => p.likes.length + (p.botLikes || 0);
function userLikes(u) { return D.posts.filter(p => p.uid === u.uid).reduce((a, p) => a + likeCount(p), 0); }
