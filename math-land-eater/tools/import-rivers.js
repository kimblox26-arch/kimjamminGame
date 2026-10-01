'use strict';
/* 강·하천 데이터 만들기
 *   node tools/import-rivers.js <earth-rivers map.geo.json>
 * 입력: npm 패키지 @geo-maps/earth-rivers-10m 의 map.geo.json (OpenStreetMap 의 강 물 면, ODbL)
 * 출력: mapdata/korea-rivers.json
 *   lines: 물 면 조각들을 가까운 것끼리 이어 만든 강 줄기 [[폭(m), 경도, 위도, 경도, 위도, …], …]
 *   (원본 물 면은 모양이 거칠어서 그리지 않고, 강 폭을 어림하는 데만 쓴다)
 * 원본은 강이 군데군데 끊긴 조각이라, 조각의 가운데를 최소 신장 트리(가까운 점끼리 잇기)로 연결하고 부드럽게 다듬어 물길을 만든다. */
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('사용법: node tools/import-rivers.js <map.geo.json>'); process.exit(1); }
const land = require('../mapdata/korea-land.json').rings;
const MAX_GAP_KM = 6;     // 이보다 멀리 떨어진 조각은 잇지 않는다
const MIN_LEN_KM = 6;     // 이보다 짧은 물길(연못 같은 것)은 버린다

const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const onLand = (x, y) => land.some(r => inRing(x, y, r));
const km = (a, b) => Math.hypot((a[0] - b[0]) * 88.4, (a[1] - b[1]) * 111);

const geo = JSON.parse(fs.readFileSync(src, 'utf8'));
const all = geo.type === 'GeometryCollection' ? geo.geometries[0].coordinates : geo.features.flatMap(f => f.geometry.coordinates);
// 남한 땅 위에 있는 물 면만
const polys = all.filter(p => p[0].some(([x, y]) => x > 124 && x < 132 && y > 33 && y < 38.7 && onLand(x, y))).map(p => p[0].map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]));

// 점 = 물 면 조각의 가운데. 가까운 조각끼리 짧은 순서로 잇는다 (최소 신장 트리, 크루스칼)
const pts = polys.map(p => { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; });
const parent = pts.map((_, i) => i), find = a => (parent[a] === a ? a : (parent[a] = find(parent[a])));
const G = 0.06, grid = new Map(), cand = [], adj = pts.map(() => []);
pts.forEach((p, i) => { const k = Math.floor(p[0] / G) + ',' + Math.floor(p[1] / G); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
pts.forEach((p, i) => {
  const gx = Math.floor(p[0] / G), gy = Math.floor(p[1] / G);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const j of grid.get(gx + dx + ',' + (gy + dy)) || []) {
    if (j <= i) continue;
    const d = km(p, pts[j]);
    if (d <= MAX_GAP_KM) cand.push([d, i, j]);
  }
});
cand.sort((a, b) => a[0] - b[0]);
for (const [, i, j] of cand) { const a = find(i), b = find(j); if (a !== b) { parent[a] = b; adj[i].push(j); adj[j].push(i); } }
// 갈림길 사이의 줄기를 한 줄로 모아 부드럽게 (차이킨 곡선)
const used = new Set(), chains = [], ek = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
for (let s = 0; s < pts.length; s++) {
  if (adj[s].length === 2) continue;
  for (const n0 of adj[s]) {
    if (used.has(ek(s, n0))) continue;
    const c = [s];
    let prev = s, cur = n0;
    used.add(ek(s, n0));
    for (;;) {
      c.push(cur);
      if (adj[cur].length !== 2) break;
      const nx = adj[cur][0] === prev ? adj[cur][1] : adj[cur][0];
      if (used.has(ek(cur, nx))) break;
      used.add(ek(cur, nx)); prev = cur; cur = nx;
    }
    chains.push(c);
  }
}
const chaikin = l => { for (let it = 0; it < 2; it++) { const o = [l[0]]; for (let k = 0; k < l.length - 1; k++) { const [a, b] = [l[k], l[k + 1]]; o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]); } o.push(l[l.length - 1]); l = o; } return l; };
// 짧은 물길(작은 연못 등)은 버린다
const len = new Map();
for (const c of chains) { const r = find(c[0]); let L = 0; for (let k = 1; k < c.length; k++) L += km(pts[c[k - 1]], pts[c[k]]); len.set(r, (len.get(r) || 0) + L); }
const keep = i => (len.get(find(i)) || 0) >= MIN_LEN_KM;
const r4 = v => +v.toFixed(4);
// 강 폭 어림: 물 면 넓이 ÷ 길이 (줄기마다 가운데값, 60~900m)
const widthOf = p => {
  let a = 0, L = 0;
  for (let k = 0, j = p.length - 1; k < p.length; j = k++) a += (p[j][0] * 88.4) * (p[k][1] * 111) - (p[k][0] * 88.4) * (p[j][1] * 111);
  for (let x = 0; x < p.length; x++) for (let y = x + 1; y < p.length; y++) L = Math.max(L, km(p[x], p[y]));
  return L > 0 ? (Math.abs(a) / 2) / L : 0;
};
const chainWidth = c => { const w = c.map(i => widthOf(polys[i])).sort((a, b) => a - b); return Math.round(Math.max(60, Math.min(900, w[w.length >> 1] * 1000))); };
const out = {
  source: 'OpenStreetMap contributors (ODbL) via @geo-maps/earth-rivers-10m',
  lines: chains.filter(c => keep(c[0])).map(c => [chainWidth(c), ...chaikin(c.map(i => pts[i])).flatMap(([x, y]) => [r4(x), r4(y)])]),
};
fs.writeFileSync(path.join(__dirname, '../mapdata/korea-rivers.json'), JSON.stringify(out));
console.log(`물길 ${out.lines.length}개 → mapdata/korea-rivers.json`, '폭(m):', out.lines.map(l => l[0]).sort((a, b) => a - b).filter((_, k, a) => k % Math.ceil(a.length / 10) === 0).join(' '));
