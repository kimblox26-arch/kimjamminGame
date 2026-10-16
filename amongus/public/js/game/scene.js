// 게임 화면(캔버스): 정적 맵 타일 캐시, 벽에 가려지는 시야, 문, 크루원, 효과, 보안 카메라 화면
import { LOBBY, canStand, visionPoly, lineClear } from '../shared/maps/index.js';
import { COLORS } from '../shared/data.js';
import { crewSVG, cosmeticSVG, CREW_BOX } from '../ui/crew.js';
import { settings } from '../core.js';
import { prepMap, floorPattern, drawPropUnder, drawPropBody, propSprite, shade, rgba, mk, FONT, CREW_SC, VENT_W, VENT_H, TAU, polyPath, hash2 } from './render.js';

const cv = document.getElementById('world');
const ctx = cv.getContext('2d');
const fog = mk(2, 2), fg = fog.getContext('2d');
let W = 0, H = 0, zoom = 1, cam = { x: 0, y: 0 }, raf = 0, last = 0, sendT = 0, lastSent = '', tNow = 0;
export const SPEED = 430;
const TILE = 512, NAME_Y = 196;

function resize() {
  const r = (settings.resolution || 1) * Math.min(devicePixelRatio || 1, 2);
  W = cv.width = fog.width = Math.max(2, Math.round(innerWidth * r));
  H = cv.height = fog.height = Math.max(2, Math.round(innerHeight * r));
}
addEventListener('resize', resize);
addEventListener('settings', resize);

export const scene = {
  map: LOBBY, art: null, players: new Map(), meId: null, viewId: null, controlId: null, bodies: [], visuals: new Map(),
  doorsClosed: new Set(), joy: { x: 0, y: 0 }, keys: new Set(), touch: null,
  ghost: false, vision: 1, lightsOut: false, inVent: null, frozen: false, speed: 1, speedMul: 1, noclip: false,
  hl: null, killId: null, reportId: null, abilityId: null, abilityColor: '#8CFFFF', arrows: [], sabTargets: [], redNames: new Set(),
  taskStations: new Set(), tracks: [], noises: [], mixup: false, mix: null, hideNames: false, flashlight: null,
  onMove: null, onArrow: null,
  get me() { return this.players.get(this.meId); },
  start(map) { this.setMap(map); cv.style.display = 'block'; resize(); if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } },
  stop() { cancelAnimationFrame(raf); raf = 0; cv.style.display = 'none'; this.players.clear(); this.bodies = []; effects.length = 0; moves.clear(); },
  setMap(map) { this.map = map; this.art = prepMap(map); tiles.clear(); tileKey = ''; },
  setPlayer(p) {
    const old = this.players.get(p.id);
    this.players.set(p.id, { anim: 0, dir: 1, mv: 0, ...old, ...p, tx: p.x ?? old?.x ?? 0, ty: p.y ?? old?.y ?? 0, x: p.x ?? old?.x ?? 0, y: p.y ?? old?.y ?? 0 });
  },
  teleport(id, x, y) { const p = this.players.get(id); if (p) { p.x = p.tx = x; p.y = p.ty = y; } },
  visionR() {
    if (this.flashlight?.on) return 1500 * (this.flashlight.size || 0.3);
    return 560 * this.vision * (this.lightsOut ? 0.28 : 1);
  },
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
  canSee(p) {
    const v = this.players.get(this.viewId ?? this.meId);
    if (!v || this.ghost || this.map === LOBBY || this.map.id === 'lobby') return true;
    return this.dist(v, p) < this.visionR() + 40 && lineClear(this.map, v.x, v.y - 40, p.x, p.y - 40, this.doorsClosed);
  },
  toScreen(x, y) { return [(x - cam.x) * zoom + W / 2, (y - cam.y) * zoom + H / 2]; },
  effect(kind, d = {}) {
    if (['transport', 'platform'].includes(kind) && d.to) {
      const id = d.id ?? d.tid, p = this.players.get(id), from = d.from || (p && { x: p.x, y: p.y });
      if (from) moves.set(id, { from, to: d.to, t0: tNow, ms: d.ms || 1200, kind: d.kind || kind });
      return;
    }
    if (['ventIn', 'ventOut', 'ventMove', 'kill', 'poof', 'shieldHit', 'noise'].includes(kind)) effects.push({ kind, ...d, t0: tNow });
  },
  renderCam(canvas, x, y, z = 0.5) {
    const g = canvas.getContext('2d');
    buildBudget = Math.max(buildBudget, 6);
    drawWorld(g, canvas.width, canvas.height, x, y, z, { cam: true });
    g.fillStyle = 'rgba(40,255,120,.06)'; g.fillRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < canvas.height; i += 4) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, i, canvas.width, 1); }
  },
};
const effects = [], moves = new Map();

