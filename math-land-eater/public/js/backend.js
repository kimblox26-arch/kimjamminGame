/* 매뜨 땅먹 — 서버 없이 브라우저 안에서 돌아가는 게임 서버 (폰 브라우저 / claude.ai 페이지용)
 * server.js 와 같은 API 를 흉내 낸다.
 *  - 계정·기록·오답 노트: 이 기기(localStorage)에 저장
 *  - 땅·소식·채팅·친구 순위: claude.ai 의 공유 저장소(db)를 쓸 수 있으면 같은 링크의 친구들과 함께,
 *    아니면 이 기기 안에서만 */
(function () {
  'use strict';
  const S = window.MLE;
  const MAX_DEF = 99, MAX_DEF_STEP = 20, CHUNK = 2048, OFFER_HOURS = 48;
  // 운영자·개발자 계정 (비밀번호는 SHA-256 으로만 적어 둔다)
  const ROLES = { 'game-admin': ['admin', '7371439df8022882e6ea2877671f337a6886350bb33a90bd3f724eee7ad96ac7'], 'game-developer': ['dev', 'fcda475b1c997a1f4f065359003a8357cc888f8a001cd253de9405c633c845bf'] };

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
  let cloud = null; // { db, room }
  // 페이지가 열리자마자 연결을 시작하고, 3.5초 안에 안 되면(로그인 안 한 사람 등) 혼자 하기
  const cloudReady = (async () => {
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
  let M = null, BASE = [], WP = 'w', MAPWP = 'w', epoch = 0; // WP: 지금 쓰는 땅 기록 자리 (서버 초기화마다 새 자리)
  async function init(m, g) { // g: 화면 쪽이 계산한 이웃(nb)과 칸 위치(sx, sy)
    M = { n: m.n, nb: g.nbOf, sx: g.sx, sy: g.sy }; // nb: 칸 → 이웃 칸들 (함수)
    // 지도가 바뀌면 땅 기록은 새로 시작한다 (칸 번호가 달라지니까)
    WP = MAPWP = 'w' + m.hash;
    if (local.mapHash !== m.hash) { local.mapHash = m.hash; local.worlds = {}; local.custom.forEach(c => { c.homes = {}; }); save(); }
    M.districts = m.districts.map(([sido, sigungu, x, y]) => ({ sido, sigungu, x, y }));
    BASE = m.schools.map(([name, sido, sigungu, url, dong], i) => ({ name, sido, sigungu, dong: dong || '', url: url || '', cell: i }));
    await connectCloud();
    if (cloud) {
      await loadCustom();
      try { // 개발자가 서버를 초기화하면 모두가 새 자리에서 처음부터 시작한다
        const r = await cloud.db.doc('meta/reset').get();
        epoch = r.exists ? r.data().epoch || 0 : 0;
        WP = MAPWP + (epoch ? 'r' + epoch : '');
        cloud.db.doc('meta/reset').onSnapshot(snap => { const e = snap.exists ? snap.data().epoch || 0 : 0; if (e !== epoch) startOver(e, snap.data().by); }, () => {});
      } catch { /* 초기화 기록이 없으면 그대로 */ }
    }
    indexSchools();
  }
  // 서버 초기화: 학년마다 들고 있던 땅을 버리고 처음부터 (화면에는 다시 불러오라고 알린다)
  function startOver(e, by) {
    epoch = e;
    WP = MAPWP + (epoch ? 'r' + epoch : '');
    for (const [g, rt] of Object.entries(worlds)) {
      (rt.unsubs || []).forEach(u => { try { u(); } catch { /* 이미 끊김 */ } });
      delete worlds[g];
      emit(+g, { t: 'upd', reload: true, ev: { kind: 'admin', by: by || '개발자', text: '🧨 서버를 처음부터 다시 시작했어요! 모든 땅이 처음 상태예요.' } });
    }
  }
  const isShared = () => !!cloud;

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
    const n = M.n, rt = { g, owner: new Int32Array(n).fill(-1), def: new Int32Array(n), home: [], homeCell: new Int32Array(n).fill(-1), feed: [], seen: new Set(), online: 1, offers: [] };
    BASE.forEach((s, i) => setHome(rt, i, s.cell));
    if (cloud) {
      const snap = await cloud.db.collection(`${WP}/g${g}/c`).get();
      snap.docs.forEach(d => { for (const [k, v] of Object.entries(d.data() || {})) setCell(rt, +k, v[0], v[1]); });
      applyCustomHomes(rt, g);
      const f = await cloud.db.doc(`${WP}/g${g}/f/main`).get();
      (f.exists ? f.data().items || [] : []).forEach(it => { rt.seen.add(it.id); rt.feed.push(it); });
      const o = await cloud.db.doc(`${WP}/g${g}/o/main`).get();
      rt.offers = o.exists ? o.data().items || [] : [];
      if (wp !== WP) return getWorld(g); // 불러오는 사이 서버가 초기화됐다
      subscribe(rt);
    } else {
      const w = local.worlds[g] || (local.worlds[g] = { cells: {} });
      for (const [k, v] of Object.entries(w.cells)) setCell(rt, +k, v[0], v[1]);
      rt.offers = w.offers || [];
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
    for (const [i, o, d] of cells) { const k = Math.floor(i / CHUNK); if (!byChunk.has(k)) byChunk.set(k, {}); byChunk.get(k)[i] = [o, d]; }
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
    save();
    return { days: st.days, streak: st.dayStreak };
  }
  function newBadges(u) {
    const st = statsOf(u), have = new Set(u.badges = u.badges || []), out = [];
    for (const b of S.BADGES) if (!have.has(b.id) && (st[b.key] || 0) >= b.n) { u.badges.push(b.id); out.push(b.id); }
    if (out.length) save();
    return out;
  }
  const noteStreak = (u, v) => { const st = statsOf(u); st.bestStreak = Math.max(st.bestStreak, Math.min(1000, Math.floor(Number(v) || 0))); };
  function publicUser(u) {
    const sid = profileSchool(u);
    return {
      username: u.username, birthYear: u.birthYear, grade: gradeOf(u), stats: statsOf(u), badges: u.badges || [], role: u.role || null,
      profile: sid >= 0 ? { schoolId: sid, semester: u.profile.semester, nickname: u.profile.nickname } : null,
    };
  }
  // 친구 순위·학교 친구 목록에 보이는 카드 (비밀번호 같은 건 절대 안 올린다)
  async function publishCard(u) {
    if (!cloud || !u.profile) return;
    const st = statsOf(u);
    try { await cloud.db.doc('players/' + u.acc).set({ nick: u.profile.nickname, school: u.profile.school, grade: gradeOf(u), captures: st.captures, solved: st.solved, at: Date.now() }); } catch { /* 다음에 다시 */ }
  }
  async function playersOf(grade) {
    if (!cloud) return Object.values(local.users).filter(u => profileSchool(u) >= 0 && gradeOf(u) === grade).map(u => ({ acc: u.acc, nick: u.profile.nickname, sid: profileSchool(u), captures: statsOf(u).captures, solved: statsOf(u).solved }));
    const snap = await cloud.db.collection('players').where('grade', '==', grade).limit(1000).get();
    return snap.docs.map(d => { const p = d.data(); return { acc: d.id, nick: p.nick, sid: idByKey.has(p.school) ? idByKey.get(p.school) : -1, captures: p.captures || 0, solved: p.solved || 0 }; }).filter(p => p.sid >= 0);
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
  function needLogin(token) { const a = getAuth(token); if (!a) fail('로그인이 필요해요.', 401); return a; }
  async function needPlayer(token) {
    const a = needLogin(token), g = gradeOf(a.u);
    if (g < 1 || g > 6) fail('초등학생(1~6학년)만 플레이할 수 있어요.', 403);
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
      if (!u || (await hashPw(String(b.password || ''), u.salt)) !== u.hash) fail('아이디 또는 비밀번호가 틀렸어요. (계정은 가입한 기기에만 있어요)');
      return newSession(key);
    },
    'POST /api/logout': async t => { if (getAuth(t)) { delete local.sessions[t]; save(); } return { ok: true }; },
    'GET /api/me': async t => { const a = needLogin(t); return { user: publicUser(a.u), debug: !!a.s.debug, shared: isShared() }; },
    'GET /api/schools': async () => ({ custom: publicCustom() }),
    'POST /api/profile': async (t, q, b) => {
      const a = needLogin(t), semester = Number(b.semester);
      if (semester !== 1 && semester !== 2) fail('학기를 골라 주세요.');
      let nickname = String(b.nickname || '').replace(/[\u0000-\u001f<>]/g, '').trim();
      if (a.u.role) nickname = S.ROLE_NICK[a.u.role];
      else if (S.RESERVED_NICK.test(nickname.replace(/\s+/g, ''))) fail('운영자·개발자 닉네임은 쓸 수 없어요. 다른 닉네임을 써 주세요.');
      if (nickname.length < 1 || nickname.length > 10) fail('닉네임은 1~10자로 써 주세요.');
      let schoolId;
      if (b.custom) {
        const di = Number(b.custom.di), d = Number.isInteger(di) ? M.districts[di] : null;
        if (!d) fail('학교가 있는 지역을 골라 주세요.');
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
      }
      a.u.profile = { school: schoolKey(schoolById(schoolId)), semester, nickname };
      save();
      publishCard(a.u);
      return { user: publicUser(a.u), custom: publicCustom() };
    },
    'GET /api/world': async t => {
      const a = await needPlayer(t), rt = a.rt, def = [], home = [];
      rt.def.forEach((d, i) => { if (d > 0) def.push([i, d]); });
      for (let i = 0; i < schoolCount(); i++) home.push(rt.home[i] != null ? rt.home[i] : -1);
      const chat = rt.feed.filter(m => m.t === 'chat' && (m.ch === 'all' || m.sid === a.sid)).map(m => Object.assign({}, m, { t: 'chat' }));
      const res = { grade: a.grade, owner: Array.from(rt.owner), def, home, custom: publicCustom(), online: rt.online, chat, offers: liveOffers(rt), attend: attend(a.u), badges: newBadges(a.u), stats: statsOf(a.u), shared: isShared() };
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
      const members = (await playersOf(a.grade)).filter(p => p.sid === id).map(p => ({ nick: p.nick, captures: p.captures, solved: p.solved, online: p.acc === a.u.acc, me: p.acc === a.u.acc }));
      members.sort((x, y) => y.online - x.online || y.captures - x.captures);
      const sc = schoolById(id);
      return { id, name: sc.name, sido: sc.sido, sigungu: sc.sigungu, dong: sc.dong || '', url: sc.url || '', land, rank: land ? rank : null, def, members: members.slice(0, 30), memberCount: members.length };
    },
    'GET /api/players': async t => {
      const a = await needPlayer(t), list = (await playersOf(a.grade)).map(p => Object.assign(p, { me: p.acc === a.u.acc }));
      list.sort((x, y) => y.captures - x.captures || y.solved - x.solved);
      return { top: list.slice(0, 10), rank: list.findIndex(p => p.me) + 1, total: list.length };
    },
    'POST /api/capture': async (t, q, b) => {
      const a = await needPlayer(t), rt = a.rt, sid = a.sid, cell = targetCell(b), prev = rt.owner[cell];
      if (prev === sid) fail('이미 우리 학교 땅이에요.');
      if (rt.homeCell[cell] >= 0) fail('학교 본부는 뺏을 수 없어요.');
      const cost = S.captureCost({ owner: rt.owner, def: rt.def, nb: M.nb, sid, cell, grade: a.grade });
      if (cost.error) fail(cost.error);
      const required = cost.cost;
      const st = statsOf(a.u);
      if (b.cheat) { if (!a.s.debug) fail('버그 창이 잠겨 있어요.', 403); }
      else {
        const solved = Number(b.solved) || 0;
        if (solved < required) return { need: required - solved, required };
        st.solved += required;
        noteStreak(a.u, b.streak);
      }
      st.captures++;
      if (prev >= 0) st.steals++;
      setCell(rt, cell, sid, 0);
      save();
      const cells = [[cell, sid, 0]], ev = { kind: 'capture', by: a.u.profile.nickname, sid, prev, cell, far: !!cost.far, escape: !!cost.escape };
      persist(rt, async () => { await writeCells(rt, cells); await pushFeed(rt, { t: 'ev', ev }); });
      publishCard(a.u);
      return { ok: true, cells, stats: st, badges: newBadges(a.u) };
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
      else { st.solved += amount; noteStreak(a.u, b.streak); }
      st.defends += amount;
      setCell(rt, cell, sid, Math.min(MAX_DEF, rt.def[cell] + amount));
      save();
      const cells = [[cell, sid, rt.def[cell]]];
      const ev = { kind: 'defend', by: a.u.profile.nickname, sid, amount, cell };
      persist(rt, async () => { await writeCells(rt, cells); await pushFeed(rt, { t: 'ev', ev }); });
      publishCard(a.u);
      return { ok: true, cells, stats: st, badges: newBadges(a.u) };
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
      if (b.act === 'grade') {
        const g = Number(b.grade);
        if (!Number.isInteger(g) || g < 1 || g > 6) fail('학년을 골라 주세요.');
        u.viewGrade = g;
        save();
        return { ok: true, user: publicUser(u) };
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
      const a = await needPlayer(t), st = statsOf(a.u);
      st.solved += Math.max(0, Math.min(50, Math.floor(Number(b.solved) || 0)));
      noteStreak(a.u, b.streak);
      save();
      publishCard(a.u);
      return { stats: st, badges: newBadges(a.u) };
    },
    'POST /api/chat': async (t, q, b) => {
      const a = await needPlayer(t), m = Number(b.m), ch = b.ch === 'school' ? 'school' : 'all', now = Date.now();
      if (!Number.isInteger(m) || !S.CHAT[m]) fail('보낼 말을 골라 주세요.');
      if (now - (a.s.lastChat || 0) < 2500) fail('조금 천천히 보내 주세요.');
      a.s.lastChat = now;
      await pushFeed(a.rt, { t: 'chat', ch, sid: a.sid, by: a.u.profile.nickname, m });
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
      return e instanceof HttpError ? { error: e.message, code: e.code } : { error: '오류가 났어요. 다시 해 주세요.', code: 500 };
    }
  }
  // 실시간 소식: 학교 채팅은 같은 학교만
  function listen(token, handler) {
    const a = getAuth(token);
    emit = (g, msg, onlySid) => {
      const me = getAuth(token);
      if (!me || gradeOf(me.u) !== g) return;
      if (onlySid != null && profileSchool(me.u) !== onlySid) return;
      handler(msg);
    };
    return a ? () => { emit = () => {}; } : () => {};
  }

  window.MLEBackend = { init, api, listen, isShared };
})();
