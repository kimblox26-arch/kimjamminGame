/* 매뜨 땅먹 — 서버 없이 브라우저 안에서 돌아가는 게임 서버 (폰 브라우저 / claude.ai 페이지용)
 * server.js 와 같은 API 를 흉내 낸다.
 *  - 계정·기록·오답 노트: 이 기기(localStorage)에 저장
 *  - 땅·소식·채팅·친구 순위: 공유 저장소를 쓸 수 있으면 친구들과 함께, 아니면 이 기기 안에서만
 *    공유 저장소: claude.ai 페이지의 db, 또는 firebase-config.js 에 설정을 넣은 Firebase(Firestore) — 둘 다 같은 모양(doc/collection)으로 쓴다 */
(function () {
  'use strict';
  const S = window.MLE;
  const MAX_DEF = 99, MAX_DEF_STEP = 20, OFFER_HOURS = 48;
  const chunkSize = () => (cloud && cloud.kind === 'firebase' ? 16384 : 2048); // 땅 기록을 이 칸 수만큼 묶어 한 문서에 (Firebase 는 읽는 횟수를 줄이려고 크게)
  // 운영자·개발자 계정 (비밀번호는 SHA-256 으로만 적어 둔다)
  const ROLES = { 'game-admin': ['admin', '7371439df8022882e6ea2877671f337a6886350bb33a90bd3f724eee7ad96ac7'], 'game-developer': ['dev', 'fcda475b1c997a1f4f065359003a8357cc888f8a001cd253de9405c633c845bf'] };
  const isBuiltin = u => Object.prototype.hasOwnProperty.call(ROLES, String(u.username || '').toLowerCase()); // 처음부터 있던 운영자·개발자 계정 (초대로 된 운영자가 아니라)

  // ---------- 이 기기 저장 ----------
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 */ } },
  };
  const local = Object.assign({ users: {}, sessions: {}, custom: [], worlds: {} }, ls.get('mle_local') || {});
  let saveTimer = 0;
  const save = () => { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = 0; ls.set('mle_local', local); }, 300); };
  const flush = () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; ls.set('mle_local', local); } }; // 페이지를 닫거나 숨길 때 바로 저장
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
  const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
  const sha = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  async function hashPw(pw, salt) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 60000, hash: 'SHA-256' }, key, 256));
  }
  let debugSha = '';
  sha('kim1234school').then(h => { debugSha = h; });

  // ---------- 공유 저장소 (claude.ai) ----------
  let cloud = null; // { db, room, kind }
  // Firebase: 스크립트를 받아서 Firestore 를 연다 (익명 로그인이 켜져 있으면 로그인도)
  const loadScript = src => new Promise((ok, no) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = no; document.head.appendChild(el); });
  async function firebaseCloud(cfg) {
    const V = 'https://www.gstatic.com/firebasejs/10.12.2/';
    if (!window.firebase) { await loadScript(V + 'firebase-app-compat.js'); await Promise.all([loadScript(V + 'firebase-auth-compat.js'), loadScript(V + 'firebase-firestore-compat.js')]); }
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    try { await firebase.auth().signInAnonymously(); } catch { /* 익명 로그인이 꺼져 있어도 규칙이 허락하면 쓸 수 있다 */ }
    const db = firebase.firestore();
    await db.doc('meta/ping').get(); // 읽을 수 있는지 확인 (규칙이 막으면 혼자 하기)
    return { db, room: presenceRoom(db), kind: 'firebase' };
  }
  // 접속 중인 친구 수: 기기마다 30초에 한 번 '여기 있어요'를 남기고, 75초 안에 남긴 기기만 센다
  function presenceRoom(db) {
    let mine = {}, timer = 0;
    return {
      presence(p) { mine = p; const beat = () => db.doc('presence/' + local.device).set(Object.assign({ at: Date.now() }, mine)).catch(() => {}); beat(); clearInterval(timer); timer = setInterval(beat, 30000); },
      onPeers(cb) { return db.collection('presence').onSnapshot(snap => { const now = Date.now(); cb({ peers: snap.docs.map(d => ({ presence: d.data() })).filter(p => now - (p.presence.at || 0) < 75000) }); }, () => {}); },
    };
  }
  // 페이지가 열리자마자 연결을 시작하고, 정해진 시간 안에 안 되면(로그인 안 한 사람 등) 혼자 하기
  const cloudReady = (async () => {
    if (window.MLE_FIREBASE && window.MLE_FIREBASE.projectId) {
      try { cloud = await Promise.race([firebaseCloud(window.MLE_FIREBASE), new Promise(res => setTimeout(() => res(null), 9000))]); } catch (e) { console.warn('Firebase 연결 실패', e); cloud = null; }
      return;
    }
    if (!window.claude || typeof window.claude.use !== 'function') return;
    const timeout = new Promise(r => setTimeout(() => r(null), 3500));
    try {
      const got = await Promise.race([Promise.all([window.claude.use('db'), window.claude.use('user'), window.claude.use('room')]), timeout]);
      if (!got || !got[0]) return;
      const [db, user, room] = got;
      if (user && (await Promise.race([user.can('data.write'), timeout])) === false) return; // 읽기만 되는 사람은 혼자 하기
      cloud = { db, room };
    } catch { cloud = null; }
  })();
  const connectCloud = () => cloudReady;

  // ---------- 지도 ----------
  let NK_SIDO = new Set(), M = null, BASE = [], WP = 'w', MAPWP = 'w', epoch = 0; // WP: 지금 쓰는 땅 기록 자리 (서버 초기화마다 새 자리)
  const setWP = () => { WP = MAPWP + (epoch ? 'r' + epoch : ''); };
  async function init(m, g) { // g: 화면 쪽이 계산한 이웃(nb)과 칸 위치(sx, sy)
    M = { n: m.n, nb: g.nbOf, sx: g.sx, sy: g.sy, nk: c => g.nkCell[c] === 1 }; // nb: 칸 → 이웃 칸들 (함수), nk: 북한 칸인지
    // 지도가 바뀌면 땅 기록은 새로 시작한다 (칸 번호가 달라지니까)
    WP = MAPWP = 'w' + m.hash;
    if (local.mapHash !== m.hash) { local.mapHash = m.hash; local.worlds = {}; local.custom.forEach(c => { c.homes = {}; }); save(); }
    M.districts = m.districts.map(([sido, sigungu, x, y]) => ({ sido, sigungu, x, y }));
    const nkS = m.nkSchools || [m.schools.length, m.schools.length];
    BASE = m.schools.map(([name, sido, sigungu, url, dong], i) => ({ name, sido, sigungu, dong: dong || '', url: url || '', cell: i, nk: i >= nkS[0] && i < nkS[1] }));
    NK_SIDO = new Set(BASE.filter(s => s.nk).map(s => s.sido));
    await connectCloud();
    await loadMod();
    if (cloud) {
      await loadCustom();
      try { // 개발자가 서버를 초기화하면 모두가 새 자리에서 처음부터 시작한다
        const r = await cloud.db.doc('meta/reset').get();
        epoch = r.exists ? r.data().epoch || 0 : 0;
        cloud.db.doc('meta/reset').onSnapshot(snap => { const e = snap.exists ? snap.data().epoch || 0 : 0; if (e !== epoch) startOver(e, snap.data().by); }, () => {});
      } catch { /* 초기화 기록이 없으면 그대로 */ }
    }
    indexSchools();
    setWP();
    await loadFlags();
  }
  // 학년마다 들고 있던 땅을 버리고 새 자리에서 처음부터 (화면에는 다시 불러오라고 알린다)
  function dropWorlds(ev) {
    for (const [g, rt] of Object.entries(worlds)) {
      (rt.unsubs || []).forEach(u => { try { u(); } catch { /* 이미 끊김 */ } });
      delete worlds[g];
      emit(+g, { t: 'upd', reload: true, ev });
    }
  }
  // 서버 초기화
  function startOver(e, by) {
    epoch = e;
    setWP();
    dropWorlds({ kind: 'admin', by: by || '개발자', text: '🧨 서버를 처음부터 다시 시작했어요! 모든 땅이 처음 상태예요.' });
  }

  // ---------- 학교 깃발 (색깔 + 마크): 학교 이름으로 기억하고, 시즌이 바뀌어도 그대로 ----------
  let flags = {};
  const flagView = () => { const out = {}; for (const [k, v] of Object.entries(flags)) if (idByKey.has(k)) out[idByKey.get(k)] = { c: v.c, m: v.m }; return out; };
  async function loadFlags() {
    if (!cloud) { flags = local.flags || {}; return; }
    try { const r = await cloud.db.doc('meta/flags').get(); flags = r.exists ? r.data().items || {} : {}; } catch { /* 없으면 빈 것 */ }
    cloud.db.doc('meta/flags').onSnapshot(snap => { flags = snap.exists ? snap.data().items || {} : {}; emit(null, { t: 'flags', items: flagView() }); }, () => {});
  }
  async function saveFlags() {
    if (cloud) await cloud.db.doc('meta/flags').set({ items: flags });
    else { local.flags = flags; save(); }
    emit(null, { t: 'flags', items: flagView() });
  }
  const isShared = () => !!cloud;

  // ---------- 운영: 학교 퇴장·밴 ----------
  if (!local.device) { local.device = rand(8); save(); } // 이 기기 표시 (밴은 아이디·기기 단위로도 걸린다)
  let mod = { bans: [], kicks: {} }, listenTok = null, listenFn = null;
  async function loadMod() {
    if (!cloud) { mod = { bans: local.bans || [], kicks: local.kicks || {} }; return; }
    try {
      const [b, k] = await Promise.all([cloud.db.doc('mod/bans').get(), cloud.db.doc('mod/kicks').get()]);
      mod.bans = b.exists ? b.data().list || [] : [];
      mod.kicks = k.exists ? k.data().schools || {} : {};
    } catch { /* 없으면 빈 목록 */ }
    cloud.db.doc('mod/bans').onSnapshot(snap => { mod.bans = snap.exists ? snap.data().list || [] : []; modChanged(); }, () => {});
    cloud.db.doc('mod/kicks').onSnapshot(snap => { mod.kicks = snap.exists ? snap.data().schools || {} : {}; modChanged(); }, () => {});
  }
  async function saveMod() {
    mod.bans = mod.bans.filter(b => b.until > Date.now());
    if (cloud) { await cloud.db.doc('mod/bans').set({ list: mod.bans }); await cloud.db.doc('mod/kicks').set({ schools: mod.kicks }); }
    else { local.bans = mod.bans; local.kicks = mod.kicks; save(); }
    modChanged();
  }
  const banOf = u => !u.role && mod.bans.find(b => b.until > Date.now() && ((u.profile && b.nick === u.profile.nickname) || (b.accs || []).includes(u.acc) || (cloud && (b.devs || []).includes(local.device))));
  const kickTime = school => Math.max(mod.kicks[school] || 0, mod.kicks['*'] || 0); // '*' = 모든 학교
  const kickedNow = u => !u.role && u.profile && kickTime(u.profile.school) > (u.profile.at || 0);
  const banInfo = b => ({ until: b.until, by: b.by || '개발자' });
  function failBan(b) { const e = new HttpError(423, '🚫 게임 이용이 정지되었어요.'); e.extra = { ban: banInfo(b) }; throw e; }
  // 밴·퇴장이 바뀌면 지금 이 화면의 사람에게 바로 알린다
  function modChanged() {
    const me = listenTok && getAuth(listenTok);
    if (!me || !listenFn) return;
    const b = banOf(me.u);
    if (b) return listenFn({ t: 'banned', ban: banInfo(b) });
    if (kickedNow(me.u)) { me.u.profile = null; save(); listenFn({ t: 'kicked' }); }
  }

  // ---------- 학교 ----------
  let custom = local.custom; // 공유 모드에서는 db 의 목록
  const schoolKey = s => `${s.sido}|${s.sigungu}|${s.name}`;
  const schoolCount = () => BASE.length + custom.length;
  const schoolById = id => (id < BASE.length ? BASE[id] : custom[id - BASE.length]);
  const idByKey = new Map();
  // 같은 학교가 두 번 있으면 번호가 작은 쪽(진짜 학교 목록)이 이긴다. 손으로 만든 가짜는 숨긴다.
  function indexSchools() { idByKey.clear(); for (let i = schoolCount() - 1; i >= 0; i--) if (!schoolById(i).hidden) idByKey.set(schoolKey(schoolById(i)), i); }
  const isDup = k => idByKey.get(schoolKey(custom[k])) !== BASE.length + k;
  const publicCustom = () => custom.map((c, i) => ({ id: BASE.length + i, name: c.name, sido: c.sido, sigungu: c.sigungu, dong: c.dong || '', url: c.url || '' })).filter((c, i) => !isDup(i));
  const cleanDong = v => { const d = String(v || '').replace(/\s+/g, ''); if (d && !/^[가-힣0-9·.]{1,12}(동|읍|면|가|리)$/.test(d)) fail('동 이름은 "대치동"처럼 동·읍·면으로 끝나게 써 주세요.'); return d; };
  const profileSchool = u => (u.profile && u.profile.school && idByKey.has(u.profile.school) ? idByKey.get(u.profile.school) : -1);
  async function loadCustom() {
    const snap = await cloud.db.doc('meta/custom').get();
    custom = (snap.exists && Array.isArray(snap.data().list)) ? snap.data().list.map(c => Object.assign({}, c, { homes: Object.assign({}, c.homes) })) : [];
  }
  async function saveCustom() {
    if (cloud) await cloud.db.doc('meta/custom').set({ list: custom });
    else save();
  }

  // ---------- 학년별 월드 ----------
  const worlds = {};
  let emit = () => {};
  function setCell(rt, i, o, d) { rt.owner[i] = o; rt.def[i] = d; }
  function setHome(rt, sid, cell) { rt.home[sid] = cell; rt.homeCell[cell] = sid; rt.owner[cell] = sid; }
  function applyCustomHomes(rt, g) {
    custom.forEach((c, k) => { const h = c.homes && c.homes[WP + g]; if (!isDup(k) && h != null && h >= 0 && rt.home[BASE.length + k] == null) setHome(rt, BASE.length + k, h); });
  }
  async function getWorld(g) {
    if (worlds[g]) return worlds[g];
    const wp = WP;
    const n = M.n, rt = { g, owner: new Int32Array(n).fill(-1), def: new Uint8Array(n), home: [], homeCell: new Int32Array(n).fill(-1), feed: [], seen: new Set(), online: 1, offers: [], shields: {} };
    BASE.forEach((s, i) => setHome(rt, i, s.cell));
    if (cloud) {
      const snap = await cloud.db.collection(`${WP}/g${g}/c`).get();
      snap.docs.forEach(d => { for (const [k, v] of Object.entries(d.data() || {})) setCell(rt, +k, v[0], v[1]); });
      applyCustomHomes(rt, g);
      const f = await cloud.db.doc(`${WP}/g${g}/f/main`).get();
      (f.exists ? f.data().items || [] : []).forEach(it => { rt.seen.add(it.id); rt.feed.push(it); });
      const o = await cloud.db.doc(`${WP}/g${g}/o/main`).get();
      rt.offers = o.exists ? o.data().items || [] : [];
      const sh = await cloud.db.doc(`${WP}/g${g}/s/main`).get();
      rt.shields = sh.exists ? sh.data().items || {} : {};
      if (wp !== WP) return getWorld(g); // 불러오는 사이 서버가 초기화됐다
      subscribe(rt);
    } else {
      const w = local.worlds[g] || (local.worlds[g] = { cells: {} });
      for (const [k, v] of Object.entries(w.cells)) setCell(rt, +k, v[0], v[1]);
      rt.offers = w.offers || [];
      rt.shields = w.shields || {};
      applyCustomHomes(rt, g);
    }
    worlds[g] = rt;
    return rt;
  }
  // 다른 친구가 바꾼 땅·소식을 실시간으로 받는다
  function subscribe(rt) {
    const g = rt.g;
    const live = () => worlds[g] === rt, keep = u => { if (typeof u === 'function') (rt.unsubs = rt.unsubs || []).push(u); };
    keep(cloud.db.collection(`${WP}/g${g}/c`).onSnapshot(snap => {
      if (!live()) return;
      const cells = [];
      for (const ch of snap.docChanges()) {
        if (ch.type === 'removed') continue;
        for (const [k, v] of Object.entries(ch.doc.data() || {})) {
          const i = +k;
          if (rt.owner[i] !== v[0] || rt.def[i] !== v[1]) { setCell(rt, i, v[0], v[1]); cells.push([i, v[0], v[1]]); }
        }
      }
      if (cells.length) emit(g, { t: 'upd', cells });
    }, () => {}));
    keep(cloud.db.doc(`${WP}/g${g}/f/main`).onSnapshot(snap => {
      if (!live()) return;
      for (const it of (snap.exists ? snap.data().items || [] : [])) {
        if (rt.seen.has(it.id)) continue;
        rt.seen.add(it.id);
        rt.feed.push(it);
        if (it.t === 'chat') emit(g, Object.assign({}, it, { t: 'chat' }), it.ch === 'school' ? it.sid : null);
        else emit(g, { t: 'upd', ev: it.ev, school: it.school, home: it.home });
      }
    }, () => {}));
    keep(cloud.db.doc(`${WP}/g${g}/s/main`).onSnapshot(snap => { if (!live()) return; rt.shields = snap.exists ? snap.data().items || {} : {}; emit(g, { t: 'shields', items: liveShields(rt) }); }, () => {}));
    keep(cloud.db.doc(`${WP}/g${g}/o/main`).onSnapshot(snap => { if (!live()) return; rt.offers = snap.exists ? snap.data().items || [] : []; emit(g, { t: 'offers', items: liveOffers(rt) }); }, () => {}));
    keep(cloud.db.doc('meta/custom').onSnapshot(async snap => {
      if (!live() || !snap.exists) return;
      const list = snap.data().list || [];
      if (list.length <= custom.length) return;
      custom = list.map(c => Object.assign({}, c, { homes: Object.assign({}, c.homes) }));
      indexSchools();
      for (const w of Object.values(worlds)) applyCustomHomes(w, w.g);
    }, () => {}));
    if (cloud.room) {
      try {
        cloud.room.presence({ grade: g });
        cloud.room.onPeers(ch => { rt.online = Math.max(1, ch.peers.filter(p => p.presence && p.presence.grade === g).length); emit(g, { t: 'online', n: rt.online }); }, () => {});
      } catch { /* 접속 수는 1명으로 */ }
    }
  }
  async function writeCells(rt, cells) {
    if (!cloud) {
      const w = local.worlds[rt.g] || (local.worlds[rt.g] = { cells: {} });
      for (const [i, o, d] of cells) w.cells[i] = [o, d];
      save();
      return;
    }
    const byChunk = new Map();
    for (const [i, o, d] of cells) { const k = Math.floor(i / chunkSize()); if (!byChunk.has(k)) byChunk.set(k, {}); byChunk.get(k)[i] = [o, d]; }
    for (const [k, data] of byChunk) {
      const ref = cloud.db.doc(`${WP}/g${rt.g}/c/${k}`);
      try { await ref.update(data); } catch { await ref.set(Object.assign({}, (await ref.get()).data() || {}, data)); }
    }
  }
  // 저장은 순서대로 뒤에서 한다 (화면은 기다리지 않는다)
  function persist(rt, task) {
    rt.q = (rt.q || Promise.resolve()).then(task).catch(e => console.warn('저장 실패', e));
    return rt.q;
  }
  async function pushFeed(rt, item) {
    item.id = rand(6);
    item.at = Date.now();
    if (!cloud) {
      rt.feed.push(item);
      if (item.t === 'chat') emit(rt.g, Object.assign({}, item, { t: 'chat' }), item.ch === 'school' ? item.sid : null);
      else emit(rt.g, { t: 'upd', ev: item.ev, school: item.school, home: item.home });
      return;
    }
    const ref = cloud.db.doc(`${WP}/g${rt.g}/f/main`), cur = await ref.get();
    const items = (cur.exists ? cur.data().items || [] : []).concat([item]).slice(-40);
    await ref.set({ items });
  }
  // 팔려고 내놓은 땅: 오래됐거나 이미 주인이 바뀐 것은 뺀다
  const liveOffers = rt => (rt.offers = (rt.offers || []).filter(o => Date.now() - o.at < OFFER_HOURS * 3600e3 && o.cells.some(c => rt.owner[c] === o.from)));
  async function saveOffers(rt) {
    liveOffers(rt);
    if (cloud) { try { await cloud.db.doc(`${WP}/g${rt.g}/o/main`).set({ items: rt.offers }); } catch { /* 다음에 */ } }
    else { (local.worlds[rt.g] || (local.worlds[rt.g] = { cells: {} })).offers = rt.offers; save(); }
    emit(rt.g, { t: 'offers', items: rt.offers });
  }
  // 방패: 칸 → 끝나는 시각
  const liveShields = rt => { const now = Date.now(), out = []; for (const [c, t] of Object.entries(rt.shields)) { if (t > now) out.push([+c, t]); else delete rt.shields[c]; } return out; };
  const shieldedNow = (rt, c) => (rt.shields[c] || 0) > Date.now();
  async function saveShields(rt) {
    liveShields(rt);
    if (cloud) { try { await cloud.db.doc(`${WP}/g${rt.g}/s/main`).set({ items: rt.shields }); } catch { /* 다음에 */ } }
    else { (local.worlds[rt.g] || (local.worlds[rt.g] = { cells: {} })).shields = rt.shields; save(); }
    emit(rt.g, { t: 'shields', items: liveShields(rt) });
  }
  function ensurePlaced(rt, id, a) {
    const h = rt.home[id];
    if ((h != null && h >= 0) || id < BASE.length) return null;
    const sc = schoolById(id);
    let best = -1, bd = Infinity;
    for (let i = 0; i < M.n; i++) {
      if (rt.owner[i] >= 0 || rt.homeCell[i] >= 0) continue;
      const d = (M.sx[i] - sc.x) ** 2 + (M.sy[i] - sc.y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    setHome(rt, id, best);
    sc.homes = sc.homes || {};
    sc.homes[WP + rt.g] = best;
    return { cell: best, run: async () => {
      await saveCustom();
      await writeCells(rt, [[best, id, 0]]);
      await pushFeed(rt, { t: 'ev', ev: { kind: 'join', sid: id, cell: best, by: a ? a.u.profile.nickname : '' }, school: { id, name: sc.name, sido: sc.sido, sigungu: sc.sigungu, url: sc.url || '' }, home: best });
    } };
  }

  // ---------- 계정 ----------
  class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  const fail = (msg, code = 400) => { throw new HttpError(code, msg); };
  const userKey = name => 'u_' + String(name).toLowerCase();
  const gradeOf = u => (u.role ? u.viewGrade || 3 : S.gradeFromBirthYear(u.birthYear)); // 운영자·개발자는 고른 학년 서버를 본다
  const STAT0 = { solved: 0, captures: 0, defends: 0, steals: 0, bestStreak: 0, days: 0, dayStreak: 0, lastDay: '' };
  const statsOf = u => { const st = (u.stats = u.stats || {}); for (const k in STAT0) if (st[k] == null) st[k] = STAT0[k]; return st; };
  const koreaDay = (ago = 0) => new Date(Date.now() + 9 * 3600e3 - ago * 864e5).toISOString().slice(0, 10);
  function attend(u) {
    const st = statsOf(u), d = koreaDay();
    if (st.lastDay === d) return null;
    st.dayStreak = st.lastDay === koreaDay(1) ? st.dayStreak + 1 : 1;
    st.days++;
    st.lastDay = d;
    const coins = S.attendCoins(st.dayStreak); // 출석 보상
    earn(u, coins);
    save();
    return { days: st.days, streak: st.dayStreak, coins };
  }
  // 코인과 아이템
  const INF = 999999;
  const walletOf = u => { u.coins = u.infCoins ? INF : u.coins || 0; u.items = Object.assign({ shield: 0, bomb: 0, scope: 0 }, u.items); return u; }; // 🐛 코인 무한이면 늘 가득
  const earn = (u, n) => { walletOf(u).coins += Math.max(0, Math.round(n || 0)); };
  // 오늘의 미션: 날짜가 바뀌면 새 미션 3개
  function missionOf(u) {
    const day = koreaDay();
    if (!u.mission || u.mission.day !== day) u.mission = { day, list: S.dailyMissions(day, u.acc).map(m => ({ id: m.id, n: m.n, p: 0, done: false })), bonus: false };
    return u.mission;
  }
  function track(u, key, v) {
    for (const m of missionOf(u).list) { const d = S.MISSIONS.find(x => x.id === m.id); if (d.key === key) m.p = d.max ? Math.max(m.p, v) : m.p + v; }
  }
  function missionView(u) {
    const ms = missionOf(u), x = 1;
    const list = ms.list.map(m => { const d = S.MISSIONS.find(y => y.id === m.id); return { id: m.id, icon: d.icon, text: d.text(m.n), n: m.n, p: Math.min(m.p, m.n), done: m.done, coin: d.coin * x }; });
    return { day: ms.day, list, bonus: ms.bonus, bonusCoin: S.MISSION_ALL * x, ready: list.filter(m => !m.done && m.p >= m.n).length + (!ms.bonus && list.every(m => m.done) ? 1 : 0) };
  }
  function newBadges(u) {
    const st = statsOf(u), have = new Set(u.badges = u.badges || []), out = [];
    for (const b of S.BADGES) if (!have.has(b.id) && (st[b.key] || 0) >= b.n) { u.badges.push(b.id); out.push(b.id); }
    if (out.length) save();
    return out;
  }
  const noteStreak = (u, v) => { const st = statsOf(u), n = Math.min(1000, Math.floor(Number(v) || 0)); st.bestStreak = Math.max(st.bestStreak, n); track(u, 'streak', n); };
  function publicUser(u) {
    const sid = profileSchool(u);
    return {
      username: u.username, birthYear: u.birthYear, grade: gradeOf(u), stats: statsOf(u), badges: u.badges || [], role: u.role || null, builtin: isBuiltin(u),
      coins: walletOf(u).coins, infCoins: !!u.infCoins, items: u.items, scopeUntil: u.scopeUntil || 0, trophies: u.trophies || [],
      profile: sid >= 0 ? { schoolId: sid, semester: u.profile.semester, nickname: u.profile.nickname } : null,
    };
  }
  // 친구 순위·학교 친구 목록에 보이는 카드 (비밀번호 같은 건 절대 안 올린다)
  async function publishCard(u) {
    if (!cloud || !u.profile) return;
    const st = statsOf(u);
    try { await cloud.db.doc('players/' + u.acc).set({ nick: u.profile.nickname, school: u.profile.school, grade: gradeOf(u), captures: st.captures, solved: st.solved, role: u.role || null, dev: local.device, at: Date.now() }); } catch { /* 다음에 다시 */ }
  }
  async function playersOf(grade) {
    if (!cloud) return Object.values(local.users).filter(u => profileSchool(u) >= 0 && gradeOf(u) === grade).map(u => ({ acc: u.acc, nick: u.profile.nickname, role: u.role || null, sid: profileSchool(u), captures: statsOf(u).captures, solved: statsOf(u).solved }));
    const snap = await cloud.db.collection('players').where('grade', '==', grade).limit(1000).get();
    return snap.docs.map(d => { const p = d.data(); return { acc: d.id, nick: p.nick, role: p.role || null, sid: idByKey.has(p.school) && !(kickTime(p.school) > (p.at || 0)) ? idByKey.get(p.school) : -1, captures: p.captures || 0, solved: p.solved || 0 }; }).filter(p => p.sid >= 0); // 퇴장된 친구는 빼고
  }
  function newSession(key) {
    const token = rand(24);
    local.sessions[token] = { user: key, at: Date.now(), debug: local.users[key].role === 'dev' }; // 개발자는 버그 창이 처음부터 열려 있다
    save();
    return { token, user: publicUser(local.users[key]) };
  }
  function getAuth(token) {
    const s = token && hasOwn(local.sessions, token) ? local.sessions[token] : null;
    const u = s && hasOwn(local.users, s.user) ? local.users[s.user] : null;
    return u ? { token, s, u } : null;
  }
  function needLogin(token) { const a = getAuth(token); if (!a) fail('로그인이 필요해요.', 401); const b = banOf(a.u); if (b) failBan(b); return a; }
  async function needPlayer(token) {
    const a = needLogin(token), g = gradeOf(a.u);
    if (g < 1 || g > 6) fail('초등학생(1~6학년)만 플레이할 수 있어요.', 403);
    if (kickedNow(a.u)) { a.u.profile = null; save(); fail('🚪 학교에서 퇴장되었어요. 학교를 다시 골라 주세요.', 409); }
    a.sid = profileSchool(a.u);
    if (a.sid < 0) fail('먼저 학교와 닉네임을 설정해 주세요.', 409);
    a.grade = g;
    a.rt = await getWorld(g);
    const placed = ensurePlaced(a.rt, a.sid, a);
    if (placed) await placed.run();
    return a;
  }
  const targetCell = b => { const c = Number(b.cell); if (!Number.isInteger(c) || c < 0 || c >= M.n) fail('땅을 다시 골라 주세요.'); return c; };
  const validUrl = u => /^https?:\/\/[^\s"'<>|;]{3,200}$/.test(u);
  function cleanProblem(p) {
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

  // ---------- 운영자 초대: 개발자가 아이디로 초대 → 그 사람이 들어오면 수락/거절 → 비밀번호로 본인 인증 ----------
  const lc = s => String(s || '').trim().toLowerCase();
  async function inviteRaw(name) {
    if (!cloud) return (local.invites || {})[name] || null;
    const s = await cloud.db.doc('invites/' + name).get();
    return s.exists ? s.data() : null;
  }
  async function inviteOf(u) {
    if (u.role) return null;
    try { const inv = await inviteRaw(lc(u.username)); return inv && inv.status === 'pending' ? { by: inv.by, at: inv.at } : null; } catch { return null; }
  }
  async function setInvite(name, patch) {
    const v = Object.assign({}, await inviteRaw(name).catch(() => null), patch);
    if (cloud) await cloud.db.doc('invites/' + name).set(v);
    else { local.invites = Object.assign({}, local.invites, { [name]: v }); save(); }
  }
  async function getStaff() { // 초대로 운영자가 된 아이디들
    if (!cloud) return Object.values(local.users).filter(x => x.role === 'admin' && !isBuiltin(x)).map(x => lc(x.username));
    const s = await cloud.db.doc('staff/list').get();
    return s.exists ? s.data().admins || [] : [];
  }
  async function syncRole(u) { // 친구들과 함께: 개발자가 운영자를 해제했으면 이 기기 계정도 내린다
    if (!cloud || u.role !== 'admin' || isBuiltin(u)) return;
    try { if (!(await getStaff()).includes(lc(u.username))) { u.role = null; delete u.viewGrade; save(); } } catch { /* 다음에 */ }
  }
  async function staffView() {
    const invites = !cloud ? Object.entries(local.invites || {}).map(([username, v]) => Object.assign({ username }, v))
      : (await cloud.db.collection('invites').limit(200).get()).docs.map(d => Object.assign({ username: d.id }, d.data()));
    return { admins: await getStaff(), invites: invites.filter(x => x.status === 'pending' || x.status === 'declined').sort((a, b) => b.at - a.at) };
  }

  // ---------- API ----------
  const routes = {
    'POST /api/signup': async (t, q, b) => {
      const username = String(b.username || '').trim(), password = String(b.password || ''), birthYear = Number(b.birthYear);
      if (!/^[A-Za-z0-9_]{4,16}$/.test(username)) fail('아이디는 영어·숫자 4~16자로 만들어 주세요.');
      if (/admin|develop|game_?(admin|dev)/i.test(username)) fail('운영자·개발자용 아이디는 쓸 수 없어요.');
      if (password.length < 4 || password.length > 64) fail('비밀번호는 4자 이상으로 만들어 주세요.');
      if (!Number.isInteger(birthYear)) fail('나이 인증을 위해 출생연도를 골라 주세요.');
      const g = S.gradeFromBirthYear(birthYear), sy = S.schoolYear();
      if (g < 1 || g > 6) fail(`나이 인증 실패: 초등학생(${sy - 12}~${sy - 7}년생)만 가입할 수 있어요.`);
      const key = userKey(username);
      if (hasOwn(local.users, key)) fail('이 기기에 이미 있는 아이디예요. 다른 아이디를 써 주세요.');
      const devBan = cloud && mod.bans.find(b => b.until > Date.now() && (b.devs || []).includes(local.device));
      if (devBan) failBan(devBan);
      if (cloud) { // 친구들과 함께 쓰는 지도에서는 다른 기기의 아이디와도 겹치면 안 된다
        const idDoc = cloud.db.doc('ids/' + username.toLowerCase());
        if ((await idDoc.get()).exists) fail('이미 있는 아이디예요. 다른 아이디를 써 주세요.');
        await idDoc.set({ at: Date.now() });
      }
      const salt = rand(16);
      local.users[key] = { username, acc: rand(8), salt, hash: await hashPw(password, salt), birthYear, profile: null, stats: Object.assign({}, STAT0), at: Date.now() };
      return newSession(key);
    },
    'POST /api/login': async (t, q, b) => {
      const key = userKey(b.username || ''), role = ROLES[String(b.username || '').trim().toLowerCase()];
      if (role && !hasOwn(local.users, key) && (await sha(String(b.password || ''))) === role[1]) { // 운영자·개발자: 이 기기에서 처음 들어올 때 계정을 만든다
        const salt = rand(16);
        local.users[key] = { username: String(b.username).trim().toLowerCase(), acc: rand(8), salt, hash: await hashPw(String(b.password), salt), birthYear: null, role: role[0], viewGrade: 3, profile: null, stats: Object.assign({}, STAT0), at: Date.now() };
        return newSession(key);
      }
      const u = hasOwn(local.users, key) ? local.users[key] : null;
      if (u && banOf(u) && (await hashPw(String(b.password || ''), u.salt)) === u.hash) failBan(banOf(u));
      if (!u || (await hashPw(String(b.password || ''), u.salt)) !== u.hash) fail('아이디 또는 비밀번호가 틀렸어요. (계정은 가입한 기기에만 있어요)');
      return newSession(key);
    },
    'POST /api/logout': async t => { if (getAuth(t)) { delete local.sessions[t]; save(); } return { ok: true }; },
    'GET /api/me': async t => { const a = needLogin(t); await syncRole(a.u); return { user: publicUser(a.u), debug: !!a.s.debug, shared: isShared(), feat: 2, invite: await inviteOf(a.u) }; },
    'GET /api/schools': async () => ({ custom: publicCustom() }),
    'POST /api/profile': async (t, q, b) => {
      const a = needLogin(t), semester = Number(b.semester);
      if (semester !== 1 && semester !== 2) fail('학기를 골라 주세요.');
      let nickname = String(b.nickname || '').replace(/[\u0000-\u001f<>]/g, '').trim();
      if (a.u.role && isBuiltin(a.u)) nickname = S.ROLE_NICK[a.u.role];
      else if (S.RESERVED_NICK.test(nickname.replace(/\s+/g, ''))) fail('운영자·개발자 닉네임은 쓸 수 없어요. 다른 닉네임을 써 주세요.');
      if (nickname.length < 1 || nickname.length > 10) fail('닉네임은 1~10자로 써 주세요.');
      let schoolId;
      if (b.custom) {
        const di = Number(b.custom.di), d = Number.isInteger(di) ? M.districts[di] : null;
        if (!d) fail('학교가 있는 지역을 골라 주세요.');
        if (NK_SIDO.has(d.sido)) fail('북한에는 학교를 등록할 수 없어요.');
        const stem = String(b.custom.name || '').replace(/\s+/g, '').replace(/(초등학교|초교|초)$/, '');
        if (!/^[가-힣A-Za-z0-9]{1,12}$/.test(stem)) fail('학교 이름은 한글·영어·숫자로 1~12자 써 주세요.');
        const sc = { name: stem + '초등학교', sido: d.sido, sigungu: d.sigungu, dong: cleanDong(b.custom.dong) };
        schoolId = idByKey.has(schoolKey(sc)) ? idByKey.get(schoolKey(sc)) : -1;
        if (schoolId < 0) {
          const url = String(b.custom.url || '').trim();
          if (url && !validUrl(url)) fail('홈페이지 주소는 https:// 로 시작하게 써 주세요.');
          if (cloud) await loadCustom();
          // 같은 동에 진짜 학교가 있으면 그 근처에, 없으면 시·군·구 가운데 근처에 둔다
          const near = BASE.filter(s => s.dong && s.dong === sc.dong && s.sido === sc.sido && s.sigungu === sc.sigungu);
          const cx = near.length ? near.reduce((t, s) => t + M.sx[s.cell], 0) / near.length : d.x, cy = near.length ? near.reduce((t, s) => t + M.sy[s.cell], 0) / near.length : d.y, j = near.length ? 60 : 200;
          custom.push(Object.assign(sc, { x: cx + (Math.random() - 0.5) * j, y: cy + (Math.random() - 0.5) * j, url, homes: {} }));
          if (!cloud) local.custom = custom;
          await saveCustom();
          indexSchools();
          schoolId = schoolCount() - 1;
        }
      } else {
        schoolId = Number(b.schoolId);
        if (!Number.isInteger(schoolId) || schoolId < 0 || schoolId >= schoolCount()) fail('학교를 골라 주세요.');
        if (schoolId < BASE.length && BASE[schoolId].nk) fail('북한 학교는 고를 수 없어요.');
      }
      a.u.profile = { school: schoolKey(schoolById(schoolId)), semester, nickname, at: Date.now() };
      save();
      publishCard(a.u);
      return { user: publicUser(a.u), custom: publicCustom() };
    },
    'GET /api/world': async t => {
      const a = await needPlayer(t), rt = a.rt, def = [], home = [];
      rt.def.forEach((d, i) => { if (d > 0) def.push([i, d]); });
      for (let i = 0; i < schoolCount(); i++) home.push(rt.home[i] != null ? rt.home[i] : -1);
      const chat = rt.feed.filter(m => m.t === 'chat' && (m.ch === 'all' || m.sid === a.sid)).map(m => Object.assign({}, m, { t: 'chat' }));
      await syncRole(a.u);
      const res = { grade: a.grade, owner: Array.from(rt.owner), def, home, custom: publicCustom(), online: rt.online, chat, offers: liveOffers(rt), attend: attend(a.u), badges: newBadges(a.u), stats: statsOf(a.u), shared: isShared(),
        user: publicUser(a.u), shields: liveShields(rt), flags: flagView(), mission: missionView(a.u).ready, invite: await inviteOf(a.u) };
      publishCard(a.u);
      return res;
    },
    'GET /api/school': async (t, q) => {
      const a = await needPlayer(t), id = Number(q.get('id'));
      if (!Number.isInteger(id) || id < 0 || id >= schoolCount()) fail('학교를 찾을 수 없어요.');
      const rt = a.rt, cnt = new Map();
      let def = 0;
      rt.owner.forEach((o, i) => { if (o >= 0) cnt.set(o, (cnt.get(o) || 0) + 1); if (o === id) def += rt.def[i]; });
      const land = cnt.get(id) || 0;
      let rank = 1;
      for (const v of cnt.values()) if (v > land) rank++;
      const members = (await playersOf(a.grade)).filter(p => p.sid === id).map(p => ({ nick: p.nick, role: p.role, captures: p.captures, solved: p.solved, online: p.acc === a.u.acc, me: p.acc === a.u.acc }));
      members.sort((x, y) => y.online - x.online || y.captures - x.captures);
      const sc = schoolById(id);
      return { id, name: sc.name, sido: sc.sido, sigungu: sc.sigungu, dong: sc.dong || '', url: sc.url || '', land, rank: land ? rank : null, def, members: members.slice(0, 30), memberCount: members.length };
    },
    'GET /api/players': async (t, q) => {
      const a = await needPlayer(t), list = (await playersOf(a.grade)).map(p => Object.assign(p, { me: p.acc === a.u.acc }));
      list.sort((x, y) => y.captures - x.captures || y.solved - x.solved);
      const n = Math.max(10, Math.min(100, Number(q.get('n')) || 10));
      return { top: list.slice(0, n), rank: list.findIndex(p => p.me) + 1, total: list.length };
    },
    'POST /api/capture': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, sid = a.sid, cell = targetCell(b), prev = rt.owner[cell];
      if (prev === sid) fail('이미 우리 학교 땅이에요.');
      if (rt.homeCell[cell] >= 0) fail('학교 본부는 뺏을 수 없어요.');
      if (shieldedNow(rt, cell)) fail(`🛡️ 방패가 지키고 있어요! ${Math.ceil((rt.shields[cell] - Date.now()) / 3600e3)}시간 뒤에 뺏을 수 있어요.`);
      const cost = S.captureCost({ owner: rt.owner, def: rt.def, nb: M.nb, sid, cell, grade: a.grade, nk: M.nk, size: () => { let k = 0; for (const o of rt.owner) if (o === sid) k++; return k; } });
      if (cost.error) fail(cost.error);
      const required = cost.cost;
      const st = statsOf(a.u);
      let got = 0;
      if (b.cheat) { if (!a.s.debug) fail('버그 창이 잠겨 있어요.', 403); }
      else {
        const solved = Number(b.solved) || 0;
        if (solved < required) return { need: required - solved, required };
        st.solved += required;
        noteStreak(a.u, b.streak);
        track(a.u, 'solved', required);
        got = required + (b.duel && prev >= 0 ? S.DUEL_BONUS : 0); // 푼 문제 1개 = 1코인, 결투에서 이기면 보너스
        earn(a.u, got);
      }
      st.captures++;
      if (prev >= 0) st.steals++;
      track(a.u, 'captures', 1); if (prev >= 0) track(a.u, 'steals', 1);
      setCell(rt, cell, sid, 0);
      save();
      const cells = [[cell, sid, 0]], ev = { kind: 'capture', by: a.u.profile.nickname, role: a.u.role || null, sid, prev, cell, far: !!cost.far, escape: !!cost.escape, duel: !!b.duel };
      persist(rt, async () => { await writeCells(rt, cells); await pushFeed(rt, { t: 'ev', ev }); });
      publishCard(a.u);
      return { ok: true, cells, stats: st, badges: newBadges(a.u), coins: a.u.coins, got, mission: missionView(a.u).ready };
    },
    'POST /api/defend': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, sid = a.sid, cell = targetCell(b), amount = Number(b.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > MAX_DEF_STEP) fail(`방어 수는 1~${MAX_DEF_STEP} 사이로 골라 주세요.`);
      if (rt.owner[cell] !== sid) fail('우리 학교 땅만 방어할 수 있어요.');
      if (rt.homeCell[cell] >= 0) fail('학교 본부는 언제나 안전해요.');
      if (rt.def[cell] >= MAX_DEF) fail(`방어는 최대 ${MAX_DEF}까지예요.`);
      const st = statsOf(a.u);
      if (b.cheat) { if (!a.s.debug) fail('버그 창이 잠겨 있어요.', 403); }
      else if ((Number(b.solved) || 0) < amount) fail(`문제를 ${amount}개 풀어야 방어할 수 있어요.`);
      else { st.solved += amount; noteStreak(a.u, b.streak); track(a.u, 'solved', amount); earn(a.u, amount); }
      st.defends += amount;
      track(a.u, 'defends', amount);
      setCell(rt, cell, sid, Math.min(MAX_DEF, rt.def[cell] + amount));
      save();
      const cells = [[cell, sid, rt.def[cell]]];
      const ev = { kind: 'defend', by: a.u.profile.nickname, role: a.u.role || null, sid, amount, cell };
      persist(rt, async () => { await writeCells(rt, cells); await pushFeed(rt, { t: 'ev', ev }); });
      publishCard(a.u);
      return { ok: true, cells, stats: st, badges: newBadges(a.u), coins: a.u.coins, mission: missionView(a.u).ready };
    },
    // 땅 팔기: 고른 학교에 우리 땅을 내놓는다 (3학년까지는 그 학교 땅과 닿아 있어야 한다)
    'POST /api/sell': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, sid = a.sid, cell = targetCell(b), to = Number(b.to), count = Number(b.count);
      if (rt.owner[cell] !== sid) fail('우리 학교 땅만 팔 수 있어요.');
      if (rt.homeCell[cell] >= 0) fail('학교 본부는 팔 수 없어요.');
      if (!Number.isInteger(to) || to < 0 || to >= schoolCount() || to === sid || !(rt.home[to] >= 0)) fail('땅을 살 학교를 골라 주세요.');
      if (!Number.isInteger(count) || count < 1 || count > 30) fail('팔 땅은 1~30칸으로 골라 주세요.');
      const cells = S.saleCells(rt.owner, M.nb, rt.homeCell, sid, cell, count);
      if (a.grade < S.FAR_GRADE && !S.touches(cells, rt.owner, M.nb, to)) fail('3학년까지는 그 학교 땅과 닿아 있는 땅만 팔 수 있어요.');
      rt.offers = liveOffers(rt).filter(o => !(o.from === sid && o.to === to) && !o.cells.some(c => cells.includes(c)));
      const offer = { id: rand(5), from: sid, to, cells, by: a.u.profile.nickname, at: Date.now() };
      rt.offers.push(offer);
      await saveOffers(rt);
      await pushFeed(rt, { t: 'ev', ev: { kind: 'sell', by: a.u.profile.nickname, sid, to, n: cells.length, cell } });
      return { ok: true, offer, offers: rt.offers };
    },
    // 땅 사기: 우리 학교에 내놓은 땅을 문제 없이 가져온다
    'POST /api/buy': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, sid = a.sid, offer = liveOffers(rt).find(o => o.id === b.id);
      if (!offer) fail('이미 끝났거나 없는 땅 팔기예요.');
      if (offer.to !== sid) fail('우리 학교에 판 땅만 살 수 있어요.');
      const cells = [];
      for (const c of offer.cells) if (rt.owner[c] === offer.from && rt.homeCell[c] < 0) { setCell(rt, c, sid, 0); cells.push([c, sid, 0]); }
      rt.offers = rt.offers.filter(o => o !== offer);
      await writeCells(rt, cells);
      await saveOffers(rt);
      await pushFeed(rt, { t: 'ev', ev: { kind: 'buy', by: a.u.profile.nickname, sid, from: offer.from, n: cells.length, cell: offer.cells[0] } });
      return { ok: true, cells, offers: rt.offers };
    },
    'POST /api/sell/cancel': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, offer = liveOffers(rt).find(o => o.id === b.id);
      if (!offer || offer.from !== a.sid) fail('우리 학교가 내놓은 땅만 취소할 수 있어요.');
      rt.offers = rt.offers.filter(o => o !== offer);
      await saveOffers(rt);
      return { ok: true, offers: rt.offers };
    },
    // 운영자·개발자: 게임 관리
    'POST /api/admin': async (t, q, b) => {
      const a0 = needLogin(t), u = a0.u;
      if (!u.role) fail('운영자만 할 수 있어요.', 403);
      if (['invite', 'staff', 'unstaff'].includes(b.act)) { // 개발자만: 운영자 추가·해제
        if (u.role !== 'dev') fail('개발자만 할 수 있어요.', 403);
        const by = u.profile ? u.profile.nickname : '개발자';
        let text = '';
        if (b.act === 'invite') {
          const name = lc(b.username), lu = local.users[userKey(name)];
          if (!/^[a-z0-9_]{4,16}$/.test(name)) fail('운영자로 만들 사람의 아이디를 써 주세요.');
          if (lu && isBuiltin(lu)) fail('처음부터 있는 운영자·개발자 계정이에요.');
          if (!lu && !(cloud && (await cloud.db.doc('ids/' + name).get()).exists)) fail('그런 아이디가 없어요.');
          if ((lu && lu.role) || (await getStaff()).includes(name)) fail('이미 운영자예요.');
          await setInvite(name, { by, at: Date.now(), status: 'pending' });
          text = `${name} 님에게 운영자 초대를 보냈어요. 게임에 들어오면 초대 창이 떠요.`;
        } else if (b.act === 'unstaff') {
          const name = lc(b.username), lu = local.users[userKey(name)];
          if (lu && !isBuiltin(lu) && lu.role === 'admin') { lu.role = null; delete lu.viewGrade; save(); }
          if (cloud) await cloud.db.doc('staff/list').set({ admins: (await getStaff()).filter(x => x !== name) });
          await setInvite(name, { status: 'removed', at: Date.now() });
          text = `${name} 님을 운영자에서 해제했어요.`;
        }
        return { ok: true, text, staff: await staffView() };
      }
      if (b.act === 'grade') {
        const g = Number(b.grade);
        if (!Number.isInteger(g) || g < 1 || g > 6) fail('학년을 골라 주세요.');
        u.viewGrade = g;
        save();
        return { ok: true, user: publicUser(u) };
      }
      if (b.act === 'kickAll') { // 모든 학교 학생을 퇴장 (운영자·개발자는 빼고): 모두 학교를 다시 고른다
        mod.kicks = { '*': Date.now() };
        let n = 0;
        for (const x of Object.values(local.users)) if (!x.role && x.profile) { x.profile = null; n++; }
        if (cloud) n = (await cloud.db.collection('players').limit(1000).get()).docs.length;
        await saveMod();
        return { ok: true, n, text: `모든 학교 학생 ${n}명을 퇴장시켰어요` };
      }
      if (b.act === 'kickSchool') { // 이 학교 학생을 모두 퇴장 (운영자·개발자는 빼고)
        const id = Number(b.sid);
        if (!Number.isInteger(id) || id < 0 || id >= schoolCount()) fail('학교를 골라 주세요.');
        const key = schoolKey(schoolById(id));
        mod.kicks[key] = Date.now();
        let n = 0;
        for (const x of Object.values(local.users)) if (!x.role && x.profile && x.profile.school === key) { x.profile = null; n++; }
        if (cloud) n = (await cloud.db.collection('players').where('school', '==', key).limit(1000).get()).docs.length;
        await saveMod();
        return { ok: true, n, text: `${schoolById(id).name} 학생 ${n}명을 퇴장시켰어요` };
      }
      if (b.act === 'ban' || b.act === 'unban' || b.act === 'bans') { // 개발자만: 밴
        if (u.role !== 'dev') fail('개발자만 밴할 수 있어요.', 403);
        if (b.act === 'ban') {
          const nick = String(b.nick || '').trim(), days = Math.round(Number(b.days));
          if (!nick) fail('밴할 사람의 닉네임을 써 주세요.');
          if (!(days >= 1 && days <= 3650)) fail('밴할 날 수는 1~3650일로 골라 주세요.');
          if (Object.values(local.users).some(x => x.role && x.profile && x.profile.nickname === nick)) fail('운영자·개발자는 밴할 수 없어요.');
          let accs = Object.values(local.users).filter(x => !x.role && x.profile && x.profile.nickname === nick).map(x => x.acc), devs = [];
          if (cloud) {
            const snap = await cloud.db.collection('players').where('nick', '==', nick).limit(100).get();
            snap.docs.forEach(d => { accs.push(d.id); if (d.data().dev) devs.push(d.data().dev); });
          }
          accs = [...new Set(accs)]; devs = [...new Set(devs)].filter(d => d !== local.device); // 내 기기는 막지 않는다
          mod.bans = mod.bans.filter(x => x.nick !== nick);
          mod.bans.push({ nick, accs, devs, until: Date.now() + days * 864e5, by: u.profile ? u.profile.nickname : '개발자', at: Date.now() });
        } else if (b.act === 'unban') mod.bans = mod.bans.filter(x => x.nick !== String(b.nick || ''));
        if (b.act !== 'bans') await saveMod();
        return { ok: true, bans: mod.bans.filter(x => x.until > Date.now()).map(x => ({ nick: x.nick, until: x.until, n: (x.accs || []).length })) };
      }
      if (b.act === 'resetAll') { // 개발자만: 모든 학년 서버를 처음부터
        if (u.role !== 'dev') fail('개발자만 서버를 초기화할 수 있어요.', 403);
        const by = u.profile ? u.profile.nickname : '개발자';
        if (cloud) await loadCustom();
        custom.forEach(c => { c.homes = {}; });
        await saveCustom();
        if (cloud) {
          const r = await cloud.db.doc('meta/reset').get(), e = (r.exists ? r.data().epoch || 0 : 0) + 1;
          await cloud.db.doc('meta/reset').set({ epoch: e, by, at: Date.now() });
          startOver(e, by);
        } else {
          local.worlds = {};
          save();
          startOver(epoch, by);
        }
        return { ok: true, reload: true };
      }
      const a = await needPlayer(t), rt = a.rt, by = u.profile.nickname, changed = [];
      const clear = c => { if (rt.homeCell[c] < 0 && (rt.owner[c] >= 0 || rt.def[c])) { setCell(rt, c, -1, 0); changed.push([c, -1, 0]); } };
      let text = '', extra = {};
      if (b.act === 'notice') {
        text = String(b.text || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 100);
        if (!text) fail('공지 내용을 써 주세요.');
        await pushFeed(rt, { t: 'ev', ev: { kind: 'notice', by, text } });
        return { ok: true };
      } else if (b.act === 'clearCell') { const c = targetCell(b); if (rt.homeCell[c] >= 0) fail('학교 본부는 비울 수 없어요.'); clear(c); text = '땅 1칸을 비웠어요'; }
      else if (b.act === 'clearSchool' || b.act === 'hideSchool') {
        const id = Number(b.sid);
        if (!Number.isInteger(id) || id < 0 || id >= schoolCount()) fail('학교를 골라 주세요.');
        for (let c = 0; c < M.n; c++) if (rt.owner[c] === id) clear(c);
        text = `${schoolById(id).name} 땅을 모두 비웠어요`;
        if (b.act === 'hideSchool') {
          if (id < BASE.length) fail('직접 등록한 학교만 숨길 수 있어요.');
          if (cloud) await loadCustom();
          const sc = custom[id - BASE.length];
          sc.hidden = true;
          const h = rt.home[id];
          if (h != null && h >= 0) { setCell(rt, h, -1, 0); rt.homeCell[h] = -1; rt.home[id] = -1; changed.push([h, -1, 0]); }
          sc.homes = {};
          await saveCustom();
          indexSchools();
          text = `가짜 학교 ${sc.name}를 지웠어요`;
        }
      } else if (b.act === 'clearChat') {
        rt.feed = rt.feed.filter(m => m.t !== 'chat');
        if (cloud) await cloud.db.doc(`${WP}/g${rt.g}/f/main`).set({ items: rt.feed.slice(-40) });
        text = '채팅을 모두 지웠어요'; extra = { chatClear: true };
      } else if (b.act === 'resetWorld') {
        for (let c = 0; c < M.n; c++) clear(c);
        rt.offers = [];
        await saveOffers(rt);
        text = `${a.grade}학년 서버를 처음 상태로 되돌렸어요`;
      } else fail('없는 관리 기능이에요.');
      if (changed.length) { await writeCells(rt, changed); if (!cloud) emit(rt.g, { t: 'upd', cells: changed }); }
      await pushFeed(rt, { t: 'ev', ev: Object.assign({ kind: 'admin', by, text }, extra) });
      return { ok: true, n: changed.length, cells: changed };
    },
    'POST /api/debug/unlock': async (t, q, b) => {
      const a = needLogin(t);
      if ((await sha(String(b.password || ''))) !== debugSha) fail('비밀번호가 틀렸어요.');
      a.s.debug = true;
      save();
      return { ok: true };
    },
    'POST /api/debug/coins': async (t, q, b) => { // 🐛 버그 창: 코인 무한
      const a = needLogin(t);
      if (!a.s.debug) fail('버그 창이 잠겨 있어요.', 403);
      if (b.on && !a.u.infCoins) a.u.coinsBefore = a.u.coins || 0;
      if (!b.on && a.u.infCoins) a.u.coins = a.u.coinsBefore || 0; // 끄면 켜기 전 코인으로
      a.u.infCoins = !!b.on;
      save();
      return { ok: true, user: publicUser(a.u) };
    },
    'GET /api/wrong': async t => ({ list: needLogin(t).u.wrong || [] }),
    'POST /api/wrong': async (t, q, b) => {
      const a = needLogin(t), p = cleanProblem(b.p), list = (a.u.wrong || []).filter(x => x.p.q !== p.q);
      list.unshift({ id: rand(5), p, given: String(b.given || '').slice(0, 30), at: Date.now() });
      a.u.wrong = list.slice(0, 30);
      save();
      return { ok: true, count: a.u.wrong.length };
    },
    'POST /api/wrong/remove': async (t, q, b) => {
      const a = needLogin(t);
      a.u.wrong = (a.u.wrong || []).filter(x => x.id !== b.id);
      save();
      return { ok: true, count: a.u.wrong.length };
    },
    'POST /api/practice': async (t, q, b) => {
      const a = await needPlayer(t), st = statsOf(a.u), n = Math.max(0, Math.min(50, Math.floor(Number(b.solved) || 0)));
      st.solved += n;
      noteStreak(a.u, b.streak);
      track(a.u, 'solved', n);
      earn(a.u, n);
      save();
      publishCard(a.u);
      return { stats: st, badges: newBadges(a.u), coins: a.u.coins, got: n, mission: missionView(a.u).ready };
    },
    'POST /api/chat': async (t, q, b) => {
      const a = await needPlayer(t), ch = b.ch === 'school' ? 'school' : 'all', now = Date.now(), item = { t: 'chat', ch, sid: a.sid, by: a.u.profile.nickname, role: a.u.role || null };
      if (b.text != null) { // 직접 쓴 말: 나쁜 말·전화번호는 가린다
        const text = S.cleanChat(b.text);
        if (!text) fail('보낼 말을 써 주세요.');
        item.text = text;
      } else {
        const m = Number(b.m);
        if (!Number.isInteger(m) || !S.CHAT[m]) fail('보낼 말을 골라 주세요.');
        item.m = m;
      }
      if (now - (a.s.lastChat || 0) < 2500) fail('조금 천천히 보내 주세요.');
      a.s.lastChat = now;
      await pushFeed(a.rt, item);
      return { ok: true };
    },
    // ⏱️ 스피드 퀴즈: 1분 동안 맞힌 수만큼 코인
    'POST /api/speed': async (t, q, b) => {
      const a = await needPlayer(t), st = statsOf(a.u), n = Math.max(0, Math.min(60, Math.floor(Number(b.score) || 0))), got = n;
      st.solved += n;
      st.speedBest = Math.max(st.speedBest || 0, n);
      noteStreak(a.u, b.streak);
      track(a.u, 'solved', n); track(a.u, 'speed', n);
      earn(a.u, got);
      save();
      publishCard(a.u);
      return { stats: st, best: st.speedBest, coins: a.u.coins, got, badges: newBadges(a.u), mission: missionView(a.u).ready };
    },
    // 🎯 오늘의 미션
    'GET /api/missions': async t => { const a = needLogin(t); return Object.assign(missionView(a.u), { coins: walletOf(a.u).coins }); },
    'POST /api/missions/claim': async (t, q, b) => {
      const a = needLogin(t), u = a.u, ms = missionOf(u), x = 1;
      let got;
      if (b.id === 'bonus') {
        if (ms.bonus || !ms.list.every(m => m.done)) fail('미션 세 개의 보상을 모두 받아야 해요.');
        ms.bonus = true; got = S.MISSION_ALL * x;
      } else {
        const m = ms.list.find(y => y.id === b.id);
        if (!m || m.done) fail('이미 받았거나 없는 미션이에요.');
        if (m.p < m.n) fail('아직 미션을 다 하지 못했어요.');
        m.done = true; got = S.MISSIONS.find(y => y.id === m.id).coin * x;
      }
      earn(u, got);
      save();
      return Object.assign(missionView(u), { coins: u.coins, got });
    },
    // 🛒 상점
    'GET /api/shop': async t => { const u = walletOf(needLogin(t).u); return { coins: u.coins, items: u.items, prices: Object.fromEntries(S.SHOP.map(it => [it.id, S.priceOf(it.id)])), scopeUntil: u.scopeUntil || 0 }; },
    'POST /api/shop/buy': async (t, q, b) => {
      const u = walletOf(needLogin(t).u), id = String(b.id || ''), price = S.priceOf(id);
      if (!['shield', 'bomb', 'scope'].includes(id)) fail('없는 아이템이에요.');
      if (u.coins < price) fail(`코인이 모자라요. (${price}코인 필요)`);
      u.coins -= price;
      u.items[id]++;
      save();
      return { coins: u.coins, items: u.items };
    },
    'POST /api/item/shield': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, u = walletOf(a.u), cell = targetCell(b);
      if (rt.owner[cell] !== a.sid || rt.homeCell[cell] >= 0) fail('우리 학교 땅(본부 말고)에만 방패를 쓸 수 있어요.');
      if (u.items.shield < 1) fail('방패가 없어요. 🛒 상점에서 사 주세요.');
      if (shieldedNow(rt, cell)) fail('이미 방패가 지키고 있어요.');
      u.items.shield--;
      track(u, 'items', 1);
      save();
      rt.shields[cell] = Date.now() + S.SHIELD_HOURS * 3600e3;
      await saveShields(rt);
      persist(rt, () => pushFeed(rt, { t: 'ev', ev: { kind: 'shield', by: u.profile.nickname, role: u.role || null, sid: a.sid, cell } }));
      return { ok: true, shields: liveShields(rt), items: u.items, coins: u.coins, mission: missionView(u).ready };
    },
    'POST /api/item/bomb': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, sid = a.sid, u = walletOf(a.u), cell = targetCell(b);
      if (u.items.bomb < 1) fail('폭탄이 없어요. 🛒 상점에서 사 주세요.');
      const size = () => { let k = 0; for (const o of rt.owner) if (o === sid) k++; return k; };
      const ok = c => rt.owner[c] !== sid && rt.homeCell[c] < 0 && !shieldedNow(rt, c);
      if (!ok(cell)) fail(rt.owner[cell] === sid ? '이미 우리 학교 땅이에요.' : rt.homeCell[cell] >= 0 ? '학교 본부는 뺏을 수 없어요.' : '🛡️ 방패가 지키는 땅이에요.');
      const cost = S.captureCost({ owner: rt.owner, def: rt.def, nb: M.nb, sid, cell, grade: a.grade, nk: M.nk, size });
      if (cost.error) fail(cost.error);
      const nkOk = size() >= S.NK_MIN; // 옆 칸이 북한 땅이면 200칸 규칙도 지킨다
      const extra = [...M.nb(cell)].filter(c => ok(c) && rt.def[c] <= S.BOMB_MAX_DEF && (nkOk || !M.nk(c))).sort((x, y) => rt.def[x] - rt.def[y]).slice(0, S.BOMB_EXTRA);
      const cells = [cell, ...extra].map(c => [c, sid, 0]), st = statsOf(u);
      let steals = 0;
      for (const [c] of cells) { if (rt.owner[c] >= 0) steals++; setCell(rt, c, sid, 0); }
      u.items.bomb--;
      st.captures += cells.length; st.steals += steals;
      track(u, 'items', 1); track(u, 'captures', cells.length); if (steals) track(u, 'steals', steals);
      save();
      const ev = { kind: 'bomb', by: u.profile.nickname, role: u.role || null, sid, n: cells.length, cell };
      persist(rt, async () => { await writeCells(rt, cells); await pushFeed(rt, { t: 'ev', ev }); });
      publishCard(u);
      return { ok: true, cells, stats: st, items: u.items, coins: u.coins, badges: newBadges(u), mission: missionView(u).ready };
    },
    'POST /api/item/scope': async t => {
      const u = walletOf(needLogin(t).u);
      if (u.items.scope < 1) fail('망원경이 없어요. 🛒 상점에서 사 주세요.');
      u.items.scope--;
      u.scopeUntil = Math.max(Date.now(), u.scopeUntil || 0) + S.SCOPE_MIN * 60e3;
      track(u, 'items', 1);
      save();
      return { ok: true, until: u.scopeUntil, items: u.items, coins: u.coins, mission: missionView(u).ready };
    },
    // 🚩 학교 깃발 꾸미기
    'POST /api/flag': async (t, q, b) => {
      const a = await needPlayer(t), u = walletOf(a.u), c = String(b.c || ''), m = String(b.m || ''), price = S.priceOf('flag');
      if (!S.FLAG_COLORS.includes(c) || !S.FLAG_MARKS.includes(m)) fail('색깔과 마크를 골라 주세요.');
      if (u.coins < price) fail(`코인이 모자라요. (${price}코인 필요)`);
      u.coins -= price;
      track(u, 'items', 1);
      save();
      flags[schoolKey(schoolById(a.sid))] = { c, m, by: u.profile.nickname, at: Date.now() };
      await saveFlags();
      return { ok: true, flags: flagView(), coins: u.coins, mission: missionView(u).ready };
    },
    // 📨 운영자 초대 받기
    'POST /api/invite/accept': async (t, q, b) => {
      const a = needLogin(t), u = a.u, name = lc(u.username);
      if (!(await inviteOf(u))) fail('받은 운영자 초대가 없어요.');
      if ((await hashPw(String(b.password || ''), u.salt)) !== u.hash) fail('비밀번호가 틀렸어요. 내 게임 비밀번호를 써 주세요.');
      u.role = 'admin';
      const g = S.gradeFromBirthYear(u.birthYear);
      u.viewGrade = g >= 1 && g <= 6 ? g : 3;
      if (cloud) { const list = await getStaff(); if (!list.includes(name)) await cloud.db.doc('staff/list').set({ admins: list.concat([name]) }); }
      await setInvite(name, { status: 'accepted', at: Date.now() });
      save();
      publishCard(u);
      return { ok: true, user: publicUser(u) };
    },
    'POST /api/invite/decline': async t => {
      const a = needLogin(t);
      if (await inviteOf(a.u)) await setInvite(lc(a.u.username), { status: 'declined', at: Date.now() });
      return { ok: true };
    },
    'POST /api/password': async (t, q, b) => {
      const a = needLogin(t), u = a.u;
      if ((await hashPw(String(b.old || ''), u.salt)) !== u.hash) fail('지금 비밀번호가 틀렸어요.');
      const pw = String(b.password || '');
      if (pw.length < 4 || pw.length > 64) fail('새 비밀번호는 4자 이상으로 만들어 주세요.');
      u.salt = rand(16);
      u.hash = await hashPw(pw, u.salt);
      for (const [k, s] of Object.entries(local.sessions)) if (s.user === a.s.user && k !== t) delete local.sessions[k];
      save();
      return { ok: true };
    },
  };

  // app.js 의 api() 가 부른다: 서버와 같은 모양의 응답 ({error, code} 포함)
  async function api(path, body, token) {
    const url = new URL(path, 'http://x'), h = routes[`${body ? 'POST' : 'GET'} ${url.pathname}`];
    if (!h) return { error: '없는 기능이에요.', code: 404 };
    try { return await h(token, url.searchParams, body || {}); }
    catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return e instanceof HttpError ? Object.assign({ error: e.message, code: e.code }, e.extra) : { error: '오류가 났어요. 다시 해 주세요.', code: 500 };
    }
  }
  // 실시간 소식: 학교 채팅은 같은 학교만
  function listen(token, handler) {
    const a = getAuth(token);
    listenTok = token; listenFn = handler;
    setTimeout(modChanged, 0);
    emit = (g, msg, onlySid) => {
      const me = getAuth(token);
      if (!me || (g != null && gradeOf(me.u) !== g)) return; // g 가 null 이면 모든 학년에게
      if (onlySid != null && profileSchool(me.u) !== onlySid) return;
      handler(msg);
    };
    return a ? () => { emit = () => {}; listenFn = null; } : () => {};
  }

  window.MLEBackend = { init, api, listen, isShared };
})();