// ---------- 입력 ----------
const KEYMAP = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
addEventListener('keydown', e => { if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; if (KEYMAP[e.code]) { scene.keys.add(e.code); e.preventDefault(); } });
addEventListener('keyup', e => scene.keys.delete(e.code));
addEventListener('blur', () => scene.keys.clear());
const ctl = () => scene.players.get(scene.controlId ?? scene.meId);
const pointerTo = e => {
  const r = cv.getBoundingClientRect(), p = ctl();
  if (!p) return null;
  const [sx, sy] = scene.toScreen(p.x, p.y - 70);
  return [(e.clientX - r.left) * (W / r.width) - sx, (e.clientY - r.top) * (H / r.height) - sy];
};
cv.addEventListener('pointerdown', e => {
  const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), py = (e.clientY - r.top) * (H / r.height);
  const a = scene.arrows.find(a => Math.hypot(a.sx - px, a.sy - py) < 70 * Math.max(0.6, zoom) + 30);
  if (a) return scene.onArrow?.(a.id);
  if (settings.control === 'touch' || e.pointerType === 'mouse') { scene.touch = pointerTo(e); cv.setPointerCapture(e.pointerId); }
});
cv.addEventListener('pointermove', e => { if (scene.touch) scene.touch = pointerTo(e); });
const endTouch = () => (scene.touch = null);
cv.addEventListener('pointerup', endTouch); cv.addEventListener('pointercancel', endTouch);
function inputVec() {
  let x = scene.joy.x, y = scene.joy.y;
  for (const k of scene.keys) { x += KEYMAP[k][0]; y += KEYMAP[k][1]; }
  if (scene.touch) { const [tx, ty] = scene.touch, d = Math.hypot(tx, ty); if (d > 30) { x += tx / d; y += ty / d; } }
  const d = Math.hypot(x, y);
  return d > 1 ? [x / d, y / d] : [x, y];
}

// ---------- 갱신 ----------
function update(dt) {
  const p = ctl();
  if (p && !scene.frozen && !scene.inVent && !moves.has(p.id)) {
    const [ix, iy] = inputVec(), sp = SPEED * scene.speed * (scene.speedMul || 1) * (scene.ghost ? 1.25 : 1) * dt;
    const moving = Math.hypot(ix, iy) > 0.1;
    if (moving) {
      const m = scene.map, free = scene.ghost || scene.noclip, cl = scene.doorsClosed;
      let left = sp;
      // 빠른 속도에서도 벽을 뚫지 않게 작은 걸음으로 나눠 이동
      while (left > 0) {
        const s = Math.min(left, 24), nx = p.x + ix * s, ny = p.y + iy * s;
        if (free) { p.x = Math.max(-200, Math.min(m.w + 200, nx)); p.y = Math.max(-200, Math.min(m.h + 200, ny)); }
        else { if (canStand(m, nx, p.y, cl)) p.x = nx; if (canStand(m, p.x, ny, cl)) p.y = ny; }
        left -= s;
      }
      if (Math.abs(ix) > 0.15) p.dir = ix > 0 ? 1 : 0;
    }
    p.mv = moving ? 1 : 0;
    p.tx = p.x; p.ty = p.y;
  }
  const cid = scene.controlId ?? scene.meId;
  for (const q of scene.players.values()) {
    if (q.id !== cid) { const k = Math.min(1, dt * 12); q.x += (q.tx - q.x) * k; q.y += (q.ty - q.y) * k; }
    q.anim = q.mv ? q.anim + dt : 0;
  }
  for (const [id, mv] of moves) if (tNow - mv.t0 > mv.ms + 200) moves.delete(id);
  for (let i = effects.length - 1; i >= 0; i--) if (tNow - effects[i].t0 > 1600) effects.splice(i, 1);
  sendT += dt;
  if (p && sendT > 0.066 && scene.onMove) {
    sendT = 0;
    const s = `${p.id},${p.x | 0},${p.y | 0},${p.dir},${p.mv}`;
    if (s !== lastSent) { lastSent = s; scene.onMove(p.x, p.y, p.dir, p.mv, p.id); }
  }
}

// ---------- 크루원 스프라이트 (SVG → 비트맵, 2배 해상도) ----------
const sprites = new Map();
const svgUrl = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
function bake(key, svg, w, h) {
  let e = sprites.get(key);
  if (!e) {
    e = { c: null };
    sprites.set(key, e);
    const img = new Image();
    img.onload = () => { const c = mk(w, h); c.getContext('2d').drawImage(img, 0, 0, w, h); e.c = c; };
    img.src = svgUrl(svg.replace('<svg ', `<svg width="${w}" height="${h}" `));
    if (sprites.size > 700) sprites.delete(sprites.keys().next().value);
  }
  return e.c;
}
const crewSprite = (look, o) => bake(['c', look.color, look.hat, look.visor, look.skin, o.frame | 0, o.dead ? 1 : 0, o.ghost ? 1 : 0, o.flip ? 1 : 0].join('|'),
  crewSVG(look, { ...o, noPet: true }), 500, 360);
const petSprite = look => (look.pet && look.pet !== 'none' ? bake('p|' + look.pet + '|' + look.color, cosmeticSVG('pet', look.pet, look), 150, 140) : null);

