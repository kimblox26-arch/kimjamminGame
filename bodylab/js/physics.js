// 베를레(Verlet) 입자 물리: 사람(래그돌)·튀어나온 장기·창자 줄을 같은 방식으로 계산한다.
//  · 입자 = 위치 p + 이전 위치 o (속도 = p - o), 반지름 r, 질량 m
//  · 거리 제약(뼈 길이), 범위 제약(관절 가동 범위), 박스 충돌(벽·바닥·장치), 물 부력
import * as THREE from 'three';

const V = THREE.Vector3;
export const GRAVITY = 9.81;
const _v = new V(), _n = new V(), _d = new V();

export class Particle {
  constructor(pos, r, m) {
    this.p = pos.clone(); this.o = pos.clone(); this.acc = new V();
    this.r = r; this.m = m; this.w = m > 0 ? 1 / m : 0;
    this.buoy = 1; this.fric = 1; this.submerged = 0; this.touch = 0; this.owner = null; this.idx = -1;
  }
  setPos(v) { this.p.copy(v); this.o.copy(v); }
  // 속도(m/s) 추가: 이전 위치를 반대로 옮긴다
  push(dv, h) { this.o.addScaledVector(dv, -h); }
  velocity(out, h) { return out.subVectors(this.p, this.o).divideScalar(h); }
}

export class Constraint {
  constructor(a, b, min, max, k = 1) { this.a = a; this.b = b; this.min = min; this.max = max; this.k = k; this.on = true; }
  solve() {
    const a = this.a, b = this.b;
    _d.subVectors(b.p, a.p);
    const L = _d.length();
    if (L < 1e-9) return;
    const t = L < this.min ? this.min : (L > this.max ? this.max : L);
    if (t === L) return;
    const ws = a.w + b.w;
    if (ws === 0) return;
    const s = this.k * (L - t) / (L * ws);
    a.p.addScaledVector(_d, s * a.w);
    b.p.addScaledVector(_d, -s * b.w);
  }
}
export const dist = (a, b, k = 1) => { const L = a.p.distanceTo(b.p); return new Constraint(a, b, L, L, k); };
export const range = (a, b, lo, hi, k = 1) => { const L = a.p.distanceTo(b.p); return new Constraint(a, b, L * lo, L * hi, k); };

// 박스(AABB) 충돌: 박스 밖으로 밀어내고 마찰·반발을 준다. 충돌 속도(m/s)를 돌려준다
export function collideBox(pt, b, h, out) {
  const p = pt.p, r = pt.r;
  const cx = Math.max(b.min.x, Math.min(p.x, b.max.x));
  const cy = Math.max(b.min.y, Math.min(p.y, b.max.y));
  const cz = Math.max(b.min.z, Math.min(p.z, b.max.z));
  let dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > r * r) return -1;
  let depth;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    _n.set(dx / d, dy / d, dz / d); depth = r - d;
  } else { // 입자 중심이 박스 안: 가장 가까운 면으로
    const f = [p.x - b.min.x, b.max.x - p.x, p.y - b.min.y, b.max.y - p.y, p.z - b.min.z, b.max.z - p.z];
    let k = 0; for (let i = 1; i < 6; i++) if (f[i] < f[k]) k = i;
    _n.set(0, 0, 0); _n.setComponent(k >> 1, k & 1 ? 1 : -1); depth = f[k] + r;
  }
  _v.subVectors(p, pt.o);
  p.addScaledVector(_n, depth);
  // 상대 속도 (움직이는 박스: 프레스 판, 자동차)
  const bvx = b.vel ? b.vel.x * h : 0, bvy = b.vel ? b.vel.y * h : 0, bvz = b.vel ? b.vel.z * h : 0;
  const rx = _v.x - bvx, ry = _v.y - bvy, rz = _v.z - bvz;
  const vn = rx * _n.x + ry * _n.y + rz * _n.z;
  let impact = 0;
  if (vn < 0) {
    impact = -vn / h;
    // 쿨롱 마찰: 누르는 힘만큼만 미끄러짐을 줄인다
    const tx = rx - _n.x * vn, ty = ry - _n.y * vn, tz = rz - _n.z * vn, vt = Math.hypot(tx, ty, tz);
    const mu = 0.9 * (b.fric ?? 1) * pt.fric;
    const keep = vt > 1e-9 ? Math.max(0, 1 - mu * (-vn) / vt) : 0;
    _v.set(tx * keep + bvx - _n.x * vn * 0.15, ty * keep + bvy - _n.y * vn * 0.15, tz * keep + bvz - _n.z * vn * 0.15);
    pt.o.subVectors(p, _v);
  }
  pt.touch = 1;
  if (out) out.copy(_n);
  return impact;
}

