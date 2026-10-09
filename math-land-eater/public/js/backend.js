/* 매뜨 땅먹 — 서버 없이 브라우저 안에서 돌아가는 게임 서버 (폰 브라우저 / claude.ai 페이지용)
 * server.js 와 같은 API 를 흉내 낸다.
 *  - 계정·기록·오답 노트: 이 기기(localStorage)에 저장
 *  - 땅·소식·채팅·친구 순위: 공유 저장소를 쓸 수 있으면 친구들과 함께, 아니면 이 기기 안에서만
 *    공유 저장소: claude.ai 페이지의 db, 또는 firebase-config.js 에 설정을 넣은 Firebase(Realtime Database, 없으면 Firestore) — 모두 같은 모양(doc/collection)으로 쓴다 */
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
  const scripts = {}; // 같은 스크립트는 한 번만 받는다
  const loadScript = src => scripts[src] || (scripts[src] = new Promise((ok, no) => { const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = no; document.head.appendChild(el); }));
  async function firebaseStart(cfg, part) {
    const V = 'https://www.gstatic.com/firebasejs/10.12.2/';
    if (!window.firebase) await loadScript(V + 'firebase-app-compat.js');
    await Promise.all([loadScript(V + 'firebase-auth-compat.js'), loadScript(V + `firebase-${part}-compat.js`)]);
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    for (let k = 0; k < 6; k++) { // 익명 로그인 (인터넷이 잠깐 끊겨도 몇 번 더 해 본다)
      try { await firebase.auth().signInAnonymously(); break; } catch (e) { if (k === 5) console.warn('익명 로그인 실패', e); else await new Promise(res => setTimeout(res, 1500 * (k + 1))); }
    }
  }
  // Realtime Database: 읽고 쓴 횟수가 아니라 주고받은 양만 세서, 바뀐 것만 주고받으면 무료로 넉넉하다
  async function rtdbCloud(cfg) {
    await firebaseStart(cfg, 'database');
    const rdb = firebase.database();
    await rdb.ref('meta/ping').once('value'); // 읽을 수 있는지 확인 (규칙이 막으면 혼자 하기)
    return { db: rtAdapter(rdb), rdb, room: rtPresence(rdb), kind: 'rtdb' };
  }
  // RTDB 키에 못 쓰는 글자(. $ # [ ] /)는 %2E 처럼 바꿔 저장하고, 읽을 때 되돌린다
  const encKey = k => String(k).replace(/[%.$#[\]/]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const decKey = k => String(k).replace(/%(25|2E|24|23|5B|5D|2F)/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  const holey = v => { for (let i = 0; i < v.length; i++) if (v[i] == null) return true; return false; };
  const toObj = (v, f) => { const o = {}; v.forEach((x, i) => { if (x != null) o[i] = f(x); }); return o; };
  function toRt(v) { // 빈칸 있는 배열(방패처럼 칸 번호를 키로 쓰는 것)은 객체로
    if (Array.isArray(v)) return holey(v) ? toObj(v, toRt) : v.map(toRt);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[encKey(k)] = toRt(x); return o; }
    return v === undefined ? null : v;
  }
  function fromRt(v) { // RTDB 는 숫자 키 객체를 (빈칸 있는) 배열로 돌려줄 때가 있다
    if (Array.isArray(v)) return holey(v) ? toObj(v, fromRt) : v.map(fromRt);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[decKey(k)] = fromRt(x); return o; }
    return v;
  }
  // Firestore 와 같은 모양(doc/collection)으로 쓰게 해 준다 (작은 문서용. 땅·소식은 아래에서 따로)
  function rtAdapter(rdb) {
    const ref = p => rdb.ref(p.split('/').map(encKey).join('/'));
    const snapOf = s => ({ id: decKey(s.key), exists: s.exists(), data: () => fromRt(s.val()) || {} });
    const coll = (p, conds, lim) => ({
      where: (f, op, v) => coll(p, conds.concat([[f, op, v]]), lim),
      limit: n => coll(p, conds, n),
      async get() {
        let q = ref(p);
        for (const [f, op, v] of conds) q = op === '==' ? q.orderByChild(f).equalTo(v) : q.orderByChild(f).startAfter(v);
        if (lim) q = q.limitToFirst(lim);
        const s = await q.once('value'), docs = [];
        s.forEach(c => { docs.push(snapOf(c)); });
        return { docs };
      },
    });
    return {
      collection: p => coll(p, [], 0),
      doc: p => ({
        get: async () => snapOf(await ref(p).once('value')),
        set: v => ref(p).set(toRt(v)),
        update: v => ref(p).update(toRt(v)),
        onSnapshot(cb, err) { const r = ref(p), f = s => cb(snapOf(s)); r.on('value', f, err); return () => r.off('value', f); },
      }),
    };
  }
  // 접속 중인 친구 수: 접속하면 '여기 있어요'를 남기고, 연결이 끊기면 서버가 알아서 지운다 (바뀐 기기만 주고받는다)
  function rtPresence(rdb) {
    let mine = null;
    const put = () => {
      if (!mine) return;
      const me = rdb.ref('presence/' + local.device);
      me.onDisconnect().remove();
      me.set(Object.assign({ at: firebase.database.ServerValue.TIMESTAMP }, mine)).catch(() => {});
    };
    rdb.ref('.info/connected').on('value', s => { if (s.val() === true) put(); }); // 다시 연결되면 다시 남긴다
    setInterval(() => { if (!document.hidden) put(); }, 30 * 60e3);
    return {
      presence(p) { mine = p; put(); },
      onPeers(cb) {
        const r = rdb.ref('presence'), peers = new Map();
        let t = 0;
        const tell = () => { clearTimeout(t); t = setTimeout(() => { const now = Date.now(); cb({ peers: [...peers.values()].filter(p => now - (p.at || 0) < 12 * 3600e3).map(p => ({ presence: p })) }); }, 200); };
        const add = s => { peers.set(s.key, s.val() || {}); tell(); }, del = s => { peers.delete(s.key); tell(); };
        r.on('child_added', add); r.on('child_changed', add); r.on('child_removed', del);
        return () => { r.off('child_added', add); r.off('child_changed', add); r.off('child_removed', del); };
      },
    };
  }
  async function firebaseCloud(cfg) {
    await firebaseStart(cfg, 'firestore');
    const db = firebase.firestore();
    await db.doc('meta/ping').get(); // 읽을 수 있는지 확인 (규칙이 막으면 혼자 하기)
    return { db, room: presenceRoom(db), kind: 'firebase' };
  }
  // 접속 중인 친구 수: 기기마다 1분에 한 번 '여기 있어요'를 남기고, 2분 30초 안에 남긴 기기만 센다
  // (무료 한도를 아끼려고: 쓰기는 1분에 한 번, 읽기는 최근에 남긴 기기만)
  function presenceRoom(db) {
    let mine = {}, timer = 0;
    return {
      presence(p) { mine = p; const beat = () => { if (!document.hidden) db.doc('presence/' + local.device).set(Object.assign({ at: Date.now() }, mine)).catch(() => {}); }; beat(); clearInterval(timer); timer = setInterval(beat, 60000); },
      onPeers(cb) {
        let unsub = null;
        const sub = () => { // 오래전에 들어왔던 기기는 읽지 않는다 (10분마다 기준 시각을 새로)
          if (unsub) unsub();
          unsub = db.collection('presence').where('at', '>', Date.now() - 5 * 60e3).onSnapshot(snap => { const now = Date.now(); cb({ peers: snap.docs.map(d => ({ presence: d.data() })).filter(p => now - (p.presence.at || 0) < 150000) }); }, () => {});
        };
        sub();
        setInterval(sub, 10 * 60e3);
        return () => { if (unsub) unsub(); };
      },
    };
  }
  // 페이지가 열리자마자 연결을 시작하고, 정해진 시간 안에 안 되면(로그인 안 한 사람 등) 혼자 하기
  const cloudReady = (async () => {
    const fb = window.MLE_FIREBASE;
    if (fb && fb.projectId) {
      const within = pr => Promise.race([pr, new Promise(res => setTimeout(() => res(null), 45000))]);
      try { cloud = await within(fb.databaseURL ? rtdbCloud(fb) : firebaseCloud(fb)); } catch (e) {
        console.warn('Firebase 연결 실패', e); cloud = null;
        // 로그인은 됐는데 Realtime Database 규칙이 아직 막혀 있을 때만 예전 저장소(Firestore)로 (로그인이 안 된 거면 친구들과 갈라지지 않게 혼자 하기)
        const signed = window.firebase && firebase.auth && firebase.auth().currentUser;
        if (fb.databaseURL && signed && /permission/i.test(String(e && (e.code || e.message)))) try { cloud = await within(firebaseCloud(fb)); } catch { cloud = null; }
      }
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
  let NK_SIDO = new Set(), M = null, BASE = [], WP = 'w', MAPWP = 'w', epoch = 0, LV = 'e', season = S.seasonOf(); // WP: 지금 쓰는 땅 기록 자리 (서버 초기화마다 새 자리), LV: 이 지도의 학교급
  const setWP = () => { WP = wpOf(season); };
  async function init(m, g) { // g: 화면 쪽이 계산한 이웃(nb)과 칸 위치(sx, sy)
    M = { n: m.n, nb: g.nbOf, sx: g.sx, sy: g.sy, nk: c => g.nkCell[c] === 1, jp: c => !!(g.jpCell && g.jpCell[c] === 1), coast: c => !g.sides[c] }; // nb: 칸 → 이웃 칸들 (함수), nk: 북한 칸, jp: 일본 칸, coast: 바다에 닿은 칸
    LV = m.level || 'e';
    // 지도가 바뀌면 땅 기록은 새로 시작한다 (칸 번호가 달라지니까)
    WP = MAPWP = 'w' + m.hash;
    if (local.mapHash !== m.hash) { local.mapHash = m.hash; local.worlds = {}; local.custom.forEach(c => { c.homes = {}; }); save(); }
    M.districts = m.districts.map(([sido, sigungu, x, y]) => ({ sido, sigungu, x, y }));
    const nkS = m.nkSchools || [m.schools.length, m.schools.length];
    BASE = m.schools.map(([name, sido, sigungu, url, dong], i) => ({ name, sido, sigungu, dong: dong || '', url: url || '', cell: i, nk: i >= nkS[0] && i < nkS[1] }));
    NK_SIDO = new Set(BASE.filter(s => s.nk).map(s => s.sido));
    await connectCloud();
    const loadReset = async () => { // 개발자가 서버를 초기화하면 모두가 새 자리에서 처음부터 시작한다
      try {
        const r = await cloud.db.doc('meta/reset').get();
        epoch = r.exists ? r.data().epoch || 0 : 0;
        cloud.db.doc('meta/reset').onSnapshot(snap => { const e = snap.exists ? snap.data().epoch || 0 : 0; if (e !== epoch) startOver(e, snap.data().by); }, () => {});
      } catch { /* 초기화 기록이 없으면 그대로 */ }
    };
    await Promise.all([loadMod(), loadFlags(), cloud && loadCustom(), cloud && loadReset()]); // 서버에 한꺼번에 물어봐서 빨리 시작
    indexSchools();
    season = S.seasonOf();
    if (!cloud && local.season !== season) { if (local.season) local.worlds = {}; local.season = season; save(); } // 혼자 하기: 시즌이 바뀌면 땅을 새로
    setWP();
    findLandmarks();
    clearInterval(init.tick);
    init.tick = setInterval(seasonTick, 20000);
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
  // 🗑️ 개발자가 삭제한 학교: 학교 키 → { name, msg(학생들에게 보내는 글), by, at }. 삭제된 학교와 그 땅은 지도에서 사라지고, 되살리면 돌아온다
  let deleted = {}, delSid = new Set();
  const delList = d => Object.fromEntries((d.list || []).filter(x => x && x.key).map(x => [x.key, x]));
  function deletedChanged(next, by) {
    const before = Object.keys(deleted).length, same = JSON.stringify(Object.keys(next).sort()) === JSON.stringify(Object.keys(deleted).sort());
    deleted = next;
    if (!M || same) return;
    indexSchools();
    const newest = Object.values(deleted).sort((x, y) => (y.at || 0) - (x.at || 0))[0];
    const text = Object.keys(deleted).length > before && newest ? `🗑️ ${newest.name}가 지도에서 삭제되었어요.` : '🏫 삭제했던 학교를 되살렸어요.';
    dropWorlds({ kind: 'admin', by: by || (newest && newest.by) || '개발자', text }); // 모두 땅을 다시 불러온다
    modChanged();
  }
  async function loadMod() {
    if (!cloud) { mod = { bans: local.bans || [], kicks: local.kicks || {} }; deleted = local.deleted || {}; return; }
    try { const r = await cloud.db.doc('mod/deleted').get(); deleted = r.exists ? delList(r.data()) : {}; } catch { /* 없으면 빈 목록 */ }
    cloud.db.doc('mod/deleted').onSnapshot(snap => deletedChanged(snap.exists ? delList(snap.data()) : {}), () => {});
    try {
      const [b, k] = await Promise.all([cloud.db.doc('mod/bans').get(), cloud.db.doc('mod/kicks').get()]);
      mod.bans = b.exists ? b.data().list || [] : [];
      mod.kicks = k.exists ? k.data().schools || {} : {};
    } catch { /* 없으면 빈 목록 */ }
    cloud.db.doc('mod/bans').onSnapshot(snap => { mod.bans = snap.exists ? snap.data().list || [] : []; modChanged(); }, () => {});
    cloud.db.doc('mod/kicks').onSnapshot(snap => { mod.kicks = snap.exists ? snap.data().schools || {} : {}; modChanged(); }, () => {});
  }
  async function saveDeleted(next, by) {
    if (cloud) await cloud.db.doc('mod/deleted').set({ list: Object.values(next) });
    else { local.deleted = next; save(); }
    deletedChanged(next, by);
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
    if (!me.u.role && me.u.profile && deleted[me.u.profile.school]) return listenFn({ t: 'schoolDeleted', info: deleted[me.u.profile.school] });
    if (kickedNow(me.u)) { me.u.profile = null; save(); listenFn({ t: 'kicked' }); }
  }

  // ---------- 학교 ----------
  let custom = local.custom; // 공유 모드에서는 db 의 목록
  const schoolKey = s => `${s.sido}|${s.sigungu}|${s.name}`;
  const schoolCount = () => BASE.length + custom.length;
  const schoolById = id => (id < BASE.length ? BASE[id] : custom[id - BASE.length]);
  const idByKey = new Map();
  // 같은 학교가 두 번 있으면 번호가 작은 쪽(진짜 학교 목록)이 이긴다. 손으로 만든 가짜는 숨긴다.
  // 직접 등록한 학교는 등록한 학교급 지도에만 (예전 것은 초등학교)
  function indexSchools() {
    idByKey.clear(); delSid = new Set();
    for (let i = schoolCount() - 1; i >= 0; i--) {
      const sc = schoolById(i), k = schoolKey(sc);
      if (deleted[k]) { delSid.add(i); continue; } // 삭제된 학교
      if (!sc.hidden && !(i >= BASE.length && (sc.lv || 'e') !== LV)) idByKey.set(k, i);
    }
  }
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
  function setCell(rt, i, o, d) { if (o >= 0 && delSid.has(o)) { o = -1; d = 0; } rt.owner[i] = o; rt.def[i] = d; } // 삭제된 학교 땅은 빈 땅으로
  function setHome(rt, sid, cell) { rt.home[sid] = cell; rt.homeCell[cell] = sid; rt.owner[cell] = sid; }
  function applyCustomHomes(rt, g) {
    custom.forEach((c, k) => { const h = c.homes && c.homes[WP + g]; if (!isDup(k) && h != null && h >= 0 && rt.home[BASE.length + k] == null) setHome(rt, BASE.length + k, h); });
  }
  async function getWorld(g) {
    if (worlds[g]) return worlds[g];
    const wp = WP;
    const n = M.n, rt = { g, owner: new Int32Array(n).fill(-1), def: new Uint8Array(n), home: [], homeCell: new Int32Array(n).fill(-1), feed: [], seen: new Set(), online: 1, offers: [], shields: {} };
    BASE.forEach((s, i) => { if (!delSid.has(i)) setHome(rt, i, s.cell); });
    if (cloud) {
      if (cloud.rdb) await rtLoad(rt);
      else {
        const snap = await cloud.db.collection(`${WP}/g${g}/c`).get();
        snap.docs.forEach(d => { for (const [k, v] of Object.entries(d.data() || {})) setCell(rt, +k, v[0], v[1]); });
        const f = await cloud.db.doc(`${WP}/g${g}/f/main`).get();
        (f.exists ? f.data().items || [] : []).forEach(it => { rt.seen.add(it.id); rt.feed.push(it); });
      }
      applyCustomHomes(rt, g);
      const [o, sh, wr, bd] = await Promise.all([cloud.db.doc(`${WP}/g${g}/o/main`).get(), cloud.db.doc(`${WP}/g${g}/s/main`).get(), LV !== 'e' ? readDoc(`${WP}/g${g}/w/main`) : {}, readDoc(`${WP}/g${g}/b/main`)]);
      rt.builds = buildsOf(bd);
      rt.unions = LV !== 'e' ? (await readDoc(`${WP}/g${g}/u/main`)).items || [] : [];
      rt.offers = o.exists ? o.data().items || [] : [];
      rt.shields = sh.exists ? sh.data().items || {} : {};
      setWars(rt, wr.items || []);
      if (wp !== WP) { (rt.unsubs || []).forEach(u => u()); return getWorld(g); } // 불러오는 사이 서버가 초기화됐다
      subscribe(rt);
    } else {
      const w = local.worlds[g] || (local.worlds[g] = { cells: {} });
      for (const [k, v] of Object.entries(w.cells)) setCell(rt, +k, v[0], v[1]);
      rt.offers = w.offers || [];
      rt.shields = w.shields || {};
      setWars(rt, w.wars || []);
      rt.builds = buildsOf((local.docs || {})[`${WP}/g${g}/b/main`]);
      rt.unions = w.unions || [];
      applyCustomHomes(rt, g);
    }
    worlds[g] = rt;
    treasureSet(rt);
    return rt;
  }
  // Realtime Database: 땅은 칸마다 따로 두고(바뀐 칸만 주고받는다), 소식은 목록에 하나씩 쌓는다
  // 듣기를 먼저 걸고 처음 내용이 다 올 때까지 기다린다 (처음 받은 것은 화면에 따로 알리지 않는다)
  async function rtLoad(rt) {
    const g = rt.g, live = () => worlds[g] === rt, base = cloud.rdb.ref(`${WP}/g${g}`);
    const on = (q, ev, fn) => { q.on(ev, fn, () => {}); (rt.unsubs = rt.unsubs || []).push(() => q.off(ev, fn)); };
    let pend = null;
    const cell = s => {
      const i = +s.key, v = s.val();
      if (!Array.isArray(v) || !(i >= 0 && i < M.n) || (rt.owner[i] === v[0] && rt.def[i] === v[1])) return;
      setCell(rt, i, v[0], v[1]);
      if (!live()) return;
      if (!pend) { pend = []; setTimeout(() => { const cells = pend; pend = null; emit(g, { t: 'upd', cells }); }, 0); } // 한 번에 바뀐 칸은 묶어서
      pend.push([i, v[0], v[1]]);
    };
    const cRef = base.child('c'), fQ = base.child('f').orderByKey().limitToLast(40);
    on(cRef, 'child_added', cell);
    on(cRef, 'child_changed', cell);
    rt.fmax = '';
    on(fQ, 'child_added', s => {
      const it = fromRt(s.val());
      if (!it || rt.seen.has(it.id)) return;
      rt.seen.add(it.id);
      if (s.key < rt.fmax) return; // 채팅을 지워서 뒤로 밀려 보인 옛 소식은 다시 알리지 않는다
      rt.fmax = s.key;
      rt.feed.push(it);
      if (!live()) return;
      if (it.t === 'chat') emit(g, Object.assign({}, it, { t: 'chat' }), chatTarget(rt, it));
      else emit(g, { t: 'upd', ev: it.ev, school: it.school, home: it.home });
    });
    await Promise.all([cRef.once('value'), fQ.once('value')]);
  }
  // 다른 친구가 바꾼 땅·소식을 실시간으로 받는다
  function subscribe(rt) {
    const g = rt.g;
    const live = () => worlds[g] === rt, keep = u => { if (typeof u === 'function') (rt.unsubs = rt.unsubs || []).push(u); };
    if (!cloud.rdb) keep(cloud.db.collection(`${WP}/g${g}/c`).onSnapshot(snap => {
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
    if (!cloud.rdb) keep(cloud.db.doc(`${WP}/g${g}/f/main`).onSnapshot(snap => {
      if (!live()) return;
      for (const it of (snap.exists ? snap.data().items || [] : [])) {
        if (rt.seen.has(it.id)) continue;
        rt.seen.add(it.id);
        rt.feed.push(it);
        if (it.t === 'chat') emit(g, Object.assign({}, it, { t: 'chat' }), chatTarget(rt, it));
        else emit(g, { t: 'upd', ev: it.ev, school: it.school, home: it.home });
      }
    }, () => {}));
    keep(cloud.db.doc(`${WP}/g${g}/b/main`).onSnapshot(snap => { if (!live()) return; rt.builds = buildsOf(snap.exists ? snap.data() : {}); emit(g, { t: 'builds', items: buildView(rt) }); }, () => {}));
    keep(cloud.db.doc(`${WP}/g${g}/s/main`).onSnapshot(snap => { if (!live()) return; rt.shields = snap.exists ? snap.data().items || {} : {}; emit(g, { t: 'shields', items: liveShields(rt) }); }, () => {}));
    if (LV !== 'e') keep(cloud.db.doc(`${WP}/g${g}/u/main`).onSnapshot(snap => { if (!live()) return; rt.unions = snap.exists ? snap.data().items || [] : []; emit(g, { t: 'unions', items: rt.unions }); }, () => {}));
    if (LV !== 'e') keep(cloud.db.doc(`${WP}/g${g}/w/main`).onSnapshot(snap => { if (!live()) return; setWars(rt, snap.exists ? snap.data().items || [] : []); emit(g, { t: 'wars', items: warView(rt) }); }, () => {}));
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
        cloud.room.presence(presMe && presMe.grade === g ? presMe : { grade: g });
        cloud.room.onPeers(ch => { rt.peers = ch.peers.filter(p => p.presence && p.presence.grade === g).map(p => p.presence); rt.online = Math.max(1, rt.peers.length); emit(g, { t: 'online', n: rt.online }); }, () => {});
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
    if (cloud.rdb) { const up = {}; for (const [i, o, d] of cells) up[i] = [o, d]; return cloud.rdb.ref(`${WP}/g${rt.g}/c`).update(up); }
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
      if (item.t === 'chat') emit(rt.g, Object.assign({}, item, { t: 'chat' }), chatTarget(rt, item));
      else emit(rt.g, { t: 'upd', ev: item.ev, school: item.school, home: item.home });
      return;
    }
    if (cloud.rdb) {
      const f = cloud.rdb.ref(`${WP}/g${rt.g}/f`);
      await f.push(toRt(item));
      if (Math.random() < 0.05) { // 가끔 3일 지난 소식을 지워 저장소를 가볍게
        const old = await f.orderByChild('at').endAt(Date.now() - 3 * 864e5).limitToFirst(200).once('value'), del = {};
        old.forEach(c => { del[c.key] = null; });
        if (Object.keys(del).length) await f.update(del);
      }
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
  // ---------- 🎁 보물 상자 (하루마다 서버에 15개, 학교 근처) · 🏗️ 건물 ----------
  // 보물 자리는 날짜·서버로 정해져서 모든 기기가 똑같이 계산하고, 누가 열었는지만 공유 저장소에 적는다 (문서 칸 "c칸번호")
  function seededRand(str) {
    let h = 2166136261;
    for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return () => { h = (h + 0x6d2b79f5) | 0; let t = Math.imul(h ^ (h >>> 15), 1 | h); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function treasureSet(rt) {
    const day = koreaDay();
    if (rt.trDay === day && rt.trCells) return rt.trCells;
    rt.trDay = day;
    const rnd = seededRand(`${day}|${rt.g}|${MAPWP}`), out = new Map(), homes = [];
    BASE.forEach((s, i) => { if (!s.nk && !delSid.has(i)) homes.push(s.cell); });
    const pool = S.TREASURE_REWARDS.filter(r => !r[2] || r[2].includes(LV)), total = pool.reduce((t, r) => t + r[1], 0);
    for (let k = 0; homes.length && out.size < S.TREASURE_N && k < 500; k++) {
      let c = homes[Math.floor(rnd() * homes.length)];
      for (let st = 4 + Math.floor(rnd() * 10); st > 0; st--) { const nb = M.nb(c); if (nb.length) c = nb[Math.floor(rnd() * nb.length)]; }
      if (rt.homeCell[c] >= 0 || out.has(c)) continue;
      let x = rnd() * total, r = pool[0][0];
      for (const p of pool) { x -= p[1]; if (x < 0) { r = p[0]; break; } }
      out.set(c, r);
    }
    rt.trCells = out;
    rt.trClaimed = {};
    if (rt.trUnsub) { try { rt.trUnsub(); } catch { /* 이미 끊김 */ } rt.trUnsub = null; }
    if (cloud) { // 다른 친구가 연 보물은 실시간으로 지운다
      const un = cloud.db.doc(`${WP}/g${rt.g}/t/${day}`).onSnapshot(s => { rt.trClaimed = s.exists ? s.data() || {} : {}; if (worlds[rt.g] === rt) emit(rt.g, { t: 'treasures', items: treasureView(rt) }); }, () => {});
      if (typeof un === 'function') { rt.trUnsub = un; (rt.unsubs = rt.unsubs || []).push(un); }
    } else rt.trClaimed = Object.assign({}, (local.docs || {})[`${WP}/g${rt.g}/t/${day}`]);
    return out;
  }
  const treasureView = rt => [...treasureSet(rt)].filter(([c]) => !rt.trClaimed['c' + c]).map(([c, r]) => [c, r]);
  // 보물이 있는 땅을 차지하면 보상 (이미 누가 열었으면 없음)
  function claimTreasure(a, rt, cell) {
    const r = treasureSet(rt).get(cell);
    if (!r || rt.trClaimed['c' + cell]) return null;
    const u = walletOf(a.u), info = { by: a.u.profile.nickname, sid: a.sid, at: Date.now() };
    rt.trClaimed['c' + cell] = info;
    if (r[0] === 'c') earn(u, +r.slice(1)); else u.items[r.slice(2)] = (u.items[r.slice(2)] || 0) + 1;
    u.treasures = (u.treasures || 0) + 1;
    persist(rt, () => mergeDoc(`${WP}/g${rt.g}/t/${rt.trDay}`, { ['c' + cell]: info }));
    if (!cloud) emit(rt.g, { t: 'treasures', items: treasureView(rt) });
    pushFeed(rt, { t: 'ev', ev: { kind: 'treasure', by: info.by, role: a.u.role || null, sid: a.sid, r, cell } });
    return { r, text: S.rewardText(r) };
  }
  // 건물: 문서 칸 "c칸번호" = [종류, 학교, 지은 때]. 땅 주인이 바뀌면 무너진 것으로 본다
  const buildsOf = d => { const out = {}; for (const [k, v] of Object.entries(d || {})) if (k[0] === 'c' && Array.isArray(v)) out[+k.slice(1)] = v; return out; };
  const buildView = rt => { const out = {}; for (const [c, b] of Object.entries(rt.builds || {})) if (rt.owner[c] === b[1]) out[c] = b; return out; };
  // ---------- 🛡️ 연합 (중·고): 전쟁이 끝나도 이어지는 학교 모임. 연합 채팅 · 연합 순위 · 연합 학교 전쟁에 바로 참전 ----------
  const unionOf = (rt, key) => (rt.unions || []).find(x => (x.schools || []).includes(key));
  async function saveUnions(rt, mutate) { // 최신 목록을 읽고 고친 뒤 저장 (mutate 안에서 fail 하면 저장 안 함)
    const path = `${WP}/g${rt.g}/u/main`;
    if (cloud) rt.unions = (await readDoc(path)).items || [];
    const out = mutate(rt.unions);
    rt.unions = rt.unions.filter(x => (x.schools || []).length);
    if (cloud) await cloud.db.doc(path).set({ items: rt.unions });
    else { (local.worlds[rt.g] || (local.worlds[rt.g] = { cells: {} })).unions = rt.unions; save(); }
    emit(rt.g, { t: 'unions', items: rt.unions });
    return out;
  }
  // 채팅을 누구에게 보일지: 학교 채팅은 그 학교, 연합 채팅은 그 연합 학교들만
  const chatTarget = (rt, it) => (it.ch === 'school' ? it.sid : it.ch === 'union' ? u => { const x = u.profile && unionOf(rt, u.profile.school); return !!x && x.id === it.uid; } : null);
  // ---------- 전쟁 · 동맹 · 밴 투표 (중·고등학교) ----------
  const keyOfSid = id => (id >= 0 && id < schoolCount() ? schoolKey(schoolById(id)) : '');
  const nameOfKey = k => (idByKey.has(k) ? schoolById(idByKey.get(k)).name : String(k).split('|')[2] || '?');
  const mhOnly = () => { if (LV === 'e') fail('중·고등학교 서버에서만 할 수 있어요.'); };
  const askLive = (w, now) => w.st === 'ask' && now - w.at < S.WAR_ASK_SEC * 1000;
  // 공유 저장소의 문서 하나를 읽기 / 몇 칸만 바꾸기 (null 은 지우기) / 수 올리기 — 저장소마다 방법이 달라서 한곳에 모았다
  async function readDoc(path) {
    if (!cloud) return Object.assign({}, (local.docs || {})[path]);
    const r = await cloud.db.doc(path).get();
    return r.exists ? r.data() || {} : {};
  }
  async function mergeDoc(path, fields) {
    if (!cloud) { const d = ((local.docs = local.docs || {})[path] = local.docs[path] || {}); for (const [k, v] of Object.entries(fields)) { if (v === null) delete d[k]; else d[k] = v; } save(); return; }
    if (cloud.rdb) return cloud.db.doc(path).update(fields);
    if (cloud.kind === 'firebase') { const F = firebase.firestore.FieldValue, v = {}; for (const [k, x] of Object.entries(fields)) v[k] = x === null ? F.delete() : x; return cloud.db.doc(path).set(v, { merge: true }); }
    const cur = await readDoc(path);
    for (const [k, v] of Object.entries(fields)) { if (v === null) delete cur[k]; else cur[k] = v; }
    await cloud.db.doc(path).set(cur);
  }
  async function bump(path, field, n = 1) {
    if (cloud && cloud.rdb) return cloud.rdb.ref(path).update({ [field]: firebase.database.ServerValue.increment(n) });
    if (cloud && cloud.kind === 'firebase') return cloud.db.doc(path).set({ [field]: firebase.firestore.FieldValue.increment(n) }, { merge: true });
    const cur = await readDoc(path);
    await mergeDoc(path, { [field]: (cur[field] || 0) + n });
  }
  async function dropDoc(path) {
    if (!cloud) { if (local.docs) { delete local.docs[path]; save(); } return; }
    if (cloud.rdb) return cloud.rdb.ref(path).remove();
    return cloud.db.doc(path).set({});
  }
  // ---------- 🪪 프로필 사진 · 배너 (그림 · 사진 · 동영상) ----------
  // 사진은 학교 땅 기록과 따로 'wface/' 에 둔다 (서버를 초기화해도 남는다). 목록에는 작은 사진(t_)만, 큰 사진(a_)·배너(b_)는 프로필을 열 때만 읽는다.
  const PIC_MAX = { av: 640000, bn: 1300000, th: 16000 }; // 동영상(최대 30초)은 여러 장을 바둑판처럼 붙인 그림이라 크다
  const picOk = (d, max) => typeof d === 'string' && d.length <= max && /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(d);
  const accOk = acc => typeof acc === 'string' && /^[0-9a-f]{6,40}$/.test(acc);
  async function cardOf(acc) {
    if (!cloud) {
      const u = Object.values(local.users).find(x => x.acc === acc);
      if (!u || !u.profile) return null;
      const l = lookOf(u), st = statsOf(u);
      return { nick: u.profile.nickname, school: u.profile.school, yr: gradeOf(u), av: l.av, ti: l.ti, fr: l.fr, pv: l.pv, bv: l.bv, captures: st.captures, solved: st.solved, role: u.role || null };
    }
    const p = await readDoc('players/' + acc);
    return p.nick ? p : null;
  }
  const mediaOf = d => (d && picOk(d.d, PIC_MAX.bn) ? { k: d.k, d: d.d, n: d.n || 1, fps: d.fps || 8, cols: d.cols || d.n || 1, v: d.v || 0 } : null);
  async function dropMedia(acc, slot) {
    const jobs = [];
    if (slot !== 'bn') jobs.push(dropDoc('wface/a_' + acc), dropDoc('wface/t_' + acc));
    if (slot !== 'av') jobs.push(dropDoc('wface/b_' + acc));
    await Promise.all(jobs);
  }
  // ---------- 🏆 시즌 · 시즌 패스 · 명예의 전당 ----------
  const wpOf = n => MAPWP + (epoch ? 'r' + epoch : '') + (n > 1 ? 's' + n : ''); // 시즌 2부터는 새 자리에서 땅을 새로 시작
  function giveOwn(u, kind, id) { const l = (u.looks = u.looks || {}), own = (l.own = l.own || []), k = kind + ':' + id; if (!own.includes(k)) own.push(k); }
  function giveReward(u, r) { walletOf(u); if (r.coins) earn(u, r.coins); if (r.item) u.items[r.item] = (u.items[r.item] || 0) + 1; if (r.look) giveOwn(u, r.look[0], r.look[1]); }
  function seasonOfU(u) { // 시즌이 바뀌면 패스는 새로, 랭크 점수는 절반으로 (지난 시즌 티어 보상을 준다)
    if (!u.season || u.season.n !== season) { if (u.season) u.prevSeason = { n: u.season.n, cap: u.season.st.captures || 0 }; u.season = { n: season, xp: 0, claimed: [], st: {}, sm: [] }; } // 지난 시즌 땅 수는 명예의 전당용으로 남긴다
    const r = u.rank;
    if (r && r.s !== season) {
      const best = S.tierOf(Math.max(r.best || 0, r.rp || 0));
      if ((r.w || 0) + (r.l || 0) > 0) {
        const coins = 30 * (best.t + 1);
        earn(u, coins);
        if (best.t >= 2) giveOwn(u, 'ti', `S${r.s} ${S.tierName(best)}`);
        u.rankNote = { s: r.s, name: S.tierName(best), coins, title: best.t >= 2 ? `S${r.s} ${S.tierName(best)}` : '' };
      }
      u.rank = { s: season, rp: Math.min(1200, Math.floor((r.rp || 0) / 2)), w: 0, l: 0, streak: 0, best: 0, done: [] };
    }
    return u.season;
  }
  const rankOf = u => { seasonOfU(u); return (u.rank = u.rank || { s: season, rp: 0, w: 0, l: 0, streak: 0, best: 0, done: [] }); };
  const sst = (u, key, n = 1) => { const s = seasonOfU(u); s.st[key] = (s.st[key] || 0) + n; };
  const addXP = (u, n) => { seasonOfU(u).xp += Math.max(0, Math.round(n || 0)); };
  const passLv = s => Math.min(S.PASS_MAX, Math.floor(s.xp / S.PASS_XP));
  function seasonView(u) {
    const s = seasonOfU(u), lv = passLv(s);
    let ready = S.SEASON_MISSIONS.filter(m => !s.sm.includes(m.id) && (s.st[m.key] || 0) >= m.n).length;
    for (let x = 1; x <= lv; x++) if (!s.claimed.includes(x)) ready++;
    return { n: season, ends: S.seasonEnds(season), xp: s.xp, lv, need: S.PASS_XP, claimed: s.claimed, ready };
  }
  // 시즌 동안 서버의 학교 순위를 가끔 적어 두고, 시즌이 끝나면 1~3등을 명예의 전당에 옮긴다
  const topPath = (wp, g) => `${wp}/g${g}/top/main`, topAt = {}, finTried = {};
  function publishTop(rt) {
    if (Date.now() - (topAt[rt.g] || 0) < 180e3) return;
    topAt[rt.g] = Date.now();
    const cnt = new Map();
    rt.owner.forEach(o => { if (o >= 0) cnt.set(o, (cnt.get(o) || 0) + 1); });
    const s = [...cnt].filter(([, n]) => n > 1).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([id, n]) => ({ nm: schoolById(id).name, n })); // 본부 1칸뿐인 학교는 빼고
    mergeDoc(topPath(WP, rt.g), { s, at: Date.now() }).catch(() => {});
  }
  async function finishSeason(prev, g) {
    if (prev < 1 || finTried[prev + '_' + g]) return;
    finTried[prev + '_' + g] = 1;
    const key = `s${prev}_g${g}`, path = 'meta/hof_' + LV, hof = await readDoc(path);
    if (hof[key]) return;
    const top = await readDoc(topPath(wpOf(prev), g));
    const capOf = x => (x.scs === prev ? x.scap : x.ps === prev ? x.pc : 0) || 0;
    const p = (await playersOf(g)).filter(x => capOf(x) > 0).sort((x, y) => capOf(y) - capOf(x)).slice(0, 3).map(x => ({ nm: x.nick, sc: schoolById(x.sid).name, n: capOf(x) }));
    const s = (top.s || []).slice(0, 3);
    if (s.length || p.length) await mergeDoc(path, { [key]: { s, p, at: Date.now() } });
  }
  function seasonTick() {
    const n = S.seasonOf();
    if (n === season) return;
    const prev = season, gs = Object.keys(worlds).map(Number);
    for (const g of gs) { topAt[g] = 0; publishTop(worlds[g]); }
    season = n;
    setWP();
    if (!cloud) { local.worlds = {}; local.season = n; save(); }
    setTimeout(() => gs.forEach(g => finishSeason(prev, g).catch(() => {})), 3000);
    dropWorlds({ kind: 'season', n, text: `🏆 새 시즌이 시작됐어요! (시즌 ${n}) 모든 땅이 새로 시작해요. 지난 시즌 1~3등은 명예의 전당에 남았어요.` });
  }

  // ---------- ⚔️ 랭크 배틀: 큐(wace/q서버) → 방(wace/m_번호) → 끝. 아이디가 작은 쪽이 방을 만든다 ----------
  let rk = null, rkWatch = null, rkArk = new Set();
  const rkEmit = (st, extra) => emit(null, Object.assign({ t: 'rank', st }, extra));
  const sub = (path, fn) => { const un = cloud.db.doc(path).onSnapshot(s => fn(s.exists ? s.data() || {} : {}), () => {}); return typeof un === 'function' ? un : () => {}; };
  function rkCard(u) { const r = rankOf(u), l = lookOf(u); return { acc: u.acc, nick: u.profile.nickname, rp: r.rp, av: l.av, pv: l.pv, sc: schoolById(profileSchool(u)).name }; }
  async function rkStop() {
    const r = rk;
    if (!r) return;
    rk = null;
    (r.unsubs || []).forEach(f => { try { f(); } catch { /* 이미 끊김 */ } });
    clearInterval(r.timer);
    if (r.inQueue && cloud) await mergeDoc(`wace/q${r.srv}`, { [r.acc]: null }).catch(() => {});
  }
  async function rkScan(d) {
    const me = rk;
    if (!me || me.match || me.busy) return;
    const mine = d[me.acc];
    if (mine && mine.m) return rkJoin(mine.m);
    const now = Date.now(), win = 150 + ((now - me.since) / 1000) * 25; // 오래 기다릴수록 점수 차이가 큰 상대도
    const opp = Object.entries(d).filter(([k, v]) => k !== me.acc && v && v.nick && !v.m && now - (v.at || 0) < 30000 && Math.abs((v.rp || 0) - me.card.rp) <= win)
      .sort((x, y) => Math.abs((x[1].rp || 0) - me.card.rp) - Math.abs((y[1].rp || 0) - me.card.rp))[0];
    const stale = Object.entries(d).filter(([, v]) => v && now - (v.at || 0) > 600e3).map(([k]) => k); // 10분 넘게 소식 없는 자리는 치운다
    if (stale.length) mergeDoc(`wace/q${me.srv}`, Object.fromEntries(stale.map(k => [k, null]))).catch(() => {});
    if (!opp || me.acc > opp[0]) return;
    me.busy = true;
    const id = rand(6), o = opp[1], G = window.MLEProblems, g = Math.min(me.g || 1, o.g || me.g || 1);
    let probs = me.probs; // 중·고 서버는 학년이 섞여 있으니 낮은 학년 문제로
    if (G && g !== me.g) { try { probs = Array.from({ length: S.RANK_N }, () => cleanProblem(G.generate(g, Math.min(me.sem || 1, o.sem || 1)))); } catch { probs = me.probs; } }
    const m = { id, srv: me.srv, a: me.card, b: { acc: opp[0], nick: o.nick, rp: o.rp || 0, av: o.av || '😀', pv: o.pv || 0, sc: o.sc || '' }, probs, sa: 0, sb: 0, win: '', at: now };
    try {
      await cloud.db.doc('wace/m_' + id).set(m);
      if (!(await rkClaim(me.srv, opp[0], id))) { dropDoc('wace/m_' + id).catch(() => {}); me.busy = false; return; }
      mergeDoc(`wace/l${me.srv}`, { [id]: { a: me.card.nick, b: o.nick, ra: me.card.rp, rb: o.rp || 0, at: now } }).catch(() => {});
      rkJoin(id);
    } catch { me.busy = false; }
  }
  async function rkClaim(srv, acc, id) { // 상대가 아직 아무와도 짝이 안 됐을 때만 (동시에 두 방이 생기지 않게)
    if (cloud.rdb) {
      const r = await cloud.rdb.ref(`wace/q${srv}/${acc}`).transaction(v => (v === null ? null : v.m ? undefined : Object.assign(v, { m: id })));
      const v = r.snapshot && r.snapshot.val();
      return !!(r.committed && v && v.m === id);
    }
    const d = await readDoc(`wace/q${srv}`);
    if (!d[acc] || d[acc].m) return false;
    await mergeDoc(`wace/q${srv}`, { [acc]: Object.assign(d[acc], { m: id }) });
    return true;
  }
  function rkJoin(id) {
    const me = rk;
    if (!me || me.match) return;
    me.match = id; me.inQueue = false;
    mergeDoc(`wace/q${me.srv}`, { [me.acc]: null }).catch(() => {});
    (me.unsubs || []).forEach(f => f());
    me.unsubs = [sub('wace/m_' + id, m => { if (rk === me && m && m.id) rkUpdate(me, m); })];
    clearInterval(me.timer);
    me.timer = setInterval(() => rkTick(me), 1000);
  }
  const rkSide = (me, m) => (m.a && m.a.acc === me.acc ? 'a' : 'b');
  function rkUpdate(me, m) {
    me.m = m;
    const side = rkSide(me, m), o = side === 'a' ? 'b' : 'a';
    if (!me.t0) { me.t0 = Date.now() + 3500; rkEmit('start', { id: m.id, probs: m.probs, opp: m[o], me: m[side], bot: !!me.bot, sec: S.RANK_SEC }); }
    const hb = m['hb_' + o];
    if (hb !== me.oppHb) { me.oppHb = hb; me.oppSeen = Date.now(); }
    rkEmit('prog', { id: m.id, mine: m['s' + side] || 0, opp: m['s' + o] || 0 });
    if (m.win && !me.ended) rkEnd(me, m);
  }
  async function rkSetWin(me, v) {
    const m = me.m;
    if (!m || m.win) return;
    if (me.bot) { m.win = v; rkUpdate(me, m); return; }
    if (cloud.rdb) { await cloud.rdb.ref(`wace/m_${m.id}/win`).transaction(cur => cur || v); return; }
    const d = await readDoc('wace/m_' + m.id);
    if (!d.win) await mergeDoc('wace/m_' + m.id, { win: v });
  }
  function rkTick(me) {
    const m = me.m;
    if (rk !== me || !m || m.win || !me.t0) return;
    const now = Date.now(), side = rkSide(me, m), o = side === 'a' ? 'b' : 'a';
    if (me.bot) {
      const n = me.botAt.filter(x => x <= now).length;
      if (n !== m.sb) { m.sb = n; if (n >= S.RANK_N) m.win = 'bot'; rkUpdate(me, m); return; }
    } else if (cloud.rdb) cloud.rdb.ref(`wace/m_${m.id}/hb_${side}`).set(now).catch(() => {}); // 아직 있다는 표시
    if (now > me.t0 + S.RANK_SEC * 1000) { const a = m['s' + side] || 0, b = m['s' + o] || 0; rkSetWin(me, a > b ? me.acc : b > a ? m[o].acc : 'draw'); }
    else if (!me.bot && now > me.t0 + 12000 && now - (me.oppSeen || me.t0) > 25000) rkSetWin(me, me.acc); // 상대가 나갔다
  }
  function rkEnd(me, m) {
    me.ended = true;
    const res = m.win === 'draw' ? null : m.win === me.acc, side = rkSide(me, m);
    const out = rkApply(me.acc, m.id, res, !!me.bot, m['s' + side] || 0);
    rkEmit('end', Object.assign({ id: m.id, res: res === null ? 'draw' : res ? 'win' : 'lose', bot: !!me.bot }, out));
    if (!me.bot && side === 'a') { mergeDoc(`wace/l${me.srv}`, { [m.id]: null }).catch(() => {}); setTimeout(() => dropDoc('wace/m_' + m.id).catch(() => {}), 60000); } // 구경하던 친구도 결과를 본 뒤에 치운다
    setTimeout(() => { if (rk === me) rkStop(); }, 300);
  }
  function rkApply(acc, id, res, bot, solved) {
    const u = Object.values(local.users).find(x => x.acc === acc);
    if (!u) return {};
    const r = rankOf(u), before = S.tierOf(r.rp);
    if (r.done.includes(id)) return { rp: r.rp, tier: before };
    r.done = r.done.concat(id).slice(-30);
    if (res === true) { r.w++; r.streak = (r.streak || 0) + 1; } else if (res === false) { r.l++; r.streak = 0; }
    const delta = S.rankDelta(r.rp, res, r.streak, bot);
    r.rp = Math.max(0, r.rp + delta);
    r.best = Math.max(r.best || 0, r.rp);
    const coins = Math.ceil((res === true ? 15 : res === false ? 5 : 8) / (bot ? 3 : 1));
    earn(u, coins);
    if (res === true && !bot) sst(u, 'rankWins', 1);
    addXP(u, Math.round((res === true ? S.XP.rankWin : S.XP.rankLose) / (bot ? 2 : 1)));
    if (solved) { statsOf(u).solved += solved; track(u, 'solved', solved); }
    save();
    publishCard(u);
    const after = S.tierOf(r.rp), lvl = x => x.t * 10 + x.d;
    return { delta, rp: r.rp, tier: after, up: lvl(after) > lvl(before), down: lvl(after) < lvl(before), coins, w: r.w, l: r.l, streak: r.streak };
  }
  function rkWatchStop() { if (rkWatch) { try { rkWatch(); } catch { /* */ } rkWatch = null; } }

  // ---------- 🏟️ 랜드마크 · 전국 학교 대항전 ----------
  let lmCells = new Map(); // 칸 → [아이디, 이름] (지도마다 모든 기기가 똑같이 계산한다)
  function findLandmarks() {
    lmCells = new Map();
    const homes = new Set(BASE.map(s => s.cell));
    for (const [id, name, sido, sgg] of S.LANDMARKS) {
      const d = M.districts.find(x => x.sido.startsWith(sido) && x.sigungu.startsWith(sgg));
      if (!d) continue;
      let best = -1, bd = Infinity;
      for (let i = 0; i < M.n; i++) {
        if (homes.has(i) || M.nk(i) || M.jp(i) || lmCells.has(i)) continue;
        const e = (M.sx[i] - d.x) ** 2 + (M.sy[i] - d.y) ** 2;
        if (e < bd) { bd = e; best = i; }
      }
      if (best >= 0) lmCells.set(best, [id, name]);
    }
  }
  const evKey = k => String(k).replace(/[.#$[\]/]/g, '_');
  const keyOfId = id => evKey(schoolKey(schoolById(id)));
  const evPath = id => `meta/ev_${id}_${LV}`;
  const lmPath = g => `${WP}/g${g}/lm/main`;
  async function flagOnce(path, field) { // 여러 기기 중 한 번만
    if (cloud && cloud.rdb) { const r = await cloud.rdb.ref(`${path}/${field}`).transaction(v => (v ? undefined : 1)); return !!r.committed; }
    const d = await readDoc(path);
    if (d[field]) return false;
    await mergeDoc(path, { [field]: 1 });
    return true;
  }
  async function lmCaptured(a, rt, cell, prev) { // 랜드마크를 차지하면: 대항전 중이면 우리 학교 +20점, 지키던 학교는 지킨 시간(분)만큼
    const ev = S.eventOf(), now = Date.now(), cur = (await readDoc(lmPath(rt.g)))['c' + cell], k = keyOfId(rt.owner[cell]);
    await mergeDoc(lmPath(rt.g), { ['c' + cell]: { k, at: now } });
    const held = (from, to, pe) => (cur && cur.k && prev >= 0 && cur.k === keyOfId(prev) && cur.at < pe ? Math.floor((Math.min(now, pe) - Math.max(cur.at, from)) / 60000) : 0);
    if (!ev.on) { // 지난 대항전이 끝난 뒤 아직 정리 전이면 지킨 시간을 지난 대항전에 더한다
      const ps = ev.start - 7 * 864e5, pid = S.kstDate(ps), mins = held(ps, now, ps + S.EVENT_LEN);
      if (mins > 0 && !(await readDoc(evPath(pid)))['fin_g' + rt.g]) await bump(evPath(pid), cur.k, mins);
      return null;
    }
    const jobs = [bump(evPath(ev.id), k, S.LM_CAP)], mins = held(ev.start, now, ev.end);
    if (mins > 0) jobs.push(bump(evPath(ev.id), cur.k, mins));
    await Promise.all(jobs);
    sst(a.u, 'landmarks', 1); addXP(a.u, S.XP.landmark); save();
    return { name: lmCells.get(cell)[1], pts: S.LM_CAP };
  }
  async function eventLast(a, rt) { // 지난 주말 대항전 결과 (우리 서버에서 끝까지 지킨 시간은 처음 연 기기가 한 번 더한다)
    const ev = S.eventOf(), ps = ev.start - 7 * 864e5, id = S.kstDate(ps), pe = ps + S.EVENT_LEN, path = evPath(id);
    let d = await readDoc(path);
    if (!d['fin_g' + rt.g] && (await flagOnce(path, 'fin_g' + rt.g))) {
      const lm = await readDoc(lmPath(rt.g)), jobs = [];
      for (const [c] of lmCells) {
        const x = lm['c' + c], o = rt.owner[c];
        if (!x || o < 0 || x.k !== keyOfId(o) || x.at >= pe) continue;
        const mins = Math.floor((pe - Math.max(x.at, ps)) / 60000);
        if (mins > 0) jobs.push(bump(path, x.k, mins));
      }
      await Promise.all(jobs);
      if (jobs.length) d = await readDoc(path);
    }
    const all = Object.entries(d).filter(([k]) => k.includes('|')).sort((x, y) => y[1] - x[1]), mine = keyOfId(a.sid);
    const place = all.findIndex(([k]) => k === mine) + 1;
    return { id, board: all.slice(0, 3).map(([k, p]) => ({ name: k.split('|')[2] || '?', pts: p })), place, pts: place ? all[place - 1][1] : 0, claimed: !!(a.u.evClaim || {})[id] };
  }

  // ---------- 💰 곳간 (땅 수입) · 🏪 장터 ----------
  function ecoOf(a) {
    const rt = a.rt, u = a.u, sid = a.sid;
    let land = 0, mine = 0, lib = 0, farm = 0;
    for (const o of rt.owner) if (o === sid) land++;
    for (const x of Object.values(buildView(rt))) {
      if (x[1] !== sid) continue;
      const lv = x[3] || 1;
      if (x[0] === 'mine' && x[4] === u.acc) mine += 4 * lv;
      else if (x[0] === 'farm' && x[4] === u.acc) farm += 6 * lv;
      else if (x[0] === 'library') lib += lv;
    }
    lib = Math.min(10, lib);
    const base = S.ecoBase(land), rate = base + mine + lib, e = (u.eco = u.eco || {}), now = Date.now();
    if (!e.at) { e.at = now; save(); }
    const hours = Math.min(S.ECO_CAP_H, (now - e.at) / 3600e3);
    return { land, base, mine, lib, farm, rate, hours, stored: Math.floor(hours * rate), storedXp: Math.floor(hours * farm), cap: S.ECO_CAP_H, at: e.at, now };
  }
  const mkPath = srv => `wace/mk${srv}`;
  const mkList = d => Object.values(d || {}).filter(x => x && x.id && x.item);
  async function mkCollect(u, srv) { // 내 물건이 팔렸으면 코인, 7일 동안 안 팔렸으면 물건을 돌려받는다
    const d = await readDoc(mkPath(srv)), now = Date.now(), up = {};
    let got = 0, back = 0, n = 0;
    for (const x of mkList(d)) {
      if (x.acc !== u.acc) continue;
      if (x.buyer) { got += Math.floor(x.price * (1 - S.MARKET_FEE)); n++; up['i_' + x.id] = null; }
      else if (now - x.at > S.MARKET_DAYS * 864e5) { walletOf(u).items[x.item] = (u.items[x.item] || 0) + 1; back++; up['i_' + x.id] = null; }
    }
    if (!Object.keys(up).length) return { got: 0, back: 0 };
    await mergeDoc(mkPath(srv), up);
    if (got) earn(u, got);
    if (n) { sst(u, 'trades', n); addXP(u, S.XP.trade * n); }
    save();
    return { got, back };
  }
  async function mkTake(srv, id, acc) {
    if (cloud && cloud.rdb) { const r = await cloud.rdb.ref(`${mkPath(srv)}/i_${id}/buyer`).transaction(v => (v ? undefined : acc)); return !!r.committed; }
    const d = await readDoc(mkPath(srv)), x = d['i_' + id];
    if (!x || x.buyer) return false;
    await mergeDoc(mkPath(srv), { ['i_' + id]: Object.assign(x, { buyer: acc }) });
    return true;
  }
  const warView = rt => (rt.wars || []).map(w => Object.assign({}, w, { sc: (rt.warScore || {})[w.id] || {} }));
  // 진행 중인 전쟁의 점수(상대편 땅을 뺏은 칸 수)를 실시간으로
  function watchScores(rt) {
    rt.warScore = rt.warScore || {}; rt.scoreSubs = rt.scoreSubs || {};
    if (!cloud) return;
    for (const w of rt.wars || []) {
      if (w.st !== 'on' || rt.scoreSubs[w.id] || Date.now() > w.end + 600e3) continue;
      const un = cloud.db.doc(`${WP}/g${rt.g}/ws/${w.id}`).onSnapshot(s => { rt.warScore[w.id] = s.exists ? s.data() || {} : {}; if (worlds[rt.g] === rt) emit(rt.g, { t: 'warscore', id: w.id, sc: rt.warScore[w.id] }); }, () => {});
      rt.scoreSubs[w.id] = un || true;
      if (typeof un === 'function') (rt.unsubs = rt.unsubs || []).push(un);
    }
  }
  function setWars(rt, items) {
    rt.wars = (items || []).filter(w => Date.now() - (w.end || w.at) < 3 * 3600e3); // 3시간 지난 전쟁은 지운다
    watchScores(rt);
  }
  // 최신 전쟁 목록을 다시 읽고 고친 뒤 저장한다 (mutate 안에서 fail 하면 저장하지 않는다)
  async function saveWars(rt, mutate) {
    const path = `${WP}/g${rt.g}/w/main`;
    if (cloud) setWars(rt, (await readDoc(path)).items || []);
    const out = mutate(rt.wars);
    setWars(rt, rt.wars);
    if (cloud) await cloud.db.doc(path).set({ items: rt.wars });
    else { (local.worlds[rt.g] || (local.worlds[rt.g] = { cells: {} })).wars = rt.wars; save(); }
    emit(rt.g, { t: 'wars', items: warView(rt) });
    return out;
  }
  // 거절되거나 시간이 지난 전쟁 신청은 선포권을 돌려준다
  function warBook(a) {
    const u = walletOf(a.u), now = Date.now();
    let changed = false;
    u.warBack = u.warBack || {};
    for (const w of a.rt.wars || []) if (w.byAcc === u.acc && !u.warBack[w.id] && (w.st === 'no' || (w.st === 'ask' && !askLive(w, now)))) { u.items.war++; u.warBack[w.id] = 1; changed = true; }
    if (changed) save();
  }
  // 이 땅을 뺏어도 되는지 (안 되면 fail), 누구 땅이 되는지 (동맹은 돕는 학교 땅으로), 전쟁 점수는 어느 편인지
  function warCheck(rt, sid, prev) {
    if (LV === 'e' || prev < 0) return { sid };
    const now = Date.now(), mk = keyOfSid(sid), pk = keyOfSid(prev), block = S.warRule(rt.wars, now, mk, pk);
    if (block) fail(block.error);
    for (const w of rt.wars || []) {
      if (!S.warLive(w, now)) continue;
      const ms = S.warSide(w, mk), ps = S.warSide(w, pk);
      if (ms && ps && ms !== ps) { const main = ms === 'a' ? w.a : w.b; return { sid: idByKey.has(main) ? idByKey.get(main) : sid, war: w.id, side: ms }; }
    }
    return { sid };
  }
  function warScored(a, rt, wc) {
    if (!wc.war) return;
    (a.u.warHit = a.u.warHit || {})[wc.war] = wc.side;
    if (cloud) persist(rt, () => Promise.all([bump(`${WP}/g${rt.g}/ws/${wc.war}`, wc.side), bump(`${WP}/g${rt.g}/ws/${wc.war}`, 'p_' + a.u.acc), mergeDoc(`${WP}/g${rt.g}/ws/${wc.war}`, { ['n_' + a.u.acc]: a.u.profile.nickname })])); // 점수 + 전쟁 영웅
    else { const sc = (rt.warScore[wc.war] = rt.warScore[wc.war] || {}); sc[wc.side] = (sc[wc.side] || 0) + 1; emit(rt.g, { t: 'warscore', id: wc.war, sc }); }
  }
  // 일본 땅 (고등학교): 배를 댈 수 있는지
  const hasPort = (rt, sid) => { for (let i = 0; i < M.n; i++) if (rt.owner[i] === sid && M.coast(i)) return true; return false; };
  function portNear(rt, sid, cell) { // 배가 떠나는 우리 바닷가 땅 (그림용)
    let best = -1, bd = Infinity;
    for (let i = 0; i < M.n; i++) if (rt.owner[i] === sid && M.coast(i) && !M.jp(i)) { const d = (M.sx[i] - M.sx[cell]) ** 2 + (M.sy[i] - M.sy[cell]) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  const shipInfo = (rt, sid, cell, u) => (M.jp(cell) ? { coast: M.coast(cell), port: hasPort(rt, sid), have: walletOf(u).items.ship > 0 } : null);
  // 밴 투표: 서버마다 문서 하나에 "받는 사람_투표한 기기" = 시각
  async function voteCounts(a) {
    const d = await readDoc(`${WP}/g${a.srv}/v/main`), out = {}, now = Date.now();
    for (const [k, at] of Object.entries(d)) {
      if (now - at > S.VOTE_DAYS * 864e5) continue;
      const [acc, dev] = k.split('_');
      out[acc] = (out[acc] || 0) + 1;
      if (dev === local.device) out['me:' + acc] = true;
    }
    return out;
  }
  // 접속 표시: 전쟁·동맹 신청에 쓰려고 아이디·닉네임·학교도 함께
  let presMe = null;
  function setPresence(a) {
    if (!cloud || !cloud.room || !a.u.profile) return;
    const p = { grade: a.srv, acc: a.u.acc, nick: a.u.profile.nickname, key: a.u.profile.school };
    if (presMe && JSON.stringify(presMe) === JSON.stringify(p)) return;
    presMe = p;
    try { cloud.room.presence(p); } catch { /* 접속 표시는 다음에 */ }
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
  const birthGrade = u => S.gradeFromBirthYear(u.birthYear);
  // 중·고등학생은 같은 학교급 안에서 학년을 직접 고를 수 있다 (빠른년생 · 유예 등). 초등학생은 출생연도 그대로 (학년마다 서버가 달라서)
  const pickOk = (u, g) => { const b = birthGrade(u), lv = S.levelOf(b); return lv !== 'e' && Number.isInteger(g) && S.levelOf(g) === lv; };
  const gradeOf = u => (u.role ? u.viewGrade || 3 : pickOk(u, u.gradePick) ? u.gradePick : birthGrade(u)); // 운영자·개발자는 고른 학년 서버를 본다 (중학교 7, 고등학교 10)
  const srvOf = u => S.serverOf(gradeOf(u)); // 놀고 있는 서버: 초등은 학년마다, 중·고는 하나씩
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
  const walletOf = u => { u.coins = u.infCoins ? INF : u.coins || 0; u.items = Object.assign({ shield: 0, bomb: 0, scope: 0, war: 0, ship: 0 }, u.items); return u; }; // 🐛 코인 무한이면 늘 가득
  const earn = (u, n) => { walletOf(u).coins += Math.max(0, Math.round(n || 0)); };
  // 오늘의 미션: 날짜가 바뀌면 새 미션 3개
  function missionOf(u) {
    const day = koreaDay();
    if (!u.mission || u.mission.day !== day) u.mission = { day, list: S.dailyMissions(day, u.acc).map(m => ({ id: m.id, n: m.n, p: 0, done: false })), bonus: false };
    return u.mission;
  }
  function track(u, key, v) {
    for (const m of missionOf(u).list) { const d = S.MISSIONS.find(x => x.id === m.id); if (d.key === key) m.p = d.max ? Math.max(m.p, v) : m.p + v; }
    if (!(v > 0)) return;
    const s = seasonOfU(u); // 🏆 시즌 점수
    if (S.XP[key]) s.xp += S.XP[key] * v;
    if (key === 'solved' || key === 'captures') s.st[key] = (s.st[key] || 0) + v;
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
  const lookOf = u => { const l = u.looks || {}; return { av: l.av || '😀', ti: l.ti || '', fr: l.fr || '', own: l.own || [], pv: l.pv || 0, bv: l.bv || 0 }; }; // 🧑‍🎨 꾸미기 (pv·bv: 프로필 사진·배너를 바꾼 때)
  function publicUser(u) {
    const sid = profileSchool(u);
    return {
      username: u.username, acc: u.acc, birthYear: u.birthYear, grade: gradeOf(u), birthGrade: u.role || u.teacher ? null : birthGrade(u), stats: statsOf(u), badges: u.badges || [], role: u.role || null, builtin: isBuiltin(u),
      coins: walletOf(u).coins, infCoins: !!u.infCoins, items: u.items, scopeUntil: u.scopeUntil || 0, trophies: u.trophies || [],
      profile: sid >= 0 ? { schoolId: sid, semester: u.profile.semester, nickname: u.profile.nickname } : null,
      deleted: !u.role && u.profile && deleted[u.profile.school] ? deleted[u.profile.school] : undefined, // 우리 학교가 삭제됐을 때 개발자의 글
      looks: lookOf(u), treasures: u.treasures || 0, raidWins: u.raidWins || 0, cls: u.cls || null, clsName: u.clsName || null, teacher: !!u.teacher, classes: u.teacher ? u.classes || [] : undefined,
    };
  }
  // 친구 순위·학교 친구 목록에 보이는 카드 (비밀번호 같은 건 절대 안 올린다)
  // 👩‍🏫 반에 들어간 학생은 공부 기록을 반 문서에 올린다 (30초에 한 번까지)
  const clsAt = {};
  function publishClass(u) {
    if (!u.cls || !u.profile || Date.now() - (clsAt[u.acc] || 0) < 30000) return;
    clsAt[u.acc] = Date.now();
    const st = statsOf(u), top = Object.entries(u.wrongTopics || {}).sort((x, y) => y[1] - x[1]).slice(0, 3);
    mergeDoc('meta/cls_' + u.cls, { ['s_' + u.acc]: { nick: u.profile.nickname, school: u.profile.school.split('|')[2] || '', grade: gradeOf(u), solved: st.solved, wrongs: st.wrongs || 0, captures: st.captures, days: st.days, top, mast: Object.entries(u.topic || {}).slice(0, 30), at: Date.now() } }).catch(() => {});
  }
  async function publishCard(u) {
    publishClass(u);
    if (!cloud || !u.profile) return;
    const st = statsOf(u);
    try { await cloud.db.doc('players/' + u.acc).set({ nick: u.profile.nickname, school: u.profile.school, grade: srvOf(u), yr: gradeOf(u), av: lookOf(u).av, ti: lookOf(u).ti, fr: lookOf(u).fr, pv: lookOf(u).pv, bv: lookOf(u).bv, captures: st.captures, solved: st.solved, role: u.role || null, dev: local.device, at: Date.now(), rp: rankOf(u).rp, rs: season, rw: rankOf(u).w, rl: rankOf(u).l, scs: season, scap: seasonOfU(u).st.captures || 0, ps: (u.prevSeason || {}).n || 0, pc: (u.prevSeason || {}).cap || 0 }); } catch { /* 다음에 다시 */ }
  }
  async function playersOf(grade) {
    if (!cloud) return Object.values(local.users).filter(u => profileSchool(u) >= 0 && srvOf(u) === grade).map(u => ({ acc: u.acc, nick: u.profile.nickname, role: u.role || null, av: lookOf(u).av, ti: lookOf(u).ti, fr: lookOf(u).fr, pv: lookOf(u).pv, sid: profileSchool(u), captures: statsOf(u).captures, solved: statsOf(u).solved, rp: rankOf(u).rp, rs: season, rw: rankOf(u).w, rl: rankOf(u).l, scs: season, scap: seasonOfU(u).st.captures || 0, ps: (u.prevSeason || {}).n || 0, pc: (u.prevSeason || {}).cap || 0 }));
    const snap = await cloud.db.collection('players').where('grade', '==', grade).limit(1000).get(); // grade 칸 = 서버 번호
    return snap.docs.map(d => { const p = d.data(); return { acc: d.id, nick: p.nick, role: p.role || null, dev: p.dev || '', yr: p.yr || p.grade, av: p.av || '', ti: p.ti || '', fr: p.fr || '', pv: p.pv || 0, rp: p.rp || 0, rs: p.rs || 0, rw: p.rw || 0, rl: p.rl || 0, scs: p.scs || 0, scap: p.scap || 0, ps: p.ps || 0, pc: p.pc || 0, sid: idByKey.has(p.school) && !(kickTime(p.school) > (p.at || 0)) ? idByKey.get(p.school) : -1, captures: p.captures || 0, solved: p.solved || 0 }; }).filter(p => p.sid >= 0); // 퇴장된 친구는 빼고
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
    if (a.u.teacher) fail('👩‍🏫 선생님 계정은 선생님 화면을 써요.', 403);
    if (g < 1 || g > S.MAX_GRADE) fail('초등학생부터 고등학생까지만 플레이할 수 있어요.', 403);
    if (S.levelOf(g) !== LV) { const e = new HttpError(426, `${S.LEVEL_NAME[S.levelOf(g)]} 지도를 불러와야 해요.`); e.extra = { level: S.levelOf(g) }; throw e; } // 화면이 그 학교급 지도로 다시 연다
    if (kickedNow(a.u)) { a.u.profile = null; save(); fail('🚪 학교에서 퇴장되었어요. 학교를 다시 골라 주세요.', 409); }
    if (!a.u.role && a.u.profile && deleted[a.u.profile.school]) { const e = new HttpError(410, '🗑️ 우리 학교가 삭제되었어요. 새 학교를 골라 주세요.'); e.extra = { deleted: deleted[a.u.profile.school] }; throw e; }
    a.sid = profileSchool(a.u);
    if (a.sid < 0) fail('먼저 학교와 닉네임을 설정해 주세요.', 409);
    a.grade = g; // 문제 수준 (7 = 중1 … 12 = 고3)
    a.srv = S.serverOf(g); // 땅이 있는 서버
    a.rt = await getWorld(a.srv);
    setPresence(a);
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
    if (p.topic) out.topic = str(p.topic, 20); // 단원
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
      const teacher = !!b.teacher; // 👩‍🏫 선생님 계정: 게임은 안 하고 반 학생들의 공부 기록을 본다
      if (!teacher && !Number.isInteger(birthYear)) fail('나이 인증을 위해 출생연도를 골라 주세요.');
      const g = S.gradeFromBirthYear(birthYear), sy = S.schoolYear();
      if (!teacher && (g < 1 || g > S.MAX_GRADE)) fail(`나이 인증 실패: 초등학생부터 고등학생까지(${sy - 18}~${sy - 7}년생)만 가입할 수 있어요.`);
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
      local.users[key] = { username, acc: rand(8), salt, hash: await hashPw(password, salt), birthYear: teacher ? null : birthYear, profile: null, stats: Object.assign({}, STAT0), at: Date.now(), ...(teacher ? { teacher: true, classes: [] } : {}) };
      if (!teacher && b.gradePick != null && pickOk(local.users[key], Number(b.gradePick))) local.users[key].gradePick = Number(b.gradePick); // 중·고: 고른 학년
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
    'GET /api/me': async t => { const a = needLogin(t); await syncRole(a.u); return { user: publicUser(a.u), debug: !!a.s.debug, shared: isShared(), feat: 2, invite: await inviteOf(a.u), gone: Object.keys(deleted) }; },
    'GET /api/schools': async () => ({ custom: publicCustom(), gone: Object.keys(deleted) }),
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
        const stem = String(b.custom.name || '').replace(/\s+/g, '').replace(/(초등학교|초교|초|중학교|중|고등학교|고)$/, '');
        if (!/^[가-힣A-Za-z0-9]{1,12}$/.test(stem)) fail('학교 이름은 한글·영어·숫자로 1~12자 써 주세요.');
        const sc = { name: stem + S.LEVEL_NAME[LV], sido: d.sido, sigungu: d.sigungu, dong: cleanDong(b.custom.dong), ...(LV !== 'e' ? { lv: LV } : {}) };
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
        if (deleted[schoolKey(schoolById(schoolId))]) fail('🗑️ 삭제된 학교예요. 다른 학교를 골라 주세요.');
      }
      if (b.grade != null && !a.u.role) { const g = Number(b.grade); if (!pickOk(a.u, g)) fail('학년은 같은 학교급 안에서만 고를 수 있어요.'); a.u.gradePick = g; } // 📚 중·고 학년 고르기
      a.u.profile = { school: schoolKey(schoolById(schoolId)), semester, nickname, at: Date.now() };
      save();
      publishCard(a.u);
      return { user: publicUser(a.u), custom: publicCustom() };
    },
    'GET /api/world': async t => {
      const a = await needPlayer(t), rt = a.rt, def = [], home = [];
      rt.def.forEach((d, i) => { if (d > 0) def.push([i, d]); });
      for (let i = 0; i < schoolCount(); i++) home.push(rt.home[i] != null ? rt.home[i] : -1);
      const myU = LV !== 'e' && unionOf(rt, a.u.profile.school);
      const chat = rt.feed.filter(m => m.t === 'chat' && (m.ch === 'all' || (m.ch !== 'union' && m.sid === a.sid) || (m.ch === 'union' && myU && m.uid === myU.id))).map(m => Object.assign({}, m, { t: 'chat' }));
      await syncRole(a.u);
      if (LV !== 'e') warBook(a);
      const res = { grade: a.grade, srv: a.srv, level: LV, wars: warView(rt), unions: rt.unions || [], gone: Object.keys(deleted), treasures: treasureView(rt), builds: buildView(rt), owner: Array.from(rt.owner), def, home, custom: publicCustom(), online: rt.online, chat, offers: liveOffers(rt), attend: attend(a.u), badges: newBadges(a.u), stats: statsOf(a.u), shared: isShared(),
        user: publicUser(a.u), shields: liveShields(rt), flags: flagView(), mission: missionView(a.u).ready, invite: await inviteOf(a.u),
        season: seasonView(a.u), landmarks: [...lmCells].map(([c, [id, name]]) => [c, id, name]), event: S.eventOf(), rank: S.tierOf(rankOf(a.u).rp, rkArk.has(a.u.acc) ? 1 : 0) };
      publishCard(a.u);
      publishTop(rt);
      if (season > 1) finishSeason(season - 1, a.srv).catch(() => {});
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
      const members = (await playersOf(a.srv)).filter(p => p.sid === id).map(p => ({ acc: p.acc, nick: p.nick, role: p.role, av: p.av, ti: p.ti, fr: p.fr, pv: p.pv, captures: p.captures, solved: p.solved, online: p.acc === a.u.acc, me: p.acc === a.u.acc }));
      members.sort((x, y) => y.online - x.online || y.captures - x.captures);
      const sc = schoolById(id);
      return { id, name: sc.name, sido: sc.sido, sigungu: sc.sigungu, dong: sc.dong || '', url: sc.url || '', land, rank: land ? rank : null, def, members: members.slice(0, 30), memberCount: members.length };
    },
    'GET /api/players': async (t, q) => {
      const a = await needPlayer(t), list = (await playersOf(a.srv)).map(p => Object.assign(p, { me: p.acc === a.u.acc }));
      if (LV !== 'e') { const v = await voteCounts(a); list.forEach(p => { p.votes = v[p.acc] || 0; p.voted = !!v['me:' + p.acc]; }); } // 중·고: 밴 투표 수
      list.sort((x, y) => y.captures - x.captures || y.solved - x.solved);
      const n = Math.max(10, Math.min(100, Number(q.get('n')) || 10));
      return { top: list.slice(0, n), rank: list.findIndex(p => p.me) + 1, total: list.length };
    },
    'POST /api/capture': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, cell = targetCell(b), prev = rt.owner[cell];
      if (prev === a.sid) fail('이미 우리 학교 땅이에요.');
      if (rt.homeCell[cell] >= 0) fail('학교 본부는 뺏을 수 없어요.');
      if (shieldedNow(rt, cell)) fail(`🛡️ 방패가 지키고 있어요! ${Math.ceil((rt.shields[cell] - Date.now()) / 3600e3)}시간 뒤에 뺏을 수 있어요.`);
      const wc = warCheck(rt, a.sid, prev), sid = wc.sid; // 동맹이면 돕는 학교 땅이 된다
      if (prev === sid) fail('이미 우리 편 학교 땅이에요.');
      const cost = S.captureCost({ owner: rt.owner, def: rt.def, nb: M.nb, sid, cell, grade: a.grade, nk: M.nk, jp: M.jp, ship: shipInfo(rt, sid, cell, a.u), size: () => { let k = 0; for (const o of rt.owner) if (o === sid) k++; return k; } });
      if (cost.error) fail(cost.error);
      const extra = (prev >= 0 ? S.buildExtra(cell, rt.owner, M.nb, rt.builds) : 0) + (lmCells.has(cell) ? S.LM_COST : 0); // 🗼 망루 · 🧱 성벽 · 🏟️ 랜드마크
      const required = cost.cost + extra;
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
      const port = cost.ship ? portNear(rt, sid, cell) : -1;
      if (cost.ship) walletOf(a.u).items.ship--; // 배는 한 번 건너면 없어진다
      setCell(rt, cell, sid, 0);
      warScored(a, rt, wc);
      const treasure = claimTreasure(a, rt, cell); // 🎁
      const landmark = lmCells.has(cell) ? await lmCaptured(a, rt, cell, prev).catch(() => null) : null; // 🏟️
      if (rt.builds[cell]) { delete rt.builds[cell]; persist(rt, () => mergeDoc(`${WP}/g${rt.g}/b/main`, { ['c' + cell]: null })); } // 건물이 무너진다
      save();
      const cells = [[cell, sid, 0]], ev = { kind: 'capture', by: a.u.profile.nickname, role: a.u.role || null, sid, prev, cell, far: !!cost.far, escape: !!cost.escape, duel: !!b.duel, ...(cost.ship ? { ship: port } : {}), ...(sid !== a.sid ? { ally: a.sid } : {}), ...(wc.war ? { war: 1 } : {}), ...(lmCells.has(cell) ? { lm: lmCells.get(cell)[1] } : {}) };
      persist(rt, async () => { await writeCells(rt, cells); await pushFeed(rt, { t: 'ev', ev }); });
      publishCard(a.u);
      publishTop(rt);
      return { ok: true, landmark, season: seasonView(a.u), cells, stats: st, badges: newBadges(a.u), coins: a.u.coins, got, mission: missionView(a.u).ready, items: walletOf(a.u).items, ship: cost.ship ? port : undefined, treasure };
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
      if (b.act === 'delSchool' || b.act === 'undelSchool' || b.act === 'listDeleted') { // 🗑️ 학교 삭제 (개발자만)
        if (u.role !== 'dev') fail('개발자만 학교를 삭제할 수 있어요.', 403);
        const by = u.profile ? u.profile.nickname : '개발자';
        if (b.act === 'delSchool') {
          const id = idByKey.get(String(b.key || ''));
          if (id == null) fail('삭제할 학교를 목록에서 골라 주세요.');
          const msg = String(b.msg || '').replace(/[\u0000-\u0008\u000b-\u001f<>]/g, '').trim().slice(0, 300);
          if (!msg) fail('그 학교 학생들에게 보낼 글(삭제한 까닭)을 써 주세요.');
          const sc = schoolById(id);
          await saveDeleted(Object.assign({}, deleted, { [b.key]: { key: b.key, name: sc.name, where: `${sc.sido} ${sc.sigungu}`, msg, by, at: Date.now() } }), by);
        } else if (b.act === 'undelSchool') {
          if (!deleted[b.key]) fail('삭제된 학교가 아니에요.');
          const next = Object.assign({}, deleted);
          delete next[b.key];
          await saveDeleted(next, by);
        }
        return { ok: true, list: Object.values(deleted).sort((x, y) => y.at - x.at) };
      }
      if (b.act === 'grade') {
        const g = Number(b.grade);
        if (!S.SERVERS.includes(g)) fail('학년(서버)을 골라 주세요.');
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
          const r = await cloud.db.doc('meta/reset').get(), e = (r.exists ? r.data().epoch || 0 : 0) + 1, old = WP;
          await cloud.db.doc('meta/reset').set({ epoch: e, by, at: Date.now() });
          if (epoch !== e) startOver(e, by); // (저장하면서 바로 알림이 와서 이미 바뀌었을 수도 있다)
          if (cloud.rdb) cloud.rdb.ref(old).remove().catch(() => {}); // 지난 땅 기록은 지워서 저장소를 비운다
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
        if (cloud && cloud.rdb) {
          const f = cloud.rdb.ref(`${WP}/g${rt.g}/f`), all = await f.once('value'), del = {};
          all.forEach(c => { const it = c.val(); if (it && it.t === 'chat') del[c.key] = null; });
          if (Object.keys(del).length) await f.update(del);
        } else if (cloud) await cloud.db.doc(`${WP}/g${rt.g}/f/main`).set({ items: rt.feed.slice(-40) });
        text = '채팅을 모두 지웠어요'; extra = { chatClear: true };
      } else if (b.act === 'resetWorld') {
        for (let c = 0; c < M.n; c++) clear(c);
        rt.offers = [];
        await saveOffers(rt);
        text = `${S.serverName(a.srv)}를 처음 상태로 되돌렸어요`;
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
    'GET /api/wrong': async t => { const u = needLogin(t).u; return { list: u.wrong || [], topics: u.wrongTopics || {} }; },
    'POST /api/wrong': async (t, q, b) => {
      const a = needLogin(t), p = cleanProblem(b.p), list = (a.u.wrong || []).filter(x => x.p.q !== p.q);
      list.unshift({ id: rand(5), p, given: String(b.given || '').slice(0, 30), at: Date.now() });
      if (p.topic) { const wt = (a.u.wrongTopics = a.u.wrongTopics || {}); wt[p.topic] = (wt[p.topic] || 0) + 1; } // 단원별로 틀린 수 (선생님 화면에도)
      statsOf(a.u).wrongs = (statsOf(a.u).wrongs || 0) + 1;
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
      const a = await needPlayer(t), ch = ['school', 'union'].includes(b.ch) ? b.ch : 'all', now = Date.now(), myU = ch === 'union' && unionOf(a.rt, a.u.profile.school);
      if (ch === 'union' && !myU) fail('우리 학교가 연합에 들어가 있어야 연합 채팅을 쓸 수 있어요.');
      const item = { t: 'chat', ch, ...(myU ? { uid: myU.id } : {}), sid: a.sid, by: a.u.profile.nickname, role: a.u.role || null, av: lookOf(a.u).av, ti: lookOf(a.u).ti, fr: lookOf(a.u).fr, acc: a.u.acc, pv: lookOf(a.u).pv };
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
      addXP(u, b.id === 'bonus' ? S.XP.missionAll : S.XP.mission);
      save();
      return Object.assign(missionView(u), { coins: u.coins, got, season: seasonView(u) });
    },
    // 🛒 상점
    'GET /api/shop': async t => { const u = walletOf(needLogin(t).u); return { coins: u.coins, items: u.items, prices: Object.fromEntries(S.SHOP.map(it => [it.id, S.priceOf(it.id)])), scopeUntil: u.scopeUntil || 0 }; },
    'POST /api/shop/buy': async (t, q, b) => {
      const u = walletOf(needLogin(t).u), id = String(b.id || ''), price = S.priceOf(id);
      if (!S.shopFor(LV).some(it => it.id === id) || id === 'flag') fail('없는 아이템이에요.');
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
      const a = await needPlayer(t), rt = a.rt, u = walletOf(a.u), cell = targetCell(b);
      if (u.items.bomb < 1) fail('폭탄이 없어요. 🛒 상점에서 사 주세요.');
      const wc = warCheck(rt, a.sid, rt.owner[cell]), sid = wc.sid, now = Date.now();
      const size = () => { let k = 0; for (const o of rt.owner) if (o === sid) k++; return k; };
      const warOk = c => LV === 'e' || rt.owner[c] < 0 || !S.warRule(rt.wars, now, keyOfSid(a.sid), keyOfSid(rt.owner[c]));
      const ok = c => rt.owner[c] !== sid && rt.homeCell[c] < 0 && !shieldedNow(rt, c);
      if (!ok(cell)) fail(rt.owner[cell] === sid ? '이미 우리 학교 땅이에요.' : rt.homeCell[cell] >= 0 ? '학교 본부는 뺏을 수 없어요.' : '🛡️ 방패가 지키는 땅이에요.');
      const cost = S.captureCost({ owner: rt.owner, def: rt.def, nb: M.nb, sid, cell, grade: a.grade, nk: M.nk, jp: M.jp, ship: shipInfo(rt, sid, cell, u), size });
      if (cost.error) fail(cost.error);
      if (cost.ship) fail('⛵ 일본에 처음 갈 때는 폭탄 말고 배를 타고 건너가요.');
      const walled = c => { const x = rt.builds[c]; return x && x[0] === 'wall' && x[1] === rt.owner[c]; };
      if (walled(cell)) fail('🧱 성벽이 있는 땅은 폭탄으로 뺏을 수 없어요.');
      if (lmCells.has(cell)) fail('🏟️ 랜드마크는 폭탄으로 뺏을 수 없어요. 문제를 풀어 차지해요!');
      const nkOk = size() >= S.NK_MIN, jpOk = size() >= S.JP_MIN; // 옆 칸이 북한·일본 땅이면 칸 수 규칙도 지킨다
      const extra = [...M.nb(cell)].filter(c => ok(c) && warOk(c) && !walled(c) && !lmCells.has(c) && rt.def[c] <= S.BOMB_MAX_DEF && (nkOk || !M.nk(c)) && (jpOk || !M.jp(c))).sort((x, y) => rt.def[x] - rt.def[y]).slice(0, S.BOMB_EXTRA);
      const cells = [cell, ...extra].map(c => [c, sid, 0]), st = statsOf(u);
      let steals = 0;
      for (const [c] of cells) { if (rt.owner[c] >= 0) steals++; setCell(rt, c, sid, 0); }
      warScored(a, rt, wc);
      const treasures = cells.map(([c]) => claimTreasure(a, rt, c)).filter(Boolean);
      u.items.bomb--;
      st.captures += cells.length; st.steals += steals;
      track(u, 'items', 1); track(u, 'captures', cells.length); if (steals) track(u, 'steals', steals);
      save();
      const ev = { kind: 'bomb', by: u.profile.nickname, role: u.role || null, sid, n: cells.length, cell };
      persist(rt, async () => { await writeCells(rt, cells); await pushFeed(rt, { t: 'ev', ev }); });
      publishCard(u);
      return { ok: true, cells, stats: st, items: u.items, coins: u.coins, badges: newBadges(u), mission: missionView(u).ready, treasure: treasures[0] || null };
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
    // ---------- 전쟁 · 동맹 · 밴 투표 (중·고등학교) ----------
    'GET /api/war': async t => {
      const a = await needPlayer(t), rt = a.rt, mk = a.u.profile.school, seen = new Set();
      mhOnly();
      warBook(a);
      const peers = (rt.peers || []).filter(p => p.acc && p.acc !== a.u.acc && p.key && idByKey.has(p.key) && !seen.has(p.acc) && seen.add(p.acc))
        .map(p => ({ acc: p.acc, nick: p.nick, key: p.key, school: nameOfKey(p.key), mine: p.key === mk }));
      const rec = Object.values(await readDoc(`${WP}/g${a.srv}/wr/main`)).filter(x => x && x.end).sort((x, y) => y.end - x.end);
      return { wars: warView(rt), peers, me: { acc: a.u.acc, key: mk, school: nameOfKey(mk) }, items: walletOf(a.u).items, coins: a.u.coins, now: Date.now(), records: rec.slice(0, 30), unions: rt.unions || [] };
    },
    'POST /api/war/declare': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, u = walletOf(a.u), mk = a.u.profile.school, now = Date.now();
      mhOnly();
      if (u.items.war < 1) fail(`⚔️ 전쟁 선포권이 있어야 해요. 🛒 상점에서 사 주세요. (${S.priceOf('war')}코인)`);
      const p = (rt.peers || []).find(x => x.acc === b.acc && x.key && idByKey.has(x.key));
      if (!p) fail('그 친구는 지금 게임에 없어요. 게임에 들어와 있는 친구에게만 전쟁을 걸 수 있어요.');
      if (p.key === mk) fail('우리 학교 친구에게는 전쟁을 걸 수 없어요.');
      const busy = k => (rt.wars || []).some(w => (S.warLive(w, now) || askLive(w, now)) && S.warSide(w, k));
      const w = await saveWars(rt, ws => {
        if (busy(mk)) fail('우리 학교는 이미 전쟁 중이거나 신청을 기다리고 있어요.');
        if (busy(p.key)) fail('그 학교는 지금 다른 전쟁을 하고 있어요.');
        const x = { id: rand(5), a: mk, an: nameOfKey(mk), b: p.key, bn: nameOfKey(p.key), by: a.u.profile.nickname, byAcc: a.u.acc, to: p.acc, toNick: p.nick, st: 'ask', at: now, al: {}, rq: [] };
        ws.push(x);
        return x;
      });
      u.items.war--; // 거절되거나 시간이 지나면 돌려준다 (warBook)
      save();
      pushFeed(rt, { t: 'ev', ev: { kind: 'war', w: 'ask', an: w.an, bn: w.bn, by: w.by } });
      return { ok: true, war: w, items: u.items };
    },
    'POST /api/war/answer': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, now = Date.now();
      mhOnly();
      const w = await saveWars(rt, ws => {
        const x = ws.find(y => y.id === b.id);
        if (!x || x.to !== a.u.acc || x.st !== 'ask') fail('이미 끝난 전쟁 신청이에요.');
        if (!askLive(x, now)) fail('수락할 시간(2분)이 지났어요.');
        if (b.yes) {
          if (ws.some(y => y !== x && S.warLive(y, now) && (S.warSide(y, x.a) || S.warSide(y, x.b)))) fail('두 학교 중 한 곳이 이미 다른 전쟁을 하고 있어요.');
          Object.assign(x, { st: 'on', start: now, end: now + S.WAR_MIN * 60e3 });
        } else x.st = 'no';
        return x;
      });
      pushFeed(rt, { t: 'ev', ev: { kind: 'war', w: w.st, an: w.an, bn: w.bn, by: a.u.profile.nickname } });
      return { ok: true, war: w };
    },
    'POST /api/war/ally': async (t, q, b) => { // 전쟁 중인 학교가 다른 학교에 동맹을 신청
      const a = await needPlayer(t), rt = a.rt, mk = a.u.profile.school, now = Date.now();
      mhOnly();
      const p = (rt.peers || []).find(x => x.acc === b.acc && x.key && idByKey.has(x.key));
      if (!p) fail('그 친구는 지금 게임에 없어요.');
      const r = await saveWars(rt, ws => {
        const w = ws.find(y => y.id === b.id);
        if (!w || !S.warLive(w, now)) fail('지금 하고 있는 전쟁이 없어요.');
        const side = mk === w.a ? 'a' : mk === w.b ? 'b' : null;
        if (!side) fail('전쟁을 하고 있는 두 학교만 동맹을 신청할 수 있어요.');
        if (S.warSide(w, p.key) || ws.some(y => y !== w && S.warLive(y, now) && S.warSide(y, p.key))) fail('그 학교는 이미 전쟁에 참여하고 있어요.');
        w.rq = w.rq || [];
        if (w.rq.some(x => x.key === p.key && x.st === 'ask' && now - x.at < S.WAR_ASK_SEC * 1000)) fail('그 학교에는 이미 동맹을 신청했어요.');
        const x = { id: rand(4), side, to: p.acc, toNick: p.nick, key: p.key, kn: nameOfKey(p.key), by: a.u.profile.nickname, at: now, st: 'ask' };
        w.rq.push(x);
        return x;
      });
      return { ok: true, req: r };
    },
    'POST /api/war/allyAnswer': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, now = Date.now();
      mhOnly();
      const res = await saveWars(rt, ws => {
        const w = ws.find(y => y.id === b.id), r = w && (w.rq || []).find(x => x.id === b.rid);
        if (!r || r.to !== a.u.acc || r.st !== 'ask') fail('이미 끝난 동맹 신청이에요.');
        if (!S.warLive(w, now)) fail('전쟁이 끝났어요.');
        if (now - r.at > S.WAR_ASK_SEC * 1000) fail('수락할 시간(2분)이 지났어요.');
        if (b.yes) { w.al = w.al || {}; w.al[r.key] = r.side; r.st = 'yes'; } else r.st = 'no';
        return { w, r };
      });
      if (res.r.st === 'yes') pushFeed(rt, { t: 'ev', ev: { kind: 'war', w: 'ally', an: res.r.kn, bn: res.r.side === 'a' ? res.w.an : res.w.bn, by: a.u.profile.nickname } });
      return { ok: true, war: res.w };
    },
    'POST /api/war/join': async (t, q, b) => { // 🛡️ 같은 연합 학교의 전쟁에 바로 참전 (신청 없이)
      const a = await needPlayer(t), rt = a.rt, mk = a.u.profile.school, now = Date.now(), u0 = unionOf(rt, mk);
      mhOnly();
      if (!u0) fail('연합에 들어간 학교만 바로 참전할 수 있어요.');
      const w = await saveWars(rt, ws => {
        const x = ws.find(y => y.id === b.id);
        if (!x || !S.warLive(x, now)) fail('지금 하고 있는 전쟁이 아니에요.');
        if (ws.some(y => S.warLive(y, now) && S.warSide(y, mk))) fail('우리 학교는 이미 전쟁에 참여하고 있어요.');
        const side = u0.schools.includes(x.a) ? 'a' : u0.schools.includes(x.b) ? 'b' : null;
        if (!side) fail('우리 연합 학교의 전쟁이 아니에요.');
        x.al = x.al || {}; x.al[mk] = side;
        return x;
      });
      pushFeed(rt, { t: 'ev', ev: { kind: 'war', w: 'ally', an: nameOfKey(mk), bn: S.warSide(w, mk) === 'a' ? w.an : w.bn, by: a.u.profile.nickname } });
      return { ok: true, war: w };
    },
    // ---------- 🛡️ 연합 ----------
    'POST /api/union/create': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, u = walletOf(a.u), mk = a.u.profile.school;
      mhOnly();
      const name = S.cleanChat(String(b.name || '')).replace(/[<>]/g, '').trim().slice(0, 8);
      if (name.length < 2) fail('연합 이름을 2~8자로 지어 주세요.');
      if (!S.FLAG_MARKS.includes(b.mark) || !S.FLAG_COLORS.includes(b.color)) fail('연합 마크와 색깔을 골라 주세요.');
      if (u.coins < S.UNION_PRICE) fail(`코인이 모자라요. (${S.UNION_PRICE}코인 필요)`);
      const x = await saveUnions(rt, us => {
        if (us.some(y => y.schools.includes(mk))) fail('우리 학교는 이미 연합에 들어가 있어요.');
        if (us.some(y => y.name === name)) fail('같은 이름의 연합이 있어요.');
        const y = { id: rand(4), name, mark: b.mark, color: b.color, lead: mk, schools: [mk], by: a.u.profile.nickname, at: Date.now(), rq: [] };
        us.push(y);
        return y;
      });
      u.coins -= S.UNION_PRICE; track(u, 'items', 1); save();
      pushFeed(rt, { t: 'ev', ev: { kind: 'union', w: 'new', name: x.name, mark: x.mark, school: nameOfKey(mk), by: a.u.profile.nickname } });
      return { ok: true, union: x, coins: u.coins, items: u.items };
    },
    'POST /api/union/invite': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, mk = a.u.profile.school, now = Date.now();
      mhOnly();
      const p = (rt.peers || []).find(x => x.acc === b.acc && x.key && idByKey.has(x.key));
      if (!p) fail('그 친구는 지금 게임에 없어요.');
      const r = await saveUnions(rt, us => {
        const y = us.find(z => z.schools.includes(mk));
        if (!y) fail('우리 학교가 연합에 들어가 있어야 초대할 수 있어요.');
        if (us.some(z => z.schools.includes(p.key))) fail('그 학교는 이미 다른 연합에 있어요.');
        if (y.schools.length >= S.UNION_MAX) fail(`연합은 학교 ${S.UNION_MAX}곳까지예요.`);
        y.rq = (y.rq || []).filter(x => now - x.at < S.WAR_ASK_SEC * 1000 * 5);
        if (y.rq.some(x => x.key === p.key && x.st === 'ask')) fail('그 학교에는 이미 초대를 보냈어요.');
        const x = { id: rand(4), to: p.acc, toNick: p.nick, key: p.key, kn: nameOfKey(p.key), by: a.u.profile.nickname, at: now, st: 'ask' };
        y.rq.push(x);
        return x;
      });
      return { ok: true, req: r };
    },
    'POST /api/union/answer': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, mk = a.u.profile.school;
      mhOnly();
      const res = await saveUnions(rt, us => {
        const y = us.find(z => z.id === b.id), r = y && (y.rq || []).find(x => x.id === b.rid);
        if (!r || r.to !== a.u.acc || r.st !== 'ask') fail('이미 끝난 초대예요.');
        if (b.yes) {
          if (us.some(z => z.schools.includes(mk))) fail('우리 학교는 이미 다른 연합에 있어요.');
          if (y.schools.length >= S.UNION_MAX) fail('연합이 가득 찼어요.');
          y.schools.push(mk); r.st = 'yes';
        } else r.st = 'no';
        return { y, r };
      });
      if (res.r.st === 'yes') pushFeed(rt, { t: 'ev', ev: { kind: 'union', w: 'join', name: res.y.name, mark: res.y.mark, school: nameOfKey(mk), by: a.u.profile.nickname } });
      return { ok: true, union: res.y };
    },
    'POST /api/union/leave': async t => {
      const a = await needPlayer(t), rt = a.rt, mk = a.u.profile.school;
      mhOnly();
      const y = await saveUnions(rt, us => {
        const z = us.find(x => x.schools.includes(mk));
        if (!z) fail('우리 학교는 연합에 없어요.');
        z.schools = z.schools.filter(k => k !== mk);
        if (z.lead === mk) z.lead = z.schools[0] || '';
        return z;
      });
      pushFeed(rt, { t: 'ev', ev: { kind: 'union', w: 'leave', name: y.name, mark: y.mark, school: nameOfKey(mk), by: a.u.profile.nickname } });
      return { ok: true };
    },
    'POST /api/war/settle': async (t, q, b) => { // 전쟁이 끝나면: 이긴 편에서 상대 땅을 뺏은 사람은 코인
      const a = await needPlayer(t), rt = a.rt, u = walletOf(a.u), w = (rt.wars || []).find(x => x.id === b.id);
      if (!w || w.st !== 'on') fail('없는 전쟁이에요.');
      if (Date.now() < w.end) fail('아직 전쟁 중이에요.');
      const sc = cloud ? await readDoc(`${WP}/g${a.srv}/ws/${w.id}`) : (rt.warScore || {})[w.id] || {};
      const A = sc.a || 0, B = sc.b || 0, win = A > B ? 'a' : B > A ? 'b' : null, hit = (u.warHit || {})[w.id];
      let got = 0;
      u.warPaid = u.warPaid || {};
      if (hit && win === hit && !u.warPaid[w.id]) { got = S.WAR_WIN; earn(u, got); }
      if (hit) u.warPaid[w.id] = 1;
      save();
      let hero = null; // ⭐ 전쟁 영웅: 상대 땅을 가장 많이 뺏은 사람
      for (const [k, v] of Object.entries(sc)) if (k.startsWith('p_') && (!hero || v > hero.n)) hero = { nick: sc['n_' + k.slice(2)] || '?', n: v };
      if (cloud) mergeDoc(`${WP}/g${a.srv}/wr/main`, { ['w_' + w.id]: { an: w.an, bn: w.bn, a: w.a, b: w.b, sa: A, sb: B, win: win || 'draw', end: w.end, al: Object.keys(w.al || {}).length, ...(hero ? { hero } : {}) } }).catch(() => {}); // 📜 전쟁 기록 (누가 먼저 적어도 같은 내용)
      return { ok: true, a: A, b: B, win, side: hit || S.warSide(w, a.u.profile.school), got, coins: u.coins };
    },
    'POST /api/vote': async (t, q, b) => { // 밴 투표: 7일 안에 20표가 모이면 하루 동안 정지
      const a = await needPlayer(t), now = Date.now();
      mhOnly();
      if (b.acc === a.u.acc) fail('나에게는 투표할 수 없어요.');
      const p = (await playersOf(a.srv)).find(x => x.acc === b.acc);
      if (!p) fail('그 친구를 찾을 수 없어요.');
      if (p.role) fail('운영자·개발자는 투표로 정지할 수 없어요.');
      const path = `${WP}/g${a.srv}/v/main`, field = `${p.acc}_${local.device}`, cur = await readDoc(path);
      if (cur[field] && now - cur[field] < S.VOTE_DAYS * 864e5) fail('이미 투표했어요. (한 사람에게 7일에 한 번)');
      await mergeDoc(path, { [field]: now });
      const n = (await voteCounts(a))[p.acc] || 0;
      if (n < S.VOTE_BAN) return { ok: true, votes: n };
      mod.bans.push({ nick: p.nick, accs: [p.acc], devs: p.dev ? [p.dev] : [], until: now + S.VOTE_BAN_HOURS * 3600e3, by: '친구들 투표', at: now });
      await saveMod();
      const clear = {};
      for (const k of Object.keys(await readDoc(path))) if (k.startsWith(p.acc + '_')) clear[k] = null; // 정지되면 표는 처음부터
      await mergeDoc(path, clear);
      pushFeed(a.rt, { t: 'ev', ev: { kind: 'notice', by: '투표', text: `🗳️ 친구들 투표 ${n}표로 ${p.nick}님이 ${S.VOTE_BAN_HOURS}시간 동안 정지됐어요.` } });
      return { ok: true, votes: n, banned: true };
    },
    // ---------- 👩‍🏫 선생님 모드 ----------
    'POST /api/class/create': async (t, q, b) => {
      const u = needLogin(t).u;
      if (!u.teacher) fail('선생님 계정만 반을 만들 수 있어요.', 403);
      const name = String(b.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
      if (!name) fail('반 이름을 써 주세요. (예: 6학년 3반)');
      if ((u.classes || []).length >= 10) fail('반은 10개까지 만들 수 있어요.');
      const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let code = '';
      for (let k = 0; k < 6; k++) code += A[crypto.getRandomValues(new Uint8Array(1))[0] % A.length];
      await mergeDoc('meta/cls_' + code, { name, by: u.username, tacc: u.acc, at: Date.now() });
      u.classes = (u.classes || []).concat([{ code, name }]);
      save();
      return { ok: true, classes: u.classes };
    },
    'POST /api/class/remove': async (t, q, b) => {
      const u = needLogin(t).u;
      if (!u.teacher) fail('선생님 계정만 할 수 있어요.', 403);
      u.classes = (u.classes || []).filter(c => c.code !== b.code);
      save();
      mergeDoc('meta/cls_' + b.code, { closed: true }).catch(() => {});
      return { ok: true, classes: u.classes };
    },
    'GET /api/class': async (t, q) => { // 선생님: 반 학생들의 기록
      const u = needLogin(t).u;
      if (!u.teacher) fail('선생님 계정만 볼 수 있어요.', 403);
      const code = q.get('code'), c = (u.classes || []).find(x => x.code === code);
      if (!c) return { classes: u.classes || [] };
      const d = await readDoc('meta/cls_' + code);
      const students = Object.entries(d).filter(([k]) => k.startsWith('s_')).map(([k, v]) => Object.assign({ acc: k.slice(2) }, v)).sort((x, y) => (y.solved || 0) - (x.solved || 0));
      return { classes: u.classes, cls: c, students };
    },
    'POST /api/class/join': async (t, q, b) => { // 학생: 선생님이 알려 준 반 코드로 들어가기
      const a = needLogin(t), u = a.u, code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (u.teacher) fail('선생님 계정은 반에 들어갈 수 없어요.');
      if (code.length !== 6) fail('반 코드 6자리를 써 주세요.');
      const d = await readDoc('meta/cls_' + code);
      if (!d.name || d.closed) fail('그런 반이 없어요. 선생님께 코드를 다시 물어보세요.');
      if (u.cls && u.cls !== code) mergeDoc('meta/cls_' + u.cls, { ['s_' + u.acc]: null }).catch(() => {});
      u.cls = code; u.clsName = d.name;
      save();
      clsAt[u.acc] = 0;
      publishClass(u);
      return { ok: true, cls: code, name: d.name };
    },
    'POST /api/class/leave': async t => {
      const u = needLogin(t).u;
      if (u.cls) mergeDoc('meta/cls_' + u.cls, { ['s_' + u.acc]: null }).catch(() => {});
      u.cls = null; u.clsName = null;
      save();
      return { ok: true };
    },
    // ---------- 🧑‍🎨 꾸미기 ----------
    'POST /api/looks/buy': async (t, q, b) => {
      const a = needLogin(t), u = walletOf(a.u), kind = String(b.kind), it = (S.LOOKS[kind] || []).find(x => x.id === b.id), l = (u.looks = u.looks || {}), own = (l.own = l.own || []);
      if (!it) fail('없는 꾸미기예요.');
      if (it.pass) fail('🏆 시즌 패스 보상으로 받을 수 있어요.');
      if (it.price && own.includes(kind + ':' + it.id)) fail('이미 가지고 있어요.');
      if (it.need) { const have = it.need[0] === 'treasures' || it.need[0] === 'raidWins' ? u[it.need[0]] || 0 : statsOf(u)[it.need[0]] || 0; if (have < it.need[1]) fail(`${S.NEED_NAME[it.need[0]]} ${it.need[1]}번을 해야 살 수 있어요. (지금 ${have})`); }
      if (u.coins < it.price) fail(`코인이 모자라요. (${it.price}코인 필요)`);
      u.coins -= it.price;
      if (it.price) own.push(kind + ':' + it.id);
      l[kind] = it.id; // 사면 바로 꾸민다
      save();
      if (u.profile) publishCard(u);
      return { ok: true, looks: lookOf(u), coins: u.coins };
    },
    'POST /api/looks/wear': async (t, q, b) => {
      const a = needLogin(t), u = a.u, kind = String(b.kind), l = (u.looks = u.looks || {}), own = l.own || [];
      let it = (S.LOOKS[kind] || []).find(x => x.id === b.id);
      if (!it && kind === 'ti' && typeof b.id === 'string' && own.includes('ti:' + b.id)) it = { id: b.id, pass: true }; // 시즌 · 대회에서 받은 칭호
      if (!it) fail('없는 꾸미기예요.');
      if ((it.price || it.pass) && !own.includes(kind + ':' + it.id)) fail(it.pass ? '🏆 시즌 패스 · 대회 보상으로 받을 수 있어요.' : '먼저 사야 해요.');
      l[kind] = it.id;
      save();
      if (u.profile) publishCard(u);
      return { ok: true, looks: lookOf(u) };
    },
    'POST /api/profile/media': async (t, q, b) => { // 프로필 사진(av) · 배너(bn) 올리기
      const a = needLogin(t), u = a.u, slot = b.slot === 'bn' ? 'bn' : 'av', kind = ['draw', 'img', 'vid'].includes(b.kind) ? b.kind : 'img';
      if (!u.profile) fail('먼저 학교와 닉네임을 설정해 주세요.', 409);
      if (!picOk(b.d, PIC_MAX[slot])) fail('사진이 너무 크거나 잘못됐어요. 다시 골라 주세요.');
      const n = kind === 'vid' ? Math.floor(Number(b.n)) : 1, fps = Math.floor(Number(b.fps)) || 8, cols = Math.floor(Number(b.cols)) || n;
      if (!(n >= 1 && n <= 240) || !(fps >= 1 && fps <= 15) || !(cols >= 1 && cols <= n) || n / fps > 30.5) fail('동영상이 잘못됐어요. (최대 30초)');
      if (slot === 'av' && !picOk(b.th, PIC_MAX.th)) fail('작은 사진이 잘못됐어요.');
      const v = Date.now(), l = (u.looks = u.looks || {});
      if (slot === 'av') {
        await Promise.all([mergeDoc('wface/a_' + u.acc, { k: kind, d: b.d, n, fps, cols, v }), mergeDoc('wface/t_' + u.acc, { d: b.th, v })]);
        l.pv = v;
      } else {
        await mergeDoc('wface/b_' + u.acc, { k: kind, d: b.d, n, fps, cols, v });
        l.bv = v;
      }
      save();
      publishCard(u);
      return { ok: true, looks: lookOf(u) };
    },
    'POST /api/profile/clear': async (t, q, b) => { // 내 사진 지우기 (운영자·개발자는 다른 친구 것도)
      const a = needLogin(t), u = a.u, slot = b.slot === 'bn' ? 'bn' : b.slot === 'av' ? 'av' : 'all', acc = b.acc && b.acc !== u.acc ? String(b.acc) : u.acc;
      if (acc !== u.acc) {
        if (!u.role) fail('운영자만 할 수 있어요.', 403);
        if (!accOk(acc)) fail('그 친구를 찾을 수 없어요.');
        await dropMedia(acc, slot);
        await mergeDoc('wface/x_' + acc, { at: Date.now(), by: 'staff' });
        return { ok: true };
      }
      const l = (u.looks = u.looks || {});
      await dropMedia(acc, slot);
      if (slot !== 'bn') l.pv = 0;
      if (slot !== 'av') l.bv = 0;
      save();
      publishCard(u);
      return { ok: true, looks: lookOf(u) };
    },
    'GET /api/profile': async (t, q) => { // 프로필 카드 (배너 · 큰 사진 포함)
      const a = needLogin(t), u = a.u, acc = String(q.get('acc') || u.acc), self = acc === u.acc;
      if (!accOk(acc)) fail('그 친구를 찾을 수 없어요.');
      const p = self ? null : await cardOf(acc);
      if (!self && !p) fail('그 친구를 찾을 수 없어요.');
      const [av, bn, x] = await Promise.all([readDoc('wface/a_' + acc), readDoc('wface/b_' + acc), readDoc('wface/x_' + acc)]);
      let removed = false;
      if (self) {
        const l = (u.looks = u.looks || {});
        if (x.at && x.at > Math.max(l.pv || 0, l.bv || 0) && (l.pv || l.bv)) { l.pv = 0; l.bv = 0; save(); publishCard(u); removed = true; } // 신고가 많아 지워졌다
      }
      const c = self ? Object.assign(lookOf(u), { nick: u.profile ? u.profile.nickname : u.username, school: u.profile ? u.profile.school : '', yr: gradeOf(u), captures: statsOf(u).captures, solved: statsOf(u).solved, role: u.role || null }) : p;
      const sid = c.school && idByKey.has(c.school) ? idByKey.get(c.school) : -1;
      return {
        acc, me: self, nick: c.nick, sid, school: c.school ? nameOfKey(c.school) : '', yr: c.yr || 0, role: c.role || null,
        av: c.av || '😀', ti: c.ti || '', fr: c.fr || '', pv: c.pv || 0, bv: c.bv || 0, captures: c.captures || 0, solved: c.solved || 0,
        a: c.pv ? mediaOf(av) : null, b: c.bv ? mediaOf(bn) : null, removed, staff: !!u.role,
      };
    },
    'GET /api/pic': async (t, q) => { // 목록에 쓰는 작은 프로필 사진
      needLogin(t);
      const acc = String(q.get('acc') || '');
      if (!accOk(acc)) return { d: null };
      const d = await readDoc('wface/t_' + acc);
      return { d: picOk(d.d, PIC_MAX.th) ? d.d : null, v: d.v || 0 };
    },
    'POST /api/profile/report': async (t, q, b) => { // 🚨 나쁜 사진 신고 — 여러 명이 신고하면 저절로 지워진다
      const a = needLogin(t), acc = String(b.acc || ''), now = Date.now();
      if (!accOk(acc) || acc === a.u.acc) fail('그 친구를 찾을 수 없어요.');
      const p = await cardOf(acc);
      if (!p) fail('그 친구를 찾을 수 없어요.');
      if (!p.pv && !p.bv) fail('신고할 사진이 없어요.');
      const since = Math.max(p.pv || 0, p.bv || 0), path = 'wface/r_' + acc, cur = await readDoc(path);
      if (cur[local.device] > since) fail('이미 신고했어요.');
      await mergeDoc(path, { [local.device]: now });
      const n = Object.values(Object.assign(cur, { [local.device]: now })).filter(x => x > since).length;
      if (n >= S.PIC_REPORT) { await dropMedia(acc, 'all'); await mergeDoc('wface/x_' + acc, { at: now, by: 'report' }); return { ok: true, n, removed: true }; }
      return { ok: true, n };
    },
    'GET /api/capacity': async t => { // 🚪 게임에 들어와 있는 사람 수 (100명이 넘으면 못 들어온다. 운영자 · 개발자는 늘 들어온다)
      const a = needLogin(t);
      if (!cloud || !cloud.rdb) return { full: false, online: null, max: S.MAX_PLAYERS };
      const snap = await cloud.rdb.ref('presence').once('value'), now = Date.now();
      let n = 0;
      snap.forEach(c => { const v = c.val() || {}; if (c.key !== local.device && now - (v.at || 0) < 45 * 60e3) n++; });
      return { full: !a.u.role && n >= S.MAX_PLAYERS, online: n, max: S.MAX_PLAYERS, msg: S.FULL_MSG };
    },
    // ---------- 🏆 시즌 패스 ----------
    'GET /api/season': async t => {
      const a = needLogin(t), u = a.u, s = seasonOfU(u), srv = srvOf(u);
      const rewards = Array.from({ length: S.PASS_MAX }, (_, i) => { const r = S.passReward(i + 1, season); return { lv: i + 1, text: S.passText(r), look: r.look || null, got: s.claimed.includes(i + 1) }; });
      const missions = S.SEASON_MISSIONS.map(m => ({ id: m.id, icon: m.icon, text: m.text, n: m.n, p: Math.min(m.n, s.st[m.key] || 0), xp: m.xp, done: s.sm.includes(m.id) }));
      if (season > 1) await finishSeason(season - 1, srv).catch(() => {});
      const hof = await readDoc('meta/hof_' + LV);
      const fame = Object.entries(hof).filter(([k]) => k.endsWith('_g' + srv)).map(([k, x]) => ({ n: +k.slice(1, k.indexOf('_')), s: x.s || [], p: x.p || [] })).sort((x, y) => y.n - x.n);
      const note = u.rankNote || null;
      if (note) { delete u.rankNote; save(); }
      return Object.assign(seasonView(u), { rewards, missions, fame, note, srvName: S.serverName(srv), coins: walletOf(u).coins });
    },
    'POST /api/season/claim': async (t, q, b) => {
      const u = walletOf(needLogin(t).u), s = seasonOfU(u), lv = passLv(s);
      const list = b.lv === 'all' ? Array.from({ length: lv }, (_, i) => i + 1).filter(x => !s.claimed.includes(x)) : [Math.floor(Number(b.lv))];
      if (!list.length) fail('받을 보상이 없어요.');
      for (const x of list) { if (!(x >= 1 && x <= lv)) fail('아직 그 단계에 오르지 못했어요.'); if (s.claimed.includes(x)) fail('이미 받았어요.'); }
      const got = [];
      for (const x of list) { const r = S.passReward(x, season); giveReward(u, r); s.claimed.push(x); got.push(S.passText(r)); }
      save();
      if (u.profile) publishCard(u);
      return Object.assign(seasonView(u), { ok: true, got, coins: u.coins, items: u.items, looks: lookOf(u) });
    },
    'POST /api/season/mission': async (t, q, b) => {
      const u = needLogin(t).u, s = seasonOfU(u), m = S.SEASON_MISSIONS.find(x => x.id === b.id);
      if (!m || s.sm.includes(m.id)) fail('이미 받았거나 없는 미션이에요.');
      if ((s.st[m.key] || 0) < m.n) fail('아직 미션을 다 하지 못했어요.');
      s.sm.push(m.id);
      s.xp += m.xp;
      save();
      return Object.assign(seasonView(u), { ok: true, xp: m.xp });
    },
    // ---------- ⚔️ 랭크 배틀 ----------
    'GET /api/rank': async t => {
      const a = await needPlayer(t), u = a.u, r = rankOf(u), now = Date.now();
      const list = (await playersOf(a.srv)).filter(p => p.rs === season && (p.rw || p.rl || p.rp)).map(p => (p.acc === u.acc ? Object.assign(p, { rp: r.rp, rw: r.w }) : p)).sort((x, y) => y.rp - x.rp || y.rw - x.rw);
      rkArk = new Set(list.slice(0, S.ARK_TOP).filter(p => p.rp >= S.NEM_RP).map(p => p.acc));
      const place = list.findIndex(p => p.acc === u.acc) + 1;
      const top = list.slice(0, 50).map((p, i) => ({ acc: p.acc, nick: p.nick, sc: schoolById(p.sid).name, rp: p.rp, w: p.rw || 0, tier: S.tierOf(p.rp, i + 1), me: p.acc === u.acc, av: p.av, pv: p.pv, ti: p.ti, fr: p.fr }));
      const live = Object.entries(cloud ? await readDoc(`wace/l${a.srv}`) : {}).filter(([, v]) => v && now - v.at < 5 * 60e3).map(([id, v]) => ({ id, a: v.a, b: v.b, ta: S.tierOf(v.ra), tb: S.tierOf(v.rb) }));
      const note = u.rankNote || null;
      if (note) { delete u.rankNote; save(); }
      return { me: { rp: r.rp, w: r.w, l: r.l, streak: r.streak || 0, best: r.best || 0, place, tier: S.tierOf(r.rp, place) }, top, live, total: list.length, online: !!cloud, note, season };
    },
    'POST /api/rank/queue': async (t, q, b) => {
      const a = await needPlayer(t), u = a.u;
      await rkStop();
      const probs = (Array.isArray(b.probs) ? b.probs : []).slice(0, S.RANK_N).map(cleanProblem);
      if (probs.length < S.RANK_N) fail('문제를 만들지 못했어요. 다시 해 주세요.');
      const card = rkCard(u), now = Date.now(), me = (rk = { acc: u.acc, srv: a.srv, card, probs, since: now, unsubs: [], inQueue: !!cloud, g: a.grade, sem: u.profile.semester || 1 });
      if (cloud) {
        await mergeDoc(`wace/q${a.srv}`, { [u.acc]: Object.assign({ at: now, m: '', g: a.grade, sem: me.sem }, card) });
        me.unsubs.push(sub(`wace/q${a.srv}`, d => { if (rk === me) { me.q = d; rkScan(d); } }));
        me.timer = setInterval(() => { // 아직 기다리는 중이라는 표시 + 다시 찾아보기
          if (rk !== me || me.match) return;
          if (cloud.rdb) cloud.rdb.ref(`wace/q${a.srv}/${u.acc}`).update({ at: Date.now() }).catch(() => {});
          if (me.q) rkScan(me.q);
        }, 5000);
      }
      rkEmit('wait', { since: now, online: !!cloud });
      return { ok: true, online: !!cloud };
    },
    'POST /api/rank/bot': async t => { // 🤖 기다려도 상대가 없으면 연습 로봇과 (점수는 조금만)
      const a = await needPlayer(t), me = rk;
      if (!me || me.acc !== a.u.acc || me.match) fail('먼저 대결 찾기를 눌러 주세요.');
      (me.unsubs || []).forEach(f => f()); me.unsubs = [];
      clearInterval(me.timer);
      if (me.inQueue && cloud) { me.inQueue = false; await mergeDoc(`wace/q${me.srv}`, { [me.acc]: null }).catch(() => {}); }
      me.bot = true; me.match = 'bot' + rand(4);
      const m = { id: me.match, a: me.card, b: { acc: 'bot', nick: '연습 로봇', rp: me.card.rp, av: '🤖', pv: 0, sc: '로봇 학교' }, probs: me.probs, sa: 0, sb: 0, win: '' };
      rkUpdate(me, m);
      const pace = S.botPace(me.card.rp) * 1000;
      let at = me.t0;
      me.botAt = me.probs.map(() => (at += pace * (0.7 + Math.random() * 0.6)));
      me.timer = setInterval(() => rkTick(me), 300);
      return { ok: true };
    },
    'POST /api/rank/progress': async (t, q, b) => {
      const a = needLogin(t), me = rk;
      if (!me || !me.m || me.acc !== a.u.acc || me.ended) return { ok: false };
      const n = Math.max(0, Math.min(S.RANK_N, Math.floor(Number(b.n) || 0))), side = rkSide(me, me.m);
      if (me.bot) { me.m['s' + side] = n; if (n >= S.RANK_N) await rkSetWin(me, me.acc); else rkUpdate(me, me.m); return { ok: true }; }
      await mergeDoc('wace/m_' + me.m.id, { ['s' + side]: n });
      if (n >= S.RANK_N) await rkSetWin(me, me.acc);
      return { ok: true };
    },
    'POST /api/rank/quit': async t => { // 기다리기 취소, 또는 대결 중이면 기권 (진 것으로)
      const a = needLogin(t), me = rk;
      if (!me || me.acc !== a.u.acc) return { ok: true };
      if (me.m && !me.m.win && !me.ended) { await rkSetWin(me, me.bot ? 'bot' : rkSide(me, me.m) === 'a' ? me.m.b.acc : me.m.a.acc); return { ok: true, quit: true }; }
      await rkStop();
      return { ok: true };
    },
    'POST /api/rank/watch': async (t, q, b) => { // 👀 다른 친구 대결 구경
      needLogin(t);
      if (!cloud) fail('온라인일 때만 구경할 수 있어요.');
      rkWatchStop();
      const id = String(b.id || '');
      if (!/^[0-9a-f]{6,20}$/.test(id)) fail('그 대결을 찾을 수 없어요.');
      rkWatch = sub('wace/m_' + id, m => { if (m && m.id) emit(null, { t: 'rankwatch', m: { id: m.id, a: m.a, b: m.b, sa: m.sa || 0, sb: m.sb || 0, win: m.win || '' } }); });
      return { ok: true };
    },
    'POST /api/rank/unwatch': async () => { rkWatchStop(); return { ok: true }; },
    // ---------- 🏟️ 전국 학교 대항전 ----------
    'GET /api/event': async t => {
      const a = await needPlayer(t), rt = a.rt, ev = S.eventOf(), now = Date.now(), lm = await readDoc(lmPath(rt.g));
      const marks = [...lmCells].map(([c, [id, name]]) => {
        const o = rt.owner[c], x = lm['c' + c], since = o >= 0 && x && x.k === keyOfId(o) ? x.at : null;
        return { cell: c, id, name, sid: o, school: o >= 0 ? schoolById(o).name : '', since, mine: o === a.sid };
      });
      const pts = {};
      if (ev.on) {
        const d = await readDoc(evPath(ev.id));
        for (const [k, v] of Object.entries(d)) if (k.includes('|')) pts[k] = v;
        for (const m of marks) if (m.sid >= 0 && m.since) { const k = keyOfId(m.sid); pts[k] = (pts[k] || 0) + Math.max(0, Math.floor((now - Math.max(m.since, ev.start)) / 60000)); }
      }
      const mine = keyOfId(a.sid), all = Object.entries(pts).sort((x, y) => y[1] - x[1]);
      const board = all.slice(0, 10).map(([k, p]) => ({ name: k.split('|')[2] || '?', pts: p, me: k === mine }));
      return { ev, now, marks, board, myPts: pts[mine] || 0, myPlace: all.findIndex(([k]) => k === mine) + 1, last: await eventLast(a, rt) };
    },
    'POST /api/event/claim': async t => {
      const a = await needPlayer(t), last = await eventLast(a, a.rt), u = walletOf(a.u);
      if (!last.place || last.place > 3) fail('지난 대항전에서 우리 학교가 3등 안에 들지 못했어요.');
      u.evClaim = u.evClaim || {};
      if (u.evClaim[last.id]) fail('이미 받았어요.');
      u.evClaim[last.id] = 1;
      const got = S.EVENT_PRIZE[last.place - 1];
      earn(u, got);
      if (last.place === 1) giveOwn(u, 'ti', '대항전 우승');
      save();
      return { ok: true, got, place: last.place, coins: u.coins };
    },
    // ---------- 💰 곳간 · 🏗️ 경제 건물 올리기 · 🏪 장터 ----------
    'GET /api/eco': async t => ecoOf(await needPlayer(t)),
    'POST /api/eco/collect': async t => {
      const a = await needPlayer(t), e = ecoOf(a), u = walletOf(a.u);
      if (e.stored < 1 && e.storedXp < 1) fail('아직 곳간이 비어 있어요. 조금 뒤에 와요!');
      earn(u, e.stored);
      addXP(u, e.storedXp + (e.hours >= 1 ? S.XP.collect : 0));
      u.eco.at = Date.now();
      save();
      return Object.assign(ecoOf(a), { ok: true, got: e.stored, gotXp: e.storedXp, coins: u.coins });
    },
    'POST /api/build/up': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, u = walletOf(a.u), cell = targetCell(b), x = buildView(rt)[cell], def = x && S.ECO_BUILDINGS.find(d => d.id === x[0]);
      if (!def || x[1] !== a.sid) fail('우리 학교 경제 건물만 단계를 올릴 수 있어요.');
      if (def.id !== 'library' && x[4] !== u.acc) fail('내가 지은 건물만 올릴 수 있어요.');
      const lv = x[3] || 1;
      if (lv >= 3) fail('이미 가장 높은 3단계예요.');
      const price = def.up[lv - 1];
      if (u.coins < price) fail(`코인이 모자라요. (${price}코인 필요)`);
      u.coins -= price;
      track(u, 'items', 1);
      save();
      rt.builds[cell] = [x[0], x[1], x[2], lv + 1, x[4] || ''];
      await mergeDoc(`${WP}/g${rt.g}/b/main`, { ['c' + cell]: rt.builds[cell] });
      emit(rt.g, { t: 'builds', items: buildView(rt) });
      return { ok: true, builds: buildView(rt), coins: u.coins, items: u.items, lv: lv + 1 };
    },
    'GET /api/market': async t => {
      const a = await needPlayer(t), u = walletOf(a.u), c = await mkCollect(u, a.srv), d = await readDoc(mkPath(a.srv)), now = Date.now();
      const all = mkList(d), live = all.filter(x => !x.buyer && now - x.at < S.MARKET_DAYS * 864e5);
      return { list: live.filter(x => x.acc !== u.acc).sort((x, y) => x.price - y.price).slice(0, 60), mine: all.filter(x => x.acc === u.acc), got: c.got, back: c.back, coins: u.coins, items: u.items };
    },
    'POST /api/market/sell': async (t, q, b) => {
      const a = await needPlayer(t), u = walletOf(a.u), item = String(b.item || ''), price = Math.floor(Number(b.price));
      if (!S.ITEM_NAME[item]) fail('팔 수 없는 물건이에요.');
      if (!(price >= 1 && price <= 999)) fail('값은 1~999코인으로 정해 주세요.');
      if ((u.items[item] || 0) < 1) fail('그 물건이 없어요.');
      const d = await readDoc(mkPath(a.srv));
      if (mkList(d).filter(x => x.acc === u.acc).length >= S.MARKET_MAX) fail(`장터에는 한 번에 ${S.MARKET_MAX}개까지 올릴 수 있어요.`);
      u.items[item]--;
      save();
      const x = { id: rand(5), acc: u.acc, nick: u.profile.nickname, item, price, at: Date.now(), buyer: '' };
      await mergeDoc(mkPath(a.srv), { ['i_' + x.id]: x });
      return { ok: true, items: u.items, coins: u.coins };
    },
    'POST /api/market/buy': async (t, q, b) => {
      const a = await needPlayer(t), u = walletOf(a.u), id = String(b.id || ''), x = (await readDoc(mkPath(a.srv)))['i_' + id];
      if (!x || x.buyer) fail('이미 팔렸거나 없는 물건이에요.');
      if (x.acc === u.acc) fail('내 물건은 살 수 없어요.');
      if (u.coins < x.price) fail(`코인이 모자라요. (${x.price}코인 필요)`);
      if (!(await mkTake(a.srv, id, u.acc))) fail('방금 다른 친구가 샀어요!');
      u.coins -= x.price;
      u.items[x.item] = (u.items[x.item] || 0) + 1;
      sst(u, 'trades', 1); addXP(u, S.XP.trade);
      save();
      return { ok: true, coins: u.coins, items: u.items, item: x.item };
    },
    'POST /api/market/cancel': async (t, q, b) => {
      const a = await needPlayer(t), u = walletOf(a.u), id = String(b.id || ''), x = (await readDoc(mkPath(a.srv)))['i_' + id];
      if (!x || x.acc !== u.acc) fail('내 물건만 내릴 수 있어요.');
      if (x.buyer) fail('이미 팔렸어요! 장터를 다시 열면 코인을 받아요.');
      await mergeDoc(mkPath(a.srv), { ['i_' + id]: null });
      u.items[x.item] = (u.items[x.item] || 0) + 1;
      save();
      return { ok: true, items: u.items, coins: u.coins };
    },
    // ---------- 🗺️ 모험 모드 · 📊 실력 지도 ----------
    'GET /api/adv': async t => ({ prog: needLogin(t).u.adv || {} }),
    'POST /api/adv/clear': async (t, q, b) => {
      const a = await needPlayer(t), u = walletOf(a.u), id = String(b.stage || ''), m = id.match(/^(\d)-(\d)$/);
      if (!m || +m[1] >= S.ADV.length || +m[2] > 3) fail('없는 스테이지예요.');
      const r = +m[1], s = +m[2], prog = (u.adv = u.adv || {}), before = prog[id] || 0;
      const prev = s > 0 ? `${r}-${s - 1}` : r > 0 ? `${r - 1}-3` : null;
      if (prev && !prog[prev]) fail('앞 스테이지를 먼저 깨요.');
      const stars = Math.max(1, Math.min(3, Math.floor(Number(b.stars) || 1))), first = !before;
      const solved = Math.max(0, Math.min(s === 3 ? S.ADV_BOSS_N : S.ADV_N, Math.floor(Number(b.solved) || 0)));
      const got = S.advReward(s, first, stars === 3 && before < 3);
      prog[id] = Math.max(before, stars);
      const st = statsOf(u);
      st.solved += solved; noteStreak(u, b.streak); track(u, 'solved', solved);
      earn(u, got);
      if (first) { sst(u, 'stages', 1); addXP(u, s === 3 ? S.XP.boss : S.XP.stage); }
      save();
      publishCard(u);
      return { ok: true, got, first, stars: prog[id], prog, coins: u.coins, stats: st, badges: newBadges(u), mission: missionView(u).ready };
    },
    'POST /api/topics': async (t, q, b) => { // 단원마다 맞힌 수 / 푼 수 (실력 지도 · 선생님 화면)
      const u = needLogin(t).u, tp = (u.topic = u.topic || {});
      for (const [k, v] of Object.entries(b.s || {}).slice(0, 30)) {
        if (k.length > 20 || !Array.isArray(v)) continue;
        const ok = Math.max(0, Math.min(60, Math.floor(v[0]) || 0)), n = Math.max(ok, Math.min(60, Math.floor(v[1]) || 0));
        if (!n) continue;
        const cur = tp[k] || [0, 0];
        tp[k] = [cur[0] + ok, cur[1] + n];
        if (tp[k][1] > 400) tp[k] = [Math.round(tp[k][0] / 2), Math.round(tp[k][1] / 2)]; // 최근 기록이 더 중요하게
      }
      save();
      publishClass(u);
      return { ok: true, topic: tp };
    },
    'GET /api/skill': async t => ({ topic: needLogin(t).u.topic || {} }),
    // ---------- 👾 보스 레이드 ----------
    'GET /api/raid': async t => {
      const a = await needPlayer(t), week = S.raidWeek(), d = await readDoc(`${WP}/g${a.srv}/raid/w${week}`), hp = S.RAID_HP[LV];
      const top = Object.keys(d).filter(k => k.startsWith('p_')).map(k => ({ nick: d['n_' + k.slice(2)] || '?', n: d[k], me: k.slice(2) === a.u.acc })).sort((x, y) => y.n - x.n);
      return { week, boss: S.bossOf(week), hp, dmg: Math.min(hp, d.dmg || 0), top: top.slice(0, 5), players: top.length, mine: d['p_' + a.u.acc] || 0, claimed: !!(a.u.raidPaid || {})[week], ends: S.raidEnds(week), now: Date.now() };
    },
    'POST /api/raid/hit': async (t, q, b) => { // 맞힌 문제 수만큼 데미지 (연습처럼 코인도)
      const a = await needPlayer(t), n = Math.max(0, Math.min(S.RAID_SET * 2, Math.floor(Number(b.n) || 0))), st = statsOf(a.u), week = S.raidWeek(), path = `${WP}/g${a.srv}/raid/w${week}`;
      if (!n) fail('맞힌 문제가 없어요.');
      st.solved += n; noteStreak(a.u, b.streak); track(a.u, 'solved', n); earn(a.u, n);
      a.u.raidHits = (a.u.raidHits || 0) + n;
      save();
      await Promise.all([bump(path, 'dmg', n), bump(path, 'p_' + a.u.acc, n), mergeDoc(path, { ['n_' + a.u.acc]: a.u.profile.nickname })]);
      publishCard(a.u);
      const d = await readDoc(path), hp = S.RAID_HP[LV];
      if ((d.dmg || 0) >= hp && (d.dmg || 0) - n < hp) pushFeed(a.rt, { t: 'ev', ev: { kind: 'raid', by: a.u.profile.nickname, boss: S.bossOf(week) } }); // 마지막 한 방
      return { ok: true, dmg: Math.min(hp, d.dmg || 0), hp, mine: d['p_' + a.u.acc] || 0, stats: st, coins: a.u.coins, got: n, badges: newBadges(a.u), mission: missionView(a.u).ready };
    },
    'POST /api/raid/claim': async t => { // 쓰러뜨렸으면 공격한 사람마다 보상 (한 주에 한 번)
      const a = await needPlayer(t), u = walletOf(a.u), week = S.raidWeek(), d = await readDoc(`${WP}/g${a.srv}/raid/w${week}`);
      if ((d.dmg || 0) < S.RAID_HP[LV]) fail('아직 보스가 살아 있어요! 친구들과 함께 공격해요.');
      if (!d['p_' + u.acc]) fail('보스를 한 번도 공격하지 않았어요. 다음 보스는 꼭 함께해요!');
      u.raidPaid = u.raidPaid || {};
      if (u.raidPaid[week]) fail('이번 주 보상은 이미 받았어요.');
      u.raidPaid[week] = 1;
      const item = ['shield', 'bomb', 'scope'][Math.floor(Math.random() * 3)];
      earn(u, S.RAID_WIN); u.items[item]++;
      u.raidWins = (u.raidWins || 0) + 1;
      save();
      return { ok: true, got: S.RAID_WIN, item, coins: u.coins, items: u.items };
    },
    'POST /api/build': async (t, q, b) => { // 🏗️ 우리 땅에 건물 짓기
      const a = await needPlayer(t), rt = a.rt, u = walletOf(a.u), cell = targetCell(b), def = S.BUILDINGS.find(x => x.id === b.kind) || S.ECO_BUILDINGS.find(x => x.id === b.kind);
      if (!def) fail('없는 건물이에요.');
      if (rt.owner[cell] !== a.sid || rt.homeCell[cell] >= 0) fail('우리 학교 땅(본부 말고)에만 지을 수 있어요.');
      const view = buildView(rt);
      if (view[cell]) fail('이미 건물이 있어요. 허물고 다시 지어요.');
      if (Object.values(view).filter(x => x[1] === a.sid).length >= S.BUILD_MAX) fail(`한 학교에 건물은 ${S.BUILD_MAX}개까지예요.`);
      if (def.max && Object.values(view).filter(x => x[0] === def.id && x[1] === a.sid && x[4] === u.acc).length >= def.max) fail(`${def.icon} ${def.name}은 한 사람이 ${def.max}개까지 지을 수 있어요.`);
      if (def.school && Object.values(view).filter(x => x[0] === def.id && x[1] === a.sid).length >= def.school) fail(`${def.icon} ${def.name}은 한 학교에 ${def.school}개까지예요.`);
      if (u.coins < def.price) fail(`코인이 모자라요. (${def.price}코인 필요)`);
      u.coins -= def.price;
      track(u, 'items', 1);
      save();
      rt.builds[cell] = def.eco ? [def.id, a.sid, Date.now(), 1, u.acc] : [def.id, a.sid, Date.now()]; // 경제 건물: 단계 · 지은 사람
      await mergeDoc(`${WP}/g${rt.g}/b/main`, { ['c' + cell]: rt.builds[cell] });
      emit(rt.g, { t: 'builds', items: buildView(rt) });
      pushFeed(rt, { t: 'ev', ev: { kind: 'build', by: a.u.profile.nickname, role: a.u.role || null, sid: a.sid, b: def.id, cell } });
      return { ok: true, builds: buildView(rt), coins: u.coins, items: u.items, mission: missionView(u).ready };
    },
    'POST /api/build/remove': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, cell = targetCell(b), x = buildView(rt)[cell];
      if (!x || x[1] !== a.sid) fail('우리 학교 건물만 허물 수 있어요.');
      delete rt.builds[cell];
      await mergeDoc(`${WP}/g${rt.g}/b/main`, { ['c' + cell]: null });
      emit(rt.g, { t: 'builds', items: buildView(rt) });
      return { ok: true, builds: buildView(rt) };
    },
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
      if (!me || (g != null && srvOf(me.u) !== g)) return; // g: 서버 번호 (null 이면 모든 서버에게)
      if (typeof onlySid === 'function' ? !onlySid(me.u) : onlySid != null && profileSchool(me.u) !== onlySid) return;
      handler(msg);
    };
    return a ? () => { emit = () => {}; listenFn = null; } : () => {};
  }

  window.MLEBackend = { init, api, listen, isShared, gone: () => Object.keys(deleted) }; // gone: 삭제된 학교 키 (학교 고르기 화면이 늘 최신으로)
})();
