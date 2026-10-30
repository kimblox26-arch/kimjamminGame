import { Sim, rocheLimit } from './sim.js';
import { EARTH_MASS, searchPlanets, spawnPlanet } from './planets.js';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const $search = document.getElementById('search');
const $results = document.getElementById('results');
const $pause = document.getElementById('pause');
const $speed = document.getElementById('speed');
const $speedLabel = document.getElementById('speed-label');
const $clear = document.getElementById('clear');
const $status = document.getElementById('status');
const $hint = document.getElementById('hint');

const sim = new Sim();
const VSCALE = 0.1;   // 속도 정하기: 화면 1px 끌 때마다 0.1 km/s
const BUDGET = 14;    // 한 프레임에 물리 계산에 쓰는 최대 시간(ms)

// ---------- 화면 ----------
let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
}
window.addEventListener('resize', resize);
resize();

const cam = { x: 0, y: 0, scale: 0.004 }; // scale: 화면 px / km
const toScreenX = (x) => (x - cam.x) * cam.scale + W / 2;
const toScreenY = (y) => (y - cam.y) * cam.scale + H / 2;
const toWorldX = (sx) => (sx - W / 2) / cam.scale + cam.x;
const toWorldY = (sy) => (sy - H / 2) / cam.scale + cam.y;
function zoomAt(sx, sy, f) {
  const wx = toWorldX(sx), wy = toWorldY(sy);
  cam.scale = Math.min(1, Math.max(1e-6, cam.scale * f));
  cam.x = wx - (sx - W / 2) / cam.scale;
  cam.y = wy - (sy - H / 2) / cam.scale;
}

// ---------- 구슬 색 · 그림 ----------
const palette = [];
const paletteIndex = new Map();
const sprites = [];
const byColor = [];
function colorId(hex) {
  let id = paletteIndex.get(hex);
  if (id !== undefined) return id;
  id = palette.length;
  palette.push(hex);
  paletteIndex.set(hex, id);
  sprites.push(makeSprite(hex));
  byColor.push([]);
  return id;
}
function makeSprite(hex) {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S * 0.36, S * 0.34, S * 0.04, S * 0.5, S * 0.5, S * 0.5);
  grad.addColorStop(0, mix(hex, '#ffffff', 0.55));
  grad.addColorStop(0.45, hex);
  grad.addColorStop(1, mix(hex, '#000000', 0.55));
  g.fillStyle = grad;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fill();
  return c;
}
function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
function addPlanet(def, x, y, vx, vy) {
  const same = sim.bodies.filter((b) => b.def.id === def.id).length;
  const name = same ? `${def.ko} ${same + 1}` : def.ko;
  const start = sim.n;
  spawnPlanet(sim, def, x, y, vx, vy, name, colorId);
  for (let i = start; i < sim.n; i++) byColor[sim.col[i]].push(i);
  clumps = sim.clumps(3);
}

// ---------- 검색 ----------
let placing = null;     // 놓으려고 고른 행성
let resultList = [];
function showResults() {
  resultList = searchPlanets($search.value);
  $results.innerHTML = '';
  for (const p of resultList) {
    const li = document.createElement('li');
    const color = (p.surface || p.layers[p.layers.length - 1].colors)[0];
    li.innerHTML = `<span class="dot" style="background:${color}"></span>` +
      `<span class="name">${p.ko} <small>${p.en}</small></span>` +
      `<span class="meta">지구 질량 ×${fmtNum(p.mass / EARTH_MASS)}<br>반지름 ${Math.round(p.radius).toLocaleString()} km</span>`;
    li.addEventListener('pointerdown', (e) => { e.preventDefault(); choose(p); });
    $results.appendChild(li);
  }
}
function fmtNum(v) { return v >= 10 ? v.toFixed(1) : v.toFixed(3); }
function choose(p) {
  placing = p;
  $results.innerHTML = '';
  $search.value = '';
  $search.blur();
  // 아직 아무것도 없으면 고른 행성이 잘 보이게 확대
  if (sim.n === 0) cam.scale = Math.min(W, H) * 0.08 / p.radius;
}
$search.addEventListener('focus', showResults);
$search.addEventListener('input', showResults);
$search.addEventListener('blur', () => setTimeout(() => { $results.innerHTML = ''; }, 100));
$search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && resultList.length) choose(resultList[0]);
  if (e.key === 'Escape') $search.blur();
  e.stopPropagation();
});

