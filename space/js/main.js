import * as THREE from 'three';
import { Sim, rocheLimit } from './sim.js';
import { EARTH_MASS, searchPlanets, spawnPlanet } from './planets.js';

const canvas = document.getElementById('view');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const $search = document.getElementById('search');
const $count = document.getElementById('count');
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

// ---------- 3D 화면 ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setClearColor(0x000000);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 1, 1e7);
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(1, 1.2, 0.8);
scene.add(sun);

let W = 0, H = 0, dpr = 1;
function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  overlay.width = Math.round(W * dpr); overlay.height = Math.round(H * dpr);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// 카메라: 중심점(target) 둘레를 도는 방식. 화면에는 중심점을 원점으로 옮겨 그린다(큰 좌표에서도 흔들리지 않게)
const cam = { tx: 0, ty: 0, tz: 0, dist: 300000, yaw: 0.6, pitch: 0.6 };
const focalPx = () => (H / 2) / Math.tan((camera.fov * Math.PI) / 360);
function updateCamera() {
  const cp = Math.cos(cam.pitch);
  camera.position.set(cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch), cam.dist * cp * Math.cos(cam.yaw));
  camera.lookAt(0, 0, 0);
  camera.near = Math.max(1, cam.dist * 0.001);
  camera.far = cam.dist * 5000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}
// 월드 좌표(km) → 화면 좌표. 카메라 뒤면 null
const tmp = new THREE.Vector3();
function project(x, y, z) {
  tmp.set(x - cam.tx, y - cam.ty, z - cam.tz).applyMatrix4(camera.matrixWorldInverse);
  const depth = -tmp.z;
  if (depth <= 0) return null;
  tmp.applyMatrix4(camera.projectionMatrix);
  return { x: (tmp.x + 1) / 2 * W, y: (1 - tmp.y) / 2 * H, depth };
}
// 화면 좌표 → 중심점을 지나는 수평면(y = 중심점 높이) 위의 월드 좌표
const ray = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
function pickPlane(sx, sy) {
  ray.setFromCamera(new THREE.Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1), camera);
  if (!ray.ray.intersectPlane(plane, hit)) return null;
  return { x: hit.x + cam.tx, y: cam.ty, z: hit.z + cam.tz };
}

// ---------- 구슬 ----------
const marbleGeo = new THREE.SphereGeometry(1, 16, 12);
const marbleMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
let marbles = null;
const colors = [];      // 팔레트 번호 → THREE.Color
const colorIndex = new Map();
function colorId(hex) {
  let id = colorIndex.get(hex);
  if (id === undefined) { id = colors.length; colors.push(new THREE.Color(hex)); colorIndex.set(hex, id); }
  return id;
}
function ensureCapacity(n) {
  if (marbles && marbles.instanceMatrix.count >= n) return;
  let cap = marbles ? marbles.instanceMatrix.count : 1024;
  while (cap < n) cap *= 2;
  if (marbles) { scene.remove(marbles); marbles.dispose(); }
  marbles = new THREE.InstancedMesh(marbleGeo, marbleMat, cap);
  marbles.frustumCulled = false;
  marbles.count = 0;
  scene.add(marbles);
  for (let i = 0; i < sim.n; i++) marbles.setColorAt(i, colors[sim.col[i]]);
}
function updateMarbles() {
  if (!marbles) return;
  const a = marbles.instanceMatrix.array;
  const { x, y, z, r } = sim;
  for (let i = 0, o = 0; i < sim.n; i++, o += 16) {
    const s = r[i];
    a[o] = s; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = s; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = s; a[o + 11] = 0;
    a[o + 12] = x[i] - cam.tx; a[o + 13] = y[i] - cam.ty; a[o + 14] = z[i] - cam.tz; a[o + 15] = 1;
  }
  marbles.count = sim.n;
  marbles.instanceMatrix.needsUpdate = true;
}

