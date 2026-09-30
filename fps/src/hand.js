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
export function proxyFromMesh(root, anchorObj, side, { rsel = 0.05, dil = 0 } = {}) {
  root.updateMatrixWorld(true); anchorObj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(anchorObj.matrixWorld).invert(), M = new THREE.Matrix4(), v = V(0, 0, 0);
  const R = side === 'R';
  const tris = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.visible || o.material.transparent || o.material.isShaderMaterial) return;
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
      let near = false;
      for (const k of [a, b, c]) if (Math.hypot(loc[k * 3], loc[k * 3 + 1]) < rsel + 0.02 && loc[k * 3 + 2] > -0.07 && loc[k * 3 + 2] < 0.13) near = true;
      if (near) tris.push([loc[a * 3], loc[a * 3 + 1], loc[a * 3 + 2], loc[b * 3], loc[b * 3 + 1], loc[b * 3 + 2], loc[c * 3], loc[c * 3 + 1], loc[c * 3 + 2]]);
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
  return { slices };
}
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

// proxy 의 z=0 부근 단면으로 손바닥이 닿는 위치(off) 결정
function fitOffset(proxy, gx) {
  // 물체 앞면(손가락이 감아 도는 쪽)이 손허리손가락 관절선(x≈0.087)에 오도록
  let maxX = -1e9;
  for (const s of proxy.slices) if (s.poly && Math.abs(s.z) <= 0.021) for (const p of s.poly) maxX = Math.max(maxX, p[0]);
  if (maxX < -1e8) return null;
  const Gx = gx ?? THREE.MathUtils.clamp(0.087 - maxX, 0.035, 0.075);
  let minY = 1e9;
  for (const s of proxy.slices) if (s.poly && Math.abs(s.z) <= 0.031) {
    // 손바닥 영역(x 0.0~0.095)에 들어오는 다각형 부분의 최저 y (변 위 보간 포함)
    const P = s.poly;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      for (let k = 0; k <= 8; k++) { const x = a[0] + (b[0] - a[0]) * k / 8, y = a[1] + (b[1] - a[1]) * k / 8; if (x + Gx > 0.0 && x + Gx < 0.095) minY = Math.min(minY, y); }
    }
  }
  if (minY > 1e8) return null;
  return [Gx, PALM_Y - 0.0008 - minY, 0];
}

// z 에 가장 가까운 단면으로 부호거리
function sdProxy(proxy, off, x, y, z) {
  const zz = z - off[2], i = Math.round((zz - ZS[0]) / 0.01);
  if (i < 0 || i >= ZS.length || Math.abs(ZS[i] - zz) > 0.0075) return 1;
  const P = proxy.slices[i].poly;
  return P ? sdPoly(P, x - off[0], y - off[1]) : 1;
}

