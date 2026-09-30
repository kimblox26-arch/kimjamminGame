// 손 — 해부학적 장갑 손(손가락 3마디 + 엄지 3마디) 공용 정의, SDF 조형,
// 실제 총 메쉬를 단면으로 잘라 손가락이 표면에 닿을 때까지 감싸 쥐는 파지 해석기
//
// 손 로컬 좌표: x = 손목→손가락 방향, y = 손바닥 법선(손바닥 바깥), z = 엄지 쪽
import * as THREE from 'three';
import { SDFModel, ellipsoid, sphere, cone, rbox, torus, smoothMesh } from './sdf.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const FINGERS = ['index', 'middle', 'ring', 'pinky'];
export const HD = {
  index: { mcp: [0.091, -0.003, 0.029], splay: 0.075, len: [0.043, 0.026, 0.022], r: [0.0097, 0.0091, 0.0085, 0.0077] },
  middle: { mcp: [0.095, -0.003, 0.0085], splay: 0.015, len: [0.047, 0.029, 0.024], r: [0.01, 0.0094, 0.0087, 0.0079] },
  ring: { mcp: [0.09, -0.003, -0.0115], splay: -0.05, len: [0.044, 0.028, 0.023], r: [0.0095, 0.0089, 0.0083, 0.0076] },
  pinky: { mcp: [0.082, -0.002, -0.0295], splay: -0.12, len: [0.034, 0.021, 0.02], r: [0.0086, 0.008, 0.0075, 0.0068] },
  thumb: { mcp: [0.018, 0.011, 0.02], dir: [0.62, 0.3, 0.72], len: [0.046, 0.033, 0.028], r: [0.0135, 0.0122, 0.0112, 0.0098] },
};
const Y = V(0, 1, 0), NX = V(-1, 0, 0);
export const PALM_Y = 0.0135;   // 손바닥 표면 높이(장갑 포함)

// 휴지 자세 사슬
const CH = {};
for (const f of [...FINGERS, 'thumb']) {
  const d = HD[f], p0 = V(...d.mcp);
  const u = f === 'thumb' ? V(...d.dir).normalize() : V(Math.cos(d.splay), 0, Math.sin(d.splay));
  const pts = [p0]; for (let i = 0; i < 3; i++) pts.push(pts[i].clone().addScaledVector(u, d.len[i]));
  const axis = new THREE.Vector3().crossVectors(u, Y).normalize();            // 굽힘 축 (+ 는 손바닥 쪽)
  const v = Y.clone().addScaledVector(u, -u.dot(Y)).normalize();              // 굽힘 평면의 손바닥쪽 방향
  CH[f] = { u, v, pts, axis, r: d.r, len: d.len };
}
export const CHAIN = CH;

export function handBoneSpec() {
  const out = [];
  for (const f of ['thumb', ...FINGERS]) for (let i = 0; i < 3; i++) out.push({ name: f + (i + 1), parent: i ? f + i : 'hand', p: CH[f].pts[i].clone() });
  return out;
}

// ════════ 장갑 손 SDF (로컬 좌표) ════════
// bi(name) → 호출측 뼈 인덱스. detail: 너클 보호대·패드·주름, watch: 손목시계
export function buildGloveLocal({ h = 0.0012, detail = true, watch = false, bi }) {
  const S = new SDFModel([-0.062, -0.038, -0.05], [0.215, 0.06, 0.114], h);
  const H = bi('hand');
  // 커프(타원 단면) + 벨크로
  S.add(rbox([-0.03, 0.0, 0.001], [0.027, 0.0215, 0.0315], 0.019, { bone: H, mat: 'cuff', k: 0.01 }));
  if (detail) S.add(rbox([-0.022, -0.0205, 0.004], [0.017, 0.0035, 0.026], 0.003, { bone: H, mat: 'cuff2', k: 0.003 }));
  // 손바닥 몸체 · 무지구 · 소지구 · 손가락 뿌리 패드
  S.add(rbox([0.046, 0.0005, 0.0], [0.046, 0.0125, 0.04], 0.0115, { bone: H, mat: 'glove', k: 0.012 }));
  S.add(ellipsoid([0.03, 0.0095, 0.02], [0.032, 0.0125, 0.02], { bone: [H, bi('thumb1')], seg: [[0.004, 0.008, 0.008], [0.05, 0.018, 0.042]], blend: [0.35, 0.95], mat: 'glove', k: 0.012, rot: [0, -0.86, 0] }));
  S.add(ellipsoid([0.045, 0.0075, -0.028], [0.037, 0.0105, 0.0135], { bone: H, mat: 'glove', k: 0.01 }));
  S.add(ellipsoid([0.05, 0.0118, -0.002], [0.04, 0.0032, 0.033], { bone: H, mat: 'palm', k: 0.004 }));
  S.add(cone([0.085, 0.0072, -0.028], [0.085, 0.0072, 0.028], 0.0082, 0.0082, { bone: H, mat: 'palm', k: 0.008 }));
  if (detail) {
    // 분절형 너클 보호대 (손가락마다 둥근 돌기 + 얇은 연결대) · 손등 통기 패널
    S.add(rbox([0.086, -0.0122, 0.0], [0.006, 0.0022, 0.037], 0.002, { bone: H, mat: 'pad', k: 0.003 }));
    for (const f of FINGERS) { const c = HD[f].mcp; S.add(ellipsoid([c[0] - 0.004, -0.0128, c[2]], [0.0085, 0.0034, 0.0082], { bone: H, mat: 'pad', k: 0.0025 })); }
  }
  // 손가락
  for (const f of FINGERS) {
    const c = CH[f], [p0, p1, p2, p3] = c.pts.map((p) => p.toArray()), r = c.r, b = [1, 2, 3].map((i) => bi(f + i));
    const ry = -HD[f].splay;
    S.add(sphere(p0, r[0] * 1.1, { bone: [H, b[0]], seg: [c.pts[0].clone().addScaledVector(c.u, -0.02).toArray(), c.pts[0].clone().addScaledVector(c.u, 0.012).toArray()], blend: [0.35, 0.85], mat: 'glove', k: 0.004 }));
    S.add(cone(p0, p1, r[0], r[1], { bone: [b[0], b[1]], seg: [p0, p1], blend: [0.84, 1.06], mat: 'glove', k: 0.0026 }));
    S.add(sphere(p1, r[1] * 1.01, { bone: [b[0], b[1]], seg: [p0, p2], blend: [0.5, 0.66], mat: 'glove', k: 0.002 }));
    S.add(cone(p1, p2, r[1], r[2], { bone: [b[1], b[2]], seg: [p1, p2], blend: [0.8, 1.06], mat: 'glove', k: 0.0026 }));
    S.add(cone(p2, p3, r[2], r[3], { bone: b[2], mat: 'glove', k: 0.0026 }));
    // 손바닥쪽 그립 패드
    for (let i = 0; i < 3; i++) {
      const m = c.pts[i].clone().lerp(c.pts[i + 1], 0.5).addScaledVector(Y, r[i] * 0.5);
      S.add(ellipsoid(m.toArray(), [c.len[i] * 0.4, r[i] * 0.55, r[i] * 0.78], { bone: b[i], mat: 'palm', k: 0.0018, rot: [0, ry, 0] }));
    }
    if (detail) {
      const m = c.pts[0].clone().lerp(c.pts[1], 0.5).addScaledVector(Y, -r[0] * 0.92);
      S.add(ellipsoid(m.toArray(), [c.len[0] * 0.32, 0.0022, r[0] * 0.72], { bone: b[0], mat: 'pad', k: 0.0015, rot: [0, ry, 0] }));
      for (const j of [1, 2]) S.sub(torus(c.pts[j].toArray(), r[j] * 1.02, 0.0008, { k: 0.0012, rot: [0, ry, Math.PI / 2] }));
    }
  }
  // 엄지
  { const c = CH.thumb, [p0, p1, p2, p3] = c.pts.map((p) => p.toArray()), r = c.r, b = [1, 2, 3].map((i) => bi('thumb' + i));
    S.add(cone(p0, p1, r[0], r[1], { bone: [b[0], b[1]], seg: [p0, p1], blend: [0.85, 1.05], mat: 'glove', k: 0.009 }));
    S.add(cone(p1, p2, r[1], r[2], { bone: [b[1], b[2]], seg: [p1, p2], blend: [0.8, 1.06], mat: 'glove', k: 0.0026 }));
    S.add(cone(p2, p3, r[2], r[3], { bone: b[2], mat: 'glove', k: 0.0026 }));
    for (let i = 1; i < 3; i++) {
      const m = c.pts[i].clone().lerp(c.pts[i + 1], 0.5).addScaledVector(c.v, r[i] * 0.5);
      S.add(ellipsoid(m.toArray(), [c.len[i] * 0.38, r[i] * 0.5, r[i] * 0.75], { bone: b[i], mat: 'palm', k: 0.0018, rot: [0, -0.86, 0] }));
    }
  }
  if (watch) {
    S.add(rbox([-0.022, 0.0005, 0.0015], [0.0085, 0.0245, 0.0345], 0.019, { bone: H, mat: 'strap', k: 0.002 }));
    S.add(rbox([-0.022, -0.0265, 0.0], [0.0195, 0.0065, 0.021], 0.006, { bone: H, mat: 'watch', k: 0.002 }));
    S.add(rbox([-0.022, -0.0328, 0.0], [0.0145, 0.0012, 0.0155], 0.003, { bone: H, mat: 'face', k: 0.001 }));
  }
  S.bake();
  const m = smoothMesh(S.mesh(), 1, 0.3);
  return { m, S };
}

