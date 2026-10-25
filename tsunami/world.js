// 쓰나미 월드 — 세계 지도(MapLibre) 위에서 천수방정식으로 쓰나미를 계산하고 가상 속보를 낸다.
// 지금 보이는 화면이 계산 영역이 되고, 그 범위의 지형·수심 타일과 (줌 13+) 건물 윤곽을 격자에 넣는다.

import { ShallowWater } from './swe.js';
import { WORLD_CITIES } from './world-cities.js';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + lat * D2R / 2));
const latOf = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) / D2R;
const pad = (v) => String(Math.floor(v)).padStart(2, '0');
const clock = (s) => `${pad(s / 3600)}:${pad(s / 60 % 60)}:${pad(s % 60)}`;
const dur = (s) => s < 60 ? `${Math.round(s)}초` : s < 3600 ? `${Math.floor(s / 60)}분 ${pad(s % 60)}초` : `${Math.floor(s / 3600)}시간 ${pad(s / 60 % 60)}분`;
const meters = (m) => m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m.toFixed(m < 10 ? 1 : 0)} m`;

const toast = $('toast');
let toastTimer;
function msg(text) {
  $('msg').textContent = text || '';
  toast.classList.toggle('fade', !text);
  clearTimeout(toastTimer);
  if (text) toastTimer = setTimeout(() => toast.classList.add('fade'), 5000);
}

// ───────── 지도 (영상 스타일) ─────────
// 바다는 평평한 파랑, 땅은 영상 프레임에서 뽑은 고도 색표 + 북서쪽 빛 음영. 도로·건물·지명은 OpenFreeMap 벡터 타일
const SEA = '#4172bd';
const RELIEF = [[0.5, '#21802c'], [15, '#21802c'], [45, '#2e9228'], [80, '#45a22a'], [125, '#64aa2b'], [175, '#81b02e'],
  [250, '#9cb330'], [350, '#bab931'], [450, '#cab12b'], [575, '#d29923'], [725, '#d17818'], [900, '#cd5f14'],
  [1100, '#c84c0f'], [1350, '#c5420e'], [1750, '#b73e18'], [2600, '#9c3a22'], [4000, '#8a5444'], [5500, '#efe9e4']];
const DEM_SOURCE = { type: 'raster-dem', tiles: [DEM_URL('{z}', '{x}', '{y}')], encoding: 'terrarium', tileSize: 256, maxzoom: 15 };
const reliefColor = ['interpolate', ['linear'], ['elevation'], -12000, SEA, 0.4, SEA, ...RELIEF.flat()];
// 해저 지형 음영이 바다에 비치지 않게, 음영 위에 바다만 다시 덮는다
const seaMask = ['interpolate', ['linear'], ['elevation'], -12000, SEA, 0.4, SEA, 0.5, 'rgba(65,114,189,0)'];
let basemap = true;
async function buildStyle() {
  const style = {
    version: 8,
    sources: { dem: DEM_SOURCE },
    layers: [
      { id: 'sea', type: 'background', paint: { 'background-color': SEA } },
      { id: 'relief', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': reliefColor } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', paint: {
        'hillshade-exaggeration': 0.85, 'hillshade-illumination-direction': 315,
        'hillshade-shadow-color': 'rgba(25, 20, 5, .75)', 'hillshade-highlight-color': 'rgba(255, 255, 230, .35)',
        'hillshade-accent-color': 'rgba(30, 25, 10, .35)' } },
      { id: 'sea-flat', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': seaMask } },
    ],
  };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(STYLE_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(res.status);
    const base = await res.json();
    const [name, src] = Object.entries(base.sources).find(([, v]) => v.type === 'vector');
    Object.assign(style, { glyphs: base.glyphs, sprite: base.sprite });
    style.sources.omt = src;
    style.layers.push(
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': SEA } },
      { id: 'roads', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12,
        paint: { 'line-color': 'rgba(255,255,255,.55)', 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 12, 0.4, 18, 7] } },
      { id: 'buildings', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14,
        paint: { 'fill-extrusion-color': '#efe7d8', 'fill-extrusion-opacity': 0.92,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 10], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0] } },
      { id: 'countries', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 6, filter: ['==', ['get', 'class'], 'country'],
        layout: { 'text-field': ['coalesce', ['get', 'name:ko'], ['get', 'name']], 'text-font': ['Noto Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 11, 5, 17] },
        paint: { 'text-color': '#fff', 'text-halo-color': 'rgba(0,0,0,.75)', 'text-halo-width': 1.6 } },
    );
    void name;
  } catch {
    basemap = false;
  }
  return style;
}

const map = new maplibregl.Map({
  container: 'map', style: await buildStyle(), center: [127.6, 35.8], zoom: 5.6, maxPitch: 70,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
await new Promise((r) => map.once('load', r));
const vectorSrc = basemap ? 'omt' : null;
if (!basemap) msg('도로·건물·지명 지도를 불러오지 못해 지형만 표시합니다. 인터넷 연결을 확인하세요.');

const OPT_KEY = 'tsunami-optimize';
let optimize = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
try { const v = localStorage.getItem(OPT_KEY); if (v !== null) optimize = v === '1'; } catch { /* 저장소를 못 쓰면 기기 판단대로 */ }

// ───────── 상태 ─────────
let swe = null;
try { swe = new ShallowWater($('sim')); } catch (e) { msg(e.message); $('start').disabled = true; }
const sim = { running: false, dom: null, setupArgs: null, places: [], points: [], epicenter: null, nextSummary: 600, buildings: 0 };
const epiEl = document.createElement('div');
epiEl.className = 'epi';
const epiMarker = new maplibregl.Marker({ element: epiEl });

// ───────── 입력 ─────────
const fmtH = (h) => +h.toPrecision(h < 10 ? 2 : 4);
function setHeight(h, fromRange) {
  if (!(h > 0)) return;
  if (!fromRange) $('height-range').value = Math.log10(h);
  else $('height').value = fmtH(h);
  $('height-label').textContent = `${fmtH(h).toLocaleString('en-US')} m / ${Math.round(h * 3.28084).toLocaleString('en-US')} ft`;
}
document.querySelectorAll('[data-h]').forEach((b) => b.addEventListener('click', () => { $('height').value = b.dataset.h; setHeight(+b.dataset.h, false); }));
$('height').addEventListener('input', (e) => setHeight(+e.target.value, false));
$('height-range').addEventListener('input', (e) => setHeight(10 ** +e.target.value, true));
function syncSource() {
  const point = $('source').value === 'point';
  $('radius-row').hidden = !point;
  $('period-row').hidden = point;
}
$('source').addEventListener('change', syncSource);

let picking = false;
function setPicking(on) {
  picking = on;
  $('pick').classList.toggle('on', on);
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
  if (on) { togglePop(null); msg('지도에서 바다 위를 눌러 진원을 정하세요.'); }
}
$('pick').addEventListener('click', () => setPicking(!picking));
map.on('click', (e) => {
  if (!picking) return;
  setEpicenter(e.lngLat.lng, e.lngLat.lat);
  setPicking(false);
  msg('진원을 정했습니다. TSUNAMI! 를 누르세요.');
});
function setEpicenter(lon, lat) {
  sim.epicenter = { lon, lat };
  epiMarker.setLngLat([lon, lat]).addTo(map);
}

const POPS = { 'height-box': 'editor', 'open-settings': 'settings', 'open-places': 'places' };
function togglePop(id) {
  for (const [btn, pop] of Object.entries(POPS)) {
    const show = pop === id && $(pop).hidden;
    $(pop).hidden = !show;
    $(btn).setAttribute('aria-expanded', String(show));
  }
}
for (const [btn, pop] of Object.entries(POPS)) $(btn).addEventListener('click', () => togglePop(pop));
map.on('mousedown', () => togglePop(null));
map.on('touchstart', () => togglePop(null));
$('news-toggle').addEventListener('click', () => {
  const closed = $('news').classList.toggle('closed');
  $('news-toggle').textContent = closed ? '펼치기' : '접기';
  $('news-toggle').setAttribute('aria-expanded', String(!closed));
});
if (innerWidth <= 760) {   // 휴대폰은 가볍게, 속보는 접어서 지도를 가리지 않게
  $('res').value = '512';
  $('news-toggle').click();
}

// ───────── 계산 영역 = 지금 화면 ─────────
function domainFromView(maxDim) {
  const b = map.getBounds();
  let west = b.getWest(), east = b.getEast();
  let yS = mercY(Math.max(-80, b.getSouth())), yN = mercY(Math.min(80, b.getNorth()));
  const wrap = east - west >= 360;
  if (wrap) { west = -180; east = 180; }
  const span = (east - west) * D2R;
  let W = maxDim, dl = span / W, H = Math.round((yN - yS) / dl);
  if (H > maxDim) {
    H = maxDim;
    if (wrap) { const yc = (yS + yN) / 2; yS = yc - H * dl / 2; } else { dl = (yN - yS) / H; W = Math.round(span / dl); }
  }
  const dom = { west, east: west + W * dl / D2R, W, H, dl, y0: yS, wrap };
  dom.south = latOf(yS);
  dom.north = latOf(yS + H * dl);
  dom.cell = 6371000 * Math.cos(((dom.south + dom.north) / 2) * D2R) * dl;
  return dom;
}
const cellAt = (dom, j) => 6371000 * Math.cos(latOf(dom.y0 + j * dom.dl) * D2R) * dom.dl;   // j 행의 셀 한 변(m)
function toCell(dom, lon, lat) {
  while (lon < dom.west) lon += 360;
  while (lon >= dom.west + 360) lon -= 360;
  const i = Math.floor((lon - dom.west) / (dom.dl / D2R)), j = Math.floor((mercY(lat) - dom.y0) / dom.dl);
  return i >= 0 && j >= 0 && i < dom.W && j < dom.H ? [i, j] : null;
}

// ───────── 지형·수심 (Terrarium 타일) ─────────
const tileCache = new Map();
const scratch = document.createElement('canvas');
scratch.width = scratch.height = 256;
const sctx = scratch.getContext('2d', { willReadFrequently: true });
async function fetchTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, (async () => {
      const res = await fetch(DEM_URL(z, x, y));
      if (!res.ok) throw new Error(`지형 타일을 받지 못했습니다 (${res.status})`);
      const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      sctx.clearRect(0, 0, 256, 256);
      sctx.drawImage(bmp, 0, 0);
      const d = sctx.getImageData(0, 0, 256, 256).data;
      const e = new Float32Array(65536);
      for (let k = 0; k < 65536; k++) e[k] = d[4 * k] * 256 + d[4 * k + 1] + d[4 * k + 2] / 256 - 32768;
      return e;
    })());
    if (tileCache.size > 400) tileCache.delete(tileCache.keys().next().value);
  }
  return tileCache.get(key);
}

// zoom z 타일로 영역을 덮고, (경도, 메르카토르 y) → 해발을 돌려주는 표본기
async function tileSampler(dom, z, progress) {
  const n = 2 ** z, size = 256 * n;
  const px = (lon) => (lon + 180) / 360 * size, py = (y) => (Math.PI - y) / (2 * Math.PI) * size;
  const tx0 = Math.floor(px(dom.west) / 256), tx1 = Math.floor(px(dom.east - 1e-9) / 256);
  const ty0 = Math.max(0, Math.floor(py(dom.y0 + dom.H * dom.dl) / 256)), ty1 = Math.min(n - 1, Math.floor(py(dom.y0) / 256));
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([((tx % n) + n) % n, ty]);
  const total = jobs.length, tiles = new Map();
  let done = 0;
  const worker = async () => {
    while (jobs.length) {
      const [x, y] = jobs.pop();
      tiles.set(`${x}/${y}`, await fetchTile(z, x, y));
      progress(`지형·수심 타일 (줌 ${z}) ${++done}/${total}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const at = (x, y) => {
    x = ((Math.floor(x) % size) + size) % size;
    y = Math.min(size - 1, Math.max(0, Math.floor(y)));
    const t = tiles.get(`${x >> 8}/${y >> 8}`);
    return t ? t[(y & 255) * 256 + (x & 255)] : 0;
  };
  return {
    nearest: (lon, y) => at(px(lon), py(y)),
    bilinear: (lon, y) => {
      const x = px(lon) - 0.5, yy = py(y) - 0.5, fx = x - Math.floor(x), fy = yy - Math.floor(yy);
      return (at(x, yy) * (1 - fx) + at(x + 1, yy) * fx) * (1 - fy) + (at(x, yy + 1) * (1 - fx) + at(x + 1, yy + 1) * fx) * fy;
    },
  };
}

