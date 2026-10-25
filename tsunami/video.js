// "What If a Tsunami Hit South Korea? Three Wave Heights!" 스타일 재현
// 타이틀 → 100 m → 500 m → 1000 m 순서로 자동 재생되는 세로(9:16) 지리 시뮬레이션.

import { fetchElevation } from './dem.js';

const $ = (id) => document.getElementById(id);
const mapCanvas = $('map'), overlay = $('overlay');
const ctx = overlay.getContext('2d');
const gl = mapCanvas.getContext('webgl2', { antialias: false });

// ───────── 연출 설정 ─────────
// 9:16 화면에 담기는 범위 (Web Mercator). 좌우 경도와 화면 위쪽의 메르카토르 y(라디안)
const FRAME = { lonL: 125.696, lonR: 130.117, mercTop: 0.7403 };
const ASPECT = 16 / 9;
const SEA = [65, 114, 189];
const EPICENTER = { lat: 33.28, lon: 127.01 };          // 제주 남동쪽 해상
const TITLE_END = 1.6;
// start: 파고 표시가 바뀌는 시각, ring: 진원에서 파동이 출발하는 시각, k: 내륙 1 km 당 수위 감소(m)
// (영상 프레임을 재서 맞춘 값 — 100 m 에서는 대구·광주까지, 500 m 에서는 서울·춘천까지 잠기고 강릉·제천은 남는다)
const PHASES = [
  { h: 100, start: 0, ring: 0.8, k: 0.15 },
  { h: 500, start: 16.9, ring: 16.9, k: 0.5, caption: '500 m' },
  { h: 1000, start: 35.6, ring: 36.8, k: 1.2, caption: '1000 m' },
];
const TOTAL = 62;
const SEA_SPEED = 34000;          // 영상 1초당 바다 위 파면 이동 거리(m)
const LAND_SPEED = 18000;         // 영상 1초당 육지 범람 전진 거리(m, 물 깊이 30 m 기준)
const DECAY_LENGTH = 600000;      // 바다에서 파고가 exp(-거리/L) 로 줄어드는 길이(m)

// 영상 속 라벨 그대로 (해발은 영상 표기값). a: 라벨 위치 rb=오른쪽아래 ra=오른쪽위 lb=왼쪽아래 l=왼쪽
const CITIES = [
  { name: 'Chuncheon', elev: 79, lat: 37.8813, lon: 127.7298, a: 'ra' },
  { name: 'Gangneung', elev: 12, lat: 37.7519, lon: 128.8761, a: 'lb' },
  { name: 'Seoul', elev: 33, lat: 37.5665, lon: 126.9780, a: 'rb', underline: true },
  { name: 'Suwon', elev: 47, lat: 37.2636, lon: 127.0286, a: 'rb' },
  { name: 'Jecheon', elev: 265, lat: 37.1326, lon: 128.1910, a: 'ra' },
  { name: 'Cheonan', elev: 40, lat: 36.8151, lon: 127.1139, a: 'ra' },
  { name: 'Cheongju-si', elev: 49, lat: 36.6424, lon: 127.4890, a: 'rb' },
  { name: 'Daejeon', elev: 59, lat: 36.3504, lon: 127.3845, a: 'rb' },
  { name: 'Pohang', elev: 12, lat: 36.0190, lon: 129.3435, a: 'l' },
  { name: 'Jeonju', elev: 52, lat: 35.8242, lon: 127.1480, a: 'rb' },
  { name: 'Daegu', elev: 45, lat: 35.8714, lon: 128.6014, a: 'rb' },
  { name: 'Ulsan', elev: 16, lat: 35.5384, lon: 129.3114, a: 'lb' },
  { name: 'Changwon', elev: 29, lat: 35.2280, lon: 128.6811, a: 'l' },
  { name: 'Busan', elev: 26, lat: 35.1796, lon: 129.0756, a: 'rb' },
  { name: 'Gwangju', elev: 28, lat: 35.1595, lon: 126.8526, a: 'rb' },
  { name: 'Mokpo', elev: 6, lat: 34.8118, lon: 126.3922, a: 'rb' },
  { name: 'Yeosu', elev: 25, lat: 34.7604, lon: 127.6622, a: 'rb' },
  { name: 'Jeju-si', elev: 58, lat: 33.4996, lon: 126.5312, a: 'rb' },
];