// 로컬 → 휴지(월드) 좌표: origin + d·x + n·y + w·z (거울 기저면 삼각형 뒤집기)
export function toRest(m, origin, d, n, w) {
  const P = m.pos, N = m.nor;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    P[i] = origin.x + d.x * x + n.x * y + w.x * z; P[i + 1] = origin.y + d.y * x + n.y * y + w.y * z; P[i + 2] = origin.z + d.z * x + n.z * y + w.z * z;
    const a = N[i], b = N[i + 1], c = N[i + 2];
    const nx = d.x * a + n.x * b + w.x * c, ny = d.y * a + n.y * b + w.y * c, nz = d.z * a + n.z * b + w.z * c, l = Math.hypot(nx, ny, nz) || 1;
    N[i] = nx / l; N[i + 1] = ny / l; N[i + 2] = nz / l;
  }
  if (d.dot(new THREE.Vector3().crossVectors(n, w)) < 0) for (let t = 0; t < m.idx.length; t += 3) { const tmp = m.idx[t + 1]; m.idx[t + 1] = m.idx[t + 2]; m.idx[t + 2] = tmp; }
  return m;
}

// ════════ 자세 적용 ════════
// pose: { off:[x,y,z], index..pinky: [a1,a2,a3,splay], thumb: [opp,f1,f2,f3] }
// B(name) → Bone, basis: {d,n,w}
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _ax = V(0, 0, 0);
export function applyHandPose(B, pose, basis) {
  const { d, n, w } = basis, s = d.dot(new THREE.Vector3().crossVectors(n, w)) < 0 ? -1 : 1;
  const W = (v) => _ax.set(d.x * v.x + n.x * v.y + w.x * v.z, d.y * v.x + n.y * v.y + w.y * v.z, d.z * v.x + n.z * v.y + w.z * v.z);
  for (const f of FINGERS) {
    const a = pose[f], c = CH[f];
    _q.setFromAxisAngle(W(Y), s * (HD[f].splay - a[3]));
    B(f + '1').quaternion.copy(_q).multiply(_q2.setFromAxisAngle(W(c.axis), s * a[0]));
    B(f + '2').quaternion.setFromAxisAngle(W(c.axis), s * a[1]);
    B(f + '3').quaternion.setFromAxisAngle(W(c.axis), s * a[2]);
  }
  const t = pose.thumb, c = CH.thumb;
  _q.setFromAxisAngle(W(Y), s * (t[4] || 0)).multiply(_q2.setFromAxisAngle(W(NX), s * t[0]));
  B('thumb1').quaternion.copy(_q).multiply(_q2.setFromAxisAngle(W(c.axis), s * t[1]));
  B('thumb2').quaternion.setFromAxisAngle(W(c.axis), s * t[2]);
  B('thumb3').quaternion.setFromAxisAngle(W(c.axis), s * t[3]);
}

export function lerpPose(A, B, u, out = {}) {
  if (u <= 0) return A; if (u >= 1) return B;
  out.off = A.off.map((x, i) => x + (B.off[i] - x) * u);
  for (const f of [...FINGERS, 'thumb']) out[f] = A[f].map((x, i) => x + (B[f][i] - x) * u);
  return out;
}

// ════════ 로컬 FK (해석기용) ════════
function fingerPts(f, a, g) {
  const c = CH[f], uA = V(Math.cos(g), 0, Math.sin(g)), pts = [c.pts[0].clone()];
  let phi = 0;
  for (let i = 0; i < 3; i++) { phi += a[i]; pts.push(pts[i].clone().addScaledVector(uA, c.len[i] * Math.cos(phi)).addScaledVector(Y, c.len[i] * Math.sin(phi))); }
  return pts;
}
const _tq = new THREE.Quaternion();
function thumbPts(t) {
  const c = CH.thumb, q = new THREE.Quaternion().setFromAxisAngle(Y, t[4] || 0).multiply(_tq.setFromAxisAngle(NX, t[0])), pts = [c.pts[0].clone()];
  let phi = 0;
  for (let i = 0; i < 3; i++) { phi += t[i + 1]; const dir = c.u.clone().multiplyScalar(Math.cos(phi)).addScaledVector(c.v, Math.sin(phi)).applyQuaternion(q); pts.push(pts[i].clone().addScaledVector(dir, c.len[i])); }
  return pts;
}

// ── 2D 볼록 다각형 ──
function hull(pts) {
  if (pts.length < 3) return null;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  return h.length >= 3 ? h : null;
}
function sdPoly(P, x, y) {
  let dmin = 1e9, inside = true;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / L2));
    const dx = x - a[0] - ex * t, dy = y - a[1] - ey * t;
    dmin = Math.min(dmin, dx * dx + dy * dy);
    if (ex * (y - a[1]) - ey * (x - a[0]) < 0) inside = false;   // CCW 가정
  }
  return inside ? -Math.sqrt(dmin) : Math.sqrt(dmin);
}
function dilate(P, r) {
  if (!P || r <= 0) return P;
  const out = [];
  for (const [x, y] of P) for (let k = 0; k < 8; k++) out.push([x + Math.cos(k * Math.PI / 4) * r, y + Math.sin(k * Math.PI / 4) * r]);
  return hull(out);
}

