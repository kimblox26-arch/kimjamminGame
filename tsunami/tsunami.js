// 한반도 쓰나미 시뮬레이터 — 지형 로드, WebGL2 렌더링, 조작 UI

import { fetchElevation } from './dem.js';

const $ = (id) => document.getElementById(id);
const mapCanvas = $('map'), labelCanvas = $('labels');
const ctx = labelCanvas.getContext('2d');

const state = {
  meta: null, elev: null,
  epicenter: null,               // 격자 인덱스
  waveHeight: 100, inlandDecay: 1, distanceDecay: true,
  sim: null,                     // { data, tMax, area }
  t: 0, playing: true, speed: 1,
  view: { x: 0, y: 0, s: 1 },    // 화면 px = 격자 px * s + (x, y)
};
const DURATION = 30;             // ×1 속도에서 전체 재생 시간(초)
const SEA_COLOR = [0.247, 0.455, 0.784];

// ───────── 데이터 로드 ─────────
async function loadDem() {
  const [meta, buf] = await Promise.all([
    fetch('./data/korea_meta.json').then((r) => r.json()),
    fetchElevation('korea_dem'),
  ]);
  const raw = new DataView(buf);
  const elev = new Float32Array(meta.width * meta.height);
  for (let i = 0; i < elev.length; i++) elev[i] = raw.getInt16(2 * i, true);
  return { meta, elev };
}

const toGrid = (lat, lon) => {
  const m = state.meta;
  return [(lon - m.lon0) / (m.lon1 - m.lon0) * m.width, (m.lat1 - lat) / (m.lat1 - m.lat0) * m.height];
};

// ───────── 바탕 지도 색 (고도 색 + 음영기복) ─────────
const LAND_RAMP = [
  [0, 0x2f8f34], [60, 0x45a83a], [150, 0x86c040], [300, 0xd7cf3e], [500, 0xe8a033],
  [800, 0xd8652a], [1200, 0xb1402a], [1700, 0x84392b], [2300, 0xe9e2da],
];
const SEA_RAMP = [[0, 0x5088d6], [-200, 0x4277c9], [-1000, 0x3566b8], [-3500, 0x264f9c]];
function ramp(stops, e) {
  let i = 0;
  const asc = stops[1][0] > stops[0][0];
  while (i < stops.length - 2 && (asc ? e > stops[i + 1][0] : e < stops[i + 1][0])) i++;
  const [e0, c0] = stops[i], [e1, c1] = stops[i + 1];
  const f = Math.min(1, Math.max(0, (e - e0) / (e1 - e0)));
  return [16, 8, 0].map((sh) => ((c0 >> sh) & 255) * (1 - f) + ((c1 >> sh) & 255) * f);
}

function buildBase() {
  const { width: W, height: H, lat0, lat1, lon0, lon1 } = state.meta, elev = state.elev;
  const out = new Uint8Array(W * H * 4);
  const dy = (lat1 - lat0) / H * 111320;
  const L = [-0.5, -0.6, 0.62];                       // 북서쪽 위에서 비추는 빛
  for (let r = 0; r < H; r++) {
    const dx = (lon1 - lon0) / W * 111320 * Math.cos((lat1 - (r + 0.5) * (lat1 - lat0) / H) * Math.PI / 180);
    for (let c = 0; c < W; c++) {
      const i = r * W + c, e = elev[i];
      const land = e > 0;
      const ex = land ? 4 : 0.6;                         // 기복 과장
      const gx = (elev[r * W + Math.min(W - 1, c + 1)] - elev[r * W + Math.max(0, c - 1)]) / (2 * dx) * ex;
      const gy = (elev[Math.min(H - 1, r + 1) * W + c] - elev[Math.max(0, r - 1) * W + c]) / (2 * dy) * ex;
      const n = 1 / Math.hypot(gx, gy, 1);
      const shade = Math.max(0, (-gx * L[0] - gy * L[1] + L[2]) * n);
      const k = land ? 0.35 + 0.95 * shade : 0.8 + 0.35 * shade;
      const col = land ? ramp(LAND_RAMP, e) : ramp(SEA_RAMP, e);
      out[4 * i] = Math.min(255, col[0] * k);
      out[4 * i + 1] = Math.min(255, col[1] * k);
      out[4 * i + 2] = Math.min(255, col[2] * k);
      out[4 * i + 3] = 255;
    }
  }
  return out;
}