// ---------- 시간 ----------
let paused = false;
$pause.addEventListener('click', togglePause);
function togglePause() { paused = !paused; $pause.textContent = paused ? '▶' : '⏸'; }
const speed = () => Math.pow(10, +$speed.value); // 화면 1초당 시뮬레이션 초
function fmtDur(s) {
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}초`;
  if (s < 3600) return `${(s / 60).toFixed(s < 600 ? 1 : 0)}분`;
  if (s < 86400) return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)}시간`;
  return `${(s / 86400).toFixed(1)}일`;
}
function fmtClock(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return (d ? `${d}일 ` : '') + `${h}시간 ${m}분`;
}
const updateSpeedLabel = () => { $speedLabel.textContent = `1초 = ${fmtDur(speed())}`; };
$speed.addEventListener('input', updateSpeedLabel);
updateSpeedLabel();
$clear.addEventListener('click', () => {
  sim.reset();
  for (const l of byColor) l.length = 0;
  clumps = [];
  placing = null;
});

// ---------- 입력 ----------
const pointers = new Map();
let drag = null; // {mode:'pan'|'aim', ...}
let hover = null;
let pinch = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    drag = null;
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    return;
  }
  if (pointers.size > 2) return;
  if (placing && e.button === 0) {
    drag = { mode: 'aim', sx: e.clientX, sy: e.clientY, wx: toWorldX(e.clientX), wy: toWorldY(e.clientY), ex: e.clientX, ey: e.clientY };
  } else {
    drag = { mode: 'pan', lx: e.clientX, ly: e.clientY };
  }
});
canvas.addEventListener('pointermove', (e) => {
  hover = { x: e.clientX, y: e.clientY };
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    cam.x -= (cx - pinch.cx) / cam.scale; cam.y -= (cy - pinch.cy) / cam.scale;
    if (pinch.d > 0) zoomAt(cx, cy, d / pinch.d);
    pinch = { d, cx, cy };
    return;
  }
  if (!drag) return;
  if (drag.mode === 'pan') {
    cam.x -= (e.clientX - drag.lx) / cam.scale; cam.y -= (e.clientY - drag.ly) / cam.scale;
    drag.lx = e.clientX; drag.ly = e.clientY;
  } else {
    drag.ex = e.clientX; drag.ey = e.clientY;
  }
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && drag.mode === 'aim' && e.type === 'pointerup' && placing) {
    addPlanet(placing, drag.wx, drag.wy, (drag.ex - drag.sx) * VSCALE, (drag.ey - drag.sy) * VSCALE);
    placing = null;
  }
  drag = null;
  if (e.pointerType !== 'mouse') hover = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); togglePause(); }
  if (e.key === 'Escape') { placing = null; drag = null; }
  if (e.key === '/') { e.preventDefault(); $search.focus(); }
});

// ---------- 천체 덩어리 · 로슈 한계 ----------
let clumps = [];
function clumpName(c) {
  let best = null;
  for (const [org, m] of c.byOrg) {
    const b = sim.bodies[org];
    if (m >= 0.5 * b.mass && (!best || b.mass > best.mass)) best = b;
  }
  return best ? best.name : null;
}

