// 캔버스 장면: 맵 그리기, 이동/충돌, 시야, 플레이어 그리기
import { SKELD, LOBBY, canStand } from '../shared/maps.js';
import { COLORS } from '../shared/data.js';
import { crewImg, petImg, CREW_BOX } from '../ui/crew.js';
import { settings } from '../core.js';

const cv = document.getElementById('world');
const ctx = cv.getContext('2d');
const fog = document.createElement('canvas'), fg = fog.getContext('2d');
let W = 0, H = 0, zoom = 1, cam = { x: 0, y: 0 }, raf = 0, last = 0, sendT = 0, lastSent = '';
const SC = 1.3; // 크루원 크기
export const SPEED = 430;

function resize() {
  const r = settings.resolution * Math.min(devicePixelRatio || 1, 2);
  W = cv.width = fog.width = Math.round(innerWidth * r);
  H = cv.height = fog.height = Math.round(innerHeight * r);
}
addEventListener('resize', resize);
addEventListener('settings', resize);

function pat(base, line, checker) {
  const c = document.createElement('canvas'); c.width = c.height = 100;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 100, 100);
  if (checker) { g.fillStyle = line; g.fillRect(0, 0, 50, 50); g.fillRect(50, 50, 50, 50); }
  else { g.strokeStyle = line; g.lineWidth = 3; g.strokeRect(1, 1, 98, 98); g.beginPath(); g.moveTo(50, 0); g.lineTo(50, 100); g.stroke(); }
  return ctx.createPattern(c, 'repeat');
}
const FLOOR = {
  cafe: pat('#cdc7b2', '#bdb7a1', true), metal: pat('#8d989e', '#7a858b'), eng: pat('#7e8b90', '#6b777c'), reactor: pat('#6b7884', '#5b6772'),
  med: pat('#a8bcc4', '#93a7af'), admin: pat('#8f8e79', '#7c7b67'), storage: pat('#958f7d', '#827c6a'), elec: pat('#6f7b73', '#5e6962'),
  ship: pat('#8f989d', '#c9b44d'), hall: pat('#848e93', '#737c81'),
};

export const scene = {
  map: LOBBY, players: new Map(), meId: null, bodies: [], visuals: new Map(),
  joy: { x: 0, y: 0 }, keys: new Set(), touch: null,
  ghost: false, vision: 1, lightsOut: false, inVent: null, frozen: false, speed: 1,
  hl: null, killId: null, reportId: null, arrows: [], sabTargets: [], redNames: new Set(),
  onMove: null, onArrow: null,
  get me() { return this.players.get(this.meId); },
  start(map) {
    this.map = map; cv.style.display = 'block'; resize();
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  },
  stop() { cancelAnimationFrame(raf); raf = 0; cv.style.display = 'none'; this.players.clear(); this.bodies = []; },
  setPlayer(p) {
    const old = this.players.get(p.id);
    this.players.set(p.id, { anim: 0, dir: 1, mv: 0, ...old, ...p, tx: p.x ?? old?.x, ty: p.y ?? old?.y });
  },
  teleport(id, x, y) { const p = this.players.get(id); if (p) { p.x = p.tx = x; p.y = p.ty = y; } },
  visionR() { return 560 * this.vision * (this.lightsOut ? 0.3 : 1); },
  dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); },
  canSee(p) { const me = this.me; return !me || this.ghost || this.map === LOBBY || this.dist(me, p) < this.visionR() + 40; },
  toScreen(x, y) { return [(x - cam.x) * zoom + W / 2, (y - cam.y) * zoom + H / 2]; },
};

