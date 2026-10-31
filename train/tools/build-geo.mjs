// Natural Earth 10m 데이터로 train/data/geo.json 을 만든다.
//   node train/tools/build-geo.mjs <natural-earth geojson 폴더>
// 필요한 파일: ne_10m_land, ne_10m_minor_islands, ne_10m_rivers_lake_centerlines, ne_10m_railroads (.geojson)
// 해안선·섬은 한반도 범위로 잘라내고, 일반철도 노선은 실제 철도 선형을 따라 역과 역 사이 경로를 찾는다.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LINES } from '../js/data/stations.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node build-geo.mjs <ne-dir>'); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
const load = f => JSON.parse(fs.readFileSync(path.join(dir, f + '.geojson'), 'utf8'));
const B = [124.5, 33.0, 132.0, 38.65];
const r4 = v => Math.round(v * 1e4) / 1e4;

// 사각형으로 다각형 자르기 (Sutherland–Hodgman)
function clipRing(ring) {
  const edges = [
    [p => p[0] >= B[0], (a, b) => lerpX(a, b, B[0])], [p => p[0] <= B[2], (a, b) => lerpX(a, b, B[2])],
    [p => p[1] >= B[1], (a, b) => lerpY(a, b, B[1])], [p => p[1] <= B[3], (a, b) => lerpY(a, b, B[3])]];
  let out = ring;
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}
const lerpX = (a, b, x) => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])];
const lerpY = (a, b, y) => [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y];
const inB = p => p[0] >= B[0] - 0.3 && p[0] <= B[2] + 0.3 && p[1] >= B[1] - 0.3 && p[1] <= B[3] + 0.3;

function rings(gj) {
  const res = [];
  for (const f of gj.features) {
    const g = f.geometry; if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const outer = poly[0];
      if (!outer.some(inB)) continue;
      const c = clipRing(outer);
      if (c.length >= 3) res.push(c.flatMap(p => [r4(p[0]), r4(p[1])]));
    }
  }
  return res;
}
const coast = [...rings(load('ne_10m_land')), ...rings(load('ne_10m_minor_islands'))];

const rivers = [];
for (const f of load('ne_10m_rivers_lake_centerlines').features) {
  const g = f.geometry; if (!g) continue;
  const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  for (const p of parts) if (p.some(inB)) rivers.push({ name: f.properties.name, pts: p.flatMap(q => [r4(q[0]), r4(q[1])]) });
}

// ── 철도 그래프 ──
const KM = (a, b) => { const dx = (a[0] - b[0]) * 88.6, dy = (a[1] - b[1]) * 110.9; return Math.hypot(dx, dy); };
const nodes = [], nodeIdx = new Map(), adj = [];
const SN = 0.0015;
function node(p) {
  const k = Math.round(p[0] / SN) + ',' + Math.round(p[1] / SN);
  let i = nodeIdx.get(k);
  if (i === undefined) { i = nodes.length; nodes.push(p); adj.push([]); nodeIdx.set(k, i); }
  return i;
}
const ends = [];
for (const f of load('ne_10m_railroads').features) {
  const g = f.geometry; if (!g) continue;
  const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  for (const p of parts) {
    if (!p.some(inB)) continue;
    let prev = -1;
    for (const q of p) {
      const i = node(q);
      if (prev >= 0 && prev !== i) { const d = KM(nodes[prev], nodes[i]); adj[prev].push([i, d]); adj[i].push([prev, d]); }
      prev = i;
    }
    ends.push(node(p[0]), node(p[p.length - 1]));
  }
}
// 끊어진 끝점을 가까운 노드에 잇는다
for (const e of ends) {
  if (adj[e].length > 1) continue;
  let best = -1, bd = 0.6;
  for (let j = 0; j < nodes.length; j++) {
    if (j === e || adj[e].some(a => a[0] === j)) continue;
    const d = KM(nodes[e], nodes[j]); if (d < bd) { bd = d; best = j; }
  }
  if (best >= 0) { adj[e].push([best, bd]); adj[best].push([e, bd]); }
}
function nearest(p) {
  let best = -1, bd = 3;
  for (let j = 0; j < nodes.length; j++) { const d = KM(p, nodes[j]); if (d < bd) { bd = d; best = j; } }
  return best;
}
function dijkstra(a, b) {
  const dist = new Float64Array(nodes.length).fill(Infinity), prev = new Int32Array(nodes.length).fill(-1);
  dist[a] = 0; const heap = [[0, a]];
  while (heap.length) {
    let mi = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[mi][0]) mi = i;
    const [d, u] = heap[mi]; heap[mi] = heap[heap.length - 1]; heap.pop();
    if (d > dist[u]) continue; if (u === b) break;
    for (const [v, w] of adj[u]) if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; heap.push([dist[v], v]); }
  }
  if (!isFinite(dist[b])) return null;
  const out = []; for (let u = b; u >= 0; u = prev[u]) out.push(nodes[u]);
  return { pts: out.reverse(), len: dist[b] };
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let md = 0, mi = -1;
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1], L = Math.hypot(bx - ax, by - ay) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const rail = {};
for (const line of LINES) {
  if (line.type !== 'rail') continue;
  const st = line.st.split('|').map(s => { const t = s.trim().split(/\s+/); return [+t[2], +t[1]]; });
  const out = [st[0]]; let snapped = 0;
  for (let i = 1; i < st.length; i++) {
    const a = st[i - 1], b = st[i], direct = KM(a, b);
    const na = nearest(a), nb = nearest(b);
    let seg = null;
    if (na >= 0 && nb >= 0 && na !== nb) {
      const r = dijkstra(na, nb);
      if (r && r.len < direct * 1.45 + 1.5) seg = r.pts;
    }
    if (seg) { snapped++; for (const p of simplify(seg, 0.0002)) if (KM(p, a) > 0.3 && KM(p, b) > 0.3) out.push(p); }
    out.push(b);
  }
  rail[line.id] = out.flatMap(p => [r4(p[0]), r4(p[1])]);
  console.log(line.id, `${snapped}/${st.length - 1} 구간 실제 선형`, out.length, 'pts');
}

const geo = { bbox: B, coast, rivers, rail };
const outFile = path.join(here, '../data/geo.json');
fs.writeFileSync(outFile, JSON.stringify(geo));
console.log('coast rings', coast.length, 'rivers', rivers.length, 'bytes', fs.statSync(outFile).size);