// ---------- 그리기 ----------
function draw() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const { x, y, r } = sim;
  const s = cam.scale;
  for (let c = 0; c < byColor.length; c++) {
    const list = byColor[c];
    if (!list.length) continue;
    const img = sprites[c];
    ctx.fillStyle = palette[c];
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      const sr = r[i] * s;
      const sx = (x[i] - cam.x) * s + W / 2, sy = (y[i] - cam.y) * s + H / 2;
      if (sx < -sr || sy < -sr || sx > W + sr || sy > H + sr) continue;
      if (sr < 1.5) { const d = Math.max(1, 2 * sr); ctx.fillRect(sx - d / 2, sy - d / 2, d, d); }
      else ctx.drawImage(img, sx - sr, sy - sr, 2 * sr, 2 * sr);
    }
  }

  // 로슈 한계: 각 천체 주변, 가장 가까운 더 가벼운 천체의 밀도 기준
  ctx.lineWidth = 1;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.setLineDash([6, 6]);
  for (const a of clumps) {
    if (a.count < 20) continue;
    let near = null, nd = Infinity;
    for (const b of clumps) {
      if (b === a || b.mass >= a.mass) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d < nd) { nd = d; near = b; }
    }
    if (!near) continue;
    const rl = rocheLimit(a.mass, near.density);
    if (rl <= a.radius) continue;
    const sx = toScreenX(a.x), sy = toScreenY(a.y), sr = rl * s;
    ctx.strokeStyle = 'rgba(255,120,110,0.55)';
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,140,130,0.8)';
    ctx.fillText('로슈 한계', sx, sy + sr + 14);
  }
  ctx.setLineDash([]);

  // 이름
  ctx.fillStyle = '#e8eef6';
  for (const c of clumps) {
    const name = clumpName(c);
    if (!name) continue;
    ctx.fillText(name, toScreenX(c.x), toScreenY(c.y) - c.radius * s - 6);
  }

  // 놓을 행성 미리보기 + 속도 화살표
  if (placing) {
    const px = drag && drag.mode === 'aim' ? drag.sx : hover && hover.x;
    const py = drag && drag.mode === 'aim' ? drag.sy : hover && hover.y;
    if (px != null) {
      const sr = Math.max(2, placing.radius * s);
      ctx.strokeStyle = 'rgba(200,220,255,0.8)';
      ctx.beginPath(); ctx.arc(px, py, sr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#e8eef6';
      ctx.fillText(placing.ko, px, py - sr - 6);
      if (drag && drag.mode === 'aim') {
        const dx = drag.ex - drag.sx, dy = drag.ey - drag.sy, len = Math.hypot(dx, dy);
        if (len > 2) {
          ctx.strokeStyle = '#ffd36a'; ctx.fillStyle = '#ffd36a'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(drag.ex, drag.ey); ctx.stroke();
          const ux = dx / len, uy = dy / len;
          ctx.beginPath();
          ctx.moveTo(drag.ex, drag.ey);
          ctx.lineTo(drag.ex - ux * 10 - uy * 5, drag.ey - uy * 10 + ux * 5);
          ctx.lineTo(drag.ex - ux * 10 + uy * 5, drag.ey - uy * 10 - ux * 5);
          ctx.fill();
          ctx.fillText(`${(len * VSCALE).toFixed(1)} km/s`, drag.ex, drag.ey - 12);
          ctx.lineWidth = 1;
        }
      }
    }
  }

  drawScaleBar();
}

function drawScaleBar() {
  const target = 120 / cam.scale;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const km = [1, 2, 5, 10].map((k) => k * p).filter((v) => v <= target).pop();
  const len = km * cam.scale;
  const x0 = W - 16 - len, y0 = H - 16;
  ctx.strokeStyle = '#8796a8'; ctx.fillStyle = '#8796a8';
  ctx.beginPath(); ctx.moveTo(x0, y0 - 4); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.lineTo(x0 + len, y0 - 4); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillText(`${km.toLocaleString()} km`, x0 + len / 2, y0 - 6);
}

function updateText(rate) {
  $status.textContent = sim.n
    ? `경과 ${fmtClock(sim.time)}  ·  구슬 ${sim.n.toLocaleString()}개  ·  Δt ${sim.lastDt.toFixed(1)}초\n실제 진행 1초 = ${fmtDur(rate)}${paused ? '  (일시정지)' : ''}`
    : '';
  $hint.textContent = placing
    ? '놓을 곳을 누른 채 끌어서 속도·방향을 정하고 손을 떼세요 (그냥 누르면 정지 상태, Esc 취소)'
    : sim.n ? '' : '왼쪽 위 검색창에서 행성을 찾아 고르세요 · 끌기: 화면 이동 · 휠/두 손가락: 확대·축소';
}

// ---------- 루프 ----------
let last = performance.now(), frame = 0, rate = 0;
function loop(now) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused && sim.n > 0 && realDt > 0) {
    const want = speed() * realDt;
    const t0 = performance.now();
    let done = 0;
    while (want - done > 1e-3 && performance.now() - t0 < BUDGET) done += sim.step(want - done);
    rate = rate * 0.9 + (done / realDt) * 0.1;
  }
  if (++frame % 10 === 0) clumps = sim.clumps(3);
  draw();
  updateText(rate);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
