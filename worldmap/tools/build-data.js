// 세계 지도 편집기 데이터 빌드 스크립트 (개발용, 런타임에는 필요 없음)
// 사용법: npm i canvas flag-icons && node build-data.js <NaturalEarth geojson 폴더> <출력 폴더>
// 필요 파일 (https://github.com/nvkelso/natural-earth-vector/tree/master/geojson):
//   ne_10m_admin_0_countries, ne_10m_admin_1_states_provinces, ne_10m_populated_places,
//   ne_50m_geography_marine_polys, ne_50m_lakes
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');

const SRC = process.argv[2], OUT = process.argv[3];
const W = 4096, H = 2048;
const rd = (n) => JSON.parse(fs.readFileSync(path.join(SRC, n + '.geojson'))).features;
const X = (lon) => (lon + 180) / 360 * W, Y = (lat) => (90 - lat) / 180 * H;

// ── 국가 ──
const adm0 = {};
for (const f of rd('ne_10m_admin_0_countries')) {
  const p = f.properties;
  let iso = (p.ISO_A2_EH && p.ISO_A2_EH !== '-99') ? p.ISO_A2_EH : p.ISO_A2;
  adm0[p.ADM0_A3] = { name: p.NAME_KO || p.NAME, en: p.NAME, iso: iso === '-99' ? '' : iso.toLowerCase(), pop: p.POP_EST };
}

// ── 지방 ──
const a1 = rd('ne_10m_admin_1_states_provinces');
const countries = [], cIndex = {};
const provinces = [];
for (const f of a1) {
  const p = f.properties;
  const a3 = p.adm0_a3;
  if (!(a3 in cIndex)) {
    const c = adm0[a3] || { name: p.admin, en: p.admin, iso: (p.iso_a2 || '').toLowerCase() };
    cIndex[a3] = countries.length;
    countries.push({ a3, name: c.name, en: c.en, iso: /^[a-z]{2}$/.test(c.iso) ? c.iso : '' });
  }
  provinces.push({ name: p.name_ko || p.name || p.admin, en: p.name || '', c: cIndex[a3], lon: p.longitude, lat: p.latitude, f });
}

// ── 래스터화 (안티앨리어싱 없음, 색 = 지방 ID) ──
const cv = createCanvas(W, H), g = cv.getContext('2d');
g.antialias = 'none';
g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
function tracePoly(poly) {
  for (const ring of poly) {
    ring.forEach(([lon, lat], k) => k ? g.lineTo(X(lon), Y(lat)) : g.moveTo(X(lon), Y(lat)));
    g.closePath();
  }
}
function fillGeom(geom) {
  g.beginPath();
  if (geom.type === 'Polygon') tracePoly(geom.coordinates);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(tracePoly);
  g.fill('evenodd');
}
provinces.forEach((p, i) => {
  const id = i + 1;
  g.fillStyle = `rgb(${(id >> 16) & 255},${(id >> 8) & 255},${id & 255})`;
  if (p.f.geometry) fillGeom(p.f.geometry);
});
g.fillStyle = '#000';
for (const f of rd('ne_50m_lakes')) if (f.geometry) fillGeom(f.geometry);

const img = g.getImageData(0, 0, W, H).data;
const pid = new Uint16Array(W * H);
const area = new Uint32Array(provinces.length + 1);
for (let i = 0; i < W * H; i++) {
  const v = (img[i * 4] << 16) | (img[i * 4 + 1] << 8) | img[i * 4 + 2];
  pid[i] = v; area[v]++;
}
let fixed = 0;
provinces.forEach((p, i) => {
  if (area[i + 1] === 0) {
    const x = Math.min(W - 1, Math.max(0, Math.floor(X(p.lon)))), y = Math.min(H - 1, Math.max(0, Math.floor(Y(p.lat))));
    pid[y * W + x] = i + 1; fixed++;
  }
});
console.log('provinces', provinces.length, 'countries', countries.length, 'tiny fixed', fixed);

// RLE: (값 u16, 길이 u16) 반복
const rle = [];
for (let i = 0; i < pid.length;) {
  const v = pid[i]; let n = 1;
  while (i + n < pid.length && pid[i + n] === v && n < 65535) n++;
  rle.push(v, n); i += n;
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'provinces.bin'), Buffer.from(new Uint16Array(rle).buffer));

// ── 도시 ──
const cities = [];
for (const f of rd('ne_10m_populated_places')) {
  const p = f.properties;
  const cap = p.ADM0CAP == 1;
  if (!cap && p.SCALERANK > 5) continue;
  cities.push([p.NAME_KO || p.NAME, +p.LONGITUDE.toFixed(3), +p.LATITUDE.toFixed(3), p.SCALERANK, cap ? 1 : 0]);
}
cities.sort((a, b) => a[3] - b[3]);

// ── 바다 이름 (가장 큰 폴리곤 중심 → 육지면 가까운 바다로 이동) ──
function ringCentroid(r) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const t = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += t; cx += (r[j][0] + r[i][0]) * t; cy += (r[j][1] + r[i][1]) * t;
  }
  return [cx / (3 * a), cy / (3 * a), Math.abs(a / 2)];
}
const oceans = [];
for (const f of rd('ne_50m_geography_marine_polys')) {
  const p = f.properties; if (!f.geometry || !p.name) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null;
  for (const pl of polys) { const c = ringCentroid(pl[0]); if (!best || c[2] > best[2]) best = c; }
  let [lon, lat] = best;
  let x = Math.floor(X(lon)), y = Math.floor(Y(lat));
  if (pid[y * W + x]) {
    search: for (let r = 1; r < 200; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = (x + dx + W) % W, yy = y + dy;
      if (yy < 0 || yy >= H || pid[yy * W + xx]) continue;
      x = xx; y = yy; break search;
    }
    lon = x / W * 360 - 180; lat = 90 - y / H * 180;
  }
  oceans.push([p.name_ko || p.name, +lon.toFixed(2), +lat.toFixed(2), p.scalerank]);
}

fs.writeFileSync(path.join(OUT, 'world.json'), JSON.stringify({
  W, H,
  countries: countries.map((c) => [c.name, c.en, c.iso]),
  provinces: provinces.map((p) => [p.name, p.en === p.name ? '' : p.en, p.c]),
  cities, oceans,
}));

// ── 국기 아틀라스 (flag-icons, MIT) ──
(async () => {
  const dir = path.join(require.resolve('flag-icons/package.json'), '..', 'flags', '4x3');
  const codes = fs.readdirSync(dir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)).sort();
  const FW = 64, FH = 48, COLS = 16;
  const at = createCanvas(FW * COLS, FH * Math.ceil(codes.length / COLS)), ag = at.getContext('2d');
  const ok = [];
  for (const code of codes) {
    let svg = fs.readFileSync(path.join(dir, code + '.svg'), 'utf8');
    svg = svg.replace(/<svg\b/, `<svg width="${FW * 2}" height="${FH * 2}"`);
    try {
      const im = await loadImage(Buffer.from(svg));
      const k = ok.length;
      ag.drawImage(im, (k % COLS) * FW, Math.floor(k / COLS) * FH, FW, FH);
      ok.push(code);
    } catch (e) { console.log('flag fail', code, e.message); }
  }
  fs.writeFileSync(path.join(OUT, 'flags.png'), at.toBuffer('image/png'));
  fs.writeFileSync(path.join(OUT, 'flags.json'), JSON.stringify({ w: FW, h: FH, cols: COLS, codes: ok }));
  console.log('flags', ok.length);
})();