const tileCount = (dom, z) => {
  const n = 2 ** z, px = (lon) => (lon + 180) / 360 * n, py = (y) => (Math.PI - y) / (2 * Math.PI) * n;
  return (Math.floor(px(dom.east - 1e-9)) - Math.floor(px(dom.west)) + 1) * (Math.floor(py(dom.y0)) - Math.floor(py(dom.y0 + dom.H * dom.dl)) + 1);
};
// Terrarium 타일은 줌 10 까지만 바다 수심이 있고, 그보다 확대하면 바다가 0 으로 채워진다.
// 그래서 육지는 고해상도 타일, 바다(고해상도에서 0 근처)는 줌 10 수심을 쓴다.
const BATHY_ZOOM = 10;
async function buildBed(dom, progress) {
  let z = Math.max(0, Math.min(15, Math.ceil(Math.log2(2 * Math.PI / (256 * dom.dl)))));
  while (tileCount(dom, z) > 160 && z > 0) z--;
  const hi = await tileSampler(dom, z, progress);
  const lo = z > BATHY_ZOOM ? await tileSampler(dom, BATHY_ZOOM, progress) : null;
  const { W, H } = dom, bed = new Float32Array(W * H), dlDeg = dom.dl / D2R;
  for (let j = 0; j < H; j++) {
    const y = dom.y0 + (j + 0.5) * dom.dl;
    for (let i = 0; i < W; i++) {
      const lon = dom.west + (i + 0.5) * dlDeg;
      bed[j * W + i] = lo && Math.abs(hi.nearest(lon, y)) < 0.5 ? Math.min(lo.bilinear(lon, y), -2) : hi.bilinear(lon, y);
    }
  }
  return bed;
}

