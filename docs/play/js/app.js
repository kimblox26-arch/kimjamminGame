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
  const PRAISE = ['정답이에요!', '잘했어요!', '최고예요!', '완벽해요!', '수학 천재!', '멋져요!'];

  let G = null;          // 지도 모양
  let schools = [];      // 학교 목록 (지도의 실제 학교 + 직접 등록한 학교)
  let token = store.get('mle_token'), me = null, W = null, es = null, online = 0, sel = -1, streak = 0, best = 0, chatCh = 'school', wrongN = 0;
  const cheat = { unlocked: false, capture: false, defend: false };
  const mySid = () => (me && me.profile ? me.profile.schoolId : -1);
  const short = sid => (schools[sid] ? schools[sid].name.replace(/초등학교$/, '초') : '어떤 학교');
  const costOf = i => S.captureCost({ owner: W.owner, def: W.def, nb: G.nbOf, sid: mySid(), cell: i, grade: me.grade, escape: exits, nk: c => G.nkCell[c] === 1, size: myLand });
  const needToTake = i => { const c = costOf(i); return c.error ? Math.max(S.BASE_COST, W.def[i]) : c.cost; };
  // 새 기능(코인·상점·미션·시즌·결투·운영자 초대)은 브라우저 안 게임 서버(backend.js)에서 돌아간다
  const FEAT = !!window.MLEBackend;
  let flagsOf = {}, shieldOf = new Map(), missionReady = 0, weakCells = [], inviteShown = false;
  const markOf = role => (role && S.MARK[role] ? `<span class="mark ${role}" title="${S.ROLE_NICK[role]}">${S.MARK[role]}</span>` : '');
  const nameHTML = (nick, role) => esc(nick) + markOf(role); // 이름 + 운영자(✦)·개발자(♛) 표시
  const flagMark = sid => (flagsOf[sid] ? flagsOf[sid].m + ' ' : '');
  const shielded = i => (shieldOf.get(i) || 0) > Date.now();
  const scopeOn = () => me && (me.scopeUntil || 0) > Date.now();
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

  // ---------- 배경 음악 (파일 없이 직접 만든 8비트 음악을 계속 반복) ----------
  const Music = (() => {
    let ac = null, src = null, buf = null, on = store.get('mle_bgm') !== 'off';
    function render(ctx) {
      const SR = 22050, BEAT = 0.5, BAR = BEAT * 4, N = Math.round(SR * BAR * 8), out = new Float32Array(N);
      const hz = m => 440 * 2 ** ((m - 69) / 12);
      const note = (t0, dur, m, vol, duty) => {
        const f = hz(m), s0 = Math.round(t0 * SR), n = Math.round((dur + 0.05) * SR);
        for (let k = 0; k < n; k++) {
          const t = k / SR, ph = (f * t) % 1, v = duty ? (ph < duty ? 1 : -1) : 1 - 4 * Math.abs(ph - 0.5);
          out[(s0 + k) % N] += v * vol * Math.min(1, t / 0.005) * (t < dur ? 1 - 0.4 * t / dur : Math.max(0, 0.6 * (1 - (t - dur) / 0.05)));
        }
      };
      let seed = 5;
      const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
      const hat = t0 => { const s0 = Math.round(t0 * SR); for (let k = 0; k < SR * 0.04; k++) out[(s0 + k) % N] += noise() * 0.05 * Math.exp(-k / SR * 80); };
      const kick = t0 => { const s0 = Math.round(t0 * SR); let ph = 0; for (let k = 0; k < SR * 0.2; k++) { const t = k / SR; ph += (50 + 100 * Math.exp(-t * 30)) / SR; out[(s0 + k) % N] += Math.sin(2 * Math.PI * ph) * 0.45 * Math.exp(-t * 15); } };
      const CH = [[60, 64, 67, 48], [59, 62, 67, 43], [57, 60, 64, 45], [57, 60, 65, 41]]; // 도 - 솔 - 라단조 - 파
      const MEL = [[[76, 1], [79, .5], [76, .5], [74, 1], [72, 1]], [[74, 1], [71, .5], [74, .5], [79, 2]], [[72, 1], [76, .5], [81, .5], [79, 1], [76, 1]], [[77, 1], [76, .5], [74, .5], [72, 2]]];
      for (let b = 0; b < 8; b++) {
        const t0 = b * BAR, [c1, c2, c3, root] = CH[b % 4], arp = [c1, c2, c3, c2 + 12];
        for (let e = 0; e < 8; e++) note(t0 + e * BEAT / 2, BEAT / 2 * 0.8, root + (e % 2 ? 12 : 0), 0.16);
        for (let e = 0; e < 8; e++) note(t0 + e * BEAT / 2, BEAT / 2 * 0.5, arp[e % 4] + 12, 0.035, 0.25);
        for (let q = 0; q < 4; q++) { kick(t0 + q * BEAT); hat(t0 + q * BEAT + BEAT / 2); }
        if (b >= 4) { let t = t0; for (const [m, d] of MEL[b % 4]) { note(t, d * BEAT * 0.85, m, 0.08, 0.5); t += d * BEAT; } }
      }
      let peak = 0.001;
      for (let k = 0; k < N; k++) peak = Math.max(peak, Math.abs(out[k]));
      const ab = ctx.createBuffer(1, N, SR), ch = ab.getChannelData(0);
      for (let k = 0; k < N; k++) ch[k] = (out[k] / peak) * 0.8;
      return ab;
    }
    function start() {
      if (!on || src) return;
      try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') ac.resume();
        buf = buf || render(ac);
        const g = ac.createGain(); g.gain.value = 0.2;
        src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
        src.connect(g).connect(ac.destination); src.start();
      } catch { src = null; /* 소리를 낼 수 없는 환경 */ }
    }
    const stop = () => { if (src) { try { src.stop(); } catch { /* 이미 멈춤 */ } src = null; } };
    document.addEventListener('visibilitychange', () => { if (!ac) return; if (document.hidden) ac.suspend(); else if (on) ac.resume(); });
    return { get on() { return on; }, start, toggle() { on = !on; store.set('mle_bgm', on ? 'on' : 'off'); if (on) start(); else stop(); return on; } };
  })();

  // ---------- 색종이 효과 ----------
  const fxCv = $('#fx'), fx = fxCv.getContext('2d');
  let parts = [];
  function confetti(x, y, n) {
    if (typeof fast !== "undefined" && fast) n = Math.min(n || 90, 30);
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
  // 밴(423)이면 정지 화면, 학교에서 퇴장(409)이면 학교 다시 고르기
  function special(d) {
    if (d.code === 423 && d.ban) showBanned(d.ban);
    else if (d.code === 409 && me && me.profile && /퇴장/.test(d.error || '')) kickedOut();
    return d;
  }
  function showBanned(ban) {
    if (es) { es.close(); es = null; }
    W = null; quiz = null;
    $$('.modal').forEach(m => { m.hidden = true; });
    const until = new Date(ban.until), forever = ban.until - Date.now() > 3000 * 864e5;
    $('#banText').innerHTML = forever ? '앞으로 <b>계속</b> 게임에 들어올 수 없어요.' : `<b>${until.getFullYear()}년 ${until.getMonth() + 1}월 ${until.getDate()}일 ${String(until.getHours()).padStart(2, '0')}:${String(until.getMinutes()).padStart(2, '0')}</b>까지 게임에 들어올 수 없어요.`;
    show('banned');
  }
  function kickedOut() {
    if (!me) return;
    me.profile = null;
    if (es) { es.close(); es = null; }
    W = null; quiz = null;
    $$('.modal').forEach(m => { m.hidden = true; });
    toast('🚪 학교에서 퇴장되었어요. 학교를 다시 골라 주세요.', 'warn');
    openSetup();
  }
  async function api(path, body) {
    if (window.MLEBackend) { // 서버 없이 브라우저 안에서 돌릴 때
      const d = await window.MLEBackend.api(path, body, token);
      if (d.code === 401 && token) logoutLocal('다시 로그인해 주세요.');
      return special(d);
    }
    const opt = { method: body ? 'POST' : 'GET', headers: {} };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    if (token) opt.headers.Authorization = 'Bearer ' + token;
    try {
      const res = await fetch(path, opt);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401 && token) logoutLocal('다시 로그인해 주세요.');
      if (!res.ok && !data.error) data.error = '서버 오류가 났어요.';
      data.code = data.code || (res.ok ? undefined : res.status);
      return special(data);
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
  // 칸 i 의 이웃 칸들. loadMap 밖에 두어야 불러올 때 쓴 큰 임시 배열(지도 파일 등)을 붙잡지 않는다 (메모리)
  const nbOf = i => G.nbIdx.subarray(G.nbOff[i], G.nbOff[i + 1]);
  let stamp = 0, marks = null;
  // 로딩 화면 진행률 (인트로가 없으면 글만)
  const prog = (p, msg) => { if (window.MLEIntro) window.MLEIntro.progress(p, msg); else if (msg) $('#loadMsg').textContent = msg; };
  const breathe = () => new Promise(r => setTimeout(r, 0)); // 화면이 진행률을 그릴 틈
  async function loadMap() {
    prog(2, '지도를 받는 중…');
    const res = await fetch(window.MLE_MAP_URL || '/api/map');
    if (!res.ok) throw new Error('지도를 받을 수 없어요.');
    const m = await res.json();
    if (window.MLEIntro) window.MLEIntro.setLand(m.land, m.W, m.H); // 인트로에 진짜 한반도 모양
    prog(6, `땅 ${m.n.toLocaleString()}칸 지도를 받는 중…`);
    const dec = arr => { const out = new Float32Array(arr.length); let x = 0, y = 0; for (let k = 0; k < arr.length; k += 2) { x += arr[k]; y += arr[k + 1]; out[k] = x; out[k + 1] = y; } return out; };
    const toPath = rings => { const p = new Path2D(); for (const r of rings) { p.moveTo(r[0], r[1]); for (let k = 2; k < r.length; k += 2) p.lineTo(r[k], r[k + 1]); p.closePath(); } return p; };
    const boxOf = rings => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const r of rings) for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); y0 = Math.min(y0, r[k + 1]); y1 = Math.max(y1, r[k + 1]); } return [x0, y0, x1, y1]; };
    G = { W: m.W, H: m.H, n: m.n, sides: m.sides, routes: m.routes, schoolCount: m.schoolCount };
    SPACING = m.spacing || 150;
    // map.bin: 칸 모양을 작게 줄여 둔 파일 (만드는 법은 lib/mapgen.js 의 encodeBin).
    // 50만 칸을 칸마다 따로 담으면 메모리가 너무 커서, 꼭짓점을 큰 배열 하나(G.xy)에 이어 담는다:
    // 고리 r 의 좌표 = G.xy[G.ro[r] .. G.ro[r + 1]), 칸 i 의 고리 = G.cr[i] .. G.cr[i + 1] - 1
    const binUrl = window.MLE_MAP_BIN_URL || '/api/map.bin';
    let buf;
    if (Array.isArray(binUrl)) { // 아티팩트용: base64 글자로 바꿔 여러 파일로 나눈 지도
      let got = 0;
      const texts = await Promise.all(binUrl.map(async u => { const r = await fetch(u); if (!r.ok) throw new Error('지도를 받을 수 없어요.'); const t = (await r.text()).trim(); got++; prog(6 + 30 * got / binUrl.length, `지도를 받는 중… ${got}/${binUrl.length}`); return t; }));
      prog(37, '지도 파일을 푸는 중…'); await breathe();
      const t = atob(texts.join(''));
      buf = new Uint8Array(t.length);
      for (let k = 0; k < t.length; k++) buf[k] = t.charCodeAt(k);
    } else {
      const br = await fetch(binUrl);
      if (!br.ok) throw new Error('지도를 받을 수 없어요.');
      buf = new Uint8Array(await br.arrayBuffer());
      prog(36);
    }
    prog(40, `땅 ${m.n.toLocaleString()}칸을 만드는 중…`); await breathe();
    const n = new DataView(buf.buffer).getUint32(4, true);
    if (n !== m.n) throw new Error('지도 파일이 서로 맞지 않아요. 새로고침 해 주세요.');
    G.sides = buf.slice(8, 8 + n); // 칸마다 변 수, 높은 비트(128)는 북한 칸
    G.nkCell = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (G.sides[i] & 128) { G.nkCell[i] = 1; G.sides[i] &= 127; }
    const u = () => { let v = 0, sh = 0, b; do { b = buf[p++]; v += (b & 0x7f) * 2 ** sh; sh += 7; } while (b & 0x80); return v; };
    let p = 8 + n, R = 0, X = 0; // 먼저 고리·꼭짓점 수만 세어서 배열을 딱 맞게 만든다 (메모리 아끼기)
    for (let i = 0; i < n; i++) { const rc = u(); R += rc; for (let k = 0; k < rc; k++) { const L = u(); X += 2 * L; for (let q = 0; q < 2 * L; q++) u(); } }
    p = 8 + n;
    let px = 0, py = 0, nr = 0, nx = 0;
    const xy = new Int32Array(X), ro = new Int32Array(R + 1), cr = new Int32Array(n + 1);
    const z = () => { const v = u(); return v % 2 ? -(v + 1) / 2 : v / 2; };
    for (let i = 0; i < n; i++) {
      const rc = u();
      cr[i] = nr;
      for (let k = 0; k < rc; k++) {
        const L = u();
        ro[nr++] = nx;
        let x = (px += z()), y = (py += z());
        xy[nx++] = x; xy[nx++] = y;
        for (let q = 1; q < L; q++) { x += z(); y += z(); xy[nx++] = x; xy[nx++] = y; }
      }
      if (i % 50000 === 49999) { prog(40 + 24 * i / n); await breathe(); } // 화면이 멈추지 않게 쉬어 간다
    }
    cr[n] = nr; ro[nr] = nx;
    G.xy = xy; G.ro = ro; G.cr = cr;
    prog(65, '이웃한 땅을 잇는 중…'); await breathe();
    // 이웃한 땅은 칸 모양으로 직접 계산한다 (서버와 같은 방법) + 섬 뱃길. 칸끼리 함께 쓰는 변은 지역 경계선에도 쓴다.
    const eachRing = (c, visit) => { for (let r = G.cr[c]; r < G.cr[c + 1]; r++) visit(G.xy, G.ro[r], G.ro[r + 1]); };
    let ec = new Int32Array(2 * (Math.ceil(X / 4 * 1.1) + 1024)), es = new Int32Array(ec.length), ne = 0; // 함께 쓰는 변은 꼭짓점 수의 절반쯤
    S.sharedEdges(n, eachRing, (c, o, x1, y1, x2, y2, k1, k2) => {
      if (2 * ne + 2 > ec.length) { const t = new Int32Array(ec.length * 2); t.set(ec); ec = t; const t2 = new Int32Array(es.length * 2); t2.set(es); es = t2; }
      ec[2 * ne] = c; ec[2 * ne + 1] = o; es[2 * ne] = k1; es[2 * ne + 1] = k2; ne++; // es: 변 두 끝의 G.xy 자리
    }, { W: m.W, H: m.H });
    G.edges = { c: ec, s: es, n: ne }; // computeRegions 가 경계선을 만든 뒤 버린다
    const off = new Int32Array(n + 1), pairs = ne + m.routes.length;
    const pa = k => (k < ne ? ec[2 * k] : m.routes[k - ne][0]), pb = k => (k < ne ? ec[2 * k + 1] : m.routes[k - ne][1]);
    for (let k = 0; k < pairs; k++) { off[pa(k) + 1]++; off[pb(k) + 1]++; }
    for (let i = 0; i < n; i++) off[i + 1] += off[i];
    const pos = off.slice(0, n), idx = new Int32Array(off[n]);
    for (let k = 0; k < pairs; k++) { const a = pa(k), b = pb(k); idx[pos[a]++] = b; idx[pos[b]++] = a; }
    let wr = 0; // 같은 이웃이 두 번 들어간 것을 빼며 앞으로 당긴다
    for (let i = 0; i < n; i++) {
      const s0 = off[i], e0 = off[i + 1];
      off[i] = wr;
      for (let k = s0; k < e0; k++) { const v = idx[k]; let dup = false; for (let q = off[i]; q < wr; q++) if (idx[q] === v) { dup = true; break; } if (!dup) idx[wr++] = v; }
    }
    off[n] = wr;
    G.nbOff = off; G.nbIdx = idx.slice(0, wr);
    G.nbOf = nbOf;
    G.paths = new Map();
    G.box = new Float32Array(m.n * 4);
    G.sx = new Float32Array(m.n); G.sy = new Float32Array(m.n);
    for (let i = 0; i < n; i++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = G.ro[G.cr[i]]; k < G.ro[G.cr[i + 1]]; k += 2) { const x = G.xy[k], y = G.xy[k + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      G.box[4 * i] = x0; G.box[4 * i + 1] = y0; G.box[4 * i + 2] = x1; G.box[4 * i + 3] = y1;
      if (i < m.schoolCount) { G.sx[i] = m.seeds[2 * i]; G.sy[i] = m.seeds[2 * i + 1]; continue; } // 학교 칸은 학교 자리, 나머지는 첫 고리 가운데
      const a = G.ro[G.cr[i]], b = G.ro[G.cr[i] + 1];
      let x = 0, y = 0;
      for (let k = a; k < b; k += 2) { x += G.xy[k]; y += G.xy[k + 1]; }
      G.sx[i] = x / ((b - a) / 2); G.sy[i] = y / ((b - a) / 2);
    }
    prog(84, '땅 위치를 정리하는 중…');
    if (window.MLEBackend) { prog(88, '친구들과 함께 쓰는 지도에 연결하는 중…'); await window.MLEBackend.init(m, G); }
    G.land = m.land.map(dec);
    G.landPaths = G.land.map(r => toPath([r]));
    G.landBox = G.land.map(r => boxOf([r]));
    // 북한: 게임 땅은 아니고 보기만 한다. 전체 보기는 한반도 전체가 보이게
    // 북한 땅도 칸으로 나뉜 진짜 땅이다 (land 고리 nkLand 번부터). 작은 지도는 남한만
    G.nkLand = m.nkLand != null ? m.nkLand : G.land.length;
    G.vb = { x0: 0, y0: 0, x1: G.W, y1: G.H };
    const sk = [Infinity, Infinity, -Infinity, -Infinity];
    G.landBox.forEach((b, k) => { if (k < G.nkLand) { sk[0] = Math.min(sk[0], b[0]); sk[1] = Math.min(sk[1], b[1]); sk[2] = Math.max(sk[2], b[2]); sk[3] = Math.max(sk[3], b[3]); } });
    G.miniBox = { x0: sk[0] - 300, y0: sk[1] - 300, w: sk[2] - sk[0] + 600, h: sk[3] - sk[1] + 600 };
    // 산·섬 이름
    G.places = (m.places || []).map(([type, name, x, y, h]) => ({ type, name, x, y, h }));
    G.peaks = G.places.filter(p => p.type === '산').sort((a, b) => b.h - a.h);
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
    const nkS = m.nkSchools || [m.schools.length, m.schools.length]; // 북한 (가상) 소학교 번호 범위
    schools = m.schools.map(([name, sido, sigungu, url, dong], id) => ({ id, name, sido, sigungu, dong: dong || '', url: url || '', nk: id >= nkS[0] && id < nkS[1] }));
    G.nkSido = new Set(schools.filter(s => s.nk).map(s => s.sido));
    prog(94, '시·도, 시·군·구, 동 경계를 그리는 중…');
    await new Promise(r => setTimeout(r, 0));
    computeRegions();
  }

  // ---------- 지역 표시: 경기도 › 남양주시 › 호평동 ----------
  // 땅 칸마다 가장 가까운 학교(이웃 칸을 따라 잰 거리)의 동네를 붙여 대략의 경계를 만든다.
  const SIDO_FULL = { 서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시', 대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도',
    평양: '평양직할시', 남포: '남포특별시', 개성: '개성특별시', 라선: '라선특별시', 평남: '평안남도', 평북: '평안북도', 자강: '자강도', 양강: '양강도', 함남: '함경남도', 함북: '함경북도', 황남: '황해남도', 황북: '황해북도', 북강원: '강원도(북한)' };
  function computeRegions() {
    const n = G.n, dongs = [], sggs = [], sidos = [], dIdx = new Map(), gIdx = new Map(), sIdx = new Map();
    const dong = new Int32Array(n).fill(-1), queue = new Int32Array(n);
    let qh = 0, qt = 0;
    for (let i = 0; i < G.schoolCount; i++) {
      const s = schools[i], gk = s.sido + '|' + s.sigungu, dk = gk + '|' + s.dong;
      let si = sIdx.get(s.sido);
      if (si === undefined) { si = sidos.length; sIdx.set(s.sido, si); sidos.push({ name: SIDO_FULL[s.sido] || s.sido }); }
      let gi = gIdx.get(gk);
      if (gi === undefined) { gi = sggs.length; gIdx.set(gk, gi); sggs.push({ name: s.sigungu, up: si }); }
      let di = dIdx.get(dk);
      if (di === undefined) { di = dongs.length; dIdx.set(dk, di); dongs.push({ name: s.dong || s.sigungu, up: gi }); }
      if (dong[i] < 0) { dong[i] = di; queue[qt++] = i; }
    }
    while (qh < qt) { const c = queue[qh++]; for (const m of G.nbOf(c)) if (dong[m] < 0) { dong[m] = dong[c]; queue[qt++] = m; } }
    const sgg = new Uint16Array(n), sido = new Uint8Array(n); // 메모리 아끼기 (시군구 수천 개, 시도 수십 개)
    for (let i = 0; i < n; i++) { const d = dong[i] < 0 ? 0 : dong[i]; dong[i] = d; sgg[i] = dongs[d].up; sido[i] = sggs[sgg[i]].up; }
    // 이름표 자리: 지역 안에서 경계로부터 가장 깊숙한 칸 (경기도 이름이 서울 위에 뜨지 않게)
    const place = (of, list) => {
      const depth = new Int32Array(n).fill(-1);
      qh = qt = 0;
      for (let i = 0; i < n; i++) if (!G.sides[i] || G.nbOf(i).some(m => of[m] !== of[i])) { depth[i] = 0; queue[qt++] = i; } // 바닷가도 경계로 본다 (섬에 이름이 뜨지 않게)
      while (qh < qt) { const c = queue[qh++]; for (const m of G.nbOf(c)) if (depth[m] < 0) { depth[m] = depth[c] + 1; queue[qt++] = m; } }
      const best = new Int32Array(list.length).fill(-1);
      for (let i = 0; i < n; i++) { const r = of[i], b = best[r]; if (b < 0 || depth[i] > depth[b]) best[r] = i; }
      list.forEach((r, k) => { const c = best[k]; r.x = c >= 0 ? G.sx[c] : 0; r.y = c >= 0 ? G.sy[c] : 0; r.size = c >= 0 ? depth[c] : 0; });
    };
    place(dong, dongs); place(sgg, sggs); place(sido, sidos);
    // 경계선: 서로 다른 지역의 칸이 함께 쓰는 변
    const E = G.edges, seg = [], lev = [];
    for (let k = 0; k < E.n; k++) {
      const c = E.c[2 * k], o = E.c[2 * k + 1];
      if (dong[o] === dong[c]) continue;
      const a = E.s[2 * k], b = E.s[2 * k + 1];
      seg.push(G.xy[a], G.xy[a + 1], G.xy[b], G.xy[b + 1]);
      lev.push(sido[o] !== sido[c] ? 0 : sgg[o] !== sgg[c] ? 1 : 2);
    }
    delete G.edges;
    G.seg = new Float32Array(seg); G.segLev = new Uint8Array(lev);
    G.segIndex = Array.from({ length: G.ibw * G.ibh }, () => []);
    for (let k = 0; k < lev.length; k++) {
      const gx = Math.min(G.ibw - 1, Math.max(0, Math.floor((seg[4 * k] + seg[4 * k + 2]) / 2 / IB))), gy = Math.min(G.ibh - 1, Math.max(0, Math.floor((seg[4 * k + 1] + seg[4 * k + 3]) / 2 / IB)));
      G.segIndex[gy * G.ibw + gx].push(k);
    }
    Object.assign(G, { dongOf: dongs.length < 65536 ? Uint16Array.from(dong) : dong, sggOf: sgg, sidoOf: sido, dongs, sggs, sidoList: sidos });
  }
  const regionName = i => (i < 0 || !G.dongOf ? '' : `${G.sidoList[G.sidoOf[i]].name} › ${G.sggs[G.sggOf[i]].name} › ${G.dongs[G.dongOf[i]].name}`);
  // 타일에 경계선 그리기: 시·도는 늘, 시·군·구는 조금 확대하면, 동은 더 확대하면
  function drawBorders(g, x0, y0, tw, px, cp) {
    const maxLev = cp >= 9 ? 2 : cp >= 2 ? 1 : 0, paths = [new Path2D(), new Path2D(), new Path2D()];
    const gx0 = Math.max(0, Math.floor((x0 - 60) / IB)), gx1 = Math.min(G.ibw - 1, Math.floor((x0 + tw + 60) / IB));
    const gy0 = Math.max(0, Math.floor((y0 - 60) / IB)), gy1 = Math.min(G.ibh - 1, Math.floor((y0 + tw + 60) / IB));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) for (const k of G.segIndex[gy * G.ibw + gx]) {
      const l = G.segLev[k];
      if (l > maxLev) continue;
      paths[l].moveTo(G.seg[4 * k], G.seg[4 * k + 1]); paths[l].lineTo(G.seg[4 * k + 2], G.seg[4 * k + 3]);
    }
    g.lineCap = 'round';
    if (maxLev >= 2) { g.strokeStyle = 'rgba(85,60,160,.38)'; g.lineWidth = 1.1 * px; g.stroke(paths[2]); }
    if (maxLev >= 1) { g.strokeStyle = 'rgba(85,60,160,.62)'; g.lineWidth = Math.min(2.6, 1 + cp / 18) * px; g.stroke(paths[1]); }
    g.strokeStyle = 'rgba(70,40,150,.85)'; g.lineWidth = Math.min(3.8, 1.6 + cp / 12) * px; g.stroke(paths[0]);
  }
  // 산: 높을수록 넓고 진한 초록 그늘 (땅 안에만)
  function drawRelief(g, x0, y0, tw, lands) {
    const near = G.peaks.filter(p => { const R = 120 + p.h * 0.32; return p.x + R >= x0 && p.x - R <= x0 + tw && p.y + R >= y0 && p.y - R <= y0 + tw; });
    if (!near.length) return;
    const clip = new Path2D();
    for (const k of lands) clip.addPath(G.landPaths[k]);
    g.save(); g.clip(clip);
    for (const p of near) {
      const R = 120 + p.h * 0.32, gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
      gr.addColorStop(0, 'rgba(80,120,60,.17)'); gr.addColorStop(0.55, 'rgba(95,130,70,.07)'); gr.addColorStop(1, 'rgba(95,130,70,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, R, 0, 7); g.fill();
    }
    g.restore();
  }
  // 산·섬 이름 (지역 이름표와 함께 겹치지 않게)
  function drawScenery(cp, SX, SY, free) {
    const out = (x, y) => x < -60 || y < -20 || x > vw + 60 || y > vh + 20;
    const label = (text, x, y, size, color) => {
      ctx.font = `${size}px Jua, sans-serif`;
      const w = ctx.measureText(text).width + 6;
      if (!free(x - w / 2, y - size / 2 - 1, w, size + 2)) return false;
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(text, x, y);
      ctx.fillStyle = color; ctx.fillText(text, x, y);
      return true;
    };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const minH = cp < 1.5 ? 1900 : cp < 3 ? 1400 : cp < 5 ? 1000 : 0;
    for (const p of G.peaks) {
      if (p.h < minH) break;
      const x = SX(p.x), y = SY(p.y);
      if (out(x, y)) continue;
      const t = Math.max(6, Math.min(11, cp * 0.4)), size = Math.round(Math.max(11, Math.min(14, 9 + cp * 0.15)));
      if (!free(x - t, y - t, 2 * t, 1.8 * t)) continue;
      ctx.beginPath(); ctx.moveTo(x, y - t); ctx.lineTo(x + t, y + t * 0.75); ctx.lineTo(x - t, y + t * 0.75); ctx.closePath();
      ctx.fillStyle = '#8a6a3f'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      if (p.h >= 1500) { ctx.beginPath(); ctx.moveTo(x, y - t); ctx.lineTo(x + t * 0.38, y - t * 0.3); ctx.lineTo(x - t * 0.38, y - t * 0.3); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill(); } // 눈 덮인 높은 산
      label(cp >= 3 ? `${p.name} ${p.h}m` : p.name, x, y + t + size * 0.7, size, '#6b4a22');
    }
    if (cp >= 2.5) for (const p of G.places) {
      if (p.type !== '섬') continue;
      const x = SX(p.x), y = SY(p.y);
      if (!out(x, y)) label(p.name, x, y, Math.round(Math.max(11, Math.min(14, 9 + cp * 0.15))), '#4b5563');
    }
  }
  // 지역 이름표 (겹치면 건너뛴다)
  function drawRegionLabels(cp, SX, SY) {
    const boxes = [], free = (x, y, w, h) => { for (const b of boxes) if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false; boxes.push([x, y, w, h]); return true; };
    const below = cp >= 11 ? Math.max(16, cp * 0.42) : 0; // 학교 표시 아래로 비켜 쓴다
    const draw = (list, size, color, minSize, dy) => {
      ctx.font = `${size}px Jua, sans-serif`;
      for (const r of list) {
        if (r.size < minSize) continue;
        const x = SX(r.x), y = SY(r.y) + dy;
        if (x < -80 || y < -20 || x > vw + 80 || y > vh + 20) continue;
        const w = ctx.measureText(r.name).width + 8;
        if (!free(x - w / 2, y - size / 2 - 2, w, size + 4)) continue;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.strokeText(r.name, x, y);
        ctx.fillStyle = color; ctx.fillText(r.name, x, y);
      }
    };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (cp < 8) draw(G.sidoList, Math.round(Math.max(14, Math.min(26, cp * 3.5))), 'rgba(70,40,150,.85)', 0, 0);
    if (G.places) drawScenery(cp, SX, SY, free);
    if (cp >= 2.2 && cp < 30) draw(G.sggs, Math.round(Math.max(12, Math.min(17, cp * 1.4))), 'rgba(85,60,160,.8)', cp < 4 ? 6 : 1, below);
    if (cp >= 11) draw(G.dongs, Math.round(Math.max(11, Math.min(15, cp * 0.45))), 'rgba(90,75,140,.75)', cp < 20 ? 2 : 0, below);
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
      const r = G.xy;
      for (let q = G.cr[i]; q < G.cr[i + 1]; q++) for (let s0 = G.ro[q], e0 = G.ro[q + 1], a = s0, b = e0 - 2; a < e0; b = a, a += 2) {
        if ((r[a + 1] > y) !== (r[b + 1] > y) && x < ((r[b] - r[a]) * (y - r[a + 1])) / (r[b + 1] - r[a + 1]) + r[a]) inside = !inside;
      }
      if (inside) return i;
    }
    return -1;
  }
  function nearestSchool(x, y) { // 가장 가까운 학교 (그 학교의 동네 이름을 빌려 쓴다)
    let best = null, bd = Infinity;
    for (const s of schools) {
      if (!s || s.id >= G.schoolCount) continue; // 기본 학교만 (학교 번호 = 칸 번호)
      const d = (G.sx[s.id] - x) ** 2 + (G.sy[s.id] - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
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
    Object.assign(cheat, { unlocked: me.role === 'dev', capture: false, defend: false }); // 개발자는 버그 창이 처음부터 열려 있다
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

  // ---------- 게임 시작 전 설정: 시도 → 시군구 → 동 → 학교 ----------
  let chosen = null, semester = 1;
  const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(t)}</option>`;
  const area = () => ({ sido: $('#stSido').value, sigungu: $('#stSigungu').value, dong: $('#stDong').value });
  function fillSigungu(keep) {
    const sido = $('#stSido').value, list = [...new Set(G.districts.filter(d => d.sido === sido).map(d => d.sigungu))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('#stSigungu').innerHTML = opt('', '시·군·구 고르기') + list.map(g => opt(g, g, g === keep)).join('');
  }
  function fillDong(keep) {
    const { sido, sigungu } = area(), set = new Set();
    for (const s of schools) if (s && s.sido === sido && s.sigungu === sigungu && s.dong) set.add(s.dong);
    const list = [...set].sort((a, b) => a.localeCompare(b, 'ko'));
    $('#stDong').innerHTML = opt('', sigungu ? `전체 (${list.length}개 동네)` : '동·읍·면') + list.map(d => opt(d, d, d === keep)).join('');
    $('#stDongList').innerHTML = list.map(d => `<option value="${esc(d)}">`).join('');
    $('#stCWhere').textContent = sigungu ? `📍 ${sido} ${sigungu}에 새 학교를 등록해요.` : '먼저 위에서 시·도와 시·군·구를 골라 주세요.';
  }
  function setArea(sido, sigungu, dong) {
    $('#stSido').value = sido || '';
    fillSigungu(sigungu);
    fillDong(dong);
    renderSchoolList();
  }
  function initSetup() {
    const sidos = [...new Set(G.districts.filter(d => !G.nkSido.has(d.sido)).map(d => d.sido))]; // 북한 학교는 고를 수 없다
    $('#stSido').innerHTML = opt('', '시·도 고르기') + sidos.map(s => opt(s, s)).join('');
    $('#stSido').onchange = () => setArea($('#stSido').value);
    $('#stSigungu').onchange = () => setArea($('#stSido').value, $('#stSigungu').value);
    $('#stDong').onchange = renderSchoolList;
    $('#stSearch').oninput = renderSchoolList;
    $('#stSearch').placeholder = '또는 동네·학교 이름으로 찾기 (예: 호평동, 남양주시, 대치초)';
    $('#stList').onclick = e => { const b = e.target.closest('[data-id]'); if (b) chooseSchool(+b.dataset.id); };
    $('#stCustomToggle').onclick = () => { $('#stCustom').hidden = !$('#stCustom').hidden; if (!$('#stCustom').hidden) $('#stCDong').value = $('#stDong').value; };
    $$('.sem').forEach(b => { b.onclick = () => setSemester(+b.dataset.sem); });
    $('#stBack').onclick = () => startGame();
    $('#setupForm').onsubmit = async e => {
      e.preventDefault();
      const body = { semester, nickname: $('#stNick').value.trim() };
      const cname = $('#stCName').value.trim();
      if (!$('#stCustom').hidden && cname) {
        const { sido, sigungu } = area(), di = G.districts.findIndex(d => d.sido === sido && d.sigungu === sigungu);
        if (di < 0) return setErr('#stErr', '새 학교가 있는 시·도와 시·군·구를 위에서 골라 주세요.');
        body.custom = { di, name: cname, dong: $('#stCDong').value.trim(), url: $('#stCUrl').value.trim() };
      } else if (chosen != null) body.schoolId = chosen;
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
  const where = s => `${s.sido} ${s.sigungu}${s.dong ? ' ' + s.dong : ''}`;
  function chooseSchool(id) {
    chosen = id;
    const s = schools[id];
    $('#stChosen').innerHTML = s ? `✅ <b>${esc(s.name)}</b> <span class="muted">${esc(where(s))}</span>` : '아직 학교를 고르지 않았어요';
    $('#stChosen').classList.toggle('on', !!s);
    renderSchoolList();
  }
  // "호평동", "남양주시", "남양주", "영통구", "경기" 처럼 지역 이름이면 그 지역의 모든 학교
  function regionSchools(q) {
    q = q.replace(/\s+/g, '');
    if (q.length < 2) return null;
    const norm = t => (t || '').replace(/\s+/g, '');
    let list = schools.filter(s => s && s.dong && (s.dong === q || s.dong === q + '동'));
    if (list.length) return { label: list[0].dong, list };
    list = schools.filter(s => s && /[시군구]$/.test(q.length > 1 ? norm(s.sigungu) : '') && (norm(s.sigungu) === q || norm(s.sigungu).startsWith(q) || norm(s.sigungu).endsWith(q)));
    if (list.length) { const g = new Set(list.map(s => s.sigungu)); return { label: g.size === 1 ? list[0].sigungu : q, list }; }
    list = schools.filter(s => s && s.sido === q);
    return list.length ? { label: q, list } : null;
  }
  // 동네별로 묶어서 보여 준다
  function schoolListHTML(list, landOf, chosenId) {
    const sorted = list.slice().sort((a, b) => (a.sido + a.sigungu).localeCompare(b.sido + b.sigungu, 'ko') || (a.dong || '').localeCompare(b.dong || '', 'ko') || a.name.localeCompare(b.name, 'ko'));
    let html = '', group = null;
    for (const s of sorted) {
      const g = `${s.sido} ${s.sigungu}${s.dong ? ' · ' + s.dong : ''}`;
      if (g !== group) { group = g; html += `<div class="list-group">📍 ${esc(g)}</div>`; }
      const land = landOf ? landOf(s.id) : null;
      html += `<button type="button" class="school-item${s.id === chosenId ? ' on' : ''}" data-id="${s.id}" data-sid="${s.id}"><b>${esc(s.name)}</b><span>${land != null ? `땅 ${land}칸` : esc(s.dong || '')}</span></button>`;
    }
    return html;
  }
  const searchSchools = (q, max) => {
    q = q.replace(/\s+/g, '');
    const res = [];
    if (!q) return res;
    for (const s of schools) {
      if (s && (s.name + s.sido + s.sigungu + (s.dong || '')).includes(q)) res.push(s);
      if (res.length >= max) break;
    }
    return res;
  };
  function renderSchoolList() {
    const q = $('#stSearch').value.trim(), box = $('#stList'), { sido, sigungu, dong } = area();
    let title = '', res;
    const region = q ? regionSchools(q) : null;
    if (region) { res = region.list; title = `${region.label}에 있는 모든 학교`; }
    else if (q) { res = searchSchools(q, 120); title = `"${q}" 검색 결과`; }
    else if (sigungu) { res = schools.filter(s => s && s.sido === sido && s.sigungu === sigungu && (!dong || s.dong === dong)); title = `${dong || sigungu}에 있는 모든 학교`; }
    else { box.innerHTML = `<div class="muted pad">시·도 → 시·군·구 → 동을 고르거나, "호평동"·"남양주시"처럼 동네 이름이나 학교 이름으로 찾아보세요. (전국 ${schools.length.toLocaleString()}개 학교)</div>`; return; }
    res = res.filter(s => !s.nk);
    box.innerHTML = res.length
      ? `<div class="list-title">🏫 ${esc(title)} <b>${res.length}곳</b></div>` + schoolListHTML(res, null, chosen)
      : '<div class="muted pad">이 동네에는 등록된 학교가 없어요. 아래 "직접 등록하기"를 눌러 보세요.</div>';
  }
  async function openSetup() {
    show('setup');
    const d = await api('/api/schools');
    mergeCustom(d.custom);
    const p = me.profile || {}, m = new Date().getMonth(), cur = p.schoolId != null ? schools[p.schoolId] : null;
    $('#stGrade').innerHTML = me.role ? `<b>${me.grade}학년 서버</b> <span class="muted">(${S.ROLE_NICK[me.role]} 계정 · 🛠️ 관리 창에서 학년 서버를 바꿀 수 있어요)</span>`
      : `<b>${me.grade}학년</b> <span class="muted">(${me.birthYear}년생 · 나이 인증으로 정해졌어요 · ${me.grade}학년 서버)</span>`;
    setSemester(p.semester || (m >= 1 && m <= 6 ? 1 : 2));
    $('#stNick').value = me.role ? S.ROLE_NICK[me.role] : p.nickname || '';
    $('#stNick').readOnly = !!me.role;
    $('#stSearch').value = '';
    $('#stCustom').hidden = true;
    $('#stCName').value = $('#stCDong').value = $('#stCUrl').value = '';
    $('#stBack').hidden = !me.profile;
    setArea(cur ? cur.sido : '', cur ? cur.sigungu : '', cur ? cur.dong : '');
    chooseSchool(p.schoolId != null ? p.schoolId : null);
  }

  // ---------- 지도 그리기 (조각 그림 캐시) ----------
  const cv = $('#map'), ctx = cv.getContext('2d');
  const view = { s: 0.02, x: 0, y: 0 };
  const TILE = 256, ZMAX = 12;
  // 얕은 바다 띠: [폭(지도 단위, 1 ≈ 14m), 화면에서 최소 폭(px), 색]
  const SEA_BANDS = [[160, 16, 'rgba(110,210,235,.18)'], [90, 10, 'rgba(130,222,240,.24)'], [42, 6, 'rgba(160,234,247,.32)'], [16, 3, 'rgba(195,244,250,.45)']];
  let SPACING = 150;
  const tiles = new Map();
  let vw = 0, vh = 0, dpr = 1, queued = false, ambient = 0, tick = 0, flashes = [], frontier = new Set(), defended = new Set(), owned = new Set();
  let exits = new Set(), exitLines = [], offerOf = new Map(), myLand = 0; // 탈출길, 팔려고 내놓은 땅, 우리 학교 땅 칸 수
  const NEUTRAL = [196, 201, 208], MINE = [255, 193, 7];
  const colorCache = new Map();
  const baseS = () => TILE / Math.max(G.W, G.H);
  const cellPx = () => SPACING * view.s;

  // ⚡ 빠르게 모드: 폰에서는 처음부터 켜고, 렉이 걸리면 저절로 켠다
  let fast = store.get('mle_fast') != null ? store.get('mle_fast') === '1' : matchMedia('(pointer: coarse)').matches;
  let moving = false, moveTimer = 0, slow = 0;
  function setFast(on, auto) {
    fast = on;
    store.set('mle_fast', on ? '1' : '0');
    tiles.clear();
    resize();
    renderMini();
    $$('.fast-toggle').forEach(b => { b.textContent = `⚡ 빠르게 모드: ${on ? '켜짐 ✅' : '꺼짐'}`; b.classList.toggle('on', on); });
    if (auto) toast('렉이 걸려서 ⚡ 빠르게 모드를 켰어요. 설정에서 끌 수 있어요.', 'warn');
  }
  function nudge() { // 지도를 움직이는 동안은 꼭 필요한 것만 그린다
    moving = true;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => { moving = false; requestDraw(); }, 160);
    requestDraw();
  }
  // 칸 모양은 처음 그릴 때 만든다 (불러오기가 빨라진다)
  function pathOf(i) {
    let p = G.paths.get(i);
    if (!p) {
      if (G.paths.size > 80000) G.paths.clear(); // 너무 많이 쌓이면 비우고 다시 만든다 (메모리)
      p = new Path2D();
      G.paths.set(i, p);
      const r = G.xy;
      for (let q = G.cr[i]; q < G.cr[i + 1]; q++) { const a = G.ro[q], b = G.ro[q + 1]; p.moveTo(r[a], r[a + 1]); for (let k = a + 2; k < b; k += 2) p.lineTo(r[k], r[k + 1]); p.closePath(); }
    }
    return p;
  }

  function hsl(h, s, l) {
    const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  }
  function rgbOf(o) {
    if (o < 0) return NEUTRAL;
    if (o === mySid()) return MINE;
    let c = colorCache.get(o);
    if (!c) {
      const f = flagsOf[o]; // 🚩 깃발을 꾸민 학교는 고른 색으로
      if (f) c = [1, 3, 5].map(k => parseInt(f.c.slice(k, k + 2), 16));
      else {
        let h = (o * 137.508) % 360;
        if (h > 32 && h < 70) h += 48; // 우리 학교 노란색과 헷갈리지 않게
        c = hsl(h, 0.62, 0.56);
      }
      colorCache.set(o, c);
    }
    return c;
  }
  const cssColor = o => `rgb(${rgbOf(o).join(',')})`;
  const shade = (c, f) => `rgb(${Math.min(255, c[0] * f) | 0},${Math.min(255, c[1] * f) | 0},${Math.min(255, c[2] * f) | 0})`;
  // 같은 색 칸을 한 묶음으로 모아 한 번에 칠한다 (칸마다 칠하는 것보다 훨씬 빠르다)
  function groupKey(i) {
    const o = W.owner[i];
    if (o < 0) return 'n' + (i % 3);
    return (W.def[i] > 0 ? 'd' : 'o') + o;
  }
  function groupStyle(key) {
    if (key[0] === 'n') return { fill: shade(NEUTRAL, [1, 0.97, 1.03][+key[1]]), line: 'rgba(255,255,255,.8)' };
    const c = rgbOf(+key.slice(1)), f = key[0] === 'd' ? 0.8 : 1;
    return { fill: shade(c, f), line: shade(c, 0.6 * f) };
  }
  function drawGroups(g, ids, px, lines) {
    const groups = new Map();
    for (const i of ids) {
      const k = groupKey(i);
      let p = groups.get(k);
      if (!p) groups.set(k, p = new Path2D());
      p.addPath(pathOf(i));
    }
    for (const [k, p] of groups) {
      const st = groupStyle(k);
      g.fillStyle = st.fill; g.fill(p);
      g.strokeStyle = lines ? st.line : st.fill; g.lineWidth = lines ? Math.min(2.2, 0.6 + (SPACING * (1 / px)) / 70) * px : px; g.stroke(p);
    }
  }

  function renderTile(z, tx, ty) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const g = c.getContext('2d');
    const sz = baseS() * 2 ** z, tw = TILE / sz, x0 = tx * tw, y0 = ty * tw, px = 1 / sz, cp = SPACING * sz;
    g.setTransform(sz, 0, 0, sz, -x0 * sz, -y0 * sz);
    g.lineJoin = 'round';
    // 바닷가 얕은 물: 해안선을 넓은 선부터 좁은 선까지 겹쳐 그려 물빛이 점점 밝아지게 한다
    const bands = SEA_BANDS.map(([u, m, c]) => [Math.max(u, m * px), c]), mg = bands[0][0] / 2;
    const lands = [];
    G.landBox.forEach((b, k) => { if (b[0] <= x0 + tw + mg && b[2] >= x0 - mg && b[1] <= y0 + tw + mg && b[3] >= y0 - mg) lands.push(k); });
    for (const [w, c] of bands) { g.strokeStyle = c; g.lineWidth = w; for (const k of lands) g.stroke(G.landPaths[k]); }
    g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = (cp > 20 ? 6 : 4) * px; // 하얀 물거품
    for (const k of lands) g.stroke(G.landPaths[k]);
    if (cp < 6) { // 멀리서 볼 때: 회색 땅을 한 번에 칠하고 주인 있는 칸만 덧칠한다
      g.fillStyle = shade(NEUTRAL, 1);
      for (const k of lands) g.fill(G.landPaths[k]);
      const ids = [];
      for (const i of owned) { const b = i * 4; if (G.box[b] <= x0 + tw && G.box[b + 2] >= x0 && G.box[b + 1] <= y0 + tw && G.box[b + 3] >= y0) ids.push(i); }
      drawGroups(g, ids, px, false);
    } else drawGroups(g, cellsIn(x0 - 1, y0 - 1, x0 + tw + 1, y0 + tw + 1), px, cp > 9);
    if (G.peaks) drawRelief(g, x0, y0, tw, lands);
    if (G.seg) drawBorders(g, x0, y0, tw, px, cp);
    if (cp >= 3) { g.strokeStyle = 'rgba(242,224,172,.95)'; g.lineWidth = Math.min(5, 1.5 + cp / 25) * px; for (const k of lands) g.stroke(G.landPaths[k]); } // 모래사장
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
    dpr = fast ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    vw = r.width; vh = r.height;
    cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
    cv.style.width = vw + 'px'; cv.style.height = vh + 'px';
    requestDraw();
  }
  window.addEventListener('resize', () => { if (!$('#game').hidden) { resize(); renderMini(); } });
  function requestDraw() { if (!queued) { queued = true; requestAnimationFrame(draw); } }

  function draw() {
    queued = false;
    if (!G || !W) return;
    const s = view.s, now = performance.now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh); // 바다는 뒤쪽 배경(CSS)이 보여 준다

    // 1) 땅 조각 그림
    const z = Math.max(0, Math.min(ZMAX, Math.ceil(Math.log2((s * dpr) / baseS()) - 0.05)));
    const sz = baseS() * 2 ** z, tw = TILE / sz, nT = 2 ** z;
    const tx0 = Math.max(0, Math.floor(-view.x / s / tw)), tx1 = Math.min(nT - 1, Math.floor((vw - view.x) / s / tw));
    const ty0 = Math.max(0, Math.floor(-view.y / s / tw)), ty1 = Math.min(nT - 1, Math.floor((vh - view.y) / s / tw));
    const budget = moving ? (fast ? 4 : 7) : 14;
    let rendered = 0, more = false;
    tick++;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = z + '/' + tx + '/' + ty, X = view.x + tx * tw * s, Y = view.y + ty * tw * s, SZ = tw * s;
      let t = tiles.get(key);
      if ((!t || t.dirty) && (rendered === 0 || performance.now() - now < budget)) { // 한 화면에 너무 오래 걸리지 않게
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
    const maxTiles = fast ? 90 : 160;
    if (tiles.size > maxTiles) [...tiles.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, tiles.size - maxTiles).forEach(([k]) => tiles.delete(k));

    // 2) 지도 위 표시 (지도 좌표)
    const cp = cellPx(), wx0 = -view.x / s, wy0 = -view.y / s, wx1 = (vw - view.x) / s, wy1 = (vh - view.y) / s;
    const vis = i => G.box[i * 4] <= wx1 && G.box[i * 4 + 2] >= wx0 && G.box[i * 4 + 1] <= wy1 && G.box[i * 4 + 3] >= wy0;
    const calm = !moving; // 움직이는 중에는 꾸밈을 줄인다
    const animate = calm && !fast;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.x, dpr * view.y);
    ctx.lineJoin = 'round';
    const rts = sel >= 0 ? G.routes.filter(([a, b]) => a === sel || b === sel) : [];
    if (rts.length) { // 섬으로 가는 뱃길: 바다는 깨끗하게 두고, 그 칸을 눌렀을 때만 보여 준다
      ctx.setLineDash([7 / s, 6 / s]); ctx.lineWidth = 2.5 / s; ctx.strokeStyle = 'rgba(255,255,255,.95)';
      ctx.beginPath();
      for (const [a, b] of rts) { ctx.moveTo(G.sx[a], G.sy[a]); ctx.lineTo(G.sx[b], G.sy[b]); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (calm && cp >= 16 && frontier.size) { // 뺏을 수 있는 땅
      const fp = new Path2D();
      for (const i of frontier) if (vis(i)) fp.addPath(pathOf(i));
      ctx.setLineDash([6 / s, 4 / s]); ctx.lineDashOffset = animate ? -(now / 60) / s : 0; ctx.lineWidth = 2.4 / s; ctx.strokeStyle = 'rgba(255,170,0,.95)'; ctx.fillStyle = 'rgba(255,214,90,.16)';
      ctx.fill(fp); ctx.stroke(fp);
      ctx.setLineDash([]);
    }
    if (calm && exitLines.length) { // 갇혔을 때 가장 가까운 빈 땅으로 가는 탈출길
      const ep = new Path2D();
      for (const i of exits) if (vis(i)) ep.addPath(pathOf(i));
      ctx.setLineDash([8 / s, 6 / s]); ctx.lineDashOffset = animate ? -(now / 40) / s : 0;
      ctx.fillStyle = 'rgba(16,185,129,.28)'; ctx.fill(ep);
      ctx.lineWidth = 3 / s; ctx.strokeStyle = 'rgba(5,150,105,.95)'; ctx.stroke(ep);
      ctx.beginPath();
      for (const [a, b] of exitLines) { ctx.moveTo(G.sx[a], G.sy[a]); ctx.lineTo(G.sx[b], G.sy[b]); }
      ctx.lineWidth = Math.max(2.5 / s, 3); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (calm && offerOf.size && cp >= 3) { // 팔려고 내놓은 땅
      const op = new Path2D();
      for (const i of offerOf.keys()) if (vis(i)) op.addPath(pathOf(i));
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fill(op);
      ctx.setLineDash([5 / s, 4 / s]); ctx.lineWidth = 2.5 / s; ctx.strokeStyle = 'rgba(147,51,234,.95)'; ctx.stroke(op); ctx.setLineDash([]);
    }
    if (calm && shieldOf.size && cp >= 3) { // 🛡️ 방패가 지키는 땅: 금색 테두리
      const sp = new Path2D(), t = Date.now();
      for (const [i, until] of shieldOf) if (until > t && vis(i)) sp.addPath(pathOf(i));
      ctx.lineWidth = 3.2 / s; ctx.strokeStyle = 'rgba(245,179,1,.95)'; ctx.fillStyle = 'rgba(255,230,120,.22)'; ctx.fill(sp); ctx.stroke(sp);
    }
    const scoping = scopeOn();
    if (calm && scoping && weakCells.length) { // 🔭 망원경: 가장 약한 땅이 반짝반짝
      const wp = new Path2D(), a = 0.55 + 0.45 * Math.sin(now / 160);
      for (const i of weakCells) if (vis(i)) wp.addPath(pathOf(i));
      ctx.lineWidth = 4 / s; ctx.strokeStyle = `rgba(229,72,77,${a})`; ctx.fillStyle = `rgba(229,72,77,${0.18 * a})`; ctx.fill(wp); ctx.stroke(wp);
    }
    flashes = flashes.filter(f => now - f.t < 1000);
    for (const f of flashes) {
      const a = 1 - (now - f.t) / 1000;
      ctx.fillStyle = `rgba(255,255,255,${a * 0.75})`; ctx.fill(pathOf(f.i));
      ctx.lineWidth = (2 + 6 * (1 - a)) / s; ctx.strokeStyle = f.bad ? `rgba(229,72,77,${a})` : `rgba(255,193,7,${a})`; ctx.stroke(pathOf(f.i));
    }
    if (sel >= 0) {
      ctx.lineWidth = 7 / s; ctx.strokeStyle = 'rgba(255,45,85,.35)'; ctx.stroke(pathOf(sel));
      ctx.lineWidth = 3 / s; ctx.strokeStyle = '#ff2d55'; ctx.stroke(pathOf(sel));
    }

    // 3) 화면 좌표 표시: 시도 이름, 방어, 학교
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const SX = x => view.x + x * s, SY = y => view.y + y * s;
    if (G.dongOf && (calm || !fast)) drawRegionLabels(cp, SX, SY);
    if (calm && G.dongOf) { // 지금 보고 있는 곳: 경기도 › 남양주시 › 호평동
      const c = hitTest((vw / 2 - view.x) / s, (vh / 2 - view.y) / s), text = c >= 0 ? '📍 ' + (cp < 2 ? G.sidoList[G.sidoOf[c]].name : cp < 9 ? G.sidoList[G.sidoOf[c]].name + ' › ' + G.sggs[G.sggOf[c]].name : regionName(c)) : '';
      if ($('#where').textContent !== text) { $('#where').textContent = text; $('#where').hidden = !text; }
    }
    if (calm && (cp >= 34 || (scoping && cp >= 10))) { // 망원경이 있으면 멀리서도 방어 수가 보인다
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `bold ${Math.round(Math.max(9, Math.min(15, cp * 0.2)))}px sans-serif`;
      for (const i of defended) {
        if (!vis(i) || W.homeCell[i] >= 0) continue;
        const x = SX(G.sx[i]), y = SY(G.sy[i]), r = Math.max(6, Math.min(13, cp * 0.14));
        shield(x, y, r);
        ctx.fillStyle = '#fff'; ctx.fillText(W.def[i], x, y + 1);
      }
    }
    const my = mySid();
    if (calm && cp >= 8) { // 🏷️ 팔 땅, 🚪 탈출길 글자
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `${Math.round(Math.min(18, 8 + cp * 0.15))}px sans-serif`;
      for (const i of offerOf.keys()) if (vis(i)) ctx.fillText('🏷️', SX(G.sx[i]), SY(G.sy[i]));
      for (const i of exits) if (vis(i)) ctx.fillText('🚪', SX(G.sx[i]), SY(G.sy[i]));
      const t = Date.now();
      for (const [i, until] of shieldOf) if (until > t && vis(i) && !defended.has(i)) ctx.fillText('🛡️', SX(G.sx[i]), SY(G.sy[i]));
      if (scoping) for (const i of weakCells) if (vis(i) && !defended.has(i)) ctx.fillText('🎯', SX(G.sx[i]), SY(G.sy[i]));
    }
    if (cp >= 11 && (calm || !fast)) {
      for (let sid = 0; sid < W.home.length; sid++) {
        const h = W.home[sid];
        if (h < 0 || sid === my || !vis(h)) continue;
        schoolMark(SX(G.sx[h]), SY(G.sy[h]), Math.max(4, Math.min(12, cp * 0.14)), sid, calm && (cp >= 55 || h === sel));
      }
    }
    const mh = W.home[my], myVis = mh >= 0 && vis(mh);
    if (myVis) {
      const x = SX(G.sx[mh]), y = SY(G.sy[mh]);
      if (animate) { const pulse = (now % 1600) / 1600; ctx.beginPath(); ctx.arc(x, y, 10 + pulse * 18, 0, 7); ctx.strokeStyle = `rgba(232,85,61,${1 - pulse})`; ctx.lineWidth = 3; ctx.stroke(); }
      schoolMark(x, y, Math.max(8, Math.min(14, cp * 0.16)), my, true);
    }
    drawMini();
    // 너무 느리면 빠르게 모드로
    const spent = performance.now() - now;
    if (!fast && spent > 45 && ++slow >= 8) setFast(true, true);
    if (more || flashes.length) requestDraw();
    else if (animate && (myVis || exitLines.length || scoping || (cp >= 16 && frontier.size)) && !ambient) ambient = setTimeout(() => { ambient = 0; requestDraw(); }, 90); // 반짝이는 표시는 천천히
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
    const text = (mine ? '⭐ ' : '') + flagMark(sid) + short(sid);
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
    const mb = G.miniBox;
    miniW = Math.min(170, Math.max(110, vw * 0.16)); miniH = miniW * mb.h / mb.w;
    const d = dpr, c = miniImg || document.createElement('canvas');
    c.width = Math.round(miniW * d); c.height = Math.round(miniH * d);
    const g = c.getContext('2d'), k = (miniW * d) / mb.w;
    g.setTransform(k, 0, 0, k, -mb.x0 * k, -mb.y0 * k);
    g.lineWidth = 1 / k;
    g.fillStyle = '#c4c9d0';
    for (const p of G.landPaths) g.fill(p);
    for (const i of owned) { g.fillStyle = g.strokeStyle = cssColor(W.owner[i]); g.fill(pathOf(i)); g.stroke(pathOf(i)); }
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
    const mb = G.miniBox, k = mini.width / mb.w, s = view.s;
    mctx.strokeStyle = '#ff2d55'; mctx.lineWidth = 2 * dpr;
    mctx.strokeRect((-view.x / s - mb.x0) * k, (-view.y / s - mb.y0) * k, (vw / s) * k, (vh / s) * k);
  }
  function miniJump(e) {
    const r = mini.getBoundingClientRect();
    const mb = G.miniBox, x = mb.x0 + ((e.clientX - r.left) / r.width) * mb.w, y = mb.y0 + ((e.clientY - r.top) / r.height) * mb.h;
    view.x = vw / 2 - x * view.s; view.y = vh / 2 - y * view.s;
    nudge();
  }
  mini.addEventListener('pointerdown', e => { mini.setPointerCapture(e.pointerId); miniJump(e); });
  mini.addEventListener('pointermove', e => { if (e.buttons) miniJump(e); });

  // ---------- 지도 움직이기 ----------
  const fitScale = () => Math.min(vw / (G.vb.x1 - G.vb.x0), vh / (G.vb.y1 - G.vb.y0)) * 0.94; // 북한까지 한반도 전체
  const clampS = s => Math.max(fitScale() * 0.8, Math.min(3.2, s)); // 가장 크게: 3.2배
  function zoomAt(px, py, ns) {
    ns = clampS(ns);
    const wx = (px - view.x) / view.s, wy = (py - view.y) / view.s;
    view.s = ns; view.x = px - wx * ns; view.y = py - wy * ns;
    nudge();
  }
  function flyTo(i, s) {
    const from = { ...view }, toS = clampS(s || view.s), t0 = performance.now();
    const to = { s: toS, x: vw / 2 - G.sx[i] * toS, y: vh / 2 - G.sy[i] * toS };
    const step = () => {
      const t = Math.min(1, (performance.now() - t0) / 450), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const ls = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * e);
      const wx = G.sx[i], wy = G.sy[i], cx = (vw / 2 - from.x) / from.s + (wx - (vw / 2 - from.x) / from.s) * e, cy = (vh / 2 - from.y) / from.s + (wy - (vh / 2 - from.y) / from.s) * e;
      view.s = ls; view.x = vw / 2 - cx * ls; view.y = vh / 2 - cy * ls;
      nudge();
      if (t < 1) requestAnimationFrame(step);
    };
    step();
  }
  function fitView() { view.s = fitScale(); view.x = vw / 2 - ((G.vb.x0 + G.vb.x1) / 2) * view.s; view.y = vh / 2 - ((G.vb.y0 + G.vb.y1) / 2) * view.s; requestDraw(); }
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
      nudge();
    } else if (drag) {
      const p = pos(e), dx = p.x - drag.x, dy = p.y - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; nudge(); }
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
    const cost = !mine && hs < 0 ? costOf(i) : {}, off = offerOf.get(i);
    const near = hs >= 0 ? schools[hs] : nearestSchool(G.sx[i], G.sy[i]), dist = near && near.dong ? near : nearestDistrict(G.sx[i], G.sy[i]);
    const title = hs >= 0 ? (mine ? '🏫 우리 학교 본부' : `🏫 ${schools[hs].name}`) : o < 0 ? '⬜ 빈 땅' : mine ? '⭐ 우리 학교 땅' : `🚩 ${short(o)}의 땅`;
    const shut = !mine && hs < 0 && shielded(i), hoursLeft = shut ? Math.ceil((shieldOf.get(i) - Date.now()) / 3600e3) : 0;
    const atkWhy = mine ? '이미 우리 학교 땅이에요.' : hs >= 0 ? '학교 본부는 뺏을 수 없어요.' : shut ? `🛡️ 방패가 지키고 있어요. ${hoursLeft}시간 뒤에 뺏을 수 있어요.` : cost.nk ? cost.error : cost.error ? `노란색 우리 땅과 닿아 있는 땅만 뺏을 수 있어요. (${S.FAR_GRADE}학년부터는 멀리 있는 땅도 문제 ${S.FAR_COST}개로 뺏어요)` : '';
    const defWhy = !mine ? '우리 학교 땅만 방어할 수 있어요.' : hs >= 0 ? '본부는 언제나 안전해요.' : d >= 99 ? '방어가 가장 높아요(99).' : '';
    let ownedN = 0;
    if (o >= 0) for (const k of owned) if (W.owner[k] === o) ownedN++;
    const tags = [`<span class="tag">📍 ${esc(dist.sido)} ${esc(dist.sigungu)}${dist.dong ? ' ' + esc(dist.dong) : ''}${hs < 0 ? ' 근처' : ''}</span>`];
    if (o >= 0 && !mine) tags.push(`<span class="tag" style="--c:${cssColor(o)}">🚩 ${esc(schools[o].name)} · ${ownedN}칸</span>`);
    if (o >= 0 && hs < 0) tags.push(`<span class="tag">🛡️ 방어 <b>${d}</b></span>`);
    if (shielded(i)) tags.push(`<span class="tag" style="--c:#f5b301">✨ 방패가 지키는 중 · ${Math.ceil((shieldOf.get(i) - Date.now()) / 3600e3)}시간 남음</span>`);
    if (o >= 0 && !mine && hs < 0 && FEAT && !shut) tags.push('<span class="tag" style="--c:#e5484d">⚔️ 1:1 수학 결투로 뺏어요</span>');
    if (!mine && hs < 0 && !cost.error && !shut) tags.push(`<span class="tag hot">${cost.far ? '🚀 멀리 있는 땅 · ' : cost.escape ? '🚪 탈출길 · ' : '⚔️ '}문제 <b>${cost.cost}개</b> 풀면 뺏어요</span>`);
    if (G.nkCell[i]) tags.push(`<span class="tag" style="--c:#b08d57">🗺️ 북한 땅 · 우리 땅 ${S.NK_MIN}칸 이상이면 뺏을 수 있어요</span>`);
    if (hs >= 0 && schools[hs] && schools[hs].nk) tags.push('<span class="tag">북한 학교 (실제 학교가 아닌 가상의 소학교예요)</span>');
    if (off) tags.push(`<span class="tag" style="--c:#9333ea">🏷️ ${esc(short(off.from))} → ${esc(short(off.to))}에 판 땅 ${off.cells.length}칸</span>`);
    const deal = off && off.to === my ? `<button type="button" class="btn buy" id="btnBuy">🛒 땅 사기 (${off.cells.length}칸 · 문제 없이)</button>`
      : off && off.from === my ? `<button type="button" class="link-btn" id="btnUnsell">🏷️ 땅 팔기 취소</button>` : '';
    const sellBtn = mine && hs < 0 ? `<button type="button" class="link-btn" id="btnSell">🏷️ 땅 팔기</button>` : '';
    const it = (me.items || {}), items = !FEAT ? '' : mine && hs < 0 && !shielded(i) ? `<button type="button" class="link-btn" id="btnShield">🛡️ 방패 쓰기 (${it.shield || 0}개)</button>`
      : !mine && hs < 0 && !cost.error && !shut ? `<button type="button" class="link-btn" id="btnBomb">💣 폭탄 쓰기 (${it.bomb || 0}개)</button>` : '';
    const admin = me.role ? `<div class="popup-links admin"><b>🛠️</b>${hs < 0 && o >= 0 ? '<button type="button" class="link-btn" data-adm="clearCell">🧹 이 땅 비우기</button>' : ''}${o >= 0 ? '<button type="button" class="link-btn" data-adm="clearSchool">🧹 이 학교 땅 모두 비우기</button>' : ''}${o >= G.schoolCount ? '<button type="button" class="link-btn" data-adm="hideSchool">🗑️ 가짜 학교 지우기</button>' : ''}</div>` : '';
    box.innerHTML = `
      <div class="popup-head"><b>${esc(title)}</b><button type="button" class="icon-btn" id="popClose">✕</button></div>
      <div class="popup-info">${tags.join('')}</div>
      <div class="popup-btns">
        <button type="button" class="btn attack" id="btnAtk" ${atkWhy ? 'disabled' : ''}>⚔️ 땅 뺏기</button>
        <button type="button" class="btn defend" id="btnDef" ${defWhy ? 'disabled' : ''}>🛡️ 땅 방어하기</button>
      </div>
      ${deal ? `<div class="popup-btns">${deal}</div>` : ''}
      ${(mine ? defWhy : atkWhy) && !deal ? `<div class="why">${esc(mine ? defWhy : atkWhy)}</div>` : ''}
      ${items ? `<div class="popup-links">${items}</div>` : ''}
      ${o >= 0 ? `<div class="popup-links"><button type="button" class="link-btn" id="btnInfo">🏫 ${esc(short(hs >= 0 ? hs : o))} 정보</button>${sellBtn}${homeLink(hs >= 0 ? hs : o)}</div>` : ''}${admin}`;
    box.hidden = false;
    if ($('#btnBuy')) $('#btnBuy').onclick = async () => { const r = await api('/api/buy', { id: off.id }); if (r.offers) setOffers(r.offers); afterAction(r, `🛒 ${short(off.from)}의 땅 ${r.cells ? r.cells.length : 0}칸을 샀어요!`, i, 'capture'); };
    if ($('#btnUnsell')) $('#btnUnsell').onclick = async () => { const r = await api('/api/sell/cancel', { id: off.id }); if (r.error) return toast(r.error, 'err'); setOffers(r.offers); toast('땅 팔기를 취소했어요.', 'ok'); };
    if ($('#btnSell')) $('#btnSell').onclick = () => openSell(i);
    if ($('#btnShield')) $('#btnShield').onclick = () => useShield(i);
    if ($('#btnBomb')) $('#btnBomb').onclick = () => useBomb(i);
    $$('#popup [data-adm]').forEach(b => { b.onclick = () => adminAct({ act: b.dataset.adm, cell: i, sid: hs >= 0 ? hs : o }, b); });
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
    $('#scName').innerHTML = `<i class="sw" style="background:${cssColor(sid)}"></i>${esc(flagMark(sid) + d.name)}`;
    const mem = d.members.map(m => `<li class="${m.me ? 'me' : ''}"><i class="dot ${m.online ? 'on' : ''}"></i><span class="nm">${nameHTML(m.nick, m.role)}</span><small>뺏은 땅 ${m.captures} · 문제 ${m.solved}</small></li>`).join('');
    $('#scBody').innerHTML = `
      <p class="muted">📍 ${esc(d.sido)} ${esc(d.sigungu)}${d.dong ? ' ' + esc(d.dong) : ''} · ${me.grade}학년 서버</p>
      <div class="stats"><div><b>${d.land}</b><span>땅</span></div><div><b>${d.rank ? d.rank + '위' : '-'}</b><span>학교 순위</span></div><div><b>${d.def}</b><span>방어 합계</span></div></div>
      <div class="row">${homeLink(sid)}<button type="button" class="link-btn" id="scGo">🗺️ 지도에서 보기</button></div>
      <h4>🧒 함께하는 친구 ${d.memberCount}명</h4>
      <ul class="members">${mem || '<li class="muted">아직 이 학교로 들어온 친구가 없어요.</li>'}</ul>`;
    if (me.role) {
      $('#scBody').insertAdjacentHTML('beforeend', `<div class="row"><button type="button" class="btn attack" id="scKick">🚪 이 학교 학생 모두 퇴장</button></div>`);
      $('#scKick').onclick = async e => { const r = await adminAct({ act: 'kickSchool', sid }, e.currentTarget); if (r && r.ok) openSchool(sid); };
    }
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
    gotWallet(r);
    gotBadges(r.badges);
    toast(okMsg, 'ok');
    if (kind === 'capture') { Sound.play('capture'); celebrate(i); } else { Sound.play('defend'); flashes.push({ i, t: performance.now() }); requestDraw(); }
    if (!$('#panePlayers').hidden) loadPlayers();
    return true;
  }
  // 바로 반응하기: 화면을 먼저 바꾸고, 저장(서버·친구 지도)은 뒤에서 한다. 거절되면 되돌린다.
  function optimistic(i, owner, def, okMsg, kind, send) {
    const before = [i, W.owner[i], W.def[i]];
    applyCells([[i, owner, def]], true);
    toast(okMsg, 'ok');
    if (kind === 'capture') { Sound.play('capture'); celebrate(i); } else { Sound.play('defend'); flashes.push({ i, t: performance.now() }); requestDraw(); }
    return send().then(r => {
      if (!r || r.error || r.need) { applyCells([before], true); if (r && r.error) toast(r.error, 'err'); return r || {}; }
      if (r.cells) applyCells(r.cells, true);
      if (r.stats) me.stats = r.stats;
      gotWallet(r);
      gotBadges(r.badges);
      if (!$('#panePlayers').hidden) loadPlayers();
      return r;
    });
  }
  function doAttack(i) {
    const prev = W.owner[i];
    const okMsg = prev < 0 ? '🎉 빈 땅을 차지했어요!' : `⚔️ ${short(prev)}의 땅을 빼앗았어요!`;
    if (cheat.capture) return optimistic(i, mySid(), 0, '🐛 ' + okMsg, 'capture', () => api('/api/capture', { cell: i, cheat: true }));
    // 다른 학교 땅은 1:1 수학 결투: 땅 주인 학교보다 먼저 다 맞혀야 가져온다
    const duel = prev >= 0 && FEAT ? { cell: i, name: short(prev), pace: S.duelPace(me.grade, W.def[i]) * 1000 } : null;
    const done = solved => {
      optimistic(i, mySid(), 0, duel ? `🏆 결투 승리! ${okMsg}` : okMsg, 'capture', () => api('/api/capture', { cell: i, solved, streak: best, duel: !!duel })).then(r => {
        if (!r.need) return;
        toast(`🛡️ 상대가 방어를 올렸어요! 문제 ${r.need}개를 더 풀어야 해요.`, 'warn'); // 푼 문제는 그대로 두고 이어서 푼다
        startQuiz({ title: '⚔️ 땅 뺏기', total: r.required, solved, onDone: done });
      });
    };
    startQuiz({ title: duel ? `⚔️ 1:1 결투 · ${duel.name}` : '⚔️ 땅 뺏기', total: needToTake(i), duel, onDone: done });
  }
  // 🛒 아이템 쓰기
  async function useShield(i) {
    if (!(me.items && me.items.shield > 0)) { toast('🛡️ 방패가 없어요. 상점에서 살 수 있어요!', 'warn'); return openShop(); }
    const r = await api('/api/item/shield', { cell: i });
    if (r.error) return toast(r.error, 'err');
    setShields(r.shields);
    gotWallet(r);
    Sound.play('defend'); flashes.push({ i, t: performance.now() }); requestDraw();
    toast(`🛡️ 방패를 세웠어요! ${S.SHIELD_HOURS}시간 동안 아무도 못 뺏어요.`, 'ok');
  }
  async function useBomb(i) {
    if (!(me.items && me.items.bomb > 0)) { toast('💣 폭탄이 없어요. 상점에서 살 수 있어요!', 'warn'); return openShop(); }
    const r = await api('/api/item/bomb', { cell: i });
    if (r.error) return toast(r.error, 'err');
    applyCells(r.cells, true);
    if (r.stats) me.stats = r.stats;
    gotWallet(r); gotBadges(r.badges);
    Sound.play('capture');
    for (const [c] of r.cells) flashes.push({ i: c, t: performance.now() });
    celebrate(i);
    toast(`💣 펑! 땅 ${r.cells.length}칸을 한 번에 차지했어요!`, 'ok');
  }
  function setShields(list) { shieldOf = new Map(list || []); requestDraw(); if (sel >= 0) renderPopup(); }
  // 코인·아이템·미션 표시를 응답에 맞춘다
  function gotWallet(r) {
    if (!r || !me) return;
    if (r.coins != null) {
      const up = r.coins > (me.coins || 0);
      me.coins = r.coins;
      if (up) { const el = $('#hudCoins'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    }
    if (r.items) me.items = r.items;
    if (r.mission != null) setMissionDot(r.mission);
    hud();
  }
  function setMissionDot(n) { missionReady = n; $('#missionDot').hidden = !n; }

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
      const to = () => Math.min(99, W.def[i] + n);
      if (cheat.defend) return optimistic(i, mySid(), to(), '🐛 ' + okMsg, 'defend', () => api('/api/defend', { cell: i, amount: n, cheat: true }));
      startQuiz({ title: `🛡️ 땅 방어하기 (+${n})`, total: n, onDone: solved => { optimistic(i, mySid(), to(), okMsg, 'defend', () => api('/api/defend', { cell: i, amount: n, solved, streak: best })); } });
    };
  }

  // ---------- 땅 팔기 ----------
  let sellCell = -1, sellTo = -1;
  function openSell(i) {
    sellCell = i; sellTo = -1;
    const my = mySid(), near = new Map(); // 우리 땅과 닿아 있는 학교
    for (const k of owned) if (W.owner[k] === my) for (const n of G.nbOf(k)) { const o = W.owner[n]; if (o >= 0 && o !== my) near.set(o, (near.get(o) || 0) + 1); }
    const far = me.grade >= S.FAR_GRADE;
    $('#sellRule').innerHTML = far ? `${me.grade}학년은 <b>멀리 있는 학교</b>에도 팔 수 있어요.` : '3학년까지는 <b>우리 땅과 닿아 있는 학교</b>에만 팔 수 있어요.';
    $('#sellFind').hidden = !far; $('#sellFind').value = '';
    const render = () => {
      const q = $('#sellFind').value.trim(), ids = q ? searchSchools(q, 20).map(sc => sc.id).filter(id => id !== my && W.home[id] >= 0) : [...near.keys()];
      $('#sellList').innerHTML = ids.length ? ids.map(id => `<button type="button" class="chip ${id === sellTo ? 'on' : ''}" data-sid="${id}"><i class="sw" style="background:${cssColor(id)}"></i>${esc(short(id))}${near.has(id) ? ' · 닿음' : ''}</button>`).join('') : `<div class="muted">${q ? '찾는 학교가 없어요.' : '우리 땅과 닿아 있는 다른 학교가 없어요.'}</div>`;
      const n = +$('#sellNum').value;
      $('#sellInfo').innerHTML = sellTo >= 0 ? `🏷️ <b>${esc(short(sellTo))}</b>에 이 땅부터 이어진 우리 땅 <b>${n}칸</b>을 팔아요.<br>${esc(short(sellTo))} 친구가 <b>🛒 땅 사기</b>를 누르면 문제 없이 가져가요.` : '땅을 살 학교를 골라 주세요.';
      $('#sellGo').disabled = sellTo < 0;
    };
    $('#sellFind').oninput = render;
    $('#sellList').onclick = e => { const b = e.target.closest('[data-sid]'); if (b) { sellTo = +b.dataset.sid; render(); } };
    const setN = v => { $('#sellNum').value = Math.max(1, Math.min(30, Math.round(v) || 1)); render(); };
    $('#sellMinus').onclick = () => setN(+$('#sellNum').value - 1);
    $('#sellPlus').onclick = () => setN(+$('#sellNum').value + 1);
    $('#sellNum').oninput = () => setN(+$('#sellNum').value);
    $('#sellGo').onclick = async () => {
      const r = await api('/api/sell', { cell: sellCell, to: sellTo, count: +$('#sellNum').value });
      if (r.error) return toast(r.error, 'err');
      closeM('sellModal');
      setOffers(r.offers);
      toast(`🏷️ ${short(sellTo)}에 땅 ${r.offer.cells.length}칸을 내놓았어요!`, 'ok');
    };
    render();
    openM('sellModal');
  }

  // ---------- 운영자 관리 ----------
  let resetAsk = 0;
  async function adminAct(body, btn) {
    if (['resetWorld', 'resetAll', 'hideSchool', 'clearSchool', 'kickSchool', 'kickAll', 'ban', 'unstaff'].includes(body.act) && Date.now() - resetAsk > 3000) { // 확인 창 대신 한 번 더 누르기
      resetAsk = Date.now();
      return toast('정말 할까요? 3초 안에 한 번 더 누르세요.', 'warn');
    }
    resetAsk = 0;
    if (btn) btn.disabled = true;
    const r = await api('/api/admin', body);
    if (btn) btn.disabled = false;
    if (r.error) return toast(r.error, 'err');
    if (r.user) { me = r.user; closeM('adminModal'); toast(`🌐 ${me.grade}학년 서버로 옮겼어요.`, 'ok'); return me.profile ? startGame() : openSetup(); }
    if (r.reload) {
      closeM('adminModal'); select(-1);
      await loadWorld();
      updateBoard(); renderMini(); requestDraw(); hud();
      return toast('🧨 서버를 처음부터 다시 시작했어요!', 'ok');
    }
    if (r.staff) renderStaff(r.staff);
    if (r.cells && r.cells.length) applyCells(r.cells, true);
    if (body.act === 'hideSchool') { delete schools[body.sid]; await loadWorld(); updateBoard(); renderMini(); requestDraw(); select(-1); }
    if (body.act === 'clearChat') clearChat();
    if (r.bans) renderBans(r.bans);
    if (body.act === 'notice') return r; // 공지는 모두에게 뜨는 공지 자체로 충분 (보냈다는 표시는 안 띄운다)
    toast(r.text ? '🛠️ ' + r.text : body.act === 'ban' ? `🚫 ${body.nick} 님을 ${body.days >= 3650 ? '영구' : body.days + '일'} 밴했어요.` : `🛠️ 처리했어요${r.n ? ` (${r.n}칸)` : ''}.`, 'ok');
    return r;
  }
  function renderBans(list) {
    const day = t => { const d = new Date(t); return t - Date.now() > 3000 * 864e5 ? '영구' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}까지`; };
    $('#admBans').innerHTML = list.length ? list.map(b => `<li><b>${esc(b.nick)}</b> <small>${day(b.until)} · 계정 ${b.n}개</small><button type="button" class="link-btn" data-unban="${esc(b.nick)}">풀기</button></li>`).join('') : '<li class="muted">밴한 사람이 없어요.</li>';
  }
  function initAdmin() {
    $('#btnAdmin').onclick = () => {
      $('#admGrades').innerHTML = [1, 2, 3, 4, 5, 6].map(g => `<button type="button" class="chip ${g === me.grade ? 'on' : ''}" data-g="${g}">${g}학년</button>`).join('');
      $('#admWho').textContent = `${S.ROLE_NICK[me.role]} · 지금 ${me.grade}학년 서버`;
      $('#admDev').hidden = me.role !== 'dev';
      if (me.role === 'dev') api('/api/admin', { act: 'bans' }).then(r => { if (r.bans) renderBans(r.bans); });
      if (me.role === 'dev' && FEAT) api('/api/admin', { act: 'staff' }).then(r => { if (r.staff) renderStaff(r.staff); });
      openM('adminModal');
    };
    $('#admGrades').onclick = e => { const b = e.target.closest('[data-g]'); if (b && +b.dataset.g !== me.grade) adminAct({ act: 'grade', grade: +b.dataset.g }); };
    $('#admNoticeGo').onclick = async () => { await adminAct({ act: 'notice', text: $('#admNotice').value }); $('#admNotice').value = ''; };
    $('#admChat').onclick = e => adminAct({ act: 'clearChat' }, e.currentTarget);
    $('#admReset').onclick = e => adminAct({ act: 'resetWorld' }, e.currentTarget);
    $('#admKickAll').onclick = e => adminAct({ act: 'kickAll' }, e.currentTarget);
    $('#admResetAll').onclick = e => adminAct({ act: 'resetAll' }, e.currentTarget);
    $('#admBanGo').onclick = e => adminAct({ act: 'ban', nick: $('#admBanNick').value.trim(), days: Math.round(+$('#admBanDays').value) }, e.currentTarget);
    $('#admBanForever').onclick = () => { $('#admBanDays').value = 3650; };
    $('#admInvGo').onclick = async e => { const r = await adminAct({ act: 'invite', username: $('#admInvId').value.trim() }, e.currentTarget); if (r && r.ok) $('#admInvId').value = ''; };
    $('#admStaff').onclick = e => { const b = e.target.closest('[data-unstaff]'); if (b) adminAct({ act: 'unstaff', username: b.dataset.unstaff }, b); };
    $('#admBans').onclick = e => { const b = e.target.closest('[data-unban]'); if (b) adminAct({ act: 'unban', nick: b.dataset.unban }, b).then(r => { if (r && r.ok) toast(`✅ ${b.dataset.unban} 님 밴을 풀었어요.`, 'ok'); }); };
  }

  // ---------- 문제 풀기 ----------
  let quiz = null;
  const coarse = matchMedia('(pointer: coarse)').matches;
  function startQuiz(opts) {
    if (quiz) stopTimers(quiz);
    quiz = Object.assign({ solved: 0 }, opts);
    openM('quizModal');
    $('#qzDuel').hidden = !quiz.duel;
    if (quiz.duel) startDuel(quiz);
    if (quiz.speed) startSpeedTimer(quiz);
    nextProblem();
  }
  const stopTimers = q => { if (q && q.timer) { clearInterval(q.timer); q.timer = 0; } };
  // ⚔️ 1:1 결투: 땅 주인 학교 막대가 정해진 빠르기로 차오른다. 먼저 끝까지 가는 쪽이 이긴다
  function startDuel(q) {
    const d = q.duel;
    d.t0 = performance.now();
    const tick = () => {
      if (quiz !== q) return stopTimers(q);
      const opp = Math.min(q.total, (performance.now() - d.t0) / d.pace);
      $('#qzDuel').innerHTML = `<div class="dl"><span>😀 나</span><div class="bar"><i style="width:${(q.solved / q.total) * 100}%"></i></div><em>${q.solved}/${q.total}</em></div>`
        + `<div class="dl opp"><span>🛡️ ${esc(d.name)}</span><div class="bar"><i style="width:${(opp / q.total) * 100}%"></i></div><em>${Math.floor(opp)}/${q.total}</em></div>`;
      if (opp >= q.total && q.solved < q.total) duelLost(q);
    };
    q.timer = setInterval(tick, 150);
    tick();
  }
  function duelLost(q) {
    stopTimers(q);
    q.busy = true;
    q.practice = true; // 닫을 때 맞힌 문제만큼 코인을 받는다
    q.lostMsg = true;
    Sound.play('lose');
    feedback(`😢 ${q.duel.name}가 먼저 다 풀었어요! 결투에서 졌어요.`, 'bad');
    $('#qzPad').hidden = true; $('#qzHintBtn').hidden = true; $('#qzHint').hidden = true;
    $('#qzAnswer').innerHTML = `<p class="muted">맞힌 문제 ${q.solved}개는 코인으로 받아요. 다시 도전해 볼까요?</p><div class="row end"><button type="button" class="btn" id="qzLoseClose">닫기</button><button type="button" class="btn primary" id="qzRetry">⚔️ 다시 결투하기</button></div>`;
    $('#qzLoseClose').onclick = closeQuiz;
    $('#qzRetry').onclick = () => { closeQuiz(); doAttack(q.duel.cell); };
  }
  // ⏱️ 스피드 퀴즈: 1분 동안 최대한 많이 (틀려도 뒤로 가지 않고 바로 다음 문제)
  function startSpeed() {
    closeM('studyModal');
    startQuiz({ title: '⏱️ 스피드 퀴즈', total: 999, speed: { end: performance.now() + 60000 }, onDone: () => {} });
  }
  function startSpeedTimer(q) {
    const tick = () => {
      if (quiz !== q) return stopTimers(q);
      const left = Math.max(0, q.speed.end - performance.now());
      $('#qzCount').textContent = `⏱️ 남은 시간 ${Math.ceil(left / 1000)}초 · 맞힌 문제 ${q.solved}개`;
      $('#qzBar').style.width = (left / 60000) * 100 + '%';
      if (!left) speedDone(q);
    };
    q.timer = setInterval(tick, 200);
    q.tickNow = tick;
  }
  async function speedDone(q) {
    stopTimers(q);
    if (q.speed.done) return;
    q.speed.done = true; q.busy = true;
    $('#qzPad').hidden = true; $('#qzHintBtn').hidden = true; $('#qzHint').hidden = true; $('#qzFeedback').textContent = '';
    $('#qzQ').innerHTML = `⏱️ 끝! 맞힌 문제 <b>${q.solved}개</b>`;
    $('#qzAnswer').innerHTML = '<p class="muted">기록을 저장하는 중…</p>';
    const r = q.solved > 0 ? await api('/api/speed', { score: q.solved, streak: best }) : { got: 0, best: (me.stats || {}).speedBest || 0 };
    if (quiz !== q) return;
    if (r.stats) me.stats = r.stats;
    gotWallet(r); gotBadges(r.badges);
    const record = q.solved > 0 && q.solved >= (r.best || 0);
    $('#qzAnswer').innerHTML = `<div class="hint-box">${record ? '🎉 <b>최고 기록!</b> ' : ''}최고 기록 <b>${r.best || 0}개</b> · 받은 코인 <b>🪙 ${r.got || 0}</b></div><div class="row end"><button type="button" class="btn" id="spClose">닫기</button><button type="button" class="btn primary" id="spAgain">🔄 다시 하기</button></div>`;
    if (record) { Sound.play('unlock'); confetti(innerWidth / 2, innerHeight * 0.35); }
    $('#spClose').onclick = closeQuiz;
    $('#spAgain').onclick = startSpeed;
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
    if (quiz.speed) { if (quiz.tickNow) quiz.tickNow(); }
    else {
      $('#qzCount').textContent = `문제 ${quiz.solved + 1} / ${quiz.total}`;
      $('#qzBar').style.width = (quiz.solved / quiz.total) * 100 + '%';
    }
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
        <input id="qzInput" autocomplete="off" inputmode="${coarse ? 'none' : p.frac ? 'text' : 'decimal'}" placeholder="${p.frac ? '분자/분모 예: 3/10 (=10분의 3)' : '답을 써요'}">
        ${p.unit ? `<span class="unit">${esc(p.unit)}</span>` : ''}<button class="btn primary">확인</button></form><div id="qzPreview" class="qz-preview"></div>`;
      $('#qzInput').oninput = showPreview;
      $('#qzForm').onsubmit = e => { e.preventDefault(); answer($('#qzInput').value); };
      const keys = ['7', '8', '9', '⌫', '4', '5', '6', 'C', '1', '2', '3', '.', '0', '/', '와', '확인'];
      $('#qzPad').innerHTML = keys.map(k => `<button type="button" data-k="${k}" class="${k === '확인' ? 'go' : /\d/.test(k) ? '' : 'op'}">${k}</button>`).join('');
      $('#qzPad').hidden = false;
      if (!coarse) setTimeout(() => { const el = $('#qzInput'); if (el) el.focus(); }, 60);
    }
  }
  // 분수를 쓰는 동안 어떻게 보이는지 미리 보여 준다 (10/3 → 3분의 10)
  function showPreview() {
    const el = $('#qzInput'), box = $('#qzPreview');
    if (!el || !box) return;
    const v = el.value.replace(/\s+/g, ''), m = v.match(/^(?:(\d+)(?:와|과))?(\d+)\/(\d+)$/);
    box.innerHTML = m ? `내가 쓴 답: ${m[1] ? esc(m[1]) + ' ' : ''}${fmt(`{${m[2]}/${m[3]}}`)} <small>(${m[1] ? esc(m[1]) + '와 ' : ''}${esc(m[3])}분의 ${esc(m[2])})</small>` : '';
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
      feedback('⭕ ' + PRAISE[Math.floor(Math.random() * PRAISE.length)], 'ok');
      if (quiz.speed) { const q = quiz; setTimeout(() => { if (quiz === q && !q.speed.done) nextProblem(); }, 250); return; }
      $('#qzBar').style.width = (quiz.solved / quiz.total) * 100 + '%';
      const last = quiz.solved >= quiz.total;
      if (last) stopTimers(quiz); // 결투: 내가 먼저 다 풀었다
      setTimeout(last ? finishQuiz : nextProblem, last ? 250 : 600); // 마지막 문제는 바로 땅에 적용
    } else {
      streak = 0;
      renderStreak();
      Sound.play('bad');
      $('#qzHintBtn').hidden = false;
      if (res === 'simplest') return feedback('🤏 거의 맞았어요! 더 이상 약분할 수 없게(기약분수로) 써 주세요.', 'bad');
      if (res === 'flipped') { // 틀린 걸로 치지 않고 다시 쓰게
        const [a, b] = String(v).replace(/\s+/g, '').split('/');
        return feedback(`🔄 분자와 분모가 바뀌었어요! ${a}분의 ${b}는 ${b}/${a} 처럼 위의 수(분자)를 먼저 써요.`, 'bad');
      }
      if (!quiz.fixed && !quiz.noted) { // 틀린 문제는 오답 노트에
        quiz.noted = true;
        const { q, a, hint, unit, frac, simplest, choices } = quiz.p;
        api('/api/wrong', { p: { q, a, hint, unit, frac, simplest, choices }, given: String(v).slice(0, 30) }).then(r => { if (r.count != null) setWrongCount(r.count); });
      }
      if (quiz.speed) { // 스피드 퀴즈: 정답만 보여 주고 바로 다음 문제
        const q = quiz;
        q.busy = true;
        $('#qzHintBtn').hidden = true;
        feedback(`❌ 정답은 ${P.answerText(q.p)}`, 'bad');
        setTimeout(() => { if (quiz === q && !q.speed.done) nextProblem(); }, 900);
        return;
      }
      if (!quiz.fixed) { // 틀리면 한 단계 뒤로 가고, 같은 문제가 아닌 새 문제를 푼다
        quiz.busy = true;
        const back = quiz.solved > 0;
        if (back) quiz.solved--;
        $('#qzCount').textContent = `문제 ${quiz.solved + 1} / ${quiz.total}`;
        $('#qzBar').style.width = (quiz.solved / quiz.total) * 100 + '%';
        feedback(`❌ 틀렸어요! 정답은 ${P.answerText(quiz.p)}${back ? ' · 한 단계 뒤로 가요' : ''}`, 'bad');
        $('#qzPad').hidden = true;
        $('#qzAnswer').innerHTML = '<button type="button" class="btn primary big" id="qzNew">🔄 새 문제 풀기</button>';
        $('#qzNew').onclick = nextProblem;
        return;
      }
      feedback('❌ 틀렸어요! 다시 풀어 보세요.', 'bad');
      const el = $('#qzInput');
      if (el) { if (!coarse) el.select(); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
    }
  }
  async function finishQuiz() {
    const q = quiz;
    if (!q) return;
    stopTimers(q);
    const r = await q.onDone(q.solved);
    if (quiz !== q) return;
    if (r && r.more) { q.total += r.more; toast(r.msg, 'warn'); nextProblem(); return; }
    closeQuiz();
  }
  function closeQuiz() {
    const q = quiz;
    quiz = null;
    stopTimers(q);
    closeM('quizModal');
    if (q && q.speed && !q.speed.done && q.solved > 0) api('/api/speed', { score: q.solved, streak: best }).then(r => { if (!r.error) { me.stats = r.stats; gotWallet(r); } });
    else if (q && q.practice && q.solved > 0) reportPractice(q.solved, q.lostMsg ? `⚔️ 결투에서 맞힌 문제 ${q.solved}개만큼 코인을 받았어요.` : '');
  }
  async function reportPractice(n, msg) {
    const r = await api('/api/practice', { solved: n, streak: best });
    if (r.error) return;
    me.stats = r.stats;
    gotWallet(r);
    toast(msg || `✏️ 연습 끝! 문제 ${n}개를 풀었어요. (🪙 +${r.got || n})`, 'ok');
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
    li.innerHTML = `<span class="t">${new Date(m.at).toTimeString().slice(0, 5)}</span><span class="ch">${m.ch === 'school' ? '🏫' : '🌐'}</span><b style="color:${mine ? '#b45309' : cssColor(m.sid)}">${nameHTML(m.by, m.role)}</b><small>${esc(short(m.sid))}</small> ${esc(m.text != null ? m.text : S.CHAT[m.m] || '')}`;
    $('#feed').prepend(li);
    while ($('#feed').children.length > 60) $('#feed').lastChild.remove();
    if ($('#paneFeed').hidden) $('#feedDot').hidden = false;
    if (!mine && ($('#paneFeed').hidden || (innerWidth <= 820 && !$('#side').classList.contains('open')))) $('#chatDot').hidden = false;
  }
  function openChat() { // 💬 채팅: 옆 칸(폰은 펼쳐서)의 소식 탭을 열고 글자 칸에 바로
    $('#side').classList.add('open');
    $$('.stab').forEach(x => x.classList.toggle('on', x.dataset.pane === 'paneFeed'));
    $$('.pane').forEach(p => { p.hidden = p.id !== 'paneFeed'; });
    $('#feedDot').hidden = true; $('#chatDot').hidden = true;
    if (!coarse) setTimeout(() => $('#chatInput').focus(), 50);
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
      showPreview();
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
    W = { owner: Int32Array.from(d.owner), def: new Uint8Array(G.n), home: d.home.slice(), homeCell: new Int32Array(G.n).fill(-1) }; // 방어는 최대 99
    defended = new Set();
    d.def.forEach(([i, v]) => { W.def[i] = v; defended.add(i); });
    owned = new Set();
    W.owner.forEach((o, i) => { if (o >= 0) owned.add(i); });
    W.home.forEach((c, sid) => { if (c >= 0) W.homeCell[c] = sid; });
    online = d.online || 0;
    if (d.user) me = d.user; // 코인·아이템·운영자 여부 등 최신으로
    if (d.stats) me.stats = d.stats;
    flagsOf = d.flags || {};
    shieldOf = new Map(d.shields || []);
    if (d.mission != null) setMissionDot(d.mission);
    colorCache.clear();
    tiles.clear();
    setOffers(d.offers || [], true);
    computeFrontier();
    return d;
  }
  function setOffers(items, quiet) {
    W.offers = items || [];
    offerOf = new Map();
    for (const o of W.offers) for (const c of o.cells) if (W.owner[c] === o.from) offerOf.set(c, o);
    if (!quiet) { requestDraw(); if (sel >= 0) renderPopup(); }
  }
  async function startGame() {
    show('game');
    sel = -1;
    renderPopup();
    $('#feed').innerHTML = '';
    const d = await loadWorld();
    if (!d) return;
    (d.chat || []).forEach(chatLine);
    if (d.attend) setTimeout(() => toast(`📅 출석 체크! ${d.attend.days}일째${d.attend.streak > 1 ? ` (${d.attend.streak}일 연속)` : ''}${d.attend.coins ? ` · 🪙 +${d.attend.coins}` : ''}`, 'ok'), 1200);
    if (d.invite) setTimeout(() => showInvite(d.invite), 900);
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
      const on = window.MLEBackend.isShared();
      $('#conn span').textContent = on ? '온라인' : '오프라인 (온라인 서버 연결 전)';
      $('#conn').classList.toggle('off', !on);
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
    if (m.t === 'chatClear') return clearChat();
    if (m.t === 'banned') return showBanned(m.ban);
    if (m.t === 'kicked') return kickedOut();
    if (m.t === 'offers') { setOffers(m.items); if (m.ev) feed(m.ev); return; }
    if (m.t === 'shields') return setShields(m.items);
    if (m.t === 'flags') return setFlags(m.items);
    if (m.t !== 'upd') return;
    if (m.reload) { loadWorld().then(d => { if (d) { updateBoard(); renderPopup(); renderMini(); requestDraw(); hud(); } }); if (m.ev) feed(m.ev); return; }
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
    if (W.offers && W.offers.length) setOffers(W.offers, true);
    computeFrontier();
    requestDraw();
    scheduleBoard();
    scheduleMini();
    if (sel >= 0) renderPopup();
  }
  function computeFrontier() {
    const my = mySid(), mine = [];
    frontier = new Set();
    for (const i of owned) { // 50만 칸을 다 보지 않고 주인 있는 칸만 본다
      if (W.owner[i] !== my) continue;
      mine.push(i);
      for (const n of G.nbOf(i)) if (W.owner[n] !== my && W.homeCell[n] < 0) frontier.add(n);
    }
    // 둘레에 빈 땅이 하나도 없으면(다른 학교 땅·본부에 갇히면) 가장 가까운 빈 땅이 탈출길이 된다
    myLand = mine.length;
    exits = new Set(S.escapeCells(W.owner, G.nbOf, my, mine));
    exitLines = [];
    for (const e of exits) {
      let best = -1, bd = Infinity;
      for (const k of mine) { const d = (G.sx[k] - G.sx[e]) ** 2 + (G.sy[k] - G.sy[e]) ** 2; if (d < bd) { bd = d; best = k; } }
      if (best >= 0) exitLines.push([best, e]);
    }
    // 🔭 망원경: 우리 땅 둘레의 다른 학교 땅 중 방어가 가장 낮은 곳 (방패 없는 곳)
    weakCells = !scopeOn() ? [] : [...frontier].filter(i => W.owner[i] >= 0 && W.owner[i] !== my && !shielded(i)).sort((a, b) => W.def[a] - W.def[b]).slice(0, 12);
  }
  function clearChat() { $$('#feed li.chat').forEach(li => li.remove()); }
  function feed(ev) {
    const my = mySid(), who = `${ev.by}${ev.role && S.MARK[ev.role] ? S.MARK[ev.role] : ''}(${short(ev.sid)})`;
    let txt, cls = ev.sid === my ? 'mine' : '';
    if (ev.kind === 'capture') txt = ev.prev >= 0 ? `⚔️ ${who}님이 ${short(ev.prev)}의 땅을 빼앗았어요!` : `🌱 ${who}님이 빈 땅을 차지했어요.`;
    else if (ev.kind === 'defend') txt = `🛡️ ${who}님이 땅을 방어했어요 (+${ev.amount})`;
    else if (ev.kind === 'join') txt = `🏫 ${short(ev.sid)}가 지도에 나타났어요!`;
    else if (ev.kind === 'sell') {
      txt = `🏷️ ${who}님이 ${short(ev.to)}에 땅 ${ev.n}칸을 팔려고 내놓았어요`;
      if (ev.to === my && ev.sid !== my) { cls = 'alert'; toast(`🏷️ ${short(ev.sid)}가 우리 학교에 땅 ${ev.n}칸을 팔았어요! 🏷️ 땅을 눌러 '땅 사기'를 하세요.`, 'ok'); Sound.play('unlock'); }
    } else if (ev.kind === 'buy') txt = `🛒 ${who}님이 ${short(ev.from)}의 땅 ${ev.n}칸을 샀어요`;
    else if (ev.kind === 'notice') { txt = `📢 ${ev.text}`; cls = 'alert'; toast(`📢 ${ev.text}`, 'warn'); }
    else if (ev.kind === 'admin') { txt = `🛠️ ${ev.by}: ${ev.text}`; if (ev.chatClear) clearChat(); }
    else if (ev.kind === 'bomb') txt = `💣 ${who}님이 폭탄으로 땅 ${ev.n}칸을 한 번에 차지했어요!`;
    else if (ev.kind === 'shield') txt = `🛡️ ${who}님이 방패를 세웠어요 (${S.SHIELD_HOURS}시간)`;
    else return;
    if (ev.kind === 'capture' && ev.duel && ev.prev >= 0) txt = `⚔️ ${who}님이 1:1 결투에서 이겨 ${short(ev.prev)}의 땅을 빼앗았어요!`;
    if (ev.kind === 'bomb' && ev.sid !== my) flashes.push({ i: ev.cell, t: performance.now() });
    if (ev.kind === 'capture' && (ev.far || ev.escape)) txt = `${ev.far ? '🚀' : '🚪'} ${who}님이 ${ev.far ? '멀리 있는' : '탈출길'} 땅을 차지했어요!`;
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
    $('#hudUser').innerHTML = `😀 ${nameHTML(me.profile.nickname, me.role)} · ${me.grade}-${me.profile.semester}`;
    $('#cheatBadge').hidden = !(cheat.capture || cheat.defend);
    $('#btnAdmin').hidden = !me.role;
    $('#btnSound').textContent = Sound.on ? '🔊' : '🔇';
    $('#btnBgm').style.opacity = Music.on ? 1 : 0.4;
    $('#btnMission').hidden = $('#btnShop').hidden = $('#hudCoins').hidden = !FEAT;
    $('#hudCoinN').textContent = me.infCoins ? '∞' : me.coins || 0;
    const left = (me.scopeUntil || 0) - Date.now(), sc = $('#hudScope');
    sc.hidden = left <= 0;
    if (left > 0) { sc.textContent = `🔭 ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`; if (!scopeTimer) scopeTimer = setInterval(() => { hud(); if (!scopeOn()) { clearInterval(scopeTimer); scopeTimer = 0; if (W) { computeFrontier(); requestDraw(); } } }, 1000); }
  }
  let boardTimer = null, scopeTimer = 0;
  function scheduleBoard() { if (!boardTimer) boardTimer = setTimeout(() => { boardTimer = null; updateBoard(); }, 300); }
  function updateBoard() {
    if (!W) return;
    const cnt = new Map();
    for (let i = 0; i < G.n; i++) { const o = W.owner[i]; if (o >= 0) cnt.set(o, (cnt.get(o) || 0) + 1); }
    const arr = [...cnt.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const my = mySid(), rank = arr.findIndex(e => e[0] === my) + 1, mine = cnt.get(my) || 0;
    const medal = k => ['🥇', '🥈', '🥉'][k] || k + 1;
    $('#board').innerHTML = arr.slice(0, 10).map(([sid, n], k) =>
      `<li class="${sid === my ? 'me' : ''}" data-sid="${sid}"><span class="rk">${medal(k)}</span><i style="background:${cssColor(sid)}"></i><span class="nm">${esc(flagMark(sid) + short(sid))}</span><b>${n}</b></li>`).join('');
    $('#myRank').innerHTML = `⭐ 우리 학교 <b>${rank || '-'}위</b> · 땅 <b>${mine}</b>칸 · 뺏을 수 있는 땅 <b>${frontier.size}</b>칸` + (exits.size ? '<br>🚪 빈 땅이 막혔어요! 초록 점선 <b>탈출길</b>로 빠져나가요.' : '') + (me.grade >= S.FAR_GRADE ? `<br>🚀 ${S.FAR_GRADE}학년부터: 멀리 있는 땅도 문제 ${S.FAR_COST}개로 뺏을 수 있어요.` : '');
    $('#hudLand').textContent = mine;
    $('#hudRank').textContent = rank || '-';
  }
  // ---------- 📊 랭킹표: 학교(땅) · 학생(뺏은 땅) · 시도 대항전 ----------
  let rankTab = 'school';
  async function openRank(tab) {
    if (!W) return;
    rankTab = tab || rankTab;
    $$('.rtab').forEach(b => b.classList.toggle('on', b.dataset.t === rankTab));
    openM('rankModal');
    const my = mySid(), medal = k => ['🥇', '🥈', '🥉'][k] || k + 1, TOP = 50;
    const where = sid => { const sc = schools[sid]; return sc ? `${SIDO_FULL[sc.sido] || sc.sido} ${sc.sigungu}` : ''; };
    let head = '', rows = [], sum = '';
    if (rankTab === 'player') {
      $('#rankBody').innerHTML = '<tr><td class="muted">불러오는 중…</td></tr>';
      const d = await api('/api/players?n=' + TOP);
      if (d.error || rankTab !== 'player') return;
      head = '<tr><th>순위</th><th>친구</th><th class="num">뺏은 땅</th><th class="num">푼 문제</th></tr>';
      rows = d.top.map((p, k) => `<tr class="${p.me ? 'me' : ''}" data-sid="${p.sid}"><td class="rk">${medal(k)}</td><td><i class="sw" style="background:${cssColor(p.sid)}"></i>${nameHTML(p.nick, p.role)}<small>${esc(short(p.sid))}</small></td><td class="num">${p.captures}</td><td class="num">${p.solved}</td></tr>`);
      if (d.rank > TOP) rows.push('<tr class="gap"><td colspan="4">⋯</td></tr>', `<tr class="me"><td class="rk">${d.rank}</td><td>😀 나</td><td class="num">${me.stats.captures}</td><td class="num">${me.stats.solved}</td></tr>`);
      sum = `${me.grade}학년 서버 친구 ${d.total}명 · 나는 <b>${d.rank || '-'}위</b>`;
    } else {
      const land = new Map(), def = new Map();
      for (const i of owned) { const o = W.owner[i]; land.set(o, (land.get(o) || 0) + 1); if (W.def[i]) def.set(o, (def.get(o) || 0) + W.def[i]); }
      if (rankTab === 'school') {
        const arr = [...land.entries()].sort((a, b) => b[1] - a[1] || (def.get(b[0]) || 0) - (def.get(a[0]) || 0) || a[0] - b[0]), mine = arr.findIndex(e => e[0] === my);
        const row = (sid, n, k) => `<tr class="${sid === my ? 'me' : ''}" data-sid="${sid}"><td class="rk">${medal(k)}</td><td><i class="sw" style="background:${cssColor(sid)}"></i>${esc(flagMark(sid) + short(sid))}<small>${esc(where(sid))}</small></td><td class="num">${n}</td><td class="num">${def.get(sid) || 0}</td></tr>`;
        head = '<tr><th>순위</th><th>학교</th><th class="num">땅</th><th class="num">방어</th></tr>';
        rows = arr.slice(0, TOP).map(([sid, n], k) => row(sid, n, k));
        if (mine >= TOP) rows.push('<tr class="gap"><td colspan="4">⋯</td></tr>', row(my, arr[mine][1], mine));
        sum = `땅을 가진 학교 ${arr.length.toLocaleString()}곳 · 우리 학교 <b>${mine >= 0 ? mine + 1 + '위' : '-'}</b> (땅 ${mine >= 0 ? arr[mine][1] : 0}칸)`;
      } else { // 시·도 대항전: 그 시·도 학교들의 땅을 모두 더한다
        const by = new Map();
        for (const [sid, n] of land) { const sc = schools[sid]; if (!sc) continue; const v = by.get(sc.sido) || { land: 0, schools: 0 }; v.land += n; if (n > 1) v.schools++; by.set(sc.sido, v); }
        const arr = [...by.entries()].sort((a, b) => b[1].land - a[1].land), mySido = schools[my] && schools[my].sido;
        head = '<tr><th>순위</th><th>시·도</th><th class="num">땅</th><th class="num">넓힌 학교</th></tr>';
        rows = arr.map(([sd, v], k) => `<tr class="${sd === mySido ? 'me' : ''}"><td class="rk">${medal(k)}</td><td>${esc(SIDO_FULL[sd] || sd)}</td><td class="num">${v.land.toLocaleString()}</td><td class="num">${v.schools}</td></tr>`);
        sum = `우리 ${esc(SIDO_FULL[mySido] || mySido || '')}는 <b>${arr.findIndex(e => e[0] === mySido) + 1}위</b> · 넓힌 학교 = 본부 말고 땅을 더 가진 학교`;
      }
    }
    $('#rankHead').innerHTML = head;
    $('#rankBody').innerHTML = rows.join('') || '<tr><td class="muted">아직 아무도 없어요</td></tr>';
    $('#rankSum').innerHTML = sum;
  }
  async function loadPlayers() {
    const d = await api('/api/players');
    if (d.error) return;
    const medal = k => ['🥇', '🥈', '🥉'][k] || k + 1;
    $('#players').innerHTML = d.top.length ? d.top.map((p, k) =>
      `<li class="${p.me ? 'me' : ''}"><span class="rk">${medal(k)}</span><i style="background:${cssColor(p.sid)}"></i><span class="nm">${nameHTML(p.nick, p.role)} <small>${esc(short(p.sid))}</small></span><b>${p.captures}</b></li>`).join('') : '<li class="muted">아직 아무도 없어요</li>';
    $('#myPlayer').innerHTML = `😀 나 <b>${d.rank || '-'}위</b> / ${d.total}명 · 뺏은 땅 <b>${me.stats.captures}</b> · 푼 문제 <b>${me.stats.solved}</b>`;
  }

  // ---------- 설정 + 비밀 버그 창 ----------
  let schoolClicks = 0, bugClicks = 0;
  function openSettings() {
    schoolClicks = bugClicks = 0;
    const s = schools[mySid()], st = me.stats || {};
    $('#setInfo').innerHTML = `
      <div>👤 아이디: <b>${esc(me.username)}</b>${markOf(me.role)}</div>
      <div>${me.role ? `🛠️ <b>${S.ROLE_NICK[me.role]}</b> ${me.builtin ? '계정' : '(초대로 된 운영자)'} · ${me.grade}학년 서버` : `🎂 나이 인증: <b>${me.birthYear}년생</b> → <b>${me.grade}학년</b> (${me.grade}학년 서버)`}</div>
      <div>🏫 학교: <b>${esc(s ? s.name : '')}</b> <span class="muted">${esc(s ? s.sido + ' ' + s.sigungu : '')}</span></div>`;
    $('#setStats').innerHTML = `<div><b>${st.solved || 0}</b><span>푼 문제</span></div><div><b>${st.captures || 0}</b><span>뺏은 땅</span></div><div><b>${st.defends || 0}</b><span>올린 방어</span></div>`;
    $$('.sem2').forEach(b => b.classList.toggle('on', +b.dataset.sem === me.profile.semester));
    $('#setNick').value = me.profile.nickname;
    $('#secretBug').hidden = !(cheat.unlocked || me.role === 'dev');
    renderSoundBtns();
    openM('settingsModal');
  }
  function renderSoundBtns() {
    $('#setBgm').textContent = `🎵 배경 음악: ${Music.on ? '켜짐 ✅' : '꺼짐'}`; $('#setBgm').classList.toggle('on', Music.on);
    $('#setSound').textContent = `🔊 효과음: ${Sound.on ? '켜짐 ✅' : '꺼짐'}`; $('#setSound').classList.toggle('on', Sound.on);
    hud();
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
    $('#bugCoins').textContent = `🪙 코인 무한 : ${me && me.infCoins ? '켜짐 ✅' : '꺼짐'}`;
    $('#bugCoins').classList.toggle('on', !!(me && me.infCoins));
    $('#bugCoins').hidden = !FEAT;
    hud();
  }
  function wiggle(el) { el.classList.remove('tap'); void el.offsetWidth; el.classList.add('tap'); }
  function initSettings() {
    $('#btnSettings').onclick = openSettings;
    $$('.fast-toggle').forEach(b => { b.onclick = () => setFast(!fast); b.textContent = `⚡ 빠르게 모드: ${fast ? '켜짐 ✅' : '꺼짐'}`; b.classList.toggle('on', fast); });
    $('#btnHelp').onclick = () => openM('helpModal');
    $('#setHelp').onclick = () => { closeM('settingsModal'); openM('helpModal'); };
    $('#setMySchool').onclick = () => { closeM('settingsModal'); openSchool(mySid()); };
    $('#btnBadges').onclick = openBadges;
    $('#pwSave').onclick = async () => {
      const r = await api('/api/password', { old: $('#pwOld').value, password: $('#pwNew').value });
      if (r.error) return toast(r.error, 'err');
      $('#pwOld').value = $('#pwNew').value = '';
      toast('🔑 비밀번호를 바꿨어요.', 'ok');
    };
    $('#btnBoard').onclick = () => $('#side').classList.toggle('open');
    $('#btnRank').onclick = () => openRank();
    $('#btnRankMore').onclick = () => openRank('school');
    $$('.rtab').forEach(b => { b.onclick = () => openRank(b.dataset.t); });
    $('#rankBody').onclick = e => { const tr = e.target.closest('tr[data-sid]'); if (tr && +tr.dataset.sid >= 0) { closeM('rankModal'); openSchool(+tr.dataset.sid); } };
    $('#btnSound').onclick = () => { Sound.toggle(); hud(); Sound.play('tap'); };
    $('#btnBgm').onclick = () => { Music.toggle(); hud(); toast(Music.on ? '🎵 배경 음악을 켰어요.' : '🎵 배경 음악을 껐어요.', 'ok'); };
    $('#setBgm').onclick = () => { Music.toggle(); renderSoundBtns(); };
    $('#setSound').onclick = () => { Sound.toggle(); Sound.play('tap'); renderSoundBtns(); };
    $$('.sem2').forEach(b => { b.onclick = async () => { if (await saveProfile({ semester: +b.dataset.sem })) { $$('.sem2').forEach(x => x.classList.toggle('on', x === b)); toast(`${b.dataset.sem}학기 문제가 나와요.`, 'ok'); } }; });
    $('#setNickSave').onclick = async () => { if (await saveProfile({ nickname: $('#setNick').value.trim() })) toast('닉네임을 바꿨어요.', 'ok'); };
    $('#setSchool').onclick = () => { closeM('settingsModal'); if (es) { es.close(); es = null; } W = null; openSetup(); };
    $('#setLogout').onclick = async () => { await api('/api/logout', {}); logoutLocal(); };
    $('#banLogout').onclick = async () => { await api('/api/logout', {}); logoutLocal(); };
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
    $('#bugCoins').onclick = async () => {
      const r = await api('/api/debug/coins', { on: !me.infCoins });
      if (r.error) return toast(r.error, 'err');
      me = r.user; renderBug();
      toast(me.infCoins ? '🪙 코인 무한! 상점에서 마음껏 사요.' : '🪙 코인 무한을 껐어요.', 'ok');
    };
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
    $('#btnChat').onclick = openChat;
    $('#chatForm').hidden = !FEAT;
    $('#chatForm').onsubmit = async e => {
      e.preventDefault();
      const text = $('#chatInput').value.trim();
      if (!text) return;
      const r = await api('/api/chat', { ch: chatCh, text });
      if (r.error) return toast(r.error, 'warn');
      $('#chatInput').value = '';
      Sound.play('tap');
    };
    $$('.chch').forEach(b => { b.onclick = () => { chatCh = b.dataset.ch; $$('.chch').forEach(x => x.classList.toggle('on', x === b)); }; });
    const landOf = () => { const m = new Map(); for (const i of owned) m.set(W.owner[i], (m.get(W.owner[i]) || 0) + 1); return id => m.get(id) || 0; };
    const findRender = () => {
      const q = $('#findSchool').value.trim(), region = regionSchools(q);
      if (!q) { $('#findList').innerHTML = ''; return; }
      const list = region ? region.list : searchSchools(q, 30), title = region ? `${region.label}에 있는 모든 학교` : `"${q}" 검색 결과`;
      $('#findList').innerHTML = list.length ? `<div class="list-title">🏫 ${esc(title)} <b>${list.length}곳</b></div>` + schoolListHTML(list, landOf()) : '<div class="muted pad">찾는 학교가 없어요.</div>';
    };
    $('#findSchool').oninput = findRender;
    $('#findMyDong').onclick = () => { const s = schools[mySid()]; $('#findSchool').value = s ? s.dong || s.sigungu : ''; findRender(); };
    $('#findMyCity').onclick = () => { const s = schools[mySid()]; $('#findSchool').value = s ? s.sigungu : ''; findRender(); };
    $('#findList').onclick = e => { const b = e.target.closest('[data-sid]'); if (b) { jumpToSchool(+b.dataset.sid); $('#findSchool').value = ''; $('#findList').innerHTML = ''; } };
    $$('.stab').forEach(t => { t.onclick = () => {
      $$('.stab').forEach(x => x.classList.toggle('on', x === t));
      $$('.pane').forEach(p => { p.hidden = p.id !== t.dataset.pane; });
      if (t.dataset.pane === 'panePlayers') loadPlayers();
      if (t.dataset.pane === 'paneFeed') $('#feedDot').hidden = true;
    }; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !quiz) { $$('.modal').forEach(m => { m.hidden = true; }); select(-1); } });
  }

  // ---------- ✏️ 공부방 · 🎯 오늘의 미션 · 🛒 상점 ----------
  function openStudy() {
    $('#stSpeedBest').textContent = FEAT ? `1분 동안 많이 맞히기 · 최고 ${(me.stats && me.stats.speedBest) || 0}개` : '1분 동안 많이 맞히기';
    $('#stSpeed').hidden = !FEAT;
    $('#stWrongN').textContent = wrongN ? `틀린 문제 ${wrongN}개` : '틀린 문제를 다시 풀어요';
    openM('studyModal');
  }
  function renderMissions(d) {
    setMissionDot(d.ready);
    $('#msInfo').innerHTML = '오늘 미션 3개를 깨고 코인을 받아요! 내일이 되면 새 미션이 나와요.';
    $('#msList').innerHTML = d.list.map(m => {
      const ready = !m.done && m.p >= m.n;
      return `<div class="mission ${m.done ? 'done' : ready ? 'ready' : ''}"><div class="mi">${m.icon}</div><div><b>${esc(m.text)}</b><div class="bar"><i style="width:${(m.p / m.n) * 100}%"></i></div><small>${m.p} / ${m.n}</small></div>`
        + (m.done ? '<span class="muted">받았어요 ✓</span>' : `<button type="button" class="btn ${ready ? 'primary' : ''}" data-claim="${m.id}" ${ready ? '' : 'disabled'}>🪙 ${m.coin}</button>`) + '</div>';
    }).join('');
    const all = d.list.every(m => m.done);
    $('#msBonus').innerHTML = d.bonus ? '🎁 오늘 보너스까지 모두 받았어요! 내일 또 만나요.' : `🎁 세 미션을 모두 끝내면 보너스 <b>🪙 ${d.bonusCoin}</b> ${all ? '<button type="button" class="btn primary" data-claim="bonus">받기</button>' : ''}`;
  }
  async function openMissions() {
    const d = await api('/api/missions');
    if (d.error) return toast(d.error, 'err');
    renderMissions(d);
    openM('missionModal');
  }
  async function claimMission(id, btn) {
    btn.disabled = true;
    const d = await api('/api/missions/claim', { id });
    if (d.error) { btn.disabled = false; return toast(d.error, 'err'); }
    gotWallet(d);
    renderMissions(d);
    Sound.play('unlock');
    confetti(innerWidth / 2, innerHeight * 0.35, 50);
    toast(`🎯 미션 완료! 🪙 +${d.got}`, 'ok');
  }
  let shopData = null, flagPick = { c: S.FLAG_COLORS[0], m: S.FLAG_MARKS[0] };
  async function openShop() {
    const d = await api('/api/shop');
    if (d.error) return toast(d.error, 'err');
    shopData = d;
    me.coins = d.coins; me.items = d.items; me.scopeUntil = d.scopeUntil;
    renderShop();
    $('#flagBox').hidden = true;
    openM('shopModal');
    hud();
  }
  function renderShop() {
    const d = shopData;
    $('#shopCoins').textContent = me.infCoins ? '∞' : me.coins || 0;
    $('#shopList').innerHTML = S.SHOP.map(it => {
      const price = d.prices[it.id], own = it.id === 'flag' ? '' : `<span class="own">가진 개수: ${(me.items || {})[it.id] || 0}개</span>`;
      const use = it.id === 'scope' ? `<button type="button" class="btn" data-use="scope" ${(me.items || {}).scope ? '' : 'disabled'}>쓰기</button>`
        : it.id === 'flag' ? '' : '<small class="muted">지도에서 땅을 눌러 써요</small>';
      return `<div class="shop-item"><div class="si">${it.icon}</div><b>${esc(it.name)}</b><p>${esc(it.desc)}</p>${own}`
        + `<div>🪙 <b>${price}</b></div>`
        + `<div class="row">${it.id === 'flag' ? `<button type="button" class="btn primary" data-flag="1">꾸미기</button>` : `<button type="button" class="btn primary" data-buy="${it.id}" ${(me.coins || 0) >= price ? '' : 'disabled'}>사기</button>${use}`}</div></div>`;
    }).join('');
  }
  function renderFlagBox() {
    const name = short(mySid()), price = shopData.prices.flag;
    $('#flagColors').innerHTML = S.FLAG_COLORS.map(c => `<button type="button" class="chip color ${c === flagPick.c ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
    $('#flagMarks').innerHTML = S.FLAG_MARKS.map(m => `<button type="button" class="chip mk ${m === flagPick.m ? 'on' : ''}" data-m="${m}">${m}</button>`).join('');
    $('#flagPreview').style.background = flagPick.c;
    $('#flagPreview').textContent = `${flagPick.m} ${name}`;
    $('#flagGo').textContent = `🚩 ${price}🪙로 바꾸기`;
    $('#flagGo').disabled = (me.coins || 0) < price;
  }
  function setFlags(items) { flagsOf = items || {}; colorCache.clear(); tiles.clear(); requestDraw(); renderMini(); scheduleBoard(); }
  function initShop() {
    $('#btnStudy').onclick = openStudy;
    $('#stPractice').onclick = () => { closeM('studyModal'); startPractice(); };
    $('#stSpeed').onclick = startSpeed;
    $('#stWrong').onclick = () => { closeM('studyModal'); openWrong(); };
    $('#btnMission').onclick = openMissions;
    $('#msList').onclick = e => { const b = e.target.closest('[data-claim]'); if (b) claimMission(b.dataset.claim, b); };
    $('#msBonus').onclick = e => { const b = e.target.closest('[data-claim]'); if (b) claimMission(b.dataset.claim, b); };
    $('#btnShop').onclick = openShop;
    $('#hudCoins').onclick = openShop;
    $('#shopList').onclick = async e => {
      const buy = e.target.closest('[data-buy]'), use = e.target.closest('[data-use]'), fl = e.target.closest('[data-flag]');
      if (fl) { flagPick = Object.assign({}, flagsOf[mySid()] || flagPick); renderFlagBox(); $('#flagBox').hidden = false; $('#flagBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
      if (buy) {
        buy.disabled = true;
        const r = await api('/api/shop/buy', { id: buy.dataset.buy });
        if (r.error) { buy.disabled = false; return toast(r.error, 'err'); }
        gotWallet(r); renderShop();
        Sound.play('unlock');
        const it = S.SHOP.find(x => x.id === buy.dataset.buy);
        toast(`${it.icon} ${it.name}을(를) 샀어요!${it.id === 'scope' ? '' : ' 지도에서 땅을 눌러 써요.'}`, 'ok');
      }
      if (use) {
        const r = await api('/api/item/scope', {});
        if (r.error) return toast(r.error, 'err');
        me.scopeUntil = r.until;
        gotWallet(r); renderShop(); computeFrontier(); requestDraw();
        closeM('shopModal');
        toast(`🔭 망원경을 썼어요! ${S.SCOPE_MIN}분 동안 약한 땅이 빨갛게 반짝여요.`, 'ok');
        goHome();
      }
    };
    $('#flagColors').onclick = e => { const b = e.target.closest('[data-c]'); if (b) { flagPick.c = b.dataset.c; renderFlagBox(); } };
    $('#flagMarks').onclick = e => { const b = e.target.closest('[data-m]'); if (b) { flagPick.m = b.dataset.m; renderFlagBox(); } };
    $('#flagCancel').onclick = () => { $('#flagBox').hidden = true; };
    $('#flagGo').onclick = async () => {
      const r = await api('/api/flag', flagPick);
      if (r.error) return toast(r.error, 'err');
      gotWallet(r); setFlags(r.flags); renderShop();
      $('#flagBox').hidden = true;
      Sound.play('unlock'); confetti(innerWidth / 2, innerHeight * 0.4, 50);
      toast(`🚩 우리 학교 깃발을 바꿨어요! 다른 학교 친구들에게 ${flagPick.m} 마크와 새 색깔로 보여요.`, 'ok');
    };
  }

  // ---------- 📨 운영자 초대 받기 ----------
  function showInvite(inv) {
    if (!inv || inviteShown || !me) return;
    inviteShown = true;
    $('#invBy').textContent = `보낸 사람: ${inv.by || '개발자'} · ${new Date(inv.at).toLocaleDateString('ko-KR')}`;
    $('#invId').textContent = me.username;
    $('#invAsk').hidden = false; $('#invAuth').hidden = true; $('#invPw').value = ''; setErr('#invErr');
    openM('inviteModal');
    Sound.play('unlock');
  }
  function initInvite() {
    $('#invYes').onclick = () => { $('#invAsk').hidden = true; $('#invAuth').hidden = false; setTimeout(() => $('#invPw').focus(), 50); };
    $('#invBack').onclick = () => { $('#invAsk').hidden = false; $('#invAuth').hidden = true; };
    $('#invNo').onclick = async () => { await api('/api/invite/decline', {}); closeM('inviteModal'); toast('운영자 초대를 거절했어요.', 'warn'); };
    $('#invAuth').onsubmit = async e => {
      e.preventDefault();
      const r = await api('/api/invite/accept', { password: $('#invPw').value });
      if (r.error) { Sound.play('bad'); return setErr('#invErr', r.error); }
      me = r.user;
      closeM('inviteModal');
      hud();
      Sound.play('unlock'); confetti(innerWidth / 2, innerHeight * 0.3, 90);
      toast(`${S.MARK.admin} 운영자가 되었어요! 위쪽 🛠️ 버튼으로 게임을 관리할 수 있어요.`, 'ok');
    };
  }
  function renderStaff(st) {
    const label = { pending: '⏳ 기다리는 중', declined: '🙅 거절함' };
    $('#admStaff').innerHTML = (st.admins.map(n => `<li><b>${esc(n)}</b><span class="mark admin">${S.MARK.admin}</span> <small>운영자</small><button type="button" class="link-btn" data-unstaff="${esc(n)}">해제</button></li>`).join('')
      + st.invites.map(v => `<li><b>${esc(v.username)}</b> <small>${label[v.status] || v.status}</small></li>`).join('')) || '<li class="muted">초대로 만든 운영자가 아직 없어요.</li>';
  }

  // ---------- 시작 ----------
  async function boot() {
    try { await loadMap(); } catch (e) { $('#loadMsg').textContent = '😢 ' + (e.message || '지도를 불러오지 못했어요.') + ' 새로고침 해 주세요.'; return; }
    if (window.MLEIntro) { await window.MLEIntro.done(); Sound.play('tap'); Music.start(); } // 인트로: 시작하기를 누르면 들어간다 (배경 음악도 이때)
    else document.addEventListener('pointerdown', () => Music.start(), { once: true });
    initAuth(); initSetup(); initGameUi(); initDefense(); initQuiz(); initSettings(); initAdmin(); initShop(); initInvite();
    if (!token) return show('auth');
    const d = await api('/api/me');
    if (d.code === 423) return; // 정지 화면이 이미 떴다
    if (!d.user) { show('auth'); if (d.error) toast(d.error, 'err'); return; }
    me = d.user;
    cheat.unlocked = !!d.debug || me.role === 'dev';
    route();
    if (d.invite && me.profile) setTimeout(() => showInvite(d.invite), 1500);
  }
  boot();
})();