// ---------- 입력 ----------
const KEYMAP = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') return; if (KEYMAP[e.code]) { scene.keys.add(e.code); e.preventDefault(); } });
addEventListener('keyup', e => scene.keys.delete(e.code));
addEventListener('blur', () => scene.keys.clear());
const pointerTo = e => {
  const r = cv.getBoundingClientRect(), me = scene.me;
  if (!me) return null;
  const [sx, sy] = scene.toScreen(me.x, me.y - 70);
  return [(e.clientX - r.left) * (W / r.width) - sx, (e.clientY - r.top) * (H / r.height) - sy];
};
cv.addEventListener('pointerdown', e => {
  const r = cv.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width), py = (e.clientY - r.top) * (H / r.height);
  const a = scene.arrows.find(a => Math.hypot(a.sx - px, a.sy - py) < 60 * zoom + 30);
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
  const me = scene.me;
  if (me && !scene.frozen && !scene.inVent) {
    const [ix, iy] = inputVec(), sp = SPEED * scene.speed * (scene.ghost ? 1.25 : 1) * dt;
    const moving = Math.hypot(ix, iy) > 0.1;
    if (moving) {
      const nx = me.x + ix * sp, ny = me.y + iy * sp, m = scene.map;
      if (scene.ghost) { me.x = Math.max(0, Math.min(m.w, nx)); me.y = Math.max(0, Math.min(m.h, ny)); }
      else {
        if (canStand(m, nx, me.y)) me.x = nx;
        if (canStand(m, me.x, ny)) me.y = ny;
      }
      if (Math.abs(ix) > 0.15) me.dir = ix > 0 ? 1 : 0;
    }
    me.mv = moving ? 1 : 0;
    me.tx = me.x; me.ty = me.y;
  }
  for (const p of scene.players.values()) {
    if (p.id !== scene.meId) { const k = Math.min(1, dt * 12); p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; }
    p.anim = p.mv ? p.anim + dt : 0;
  }
  sendT += dt;
  if (me && sendT > 0.066 && scene.onMove) {
    sendT = 0;
    const s = `${me.x | 0},${me.y | 0},${me.dir},${me.mv}`;
    if (s !== lastSent) { lastSent = s; scene.onMove(me.x, me.y, me.dir, me.mv); }
  }
}