// 마디별 최대 관통 깊이
function penetration(pts, r, proxy, off, palm, out = [0, 0, 0]) {
  for (let i = 0; i < 3; i++) {
    let pen = 0;
    const A = pts[i], Bp = pts[i + 1];
    for (const t of [0.2, 0.45, 0.7, 0.95, 1.0]) {
      if (t === 1.0 && i < 2) continue;
      const qx = A.x + (Bp.x - A.x) * t, qy = A.y + (Bp.y - A.y) * t, qz = A.z + (Bp.z - A.z) * t, rr = r[i] + (r[i + 1] - r[i]) * t;
      if (proxy) pen = Math.max(pen, rr - sdProxy(proxy, off, qx, qy, qz));
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
function close(fk, r, maxA, proxy, off, { tol = 0.0008, palm = true, steps = 90, start } = {}) {
  const a = start ? start.slice() : [0, 0, 0], fz = [false, false, false];
  // 처음부터 겹쳐 있는 마디(방아쇠울 등)는 '더 깊어질 때' 만 충돌로 봄
  const base = penetration(fk(a), r, proxy, off, palm).map((x) => (x > tol ? x : 0));
  for (let it = 0; it < steps; it++) {
    const tr = a.map((x, i) => (fz[i] ? x : Math.min(maxA[i], x + maxA[i] / steps * 1.4)));
    const hit = collides(fk(tr), r, proxy, off, tol, palm, base);
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
    return V(mx + o[0] + (t.dx || 0), my + o[1] + rt * 0.9, t.z);
  }
  if (t.mode === 'fwd') {   // 엄지를 앞으로 곧게 (권총 thumbs-forward): 프레임 앞쪽, 지정한 면(near=손바닥쪽/far=반대쪽)
    const P = slicePoly(proxy, (t.zs ?? 0.045) - o[2]);
    if (!P) return null;
    let mx = -1e9, lo = 1e9, hi = -1e9; for (const [x, y] of P) { mx = Math.max(mx, x); lo = Math.min(lo, y); hi = Math.max(hi, y); }
    return V(mx + o[0] + (t.dx ?? 0.02), (t.side === 'near' ? lo - rt * 0.9 : hi + rt * 0.9) + o[1], t.z);
  }
  if (t.mode === 'along') {
    const P = slicePoly(proxy, (t.zs ?? 0.02) - o[2]);
    if (!P) return null;
    let mx = 1e9, cy = 0; for (const [x, y] of P) if (x < mx) { mx = x; } let n = 0; for (const [x, y] of P) if (x < mx + 0.006) { cy += y; n++; }
    return V(mx + o[0] - rt * 0.85, cy / n + o[1] + (t.dy || 0), t.z);
  }
  return null;
}
function thumbCost(t, T, proxy, o) {
  const pts = thumbPts(t), pen = penetration(pts, CH.thumb.r, proxy, o, false);   // 손허리뼈(0)는 물갈퀴가 등판을 감싸므로 제외
  return pts[3].distanceTo(T) + Math.max(0, pen[1] - 0.001) * 6 + Math.max(0, pen[2] - 0.001) * 6 + (t[0] * t[0] + t[4] * t[4]) * 0.002;
}
function thumbSearch(T, proxy, o) {
  // [opp, f1, f2, f3=0.8·f2, ab] 거친 격자 → 주변 세밀 탐색
  let best = null, bd = 1e9;
  for (let ab = -0.3; ab <= 1.21; ab += 0.15) for (let opp = -0.3; opp <= 1.5; opp += 0.15) for (let f1 = -0.3; f1 <= 0.9; f1 += 0.15) for (let f2 = 0; f2 <= 0.91; f2 += 0.3) {
    const t = [opp, f1, f2, f2 * 0.8, ab], c = thumbCost(t, T, proxy, o);
    if (c < bd) { bd = c; best = t; }
  }
  for (let pass = 0; pass < 2; pass++) {
    const st = pass ? 0.03 : 0.075, b0 = best.slice();
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
  const T = thumbTarget(proxy, o, thumb);
  if (T) pose.thumb = thumbSearch(T, proxy, o);
  else pose.thumb = [thumbOpp, ...close((a) => thumbPts([thumbOpp, ...a, 0]), CH.thumb.r, [0.95, 0.95, 1.1], proxy, o, { palm: false }), 0];
  // 검지: 방아쇠 / 프레임 위 곧게 (트리거 규율)
  if (trigger) {
    pose.indexFrame = pose.index.slice();
    const T = V(trigger.x + o[0], trigger.y + o[1], trigger.z + o[2]);
    const p0 = CH.index.pts[0], g = THREE.MathUtils.clamp(Math.atan2(T.z - p0.z, T.x - p0.x), -0.3, 0.45);
    const L = CH.index.len, r = CH.index.r;
    let best = null, bd = 1e9;
    for (let a1 = 0; a1 <= 1.4; a1 += 0.03) for (let a2 = 0; a2 <= 1.8; a2 += 0.03) {
      const a3 = a2 * 0.6, pts = fingerPts('index', [a1, a2, a3], g);
      const dir = pts[3].clone().sub(pts[2]).normalize(), nrm = V(-Math.sin(g), 0, Math.cos(g)).cross(dir).normalize();
      const pad = pts[2].clone().addScaledVector(dir, L[2] * 0.62).addScaledVector(nrm, r[2] * 0.9);
      const dd = pad.distanceTo(T) + (collides(pts, r, null, o, 0.001, true) >= 0 ? 0.05 : 0);
      if (dd < bd) { bd = dd; best = [a1, a2, a3, g]; }
    }
    pose.indexTrig = best;
    // 프레임을 따라 곧게: 살짝 위로 벌리고 옆면에 닿을 때까지만 굽힘
    const gu = HD.index.splay + indexUp;
    pose.indexFrame = [...close((a) => fingerPts('index', a, gu), CH.index.r, [0.55, 0.18, 0.1], proxy, o, { palm: false }), gu];
    pose.index = pose.indexFrame;
  }
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
        _t.set(0, -0.012, -0.003).applyMatrix4(m.parts.trigger.matrixWorld).applyMatrix4(_mi.copy(A.matrixWorld).invert());
        trig = new THREE.Vector3(-_t.z, side === 'R' ? -_t.x : _t.x, _t.y);
      }
      pose = solveGrasp(proxyFromMesh(m.group, A, side, { rsel: 0.045 }), { trigger: trig, thumb: pistol ? { mode: 'fwd', side: 'far', zs: 0.045, z: 0.052, dx: 0.012 } : { mode: 'far', z: 0.052, dx: 0.012 }, spread: 0.2 });
    } else if (name === 'fore') {
      pose = pistol ? solveGrasp(proxyFromMesh(m.group, A, side, { rsel: 0.055, dil: 0.012 }), { thumb: { mode: 'fwd', side: 'near', zs: 0.045, z: 0.05, dx: 0.03 }, spread: 0.25 })
        : solveGrasp(proxyFromMesh(m.group, A, side, { rsel: 0.05 }), { thumb: { mode: 'along', z: 0.085, zs: 0.02 }, spread: 0.3 });
    } else if (name === 'mag') pose = solveGrasp(proxyFromMesh(m.group, A, side, { rsel: 0.06 }), { thumbOpp: 0.95, spread: 0.3 });
    else if (name === 'slide') pose = solveGrasp(proxyFromMesh(m.group, A, side, { rsel: 0.04 }), { thumbOpp: 1.0, spread: 0.3 });
    else if (name === 'cyl') pose = solveGrasp(proxyFromMesh(m.group, A, side, { rsel: 0.035 }), { thumbOpp: 0.9, spread: 0.3 });
    else if (name === 'charge' || name === 'bolt') pose = preset('hook');
    else if (name === 'cover') pose = preset('open');
  } catch (e) { console.warn('grasp', name, e); }
  return pose || preset(name === 'port' ? 'relaxed' : 'relaxed');
}