// 남한만 보이도록: 휴전선 북쪽(북한)과 대마도·일본은 바다로 처리
const DMZ = [[124.0, 38.05], [125.0, 37.95], [125.25, 37.72], [125.9, 37.7], [126.15, 37.73], [126.68, 37.78],
  [126.72, 37.93], [127.0, 38.05], [127.3, 38.25], [127.6, 38.32], [128.0, 38.32], [128.25, 38.45],
  [128.36, 38.62], [128.45, 38.75], [129.0, 39.2], [131, 39.2]];
function outsideSouthKorea(lat, lon) {
  if ((lon > 129.17 && lat < 35.0) || (lon > 128.0 && lat < 34.2)) return true;   // 대마도·고토 열도·규슈
  let i = 0;
  while (i < DMZ.length - 2 && lon > DMZ[i + 1][0]) i++;
  const [x0, y0] = DMZ[i], [x1, y1] = DMZ[i + 1];
  return lat > y0 + (y1 - y0) * Math.min(1, Math.max(0, (lon - x0) / (x1 - x0)));
}

// ───────── 지형 ─────────
async function loadTerrain() {
  const [meta, buf] = await Promise.all([
    fetch('./data/korea_video.json').then((r) => r.json()),
    fetchElevation('korea_video'),
  ]);
  const raw = new DataView(buf);
  const W = meta.width, H = meta.height - (meta.height % 2);   // 저해상도(1/2) 격자와 맞추려 짝수 행만
  const dLat = (meta.lat1 - meta.lat0) / meta.height;
  const hi = { width: W, height: H, lon0: meta.lon0, lon1: meta.lon1, lat1: meta.lat1, lat0: meta.lat1 - H * dLat };
  hi.elev = new Float32Array(W * H);
  for (let r = 0; r < H; r++) {
    const lat = hi.lat1 - (r + 0.5) * dLat;
    for (let c = 0; c < W; c++) {
      const i = r * W + c, e = raw.getInt16(2 * i, true);
      hi.elev[i] = e > 0 && outsideSouthKorea(lat, hi.lon0 + (c + 0.5) * (hi.lon1 - hi.lon0) / W) ? -100 : e;
    }
  }
  // 시뮬레이션용 1/2 격자 (2×2 평균)
  const lo = { ...hi, width: W / 2, height: H / 2, elev: new Float32Array(W * H / 4) };
  for (let r = 0; r < lo.height; r++)
    for (let c = 0; c < lo.width; c++) {
      const a = 2 * r * W + 2 * c;
      lo.elev[r * lo.width + c] = (hi.elev[a] + hi.elev[a + 1] + hi.elev[a + W] + hi.elev[a + W + 1]) / 4;
    }
  return { hi, lo };
}

// 영상 프레임에서 고도 구간별 색을 뽑아 음영 평균만큼 보정한 색표
const LAND_RAMP = [
  [0, 0x21802c], [15, 0x21802c], [45, 0x2e9228], [80, 0x45a22a], [125, 0x64aa2b], [175, 0x81b02e],
  [250, 0x9cb330], [350, 0xbab931], [450, 0xcab12b], [575, 0xd29923], [725, 0xd17818],
  [900, 0xcd5f14], [1100, 0xc84c0f], [1350, 0xc5420e], [1750, 0xb73e18],
];
function ramp(e) {
  let i = 0;
  while (i < LAND_RAMP.length - 2 && e > LAND_RAMP[i + 1][0]) i++;
  const [e0, c0] = LAND_RAMP[i], [e1, c1] = LAND_RAMP[i + 1];
  const f = Math.min(1, Math.max(0, (e - e0) / (e1 - e0)));
  return [16, 8, 0].map((sh) => ((c0 >> sh) & 255) * (1 - f) + ((c1 >> sh) & 255) * f);
}
function buildBase(g) {
  const { width: W, height: H, elev } = g;
  const out = new Uint8Array(W * H * 4);
  const dLat = (g.lat1 - g.lat0) / H;
  const dy = dLat * 111320;
  for (let r = 0; r < H; r++) {
    const dx = (g.lon1 - g.lon0) / W * 111320 * Math.cos((g.lat1 - (r + 0.5) * dLat) * Math.PI / 180);
    for (let c = 0; c < W; c++) {
      const i = r * W + c, e = elev[i];
      let col = SEA;
      if (e > 0) {
        const gx = (elev[r * W + Math.min(W - 1, c + 1)] - elev[r * W + Math.max(0, c - 1)]) / (2 * dx) * 3;
        const gy = (elev[Math.min(H - 1, r + 1) * W + c] - elev[Math.max(0, r - 1) * W + c]) / (2 * dy) * 3;
        const shade = (gx * 0.55 + gy * 0.6 + 0.6) / Math.hypot(gx, gy, 1);   // 북서쪽 빛
        const k = 0.45 + 0.85 * Math.max(0, shade);
        col = ramp(e).map((v) => v * k);
      }
      out[4 * i] = Math.min(255, col[0]); out[4 * i + 1] = Math.min(255, col[1]);
      out[4 * i + 2] = Math.min(255, col[2]); out[4 * i + 3] = 255;
    }
  }
  return out;
}

