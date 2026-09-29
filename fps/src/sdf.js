// SDF 조각 → 표면망(Surface Nets) 메쉬 생성기
// 원시 도형(타원체/원뿔캡슐/둥근상자/토러스)을 부드러운 합/차로 조합해 유기적인 형태를 만들고,
// 각 도형의 뼈/재질 태그로 스킨 가중치와 재질 영역을 계산한다.
import * as THREE from 'three';

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const smin = (a, b, k) => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

// 로컬 변환 (중심 + 회전)
function frame(c, rot) {
  if (!rot) return null;
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], rot[3] || 'XYZ')).invert();
  return m.elements;
}
function toLocal(x, y, z, c, e) {
  const dx = x - c[0], dy = y - c[1], dz = z - c[2];
  if (!e) return [dx, dy, dz];
  return [e[0] * dx + e[4] * dy + e[8] * dz, e[1] * dx + e[5] * dy + e[9] * dz, e[2] * dx + e[6] * dy + e[10] * dz];
}

// ── 원시 도형 ──
export function ellipsoid(c, r, o = {}) {
  const e = frame(c, o.rot);
  const fn = (x, y, z) => {
    const [px, py, pz] = toLocal(x, y, z, c, e);
    const k0 = len3(px / r[0], py / r[1], pz / r[2]), k1 = len3(px / (r[0] * r[0]), py / (r[1] * r[1]), pz / (r[2] * r[2]));
    return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(r[0], r[1], r[2]);
  };
  const m = Math.max(r[0], r[1], r[2]);
  return { fn, aabb: [c[0] - m, c[1] - m, c[2] - m, c[0] + m, c[1] + m, c[2] + m], ...o };
}
export function sphere(c, r, o = {}) {
  return { fn: (x, y, z) => len3(x - c[0], y - c[1], z - c[2]) - r, aabb: [c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r], ...o };
}
// 두 반지름 캡슐 (둥근 원뿔). o.along(t) 로 주름 등 변위 가능
export function cone(a, b, r1, r2, o = {}) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2], L2 = bax * bax + bay * bay + baz * baz, L = Math.sqrt(L2);
  const fn = (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    let t = (pax * bax + pay * bay + paz * baz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = pax - bax * t, qy = pay - bay * t, qz = paz - baz * t;
    let d = len3(qx, qy, qz) - (r1 + (r2 - r1) * t);
    if (o.disp) d += o.disp(t, qx, qy, qz, x, y, z);
    return d;
  };
  const m = Math.max(r1, r2) + (o.dispMax || 0);
  return { fn, aabb: [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m], seg: [a, b], ...o };
}
export function rbox(c, hs, round, o = {}) {
  const e = frame(c, o.rot);
  const fn = (x, y, z) => {
    const [px, py, pz] = toLocal(x, y, z, c, e);
    const qx = Math.abs(px) - hs[0] + round, qy = Math.abs(py) - hs[1] + round, qz = Math.abs(pz) - hs[2] + round;
    return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - round;
  };
  const m = len3(hs[0], hs[1], hs[2]);
  return { fn, aabb: [c[0] - m, c[1] - m, c[2] - m, c[0] + m, c[1] + m, c[2] + m], ...o };
}
export function torus(c, R, r, o = {}) {
  const e = frame(c, o.rot);
  const fn = (x, y, z) => { const [px, py, pz] = toLocal(x, y, z, c, e); const q = Math.hypot(px, pz) - R; return Math.hypot(q, py) - r; };
  const m = R + r;
  return { fn, aabb: [c[0] - m, c[1] - m, c[2] - m, c[0] + m, c[1] + m, c[2] + m], ...o };
}
// 평면 절단 (n·p - d > 0 영역 제거)
export function plane(n, d, o = {}) {
  return { fn: (x, y, z) => n[0] * x + n[1] * y + n[2] * z - d, aabb: null, ...o };
}