function addPlanet(def, count, p, v) {
  const same = sim.bodies.filter((b) => b.def.id === def.id).length;
  const name = same ? `${def.ko} ${same + 1}` : def.ko;
  const start = sim.n;
  spawnPlanet(sim, def, count, p.x, p.y, p.z, v.x, 0, v.z, name, colorId);
  ensureCapacity(sim.n);
  for (let i = start; i < sim.n; i++) marbles.setColorAt(i, colors[sim.col[i]]);
  marbles.instanceColor.needsUpdate = true;
  clumps = sim.clumps(3);
}

// 놓을 행성 미리보기
const ghost = new THREE.Mesh(
  new THREE.SphereGeometry(1, 32, 16),
  new THREE.MeshBasicMaterial({ color: 0xc8dcff, wireframe: true, transparent: true, opacity: 0.35 }),
);
ghost.visible = false;
scene.add(ghost);

// ---------- 검색 ----------
let placing = null;     // 놓으려고 고른 행성
let placingCount = 0;
let resultList = [];
function marbleCountInput() {
  const v = Math.round(+$count.value);
  return Math.min(20000, Math.max(20, Number.isFinite(v) ? v : 800));
}
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
  placingCount = marbleCountInput();
  $count.value = placingCount;
  $results.innerHTML = '';
  $search.value = '';
  $search.blur();
  // 아직 아무것도 없으면 고른 행성이 잘 보이게 확대
  if (sim.n === 0) cam.dist = (p.radius * focalPx()) / (Math.min(W, H) * 0.08);
}
$search.addEventListener('focus', showResults);
$search.addEventListener('input', showResults);
$search.addEventListener('blur', () => setTimeout(() => { $results.innerHTML = ''; }, 100));
$search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && resultList.length) choose(resultList[0]);
  if (e.key === 'Escape') $search.blur();
  e.stopPropagation();
});
$count.addEventListener('keydown', (e) => e.stopPropagation());

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
  if (marbles) marbles.count = 0;
  clumps = [];
  placing = null;
});