// ---------- 정적 타일 ----------
const tiles = new Map();
let tileKey = '', tileS = 1;
const hit = (bb, x0, y0, x1, y1) => bb[2] >= x0 && bb[0] <= x1 && bb[3] >= y0 && bb[1] <= y1;
function drawStatic(g, art, x0, y0, x1, y1) {
  const m = art.map;
  g.lineJoin = 'round'; g.lineCap = 'round';
  // 1) 벽 덩어리(바깥 띠)
  for (const S of art.styles) {
    const st = S.st;
    for (const pass of [[st.out, st.cap * 2 + 30], [st.mass, st.cap * 2 + 14]]) {
      g.strokeStyle = pass[0]; g.lineWidth = pass[1];
      for (const c of S.chains) {
        if (!hit(c.bb, x0, y0, x1, y1)) continue;
        g.beginPath(); c.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (c.closed) g.closePath(); g.stroke();
      }
    }
  }
  // 2) 바닥
  for (const p of art.polys) { if (!hit(p.bb, x0, y0, x1, y1)) continue; polyPath(g, p.poly); g.fillStyle = floorPattern(p.floor); g.fill(); }
  // 벽 쪽 바닥 그늘
  g.strokeStyle = 'rgba(0,0,0,.2)'; g.lineWidth = 56;
  for (const c of art.chains) { if (!hit(c.bb, x0, y0, x1, y1) || c.st.H === 0) continue; g.beginPath(); c.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (c.closed) g.closePath(); g.stroke(); }
  // 3) 북쪽 벽면(높이) + 벽 윗면
  for (const s of art.faceSegs) {
    if (Math.max(s.ax, s.bx) < x0 - 50 || Math.min(s.ax, s.bx) > x1 + 50 || s.ay < y0 - 20 || s.ay - s.H - s.st.cap > y1 + 20) continue;
    const top = Math.min(s.ay, s.by) - s.H, gr = g.createLinearGradient(0, top, 0, Math.max(s.ay, s.by));
    gr.addColorStop(0, shade(s.st.face, -0.18)); gr.addColorStop(0.75, s.st.face); gr.addColorStop(1, shade(s.st.face, -0.35));
    g.beginPath(); g.moveTo(s.ax, s.ay + 2); g.lineTo(s.bx, s.by + 2); g.lineTo(s.bx, s.by - s.H); g.lineTo(s.ax, s.ay - s.H); g.closePath();
    g.fillStyle = gr; g.fill();
    if (s.st.k === 'wall') {
      g.strokeStyle = rgba('#000', 0.18); g.lineWidth = 3;
      for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(s.ax, s.ay - (s.H * k) / 3); g.lineTo(s.bx, s.by - (s.H * k) / 3); g.stroke(); }
      const L = Math.hypot(s.bx - s.ax, s.by - s.ay), n = Math.floor(L / 160);
      for (let k = 1; k <= n; k++) { const t = k / (n + 1), px = s.ax + (s.bx - s.ax) * t, py = s.ay + (s.by - s.ay) * t; g.beginPath(); g.moveTo(px, py); g.lineTo(px, py - s.H); g.stroke(); }
    }
    g.fillStyle = s.st.top; g.beginPath(); g.moveTo(s.ax, s.ay - s.H); g.lineTo(s.bx, s.by - s.H); g.lineTo(s.bx, s.by - s.H - s.st.cap); g.lineTo(s.ax, s.ay - s.H - s.st.cap); g.closePath(); g.fill();
    g.strokeStyle = s.st.rim; g.lineWidth = 4; g.beginPath(); g.moveTo(s.ax, s.ay - s.H); g.lineTo(s.bx, s.by - s.H); g.stroke();
  }
  // 나머지 벽: 윗면 띠 + 테두리선
  for (const c of art.chains) {
    if (!hit(c.bb, x0, y0, x1, y1)) continue;
    for (const s of c.segs) {
      if (s.ny < -0.3 && c.st.H > 0) continue;
      const k = c.st.cap;
      g.fillStyle = c.st.top; g.beginPath(); g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); g.lineTo(s.bx + s.nx * k, s.by + s.ny * k); g.lineTo(s.ax + s.nx * k, s.ay + s.ny * k); g.closePath(); g.fill();
    }
    g.strokeStyle = c.st.rim; g.lineWidth = 5;
    g.beginPath(); c.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (c.closed) g.closePath(); g.stroke();
  }
  // 4) 평평한 소품, 높은 소품의 그림자
  for (const p of art.flat) if (hit(p.sb, x0, y0, x1, y1)) { drawPropUnder(g, p, art); drawPropBody(g, p, art); }
  for (const p of art.tall) if (hit(p.sb, x0, y0, x1, y1)) drawPropUnder(g, p, art);
  // 5) 환풍구, 콘솔
  for (const id in m.vents) { const v = m.vents[id]; if (v.x > x0 - 100 && v.x < x1 + 100 && v.y > y0 - 100 && v.y < y1 + 100) drawVent(g, v.x, v.y, 0); }
  for (const c of art.consoles) if (c.x > x0 - 150 && c.x < x1 + 150 && c.y > y0 - 300 && c.y < y1 + 150) drawConsole(g, c);
}
function drawVent(g, x, y, lid) {
  g.save(); g.translate(x, y);
  g.fillStyle = '#1b2125'; rr(g, -VENT_W / 2 - 6, -VENT_H / 2 - 6, VENT_W + 12, VENT_H + 12, 10); g.fill();
  g.fillStyle = '#20272c'; rr(g, -VENT_W / 2, -VENT_H / 2, VENT_W, VENT_H, 8); g.fill();
  g.translate(0, -lid);
  const gr = g.createLinearGradient(0, -VENT_H / 2, 0, VENT_H / 2); gr.addColorStop(0, '#7f8b92'); gr.addColorStop(1, '#4f5a60');
  g.fillStyle = gr; rr(g, -VENT_W / 2 + 6, -VENT_H / 2 + 6, VENT_W - 12, VENT_H - 12, 6); g.fill();
  g.fillStyle = '#2b3338'; for (let i = -VENT_W / 2 + 18; i < VENT_W / 2 - 14; i += 17) g.fillRect(i, -VENT_H / 2 + 14, 8, VENT_H - 28);
  g.restore();
}
function drawConsole(g, c) {
  if (c.wall != null) {
    const y = c.wall - Math.min(110, c.H * 0.7);
    g.fillStyle = '#20272c'; rr(g, c.x - 52, y - 40, 104, 78, 8); g.fill();
    g.fillStyle = '#56636a'; rr(g, c.x - 46, y - 34, 92, 66, 6); g.fill();
    const gr = g.createLinearGradient(0, y - 26, 0, y + 22); gr.addColorStop(0, '#2fe38a'); gr.addColorStop(1, '#127a52');
    g.fillStyle = gr; rr(g, c.x - 36, y - 26, 72, 44, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(c.x - 30, y - 20, 30, 5);
    return;
  }
  g.fillStyle = 'rgba(0,0,0,.28)'; ell(g, c.x, c.y + 26, 56, 16); g.fill();
  g.fillStyle = '#353f45'; rr(g, c.x - 44, c.y - 30, 88, 56, 8); g.fill();
  g.fillStyle = '#5f6c73'; rr(g, c.x - 44, c.y - 44, 88, 26, 7); g.fill();
  const gr = g.createLinearGradient(0, c.y - 40, 0, c.y - 22); gr.addColorStop(0, '#31d7ff'); gr.addColorStop(1, '#1777a8');
  g.fillStyle = gr; rr(g, c.x - 34, c.y - 40, 68, 16, 4); g.fill();
  g.fillStyle = '#c33'; g.beginPath(); g.arc(c.x + 28, c.y - 4, 5, 0, TAU); g.fill();
  g.fillStyle = '#3c3'; g.beginPath(); g.arc(c.x + 14, c.y - 4, 5, 0, TAU); g.fill();
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }
function ell(g, x, y, rx, ry) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); }