// ── 필드 + 메쉬 ──
export class SDFModel {
  constructor(min, max, h) {
    this.min = min; this.h = h;
    this.nx = Math.ceil((max[0] - min[0]) / h) + 1; this.ny = Math.ceil((max[1] - min[1]) / h) + 1; this.nz = Math.ceil((max[2] - min[2]) / h) + 1;
    this.f = new Float32Array(this.nx * this.ny * this.nz).fill(1);
    this.prims = [];
  }
  add(p) { p.op = p.op || 'add'; this.prims.push(p); return p; }
  sub(p) { p.op = 'sub'; this.prims.push(p); return p; }
  inter(p) { p.op = 'inter'; this.prims.push(p); return p; }

  bake() {
    const { nx, ny, nz, f, h, min } = this;
    for (const p of this.prims) {
      const k = p.k ?? 0.01;
      let x0 = 0, y0 = 0, z0 = 0, x1 = nx - 1, y1 = ny - 1, z1 = nz - 1;
      if (p.aabb && p.op !== 'inter') {
        const m = k + h * 2;
        x0 = Math.max(0, Math.floor((p.aabb[0] - m - min[0]) / h)); y0 = Math.max(0, Math.floor((p.aabb[1] - m - min[1]) / h)); z0 = Math.max(0, Math.floor((p.aabb[2] - m - min[2]) / h));
        x1 = Math.min(nx - 1, Math.ceil((p.aabb[3] + m - min[0]) / h)); y1 = Math.min(ny - 1, Math.ceil((p.aabb[4] + m - min[1]) / h)); z1 = Math.min(nz - 1, Math.ceil((p.aabb[5] + m - min[2]) / h));
      }
      const fn = p.fn, op = p.op;
      for (let z = z0; z <= z1; z++) {
        const pz = min[2] + z * h;
        for (let y = y0; y <= y1; y++) {
          const py = min[1] + y * h, row = nx * (y + ny * z);
          for (let x = x0; x <= x1; x++) {
            const i = row + x, d = fn(min[0] + x * h, py, pz);
            f[i] = op === 'add' ? smin(f[i], d, k) : op === 'sub' ? smax(f[i], -d, k) : smax(f[i], d, k);
          }
        }
      }
    }
    return this;
  }

