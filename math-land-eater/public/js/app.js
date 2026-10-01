/* 매뜨 땅먹 — 화면, 다각형 지도, 문제 풀기 */
(() => {
  'use strict';
  const S = window.MLE, P = window.MLEProblems;
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = s => esc(s).replace(/\{(\d+)\/(\d+)\}/g, '<span class="frac"><span>$1</span><span>$2</span></span>');
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* 저장 불가 */ } },
  };
  const SHAPE = { 3: '삼각형', 4: '사각형', 5: '오각형', 6: '육각형', 7: '칠각형', 8: '팔각형', 9: '구각형' };
  const PRAISE = ['정답이에요!', '잘했어요!', '최고예요!', '완벽해요!', '수학 천재!', '멋져요!'];

  let G = null;          // 지도 모양
  let schools = [];      // 학교 목록 (지도의 실제 학교 + 직접 등록한 학교)
  let token = store.get('mle_token'), me = null, W = null, es = null, online = 0, sel = -1, streak = 0, best = 0, chatCh = 'school', wrongN = 0;
  const cheat = { unlocked: false, capture: false, defend: false };
  const mySid = () => (me && me.profile ? me.profile.schoolId : -1);
  const short = sid => (schools[sid] ? schools[sid].name.replace(/초등학교$/, '초') : '어떤 학교');
  const needToTake = i => (W.owner[i] < 0 ? 2 : Math.max(2, W.def[i]));

  // ---------- 소리 (파일 없이 직접 만든 효과음) ----------
  const Sound = (() => {
    let ac = null, on = store.get('mle_sound') !== 'off';
    const tone = (f, t, dur, type, vol, slide) => {
      const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + t;
      o.type = type; o.frequency.setValueAtTime(f, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    };
    const songs = {
      tap: () => tone(660, 0, 0.05, 'triangle', 0.04),
      ok: s => { const b = 1 + Math.min(s || 0, 8) * 0.06; tone(784 * b, 0, 0.12, 'triangle', 0.12); tone(1175 * b, 0.08, 0.2, 'triangle', 0.1); },
      bad: () => tone(220, 0, 0.3, 'sawtooth', 0.05, 110),
      capture: () => [523, 659, 784, 1047, 1319].forEach((f, k) => tone(f, k * 0.08, 0.25, 'triangle', 0.1)),
      defend: () => { tone(294, 0, 0.4, 'square', 0.04); tone(440, 0.06, 0.4, 'square', 0.035); tone(587, 0.12, 0.45, 'triangle', 0.06); },
      lose: () => [494, 415, 330].forEach((f, k) => tone(f, k * 0.13, 0.22, 'sawtooth', 0.045)),
      unlock: () => [880, 1109, 1319, 1760].forEach((f, k) => tone(f, k * 0.06, 0.16, 'sine', 0.08)),
    };
    return {
      get on() { return on; },
      toggle() { on = !on; store.set('mle_sound', on ? 'on' : 'off'); return on; },
      play(name, arg) {
        if (!on) return;
        try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); songs[name](arg); } catch { /* 소리를 낼 수 없는 환경 */ }
      },
    };
  })();

  // ---------- 색종이 효과 ----------
  const fxCv = $('#fx'), fx = fxCv.getContext('2d');
  let parts = [];
  function confetti(x, y, n) {
    const cols = ['#ff7a1a', '#ffc107', '#22a95a', '#2f80ed', '#e5484d', '#b45cff'];
    for (let k = 0; k < (n || 90); k++) {
      const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 8;
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, r: 3 + Math.random() * 4, c: cols[k % cols.length], life: 1, rot: Math.random() * 6 });
    }
    if (parts.length === (n || 90)) requestAnimationFrame(fxStep);
  }
  function fxStep() {
    const d = window.devicePixelRatio || 1;
    if (fxCv.width !== Math.round(innerWidth * d)) { fxCv.width = Math.round(innerWidth * d); fxCv.height = Math.round(innerHeight * d); }
    fx.setTransform(d, 0, 0, d, 0, 0);
    fx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.vy += 0.28; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.life -= 0.011; p.rot += 0.18;
      fx.save(); fx.globalAlpha = Math.max(0, p.life); fx.translate(p.x, p.y); fx.rotate(p.rot); fx.fillStyle = p.c; fx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); fx.restore();
    }
    if (parts.length) requestAnimationFrame(fxStep); else fx.clearRect(0, 0, innerWidth, innerHeight);
  }

  // ---------- 공통 ----------
  async function api(path, body) {
    if (window.MLEBackend) { // 서버 없이 브라우저 안에서 돌릴 때
      const d = await window.MLEBackend.api(path, body, token);
      if (d.code === 401 && token) logoutLocal('다시 로그인해 주세요.');
      return d;
    }
    const opt = { method: body ? 'POST' : 'GET', headers: {} };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (token) opt.headers.Authorization = 'Bearer ' + token;
    try {
      const res = await fetch(path, opt);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && token) logoutLocal('다시 로그인해 주세요.');
      if (!res.ok && !data.error) data.error = '서버 오류가 났어요.';
      return data;
    } catch {
      return { error: '서버에 연결할 수 없어요.' };
    }
  }
  function toast(msg, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3000);
  }
  const show = id => { $$('.screen').forEach(s => { s.hidden = s.id !== id; }); if (id === 'game') resize(); };
  const openM = id => { $('#' + id).hidden = false; };
  const closeM = id => { $('#' + id).hidden = true; };
  document.addEventListener('click', e => { const c = e.target.closest('[data-close]'); if (c) closeM(c.dataset.close); });
  const setErr = (s, msg) => { $(s).textContent = msg || ''; };
  const mergeCustom = list => (list || []).forEach(c => { schools[c.id] = c; });

  // ---------- 지도 불러오기 ----------
  const IB = 1024; // 빠른 찾기 색인 칸 크기
  let stamp = 0, marks = null;
  async function loadMap() {
    const res = await fetch(window.MLE_MAP_URL || '/api/map');
    if (!res.ok) throw new Error('지도를 받을 수 없어요.');
    const m = await res.json();
    if (window.MLEBackend) { $('#loadMsg').textContent = '친구들과 함께 쓰는 지도에 연결하는 중…'; await window.MLEBackend.init(m); }
    $('#loadMsg').textContent = `다각형 땅 ${m.n.toLocaleString()}칸을 그리는 중…`;
    await new Promise(r => setTimeout(r, 30));
    const dec = arr => { const out = new Float32Array(arr.length); let x = 0, y = 0; for (let k = 0; k < arr.length; k += 2) { x += arr[k]; y += arr[k + 1]; out[k] = x; out[k + 1] = y; } return out; };
    const toPath = rings => { const p = new Path2D(); for (const r of rings) { p.moveTo(r[0], r[1]); for (let k = 2; k < r.length; k += 2) p.lineTo(r[k], r[k + 1]); p.closePath(); } return p; };
    const boxOf = rings => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const r of rings) for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); y0 = Math.min(y0, r[k + 1]); y1 = Math.max(y1, r[k + 1]); } return [x0, y0, x1, y1]; };
    G = { W: m.W, H: m.H, n: m.n, nb: m.nb, sides: m.sides, routes: m.routes };
    SPACING = m.spacing || 150;
    G.rings = m.cells.map(c => c.map(dec));
    G.paths = G.rings.map(toPath);
    G.box = new Float32Array(m.n * 4);
    G.rings.forEach((rs, i) => G.box.set(boxOf(rs), i * 4));
    G.sx = new Float32Array(m.n); G.sy = new Float32Array(m.n);
    for (let i = 0; i < m.n; i++) { G.sx[i] = m.seeds[2 * i]; G.sy[i] = m.seeds[2 * i + 1]; }
    G.land = m.land.map(dec);
    G.landPaths = G.land.map(r => toPath([r]));
    G.landBox = G.land.map(r => boxOf([r]));
    G.districts = m.districts.map(([sido, sigungu, x, y]) => ({ sido, sigungu, x, y }));
    const sm = new Map();
    for (const d of G.districts) { const v = sm.get(d.sido) || { name: d.sido, x: 0, y: 0, n: 0 }; v.x += d.x; v.y += d.y; v.n++; sm.set(d.sido, v); }
    G.sidos = [...sm.values()].map(v => ({ name: v.name, x: v.x / v.n, y: v.y / v.n }));
    G.ibw = Math.ceil(G.W / IB); G.ibh = Math.ceil(G.H / IB);
    G.index = Array.from({ length: G.ibw * G.ibh }, () => []);
    for (let i = 0; i < m.n; i++) {
      const b = i * 4;
      const gx0 = Math.max(0, Math.floor(G.box[b] / IB)), gx1 = Math.min(G.ibw - 1, Math.floor(G.box[b + 2] / IB));
      const gy0 = Math.max(0, Math.floor(G.box[b + 1] / IB)), gy1 = Math.min(G.ibh - 1, Math.floor(G.box[b + 3] / IB));
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) G.index[gy * G.ibw + gx].push(i);
    }
    marks = new Uint32Array(m.n);
    schools = m.schools.map(([name, sido, sigungu, url], id) => ({ id, name, sido, sigungu, url: url || '' }));
  }
  function cellsIn(x0, y0, x1, y1) {
    const out = [];
    stamp++;
    const gx0 = Math.max(0, Math.floor(x0 / IB)), gx1 = Math.min(G.ibw - 1, Math.floor(x1 / IB));
    const gy0 = Math.max(0, Math.floor(y0 / IB)), gy1 = Math.min(G.ibh - 1, Math.floor(y1 / IB));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) for (const i of G.index[gy * G.ibw + gx]) {
      if (marks[i] === stamp) continue;
      marks[i] = stamp;
      const b = i * 4;
      if (G.box[b] <= x1 && G.box[b + 2] >= x0 && G.box[b + 1] <= y1 && G.box[b + 3] >= y0) out.push(i);
    }
    return out;
  }
  function hitTest(x, y) {
    for (const i of cellsIn(x, y, x, y)) {
      let inside = false;
      for (const r of G.rings[i]) for (let a = 0, b = r.length - 2; a < r.length; b = a, a += 2) {
        if ((r[a + 1] > y) !== (r[b + 1] > y) && x < ((r[b] - r[a]) * (y - r[a + 1])) / (r[b + 1] - r[a + 1]) + r[a]) inside = !inside;
      }
      if (inside) return i;
    }
    return -1;
  }
  function nearestDistrict(x, y) {
    let best = null, bd = Infinity;
    for (const d of G.districts) { const dd = (d.x - x) ** 2 + (d.y - y) ** 2; if (dd < bd) { bd = dd; best = d; } }
    return best;
  }

  // ---------- 로그인 / 회원가입 ----------
  function initAuth() {
    $$('.tab').forEach(t => { t.onclick = () => {
      $$('.tab').forEach(x => x.classList.toggle('on', x === t));
      $('#loginForm').hidden = t.dataset.tab !== 'login';
      $('#signupForm').hidden = t.dataset.tab !== 'signup';
    }; });
    const sy = S.schoolYear(), birth = $('#suBirth');
    birth.innerHTML = '<option value="">출생연도를 골라요</option>' +
      Array.from({ length: 17 }, (_, k) => sy - 4 - k).map(y => `<option value="${y}">${y}년생</option>`).join('');
    birth.onchange = () => {
      const y = +birth.value, g = S.gradeFromBirthYear(y), ok = g >= 1 && g <= 6;
      $('#suGrade').textContent = !y ? '' : ok ? `✅ ${y}년생 → ${g}학년 (${g}학년 서버에서 놀아요)` : `❌ 초등학생(${sy - 12}~${sy - 7}년생)만 가입할 수 있어요.`;
      $('#suGrade').className = 'note ' + (y && !ok ? 'bad' : '');
    };
    $('#loginForm').onsubmit = async e => {
      e.preventDefault();
      const d = await api('/api/login', { username: $('#liId').value.trim(), password: $('#liPw').value });
      if (d.error) return setErr('#liErr', d.error);
      setErr('#liErr');
      onAuthed(d);
    };
    $('#signupForm').onsubmit = async e => {
      e.preventDefault();
      if ($('#suPw').value !== $('#suPw2').value) return setErr('#suErr', '비밀번호가 서로 달라요.');
      const d = await api('/api/signup', { username: $('#suId').value.trim(), password: $('#suPw').value, birthYear: +$('#suBirth').value });
      if (d.error) return setErr('#suErr', d.error);
      setErr('#suErr');
      toast('🎉 회원가입 완료! 환영해요.', 'ok');
      onAuthed(d);
    };
  }
  function onAuthed(d) {
    token = d.token;
    store.set('mle_token', token);
    me = d.user;
    Object.assign(cheat, { unlocked: false, capture: false, defend: false });
    route();
  }
  function route() {
    if (me.grade < 1 || me.grade > 6) { toast('초등학생(1~6학년)만 플레이할 수 있어요.', 'err'); return logoutLocal(); }
    if (me.profile) startGame(); else openSetup();
  }
  function logoutLocal(msg) {
    token = null;
    store.set('mle_token', null);
    me = null; W = null; sel = -1; quiz = null;
    if (es) { es.close(); es = null; }
    Object.assign(cheat, { unlocked: false, capture: false, defend: false });
    $$('.modal').forEach(m => { m.hidden = true; });
    show('auth');
    if (msg) toast(msg, 'warn');
  }

  // ---------- 게임 시작 전 설정 ----------
  let chosen = null, semester = 1;
  function initSetup() {
    $('#stSearch').oninput = renderSchoolList;
    $('#stList').onclick = e => { const b = e.target.closest('[data-id]'); if (b) chooseSchool(+b.dataset.id); };
    $('#stCustomToggle').onclick = () => { $('#stCustom').hidden = !$('#stCustom').hidden; };
    const sidos = [...new Set(G.districts.map(d => d.sido))];
    $('#stCSido').innerHTML = sidos.map(s => `<option>${esc(s)}</option>`).join('');
    const fillSigungu = () => {
      $('#stCSigungu').innerHTML = G.districts.map((d, i) => (d.sido === $('#stCSido').value ? `<option value="${i}">${esc(d.sigungu)}</option>` : '')).join('');
    };
    $('#stCSido').onchange = fillSigungu;
    fillSigungu();
    $$('.sem').forEach(b => { b.onclick = () => setSemester(+b.dataset.sem); });
    $('#stBack').onclick = () => startGame();
    $('#setupForm').onsubmit = async e => {
      e.preventDefault();
      const body = { semester, nickname: $('#stNick').value.trim() };
      const cname = $('#stCName').value.trim();
      if (!$('#stCustom').hidden && cname) body.custom = { di: +$('#stCSigungu').value, name: cname, url: $('#stCUrl').value.trim() };
      else if (chosen != null) body.schoolId = chosen;
      else return setErr('#stErr', '우리 학교를 골라 주세요.');
      const d = await api('/api/profile', body);
      if (d.error) return setErr('#stErr', d.error);
      setErr('#stErr');
      me = d.user;
      mergeCustom(d.custom);
      startGame();
    };
  }
  function setSemester(s) {
    semester = s;
    $$('.sem').forEach(b => b.classList.toggle('on', +b.dataset.sem === s));
  }
  function chooseSchool(id) {
    chosen = id;
    const s = schools[id];
    $('#stChosen').innerHTML = s ? `✅ <b>${esc(s.name)}</b> <span class="muted">${esc(s.sido)} ${esc(s.sigungu)}</span>` : '아직 학교를 고르지 않았어요';
    $('#stChosen').classList.toggle('on', !!s);
    renderSchoolList();
  }
  const searchSchools = (q, max) => {
    q = q.replace(/\s+/g, '');
    const res = [];
    if (!q) return res;
    for (const s of schools) {
      if (s && (s.name + s.sido + s.sigungu).includes(q)) res.push(s);
      if (res.length >= max) break;
    }
    return res;
  };
  function renderSchoolList() {
    const q = $('#stSearch').value, box = $('#stList'), res = searchSchools(q, 60);
    if (!q.trim()) { box.innerHTML = `<div class="muted pad">전국 ${schools.length.toLocaleString()}개 학교 중에서 이름이나 지역을 검색해 보세요.</div>`; return; }
    box.innerHTML = res.length
      ? res.map(s => `<button type="button" class="school-item${s.id === chosen ? ' on' : ''}" data-id="${s.id}"><b>${esc(s.name)}</b><span>${esc(s.sido)} ${esc(s.sigungu)}</span></button>`).join('')
      : '<div class="muted pad">검색 결과가 없어요. 아래 "직접 등록하기"를 눌러 보세요.</div>';
  }
  async function openSetup() {
    show('setup');
    const d = await api('/api/schools');
    mergeCustom(d.custom);
    const p = me.profile || {}, m = new Date().getMonth();
    $('#stGrade').innerHTML = `<b>${me.grade}학년</b> <span class="muted">(${me.birthYear}년생 · 나이 인증으로 정해졌어요 · ${me.grade}학년 서버)</span>`;
    setSemester(p.semester || (m >= 1 && m <= 6 ? 1 : 2));
    $('#stNick').value = p.nickname || '';
    $('#stSearch').value = '';
    $('#stCustom').hidden = true;
    $('#stCName').value = '';
    $('#stBack').hidden = !me.profile;
    chooseSchool(p.schoolId != null ? p.schoolId : null);
  }

  // ---------- 지도 그리기 (조각 그림 캐시) ----------
  const cv = $('#map'), ctx = cv.getContext('2d');
  const view = { s: 0.02, x: 0, y: 0 };
  const TILE = 256, ZMAX = 12;
  let SPACING = 150;
  const tiles = new Map();
  let vw = 0, vh = 0, dpr = 1, queued = false, ambient = 0, tick = 0, flashes = [], frontier = new Set(), defended = new Set(), owned = new Set();
  const NEUTRAL = [196, 201, 208], MINE = [255, 193, 7];
  const colorCache = new Map();
  const baseS = () => TILE / Math.max(G.W, G.H);
  const cellPx = () => SPACING * view.s;

  function hsl(h, s, l) {
    const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  }
  function rgbOf(o) {
    if (o < 0) return NEUTRAL;
    if (o === mySid()) return MINE;
    let c = colorCache.get(o);
    if (!c) {
      let h = (o * 137.508) % 360;
      if (h > 32 && h < 70) h += 48; // 우리 학교 노란색과 헷갈리지 않게
      c = hsl(h, 0.62, 0.56);
      colorCache.set(o, c);
    }
    return c;
  }
  const cssColor = o => `rgb(${rgbOf(o).join(',')})`;
  const hash01 = i => { let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  function fillOf(i) {
    const o = W.owner[i], c = rgbOf(o);
    let f = 1 + (hash01(i) - 0.5) * (o < 0 ? 0.08 : 0.12);
    if (W.def[i] > 0) f *= 0.8;
    return `rgb(${Math.min(255, c[0] * f) | 0},${Math.min(255, c[1] * f) | 0},${Math.min(255, c[2] * f) | 0})`;
  }
  function strokeOf(i) {
    const o = W.owner[i];
    if (o < 0) return 'rgba(255,255,255,.8)';
    const c = rgbOf(o);
    return `rgb(${c[0] * 0.6 | 0},${c[1] * 0.6 | 0},${c[2] * 0.6 | 0})`;
  }

  function renderTile(z, tx, ty) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const g = c.getContext('2d');
    const sz = baseS() * 2 ** z, tw = TILE / sz, x0 = tx * tw, y0 = ty * tw, px = 1 / sz, cp = SPACING * sz;
    g.setTransform(sz, 0, 0, sz, -x0 * sz, -y0 * sz);
    g.lineJoin = 'round';
    const lands = [];
    G.landBox.forEach((b, k) => { if (b[0] <= x0 + tw && b[2] >= x0 && b[1] <= y0 + tw && b[3] >= y0) lands.push(k); });
    g.strokeStyle = 'rgba(214,244,255,.85)';
    g.lineWidth = Math.min(14, 4 + cp / 12) * px;
    for (const k of lands) g.stroke(G.landPaths[k]); // 바닷가 물빛
    if (cp < 3) { // 아주 멀리서 볼 때: 회색 땅을 한 번에 칠하고 주인 있는 칸만 덧칠한다
      g.fillStyle = `rgb(${NEUTRAL.join(',')})`;
      for (const k of lands) g.fill(G.landPaths[k]);
      g.lineWidth = px;
      for (const i of owned) {
        const b = i * 4;
        if (G.box[b] > x0 + tw || G.box[b + 2] < x0 || G.box[b + 1] > y0 + tw || G.box[b + 3] < y0) continue;
        g.fillStyle = g.strokeStyle = fillOf(i); g.fill(G.paths[i]); g.stroke(G.paths[i]);
      }
    } else {
    const ids = cellsIn(x0 - 1, y0 - 1, x0 + tw + 1, y0 + tw + 1);
    const lines = cp > 7;
    g.lineWidth = (lines ? Math.min(2.2, 0.6 + cp / 70) : 1) * px;
    for (const i of ids) {
      const f = fillOf(i);
      g.fillStyle = f;
      g.fill(G.paths[i]);
      if (!lines) { g.strokeStyle = f; g.stroke(G.paths[i]); } // 이음새 메우기
    }
    if (lines) for (const i of ids) { g.strokeStyle = strokeOf(i); g.stroke(G.paths[i]); }
    }
    g.strokeStyle = 'rgba(30,80,120,.5)';
    g.lineWidth = 1.1 * px;
    for (const k of lands) g.stroke(G.landPaths[k]); // 해안선
    return c;
  }
  function invalidateCell(i) {
    const b = i * 4;
    for (const t of tiles.values()) {
      const tw = TILE / (baseS() * 2 ** t.z), m = tw * 0.03, x0 = t.tx * tw, y0 = t.ty * tw;
      if (G.box[b] <= x0 + tw + m && G.box[b + 2] >= x0 - m && G.box[b + 1] <= y0 + tw + m && G.box[b + 3] >= y0 - m) t.dirty = true;
    }
  }
  function resize() {
    const r = $('#mapWrap').getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    vw = r.width; vh = r.height;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    requestDraw();
  }
  window.addEventListener('resize', () => { if (!$('#game').hidden) { resize(); renderMini(); } });
  function requestDraw() { if (!queued) { queued = true; requestAnimationFrame(draw); } }

  let seaPattern = null;
  function makeSea() {
    const p = document.createElement('canvas');
    p.width = p.height = 120;
    const g = p.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1.5; g.lineCap = 'round';
    for (const [x, y] of [[10, 20], [70, 50], [30, 90], [90, 105]]) { g.beginPath(); g.arc(x, y, 8, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); g.beginPath(); g.arc(x + 16, y, 8, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
    seaPattern = ctx.createPattern(p, 'repeat');
  }

  function draw() {
    queued = false;
    if (!G || !W) return;
    const s = view.s, now = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sea = ctx.createLinearGradient(0, 0, 0, vh);
    sea.addColorStop(0, '#7cc8f0'); sea.addColorStop(1, '#4fa6de');
    ctx.fillStyle = sea; ctx.fillRect(0, 0, vw, vh);
    if (!seaPattern) makeSea();
    ctx.save(); ctx.translate(view.x % 120, view.y % 120); ctx.fillStyle = seaPattern; ctx.fillRect(-120, -120, vw + 240, vh + 240); ctx.restore();

    // 1) 땅 조각 그림
    const z = Math.max(0, Math.min(ZMAX, Math.ceil(Math.log2((s * dpr) / baseS()) - 0.05)));
    const sz = baseS() * 2 ** z, tw = TILE / sz, nT = 2 ** z;
    const tx0 = Math.max(0, Math.floor(-view.x / s / tw)), tx1 = Math.min(nT - 1, Math.floor((vw - view.x) / s / tw));
    const ty0 = Math.max(0, Math.floor(-view.y / s / tw)), ty1 = Math.min(nT - 1, Math.floor((vh - view.y) / s / tw));
    const t0 = performance.now();
    let rendered = 0, more = false;
    tick++;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = z + '/' + tx + '/' + ty, X = view.x + tx * tw * s, Y = view.y + ty * tw * s, SZ = tw * s;
      let t = tiles.get(key);
      if ((!t || t.dirty) && (rendered === 0 || performance.now() - t0 < 14)) { // 한 화면에 너무 오래 걸리지 않게
        rendered++;
        const img = renderTile(z, tx, ty);
        if (t) { t.cv = img; t.dirty = false; } else tiles.set(key, t = { cv: img, z, tx, ty, dirty: false });
      }
      if (t) { t.used = tick; ctx.drawImage(t.cv, X, Y, SZ + 0.6, SZ + 0.6); if (t.dirty) more = true; continue; }
      more = true;
      for (let d = 1; d <= z; d++) { // 아직 없으면 더 흐린 조각으로 먼저 보여 준다
        const p = tiles.get((z - d) + '/' + (tx >> d) + '/' + (ty >> d));
        if (!p) continue;
        const sub = TILE >> d;
        ctx.drawImage(p.cv, (tx - ((tx >> d) << d)) * sub, (ty - ((ty >> d) << d)) * sub, sub, sub, X, Y, SZ + 0.6, SZ + 0.6);
        break;
      }
    }
    if (tiles.size > 160) [...tiles.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, tiles.size - 160).forEach(([k]) => tiles.delete(k));

    // 2) 지도 위 표시 (지도 좌표)
    const cp = cellPx(), wx0 = -view.x / s, wy0 = -view.y / s, wx1 = (vw - view.x) / s, wy1 = (vh - view.y) / s;
    const vis = i => G.box[i * 4] <= wx1 && G.box[i * 4 + 2] >= wx0 && G.box[i * 4 + 1] <= wy1 && G.box[i * 4 + 3] >= wy0;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.x, dpr * view.y);
    ctx.lineJoin = 'round';
    if (G.routes.length) { // 섬으로 가는 뱃길
      ctx.setLineDash([7 / s, 6 / s]); ctx.lineWidth = 2 / s; ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath();
      for (const [a, b] of G.routes) { ctx.moveTo(G.sx[a], G.sy[a]); ctx.lineTo(G.sx[b], G.sy[b]); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (cp >= 16 && frontier.size) { // 뺏을 수 있는 땅
      ctx.setLineDash([6 / s, 4 / s]); ctx.lineDashOffset = -(now / 60) / s; ctx.lineWidth = 2.4 / s; ctx.strokeStyle = 'rgba(255,170,0,.95)'; ctx.fillStyle = 'rgba(255,214,90,.16)';
      for (const i of frontier) if (vis(i)) { ctx.fill(G.paths[i]); ctx.stroke(G.paths[i]); }
      ctx.setLineDash([]);
    }
    flashes = flashes.filter(f => now - f.t < 1000);
    for (const f of flashes) {
      const a = 1 - (now - f.t) / 1000;
      ctx.fillStyle = `rgba(255,255,255,${a * 0.75})`; ctx.fill(G.paths[f.i]);
      ctx.lineWidth = (2 + 6 * (1 - a)) / s; ctx.strokeStyle = f.bad ? `rgba(229,72,77,${a})` : `rgba(255,193,7,${a})`; ctx.stroke(G.paths[f.i]);
    }
    if (sel >= 0) {
      ctx.lineWidth = 7 / s; ctx.strokeStyle = 'rgba(255,45,85,.35)'; ctx.stroke(G.paths[sel]);
      ctx.lineWidth = 3 / s; ctx.strokeStyle = '#ff2d55'; ctx.stroke(G.paths[sel]);
    }

    // 3) 화면 좌표 표시: 시도 이름, 방어, 학교
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const SX = x => view.x + x * s, SY = y => view.y + y * s;
    if (cp < 9) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.round(Math.max(13, Math.min(26, cp * 3)))}px Jua, sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.fillStyle = 'rgba(40,55,70,.55)';
      for (const d of G.sidos) { ctx.strokeText(d.name, SX(d.x), SY(d.y)); ctx.fillText(d.name, SX(d.x), SY(d.y)); }
    }
    if (cp >= 34) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${Math.round(Math.min(15, cp * 0.2))}px sans-serif`;
      for (const i of defended) {
        if (!vis(i) || W.homeCell[i] >= 0) continue;
        const x = SX(G.sx[i]), y = SY(G.sy[i]), r = Math.min(13, cp * 0.14);
        shield(x, y, r);
        ctx.fillStyle = '#fff'; ctx.fillText(W.def[i], x, y + 1);
      }
    }
    const my = mySid();
    for (let sid = 0; sid < W.home.length; sid++) {
      const h = W.home[sid];
      if (h < 0 || sid === my || cp < 11 || !vis(h)) continue;
      schoolMark(SX(G.sx[h]), SY(G.sy[h]), Math.max(4, Math.min(12, cp * 0.14)), sid, cp >= 55 || h === sel);
    }
    const mh = W.home[my], myVis = mh >= 0 && vis(mh);
    if (myVis) {
      const x = SX(G.sx[mh]), y = SY(G.sy[mh]), pulse = (now % 1600) / 1600;
      ctx.beginPath(); ctx.arc(x, y, 10 + pulse * 18, 0, 7); ctx.strokeStyle = `rgba(232,85,61,${1 - pulse})`; ctx.lineWidth = 3; ctx.stroke();
      schoolMark(x, y, Math.max(8, Math.min(14, cp * 0.16)), my, true);
    }
    drawMini();
    if (more || flashes.length) requestDraw();
    else if ((myVis || (cp >= 16 && frontier.size)) && !ambient) ambient = setTimeout(() => { ambient = 0; requestDraw(); }, 60); // 반짝이는 표시는 천천히
  }
  function shield(x, y, r) {
    ctx.beginPath();
    ctx.moveTo(x, y - r); ctx.lineTo(x + r, y - r * 0.6); ctx.lineTo(x + r * 0.8, y + r * 0.5); ctx.lineTo(x, y + r * 1.05); ctx.lineTo(x - r * 0.8, y + r * 0.5); ctx.lineTo(x - r, y - r * 0.6); ctx.closePath();
    ctx.fillStyle = '#2f6fd6'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
  }
  function schoolMark(x, y, r, sid, withLabel) {
    const mine = sid === mySid();
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = Math.max(2, r * 0.28); ctx.strokeStyle = mine ? '#e8553d' : cssColor(sid); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - r * 0.55, y + r * 0.45); ctx.lineTo(x - r * 0.55, y - r * 0.05); ctx.lineTo(x, y - r * 0.55); ctx.lineTo(x + r * 0.55, y - r * 0.05); ctx.lineTo(x + r * 0.55, y + r * 0.45); ctx.closePath();
    ctx.fillStyle = mine ? '#e8553d' : '#4a5563'; ctx.fill();
    if (!withLabel) return;
    const text = (mine ? '⭐ ' : '') + short(sid);
    ctx.font = `${mine ? 15 : 13}px Jua, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const w = ctx.measureText(text).width + 12, ly = y - r - 4;
    ctx.fillStyle = mine ? 'rgba(232,85,61,.95)' : 'rgba(255,255,255,.92)';
    roundRect(x - w / 2, ly - 19, w, 19, 9); ctx.fill();
    ctx.fillStyle = mine ? '#fff' : '#23303b'; ctx.fillText(text, x, ly - 3);
  }
  function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  // ---------- 작은 지도 ----------
  const mini = $('#mini'), mctx = mini.getContext('2d');
  let miniImg = null, miniTimer = null, miniW = 0, miniH = 0;
  function renderMini() {
    if (!G || !W) return;
    miniW = Math.min(170, Math.max(110, vw * 0.16)); miniH = miniW * G.H / G.W;
    const d = dpr, c = miniImg || document.createElement('canvas');
    c.width = Math.round(miniW * d); c.height = Math.round(miniH * d);
    const g = c.getContext('2d'), k = (miniW * d) / G.W;
    g.setTransform(k, 0, 0, k, 0, 0);
    g.lineWidth = 1 / k;
    g.fillStyle = '#c4c9d0';
    for (const p of G.landPaths) g.fill(p);
    for (const i of owned) { g.fillStyle = g.strokeStyle = cssColor(W.owner[i]); g.fill(G.paths[i]); g.stroke(G.paths[i]); }
    miniImg = c;
    mini.width = c.width; mini.height = c.height;
    mini.style.width = miniW + 'px'; mini.style.height = miniH + 'px';
    requestDraw();
  }
  const scheduleMini = () => { if (!miniTimer) miniTimer = setTimeout(() => { miniTimer = null; renderMini(); }, 1200); };
  function drawMini() {
    if (!miniImg) return;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, mini.width, mini.height);
    mctx.drawImage(miniImg, 0, 0);
    const k = mini.width / G.W, s = view.s;
    mctx.strokeStyle = '#ff2d55'; mctx.lineWidth = 2 * dpr;
    mctx.strokeRect((-view.x / s) * k, (-view.y / s) * k, (vw / s) * k, (vh / s) * k);
  }
  function miniJump(e) {
    const r = mini.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * G.W, y = ((e.clientY - r.top) / r.height) * G.H;
    view.x = vw / 2 - x * view.s; view.y = vh / 2 - y * view.s;
    requestDraw();
  }
  mini.addEventListener('pointerdown', e => { mini.setPointerCapture(e.pointerId); miniJump(e); });
  mini.addEventListener('pointermove', e => { if (e.buttons) miniJump(e); });

  // ---------- 지도 움직이기 ----------
  const fitScale = () => Math.min(vw / G.W, vh / G.H) * 0.94;
  const clampS = s => Math.max(fitScale() * 0.8, Math.min(2.4, s));
  function zoomAt(px, py, ns) {
    ns = clampS(ns);
    const wx = (px - view.x) / view.s, wy = (py - view.y) / view.s;
    view.s = ns; view.x = px - wx * ns; view.y = py - wy * ns;
    requestDraw();
  }
  function flyTo(i, s) {
    const from = { ...view }, toS = clampS(s || view.s), t0 = performance.now();
    const to = { s: toS, x: vw / 2 - G.sx[i] * toS, y: vh / 2 - G.sy[i] * toS };
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 450), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const ls = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
      const wx = G.sx[i], wy = G.sy[i], cx = (vw / 2 - from.x) / from.s + (wx - (vw / 2 - from.x) / from.s) * e, cy = (vh / 2 - from.y) / from.s + (wy - (vh / 2 - from.y) / from.s) * e;
      view.s = ls; view.x = vw / 2 - cx * ls; view.y = vh / 2 - cy * ls;
      requestDraw();
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  }
  function fitView() { view.s = fitScale(); view.x = (vw - G.W * view.s) / 2; view.y = (vh - G.H * view.s) / 2; requestDraw(); }
  const goHome = () => { const h = W && W.home[mySid()]; if (h >= 0) flyTo(h, Math.max(view.s, 0.5)); };

  const pointers = new Map();
  let drag = null, pinch = null, moved = false, hoverCell = -1;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pinchState = () => { const [a, b] = [...pointers.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pos(e));
    $('#tip').hidden = true;
    if (pointers.size === 1) { const p = pos(e); drag = { x: p.x, y: p.y, vx: view.x, vy: view.y }; moved = false; }
    else if (pointers.size === 2) { pinch = { ...pinchState(), s: view.s, vx: view.x, vy: view.y }; moved = true; }
  });
  cv.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) { if (e.pointerType === 'mouse') hover(pos(e)); return; }
    pointers.set(e.pointerId, pos(e));
    if (pinch && pointers.size >= 2) {
      const st = pinchState(), ns = clampS(pinch.s * (st.d / pinch.d));
      const wx = (pinch.x - pinch.vx) / pinch.s, wy = (pinch.y - pinch.vy) / pinch.s;
      view.s = ns; view.x = st.x - wx * ns; view.y = st.y - wy * ns;
      requestDraw();
    } else if (drag) {
      const p = pos(e), dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; requestDraw(); }
    }
  });
  const endPointer = e => {
    if (!pointers.has(e.pointerId)) return;
    const p = pos(e);
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (!moved && drag && e.type === 'pointerup') select(hitTest((p.x - view.x) / view.s, (p.y - view.y) / view.s));
      drag = null; pinch = null;
    } else if (pointers.size === 1) {
      pinch = null;
      const q = [...pointers.values()][0];
      drag = { x: q.x, y: q.y, vx: view.x, vy: view.y };
    }
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('pointerleave', () => { $('#tip').hidden = true; hoverCell = -1; });
  cv.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); zoomAt(p.x, p.y, view.s * Math.exp(-e.deltaY * 0.0016)); }, { passive: false });
  function hover(p) {
    if (!W) return;
    const i = hitTest((p.x - view.x) / view.s, (p.y - view.y) / view.s), tip = $('#tip');
    if (i < 0) { tip.hidden = true; hoverCell = -1; return; }
    if (i !== hoverCell) {
      hoverCell = i;
      const o = W.owner[i], hs = W.homeCell[i];
      tip.textContent = hs >= 0 ? `🏫 ${schools[hs].name}` : o < 0 ? '빈 땅' : `${short(o)} 땅${W.def[i] ? ' · 🛡' + W.def[i] : ''}`;
    }
    tip.hidden = false;
    tip.style.left = p.x + 14 + 'px'; tip.style.top = p.y + 14 + 'px';
  }
  function select(i) { sel = i; renderPopup(); requestDraw(); if (i >= 0) Sound.play('tap'); }

  // ---------- 땅 정보 창 (땅 뺏기 / 땅 방어하기) ----------
  function renderPopup() {
    const box = $('#popup');
    if (sel < 0 || !W) { box.hidden = true; return; }
    const i = sel, o = W.owner[i], d = W.def[i], hs = W.homeCell[i], my = mySid(), mine = o === my;
    const adj = G.nb[i].some(n => W.owner[n] === my);
    const dist = nearestDistrict(G.sx[i], G.sy[i]);
    const shape = G.sides[i] ? SHAPE[G.sides[i]] || '다각형' : '바닷가';
    const title = hs >= 0 ? (mine ? '🏫 우리 학교 본부' : `🏫 ${schools[hs].name}`) : o < 0 ? `⬜ ${shape} 빈 땅` : mine ? `⭐ 우리 학교 ${shape} 땅` : `🚩 ${short(o)}의 ${shape} 땅`;
    const atkWhy = mine ? '이미 우리 학교 땅이에요.' : hs >= 0 ? '학교 본부는 뺏을 수 없어요.' : !adj ? '노란색 우리 땅과 닿아 있는 땅만 뺏을 수 있어요.' : '';
    const defWhy = !mine ? '우리 학교 땅만 방어할 수 있어요.' : hs >= 0 ? '본부는 언제나 안전해요.' : d >= 99 ? '방어가 가장 높아요(99).' : '';
    let ownedN = 0;
    if (o >= 0) for (const k of owned) if (W.owner[k] === o) ownedN++;
    const tags = [`<span class="tag">📍 ${esc(dist.sido)} ${esc(dist.sigungu)}</span>`];
    if (o >= 0 && !mine) tags.push(`<span class="tag" style="--c:${cssColor(o)}">🚩 ${esc(schools[o].name)} · ${ownedN}칸</span>`);
    if (o >= 0 && hs < 0) tags.push(`<span class="tag">🛡️ 방어 <b>${d}</b></span>`);
    if (!mine && hs < 0) tags.push(`<span class="tag hot">⚔️ 문제 <b>${needToTake(i)}개</b> 풀면 뺏어요</span>`);
    box.innerHTML = `
      <div class="popup-head"><b>${esc(title)}</b><button type="button" class="icon-btn" id="popClose">✕</button></div>
      <div class="popup-info">${tags.join('')}</div>
      <div class="popup-btns">
        <button type="button" class="btn attack" id="btnAtk" ${atkWhy ? 'disabled' : ''}>⚔️ 땅 뺏기</button>
        <button type="button" class="btn defend" id="btnDef" ${defWhy ? 'disabled' : ''}>🛡️ 땅 방어하기</button>
      </div>
      ${(mine ? defWhy : atkWhy) ? `<div class="why">${esc(mine ? defWhy : atkWhy)}</div>` : ''}
      ${o >= 0 ? `<div class="popup-links"><button type="button" class="link-btn" id="btnInfo">🏫 ${esc(short(hs >= 0 ? hs : o))} 정보</button>${homeLink(hs >= 0 ? hs : o)}</div>` : ''}`;
    box.hidden = false;
    if ($('#btnInfo')) $('#btnInfo').onclick = () => openSchool(hs >= 0 ? hs : o);
    $('#popClose').onclick = () => select(-1);
    $('#btnAtk').onclick = () => doAttack(i);
    $('#btnDef').onclick = () => openDefense(i);
  }

  // 학교 홈페이지: 주소를 알면 바로, 모르면 검색으로 찾아 준다
  const safeUrl = u => (/^https?:\/\//.test(u || '') ? u : '');
  function homeLink(sid) {
    const s = schools[sid];
    if (!s) return '';
    const url = safeUrl(s.url);
    return url ? `<a class="link-btn home" href="${esc(url)}" target="_blank" rel="noopener noreferrer">🌐 학교 홈페이지</a>`
      : `<a class="link-btn" href="https://search.naver.com/search.naver?query=${encodeURIComponent(`${s.sido} ${s.name} 홈페이지`)}" target="_blank" rel="noopener noreferrer">🔎 홈페이지 찾기</a>`;
  }
  async function openSchool(sid) {
    const d = await api('/api/school?id=' + sid);
    if (d.error) return toast(d.error, 'err');
    $('#scName').innerHTML = `<i class="sw" style="background:${cssColor(sid)}"></i>${esc(d.name)}`;
    const mem = d.members.map(m => `<li class="${m.me ? 'me' : ''}"><i class="dot ${m.online ? 'on' : ''}"></i><span class="nm">${esc(m.nick)}</span><small>뺏은 땅 ${m.captures} · 문제 ${m.solved}</small></li>`).join('');
    $('#scBody').innerHTML = `
      <p class="muted">📍 ${esc(d.sido)} ${esc(d.sigungu)} · ${me.grade}학년 서버</p>
      <div class="stats"><div><b>${d.land}</b><span>땅</span></div><div><b>${d.rank ? d.rank + '위' : '-'}</b><span>학교 순위</span></div><div><b>${d.def}</b><span>방어 합계</span></div></div>
      <div class="row">${homeLink(sid)}<button type="button" class="link-btn" id="scGo">🗺️ 지도에서 보기</button></div>
      <h4>🧒 함께하는 친구 ${d.memberCount}명</h4>
      <ul class="members">${mem || '<li class="muted">아직 이 학교로 들어온 친구가 없어요.</li>'}</ul>`;
    $('#scGo').onclick = () => { closeM('schoolModal'); const h = W.home[sid]; if (h >= 0) { flyTo(h, Math.max(view.s, 0.5)); select(h); $('#side').classList.remove('open'); } };
    openM('schoolModal');
  }

  // 새 배지 알림
  function gotBadges(ids) {
    (ids || []).forEach((id, k) => {
      const b = S.BADGES.find(x => x.id === id);
      if (!b) return;
      if (me && !me.badges.includes(id)) me.badges.push(id);
      setTimeout(() => { toast(`🏅 새 배지! ${b.icon} ${b.name}`, 'ok'); Sound.play('unlock'); confetti(innerWidth / 2, innerHeight * 0.3, 60); }, 900 + k * 1200);
    });
  }

  function celebrate(i) {
    confetti(vw / 2 + $('#mapWrap').getBoundingClientRect().left, innerHeight * 0.45);
    flashes.push({ i, t: performance.now() });
    requestDraw();
  }
  function afterAction(r, okMsg, i, kind) {
    if (!r || r.error) { if (r && r.error) toast(r.error, 'err'); return false; }
    if (r.cells) applyCells(r.cells, true);
    if (r.stats) me.stats = r.stats;
    gotBadges(r.badges);
    toast(okMsg, 'ok');
    if (kind === 'capture') { Sound.play('capture'); celebrate(i); } else { Sound.play('defend'); flashes.push({ i, t: performance.now() }); requestDraw(); }
    if (!$('#panePlayers').hidden) loadPlayers();
    return true;
  }
  async function doAttack(i) {
    const prev = W.owner[i];
    const okMsg = prev < 0 ? '🎉 빈 땅을 차지했어요!' : `⚔️ ${short(prev)}의 땅을 빼앗았어요!`;
    if (cheat.capture) return afterAction(await api('/api/capture', { cell: i, cheat: true }), '🐛 ' + okMsg, i, 'capture');
    startQuiz({
      title: '⚔️ 땅 뺏기', total: needToTake(i),
      onDone: async solved => {
        const r = await api('/api/capture', { cell: i, solved, streak: best });
        if (r.need) return { more: r.need, msg: `🛡️ 상대가 방어를 올렸어요! 문제 ${r.need}개를 더 풀어야 해요.` };
        afterAction(r, okMsg, i, 'capture');
      },
    });
  }

  let defCell = -1;
  function openDefense(i) {
    defCell = i;
    $('#defInfo').innerHTML = `지금 이 땅의 방어: <b>${W.def[i]}</b>`;
    setDefNum(+$('#defNum').value || 3);
    openM('defModal');
  }
  function setDefNum(n) {
    n = Math.max(1, Math.min(20, Math.round(n) || 1));
    $('#defNum').value = n;
    const now = W ? W.def[defCell] || 0 : 0, after = Math.min(99, now + n);
    $('#defAfter').innerHTML = `문제 <b>${n}개</b>를 풀면 방어가 ${now} → <b>${after}</b>이 돼요.<br>다른 학교는 이 땅을 뺏으려면 문제를 <b>${Math.max(2, after)}개</b> 풀어야 해요.`;
  }
  function initDefense() {
    $('#defMinus').onclick = () => setDefNum(+$('#defNum').value - 1);
    $('#defPlus').onclick = () => setDefNum(+$('#defNum').value + 1);
    $('#defNum').oninput = () => setDefNum(+$('#defNum').value);
    $$('.quick button').forEach(b => { b.onclick = () => setDefNum(+b.dataset.n); });
    $('#defGo').onclick = async () => {
      const i = defCell, n = +$('#defNum').value;
      closeM('defModal');
      const okMsg = `🛡️ 방어 +${n}! 우리 땅이 더 튼튼해졌어요.`;
      if (cheat.defend) return afterAction(await api('/api/defend', { cell: i, amount: n, cheat: true }), '🐛 ' + okMsg, i, 'defend');
      startQuiz({ title: `🛡️ 땅 방어하기 (+${n})`, total: n, onDone: async solved => { afterAction(await api('/api/defend', { cell: i, amount: n, solved, streak: best }), okMsg, i, 'defend'); } });
    };
  }

  // ---------- 문제 풀기 ----------
  let quiz = null;
  const coarse = matchMedia('(pointer: coarse)').matches;
  function startQuiz(opts) {
    quiz = Object.assign({ solved: 0 }, opts);
    openM('quizModal');
    nextProblem();
  }
  function renderStreak() {
    const el = $('#qzStreak');
    el.hidden = streak < 2;
    el.textContent = `🔥 ${streak}연속!`;
  }
  function nextProblem() {
    const p = quiz.p = quiz.fixed ? quiz.fixed[quiz.solved] : P.generate(me.grade, me.profile.semester);
    quiz.noted = false;
    quiz.busy = false;
    $('#qzTitle').textContent = quiz.title;
    $('#qzCount').textContent = `문제 ${quiz.solved + 1} / ${quiz.total}`;
    $('#qzBar').style.width = (quiz.solved / quiz.total) * 100 + '%';
    $('#qzQ').innerHTML = fmt(p.q);
    $('#qzFeedback').textContent = '';
    $('#qzFeedback').className = 'feedback';
    $('#qzHintBtn').hidden = true;
    $('#qzHint').hidden = true;
    $('#qzHint').innerHTML = '💡 ' + fmt(p.hint);
    renderStreak();
    if (p.choices) {
      $('#qzAnswer').innerHTML = `<div class="choices">${p.choices.map(c => `<button type="button" class="choice" data-v="${esc(c)}">${fmt(/^\d+\/\d+$/.test(c) ? `{${c}}` : c)}</button>`).join('')}</div>`;
      $('#qzPad').hidden = true;
    } else {
      $('#qzAnswer').innerHTML = `<form id="qzForm" class="answer-row">
        <input id="qzInput" autocomplete="off" inputmode="${coarse ? 'none' : p.frac ? 'text' : 'decimal'}" placeholder="${p.frac ? '예: 3/4 또는 2와 1/3' : '답을 써요'}">
        ${p.unit ? `<span class="unit">${esc(p.unit)}</span>` : ''}<button class="btn primary">확인</button></form>`;
      $('#qzForm').onsubmit = e => { e.preventDefault(); answer($('#qzInput').value); };
      const keys = ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '.', '0', '/', '와', '확인'];
      $('#qzPad').innerHTML = keys.map(k => `<button type="button" data-k="${k}" class="${k === '확인' ? 'go' : /\d/.test(k) ? '' : 'op'}">${k}</button>`).join('');
      $('#qzPad').hidden = false;
      if (!coarse) setTimeout(() => { const el = $('#qzInput'); if (el) el.focus(); }, 60);
    }
  }
  function feedback(msg, kind) {
    const f = $('#qzFeedback');
    f.textContent = msg;
    f.className = 'feedback ' + kind;
    void f.offsetWidth;
    f.classList.add('pop');
  }
  function answer(v) {
    if (!quiz || quiz.busy || !String(v).trim()) return;
    const res = P.check(quiz.p, v);
    if (res === true) {
      quiz.busy = true;
      quiz.solved++;
      streak++;
      best = Math.max(best, streak);
      Sound.play('ok', streak);
      renderStreak();
      $('#qzBar').style.width = (quiz.solved / quiz.total) * 100 + '%';
      feedback('⭕ ' + PRAISE[Math.floor(Math.random() * PRAISE.length)], 'ok');
      setTimeout(quiz.solved >= quiz.total ? finishQuiz : nextProblem, 700);
    } else {
      streak = 0;
      renderStreak();
      Sound.play('bad');
      feedback(res === 'simplest' ? '🤏 거의 맞았어요! 더 이상 약분할 수 없게(기약분수로) 써 주세요.' : '❌ 틀렸어요! 다시 풀어 보세요.', 'bad');
      $('#qzHintBtn').hidden = false;
      if (!quiz.fixed && !quiz.noted) { // 처음 틀린 문제는 오답 노트에
        quiz.noted = true;
        const { q, a, hint, unit, frac, simplest, choices } = quiz.p;
        api('/api/wrong', { p: { q, a, hint, unit, frac, simplest, choices }, given: String(v).slice(0, 30) }).then(r => { if (r.count != null) setWrongCount(r.count); });
      }
      const el = $('#qzInput');
      if (el) { if (!coarse) el.select(); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    }
  }
  async function finishQuiz() {
    const q = quiz;
    if (!q) return;
    const r = await q.onDone(q.solved);
    if (quiz !== q) return;
    if (r && r.more) { q.total += r.more; toast(r.msg, 'warn'); nextProblem(); return; }
    closeQuiz();
  }
  function closeQuiz() {
    const q = quiz;
    quiz = null;
    closeM('quizModal');
    if (q && q.practice && q.solved > 0) reportPractice(q.solved);
  }
  async function reportPractice(n) {
    const r = await api('/api/practice', { solved: n, streak: best });
    if (r.error) return;
    me.stats = r.stats;
    toast(`✏️ 연습 끝! 문제 ${n}개를 풀었어요.`, 'ok');
    gotBadges(r.badges);
  }
  function startPractice() {
    startQuiz({ title: '✏️ 연습하기', total: 10, practice: true, onDone: () => { Sound.play('capture'); confetti(innerWidth / 2, innerHeight * 0.4); } });
  }

  // 오답 노트
  function setWrongCount(n) { wrongN = n; $('#wrongCount').hidden = !n; $('#wrongCount').textContent = n; }
  async function openWrong() {
    const d = await api('/api/wrong');
    if (d.error) return toast(d.error, 'err');
    setWrongCount(d.list.length);
    $('#wrongList').innerHTML = d.list.length ? d.list.map(w => `
      <div class="wrong-item" data-id="${esc(w.id)}">
        <div class="wq">${fmt(w.p.q)}</div>
        <div class="wa"><span class="bad">내 답: ${esc(w.given || '-')}</span><span class="ok">정답: ${fmt(P.answerText(w.p))}</span></div>
        <div class="wh">💡 ${fmt(w.p.hint)}</div>
        <div class="row end"><button type="button" class="btn small" data-act="del">지우기</button><button type="button" class="btn primary small" data-act="retry">다시 풀기</button></div>
      </div>`).join('') : '<p class="pad muted">틀린 문제가 없어요. 대단해요! 🎉</p>';
    $('#wrongList').onclick = async e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.closest('[data-id]').dataset.id, item = d.list.find(w => w.id === id);
      if (b.dataset.act === 'del') { const r = await api('/api/wrong/remove', { id }); if (!r.error) { setWrongCount(r.count); b.closest('.wrong-item').remove(); } return; }
      closeM('wrongModal');
      startQuiz({ title: '📒 다시 풀기', total: 1, fixed: [item.p], onDone: async () => { const r = await api('/api/wrong/remove', { id }); if (!r.error) setWrongCount(r.count); toast('📒 이제 맞혔어요! 오답 노트에서 지웠어요.', 'ok'); } });
    };
    openM('wrongModal');
  }

  // 배지와 기록
  function openBadges() {
    const st = me.stats || {}, have = new Set(me.badges || []);
    $('#badgeStats').innerHTML = `<div><b>${st.solved || 0}</b><span>푼 문제</span></div><div><b>${st.captures || 0}</b><span>차지한 땅</span></div><div><b>${st.bestStreak || 0}</b><span>최고 연속 정답</span></div><div><b>${st.days || 0}일</b><span>출석 (연속 ${st.dayStreak || 0}일)</span></div>`;
    $('#badgeGrid').innerHTML = S.BADGES.map(b => {
      const v = Math.min(st[b.key] || 0, b.n), on = have.has(b.id);
      return `<div class="badge ${on ? 'on' : ''}"><div class="bi">${b.icon}</div><b>${esc(b.name)}</b><small>${esc(b.desc)}</small>${on ? '<em>받았어요!</em>' : `<div class="bp"><i style="width:${(v / b.n) * 100}%"></i></div><small>${v} / ${b.n}</small>`}</div>`;
    }).join('');
    openM('badgeModal');
  }

  // 빠른 채팅
  function chatLine(m) {
    const li = document.createElement('li'), mine = m.sid === mySid();
    li.className = 'chat' + (m.ch === 'school' ? ' school' : '');
    li.innerHTML = `<span class="t">${new Date(m.at).toTimeString().slice(0, 5)}</span><span class="ch">${m.ch === 'school' ? '🏫' : '🌐'}</span><b style="color:${mine ? '#b45309' : cssColor(m.sid)}">${esc(m.by)}</b><small>${esc(short(m.sid))}</small> ${esc(S.CHAT[m.m] || '')}`;
    $('#feed').prepend(li);
    while ($('#feed').children.length > 60) $('#feed').lastChild.remove();
    if ($('#paneFeed').hidden) $('#feedDot').hidden = false;
  }
  function initQuiz() {
    $('#qzAnswer').addEventListener('click', e => { const b = e.target.closest('.choice'); if (b) answer(b.dataset.v); });
    $('#qzPad').addEventListener('click', e => {
      const b = e.target.closest('[data-k]'), el = $('#qzInput');
      if (!b || !el) return;
      const k = b.dataset.k;
      Sound.play('tap');
      if (k === '확인') return answer(el.value);
      if (k === '⌫') el.value = el.value.slice(0, -1);
      else if (k === 'C') el.value = '';
      else el.value += k;
    });
    $('#qzHintBtn').onclick = () => { $('#qzHint').hidden = false; };
    let closeAsk = 0;
    $('#qzClose').onclick = () => { // 확인 창 대신 한 번 더 누르기
      if (!quiz || quiz.solved === 0 || quiz.practice || Date.now() - closeAsk < 3000) { closeAsk = 0; return closeQuiz(); }
      closeAsk = Date.now();
      feedback('그만하려면 ✕ 를 한 번 더 누르세요. 지금까지 푼 문제는 사라져요.', 'bad');
    };
  }

  // ---------- 월드 / 실시간 ----------
  async function loadWorld() {
    const d = await api('/api/world');
    if (d.error) { toast(d.error, 'err'); return false; }
    if (d.owner.length !== G.n) { toast('지도가 새로 바뀌었어요. 새로고침 해 주세요.', 'err'); return false; }
    mergeCustom(d.custom);
    W = { owner: Int32Array.from(d.owner), def: new Int32Array(G.n), home: d.home.slice(), homeCell: new Int32Array(G.n).fill(-1) };
    defended = new Set();
    d.def.forEach(([i, v]) => { W.def[i] = v; defended.add(i); });
    owned = new Set();
    W.owner.forEach((o, i) => { if (o >= 0) owned.add(i); });
    W.home.forEach((c, sid) => { if (c >= 0) W.homeCell[c] = sid; });
    online = d.online || 0;
    if (d.stats) me.stats = d.stats;
    colorCache.clear();
    tiles.clear();
    computeFrontier();
    return d;
  }
  async function startGame() {
    show('game');
    sel = -1;
    renderPopup();
    $('#feed').innerHTML = '';
    const d = await loadWorld();
    if (!d) return;
    (d.chat || []).forEach(chatLine);
    if (d.attend) setTimeout(() => toast(`📅 출석 체크! ${d.attend.days}일째${d.attend.streak > 1 ? ` (${d.attend.streak}일 연속)` : ''}`, 'ok'), 1200);
    gotBadges(d.badges);
    api('/api/wrong').then(r => { if (r.list) setWrongCount(r.list.length); });
    if (!store.get('mle_tut')) { store.set('mle_tut', '1'); setTimeout(() => openM('helpModal'), 900); }
    hud();
    updateBoard();
    renderMini();
    connectEvents();
    const h = W.home[mySid()];
    if (h >= 0) { fitView(); setTimeout(() => flyTo(h, 0.55), 350); } else fitView();
  }
  function connectEvents() {
    if (es) es.close();
    if (window.MLEBackend) {
      es = { close: window.MLEBackend.listen(token, onEvent) };
      $('#conn span').textContent = window.MLEBackend.isShared() ? '친구들과 함께' : '혼자 하기 (이 기기)';
      return;
    }
    let broken = false;
    es = new EventSource('/api/events?token=' + encodeURIComponent(token));
    es.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onEvent(m); };
    es.onerror = () => { broken = true; $('#conn').classList.add('off'); $('#conn span').textContent = '연결 끊김'; };
    es.onopen = () => {
      $('#conn').classList.remove('off');
      $('#conn span').textContent = '연결됨';
      if (broken) { broken = false; loadWorld().then(ok => { if (ok) { updateBoard(); renderPopup(); renderMini(); requestDraw(); } }); }
    };
  }
  function onEvent(m) {
    if (!W) return;
    if (m.t === 'online') { online = m.n; hud(); return; }
    if (m.t === 'chat') { chatLine(m); if (m.sid !== mySid() && m.ch === 'school') Sound.play('tap'); return; }
    if (m.t !== 'upd') return;
    if (m.school) { schools[m.school.id] = m.school; W.home[m.school.id] = m.home; if (m.home >= 0) W.homeCell[m.home] = m.school.id; }
    if (m.cells) {
      applyCells(m.cells);
      const bad = m.ev && m.ev.kind === 'capture' && m.ev.prev === mySid() && m.ev.sid !== mySid();
      for (const [i] of m.cells) flashes.push({ i, t: performance.now(), bad });
    }
    if (m.ev) feed(m.ev);
  }
  function applyCells(cells, mineAction) {
    for (const [i, o, d] of cells) {
      W.owner[i] = o; W.def[i] = d;
      if (d > 0) defended.add(i); else defended.delete(i);
      if (o >= 0) owned.add(i); else owned.delete(i);
      invalidateCell(i);
    }
    computeFrontier();
    requestDraw();
    scheduleBoard();
    scheduleMini();
    if (sel >= 0) renderPopup();
    if (mineAction) renderMini();
  }
  function computeFrontier() {
    const my = mySid();
    frontier = new Set();
    for (let i = 0; i < G.n; i++) {
      if (W.owner[i] !== my) continue;
      for (const n of G.nb[i]) if (W.owner[n] !== my && W.homeCell[n] < 0) frontier.add(n);
    }
  }
  function feed(ev) {
    const my = mySid(), who = `${ev.by}(${short(ev.sid)})`;
    let txt, cls = ev.sid === my ? 'mine' : '';
    if (ev.kind === 'capture') txt = ev.prev >= 0 ? `⚔️ ${who}님이 ${short(ev.prev)}의 땅을 빼앗았어요!` : `🌱 ${who}님이 빈 땅을 차지했어요.`;
    else if (ev.kind === 'defend') txt = `🛡️ ${who}님이 땅을 방어했어요 (+${ev.amount})`;
    else if (ev.kind === 'join') txt = `🏫 ${short(ev.sid)}가 지도에 나타났어요!`;
    else return;
    if (ev.kind === 'capture' && ev.prev === my && ev.sid !== my) { cls = 'alert'; toast(`😱 ${short(ev.sid)}에게 우리 땅을 빼앗겼어요!`, 'warn'); Sound.play('lose'); }
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${new Date().toTimeString().slice(0, 5)}</span>${esc(txt)}`;
    li.className = cls;
    if (ev.cell >= 0) li.onclick = () => { flyTo(ev.cell, Math.max(view.s, 0.5)); select(ev.cell); $('#side').classList.remove('open'); };
    $('#feed').prepend(li);
    while ($('#feed').children.length > 40) $('#feed').lastChild.remove();
    if ($('#paneFeed').hidden) $('#feedDot').hidden = false;
  }
  function hud() {
    if (!me || !me.profile) return;
    $('#hudServer').textContent = `🌐 ${me.grade}학년 서버`;
    $('#hudOnline').innerHTML = `<i></i>${online}명 접속 중`;
    $('#hudSchool').textContent = short(mySid());
    $('#hudUser').textContent = `😀 ${me.profile.nickname} · ${me.grade}-${me.profile.semester}`;
    $('#cheatBadge').hidden = !(cheat.capture || cheat.defend);
    $('#btnSound').textContent = Sound.on ? '🔊' : '🔇';
  }
  let boardTimer = null;
  function scheduleBoard() { if (!boardTimer) boardTimer = setTimeout(() => { boardTimer = null; updateBoard(); }, 300); }
  function updateBoard() {
    if (!W) return;
    const cnt = new Map();
    for (let i = 0; i < G.n; i++) { const o = W.owner[i]; if (o >= 0) cnt.set(o, (cnt.get(o) || 0) + 1); }
    const arr = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const my = mySid(), rank = arr.findIndex(e => e[0] === my) + 1, mine = cnt.get(my) || 0;
    const medal = k => ['🥇', '🥈', '🥉'][k] || k + 1;
    $('#board').innerHTML = arr.slice(0, 10).map(([sid, n], k) =>
      `<li class="${sid === my ? 'me' : ''}" data-sid="${sid}"><span class="rk">${medal(k)}</span><i style="background:${cssColor(sid)}"></i><span class="nm">${esc(short(sid))}</span><b>${n}</b></li>`).join('');
    $('#myRank').innerHTML = `⭐ 우리 학교 <b>${rank || '-'}위</b> · 땅 <b>${mine}</b>칸 · 뺏을 수 있는 땅 <b>${frontier.size}</b>칸`;
    $('#hudLand').textContent = mine;
    $('#hudRank').textContent = rank || '-';
  }
  async function loadPlayers() {
    const d = await api('/api/players');
    if (d.error) return;
    const medal = k => ['🥇', '🥈', '🥉'][k] || k + 1;
    $('#players').innerHTML = d.top.length ? d.top.map((p, k) =>
      `<li class="${p.me ? 'me' : ''}"><span class="rk">${medal(k)}</span><i style="background:${cssColor(p.sid)}"></i><span class="nm">${esc(p.nick)} <small>${esc(short(p.sid))}</small></span><b>${p.captures}</b></li>`).join('') : '<li class="muted">아직 아무도 없어요</li>';
    $('#myPlayer').innerHTML = `😀 나 <b>${d.rank || '-'}위</b> / ${d.total}명 · 뺏은 땅 <b>${me.stats.captures}</b> · 푼 문제 <b>${me.stats.solved}</b>`;
  }

  // ---------- 설정 + 비밀 버그 창 ----------
  let schoolClicks = 0, bugClicks = 0;
  function openSettings() {
    schoolClicks = bugClicks = 0;
    const s = schools[mySid()], st = me.stats || {};
    $('#setInfo').innerHTML = `
      <div>👤 아이디: <b>${esc(me.username)}</b></div>
      <div>🎂 나이 인증: <b>${me.birthYear}년생</b> → <b>${me.grade}학년</b> (${me.grade}학년 서버)</div>
      <div>🏫 학교: <b>${esc(s ? s.name : '')}</b> <span class="muted">${esc(s ? s.sido + ' ' + s.sigungu : '')}</span></div>`;
    $('#setStats').innerHTML = `<div><b>${st.solved || 0}</b><span>푼 문제</span></div><div><b>${st.captures || 0}</b><span>뺏은 땅</span></div><div><b>${st.defends || 0}</b><span>올린 방어</span></div>`;
    $$('.sem2').forEach(b => b.classList.toggle('on', +b.dataset.sem === me.profile.semester));
    $('#setNick').value = me.profile.nickname;
    $('#secretBug').hidden = !cheat.unlocked;
    openM('settingsModal');
  }
  async function saveProfile(patch) {
    const d = await api('/api/profile', Object.assign({ schoolId: me.profile.schoolId, semester: me.profile.semester, nickname: me.profile.nickname }, patch));
    if (d.error) { toast(d.error, 'err'); return false; }
    me = d.user;
    hud();
    return true;
  }
  function renderBug() {
    $('#bugCapture').textContent = `⚔️ 문제 안풀고 땅 뺏기 : ${cheat.capture ? '켜짐 ✅' : '꺼짐'}`;
    $('#bugDefend').textContent = `🛡️ 문제 안풀고 땅 방어하기 : ${cheat.defend ? '켜짐 ✅' : '꺼짐'}`;
    $('#bugCapture').classList.toggle('on', cheat.capture);
    $('#bugDefend').classList.toggle('on', cheat.defend);
    hud();
  }
  function wiggle(el) { el.classList.remove('tap'); void el.offsetWidth; el.classList.add('tap'); }
  function initSettings() {
    $('#btnSettings').onclick = openSettings;
    $('#btnHelp').onclick = () => openM('helpModal');
    $('#setHelp').onclick = () => { closeM('settingsModal'); openM('helpModal'); };
    $('#setMySchool').onclick = () => { closeM('settingsModal'); openSchool(mySid()); };
    $('#btnPractice').onclick = startPractice;
    $('#btnWrong').onclick = openWrong;
    $('#btnBadges').onclick = openBadges;
    $('#pwSave').onclick = async () => {
      const r = await api('/api/password', { old: $('#pwOld').value, password: $('#pwNew').value });
      if (r.error) return toast(r.error, 'err');
      $('#pwOld').value = $('#pwNew').value = '';
      toast('🔑 비밀번호를 바꿨어요.', 'ok');
    };
    $('#btnBoard').onclick = () => $('#side').classList.toggle('open');
    $('#btnSound').onclick = () => { Sound.toggle(); hud(); Sound.play('tap'); };
    $$('.sem2').forEach(b => { b.onclick = async () => { if (await saveProfile({ semester: +b.dataset.sem })) { $$('.sem2').forEach(x => x.classList.toggle('on', x === b)); toast(`${b.dataset.sem}학기 문제가 나와요.`, 'ok'); } }; });
    $('#setNickSave').onclick = async () => { if (await saveProfile({ nickname: $('#setNick').value.trim() })) toast('닉네임을 바꿨어요.', 'ok'); };
    $('#setSchool').onclick = () => { closeM('settingsModal'); if (es) { es.close(); es = null; } W = null; openSetup(); };
    $('#setLogout').onclick = async () => { await api('/api/logout', {}); logoutLocal(); };
    $('#secretSchool').onclick = e => {
      wiggle(e.currentTarget);
      if (cheat.unlocked) return;
      if (++schoolClicks >= 10) { schoolClicks = 0; $('#pwInput').value = ''; setErr('#pwErr'); openM('pwModal'); setTimeout(() => $('#pwInput').focus(), 50); }
    };
    $('#pwForm').onsubmit = async e => {
      e.preventDefault();
      const d = await api('/api/debug/unlock', { password: $('#pwInput').value });
      if (d.error) { Sound.play('bad'); return setErr('#pwErr', d.error); }
      cheat.unlocked = true;
      closeM('pwModal');
      $('#secretBug').hidden = false;
      Sound.play('unlock');
      toast('🔓 잠금이 풀렸어요!', 'ok');
    };
    $('#secretBug').onclick = e => {
      wiggle(e.currentTarget);
      if (++bugClicks >= 10) { bugClicks = 0; renderBug(); openM('bugModal'); }
    };
    $('#bugCapture').onclick = () => { cheat.capture = !cheat.capture; renderBug(); };
    $('#bugDefend').onclick = () => { cheat.defend = !cheat.defend; renderBug(); };
  }

  function initGameUi() {
    $('#zIn').onclick = () => zoomAt(vw / 2, vh / 2, view.s * 1.6);
    $('#zOut').onclick = () => zoomAt(vw / 2, vh / 2, view.s / 1.6);
    $('#zHome').onclick = goHome;
    $('#zFit').onclick = fitView;
    const jumpToSchool = sid => {
      const h = W && W.home[sid];
      if (h >= 0) { flyTo(h, Math.max(view.s, 0.5)); select(h); $('#side').classList.remove('open'); }
      else toast('이 학교는 아직 이 서버 지도에 없어요.', 'warn');
    };
    $('#board').onclick = e => { const li = e.target.closest('[data-sid]'); if (li) openSchool(+li.dataset.sid); };
    $('#chatBtns').innerHTML = S.CHAT.map((t, k) => `<button type="button" data-m="${k}">${esc(t)}</button>`).join('');
    $('#chatBtns').onclick = async e => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const r = await api('/api/chat', { ch: chatCh, m: +b.dataset.m });
      if (r.error) toast(r.error, 'warn'); else Sound.play('tap');
    };
    $$('.chch').forEach(b => { b.onclick = () => { chatCh = b.dataset.ch; $$('.chch').forEach(x => x.classList.toggle('on', x === b)); }; });
    $('#findSchool').oninput = () => {
      const res = searchSchools($('#findSchool').value, 8);
      $('#findList').innerHTML = res.map(s => `<button type="button" data-sid="${s.id}"><b>${esc(s.name)}</b><span>${esc(s.sido)} ${esc(s.sigungu)}</span></button>`).join('');
    };
    $('#findList').onclick = e => { const b = e.target.closest('[data-sid]'); if (b) { jumpToSchool(+b.dataset.sid); $('#findSchool').value = ''; $('#findList').innerHTML = ''; } };
    $$('.stab').forEach(t => { t.onclick = () => {
      $$('.stab').forEach(x => x.classList.toggle('on', x === t));
      $$('.pane').forEach(p => { p.hidden = p.id !== t.dataset.pane; });
      if (t.dataset.pane === 'panePlayers') loadPlayers();
      if (t.dataset.pane === 'paneFeed') $('#feedDot').hidden = true;
    }; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !quiz) { $$('.modal').forEach(m => { m.hidden = true; }); select(-1); } });
  }

  // ---------- 시작 ----------
  async function boot() {
    try { await loadMap(); } catch (e) { $('#loadMsg').textContent = '😢 ' + (e.message || '지도를 불러오지 못했어요.') + ' 새로고침 해 주세요.'; return; }
    initAuth(); initSetup(); initGameUi(); initDefense(); initQuiz(); initSettings();
    if (!token) return show('auth');
    const d = await api('/api/me');
    if (!d.user) { show('auth'); if (d.error) toast(d.error, 'err'); return; }
    me = d.user;
    cheat.unlocked = !!d.debug;
    route();
  }
  boot();
})();
