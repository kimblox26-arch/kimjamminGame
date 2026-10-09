/* 매뜨 땅먹 — 애니메이션 인트로 + 로딩 화면 (말랑 점토 스타일)
 * 글자가 하나씩 떨어져 통통 튀고, 왕관이 내려앉으며 반짝, 수학 기호 타일이 둥둥 떠다닌다.
 * 가운데 무대에서는 진짜 한반도 모양 위에서 학교들이 땅을 넓히고, 학교 위로 수학 문제 말풍선이 떠올라
 * 정답이 나오면 땅이 한꺼번에 퐁퐁 늘어난다. 아래에는 진행률 막대(왕관이 타고 간다)와 게임 팁.
 * 다 불러오면 "시작하기" 버튼이 튀어나오고, 누르면 화면이 커지며 사라진다.
 * app.js 가 쓰는 것: MLEIntro.setLand(land, W, H), MLEIntro.progress(%, 글), MLEIntro.done() → 누르면 끝나는 Promise */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const cv = $('#introMap'), g = cv.getContext('2d');
  const layer = document.createElement('canvas'), lg = layer.getContext('2d');
  const COLORS = ['#7b6cff', '#ff8a5c', '#22c39a', '#4b8df8', '#ffb020', '#f0508a', '#14b8c4', '#9bcf2e', '#c06cff'];
  const TIPS = [
    '💡 분수는 분자/분모로 써요. 10분의 3 → 3/10',
    '🛡️ 땅 방어를 올리면 다른 학교가 뺏기 어려워요',
    '🚀 4학년부터는 멀리 있는 땅도 문제 50개로 뺏을 수 있어요',
    '🗺️ 우리 학교 땅이 200칸을 넘으면 북한 땅도 뺏을 수 있어요',
    '🔥 연속으로 맞히면 불꽃이 붙어요',
    '📒 틀린 문제는 오답 노트에 모여요',
    '🪙 문제 1개를 맞히면 1코인! 상점에서 방패·폭탄·망원경을 사요',
    '🎯 오늘의 미션을 깨면 코인을 받아요',
    '⚔️ 랭크 배틀에서 이기면 티어가 올라가요',
    '👑 도전 버튼에 시즌 · 모험 · 대항전 · 장터가 모여 있어요',
    '⏱️ 스피드 퀴즈: 1분 동안 몇 문제나 맞힐까요?',
    '🗺️ 작은 지도는 지도 버튼이나 메뉴에서 켜고 끌 수 있어요',
  ];
  const SUB = '수학으로 넓히는 우리 학교 땅';
  const SYMS = ['+', '−', '×', '÷', '=', '%', 'π', '√', '½', '7', '3', '9'];
  const SYM_COLORS = ['#6d5dfc', '#ff8a5c', '#22c39a', '#4b8df8', '#f0508a', '#ffb020'];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, rings = null, box = null, land = null, hexes = [], hexR = 4;
  let owner = null, born = null, fronts = [], seeds = [], recent = [], bubbles = [], sparks = [];
  let raf = 0, running = true, dirty = true, fullAt = 0, fadeIn = 0;
  const timers = [];
  const later = (f, ms) => timers.push(setTimeout(f, ms));

  // 캔버스 크기 (보이는 크기에 맞춰 선명하게)
  function fit() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(160, r.width); H = Math.max(160, r.height);
    cv.width = layer.width = Math.round(W * dpr); cv.height = layer.height = Math.round(H * dpr);
    if (rings) buildHexes();
  }

  // 지도 파일의 해안선(줄여 쓴 정수 좌표)을 캔버스 모양으로
  function setLand(enc) {
    rings = enc.map(e => { const o = []; let x = 0, y = 0; for (let k = 0; k < e.length; k += 2) { x += e[k]; y += e[k + 1]; o.push(x, y); } return o; });
    box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of rings) for (let k = 0; k < r.length; k += 2) { box[0] = Math.min(box[0], r[k]); box[1] = Math.min(box[1], r[k + 1]); box[2] = Math.max(box[2], r[k]); box[3] = Math.max(box[3], r[k + 1]); }
    buildHexes();
  }
  function buildHexes() {
    const pad = 16, s = Math.min((W - 2 * pad) / (box[2] - box[0]), (H - 2 * pad) / (box[3] - box[1]));
    const ox = (W - (box[2] - box[0]) * s) / 2 - box[0] * s, oy = (H - (box[3] - box[1]) * s) / 2 - box[1] * s;
    const path = new Path2D();
    for (const r of rings) { path.moveTo(r[0] * s + ox, r[1] * s + oy); for (let k = 2; k < r.length; k += 2) path.lineTo(r[k] * s + ox, r[k + 1] * s + oy); path.closePath(); }
    land = path;
    // 육각형 칸 (뾰족한 쪽이 위) 중 땅 위에 있는 것만
    const R = Math.max(3.4, Math.min(W, H) / 62), dx = Math.sqrt(3) * R, dy = 1.5 * R;
    hexes = []; const at = new Map();
    g.setTransform(dpr, 0, 0, dpr, 0, 0); // isPointInPath 는 지금 변환을 따른다
    for (let row = 0, y = R; y < H; row++, y += dy) for (let col = 0, x = (row % 2 ? dx / 2 : 0) + dx / 2; x < W; col++, x += dx) {
      if (g.isPointInPath(path, x * dpr, y * dpr)) { at.set(row + ',' + col, hexes.length); hexes.push({ x, y, row, col, nb: [] }); }
    }
    const odd = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]], even = [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    for (const h of hexes) for (const [r, c] of (h.row % 2 ? odd : even)) { const j = at.get((h.row + r) + ',' + (h.col + c)); if (j !== undefined) h.nb.push(j); }
    hexR = R;
    reset();
  }
  function reset() { // 학교 몇 곳이 처음 칸에서 시작
    owner = new Int8Array(hexes.length).fill(-1);
    born = new Float64Array(hexes.length);
    fronts = []; seeds = []; recent = []; bubbles = []; sparks = [];
    const k = 6 + Math.floor(Math.random() * 3);
    for (let i = 0, tries = 0; seeds.length < k && hexes.length && tries < 200; tries++) {
      const h = Math.floor(Math.random() * hexes.length);
      if (owner[h] >= 0 || seeds.some(o => Math.hypot(hexes[o].x - hexes[h].x, hexes[o].y - hexes[h].y) < hexR * 7)) continue;
      owner[h] = i; seeds.push(h); fronts.push([h]); i++;
    }
    fullAt = 0; fadeIn = performance.now(); dirty = true;
  }
  // 학교 s 가 닿아 있는 빈 칸을 n개 차지 (게임처럼)
  function grow(s, n, now) {
    const f = fronts[s]; let got = 0;
    for (let t = 0; t < n; t++) {
      for (let tries = 0; tries < 8 && f.length; tries++) {
        const i = Math.floor(Math.random() * f.length), free = hexes[f[i]].nb.filter(j => owner[j] < 0);
        if (!free.length) { f.splice(i, 1); continue; }
        const j = free[Math.floor(Math.random() * free.length)];
        owner[j] = s; born[j] = now; f.push(j); recent.push(j); got++; dirty = true;
        break;
      }
    }
    return got;
  }
  function hexPath(c, x, y, r) {
    c.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; c.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
    c.closePath();
  }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  // 바뀔 때만 다시 그리는 땅 그림 (말랑한 점토 섬 + 볼록한 칸)
  function drawLayer() {
    lg.setTransform(dpr, 0, 0, dpr, 0, 0);
    lg.clearRect(0, 0, W, H);
    lg.save(); lg.shadowColor = 'rgba(60, 70, 170, .35)'; lg.shadowBlur = 18; lg.shadowOffsetY = 8;
    lg.fillStyle = '#f6f5fd'; lg.fill(land); lg.restore();
    for (let i = 0; i < hexes.length; i++) {
      const h = hexes[i], o = owner[i];
      hexPath(lg, h.x, h.y, hexR * 0.93);
      lg.fillStyle = o >= 0 ? COLORS[o] : '#e7e5f5'; lg.fill();
      lg.lineWidth = 0.9; lg.strokeStyle = o >= 0 ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.9)'; lg.stroke();
      if (o >= 0) { hexPath(lg, h.x - hexR * 0.18, h.y - hexR * 0.22, hexR * 0.42); lg.fillStyle = 'rgba(255,255,255,.28)'; lg.fill(); }
    }
    lg.lineWidth = 1.4; lg.strokeStyle = 'rgba(109, 93, 252, .3)'; lg.stroke(land);
  }
  // 학교 위로 떠오르는 수학 문제 말풍선
  function spawnBubble(now) {
    if (!seeds.length) return;
    const s = Math.floor(Math.random() * seeds.length), f = fronts[s];
    const at = hexes[f.length ? f[Math.floor(Math.random() * f.length)] : seeds[s]];
    const op = Math.random() < 0.55 ? '×' : '+', a = 2 + Math.floor(Math.random() * 8), b = 2 + Math.floor(Math.random() * 8);
    bubbles.push({ s, x: at.x, y: at.y, t0: now, q: `${a}${op}${b}`, ans: op === '×' ? a * b : a + b, hit: false });
  }
  function burst(x, y, color) {
    for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2, v = 0.06 + Math.random() * 0.08; sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.05, t0: performance.now(), c: k % 3 ? color : '#ffd54a' }); }
  }
  function drawWaiting(t) { // 지도 받기 전: 통통 튀는 점토 공 세 개
    for (let k = 0; k < 3; k++) {
      const b = Math.abs(Math.sin(t / 260 + k * 0.7)), x = W / 2 + (k - 1) * 28, y = H / 2 + 10 - b * 26;
      g.fillStyle = 'rgba(60,70,170,.15)'; g.beginPath(); g.ellipse(x, H / 2 + 22, 10 - b * 3, 3, 0, 0, 7); g.fill();
      const gr = g.createRadialGradient(x - 3, y - 4, 2, x, y, 11); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, COLORS[k * 2]); gr.addColorStop(1, COLORS[k * 2]);
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, 10, 0, 7); g.fill();
    }
  }
  function draw(t) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!land) return drawWaiting(t);
    if (dirty) { drawLayer(); dirty = false; }
    let alpha = Math.min(1, (t - fadeIn) / 450);
    if (fullAt) alpha = Math.max(0, 1 - (t - fullAt - 900) / 450);
    g.globalAlpha = Math.max(0, alpha);
    g.drawImage(layer, 0, 0, W, H);
    // 막 차지한 칸은 퐁 하고 커졌다 작아진다
    recent = recent.filter(j => t - born[j] < 360);
    for (const j of recent) {
      const k = (t - born[j]) / 360, h = hexes[j], sc = 1 + 0.7 * Math.sin(k * Math.PI) ;
      hexPath(g, h.x, h.y, hexR * 0.93 * sc); g.fillStyle = COLORS[owner[j]]; g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#fff'; g.stroke();
    }
    // 학교 본부: 점토 핀 + 퍼지는 고리
    const pulse = (t % 1400) / 1400;
    seeds.forEach((h, s) => {
      const p = hexes[h], R = hexR * 1.35;
      g.beginPath(); g.arc(p.x, p.y, R * (1 + pulse * 1.6), 0, 7); g.strokeStyle = `rgba(255,255,255,${0.9 - pulse * 0.9})`; g.lineWidth = 2; g.stroke();
      g.fillStyle = 'rgba(40,40,120,.25)'; g.beginPath(); g.ellipse(p.x, p.y + R * 0.9, R * 0.9, R * 0.35, 0, 0, 7); g.fill();
      g.beginPath(); g.arc(p.x, p.y, R, 0, 7); g.fillStyle = '#fff'; g.fill();
      const gr = g.createRadialGradient(p.x - R * 0.3, p.y - R * 0.35, 1, p.x, p.y, R * 0.7); gr.addColorStop(0, '#fff'); gr.addColorStop(0.4, COLORS[s]); gr.addColorStop(1, COLORS[s]);
      g.beginPath(); g.arc(p.x, p.y, R * 0.66, 0, 7); g.fillStyle = gr; g.fill();
    });
    // 말풍선: 문제 → 정답 ✓ → 땅이 한꺼번에 늘어난다
    bubbles = bubbles.filter(b => t - b.t0 < 1700);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const b of bubbles) {
      const age = t - b.t0, solved = age > 700;
      if (solved && !b.hit) { b.hit = true; grow(b.s, 6, t); burst(b.x, b.y - 26, COLORS[b.s]); }
      const pop = Math.min(1, age / 220), sc = pop < 1 ? 0.4 + 0.75 * pop - 0.15 * Math.sin(pop * Math.PI) : 1;
      const a = age > 1400 ? 1 - (age - 1400) / 300 : 1, y = Math.max(18, b.y - 22 - Math.min(age, 1700) * 0.01);
      const txt = solved ? `${b.q}=${b.ans} ✓` : `${b.q} = ?`;
      g.save(); g.globalAlpha = Math.max(0, a) * g.globalAlpha; g.translate(b.x, y); g.scale(sc, sc);
      g.font = '800 12px Pretendard, "Apple SD Gothic Neo", sans-serif';
      const w = g.measureText(txt).width + 16;
      g.shadowColor = 'rgba(60,60,160,.35)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
      rr(g, -w / 2, -11, w, 22, 11); g.fillStyle = solved ? '#22c39a' : '#fff'; g.fill();
      g.shadowColor = 'transparent';
      g.beginPath(); g.moveTo(-5, 10); g.lineTo(0, 16); g.lineTo(5, 10); g.closePath(); g.fill();
      g.fillStyle = solved ? '#fff' : '#3b2fb0'; g.fillText(txt, 0, 0.5);
      g.restore();
    }
    // 반짝이 가루
    sparks = sparks.filter(p => t - p.t0 < 650);
    for (const p of sparks) {
      const age = t - p.t0, x = p.x + p.vx * age, y = p.y + p.vy * age + 0.00012 * age * age;
      g.globalAlpha = Math.max(0, 1 - age / 650) * Math.max(0, alpha);
      g.fillStyle = p.c; g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }
  let lastGrow = 0, lastBubble = 0;
  function loop(t) {
    if (!running) return;
    if (land && !fullAt && t - lastGrow > (reduce ? 400 : 120)) {
      lastGrow = t;
      let any = 0;
      for (let s = 0; s < seeds.length; s++) any += grow(s, 1, t);
      if (!any) fullAt = t; // 다 찼으면 잠깐 보여 주고 사라졌다가 다시
    }
    if (fullAt && t - fullAt > 1400) reset();
    if (land && !fullAt && !reduce && t - lastBubble > 650) { lastBubble = t; spawnBubble(t); }
    draw(t);
    raf = requestAnimationFrame(loop);
  }

  // 떠다니는 수학 기호 타일
  function symbols() {
    const box = $('#ibSyms'); if (!box) return;
    const spots = [[6, 8], [80, 6], [88, 30], [4, 36], [12, 62], [86, 58], [70, 84], [8, 86], [46, 92], [92, 82], [30, 4], [60, 2]];
    spots.forEach(([x, y], k) => {
      const el = document.createElement('span'), s = 30 + Math.round(Math.random() * 22);
      el.textContent = SYMS[k % SYMS.length];
      el.style.cssText = `left:${x}%;top:${y}%;--s:${s}px;--c:${SYM_COLORS[k % SYM_COLORS.length]};--d:${(0.2 + k * 0.09).toFixed(2)}s;--f:${(3 + Math.random() * 3).toFixed(1)}s;--r0:${Math.round(Math.random() * 30 - 15)}deg;--r1:${Math.round(Math.random() * 30 - 15)}deg`;
      box.appendChild(el);
    });
  }
  // 한 글자씩 써지는 부제목
  function typeSub() {
    const el = $('#ibSub'); if (!el) return;
    if (reduce) { el.textContent = SUB; return; }
    let i = 0; el.classList.add('typing');
    const tick = () => { el.textContent = SUB.slice(0, ++i); if (i < SUB.length) later(tick, 55); else later(() => el.classList.remove('typing'), 900); };
    later(tick, 1500);
  }
  // 문제 풀기 → 땅 차지 → 학교 1등 이 차례로 반짝
  function cycleSteps() {
    const items = [...document.querySelectorAll('#ibSteps li:not(.ar)')]; let k = 0;
    const next = () => { if (!running) return; items.forEach((li, i) => li.classList.toggle('on', i === k)); k = (k + 1) % items.length; later(next, 1300); };
    later(next, 2600);
  }
  // 팁
  let ti = Math.floor(Math.random() * TIPS.length);
  function nextTip() {
    if (!running) return;
    const tip = $('#introTip');
    tip.textContent = TIPS[ti++ % TIPS.length]; tip.classList.remove('show'); void tip.offsetWidth; tip.classList.add('show');
    later(nextTip, 3800);
  }

  function progress(p, msg) {
    p = Math.max(0, Math.min(100, Math.round(p)));
    $('#loadBar').style.width = p + '%';
    $('#ibRider').style.left = p + '%';
    $('#loadPct').textContent = p + '%';
    if (msg) $('#loadMsg').textContent = msg;
  }
  // 다 불러왔으면 시작 버튼 (누르면 화면이 커지며 사라지고 끝)
  function done() {
    progress(100, '준비 완료!');
    const btn = $('#introStart');
    $('#introProgress').hidden = true;
    btn.hidden = false;
    btn.focus();
    return new Promise(res => {
      let gone = false;
      const go = () => {
        if (gone) return; gone = true;
        window.removeEventListener('keydown', key);
        $('#loading').classList.add('leaving');
        setTimeout(() => { running = false; cancelAnimationFrame(raf); timers.forEach(clearTimeout); res(); }, reduce ? 0 : 520);
      };
      const key = e => { if (e.key === 'Enter' || e.key === ' ') go(); };
      btn.onclick = go;
      window.addEventListener('keydown', key);
    });
  }

  window.addEventListener('resize', fit);
  fit();
  symbols();
  typeSub();
  cycleSteps();
  later(nextTip, 2400);
  raf = requestAnimationFrame(loop);
  window.MLEIntro = { setLand, progress, done };
})();