function tileFor(art, s, ix, iy) {
  const k = ix + ',' + iy;
  let t = tiles.get(k);
  if (t) return t.c;
  if (buildBudget <= 0) return null;
  buildBudget--;
  const c = mk(TILE, TILE), g = c.getContext('2d'), wx0 = (ix * TILE) / s, wy0 = (iy * TILE) / s;
  g.setTransform(s, 0, 0, s, -ix * TILE, -iy * TILE);
  drawStatic(g, art, wx0 - 10, wy0 - 10, wx0 + TILE / s + 10, wy0 + TILE / s + 10);
  tiles.set(k, { c });
  if (tiles.size > 160) tiles.delete(tiles.keys().next().value);
  return c;
}
let buildBudget = 0;
function drawTiles(g, Wd, Hd, cx, cy, z, cam) {
  const art = scene.art;
  const s = cam ? tileS : [0.3, 0.42, 0.6, 0.85, 1.2, 1.7].find(v => v >= z * 0.92) || 1.7;
  if (!cam && (s !== tileS || tileKey !== art.map.id)) { tiles.clear(); tileS = s; tileKey = art.map.id; }
  const k = z / tileS, wx0 = cx - Wd / 2 / z, wy0 = cy - Hd / 2 / z;
  const i0 = Math.floor((wx0 * tileS) / TILE), j0 = Math.floor((wy0 * tileS) / TILE), i1 = Math.floor(((cx + Wd / 2 / z) * tileS) / TILE), j1 = Math.floor(((cy + Hd / 2 / z) * tileS) / TILE);
  g.imageSmoothingEnabled = true;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const t = tileFor(art, tileS, i, j);
    if (t) g.drawImage(t, Math.floor(((i * TILE) / tileS - wx0) * z), Math.floor(((j * TILE) / tileS - wy0) * z), Math.ceil(TILE * k) + 1, Math.ceil(TILE * k) + 1);
  }
}