// ───────── 시뮬레이션 ─────────
function runPhases(lo) {
  const worker = new Worker('./sim-worker.js');
  const dLat = (lo.lat1 - lo.lat0) / lo.height;
  const ec = Math.floor((EPICENTER.lon - lo.lon0) / (lo.lon1 - lo.lon0) * lo.width);
  const er = Math.floor((lo.lat1 - EPICENTER.lat) / dLat);
  const results = [];
  return new Promise((resolve) => {
    const next = () => {
      const p = PHASES[results.length];
      worker.postMessage({
        width: lo.width, height: lo.height, lat0: lo.lat0, lat1: lo.lat1, lon0: lo.lon0, lon1: lo.lon1,
        elev: lo.elev, epicenter: er * lo.width + ec, waveHeight: p.h, distanceDecay: true,
        inlandDecay: p.k, decayLength: DECAY_LENGTH, seaSpeed: SEA_SPEED, landSpeed: LAND_SPEED,
      });
    };
    worker.onmessage = (e) => {
      results.push(e.data.data);
      if (results.length < PHASES.length) next();
      else { worker.terminate(); resolve(results); }
    };
    next();
  });
}

// ───────── WebGL ─────────
const VS = `#version 300 es
in vec2 p; void main() { gl_Position = vec4(p, 0., 1.); }`;
const FS = `#version 300 es
precision highp float;
uniform sampler2D uBase, uElev, uSim;
uniform vec4 uStage;            // 화면 안 9:16 영역 (x, y, w, h) 장치 픽셀
uniform float uViewH;
uniform vec3 uFrame;            // lonL, lonR, mercTop
uniform vec4 uBox;              // lon0, lon1, lat0, lat1
uniform vec2 uEpi;              // lat, lon
uniform float uT, uSeaSpeed;
uniform vec3 uSea, uWater;
out vec4 o;
const float D2R = 0.017453292519943295;
void main() {
  vec2 frag = vec2(gl_FragCoord.x, uViewH - gl_FragCoord.y);
  vec2 uv = (frag - uStage.xy) / uStage.zw;
  float lon = mix(uFrame.x, uFrame.y, uv.x);
  float my = uFrame.z - uv.y * (uFrame.y - uFrame.x) * D2R * ${ASPECT.toFixed(6)};
  float lat = (2. * atan(exp(my)) - 1.5707963267948966) / D2R;
  vec2 g = vec2((lon - uBox.x) / (uBox.y - uBox.x), (uBox.w - lat) / (uBox.w - uBox.z));
  if (any(lessThan(g, vec2(0.))) || any(greaterThan(g, vec2(1.)))) { o = vec4(uSea, 1.); return; }
  vec3 col = texture(uBase, g).rgb;
  float e = texture(uElev, g).r;
  vec4 s = texture(uSim, g);                 // 수위, 도달시각, 바다여부
  float dt = uT - s.g;
  if (e <= 0.) {
    // 진원에서 퍼지는 원형 파면 (두 겹)
    float R = uSeaSpeed * uT / 1000.;
    vec2 d = vec2((lon - uEpi.y) * cos(uEpi.x * D2R), lat - uEpi.x) * 111.32;
    float r = length(d), w = 2.2 + R * .006;
    float ring = exp(-pow((r - R) / w, 2.)) + .6 * exp(-pow((r - R + 4. * w) / w, 2.));
    col = mix(col, vec3(1.), step(0., R) * ring * .42 * exp(-R / 420.));
  } else if (s.r > e && dt > 0.) {
    float depth = s.r - e;
    col = mix(col, uWater, (.74 + .16 * smoothstep(0., 80., depth)) * smoothstep(0., .5, dt));
    col = mix(col, vec3(.86, .94, 1.), (1. - smoothstep(0., .9, dt)) * .55);   // 밀려드는 물마루 거품
  }
  o = vec4(col, 1.);
}`;