// 건물 윤곽(OpenStreetMap)을 높이만큼 지반에 더해, 물이 건물 사이 골목으로 흐르게 한다
function addBuildings(dom, bed) {
  if (!vectorSrc || map.getZoom() < 13 || dom.cell > 40) return 0;
  const feats = map.querySourceFeatures(vectorSrc, { sourceLayer: 'building' });
  if (!feats.length) return 0;
  const c = document.createElement('canvas');
  c.width = dom.W; c.height = dom.H;
  const g = c.getContext('2d', { willReadFrequently: true });
  const dlDeg = dom.dl / D2R, yTop = dom.y0 + dom.H * dom.dl;
  const seen = new Set();
  for (const f of feats) {
    const key = f.id ?? JSON.stringify(f.geometry.coordinates[0]?.[0]);
    if (seen.has(key)) continue;
    seen.add(key);
    const h = Math.min(255, Math.max(3, Math.round(f.properties.render_height ?? f.properties.height ?? 10)));
    g.fillStyle = `rgb(${h},0,0)`;
    g.beginPath();
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    for (const poly of polys) for (const ring of poly) ring.forEach(([lon, lat], k) => {
      const x = (lon - dom.west) / dlDeg, y = (yTop - mercY(lat)) / dom.dl;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.fill('evenodd');
  }
  const px = g.getImageData(0, 0, dom.W, dom.H).data;
  for (let r = 0; r < dom.H; r++)
    for (let i = 0; i < dom.W; i++) {
      const p = 4 * (r * dom.W + i);
      if (px[p + 3] < 128) continue;
      const k = (dom.H - 1 - r) * dom.W + i;
      bed[k] = Math.max(bed[k], 0.5) + px[p];
    }
  return seen.size;
}

// 처음부터 바닷물이 있는 셀: 화면 가장자리(또는 진원)의 바다와 이어진 곳만. 해수면보다 낮은 내륙 분지는 마른 땅
function wetMask(dom, bed, seed) {
  const { W, H, wrap } = dom;
  const wet = new Uint8Array(W * H), q = new Int32Array(W * H);
  let head = 0, tail = 0;
  const push = (k) => { if (!wet[k] && bed[k] < 0) { wet[k] = 1; q[tail++] = k; } };
  for (let i = 0; i < W; i++) { push(i); push((H - 1) * W + i); }
  if (!wrap) for (let j = 0; j < H; j++) { push(j * W); push(j * W + W - 1); }
  if (seed) push(seed[1] * W + seed[0]);
  if (!tail) for (let k = 0; k < W * H; k++) push(k);
  while (head < tail) {
    const k = q[head++], j = (k / W) | 0, i = k - j * W;
    if (i > 0) push(k - 1); else if (wrap) push(k + W - 1);
    if (i < W - 1) push(k + 1); else if (wrap) push(k - W + 1);
    if (j > 0) push(k - W);
    if (j < H - 1) push(k + W);
  }
  return wet;
}

// ───────── 지명 (뉴스용) ─────────
const CLASS_RANK = { city: 0, town: 1, suburb: 2, quarter: 2, island: 3, village: 3, neighbourhood: 4, hamlet: 5 };
function gatherPlaces(dom) {
  const out = [], names = new Set(), cells = new Set();
  const add = (name, lon, lat, rank) => {
    if (!name || names.has(name)) return;
    const c = toCell(dom, lon, lat);
    if (!c || cells.has(c[1] * dom.W + c[0])) return;
    names.add(name); cells.add(c[1] * dom.W + c[0]);
    out.push({ name, lon, lat, i: c[0], j: c[1], rank, arrived: false, stage: 0 });
  };
  if (vectorSrc) {
    for (const f of map.querySourceFeatures(vectorSrc, { sourceLayer: 'place' })) {
      const p = f.properties, r = CLASS_RANK[p.class];
      if (r === undefined || f.geometry.type !== 'Point') continue;
      add(p['name:ko'] || p.name, ...f.geometry.coordinates, r * 100 + (p.rank ?? 50));
    }
  }
  for (const [name, lat, lon] of WORLD_CITIES) add(name, lon, lat, 150);
  return out.sort((a, b) => a.rank - b.rank).slice(0, 300);
}
const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
function describe(lon, lat) {
  let best = null;
  for (const [name, la, lo] of WORLD_CITIES) {
    const dx = ((lon - lo + 540) % 360 - 180) * Math.cos(lat * D2R), dy = lat - la;
    const d = Math.hypot(dx, dy) * 111.32;
    if (!best || d < best.d) best = { name, d, dx, dy };
  }
  if (!best || best.d > 2500) return `북위 ${lat.toFixed(1)}° 동경 ${lon.toFixed(1)}°`;
  const dir = DIRS[Math.round(((Math.atan2(best.dx, best.dy) / D2R + 360) % 360) / 45) % 8];
  return `${best.name} ${dir}쪽 ${Math.round(best.d)} km`;
}

// ───────── 가상 뉴스 ─────────
function news(text, big = false) {
  const li = document.createElement('li');
  if (big) li.className = 'big';
  li.innerHTML = `<time>발생 후 ${clock(swe.t)}</time><span></span>`;
  li.lastChild.textContent = text;
  const list = $('news-list');
  list.prepend(li);
  while (list.children.length > 80) list.lastChild.remove();
  $('news-empty').hidden = true;
  ticker(text);
}
let tickerQueue = [], tickerBusy = false;
function ticker(text) {
  tickerQueue.push(text);
  if (tickerQueue.length > 4) tickerQueue = tickerQueue.slice(-4);
  if (!tickerBusy) nextTicker();
}
function nextTicker() {
  const el = $('ticker-text'), text = tickerQueue.shift();
  if (!text) { tickerBusy = false; return; }
  tickerBusy = true;
  el.textContent = text;
  el.classList.remove('run');
  void el.offsetWidth;
  el.style.animationDuration = `${(el.offsetWidth + el.parentElement.offsetWidth) / 140}s`;
  el.classList.add('run');
}
$('ticker-text').addEventListener('animationend', nextTicker);

function updateNews() {
  if (!sim.points.length) return;
  const r = swe.probe(sim.points);
  const arrive = [], flood = [];
  sim.places.forEach((p, k) => {
    const eta = r[4 * k], bed = r[4 * k + 1], mx = r[4 * k + 2], arr = r[4 * k + 3];
    if (bed < 0 ? arr >= 0 : mx > 0.5) p.sunkAt ||= performance.now();
    if (arr >= 0 && !p.arrived) { p.arrived = true; arrive.push({ p, eta: bed < 0 ? Math.max(eta, mx) : eta - bed, arr, sea: bed < 0 }); }
    if (bed >= 0) {
      const stage = mx > 9 ? 3 : mx > 3 ? 2 : mx > 0.5 ? 1 : 0;
      if (stage > p.stage) { p.stage = stage; flood.push({ p, d: mx, stage }); }
    }
  });
  const report = (items, one, many) => {
    items.sort((a, b) => a.p.rank - b.p.rank);
    items.slice(0, 2).forEach((it) => one(it));
    if (items.length > 2) many(items.slice(2));
  };
  report(arrive,
    (a) => news(a.sea ? `${a.p.name} 앞바다에 쓰나미 도달 — 발생 ${dur(a.arr)} 뒤, 수면 +${a.eta.toFixed(1)} m`
                      : `${a.p.name}에 바닷물이 밀려들기 시작 — 발생 ${dur(a.arr)} 뒤`),
    (rest) => news(`${rest[0].p.name} 등 ${rest.length}곳에도 쓰나미가 닿았습니다`));
  report(flood,
    (f) => news(f.stage === 3 ? `${f.p.name} 물 깊이 ${f.d.toFixed(1)} m — 건물 ${Math.floor(f.d / 3)}층 높이까지 잠겼습니다`
              : f.stage === 2 ? `${f.p.name} 물 깊이 ${f.d.toFixed(1)} m, 건물 1층이 물에 잠기는 수준`
              : `${f.p.name} 침수 시작 — 물 깊이 ${f.d.toFixed(1)} m`, f.stage >= 2),
    (rest) => news(`${rest[0].p.name} 외 ${rest.length - 1}곳 침수 (물 깊이 ${Math.max(...rest.map((x) => x.d)).toFixed(1)} m 이상 포함)`, true));
}

// ───────── 시작·초기화 ─────────
const SIDES = { W: 1, E: 2, S: 3, N: 4 };
const SIDE_NAME = { W: '서쪽', E: '동쪽', S: '남쪽', N: '북쪽' };
let building = false;
async function start() {
  if (!swe || building) return;
  const h = +$('height').value, src = $('source').value;
  if (!(h > 0)) { msg('파고를 0보다 큰 숫자로 입력하세요.'); return; }
  if (src === 'point' && !sim.epicenter) { msg('먼저 📍 진원을 누르고 바다 위를 눌러 진원을 정하세요.'); setPicking(true); return; }
  const dom = domainFromView(+$('res').value);
  const epiCell = src === 'point' ? toCell(dom, sim.epicenter.lon, sim.epicenter.lat) : null;
  if (src === 'point' && !epiCell) { msg('진원이 화면 밖에 있습니다. 진원이 보이도록 지도를 옮기거나 진원을 다시 찍으세요.'); return; }

  building = true;
  $('start').disabled = true;
  sim.running = false;
  try {
    const bed = await buildBed(dom, (t) => msg(t));
    const buildings = addBuildings(dom, bed);
    if (epiCell && bed[epiCell[1] * dom.W + epiCell[0]] >= 0) throw new Error('진원이 육지에 있습니다. 바다 위를 찍어 주세요.');
    const wet = wetMask(dom, bed, epiCell);
    if (src !== 'point') {
      const side = SIDES[src], edge = [];
      for (let k = 0; k < (side <= 2 ? dom.H : dom.W); k++)
        edge.push(side === 1 ? k * dom.W : side === 2 ? k * dom.W + dom.W - 1 : side === 3 ? k : (dom.H - 1) * dom.W + k);
      if (edge.filter((k) => wet[k]).length < edge.length * 0.1) throw new Error(`화면 ${SIDE_NAME[src]} 가장자리에 바다가 거의 없습니다. 바다가 그쪽에 오도록 지도를 옮기세요.`);
    }
    swe.manning = Math.max(0, +$('manning').value || 0);
    swe.coriolis = $('coriolis').checked;
    swe.force = src === 'point' ? [0, 0, 1, 0] : [SIDES[src], h, Math.max(5, +$('period').value || 300), 0];
    const source = epiCell && {
      i: epiCell[0], j: epiCell[1], amp: h,
      sigma: Math.max(1.5, (+$('radius').value || 30) * 1000 / 2 / cellAt(dom, epiCell[1] + 0.5)),
    };
    sim.setupArgs = { W: dom.W, H: dom.H, y0: dom.y0, dl: dom.dl, wrap: dom.wrap, bed, wet, source };
    sim.dom = dom;
    sim.buildings = buildings;
    sim.places = gatherPlaces(dom);
    sim.points = sim.places.map((p) => [p.i, p.j]);
    sim.byName = new Map(sim.places.map((p) => [p.name, p]));
    showLayer(dom);
    reset();
    togglePop(null);
    caption(`${fmtH(h)} m`);
    news(src === 'point'
      ? `[가상] ${describe(sim.epicenter.lon, sim.epicenter.lat)} 해상에서 높이 ${h} m 쓰나미 발생`
      : `[가상] ${SIDE_NAME[src]} 먼바다에서 높이 ${h} m 파도가 밀려오고 있습니다`, true);
    msg(buildings ? `건물 ${buildings.toLocaleString()}채를 지형에 넣었습니다.` : dom.cell <= 40 ? '이 화면에서는 건물 윤곽을 찾지 못했습니다.' : '');
  } catch (e) {
    msg(e.message);
  } finally {
    building = false;
    $('start').disabled = false;
  }
}
function reset() {
  if (!sim.setupArgs) return;
  swe.setup(sim.setupArgs);
  for (const p of sim.places) { p.arrived = false; p.stage = 0; p.sunkAt = 0; }
  sim.nextSummary = 1800;
  sim.summaryReal = 0;
  sim.running = true;
  $('pause').textContent = '⏸';
  $('news-list').replaceChildren();
}
function showLayer(dom) {
  const coords = [[dom.west, dom.north], [dom.east, dom.north], [dom.east, dom.south], [dom.west, dom.south]];
  const src = map.getSource('tsunami');
  if (src) { src.setCoordinates(coords); return; }
  map.addSource('tsunami', { type: 'canvas', canvas: $('sim'), coordinates: coords, animate: true });
  const before = map.getLayer('buildings') ? 'buildings' : map.getLayer('countries') ? 'countries' : undefined;
  map.addLayer({ id: 'tsunami', type: 'raster', source: 'tsunami', paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, before);
}
$('start').addEventListener('click', start);
$('reset').addEventListener('click', () => { if (sim.setupArgs) { reset(); news('[가상] 같은 조건으로 다시 시작합니다', true); } });
$('pause').addEventListener('click', () => {
  if (!sim.setupArgs) return;
  sim.running = !sim.running;
  $('pause').textContent = sim.running ? '⏸' : '▶';
});

// ───────── 예시 장소 ─────────
const PRESETS = {
  korea: { bounds: [[124.6, 32.6], [130.4, 38.7]], source: 'point', epi: [127.01, 33.28], h: 100, radius: 30 },
  haeundae: { center: [129.162, 35.156], zoom: 14.6, source: 'S', h: 30, period: 240 },
  tokyo: { center: [139.79, 35.625], zoom: 14.2, source: 'S', h: 20, period: 300 },
  tohoku: { bounds: [[129, 26], [158, 46]], source: 'point', epi: [142.86, 38.1], h: 10, radius: 80 },
  sumatra: { bounds: [[76, -10], [104, 18]], source: 'point', epi: [94.5, 3.5], h: 10, radius: 120 },
  chile: { bounds: [[110, -58], [295, 62]], source: 'point', epi: [285.5, -38], h: 15, radius: 150 },
  world: { center: [150, 15], zoom: 1.2 },
};
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => goPreset(b.dataset.preset)));
async function goPreset(key) {
  const p = PRESETS[key];
  togglePop(null);
  if (!p) return;
  if (p.bounds) map.fitBounds(p.bounds, { padding: 20, duration: 1500 });
  else map.flyTo({ center: p.center, zoom: p.zoom, duration: 1500 });
  if (!p.h) return;
  $('source').value = p.source; syncSource();
  $('height').value = p.h; setHeight(p.h, false);
  if (p.radius) $('radius').value = p.radius;
  if (p.period) $('period').value = p.period;
  if (p.epi) setEpicenter(...p.epi);
  await new Promise((r) => map.once('idle', r));
  start();
}

// ───────── 큰 자막 (영상의 "500 m") ─────────
function caption(text) {
  const el = $('caption');
  $('caption-text').textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

// ───────── 지명 라벨 (영상 스타일: 점 + "이름(해발m)", 잠기면 연파랑으로 가라앉음) ─────────
const labelCanvas = $('labels'), lctx = labelCanvas.getContext('2d');
let ldpr = 1;
function sizeLabels() {
  ldpr = optimize ? 1 : Math.min(2, devicePixelRatio || 1);
  labelCanvas.width = Math.round(innerWidth * ldpr);
  labelCanvas.height = Math.round(innerHeight * ldpr);
}
sizeLabels();
addEventListener('resize', sizeLabels);

const LABEL_CLASS = { city: 0, town: 1, village: 2, suburb: 2, quarter: 3, neighbourhood: 3, hamlet: 4 };
const elevCache = new Map();
let labelItems = [];
async function elevationAt(lon, lat, z) {
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  const n = 2 ** z, x = (lon + 180) / 360 * n, y = Math.min(n - 1e-6, Math.max(0, (Math.PI - mercY(lat)) / (2 * Math.PI) * n));
  const t = await fetchTile(z, Math.floor(x) % n, Math.floor(y));
  return t[Math.floor((y % 1) * 256) * 256 + Math.floor((x % 1) * 256)];
}
function refreshLabels() {
  const z = map.getZoom();
  const maxClass = z < 5 ? -1 : z < 7 ? 0 : z < 9 ? 1 : z < 11 ? 2 : z < 13 ? 3 : 4;
  const items = new Map();
  if (vectorSrc) {
    for (const f of map.querySourceFeatures(vectorSrc, { sourceLayer: 'place' })) {
      const p = f.properties, c = LABEL_CLASS[p.class];
      if (c === undefined || c > maxClass || f.geometry.type !== 'Point') continue;
      const name = p['name:ko'] || p.name;
      if (name && !items.has(name)) items.set(name, { name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], rank: c * 100 + (p.rank ?? 50) });
    }
  }
  if (z >= 2.5) for (const [name, lat, lon] of WORLD_CITIES) if (!items.has(name)) items.set(name, { name, lon, lat, rank: z < 5 ? 0 : 60 });
  labelItems = [...items.values()].sort((a, b) => a.rank - b.rank).slice(0, 400);
  const ez = Math.max(5, Math.min(11, Math.round(z) + 1));
  for (const it of labelItems.slice(0, 160)) {
    it.key = `${it.name}|${ez}`;
    if (elevCache.has(it.key)) continue;
    elevCache.set(it.key, null);
    elevationAt(it.lon, it.lat, ez).then((e) => elevCache.set(it.key, Math.max(0, Math.round(e)))).catch(() => {});
  }
}
let labelTimer;
const scheduleLabels = () => { clearTimeout(labelTimer); labelTimer = setTimeout(refreshLabels, 250); };
map.on('moveend', scheduleLabels);
map.on('sourcedata', (e) => { if (e.sourceId === vectorSrc && e.isSourceLoaded) scheduleLabels(); });
refreshLabels();

function drawLabels(now) {
  const W = innerWidth, H = innerHeight;
  lctx.setTransform(ldpr, 0, 0, ldpr, 0, 0);
  lctx.clearRect(0, 0, W, H);
  const f = Math.max(12, Math.min(17, W * 0.034));
  lctx.font = `500 ${f}px "Noto Sans", system-ui, sans-serif`;
  lctx.textBaseline = 'middle';
  lctx.lineJoin = 'round';
  const placed = [];
  for (const it of labelItems) {
    if (placed.length >= (optimize ? 35 : 70)) break;
    const pt = map.project([it.lon, it.lat]);
    if (pt.x < -60 || pt.y < -30 || pt.x > W + 60 || pt.y > H + 30) continue;
    const elev = it.key ? elevCache.get(it.key) : null;
    const text = elev != null ? `${it.name}(${elev}m)` : it.name;
    const tw = lctx.measureText(text).width;
    const tx = pt.x + f * 0.32, ty = pt.y + f * 0.7;
    const box = [pt.x - 6, pt.y - 6, tx + tw + 4, ty + f * 0.6];
    if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    placed.push(box);
    const sp = sim.byName?.get(it.name);
    const since = sp?.sunkAt ? (now - sp.sunkAt) / 1000 : -1;
    const glow = since >= 0 ? Math.max(0, 1 - since / 1.2) : 0;           // 물이 닿는 순간 하얗게 빛나고
    const sunk = since >= 0 ? Math.min(1, Math.max(0, (since - 0.6) / 0.8)) : 0;   // 잠기면 가라앉는다
    const dot = () => { lctx.beginPath(); lctx.arc(pt.x, pt.y, f * 0.16, 0, Math.PI * 2); lctx.fill(); };
    if (glow > 0) {
      lctx.shadowColor = `rgba(255,255,255,${glow})`; lctx.shadowBlur = f * 0.6;
      lctx.lineWidth = f * 0.22; lctx.strokeStyle = `rgba(255,255,255,${0.9 * glow})`;
      lctx.strokeText(text, tx, ty);
      lctx.shadowColor = 'transparent';
    }
    if (sunk < 1) {
      lctx.globalAlpha = 1 - sunk;
      lctx.fillStyle = '#fff';
      dot();
      lctx.shadowColor = 'rgba(0,0,0,.9)'; lctx.shadowBlur = f * 0.18;
      lctx.lineWidth = f * 0.1; lctx.strokeStyle = 'rgba(0,0,0,.55)';
      lctx.strokeText(text, tx, ty);
      lctx.shadowColor = 'transparent';
      lctx.fillText(text, tx, ty);
      lctx.globalAlpha = 1;
    }
    if (sunk > 0) {
      lctx.fillStyle = `rgba(188,211,245,${0.9 * sunk})`;
      dot();
      lctx.fillText(text, tx, ty);
    }
  }
}

// ───────── 최적화 모드 ─────────
// 느린 휴대폰·컴퓨터용: 화면 해상도 1배, 계산 격자 512 이하, 30fps, 한 프레임 계산량 절반, 3D 건물 끔, 라벨 절반.
// 처음에는 터치 기기나 코어·메모리가 적은 기기면 자동으로 켜고, 직접 바꾸면 그 선택을 기억한다.
function applyOptimize(announce) {
  $('optimize').classList.toggle('on', optimize);
  $('optimize').setAttribute('aria-pressed', String(optimize));
  map.setPixelRatio(optimize ? 1 : Math.min(2, devicePixelRatio || 1));
  if (map.getLayer('buildings')) map.setLayoutProperty('buildings', 'visibility', optimize ? 'none' : 'visible');
  sizeLabels();
  if (optimize && +$('res').value > 512) $('res').value = '512';
  if (announce) msg(optimize ? '최적화 모드: 화면 해상도 1배 · 격자 512 이하 · 30fps · 3D 건물 끔' : '최적화 모드를 껐습니다');
}
$('optimize').addEventListener('click', () => {
  optimize = !optimize;
  try { localStorage.setItem(OPT_KEY, optimize ? '1' : '0'); } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
  applyOptimize(true);
});
applyOptimize(false);

// ───────── 루프 ─────────
let last = performance.now(), backlog = 0, nextInfo = 0, rateT0 = 0, rateSim0 = 0, simRate = 60, lastSimT = 0, odd = false;
function frame(now) {
  if (optimize && (odd = !odd)) { requestAnimationFrame(frame); return; }   // 최적화: 두 프레임에 한 번만 계산·그리기
  const fdt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (swe && sim.setupArgs) {
    if (sim.running) {
      const budget = Math.max(1, Math.floor((optimize ? 1.25e7 : 2.5e7) / (swe.W * swe.H)));
      const speed = +$('speed').value;
      let n = budget;
      if (speed) {
        backlog = Math.min(backlog + speed * fdt, swe.dt * budget);
        n = Math.floor(backlog / swe.dt);
        backlog -= n * swe.dt;
      }
      swe.step(n);
    }
    // 실제로 나온 배속(계산 초/실제 초)으로, 물이 막 들이닥친 곳이 약 1초 동안 하얗게 보이도록
    if (fdt > 0) simRate += ((sim.running ? Math.max(0, swe.t - lastSimT) / fdt : simRate) - simRate) * 0.1;
    lastSimT = swe.t;
    swe.render(+$('view').value, Math.max(0.3, swe.amp), Math.max(swe.dt * 5, simRate * 0.9));
    if (now > nextInfo) {
      nextInfo = now + (optimize ? 1000 : 500);
      const s = swe.stats();
      $('s-time').textContent = clock(swe.t);
      $('status').textContent = `${clock(swe.t)}${s.floodMax > 0.005 ? ` · 침수 ${s.floodMax < 10 ? s.floodMax.toFixed(2) : Math.round(s.floodMax).toLocaleString()} km²` : ''}`;
      $('s-rate').textContent = rateT0 ? `×${Math.round((swe.t - rateSim0) / ((now - rateT0) / 1000)).toLocaleString()}` : '-';
      rateT0 = now; rateSim0 = swe.t;
      $('s-grid').textContent = `${swe.W}×${swe.H}`;
      $('s-cell').textContent = meters(sim.dom.cell);
      $('s-dt').textContent = `${swe.dt < 1 ? swe.dt.toFixed(2) : swe.dt.toFixed(1)} s`;
      $('s-bld').textContent = sim.buildings ? `${sim.buildings.toLocaleString()}채` : '-';
      $('s-area').textContent = `${s.floodMax < 10 ? s.floodMax.toFixed(2) : Math.round(s.floodMax).toLocaleString()} km²`;
      $('s-run').textContent = s.runup > 0 ? `${s.runup.toFixed(1)} m` : '-';
      if (sim.running) {
        updateNews();
        if (swe.t > sim.nextSummary && now > sim.summaryReal) {
          sim.nextSummary = swe.t + 1800;
          sim.summaryReal = now + 15000;
          if (s.floodMax > 0.01) news(`누적 침수 면적 ${s.floodMax.toFixed(1)} km², 가장 높이 올라온 물 해발 ${s.runup.toFixed(1)} m`);
        }
      }
    }
  }
  drawLabels(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
syncSource();