// ---------- 배경 ----------
let starField = null;
function drawBackground(g, Wd, Hd, cx, cy) {
  const o = scene.art?.theme?.outside || 'space';
  if (o === 'sky') {
    const gr = g.createLinearGradient(0, 0, 0, Hd); gr.addColorStop(0, '#5fb0e8'); gr.addColorStop(1, '#bfe3fb');
    g.fillStyle = gr; g.fillRect(0, 0, Wd, Hd);
    g.fillStyle = 'rgba(255,255,255,.75)';
    for (let i = 0; i < 9; i++) {
      const x = ((hash2(i, 1) * 3000 + tNow * 0.012 * (1 + i % 3) - cx * 0.08) % (Wd + 600) + Wd + 600) % (Wd + 600) - 300, y = hash2(i, 2) * Hd;
      for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(x + k * 60, y + Math.sin(k) * 14, 90, 38, 0, 0, TAU); g.fill(); }
    }
    return;
  }
  const base = { snow: '#232a38', jungle: '#10261a', ocean: '#1a4f7a' }[o] || '#000';
  g.fillStyle = base; g.fillRect(0, 0, Wd, Hd);
  if (o === 'ocean') {
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 3;
    for (let i = 0; i < 26; i++) { const x = ((hash2(i, 5) * 4000 - cx * 0.3) % Wd + Wd) % Wd, y = ((hash2(i, 6) * 3000 - cy * 0.3 + tNow * 0.01) % Hd + Hd) % Hd; g.beginPath(); g.arc(x, y, 30, 0.2, 2.9); g.stroke(); }
    return;
  }
  if (o !== 'space') return;
  starField ||= Array.from({ length: 220 }, (_, i) => [hash2(i, 9), hash2(i, 10), hash2(i, 11) * 2.2 + 0.6, 0.02 + hash2(i, 12) * 0.08]);
  for (const [x, y, r, par] of starField) {
    g.fillStyle = `rgba(255,255,255,${0.4 + r / 4})`;
    g.fillRect(((x * Wd - cx * par) % Wd + Wd) % Wd, ((y * Hd - cy * par) % Hd + Hd) % Hd, r, r);
  }
}