// ---------- 입력 ----------
// 끌기: 회전 · 오른쪽 버튼(또는 Shift) 끌기: 이동 · 휠: 확대·축소 · 두 손가락: 이동 + 확대·축소
const pointers = new Map();
let drag = null; // {mode:'rotate'|'pan'|'aim', ...}
let hover = null;
let pinch = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function pan(dx, dy) {
  // 화면에서 끈 만큼 중심점을 카메라 기준 좌우·위아래로 옮긴다
  const k = cam.dist / focalPx();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  cam.tx -= (right.x * dx - up.x * dy) * k;
  cam.ty -= (right.y * dx - up.y * dy) * k;
  cam.tz -= (right.z * dx - up.z * dy) * k;
}
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
  const p = placing && e.button === 0 ? pickPlane(e.clientX, e.clientY) : null;
  if (p) drag = { mode: 'aim', sx: e.clientX, sy: e.clientY, p, ex: e.clientX, ey: e.clientY };
  else if (e.button === 2 || e.button === 1 || e.shiftKey) drag = { mode: 'pan', lx: e.clientX, ly: e.clientY };
  else drag = { mode: 'rotate', lx: e.clientX, ly: e.clientY };
});
canvas.addEventListener('pointermove', (e) => {
  hover = { x: e.clientX, y: e.clientY };
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    pan(cx - pinch.cx, cy - pinch.cy);
    if (pinch.d > 0 && d > 0) cam.dist *= pinch.d / d;
    pinch = { d, cx, cy };
    return;
  }
  if (!drag) return;
  if (drag.mode === 'rotate') {
    cam.yaw -= (e.clientX - drag.lx) * 0.005;
    cam.pitch = Math.min(1.55, Math.max(-1.55, cam.pitch + (e.clientY - drag.ly) * 0.005));
    drag.lx = e.clientX; drag.ly = e.clientY;
  } else if (drag.mode === 'pan') {
    pan(e.clientX - drag.lx, e.clientY - drag.ly);
    drag.lx = e.clientX; drag.ly = e.clientY;
  } else {
    drag.ex = e.clientX; drag.ey = e.clientY;
  }
});
function aimVelocity() {
  // 방향: 수평면 위에서 끈 방향, 크기: 화면에서 끈 길이
  const len = Math.hypot(drag.ex - drag.sx, drag.ey - drag.sy);
  const q = pickPlane(drag.ex, drag.ey);
  if (!q || len < 2) return { x: 0, z: 0, len: 0 };
  const dx = q.x - drag.p.x, dz = q.z - drag.p.z, l = Math.hypot(dx, dz) || 1;
  return { x: (dx / l) * len * VSCALE, z: (dz / l) * len * VSCALE, len };
}
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag && drag.mode === 'aim' && e.type === 'pointerup' && placing) {
    addPlanet(placing, placingCount, drag.p, aimVelocity());
    placing = null;
  }
  drag = null;
  if (e.pointerType !== 'mouse') hover = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  cam.dist *= Math.exp(e.deltaY * 0.0015);
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
  updateCamera();
  updateMarbles();

  // 미리보기 구
  const gp = placing && (drag && drag.mode === 'aim' ? drag.p : hover && pickPlane(hover.x, hover.y));
  ghost.visible = !!gp;
  if (gp) {
    ghost.position.set(gp.x - cam.tx, gp.y - cam.ty, gp.z - cam.tz);
    ghost.scale.setScalar(placing.radius);
  }
  renderer.render(scene, camera);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const f = focalPx();
  ctx.lineWidth = 1;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';

  // 로슈 한계: 각 천체 둘레, 가장 가까운 더 가벼운 천체의 밀도 기준 (구의 화면 테두리)
  ctx.setLineDash([6, 6]);
  for (const a of clumps) {
    if (a.count < 20) continue;
    let near = null, nd = Infinity;
    for (const b of clumps) {
      if (b === a || b.mass >= a.mass) continue;
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (d < nd) { nd = d; near = b; }
    }
    if (!near) continue;
    const rl = rocheLimit(a.mass, near.density);
    if (rl <= a.radius) continue;
    const s = project(a.x, a.y, a.z);
    if (!s) continue;
    const sr = (rl * f) / s.depth;
    ctx.strokeStyle = 'rgba(255,120,110,0.55)';
    ctx.beginPath(); ctx.arc(s.x, s.y, sr, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,140,130,0.8)';
    ctx.fillText('로슈 한계', s.x, s.y + sr + 14);
  }
  ctx.setLineDash([]);

  // 이름
  ctx.fillStyle = '#e8eef6';
  for (const c of clumps) {
    const name = clumpName(c);
    if (!name) continue;
    const s = project(c.x, c.y, c.z);
    if (s) ctx.fillText(name, s.x, s.y - (c.radius * f) / s.depth - 6);
  }

  // 놓을 행성 이름 + 속도 화살표
  if (gp) {
    const s = project(gp.x, gp.y, gp.z);
    if (s) {
      ctx.fillStyle = '#e8eef6';
      ctx.fillText(`${placing.ko} (구슬 ${placingCount.toLocaleString()}개)`, s.x, s.y - (placing.radius * f) / s.depth - 6);
    }
    if (drag && drag.mode === 'aim') {
      const v = aimVelocity();
      if (v.len > 2) {
        const dx = drag.ex - drag.sx, dy = drag.ey - drag.sy, len = Math.hypot(dx, dy);
        ctx.strokeStyle = '#ffd36a'; ctx.fillStyle = '#ffd36a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(drag.sx, drag.sy); ctx.lineTo(drag.ex, drag.ey); ctx.stroke();
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

  drawScaleBar(f / cam.dist);
}

// 화면 중심점 거리에서의 축척
function drawScaleBar(pxPerKm) {
  const target = 120 / pxPerKm;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const km = [1, 2, 5, 10].map((k) => k * p).filter((v) => v <= target).pop();
  const len = km * pxPerKm;
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
    : sim.n ? '' : '왼쪽 위 검색창에서 행성을 찾아 고르세요 · 끌기: 회전 · 오른쪽 끌기/두 손가락: 이동 · 휠/두 손가락: 확대·축소';
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