  // Naive Surface Nets
  mesh() {
    const { nx, ny, nz, f, h, min } = this;
    const vidx = new Int32Array(nx * ny * nz).fill(-1);
    const pos = [], nor = [];
    const off = [0, 1, nx, nx + 1, nx * ny, nx * ny + 1, nx * ny + nx, nx * ny + nx + 1];
    const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const c = new Float32Array(8);
    for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      const i = x + nx * (y + ny * z);
      let mask = 0;
      for (let k = 0; k < 8; k++) { c[k] = f[i + off[k]]; if (c[k] < 0) mask |= 1 << k; }
      if (mask === 0 || mask === 255) continue;
      let vx = 0, vy = 0, vz = 0, n = 0;
      for (const [a, b] of EDGES) {
        if ((c[a] < 0) === (c[b] < 0)) continue;
        const t = c[a] / (c[a] - c[b]);
        const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1, bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1;
        vx += ax + (bx - ax) * t; vy += ay + (by - ay) * t; vz += az + (bz - az) * t; n++;
      }
      vx /= n; vy /= n; vz /= n;
      // 트라이리니어 기울기
      const gx = (c[1] - c[0]) * (1 - vy) * (1 - vz) + (c[3] - c[2]) * vy * (1 - vz) + (c[5] - c[4]) * (1 - vy) * vz + (c[7] - c[6]) * vy * vz;
      const gy = (c[2] - c[0]) * (1 - vx) * (1 - vz) + (c[3] - c[1]) * vx * (1 - vz) + (c[6] - c[4]) * (1 - vx) * vz + (c[7] - c[5]) * vx * vz;
      const gz = (c[4] - c[0]) * (1 - vx) * (1 - vy) + (c[5] - c[1]) * vx * (1 - vy) + (c[6] - c[2]) * (1 - vx) * vy + (c[7] - c[3]) * vx * vy;
      const gl = len3(gx, gy, gz) || 1;
      vidx[i] = pos.length / 3;
      pos.push(min[0] + (x + vx) * h, min[1] + (y + vy) * h, min[2] + (z + vz) * h);
      nor.push(gx / gl, gy / gl, gz / gl);
    }
    const idx = [];
    const quad = (a, b, cc, d, flip) => {
      if (a < 0 || b < 0 || cc < 0 || d < 0) return;
      if (flip) { idx.push(a, d, cc, a, cc, b); } else { idx.push(a, b, cc, a, cc, d); }
    };
    for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
      const i = x + nx * (y + ny * z);
      const inside = f[i] < 0;
      // x 방향 모서리 (i → i+1): 셀 (x, y-1..y, z-1..z)
      if (y > 0 && z > 0 && inside !== (f[i + 1] < 0)) quad(vidx[i - nx - nx * ny], vidx[i - nx * ny], vidx[i], vidx[i - nx], inside);
      if (x > 0 && z > 0 && inside !== (f[i + nx] < 0)) quad(vidx[i - 1 - nx * ny], vidx[i - 1], vidx[i], vidx[i - nx * ny], inside);
      if (x > 0 && y > 0 && inside !== (f[i + nx * ny] < 0)) quad(vidx[i - 1 - nx], vidx[i - nx], vidx[i], vidx[i - 1], inside);
    }
    // 와인딩을 기울기 법선에 맞춤
    const P = pos, N = nor;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, cc = idx[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const wx = P[cc] - P[a], wy = P[cc + 1] - P[a + 1], wz = P[cc + 2] - P[a + 2];
      const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
      if (fx * (N[a] + N[b] + N[cc]) + fy * (N[a + 1] + N[b + 1] + N[cc + 1]) + fz * (N[a + 2] + N[b + 2] + N[cc + 2]) < 0) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
    }
    return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) };
  }

  // 정점마다 가장 가까운 '더하기' 도형 찾기 → 재질/뼈 가중치
  classify(m, bones, sigma = 0.02) {
    const n = m.pos.length / 3, adds = this.prims.filter((p) => p.op === 'add');
    const mat = new Array(n), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const acc = new Float32Array(bones ? bones.length : 1);
    for (let v = 0; v < n; v++) {
      const x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2];
      let best = 1e9, bm = null;
      acc.fill(0);
      for (const p of adds) {
        const d = p.fn(x, y, z);
        if (d < best) { best = d; bm = p; }
        if (bones && p.bone != null) {
          const w = Math.exp(-Math.max(d, 0) / (p.sigma || sigma)) * (p.w ?? 1);
          if (Array.isArray(p.bone)) {
            // 선분 따라 두 뼈에 블렌딩
            const [a, b] = p.seg, t = Math.min(1, Math.max(0, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1]) + (z - a[2]) * (b[2] - a[2])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + (b[2] - a[2]) ** 2)));
            const s = p.blend || [0.7, 1.0];
            const u = t < s[0] ? 0 : t > s[1] ? 1 : (t - s[0]) / (s[1] - s[0]);
            acc[p.bone[0]] += w * (1 - u); acc[p.bone[1]] += w * u;
          } else acc[p.bone] += w;
        }
      }
      mat[v] = bm ? bm.mat : null;
      if (bones) {
        // 상위 4개
        const top = [];
        for (let b = 0; b < acc.length; b++) if (acc[b] > 1e-4) top.push([acc[b], b]);
        top.sort((p, q) => q[0] - p[0]);
        let s = 0; for (let k = 0; k < Math.min(4, top.length); k++) s += top[k][0];
        for (let k = 0; k < 4; k++) { si[v * 4 + k] = top[k] ? top[k][1] : 0; sw[v * 4 + k] = top[k] ? top[k][0] / (s || 1) : 0; }
        if (!top.length) sw[v * 4] = 1;
      }
    }
    return { mat, si, sw };
  }
}