// ---------- 동적 그리기 ----------
function drawDoors(g, cx, cy, Wd, Hd, z) {
  for (const d of scene.map.doors || []) {
    if (d.x > cx + Wd / 2 / z + 50 || d.x + d.w < cx - Wd / 2 / z - 50 || d.y > cy + Hd / 2 / z + 200 || d.y + d.h < cy - Hd / 2 / z - 50) continue;
    const closed = scene.doorsClosed.has(d.id), horiz = d.w >= d.h;
    g.save();
    if (closed) {
      const gr = horiz ? g.createLinearGradient(0, d.y - 60, 0, d.y + d.h) : g.createLinearGradient(d.x, 0, d.x + d.w, 0);
      gr.addColorStop(0, '#9aa6ad'); gr.addColorStop(1, '#5d686e');
      g.fillStyle = '#1e2428'; g.fillRect(d.x - 4, d.y - (horiz ? 70 : 4), d.w + 8, d.h + (horiz ? 74 : 8));
      g.fillStyle = gr; g.fillRect(d.x, d.y - (horiz ? 64 : 0), d.w, d.h + (horiz ? 64 : 0));
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 4;
      if (horiz) { g.beginPath(); g.moveTo(d.x + d.w / 2, d.y - 64); g.lineTo(d.x + d.w / 2, d.y + d.h); g.stroke(); }
      else { g.beginPath(); g.moveTo(d.x, d.y + d.h / 2); g.lineTo(d.x + d.w, d.y + d.h / 2); g.stroke(); }
      g.fillStyle = Math.sin(tNow / 150) > 0 ? '#ff3030' : '#801010';
      g.beginPath(); g.arc(d.x + d.w / 2, d.y + (horiz ? -40 : d.h / 2), 8, 0, TAU); g.fill();
    } else {
      g.fillStyle = '#4b555b';
      if (horiz) { g.fillRect(d.x - 6, d.y - 30, 18, d.h + 30); g.fillRect(d.x + d.w - 12, d.y - 30, 18, d.h + 30); }
      else { g.fillRect(d.x, d.y - 6, d.w, 18); g.fillRect(d.x, d.y + d.h - 12, d.w, 18); }
    }
    g.restore();
  }
}
function lookOf(p) { return scene.mixup || p.disguise ? p.disguise?.look || p.look : p.look; }
function drawPlayer(g, p, alpha = 1) {
  const mv = moves.get(p.id);
  let x = p.x, y = p.y, lift = 0;
  if (mv) {
    const t = Math.min(1, (tNow - mv.t0) / mv.ms);
    x = mv.from.x + (mv.to.x - mv.from.x) * t; y = mv.from.y + (mv.to.y - mv.from.y) * t;
    if (mv.kind === 'zipline') lift = 120 * Math.sin(t * Math.PI);
    if (mv.kind === 'ladder') lift = Math.abs(Math.sin(t * 20)) * 6;
  }
  const look = lookOf(p) || {}, ghost = !!p.dead;
  const frame = p.mv && !ghost ? 1 + (Math.floor(p.anim * 11) % 6) : 0;
  const c = crewSprite(look, { frame, flip: !p.dir, ghost });
  const w = CREW_BOX.w * CREW_SC, hh = CREW_BOX.h * CREW_SC;
  g.save();
  g.globalAlpha = alpha;
  if (!ghost) { g.fillStyle = 'rgba(0,0,0,.25)'; ell(g, x, y + 2, 52, 16); g.fill(); }
  if (p.id === scene.killId) { g.strokeStyle = '#ff2020'; g.lineWidth = 7; ell(g, x, y + 2, 70, 24); g.stroke(); }
  if (p.id === scene.abilityId) { g.strokeStyle = scene.abilityColor; g.lineWidth = 6; ell(g, x, y + 2, 68, 22); g.stroke(); }
  const pet = !ghost && petSprite(look);
  if (pet) g.drawImage(pet, x + (p.dir ? -165 : 85), y - 70 - lift * 0.5 + Math.abs(Math.sin(p.anim * 9)) * -6, 80, 75);
  const fy = ghost ? Math.sin(tNow / 400 + (p.id?.length || 0)) * 8 : 0;
  if (c) g.drawImage(c, x - CREW_BOX.cx * CREW_SC, y - CREW_BOX.foot * CREW_SC - lift + fy, w, hh);
  if (p.shield) {
    const gr = g.createRadialGradient(x, y - 80, 30, x, y - 80, 120); gr.addColorStop(0, 'rgba(120,200,255,0)'); gr.addColorStop(1, 'rgba(120,200,255,.45)');
    g.fillStyle = gr; ell(g, x, y - 80, 110, 120); g.fill();
  }
  const vis = scene.visuals.get(p.id);
  if (vis?.scan) {
    g.fillStyle = 'rgba(60,255,120,.3)'; g.fillRect(x - 70, y - 180, 140, 190);
    g.fillStyle = 'rgba(140,255,170,.95)'; g.fillRect(x - 70, y - 180 + ((tNow / 5) % 190), 140, 6);
  }
  const name = scene.mixup ? '' : p.disguise?.name ?? p.name;
  if (name && !scene.hideNames) {
    g.font = `800 36px ${FONT}`; g.textAlign = 'center'; g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.85)';
    g.fillStyle = scene.redNames.has(p.id) ? '#ff2a2a' : ghost ? 'rgba(255,255,255,.75)' : '#fff';
    g.strokeText(name, x, y - NAME_Y - lift + fy); g.fillText(name, x, y - NAME_Y - lift + fy);
    if (settings.colorblind && !ghost) { g.font = `700 26px ${FONT}`; const cn = COLORS[look.color]?.[0] || ''; g.strokeText(cn, x, y + 40); g.fillText(cn, x, y + 40); }
  }
  g.restore();
}
function drawBody(g, b) {
  const c = crewSprite(b.look || {}, { dead: true });
  g.save();
  if (b.stage) g.globalAlpha = Math.max(0.15, 1 - b.stage * 0.28);
  if (c) g.drawImage(c, b.x - CREW_BOX.cx * CREW_SC, b.y - CREW_BOX.foot * CREW_SC + 12, CREW_BOX.w * CREW_SC, CREW_BOX.h * CREW_SC);
  if (b.stage) { g.fillStyle = 'rgba(120,255,60,.35)'; ell(g, b.x, b.y, 80, 26); g.fill(); }
  if (scene.reportId === b.id) { g.strokeStyle = '#ffe600'; g.lineWidth = 7; ell(g, b.x, b.y, 95, 34); g.stroke(); }
  g.restore();
}
function drawHighlight(g) {
  const m = scene.map, id = scene.hl;
  for (const sid of scene.taskStations) {
    const s = m.stations?.[sid];
    if (!s || sid === id) continue;
    g.strokeStyle = 'rgba(255,230,0,.55)'; g.lineWidth = 5; rr(g, s.x - 52, s.y - 50, 104, 84, 10); g.stroke();
  }
  for (const sid of scene.sabTargets) {
    const s = m.stations?.[sid];
    if (!s) continue;
    g.strokeStyle = Math.sin(tNow / 160) > 0 ? '#ff3030' : '#ff9090'; g.lineWidth = 7; rr(g, s.x - 56, s.y - 54, 112, 92, 12); g.stroke();
  }
  if (!id) return;
  const s = m.stations?.[id] || (id === 'button' && m.button) || m.vents?.[id] || m.transports?.find(t => t.id === id)?.a || m.doors?.find(d => d.id === id);
  if (!s) return;
  g.strokeStyle = m.vents?.[id] ? '#ff4040' : '#ffef00'; g.lineWidth = 9;
  if (s.w) { g.strokeRect(s.x - 10, s.y - 10, s.w + 20, s.h + 20); return; }
  rr(g, s.x - 66, s.y - 64, 132, 112, 14); g.stroke();
}
function drawEffects(g) {
  for (const e of effects) {
    const t = (tNow - e.t0) / 1000;
    if (e.kind === 'poof' && t < 0.9) {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU, r = 30 + t * 160;
        g.fillStyle = e.acid ? `rgba(120,255,80,${0.5 * (1 - t / 0.9)})` : `rgba(220,220,220,${0.6 * (1 - t / 0.9)})`;
        g.beginPath(); g.arc(e.x + Math.cos(a) * r, e.y - 80 + Math.sin(a) * r * 0.6, 40 + t * 30, 0, TAU); g.fill();
      }
    } else if (e.kind === 'kill' && t < 0.7) {
      g.strokeStyle = e.acid ? `rgba(120,255,60,${1 - t / 0.7})` : `rgba(255,40,40,${1 - t / 0.7})`; g.lineWidth = 10;
      g.beginPath(); g.arc(e.x, e.y - 60, 60 + t * 220, 0, TAU); g.stroke();
    } else if (e.kind === 'shieldHit' && t < 0.8) {
      const p = scene.players.get(e.id);
      if (!p) continue;
      g.strokeStyle = `rgba(120,200,255,${1 - t / 0.8})`; g.lineWidth = 12;
      g.beginPath(); for (let i = 0; i <= 6; i++) { const a = (i / 6) * TAU; const r = 120 + t * 80; g.lineTo(p.x + Math.cos(a) * r, p.y - 80 + Math.sin(a) * r); } g.stroke();
    } else if (e.kind === 'noise' && t < 1.5) {
      for (let k = 0; k < 3; k++) { const tt = (t + k * 0.35) % 1.05; g.strokeStyle = `rgba(255,50,50,${1 - tt})`; g.lineWidth = 9; g.beginPath(); g.arc(e.x, e.y - 40, 40 + tt * 360, 0, TAU); g.stroke(); }
    } else if ((e.kind === 'ventIn' || e.kind === 'ventOut') && t < 0.5) {
      const v = scene.map.vents?.[e.vent] || { x: e.x, y: e.y }, p = scene.players.get(e.id);
      if (!v || v.x == null) continue;
      drawVent(g, v.x, v.y, Math.sin(Math.min(1, t / 0.35) * Math.PI) * 26);
      if (p) {
        const k = e.kind === 'ventIn' ? 1 - Math.min(1, t / 0.35) : Math.min(1, t / 0.35);
        const c = crewSprite(lookOf(p) || {}, { flip: !p.dir });
        if (c && k > 0.02) { g.save(); g.translate(v.x, v.y); g.scale(1, k); g.drawImage(c, -CREW_BOX.cx * CREW_SC, -CREW_BOX.foot * CREW_SC, CREW_BOX.w * CREW_SC, CREW_BOX.h * CREW_SC); g.restore(); }
      }
    }
  }
}
// 세계 그리기 (메인 화면과 보안 카메라 공용)
function drawWorld(g, Wd, Hd, cx, cy, z, o = {}) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawBackground(g, Wd, Hd, cx, cy);
  if (!scene.art) return;
  drawTiles(g, Wd, Hd, cx, cy, z, o.cam);
  g.setTransform(z, 0, 0, z, Wd / 2 - cx * z, Hd / 2 - cy * z);
  drawDoors(g, cx, cy, Wd, Hd, z);
  if (!o.cam) drawHighlight(g);
  const vx0 = cx - Wd / 2 / z - 300, vx1 = cx + Wd / 2 / z + 300, vy0 = cy - Hd / 2 / z - 300, vy1 = cy + Hd / 2 / z + 400;
  const inView = (x, y) => x > vx0 && x < vx1 && y > vy0 && y < vy1;
  for (const b of scene.bodies) if (inView(b.x, b.y) && (o.cam || scene.canSee(b))) drawBody(g, b);
  const list = [];
  for (const p of scene.art.tall) if (hit(p.sb, vx0, vy0, vx1, vy1)) list.push({ k: p.key, prop: p });
  const viewer = scene.viewId ?? scene.meId;
  for (const p of scene.players.values()) {
    if (!inView(p.x, p.y)) continue;
    const self = p.id === viewer || p.id === scene.meId;
    if (p.vent) continue;
    if (p.dead && !scene.ghost && !self) continue;
    if (!self && !o.cam && !scene.canSee(p)) continue;
    if (p.invisible && !self) continue;
    list.push({ k: p.y, p, a: p.invisible ? 0.35 : 1 });
  }
  if (scene.map.button && scene.map.id !== 'lobby') list.push({ k: scene.map.button.y + 100, button: scene.map.button });
  list.sort((a, b) => a.k - b.k);
  const s = Math.max(0.3, Math.min(2, z * 1.1));
  for (const it of list) {
    if (it.p) drawPlayer(g, it.p, it.a);
    else if (it.button) drawButton(g, it.button);
    else { const sp = propSprite(it.prop, scene.art, s); g.drawImage(sp.c, sp.x, sp.y, sp.w, sp.h); }
  }
  drawEffects(g);
}
function drawButton(g, b) {
  g.fillStyle = '#ffb800'; ell(g, b.x, b.y - 30, 66, 40); g.fill();
  g.fillStyle = '#2b2b2b'; ell(g, b.x, b.y - 34, 54, 32); g.fill();
  g.fillStyle = '#9b1515'; ell(g, b.x, b.y - 38, 44, 26); g.fill();
  g.fillStyle = '#e53935'; ell(g, b.x, b.y - 46, 44, 26); g.fill();
  g.fillStyle = 'rgba(255,255,255,.35)'; ell(g, b.x - 12, b.y - 54, 16, 7); g.fill();
}