// 회전한 박스(y축 회전만): 입자를 박스 좌표로 옮겨 AABB 충돌을 쓰고 되돌린다
const _proxy = { p: new V(), o: new V(), r: 0, fric: 1, touch: 0 }, _lb = { min: new V(), max: new V(), vel: new V(), fric: 1 };
export function collideOBB(pt, ob, h, out) {
  const c = ob.c, cs = Math.cos(ob.yaw), sn = Math.sin(ob.yaw);
  const tl = (src, dst) => { const dx = src.x - c.x, dz = src.z - c.z; dst.set(dx * cs - dz * sn, src.y - c.y, dx * sn + dz * cs); };
  tl(pt.p, _proxy.p); tl(pt.o, _proxy.o); _proxy.r = pt.r; _proxy.fric = pt.fric;
  _lb.min.copy(ob.half).negate(); _lb.max.copy(ob.half);
  _lb.vel.set(ob.vel.x * cs - ob.vel.z * sn, ob.vel.y, ob.vel.x * sn + ob.vel.z * cs);
  const imp = collideBox(_proxy, _lb, h, out);
  if (imp < 0) return -1;
  const tw = (src, dst) => { dst.set(c.x + src.x * cs + src.z * sn, src.y + c.y, c.z - src.x * sn + src.z * cs); };
  tw(_proxy.p, pt.p); tw(_proxy.o, pt.o); pt.touch = 1;
  if (out) out.set(out.x * cs + out.z * sn, out.y, -out.x * sn + out.z * cs);
  return imp;
}

export class Physics {
  constructor(world) {
    this.world = world; this.h = 1 / 240; this.acc = 0; this.iters = 6; this._near = [];
    this.groups = new Set(); // { particles, constraints, preSolve(h), postSolve(h), onImpact(pt, speed, n) }
    this.pairs = []; // 서로 부딪히는 입자 그룹 쌍 (사람끼리)
  }
  add(g) { this.groups.add(g); return g; }
  remove(g) { this.groups.delete(g); }
  step(simDt) {
    this.acc += simDt;
    let n = 0;
    while (this.acc >= this.h && n < 10) { this.substep(this.h); this.acc -= this.h; n++; }
    if (n === 10) this.acc = 0;
  }
  substep(h) {
    const W = this.world, water = W.water;
    for (const g of this.groups) {
      g.preSolve?.(h);
      for (const pt of g.particles) {
        if (pt.w === 0) continue;
        _v.subVectors(pt.p, pt.o).multiplyScalar(0.9995);
        let ay = -GRAVITY;
        pt.submerged = 0;
        if (water && pt.p.x > water.min.x && pt.p.x < water.max.x && pt.p.z > water.min.z && pt.p.z < water.max.z) {
          const s = Math.min(1, Math.max(0, (water.surface - pt.p.y + pt.r) / (2 * pt.r)));
          if (s > 0) { pt.submerged = s; ay += GRAVITY * pt.buoy * 1.0 * s; _v.multiplyScalar(1 - 2.6 * s * h); }
        }
        pt.o.copy(pt.p);
        pt.p.x += _v.x + pt.acc.x * h * h;
        pt.p.y += _v.y + (pt.acc.y + ay) * h * h;
        pt.p.z += _v.z + pt.acc.z * h * h;
        pt.acc.set(0, 0, 0);
        pt.touch = 0;
      }
    }
    // 넓은 판정: 그룹 근처의 박스만 추린다 (나무·건물이 많아도 빠르게)
    for (const g of this.groups) {
      const P = g.particles; if (!P.length) { g._near = []; continue; }
      let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
      for (const q of P) { x0 = Math.min(x0, q.p.x); y0 = Math.min(y0, q.p.y); z0 = Math.min(z0, q.p.z); x1 = Math.max(x1, q.p.x); y1 = Math.max(y1, q.p.y); z1 = Math.max(z1, q.p.z); }
      const m = 0.6, near = g._near || (g._near = []); near.length = 0;
      for (const b of W.boxes) if (b.max.x > x0 - m && b.min.x < x1 + m && b.max.y > y0 - m && b.min.y < y1 + m && b.max.z > z0 - m && b.min.z < z1 + m) near.push(b);
      g._obb = W.obbs?.filter(o => Math.abs(o.c.x - (x0 + x1) / 2) < 6 + (x1 - x0) && Math.abs(o.c.z - (z0 + z1) / 2) < 6 + (z1 - z0)) || [];
    }
    for (let it = 0; it < this.iters; it++) {
      for (const g of this.groups) for (const c of g.constraints) if (c.on) c.solve();
      for (const g of this.groups) g.innerSolve?.(it);
      if (it % 2 === 0) for (const [A, B] of this.pairs) collideGroups(A, B);
      for (const g of this.groups) {
        for (const pt of g.particles) {
          if (pt.w === 0) continue;
          for (const b of g._near) {
            if (pt.p.x + pt.r < b.min.x || pt.p.x - pt.r > b.max.x || pt.p.y + pt.r < b.min.y || pt.p.y - pt.r > b.max.y || pt.p.z + pt.r < b.min.z || pt.p.z - pt.r > b.max.z) continue;
            const imp = collideBox(pt, b, h, _n);
            if (imp > 0 && it === 0) g.onImpact?.(pt, imp, _n, b);
          }
          for (const ob of g._obb) {
            const imp = collideOBB(pt, ob, h, _n);
            if (imp > 0 && it === 0) g.onImpact?.(pt, imp, _n, ob);
          }
        }
      }
    }
    for (const g of this.groups) g.postSolve?.(h);
  }
}

