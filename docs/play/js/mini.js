/* 매뜨 땅먹 — 미니게임 '검의 회오리' (밤의 숲 판타지 스타일)
 * 내 둘레를 도는 검으로 괴물을 물리치면 포인트 보석이 떨어진다. 보석을 모아 포인트 게이지가 차면 레벨 업(최대 50) → 무작위 업그레이드 3장 중 하나를 고른다.
 * 카드 색: 별 1 흰색 · 별 2 파랑 · 별 3 빨강. 업그레이드: 검 크기 · 검 회전 속도 · 검 추가 · 체력 · 괴물 접근 (한 판 안에서 쌓인다).
 * 맵에는 체력 포션이 최대 3개 (20초마다 1~2개). 머리 위에 닉네임 · 체력 막대 · 체력 숫자.
 * app.js 가 쓰는 것: MLEMini.open({ api, toast, nick, S }) */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
  const WORLD = 3600, C = WORLD / 2, TAU = Math.PI * 2;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a), clamp = (x, a, b) => Math.max(a, Math.min(b, x)), pick = a => a[Math.floor(Math.random() * a.length)];
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const hexA = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
  let O = null, S = null, cv, g, lc, lg, vig = null, W = 0, H = 0, dpr = 1, raf = 0, last = 0, now = 0;
  let data = null, state = 'lobby', st = null;
  const keys = {}, joy = { on: false, id: -1, bx: 0, by: 0, x: 0, y: 0 };

  // ---------- 소리 (앱의 효과음 켜기/끄기를 따른다) ----------
  let ac = null, sndHit = 0, sndGem = 0, sndHurt = 0;
  const soundOn = () => { try { return localStorage.getItem('mle_sound') !== 'off'; } catch (e) { return true; } };
  function tone(f, d, type = 'sine', vol = .06, slide = 1, delay = 0) {
    if (!soundOn()) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume();
      const t0 = ac.currentTime + delay, o = ac.createOscillator(), v = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t0); if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t0 + d);
      v.gain.setValueAtTime(vol, t0); v.gain.exponentialRampToValueAtTime(.0001, t0 + d);
      o.connect(v).connect(ac.destination); o.start(t0); o.stop(t0 + d + .02);
    } catch (e) { /* 소리를 낼 수 없는 환경 */ }
  }
  const SND = {
    hit() { if (now - sndHit < 70) return; sndHit = now; tone(rnd(560, 700), .06, 'triangle', .03, .45); },
    kill() { tone(rnd(200, 260), .12, 'square', .022, .4); },
    gem() { if (now - sndGem < 50) return; sndGem = now; tone(rnd(900, 1250), .07, 'sine', .035, 1.5); },
    lvup() { [523, 659, 784, 1047, 1319].forEach((f, k) => tone(f, .25, 'triangle', .05, 1, k * .07)); },
    pick(r) { [784, 988, 1319].slice(0, r).forEach((f, k) => tone(f, .3, 'sine', .06, 1.2, k * .06)); },
    hurt() { if (now - sndHurt < 260) return; sndHurt = now; tone(150, .18, 'sawtooth', .035, .5); },
    potion() { [660, 880, 1175].forEach((f, k) => tone(f, .2, 'sine', .055, 1, k * .06)); },
    boss() { tone(65, 1.1, 'sawtooth', .07, .6); tone(98, 1.1, 'square', .025, .6); },
    die() { tone(320, .9, 'sawtooth', .05, .15); },
  };

  // ---------- 미리 그려 두는 그림 (매 프레임 그레이디언트를 새로 만들지 않게) ----------
  const LIGHT = (() => { const c = mkCanvas(256, 256), x = c.getContext('2d'), gr = x.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.4, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); return c; })();
  const glowCache = {};
  function glow(col) { // 색깔 빛 동그라미
    let c = glowCache[col]; if (c) return c;
    c = glowCache[col] = mkCanvas(128, 128); const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, hexA(col, .95)); gr.addColorStop(.28, hexA(col, .45)); gr.addColorStop(1, hexA(col, 0)); x.fillStyle = gr; x.fillRect(0, 0, 128, 128); return c;
  }
  const drawGlow = (col, x, y, r, a = 1) => { if (a <= 0) return; g.globalAlpha = Math.min(1, a); g.drawImage(glow(col), x - r, y - r, r * 2, r * 2); g.globalAlpha = 1; };
  function sprite(w, h, fn) { // 2배로 그려 둔 그림 (선명하게), ax/ay = 발 자리
    const c = mkCanvas(w * 2, h * 2), x = c.getContext('2d'); x.scale(2, 2); x.lineCap = x.lineJoin = 'round'; fn(x, w, h); return { c, w, h };
  }
  const blit = (sp, x, y, sc = 1, ax = .5, ay = .9) => g.drawImage(sp.c, x - sp.w * sc * ax, y - sp.h * sc * ay, sp.w * sc, sp.h * sc);

  // 검: 날 빛깔은 레벨이 오를수록 바뀐다 (하늘 → 보라 → 진홍 → 황금)
  const TIERS = [['#5ce1ff', '#e9fbff'], ['#a585ff', '#f1eaff'], ['#ff4d7a', '#ffe3ea'], ['#ffc83d', '#fff6d6']];
  const tierOf = lv => (lv >= 35 ? 3 : lv >= 20 ? 2 : lv >= 10 ? 1 : 0);
  const swordCache = {};
  function swordSprite(len, tier) { // 오른쪽을 보는 검. ox = 날밑 자리
    const L = Math.round(len / 2) * 2, key = L + '|' + tier; if (swordCache[key]) return swordCache[key];
    const wd = clamp(L * .19, 8, 26), pad = 16, grip = wd * 1.5, cw = L + grip + pad * 2, ch = wd * 2.8 + pad * 2, cy = ch / 2, bx = pad + grip, [gc, lt] = TIERS[tier];
    const sp = sprite(cw, ch, x => {
      const blade = () => { x.beginPath(); x.moveTo(bx, cy - wd * .42); x.lineTo(bx + L * .76, cy - wd * .36); x.quadraticCurveTo(bx + L * .93, cy - wd * .25, bx + L, cy); x.quadraticCurveTo(bx + L * .93, cy + wd * .25, bx + L * .76, cy + wd * .36); x.lineTo(bx, cy + wd * .42); x.closePath(); };
      x.save(); x.shadowColor = gc; x.shadowBlur = 14; x.fillStyle = hexA(gc, .9); blade(); x.fill(); x.fill(); x.restore(); // 둘레 빛
      let gr = x.createLinearGradient(0, cy - wd * .45, 0, cy + wd * .45); gr.addColorStop(0, '#ffffff'); gr.addColorStop(.42, '#e4ecff'); gr.addColorStop(.58, '#a3b3dc'); gr.addColorStop(1, '#56648f');
      x.fillStyle = gr; blade(); x.fill();
      x.strokeStyle = 'rgba(60,72,120,.5)'; x.lineWidth = wd * .18; x.beginPath(); x.moveTo(bx + wd * .5, cy); x.lineTo(bx + L * .7, cy); x.stroke(); // 홈
      x.strokeStyle = gc; x.lineWidth = wd * .08; x.beginPath(); x.moveTo(bx + wd * .5, cy); x.lineTo(bx + L * .7, cy); x.stroke();
      x.fillStyle = lt; for (let k = 0; k < 4; k++) { const rx = bx + L * (.14 + k * .14); x.beginPath(); x.moveTo(rx, cy - wd * .13); x.lineTo(rx + wd * .13, cy); x.lineTo(rx, cy + wd * .13); x.lineTo(rx - wd * .13, cy); x.closePath(); x.fill(); } // 룬
      x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(bx + 2, cy - wd * .37); x.lineTo(bx + L * .76, cy - wd * .31); x.quadraticCurveTo(bx + L * .92, cy - wd * .21, bx + L - 2, cy - .8); x.stroke();
      gr = x.createLinearGradient(0, cy - wd * 1.3, 0, cy + wd * 1.3); gr.addColorStop(0, '#fff3b8'); gr.addColorStop(.5, '#f2b52c'); gr.addColorStop(1, '#9a5a08');
      x.fillStyle = gr; x.beginPath(); x.moveTo(bx - wd * .25, cy - wd * .3); x.quadraticCurveTo(bx - wd * .2, cy - wd * 1.05, bx + wd * .6, cy - wd * 1.3); x.quadraticCurveTo(bx + wd * .2, cy - wd * .75, bx + wd * .3, cy - wd * .3);
      x.lineTo(bx + wd * .3, cy + wd * .3); x.quadraticCurveTo(bx + wd * .2, cy + wd * .75, bx + wd * .6, cy + wd * 1.3); x.quadraticCurveTo(bx - wd * .2, cy + wd * 1.05, bx - wd * .25, cy + wd * .3); x.closePath(); x.fill(); // 날밑
      x.fillStyle = gc; x.beginPath(); x.arc(bx, cy, wd * .27, 0, TAU); x.fill(); x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(bx - wd * .07, cy - wd * .09, wd * .09, 0, TAU); x.fill();
      gr = x.createLinearGradient(0, cy - wd * .25, 0, cy + wd * .25); gr.addColorStop(0, '#7a4524'); gr.addColorStop(1, '#2b1409'); x.fillStyle = gr; x.fillRect(pad + wd * .4, cy - wd * .22, grip - wd * .6, wd * .44); // 손잡이
      x.strokeStyle = 'rgba(255,215,160,.4)'; x.lineWidth = 1; for (let k = pad + wd * .5; k < bx - wd * .35; k += wd * .3) { x.beginPath(); x.moveTo(k, cy - wd * .22); x.lineTo(k + wd * .2, cy + wd * .22); x.stroke(); }
      x.fillStyle = '#f2b52c'; x.beginPath(); x.arc(pad + wd * .32, cy, wd * .32, 0, TAU); x.fill(); x.fillStyle = gc; x.beginPath(); x.arc(pad + wd * .32, cy, wd * .16, 0, TAU); x.fill();
    });
    return (swordCache[key] = Object.assign(sp, { ox: bx, oy: cy, L }));
  }

  // ---------- 밤의 숲 맵 ----------
  let groundPat = null, flat = [], tall = [], paths = [], flies = [], fogs = [], SPR = null;
  function makeSprites() {
    const tree = v => sprite(130, 170, (x, w) => { // 굵은 나무
      const cx = w / 2, by = 160;
      let gr = x.createLinearGradient(cx - 10, 0, cx + 10, 0); gr.addColorStop(0, '#4a3324'); gr.addColorStop(1, '#1f140c');
      x.fillStyle = gr; x.beginPath(); x.moveTo(cx - 16, by); x.quadraticCurveTo(cx - 8, by - 10, cx - 8, by - 60); x.lineTo(cx + 8, by - 60); x.quadraticCurveTo(cx + 8, by - 10, cx + 18, by); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.3)'; x.lineWidth = 1.5; for (const o of [-3, 3]) { x.beginPath(); x.moveTo(cx + o, by - 6); x.lineTo(cx + o * 1.4, by - 50); x.stroke(); }
      const blobs = [[0, -92, 44, '#163a26'], [-30, -76, 30, '#163a26'], [30, -78, 30, '#173d28'], [-16, -104, 32, '#1f4d31'], [18, -102, 32, '#1f4d31'], [0, -122, 30, '#28603c'], [-8, -132, 18, '#337a4b']];
      for (const [ox, oy, r, c] of blobs) { gr = x.createRadialGradient(cx + ox - r * .4, by + oy - r * .5, r * .1, cx + ox, by + oy, r); gr.addColorStop(0, c === '#163a26' ? '#21512f' : '#3b8a55'); gr.addColorStop(1, c); x.fillStyle = gr; x.beginPath(); x.arc(cx + ox + (v - 1) * 3, by + oy, r, 0, TAU); x.fill(); }
      x.fillStyle = 'rgba(150,230,170,.12)'; for (let k = 0; k < 40; k++) { const a = Math.random() * TAU, d = Math.random() * 46; x.beginPath(); x.arc(cx + Math.cos(a) * d - 6, by - 108 + Math.sin(a) * d * .7, rnd(1.5, 3), 0, TAU); x.fill(); }
      x.strokeStyle = 'rgba(170,220,255,.22)'; x.lineWidth = 3; x.beginPath(); x.arc(cx - 6, by - 112, 42, Math.PI * 1.05, Math.PI * 1.45); x.stroke(); // 달빛 테두리
    });
    const pine = () => sprite(100, 180, (x, w) => {
      const cx = w / 2, by = 170;
      x.fillStyle = '#2a1b10'; x.fillRect(cx - 5, by - 30, 10, 30);
      for (let k = 0; k < 4; k++) { const y0 = by - 22 - k * 30, hw = 40 - k * 8, gr = x.createLinearGradient(cx - hw, 0, cx + hw, 0); gr.addColorStop(0, '#2c6a55'); gr.addColorStop(.5, '#1b4a3c'); gr.addColorStop(1, '#0f2e26'); x.fillStyle = gr; x.beginPath(); x.moveTo(cx - hw, y0); x.quadraticCurveTo(cx, y0 + 8, cx + hw, y0); x.lineTo(cx, y0 - 50); x.closePath(); x.fill(); }
      x.strokeStyle = 'rgba(170,220,255,.25)'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx, by - 140); x.lineTo(cx - 30, by - 70); x.stroke();
    });
    const rock = () => sprite(70, 50, (x, w) => {
      const cx = w / 2, by = 44, pts = [[-30, 0], [-27, -18], [-12, -32], [8, -34], [26, -20], [31, 0]].map(([a, b]) => [cx + a + rnd(-3, 3), by + b + rnd(-3, 3)]);
      const gr = x.createLinearGradient(0, by - 34, 0, by); gr.addColorStop(0, '#7d8398'); gr.addColorStop(1, '#2f3242'); x.fillStyle = gr; x.beginPath(); pts.forEach(([a, b], k) => (k ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); x.fill();
      x.fillStyle = 'rgba(255,255,255,.14)'; x.beginPath(); x.moveTo(pts[1][0] + 4, pts[1][1] + 2); x.lineTo(pts[2][0], pts[2][1] + 3); x.lineTo(pts[3][0], pts[3][1] + 4); x.lineTo(cx, by - 18); x.closePath(); x.fill();
      x.fillStyle = '#3c7a48'; x.beginPath(); x.ellipse(cx - 4, by - 30, 15, 5, -.1, 0, TAU); x.fill(); x.fillStyle = '#4f9a5a'; x.beginPath(); x.ellipse(cx - 7, by - 32, 8, 3, -.1, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(cx + 6, by - 28); x.lineTo(cx + 2, by - 16); x.lineTo(cx + 8, by - 6); x.stroke();
    });
    const ruin = () => sprite(70, 110, (x, w) => {
      const cx = w / 2, by = 104, h = rnd(50, 80);
      let gr = x.createLinearGradient(cx - 14, 0, cx + 14, 0); gr.addColorStop(0, '#8d8aa3'); gr.addColorStop(1, '#3e3b52'); x.fillStyle = gr;
      x.beginPath(); x.moveTo(cx - 14, by); x.lineTo(cx - 14, by - h); x.lineTo(cx - 4, by - h - 8); x.lineTo(cx + 3, by - h + 2); x.lineTo(cx + 14, by - h - 4); x.lineTo(cx + 14, by); x.closePath(); x.fill();
      x.fillStyle = '#a7a3bd'; x.fillRect(cx - 18, by - 8, 36, 8);
      x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 1.2; for (let k = 1; k < 4; k++) { x.beginPath(); x.moveTo(cx - 14 + k * 7, by - 8); x.lineTo(cx - 14 + k * 7, by - h + 4); x.stroke(); }
      x.strokeStyle = '#3f8a4c'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx - 12, by - 6); x.bezierCurveTo(cx + 8, by - 22, cx - 10, by - 40, cx + 8, by - h + 10); x.stroke();
      x.fillStyle = '#5aa65f'; for (let k = 0; k < 8; k++) { x.beginPath(); x.ellipse(cx + rnd(-10, 9), by - rnd(10, h - 10), 3, 1.8, rnd(0, 3), 0, TAU); x.fill(); }
      gr = x.createLinearGradient(0, by - 14, 0, by); gr.addColorStop(0, '#7f7b96'); gr.addColorStop(1, '#3a374c'); x.fillStyle = gr; x.save(); x.translate(cx + 22, by - 6); x.rotate(.3); x.fillRect(-9, -7, 18, 13); x.restore();
    });
    const crystal = () => sprite(60, 70, (x, w) => {
      const cx = w / 2, by = 64;
      for (const [ox, h, a, c0, c1] of [[-12, 30, -.35, '#d9c2ff', '#6a3bd6'], [12, 26, .4, '#c7f6ff', '#2f8fd6'], [0, 46, 0, '#f1e6ff', '#7c4dff'], [6, 20, .2, '#ffd0f2', '#c03aa4']]) {
        x.save(); x.translate(cx + ox, by); x.rotate(a); const gr = x.createLinearGradient(-7, 0, 7, 0); gr.addColorStop(0, c0); gr.addColorStop(1, c1); x.fillStyle = gr;
        x.beginPath(); x.moveTo(-7, 0); x.lineTo(-7, -h * .75); x.lineTo(0, -h); x.lineTo(7, -h * .75); x.lineTo(7, 0); x.closePath(); x.fill();
        x.fillStyle = 'rgba(255,255,255,.5)'; x.beginPath(); x.moveTo(-5, -2); x.lineTo(-5, -h * .72); x.lineTo(0, -h * .95); x.lineTo(-1, -2); x.closePath(); x.fill(); x.restore();
      }
      x.fillStyle = '#3d3a4f'; x.beginPath(); x.ellipse(cx, by, 22, 6, 0, 0, TAU); x.fill();
    });
    const obelisk = () => sprite(60, 150, (x, w) => {
      const cx = w / 2, by = 144;
      const gr = x.createLinearGradient(cx - 14, 0, cx + 14, 0); gr.addColorStop(0, '#7b7896'); gr.addColorStop(.5, '#4a4763'); gr.addColorStop(1, '#25233a'); x.fillStyle = gr;
      x.beginPath(); x.moveTo(cx - 16, by); x.lineTo(cx - 11, by - 104); x.lineTo(cx, by - 114); x.lineTo(cx + 11, by - 104); x.lineTo(cx + 16, by); x.closePath(); x.fill();
      x.fillStyle = '#9b97b6'; x.fillRect(cx - 21, by - 10, 42, 10);
      x.fillStyle = '#7ff5ff'; for (let k = 0; k < 4; k++) { x.globalAlpha = .75; x.fillRect(cx - 3, by - 28 - k * 18, 6, 2.5); x.fillRect(cx - 1.2, by - 32 - k * 18, 2.5, 8); } x.globalAlpha = 1;
    });
    SPR = { tree: [tree(0), tree(1), tree(2)], pine: [pine(), pine()], rock: [rock(), rock(), rock()], ruin: [ruin(), ruin()], crystal: [crystal(), crystal()], obelisk: [obelisk()] };
  }
  function makeGround() {
    const N = 512, c = mkCanvas(N, N), x = c.getContext('2d');
    x.fillStyle = '#1d3a2b'; x.fillRect(0, 0, N, N);
    for (let k = 0; k < 46; k++) {
      const px = rnd(0, N), py = rnd(0, N), r = rnd(30, 100), col = pick(['rgba(70,125,80,.2)', 'rgba(12,30,22,.32)', 'rgba(85,72,45,.16)', 'rgba(60,120,110,.14)']);
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const gr = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(px + ox - r, py + oy - r, r * 2, r * 2); }
    }
    for (let k = 0; k < 1800; k++) { const px = rnd(3, N - 3), py = rnd(10, N - 2), h = rnd(4, 11), lean = rnd(-3, 3); x.strokeStyle = pick(['#2a5539', '#336645', '#244a35', '#3d764b', '#183326', '#4a8a57']); x.lineWidth = rnd(.9, 1.7); x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + lean * .3, py - h * .6, px + lean, py - h); x.stroke(); }
    for (let k = 0; k < 70; k++) { x.fillStyle = 'rgba(150,160,175,.3)'; x.beginPath(); x.ellipse(rnd(4, N - 4), rnd(4, N - 4), rnd(1.5, 3.5), rnd(1, 2.4), rnd(0, 3), 0, TAU); x.fill(); }
    groundPat = g.createPattern(c, 'repeat');
  }
  function makeWorld() {
    if (!SPR) makeSprites();
    makeGround(); flat = []; tall = []; flies = []; fogs = []; paths = [];
    const far = (x, y, r) => Math.hypot(x - C, y - C) > r;
    const put = (kind, n, minR, s0, s1, list) => { for (let k = 0; k < n; k++) { const x = rnd(60, WORLD - 60), y = rnd(60, WORLD - 60); if (far(x, y, minR)) list.push({ kind, x, y, s: rnd(s0, s1), h: Math.random(), v: Math.floor(Math.random() * 3) }); } };
    for (let k = 0; k < 4; k++) {
      const a = k * TAU / 4 + rnd(-.3, .3), pts = []; let r = 240;
      while (r < WORLD * .74) { const w = Math.sin(r / 170 + k * 2) * 70; pts.push([C + Math.cos(a) * r - Math.sin(a) * w, C + Math.sin(a) * r + Math.cos(a) * w]); r += 50; }
      paths.push(pts);
      pts.forEach(([x, y], i) => { // 길 위 판돌 · 길가 횃불
        for (let j = 0; j < 2; j++) flat.push({ kind: 'cobble', x: x + rnd(-16, 16), y: y + rnd(-16, 16), s: rnd(5, 9), h: Math.random() });
        if (i % 7 === 3) { const sd = i % 14 === 3 ? 1 : -1; tall.push({ kind: 'torch', x: x - Math.sin(a) * 52 * sd, y: y + Math.cos(a) * 52 * sd, s: 1, h: Math.random() }); }
      });
    }
    put('tuft', 650, 250, 6, 11, flat); put('flower', 260, 250, 2.5, 4, flat); put('shroom', 80, 270, 6, 10, flat); put('stone', 80, 250, 4, 9, flat);
    put('tree', 150, 380, .8, 1.15, tall); put('pine', 110, 380, .8, 1.1, tall); put('rock', 80, 300, .6, 1.1, tall); put('ruin', 28, 420, .8, 1.1, tall); put('crystal', 34, 360, .7, 1.1, tall);
    for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + TAU / 8; tall.push({ kind: 'obelisk', x: C + Math.cos(a) * 262, y: C + Math.sin(a) * 262, s: 1, h: k / 4, v: 0 }); }
    for (let k = 0; k < 90; k++) flies.push({ x: rnd(0, WORLD), y: rnd(0, WORLD), p: Math.random() * TAU, c: pick(['#fff3a8', '#b6f5ff', '#d6c2ff']) });
    for (let k = 0; k < 6; k++) fogs.push({ x: Math.random(), y: Math.random(), r: rnd(.45, .8), v: rnd(.006, .016) });
  }
  const FLOWER = ['#9fd8ff', '#d2b6ff', '#ffe08a', '#ff9fc4'];
  function drawGround(cam, t) {
    g.save(); g.translate(-cam.x, -cam.y);
    g.fillStyle = groundPat; g.fillRect(cam.x, cam.y, W, H);
    g.lineCap = g.lineJoin = 'round';
    for (const [w, c] of [[74, 'rgba(10,8,6,.35)'], [60, '#3d3226'], [46, '#4d3f2e']]) { g.strokeStyle = c; g.lineWidth = w; for (const p of paths) { g.beginPath(); p.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); } }
    // 가운데 제단 (돌바닥)
    g.fillStyle = '#3b4052'; g.beginPath(); g.arc(C, C, 240, 0, TAU); g.fill();
    g.fillStyle = '#4a5066'; g.beginPath(); g.arc(C, C, 200, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(15,18,30,.55)'; g.lineWidth = 2;
    for (let r = 60; r < 240; r += 36) { g.beginPath(); g.arc(C, C, r, 0, TAU); g.stroke(); }
    for (let ring = 0; ring < 5; ring++) { const r0 = 60 + ring * 36, n = 10 + ring * 4; for (let k = 0; k < n; k++) { const a = (k + (ring % 2) * .5) * TAU / n; g.beginPath(); g.moveTo(C + Math.cos(a) * r0, C + Math.sin(a) * r0); g.lineTo(C + Math.cos(a) * (r0 + 36), C + Math.sin(a) * (r0 + 36)); g.stroke(); } }
    g.strokeStyle = '#6a7190'; g.lineWidth = 7; g.beginPath(); g.arc(C, C, 240, 0, TAU); g.stroke();
    g.restore();
    // 맵 끝 (깊은 숲)
    g.fillStyle = '#08130e';
    if (cam.x < 0) g.fillRect(0, 0, -cam.x, H);
    if (cam.y < 0) g.fillRect(0, 0, W, -cam.y);
    if (cam.x + W > WORLD) g.fillRect(WORLD - cam.x, 0, cam.x + W - WORLD, H);
    if (cam.y + H > WORLD) g.fillRect(0, WORLD - cam.y, W, cam.y + H - WORLD);
    for (const d of flat) {
      const x = d.x - cam.x, y = d.y - cam.y;
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      if (d.kind === 'tuft') { const sw = Math.sin(t * 1.6 + d.h * 9) * 2; g.strokeStyle = d.h < .5 ? '#3f7d4d' : '#2f6a42'; g.lineWidth = 1.6; g.beginPath(); for (const o of [-3, 0, 3]) { g.moveTo(x + o, y); g.quadraticCurveTo(x + o * 1.3, y - d.s * .6, x + o * 1.8 + sw, y - d.s); } g.stroke(); }
      else if (d.kind === 'cobble') { g.fillStyle = d.h < .5 ? '#5e5648' : '#6b6354'; g.beginPath(); g.ellipse(x, y, d.s, d.s * .65, d.h * 3, 0, TAU); g.fill(); }
      else if (d.kind === 'stone') { g.fillStyle = '#566070'; g.beginPath(); g.ellipse(x, y, d.s, d.s * .6, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.ellipse(x - 1, y - 1.5, d.s * .5, d.s * .25, 0, 0, TAU); g.fill(); }
      else if (d.kind === 'shroom') { g.fillStyle = '#d8d2c6'; g.fillRect(x - 1.5, y - d.s * .7, 3, d.s * .7); g.fillRect(x + 5, y - d.s * .45, 2.4, d.s * .45); g.fillStyle = '#2a8fb8'; g.beginPath(); g.ellipse(x, y - d.s * .7, d.s * .6, d.s * .38, 0, Math.PI, 0); g.fill(); g.beginPath(); g.ellipse(x + 6, y - d.s * .45, d.s * .4, d.s * .26, 0, Math.PI, 0); g.fill(); }
    }
  }
  function drawTall(d, x, y, t) { // y = 발 자리 (화면 좌표)
    if (d.kind === 'torch') {
      g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, y, 9, 3.5, 0, 0, TAU); g.fill();
      g.fillStyle = '#3a2a1c'; g.fillRect(x - 2.5, y - 40, 5, 40); g.fillStyle = '#6b5a48'; g.fillRect(x - 6, y - 46, 12, 7); g.fillStyle = '#2a2018'; g.fillRect(x - 5, y - 40, 10, 2);
      return;
    }
    const sp = SPR[d.kind][d.v % SPR[d.kind].length], sc = d.s;
    if (d.kind !== 'obelisk') { g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(x + 4, y, sp.w * sc * .33, sp.w * sc * .1, 0, 0, TAU); g.fill(); }
    if (d.kind === 'tree' || d.kind === 'pine') { // 바람에 살랑 + 내가 뒤에 있으면 반투명
      const sw = Math.sin(t * 1.1 + d.h * 9) * .025, near = st && Math.abs(st.p.x - d.x) < 46 * sc && st.p.y < d.y && st.p.y > d.y - 150 * sc;
      g.save(); g.translate(x, y); g.transform(1, 0, sw, 1, 0, 0); if (near) g.globalAlpha = .42; blit(sp, 0, 0, sc, .5, d.kind === 'pine' ? 170 / 180 : 160 / 170); g.restore(); return;
    }
    blit(sp, x, y, sc, .5, d.kind === 'rock' ? 44 / 50 : d.kind === 'ruin' ? 104 / 110 : d.kind === 'crystal' ? 64 / 70 : 144 / 150);
  }

  // ---------- 괴물 (뼈 전사 · 그림자 박쥐 · 망령 · 돌 골렘 · 어둠의 기사) ----------
  const KIND = {
    skel: { hp: 40, sp: 70, r: 15, dmg: 60, pts: 1, ht: 44, col: '#e3dccb', eye: '#ff6a3d' },
    bat: { hp: 26, sp: 128, r: 12, dmg: 45, pts: 2, ht: 42, col: '#9b5cf0', eye: '#ff3b5c' },
    ghost: { hp: 60, sp: 92, r: 16, dmg: 55, pts: 3, ht: 54, col: '#bcd0ff', eye: '#7ff9ff' },
    golem: { hp: 240, sp: 48, r: 28, dmg: 140, pts: 8, ht: 74, col: '#8a90a3', eye: '#ffa23a' },
    boss: { hp: 1700, sp: 58, r: 46, dmg: 260, pts: 60, ht: 138, col: '#ff5a3a', eye: '#ff7a1a' },
  };
  const rr = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
  const line = (...p) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); g.stroke(); };
  function drawSkel(m, t) {
    const k = m.mv ? Math.sin(m.walk) : 0, hy = -13 - (m.mv ? Math.abs(Math.cos(m.walk)) * 1.6 : 0), sy = hy - 19;
    const leg = s => line(0, hy, s * 3.5 + 1.5, -6.5, s * 6.5, -Math.max(0, -s) * 2.5), arm = s => line(-.5, hy - 11, -s * 3.5 + 2.5, hy - 5, -s * 2.5 + 7, hy - 2);
    g.strokeStyle = '#8f8878'; g.lineWidth = 3; leg(-k); arm(-k);
    g.strokeStyle = '#e3dccb'; g.lineWidth = 2.6; line(0, hy, -1, hy - 13);
    g.lineWidth = 1.7; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(-.5, hy - 10 + i * 3.2, 6 - i * .9, 1.7, 0, 0, TAU); g.stroke(); }
    g.fillStyle = '#e3dccb'; g.beginPath(); g.ellipse(0, hy, 5, 2.4, 0, 0, TAU); g.fill();
    g.lineWidth = 3; leg(k); arm(k);
    g.strokeStyle = '#9aa3ad'; g.lineWidth = 2.2; line(-k * 2.5 + 7, hy - 2, -k * 2.5 + 15, hy - 8); // 녹슨 칼
    g.fillStyle = '#ece6d6'; g.beginPath(); g.ellipse(2, sy, 7.5, 7, 0, 0, TAU); g.fill(); g.fillRect(1.5, sy + 3.5, 7, 4);
    g.fillStyle = '#1a1420'; g.beginPath(); g.ellipse(5, sy - .5, 2.5, 2.8, 0, 0, TAU); g.ellipse(-.5, sy - .5, 1.8, 2.5, 0, 0, TAU); g.fill(); g.fillRect(7.6, sy + 2.2, 1.4, 1.4);
    g.strokeStyle = '#1a1420'; g.lineWidth = .8; for (const tx of [3.2, 5.2, 7.2]) line(tx, sy + 4, tx, sy + 7.3);
    if (m.v) { g.fillStyle = '#5d5a6e'; g.beginPath(); g.ellipse(1.5, sy - 3, 8.4, 5.6, 0, Math.PI, 0); g.fill(); g.fillRect(-7.5, sy - 3.6, 18, 2.2); g.fillStyle = '#8b2a3a'; g.fillRect(-1, sy - 12, 3, 4); }
    m.eyes = [[5, sy - .5]];
  }
  function drawBat(m, t) {
    const f = Math.sin(t * 22 + m.ph), y0 = -18 - Math.sin(t * 4 + m.ph) * 4;
    g.fillStyle = '#26132f';
    for (const s of [-1, 1]) {
      g.beginPath(); g.moveTo(s * 3, y0 - 3); g.quadraticCurveTo(s * 12, y0 - 14 - f * 9, s * 23, y0 - 8 - f * 12); g.quadraticCurveTo(s * 19, y0 + 1 - f * 5, s * 15, y0 + 2 - f * 4);
      g.quadraticCurveTo(s * 11, y0 - 1, s * 8, y0 + 4 - f * 2); g.quadraticCurveTo(s * 6, y0 + 1, s * 3, y0 + 4); g.closePath(); g.fill();
    }
    g.strokeStyle = '#6a3a8c'; g.lineWidth = 1.2; for (const s of [-1, 1]) { line(s * 3, y0 - 3, s * 15, y0 + 2 - f * 4); line(s * 9, y0 - 7 - f * 5, s * 8, y0 + 4 - f * 2); }
    g.fillStyle = '#3a1f4d'; g.beginPath(); g.ellipse(0, y0, 6.5, 7.5, 0, 0, TAU); g.fill();
    g.fillStyle = '#5a3274'; g.beginPath(); g.ellipse(1, y0 + 2, 3.5, 4.5, 0, 0, TAU); g.fill();
    g.fillStyle = '#26132f'; g.beginPath(); g.moveTo(-4, y0 - 5); g.lineTo(-5, y0 - 12); g.lineTo(-1, y0 - 6); g.moveTo(2, y0 - 6); g.lineTo(4, y0 - 12); g.lineTo(5, y0 - 4); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(.5, y0 + 2.5); g.lineTo(1.3, y0 + 5); g.lineTo(2, y0 + 2.5); g.moveTo(3, y0 + 2.5); g.lineTo(3.7, y0 + 5); g.lineTo(4.4, y0 + 2.5); g.fill();
    m.eyes = [[-.5, y0 - 2], [3.5, y0 - 2]];
  }
  function drawGhost(m, t) {
    const y0 = -8 - Math.sin(t * 3 + m.ph) * 3;
    g.rotate(m.mv ? .14 : 0); g.globalAlpha *= .9;
    g.fillStyle = 'rgba(178,194,245,.88)'; g.beginPath(); g.moveTo(2, y0 - 40); g.bezierCurveTo(13, y0 - 39, 13, y0 - 22, 11, y0 - 10);
    for (let i = 0; i <= 5; i++) g.lineTo(11 - i * 5.4, y0 - 4 + Math.sin(t * 7 + i + m.ph) * 3 + (i % 2) * 4 + i * .8);
    g.bezierCurveTo(-21, y0 - 18, -10, y0 - 39, 2, y0 - 40); g.closePath(); g.fill();
    g.fillStyle = 'rgba(100,115,185,.55)'; g.beginPath(); g.moveTo(-4, y0 - 27); g.quadraticCurveTo(-10, y0 - 14, -15, y0 - 3); g.lineTo(-6, y0 - 6); g.quadraticCurveTo(-3, y0 - 16, -4, y0 - 27); g.fill();
    g.fillStyle = '#0a0c1e'; g.beginPath(); g.ellipse(5, y0 - 30, 5.6, 6.6, .15, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(225,235,255,.95)'; g.lineWidth = 1.5; const r = Math.sin(t * 5 + m.ph) * 2;
    for (const o of [0, 5]) { line(9, y0 - 19 + o, 15, y0 - 20 + o + r); line(15, y0 - 20 + o + r, 18, y0 - 23 + o + r); line(15, y0 - 20 + o + r, 18.5, y0 - 19 + o + r); }
    m.eyes = [[3.3, y0 - 31], [7, y0 - 31]];
  }
  function drawGolem(m, t) {
    const k = m.mv ? Math.sin(m.walk) : 0, s2 = m.mv ? Math.abs(Math.cos(m.walk)) * 2.5 : 0, y0 = -s2;
    g.rotate(k * .04);
    g.fillStyle = '#3a3e4e'; g.beginPath(); g.ellipse(-12 + k * 5, y0 - 30, 8, 11, 0, 0, TAU); g.fill();
    g.fillStyle = '#3f4357'; g.fillRect(-11 - k * 5, y0 - 16, 9, 16 + s2); g.fillStyle = '#50556b'; g.fillRect(2 + k * 5, y0 - 16, 9, 16 + s2);
    g.fillStyle = '#5d6276'; g.beginPath(); g.moveTo(-19, y0 - 14); g.lineTo(-22, y0 - 38); g.lineTo(-12, y0 - 54); g.lineTo(8, y0 - 58); g.lineTo(21, y0 - 44); g.lineTo(19, y0 - 14); g.closePath(); g.fill();
    g.fillStyle = '#7d8399'; g.beginPath(); g.moveTo(-12, y0 - 54); g.lineTo(8, y0 - 58); g.lineTo(21, y0 - 44); g.lineTo(4, y0 - 42); g.lineTo(-14, y0 - 40); g.closePath(); g.fill();
    g.fillStyle = '#464a5c'; g.beginPath(); g.moveTo(-22, y0 - 38); g.lineTo(-14, y0 - 40); g.lineTo(-10, y0 - 14); g.lineTo(-19, y0 - 14); g.closePath(); g.fill();
    g.strokeStyle = '#ff8a2a'; g.lineWidth = 2; g.beginPath(); g.moveTo(-8, y0 - 46); g.lineTo(-2, y0 - 34); g.lineTo(-9, y0 - 24); g.moveTo(-2, y0 - 34); g.lineTo(9, y0 - 30); g.lineTo(13, y0 - 20); g.stroke();
    g.fillStyle = '#3f7a48'; g.beginPath(); g.ellipse(-3, y0 - 55, 10, 3.5, -.15, 0, TAU); g.fill();
    g.fillStyle = '#6a6f84'; g.fillRect(-2, y0 - 69, 17, 13); g.fillStyle = '#4a4f62'; g.fillRect(-2, y0 - 59, 17, 3); g.fillStyle = '#ffb347'; g.fillRect(8, y0 - 65, 6, 3);
    g.fillStyle = '#6d7287'; g.beginPath(); g.ellipse(15 - k * 6, y0 - 29, 9, 12, -.2, 0, TAU); g.fill(); g.fillStyle = '#585d71'; g.beginPath(); g.ellipse(17 - k * 6, y0 - 17, 7.5, 6, 0, 0, TAU); g.fill();
    m.eyes = [[11, y0 - 63.5]]; m.core = [0, y0 - 34];
  }
  function drawBoss(m, t) {
    const k = m.mv ? Math.sin(m.walk) : 0, bob = m.mv ? Math.abs(Math.cos(m.walk)) * 3 : Math.sin(t * 2) * 1.5, y0 = -bob;
    g.fillStyle = '#4a0d1c'; g.beginPath(); g.moveTo(-14, y0 - 84); g.quadraticCurveTo(-30, y0 - 50, -38 + Math.sin(t * 3) * 4, y0 - 6);
    for (let i = 0; i < 5; i++) g.lineTo(-30 + i * 9, y0 - 2 + (i % 2) * 7 + Math.sin(t * 4 + i) * 2);
    g.lineTo(8, y0 - 80); g.closePath(); g.fill();
    g.fillStyle = '#1c1525'; g.fillRect(-12 - k * 9, y0 - 40, 12, 40 + bob);
    g.fillStyle = '#2d2338'; g.fillRect(2 + k * 9, y0 - 40, 12, 40 + bob); g.fillStyle = '#8a1a2e'; g.fillRect(2 + k * 9, y0 - 26, 12, 3);
    g.fillStyle = '#2f2440'; g.beginPath(); g.moveTo(-22, y0 - 88); g.lineTo(22, y0 - 88); g.lineTo(16, y0 - 40); g.lineTo(-16, y0 - 40); g.closePath(); g.fill();
    g.fillStyle = '#45355c'; g.beginPath(); g.moveTo(-16, y0 - 84); g.lineTo(10, y0 - 84); g.lineTo(6, y0 - 56); g.lineTo(-12, y0 - 56); g.closePath(); g.fill();
    g.fillStyle = '#8a1a2e'; g.fillRect(-17, y0 - 46, 34, 6); g.fillStyle = '#ff5a3a'; g.beginPath(); g.arc(0, y0 - 66, 5, 0, TAU); g.fill();
    for (const s of [-1, 1]) {
      g.fillStyle = s < 0 ? '#251c33' : '#3a2d4d'; g.beginPath(); g.ellipse(s * 21, y0 - 84, 13, 10, 0, 0, TAU); g.fill();
      g.fillStyle = '#d9cbb0'; g.beginPath(); g.moveTo(s * 14, y0 - 90); g.lineTo(s * 18, y0 - 104); g.lineTo(s * 22, y0 - 92); g.moveTo(s * 24, y0 - 90); g.lineTo(s * 33, y0 - 100); g.lineTo(s * 31, y0 - 86); g.fill();
    }
    g.fillStyle = '#251c33'; g.beginPath(); g.moveTo(-11, y0 - 92); g.lineTo(-10, y0 - 112); g.quadraticCurveTo(2, y0 - 120, 13, y0 - 110); g.lineTo(13, y0 - 92); g.closePath(); g.fill();
    g.fillStyle = '#0a0610'; g.fillRect(-2, y0 - 106, 15, 4); g.fillRect(4, y0 - 106, 3, 11);
    g.fillStyle = '#e6d8bd'; for (const [bx, s] of [[-8, -1], [10, 1]]) { g.beginPath(); g.moveTo(bx - 4, y0 - 110); g.quadraticCurveTo(bx + s * 12, y0 - 116, bx + s * 22, y0 - 134); g.quadraticCurveTo(bx + s * 8, y0 - 122, bx + 4, y0 - 114); g.closePath(); g.fill(); }
    g.strokeStyle = '#2a2038'; g.lineWidth = 9; line(18, y0 - 80, 24 - k * 3, y0 - 54);
    g.save(); g.translate(24 - k * 3, y0 - 54); g.rotate(.75 + k * .08);
    g.fillStyle = '#2b2436'; g.beginPath(); g.moveTo(0, -5); g.lineTo(60, -4); g.lineTo(72, 0); g.lineTo(60, 4); g.lineTo(0, 5); g.closePath(); g.fill();
    g.strokeStyle = '#ff5a2a'; g.lineWidth = 1.8; line(4, -4, 60, -3.3, 71, 0); g.fillStyle = '#8a1a2e'; g.fillRect(-2, -11, 5, 22); g.restore();
    m.eyes = [[3, y0 - 104], [10, y0 - 104]]; m.core = [0, y0 - 66];
  }
  const DRAW = { skel: drawSkel, bat: drawBat, ghost: drawGhost, golem: drawGolem, boss: drawBoss };
  function drawMob(m, x, y, t) { // x, y = 발 자리
    const k = KIND[m.kind], grow = m.born < .45 ? .3 + m.born / .45 * .7 : 1, sc = m.sc * grow;
    g.fillStyle = m.kind === 'bat' || m.kind === 'ghost' ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,.34)'; g.beginPath(); g.ellipse(x, y, k.r * m.sc * .95, k.r * m.sc * .34, 0, 0, TAU); g.fill();
    g.save(); g.translate(x, y); g.scale(m.face * sc, sc); g.globalAlpha = m.born < .45 ? m.born / .45 : 1;
    g.lineCap = g.lineJoin = 'round'; DRAW[m.kind](m, t);
    g.restore(); g.globalAlpha = 1;
    if (m.hp < m.max && m.kind !== 'boss') { const w = Math.max(24, k.r * 1.8 * m.sc), top = y - k.ht * m.sc - 8, f = clamp(m.hp / m.max, 0, 1); g.fillStyle = 'rgba(5,6,15,.7)'; g.fillRect(x - w / 2 - 1, top - 1, w + 2, 5); g.fillStyle = f > .5 ? '#ffd54a' : '#ff6b5a'; g.fillRect(x - w / 2, top, w * f, 3); }
  }

  // ---------- 나: 망토 기사 (앞 · 뒤 · 옆 모습이 움직이는 방향 따라 바뀐다) ----------
  const PS = 1.3, ST_HI = '#eef2fb', ST = '#aeb9d2', ST_D = '#66728d', GOLD = '#f2c14e', CAPE = '#b0153f', CAPE_D = '#5e0a22', BOOT = '#262b3b', PLUME = '#ff4d6d';
  function drawPlayer(x, y, t) {
    const p = st.p, mv = p.moving, k = mv ? Math.sin(p.walk) : 0, bob = mv ? Math.abs(Math.cos(p.walk)) * 2.4 : Math.sin(t * 2.4) * .7, y0 = -bob, hy = y0 - 44, cw = Math.sin(t * 9) * (mv ? 3 : 1.2);
    g.fillStyle = 'rgba(0,0,0,.38)'; g.beginPath(); g.ellipse(x, y, 19, 6.5, 0, 0, TAU); g.fill();
    g.save(); g.translate(x + (st.hurt > 0 ? rnd(-1.5, 1.5) : 0), y); g.scale(PS, PS); g.lineCap = g.lineJoin = 'round';
    if (p.dir === 2) { g.scale(p.face, 1); g.rotate(mv ? .07 : 0); } else g.rotate(clamp(p.vx / 215, -1, 1) * .05);
    const legF = (lx, lift) => { g.fillStyle = ST_D; g.fillRect(lx, y0 - 14, 5.5, 14 - lift + bob); g.fillStyle = BOOT; rr(lx - .6, -lift - 4.5, 6.8, 4.8, 2); g.fill(); };
    const pauldron = (px) => { g.fillStyle = ST_HI; g.beginPath(); g.ellipse(px, y0 - 31, 6.5, 5, 0, 0, TAU); g.fill(); g.strokeStyle = GOLD; g.lineWidth = 1.5; g.beginPath(); g.ellipse(px, y0 - 31, 6.5, 5, 0, .1, Math.PI - .1); g.stroke(); };
    const dome = (hx) => { g.fillStyle = ST; g.beginPath(); g.arc(hx, hy, 10, 0, TAU); g.fill(); g.fillStyle = ST_HI; g.beginPath(); g.arc(hx - 3, hy - 3.5, 4.8, 0, TAU); g.fill(); g.fillStyle = GOLD; g.fillRect(hx - 1.2, hy - 10, 2.4, 8); };
    const plume = (ex, ey) => { g.strokeStyle = PLUME; g.lineWidth = 4.2; g.beginPath(); g.moveTo(0, hy - 9); g.quadraticCurveTo(ex * .4, hy - 20, ex, ey); g.stroke(); g.strokeStyle = '#ff9aae'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, hy - 10); g.quadraticCurveTo(ex * .4, hy - 20.5, ex, ey - 1); g.stroke(); };
    const belt = (x0, w) => { g.fillStyle = '#4a2c1a'; g.fillRect(x0, y0 - 16, w, 3); g.fillStyle = GOLD; g.fillRect(x0 + w / 2 - 2, y0 - 16.6, 4, 4.2); };
    if (p.dir === 0) { // 앞모습
      g.fillStyle = CAPE_D; g.beginPath(); g.moveTo(-10, y0 - 32); g.lineTo(10, y0 - 32); g.lineTo(14 + cw * .5, y0 - 3); g.lineTo(-14 - cw * .5, y0 - 3); g.closePath(); g.fill();
      legF(-7, Math.max(0, k) * 3.5); legF(1.5, Math.max(0, -k) * 3.5);
      g.fillStyle = ST; rr(-10, y0 - 33, 20, 20, 5); g.fill(); g.fillStyle = ST_HI; rr(-8, y0 - 31, 6, 13, 3); g.fill(); g.fillStyle = 'rgba(40,50,80,.25)'; g.fillRect(3.5, y0 - 31, 5.5, 15);
      g.fillStyle = CAPE; g.beginPath(); g.moveTo(-4, y0 - 25); g.lineTo(4, y0 - 25); g.lineTo(3.5, y0 - 9); g.lineTo(0, y0 - 6); g.lineTo(-3.5, y0 - 9); g.closePath(); g.fill();
      belt(-10, 20);
      for (const s of [-1, 1]) { const sw = s * k * 2.5; g.fillStyle = ST_D; g.fillRect(s * 12 - 2.5, y0 - 28, 5, 12 + sw * .4); g.fillStyle = BOOT; g.beginPath(); g.arc(s * 12, y0 - 15 + sw, 3, 0, TAU); g.fill(); }
      pauldron(-11); pauldron(11);
      plume(-15 - cw * 1.5, hy - 12 + bob); dome(0);
      g.fillStyle = '#121624'; rr(-7, hy - 1, 14, 5, 2); g.fill(); g.fillStyle = ST_D; g.fillRect(-9, hy + 3, 4, 6); g.fillRect(5, hy + 3, 4, 6);
      p.eyes = [[-3, hy + 1.5], [3, hy + 1.5]];
    } else if (p.dir === 1) { // 뒷모습
      legF(-7, Math.max(0, -k) * 3.5); legF(1.5, Math.max(0, k) * 3.5);
      for (const s of [-1, 1]) { g.fillStyle = ST_D; g.fillRect(s * 12 - 2.5, y0 - 28, 5, 12); g.fillStyle = BOOT; g.beginPath(); g.arc(s * 12, y0 - 15 - s * k * 2.5, 3, 0, TAU); g.fill(); }
      g.fillStyle = CAPE; g.beginPath(); g.moveTo(-11, y0 - 33); g.lineTo(11, y0 - 33); g.quadraticCurveTo(13, y0 - 18, 14 + cw * .6, y0 - 3);
      for (let i = 1; i <= 4; i++) g.lineTo(14 - i * 7 + cw * .6, y0 - 3 + (i % 2) * 2.5 + Math.sin(t * 8 + i) * 1.2);
      g.quadraticCurveTo(-13, y0 - 18, -11, y0 - 33); g.closePath(); g.fill();
      g.strokeStyle = GOLD; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-11, y0 - 33); g.quadraticCurveTo(-13, y0 - 18, -14 + cw * .6, y0 - 3); g.moveTo(11, y0 - 33); g.quadraticCurveTo(13, y0 - 18, 14 + cw * .6, y0 - 3); g.stroke();
      g.fillStyle = CAPE_D; g.beginPath(); g.moveTo(-2, y0 - 30); g.quadraticCurveTo(-3, y0 - 16, -5 + cw * .4, y0 - 5); g.lineTo(-1 + cw * .4, y0 - 5); g.quadraticCurveTo(0, y0 - 18, 1, y0 - 30); g.fill();
      pauldron(-11); pauldron(11);
      dome(0); plume(5 + cw, hy + 6 + bob);
      p.eyes = null;
    } else { // 옆모습 (오른쪽 기준, 왼쪽은 뒤집어서)
      const tr = mv ? 9 : 3;
      g.fillStyle = CAPE_D; g.beginPath(); g.moveTo(-3, y0 - 32); g.quadraticCurveTo(-10 - tr, y0 - 22, -12 - tr * 1.3 + cw, y0 - 4); g.lineTo(-3 - tr * .4 + cw * .6, y0 - 2); g.lineTo(3, y0 - 30); g.closePath(); g.fill();
      g.lineWidth = 5.5; g.strokeStyle = '#4f5a73'; line(0, y0 - 14, -k * 3 + 1, y0 - 7, -k * 6, -Math.max(0, k) * 3); g.fillStyle = BOOT; rr(-k * 6 - 3, -Math.max(0, k) * 3 - 4, 7.5, 4.5, 2); g.fill();
      g.strokeStyle = '#4f5a73'; g.lineWidth = 4.5; line(-1, y0 - 28, k * 3 - 2, y0 - 22, k * 6, y0 - 16);
      g.strokeStyle = ST_D; g.lineWidth = 5.5; line(0, y0 - 14, k * 3 + 1, y0 - 7, k * 6, -Math.max(0, -k) * 3); g.fillStyle = BOOT; rr(k * 6 - 3, -Math.max(0, -k) * 3 - 4, 7.5, 4.5, 2); g.fill();
      g.fillStyle = ST; rr(-6, y0 - 33, 13, 20, 5); g.fill(); g.fillStyle = ST_HI; rr(2, y0 - 31, 4, 13, 2); g.fill(); g.fillStyle = CAPE; g.fillRect(4.5, y0 - 26, 2.5, 15);
      belt(-6, 13);
      g.strokeStyle = ST; g.lineWidth = 5; line(1, y0 - 28, -k * 3 + 3, y0 - 22, -k * 6 + 2, y0 - 16); g.fillStyle = BOOT; g.beginPath(); g.arc(-k * 6 + 2, y0 - 15, 3, 0, TAU); g.fill();
      pauldron(0);
      plume(-16 - (mv ? 6 : 0) - cw, hy - 6 + bob); dome(1);
      g.fillStyle = '#121624'; rr(3, hy - 1, 8.5, 4.6, 2); g.fill(); g.fillStyle = ST_D; g.fillRect(4, hy + 3, 5, 6);
      p.eyes = [[7.5, hy + 1.3]];
    }
    g.restore();
  }

  // ---------- 검 · 보석 · 포션 · 효과 (빛나는 것들은 어둠 위에 그린다) ----------
  function drawBlades(x, y, t) { // x, y = 내 몸 가운데 (화면)
    const tier = tierOf(st.lv), col = TIERS[tier][0], sp = swordSprite(st.len, tier), n = st.swords, r0 = st.r0, span = clamp(.28 + st.spinNow * .05, .3, .95);
    g.globalCompositeOperation = 'lighter';
    if (!reduce) { g.lineCap = 'butt'; g.lineWidth = st.len * .62; for (let s = 0; s < n; s++) { const a = st.ang + s * TAU / n; for (let j = 0; j < 12; j++) { g.strokeStyle = hexA(col, .13 * (1 - j / 12)); g.beginPath(); g.arc(x, y, r0 + st.len * .55, a - (j + 1) * span / 12, a - j * span / 12 + .02); g.stroke(); } } }
    for (let s = 0; s < n; s++) { const a = st.ang + s * TAU / n; drawGlow(col, x + Math.cos(a) * (r0 + st.len), y + Math.sin(a) * (r0 + st.len), 14 + st.len * .12, .55); }
    g.globalCompositeOperation = 'source-over';
    for (let s = 0; s < n; s++) { g.save(); g.translate(x, y); g.rotate(st.ang + s * TAU / n); g.drawImage(sp.c, r0 - sp.ox, -sp.oy, sp.w, sp.h); g.restore(); }
  }
  const gemStyle = v => (v >= 20 ? ['#ffc83d', 11] : v >= 6 ? ['#c58bff', 8] : v >= 3 ? ['#ffe066', 6.5] : v >= 2 ? ['#5dffa0', 5.5] : ['#5ce1ff', 4.5]);
  function drawGems(cam, t) {
    const vis = [];
    for (const q of st.gems) { const x = q.x - cam.x, y = q.y - cam.y - 6 + Math.sin(t * 4 + q.ph) * 2.5; if (x > -20 && y > -20 && x < W + 20 && y < H + 20) vis.push([q, x, y]); }
    g.globalCompositeOperation = 'lighter'; for (const [q, x, y] of vis) { const [c, s] = gemStyle(q.v); drawGlow(c, x, y, s * 3, .5); } g.globalCompositeOperation = 'source-over';
    for (const [q, x, y] of vis) {
      const [c, s] = gemStyle(q.v);
      g.fillStyle = c; g.beginPath(); g.moveTo(x, y - s * 1.3); g.lineTo(x + s, y); g.lineTo(x, y + s * 1.3); g.lineTo(x - s, y); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.moveTo(x, y - s * 1.3); g.lineTo(x + s * .35, y - s * .15); g.lineTo(x - s * .55, y - s * .05); g.closePath(); g.fill();
      g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.moveTo(x + s, y); g.lineTo(x, y + s * 1.3); g.lineTo(x, y); g.closePath(); g.fill();
    }
  }
  const POT = { 200: ['#ff4d5e', '#9e0f2a', 12], 400: ['#ff5fc8', '#a2147a', 14], 500: ['#9f7bff', '#4a1fc2', 15], 750: ['#ffd23d', '#c77a00', 18] };
  function drawPotion(q, x, y, t) {
    const [c0, c1, s] = POT[q.v], pop = Math.min(1, (st.t - q.born) / .4), yy = y - 16 + Math.sin(t * 3 + q.x) * 3;
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, y, s * .8, s * .28, 0, 0, TAU); g.fill();
    g.globalCompositeOperation = 'lighter'; drawGlow(c0, x, yy, s * 3.4 * pop, .55); if (q.v === 750) { g.globalAlpha = .3; g.drawImage(glow(c0), x - s * 1.1, yy - 110, s * 2.2, 140); g.globalAlpha = 1; } g.globalCompositeOperation = 'source-over';
    g.save(); g.translate(x, yy); g.scale(pop, pop);
    g.fillStyle = 'rgba(215,232,255,.38)'; g.beginPath(); g.arc(0, s * .25, s * .9, 0, TAU); g.fill(); g.fillRect(-s * .3, -s * .95, s * .6, s * .8);
    g.save(); g.beginPath(); g.arc(0, s * .25, s * .74, 0, TAU); g.clip();
    const gr = g.createLinearGradient(0, -s * .3, 0, s); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.beginPath(); g.moveTo(-s, s * .05);
    for (let i = 0; i <= 8; i++) g.lineTo(-s + i * s / 4, s * .02 + Math.sin(t * 5 + i) * s * .06); g.lineTo(s, s * 1.2); g.lineTo(-s, s * 1.2); g.closePath(); g.fill(); g.restore();
    g.fillStyle = '#8a5a32'; rr(-s * .38, -s * 1.22, s * .76, s * .34, 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.75)'; g.beginPath(); g.ellipse(-s * .32, s * .02, s * .13, s * .3, -.4, 0, TAU); g.fill();
    if (q.v === 750) for (let k = 0; k < 4; k++) { const a = t * 2 + k * TAU / 4; g.fillStyle = '#fff6c8'; g.beginPath(); g.arc(Math.cos(a) * s * 1.6, Math.sin(a) * s * 1.6, 2.2, 0, TAU); g.fill(); }
    g.font = '900 12px Pretendard, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(10,8,25,.85)'; g.strokeText('+' + q.v, 0, -s * 1.7); g.fillStyle = '#fff'; g.fillText('+' + q.v, 0, -s * 1.7);
    g.restore();
  }
  function fx(k, x, y, o = {}) { if (st.fx.length > 500) return; st.fx.push(Object.assign({ k, x, y, vx: 0, vy: 0, t: 0, life: .6, col: '#fff', r: 3 }, o)); }
  function burst(x, y, col, n = 10, sp = 160, k = 'spark') { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, v = rnd(.3, 1) * sp; fx(k, x, y, { vx: Math.cos(a) * v, vy: Math.sin(a) * v - (k === 'ember' ? 40 : 0), life: rnd(.35, .8), col, r: rnd(1.6, 3.8) }); } }
  function drawFx(cam) {
    g.globalCompositeOperation = 'lighter';
    for (const e of st.fx) {
      const x = e.x - cam.x, y = e.y - cam.y, f = e.t / e.life;
      if (e.k === 'ring') { g.strokeStyle = hexA(e.col, .7 * (1 - f)); g.lineWidth = 6 * (1 - f) + 1; g.beginPath(); g.arc(x, y, e.r * (.2 + f * .8), 0, TAU); g.stroke(); continue; }
      if (e.k === 'slash') { g.strokeStyle = hexA(e.col, .9 * (1 - f)); g.lineWidth = 3 * (1 - f) + .5; g.beginPath(); g.arc(x, y, e.r, e.a - .9, e.a + .9); g.stroke(); continue; }
      if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      drawGlow(e.col, x, y, e.r * (e.k === 'soul' ? 4 : 2.6), 1 - f);
    }
    g.globalCompositeOperation = 'source-over';
  }

  // ---------- 한 판 ----------
  const need = lv => Math.floor(6 + lv * 2.6 + lv * lv * .06); // 다음 레벨까지 포인트
  const fmtT = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  let glowFlat = [], torches = [], cam0 = null, cards = [], picking = false, hudC = {};
  function derive() {
    const u = st.up;
    st.len = 50 * (1 + u.size); st.r0 = 40 + 18 * (1 + u.size); st.wid = clamp(st.len * .19, 8, 26);
    st.spinNow = 2.8 * (1 + u.spin); st.swords = 3 + u.sword; st.slow = u.slow;
  }
  function newRun() {
    st = { t: 0, p: { x: C, y: C + 60, vx: 0, vy: 0, moving: false, walk: 0, dir: 0, face: 1, eyes: null }, up: { size: 0, spin: 0, sword: 0, hp: 0, slow: 0 },
      hpMax: S.MINI_HP, hp: S.MINI_HP, lv: 1, xp: 0, pend: 0, lvT: 0, ang: 0, mobs: [], gems: [], pots: [], fx: [], texts: [],
      kills: 0, spawnT: 1.2, potT: 0, bossT: 60, boss: 0, waveT: 75, wave: 0, hurt: 0, shake: 0, dead: 0, nick: O.nick || '나' };
    derive(); hudC = {};
    for (let k = 0; k < 6; k++) spawn('skel');
  }
  function spawn(kind, ang, dist) {
    const k = KIND[kind], a = ang != null ? ang : Math.random() * TAU, d = dist || Math.hypot(W, H) * .5 + 40, big = kind === 'boss' ? 1 + st.boss * .08 : 1;
    const grow = (1 + st.t / 75) * (kind === 'boss' ? 1 + st.boss * .6 : 1);
    st.mobs.push({ kind, x: clamp(st.p.x + Math.cos(a) * d, 30, WORLD - 30), y: clamp(st.p.y + Math.sin(a) * d, 30, WORLD - 30), r: k.r * big, sc: big * (kind === 'golem' ? 1.05 : kind === 'boss' ? 1 : 1.2), hp: k.hp * grow, max: k.hp * grow,
      sp: k.sp * rnd(.9, 1.1), hit: {}, flash: 0, ph: Math.random() * TAU, face: 1, walk: Math.random() * 6, mv: true, born: 0, v: Math.random() < .35 ? 1 : 0, eyes: null, core: null });
  }
  function float(x, y, txt, col, size = 14, life = .9) { st.texts.push({ x, y, txt, col, size, t: 0, life }); }
  function banner(txt) { const b = $('#mgBanner'); b.textContent = txt; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
  function rollHeal() { let r = Math.random(); for (const [p, v] of S.MINI_POTIONS) { if (r < p) return v; r -= p; } return 200; }
  function dropPotions() { // 맵에 최대 3개, 한 번에 1~2개
    const n = Math.min(3 - st.pots.length, 1 + (Math.random() < .5 ? 1 : 0));
    for (let k = 0; k < n; k++) { const a = Math.random() * TAU, d = rnd(260, 820); st.pots.push({ x: clamp(st.p.x + Math.cos(a) * d, 60, WORLD - 60), y: clamp(st.p.y + Math.sin(a) * d, 60, WORLD - 60), v: rollHeal(), born: st.t }); }
    if (n > 0) float(st.p.x, st.p.y - 100, `체력 포션 ${n}개가 나타났어요!`, '#ffffff', 15, 1.6);
  }
  function dropGem(x, y, v) {
    if (st.gems.length > 260) { st.gems[Math.floor(Math.random() * st.gems.length)].v += v; return; }
    st.gems.push({ x, y, v, ph: Math.random() * TAU, fly: false, sp: 0 });
  }
  function gainXp(v) {
    if (st.lv >= S.MINI_MAXLV) return; // 50레벨부터는 게이지를 채워도 업그레이드가 없다
    st.xp += v;
    while (st.lv < S.MINI_MAXLV && st.xp >= need(st.lv)) { st.xp -= need(st.lv); st.lv++; st.pend++; levelFx(); }
    if (st.lv >= S.MINI_MAXLV) st.xp = 0;
  }
  function levelFx() {
    const p = st.p; SND.lvup(); st.lvT = .45;
    fx('ring', p.x, p.y, { r: 300, col: '#ffd54a', life: .7 }); burst(p.x, p.y, '#ffd54a', 30, 260, 'ember');
    float(p.x, p.y - 96, `LEVEL ${st.lv}!`, '#ffd54a', 24, 1.4);
    for (const m of st.mobs) { const dx = m.x - p.x, dy = m.y - p.y, d = Math.hypot(dx, dy) || 1; if (d < 280 && m.kind !== 'boss') { m.x += dx / d * 110; m.y += dy / d * 110; } } // 둘레 괴물을 밀어낸다
  }
  function kill(m) {
    const k = KIND[m.kind], fy = m.y + m.r * .7 - k.ht * m.sc * .45;
    st.kills++; SND.kill();
    burst(m.x, fy, k.col, m.kind === 'boss' ? 50 : 12, m.kind === 'boss' ? 340 : 170);
    fx('soul', m.x, fy, { vy: -60, col: k.eye, r: m.kind === 'boss' ? 8 : 4, life: .9 });
    if (m.kind === 'boss') { st.shake = 10; for (let j = 0; j < 8; j++) dropGem(m.x + rnd(-50, 50), m.y + rnd(-40, 40), Math.ceil(k.pts / 8)); banner('어둠의 기사를 물리쳤다!'); }
    else dropGem(m.x, m.y, k.pts);
  }
  function stepFx(dt) {
    for (const e of st.fx) { e.t += dt; e.x += e.vx * dt; e.y += e.vy * dt; e.vx *= .93; e.vy = e.vy * .93 + (e.k === 'ember' ? -20 * dt : 0); }
    st.fx = st.fx.filter(e => e.t < e.life);
    for (const x of st.texts) { x.t += dt; x.y -= 36 * dt; }
    st.texts = st.texts.filter(x => x.t < x.life);
  }
  function update(dt) {
    const p = st.p;
    st.t += dt; st.hurt = Math.max(0, st.hurt - dt); st.shake = Math.max(0, st.shake - dt * 20);
    if (st.pend > 0) { st.lvT -= dt; if (st.lvT <= 0) { offer(); return; } }
    // 움직이기 (방향에 따라 앞 · 뒤 · 옆 모습)
    let mx = (keys.arrowright || keys.d ? 1 : 0) - (keys.arrowleft || keys.a ? 1 : 0), my = (keys.arrowdown || keys.s ? 1 : 0) - (keys.arrowup || keys.w ? 1 : 0);
    if (joy.on) { const dx = joy.x - joy.bx, dy = joy.y - joy.by, d = Math.hypot(dx, dy); if (d > 6) { mx = dx / Math.max(d, 55); my = dy / Math.max(d, 55); } }
    const ml = Math.hypot(mx, my); if (ml > 1) { mx /= ml; my /= ml; }
    p.vx = mx * 215; p.vy = my * 215; p.moving = ml > .1;
    if (p.moving) { p.walk += dt * 12 * Math.min(1, ml + .3); if (Math.abs(mx) > Math.abs(my) * .8) { p.dir = 2; p.face = mx > 0 ? 1 : -1; } else p.dir = my > 0 ? 0 : 1; }
    p.x = clamp(p.x + p.vx * dt, 24, WORLD - 24); p.y = clamp(p.y + p.vy * dt, 24, WORLD - 24);
    st.ang += st.spinNow * dt;
    if (!reduce && Math.random() < dt * st.swords * 2) { const a = st.ang + Math.floor(Math.random() * st.swords) * TAU / st.swords, r = st.r0 + st.len; fx('spark', p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, { vx: -Math.sin(a) * 60, vy: Math.cos(a) * 60, col: TIERS[tierOf(st.lv)][0], r: rnd(1.5, 2.6), life: .45 }); }
    // 괴물 나오기 (시간이 갈수록 많고 세게) · 1분마다 보스 · 75초마다 포위
    st.spawnT -= dt;
    if (st.spawnT <= 0 && st.mobs.length < 180) {
      st.spawnT = Math.max(.14, 1.0 - st.t * .008);
      for (let k = 0, n = 1 + Math.floor(st.t / 50); k < n; k++) { const r = Math.random(); spawn(st.t > 40 && r < .1 ? 'golem' : st.t > 20 && r < .32 ? 'ghost' : st.t > 12 && r < .55 ? 'bat' : 'skel'); }
    }
    if (st.t >= st.bossT) { st.bossT += 60; spawn('boss'); st.boss++; banner('어둠의 기사가 나타났다!'); SND.boss(); st.shake = 8; }
    if (st.t >= st.waveT) { st.waveT += 75; st.wave++; const n = 18 + st.wave * 4; for (let k = 0; k < n; k++) spawn(st.wave % 2 ? 'bat' : 'skel', k * TAU / n, 430); banner('괴물들이 몰려와요!'); }
    // 체력 포션: 20초마다 1~2개
    st.potT += dt; if (st.potT >= 20) { st.potT -= 20; dropPotions(); }
    for (let i = st.pots.length - 1; i >= 0; i--) {
      const q = st.pots[i]; if (Math.hypot(q.x - p.x, q.y - p.y) > 36) continue;
      st.hp = Math.min(st.hpMax, st.hp + q.v); float(p.x, p.y - 80, `+${q.v} 체력`, '#7ef0a0', 20, 1.3);
      burst(q.x, q.y - 14, POT[q.v][0], 22, 220); fx('ring', p.x, p.y, { r: 90, col: '#7ef0a0', life: .6 }); st.pots.splice(i, 1); SND.potion();
    }
    // 포인트 보석: 가까우면 끌려와서 게이지를 채운다
    for (let i = st.gems.length - 1; i >= 0; i--) {
      const q = st.gems[i], dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy) || 1;
      if (q.fly || d < 125) { q.fly = true; q.sp = Math.min(900, (q.sp || 120) + 1500 * dt); q.x += dx / d * Math.min(d, q.sp * dt); q.y += dy / d * Math.min(d, q.sp * dt); }
      if (d < 20 || (q.fly && q.sp * dt >= d)) { st.gems.splice(i, 1); gainXp(q.v); SND.gem(); fx('spark', p.x, p.y, { col: gemStyle(q.v)[0], r: 4, life: .3 }); }
    }
    // 괴물: 다가오기 · 칼에 맞기 · 나를 때리기
    const n = st.swords, r0 = st.r0, r1 = st.r0 + st.len, wid = st.wid, slowF = 1 - st.slow, dmgBase = 32 * (1 + (st.lv - 1) * .045), tc = TIERS[tierOf(st.lv)];
    for (let i = st.mobs.length - 1; i >= 0; i--) {
      const m = st.mobs[i], k = KIND[m.kind], dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy) || 1;
      m.born += dt; m.flash = Math.max(0, m.flash - dt);
      const sp = m.sp * slowF * (m.kind === 'bat' ? 1 + Math.sin(st.t * 3 + m.ph) * .25 : 1) * (m.born < .45 ? .2 : 1);
      m.mv = d > 14 + m.r;
      if (m.mv) { m.x += dx / d * sp * dt; m.y += dy / d * sp * dt; m.walk += sp * dt * .11; }
      if (Math.abs(dx) > 4) m.face = dx > 0 ? 1 : -1;
      if (d < 20 + m.r && m.born > .45) { st.hp -= k.dmg * dt; st.hurt = .15; SND.hurt(); }
      if (m.kind === 'boss' && Math.random() < dt * 14) fx('ember', m.x + rnd(-30, 30) * m.sc, m.y + m.r * .7 - rnd(20, 110) * m.sc, { vx: rnd(-15, 15), vy: -rnd(30, 80), col: '#ff6a2a', r: rnd(2, 4), life: rnd(.5, 1) });
      if (d - m.r < r1 + 4) for (let s = 0; s < n; s++) { // 검 = 몸 가운데에서 바깥으로 뻗은 막대 (손잡이 쪽에 붙은 괴물도 베인다)
        const a = st.ang + s * TAU / n, ux = Math.cos(a), uy = Math.sin(a), along = -dx * ux - dy * uy;
        if (along < 0 || along > r1 + m.r || Math.abs(dx * uy - dy * ux) > m.r + wid * .6 || (m.hit[s] || 0) > st.t) continue;
        m.hit[s] = st.t + .3;
        const crit = Math.random() < .12, dmg = Math.round(dmgBase * rnd(.9, 1.1) * (crit ? 2 : 1)), top = m.y + m.r * .7 - k.ht * m.sc;
        m.hp -= dmg; m.flash = .1;
        if (m.kind !== 'boss') { m.x += -dx / d * 9 - uy * 6; m.y += -dy / d * 9 + ux * 6; }
        if (st.texts.length < 70) float(m.x, top, crit ? dmg + '!' : String(dmg), crit ? '#ffb020' : '#ffffff', crit ? 18 : 13, .6);
        fx('slash', m.x, m.y + m.r * .7 - k.ht * m.sc * .45, { r: m.r * 1.15, a: a + Math.PI / 2, col: tc[0], life: .22 });
        burst(p.x + ux * along, p.y + uy * along, tc[1], 4, 140); SND.hit();
      }
      if (m.hp <= 0) { kill(m); st.mobs.splice(i, 1); }
    }
    const ms = st.mobs; // 괴물끼리 살짝 밀어내기
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) { const a = ms[i], b = ms[j], dx = b.x - a.x, dy = b.y - a.y, rr2 = a.r + b.r; if (Math.abs(dx) > rr2 || Math.abs(dy) > rr2) continue; const d = Math.hypot(dx, dy) || 1; if (d < rr2) { const push = (rr2 - d) / 2, ux = dx / d, uy = dy / d; a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; } }
    stepFx(dt);
    if (st.hp <= 0) { st.hp = 0; die(); }
  }

  // ---------- 레벨 업 카드 (별 1 흰색 · 별 2 파랑 · 별 3 빨강) ----------
  const RARE = ['', '보통', '희귀', '전설'];
  function rollRare() { let r = Math.random(); for (let i = 0; i < 3; i++) { if (r < S.MINI_RARE[i]) return i + 1; r -= S.MINI_RARE[i]; } return 1; }
  function upText(k, add) { // 지금 → 고르면
    const u = st.up, U = S.MINI_UP;
    if (k === 'size' || k === 'spin') return `${(1 + u[k]).toFixed(2)}× → ${(1 + Math.min(U[k].max, u[k] + add)).toFixed(2)}×`;
    if (k === 'sword') return `${3 + u.sword}개 → ${3 + Math.min(U.sword.max, u.sword + add)}개`;
    if (k === 'hp') return `최대 ${st.hpMax} → ${st.hpMax + add}`;
    return `−${Math.round(u.slow * 100)}% → −${Math.round(Math.min(U.slow.max, 1 - (1 - u.slow) * (1 - add)) * 100)}%`;
  }
  function offer() {
    const U = S.MINI_UP, pool = Object.keys(U).filter(k => st.up[k] < U[k].max - 1e-6);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    cards = pool.slice(0, 3).map(k => ({ k, r: rollRare() }));
    $('#mgCards').innerHTML = cards.map((c, i) => { const u = U[c.k], v = u.vals[c.r - 1]; return `<button type="button" class="mg-cu r${c.r}" data-i="${i}" style="--d:${(i * .09).toFixed(2)}s"><span class="cu-rare">${RARE[c.r]}</span><span class="mg-up-ic mg-${c.k}"></span><b>${u.name}</b><span class="mg-stars">${'<i class="on"></i>'.repeat(c.r)}</span><strong>${u.fmt(v)}</strong><small>${upText(c.k, v)}</small><kbd>${i + 1}</kbd></button>`; }).join('');
    $('#mgPickLv').textContent = st.lv; state = 'level'; joy.on = false; picking = false; $('#mgPick').hidden = false;
  }
  function choose(i) {
    const c = cards[i]; if (!c || state !== 'level' || picking) return;
    picking = true;
    $$('#mgCards .mg-cu').forEach((b, j) => b.classList.add(j === i ? 'go' : 'out'));
    setTimeout(() => {
      const U = S.MINI_UP, v = U[c.k].vals[c.r - 1], col = c.r === 3 ? '#ff4d6d' : c.r === 2 ? '#4da3ff' : '#e8eeff';
      if (c.k === 'slow') st.up.slow = Math.min(U.slow.max, 1 - (1 - st.up.slow) * (1 - v));
      else { st.up[c.k] = Math.min(U[c.k].max, st.up[c.k] + v); if (c.k === 'hp') { st.hpMax += v; st.hp += v; } }
      derive(); SND.pick(c.r);
      fx('ring', st.p.x, st.p.y, { r: 170, col, life: .55 }); burst(st.p.x, st.p.y, col, 24, 220, 'ember');
      float(st.p.x, st.p.y - 86, `${U[c.k].name} ${U[c.k].fmt(v)}`, col, 17, 1.4);
      cards = []; picking = false; $('#mgPick').hidden = true; st.pend--; st.lvT = .3; state = 'play'; last = performance.now();
    }, 260);
  }

  // ---------- 그리기 ----------
  function drawLight(cam, t) { // 어둠 + 빛 구멍 (절반 크기로 그려 빠르게)
    const k = .5, w = lc.width, h = lc.height;
    lg.globalCompositeOperation = 'source-over'; lg.globalAlpha = 1; lg.clearRect(0, 0, w, h); lg.fillStyle = 'rgba(6,8,26,.62)'; lg.fillRect(0, 0, w, h);
    lg.globalCompositeOperation = 'destination-out';
    const L = (x, y, r, a) => { if (x + r < 0 || y + r < 0 || x - r > W || y - r > H) return; lg.globalAlpha = clamp(a, 0, 1); lg.drawImage(LIGHT, (x - r) * k, (y - r) * k, r * 2 * k, r * 2 * k); };
    if (st) { const px = st.p.x - cam.x, py = st.p.y - cam.y; L(px, py, 290 + st.r0 + st.len, 1); L(px, py, 150, 1); }
    L(C - cam.x, C - cam.y, 300, .7);
    for (const d of torches) L(d.x - cam.x, d.y - cam.y - 46, 190 + Math.sin(t * 11 + d.h * 20) * 10, .85);
    for (const d of tall) { if (d.kind === 'crystal') L(d.x - cam.x, d.y - cam.y - 25, 120, .6); else if (d.kind === 'obelisk') L(d.x - cam.x, d.y - cam.y - 130, 140, .6); }
    for (const d of glowFlat) if (d.kind === 'shroom') L(d.x - cam.x, d.y - cam.y, 70, .45);
    if (st) { for (const q of st.pots) L(q.x - cam.x, q.y - cam.y - 16, 110, .8); for (const q of st.gems) if (q.v >= 6) L(q.x - cam.x, q.y - cam.y, 50, .5); for (const m of st.mobs) if (m.kind === 'boss') L(m.x - cam.x, m.y - cam.y, 170, .5); }
    lg.globalAlpha = 1; lg.globalCompositeOperation = 'source-over';
    g.drawImage(lc, 0, 0, W, H);
  }
  function drawGlows(cam, t) { // 어둠 위에서 빛나는 것들 (마법진 · 횃불 · 수정 · 눈)
    g.globalCompositeOperation = 'lighter';
    const ax = C - cam.x, ay = C - cam.y;
    if (ax > -300 && ay > -300 && ax < W + 300 && ay < H + 300) {
      const a = .5 + .2 * Math.sin(t * 2);
      drawGlow('#5ce1ff', ax, ay, 190, .16 + .06 * Math.sin(t * 2));
      g.strokeStyle = hexA('#5ce1ff', a); g.lineWidth = 3; g.beginPath(); g.arc(ax, ay, 132, 0, TAU); g.stroke(); g.lineWidth = 2; g.beginPath(); g.arc(ax, ay, 110, 0, TAU); g.stroke();
      g.save(); g.translate(ax, ay); g.rotate(t * .2); g.lineWidth = 2.4; g.beginPath(); for (let k = 0; k <= 5; k++) { const q = k * TAU * 2 / 5 - Math.PI / 2; g.lineTo(Math.cos(q) * 110, Math.sin(q) * 110); } g.stroke();
      g.fillStyle = hexA('#bff6ff', a); for (let k = 0; k < 18; k++) { g.rotate(TAU / 18); g.fillRect(115, -1, 12, 2); g.fillRect(120, -4, 2, 8); }
      g.restore();
    }
    for (const d of torches) {
      const x = d.x - cam.x, y = d.y - cam.y; if (x < -100 || y < -120 || x > W + 100 || y > H + 60) continue;
      const fl = Math.sin(t * 13 + d.h * 20) * .5 + Math.sin(t * 7.3 + d.h * 9) * .5;
      drawGlow('#ff8a2a', x, y - 50, 80 + fl * 8, .45); drawGlow('#ffd27a', x, y - 52, 16 + fl * 2, .95);
      g.fillStyle = 'rgba(255,185,80,.85)'; g.beginPath(); g.moveTo(x - 5, y - 46); g.quadraticCurveTo(x - 6, y - 56, x + fl * 2, y - 65 - fl * 2); g.quadraticCurveTo(x + 6, y - 56, x + 5, y - 46); g.closePath(); g.fill();
    }
    for (const d of tall) {
      if (d.kind !== 'crystal' && d.kind !== 'obelisk') continue;
      const x = d.x - cam.x, y = d.y - cam.y; if (x < -80 || y < -160 || x > W + 80 || y > H + 60) continue;
      if (d.kind === 'crystal') drawGlow('#b48cff', x, y - 28 * d.s, 56, .4 + .12 * Math.sin(t * 2 + d.h * 9));
      else { drawGlow('#7ff5ff', x, y - 128, 34, .7 + .2 * Math.sin(t * 3 + d.h * 6)); drawGlow('#7ff5ff', x, y - 70, 40, .18); }
    }
    for (const d of glowFlat) {
      const x = d.x - cam.x, y = d.y - cam.y; if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
      if (d.kind === 'shroom') drawGlow('#4fd8ff', x, y - d.s * .7, 20, .5 + .15 * Math.sin(t * 2 + d.h * 7)); else drawGlow(FLOWER[Math.floor(d.h * 4)], x, y, 6, .7);
    }
    if (st) {
      for (const m of st.mobs) {
        if (!m.eyes) continue;
        const k = KIND[m.kind], fx0 = m.x - cam.x, fy0 = m.y + m.r * .7 - cam.y;
        if (m.kind === 'boss') drawGlow('#ff3a1a', fx0, fy0 - 60 * m.sc, 120 * m.sc, .22 + .08 * Math.sin(t * 3));
        if (m.core) drawGlow(k.eye, fx0 + m.core[0] * m.face * m.sc, fy0 + m.core[1] * m.sc, 22 * m.sc, .55);
        for (const e of m.eyes) drawGlow(k.eye, fx0 + e[0] * m.face * m.sc, fy0 + e[1] * m.sc, 7 * m.sc, .95);
        if (m.flash > 0) drawGlow('#ffffff', fx0, fy0 - k.ht * m.sc * .45, k.r * m.sc * 1.6, .7);
      }
      const p = st.p, px = p.x - cam.x, py = p.y + 16 - cam.y;
      if (!st.dead && p.eyes) for (const e of p.eyes) drawGlow('#7ff5ff', px + e[0] * PS * (p.dir === 2 ? p.face : 1), py + e[1] * PS, 7, .95);
      if (st.hurt > 0) drawGlow('#ff2a4a', px, py - 30, 66, .45);
    }
    for (const f of flies) { const x = f.x - cam.x + Math.sin(t * .7 + f.p) * 30, y = f.y - cam.y + Math.cos(t * .5 + f.p) * 20; if (x < 0 || y < 0 || x > W || y > H) continue; drawGlow(f.c, x, y, 7, .45 + .4 * Math.sin(t * 3 + f.p)); }
    g.globalCompositeOperation = 'source-over';
  }
  function drawHead(x, y) { // 머리 위: 닉네임 · 체력 막대 · 체력 숫자
    const f = clamp(st.hp / st.hpMax, 0, 1), bw = 96;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 13px Pretendard, "Apple SD Gothic Neo", sans-serif'; g.lineWidth = 4; g.strokeStyle = 'rgba(5,6,18,.9)'; g.strokeText(st.nick, x, y - 20); g.fillStyle = '#fff'; g.fillText(st.nick, x, y - 20);
    g.fillStyle = 'rgba(5,6,18,.82)'; rr(x - bw / 2 - 3, y - 8, bw + 6, 16, 8); g.fill(); g.strokeStyle = 'rgba(255,215,120,.6)'; g.lineWidth = 1; g.stroke();
    if (f > 0) {
      const col = f > .5 ? ['#86f5a8', '#16a34a'] : f > .25 ? ['#ffe27a', '#e08a00'] : ['#ff9aa8', '#d0103a'], gr = g.createLinearGradient(0, y - 5, 0, y + 5); gr.addColorStop(0, col[0]); gr.addColorStop(1, col[1]);
      g.fillStyle = gr; rr(x - bw / 2, y - 5, Math.max(10, bw * f), 10, 5); g.fill(); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x - bw / 2 + 4, y - 4, Math.max(2, bw * f - 8), 2);
    }
    const s = `${Math.ceil(st.hp)} / ${st.hpMax}`; g.font = '900 10.5px Pretendard, sans-serif'; g.lineWidth = 3; g.strokeStyle = 'rgba(5,6,18,.95)'; g.strokeText(s, x, y + .5); g.fillStyle = '#fff'; g.fillText(s, x, y + .5);
  }
  function arrow(x, y, col) { const a = Math.atan2(y - H / 2, x - W / 2), ex = clamp(W / 2 + Math.cos(a) * W, 26, W - 26), ey = clamp(H / 2 + Math.sin(a) * H, 130, H - 40); g.save(); g.translate(ex, ey); g.rotate(a); g.fillStyle = col; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(15, 0); g.lineTo(-8, -10); g.lineTo(-3, 0); g.lineTo(-8, 10); g.closePath(); g.fill(); g.stroke(); g.restore(); }
  function render(t, cam) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGround(cam, t);
    const list = [];
    for (const d of tall) { const x = d.x - cam.x, y = d.y - cam.y; if (x > -120 && x < W + 120 && y > -20 && y < H + 230) list.push([y, 0, d, x]); }
    if (st) {
      for (const m of st.mobs) { const x = m.x - cam.x, y = m.y + m.r * .7 - cam.y; if (x > -90 && x < W + 90 && y > -30 && y < H + 170 * m.sc) list.push([y, 1, m, x]); else m.eyes = null; }
      if (!st.dead) list.push([st.p.y + 16 - cam.y, 2, st.p, st.p.x - cam.x]);
    }
    list.sort((a, b) => a[0] - b[0]);
    for (const [y, kd, o, x] of list) { if (kd === 0) drawTall(o, x, y, t); else if (kd === 1) drawMob(o, x, y, t); else drawPlayer(x, y, t); }
    if (!reduce) for (const f of fogs) drawGlow('#9fb4d8', ((f.x + t * f.v) % 1.4 - .2) * W, f.y * H, f.r * Math.max(W, H), .07);
    drawLight(cam, t);
    drawGlows(cam, t);
    if (st) {
      drawGems(cam, t);
      for (const q of st.pots) { const x = q.x - cam.x, y = q.y - cam.y; if (x > -60 && y > -60 && x < W + 60 && y < H + 60) drawPotion(q, x, y, t); }
      if (!st.dead) drawBlades(st.p.x - cam.x, st.p.y - cam.y, t);
      drawFx(cam);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const x of st.texts) { const sc = x.t < .12 ? .6 + x.t / .12 * .4 : 1; g.globalAlpha = 1 - Math.max(0, x.t / x.life - .6) / .4; g.font = `900 ${Math.round(x.size * sc)}px Pretendard, sans-serif`; g.lineWidth = 3.5; g.strokeStyle = 'rgba(5,6,18,.9)'; g.strokeText(x.txt, x.x - cam.x, x.y - cam.y); g.fillStyle = x.col; g.fillText(x.txt, x.x - cam.x, x.y - cam.y); }
      g.globalAlpha = 1;
      if (!st.dead) drawHead(st.p.x - cam.x, st.p.y + 16 - cam.y - 92);
      for (const q of st.pots) { const x = q.x - cam.x, y = q.y - cam.y; if (x < 0 || y < 0 || x > W || y > H) arrow(x, y, POT[q.v][0]); }
      const boss = st.mobs.find(m => m.kind === 'boss');
      if (boss) {
        const x = boss.x - cam.x, y = boss.y - cam.y; if (x < 0 || y < 0 || x > W || y > H) arrow(x, y, '#ff3a3a');
        const bw = Math.min(W - 48, 360), bx = (W - bw) / 2, by = 122, f = clamp(boss.hp / boss.max, 0, 1);
        g.fillStyle = 'rgba(8,6,18,.85)'; rr(bx - 4, by - 4, bw + 8, 18, 9); g.fill(); g.strokeStyle = 'rgba(255,90,58,.7)'; g.lineWidth = 1.5; g.stroke();
        const gr = g.createLinearGradient(bx, 0, bx + bw, 0); gr.addColorStop(0, '#ff2a4a'); gr.addColorStop(1, '#ff8a2a'); g.fillStyle = gr; rr(bx, by, Math.max(8, bw * f), 10, 5); g.fill();
        g.font = '900 12px Pretendard, sans-serif'; g.lineWidth = 3; g.strokeStyle = 'rgba(5,6,18,.9)'; g.strokeText(`어둠의 기사 ${st.boss > 1 ? '+' + (st.boss - 1) : ''}`, W / 2, by - 13); g.fillStyle = '#ffd0c4'; g.fillText(`어둠의 기사 ${st.boss > 1 ? '+' + (st.boss - 1) : ''}`, W / 2, by - 13);
      }
      if (st.hurt > 0) { g.globalAlpha = .55; g.drawImage(glow('#ff1a3a'), -W * .5, -H * .5, W * 2, H * 2); g.globalAlpha = 1; g.fillStyle = 'rgba(255,20,50,.08)'; g.fillRect(0, 0, W, H); }
    }
    if (vig) g.drawImage(vig, 0, 0, W, H);
    if (joy.on && state === 'play') {
      const dx = joy.x - joy.bx, dy = joy.y - joy.by, d = Math.hypot(dx, dy), k = d > 55 ? 55 / d : 1;
      g.fillStyle = 'rgba(255,255,255,.1)'; g.strokeStyle = 'rgba(255,230,160,.55)'; g.lineWidth = 2; g.beginPath(); g.arc(joy.bx, joy.by, 55, 0, TAU); g.fill(); g.stroke();
      g.globalCompositeOperation = 'lighter'; drawGlow('#ffd27a', joy.bx + dx * k, joy.by + dy * k, 40, .35); g.globalCompositeOperation = 'source-over';
      g.fillStyle = 'rgba(255,255,255,.9)'; g.beginPath(); g.arc(joy.bx + dx * k, joy.by + dy * k, 22, 0, TAU); g.fill();
    }
  }
  function setT(id, v) { if (hudC[id] !== v) { hudC[id] = v; $('#' + id).textContent = v; } }
  function hud() {
    const max = st.lv >= S.MINI_MAXLV, w = (max ? 100 : (100 * st.xp) / need(st.lv)).toFixed(1) + '%';
    setT('mgTime', fmtT(Math.floor(st.t))); setT('mgKills', String(st.kills)); setT('mgLv', String(st.lv)); setT('mgXpT', max ? 'MAX 레벨!' : `${Math.floor(st.xp)} / ${need(st.lv)}`);
    if (hudC.w !== w) { hudC.w = w; $('#mgXp').style.width = w; }
    if (hudC.max !== max) { hudC.max = max; $('#mgHud').classList.toggle('max', max); }
  }
  function loop(ts) {
    raf = requestAnimationFrame(loop); now = ts;
    const dt = Math.min(.05, (ts - last) / 1000 || 0); last = ts;
    if (state === 'play') update(dt);
    else if (state === 'dying') { st.t += dt; stepFx(dt); if (st.t - st.dead > 1.4) showOver(); }
    const t = ts / 1000, p = st ? st.p : { x: C + Math.sin(t * .12) * 240, y: C + 40 + Math.cos(t * .09) * 200 }, tx = p.x - W / 2, ty = p.y - H / 2, kk = 1 - Math.exp(-dt * 9);
    if (!cam0) cam0 = { x: tx, y: ty }; else { cam0.x += (tx - cam0.x) * kk; cam0.y += (ty - cam0.y) * kk; }
    const sh = st && st.shake > 0 && !reduce ? st.shake : 0;
    render(t, { x: cam0.x + rnd(-sh, sh), y: cam0.y + rnd(-sh, sh) });
    if (st && (state === 'play' || state === 'level')) hud();
  }
  function die() { state = 'dying'; st.dead = st.t; SND.die(); burst(st.p.x, st.p.y, '#a8c6ff', 40, 300, 'ember'); burst(st.p.x, st.p.y, '#ff4d6d', 24, 240); st.shake = 8; }
  let ending = false;
  async function finish() { // 기록 남기기
    if (!st || ending) return null; ending = true;
    const r = await O.api('/api/mini/end', { sec: Math.floor(st.t), kills: st.kills, lv: st.lv });
    ending = false;
    if (r && !r.error) data = r;
    return r;
  }
  async function showOver() {
    state = 'over';
    const r = await finish(), s = Math.floor(st.t);
    $('#mgOverStats').innerHTML = `<div><b>${fmtT(s)}</b><span>버틴 시간</span></div><div><b>${st.kills}</b><span>처치</span></div><div><b>Lv ${st.lv}</b><span>레벨</span></div>`;
    $('#mgRecord').hidden = !(r && r.record);
    show('over');
  }

  // ---------- 화면 (처음 · 멈춤 · 끝) ----------
  function show(which) {
    for (const id of ['Lobby', 'Pause', 'Over']) $('#mg' + id).hidden = id.toLowerCase() !== which;
    $('#mgHud').hidden = !(which === null || which === 'pause');
    if (which !== null) $('#mgPick').hidden = true;
  }
  function renderLobby() {
    const U = S.MINI_UP, b = data && data.best;
    $('#mgBest').innerHTML = b && b.sec ? `<div><b>${fmtT(b.sec)}</b><span>최고 기록</span></div><div><b>${b.kills}</b><span>처치</span></div><div><b>Lv ${b.lv}</b><span>레벨</span></div>` : '<p>아직 기록이 없어요. 첫 판을 시작해 봐요!</p>';
    $('#mgGuide').innerHTML = Object.keys(U).map(k => `<div class="mg-gd"><span class="mg-up-ic mg-${k}"></span><b>${U[k].name}</b><span class="gd-v">${U[k].vals.map((v, i) => `<i class="r${i + 1}">${U[k].fmt(v)}</i>`).join('')}</span></div>`).join('');
  }
  function pauseStats() {
    const u = st.up;
    $('#mgNow').innerHTML = [['검 크기', `${(1 + u.size).toFixed(2)}×`], ['회전 속도', `${(1 + u.spin).toFixed(2)}×`], ['검', `${st.swords}개`], ['최대 체력', st.hpMax], ['괴물 접근', `−${Math.round(u.slow * 100)}%`], ['레벨', `Lv ${st.lv}`]].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  }
  function start() { newRun(); state = 'play'; show(null); last = performance.now(); }
  function pause() { if (state !== 'play') return; state = 'pause'; joy.on = false; pauseStats(); show('pause'); }
  function resume() { if (state !== 'pause') return; state = 'play'; show(null); last = performance.now(); }
  async function quitRun() { state = 'over'; await finish(); st = null; renderLobby(); show('lobby'); state = 'lobby'; }
  function close() {
    if (st && (state === 'play' || state === 'pause' || state === 'level')) finish();
    state = 'lobby'; st = null; cancelAnimationFrame(raf); raf = 0; cam0 = null;
    $('#miniGame').hidden = true; removeEventListener('resize', fit); document.removeEventListener('visibilitychange', onVis);
  }
  const onVis = () => { if (document.hidden) pause(); };
  function fit() {
    const r = cv.getBoundingClientRect(); dpr = Math.min(window.devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    lc = lc || document.createElement('canvas'); lc.width = Math.ceil(W / 2); lc.height = Math.ceil(H / 2); lg = lc.getContext('2d');
    vig = mkCanvas(W, H); const v = vig.getContext('2d'), gr = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .38, W / 2, H / 2, Math.max(W, H) * .78); gr.addColorStop(0, 'rgba(2,3,12,0)'); gr.addColorStop(1, 'rgba(2,3,12,.6)'); v.fillStyle = gr; v.fillRect(0, 0, W, H);
  }
  let wired = false;
  function wire() {
    if (wired) return; wired = true;
    cv = $('#mgCv'); g = cv.getContext('2d');
    addEventListener('keydown', e => {
      if ($('#miniGame').hidden) return;
      const k = e.key.toLowerCase(); keys[k] = true;
      if (state === 'level' && /^[123]$/.test(k)) choose(+k - 1);
      if (k === 'escape' || k === 'p') { if (state === 'play') pause(); else if (state === 'pause') resume(); }
      if (/^arrow/.test(k) || k === ' ') e.preventDefault();
    });
    addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
    addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
    cv.addEventListener('pointerdown', e => { if (state !== 'play') return; const r = cv.getBoundingClientRect(); joy.on = true; joy.id = e.pointerId; joy.bx = joy.x = e.clientX - r.left; joy.by = joy.y = e.clientY - r.top; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => { if (!joy.on || e.pointerId !== joy.id) return; const r = cv.getBoundingClientRect(); joy.x = e.clientX - r.left; joy.y = e.clientY - r.top; });
    const up = e => { if (e.pointerId === joy.id) joy.on = false; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    $('#mgStart').onclick = start; $('#mgAgain').onclick = start;
    $('#mgCards').onclick = e => { const b = e.target.closest('.mg-cu'); if (b) choose(+b.dataset.i); };
    $('#mgPauseBtn').onclick = pause; $('#mgResume').onclick = resume; $('#mgQuit').onclick = quitRun;
    $('#mgToLobby').onclick = () => { st = null; state = 'lobby'; renderLobby(); show('lobby'); };
    $$('.mg-x').forEach(b => { b.onclick = close; });
  }
  async function open(opts) {
    O = opts; S = opts.S; wire();
    $('#miniGame').hidden = false; fit(); makeWorld();
    glowFlat = flat.filter(d => d.kind === 'shroom' || d.kind === 'flower'); torches = tall.filter(d => d.kind === 'torch');
    addEventListener('resize', fit); document.addEventListener('visibilitychange', onVis);
    st = null; state = 'lobby'; data = null; renderLobby(); show('lobby');
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    const r = await O.api('/api/mini');
    if (r.error) { O.toast(r.error, 'err'); return close(); }
    data = r; renderLobby();
  }
  window.MLEMini = { open, close, _state: () => ({ state, st, data }) };
})();