// ════════ 파지 대상(프록시): z 단면별 볼록 다각형 (손 로컬, 앵커 원점 기준) ════════
const ZS = []; for (let z = -0.045; z <= 0.1051; z += 0.01) ZS.push(+z.toFixed(3));
export function proxyFromMesh(root, anchorObj, side, { rsel = 0.05, dil = 0, skip = null } = {}) {
  root.updateMatrixWorld(true); anchorObj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(anchorObj.matrixWorld).invert(), M = new THREE.Matrix4(), v = V(0, 0, 0);
  const R = side === 'R';
  const tris = [], all = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.material.transparent || o.material.isShaderMaterial) return;
    let sk = false; if (skip) o.traverseAncestors((a) => { if (a === skip) sk = true; });
    if (sk || o === skip) return;   // 방아쇠 자체(검지가 닿도록 설계된 면)는 제외, 방아쇠울은 유지
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    M.multiplyMatrices(inv, o.matrixWorld);
    const loc = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M);
      // 앵커 좌표 → 손 로컬 (x=-za, y=∓xa, z=ya) — 왼손은 거울 기저라 y 만 반전
      loc[i * 3] = -v.z; loc[i * 3 + 1] = R ? -v.x : v.x; loc[i * 3 + 2] = v.y;
    }
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
      let near = false, box = false;
      for (const k of [a, b, c]) {
        if (Math.hypot(loc[k * 3], loc[k * 3 + 1]) < rsel + 0.02 && loc[k * 3 + 2] > -0.07 && loc[k * 3 + 2] < 0.13) near = true;
        if (Math.abs(loc[k * 3]) < 0.24 && Math.abs(loc[k * 3 + 1]) < 0.16 && loc[k * 3 + 2] > -0.14 && loc[k * 3 + 2] < 0.22) box = true;
      }
      const T = [loc[a * 3], loc[a * 3 + 1], loc[a * 3 + 2], loc[b * 3], loc[b * 3 + 1], loc[b * 3 + 2], loc[c * 3], loc[c * 3 + 1], loc[c * 3 + 2]];
      if (near) tris.push(T);
      if (box) all.push(T);
    }
  });
  const slices = ZS.map((z) => {
    const pts = [];
    for (const T of tris) {
      const e = [];
      for (const [i, j] of [[0, 3], [3, 6], [6, 0]]) {
        const za = T[i + 2], zb = T[j + 2];
        if ((za - z) * (zb - z) > 0 || za === zb) continue;
        const u = (z - za) / (zb - za);
        e.push([T[i] + (T[j] - T[i]) * u, T[i + 1] + (T[j + 1] - T[i + 1]) * u]);
      }
      for (const p of e) if (Math.hypot(p[0], p[1]) < rsel) pts.push(p);
    }
    return { z, poly: dilate(hull(pts), dil) };
  });
  // 프록시(손 로컬, 앵커 원점) → 총 로컬: p → 앵커 v=(±p.y, p.z, -p.x) → root 로컬
  const Bm = new THREE.Matrix4().set(0, R ? -1 : 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1);
  const P2R = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(anchorObj.matrixWorld).multiply(Bm);
  return { slices, surf: new SurfHash(all).setSolid(solidOf(root), P2R) };
}