function collideGroups(A, B) {
  for (const a of A.particles) for (const b of B.particles) {
    if (a.w + b.w === 0) continue;
    _d.subVectors(b.p, a.p);
    const r = a.r + b.r, d2 = _d.lengthSq();
    if (d2 >= r * r || d2 < 1e-10) continue;
    const d = Math.sqrt(d2), s = (r - d) / (d * (a.w + b.w));
    a.p.addScaledVector(_d, -s * a.w);
    b.p.addScaledVector(_d, s * b.w);
  }
}

// 광선-캡슐 교차 (Inigo Quilez). 진입 거리 또는 -1
export function rayCapsule(ro, rd, pa, pb, ra) {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z;
  const oax = ro.x - pa.x, oay = ro.y - pa.y, oaz = ro.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * rd.x + bay * rd.y + baz * rd.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = rd.x * oax + rd.y * oay + rd.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - ra * ra * baba;
  let h = b * b - a * c;
  if (a > 1e-9 && h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
  } else if (a <= 1e-9 && h < 0) { /* 평행 */ }
  // 양 끝 구
  let best = -1;
  for (const q of [pa, pb]) {
    const ocx = ro.x - q.x, ocy = ro.y - q.y, ocz = ro.z - q.z;
    const bb = rd.x * ocx + rd.y * ocy + rd.z * ocz;
    const cc = ocx * ocx + ocy * ocy + ocz * ocz - ra * ra;
    const hh = bb * bb - cc;
    if (hh > 0) { const t = -bb - Math.sqrt(hh); if (best < 0 || t < best) best = t; }
  }
  return best;
}
// 진입·탈출 거리 [tIn, tOut] 또는 null
const _ro = new V(), _rd = new V();
export function rayCapsuleSpan(ro, rd, pa, pb, ra) {
  const tIn = rayCapsule(ro, rd, pa, pb, ra);
  if (tIn < 0) return null;
  const T = tIn + 3;
  _ro.copy(ro).addScaledVector(rd, T); _rd.copy(rd).negate();
  const t2 = rayCapsule(_ro, _rd, pa, pb, ra);
  if (t2 < 0) return null;
  return [tIn, T - t2];
}
// 광선-AABB: 진입 거리 또는 -1 (법선은 out 에)
export function rayBox(ro, rd, b, out) {
  let tmin = -Infinity, tmax = Infinity, axis = 0, sign = 1;
  for (let i = 0; i < 3; i++) {
    const o = ro.getComponent(i), d = rd.getComponent(i), lo = b.min.getComponent(i), hi = b.max.getComponent(i);
    if (Math.abs(d) < 1e-12) { if (o < lo || o > hi) return -1; continue; }
    let t1 = (lo - o) / d, t2 = (hi - o) / d, s = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (tmax < 0) return -1;
  if (out) { out.set(0, 0, 0); out.setComponent(axis, sign); }
  return Math.max(tmin, 0);
}
