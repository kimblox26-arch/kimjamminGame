// 대피 경로 격자: 다중 출발점 다익스트라로 고지대 / 지정 대피건물까지의 거리장과 방향장 생성
import { WORLD, HALF, SAFE_ELEV } from './config.js';
import { STYLE } from './city.js';

const S = 10;
const BLD_PENALTY = 70;   // 고지대를 약간 더 선호

class Heap {
  constructor(cap) { this.k = new Float32Array(cap); this.v = new Int32Array(cap); this.n = 0; }
  push(key, val) {
    if (this.n >= this.k.length) {
      const k2 = new Float32Array(this.k.length * 2), v2 = new Int32Array(this.k.length * 2);
      k2.set(this.k); v2.set(this.v); this.k = k2; this.v = v2;
    }
    let i = this.n++;
    const k = this.k, v = this.v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topV = v[0]; this.topK = k[0];
    const key = k[--this.n], val = v[this.n];
    let i = 0;
    for (;;) {
      let c = i * 2 + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && k[c + 1] < k[c]) c++;
      if (k[c] >= key) break;
      k[i] = k[c]; v[i] = v[c]; i = c;
    }
    k[i] = key; v[i] = val;
    return topV;
  }
}

export class NavGrid {
  constructor(terrain, city) {
    this.S = S;
    const M = this.M = Math.round(WORLD / S);
    this.terrain = terrain;
    this.city = city;
    const C = M * M;
    this.walk = new Uint8Array(C);
    this.ground = new Float32Array(C);
    this.cost = new Float32Array(C);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const x = -HALF + (i + 0.5) * S, z = -HALF + (j + 0.5) * S;
      const k = j * M + i;
      const g = terrain.groundAt(x, z);
      this.ground[k] = g;
      const sl = terrain.slopeAt(x, z);
      let ok = g > 0.35 && sl < 0.9;
      if (ok && city.buildingAt(x, z, 0.5)) ok = false;
      this.walk[k] = ok ? 1 : 0;
      this.cost[k] = 1 + sl * 3.5;
    }
    this.safe = new Uint8Array(C);
    for (let k = 0; k < C; k++) if (this.walk[k] && this.ground[k] >= SAFE_ELEV) this.safe[k] = 1;
    // 대피건물 입구 셀
    const bldSrc = [];
    for (const b of city.buildings) {
      if (!b.evac || b.style === STYLE.shelter) continue;
      const i0 = Math.floor((b.x - b.w / 2 - 8 + HALF) / S), i1 = Math.floor((b.x + b.w / 2 + 8 + HALF) / S);
      const j0 = Math.floor((b.z - b.d / 2 - 8 + HALF) / S), j1 = Math.floor((b.z + b.d / 2 + 8 + HALF) / S);
      for (let j = Math.max(0, j0); j <= Math.min(M - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(M - 1, i1); i++) {
        const k = j * M + i;
        if (this.walk[k] && !this.safe[k]) bldSrc.push([k, b.id]);
      }
    }
    this.hill = this.solve([], false);
    this.all = this.solve(bldSrc, true);
  }

  solve(bldSrc, withBld) {
    const M = this.M, C = M * M;
    const dist = new Float32Array(C).fill(Infinity);
    const src = new Int32Array(C).fill(-1);
    const heap = new Heap(1 << 16);
    for (let k = 0; k < C; k++) if (this.safe[k]) { dist[k] = 0; heap.push(0, k); }
    if (withBld) for (const [k, id] of bldSrc) {
      if (BLD_PENALTY < dist[k]) { dist[k] = BLD_PENALTY; src[k] = id; heap.push(BLD_PENALTY, k); }
    }
    const walk = this.walk, cost = this.cost;
    const nb = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
    while (heap.n) {
      const k = heap.pop();
      const d0 = heap.topK;
      if (d0 > dist[k]) continue;
      const i = k % M, j = (k - i) / M;
      for (const [di, dj, l] of nb) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= M || jj >= M) continue;
        const n = jj * M + ii;
        if (!walk[n]) continue;
        if (di && dj && (!walk[j * M + ii] || !walk[jj * M + i])) continue;
        const nd = d0 + l * S * 0.5 * (cost[k] + cost[n]);
        if (nd < dist[n]) { dist[n] = nd; src[n] = src[k]; heap.push(nd, n); }
      }
    }
    // 방향장
    const dx = new Float32Array(C), dz = new Float32Array(C);
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
      const k = j * M + i;
      if (!walk[k] || !isFinite(dist[k]) || dist[k] === 0) continue;
      let best = dist[k], bx = 0, bz = 0;
      for (const [di, dj] of nb) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= M || jj >= M) continue;
        const n = jj * M + ii;
        if (!walk[n]) continue;
        if (di && dj && (!walk[j * M + ii] || !walk[jj * M + i])) continue;
        if (dist[n] < best) { best = dist[n]; bx = di; bz = dj; }
      }
      const l = Math.hypot(bx, bz) || 1;
      dx[k] = bx / l; dz[k] = bz / l;
    }
    return { dist, src, dx, dz };
  }

  cellOf(x, z) {
    const M = this.M;
    let i = Math.floor((x + HALF) / S), j = Math.floor((z + HALF) / S);
    if (i < 0) i = 0; else if (i >= M) i = M - 1;
    if (j < 0) j = 0; else if (j >= M) j = M - 1;
    return j * M + i;
  }

  /** 부드러운 대피 방향 (쌍선형 보간된 방향장) */
  direction(field, x, z, out) {
    const M = this.M;
    let gx = (x + HALF) / S - 0.5, gz = (z + HALF) / S - 0.5;
    const i0 = Math.floor(gx), j0 = Math.floor(gz), tx = gx - i0, tz = gz - j0;
    let sx = 0, sz = 0, sw = 0;
    for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
      const i = i0 + a, j = j0 + b;
      if (i < 0 || j < 0 || i >= M || j >= M) continue;
      const k = j * M + i;
      if (!this.walk[k] || !isFinite(field.dist[k])) continue;
      const w = (a ? tx : 1 - tx) * (b ? tz : 1 - tz) + 1e-4;
      sx += field.dx[k] * w; sz += field.dz[k] * w; sw += w;
    }
    const k = this.cellOf(x, z);
    if (sw === 0 || !this.walk[k]) {
      // 보행 불가 셀: 인접 보행 셀 중 가장 가까운 쪽으로
      const i = k % M, j = (k - i) / M;
      let best = Infinity;
      out.x = 0; out.z = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= M || jj >= M) continue;
        const n = jj * M + ii;
        if (!this.walk[n]) continue;
        const d = field.dist[n] + Math.hypot(di, dj) * S;
        if (d < best) { best = d; out.x = di; out.z = dj; }
      }
      const l = Math.hypot(out.x, out.z) || 1;
      out.x /= l; out.z /= l;
      return out;
    }
    const l = Math.hypot(sx, sz);
    out.x = l > 1e-4 ? sx / l : 0; out.z = l > 1e-4 ? sz / l : 0;
    return out;
  }

  isWalkable(x, z) { return this.walk[this.cellOf(x, z)] === 1; }
  isSafe(x, z) { return this.terrain.groundAt(x, z) >= SAFE_ELEV; }
}