// 재질 태그별 그룹으로 BufferGeometry 구성
export function buildGeometry(m, cls, matOrder, colorFn) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
  if (cls.si) { g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(cls.si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(cls.sw, 4)); }
  if (colorFn) {
    const n = m.pos.length / 3, col = new Float32Array(n * 3), out = [1, 1, 1];
    const lin = (c) => Math.pow(Math.max(0, c), 2.2);
    for (let v = 0; v < n; v++) { colorFn(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2], cls.mat[v], out); col[v * 3] = lin(out[0]); col[v * 3 + 1] = lin(out[1]); col[v * 3 + 2] = lin(out[2]); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  // 삼각형을 재질별로 정렬
  const buckets = matOrder.map(() => []);
  const I = m.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = cls.mat[I[t]], b = cls.mat[I[t + 1]], c = cls.mat[I[t + 2]];
    const tag = a === b || a === c ? a : b === c ? b : a;
    let gi = matOrder.indexOf(tag); if (gi < 0) gi = 0;
    buckets[gi].push(I[t], I[t + 1], I[t + 2]);
  }
  const all = [];
  buckets.forEach((b, gi) => { if (b.length) { g.addGroup(all.length, b.length, gi); for (const v of b) all.push(v); } });
  g.setIndex(new THREE.BufferAttribute(m.pos.length / 3 > 65535 ? new Uint32Array(all) : new Uint16Array(all), 1));
  g.computeBoundingSphere();
  return g;
}

// 라플라시안 스무딩 (계단 현상 제거)
export function smoothMesh(m, iters = 2, lambda = 0.5) {
  const n = m.pos.length / 3, nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < m.idx.length; t += 3) { const a = m.idx[t], b = m.idx[t + 1], c = m.idx[t + 2]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
  const tmp = new Float32Array(m.pos.length);
  for (let it = 0; it < iters; it++) {
    for (let v = 0; v < n; v++) {
      let sx = 0, sy = 0, sz = 0, k = 0;
      for (const u of nb[v]) { sx += m.pos[u * 3]; sy += m.pos[u * 3 + 1]; sz += m.pos[u * 3 + 2]; k++; }
      if (!k) { tmp[v * 3] = m.pos[v * 3]; tmp[v * 3 + 1] = m.pos[v * 3 + 1]; tmp[v * 3 + 2] = m.pos[v * 3 + 2]; continue; }
      tmp[v * 3] = m.pos[v * 3] + (sx / k - m.pos[v * 3]) * lambda; tmp[v * 3 + 1] = m.pos[v * 3 + 1] + (sy / k - m.pos[v * 3 + 1]) * lambda; tmp[v * 3 + 2] = m.pos[v * 3 + 2] + (sz / k - m.pos[v * 3 + 2]) * lambda;
    }
    m.pos.set(tmp);
  }
  // 법선 재계산 (면적 가중)
  const N = new Float32Array(m.pos.length), P = m.pos;
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, c = m.idx[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    for (const q of [a, b, c]) { N[q] += fx; N[q + 1] += fy; N[q + 2] += fz; }
  }
  for (let v = 0; v < n; v++) { const l = len3(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1; N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l; }
  m.nor = N;
  return m;
}

// 여러 SDF 부분 메쉬 합치기 (분류 결과 포함)
export function mergeParts(parts) {
  let nv = 0, ni = 0;
  for (const { m } of parts) { nv += m.pos.length / 3; ni += m.idx.length; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const mat = [], si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4);
  let vo = 0, io = 0;
  for (const { m, cls } of parts) {
    const n = m.pos.length / 3;
    pos.set(m.pos, vo * 3); nor.set(m.nor, vo * 3);
    for (let i = 0; i < m.idx.length; i++) idx[io++] = m.idx[i] + vo;
    for (let i = 0; i < n; i++) mat.push(cls.mat[i]);
    if (cls.si) { si.set(cls.si, vo * 4); sw.set(cls.sw, vo * 4); }
    vo += n;
  }
  return { m: { pos, nor, idx }, cls: { mat, si, sw } };
}