// ════════ 실제 표면 거리 (삼각형 공간 해시) ════════
// 볼록 단면 프록시가 못 보는 비볼록/먼 형상(리시버 옆면·방아쇠울·레일)까지 손가락이 뚫지 않도록
const SC0 = 0.016;
class SurfHash {
  constructor(tris, sc = SC0) {
    const SC = this.sc = sc;
    this.t = tris; this.map = new Map();
    for (let i = 0; i < tris.length; i++) {
      const T = tris[i];
      const x0 = Math.floor(Math.min(T[0], T[3], T[6]) / SC), x1 = Math.floor(Math.max(T[0], T[3], T[6]) / SC);
      const y0 = Math.floor(Math.min(T[1], T[4], T[7]) / SC), y1 = Math.floor(Math.max(T[1], T[4], T[7]) / SC);
      const z0 = Math.floor(Math.min(T[2], T[5], T[8]) / SC), z1 = Math.floor(Math.max(T[2], T[5], T[8]) / SC);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4000) continue;
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
        const k = (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
        let l = this.map.get(k); if (!l) this.map.set(k, l = []); l.push(i);
      }
    }
    this.stamp = new Uint32Array(tris.length); this.gen = 0;
    // 면 법선 (감김 순서 → 바깥 방향) : 부호 거리용
    this.n = new Float32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) {
      const T = tris[i], ux = T[3] - T[0], uy = T[4] - T[1], uz = T[5] - T[2], vx = T[6] - T[0], vy = T[7] - T[1], vz = T[8] - T[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      this.n[i * 3] = nx / l; this.n[i * 3 + 1] = ny / l; this.n[i * 3 + 2] = nz / l;
    }
  }
  // 내부 판정 격자 연결 (M: 이 해시 좌표 → 격자 물체 로컬)
  setSolid(grid, M = null) { this.solid = grid; this.M = M; this._p = V(0, 0, 0); return this; }
  _in(px, py, pz) { const p = this._p.set(px, py, pz); if (this.M) p.applyMatrix4(this.M); return this.solid.inside(p.x, p.y, p.z); }
  // 부호 거리: 격자가 있으면 격자로 안/밖, 없으면 가장 가까운 면 법선 기준
  sdist(px, py, pz) {
    if (this.solid) { const d = this.dist(px, py, pz); return this._in(px, py, pz) ? -d : d; }
    return this._sdistN(px, py, pz);
  }
  _sdistN(px, py, pz) {
    const SC = this.sc, cx = Math.floor(px / SC), cy = Math.floor(py / SC), cz = Math.floor(pz / SC);
    let best = SC * SC, bs = 1; const g = ++this.gen;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      const l = this.map.get((x + 512) * 1048576 + (y + 512) * 1024 + (z + 512)); if (!l) continue;
      for (const i of l) {
        if (this.stamp[i] === g) continue; this.stamp[i] = g;
        const d = ptTri2(px, py, pz, this.t[i]); if (d > best + 1e-10) continue;
        const T = this.t[i], sd = (px - T[0]) * this.n[i * 3] + (py - T[1]) * this.n[i * 3 + 1] + (pz - T[2]) * this.n[i * 3 + 2];
        if (d < best - 1e-10 || Math.abs(sd) > Math.abs(bs)) { best = d; bs = sd; }
      }
    }
    const d = Math.sqrt(best);
    return bs < 0 && d < SC ? -d : d;
  }
  // 가장 가까운 표면점과 부호 거리: out = [sd, qx, qy, qz] (범위 밖이면 null)
  closest(px, py, pz, out) {
    const SC = this.sc, cx = Math.floor(px / SC), cy = Math.floor(py / SC), cz = Math.floor(pz / SC);
    let best = SC * SC, bs = 1, found = false; const g = ++this.gen;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      const l = this.map.get((x + 512) * 1048576 + (y + 512) * 1024 + (z + 512)); if (!l) continue;
      for (const i of l) {
        if (this.stamp[i] === g) continue; this.stamp[i] = g;
        const d = ptTri2(px, py, pz, this.t[i]); if (d > best + 1e-10) continue;
        const T = this.t[i], sd = (px - T[0]) * this.n[i * 3] + (py - T[1]) * this.n[i * 3 + 1] + (pz - T[2]) * this.n[i * 3 + 2];
        if (d < best - 1e-10 || Math.abs(sd) > Math.abs(bs)) { best = d; bs = sd; out[1] = _Q[0]; out[2] = _Q[1]; out[3] = _Q[2]; found = true; }
      }
    }
    if (!found) { if (this.solid && this._in(px, py, pz)) { out[0] = -SC; return null; } return null; }
    const d = Math.sqrt(best); out[0] = (this.solid ? this._in(px, py, pz) : bs < 0) ? -d : d;
    return out;
  }
  // 점에서 가장 가까운 표면까지 거리 (반경 SC 이내만 정확, 그 밖은 SC)
  dist(px, py, pz) {
    const SC = this.sc, cx = Math.floor(px / SC), cy = Math.floor(py / SC), cz = Math.floor(pz / SC);
    let best = SC * SC; const g = ++this.gen;
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      const l = this.map.get((x + 512) * 1048576 + (y + 512) * 1024 + (z + 512)); if (!l) continue;
      for (const i of l) { if (this.stamp[i] === g) continue; this.stamp[i] = g; const d = ptTri2(px, py, pz, this.t[i]); if (d < best) best = d; }
    }
    return Math.sqrt(best);
  }
}
// ════════ 내부 판정: 표면 복셀화 → 바깥에서 채우기(flood fill) ════════
// 겹치거나 박힌 부품, 뒤집힌 법선과 무관하게 '안/밖'을 정확히 판정 (복셀 2.5mm)
export class SolidGrid {
  constructor(root, h = 0.0025) {
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4(), a = V(0, 0, 0), b = V(0, 0, 0), c = V(0, 0, 0);
    const tris = [], mn = V(1e9, 1e9, 1e9), mx = V(-1e9, -1e9, -1e9);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.material.transparent || o.material.isShaderMaterial) return;
      M.multiplyMatrices(inv, o.matrixWorld);
      const p = o.geometry.attributes.position, ix = o.geometry.index, n = ix ? ix.count : p.count;
      for (let t = 0; t < n; t += 3) {
        a.fromBufferAttribute(p, ix ? ix.getX(t) : t).applyMatrix4(M); b.fromBufferAttribute(p, ix ? ix.getX(t + 1) : t + 1).applyMatrix4(M); c.fromBufferAttribute(p, ix ? ix.getX(t + 2) : t + 2).applyMatrix4(M);
        tris.push([a.clone(), b.clone(), c.clone()]); mn.min(a).min(b).min(c); mx.max(a).max(b).max(c);
      }
    });
    mn.subScalar(h * 3); mx.addScalar(h * 3);
    const nx = Math.ceil((mx.x - mn.x) / h), ny = Math.ceil((mx.y - mn.y) / h), nz = Math.ceil((mx.z - mn.z) / h);
    const G = new Uint8Array(nx * ny * nz), id = (x, y, z) => (x * ny + y) * nz + z;
    // 표면 복셀 (삼각형 위 표본점 간격 h/2)
    const e1 = V(0, 0, 0), e2 = V(0, 0, 0), q = V(0, 0, 0);
    for (const [A, B, C] of tris) {
      e1.subVectors(B, A); e2.subVectors(C, A);
      const na = Math.max(1, Math.ceil(e1.length() / (h * 0.5))), nb = Math.max(1, Math.ceil(e2.length() / (h * 0.5)));
      for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
        const u = i / na, v = j / nb; if (u + v > 1) continue;
        q.copy(A).addScaledVector(e1, u).addScaledVector(e2, v);
        const X = Math.floor((q.x - mn.x) / h), Y = Math.floor((q.y - mn.y) / h), Z = Math.floor((q.z - mn.z) / h);
        if (X >= 0 && Y >= 0 && Z >= 0 && X < nx && Y < ny && Z < nz) G[id(X, Y, Z)] = 1;
      }
    }
    // 경계에서 6-이웃 채우기 → 2 = 바깥, 0 으로 남은 곳 = 속
    const Q = new Int32Array(nx * ny * nz); let qh = 0, qt = 0;
    const push = (x, y, z) => { const i = id(x, y, z); if (G[i] === 0) { G[i] = 2; Q[qt++] = i; } };
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) { push(x, y, 0); push(x, y, nz - 1); }
    for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) { push(x, 0, z); push(x, ny - 1, z); }
    for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) { push(0, y, z); push(nx - 1, y, z); }
    while (qh < qt) {
      const i = Q[qh++], z = i % nz, y = ((i - z) / nz) % ny, x = (i - z - y * nz) / (nz * ny);
      if (x > 0) push(x - 1, y, z); if (x < nx - 1) push(x + 1, y, z);
      if (y > 0) push(x, y - 1, z); if (y < ny - 1) push(x, y + 1, z);
      if (z > 0) push(x, y, z - 1); if (z < nz - 1) push(x, y, z + 1);
    }
    Object.assign(this, { G, mn, h, nx, ny, nz });
  }
  // 물체 로컬 점이 속(0)인지. 표면 복셀(1)·바깥(2)·격자 밖 = false
  inside(x, y, z) {
    const X = Math.floor((x - this.mn.x) / this.h), Y = Math.floor((y - this.mn.y) / this.h), Z = Math.floor((z - this.mn.z) / this.h);
    if (X < 0 || Y < 0 || Z < 0 || X >= this.nx || Y >= this.ny || Z >= this.nz) return false;
    return this.G[(X * this.ny + Y) * this.nz + Z] === 0;
  }
}
export function solidOf(root) { return root.userData.solid || (root.userData.solid = new SolidGrid(root)); }