let uni = {}, simTex = [];
function compile(type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}
function texture(unit, internal, format, w, h, data) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, data instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.FLOAT, data);
  return t;
}
function initGL(hi, lo, results) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  for (const n of ['uBase', 'uElev', 'uSim', 'uStage', 'uViewH', 'uFrame', 'uBox', 'uEpi', 'uT', 'uSeaSpeed', 'uSea', 'uWater'])
    uni[n] = gl.getUniformLocation(prog, n);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  texture(0, gl.RGBA8, gl.RGBA, hi.width, hi.height, buildBase(hi));
  texture(1, gl.R16F, gl.RED, hi.width, hi.height, hi.elev);
  // 단계별 결과: 수위·도달시각·바다여부 (반정밀도 + 선형 보간으로 고해상도 지형과 비교)
  simTex = results.map((d) => {
    const n = lo.width * lo.height, px = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      px[4 * i] = Math.max(-1000, d[4 * i + 2]);
      px[4 * i + 1] = Math.min(999, d[4 * i + 1]);
      px[4 * i + 2] = d[4 * i + 3];
    }
    return texture(2, gl.RGBA16F, gl.RGBA, lo.width, lo.height, px);
  });
  gl.uniform1i(uni.uBase, 0); gl.uniform1i(uni.uElev, 1); gl.uniform1i(uni.uSim, 2);
  gl.uniform3f(uni.uFrame, FRAME.lonL, FRAME.lonR, FRAME.mercTop);
  gl.uniform4f(uni.uBox, hi.lon0, hi.lon1, hi.lat0, hi.lat1);
  gl.uniform2f(uni.uEpi, EPICENTER.lat, EPICENTER.lon);
  gl.uniform1f(uni.uSeaSpeed, SEA_SPEED);
  gl.uniform3f(uni.uSea, ...SEA.map((v) => v / 255));
  gl.uniform3f(uni.uWater, 74 / 255, 126 / 255, 203 / 255);
}

// ───────── 화면 배치 ─────────
let dpr = 1, vw = 0, vh = 0, stage = { x: 0, y: 0, w: 1, h: 1 };
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  vw = innerWidth; vh = innerHeight;
  for (const c of [mapCanvas, overlay]) { c.width = Math.round(vw * dpr); c.height = Math.round(vh * dpr); }
  gl.viewport(0, 0, mapCanvas.width, mapCanvas.height);
  const w = Math.min(vw, vh / ASPECT);
  stage = { w, h: w * ASPECT, x: (vw - w) / 2, y: (vh - w * ASPECT) / 2 };
}
// 위경도 → 화면 좌표
function project(lat, lon) {
  const u = (lon - FRAME.lonL) / (FRAME.lonR - FRAME.lonL);
  const my = Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const v = (FRAME.mercTop - my) / ((FRAME.lonR - FRAME.lonL) * Math.PI / 180 * ASPECT);
  return [stage.x + u * stage.w, stage.y + v * stage.h];
}

