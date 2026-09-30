/* 매뜨 땅먹 — 화면, 지도, 문제 풀기 */
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

  const grid = S.buildGrid(), L = grid.cc.length, COLS = grid.cols, ROWS = grid.rows;
  const BASE = S.baseSchools();
  let schools = BASE.slice();
  let token = store.get('mle_token'), me = null, W = null, es = null, online = 0, sel = -1;
  const cheat = { unlocked: false, capture: false, defend: false };
  const mySid = () => (me && me.profile ? me.profile.schoolId : -1);
  const short = sid => (schools[sid] ? schools[sid].name.replace(/초등학교$/, '초') : '어떤 학교');
  const needToTake = i => (W.owner[i] < 0 ? 2 : Math.max(2, W.def[i]));

  // ---------- 공통 ----------
  async function api(path, body) {
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
  const setErr = (sel_, msg) => { $(sel_).textContent = msg || ''; };
  const mergeCustom = list => (list || []).forEach(c => { schools[c.id] = c; });

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
    cheat.unlocked = cheat.capture = cheat.defend = false;
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
    $('#stCSido').innerHTML = S.SIDOS.map(s => `<option>${esc(s)}</option>`).join('');
    const fillSigungu = () => {
      $('#stCSigungu').innerHTML = S.DISTRICTS.map((d, i) => (d.sido === $('#stCSido').value ? `<option value="${i}">${esc(d.sigungu)}</option>` : '')).join('');
    };
    $('#stCSido').onchange = fillSigungu;
    fillSigungu();
    $$('.sem').forEach(b => { b.onclick = () => setSemester(+b.dataset.sem); });
    $('#stBack').onclick = () => startGame();
    $('#setupForm').onsubmit = async e => {
      e.preventDefault();
      const body = { semester, nickname: $('#stNick').value.trim() };
      const cname = $('#stCName').value.trim();
      if (!$('#stCustom').hidden && cname) body.custom = { di: +$('#stCSigungu').value, name: cname };
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
  function renderSchoolList() {
    const q = $('#stSearch').value.replace(/\s+/g, ''), box = $('#stList');
    if (!q) { box.innerHTML = '<div class="muted pad">학교 이름이나 지역을 검색해 보세요.</div>'; return; }
    const res = [];
    for (const s of schools) {
      if (s && (s.name + s.sido + s.sigungu).includes(q)) res.push(s);
      if (res.length >= 60) break;
    }
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

  // ---------- 지도 그리기 ----------
  const cv = $('#map'), ctx = cv.getContext('2d');
  const mapCv = document.createElement('canvas');
  mapCv.width = COLS; mapCv.height = ROWS;
  const mctx = mapCv.getContext('2d'), img = mctx.createImageData(COLS, ROWS);
  const SEA = '#9fd6f2', NEUTRAL = [236, 230, 204], MINE = [255, 196, 0];
  const view = { s: 4, x: 0, y: 0 };
  let vw = 0, vh = 0, dpr = 1, drawQueued = false;
  const colorCache = new Map();

  function hsl(h, s, l) {
    const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  }
  function rgbOf(sid) {
    if (sid < 0) return NEUTRAL;
    if (sid === mySid()) return MINE;
    let c = colorCache.get(sid);
    if (!c) {
      let h = (sid * 137.508) % 360;
      if (h > 35 && h < 70) h += 45; // 우리 학교 노란색과 헷갈리지 않게
      c = hsl(h, 0.55, 0.6);
      colorCache.set(sid, c);
    }
    return c;
  }
  const cssColor = sid => `rgb(${rgbOf(sid).join(',')})`;
  function paintCell(i) {
    const o = W.owner[i];
    let [r, g, b] = rgbOf(o);
    const f = ((grid.cc[i] + grid.rr[i]) & 1 ? 0.95 : 1) * (W.def[i] > 0 ? 0.78 : 1);
    const k = (grid.rr[i] * COLS + grid.cc[i]) * 4;
    img.data[k] = r * f; img.data[k + 1] = g * f; img.data[k + 2] = b * f; img.data[k + 3] = 255;
  }
  function paintAll() {
    img.data.fill(0);
    for (let i = 0; i < L; i++) paintCell(i);
    mctx.putImageData(img, 0, 0);
    requestDraw();
  }
  function resize() {
    const r = $('#mapWrap').getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    vw = r.width; vh = r.height;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    requestDraw();
  }
  window.addEventListener('resize', () => { if (!$('#game').hidden) resize(); });
  function requestDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); } }

  function label(text, x, y, size, strong) {
    ctx.font = `${strong ? 'bold ' : ''}${size}px Jua, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = strong ? '#b3261e' : '#222'; ctx.fillText(text, x, y);
  }
  function draw() {
    drawQueued = false;
    if (!W) return;
    const s = view.s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SEA; ctx.fillRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mapCv, view.x, view.y, COLS * s, ROWS * s);
    const c0 = Math.max(0, Math.floor(-view.x / s)), c1 = Math.min(COLS - 1, Math.floor((vw - view.x) / s));
    const r0 = Math.max(0, Math.floor(-view.y / s)), r1 = Math.min(ROWS - 1, Math.floor((vh - view.y) / s));
    if (s >= 6) { // 잘게 나뉜 땅 칸 선
      ctx.beginPath();
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (grid.idx[r * COLS + c] >= 0) ctx.rect(view.x + c * s + 0.5, view.y + r * s + 0.5, s - 1, s - 1);
      ctx.strokeStyle = 'rgba(60,50,30,.16)'; ctx.lineWidth = 1; ctx.stroke();
    }
    if (s >= 18) { // 방어 수
      ctx.font = `bold ${Math.floor(s * 0.34)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const k = grid.idx[r * COLS + c];
        if (k >= 0 && W.def[k] > 0 && W.homeCell[k] < 0) ctx.fillText('🛡' + W.def[k], view.x + (c + 0.5) * s, view.y + (r + 0.5) * s);
      }
    }
    const my = mySid(), fs = Math.max(11, Math.min(15, s * 0.7));
    for (let sid = 0; sid < W.home.length; sid++) {
      const h = W.home[sid];
      if (h < 0 || sid === my || s < 2.5) continue;
      const c = grid.cc[h], r = grid.rr[h];
      if (c < c0 - 1 || c > c1 + 1 || r < r0 - 1 || r > r1 + 1) continue;
      const x = view.x + (c + 0.5) * s, y = view.y + (r + 0.5) * s;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, s * 0.3), 0, 7);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = Math.max(1, s * 0.08); ctx.strokeStyle = '#333'; ctx.stroke();
      if (s >= 14) label(short(sid), x, y - s * 0.45, fs, false);
    }
    const mh = W.home[my];
    if (mh >= 0) {
      const x = view.x + (grid.cc[mh] + 0.5) * s, y = view.y + (grid.rr[mh] + 0.5) * s;
      ctx.beginPath(); ctx.arc(x, y, Math.max(4, s * 0.42), 0, 7);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.12); ctx.strokeStyle = '#e8553d'; ctx.stroke();
      label('⭐ ' + short(my), x, y - Math.max(5, s * 0.5), Math.max(13, fs), true);
    }
    if (sel >= 0) {
      ctx.lineWidth = Math.max(2, s * 0.14); ctx.strokeStyle = '#ff2d55';
      ctx.strokeRect(view.x + grid.cc[sel] * s, view.y + grid.rr[sel] * s, s, s);
    }
  }

  // ---------- 지도 움직이기 ----------
  const fitScale = () => Math.min(vw / COLS, vh / ROWS) * 0.96;
  const clampS = s => Math.max(fitScale() * 0.7, Math.min(48, s));
  function zoomAt(px, py, ns) {
    ns = clampS(ns);
    const wx = (px - view.x) / view.s, wy = (py - view.y) / view.s;
    view.s = ns; view.x = px - wx * ns; view.y = py - wy * ns;
    requestDraw();
  }
  function flyTo(c, r, s) {
    view.s = clampS(s || view.s);
    view.x = vw / 2 - (c + 0.5) * view.s;
    view.y = vh / 2 - (r + 0.5) * view.s;
    requestDraw();
  }
  function fitView() { view.s = fitScale(); view.x = (vw - COLS * view.s) / 2; view.y = (vh - ROWS * view.s) / 2; requestDraw(); }
  function goHome() { const h = W && W.home[mySid()]; if (h >= 0) flyTo(grid.cc[h], grid.rr[h], Math.max(view.s, 12)); }

  const pointers = new Map();
  let drag = null, pinch = null, moved = false;
  const pos = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pos(e));
    if (pointers.size === 1) { const p = pos(e); drag = { x: p.x, y: p.y, vx: view.x, vy: view.y }; moved = false; }
    else if (pointers.size === 2) { const st = pinchState(); pinch = { ...st, s: view.s, vx: view.x, vy: view.y }; moved = true; }
  });
  cv.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
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
      if (!moved && drag && e.type === 'pointerup') clickAt(p.x, p.y);
      drag = null; pinch = null;
    } else if (pointers.size === 1) {
      pinch = null;
      const q = [...pointers.values()][0];
      drag = { x: q.x, y: q.y, vx: view.x, vy: view.y };
    }
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', endPointer);
  cv.addEventListener('wheel', e => { e.preventDefault(); const p = pos(e); zoomAt(p.x, p.y, view.s * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });

  function clickAt(x, y) {
    if (!W) return;
    const c = Math.floor((x - view.x) / view.s), r = Math.floor((y - view.y) / view.s);
    const k = c >= 0 && r >= 0 && c < COLS && r < ROWS ? grid.idx[r * COLS + c] : -1;
    select(k);
  }
  function select(i) { sel = i; renderPopup(); requestDraw(); }

  // ---------- 땅 정보 창 (땅 뺏기 / 땅 방어하기) ----------
  function renderPopup() {
    const box = $('#popup');
    if (sel < 0 || !W) { box.hidden = true; return; }
    const i = sel, o = W.owner[i], d = W.def[i], hs = W.homeCell[i], my = mySid(), mine = o === my;
    const adj = S.neighbors(grid, i, true).some(n => W.owner[n] === my);
    const [lat, lon] = S.cellLatLon(grid, i), dist = S.nearestDistrict(lat, lon);
    const title = hs >= 0 ? (mine ? '🏫 우리 학교 본부' : `🏫 ${schools[hs].name} 본부`) : o < 0 ? '🌱 빈 땅' : mine ? '⭐ 우리 학교 땅' : `🚩 ${short(o)} 땅`;
    const atkWhy = mine ? '이미 우리 학교 땅이에요.' : hs >= 0 ? '학교 본부는 뺏을 수 없어요.' : !adj ? '우리 학교 땅과 닿아 있는 땅만 뺏을 수 있어요.' : '';
    const defWhy = !mine ? '우리 학교 땅만 방어할 수 있어요.' : hs >= 0 ? '본부는 언제나 안전해요.' : d >= 99 ? '방어가 가장 높아요(99).' : '';
    const lines = [`📍 ${esc(dist.sido)} ${esc(dist.sigungu)} 근처`];
    if (o >= 0 && !mine && schools[o]) lines.push(`주인: <b>${esc(schools[o].name)}</b>`);
    if (o >= 0 && hs < 0) lines.push(`🛡️ 방어: <b>${d}</b>`);
    if (!mine && hs < 0) lines.push(`⚔️ 뺏으려면 문제 <b>${needToTake(i)}개</b>`);
    box.innerHTML = `
      <div class="popup-head"><b>${esc(title)}</b><button type="button" class="icon-btn" id="popClose">✕</button></div>
      <div class="popup-info">${lines.join('<br>')}</div>
      <div class="popup-btns">
        <button type="button" class="btn attack" id="btnAtk" ${atkWhy ? 'disabled' : ''}>⚔️ 땅 뺏기</button>
        <button type="button" class="btn defend" id="btnDef" ${defWhy ? 'disabled' : ''}>🛡️ 땅 방어하기</button>
      </div>
      ${(mine ? defWhy : atkWhy) ? `<div class="why">${esc(mine ? defWhy : atkWhy)}</div>` : ''}`;
    box.hidden = false;
    $('#popClose').onclick = () => select(-1);
    $('#btnAtk').onclick = () => doAttack(i);
    $('#btnDef').onclick = () => openDefense(i);
  }

  function afterAction(r, okMsg) {
    if (!r || r.error) { if (r && r.error) toast(r.error, 'err'); return; }
    if (r.cells) applyCells(r.cells);
    toast(okMsg, 'ok');
  }
  async function doAttack(i) {
    const prev = W.owner[i];
    const okMsg = prev < 0 ? '🎉 빈 땅을 차지했어요!' : `⚔️ ${short(prev)}의 땅을 빼앗았어요!`;
    if (cheat.capture) return afterAction(await api('/api/capture', { cell: i, cheat: true }), '🐛 ' + okMsg);
    startQuiz({
      title: '⚔️ 땅 뺏기', total: needToTake(i),
      onDone: async solved => {
        const r = await api('/api/capture', { cell: i, solved });
        if (r.need) return { more: r.need, msg: `🛡️ 상대가 방어를 올렸어요! 문제 ${r.need}개를 더 풀어야 해요.` };
        afterAction(r, okMsg);
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
      if (cheat.defend) return afterAction(await api('/api/defend', { cell: i, amount: n, cheat: true }), '🐛 ' + okMsg);
      startQuiz({ title: `🛡️ 땅 방어하기 (+${n})`, total: n, onDone: async solved => { afterAction(await api('/api/defend', { cell: i, amount: n, solved }), okMsg); } });
    };
  }

  // ---------- 문제 풀기 ----------
  let quiz = null;
  function startQuiz(opts) {
    quiz = Object.assign({ solved: 0 }, opts);
    openM('quizModal');
    nextProblem();
  }
  function nextProblem() {
    const p = quiz.p = P.generate(me.grade, me.profile.semester);
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
    if (p.choices) {
      $('#qzAnswer').innerHTML = `<div class="choices">${p.choices.map(c => `<button type="button" class="choice" data-v="${esc(c)}">${fmt(/^\d+\/\d+$/.test(c) ? `{${c}}` : c)}</button>`).join('')}</div>`;
    } else {
      $('#qzAnswer').innerHTML = `<form id="qzForm" class="answer-row">
        <input id="qzInput" autocomplete="off" inputmode="${p.frac ? 'text' : 'decimal'}" placeholder="${p.frac ? '예: 3/4 또는 2와 1/3' : '답을 써요'}">
        ${p.unit ? `<span class="unit">${esc(p.unit)}</span>` : ''}<button class="btn primary">확인</button></form>`;
      $('#qzForm').onsubmit = e => { e.preventDefault(); answer($('#qzInput').value); };
      setTimeout(() => { const el = $('#qzInput'); if (el) el.focus(); }, 60);
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
      $('#qzBar').style.width = (quiz.solved / quiz.total) * 100 + '%';
      feedback('⭕ 정답이에요!', 'ok');
      setTimeout(quiz.solved >= quiz.total ? finishQuiz : nextProblem, 650);
    } else {
      feedback(res === 'simplest' ? '🤏 거의 맞았어요! 더 이상 약분할 수 없게(기약분수로) 써 주세요.' : '❌ 틀렸어요! 다시 풀어 보세요.', 'bad');
      $('#qzHintBtn').hidden = false;
      const el = $('#qzInput');
      if (el) { el.select(); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
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
  function closeQuiz() { quiz = null; closeM('quizModal'); }
  function initQuiz() {
    $('#qzAnswer').addEventListener('click', e => { const b = e.target.closest('.choice'); if (b) answer(b.dataset.v); });
    $('#qzHintBtn').onclick = () => { $('#qzHint').hidden = false; };
    $('#qzClose').onclick = () => { if (!quiz || quiz.solved === 0 || confirm('그만할까요? 지금까지 푼 문제는 사라져요.')) closeQuiz(); };
  }

  // ---------- 월드 / 실시간 ----------
  async function loadWorld() {
    const d = await api('/api/world');
    if (d.error) { toast(d.error, 'err'); return false; }
    if (d.landCount !== L) { toast('지도 정보가 서버와 달라요. 새로고침 해 주세요.', 'err'); return false; }
    mergeCustom(d.custom);
    W = { owner: Int32Array.from(d.owner), def: new Int32Array(L), home: d.home.slice(), homeCell: new Int32Array(L).fill(-1) };
    d.def.forEach(([i, v]) => { W.def[i] = v; });
    W.home.forEach((c, sid) => { if (c >= 0) W.homeCell[c] = sid; });
    online = d.online || 0;
    colorCache.clear();
    paintAll();
    return true;
  }
  async function startGame() {
    show('game');
    sel = -1;
    renderPopup();
    $('#feed').innerHTML = '';
    if (!(await loadWorld())) return;
    hud();
    updateBoard();
    connectEvents();
    const h = W.home[mySid()];
    if (h >= 0) flyTo(grid.cc[h], grid.rr[h], 12); else fitView();
  }
  function connectEvents() {
    if (es) es.close();
    let broken = false;
    es = new EventSource('/api/events?token=' + encodeURIComponent(token));
    es.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onEvent(m); };
    es.onerror = () => { broken = true; $('#conn').classList.add('off'); };
    es.onopen = () => {
      $('#conn').classList.remove('off');
      if (broken) { broken = false; loadWorld().then(ok => { if (ok) { updateBoard(); renderPopup(); } }); }
    };
  }
  function onEvent(m) {
    if (!W) return;
    if (m.t === 'online') { online = m.n; hud(); return; }
    if (m.t !== 'upd') return;
    if (m.school) { schools[m.school.id] = m.school; W.home[m.school.id] = m.home; if (m.home >= 0) W.homeCell[m.home] = m.school.id; }
    if (m.cells) applyCells(m.cells);
    if (m.ev) feed(m.ev);
  }
  function applyCells(cells) {
    for (const [i, o, d] of cells) { W.owner[i] = o; W.def[i] = d; paintCell(i); }
    mctx.putImageData(img, 0, 0);
    requestDraw();
    scheduleBoard();
    if (sel >= 0) renderPopup();
  }
  function feed(ev) {
    const my = mySid(), who = `${ev.by}(${short(ev.sid)})`;
    let txt, cls = ev.sid === my ? 'mine' : '';
    if (ev.kind === 'capture') txt = ev.prev >= 0 ? `⚔️ ${who}님이 ${short(ev.prev)}의 땅을 빼앗았어요!` : `🌱 ${who}님이 빈 땅을 차지했어요.`;
    else if (ev.kind === 'defend') txt = `🛡️ ${who}님이 땅을 방어했어요 (+${ev.amount})`;
    else if (ev.kind === 'join') txt = `🏫 ${short(ev.sid)}가 지도에 나타났어요!`;
    else return;
    if (ev.kind === 'capture' && ev.prev === my && ev.sid !== my) { cls = 'alert'; toast(`😱 ${short(ev.sid)}에게 우리 땅을 빼앗겼어요!`, 'warn'); }
    const li = document.createElement('li');
    li.textContent = txt;
    li.className = cls;
    if (ev.cell >= 0) li.onclick = () => { flyTo(grid.cc[ev.cell], grid.rr[ev.cell], Math.max(view.s, 14)); select(ev.cell); };
    $('#feed').prepend(li);
    while ($('#feed').children.length > 30) $('#feed').lastChild.remove();
  }
  function hud() {
    if (!me || !me.profile) return;
    $('#hudServer').textContent = `🌐 ${me.grade}학년 서버`;
    $('#hudOnline').textContent = `👥 ${online}명 접속 중`;
    $('#hudSchool').textContent = schools[mySid()] ? schools[mySid()].name : '';
    $('#hudUser').textContent = `😀 ${me.profile.nickname} · ${me.grade}학년 ${me.profile.semester}학기`;
    $('#cheatBadge').hidden = !(cheat.capture || cheat.defend);
  }
  let boardTimer = null;
  function scheduleBoard() { if (!boardTimer) boardTimer = setTimeout(() => { boardTimer = null; updateBoard(); }, 300); }
  function updateBoard() {
    if (!W) return;
    const cnt = new Map();
    for (let i = 0; i < L; i++) { const o = W.owner[i]; if (o >= 0) cnt.set(o, (cnt.get(o) || 0) + 1); }
    const arr = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const my = mySid(), rank = arr.findIndex(e => e[0] === my) + 1, mine = cnt.get(my) || 0;
    $('#board').innerHTML = arr.slice(0, 10).map(([sid, n], k) =>
      `<li class="${sid === my ? 'me' : ''}" data-sid="${sid}"><span class="rk">${k + 1}</span><i style="background:${cssColor(sid)}"></i><span class="nm">${esc(short(sid))}</span><b>${n}</b></li>`).join('');
    $('#myRank').innerHTML = `⭐ 우리 학교 <b>${rank || '-'}위</b> · 땅 <b>${mine}</b>칸`;
    $('#hudLand').textContent = mine;
  }

  // ---------- 설정 + 비밀 버그 창 ----------
  let schoolClicks = 0, bugClicks = 0;
  function openSettings() {
    schoolClicks = bugClicks = 0;
    const s = schools[mySid()];
    $('#setInfo').innerHTML = `
      <div>👤 아이디: <b>${esc(me.username)}</b></div>
      <div>🎂 나이 인증: <b>${me.birthYear}년생</b> → <b>${me.grade}학년</b> (${me.grade}학년 서버)</div>
      <div>🏫 학교: <b>${esc(s ? s.name : '')}</b> <span class="muted">${esc(s ? s.sido + ' ' + s.sigungu : '')}</span></div>`;
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
    $('#btnBoard').onclick = () => $('#side').classList.toggle('open');
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
      if (d.error) return setErr('#pwErr', d.error);
      cheat.unlocked = true;
      closeM('pwModal');
      $('#secretBug').hidden = false;
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
    $('#zIn').onclick = () => zoomAt(vw / 2, vh / 2, view.s * 1.5);
    $('#zOut').onclick = () => zoomAt(vw / 2, vh / 2, view.s / 1.5);
    $('#zHome').onclick = goHome;
    $('#zFit').onclick = fitView;
    $('#board').onclick = e => {
      const li = e.target.closest('[data-sid]'), h = li && W ? W.home[+li.dataset.sid] : -1;
      if (h >= 0) { flyTo(grid.cc[h], grid.rr[h], Math.max(view.s, 12)); select(h); $('#side').classList.remove('open'); }
    };
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !quiz) { $$('.modal').forEach(m => { m.hidden = true; }); select(-1); } });
  }

  // ---------- 시작 ----------
  async function boot() {
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