// 물체 전체의 표면 해시 (물체 로컬 좌표) — 손 이동 경로가 총을 관통하지 않게
export function surfOf(root, sc = 0.03) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), M = new THREE.Matrix4(), a = V(0, 0, 0), tris = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.material.transparent || o.material.isShaderMaterial) return;
    M.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position, ix = o.geometry.index, n = ix ? ix.count : p.count;
    for (let t = 0; t < n; t += 3) {
      const T = [];
      for (let j = 0; j < 3; j++) { a.fromBufferAttribute(p, ix ? ix.getX(t + j) : t + j).applyMatrix4(M); T.push(a.x, a.y, a.z); }
      tris.push(T);
    }
  });
  return new SurfHash(tris, sc).setSolid(solidOf(root));
}
// 점-삼각형 최단거리² (Ericson, Real-Time Collision Detection)
function ptTri2(px, py, pz, T) {
  const ax = T[0], ay = T[1], az = T[2], abx = T[3] - ax, aby = T[4] - ay, abz = T[5] - az, acx = T[6] - ax, acy = T[7] - ay, acz = T[8] - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
  else {
    const bpx = px - T[3], bpy = py - T[4], bpz = pz - T[5];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    if (d3 >= 0 && d4 <= d3) { qx = T[3]; qy = T[4]; qz = T[5]; }
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; }
      else {
        const cpx = px - T[6], cpy = py - T[7], cpz = pz - T[8];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        if (d6 >= 0 && d5 <= d6) { qx = T[6]; qy = T[7]; qz = T[8]; }
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = T[3] + (T[6] - T[3]) * w; qy = T[4] + (T[7] - T[4]) * w; qz = T[5] + (T[8] - T[5]) * w; }
            else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w; }
          }
        }
      }
    }
  }
  const dx = px - qx, dy = py - qy, dz = pz - qz;
  _Q[0] = qx; _Q[1] = qy; _Q[2] = qz;
  return dx * dx + dy * dy + dz * dz;
}
const _Q = [0, 0, 0];
// 해석적 프록시: 구(반지름 r) / 사각기둥(hx·hy, 길이 hz)
export function proxyShape(kind, a) {
  const slices = ZS.map((z) => {
    let pts = [];
    if (kind === 'sphere') { const rr = a.r * a.r - (z - (a.cz || 0)) ** 2; if (rr > 1e-6) { const r = Math.sqrt(rr); for (let k = 0; k < 20; k++) pts.push([a.cx + Math.cos(k / 20 * 6.283) * r, a.cy + Math.sin(k / 20 * 6.283) * r]); } }
    else if (kind === 'box' && Math.abs(z - (a.cz || 0)) < a.hz) pts = [[a.cx - a.hx, a.cy - a.hy], [a.cx + a.hx, a.cy - a.hy], [a.cx + a.hx, a.cy + a.hy], [a.cx - a.hx, a.cy + a.hy]];
    else if (kind === 'cyl' && Math.abs(z - (a.cz || 0)) < (a.hz || 1)) for (let k = 0; k < 20; k++) pts.push([a.cx + Math.cos(k / 20 * 6.283) * a.r, a.cy + Math.sin(k / 20 * 6.283) * a.r]);
    return { z, poly: hull(pts) };
  });
  return { slices };
}

// ════════ 파지 해석 ════════
const REL = {
  relaxed: { index: [0.3, 0.42, 0.22, 0.06], middle: [0.36, 0.5, 0.26, 0.012], ring: [0.42, 0.56, 0.3, -0.04], pinky: [0.5, 0.62, 0.34, -0.09], thumb: [0.35, 0.2, 0.18, 0.12, 0] },
  open: { index: [0.06, 0.08, 0.04, 0.07], middle: [0.06, 0.08, 0.04, 0.015], ring: [0.08, 0.1, 0.05, -0.05], pinky: [0.1, 0.12, 0.06, -0.11], thumb: [0.15, 0.05, 0.05, 0.05, 0] },
  fist: { index: [1.45, 1.6, 0.9, 0.03], middle: [1.5, 1.65, 0.9, 0.01], ring: [1.5, 1.65, 0.9, -0.02], pinky: [1.5, 1.6, 0.9, -0.05], thumb: [0.9, 0.5, 0.6, 0.5, 0] },
  hook: { index: [0.9, 1.35, 0.8, 0.05], middle: [0.95, 1.35, 0.8, 0.01], ring: [1.3, 1.55, 0.9, -0.03], pinky: [1.35, 1.55, 0.9, -0.06], thumb: [0.6, 0.35, 0.35, 0.3, 0] },
  ring: { index: [0.8, 1.2, 0.7, 0.1], middle: [1.3, 1.55, 0.9, 0.0], ring: [1.35, 1.55, 0.9, -0.03], pinky: [1.4, 1.55, 0.9, -0.06], thumb: [0.7, 0.35, 0.45, 0.4, 0] },
};
export function preset(name, off = [0.058, 0.03, 0]) {
  const P = REL[name] || REL.relaxed, o = { off: off.slice() };
  for (const k in P) o[k] = P[k].slice();
  return o;
}

// 실제 장갑 손바닥 표면 높이 지도 (x·z 격자별 최대 y) — 무지구/소지구/패드 볼록 포함
let PALM_MAP = null;
function palmMap() {
  if (PALM_MAP) return PALM_MAP;
  const { m } = buildGloveLocal({ h: 0.0025, detail: true, watch: false, bi: () => 0 });
  const nx = 22, nz = 20, H = new Float32Array(nx * nz).fill(-1);
  for (let i = 0; i < m.pos.length; i += 3) {
    const x = m.pos[i], y = m.pos[i + 1], z = m.pos[i + 2];
    if (x < -0.005 || x >= 0.105 || z < -0.05 || z >= 0.05 || y < 0) continue;
    const ix = Math.floor((x + 0.005) / 0.005), iz = Math.floor((z + 0.05) / 0.005);
    if (ix < nx && iz < nz) H[ix * nz + iz] = Math.max(H[ix * nz + iz], y);
  }
  return (PALM_MAP = { H, nx, nz });
}
// 단면 다각형에서 세로선 x 의 최저 y
function polyMinYAt(P, x) {
  let lo = 1e9;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
    const u = (x - a[0]) / (b[0] - a[0]); lo = Math.min(lo, a[1] + (b[1] - a[1]) * u);
  }
  return lo;
}
// proxy 의 z=0 부근 단면으로 손바닥이 닿는 위치(off) 결정
function fitOffset(proxy, gx) {
  // 물체 앞면(손가락이 감아 도는 쪽)이 손허리손가락 관절선(x≈0.087)에 오도록
  let maxX = -1e9;
  for (const s of proxy.slices) if (s.poly && Math.abs(s.z) <= 0.021) for (const p of s.poly) maxX = Math.max(maxX, p[0]);
  if (maxX < -1e8) return null;
  const Gx = gx ?? THREE.MathUtils.clamp(0.087 - maxX, 0.035, 0.075);
  let minY = 1e9;
  for (const s of proxy.slices) if (s.poly && s.z >= -0.041 && s.z <= 0.041) {
    // 손바닥 영역(x 0.0~0.095)에 들어오는 다각형 부분의 최저 y (변 위 보간 포함)
    const P = s.poly;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      for (let k = 0; k <= 8; k++) { const x = a[0] + (b[0] - a[0]) * k / 8, y = a[1] + (b[1] - a[1]) * k / 8; if (x + Gx > 0.0 && x + Gx < 0.095) minY = Math.min(minY, y); }
    }
  }
  if (minY > 1e8) return null;
  // 손바닥 실제 표면 격자마다: 물체 아래면이 손바닥 표면보다 (연조직 압착 2mm 이내로) 위에 있게
  const { H, nx, nz } = palmMap();
  let oy = PALM_Y - 0.0008 - minY;
  for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
    const h = H[ix * nz + iz]; if (h < 0) continue;
    const x = -0.005 + (ix + 0.5) * 0.005, z = -0.05 + (iz + 0.5) * 0.005;
    const P = slicePoly(proxy, z); if (!P) continue;
    const py = polyMinYAt(P, x - Gx); if (py > 1e8) continue;
    oy = Math.max(oy, h - 0.002 - py);
  }
  // 단면 밖(지지대·양각대·방아쇠울 등) 실제 표면도 손바닥을 뚫지 않게 필요한 만큼 띄움
  if (proxy.surf) for (let k = 0; k < 16; k++) {
    let worst = 0;
    for (let ix = 0; ix < nx; ix += 2) for (let iz = 0; iz < nz; iz += 2) {
      const h = H[ix * nz + iz]; if (h < 0) continue;
      const x = -0.005 + (ix + 0.5) * 0.005, z = -0.05 + (iz + 0.5) * 0.005;
      worst = Math.max(worst, -proxy.surf.sdist(x - Gx, h - 0.002 - oy, z));
    }
    if (worst < 0.001) break;
    oy += Math.min(0.004, worst);
  }
  return [Gx, oy, 0];
}