// ───────── 글자 ─────────
const LABEL_FONT = '"Noto Sans", "Segoe UI", system-ui, sans-serif';
const TITLE_FONT = 'Montserrat, "Arial Black", sans-serif';
function outlined(text, x, y, size, fill, { weight = 900, stroke = size * 0.16, align = 'center', fitWidth = 0, font = TITLE_FONT } = {}) {
  ctx.font = `${weight} ${size}px ${font}`;
  if (fitWidth) {
    size *= fitWidth / ctx.measureText(text).width;
    stroke = size * 0.16;
    ctx.font = `${weight} ${size}px ${font}`;
  }
  ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = size * 0.12; ctx.shadowOffsetY = size * 0.05;
  ctx.lineWidth = stroke; ctx.strokeStyle = '#111';
  ctx.strokeText(text, x, y);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawTitle(alpha) {
  const W = stage.w, cx = stage.x + W / 2;
  ctx.globalAlpha = alpha;
  outlined('Tsunami', cx, stage.y + stage.h * 0.434, W * 0.2, '#ffe01b', { fitWidth: W * 0.91 });
  outlined('South Korea', cx, stage.y + stage.h * 0.521, W * 0.12, '#ffffff', { fitWidth: W * 0.9 });
  outlined('Three wave heights!', cx, stage.y + stage.h * 0.596, W * 0.08, '#a6dcff', { weight: 800, fitWidth: W * 0.9 });
  ctx.globalAlpha = 1;
}

function drawHud(phase) {
  const W = stage.w, x0 = stage.x, y0 = stage.y;
  outlined('SIMULATION', x0 + W * 0.044, y0 + stage.h * 0.026, W * 0.05, '#fff',
    { weight: 800, align: 'left', fitWidth: W * 0.235, font: TITLE_FONT });
  if (!phase) return;
  const bx = x0 + W * 0.494, by = y0 + stage.h * 0.012, bw = W * 0.467, bh = stage.h * 0.055;
  ctx.fillStyle = 'rgba(26,39,65,.94)';
  ctx.strokeStyle = 'rgba(150,180,230,.45)'; ctx.lineWidth = Math.max(1, W * 0.002);
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, W * 0.014); ctx.fill(); ctx.stroke();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(220,230,245,.85)';
  ctx.font = `500 ${W * 0.024}px ${LABEL_FONT}`;
  ctx.fillText('START TSUNAMI HEIGHT', bx + W * 0.016, by + bh * 0.26);
  ctx.fillStyle = '#fff';
  ctx.font = `700 ${W * 0.054}px ${LABEL_FONT}`;
  ctx.fillText(`${phase.h} m / ${Math.round(phase.h * 3.28084).toLocaleString('en-US')} ft`, bx + W * 0.016, by + bh * 0.66);
}

function drawCaption(text, age) {
  const a = Math.min(1, age / 0.15) * Math.min(1, Math.max(0, (1.8 - age) / 0.3));
  if (a <= 0) return;
  const s = 1 + 0.15 * Math.max(0, 1 - age / 0.2);
  ctx.globalAlpha = a;
  outlined(text, stage.x + stage.w / 2, stage.y + stage.h * 0.5, stage.w * 0.165 * s, '#fff', { weight: 800 });
  ctx.globalAlpha = 1;
}

let lo, results;
function cityState(c, pi, t) {
  if (t < 0) return { since: -1 };
  const d = results[pi], dLat = (lo.lat1 - lo.lat0) / lo.height;
  const i = Math.floor((lo.lat1 - c.lat) / dLat) * lo.width + Math.floor((c.lon - lo.lon0) / (lo.lon1 - lo.lon0) * lo.width);
  const arr = d[4 * i + 1];
  if (d[4 * i + 2] <= c.elev || t < arr) return { since: -1 };
  return { since: t - arr };
}

