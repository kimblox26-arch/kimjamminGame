/* 매뜨 땅먹 — 미니게임 '검의 회오리'
 * 내 둘레를 도는 검이 다가오는 괴물을 물리친다. 괴물을 잡으면 포인트, 포인트로 검 크기 · 회전 속도 · 체력 · 괴물 접근을 별 1~3까지 올린다.
 * 맵에는 체력 포션이 최대 3개 (20초마다 1~2개). 머리 위에 닉네임 · 체력 막대 · 체력 숫자.
 * app.js 가 쓰는 것: MLEMini.open({ api, toast, nick, S, sfx }) */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const WORLD = 3400, TAU = Math.PI * 2;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let O = null, S = null, cv, g, W = 0, H = 0, dpr = 1, raf = 0, last = 0;
  let data = null, state = 'lobby', st = null;
  const keys = {}, joy = { on: false, id: -1, bx: 0, by: 0, x: 0, y: 0 };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- 멋진 맵: 풀밭 무늬 · 꽃 · 나무 · 바위 · 돌 광장 · 흙길 · 숲 가장자리 ----------
  let pattern = null, decor = [], paths = [], flies = [];
  function makeWorld() {
    const t = document.createElement('canvas'); t.width = t.height = 256; const c = t.getContext('2d');
    c.fillStyle = '#7fc46f'; c.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 26; k++) { const gr = c.createRadialGradient(Math.random() * 256, Math.random() * 256, 0, 0, 0, 0); void gr; c.fillStyle = Math.random() < .5 ? 'rgba(255,255,255,.05)' : 'rgba(30,90,40,.07)'; c.beginPath(); c.ellipse(Math.random() * 256, Math.random() * 256, rnd(20, 60), rnd(14, 40), rnd(0, 3), 0, TAU); c.fill(); }
    for (let k = 0; k < 340; k++) { const x = Math.random() * 256, y = Math.random() * 256; c.strokeStyle = Math.random() < .5 ? 'rgba(40,110,50,.45)' : 'rgba(170,230,140,.5)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + rnd(-2, 2), y - rnd(3, 7)); c.stroke(); }
    pattern = g.createPattern(t, 'repeat');
    decor = []; flies = [];
    const C = WORLD / 2, far = (x, y, r) => Math.hypot(x - C, y - C) > r;
    const put = (kind, n, minR, size) => { for (let k = 0; k < n; k++) { const x = rnd(80, WORLD - 80), y = rnd(80, WORLD - 80); if (far(x, y, minR)) decor.push({ kind, x, y, s: rnd(size[0], size[1]), h: Math.random(), c: Math.floor(Math.random() * 5) }); } };
    put('flower', 520, 230, [3, 6]); put('bush', 110, 260, [16, 28]); put('rock', 90, 260, [12, 26]); put('tree', 140, 330, [30, 48]); put('shroom', 60, 260, [6, 10]); put('pillar', 18, 420, [16, 22]);
    decor.sort((a, b) => a.y - b.y);
    paths = [];
    for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + rnd(-.3, .3), pts = []; let r = 210; while (r < WORLD * .72) { const w = Math.sin(r / 160 + k) * 60; pts.push([C + Math.cos(a) * r - Math.sin(a) * w, C + Math.sin(a) * r + Math.cos(a) * w]); r += 60; } paths.push(pts); }
    for (let k = 0; k < 70; k++) flies.push({ x: rnd(0, WORLD), y: rnd(0, WORLD), p: Math.random() * TAU });
  }
  const FLOWER = ['#ffffff', '#ffd54a', '#ff8fb5', '#a397ff', '#7fd6ff'];
  function drawDecor(d, cam, t) {
    const x = d.x - cam.x, y = d.y - cam.y;
    if (x < -80 || y < -100 || x > W + 80 || y > H + 80) return;
    if (d.kind === 'flower') { g.fillStyle = FLOWER[d.c]; for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + d.h; g.beginPath(); g.arc(x + Math.cos(a) * d.s * .7, y + Math.sin(a) * d.s * .7, d.s * .55, 0, TAU); g.fill(); } g.fillStyle = '#ffb020'; g.beginPath(); g.arc(x, y, d.s * .45, 0, TAU); g.fill(); return; }
    if (d.kind === 'shroom') { g.fillStyle = '#f3ead8'; g.fillRect(x - d.s * .25, y - d.s * .2, d.s * .5, d.s * .9); g.fillStyle = '#e5484d'; g.beginPath(); g.ellipse(x, y - d.s * .2, d.s, d.s * .7, 0, Math.PI, 0); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(x - d.s * .35, y - d.s * .55, d.s * .18, 0, TAU); g.arc(x + d.s * .3, y - d.s * .45, d.s * .14, 0, TAU); g.fill(); return; }
    // 그림자
    g.fillStyle = 'rgba(20,50,30,.22)'; g.beginPath(); g.ellipse(x + d.s * .2, y + d.s * .35, d.s * 1.05, d.s * .42, 0, 0, TAU); g.fill();
    if (d.kind === 'bush') { for (const [ox, oy, r] of [[-.45, 0, .62], [.45, 0, .62], [0, -.35, .75]]) { const gr = g.createRadialGradient(x + ox * d.s - d.s * .2, y + oy * d.s - d.s * .3, 1, x + ox * d.s, y + oy * d.s, d.s * r); gr.addColorStop(0, '#8fdc72'); gr.addColorStop(1, '#3e9a4b'); g.fillStyle = gr; g.beginPath(); g.arc(x + ox * d.s, y + oy * d.s, d.s * r, 0, TAU); g.fill(); } if (d.c < 2) { g.fillStyle = '#ff6b8a'; g.beginPath(); g.arc(x - d.s * .2, y - d.s * .5, 2.6, 0, TAU); g.arc(x + d.s * .3, y - d.s * .2, 2.6, 0, TAU); g.fill(); } return; }
    if (d.kind === 'rock') { const gr = g.createLinearGradient(x, y - d.s, x, y + d.s * .5); gr.addColorStop(0, '#c9ccd8'); gr.addColorStop(1, '#7d8296'); g.fillStyle = gr; g.beginPath(); g.moveTo(x - d.s, y + d.s * .3); g.lineTo(x - d.s * .7, y - d.s * .5); g.lineTo(x - d.s * .1, y - d.s * .8); g.lineTo(x + d.s * .7, y - d.s * .45); g.lineTo(x + d.s, y + d.s * .3); g.closePath(); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.moveTo(x - d.s * .6, y - d.s * .45); g.lineTo(x - d.s * .1, y - d.s * .7); g.lineTo(x + d.s * .1, y - d.s * .3); g.closePath(); g.fill(); return; }
    if (d.kind === 'pillar') { g.fillStyle = '#b9b3cf'; g.fillRect(x - d.s * .5, y - d.s * 2.2, d.s, d.s * 2.4); g.fillStyle = '#d9d4ea'; g.fillRect(x - d.s * .7, y - d.s * 2.45, d.s * 1.4, d.s * .35); g.fillStyle = 'rgba(80,60,140,.25)'; g.fillRect(x + d.s * .15, y - d.s * 2.2, d.s * .35, d.s * 2.4); g.fillStyle = `rgba(163,151,255,${.5 + .4 * Math.sin(t * 2 + d.h * 9)})`; g.beginPath(); g.arc(x, y - d.s * 1.3, d.s * .22, 0, TAU); g.fill(); return; }
    if (d.kind === 'tree') { g.fillStyle = '#8a5a35'; g.fillRect(x - d.s * .14, y - d.s * .6, d.s * .28, d.s * .75); const sway = Math.sin(t * 1.3 + d.h * 7) * 2; for (const [ox, oy, r, c0, c1] of [[0, -1.0, .78, '#5cb85c', '#2f7d3f'], [-.42, -.7, .55, '#6cc56a', '#348a45'], [.42, -.72, .55, '#6cc56a', '#348a45'], [0, -1.35, .5, '#8fdc72', '#3f9a4d']]) { const cx = x + ox * d.s + sway, cy = y + oy * d.s, gr = g.createRadialGradient(cx - d.s * r * .35, cy - d.s * r * .4, 1, cx, cy, d.s * r); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, d.s * r, 0, TAU); g.fill(); } }
  }
  function drawGround(cam, t) {
    g.save(); g.translate(-cam.x, -cam.y); g.fillStyle = pattern; g.fillRect(cam.x, cam.y, W, H); g.restore();
    // 흙길
    g.save(); g.translate(-cam.x, -cam.y); g.lineCap = g.lineJoin = 'round';
    for (const [w, c] of [[64, '#c9a46c'], [52, '#e2c48f'], [8, 'rgba(255,255,255,.18)']]) { g.strokeStyle = c; g.lineWidth = w; for (const p of paths) { g.beginPath(); p.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); } }
    // 가운데 돌 광장 + 빛나는 마법진
    const C = WORLD / 2;
    g.fillStyle = '#d9d2c3'; g.beginPath(); g.arc(C, C, 230, 0, TAU); g.fill();
    g.strokeStyle = '#b7ad99'; g.lineWidth = 3; for (let r = 70; r < 230; r += 52) { g.beginPath(); g.arc(C, C, r, 0, TAU); g.stroke(); }
    for (let k = 0; k < 16; k++) { const a = k * TAU / 16; g.beginPath(); g.moveTo(C + Math.cos(a) * 70, C + Math.sin(a) * 70); g.lineTo(C + Math.cos(a) * 230, C + Math.sin(a) * 230); g.stroke(); }
    g.strokeStyle = `rgba(123,108,255,${.45 + .25 * Math.sin(t * 2)})`; g.lineWidth = 5; g.beginPath(); g.arc(C, C, 120, 0, TAU); g.stroke();
    g.save(); g.translate(C, C); g.rotate(t * .25); g.lineWidth = 3; g.beginPath(); for (let k = 0; k <= 6; k++) { const a = k * TAU / 6 * 2; g.lineTo(Math.cos(a) * 112, Math.sin(a) * 112); } g.stroke(); g.restore();
    g.restore();
    // 숲 가장자리 (맵 밖)
    g.fillStyle = '#244b33';
    if (cam.x < 0) g.fillRect(0, 0, -cam.x, H);
    if (cam.y < 0) g.fillRect(0, 0, W, -cam.y);
    if (cam.x + W > WORLD) g.fillRect(WORLD - cam.x, 0, cam.x + W - WORLD, H);
    if (cam.y + H > WORLD) g.fillRect(0, WORLD - cam.y, W, cam.y + H - WORLD);
    g.save(); g.translate(-cam.x, -cam.y); g.strokeStyle = 'rgba(20,50,30,.55)'; g.lineWidth = 14; g.strokeRect(-7, -7, WORLD + 14, WORLD + 14);
    g.fillStyle = '#1d3d29'; for (let k = -1; k <= WORLD / 70 + 1; k++) for (const [bx, by] of [[k * 70, -30], [k * 70, WORLD + 30], [-30, k * 70], [WORLD + 30, k * 70]]) { const sx = bx - cam.x, sy = by - cam.y; if (sx < -60 || sy < -60 || sx > W + 60 || sy > H + 60) continue; g.beginPath(); g.arc(bx, by, 40 + ((k * 37) % 13), 0, TAU); g.fill(); }
    g.restore();
  }

  // ---------- 괴물 ----------
  const KIND = {
    slime: { hp: 40, sp: 72, r: 17, dmg: 60, pts: 1, col: ['#8be38f', '#2fa14a'] },
    bat: { hp: 26, sp: 128, r: 13, dmg: 45, pts: 2, col: ['#c7a2ff', '#6d3fd8'] },
    golem: { hp: 230, sp: 50, r: 29, dmg: 140, pts: 6, col: ['#c9b49a', '#7a6248'] },
    boss: { hp: 1600, sp: 58, r: 48, dmg: 260, pts: 40, col: ['#ff8f8f', '#c0263f'] },
  };
  function spawn(kind) {
    const k = KIND[kind], a = Math.random() * TAU, d = Math.hypot(W, H) * .5 + 30;
    let x = st.p.x + Math.cos(a) * d, y = st.p.y + Math.sin(a) * d;
    x = clamp(x, 30, WORLD - 30); y = clamp(y, 30, WORLD - 30);
    const grow = 1 + st.t / 85 + (kind === 'boss' ? st.boss * .5 : 0);
    st.mobs.push({ kind, x, y, r: k.r, hp: k.hp * grow, max: k.hp * grow, sp: k.sp * rnd(.9, 1.1), hit: {}, flash: 0, ph: Math.random() * TAU });
  }
  function drawMob(m, cam, t) {
    const k = KIND[m.kind], x = m.x - cam.x, y = m.y - cam.y;
    if (x < -80 || y < -80 || x > W + 80 || y > H + 80) return;
    g.fillStyle = 'rgba(20,40,30,.25)'; g.beginPath(); g.ellipse(x, y + m.r * .85, m.r * .9, m.r * .32, 0, 0, TAU); g.fill();
    const fl = m.flash > 0;
    if (m.kind === 'bat') {
      const fly = Math.sin(t * 18 + m.ph) * .6, yy = y - 10 + Math.sin(t * 4 + m.ph) * 4;
      g.fillStyle = fl ? '#fff' : k.col[1];
      for (const sgn of [-1, 1]) { g.beginPath(); g.moveTo(x, yy); g.quadraticCurveTo(x + sgn * m.r * 1.6, yy - m.r * (1 + fly), x + sgn * m.r * 2.1, yy + m.r * .2); g.quadraticCurveTo(x + sgn * m.r * 1.2, yy + m.r * .1, x, yy + m.r * .4); g.fill(); }
      const gr = g.createRadialGradient(x - 3, yy - 4, 1, x, yy, m.r); gr.addColorStop(0, fl ? '#fff' : k.col[0]); gr.addColorStop(1, fl ? '#fff' : k.col[1]); g.fillStyle = gr; g.beginPath(); g.arc(x, yy, m.r, 0, TAU); g.fill();
      g.fillStyle = '#ffe14d'; g.beginPath(); g.arc(x - 4, yy - 2, 2.6, 0, TAU); g.arc(x + 4, yy - 2, 2.6, 0, TAU); g.fill();
    } else {
      const sq = m.kind === 'slime' ? 1 + Math.sin(t * 7 + m.ph) * .08 : 1, rx = m.r * sq, ry = m.r / sq;
      const gr = g.createRadialGradient(x - m.r * .35, y - m.r * .45, 1, x, y, m.r * 1.1); gr.addColorStop(0, fl ? '#fff' : k.col[0]); gr.addColorStop(1, fl ? '#fff' : k.col[1]); g.fillStyle = gr;
      g.beginPath();
      if (m.kind === 'golem') { g.moveTo(x - rx, y + ry * .6); g.lineTo(x - rx * .9, y - ry * .5); g.lineTo(x - rx * .3, y - ry); g.lineTo(x + rx * .5, y - ry * .9); g.lineTo(x + rx, y - ry * .2); g.lineTo(x + rx * .85, y + ry * .7); g.closePath(); }
      else if (m.kind === 'slime') { g.ellipse(x, y + m.r * .1, rx, ry * .9, 0, Math.PI, 0); g.quadraticCurveTo(x + rx, y + ry * .8, x, y + ry * .8); g.quadraticCurveTo(x - rx, y + ry * .8, x - rx, y + m.r * .1); }
      else g.arc(x, y, m.r, 0, TAU);
      g.fill();
      if (m.kind === 'boss') { g.fillStyle = '#ffc23d'; g.beginPath(); g.moveTo(x - 22, y - m.r + 4); g.lineTo(x - 26, y - m.r - 22); g.lineTo(x - 10, y - m.r - 8); g.lineTo(x, y - m.r - 28); g.lineTo(x + 10, y - m.r - 8); g.lineTo(x + 26, y - m.r - 22); g.lineTo(x + 22, y - m.r + 4); g.closePath(); g.fill(); g.fillStyle = '#4a0a18'; g.beginPath(); g.moveTo(x - 30, y - 14); g.lineTo(x - 42, y - 34); g.lineTo(x - 24, y - 22); g.moveTo(x + 30, y - 14); g.lineTo(x + 42, y - 34); g.lineTo(x + 24, y - 22); g.fill(); }
      // 눈
      const ey = y - m.r * .15, ex = m.r * .32, er = Math.max(2.4, m.r * .14);
      g.fillStyle = '#fff'; g.beginPath(); g.arc(x - ex, ey, er * 1.35, 0, TAU); g.arc(x + ex, ey, er * 1.35, 0, TAU); g.fill();
      const dx = Math.sign(st.p.x - m.x) * er * .4; g.fillStyle = m.kind === 'boss' ? '#c0263f' : '#1e1c3a'; g.beginPath(); g.arc(x - ex + dx, ey + 1, er * .8, 0, TAU); g.arc(x + ex + dx, ey + 1, er * .8, 0, TAU); g.fill();
      if (m.kind === 'golem') { g.strokeStyle = 'rgba(60,40,20,.45)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 8, y + 8); g.lineTo(x + 4, y + 14); g.stroke(); }
    }
    if (m.hp < m.max) { const w = m.r * 2, f = clamp(m.hp / m.max, 0, 1); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(x - w / 2, y - m.r - 14, w, 5); g.fillStyle = m.kind === 'boss' ? '#ff4d6d' : '#ffd54a'; g.fillRect(x - w / 2, y - m.r - 14, w * f, 5); }
  }

  // ---------- 체력 포션 ----------
  const POT = { 200: ['#ff6b6b', '#c81e3a', 13], 400: ['#ff8fd0', '#d4318f', 15], 500: ['#b39bff', '#6d3fd8', 16], 750: ['#ffe27a', '#e09b00', 19] };
  function rollHeal() { let r = Math.random(); for (const [p, v] of S.MINI_POTIONS) { if (r < p) return v; r -= p; } return 200; }
  function dropPotions() {
    const n = Math.min(3 - st.pots.length, 1 + (Math.random() < .5 ? 1 : 0));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU, d = rnd(260, 820);
      st.pots.push({ x: clamp(st.p.x + Math.cos(a) * d, 60, WORLD - 60), y: clamp(st.p.y + Math.sin(a) * d, 60, WORLD - 60), v: rollHeal(), born: st.t });
    }
    if (n > 0) float(st.p.x, st.p.y - 90, `포션 ${n}개가 나타났어요!`, '#ffffff', 16, 1.6);
  }
  function drawPotion(p, cam, t) {
    const [c0, c1, s] = POT[p.v], x = p.x - cam.x, y = p.y - cam.y + Math.sin(t * 3 + p.x) * 4, pop = Math.min(1, (st.t - p.born) / .4);
    if (x < -60 || y < -60 || x > W + 60 || y > H + 60) return;
    g.save(); g.translate(x, y); g.scale(pop, pop);
    const glow = g.createRadialGradient(0, 0, 2, 0, 0, s * 2.6); glow.addColorStop(0, c0 + 'aa'); glow.addColorStop(1, c0 + '00'); g.fillStyle = glow; g.beginPath(); g.arc(0, 0, s * 2.6, 0, TAU); g.fill();
    g.fillStyle = 'rgba(20,40,30,.25)'; g.beginPath(); g.ellipse(0, s * 1.15, s * .8, s * .25, 0, 0, TAU); g.fill();
    g.fillStyle = '#e8f4ff'; g.beginPath(); g.arc(0, s * .25, s * .85, 0, TAU); g.fill();
    g.fillRect(-s * .32, -s * .9, s * .64, s * .8);
    const gr = g.createLinearGradient(0, -s * .2, 0, s); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.beginPath(); g.arc(0, s * .3, s * .7, 0, TAU); g.fill();
    g.fillStyle = '#9b6b3a'; g.fillRect(-s * .38, -s * 1.15, s * .76, s * .32);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.beginPath(); g.ellipse(-s * .28, s * .05, s * .14, s * .3, -.4, 0, TAU); g.fill();
    if (p.v === 750) for (let k = 0; k < 4; k++) { const a = t * 2 + k * TAU / 4; g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(Math.cos(a) * s * 1.6, Math.sin(a) * s * 1.6, 2.2, 0, TAU); g.fill(); }
    g.font = '900 12px Pretendard, sans-serif'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = 'rgba(30,20,60,.8)'; g.strokeText('+' + p.v, 0, -s * 1.45); g.fillStyle = '#fff'; g.fillText('+' + p.v, 0, -s * 1.45);
    g.restore();
  }

  // ---------- 효과: 숫자 · 반짝이 ----------
  function float(x, y, txt, col, size = 14, life = .9) { st.texts.push({ x, y, txt, col, size, t: 0, life }); }
  function burst(x, y, col, n = 10, sp = 160) { if (st.sparks.length > 400) return; for (let k = 0; k < n; k++) { const a = Math.random() * TAU, v = rnd(.3, 1) * sp; st.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: rnd(.35, .7), col, r: rnd(2, 4.5) }); } }

  // ---------- 나 · 검 ----------
  function stats() {
    const up = data.up, U = S.MINI_UP, v = k => (up[k] ? U[k].vals[up[k] - 1] : 0);
    return { size: 1 + v('size'), spin: 1 + v('spin'), hpMax: S.MINI_HP + v('hp'), slow: v('slow') };
  }
  function swordCount() { return 3 + (st.t > 45 ? 1 : 0) + (st.t > 110 ? 1 : 0); }
  function drawSword(cx, cy, ang, len, wid) {
    g.save(); g.translate(cx, cy); g.rotate(ang);
    const r0 = st.orbit - len / 2;
    g.translate(r0, 0);
    g.fillStyle = 'rgba(20,30,60,.18)'; g.beginPath(); g.ellipse(len / 2, wid * 1.6, len / 2, wid * .5, 0, 0, TAU); g.fill();
    // 손잡이 · 날밑
    g.fillStyle = '#7b4a24'; g.fillRect(-wid * 1.1, -wid * .28, wid * 1.2, wid * .56);
    g.fillStyle = '#ffc23d'; g.fillRect(0, -wid * .95, wid * .45, wid * 1.9);
    g.fillStyle = '#ff5e8a'; g.beginPath(); g.arc(-wid * 1.15, 0, wid * .3, 0, TAU); g.fill();
    // 칼날
    const gr = g.createLinearGradient(0, -wid / 2, 0, wid / 2); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.5, '#cfd8ff'); gr.addColorStop(1, '#7f8bd6');
    g.fillStyle = gr; g.beginPath(); g.moveTo(wid * .45, -wid * .5); g.lineTo(len - wid * 1.2, -wid * .5); g.lineTo(len, 0); g.lineTo(len - wid * 1.2, wid * .5); g.lineTo(wid * .45, wid * .5); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(wid * .6, -wid * .15); g.lineTo(len - wid * 1.3, -wid * .15); g.stroke();
    g.restore();
  }
  function drawPlayer(cam, t) {
    const p = st.p, x = p.x - cam.x, y = p.y - cam.y;
    // 그림자 · 몸
    g.fillStyle = 'rgba(20,40,30,.28)'; g.beginPath(); g.ellipse(x, y + 20, 18, 6, 0, 0, TAU); g.fill();
    const bob = Math.sin(t * (p.moving ? 14 : 3)) * (p.moving ? 2.2 : 1), hurt = st.hurt > 0;
    const gr = g.createRadialGradient(x - 6, y - 10 + bob, 2, x, y + bob, 21); gr.addColorStop(0, hurt ? '#ffd0d6' : '#b6abff'); gr.addColorStop(1, hurt ? '#ff5e7a' : '#5544e8');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y + bob, 18, 20, 0, 0, TAU); g.fill();
    g.fillStyle = '#ffc23d'; g.beginPath(); g.moveTo(x - 10, y - 15 + bob); g.lineTo(x - 12, y - 27 + bob); g.lineTo(x - 5, y - 21 + bob); g.lineTo(x, y - 30 + bob); g.lineTo(x + 5, y - 21 + bob); g.lineTo(x + 12, y - 27 + bob); g.lineTo(x + 10, y - 15 + bob); g.closePath(); g.fill();
    const lx = clamp(p.fx, -1, 1) * 3, ly = clamp(p.fy, -1, 1) * 2;
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x - 6 + lx, y - 3 + bob + ly, 4.6, 5.4, 0, 0, TAU); g.ellipse(x + 6 + lx, y - 3 + bob + ly, 4.6, 5.4, 0, 0, TAU); g.fill();
    g.fillStyle = '#1e1c3a'; g.beginPath(); g.arc(x - 6 + lx * 1.5, y - 2 + bob + ly, 2.4, 0, TAU); g.arc(x + 6 + lx * 1.5, y - 2 + bob + ly, 2.4, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,143,181,.6)'; g.beginPath(); g.ellipse(x - 11, y + 5 + bob, 3.4, 2, 0, 0, TAU); g.ellipse(x + 11, y + 5 + bob, 3.4, 2, 0, 0, TAU); g.fill();
  }
  function drawBlades(cam) { // 검은 나무 · 괴물보다 위에
    const x = st.p.x - cam.x, y = st.p.y - cam.y, sv = stats();
    // 검 자국
    const n = swordCount(), len = 46 * sv.size, wid = 10 * Math.sqrt(sv.size);
    if (!reduce) { g.lineWidth = wid * 1.1; g.lineCap = 'round'; for (let k = 0; k < n; k++) { const a = st.ang + k * TAU / n; for (let j = 0; j < 6; j++) { g.strokeStyle = `rgba(225,232,255,${.3 * (1 - j / 6)})`; g.beginPath(); g.arc(x, y, st.orbit + len * .3, a - (j + 1) * .085, a - j * .085); g.stroke(); } } g.lineCap = 'butt'; }
    for (let k = 0; k < n; k++) drawSword(x, y, st.ang + k * TAU / n, len, wid);
  }
  function drawHead(cam) { // 머리 위: 닉네임 · 체력 막대 · 체력 숫자
    const p = st.p, x = p.x - cam.x, y = p.y - cam.y - 46, bw = 92, f = clamp(st.hp / st.hpMax, 0, 1);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 14px Pretendard, "Apple SD Gothic Neo", sans-serif'; g.lineWidth = 4; g.strokeStyle = 'rgba(25,20,60,.85)'; g.strokeText(st.nick, x, y - 22); g.fillStyle = '#fff'; g.fillText(st.nick, x, y - 22);
    g.fillStyle = 'rgba(25,20,60,.8)'; g.beginPath(); g.roundRect(x - bw / 2 - 3, y - 9, bw + 6, 18, 9); g.fill();
    const col = f > .5 ? ['#7ef0a0', '#22c55e'] : f > .25 ? ['#ffe27a', '#f59e0b'] : ['#ff9aa8', '#e11d48'], gr = g.createLinearGradient(0, y - 6, 0, y + 6); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.roundRect(x - bw / 2, y - 6, bw, 12, 6); g.fill();
    if (f > 0) { g.fillStyle = gr; g.beginPath(); g.roundRect(x - bw / 2, y - 6, Math.max(12, bw * f), 12, 6); g.fill(); }
    g.font = '900 11px Pretendard, sans-serif'; g.lineWidth = 3; g.strokeStyle = 'rgba(25,20,60,.9)'; const txt = `${Math.ceil(st.hp)} / ${st.hpMax}`; g.strokeText(txt, x, y + .5); g.fillStyle = '#fff'; g.fillText(txt, x, y + .5);
  }

  // ---------- 한 판 ----------
  function newRun() {
    const sv = stats();
    st = { t: 0, p: { x: WORLD / 2, y: WORLD / 2, fx: 0, fy: 1, moving: false }, hpMax: sv.hpMax, hp: sv.hpMax, ang: 0, orbit: 74 * sv.size, mobs: [], pots: [], texts: [], sparks: [],
      kills: 0, pts: 0, spawnT: 1.2, potT: 0, boss: 0, bossT: 60, hurt: 0, dead: 0, nick: O.nick || '나' };
  }
  function update(dt) {
    if (!st.started) { st.started = 1; for (let k = 0; k < 7; k++) spawn('slime'); }
    const sv = stats(), p = st.p;
    st.t += dt; st.hurt = Math.max(0, st.hurt - dt);
    // 움직이기 (키보드 · 손가락)
    let mx = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0), my = (keys.ArrowDown || keys.s ? 1 : 0) - (keys.ArrowUp || keys.w ? 1 : 0);
    if (joy.on) { const dx = joy.x - joy.bx, dy = joy.y - joy.by, d = Math.hypot(dx, dy); if (d > 6) { mx = dx / Math.max(d, 55); my = dy / Math.max(d, 55); } }
    const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    p.moving = ml > .05; if (p.moving) { p.fx = mx; p.fy = my; }
    p.x = clamp(p.x + mx * 215 * dt, 24, WORLD - 24); p.y = clamp(p.y + my * 215 * dt, 24, WORLD - 24);
    // 검 회전
    st.ang += 3.0 * sv.spin * dt; st.orbit = 74 * sv.size;
    // 괴물 나오기
    st.spawnT -= dt;
    if (st.spawnT <= 0 && st.mobs.length < 170) {
      st.spawnT = Math.max(.16, 1.05 - st.t * .011);
      const n = 1 + Math.floor(st.t / 45);
      for (let k = 0; k < n; k++) spawn(st.t > 25 && Math.random() < .3 ? 'bat' : st.t > 35 && Math.random() < .12 ? 'golem' : Math.random() < .25 ? 'bat' : 'slime');
    }
    if (st.t >= st.bossT) { st.bossT += 60; spawn('boss'); st.boss++; float(p.x, p.y - 110, '보스가 나타났다!', '#ff5e7a', 22, 2); }
    // 포션: 20초마다 1~2개 (맵에 최대 3개)
    st.potT += dt; if (st.potT >= 20) { st.potT -= 20; dropPotions(); }
    for (let i = st.pots.length - 1; i >= 0; i--) { const q = st.pots[i]; if (Math.hypot(q.x - p.x, q.y - p.y) < 34) { const heal = Math.min(q.v, st.hpMax - st.hp); st.hp = Math.min(st.hpMax, st.hp + q.v); float(p.x, p.y - 70, `+${q.v} 체력`, '#7ef0a0', 20, 1.3); burst(q.x, q.y, POT[q.v][0], 18, 220); st.pots.splice(i, 1); if (O.sfx) O.sfx('unlock'); void heal; } }
    // 괴물 움직임 · 칼 맞기 · 나를 때리기
    const n = swordCount(), len = 46 * sv.size, wid = 10 * Math.sqrt(sv.size), r0 = st.orbit - len / 2, r1 = st.orbit + len / 2;
    for (let i = st.mobs.length - 1; i >= 0; i--) {
      const m = st.mobs[i], k = KIND[m.kind], dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy) || 1;
      m.flash = Math.max(0, m.flash - dt);
      const sp = m.sp * (1 - sv.slow) * (m.kind === 'bat' ? 1 + Math.sin(st.t * 3 + m.ph) * .25 : 1);
      if (d > 14 + m.r) { m.x += (dx / d) * sp * dt; m.y += (dy / d) * sp * dt; }
      if (d < 22 + m.r) { st.hp -= k.dmg * dt; st.hurt = .15; }
      // 칼에 맞았나? (칼은 가운데에서 바깥으로 뻗은 막대)
      for (let s = 0; s < n; s++) {
        const a = st.ang + s * TAU / n, ux = Math.cos(a), uy = Math.sin(a), rx = m.x - p.x, ry = m.y - p.y, along = rx * ux + ry * uy;
        if (along < r0 - m.r || along > r1 + m.r) continue;
        const perp = Math.abs(rx * -uy + ry * ux);
        if (perp > m.r + wid * .7) continue;
        if ((m.hit[s] || 0) > st.t) continue;
        m.hit[s] = st.t + .28;
        const dmg = Math.round(34 * (1 + st.t / 240) * rnd(.9, 1.1));
        m.hp -= dmg; m.flash = .08;
        m.x += ux * 10 + (rx / (Math.hypot(rx, ry) || 1)) * 8; m.y += uy * 10 + (ry / (Math.hypot(rx, ry) || 1)) * 8;
        if (st.texts.length < 60) float(m.x, m.y - m.r, String(dmg), '#ffffff', 13, .55);
        burst(p.x + ux * along, p.y + uy * along, '#e6ecff', 4, 120);
      }
      if (m.hp <= 0) { st.kills++; st.pts += k.pts; burst(m.x, m.y, k.col[0], m.kind === 'boss' ? 40 : 12, m.kind === 'boss' ? 320 : 180); float(m.x, m.y - m.r - 8, `+${k.pts}`, '#ffd54a', m.kind === 'boss' ? 24 : 15, .9); st.mobs.splice(i, 1); }
    }
    // 괴물끼리 살짝 밀어내기
    const ms = st.mobs;
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) { const a = ms[i], b = ms[j], dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r; if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue; const d = Math.hypot(dx, dy) || 1; if (d < rr) { const push = (rr - d) / 2, ux = dx / d, uy = dy / d; a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; } }
    // 효과
    for (const s of st.sparks) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; s.vx *= .92; s.vy *= .92; }
    st.sparks = st.sparks.filter(s => s.t < s.life);
    for (const x of st.texts) { x.t += dt; x.y -= 34 * dt; }
    st.texts = st.texts.filter(x => x.t < x.life);
    if (st.hp <= 0) { st.hp = 0; die(); }
  }
  function render(t) {
    const p = st ? st.p : { x: WORLD / 2, y: WORLD / 2 };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cam = { x: p.x - W / 2, y: p.y - H / 2 };
    drawGround(cam, t);
    for (const d of decor) if (d.kind === 'flower' || d.kind === 'shroom') drawDecor(d, cam, t);
    for (const d of decor) if (d.kind !== 'flower' && d.kind !== 'shroom' && d.y < p.y) drawDecor(d, cam, t);
    if (st) {
      for (const q of st.pots) drawPotion(q, cam, t);
      for (const m of st.mobs) if (m.y <= p.y) drawMob(m, cam, t);
      if (!st.dead || st.t - st.dead < .1) drawPlayer(cam, t);
      for (const m of st.mobs) if (m.y > p.y) drawMob(m, cam, t);
    }
    for (const d of decor) if (d.kind !== 'flower' && d.kind !== 'shroom' && d.y >= p.y) drawDecor(d, cam, t);
    if (st && !st.dead) drawBlades(cam);
    // 반딧불
    for (const f of flies) { const x = f.x - cam.x + Math.sin(t * .7 + f.p) * 30, y = f.y - cam.y + Math.cos(t * .5 + f.p) * 20; if (x < 0 || y < 0 || x > W || y > H) continue; g.fillStyle = `rgba(255,250,190,${.35 + .35 * Math.sin(t * 3 + f.p)})`; g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill(); }
    if (st) {
      for (const s of st.sparks) { g.globalAlpha = 1 - s.t / s.life; g.fillStyle = s.col; g.beginPath(); g.arc(s.x - cam.x, s.y - cam.y, s.r, 0, TAU); g.fill(); }
      g.globalAlpha = 1; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const x of st.texts) { g.globalAlpha = 1 - Math.max(0, x.t / x.life - .6) / .4; g.font = `900 ${x.size}px Pretendard, sans-serif`; g.lineWidth = 3.5; g.strokeStyle = 'rgba(25,20,60,.85)'; g.strokeText(x.txt, x.x - cam.x, x.y - cam.y); g.fillStyle = x.col; g.fillText(x.txt, x.x - cam.x, x.y - cam.y); }
      g.globalAlpha = 1;
      if (!st.dead) drawHead(cam);
      // 화면 밖 포션은 가장자리 화살표로
      for (const q of st.pots) { const x = q.x - cam.x, y = q.y - cam.y; if (x > 0 && y > 0 && x < W && y < H) continue; const a = Math.atan2(y - H / 2, x - W / 2), ex = clamp(W / 2 + Math.cos(a) * W, 26, W - 26), ey = clamp(H / 2 + Math.sin(a) * H, 90, H - 120); g.save(); g.translate(ex, ey); g.rotate(a); g.fillStyle = POT[q.v][0]; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -10); g.lineTo(-8, 10); g.closePath(); g.fill(); g.stroke(); g.restore(); }
      // 맞을 때 빨간 테두리
      if (st.hurt > 0) { const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.max(W, H) * .75); gr.addColorStop(0, 'rgba(255,40,70,0)'); gr.addColorStop(1, 'rgba(255,40,70,.35)'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
    }
    // 가장자리 어둡게
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .45, W / 2, H / 2, Math.max(W, H) * .78); vg.addColorStop(0, 'rgba(10,20,40,0)'); vg.addColorStop(1, 'rgba(10,20,40,.35)'); g.fillStyle = vg; g.fillRect(0, 0, W, H);
    // 손가락 조이스틱
    if (joy.on && state === 'play') { g.fillStyle = 'rgba(255,255,255,.18)'; g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 2; g.beginPath(); g.arc(joy.bx, joy.by, 55, 0, TAU); g.fill(); g.stroke(); const dx = joy.x - joy.bx, dy = joy.y - joy.by, d = Math.hypot(dx, dy), k = d > 55 ? 55 / d : 1; g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.arc(joy.bx + dx * k, joy.by + dy * k, 24, 0, TAU); g.fill(); }
  }
  function hud() {
    if (!st) return;
    const s = Math.floor(st.t);
    $('#mgTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    $('#mgKills').textContent = st.kills;
    $('#mgPts').textContent = st.pts;
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
    if (state === 'play') update(dt);
    else if (state === 'dying') { st.t += dt; for (const s of st.sparks) { s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt; } if (st.t - st.dead > 1.1) showOver(); }
    render(now / 1000);
    if (state === 'play') hud();
  }
  function die() {
    state = 'dying'; st.dead = st.t; burst(st.p.x, st.p.y, '#a397ff', 40, 300); burst(st.p.x, st.p.y, '#ffc23d', 20, 240);
  }
  let ending = false;
  async function finish() { // 얻은 포인트를 통장에
    if (!st || ending) return null; ending = true;
    const r = await O.api('/api/mini/end', { sec: Math.floor(st.t), kills: st.kills, pts: st.pts });
    ending = false;
    if (r && !r.error) data = r;
    return r;
  }
  async function showOver() {
    state = 'over';
    const r = await finish();
    const s = Math.floor(st.t);
    $('#mgOverStats').innerHTML = `<div><b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b><span>버틴 시간</span></div><div><b>${st.kills}</b><span>처치</span></div><div><b>+${r && r.got != null ? r.got : st.pts}</b><span>포인트</span></div>`;
    $('#mgRecord').hidden = !(r && r.record);
    $('#mgBank').textContent = data ? data.pts : 0;
    show('over');
  }

  // ---------- 화면 (로비 · 일시정지 · 끝) ----------
  function show(which) {
    for (const id of ['lobby', 'pause', 'over']) $('#mg' + id[0].toUpperCase() + id.slice(1)).hidden = id !== which;
    $('#mgHud').hidden = !(which === null || which === 'pause');
  }
  function renderLobby() {
    const U = S.MINI_UP;
    $('#mgBankL').textContent = data.pts;
    $('#mgBest').textContent = data.best && data.best.sec ? `최고 기록 ${Math.floor(data.best.sec / 60)}:${String(data.best.sec % 60).padStart(2, '0')} · ${data.best.kills}마리` : '아직 기록이 없어요';
    $('#mgUps').innerHTML = Object.keys(U).map(k => {
      const star = data.up[k] || 0, cur = star ? U[k].fmt(U[k].vals[star - 1]) : '기본', next = star < 3 ? U[k].fmt(U[k].vals[star]) : null, cost = star < 3 ? S.MINI_COST[star] : 0;
      return `<div class="mg-up"><div class="mg-up-ic mg-${k}"></div><div class="mg-up-txt"><b>${U[k].name}</b><span class="mg-stars">${[0, 1, 2].map(i => `<i class="${i < star ? 'on' : ''}"></i>`).join('')}</span><small>지금 ${cur}${next ? ` → 별${star + 1} ${next}` : ' · 최고!'}</small></div>${next ? `<button type="button" class="mg-buy" data-k="${k}" ${data.pts < cost ? 'disabled' : ''}>${cost}P</button>` : '<span class="mg-max">MAX</span>'}</div>`;
    }).join('');
  }
  async function buy(k) {
    const r = await O.api('/api/mini/buy', { key: k });
    if (r.error) return O.toast(r.error, 'err');
    data = r; renderLobby(); O.toast(`⭐ ${S.MINI_UP[k].name} 별 ${r.up[k]}개!`, 'ok');
  }
  function start() { newRun(); state = 'play'; show(null); last = performance.now(); }
  function pause() { if (state !== 'play') return; state = 'pause'; show('pause'); }
  function resume() { if (state !== 'pause') return; state = 'play'; show(null); last = performance.now(); }
  async function quitRun() { // 그만하기: 지금까지 얻은 포인트는 받는다
    state = 'over'; await finish(); st = null; renderLobby(); show('lobby'); state = 'lobby';
  }
  function close() {
    if (st && (state === 'play' || state === 'pause')) finish();
    state = 'lobby'; st = null; cancelAnimationFrame(raf); raf = 0;
    $('#miniGame').hidden = true; removeEventListener('resize', fit); document.removeEventListener('visibilitychange', onVis);
    if (O && O.onClose) O.onClose();
  }
  const onVis = () => { if (document.hidden) pause(); };
  function fit() { const r = cv.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    cv = $('#mgCv'); g = cv.getContext('2d');
    addEventListener('keydown', e => { if ($('#miniGame').hidden) return; const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys[k] = true; if (k === 'Escape' || k === 'p') { state === 'play' ? pause() : resume(); } if (/^Arrow/.test(k)) e.preventDefault(); });
    addEventListener('keyup', e => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys[k] = false; });
    cv.addEventListener('pointerdown', e => { if (state !== 'play') return; joy.on = true; joy.id = e.pointerId; joy.bx = joy.x = e.clientX - cv.getBoundingClientRect().left; joy.by = joy.y = e.clientY - cv.getBoundingClientRect().top; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!joy.on || e.pointerId !== joy.id) return; const r = cv.getBoundingClientRect(); joy.x = e.clientX - r.left; joy.y = e.clientY - r.top; });
    const up = e => { if (e.pointerId === joy.id) joy.on = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    $('#mgStart').onclick = start; $('#mgAgain').onclick = start;
    $('#mgUps').onclick = e => { const b = e.target.closest('.mg-buy'); if (b && !b.disabled) buy(b.dataset.k); };
    $('#mgPauseBtn').onclick = pause; $('#mgResume').onclick = resume; $('#mgQuit').onclick = quitRun;
    $('#mgToLobby').onclick = () => { st = null; state = 'lobby'; renderLobby(); show('lobby'); };
    $$('.mg-x').forEach(b => { b.onclick = close; });
  }
  const $$ = s => document.querySelectorAll(s);
  async function open(opts) {
    O = opts; S = opts.S; wire();
    $('#miniGame').hidden = false; fit(); makeWorld();
    addEventListener('resize', fit); document.addEventListener('visibilitychange', onVis);
    const r = await O.api('/api/mini');
    if (r.error) { O.toast(r.error, 'err'); return close(); }
    data = r; st = null; state = 'lobby'; renderLobby(); show('lobby');
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  }
  window.MLEMini = { open, close, _state: () => ({ state, st, data }) };
})();
