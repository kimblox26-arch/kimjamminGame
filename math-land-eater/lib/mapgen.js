'use strict';
/* 매뜨 땅먹 — 지도 만들기
 * 실제 해안선 안에 무작위 점(포아송 원판 표본)을 뿌리고, 학교 위치도 점으로 넣은 뒤
 * 보로노이 다각형으로 나눠 사각형·오각형·육각형… 모양의 땅 칸을 만든다.
 * 각 학교는 자기 위치를 품은 칸 하나를 본부 땅으로 가진다. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { project, decodeRing, neighborsFromRings } = require('../public/js/shared.js');

const VERSION = 3;
const SPACING = 50;    // 칸 사이 평균 거리 (지도 단위 1 ≈ 13.9m → 약 700m)
const MIN_GAP = 22;    // 학교끼리 이보다 가까우면 살짝 떨어뜨린다 (≈300m)
const MARGIN = 400;

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// "시도|시군구|학교:위도,경도;…" 형식을 읽는다
function parseSchools(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [sido, sigungu, list] = line.split('|');
    for (const item of (list || '').split(';')) {
      const m = item.match(/^([^@:]+)(?:@([^:]*))?:(-?[\d.]+),(-?[\d.]+)(?:,(https?:\/\/\S+))?$/);
      if (!m) continue;
      const nm = m[1].trim();
      out.push({ name: /(학교|분교장|분교)$/.test(nm) ? nm : nm + '초등학교', sido: sido.trim(), sigungu: (sigungu || '').trim(), dong: (m[2] || '').trim(), lat: +m[3], lon: +m[4], url: m[5] || '' });
    }
  }
  return out;
}

const area = p => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; };

// 볼록 다각형을 반평면 n·p <= c 로 자른다. 꼭짓점 [x, y, 다음 변을 만든 이웃 번호]
function clipHalf(P, nx, ny, c, tag) {
  const out = [];
  for (let k = 0; k < P.length; k++) {
    const A = P[k], B = P[(k + 1) % P.length];
    const da = nx * A[0] + ny * A[1] - c, db = nx * B[0] + ny * B[1] - c;
    if (da <= 0) {
      out.push(A);
      if (db > 0) { const t = da / (da - db); out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, tag]); }
    } else if (db <= 0) {
      const t = da / (da - db);
      out.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2]]);
    }
  }
  return out;
}

// 아무 모양 다각형(해안선)을 볼록 다각형(칸)으로 자른다 (서덜랜드–호지먼)
function clipByConvex(subject, clip) {
  const sign = area(clip) > 0 ? 1 : -1;
  let out = subject;
  for (let k = 0; k < clip.length && out.length; k++) {
    const A = clip[k], B = clip[(k + 1) % clip.length], ex = B[0] - A[0], ey = B[1] - A[1];
    const side = p => sign * (ex * (p[1] - A[1]) - ey * (p[0] - A[0]));
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length], sc = side(cur), sp = side(prev);
      if ((sc >= 0) !== (sp >= 0)) { const t = sp / (sp - sc); out.push([prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t]); }
      if (sc >= 0) out.push(cur);
    }
  }
  return out;
}

function encodeRing(p) {
  const out = [];
  let px = 0, py = 0, prevKey = '';
  for (const [x, y] of p) {
    const qx = Math.round(x), qy = Math.round(y), key = qx + ',' + qy;
    if (key === prevKey) continue;
    out.push(qx - px, qy - py);
    px = qx; py = qy; prevKey = key;
  }
  return out;
}

function buildMap({ landFile, schoolsFile, cacheDir }) {
  const t0 = Date.now();
  const landRings = JSON.parse(fs.readFileSync(landFile, 'utf8')).rings;
  const schoolsText = fs.readFileSync(schoolsFile, 'utf8');
  const schools = parseSchools(schoolsText);
  const hash = crypto.createHash('sha1').update(`${VERSION}|${SPACING}|${MIN_GAP}|`).update(JSON.stringify(landRings)).update(schoolsText).digest('hex').slice(0, 12);
  // 같은 재료로 만든 지도가 있으면 그대로 쓴다 (만드는 데 십몇 초 걸리니까)
  const cacheFile = cacheDir ? path.join(cacheDir, `map-${hash}.json`) : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      c.toMap = (lat, lon) => { const [x, y] = project(lon, lat); return [x - c.ox, y - c.oy]; };
      c.stats.ms = Date.now() - t0;
      c.stats.cached = true;
      return c;
    } catch { /* 다시 만든다 */ }
  }
  const rand = mulberry32(20260930);

  // ---- 1) 해안선을 지도 좌표로 ----
  const polys = landRings.map(r => r.map(([lo, la]) => project(lo, la)));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const ox = minX - MARGIN, oy = minY - MARGIN, W = Math.ceil(maxX - ox + MARGIN), H = Math.ceil(maxY - oy + MARGIN);
  for (const p of polys) for (const q of p) { q[0] -= ox; q[1] -= oy; }
  const toMap = (lat, lon) => { const [x, y] = project(lon, lat); return [x - ox, y - oy]; };

  // 해안선 변 색인: 가로 띠(점이 땅 안인지 판정) + 네모 칸(해안 근처 찾기)
  const B = 512, bw = Math.ceil(W / B), bh = Math.ceil(H / B);
  const band = Array.from({ length: bh }, () => []), egrid = Array.from({ length: bw * bh }, () => []);
  const pbox = polys.map((p, pi) => {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [ax, ay] = p[j], [bx, by] = p[i], e = [ax, ay, bx, by, pi];
      bb[0] = Math.min(bb[0], bx); bb[1] = Math.min(bb[1], by); bb[2] = Math.max(bb[2], bx); bb[3] = Math.max(bb[3], by);
      const gx0 = Math.floor(Math.min(ax, bx) / B), gx1 = Math.floor(Math.max(ax, bx) / B), gy0 = Math.floor(Math.min(ay, by) / B), gy1 = Math.floor(Math.max(ay, by) / B);
      for (let gy = gy0; gy <= gy1; gy++) { band[gy].push(e); for (let gx = gx0; gx <= gx1; gx++) egrid[gy * bw + gx].push(e); }
    }
    return bb;
  });
  function landAt(x, y) { // 몇 번째 땅(본토/섬)인지, 바다면 -1
    const gy = Math.floor(y / B);
    if (gy < 0 || gy >= bh) return -1;
    const hits = [];
    for (const [ax, ay, bx, by, pi] of band[gy]) if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hits.push(pi);
    hits.sort((a, b) => a - b);
    for (let i = 0; i < hits.length;) { let j = i; while (j < hits.length && hits[j] === hits[i]) j++; if ((j - i) & 1) return hits[i]; i = j; }
    return -1;
  }
  function snapToLand(x, y) { // 바다에 찍힌 학교는 가장 가까운 해안 안쪽으로
    if (landAt(x, y) >= 0) return [x, y];
    let best = null, bd = Infinity;
    const gx = Math.floor(x / B), gy = Math.floor(y / B);
    for (let rad = 0; rad < 20 && (!best || (rad - 1) * B < Math.sqrt(bd)); rad++) {
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const cx = gx + dx, cy = gy + dy;
        if (cx < 0 || cy < 0 || cx >= bw || cy >= bh) continue;
        for (const [ax, ay, bx, by] of egrid[cy * bw + cx]) {
          const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)), qx = ax + vx * t, qy = ay + vy * t, d = (qx - x) ** 2 + (qy - y) ** 2;
          if (d < bd) { bd = d; best = [qx, qy]; }
        }
      }
    }
    if (!best) return [x, y];
    for (const s of [3, 8, 20, 50]) for (let a = 0; a < 16; a++) {
      const nx = best[0] + Math.cos((a * Math.PI) / 8) * s, ny = best[1] + Math.sin((a * Math.PI) / 8) * s;
      if (landAt(nx, ny) >= 0) return [nx, ny];
    }
    return best;
  }

  // ---- 2) 씨앗 점: 학교 먼저(칸 번호 = 학교 번호), 그다음 무작위 빈 땅 ----
  const sx = [], sy = [];
  const SB = SPACING, sgw = Math.ceil(W / SB), sgh = Math.ceil(H / SB), sgrid = new Map();
  const sKey = (x, y) => Math.floor(y / SB) * sgw + Math.floor(x / SB);
  const addSeed = (x, y) => { const k = sx.length; sx.push(x); sy.push(y); const key = sKey(x, y); if (!sgrid.has(key)) sgrid.set(key, []); sgrid.get(key).push(k); return k; };
  const nearestSeedDist = (x, y) => {
    let bd = Infinity;
    const gx = Math.floor(x / SB), gy = Math.floor(y / SB);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const k of sgrid.get((gy + dy) * sgw + gx + dx) || []) bd = Math.min(bd, Math.hypot(sx[k] - x, sy[k] - y));
    return bd;
  };
  for (const s of schools) {
    let [x, y] = snapToLand(...toMap(s.lat, s.lon));
    for (let tries = 0; tries < 12 && nearestSeedDist(x, y) < MIN_GAP; tries++) {
      const a = rand() * Math.PI * 2, nx = x + Math.cos(a) * MIN_GAP, ny = y + Math.sin(a) * MIN_GAP;
      if (landAt(nx, ny) >= 0) { x = nx; y = ny; }
    }
    addSeed(x, y);
  }
  const schoolCount = sx.length;

  // 포아송 원판 표본 (브리드슨): 서로 SPACING 이상 떨어진 무작위 점
  const cs = SPACING / Math.SQRT2, gw = Math.ceil(W / cs), gh = Math.ceil(H / cs), pg = new Int32Array(gw * gh).fill(-1);
  const px = [], py = [], active = [];
  const addP = (x, y) => { const k = px.length; px.push(x); py.push(y); pg[Math.floor(y / cs) * gw + Math.floor(x / cs)] = k; active.push(k); };
  const farEnough = (x, y) => {
    const gx = Math.floor(x / cs), gy = Math.floor(y / cs);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const cx = gx + dx, cy = gy + dy;
      if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
      const k = pg[cy * gw + cx];
      if (k >= 0 && (px[k] - x) ** 2 + (py[k] - y) ** 2 < SPACING * SPACING) return false;
    }
    return true;
  };
  addP(W / 2, H / 2);
  while (active.length) {
    const ai = Math.floor(rand() * active.length), k = active[ai];
    let placed = false;
    for (let t = 0; t < 24 && !placed; t++) {
      const a = rand() * Math.PI * 2, d = SPACING * (1 + rand()), x = px[k] + Math.cos(a) * d, y = py[k] + Math.sin(a) * d;
      if (x >= 0 && y >= 0 && x < W && y < H && farEnough(x, y)) { addP(x, y); placed = true; }
    }
    if (!placed) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  for (let k = 0; k < px.length; k++) {
    if (landAt(px[k], py[k]) < 0) continue;
    let near = false;
    const gx = Math.floor(px[k] / SB), gy = Math.floor(py[k] / SB);
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1 && !near; dx++) for (const s of sgrid.get((gy + dy) * sgw + gx + dx) || []) if (s < schoolCount && Math.hypot(sx[s] - px[k], sy[s] - py[k]) < SPACING * 0.7) { near = true; break; }
    if (!near) addSeed(px[k], py[k]);
  }
  // 씨앗이 하나도 없는 섬에도 칸을 하나씩
  const massOfSeed = sx.map((x, i) => landAt(x, sy[i]));
  const hasSeed = new Set(massOfSeed);
  polys.forEach((p, pi) => {
    if (hasSeed.has(pi)) return;
    const bb = pbox[pi];
    let x = (bb[0] + bb[2]) / 2, y = (bb[1] + bb[3]) / 2;
    for (let t = 0; t < 400 && landAt(x, y) !== pi; t++) { x = bb[0] + rand() * (bb[2] - bb[0]); y = bb[1] + rand() * (bb[3] - bb[1]); }
    if (landAt(x, y) === pi) { addSeed(x, y); massOfSeed.push(pi); }
  });
  const n = sx.length;

  // ---- 3) 보로노이 다각형 (반평면 자르기) ----
  const LIM = SPACING * 5;
  const vor = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = sx[i], y = sy[i];
    let P = [[x - LIM, y - LIM, -1], [x + LIM, y - LIM, -1], [x + LIM, y + LIM, -1], [x - LIM, y + LIM, -1]];
    let maxR2 = 2 * LIM * LIM;
    const gx = Math.floor(x / SB), gy = Math.floor(y / SB);
    for (let ring = 0; ring <= LIM / SB * 2 + 2; ring++) {
      const minD = (ring - 1) * SB;
      if (ring > 1 && minD * minD > 4 * maxR2) break;
      for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        for (const j of sgrid.get((gy + dy) * sgw + gx + dx) || []) {
          if (j === i) continue;
          const nx = sx[j] - x, ny = sy[j] - y, d2 = nx * nx + ny * ny;
          if (d2 / 4 >= maxR2) continue;
          P = clipHalf(P, nx, ny, nx * (x + sx[j]) / 2 + ny * (y + sy[j]) / 2, j);
          maxR2 = 0;
          for (const v of P) maxR2 = Math.max(maxR2, (v[0] - x) ** 2 + (v[1] - y) ** 2);
        }
      }
    }
    vor[i] = P;
  }

  // ---- 4) 칸을 해안선으로 잘라 실제 땅 모양으로 ----
  const cells = new Array(n), sides = new Array(n).fill(0);
  let coastal = 0, fallback = 0;
  for (let i = 0; i < n; i++) {
    const P = vor[i];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    let touches = false;
    for (let gy = Math.max(0, Math.floor(y0 / B)); gy <= Math.min(bh - 1, Math.floor(y1 / B)) && !touches; gy++) {
      for (let gx = Math.max(0, Math.floor(x0 / B)); gx <= Math.min(bw - 1, Math.floor(x1 / B)) && !touches; gx++) {
        for (const [ax, ay, bx, by] of egrid[gy * bw + gx]) if (Math.max(ax, bx) >= x0 && Math.min(ax, bx) <= x1 && Math.max(ay, by) >= y0 && Math.min(ay, by) <= y1) { touches = true; break; }
      }
    }
    if (!touches) {
      cells[i] = [P.map(v => [v[0], v[1]])];
      sides[i] = P.filter((v, k) => { const w = P[(k + 1) % P.length]; return Math.hypot(w[0] - v[0], w[1] - v[1]) > 3; }).length;
      continue;
    }
    coastal++;
    const rings = [];
    polys.forEach((poly, pi) => {
      const bb = pbox[pi];
      if (bb[0] > x1 || bb[2] < x0 || bb[1] > y1 || bb[3] < y0) return;
      const r = clipByConvex(poly, P);
      if (r.length >= 3 && Math.abs(area(r)) > 150) rings.push(r);
    });
    if (!rings.length) fallback++;
    cells[i] = rings.length ? rings : [P.map(v => [v[0], v[1]])];
  }

  // ---- 5) 꼭짓점을 정수로 맞추기: 이웃 칸이 똑같은 꼭짓점을 쓰도록 거의 같은 점은 하나로 ----
  const snap = new Map();
  const canon = (x, y) => {
    const bx = Math.floor(x), by = Math.floor(y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = snap.get((bx + dx) * 131072 + by + dy);
      if (l) for (const v of l) if ((v[0] - x) ** 2 + (v[1] - y) ** 2 < 0.5) return [v[2], v[3]];
    }
    const v = [x, y, Math.round(x), Math.round(y)], k = bx * 131072 + by;
    if (!snap.has(k)) snap.set(k, []);
    snap.get(k).push(v);
    return [v[2], v[3]];
  };
  const encoded = cells.map(rings => rings.map(r => encodeRing(r.map(([x, y]) => canon(x, y)))).filter(r => r.length >= 6));
  // 브라우저와 똑같이 정수 좌표로 이웃을 구한다
  const nb = neighborsFromRings(encoded.map(rings => rings.map(decodeRing)));

  // ---- 6) 모든 땅이 이어지도록 섬에 뱃길을 놓는다 ----
  const routes = [];
  const parent = Array.from({ length: n }, (_, i) => i), find = a => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (let i = 0; i < n; i++) for (const j of nb[i]) parent[find(i)] = find(j);
  for (;;) {
    const comps = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(i); }
    if (comps.size <= 1) break;
    const small = [...comps.values()].sort((a, b) => a.length - b.length)[0], root = find(small[0]);
    let best = null, bd = Infinity;
    for (const a of small) for (let b = 0; b < n; b++) {
      if (find(b) === root) continue;
      const d = (sx[a] - sx[b]) ** 2 + (sy[a] - sy[b]) ** 2;
      if (d < bd) { bd = d; best = [a, b]; }
    }
    routes.push(best);
    nb[best[0]].push(best[1]); nb[best[1]].push(best[0]);
    parent[root] = find(best[1]);
  }

  // ---- 7) 시군구 중심 (학교 위치 평균) ----
  const dmap = new Map();
  schools.forEach((s, i) => {
    const key = s.sido + '|' + s.sigungu;
    if (!dmap.has(key)) dmap.set(key, { sido: s.sido, sigungu: s.sigungu, x: 0, y: 0, n: 0, lat: 0, lon: 0 });
    const d = dmap.get(key); d.x += sx[i]; d.y += sy[i]; d.lat += s.lat; d.lon += s.lon; d.n++;
  });
  const districts = [...dmap.values()].map(d => ({ sido: d.sido, sigungu: d.sigungu, x: d.x / d.n, y: d.y / d.n, lat: d.lat / d.n, lon: d.lon / d.n }));

  const map = {
    hash, W, H, n, ox, oy, schoolCount, seedX: sx, seedY: sy, nb, routes, sides, mass: massOfSeed, districts,
    schools: schools.map((s, i) => ({ name: s.name, sido: s.sido, sigungu: s.sigungu, dong: s.dong, url: s.url, cell: i })),
    toMap, landAt,
  };
  map.clientJSON = JSON.stringify({
    hash, W, H, n, spacing: SPACING, schoolCount,
    cells: encoded, sides, routes,
    seeds: sx.slice(0, schoolCount).flatMap((x, i) => [Math.round(x), Math.round(sy[i])]), // 학교 칸만 (나머지는 칸 가운데)
    land: polys.map(encodeRing),
    schools: schools.map(s => [s.name, s.sido, s.sigungu, s.url || '', s.dong || '']),
    districts: districts.map(d => [d.sido, d.sigungu, Math.round(d.x), Math.round(d.y)]),
  });
  map.stats = { cells: n, schools: schoolCount, coastal, fallback, routes: routes.length, ms: Date.now() - t0 };
  if (cacheFile) {
    try {
      fs.mkdirSync(cacheDir, { recursive: true });
      const { toMap, landAt, ...plain } = map;
      fs.writeFileSync(cacheFile, JSON.stringify(plain));
    } catch (e) { console.warn('지도 저장 실패:', e.message); }
  }
  return map;
}

module.exports = { buildMap, parseSchools };