// ---------- 그리기 ----------
const path = poly => { ctx.beginPath(); poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
let starField = null;
function drawStars() {
  if (!starField) starField = Array.from({ length: 160 }, () => [Math.random(), Math.random(), Math.random() * 2 + 1]);
  ctx.fillStyle = '#fff';
  for (const [x, y, r] of starField) ctx.fillRect(((x * W - cam.x * 0.05 * zoom) % W + W) % W, ((y * H - cam.y * 0.05 * zoom) % H + H) % H, r, r);
}
function drawMap(m) {
  ctx.lineJoin = 'round';
  for (const p of m.walk) { path(p); ctx.strokeStyle = '#2b3236'; ctx.lineWidth = 90; ctx.stroke(); }
  for (const p of m.walk) { path(p); ctx.strokeStyle = '#59646a'; ctx.lineWidth = 50; ctx.stroke(); }
  for (const h of m.halls) { path(h); ctx.fillStyle = FLOOR.hall; ctx.fill(); }
  for (const r of m.rooms) { path(r.poly); ctx.fillStyle = FLOOR[r.floor] || FLOOR.metal; ctx.fill(); }
  if (m === LOBBY) drawLobbyWall();
  // 방 이름 (바닥에 흐릿하게)
  if (m === SKELD) {
    ctx.font = 'bold 60px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,.12)';
    for (const r of m.rooms) ctx.fillText(r.name, r.label.x, r.label.y + 20);
  }
  for (const id in m.vents) drawVent(m.vents[id], scene.hl === id);
  for (const id in m.stations) drawStation(id, m.stations[id]);
  for (const o of m.obstacles) drawObstacle(o);
  if (m === SKELD) {
    const b = m.button;
    ctx.fillStyle = '#ffcc00'; ctx.beginPath(); ctx.arc(b.x, b.y, 62, 0, 7); ctx.fill();
    ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(b.x, b.y, 50, 0, 7); ctx.fill();
    ctx.fillStyle = '#d61f1f'; ctx.beginPath(); ctx.arc(b.x, b.y - 6, 40, 0, 7); ctx.fill();
    if (scene.hl === 'button') { ctx.strokeStyle = '#ff0'; ctx.lineWidth = 8; ctx.stroke(); }
  }
}
function drawLobbyWall() {
  ctx.fillStyle = '#b9c2c7'; ctx.fillRect(150, 110, 1100, 220);
  ctx.fillStyle = '#5d676c'; ctx.fillRect(150, 300, 1100, 30);
  ctx.fillStyle = '#3f474b'; ctx.fillRect(610, 130, 180, 200); ctx.fillStyle = '#717b80'; ctx.fillRect(630, 150, 140, 170);
  ctx.strokeStyle = '#3f474b'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(700, 150); ctx.lineTo(700, 320); ctx.stroke();
  for (const side of [0, 1]) for (let i = 0; i < 5; i++) {
    const x = side ? 870 + i * 70 : 200 + i * 70, y = 220 - (side ? 4 - i : i) * 16;
    ctx.fillStyle = '#2f5c8f'; ctx.fillRect(x, y, 50, 70); ctx.fillStyle = '#4c84c4'; ctx.fillRect(x + 6, y + 6, 38, 34);
  }
}
function drawVent(v, hl) {
  ctx.save(); ctx.translate(v.x, v.y);
  ctx.fillStyle = '#2c3336'; ctx.fillRect(-55, -30, 110, 60);
  ctx.strokeStyle = hl ? '#ff3b3b' : '#59656b'; ctx.lineWidth = hl ? 8 : 5; ctx.strokeRect(-55, -30, 110, 60);
  ctx.fillStyle = '#4b555a'; for (let i = -40; i <= 30; i += 18) ctx.fillRect(i, -22, 8, 44);
  ctx.restore();
}
function drawStation(id, s) {
  const mine = scene.taskStations?.has(id), sab = scene.sabTargets.includes(id), hl = scene.hl === id;
  if (scene.map === LOBBY) { if (hl) { ctx.strokeStyle = '#ff0'; ctx.lineWidth = 8; ctx.strokeRect(s.x - 75, s.y - 150, 150, 120); } return; }
  ctx.save(); ctx.translate(s.x, s.y);
  ctx.fillStyle = '#4a565c'; ctx.fillRect(-40, -34, 80, 56);
  ctx.fillStyle = sab ? '#c62828' : '#1f6f5a'; ctx.fillRect(-30, -26, 60, 32);
  if (mine || sab || hl) { ctx.strokeStyle = hl ? '#ffff00' : sab ? '#ff4040' : 'rgba(255,230,0,.8)'; ctx.lineWidth = hl ? 9 : 5; ctx.strokeRect(-44, -38, 88, 64); }
  ctx.restore();
}
function drawObstacle(o) {
  ctx.save();
  if (o.table) {
    ctx.strokeStyle = '#2f5d93'; ctx.lineWidth = 46;
    for (let a = 0; a < 4; a++) { ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 34, a * 1.57 + 0.25, a * 1.57 + 1.3); ctx.stroke(); }
    ctx.fillStyle = '#3f6fae'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.fill();
    ctx.fillStyle = '#5d8fd0'; ctx.beginPath(); ctx.arc(o.x, o.y - 8, o.r - 18, 0, 7); ctx.fill();
  } else if (o.engine) {
    ctx.fillStyle = '#59646a'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.fill();
    ctx.fillStyle = '#9aa5aa'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.78, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff8a2a'; ctx.beginPath(); ctx.arc(o.x - o.r * 0.9, o.y, o.r * 0.3, 0, 7); ctx.fill();
  } else if (o.core) {
    const g = ctx.createRadialGradient(o.x, o.y, 10, o.x, o.y, o.r);
    g.addColorStop(0, '#d9fbff'); g.addColorStop(0.5, '#3fb6e6'); g.addColorStop(1, '#1d4f6b');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.fill();
  } else if (o.map) {
    ctx.fillStyle = '#26343e'; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#3ef08a'; ctx.lineWidth = 4; ctx.strokeRect(o.x - 70, o.y - 40, 140, 80);
  } else if (o.crate) {
    ctx.fillStyle = '#2d5a43'; ctx.fillRect(o.x, o.y, o.w, o.h);
    ctx.fillStyle = '#3f7a5b'; ctx.fillRect(o.x + 8, o.y + 8, o.w - 16, o.h * 0.45);
    ctx.strokeStyle = '#1c3a2b'; ctx.lineWidth = 6; ctx.strokeRect(o.x, o.y, o.w, o.h);
    if (o.laptop) { ctx.fillStyle = '#ccc'; ctx.fillRect(o.x + 20, o.y - 50, 80, 50); ctx.fillStyle = '#2a9d5a'; ctx.fillRect(o.x + 28, o.y - 44, 64, 36); }
    if (o.box) { ctx.fillStyle = '#222'; ctx.fillRect(o.x + 35, o.y - 50, 50, 44); ctx.fillRect(o.x + 22, o.y - 10, 76, 12); }
  }
  ctx.restore();
}
function drawPlayer(p) {
  const fr = p.mv ? 1 + (Math.floor(p.anim * 8) % 2) : 0;
  const img = crewImg(p.look, { frame: fr, flip: !p.dir, ghost: p.dead });
  const w = CREW_BOX.w * SC, hh = CREW_BOX.h * SC, bob = p.mv ? Math.abs(Math.sin(p.anim * 16)) * 6 : 0;
  ctx.save();
  if (p.id === scene.killId) { ctx.fillStyle = 'rgba(255,0,0,.45)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 70, 24, 0, 0, 7); ctx.fill(); }
  else if (!p.dead) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 50, 16, 0, 0, 7); ctx.fill(); }
  const pet = petImg(p.look);
  if (pet?.naturalWidth && !p.dead) ctx.drawImage(pet, p.x + (p.dir ? -150 : 80), p.y - 66 + bob * 0.5, 70, 64);
  if (img.naturalWidth) ctx.drawImage(img, p.x - CREW_BOX.cx * SC, p.y - CREW_BOX.foot * SC - bob, w, hh);
  const vis = scene.visuals.get(p.id);
  if (vis?.scan) {
    ctx.fillStyle = 'rgba(60,255,120,.35)'; ctx.fillRect(p.x - 70, p.y - 160, 140, 170);
    ctx.fillStyle = 'rgba(120,255,160,.9)'; ctx.fillRect(p.x - 70, p.y - 160 + ((performance.now() / 6) % 170), 140, 6);
  }
  ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#000';
  const ny = p.y - 165 * SC + 40;
  ctx.fillStyle = scene.redNames.has(p.id) ? '#ff2a2a' : p.dead ? 'rgba(255,255,255,.6)' : '#fff';
  ctx.strokeText(p.name, p.x, ny); ctx.fillText(p.name, p.x, ny);
  if (settings.colorblind) { ctx.font = 'bold 24px sans-serif'; ctx.strokeText(COLORS[p.look.color][0], p.x, p.y + 34); ctx.fillText(COLORS[p.look.color][0], p.x, p.y + 34); }
  ctx.restore();
}
function drawBody(b) {
  const img = crewImg(b.look, { dead: true, flip: false });
  if (img.naturalWidth) ctx.drawImage(img, b.x - CREW_BOX.cx * SC, b.y - CREW_BOX.foot * SC + 10, CREW_BOX.w * SC, CREW_BOX.h * SC);
  if (scene.reportId === b.id) { ctx.strokeStyle = '#ff0'; ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(b.x, b.y, 90, 34, 0, 0, 7); ctx.stroke(); }
}

