// 충돌 월드: AABB 박스(벽/바닥/계단) + 지형 높이. 캐릭터는 원기둥(반지름, 키)으로 처리
import { terrainH } from './korea.js';

const CELL = 8;
const key = (ix, iz) => (ix + 200000) * 400000 + (iz + 200000);

export class CollisionWorld {
  constructor() { this.grid = new Map(); this.owners = new Map(); this.q = 0; }
  add(b, owner = 'misc') {
    b.on = b.on !== false; b._q = 0;
    const x0 = Math.floor(b.x0 / CELL), x1 = Math.floor(b.x1 / CELL), z0 = Math.floor(b.z0 / CELL), z1 = Math.floor(b.z1 / CELL);
    b._cells = [];
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = key(i, j); let c = this.grid.get(k); if (!c) this.grid.set(k, c = []); c.push(b); b._cells.push(k); }
    let o = this.owners.get(owner); if (!o) this.owners.set(owner, o = []); o.push(b); return b;
  }
  box(x0, y0, z0, x1, y1, z1, owner, extra) { return this.add(Object.assign({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1) }, extra), owner); }
  removeOwner(owner) {
    const o = this.owners.get(owner); if (!o) return;
    for (const b of o) for (const k of b._cells) { const c = this.grid.get(k); if (!c) continue; const i = c.indexOf(b); if (i >= 0) c.splice(i, 1); if (!c.length) this.grid.delete(k); }
    this.owners.delete(owner);
  }
  query(x0, z0, x1, z1, out = []) {
    this.q++; out.length = 0;
    const a = Math.floor(x0 / CELL), b = Math.floor(x1 / CELL), c = Math.floor(z0 / CELL), d = Math.floor(z1 / CELL);
    for (let i = a; i <= b; i++) for (let j = c; j <= d; j++) {
      const cell = this.grid.get(key(i, j)); if (!cell) continue;
      for (const bx of cell) if (bx.on && bx._q !== this.q) { bx._q = this.q; out.push(bx); }
    }
    return out;
  }
  // (x,z) 에서 y+step 이하 가장 높은 바닥
  groundAt(x, z, y, step = 0.5, r = 0.15, list) {
    let g = terrainH(x, z);
    const bs = list || this.query(x - r, z - r, x + r, z + r, _tmp);
    for (const b of bs) {
      if (b.y1 > y + step || b.y1 <= g || b.nowalk) continue;
      if (x + r < b.x0 || x - r > b.x1 || z + r < b.z0 || z - r > b.z1) continue;
      g = b.y1;
    }
    return g;
  }
  // 캐릭터 이동: c = {pos, vel, r, h, step, onGround}
  move(c, dt, gravity = 22) {
    const p = c.pos, r = c.r;
    const steps = Math.max(1, Math.ceil(Math.hypot(c.vel.x, c.vel.z) * dt / (r * 0.6)));
    const sdt = dt / steps;
    const list = this.query(p.x - r - 2, p.z - r - 2, p.x + r + 2, p.z + r + 2, _tmp2);
    c.blocked = false;
    for (let s = 0; s < steps; s++) {
      p.x += c.vel.x * sdt; p.z += c.vel.z * sdt;
      for (let it = 0; it < 2; it++) for (const b of list) {
        if (b.y1 <= p.y + c.step || b.y0 >= p.y + c.h || b.ghost) continue;
        const cx = p.x < b.x0 ? b.x0 : p.x > b.x1 ? b.x1 : p.x, cz = p.z < b.z0 ? b.z0 : p.z > b.z1 ? b.z1 : p.z;
        let dx = p.x - cx, dz = p.z - cz; const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        c.blocked = true; c.hitBox = b;
        if (d2 > 1e-10) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
        else { // 중심이 박스 안
          const l = p.x - b.x0, rr = b.x1 - p.x, f = p.z - b.z0, bk = b.z1 - p.z, m = Math.min(l, rr, f, bk);
          if (m === l) p.x = b.x0 - r; else if (m === rr) p.x = b.x1 + r; else if (m === f) p.z = b.z0 - r; else p.z = b.z1 + r;
        }
      }
    }
    // 수직
    const g = this.groundAt(p.x, p.z, p.y, c.step, r * 0.55, list);
    c.vel.y -= gravity * dt;
    let ny = p.y + c.vel.y * dt;
    // 천장
    if (c.vel.y > 0) for (const b of list) { if (b.y0 > p.y + c.h - 0.05 && b.y0 < ny + c.h && p.x + r * .5 > b.x0 && p.x - r * .5 < b.x1 && p.z + r * .5 > b.z0 && p.z - r * .5 < b.z1) { c.vel.y = 0; ny = p.y; } }
    if (ny <= g) { ny = g; c.vel.y = 0; c.onGround = true; }
    else if (c.onGround && c.vel.y <= 0 && p.y - g < c.step + 0.05) { ny = g; c.vel.y = 0; }
    else c.onGround = false;
    p.y = ny;
    return c;
  }
  // 광선 vs 박스(슬랩) — 반환 거리 또는 Infinity
  ray(ox, oy, oz, dx, dy, dz, maxD = 200, filter) {
    let best = maxD;
    const steps = Math.ceil(maxD / 6);
    // 지형: 간단한 마칭
    let prevY = oy, hitT = Infinity;
    for (let i = 1; i <= steps * 2; i++) {
      const t = i * maxD / (steps * 2), x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      if (y < terrainH(x, z)) { hitT = t; break; }
      prevY = y;
    }
    if (hitT < best) best = hitT;
    // 박스: 광선 경로를 따라 셀 탐색
    const ex = ox + dx * best, ez = oz + dz * best;
    const n = Math.max(1, Math.ceil(best / CELL));
    const seen = new Set();
    for (let i = 0; i <= n; i++) {
      const t0 = (i / n) * best, x = ox + dx * t0, z = oz + dz * t0;
      const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const cell = this.grid.get(key(ix + a, iz + b)); if (!cell) continue;
        for (const bx of cell) {
          if (!bx.on || seen.has(bx) || (filter && !filter(bx))) continue; seen.add(bx);
          const t = slab(ox, oy, oz, dx, dy, dz, bx); if (t >= 0 && t < best) best = t;
        }
      }
    }
    return best < maxD ? best : Infinity;
  }
}
const _tmp = [], _tmp2 = [];
export function slab(ox, oy, oz, dx, dy, dz, b) {
  let tmin = -Infinity, tmax = Infinity;
  for (const [o, d, mn, mx] of [[ox, dx, b.x0, b.x1], [oy, dy, b.y0, b.y1], [oz, dz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) return -1; continue; }
    let t1 = (mn - o) / d, t2 = (mx - o) / d; if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1; return tmin < 0 ? 0 : tmin;
}