function drawCities(pi, t) {
  const f = stage.w * 0.036;
  ctx.font = `500 ${f}px ${LABEL_FONT}`;
  ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  for (const c of CITIES) {
    const [x, y] = project(c.lat, c.lon);
    const text = `${c.name}(${c.elev}m)`;
    const tw = ctx.measureText(text).width;
    const left = c.a === 'l' || c.a === 'lb';
    const tx = left ? x - f * 0.26 - tw : x + f * (c.a === 'ra' ? 0.26 : 0.32);
    const ty = y + f * { rb: 0.7, ra: -0.78, lb: 0.68, l: -0.1 }[c.a];
    const { since } = cityState(c, pi, t);
    // 물에 잠기는 순간 잠깐 하얗게 빛나고, 잠긴 뒤에는 반투명하게 가라앉는다
    const glow = since >= 0 ? Math.max(0, 1 - since / 1.2) : 0;
    const sunk = since >= 0 ? Math.min(1, Math.max(0, (since - 0.6) / 0.8)) : 0;
    const sunkCol = `rgba(188,211,245,${0.9 * sunk})`;
    const dot = () => { ctx.beginPath(); ctx.arc(x, y, f * 0.15, 0, Math.PI * 2); ctx.fill(); };

    ctx.textAlign = 'left';
    if (glow > 0) {
      ctx.shadowColor = `rgba(255,255,255,${glow})`; ctx.shadowBlur = f * 0.6;
      ctx.lineWidth = f * 0.22; ctx.strokeStyle = `rgba(255,255,255,${0.9 * glow})`;
      ctx.strokeText(text, tx, ty);
      ctx.shadowColor = 'transparent';
    }
    if (sunk < 1) {                                   // 평상시: 흰 글자 + 어두운 그림자
      ctx.globalAlpha = 1 - sunk;
      ctx.fillStyle = '#fff';
      dot();
      ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = f * 0.18;
      ctx.lineWidth = f * 0.1; ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.strokeText(text, tx, ty);
      ctx.shadowColor = 'transparent';
      ctx.fillText(text, tx, ty);
      ctx.globalAlpha = 1;
    }
    if (sunk > 0) {                                   // 잠긴 뒤: 그림자 없는 연파랑
      ctx.fillStyle = sunkCol;
      dot();
      ctx.fillText(text, tx, ty);
    }
    if (c.underline) { ctx.fillStyle = sunk > 0.5 ? sunkCol : '#fff'; ctx.fillRect(tx, ty + f * 0.62, tw, Math.max(1, f * 0.06)); }
  }
}

// ───────── 재생 ─────────
const params = new URLSearchParams(location.search);
let clock = +params.get('t') || 0, playing = !params.has('t'), last = 0;
function phaseAt(t) {
  let i = 0;
  while (i < PHASES.length - 1 && t >= PHASES[i + 1].start) i++;
  return i;
}
function frame(now) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  if (playing) {
    clock += dt;
    if (clock >= TOTAL) { clock = TOTAL; setPlaying(false); showControls(); }
  }
  const pi = phaseAt(clock), phase = PHASES[pi];
  const t = clock - phase.ring;

  gl.uniform4f(uni.uStage, stage.x * dpr, stage.y * dpr, stage.w * dpr, stage.h * dpr);
  gl.uniform1f(uni.uViewH, mapCanvas.height);
  gl.uniform1f(uni.uT, t);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, simTex[pi]);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  const title = clock < TITLE_END;
  if (!title) {
    drawCities(pi, t);
    const [ex, ey] = project(EPICENTER.lat, EPICENTER.lon);          // 진원
    ctx.fillStyle = 'rgba(255,60,70,.9)';
    ctx.beginPath(); ctx.arc(ex, ey, stage.w * 0.0065, 0, Math.PI * 2); ctx.fill();
  }
  drawHud(title ? null : phase);
  if (title) drawTitle(Math.min(1, (TITLE_END - clock) / 0.2));
  if (phase.caption) drawCaption(phase.caption, clock - phase.start);
  requestAnimationFrame(frame);
}

function setPlaying(p) { playing = p; $('play').textContent = p ? '⏸' : '▶'; }
let hideTimer;
function showControls() {
  if (params.has('clean')) return;
  $('controls').classList.remove('hide');
  clearTimeout(hideTimer);
  if (playing) hideTimer = setTimeout(() => $('controls').classList.add('hide'), 2500);
}
$('play').onclick = (e) => { e.stopPropagation(); if (clock >= TOTAL) clock = 0; setPlaying(!playing); showControls(); };
$('replay').onclick = (e) => { e.stopPropagation(); clock = 0; setPlaying(true); showControls(); };
overlay.style.pointerEvents = 'none';
mapCanvas.addEventListener('click', () => { if (clock >= TOTAL) clock = 0; setPlaying(!playing); showControls(); });
addEventListener('pointermove', showControls);

(async () => {
  if (!gl) { $('loading').textContent = '이 브라우저는 WebGL2를 지원하지 않습니다'; return; }
  const terrain = await loadTerrain();
  lo = terrain.lo;
  $('loading').textContent = '시뮬레이션 계산 중…';
  const [res] = await Promise.all([runPhases(lo), document.fonts.ready]);
  results = res;
  initGL(terrain.hi, lo, results);
  resize();
  addEventListener('resize', resize);
  $('loading').remove();
  setPlaying(playing);
  requestAnimationFrame(frame);
})();