function draw() {
  const m = scene.map, me = scene.me;
  if (m === LOBBY) { zoom = Math.min(H / 1000, W / 1500); cam.x = 700; cam.y = 560; }
  else { zoom = H / 1350; if (me) { cam.x = me.x; cam.y = me.y - 60; } }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  drawStars();
  ctx.setTransform(zoom, 0, 0, zoom, W / 2 - cam.x * zoom, H / 2 - cam.y * zoom);
  drawMap(m);
  for (const b of scene.bodies) if (scene.canSee(b)) drawBody(b);
  const list = [...scene.players.values()].filter(p => (p.id === scene.meId ? !p.vent : !p.vent && (!p.dead || scene.ghost) && scene.canSee(p))).sort((a, b) => a.y - b.y);
  for (const p of list) drawPlayer(p);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (m === SKELD && me && !scene.ghost) {
    const [sx, sy] = scene.toScreen(me.x, me.y - 60), r = scene.visionR() * zoom;
    fg.globalCompositeOperation = 'source-over'; fg.clearRect(0, 0, W, H);
    fg.fillStyle = 'rgba(0,0,0,.86)'; fg.fillRect(0, 0, W, H);
    fg.globalCompositeOperation = 'destination-out';
    const g = fg.createRadialGradient(sx, sy, settings.lighting ? r * 0.55 : r * 0.98, sx, sy, r);
    g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    fg.fillStyle = g; fg.beginPath(); fg.arc(sx, sy, r, 0, 7); fg.fill();
    ctx.drawImage(fog, 0, 0);
  }
  // 벤트 안: 연결된 벤트 방향 화살표
  scene.arrows = [];
  if (scene.inVent && me) {
    const v = m.vents[scene.inVent];
    for (const id of v.links) {
      const t = m.vents[id], a = Math.atan2(t.y - v.y, t.x - v.x), [sx, sy] = scene.toScreen(v.x + Math.cos(a) * 220, v.y + Math.sin(a) * 220);
      scene.arrows.push({ id, sx, sy });
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(a); ctx.fillStyle = '#ff3b3b'; ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(50 * zoom + 20, 0); ctx.lineTo(-30, -40 * zoom - 16); ctx.lineTo(-30, 40 * zoom + 16); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
  }
  // 사보타주 위치 화살표 (화면 가장자리)
  if (me && scene.sabTargets.length) {
    for (const id of scene.sabTargets) {
      const s = m.stations[id];
      if (!s) continue;
      const [sx, sy] = scene.toScreen(s.x, s.y);
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const a = Math.atan2(sy - H / 2, sx - W / 2), ex = W / 2 + Math.cos(a) * (Math.min(W, H) / 2 - 50), ey = H / 2 + Math.sin(a) * (Math.min(W, H) / 2 - 50);
      ctx.save(); ctx.translate(ex, ey); ctx.rotate(a); ctx.fillStyle = 'rgba(255,40,40,.9)';
      ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(-20, -24); ctx.lineTo(-20, 24); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }
}

function loop(t) {
  raf = requestAnimationFrame(loop);
  const minDt = settings.fps ? 1000 / settings.fps - 2 : 0;
  if (t - last < minDt) return;
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  update(dt);
  draw();
}
export { SKELD, LOBBY };