// 시야(그림자) 레이어
function drawFog(viewer) {
  const R = scene.visionR() * (scene.lightsOut ? 1 + Math.sin(tNow / 60) * 0.04 : 1);
  const cl = scene.doorsClosed;
  const pts = visionPoly(scene.map, viewer.x, viewer.y - 50, R, cl, 260);
  fg.setTransform(1, 0, 0, 1, 0, 0);
  fg.globalCompositeOperation = 'source-over';
  fg.clearRect(0, 0, W, H);
  fg.fillStyle = scene.flashlight?.on ? 'rgba(2,3,6,.94)' : 'rgba(6,8,14,.8)';
  fg.fillRect(0, 0, W, H);
  fg.globalCompositeOperation = 'destination-out';
  fg.setTransform(zoom, 0, 0, zoom, W / 2 - cam.x * zoom, H / 2 - cam.y * zoom);
  const cx = viewer.x, cy = viewer.y - 50;
  // 위쪽 벽면이 보이도록 위로 향한 광선은 조금 더 연장
  fg.beginPath();
  pts.forEach(([x, y], i) => {
    const dx = x - cx, dy = y - cy, L = Math.hypot(dx, dy) || 1;
    if (dy / L < -0.35 && L < R - 5) { const e = Math.min(R - L, 200); x += (dx / L) * e; y += (dy / L) * e; }
    i ? fg.lineTo(x, y) : fg.moveTo(x, y);
  });
  fg.closePath();
  const gr = fg.createRadialGradient(cx, cy, settings.lighting ? R * 0.6 : R * 0.97, cx, cy, R);
  gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  fg.fillStyle = gr; fg.fill();
  fg.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(fog, 0, 0);
}
function edgeArrow(x, y, color, size = 1) {
  const [sx, sy] = scene.toScreen(x, y);
  if (sx > 40 && sx < W - 40 && sy > 40 && sy < H - 40) return;
  const a = Math.atan2(sy - H / 2, sx - W / 2), r = Math.min(W, H) / 2 - 60 * size;
  ctx.save(); ctx.translate(W / 2 + Math.cos(a) * r * (W / Math.min(W, H)) * 0.9, H / 2 + Math.sin(a) * r); ctx.rotate(a);
  ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 3 * size;
  ctx.beginPath(); ctx.moveTo(34 * size, 0); ctx.lineTo(-20 * size, -26 * size); ctx.lineTo(-20 * size, 26 * size); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
function draw() {
  const m = scene.map, viewer = scene.players.get(scene.viewId ?? scene.meId);
  const lobby = m === LOBBY || m.id === 'lobby';
  if (lobby) { zoom = Math.min(H / 1000, W / 1500); cam.x = 700; cam.y = 560; }
  else {
    zoom = H / 1350;
    if (viewer) {
      const mv = moves.get(viewer.id);
      const vx = mv ? mv.from.x + (mv.to.x - mv.from.x) * Math.min(1, (tNow - mv.t0) / mv.ms) : viewer.x, vy = mv ? mv.from.y + (mv.to.y - mv.from.y) * Math.min(1, (tNow - mv.t0) / mv.ms) : viewer.y;
      cam.x += (vx - cam.x) * 0.35; cam.y += (vy - 60 - cam.y) * 0.35;
      if (Math.hypot(vx - cam.x, vy - 60 - cam.y) > 1500) { cam.x = vx; cam.y = vy - 60; }
    }
  }
  buildBudget = 4;
  drawWorld(ctx, W, H, cam.x, cam.y, zoom);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!lobby && viewer && !scene.ghost) drawFog(viewer);
  // 벤트 안: 연결된 벤트 방향 화살표
  scene.arrows = [];
  if (scene.inVent && viewer) {
    const v = m.vents?.[scene.inVent];
    for (const id of v?.links || []) {
      const t = m.vents[id], a = Math.atan2(t.y - v.y, t.x - v.x), [sx, sy] = scene.toScreen(v.x + Math.cos(a) * 240, v.y + Math.sin(a) * 240);
      scene.arrows.push({ id, sx, sy });
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(a); ctx.fillStyle = '#ff3b3b'; ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
      const k = Math.max(0.6, zoom);
      ctx.beginPath(); ctx.moveTo(56 * k, 0); ctx.lineTo(-30 * k, -44 * k); ctx.lineTo(-30 * k, 44 * k); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  const k = Math.max(0.7, zoom);
  for (const id of scene.sabTargets) { const s = m.stations?.[id]; if (s) edgeArrow(s.x, s.y, '#ff3030', k); }
  for (const t of scene.tracks || []) if (isFinite(t.x)) edgeArrow(t.x, t.y, t.color || '#4fe3cf', k);
  for (const n of scene.noises || []) edgeArrow(n.x, n.y, n.ping ? '#ff8c00' : '#ff2020', k);
  if (scene.lightsOut && !scene.ghost) { ctx.fillStyle = `rgba(0,0,0,${0.08 + Math.random() * 0.04})`; ctx.fillRect(0, 0, W, H); }
}

function loop(t) {
  raf = requestAnimationFrame(loop);
  const minDt = settings.fps ? 1000 / settings.fps - 2 : 0;
  if (t - last < minDt) return;
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t; tNow = t;
  update(dt);
  try { draw(); } catch (e) { console.error('그리기 오류', e); }
}
export { LOBBY };
