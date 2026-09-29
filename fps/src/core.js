// 공용 유틸리티: 수학, 스프링, 지오메트리 병합, 광선-박스 교차
import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const smooth = (t) => t * t * (3 - 2 * t);
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

// 감쇠 스프링 (3축) — 반동/흔들림용
export class Spring3 {
  constructor(k = 180, c = 18) { this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); this.k = k; this.c = c; }
  impulse(x, y, z) { this.v.x += x; this.v.y += y; this.v.z += z; }
  update(dt) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v.x += (-this.k * this.x.x - this.c * this.v.x) * h;
      this.v.y += (-this.k * this.x.y - this.c * this.v.y) * h;
      this.v.z += (-this.k * this.x.z - this.c * this.v.z) * h;
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
  reset() { this.x.set(0, 0, 0); this.v.set(0, 0, 0); }
}

// 여러 BufferGeometry(position/normal/uv)를 하나로 병합
export function mergeGeometries(geos) {
  let vc = 0, ic = 0;
  for (const g of geos) { vc += g.attributes.position.count; ic += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, c = p.count;
    pos.set(p.array.subarray(0, c * 3), vo * 3);
    if (n) nor.set(n.array.subarray(0, c * 3), vo * 3);
    if (u) uv.set(u.array.subarray(0, c * 2), vo * 2);
    if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; }
    else for (let i = 0; i < c; i++) idx[io++] = i + vo;
    vo += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); out.computeBoundingBox();
  return out;
}

// 재질별로 지오메트리를 모아 병합하는 빌더
export class MeshBatch {
  constructor() { this.map = new Map(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); }
  add(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    this._q.setFromEuler(this._e.set(rx, ry, rz));
    this._m.compose(new THREE.Vector3(x, y, z), this._q, new THREE.Vector3(sx, sy, sz));
    geo.applyMatrix4(this._m);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
    return geo;
  }
  addMatrix(geo, mat, m) {
    geo.applyMatrix4(m);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
  }
  build(group = new THREE.Group(), { cast = false, receive = false } = {}) {
    for (const [mat, geos] of this.map) {
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
    this.map.clear();
    return group;
  }
}

// 광선-AABB 교차 (slab). 반환: 거리 t 또는 -1, out.n 에 법선
export function rayAABB(o, d, b, maxT, out) {
  let tmin = 0, tmax = maxT, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const oa = a === 0 ? o.x : a === 1 ? o.y : o.z;
    const da = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const mn = a === 0 ? b.min.x : a === 1 ? b.min.y : b.min.z;
    const mx = a === 0 ? b.max.x : a === 1 ? b.max.y : b.max.z;
    if (Math.abs(da) < 1e-9) { if (oa < mn || oa > mx) return -1; continue; }
    let t1 = (mn - oa) / da, t2 = (mx - oa) / da, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (axis < 0) return -1; // 내부에서 시작
  if (out) { out.n.set(0, 0, 0); if (axis === 0) out.n.x = sign; else if (axis === 1) out.n.y = sign; else out.n.z = sign; }
  return tmin;
}

// 광선-구 교차
export function raySphere(o, d, c, r, maxT) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxT ? t : -1;
}

// 2-본 IK: 어깨 S, 목표 W, 길이 a/b, 폴 방향 pole → 팔꿈치 out
const _u = new THREE.Vector3(), _v = new THREE.Vector3();
export function solveIK(S, W, a, b, pole, out) {
  _u.subVectors(W, S);
  let d = _u.length();
  const maxD = (a + b) * 0.999;
  if (d > maxD) { S.addScaledVector(_u, (d - maxD) / d); _u.subVectors(W, S); d = maxD; }
  d = Math.max(d, Math.abs(a - b) + 1e-3);
  _u.divideScalar(d);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _v.copy(pole).addScaledVector(_u, -pole.dot(_u)).normalize();
  return out.copy(S).addScaledVector(_u, a * cosA).addScaledVector(_v, a * sinA);
}

// 두 점 사이에 Y축 메쉬(캡슐 등)를 배치
const _Y = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
export function placeBetween(obj, A, B, len0 = 1) {
  _dir.subVectors(B, A);
  const L = _dir.length();
  obj.position.copy(A).add(B).multiplyScalar(0.5);
  obj.quaternion.setFromUnitVectors(_Y, _dir.divideScalar(L || 1));
  obj.scale.set(1, L / len0, 1);
}

// 키프레임 샘플러: keys = [[t, v...], ...]
export function sampleKeys(keys, t, out) {
  if (!keys || !keys.length) return null;
  const n = keys[0].length - 1;
  if (t <= keys[0][0]) { for (let i = 0; i < n; i++) out[i] = keys[0][i + 1]; return out; }
  const last = keys[keys.length - 1];
  if (t >= last[0]) { for (let i = 0; i < n; i++) out[i] = last[i + 1]; return out; }
  for (let k = 0; k < keys.length - 1; k++) {
    const a = keys[k], b = keys[k + 1];
    if (t >= a[0] && t <= b[0]) {
      const u = b[0] > a[0] ? smooth((t - a[0]) / (b[0] - a[0])) : 1;
      for (let i = 0; i < n; i++) out[i] = typeof a[i + 1] === 'number' ? lerp(a[i + 1], b[i + 1], u) : (u < 0.5 ? a[i + 1] : b[i + 1]);
      return out;
    }
  }
  return out;
}

// 앵커 키 샘플러: [[t,'name'],...] → {a, b, u}
export function sampleAnchor(keys, t) {
  if (!keys) return null;
  if (t <= keys[0][0]) return { a: keys[0][1], b: keys[0][1], u: 0 };
  for (let k = 0; k < keys.length - 1; k++) {
    const A = keys[k], B = keys[k + 1];
    if (t >= A[0] && t <= B[0]) return { a: A[1], b: B[1], u: smooth((t - A[0]) / Math.max(1e-4, B[0] - A[0])) };
  }
  const L = keys[keys.length - 1][1];
  return { a: L, b: L, u: 0 };
}
