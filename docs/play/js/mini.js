/* 매뜨 땅먹 — 미니게임 '검의 회오리' (숲 스타일)
 * 내 둘레를 도는 검으로 괴물을 물리치면 포인트 보석이 떨어진다. 보석을 모아 포인트 게이지가 차면 레벨 업(최대 50) → 무작위 업그레이드 3장 중 하나를 고른다.
 * 카드 색: 별 1 흰색 · 별 2 파랑 · 별 3 빨강. 업그레이드: 검 크기 · 검 회전 속도 · 검 추가 · 체력 · 괴물 접근 (한 판 안에서 쌓인다).
 * 괴물은 일반 괴물(뼈 전사 · 박쥐 · 망령)만 나온다. 맵에는 체력 포션이 최대 3개 (20초마다 1~2개). 머리 위에 닉네임 · 체력 막대 · 체력 숫자.
 * app.js 가 쓰는 것: MLEMini.open({ api, toast, nick, S }) */
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
  const WORLD = 3600, C = WORLD / 2, TAU = Math.PI * 2;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a), clamp = (x, a, b) => Math.max(a, Math.min(b, x)), pick = a => a[Math.floor(Math.random() * a.length)];
  const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const hexA = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
  let O = null, S = null, cv, g, vig = null, W = 0, H = 0, dpr = 1, raf = 0, last = 0, now = 0;
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
    die() { tone(320, .9, 'sawtooth', .05, .15); },
  };

  // ---------- 미리 그려 두는 그림 (매 프레임 그레이디언트를 새로 만들지 않게) ----------
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

  // ---------- 숲 맵 (그림처럼: 나무 · 덤불 · 고사리 · 쓰러진 통나무 · 그루터기 · 바위 · 흙길) ----------
  let groundPat = null, flat = [], tall = [], paths = [], SPR = null, motes = [];
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mixC = (a, b, t) => { const p = rgb(a), q = rgb(b); return `rgb(${p.map((v, i) => Math.round(v + (q[i] - v) * t)).join(',')})`; };
  function blob(x, cx, cy, r, c0, c1) { const gr = x.createRadialGradient(cx - r * .35, cy - r * .4, r * .1, cx, cy, r); gr.addColorStop(0, c0); gr.addColorStop(1, c1); x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, r, 0, TAU); x.fill(); }
  function leaves(x, cx, cy, rx, ry, n, pal) { // 잎 덩어리를 겹겹이: 뒤 · 아래는 어둡게, 위 왼쪽은 햇빛
    const pts = [];
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, d = Math.sqrt(Math.random()); pts.push([cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, rnd(.2, .33) * rx]); }
    const lit = ([px, py]) => clamp(.55 - (px - cx) / rx * .32 - (py - cy) / ry * .45, 0, 1);
    pts.sort((a, b) => lit(a) - lit(b));
    for (const p of pts) { const L = lit(p); blob(x, p[0], p[1], p[2], mixC(pal[1], pal[2], L), mixC(pal[0], pal[1], L * .8)); }
    for (let i = 0; i < n * 5; i++) { // 잎 한 장 한 장
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()), px = cx + Math.cos(a) * rx * d, py = cy + Math.sin(a) * ry * d, L = lit([px, py]);
      x.fillStyle = L > .55 ? hexA(pal[3], .55) : hexA(pal[0], .35); x.beginPath(); x.ellipse(px, py, rnd(1.6, 3), rnd(.9, 1.5), rnd(0, 3), 0, TAU); x.fill();
    }
  }
  function bark(x, x0, x1, y0, y1) { // 나무껍질 결
    for (let i = 0; i < 9; i++) { const bx = rnd(x0, x1); x.strokeStyle = i % 3 ? 'rgba(25,15,8,.45)' : 'rgba(170,130,90,.35)'; x.lineWidth = rnd(.6, 1.4); x.beginPath(); x.moveTo(bx, y1); for (let y = y1; y > y0; y -= 8) x.lineTo(bx + rnd(-1.2, 1.2), y); x.stroke(); }
  }
  function makeSprites() {
    const OAK = ['#13311a', '#2c652c', '#6eae4a', '#b5df7c'], BIRCH = ['#1f4a1f', '#4c8a34', '#93c95c', '#d4ef9a'], PINE = ['#0f2e22', '#245c42', '#4f8c5e', '#8cc48a'], BUSH = ['#173d1c', '#357a33', '#76b552', '#bfe48a'];
    const oak = () => Object.assign(sprite(170, 220, (x, w) => {
      const cx = w / 2, by = 210;
      let gr = x.createLinearGradient(cx - 16, 0, cx + 16, 0); gr.addColorStop(0, '#8a6644'); gr.addColorStop(.5, '#5a3e27'); gr.addColorStop(1, '#2c1d11'); x.fillStyle = gr;
      x.beginPath(); x.moveTo(cx - 30, by + 2); x.quadraticCurveTo(cx - 14, by - 6, cx - 11, by - 40); x.lineTo(cx - 9, by - 92); x.quadraticCurveTo(cx - 30, by - 120, cx - 44, by - 128); x.lineTo(cx - 36, by - 132); x.quadraticCurveTo(cx - 14, by - 118, cx - 2, by - 104);
      x.quadraticCurveTo(cx + 18, by - 124, cx + 36, by - 132); x.lineTo(cx + 42, by - 126); x.quadraticCurveTo(cx + 20, by - 112, cx + 10, by - 90); x.lineTo(cx + 12, by - 40); x.quadraticCurveTo(cx + 15, by - 6, cx + 32, by + 2); x.closePath(); x.fill();
      bark(x, cx - 10, cx + 10, by - 92, by - 4);
      x.fillStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.ellipse(cx + 4, by - 96, 14, 5, 0, 0, TAU); x.fill(); // 잎 그늘
      leaves(x, cx, by - 140, 76, 56, 44, OAK); leaves(x, cx - 10, by - 172, 44, 28, 18, OAK);
    }), { ay: 210 / 220 });
    const birch = () => Object.assign(sprite(130, 220, (x, w) => {
      const cx = w / 2, by = 210;
      const gr = x.createLinearGradient(cx - 7, 0, cx + 7, 0); gr.addColorStop(0, '#f4f1ea'); gr.addColorStop(.6, '#d9d3c6'); gr.addColorStop(1, '#9d968a'); x.fillStyle = gr;
      x.beginPath(); x.moveTo(cx - 9, by + 1); x.lineTo(cx - 5, by - 130); x.lineTo(cx + 5, by - 130); x.lineTo(cx + 9, by + 1); x.closePath(); x.fill();
      x.fillStyle = '#2b2620'; for (let y = by - 8; y > by - 126; y -= rnd(9, 15)) { const sw = rnd(3, 7); x.fillRect(cx - 6 + rnd(0, 6), y, sw, rnd(1.2, 2.2)); }
      x.strokeStyle = '#cfc8ba'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx, by - 100); x.lineTo(cx - 22, by - 134); x.moveTo(cx + 1, by - 112); x.lineTo(cx + 20, by - 140); x.stroke();
      leaves(x, cx, by - 150, 50, 44, 30, BIRCH);
    }), { ay: 210 / 220 });
    const pine = () => Object.assign(sprite(120, 230, (x, w) => {
      const cx = w / 2, by = 220;
      x.fillStyle = '#4a321e'; x.fillRect(cx - 5, by - 34, 10, 34);
      for (let i = 0; i < 7; i++) {
        const y0 = by - 26 - i * 25, hw = 52 - i * 6.5, gr = x.createLinearGradient(cx - hw, 0, cx + hw, 0); gr.addColorStop(0, PINE[2]); gr.addColorStop(.45, PINE[1]); gr.addColorStop(1, PINE[0]);
        x.fillStyle = gr; x.beginPath(); x.moveTo(cx, y0 - 44);
        for (let k = 0; k <= 8; k++) { const t = k / 8, px = cx + hw - t * hw * 2; x.lineTo(px, y0 + (k % 2 ? -5 : 2) + Math.sin(t * Math.PI) * 6); }
        x.closePath(); x.fill();
        x.strokeStyle = hexA(PINE[3], .35); x.lineWidth = 1; for (let k = 0; k < 14; k++) { const px = cx - rnd(0, hw * .9), py = y0 - rnd(0, 36); x.beginPath(); x.moveTo(px, py); x.lineTo(px - 4, py + 3); x.stroke(); }
      }
    }), { ay: 220 / 230 });
    const bush = () => Object.assign(sprite(80, 56, (x, w) => { leaves(x, w / 2, 34, 34, 20, 16, BUSH); }), { ay: 52 / 56 });
    const fern = () => Object.assign(sprite(60, 40, (x, w) => {
      const cx = w / 2, by = 38;
      for (let i = 0; i < 8; i++) {
        const a = -Math.PI / 2 + (i - 3.5) * .36, L = rnd(18, 26), ex = cx + Math.cos(a) * L, ey = by + Math.sin(a) * L * .8, mx = cx + Math.cos(a) * L * .5, my = by + Math.sin(a) * L * .55 - 4;
        x.strokeStyle = '#3d7a2e'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(cx, by); x.quadraticCurveTo(mx, my, ex, ey); x.stroke();
        for (let k = 1; k < 9; k++) { const t = k / 9, px = (1 - t) * (1 - t) * cx + 2 * (1 - t) * t * mx + t * t * ex, py = (1 - t) * (1 - t) * by + 2 * (1 - t) * t * my + t * t * ey, s = (1 - t) * 4 + 1; x.fillStyle = k % 2 ? '#5c9e3e' : '#4a8a34'; x.beginPath(); x.ellipse(px - s * .6, py - s * .3, s, s * .38, a + 1, 0, TAU); x.ellipse(px + s * .6, py + s * .2, s, s * .38, a - 1, 0, TAU); x.fill(); }
      }
    }), { ay: 38 / 40 });
    const log = () => Object.assign(sprite(120, 46, (x) => {
      const y0 = 14, h = 22;
      let gr = x.createLinearGradient(0, y0, 0, y0 + h); gr.addColorStop(0, '#9a7650'); gr.addColorStop(.45, '#6b4a2c'); gr.addColorStop(1, '#3a2614'); x.fillStyle = gr;
      x.beginPath(); x.moveTo(10, y0); x.lineTo(104, y0); x.lineTo(104, y0 + h); x.lineTo(10, y0 + h); x.ellipse(10, y0 + h / 2, 6, h / 2, 0, Math.PI / 2, -Math.PI / 2); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(30,18,8,.5)'; x.lineWidth = 1; for (let i = 0; i < 6; i++) { const yy = y0 + 3 + i * 3.4; x.beginPath(); x.moveTo(12, yy); for (let xx = 12; xx < 102; xx += 10) x.lineTo(xx, yy + rnd(-.8, .8)); x.stroke(); }
      gr = x.createRadialGradient(104, y0 + h / 2, 1, 104, y0 + h / 2, h / 2); gr.addColorStop(0, '#d9b884'); gr.addColorStop(1, '#a8834f'); x.fillStyle = gr; x.beginPath(); x.ellipse(104, y0 + h / 2, 6.5, h / 2, 0, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(110,75,40,.6)'; x.lineWidth = .8; for (let r = 2; r < h / 2; r += 2.4) { x.beginPath(); x.ellipse(104, y0 + h / 2, r * .58, r, 0, 0, TAU); x.stroke(); }
      for (let i = 0; i < 7; i++) blob(x, rnd(18, 92), y0 + rnd(0, 3), rnd(4, 8), '#8fc45a', '#3f7a2e');
    }), { ay: 40 / 46 });
    const stump = () => Object.assign(sprite(60, 50, (x, w) => {
      const cx = w / 2, by = 44;
      let gr = x.createLinearGradient(cx - 16, 0, cx + 16, 0); gr.addColorStop(0, '#8a6644'); gr.addColorStop(1, '#3a2716'); x.fillStyle = gr;
      x.beginPath(); x.moveTo(cx - 22, by); x.quadraticCurveTo(cx - 15, by - 4, cx - 15, by - 22); x.lineTo(cx + 15, by - 22); x.quadraticCurveTo(cx + 15, by - 4, cx + 22, by); x.closePath(); x.fill();
      bark(x, cx - 13, cx + 13, by - 22, by - 2);
      gr = x.createRadialGradient(cx - 3, by - 24, 1, cx, by - 22, 15); gr.addColorStop(0, '#e2c393'); gr.addColorStop(1, '#a8834f'); x.fillStyle = gr; x.beginPath(); x.ellipse(cx, by - 22, 15, 6, 0, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(110,75,40,.55)'; x.lineWidth = .8; for (let r = 3; r < 15; r += 3) { x.beginPath(); x.ellipse(cx, by - 22, r, r * .4, 0, 0, TAU); x.stroke(); }
      blob(x, cx - 12, by - 8, 6, '#8fc45a', '#3f7a2e');
    }), { ay: 44 / 50 });
    const rock = () => Object.assign(sprite(70, 50, (x, w) => {
      const cx = w / 2, by = 44, pts = [[-30, 0], [-27, -18], [-12, -32], [8, -34], [26, -20], [31, 0]].map(([a, b]) => [cx + a + rnd(-3, 3), by + b + rnd(-3, 3)]);
      const gr = x.createLinearGradient(0, by - 34, 0, by); gr.addColorStop(0, '#a3a7a8'); gr.addColorStop(1, '#4b4f52'); x.fillStyle = gr; x.beginPath(); pts.forEach(([a, b], k) => (k ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); x.fill();
      x.fillStyle = 'rgba(255,255,255,.18)'; x.beginPath(); x.moveTo(pts[1][0] + 4, pts[1][1] + 2); x.lineTo(pts[2][0], pts[2][1] + 3); x.lineTo(pts[3][0], pts[3][1] + 4); x.lineTo(cx, by - 18); x.closePath(); x.fill();
      for (let i = 0; i < 5; i++) blob(x, cx + rnd(-14, 8), by - rnd(26, 32), rnd(3, 6), '#9ccf62', '#4a8a34');
      x.strokeStyle = 'rgba(0,0,0,.3)'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(cx + 6, by - 28); x.lineTo(cx + 2, by - 16); x.lineTo(cx + 8, by - 6); x.stroke();
    }), { ay: 44 / 50 });
    SPR = { oak: [oak(), oak(), oak()], birch: [birch(), birch()], pine: [pine(), pine()], bush: [bush(), bush(), bush()], fern: [fern(), fern()], log: [log()], stump: [stump()], rock: [rock(), rock()] };
    makeHero();
  }
  function makeGround() { // 숲 바닥: 풀 · 이끼 · 낙엽 · 잔가지
    const N = 512, c = mkCanvas(N, N), x = c.getContext('2d');
    x.fillStyle = '#4c7533'; x.fillRect(0, 0, N, N);
    for (let k = 0; k < 50; k++) {
      const px = rnd(0, N), py = rnd(0, N), r = rnd(30, 100), col = pick(['rgba(95,140,60,.3)', 'rgba(40,75,30,.3)', 'rgba(120,95,55,.22)', 'rgba(70,110,45,.25)']);
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { const gr = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(px + ox - r, py + oy - r, r * 2, r * 2); }
    }
    for (let k = 0; k < 2200; k++) { const px = rnd(3, N - 3), py = rnd(10, N - 2), h = rnd(4, 11), lean = rnd(-3, 3); x.strokeStyle = pick(['#3f6a2a', '#4f8034', '#5f9440', '#36602a', '#71a64a', '#2f5524']); x.lineWidth = rnd(.9, 1.6); x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + lean * .3, py - h * .6, px + lean, py - h); x.stroke(); }
    for (let k = 0; k < 150; k++) { x.fillStyle = pick(['#a0662a', '#c08a3a', '#7a4a20', '#b3953f', '#8a5a2a']); x.globalAlpha = .75; x.beginPath(); x.ellipse(rnd(4, N - 4), rnd(4, N - 4), rnd(2, 3.6), rnd(1, 1.8), rnd(0, 3), 0, TAU); x.fill(); }
    x.globalAlpha = 1; x.strokeStyle = 'rgba(80,55,30,.55)'; x.lineWidth = 1; for (let k = 0; k < 25; k++) { const px = rnd(10, N - 10), py = rnd(10, N - 10), a = rnd(0, 3); x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9); x.lineTo(px + Math.cos(a) * 9 + 3, py + Math.sin(a) * 9 - 2); x.stroke(); }
    groundPat = g.createPattern(c, 'repeat');
  }
  function makeWorld() {
    if (!SPR) makeSprites();
    makeGround(); flat = []; tall = []; paths = []; motes = [];
    for (let k = 0; k < 3; k++) { // 숲을 가로지르는 흙길 (가운데 빈터를 지나간다)
      const a = k * Math.PI / 3 + rnd(-.2, .2), pts = [];
      for (let r = -WORLD * .72; r <= WORLD * .72; r += 50) { const w = Math.sin(r / 190 + k * 2) * 80; pts.push([C + Math.cos(a) * r - Math.sin(a) * w, C + Math.sin(a) * r + Math.cos(a) * w]); }
      paths.push(pts.filter(([x, y]) => x > -80 && y > -80 && x < WORLD + 80 && y < WORLD + 80));
    }
    const nearPath = (x, y, r) => paths.some(p => p.some(([a, b]) => Math.abs(a - x) < r && Math.abs(b - y) < r && Math.hypot(a - x, b - y) < r));
    const trees = [], okTree = (x, y, r) => trees.every(([a, b]) => Math.hypot(a - x, b - y) > r);
    const plant = (n, minR, gap, edge) => { for (let k = 0, tries = 0; k < n && tries < n * 8; tries++) {
      let x = rnd(40, WORLD - 40), y = rnd(40, WORLD - 40);
      if (edge) { const s = Math.floor(Math.random() * 4), e = rnd(20, 170); x = s === 0 ? e : s === 1 ? WORLD - e : x; y = s === 2 ? e : s === 3 ? WORLD - e : y; }
      if (Math.hypot(x - C, y - C) < minR || nearPath(x, y, 70) || !okTree(x, y, gap)) continue;
      trees.push([x, y]); tall.push({ kind: pick(['oak', 'oak', 'pine', 'birch']), x, y, s: rnd(.85, 1.15), h: Math.random(), v: Math.floor(Math.random() * 3) }); k++;
    } };
    plant(330, 340, 90, false); plant(160, 0, 70, true); // 숲 · 맵 가장자리는 빽빽하게
    const put = (kind, n, minR, s0, s1, list, avoid) => { for (let k = 0; k < n; k++) { const x = rnd(50, WORLD - 50), y = rnd(50, WORLD - 50); if (Math.hypot(x - C, y - C) > minR && !(avoid && nearPath(x, y, 45))) list.push({ kind, x, y, s: rnd(s0, s1), h: Math.random(), v: Math.floor(Math.random() * 3) }); } };
    put('bush', 170, 300, .8, 1.2, tall, true); put('rock', 60, 300, .6, 1.1, tall, true); put('log', 26, 360, .8, 1.1, tall, true); put('stump', 34, 320, .8, 1.1, tall, true);
    put('fern', 260, 260, .8, 1.2, flat, true); put('tuft', 900, 0, 6, 12, flat); put('flower', 420, 0, 2.2, 3.6, flat); put('shroom', 70, 260, 5, 8, flat, true); put('pebble', 160, 0, 2, 4, flat);
    for (let k = 0; k < 14; k++) motes.push({ x: Math.random(), y: Math.random(), p: Math.random() * TAU, s: rnd(.6, 1.2), c: pick(['#c98a3a', '#d9a640', '#a8642a', '#8fae3f']) });
  }
  const FLOWER = ['#ffffff', '#ffe066', '#c9a6ff', '#ff9ec4'];
  function drawGround(cam, t) {
    g.save(); g.translate(-cam.x, -cam.y);
    g.fillStyle = groundPat; g.fillRect(cam.x, cam.y, W, H);
    g.lineCap = g.lineJoin = 'round';
    for (const [w, c] of [[66, 'rgba(60,45,25,.35)'], [54, '#7d6142'], [40, '#957452'], [14, 'rgba(255,235,200,.08)']]) { g.strokeStyle = c; g.lineWidth = w; for (const p of paths) { g.beginPath(); p.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); } }
    g.restore();
    g.fillStyle = '#1c3a1b'; // 맵 끝: 빽빽한 숲
    if (cam.x < 0) g.fillRect(0, 0, -cam.x, H);
    if (cam.y < 0) g.fillRect(0, 0, W, -cam.y);
    if (cam.x + W > WORLD) g.fillRect(WORLD - cam.x, 0, cam.x + W - WORLD, H);
    if (cam.y + H > WORLD) g.fillRect(0, WORLD - cam.y, W, cam.y + H - WORLD);
    for (const d of flat) {
      const x = d.x - cam.x, y = d.y - cam.y;
      if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
      if (d.kind === 'tuft') { const sw = Math.sin(t * 1.6 + d.h * 9) * 2; g.strokeStyle = d.h < .5 ? '#5f9a40' : '#4a8434'; g.lineWidth = 1.6; g.beginPath(); for (const o of [-4, -2, 0, 2, 4]) { g.moveTo(x + o, y); g.quadraticCurveTo(x + o * 1.3, y - d.s * .6, x + o * 1.8 + sw, y - d.s * (1 - Math.abs(o) * .06)); } g.stroke(); }
      else if (d.kind === 'flower') { g.strokeStyle = '#3f7a2e'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x, y); g.stroke(); g.fillStyle = FLOWER[Math.floor(d.h * 4)]; for (let k = 0; k < 5; k++) { const a = k * TAU / 5 + d.h; g.beginPath(); g.arc(x + Math.cos(a) * d.s * .7, y + Math.sin(a) * d.s * .7, d.s * .5, 0, TAU); g.fill(); } g.fillStyle = '#e8a020'; g.beginPath(); g.arc(x, y, d.s * .38, 0, TAU); g.fill(); }
      else if (d.kind === 'pebble') { g.fillStyle = '#8c8f8a'; g.beginPath(); g.ellipse(x, y, d.s, d.s * .65, d.h * 3, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.2)'; g.beginPath(); g.ellipse(x - .5, y - .8, d.s * .5, d.s * .25, 0, 0, TAU); g.fill(); }
      else if (d.kind === 'shroom') { g.fillStyle = '#efe6d2'; g.fillRect(x - 1.4, y - d.s * .7, 2.8, d.s * .7); g.fillRect(x + 5, y - d.s * .45, 2.2, d.s * .45); g.fillStyle = d.h < .5 ? '#c83a2a' : '#9a6a3a'; g.beginPath(); g.ellipse(x, y - d.s * .7, d.s * .62, d.s * .4, 0, Math.PI, 0); g.fill(); g.beginPath(); g.ellipse(x + 6, y - d.s * .45, d.s * .4, d.s * .26, 0, Math.PI, 0); g.fill(); if (d.h < .5) { g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 1.5, y - d.s * .85, .9, 0, TAU); g.arc(x + 1.6, y - d.s * .78, .7, 0, TAU); g.fill(); } }
      else if (d.kind === 'fern') { const sp = SPR.fern[d.v % 2]; blit(sp, x, y, d.s, .5, sp.ay); }
    }
    for (const d of tall) { // 나무 그늘 (땅에 드리운 잎 그림자)
      if (d.kind !== 'oak' && d.kind !== 'pine' && d.kind !== 'birch') continue;
      const x = d.x - cam.x + 26 * d.s, y = d.y - cam.y - 14 * d.s; if (x < -120 || y < -80 || x > W + 120 || y > H + 80) continue;
      g.globalAlpha = .26; g.drawImage(glow('#0a1f0c'), x - 95 * d.s, y - 52 * d.s, 190 * d.s, 104 * d.s); g.globalAlpha = 1;
    }
  }
  function drawTall(d, x, y, t) { // y = 발 자리 (화면 좌표)
    const sp = SPR[d.kind][d.v % SPR[d.kind].length], sc = d.s;
    g.fillStyle = 'rgba(10,25,10,.3)'; g.beginPath(); g.ellipse(x + 3, y, sp.w * sc * (d.kind === 'log' ? .45 : .2), sp.w * sc * .07, 0, 0, TAU); g.fill();
    if (d.kind === 'oak' || d.kind === 'pine' || d.kind === 'birch') { // 바람에 살랑 + 내가 나무 뒤에 있으면 반투명
      const sw = Math.sin(t * 1.1 + d.h * 9) * .02, near = st && Math.abs(st.p.x - d.x) < 60 * sc && st.p.y < d.y && st.p.y > d.y - 190 * sc;
      g.save(); g.translate(x, y); g.transform(1, 0, sw, 1, 0, 0); if (near) g.globalAlpha = .42; blit(sp, 0, 0, sc, .5, sp.ay); g.restore(); return;
    }
    blit(sp, x, y, sc, .5, sp.ay);
  }
  function drawAtmos(t) { // 숲 공기: 나뭇잎 사이 햇살 · 떨어지는 잎
    if (reduce) return;
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const bx = ((i * .37 + t * .006) % 1.3 - .15) * W, gr = g.createLinearGradient(bx, 0, bx - H * .45, H);
      gr.addColorStop(0, 'rgba(255,240,190,.10)'); gr.addColorStop(1, 'rgba(255,240,190,0)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(bx - 30, 0); g.lineTo(bx + 30 + i * 10, 0); g.lineTo(bx - H * .45 + 70, H); g.lineTo(bx - H * .45 - 40, H); g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    for (const m of motes) {
      const x = ((m.x + t * .02 * m.s) % 1.1 - .05) * W + Math.sin(t * 1.3 + m.p) * 20, y = ((m.y + t * .035 * m.s) % 1.1 - .05) * H;
      g.save(); g.translate(x, y); g.rotate(t * 2 * m.s + m.p); g.scale(1, Math.abs(Math.sin(t * 2.5 + m.p)) * .8 + .2); g.fillStyle = m.c; g.beginPath(); g.ellipse(0, 0, 4.5, 2.2, 0, 0, TAU); g.fill(); g.restore();
    }
  }
  // ---------- 괴물 (일반 괴물: 뼈 전사 · 그림자 박쥐 · 망령) ----------
  const KIND = {
    skel: { hp: 40, sp: 70, r: 15, dmg: 60, pts: 1, ht: 44, col: '#e3dccb', eye: '#ff6a3d' },
    bat: { hp: 26, sp: 128, r: 12, dmg: 45, pts: 2, ht: 42, col: '#9b5cf0', eye: '#ff3b5c' },
    ghost: { hp: 60, sp: 92, r: 16, dmg: 55, pts: 3, ht: 54, col: '#bcd0ff', eye: '#7ff9ff' },
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
  const DRAW = { skel: drawSkel, bat: drawBat, ghost: drawGhost };
  function drawMob(m, x, y, t) { // x, y = 발 자리
    const k = KIND[m.kind], grow = m.born < .45 ? .3 + m.born / .45 * .7 : 1, sc = m.sc * grow;
    g.fillStyle = m.kind === 'bat' || m.kind === 'ghost' ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,.34)'; g.beginPath(); g.ellipse(x, y, k.r * m.sc * .95, k.r * m.sc * .34, 0, 0, TAU); g.fill();
    g.save(); g.translate(x, y); g.scale(m.face * sc, sc); g.globalAlpha = m.born < .45 ? m.born / .45 : 1;
    g.lineCap = g.lineJoin = 'round'; DRAW[m.kind](m, t);
    g.restore(); g.globalAlpha = 1;
    if (m.hp < m.max) { const w = Math.max(24, k.r * 1.8 * m.sc), top = y - k.ht * m.sc - 8, f = clamp(m.hp / m.max, 0, 1); g.fillStyle = 'rgba(5,6,15,.7)'; g.fillRect(x - w / 2 - 1, top - 1, w + 2, 5); g.fillStyle = f > .5 ? '#ffd54a' : '#ff6b5a'; g.fillRect(x - w / 2, top, w * f, 3); }
  }

  // ---------- 나: 검사 (그림처럼 · 사람 비율). 앞 · 뒤 · 옆 모습과 걷기/숨쉬기 동작을 미리 높은 해상도로 그려 둔다 ----------
  const PF = 12, PW = 70, PH = 100, PAX = 35, PAY = 96, PS = 1.05; // 걷기 장 수 · 한 장 크기 · 발 자리 · 화면 배율
  const SK = ['#f7d6bb', '#e2aa85', '#b5735a'], HR = ['#7a5232', '#43291a', '#1e120a'], TU = ['#5d86c8', '#2f5694', '#18305c'], LE = ['#b98450', '#7c4f2b', '#40260f'],
    TRS = ['#6f6353', '#4a4036', '#26201a'], BO = ['#90623c', '#5a3a22', '#2a1a0d'], CL = ['#4f8a5a', '#2c5a36', '#14301b'], MT = ['#f1f4f9', '#a9b3c4', '#57627a'];
  const dim = pal => pal.map(c => mixC(c, '#000000', .3));
  let HERO = null; // HERO[dir][frame] dir 0 앞 · 1 뒤 · 2 옆(오른쪽)
  function seg(x, x1, y1, x2, y2, w1, w2, pal) { // 둥근 원통 모양 팔다리 (빛은 왼쪽 위)
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, an = Math.atan2(ny, nx);
    const gr = x.createLinearGradient(x1 + nx * w1 / 2, y1 + ny * w1 / 2, x1 - nx * w1 / 2, y1 - ny * w1 / 2); gr.addColorStop(0, pal[0]); gr.addColorStop(.45, pal[1]); gr.addColorStop(1, pal[2]);
    x.fillStyle = gr; x.beginPath(); x.moveTo(x1 + nx * w1 / 2, y1 + ny * w1 / 2); x.lineTo(x2 + nx * w2 / 2, y2 + ny * w2 / 2);
    x.arc(x2, y2, w2 / 2, an, an + Math.PI, true); x.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2); x.arc(x1, y1, w1 / 2, an + Math.PI, an, true); x.closePath(); x.fill();
  }
  const hgrad = (x, x0, x1, pal) => { const gr = x.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, pal[0]); gr.addColorStop(.5, pal[1]); gr.addColorStop(1, pal[2]); return gr; };
  const vgrad = (x, y0, y1, pal) => { const gr = x.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, pal[0]); gr.addColorStop(.5, pal[1]); gr.addColorStop(1, pal[2]); return gr; };
  function eye(x, ex, ey, s = 1) {
    x.fillStyle = '#fbf7f0'; x.beginPath(); x.ellipse(ex, ey, 1.35 * s, .85 * s, 0, 0, TAU); x.fill();
    x.fillStyle = '#5a3a22'; x.beginPath(); x.arc(ex + .15 * s, ey + .05, .78 * s, 0, TAU); x.fill();
    x.fillStyle = '#120a05'; x.beginPath(); x.arc(ex + .15 * s, ey + .05, .38 * s, 0, TAU); x.fill();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(ex + .4 * s, ey - .25, .22 * s, 0, TAU); x.fill();
    x.strokeStyle = '#3a2418'; x.lineWidth = .55; x.beginPath(); x.ellipse(ex, ey + .1, 1.45 * s, .95 * s, 0, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
  }
  function headFront(x, cx, cy) {
    x.fillStyle = SK[1]; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * 6.3, cy + .6, 1.5, 2.5, 0, 0, TAU); x.fill(); }
    let gr = x.createRadialGradient(cx - 2, cy - 3, 1, cx, cy, 8.5); gr.addColorStop(0, SK[0]); gr.addColorStop(.7, SK[1]); gr.addColorStop(1, SK[2]); x.fillStyle = gr;
    x.beginPath(); x.moveTo(cx - 6.2, cy - 2); x.bezierCurveTo(cx - 6.4, cy + 3.5, cx - 3.4, cy + 7.6, cx, cy + 7.8); x.bezierCurveTo(cx + 3.4, cy + 7.6, cx + 6.4, cy + 3.5, cx + 6.2, cy - 2); x.bezierCurveTo(cx + 6, cy - 9, cx - 6, cy - 9, cx - 6.2, cy - 2); x.fill();
    x.fillStyle = 'rgba(232,130,110,.22)'; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * 3.7, cy + 3, 1.8, 1.1, 0, 0, TAU); x.fill(); }
    eye(x, cx - 2.45, cy + .3); eye(x, cx + 2.45, cy + .3);
    x.strokeStyle = HR[2]; x.lineWidth = .95; x.lineCap = 'round'; x.beginPath(); x.moveTo(cx - 3.8, cy - 1.5); x.quadraticCurveTo(cx - 2.6, cy - 2.3, cx - 1.2, cy - 1.8); x.moveTo(cx + 1.2, cy - 1.8); x.quadraticCurveTo(cx + 2.6, cy - 2.3, cx + 3.8, cy - 1.5); x.stroke();
    x.strokeStyle = 'rgba(150,90,65,.7)'; x.lineWidth = .7; x.beginPath(); x.moveTo(cx + .4, cy + .8); x.quadraticCurveTo(cx + 1.2, cy + 3.2, cx - .2, cy + 3.6); x.stroke();
    x.strokeStyle = '#a2584a'; x.lineWidth = .8; x.beginPath(); x.moveTo(cx - 1.7, cy + 5.2); x.quadraticCurveTo(cx, cy + 5.9, cx + 1.7, cy + 5.2); x.stroke();
    gr = vgrad(x, cy - 11, cy + 2, HR); x.fillStyle = gr; // 머리카락 (앞머리)
    x.beginPath(); x.moveTo(cx - 6.9, cy + 2); x.bezierCurveTo(cx - 8, cy - 8, cx - 3, cy - 11, cx + 1, cy - 10.6); x.bezierCurveTo(cx + 6.4, cy - 10.2, cx + 8.2, cy - 5, cx + 6.9, cy + 2);
    for (const [px, py] of [[6.1, -1.8], [4.8, -4.4], [3.4, -2.6], [1.6, -4.9], [0, -3], [-1.8, -5], [-3.4, -2.9], [-5, -4.4], [-6.2, -1.6]]) x.lineTo(cx + px, cy + py);
    x.closePath(); x.fill();
    x.strokeStyle = hexA(HR[0], .9); x.lineWidth = .7; for (const o of [-4, -1.5, 1.5]) { x.beginPath(); x.moveTo(cx + o, cy - 9.6); x.quadraticCurveTo(cx + o - 1.6, cy - 7, cx + o - 1, cy - 4.8); x.stroke(); }
  }
  function headBack(x, cx, cy) {
    x.fillStyle = SK[1]; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * 6.4, cy + .6, 1.5, 2.5, 0, 0, TAU); x.fill(); }
    x.fillStyle = vgrad(x, cy - 11, cy + 8, HR); x.beginPath(); x.moveTo(cx - 6.8, cy + 2); x.bezierCurveTo(cx - 8, cy - 8, cx - 3, cy - 11, cx, cy - 10.8); x.bezierCurveTo(cx + 3, cy - 11, cx + 8, cy - 8, cx + 6.8, cy + 2);
    x.lineTo(cx + 4.6, cy + 7.6); x.lineTo(cx + 2.4, cy + 6.4); x.lineTo(cx, cy + 8); x.lineTo(cx - 2.4, cy + 6.4); x.lineTo(cx - 4.6, cy + 7.6); x.closePath(); x.fill();
    x.strokeStyle = hexA(HR[0], .8); x.lineWidth = .7; for (const o of [-4, -1.5, 1, 3.5]) { x.beginPath(); x.moveTo(cx + o * .4, cy - 10); x.quadraticCurveTo(cx + o, cy - 3, cx + o * 1.1, cy + 5); x.stroke(); }
  }
  function headSide(x, cx, cy) {
    let gr = x.createRadialGradient(cx + 2, cy - 3, 1, cx, cy, 9); gr.addColorStop(0, SK[0]); gr.addColorStop(.7, SK[1]); gr.addColorStop(1, SK[2]); x.fillStyle = gr;
    x.beginPath(); x.moveTo(cx - 4, cy - 7); x.bezierCurveTo(cx, cy - 9.4, cx + 5, cy - 8.4, cx + 5.8, cy - 5); x.lineTo(cx + 6.2, cy - 1.8); x.lineTo(cx + 8, cy + 1.3); x.lineTo(cx + 6.3, cy + 2.3);
    x.lineTo(cx + 6.7, cy + 3.7); x.lineTo(cx + 6.1, cy + 4.4); x.lineTo(cx + 6.4, cy + 5.2); x.quadraticCurveTo(cx + 5.8, cy + 7.8, cx + 2.6, cy + 7.8); x.quadraticCurveTo(cx - 1, cy + 7.4, cx - 2.6, cy + 4);
    x.bezierCurveTo(cx - 7.6, cy + 2, cx - 7.6, cy - 7, cx - 4, cy - 7); x.fill();
    eye(x, cx + 4.3, cy - .1, .85);
    x.strokeStyle = HR[2]; x.lineWidth = .95; x.beginPath(); x.moveTo(cx + 2.8, cy - 1.8); x.quadraticCurveTo(cx + 4.4, cy - 2.6, cx + 6, cy - 2); x.stroke();
    x.strokeStyle = '#a2584a'; x.lineWidth = .7; x.beginPath(); x.moveTo(cx + 6.2, cy + 3.9); x.lineTo(cx + 4.9, cy + 4.1); x.stroke();
    x.fillStyle = 'rgba(232,130,110,.22)'; x.beginPath(); x.ellipse(cx + 3, cy + 2.8, 1.8, 1.1, 0, 0, TAU); x.fill();
    x.fillStyle = vgrad(x, cy - 11, cy + 7, HR); x.beginPath(); x.moveTo(cx + 6.2, cy - 3.4); x.bezierCurveTo(cx + 5.6, cy - 9.6, cx - 1, cy - 11.4, cx - 4.6, cy - 9.2);
    x.bezierCurveTo(cx - 9.4, cy - 6.6, cx - 8.8, cy + 2.6, cx - 4.6, cy + 6.6); x.lineTo(cx - 2.6, cy + 3.4); x.lineTo(cx - 2.8, cy - 2.4); x.lineTo(cx + 1.2, cy - 3); x.lineTo(cx + 3.2, cy - 4.6); x.closePath(); x.fill();
    x.strokeStyle = hexA(HR[0], .85); x.lineWidth = .7; for (const o of [0, 2.4]) { x.beginPath(); x.moveTo(cx - 3 + o, cy - 9.6); x.quadraticCurveTo(cx - 7 + o, cy - 5, cx - 6 + o, cy + 2); x.stroke(); }
    x.fillStyle = SK[1]; x.beginPath(); x.ellipse(cx - .9, cy + .6, 1.7, 2.6, .1, 0, TAU); x.fill(); x.strokeStyle = SK[2]; x.lineWidth = .6; x.beginPath(); x.ellipse(cx - .7, cy + .6, .9, 1.6, .1, -1.2, 1.6); x.stroke();
  }
  function pauldron(x, px, py, rot) {
    x.save(); x.translate(px, py); x.rotate(rot);
    x.fillStyle = vgrad(x, -2, 5, MT); x.beginPath(); x.ellipse(.6, 3, 5.4, 3.3, 0, 0, TAU); x.fill();
    x.fillStyle = vgrad(x, -5, 3, MT); x.beginPath(); x.ellipse(0, 0, 6.4, 4.6, 0, 0, TAU); x.fill();
    x.fillStyle = 'rgba(255,255,255,.75)'; x.beginPath(); x.ellipse(-2, -1.8, 2.6, 1.1, -.3, 0, TAU); x.fill();
    x.fillStyle = '#c9a24a'; x.beginPath(); x.arc(3.6, .8, .8, 0, TAU); x.fill(); x.restore();
  }
  function hand(x, hx, hy) { const gr = x.createRadialGradient(hx - .8, hy - .8, .3, hx, hy, 3); gr.addColorStop(0, SK[0]); gr.addColorStop(1, SK[2]); x.fillStyle = gr; x.beginPath(); x.arc(hx, hy, 2.7, 0, TAU); x.fill(); }
  function heroFront(x, ph, mv, br, back) {
    const s = Math.sin(ph), c = Math.cos(ph), Y = -(mv ? Math.abs(c) * 1.8 : br * .7), wave = Math.sin(ph * 2) * (mv ? 1.6 : .5);
    const lift = [mv ? Math.max(0, back ? -s : s) * 5 : 0, mv ? Math.max(0, back ? s : -s) * 5 : 0];
    if (!back) { x.fillStyle = hgrad(x, -17, 17, dim(CL)); x.beginPath(); x.moveTo(-12.5, Y - 66); x.lineTo(12.5, Y - 66); x.lineTo(16.5 + wave, -12); x.lineTo(-16.5 - wave, -12); x.closePath(); x.fill(); }
    [-4.6, 4.6].forEach((lx, i) => { // 다리 · 장화
      const kY = -22 - lift[i] * .6, aY = -4 - lift[i];
      seg(x, lx, Y - 43, lx * 1.05, kY, 8.6, 7, TRS);
      seg(x, lx * 1.05, kY - 1.5, lx * 1.1, aY, 7.4, 6, BO);
      x.fillStyle = BO[0]; x.beginPath(); x.ellipse(lx * 1.05, kY - 1.8, 4.3, 1.7, 0, 0, TAU); x.fill();
      x.fillStyle = vgrad(x, aY - 1, aY + 4, BO); x.beginPath(); x.ellipse(lx * 1.1, aY + 1.6, 4.1, 2.9, 0, 0, TAU); x.fill();
    });
    x.fillStyle = hgrad(x, -12, 12, TU); x.beginPath(); x.moveTo(-10, Y - 45); x.lineTo(10, Y - 45); x.lineTo(11.8 + wave * .3, Y - 31); x.quadraticCurveTo(0, Y - 29, -11.8 - wave * .3, Y - 31); x.closePath(); x.fill(); // 튜닉 자락
    x.strokeStyle = 'rgba(10,25,60,.45)'; x.lineWidth = .8; for (const o of [-6, -2, 3, 7]) { x.beginPath(); x.moveTo(o * .8, Y - 43); x.lineTo(o * 1.05, Y - 31); x.stroke(); }
    x.fillStyle = hgrad(x, -13, 13, TU); x.beginPath(); x.moveTo(-12.5, Y - 66); x.bezierCurveTo(-13.2, Y - 58, -11, Y - 50, -10.2, Y - 43); x.lineTo(10.2, Y - 43); x.bezierCurveTo(11, Y - 50, 13.2, Y - 58, 12.5, Y - 66); x.quadraticCurveTo(0, Y - 69, -12.5, Y - 66); x.fill();
    if (!back) { // 가죽 조끼 · 끈 · V 목
      for (const sd of [-1, 1]) { x.fillStyle = hgrad(x, sd * 12, sd * 2, sd < 0 ? LE : [LE[1], LE[1], LE[2]]); x.beginPath(); x.moveTo(sd * 12, Y - 65); x.lineTo(sd * 3.4, Y - 66); x.lineTo(sd * 2.5, Y - 45); x.lineTo(sd * 10.4, Y - 45); x.closePath(); x.fill(); }
      x.strokeStyle = '#e0c48a'; x.lineWidth = .7; x.beginPath(); for (let y = Y - 63; y < Y - 48; y += 3.4) { x.moveTo(-2.8, y); x.lineTo(2.8, y + 1.7); x.moveTo(2.8, y); x.lineTo(-2.8, y + 1.7); } x.stroke();
      x.fillStyle = SK[1]; x.beginPath(); x.moveTo(-2.8, Y - 67); x.lineTo(2.8, Y - 67); x.lineTo(0, Y - 62); x.closePath(); x.fill();
    } else { x.fillStyle = hgrad(x, -12, 12, LE); x.beginPath(); x.moveTo(-12, Y - 65); x.lineTo(12, Y - 65); x.lineTo(10.4, Y - 45); x.lineTo(-10.4, Y - 45); x.closePath(); x.fill(); x.strokeStyle = 'rgba(30,15,5,.5)'; x.lineWidth = .7; x.beginPath(); x.moveTo(0, Y - 65); x.lineTo(0, Y - 45); x.stroke(); }
    x.fillStyle = vgrad(x, Y - 46, Y - 42, ['#5a3a20', '#3a2414', '#22140a']); x.fillRect(-10.6, Y - 46, 21.2, 3.8); // 허리띠
    if (!back) { x.fillStyle = '#e2bd62'; x.fillRect(-2.1, Y - 46.5, 4.2, 4.8); x.fillStyle = '#3a2414'; x.fillRect(-1, Y - 45.4, 2, 2.6); }
    x.fillStyle = vgrad(x, Y - 44, Y - 37, LE); x.beginPath(); x.roundRect ? x.roundRect(back ? -11 : 6.2, Y - 44, 5, 6.2, 1.4) : x.rect(back ? -11 : 6.2, Y - 44, 5, 6.2); x.fill(); // 주머니
    if (back) { // 망토 (등)
      x.fillStyle = hgrad(x, -16, 16, CL); x.beginPath(); x.moveTo(-12.5, Y - 66); x.lineTo(12.5, Y - 66); x.quadraticCurveTo(14, Y - 40, 15.5 + wave, -11);
      for (let k = 1; k <= 6; k++) x.lineTo(15.5 + wave - k * 5.2, -11 + (k % 2) * 1.6 + Math.sin(ph * 2 + k) * .8);
      x.quadraticCurveTo(-14, Y - 40, -12.5, Y - 66); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(5,20,10,.45)'; x.lineWidth = 1; for (const o of [-8, -3, 2, 7]) { x.beginPath(); x.moveTo(o * .6, Y - 62); x.quadraticCurveTo(o * 1.1, Y - 40, o * 1.25 + wave * .5, -12); x.stroke(); }
      x.fillStyle = CL[2]; x.beginPath(); x.ellipse(0, Y - 66, 8.5, 3.2, 0, 0, TAU); x.fill(); x.fillStyle = CL[1]; x.beginPath(); x.ellipse(0, Y - 66.8, 7.4, 2.2, 0, 0, TAU); x.fill();
    }
    for (const sd of [-1, 1]) { // 팔 (앞뒤로 흔들림)
      const sw = mv ? (back ? sd : -sd) * s * 2.2 : 0, sx = sd * 12.6, sy = Y - 64, ex = sd * 14.3, ey = Y - 53 + sw * .4, hx = sd * 14.7, hy = Y - 42.5 + sw;
      seg(x, sx, sy, ex, ey, 6.4, 5.4, TU); seg(x, ex, ey, hx, hy - 1.5, 5.6, 4.8, LE); hand(x, hx, hy);
    }
    pauldron(x, -12.8, Y - 65.5, -.15); pauldron(x, 12.8, Y - 65.5, .15);
    x.fillStyle = SK[1]; x.fillRect(-2.7, Y - 72, 5.4, 6); x.fillStyle = 'rgba(120,60,40,.35)'; x.fillRect(-2.7, Y - 72, 5.4, 2.2);
    if (back) headBack(x, 0, Y - 78.5); else headFront(x, 0, Y - 78.5);
  }
  function heroSide(x, ph, mv, br) {
    const leg = p => { const a1 = mv ? Math.sin(p) * .46 : 0, bend = mv ? Math.max(0, -Math.cos(p)) * .8 : 0, kx = Math.sin(a1) * 21, ky = Math.cos(a1) * 21; return { kx, ky, ax: kx + Math.sin(a1 - bend) * 20, ay: ky + Math.cos(a1 - bend) * 20 }; };
    const L1 = leg(ph), L2 = leg(ph + Math.PI), hipY = -Math.max(L1.ay, L2.ay) - 4.5, Y = hipY + 44 - (mv ? 0 : br * .7), fw = mv ? 1.4 : 0, wave = Math.sin(ph * 2) * (mv ? 2 : .6), tr = mv ? 7 : 2;
    const drawLeg = (L, dark) => {
      const tp = dark ? dim(TRS) : TRS, bp = dark ? dim(BO) : BO, kx = L.kx, ky = hipY + L.ky, ax = L.ax, ay = hipY + L.ay;
      seg(x, 0, hipY, kx, ky, 8.6, 7, tp); seg(x, kx, ky - 1.5, ax, ay, 7.2, 5.8, bp);
      x.fillStyle = bp[0]; x.beginPath(); x.ellipse(kx, ky - 1.8, 4.2, 1.6, 0, 0, TAU); x.fill();
      x.fillStyle = vgrad(x, ay - 2, ay + 3.5, bp); x.beginPath(); x.moveTo(ax - 3, ay - 1.6); x.lineTo(ax + 3.5, ay - .4); x.quadraticCurveTo(ax + 7.6, ay + .4, ax + 7.4, ay + 3.4); x.lineTo(ax - 3.4, ay + 3.4); x.closePath(); x.fill();
    };
    const arm = (p, dark) => {
      const ua = mv ? -Math.sin(p) * .55 : .06, fa = ua + .28 + (mv ? Math.max(0, Math.sin(p)) * .4 : .08), sx = .5 + fw, sy = Y - 64, ex = sx + Math.sin(ua) * 11, ey = sy + Math.cos(ua) * 11, hx = ex + Math.sin(fa) * 10, hy = ey + Math.cos(fa) * 10;
      seg(x, sx, sy, ex, ey, 6.2, 5.3, dark ? dim(TU) : TU); seg(x, ex, ey, hx, hy, 5.4, 4.6, dark ? dim(LE) : LE); hand(x, hx, hy);
    };
    x.fillStyle = hgrad(x, -20, 0, CL); x.beginPath(); x.moveTo(-4 + fw, Y - 67); x.quadraticCurveTo(-12 - tr, Y - 42, -15 - tr * 1.2 + wave, -10); // 망토는 뒤로 휘날린다
    for (let k = 1; k <= 3; k++) x.lineTo(-15 - tr * 1.2 + wave + k * 4, -10 + (k % 2) * 1.8);
    x.lineTo(-2 + wave * .4, -13); x.lineTo(-1 + fw, Y - 60); x.closePath(); x.fill();
    arm(ph + Math.PI, true); drawLeg(L2, true);
    x.fillStyle = hgrad(x, -7, 8, TU); x.beginPath(); x.moveTo(-6.4, Y - 45); x.lineTo(6.4 + fw, Y - 45); x.lineTo(8 + fw + wave * .3, Y - 31); x.quadraticCurveTo(0, Y - 29.5, -7.6 + wave * .4, Y - 31); x.closePath(); x.fill();
    drawLeg(L1, false);
    x.fillStyle = hgrad(x, -6, 7, TU); x.beginPath(); x.moveTo(-5.6 + fw, Y - 66); x.bezierCurveTo(-6.6 + fw, Y - 56, -6, Y - 48, -5.4, Y - 43); x.lineTo(5.6 + fw, Y - 43); x.bezierCurveTo(6.4 + fw, Y - 50, 7.6 + fw, Y - 57, 6 + fw, Y - 65); x.quadraticCurveTo(0 + fw, Y - 68, -5.6 + fw, Y - 66); x.fill();
    x.fillStyle = hgrad(x, -6, 5, LE); x.beginPath(); x.moveTo(-5.4 + fw, Y - 65); x.lineTo(3.6 + fw, Y - 65.5); x.lineTo(3 + fw, Y - 45); x.lineTo(-5.2, Y - 45); x.closePath(); x.fill();
    x.fillStyle = vgrad(x, Y - 46, Y - 42, ['#5a3a20', '#3a2414', '#22140a']); x.fillRect(-5.8, Y - 46, 12.4 + fw, 3.8); x.fillStyle = '#e2bd62'; x.fillRect(4.2 + fw, Y - 46.5, 2.6, 4.8);
    x.fillStyle = vgrad(x, Y - 44, Y - 37, LE); x.fillRect(-6.4, Y - 44, 4.6, 6);
    arm(ph, false);
    pauldron(x, .6 + fw, Y - 65.5, .1);
    x.fillStyle = SK[1]; x.fillRect(-1.6 + fw, Y - 72, 5, 6.2); x.fillStyle = 'rgba(120,60,40,.35)'; x.fillRect(-1.6 + fw, Y - 72, 5, 2.2);
    headSide(x, 1 + fw, Y - 78.5);
  }
  function inked(sp) { // 그림처럼 가는 테두리
    const c = sp.c, sil = mkCanvas(c.width, c.height), sx = sil.getContext('2d'), out = mkCanvas(c.width, c.height), o = out.getContext('2d');
    sx.drawImage(c, 0, 0); sx.globalCompositeOperation = 'source-in'; sx.fillStyle = 'rgba(28,18,12,.85)'; sx.fillRect(0, 0, c.width, c.height);
    for (let a = 0; a < 8; a++) o.drawImage(sil, Math.cos(a * TAU / 8) * 1.6, Math.sin(a * TAU / 8) * 1.6);
    o.drawImage(c, 0, 0); sp.c = out; return sp;
  }
  function makeHero() {
    HERO = [0, 1, 2].map(dir => Array.from({ length: PF + 4 }, (_, f) => {
      const mv = f < PF, ph = mv ? (f / PF) * TAU : 0, br = mv ? 0 : (1 - Math.cos(((f - PF) / 4) * TAU)) / 2;
      return inked(sprite(PW, PH, x => { x.translate(PAX, PAY); if (dir === 2) heroSide(x, ph, mv, br); else heroFront(x, ph, mv, br, dir === 1); }));
    }));
  }
  function drawPlayer(x, y, t) {
    const p = st.p, f = p.moving ? Math.floor(((p.walk % TAU) + TAU) % TAU / TAU * PF) % PF : PF + Math.floor(t * 2.4) % 4, sp = HERO[p.dir][f];
    g.fillStyle = 'rgba(10,25,10,.35)'; g.beginPath(); g.ellipse(x, y, 15, 5, 0, 0, TAU); g.fill();
    g.save(); g.translate(x + (st.hurt > 0 ? rnd(-1.2, 1.2) : 0), y); if (p.dir === 2 && p.face < 0) g.scale(-1, 1);
    g.drawImage(sp.c, -PAX * PS, -PAY * PS, PW * PS, PH * PS); g.restore();
  }
  // ---------- 검 · 보석 · 포션 · 효과 (빛나는 것들은 위에 겹쳐 그린다) ----------
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
  let cam0 = null, cards = [], picking = false, hudC = {};
  function derive() {
    const u = st.up;
    st.len = 50 * (1 + u.size); st.r0 = 40 + 18 * (1 + u.size); st.wid = clamp(st.len * .19, 8, 26);
    st.spinNow = 2.8 * (1 + u.spin); st.swords = 3 + u.sword; st.near = u.near;
  }
  function newRun() {
    st = { t: 0, p: { x: C, y: C + 60, vx: 0, vy: 0, moving: false, walk: 0, dir: 0, face: 1, eyes: null }, up: { size: 0, spin: 0, sword: 0, hp: 0, near: 0 },
      hpMax: S.MINI_HP, hp: S.MINI_HP, lv: 1, xp: 0, pend: 0, lvT: 0, ang: 0, mobs: [], gems: [], pots: [], fx: [], texts: [],
      kills: 0, spawnT: 1.2, potT: 0, hurt: 0, shake: 0, dead: 0, nick: O.nick || '나' };
    derive(); hudC = {};
    for (let k = 0; k < 6; k++) spawn('skel');
  }
  function spawn(kind) {
    const k = KIND[kind], a = Math.random() * TAU, d = Math.hypot(W, H) * .5 + 40, grow = 1 + st.t / 75;
    st.mobs.push({ kind, x: clamp(st.p.x + Math.cos(a) * d, 30, WORLD - 30), y: clamp(st.p.y + Math.sin(a) * d, 30, WORLD - 30), r: k.r, sc: 1.2, hp: k.hp * grow, max: k.hp * grow,
      sp: k.sp * rnd(.9, 1.1), hit: {}, flash: 0, ph: Math.random() * TAU, face: 1, walk: Math.random() * 6, mv: true, born: 0, v: Math.random() < .35 ? 1 : 0, eyes: null });
  }
  function float(x, y, txt, col, size = 14, life = .9) { st.texts.push({ x, y, txt, col, size, t: 0, life }); }
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
  }
  function kill(m) {
    const k = KIND[m.kind], fy = m.y + m.r * .7 - k.ht * m.sc * .45;
    st.kills++; SND.kill();
    burst(m.x, fy, k.col, 12, 170); fx('soul', m.x, fy, { vy: -60, col: k.eye, r: 4, life: .9 });
    dropGem(m.x, m.y, k.pts);
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
    // 괴물 나오기 (시간이 갈수록 많고 세게)
    st.spawnT -= dt;
    if (st.spawnT <= 0 && st.mobs.length < 180) {
      st.spawnT = Math.max(.14, 1.0 - st.t * .008);
      for (let k = 0, n = 1 + Math.floor(st.t / 50); k < n; k++) { const r = Math.random(); spawn(st.t > 20 && r < .3 ? 'ghost' : st.t > 12 && r < .55 ? 'bat' : 'skel'); }
    }
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
    const n = st.swords, r0 = st.r0, r1 = st.r0 + st.len, wid = st.wid, nearF = 1 + st.near, dmgBase = 32 * (1 + (st.lv - 1) * .045), tc = TIERS[tierOf(st.lv)];
    for (let i = st.mobs.length - 1; i >= 0; i--) {
      const m = st.mobs[i], k = KIND[m.kind], dx = p.x - m.x, dy = p.y - m.y, d = Math.hypot(dx, dy) || 1;
      m.born += dt; m.flash = Math.max(0, m.flash - dt);
      const sp = m.sp * nearF * (m.kind === 'bat' ? 1 + Math.sin(st.t * 3 + m.ph) * .25 : 1) * (m.born < .45 ? .2 : 1);
      m.mv = d > 14 + m.r;
      if (m.mv) { m.x += dx / d * sp * dt; m.y += dy / d * sp * dt; m.walk += sp * dt * .11; }
      if (Math.abs(dx) > 4) m.face = dx > 0 ? 1 : -1;
      if (d < 20 + m.r && m.born > .45) { st.hp -= k.dmg * dt; st.hurt = .15; SND.hurt(); }
      if (d - m.r < r1 + 4) for (let s = 0; s < n; s++) { // 검 = 몸 가운데에서 바깥으로 뻗은 막대 (손잡이 쪽에 붙은 괴물도 베인다)
        const a = st.ang + s * TAU / n, ux = Math.cos(a), uy = Math.sin(a), along = -dx * ux - dy * uy;
        if (along < 0 || along > r1 + m.r || Math.abs(dx * uy - dy * ux) > m.r + wid * .6 || (m.hit[s] || 0) > st.t) continue;
        m.hit[s] = st.t + .3;
        const dmg = Math.round(dmgBase * rnd(.9, 1.1)), top = m.y + m.r * .7 - k.ht * m.sc;
        m.hp -= dmg; m.flash = .1;
        m.x += -dx / d * 9 - uy * 6; m.y += -dy / d * 9 + ux * 6;
        if (st.texts.length < 70) float(m.x, top, String(dmg), '#ffffff', 13, .6);
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
    return `+${Math.round(u.near * 100)}% → +${Math.round(Math.min(U.near.max, u.near + add) * 100)}%`;
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
      st.up[c.k] = Math.min(U[c.k].max, st.up[c.k] + v); if (c.k === 'hp') { st.hpMax += v; st.hp += v; }
      derive(); SND.pick(c.r);
      fx('ring', st.p.x, st.p.y, { r: 170, col, life: .55 }); burst(st.p.x, st.p.y, col, 24, 220, 'ember');
      float(st.p.x, st.p.y - 86, `${U[c.k].name} ${U[c.k].fmt(v)}`, col, 17, 1.4);
      cards = []; picking = false; $('#mgPick').hidden = true; st.pend--; st.lvT = .3; state = 'play'; last = performance.now();
    }, 260);
  }

  // ---------- 그리기 ----------
  function drawGlows(cam) { // 괴물 눈 · 칼에 맞은 번쩍임 · 내가 맞을 때 붉은 빛
    g.globalCompositeOperation = 'lighter';
    for (const m of st.mobs) {
      if (!m.eyes) continue;
      const k = KIND[m.kind], fx0 = m.x - cam.x, fy0 = m.y + m.r * .7 - cam.y;
      for (const e of m.eyes) drawGlow(k.eye, fx0 + e[0] * m.face * m.sc, fy0 + e[1] * m.sc, 6 * m.sc, .8);
      if (m.flash > 0) drawGlow('#ffffff', fx0, fy0 - k.ht * m.sc * .45, k.r * m.sc * 1.6, .7);
    }
    if (st.hurt > 0) drawGlow('#ff2a4a', st.p.x - cam.x, st.p.y + 16 - cam.y - 42, 70, .45);
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
    if (st) {
      drawGlows(cam);
      drawGems(cam, t);
      for (const q of st.pots) { const x = q.x - cam.x, y = q.y - cam.y; if (x > -60 && y > -60 && x < W + 60 && y < H + 60) drawPotion(q, x, y, t); }
      if (!st.dead) drawBlades(st.p.x - cam.x, st.p.y - cam.y, t);
      drawFx(cam);
      drawAtmos(t);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const x of st.texts) { const sc = x.t < .12 ? .6 + x.t / .12 * .4 : 1; g.globalAlpha = 1 - Math.max(0, x.t / x.life - .6) / .4; g.font = `900 ${Math.round(x.size * sc)}px Pretendard, sans-serif`; g.lineWidth = 3.5; g.strokeStyle = 'rgba(5,6,18,.9)'; g.strokeText(x.txt, x.x - cam.x, x.y - cam.y); g.fillStyle = x.col; g.fillText(x.txt, x.x - cam.x, x.y - cam.y); }
      g.globalAlpha = 1;
      if (!st.dead) drawHead(st.p.x - cam.x, st.p.y + 16 - cam.y - 108);
      for (const q of st.pots) { const x = q.x - cam.x, y = q.y - cam.y; if (x < 0 || y < 0 || x > W || y > H) arrow(x, y, POT[q.v][0]); }
      if (st.hurt > 0) { g.globalAlpha = .55; g.drawImage(glow('#ff1a3a'), -W * .5, -H * .5, W * 2, H * 2); g.globalAlpha = 1; g.fillStyle = 'rgba(255,20,50,.08)'; g.fillRect(0, 0, W, H); }
    } else drawAtmos(t);
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
    $('#mgNow').innerHTML = [['검 크기', `${(1 + u.size).toFixed(2)}×`], ['회전 속도', `${(1 + u.spin).toFixed(2)}×`], ['검', `${st.swords}개`], ['최대 체력', st.hpMax], ['괴물 접근', `+${Math.round(u.near * 100)}%`], ['레벨', `Lv ${st.lv}`]].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
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
    vig = mkCanvas(W, H); const v = vig.getContext('2d'), gr = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .38, W / 2, H / 2, Math.max(W, H) * .78); gr.addColorStop(0, 'rgba(8,20,8,0)'); gr.addColorStop(1, 'rgba(8,20,8,.38)'); v.fillStyle = gr; v.fillRect(0, 0, W, H);
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
    addEventListener('resize', fit); document.addEventListener('visibilitychange', onVis);
    st = null; state = 'lobby'; data = null; renderLobby(); show('lobby');
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    const r = await O.api('/api/mini');
    if (r.error) { O.toast(r.error, 'err'); return close(); }
    data = r; renderLobby();
  }
  window.MLEMini = { open, close, _state: () => ({ state, st, data }) };
})();