// z 에 가장 가까운 단면으로 부호거리
function sdProxy(proxy, off, x, y, z) {
  const zz = z - off[2], i = Math.round((zz - ZS[0]) / 0.01);
  if (i < 0 || i >= ZS.length || Math.abs(ZS[i] - zz) > 0.0075) return 1;
  const P = proxy.slices[i].poly;
  return P ? sdPoly(P, x - off[0], y - off[1]) : 1;
}

// 마디별 최대 관통 깊이 (볼록 단면 + 실제 표면 거리)
const USE_SURF = { on: false };
function penetration(pts, r, proxy, off, palm, out = [0, 0, 0]) {
  for (let i = 0; i < 3; i++) {
    let pen = 0;
    const A = pts[i], Bp = pts[i + 1];
    for (const t of [0.2, 0.45, 0.7, 0.95, 1.0]) {
      if (t === 1.0 && i < 2) continue;
      // 장갑 패드·굽힘 부풀음을 감안해 반지름 +8% +0.8mm
      const qx = A.x + (Bp.x - A.x) * t, qy = A.y + (Bp.y - A.y) * t, qz = A.z + (Bp.z - A.z) * t, rr = (r[i] + (r[i + 1] - r[i]) * t) * 1.08 + 0.0008;
      if (proxy) {
        pen = Math.max(pen, rr - sdProxy(proxy, off, qx, qy, qz));
        if (proxy.surf && USE_SURF.on) pen = Math.max(pen, rr - proxy.surf.sdist(qx - off[0], qy - off[1], qz - off[2]));
      }
      if (palm && qx > -0.005 && qx < 0.09 && Math.abs(qz) < 0.045) pen = Math.max(pen, qy + rr - PALM_Y - 0.004);
    }
    out[i] = pen;
  }
  return out;
}
function collides(pts, r, proxy, off, tol, palm, base) {
  const p = penetration(pts, r, proxy, off, palm);
  for (let i = 0; i < 3; i++) if (p[i] > Math.max(tol, base ? base[i] + tol : tol)) return i;
  return -1;
}

// 관절을 동시에 굽히다가 닿은 마디부터 고정 (손바닥 관통 방지 포함)
// 실제 표면 관통(마디별) — 시작 자세에서 이미 겹친 마디는 제외(부호 없는 거리라 내부 판정 불가)
function surfPen(pts, r, proxy, off, out = [0, 0, 0]) {
  for (let i = 0; i < 3; i++) {
    let pen = 0; const A = pts[i], Bp = pts[i + 1];
    for (const t of [0.25, 0.6, 0.95]) {
      const rr = (r[i] + (r[i + 1] - r[i]) * t) * 1.08 + 0.0008;
      pen = Math.max(pen, rr - proxy.surf.dist(A.x + (Bp.x - A.x) * t - off[0], A.y + (Bp.y - A.y) * t - off[1], A.z + (Bp.z - A.z) * t - off[2]));
    }
    out[i] = pen;
  }
  return out;
}
function close(fk, r, maxA, proxy, off, { tol = 0.0008, palm = true, steps = 90, start } = {}) {
  const a = start ? start.slice() : [0, 0, 0], fz = [false, false, false];
  // 처음부터 겹쳐 있는 마디(방아쇠울 등)는 '더 깊어질 때' 만 충돌로 봄
  const base = penetration(fk(a), r, proxy, off, palm).map((x) => (x > tol ? x : 0));
  const useS = proxy && proxy.surf && !USE_SURF.on, sb = useS ? surfPen(fk(a), r, proxy, off).map((x) => x <= tol) : null;
  for (let it = 0; it < steps; it++) {
    const tr = a.map((x, i) => (fz[i] ? x : Math.min(maxA[i], x + maxA[i] / steps * 1.4)));
    const P = fk(tr);
    let hit = collides(P, r, proxy, off, tol, palm, base);
    if (useS) { const sp = surfPen(P, r, proxy, off); for (let i = 0; i < 3; i++) if (sb[i] && sp[i] > tol && (hit < 0 || i < hit)) { hit = i; break; } }
    if (hit >= 0) { for (let i = 0; i <= hit; i++) fz[i] = true; for (let i = hit + 1; i < 3; i++) a[i] = tr[i]; }
    else for (let i = 0; i < 3; i++) a[i] = tr[i];
    if (fz.every((x, i) => x || a[i] >= maxA[i])) break;
  }
  return a;
}