// ───────── WebGL2 ─────────
const gl = mapCanvas.getContext('webgl2', { antialias: false });
const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uBase;
uniform highp sampler2D uSim;
uniform vec2 uSize, uOffset, uView;
uniform float uScale, uTime, uPeriod, uHasSim, uWaveH;
uniform vec3 uBg;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 m = (p - uOffset) / uScale;
  if (m.x < 0. || m.y < 0. || m.x >= uSize.x || m.y >= uSize.y) { o = vec4(uBg, 1.); return; }
  vec3 col = texture(uBase, m / uSize).rgb;
  if (uHasSim > .5) {
    vec4 s = texelFetch(uSim, ivec2(m), 0);       // 해발, 도달시각, 수위/파고, 바다여부
    float dt = uTime - s.y;
    if (s.w > .5) {
      if (dt > 0.) {
        float x = dt / uPeriod;
        float a = clamp(s.z / uWaveH, .2, 1.);
        float ring = pow(max(0., cos(6.2832 * x)), 8.) * exp(-x * .5);
        col = mix(col, col * vec3(.82, .9, 1.05), clamp(x * .5, 0., .5) * a);
        col = mix(col, vec3(.93, .97, 1.), ring * .6 * a);
      }
    } else if (s.z > s.x && dt > 0.) {
      float depth = s.z - s.x;
      float fill = smoothstep(0., uPeriod * .6, dt);
      vec3 water = mix(vec3(.36, .64, .96), vec3(.07, .24, .62), clamp(depth / 40., 0., 1.));
      col = mix(col, water, (.55 + .4 * clamp(depth / 15., 0., 1.)) * fill);
      col = mix(col, vec3(1.), (1. - smoothstep(0., uPeriod * .35, dt)) * .75);
    }
  }
  float edge = min(min(m.x, m.y), min(uSize.x - m.x, uSize.y - m.y));
  o = vec4(mix(uBg, col, smoothstep(0., 40., edge)), 1.);
}`;

function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
let prog, uni = {}, baseTex, simTex;
function initGL() {
  prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  for (const n of ['uBase', 'uSim', 'uSize', 'uOffset', 'uView', 'uScale', 'uTime', 'uPeriod', 'uHasSim', 'uWaveH', 'uBg'])
    uni[n] = gl.getUniformLocation(prog, n);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const { width: W, height: H } = state.meta;
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  baseTex = makeTex(0, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildBase());
  simTex = makeTex(1, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));
  gl.uniform1i(uni.uBase, 0);
  gl.uniform1i(uni.uSim, 1);
  gl.uniform2f(uni.uSize, W, H);
  gl.uniform3f(uni.uBg, ...SEA_COLOR);
}
function makeTex(unit, filter) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// ───────── 시뮬레이션 (워커) ─────────
const worker = new Worker('./sim-worker.js');
let running = false, queued = false;
function simulate() {
  if (running) { queued = true; return; }
  running = true;
  $('busy').classList.add('show');
  const m = state.meta;
  worker.postMessage({
    width: m.width, height: m.height, lat0: m.lat0, lat1: m.lat1, lon0: m.lon0, lon1: m.lon1,
    elev: state.elev, epicenter: state.epicenter, waveHeight: state.waveHeight,
    distanceDecay: state.distanceDecay, inlandDecay: state.inlandDecay,
  });
}
worker.onmessage = (e) => {
  running = false;
  if (queued) { queued = false; simulate(); return; }
  $('busy').classList.remove('show');
  state.sim = e.data;
  // 침수가 끝난 뒤에도 파도가 바다 끝까지 퍼지는 모습을 다 보여주고 멈춘다
  state.sim.tEnd = Math.max(e.data.tMax, e.data.tSea) * 1.1;
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, simTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, state.meta.width, state.meta.height, 0, gl.RGBA, gl.FLOAT, e.data.data);
  restart();
};

// ───────── 화면 ─────────
let dpr = 1, vw = 0, vh = 0;
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  vw = innerWidth; vh = innerHeight;
  for (const c of [mapCanvas, labelCanvas]) { c.width = Math.round(vw * dpr); c.height = Math.round(vh * dpr); }
  gl.viewport(0, 0, mapCanvas.width, mapCanvas.height);
}
function fitView() {
  // 남한 전체(울릉도 포함)가 보이도록
  const [x0, y0] = toGrid(38.7, 125.0), [x1, y1] = toGrid(33.0, 131.2);
  const panel = document.querySelector('.panel').offsetHeight + 20, top = 70;
  const s = Math.min(vw / (x1 - x0), (vh - panel - top) / (y1 - y0));
  state.view = { s, x: (vw - (x1 - x0) * s) / 2 - x0 * s, y: top + (vh - panel - top - (y1 - y0) * s) / 2 - y0 * s };
}

const cityCell = (c) => {
  const [x, y] = toGrid(c.lat, c.lon);
  return Math.floor(y) * state.meta.width + Math.floor(x);
};
const hms = (s) => [s / 3600, (s / 60) % 60, s % 60].map((v) => String(Math.floor(v)).padStart(2, '0')).join(':');

function drawLabels() {
  const { x, y, s } = state.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  const fs = Math.max(11, Math.min(17, s * 9));
  ctx.font = `700 ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const items = state.meta.cities.map((c) => {
    const [gx, gy] = toGrid(c.lat, c.lon);
    let text = `${c.name}(${c.elev}m)`, hit = false;
    if (state.sim) {
      const i = cityCell(c), d = state.sim.data;
      const depth = d[4 * i + 2] - c.elev;
      if (depth > 0 && d[4 * i + 1] <= state.t) { hit = true; text = `${c.name} 침수 ${depth.toFixed(depth < 10 ? 1 : 0)}m`; }
    }
    return { sx: gx * s + x, sy: gy * s + y, text, hit };
  });
  const flooded = items.filter((it) => it.hit).length;
  items.sort((a, b) => b.hit - a.hit);              // 침수된 도시 이름을 먼저 배치
  const placed = [];
  for (const { sx, sy, text, hit } of items) {
    if (sx < -60 || sy < -20 || sx > vw + 60 || sy > vh + 20) continue;
    const box = [sx - 5, sy - fs / 2, sx + 9 + ctx.measureText(text).width, sy + fs / 2];
    const free = !placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
    ctx.fillStyle = hit ? '#ff4d4d' : '#fff';
    ctx.beginPath(); ctx.arc(sx, sy, hit ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fill();
    if (!free) continue;                             // 이름이 겹치면 점만 표시
    placed.push(box);
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.75)';
    ctx.strokeText(text, sx + 7, sy);
    ctx.fillStyle = hit ? '#ffd0d0' : '#fff';
    ctx.fillText(text, sx + 7, sy);
  }
  $('cities').textContent = `${flooded} / ${state.meta.cities.length}`;

  // 진원 표시
  if (state.epicenter != null) {
    const W = state.meta.width;
    const ex = (state.epicenter % W + 0.5) * s + x, ey = (Math.floor(state.epicenter / W) + 0.5) * s + y;
    const ph = (performance.now() / 1000) % 1.2 / 1.2;
    ctx.strokeStyle = `rgba(255,60,60,${1 - ph})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ex, ey, 6 + ph * 22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff3030';
    ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill();
  }
}

function render() {
  const sim = state.sim;
  gl.uniform2f(uni.uOffset, state.view.x * dpr, state.view.y * dpr);
  gl.uniform1f(uni.uScale, state.view.s * dpr);
  gl.uniform2f(uni.uView, mapCanvas.width, mapCanvas.height);
  gl.uniform1f(uni.uTime, state.t);
  gl.uniform1f(uni.uHasSim, sim ? 1 : 0);
  gl.uniform1f(uni.uPeriod, sim ? sim.tEnd / 45 : 1);
  gl.uniform1f(uni.uWaveH, state.waveHeight);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  drawLabels();
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state.sim && state.playing) {
    const end = state.sim.tEnd;
    state.t = Math.min(end, state.t + dt * state.speed * end / DURATION);
    if (state.t >= end) setPlaying(false);
    const { area, tMax } = state.sim;
    const a = area[Math.min(area.length - 1, Math.floor(state.t / tMax * (area.length - 1)))];
    $('clock').textContent = hms(state.t);
    $('area').textContent = `${Math.round(a).toLocaleString()} km²`;
  }
  render();
  requestAnimationFrame(frame);
}

function setPlaying(p) {
  state.playing = p;
  $('play').textContent = p ? '⏸ 일시정지' : '▶ 재생';
}
function restart() { state.t = 0; setPlaying(true); }

// ───────── 조작 ─────────
function setHeight(h) {
  state.waveHeight = h;
  $('height').value = h;
  $('height-label').textContent = `${h} m / ${Math.round(h * 3.28084)} ft`;
  document.querySelectorAll('[data-h]').forEach((b) => b.classList.toggle('on', +b.dataset.h === h));
}
document.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => { setHeight(+b.dataset.h); simulate(); });
$('height').oninput = (e) => setHeight(+e.target.value);
$('height').onchange = () => simulate();
$('inland').oninput = (e) => { state.inlandDecay = +e.target.value; $('inland-val').textContent = `${state.inlandDecay.toFixed(1)} m/km`; };
$('inland').onchange = () => simulate();
$('decay').onclick = () => { state.distanceDecay = !state.distanceDecay; $('decay').classList.toggle('on', state.distanceDecay); simulate(); };
$('play').onclick = () => {
  if (!state.playing && state.sim && state.t >= state.sim.tEnd) state.t = 0;
  setPlaying(!state.playing);
};
$('restart').onclick = restart;
document.querySelectorAll('[data-speed]').forEach((b) => b.onclick = () => {
  state.speed = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach((o) => o.classList.toggle('on', o === b));
});

// 드래그 이동 · 휠/핀치 확대 · 탭으로 진원 선택
const pointers = new Map();
let gesture = null;
function zoomAt(cx, cy, k) {
  const v = state.view, s = Math.min(40, Math.max(0.2, v.s * k));
  v.x = cx - (cx - v.x) * s / v.s; v.y = cy - (cy - v.y) * s / v.s; v.s = s;
}
mapCanvas.addEventListener('pointerdown', (e) => {
  mapCanvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  gesture = { moved: pointers.size > 1, sx: e.clientX, sy: e.clientY, ...pinchInfo() };
});
mapCanvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 6) gesture.moved = true;
  if (pointers.size === 1) { state.view.x += dx; state.view.y += dy; }
  else {
    const info = pinchInfo();
    zoomAt(info.cx, info.cy, info.d / gesture.d);
    state.view.x += info.cx - gesture.cx; state.view.y += info.cy - gesture.cy;
    Object.assign(gesture, info);
  }
});
const endPointer = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (pointers.size === 0 && gesture && !gesture.moved && e.type === 'pointerup') pickEpicenter(e.clientX, e.clientY);
  gesture = pointers.size ? { ...gesture, moved: true, ...pinchInfo() } : null;
};
mapCanvas.addEventListener('pointerup', endPointer);
mapCanvas.addEventListener('pointercancel', endPointer);
mapCanvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
function pinchInfo() {
  const ps = [...pointers.values()];
  if (ps.length < 2) return { cx: 0, cy: 0, d: 1 };
  return { cx: (ps[0].x + ps[1].x) / 2, cy: (ps[0].y + ps[1].y) / 2, d: Math.max(1, Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y)) };
}

function pickEpicenter(sx, sy) {
  const { width: W, height: H } = state.meta, v = state.view;
  const gx = Math.floor((sx - v.x) / v.s), gy = Math.floor((sy - v.y) / v.s);
  if (gx < 0 || gy < 0 || gx >= W || gy >= H) return;
  if (state.elev[gy * W + gx] > 0) { flashHint('육지입니다 — 바다를 탭하세요'); return; }
  state.epicenter = gy * W + gx;
  simulate();
}
let hintTimer;
function flashHint(text) {
  const h = $('hint');
  h.textContent = text; h.style.opacity = 1;
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { h.style.opacity = 0; }, 3500);
}

// 가장 가까운 바다 칸 (기본 진원 지정용)
function nearestSea(lat, lon) {
  const { width: W, height: H } = state.meta;
  const [x, y] = toGrid(lat, lon).map(Math.floor);
  for (let r = 0; r < 200; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const cx = x + dx, cy = y + dy;
        if (cx >= 0 && cy >= 0 && cx < W && cy < H && state.elev[cy * W + cx] <= 0) return cy * W + cx;
      }
  return y * W + x;
}

// ───────── 시작 ─────────
(async () => {
  if (!gl) { $('busy').textContent = '이 브라우저는 WebGL2를 지원하지 않습니다'; $('busy').classList.add('show'); return; }
  $('busy').classList.add('show');
  Object.assign(state, await loadDem());
  initGL();
  resize();
  fitView();
  addEventListener('resize', () => { resize(); fitView(); });
  setHeight(state.waveHeight);
  state.epicenter = nearestSea(33.12, 126.75);   // 제주 남동쪽 해상
  flashHint('바다를 탭하면 그 곳이 진원이 됩니다 · 드래그/휠/핀치로 이동·확대');
  simulate();
  requestAnimationFrame(frame);
})();