// 엄지 목표: mode 'far' = 물체 반대편(손바닥 반대쪽 면) 높이 z, 'along' = 물체 옆면을 따라 앞(+z)으로
function slicePoly(proxy, z) { let best = null, bd = 1e9; for (const s of proxy.slices) { const d = Math.abs(s.z - z); if (s.poly && d < bd) { bd = d; best = s; } } return bd < 0.012 ? best.poly : null; }
function thumbTarget(proxy, o, t) {
  if (!t) return null;
  const rt = CH.thumb.r[3];
  if (t.mode === 'far') {
    const P = slicePoly(proxy, t.z - o[2]) || slicePoly(proxy, t.z - o[2] - 0.012);
    if (!P) return null;
    let my = -1e9, mx = 0; for (const [x, y] of P) if (y > my) { my = y; mx = x; }
    return V(mx + o[0] + (t.dx || 0), my + o[1] + rt * 1.2, t.z);
  }
  if (t.mode === 'fwd') {   // 엄지를 앞으로 곧게 (권총 thumbs-forward): 프레임 앞쪽, 지정한 면(near=손바닥쪽/far=반대쪽)
    const P = slicePoly(proxy, (t.zs ?? 0.045) - o[2]);
    if (!P) return null;
    let mx = -1e9, lo = 1e9, hi = -1e9; for (const [x, y] of P) { mx = Math.max(mx, x); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    return V(mx + o[0] + (t.dx ?? 0.02), (t.side === 'near' ? lo - rt * 1.2 : hi + rt * 1.2) + o[1], t.z);
  }
  if (t.mode === 'along') {
    const P = slicePoly(proxy, (t.zs ?? 0.02) - o[2]);
    if (!P) return null;
    let mx = 1e9, cy = 0; for (const [x, y] of P) if (x < mx) { mx = x; } let n = 0; for (const [x, y] of P) if (x < mx + 0.006) { cy += y; n++; }
    return V(mx + o[0] - rt * 1.15, cy / n + o[1] + (t.dy || 0), t.z);
  }
  return null;
}
const THUMB_R = CH.thumb.r.map((x) => x * 1.16);
const IDX_SIDE = V(0.1, 0.012, 0.045);
function thumbCost(t, T, proxy, o) {
  const pts = thumbPts(t), pen = penetration(pts, THUMB_R, proxy, o, false);   // 손허리뼈(0)는 물갈퀴가 등판을 감싸므로 제외
  return pts[3].distanceTo(T) + Math.max(0, pen[1] - 0.0005) * 30 + Math.max(0, pen[2] - 0.0005) * 30 + (t[0] * t[0] + t[4] * t[4]) * 0.002;
}
function thumbSearch(T, proxy, o) {
  // [opp, f1, f2, f3=0.8·f2, ab] 거친 격자 → 주변 세밀 탐색
  let best = null, bd = 1e9;
  USE_SURF.on = false;   // 거친 격자는 볼록 프록시만 (속도), 세밀 탐색부터 실제 표면 포함
  const top = [];
  for (let ab = -0.3; ab <= 1.21; ab += 0.15) for (let opp = -0.3; opp <= 1.5; opp += 0.15) for (let f1 = -0.3; f1 <= 0.9; f1 += 0.15) for (let f2 = 0; f2 <= 0.91; f2 += 0.3) {
    const t = [opp, f1, f2, f2 * 0.8, ab], c = thumbCost(t, T, proxy, o);
    top.push([c, t]);
  }
  top.sort((a, b) => a[0] - b[0]);
  // 상위 후보를 실제 표면(부호 거리)으로 재평가 — 리시버 속에 숨은 엄지 배제
  if (proxy.surf) { USE_SURF.on = true; for (let i = 0; i < Math.min(80, top.length); i++) { const c = thumbCost(top[i][1], T, proxy, o); if (c < bd) { bd = c; best = top[i][1]; } } }
  else { best = top[0][1]; bd = top[0][0]; }
  USE_SURF.on = true; bd = thumbCost(best, T, proxy, o);   // (끝나면 호출측에서 끔)
  for (let pass = 0; pass < 3; pass++) {
    const st = pass === 2 ? 0.015 : pass ? 0.03 : 0.075, b0 = best.slice();
    for (let da = -2; da <= 2; da++) for (let db = -2; db <= 2; db++) for (let dc = -2; dc <= 2; dc++) for (let dd = -1; dd <= 1; dd++) {
      const f2 = Math.max(0, b0[2] + dd * st * 2), t = [b0[0] + db * st, b0[1] + dc * st, f2, f2 * 0.8, b0[4] + da * st], c = thumbCost(t, T, proxy, o);
      if (c < bd) { bd = c; best = t; }
    }
  }
  return best;
}

// kind: 'grip' | 'support' | 'mag' | 'wrap' ... opts: {trigger: Vector3(앵커 원점 기준 손 로컬), thumb: [opp], spread}
export function solveGrasp(proxy, { off = null, gx, trigger = null, thumbOpp = 0.75, thumb = null, spread = 0.2, indexUp = 0.12, maxA = [1.55, 1.75, 1.15] } = {}) {
  const o = off || fitOffset(proxy, gx);
  if (!o) return null;
  const pose = { off: o };
  for (const f of FINGERS) {
    const g = HD[f].splay * spread;
    pose[f] = [...close((a) => fingerPts(f, a, g), CH[f].r, maxA, proxy, o), g];
  }
  // 엄지: 목표점(물체 반대편 위쪽 / 물체 옆면을 따라 앞쪽) 탐색, 아니면 감싸 굽힘
  // 엄지: 후보(지정 목표 → 감싸 쥐기)를 차례로 풀고 실제 표면을 뚫지 않는 첫 해 채택
  const wrap = () => [thumbOpp, ...close((a) => thumbPts([thumbOpp, ...a, 0]), THUMB_R, [0.95, 0.95, 1.1], proxy, o, { palm: false }), 0];
  const thumbPen = (t) => { if (!proxy.surf) return 0; USE_SURF.on = true; const p = penetration(thumbPts(t), THUMB_R, proxy, o, false); USE_SURF.on = false; return Math.max(p[1], p[2]); };
  let tb = null, tp = 1e9;
  for (const spec of [...(Array.isArray(thumb) ? thumb : [thumb]), null]) {
    const T = thumbTarget(proxy, o, spec);
    if (spec && !T) continue;
    const t = T ? thumbSearch(T, proxy, o) : wrap(); USE_SURF.on = false;
    const p = thumbPen(t);
    if (p < tp) { tp = p; tb = t; }
    if (p < 0.0015) break;
  }
  if (tp >= 0.0015 && proxy.surf) {
    // 최후: 관통 최소화만 (이완 자세에 가까운 쪽) — 엄지를 옆면에 곧게 얹는 등
    let bc = 1e9;
    for (let ab = -0.3; ab <= 1.2; ab += 0.1) for (let opp = -0.4; opp <= 1.4; opp += 0.1) for (const f1 of [-0.2, 0, 0.2, 0.4]) for (const f2 of [0, 0.3, 0.6]) {
      const t = [opp, f1, f2, f2 * 0.8, ab], p = thumbPen(t), tip = thumbPts(t)[3];
      // 관통 최소 + 엄지 끝이 검지 옆(자연스러운 휴식 위치)에 가깝게 — 허공으로 곧게 뻗은 '엄지척' 배제
      const c = Math.max(0, p - 0.0005) * 50 + tip.distanceTo(IDX_SIDE) * 0.08 + Math.abs(ab) * 0.005;
      if (c < bc) { bc = c; tp = p; tb = t; }
    }
  }
  pose.thumb = tb;
  // 검지: 방아쇠 / 프레임 위 곧게 (트리거 규율)
  if (trigger) {
    pose.indexFrame = pose.index.slice();
    const T = V(trigger.x + o[0], trigger.y + o[1], trigger.z + o[2]);
    const p0 = CH.index.pts[0], g0 = THREE.MathUtils.clamp(Math.atan2(T.z - p0.z, T.x - p0.x), -0.3, 0.4);
    const L = CH.index.len, r = CH.index.r;
    const cand = [];
    for (const g of [g0, g0 + 0.1, Math.max(-0.36, g0 - 0.08), g0 + 0.2]) for (let a1 = 0; a1 <= 1.4; a1 += 0.035) for (let a2 = 0; a2 <= 1.4; a2 += 0.035) {
      const a3 = a2 * 0.6, pts = fingerPts('index', [a1, a2, a3], g);
      const dir = pts[3].clone().sub(pts[2]).normalize(), nrm = V(-Math.sin(g), 0, Math.cos(g)).cross(dir).normalize();
      const pad = pts[2].clone().addScaledVector(dir, L[2] * 0.62).addScaledVector(nrm, r[2] * 0.9);
      cand.push([pad.distanceTo(T) + (collides(pts, r, null, o, 0.001, true) >= 0 ? 0.05 : 0), a1, a2, a3, g]);
    }
    cand.sort((x, y) => x[0] - y[0]);
    // 방아쇠에 가장 가까우면서 방아쇠울/프레임을 뚫지 않는 자세 (방아쇠 자체 접촉 1.5mm 허용)
    let best = null, bc = 1e9;
    USE_SURF.on = true;
    // 방아쇠까지 거리 + 방아쇠울/리시버 관통(강한 벌점)의 합이 최소인 자세
    for (let i = 0; i < cand.length; i++) {
      const [dd, a1, a2, a3, g] = cand[i]; if (dd > bc) break;
      const pen = Math.max(...penetration(fingerPts('index', [a1, a2, a3], g), r, proxy, o, true)), c = dd + Math.max(0, pen - 0.0008) * 25 + a2 * 0.004 + Math.abs(g - g0) * 0.01;   // 주먹처럼 과하게 말리거나 옆으로 꺾인 자세는 비선호
      if (c < bc) { bc = c; best = [a1, a2, a3, g]; }
    }
    pose.indexTrig = best || [cand[0][1], cand[0][2], cand[0][3], cand[0][4]];
    // 프레임을 따라 곧게: 살짝 위로 벌리고 옆면에 닿을 때까지만 굽힘
    const gu = HD.index.splay + indexUp;
    pose.indexFrame = [...close((a) => fingerPts('index', a, gu), CH.index.r, [0.55, 0.18, 0.1], proxy, o, { palm: false }), gu];
    // 곧게 편 검지가 리시버 옆면을 뚫으면 바깥(엄지 반대쪽 위)으로 더 벌려 표면에 얹히게
    const penF = (a, gg) => Math.max(...penetration(fingerPts('index', a, gg), CH.index.r, proxy, o, false));
    if (penF(pose.indexFrame, gu) > 0.001) {
      // 곧게 편 검지가 리시버 옆면을 뚫으면: 손허리손가락 관절 신전(최대 -0.4rad) + 벌림으로 옆면 위에 얹기
      let bb = null, bc = 1e9;
      for (let a1 = -0.4; a1 <= 0.3; a1 += 0.05) for (let dg = -0.1; dg <= 0.3; dg += 0.05) for (const a2 of [0, 0.1, 0.2]) {
        const a = [a1, a2, a2 * 0.5], p = penF(a, gu + dg), c = Math.max(0, p - 0.0008) * 40 + Math.abs(a1) * 0.02 + Math.abs(dg) * 0.02 + a2 * 0.01;
        if (c < bc) { bc = c; bb = [...a, gu + dg]; }
      }
      pose.indexFrame = bb;
    }
    USE_SURF.on = false;
    pose.index = pose.indexFrame;
  }
  // 최종 점검: 부호 거리로 여전히 뚫는 손가락은 펴서 표면에 얹힘
  if (proxy.surf) { const keep = pose.index; depenetrate(proxy, pose); if (pose.indexFrame) { pose.indexFrame = pose.index; } void keep; }
  return pose;
}

// 앵커 이름별 파지 해석 (총 모델 기준)
const _t = new THREE.Vector3(), _mi = new THREE.Matrix4();
export function gunPose(m, A, name, side, pistol) {
  let pose = null;
  try {
    if (name === 'grip') {
      let trig = null;
      if (m.parts.trigger) {
        m.group.updateMatrixWorld(true);
        _t.set(0, -0.015, -0.007).applyMatrix4(m.parts.trigger.matrixWorld).applyMatrix4(_mi.copy(A.matrixWorld).invert());
        trig = new THREE.Vector3(-_t.z, side === 'R' ? -_t.x : _t.x, _t.y);
      }
      pose = solveGrasp(proxyFromMesh(m.group, A, side, { rsel: 0.045 }), { trigger: trig, thumb: pistol ? { mode: 'fwd', side: 'far', zs: 0.045, z: 0.052, dx: 0.012 } : [{ mode: 'far', z: 0.052, dx: 0.012 }, { mode: 'far', z: 0.04, dx: 0 }, { mode: 'far', z: 0.03, dx: -0.01 }], spread: 0.2 });
    } else if (name === 'fore') {
      pose = pistol ? solveGrasp(proxyFromMesh(m.group, A, side, { rsel: 0.055, dil: 0.012 }), { thumb: { mode: 'fwd', side: 'near', zs: 0.045, z: 0.05, dx: 0.03 }, spread: 0.25 })
        : solveGrasp(proxyFromMesh(m.group, A, side, { rsel: 0.05 }), { thumb: [{ mode: 'along', z: 0.085, zs: 0.02 }, { mode: 'along', z: 0.065, zs: 0.02 }, { mode: 'far', z: 0.05, dx: 0 }], spread: 0.3 });
    } else if (name === 'mag' || name === 'slide' || name === 'cyl') {
      const r0 = name === 'mag' ? 0.06 : name === 'slide' ? 0.04 : 0.035, th = [{ mode: 'far', z: 0.035, dx: -0.01 }, { mode: 'far', z: 0.05, dx: -0.02 }, { mode: 'far', z: 0.025, dx: 0 }];
      for (const rs of [r0, r0 * 1.7, r0 * 2.4]) { pose = solveGrasp(proxyFromMesh(m.group, A, side, { rsel: rs }), { thumbOpp: 0.95, thumb: th, spread: 0.3 }); if (pose) break; }
    } else {
      // 프리셋 자세(장전손잡이 걸기·덮개 열기·탄 넣기)도 실제 표면 기준으로 관통 해소
      pose = preset(name === 'charge' || name === 'bolt' ? 'hook' : name === 'cover' ? 'open' : 'relaxed');
      depenetrate(proxyFromMesh(m.group, A, side, { rsel: 0.08 }), pose);
    }
  } catch (e) { console.warn('grasp', name, e); }
  if (!pose) { pose = preset('relaxed'); try { depenetrate(proxyFromMesh(m.group, A, side, { rsel: 0.08 }), pose); } catch (e) { /* 무시 */ } }
  return pose;
}

// 고정 자세 → 손바닥이 뚫으면 띄우고, 뚫는 손가락/엄지는 펴서 표면에 얹힘
function depenetrate(proxy, pose) {
  if (!proxy.surf) return pose;
  const { H, nx, nz } = palmMap(), o = pose.off;
  for (let k = 0; k < 20; k++) {
    let worst = 0;
    for (let ix = 0; ix < nx; ix += 2) for (let iz = 0; iz < nz; iz += 2) {
      const h = H[ix * nz + iz]; if (h < 0) continue;
      worst = Math.max(worst, -proxy.surf.sdist(-0.005 + (ix + 0.5) * 0.005 - o[0], h - 0.002 - o[1], -0.05 + (iz + 0.5) * 0.005 - o[2]));
    }
    if (worst < 0.001) break;
    o[1] += Math.min(0.004, worst);
  }
  const was = USE_SURF.on; USE_SURF.on = true;
  for (const f of FINGERS) for (let k = 0; k < 30 && Math.max(...penetration(fingerPts(f, pose[f], pose[f][3]), CH[f].r, proxy, o, false)) > 0.001; k++) for (let i = 0; i < 3; i++) pose[f][i] *= 0.9;
  for (let k = 0; k < 30 && Math.max(...penetration(thumbPts(pose.thumb), THUMB_R, proxy, o, false).slice(1)) > 0.001; k++) for (let i = 0; i < 4; i++) pose.thumb[i] *= 0.88;
  USE_SURF.on = was;
  return pose;
}

// 점검용: 손가락 자세의 실제 표면 관통 깊이(마디별)
export function fingerPenetration(proxy, off, f, a) {
  const was = USE_SURF.on; USE_SURF.on = true;
  const p = f === 'thumb' ? penetration(thumbPts(a), THUMB_R, proxy, off, false) : penetration(fingerPts(f, a, a[3]), CH[f].r, proxy, off, true);
  USE_SURF.on = was; return p;
}
