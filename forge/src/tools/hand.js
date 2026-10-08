// 사실적인 1인칭 손
//  · 형상: 해부 데이터(뼈 길이/관절 위치/굵기)로 부호거리장(SDF)을 조각 → Surface Nets 로 표면 추출 → 표면 투영
//  · 스키닝: 17개 뼈 (팔뚝, 손목, 손가락 4×3, 엄지 3), 표면 거리 기반 가중치
//  · 피부: 관절 주름, 손바닥 손금, 손가락 마디 주름, 지문, 손등 힘줄·혈관, 모공, 손톱 주변 큐티클,
//          피하 산란(SSS) 근사(빛 감쌈 + 붉은 투과광), 시편(sheen)
//  · 손톱(반투명 광택, 반달·자유연), 작업복 소매
//  · 애니메이션: 관절별 감쇠 스프링 + 손가락마다 다른 반응속도 + 미세한 떨림, 손잡이를 감싸는 IK
import * as THREE from 'three';

// ── 해부 데이터: 오른손, 손 로컬 좌표 (손등 +Y, 손가락 -Z, 엄지 -X), 단위 m ──
const FINGERS = [ // 검지 · 중지 · 약지 · 소지
  { base: [-0.0272, 0.0012, -0.0925], dir: [-0.19, 0.012, -1], seg: [0.041, 0.0245, 0.0205], r: [0.0088, 0.0081, 0.0074, 0.0065] },
  { base: [-0.0084, 0.0033, -0.0965], dir: [-0.05, 0.008, -1], seg: [0.0455, 0.0285, 0.0215], r: [0.0092, 0.0084, 0.0076, 0.0067] },
  { base: [0.0108, 0.0018, -0.093], dir: [0.1, 0.0, -1], seg: [0.0425, 0.027, 0.021], r: [0.0087, 0.008, 0.0073, 0.0064] },
  { base: [0.0287, -0.0028, -0.0858], dir: [0.27, -0.015, -1], seg: [0.0335, 0.0205, 0.0185], r: [0.0076, 0.007, 0.0064, 0.0057] },
];
const THUMB = { base: [-0.0205, -0.0105, -0.025], dir: [-0.58, -0.22, -0.78], seg: [0.044, 0.0325, 0.0265], r: [0.0132, 0.0112, 0.0099, 0.0086] };
const WRIST = new THREE.Vector3(0, -0.003, 0), FOREARM = new THREE.Vector3(0, -0.003, 0.04);
const NAIL_START = 0.36; // 원위 마디에서 손톱 뿌리 위치 (비율)

// 손가락 사슬 데이터 (관절 위치, 방향, 손등/측면 축, 굽힘 축)
function chains() {
  const out = [];
  const mk = (d, isThumb) => {
    const dir = new THREE.Vector3(...d.dir).normalize();
    const J = [new THREE.Vector3(...d.base)];
    for (let k = 0; k < 3; k++) J.push(J[k].clone().addScaledVector(dir, d.seg[k]));
    const dors = (isThumb ? new THREE.Vector3(-0.62, 0.78, 0) : new THREE.Vector3(0, 1, 0)).addScaledVector(dir, 0);
    dors.addScaledVector(dir, -dors.dot(dir)).normalize();
    const side = new THREE.Vector3().crossVectors(dors, dir).normalize(); // 손가락 기준 측면
    const S = [0, d.seg[0], d.seg[0] + d.seg[1], d.seg[0] + d.seg[1] + d.seg[2]];
    const bend = dors.clone().negate(); // 굽힘 방향 = 손바닥 쪽
    const flex = new THREE.Vector3().crossVectors(dir, bend).normalize();
    // 엄지: 손바닥 가로질러 소지 쪽으로 (대립)
    const opp = isThumb ? new THREE.Vector3(0.8, -0.45, 0.15).addScaledVector(dir, -new THREE.Vector3(0.8, -0.45, 0.15).dot(dir)).normalize() : null;
    const oppAxis = isThumb ? new THREE.Vector3().crossVectors(dir, opp).normalize() : null;
    out.push({ J, dir, dors, side, S, L: d.seg, r: d.r, flex, oppAxis, thumb: isThumb });
  };
  FINGERS.forEach((d) => mk(d, false));
  mk(THUMB, true);
  return out;
}
export const CH = chains(); // 0..3 손가락, 4 엄지

// ── SDF 기본형 ──
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
function cone(x, y, z, a, b, r1, r2) {
  const bx = b.x - a.x, by = b.y - a.y, bz = b.z - a.z, px = x - a.x, py = y - a.y, pz = z - a.z;
  let t = (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz); t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - bx * t, dy = py - by * t, dz = pz - bz * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - (r1 + (r2 - r1) * t);
}
function ell(x, y, z, cx, cy, cz, rx, ry, rz) {
  const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
  const k0 = Math.sqrt(px * px + py * py + pz * pz), k1 = Math.sqrt((px / rx) ** 2 + (py / ry) ** 2 + (pz / rz) ** 2);
  return k1 < 1e-9 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}
function rbox(x, y, z, cx, cy, cz, hx, hy, hz, r) {
  const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy, qz = Math.abs(z - cz) - hz;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
const sph = (x, y, z, c, r) => { const dx = x - c.x, dy = y - c.y, dz = z - c.z; return Math.sqrt(dx * dx + dy * dy + dz * dz) - r; }; // Math.hypot 은 느림

// 손바닥 (가로 아치 포함)
function palmBody(x, y, z) {
  const t = Math.min(1, Math.max(0, (-z - 0.012) / 0.07)), ts = t * t * (3 - 2 * t);
  const hx = 0.0262 + 0.0093 * ts, hy = 0.0052 + 0.0012 * Math.sin(t * Math.PI);
  const ya = y + 3.2 * x * x - 0.0016 * Math.sin(t * Math.PI); // 손등 돔 + 가로 아치
  return rbox(x, ya, z, 0.0012 + 0.0016 * ts, -0.003, -0.0545, hx, hy, 0.0395, 0.0088);
}
function palmSDF(x, y, z) {
  let d = palmBody(x, y, z);
  d = smin(d, ell(x, y, z, -0.0245, -0.0125, -0.041, 0.0175, 0.0108, 0.027), 0.011); // 무지구(엄지 두덩)
  d = smin(d, ell(x, y, z, 0.0305, -0.0105, -0.05, 0.0108, 0.0084, 0.031), 0.009); // 소지구
  d = smin(d, ell(x, y, z, 0.002, -0.0118, -0.088, 0.034, 0.0072, 0.0105), 0.009); // 손가락 밑 지간 패드
  d = smin(d, ell(x, y, z, 0.004, -0.0108, -0.062, 0.024, 0.006, 0.02), 0.01); // 손바닥 중앙 살
  // 팔뚝·손목 (타원 단면, 손목이 가장 가늘다)
  const zz = Math.max(z, 0), rx = 0.0265 + 0.05 * zz, ry = 0.0178 + 0.034 * zz;
  const qx = x / rx, qy = (y + 0.003) / ry, tube = (Math.sqrt(qx * qx + qy * qy) - 1) * Math.min(rx, ry);
  d = smin(d, Math.max(tube, -0.014 - z), 0.02);
  return d;
}
// 손바닥 몸통만 (가중치용, 팔뚝 제외)
function palmCore(x, y, z) {
  return Math.min(palmBody(x, y, z),
    ell(x, y, z, -0.0245, -0.0125, -0.041, 0.0175, 0.0108, 0.027), ell(x, y, z, 0.0305, -0.0105, -0.05, 0.0108, 0.0084, 0.031));
}
// 손가락 1개
function fingerSDF(x, y, z, c, i) {
  const J = c.J, r = c.r;
  let d = cone(x, y, z, J[0], J[1], r[0], r[1]);
  d = smin(d, cone(x, y, z, J[1], J[2], r[1], r[2]), 0.003);
  d = smin(d, cone(x, y, z, J[2], J[3], r[2], r[3]), 0.0025);
  d = smin(d, sph(x, y, z, J[1], r[1] * 1.06), 0.003); // 관절 볼록
  d = smin(d, sph(x, y, z, J[2], r[2] * 1.04), 0.0025);
  for (let k = 0; k < 2; k++) d = smin(d, cone(x, y, z, c.pads[k][0], c.pads[k][1], r[k] * 0.78, r[k + 1] * 0.78), 0.004); // 지골 손바닥쪽 살
  // 손끝 패드 (손바닥 쪽 볼록)
  const pc = c.pad;
  const px = x - pc.x, py = y - pc.y, pz = z - pc.z;
  const u = px * c.side.x + py * c.side.y + pz * c.side.z, v = px * c.dors.x + py * c.dors.y + pz * c.dors.z, w = px * c.dir.x + py * c.dir.y + pz * c.dir.z;
  const rr = r[3];
  const a0 = u / (rr * 0.98), b0 = v / (rr * 0.82), c0 = w / 0.0105, a1 = u / (rr * rr * 0.96), b1 = v / (rr * rr * 0.67), c1 = w / 0.00011;
  const k0 = Math.sqrt(a0 * a0 + b0 * b0 + c0 * c0), k1 = Math.sqrt(a1 * a1 + b1 * b1 + c1 * c1);
  d = smin(d, (k0 * (k0 - 1)) / k1, 0.002);
  return d;
}
for (const c of CH) {
  c.pad = c.J[3].clone().addScaledVector(c.dir, -0.0088).addScaledVector(c.dors, -c.r[3] * 0.28);
  c.pads = [0, 1].map((k) => [c.J[k].clone().lerp(c.J[k + 1], 0.22).addScaledVector(c.dors, -c.r[k] * 0.3), c.J[k].clone().lerp(c.J[k + 1], 0.78).addScaledVector(c.dors, -c.r[k] * 0.3)]);
}
// 손가락별 경계 상자 (멀리 있으면 상자 거리로 대체 → 빠름)
for (const c of CH) {
  const mn = new THREE.Vector3(1, 1, 1), mx = new THREE.Vector3(-1, -1, -1);
  for (const j of c.J) { mn.min(j); mx.max(j); }
  c.bmin = mn.subScalar(c.r[0] + 0.004); c.bmax = mx.addScalar(c.r[0] + 0.004);
}
const boxDist = (x, y, z, mn, mx) => {
  const dx = mn.x - x > 0 ? mn.x - x : x - mx.x > 0 ? x - mx.x : 0, dy = mn.y - y > 0 ? mn.y - y : y - mx.y > 0 ? y - mx.y : 0, dz = mn.z - z > 0 ? mn.z - z : z - mx.z > 0 ? z - mx.z : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};
const KN = CH.slice(0, 4).map((c) => c.J[0].clone().add(new THREE.Vector3(0, 0.0022, 0.0015)));
const MC0 = CH.slice(0, 4).map((c) => new THREE.Vector3(c.J[0].x * 0.5, 0.0025, -0.028));

export function handSDF(x, y, z) {
  let d = palmSDF(x, y, z);
  for (let i = 0; i < 4; i++) { // 손등 중수골 능선 + 너클
    d = smin(d, cone(x, y, z, MC0[i], KN[i], 0.0058, 0.0072), 0.009);
    d = smin(d, sph(x, y, z, KN[i], CH[i].r[0] * 1.02), 0.005);
  }
  // 경계 상자 거리가 결과에 영향을 줄 수 없을 때만 생략 (정확한 조기 종료 → 이음새 없음)
  let f = 1;
  for (let i = 0; i < 4; i++) {
    const c = CH[i], b = boxDist(x, y, z, c.bmin, c.bmax);
    if (b < Math.min(f, d + 0.0072)) f = Math.min(f, fingerSDF(x, y, z, c, i));
  }
  if (f < d + 0.0072) d = smin(d, f, 0.0072); // 손가락 사이 물갈퀴
  const t = CH[4], bt = boxDist(x, y, z, t.bmin, t.bmax);
  if (bt < d + 0.013) d = smin(d, fingerSDF(x, y, z, t, 4), 0.013); // 엄지-검지 사이 넓은 물갈퀴
  return d;
}

// ── 표면 추출 (좁은 대역 + Surface Nets + 표면 투영) ──
function extract(h) {
  const B0 = [-0.1, -0.052, -0.218], B1 = [0.07, 0.032, 0.05];
  const nx = Math.ceil((B1[0] - B0[0]) / h) + 1, ny = Math.ceil((B1[1] - B0[1]) / h) + 1, nz = Math.ceil((B1[2] - B0[2]) / h) + 1;
  const N = nx * ny * nz, val = new Float32Array(N), id = (i, j, k) => i + nx * (j + ny * k);
  const C = 4, cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++)
    coarse[i + cx * (j + cy * k)] = handSDF(B0[0] + i * C * h, B0[1] + j * C * h, B0[2] + k * C * h);
  const band = C * h * 1.9;
  for (let K = 0; K < cz - 1; K++) for (let J = 0; J < cy - 1; J++) for (let I = 0; I < cx - 1; I++) {
    let near = false, any = 0;
    for (let c = 0; c < 8; c++) { const v = coarse[(I + (c & 1)) + cx * ((J + ((c >> 1) & 1)) + cy * (K + (c >> 2)))]; if (Math.abs(v) < band) near = true; any = v; }
    for (let k = K * C; k <= Math.min(K * C + C, nz - 1); k++) for (let j = J * C; j <= Math.min(J * C + C, ny - 1); j++) for (let i = I * C; i <= Math.min(I * C + C, nx - 1); i++)
      val[id(i, j, k)] = near ? handSDF(B0[0] + i * h, B0[1] + j * h, B0[2] + k * h) : any;
  }
  // Surface Nets: 셀마다 꼭짓점 1개
  const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1), cid = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k);
  const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { cv[c] = val[id(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2))]; if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of E) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t; sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t; sz += (a >> 2) + ((b >> 2) - (a >> 2)) * t; n++;
    }
    cellV[cid(i, j, k)] = pos.length / 3;
    pos.push(B0[0] + (i + sx / n) * h, B0[1] + (j + sy / n) * h, B0[2] + (k + sz / n) * h);
  }
  const idx = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[id(i, j, k)] < 0;
    if (v0 !== (val[id(i + 1, j, k)] < 0)) quad(cellV[cid(i, j - 1, k - 1)], cellV[cid(i, j, k - 1)], cellV[cid(i, j, k)], cellV[cid(i, j - 1, k)], !v0);
    if (v0 !== (val[id(i, j + 1, k)] < 0)) quad(cellV[cid(i - 1, j, k - 1)], cellV[cid(i - 1, j, k)], cellV[cid(i, j, k)], cellV[cid(i, j, k - 1)], !v0);
    if (v0 !== (val[id(i, j, k + 1)] < 0)) quad(cellV[cid(i - 1, j - 1, k)], cellV[cid(i, j - 1, k)], cellV[cid(i, j, k)], cellV[cid(i - 1, j, k)], !v0);
  }
  // 표면 투영 + 법선 (SDF 기울기)
  const e = 0.00015, P = new Float32Array(pos), Nrm = new Float32Array(pos.length);
  for (let v = 0; v < P.length; v += 3) {
    let x = P[v], y = P[v + 1], z = P[v + 2], gx = 0, gy = 0, gz = 0;
    for (let it = 0; it < 2; it++) {
      const d = handSDF(x, y, z);
      gx = handSDF(x + e, y, z) - handSDF(x - e, y, z); gy = handSDF(x, y + e, z) - handSDF(x, y - e, z); gz = handSDF(x, y, z + e) - handSDF(x, y, z - e);
      const g = Math.hypot(gx, gy, gz) / (2 * e) || 1, s = Math.max(-0.6 * h, Math.min(0.6 * h, d / g)); // 다른 면으로 건너뛰지 않게
      gx /= 2 * e * g; gy /= 2 * e * g; gz /= 2 * e * g;
      x -= gx * s; y -= gy * s; z -= gz * s;
    }
    P[v] = x; P[v + 1] = y; P[v + 2] = z; Nrm[v] = gx; Nrm[v + 1] = gy; Nrm[v + 2] = gz;
  }
  // 면 방향이 법선과 반대면 뒤집기
  let dsum = 0;
  for (let t = 0; t < idx.length; t += 3 * 50) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    dsum += (uy * vz - uz * vy) * Nrm[a] + (uz * vx - ux * vz) * Nrm[a + 1] + (ux * vy - uy * vx) * Nrm[a + 2];
  }
  if (dsum < 0) for (let t = 0; t < idx.length; t += 3) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
  return { P, Nrm, idx };
}

// ── 스키닝 가중치 + 피부 셰이더용 속성 ──
// 뼈: 0 팔뚝, 1 손목(손바닥), 2-4 검지, 5-7 중지, 8-10 약지, 11-13 소지, 14-16 엄지
export const BONE = { root: 0, wrist: 1, finger: (f, k) => 2 + f * 3 + k, thumb: (k) => 14 + k };
function attributes(P, Nrm) {
  const n = P.length / 3;
  const sIdx = new Uint16Array(n * 4), sW = new Float32Array(n * 4), h1 = new Float32Array(n * 4), h2 = new Float32Array(n * 4), fd = new Float32Array(n * 3), fs = new Float32Array(n * 3), ao = new Float32Array(n);
  const segs = []; // [bone, a, b, r1, r2, chain, k]
  CH.forEach((c, ci) => { for (let k = 0; k < 3; k++) segs.push([ci < 4 ? BONE.finger(ci, k) : BONE.thumb(k), c.J[k], c.J[k + 1], c.r[k], c.r[k + 1], ci, k]); });
  const fa = WRIST.clone().setZ(0.004), fb = WRIST.clone().setZ(0.12);
  const thin = [0.05, 0.25, 1, 1, 1.2, 1, 1, 1.2, 1, 1, 1.2, 1, 1, 1.2, 0.55, 0.85, 1.05];
  const regOf = (b) => (b === 0 ? 3 : b === 1 || b === 14 ? 2 : b >= 15 ? 1 : 0);
  const w = new Float32Array(17), p = new THREE.Vector3(), nn = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let v = 0; v < n; v++) {
    p.set(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); nn.set(Nrm[v * 3], Nrm[v * 3 + 1], Nrm[v * 3 + 2]);
    // 앰비언트 오클루전 (SDF 법선 방향 표본): 손가락 사이 · 주름 · 엄지 물갈퀴가 자연스럽게 어두워짐
    let occ = 0;
    for (let k = 0; k < 3; k++) { const d = [0.003, 0.0065, 0.011][k], sd = handSDF(p.x + nn.x * d, p.y + nn.y * d, p.z + nn.z * d); occ += Math.max(0, d - sd) * [1, 0.6, 0.35][k]; }
    ao[v] = Math.max(0.15, Math.min(1, 1 - occ * 55));
    const dArm = Math.max(0, cone(p.x, p.y, p.z, fa, fb, 0.024, 0.03));
    const dPalm = Math.max(0, palmCore(p.x, p.y, p.z));
    w.fill(0);
    w[0] = 1 / (dArm + 0.0016) ** 3;
    w[1] = 1 / (dPalm + 0.0016) ** 3 * (p.z > 0.012 ? 0.2 : 1);
    let best = null, bd = 1e9;
    for (const s of segs) {
      const [b, a, e, r1, r2, ci, k] = s;
      const d = Math.max(0, cone(p.x, p.y, p.z, a, e, r1, r2));
      const ww = 1 / (d + 0.0016) ** 3; if (ww > w[b]) w[b] = ww;
    }
    // 상위 4개
    const order = [...w.keys()].sort((a, b) => w[b] - w[a]).slice(0, 4);
    let sum = 0; for (const b of order) sum += w[b];
    let th = 0;
    order.forEach((b, i) => { sIdx[v * 4 + i] = b; sW[v * 4 + i] = w[b] / sum; th += thin[b] * w[b] / sum; });
    const top = order[0], reg = regOf(top);
    // 가장 가까운 손가락 사슬 (손바닥이면 축을 뒤로 연장한 손가락)
    let ci = -1;
    if (top >= 2 && top <= 13) ci = Math.floor((top - 2) / 3); else if (top >= 14) ci = 4;
    if (ci < 0) { let m = 1e9; for (let c = 0; c < 4; c++) { const ch = CH[c]; tmp.copy(p).sub(ch.J[0]); const along = tmp.dot(ch.dir); const d = tmp.addScaledVector(ch.dir, -along).length(); if (d < m) { m = d; ci = c; } } }
    const c = CH[ci];
    // 사슬 위 호길이 s
    let s = 0, sd = 1e9, segk = 0;
    for (let k = 0; k < 3; k++) {
      tmp.copy(p).sub(c.J[k]); const t = tmp.dot(c.dir); const tc = k === 0 ? Math.min(t, c.L[0]) : k === 2 ? Math.max(t, 0) : Math.max(0, Math.min(t, c.L[k]));
      const d = tmp.addScaledVector(c.dir, -tc).length(); if (d < sd) { sd = d; s = c.S[k] + tc; segk = k; }
    }
    let jt = 0, aj = 1e9; for (let k = 0; k < 4; k++) if (Math.abs(s - c.S[k]) < Math.abs(aj)) { aj = s - c.S[k]; jt = k; }
    const axis = c.J[0].clone().addScaledVector(c.dir, s);
    const lat = tmp.copy(p).sub(axis).dot(c.side);
    const nail = segk === 2 && (reg === 0 || reg === 1) ? s - (c.S[2] + NAIL_START * c.L[2]) : 1;
    const dors = reg >= 2 ? nn.y : nn.dot(c.dors);
    h1.set([aj, jt, lat, nail], v * 4); h2.set([dors, th, reg, ci], v * 4);
    fd.set([c.dir.x, c.dir.y, c.dir.z], v * 3); fs.set([c.side.x, c.side.y, c.side.z], v * 3);
  }
  return { sIdx, sW, h1, h2, fd, fs, ao };
}

// ── 손톱 ──
function nailGeo(c) {
  const NU = 10, NV = 12, w = c.r[3] * (c.thumb ? 0.8 : 0.74), sB = c.S[2] + NAIL_START * c.L[2], sT = c.S[3] + 0.0014;
  const pos = [], col = [], idx = [], uv = [];
  const surf = (lat, s) => { // 손등 쪽에서 아래로 쏘아 피부 표면 찾기
    const a = c.J[0].clone().addScaledVector(c.dir, Math.min(s, c.S[3] - 0.0012)).addScaledVector(c.side, lat);
    let lo = 0, hi = 0.02;
    for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2, q = a.clone().addScaledVector(c.dors, m); if (handSDF(q.x, q.y, q.z) < 0) lo = m; else hi = m; }
    const q = a.addScaledVector(c.dors, lo);
    if (s > c.S[3] - 0.0012) q.addScaledVector(c.dir, s - (c.S[3] - 0.0012)); // 자유연은 수평으로 연장
    return q;
  };
  for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
    const u = (i / NU) * 2 - 1, v = j / NV;
    const lat = u * w * (0.76 + 0.24 * Math.sin(Math.min(1, v * 1.8) * Math.PI / 2));
    const base = sB + 0.0024 * u * u, tip = sT - 0.0026 * u * u;
    const s = base + (tip - base) * v;
    const q = surf(lat, s).addScaledVector(c.dors, 0.00034 + 0.00014 * (1 - u * u));
    pos.push(q.x, q.y, q.z); uv.push(u, v);
    const free = s > c.S[3] - 0.0005 ? 1 : 0, lunula = Math.max(0, 1 - v / 0.2) * (1 - u * u * 0.6);
    const pink = [0.55, 0.32, 0.28], white = [0.8, 0.72, 0.64];
    const t = Math.max(free * 0.85, lunula * 0.3);
    col.push(pink[0] + (white[0] - pink[0]) * t, pink[1] + (white[1] - pink[1]) * t, pink[2] + (white[2] - pink[2]) * t);
  }
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i; idx.push(a, a + NU + 1, a + 1, a + 1, a + NU + 1, a + NU + 2); }
  // 자유연 두께 (앞쪽 띠)
  const top = NV * (NU + 1), n0 = pos.length / 3;
  for (let i = 0; i <= NU; i++) { const k = (top + i) * 3; pos.push(pos[k] - c.dors.x * 0.0005, pos[k + 1] - c.dors.y * 0.0005, pos[k + 2] - c.dors.z * 0.0005); uv.push(0, 1); col.push(0.93, 0.88, 0.8); }
  for (let i = 0; i < NU; i++) idx.push(top + i, top + i + 1, n0 + i, top + i + 1, n0 + i + 1, n0 + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // 법선이 손등 방향을 향하도록
  const nrm = g.attributes.normal; let dot = 0; for (let i = 0; i < nrm.count; i++) dot += nrm.getX(i) * c.dors.x + nrm.getY(i) * c.dors.y + nrm.getZ(i) * c.dors.z;
  if (dot < 0) { g.index.array.reverse(); g.computeVertexNormals(); }
  g.translate(-c.J[2].x, -c.J[2].y, -c.J[2].z); // 원위 마디 뼈 기준
  return g;
}

// ── 소매 (작업복) ──
function sleeveGeo() {
  const NA = 56, NZ = 30, z0 = 0.026, z1 = 0.24, pos = [], uv = [], idx = [];
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NA; i++) {
    const t = j / NZ, z = z0 + (z1 - z0) * t * t, a = (i / NA) * Math.PI * 2;
    const cuff = z < 0.056 ? 1 : 0;
    let rx = 0.0345 + 0.075 * Math.max(0, z - 0.06), ry = 0.0275 + 0.06 * Math.max(0, z - 0.06);
    let disp = cuff ? 0.0006 * Math.sin(a * 64) : 0.0024 * Math.sin(a * 5 + z * 55) * Math.sin(z * 38 + a * 2) + 0.0015 * Math.sin(a * 11 - z * 90);
    if (Math.abs(z - 0.056) < 0.004) disp += 0.0015; // 소맷부리 솔기
    pos.push(Math.cos(a) * (rx + disp), Math.sin(a) * (ry + disp) - 0.003, z);
    uv.push((i / NA) * 0.42, z);
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i; idx.push(a, a + 1, a + NA + 1, a + 1, a + NA + 2, a + NA + 1); }
  // 소맷부리 안쪽 단면 (두께)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.translate(-FOREARM.x, -FOREARM.y, -FOREARM.z);
  return g;
}

// ── 피부 셰이더 ──
const SKIN_GLSL = /* glsl */ `
varying vec3 vRest; varying vec3 vRN; varying vec4 vH1; varying vec4 vH2; varying vec3 vFD; varying vec3 vFS; varying float vAO;
varying vec3 vS0; varying vec3 vS1; varying vec3 vS2;
float hh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hh(i), hh(i + vec3(1,0,0)), f.x), mix(hh(i + vec3(0,1,0)), hh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hh(i + vec3(0,0,1)), hh(i + vec3(1,0,1)), f.x), mix(hh(i + vec3(0,1,1)), hh(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float lineG(float d, float w) { return exp(-d * d / (w * w)); }
float lines(float a, float sp, float w) { float u = a / sp; float d = (u - floor(u + 0.5)) * sp; return exp(-d * d / (w * w)); }
float bez(vec2 p, vec2 a, vec2 b, vec2 c) { // 2차 베지어까지 거리 (표본)
  float m = 1.0; vec2 q0 = a;
  for (int i = 1; i <= 12; i++) { float t = float(i) / 12.0; vec2 q1 = mix(mix(a, b, t), mix(b, c, t), t); vec2 e = q1 - q0; float h = clamp(dot(p - q0, e) / dot(e, e), 0.0, 1.0); m = min(m, length(p - q0 - e * h)); q0 = q1; }
  return m;
}
// 높이장 (m). aj: 가까운 관절까지 축방향 거리, lat: 측면 좌표, nl: 손톱 뿌리 기준 거리
float skinH(vec3 p, float aj, float lat, float nl, inout vec4 info) {
  float jt = floor(vH1.y + 0.5), dors = vH2.x, reg = vH2.z;
  float wF = clamp(1.5 - reg, 0.0, 1.0), wP = 1.0 - clamp(abs(reg - 2.0), 0.0, 1.0), wA = clamp(reg - 2.0, 0.0, 1.0);
  float dm = smoothstep(0.05, 0.55, dors), pm = smoothstep(0.0, 0.5, -dors);
  float h = 0.0, cr = 0.0, vein = 0.0, red = 0.0;
  float wob = (vn(p * 900.0) - 0.5) * 0.00045;
  float a = aj + 22.0 * lat * lat + wob;
  bool thumb = vH2.w > 3.5;
  // ── 손등 쪽 관절 주름 (불규칙 간격 · 끊김 · 호 모양, 손등 쪽에만)
  float envW = jt < 0.5 ? 0.0044 : jt < 1.5 ? 0.0042 : jt < 2.5 ? 0.0028 : 0.0;
  if (envW > 0.0) {
    float latM = 1.0 - smoothstep(0.0038, 0.0068, abs(lat));
    float env = lineG(a, envW) * dm * latM * (wF + (jt < 0.5 ? wP : 0.0));
    float sp = jt < 0.5 ? 0.0017 : jt < 1.5 ? 0.0013 : 0.0011;
    float aw = a + (vn(vec3(lat * 700.0, a * 300.0, 5.3)) - 0.5) * 0.0007;
    float li = floor(aw / sp + 0.5), lr = hh(vec3(li, jt, vH2.w));
    float brk = smoothstep(0.25, 0.6, vn(vec3(lat * 1500.0 + li * 7.0, li, 1.7)));
    float fine = lines(aw, sp, 0.00016 + lr * 0.00008) * brk * (0.45 + lr * 0.75);
    float fold = jt > 0.5 && jt < 1.5 ? lines(a + 0.0005, 0.0034, 0.0008) * lineG(a, 0.003) : 0.0;
    h -= env * (fine * (jt > 0.5 && jt < 1.5 ? 0.00013 : 0.00009) + fold * 0.00016);
    cr += env * fine * 0.55; red += env * 0.22;
  }
  // ── 손바닥 쪽 굽힘 주름
  float latF = 1.0 - smoothstep(0.004, 0.0085, abs(lat));
  if (pm > 0.0) {
    float c = 0.0;
    if (jt > 1.5 && jt < 2.5) c = lineG(aj + 0.0004, 0.00034);
    else if (jt > 0.5 && jt < 1.5) c = lineG(aj + 0.0012, 0.0003) + lineG(aj - 0.0005, 0.00028) * 0.8;
    else if (jt < 0.5) c = thumb ? 0.0 : lineG(aj - 0.0168 + wob, 0.0004) + lineG(aj - 0.0145 + wob, 0.0003) * 0.5;
    if (thumb && jt > 0.5 && jt < 1.5) c = lineG(aj + 0.0006, 0.00035) + lineG(aj - 0.001, 0.0003) * 0.7;
    c *= pm * latF * (wF + wP * 0.8);
    h -= c * 0.00032; cr += c;
  }
  // ── 손금 (손바닥)
  if (wP * pm > 0.0) {
    vec2 q = p.xz + vec2(vn(p * 300.0), vn(p * 300.0 + 7.0)) * 0.0012;
    float heart = bez(q, vec2(0.046, -0.071), vec2(0.012, -0.086), vec2(-0.019, -0.094));
    float head = bez(q, vec2(-0.038, -0.077), vec2(-0.004, -0.066), vec2(0.035, -0.057));
    float life = bez(q, vec2(-0.036, -0.077), vec2(-0.004, -0.05), vec2(-0.01, -0.011));
    float wrist = min(abs(p.z + 0.004 + 600.0 * p.x * p.x * 0.0), abs(p.z - 0.004));
    float var = 0.55 + 0.45 * vn(p * 160.0), var2 = 0.6 + 0.4 * vn(p * 160.0 + 11.0);
    float c = lineG(heart, 0.00035 + 0.0003 * var) * var + lineG(head, 0.00032 + 0.00028 * var2) * var2 + lineG(life, 0.0004 + 0.0003 * var) * 1.1 + lineG(wrist, 0.00035) * 0.7;
    float minor = pow(1.0 - abs(vn(vec3(p.x * 420.0, 0.0, p.z * 330.0)) * 2.0 - 1.0), 9.0);
    c = c * wP * pm;
    h -= c * 0.00055 + minor * wP * pm * 0.00007; cr += c + minor * wP * pm * 0.25;
  }
  // ── 손등: 힘줄 + 혈관 + 피부결
  float back = dm * (wP + wA * 0.8);
  if (back > 0.0) {
    float tend = 0.0;
    vec2 pa = p.xz;
    ${CH.slice(0, 4).map((c, i) => `{ vec2 A = vec2(${(c.J[0].x * 0.42).toFixed(4)}, -0.012); vec2 Bp = vec2(${c.J[0].x.toFixed(4)}, ${(c.J[0].z + 0.006).toFixed(4)}); vec2 e = Bp - A; float t = clamp(dot(pa - A, e) / dot(e, e), 0.0, 1.0); tend += lineG(length(pa - A - e * t), 0.0027) * smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.75, 1.0, t)); }`).join('\n    ')}
    vec2 vq = p.xz + vec2(vn(p * 220.0), vn(p * 220.0 + 9.0)) * 0.0016;
    float vd = min(min(bez(vq, vec2(-0.019, -0.078), vec2(-0.012, -0.045), vec2(-0.011, -0.006)),
                       bez(vq, vec2(0.006, -0.082), vec2(0.014, -0.05), vec2(0.004, -0.012))),
                   min(bez(vq, vec2(0.025, -0.075), vec2(0.022, -0.046), vec2(0.008, -0.024)),
                       bez(vq, vec2(-0.022, -0.033), vec2(0.0, -0.019), vec2(0.024, -0.036))));
    float vfade = 0.55 + 0.45 * vn(p * 120.0);
    vein = lineG(vd, 0.0017) * back * vfade;
    h += tend * back * 0.0002 + vein * 0.00038;
    float hatch = lines(dot(p.xz, vec2(0.82, 0.57)) + wob * 0.4, 0.0009, 0.00008) * vn(p * 500.0) + lines(dot(p.xz, vec2(-0.82, 0.57)) + wob * 0.4, 0.0011, 0.00008) * vn(p * 500.0 + 4.0);
    h -= hatch * back * 0.000022;
  }
  // ── 손톱 큐티클 (손톱 뿌리 주름)
  float nailW = ${(CH[1].r[3] * 0.8).toFixed(4)};
  if (nl < 0.5) {
    float cu = nl + 40.0 * lat * lat;
    float m = dm * (1.0 - smoothstep(nailW * 0.85, nailW * 1.25, abs(lat)));
    h -= lineG(cu + 0.0003, 0.00028) * m * 0.00022; h += lineG(cu + 0.0012, 0.0008) * m * 0.0001;
    cr += lineG(cu + 0.0003, 0.0003) * m * 0.7; red += lineG(cu + 0.0012, 0.0016) * m * 0.5;
  }
#if HAND_DETAIL > 1
  // ── 지문 (손끝 패드)
  if (jt > 2.5 && pm > 0.0) {
    vec2 fq = vec2(lat * 1.05, (aj + 0.0085) * 0.8);
    float r = length(fq) + vn(vec3(fq * 1800.0, 1.0)) * 0.00025;
    h += sin(r * 6.2831 / 0.00047) * 0.000012 * pm;
  }
  // ── 모공 · 미세 요철
  float pore = smoothstep(0.62, 0.8, vn(p * 2600.0));
  h -= pore * 0.000014 * (1.0 - wP * pm * 0.6);
  h += (vn(p * 700.0) - 0.5) * 0.00002;
#endif
  info = vec4(cr, vein, red, wF);
  return h;
}
`;

function skinMaterial(detail) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.5, metalness: 0, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.9, 0.62, 0.52),
    specularIntensity: 0.55, specularColor: new THREE.Color(1, 0.97, 0.95), envMapIntensity: 0.55,
  });
  m.defines = { HAND_DETAIL: detail };
  m.customProgramCacheKey = () => 'forge-skin-' + detail;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aH1; attribute vec4 aH2; attribute vec3 aFD; attribute vec3 aFS; attribute float aAO; varying float vAO;
varying vec3 vRest; varying vec3 vRN; varying vec4 vH1; varying vec4 vH2; varying vec3 vFD; varying vec3 vFS; varying vec3 vS0; varying vec3 vS1; varying vec3 vS2;`)
      .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
  mat3 skr = mat3(modelViewMatrix) * mat3(skinMatrix);
  vS0 = skr[0]; vS1 = skr[1]; vS2 = skr[2];
  vRest = position; vRN = normal; vH1 = aH1; vH2 = aH2; vFD = aFD; vFS = aFS; vAO = aAO;`);
    let f = sh.fragmentShader;
    f = f.replace('#include <common>', '#include <common>\n' + SKIN_GLSL);
    // 피하 산란 근사: 빛 감쌈(빨강이 더 깊이 퍼짐) + 얇은 부위 붉은 투과광
    const lp = THREE.ShaderChunk.lights_physical_pars_fragment
      .replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', `
	float wNL = dot( geometryNormal, directLight.direction );
	vec3 wrapNL = clamp( ( vec3( wNL ) + vec3( 0.26, 0.12, 0.08 ) ) / vec3( 1.26, 1.12, 1.08 ), 0.0, 1.0 );
	float thinF = clamp( vH2.y, 0.0, 1.3 );
	vec3 trans = vec3( 1.0, 0.32, 0.18 ) * pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 3.0 ) * thinF * 0.22 * saturate( 0.4 - wNL );
	reflectedLight.directDiffuse += ( wrapNL + trans ) * directLight.color * BRDF_Lambert( material.diffuseColor );`);
    f = f.replace('#include <lights_physical_pars_fragment>', lp);
    f = f.replace('#include <color_fragment>', `#include <color_fragment>
  vec4 skInfo = vec4(0.0);
  float skH = 0.0; vec3 skN = normalize(vRN);
  {
    vec3 p = vRest; float e = 0.00007;
    skH = skinH(p, vH1.x, vH1.z, vH1.w, skInfo);
#if HAND_DETAIL > 0
    vec4 tmp;
    float hx = skinH(p + vec3(e, 0.0, 0.0), vH1.x + vFD.x * e, vH1.z + vFS.x * e, vH1.w + vFD.x * e, tmp);
    float hy = skinH(p + vec3(0.0, e, 0.0), vH1.x + vFD.y * e, vH1.z + vFS.y * e, vH1.w + vFD.y * e, tmp);
    float hz = skinH(p + vec3(0.0, 0.0, e), vH1.x + vFD.z * e, vH1.z + vFS.z * e, vH1.w + vFD.z * e, tmp);
    vec3 g = vec3(hx - skH, hy - skH, hz - skH) / e;
    g -= dot(g, skN) * skN;
    skN = normalize(skN - g);
#endif
  }
  // 피부 색: 기본 + 저주파 얼룩 + 관절/손끝 붉은기 + 손바닥 분홍 + 주름 어둡게 + 혈관 푸른기
  vec3 base = vec3(0.52, 0.3, 0.195);
  float lf = vn(vRest * 90.0) * 0.6 + vn(vRest * 260.0) * 0.4;
  base *= 0.92 + lf * 0.16;
  float palmar = smoothstep(0.0, 0.6, -vH2.x);
  base = mix(base, vec3(0.7, 0.4, 0.31), palmar * 0.55);
  float tipRed = vH1.y > 2.5 ? smoothstep(-0.012, 0.0, vH1.x) : 0.0;
  base = mix(base, base * vec3(1.06, 0.8, 0.76), clamp(skInfo.z * 0.6 + tipRed * 0.7, 0.0, 1.0));
  base = mix(base, base * vec3(0.8, 0.7, 0.66), clamp(skInfo.z, 0.0, 1.0) * smoothstep(0.1, 0.6, vH2.x) * 0.55); // 손등 관절 색소 침착
  base *= mix(0.74, 1.0, smoothstep(0.25, 0.95, vAO));
  base = mix(base, vec3(0.42, 0.39, 0.5) * 0.6, clamp(skInfo.y, 0.0, 1.0) * 0.16);
  base *= 1.0 - clamp(skInfo.x, 0.0, 1.0) * 0.28;
  base = mix(base, base * vec3(1.02, 0.95, 0.9), clamp(vH2.z - 2.0, 0.0, 1.0));
  diffuseColor.rgb = base;`);
    f = f.replace('#include <aomap_fragment>', `
  float ambientOcclusion = mix(1.0, vAO, 0.92);
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_SHEEN )
    sheenSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), ambientOcclusion, material.roughness );
  #endif`);
    f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = 0.47 + palmar * 0.08 + clamp(skInfo.x, 0.0, 1.0) * 0.15 - tipRed * 0.06;`);
    f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  normal = normalize(mat3(vS0, vS1, vS2) * skN);`);
    sh.fragmentShader = f;
  };
  return m;
}

// ── 손 모델 (지오메트리 + 재질, 양손 공유) ──
export class HandModel {
  constructor(quality = 'high') {
    const h = { low: 0.0019, medium: 0.0016, high: 0.00138, ultra: 0.00122 }[quality] || 0.00138;
    const t0 = performance.now();
    const { P, Nrm, idx } = extract(h);
    const at = attributes(P, Nrm);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(Nrm, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(at.sIdx, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(at.sW, 4));
    g.setAttribute('aH1', new THREE.Float32BufferAttribute(at.h1, 4)); g.setAttribute('aH2', new THREE.Float32BufferAttribute(at.h2, 4));
    g.setAttribute('aFD', new THREE.Float32BufferAttribute(at.fd, 3)); g.setAttribute('aFS', new THREE.Float32BufferAttribute(at.fs, 3)); g.setAttribute('aAO', new THREE.Float32BufferAttribute(at.ao, 1));
    g.setIndex(P.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    this.geo = g; this.tris = idx.length / 3; this.ms = performance.now() - t0;
    this.skin = skinMaterial(quality === 'low' ? 0 : quality === 'medium' ? 1 : 2);
    this.nails = CH.map((c) => nailGeo(c));
    this.nailMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.2, specularIntensity: 0.6, envMapIntensity: 0.5, sheen: 0.2, sheenColor: new THREE.Color(1, 0.8, 0.75) });
    this.sleeve = sleeveGeo();
    this.sleeveMat = new THREE.MeshStandardMaterial({ color: 0x4d5b70, roughness: 0.93, metalness: 0 });
  }
  setSleeveMap(map, normalMap) { this.sleeveMat.normalMap = normalMap; this.sleeveMat.normalScale.set(0.6, 0.6); this.sleeveMat.needsUpdate = true; }
}

// ── 자세 ── 값 배열: 손가락 i(0..3) → [MCP, PIP, DIP, 벌림] (i*4), 엄지 16..20 → [CMC 굽힘, CMC 대립, 회전, MCP, IP], 손목 21..22 → [굽힘, 편위]
export const NDOF = 23;
const P = (f, t, w = [0, 0]) => Float32Array.from([...f.flat(), ...t, ...w]);
export const POSES = {
  relaxed: P([[0.26, 0.3, 0.16, 0.0], [0.32, 0.4, 0.2, 0], [0.38, 0.48, 0.24, 0], [0.45, 0.56, 0.28, 0.02]], [0.1, 0.02, 0.0, 0.16, 0.14]),
  open: P([[0.04, 0.05, 0.04, -0.04], [0.04, 0.05, 0.03, 0], [0.05, 0.06, 0.04, 0.03], [0.06, 0.07, 0.05, 0.07]], [-0.05, -0.12, 0.0, 0.05, 0.05], [-0.15, 0]),
  reach: P([[0.12, 0.18, 0.1, -0.06], [0.14, 0.2, 0.12, 0], [0.17, 0.24, 0.14, 0.05], [0.2, 0.3, 0.16, 0.1]], [0.0, -0.05, 0.0, 0.08, 0.08], [-0.25, 0]),
  fist: P([[1.45, 1.75, 0.95, 0], [1.5, 1.78, 0.95, 0], [1.52, 1.8, 0.95, 0], [1.55, 1.8, 0.95, 0]], [0.65, 0.55, 0.35, 0.55, 0.5]),
  point: P([[0.06, 0.08, 0.05, -0.03], [1.45, 1.7, 0.9, 0], [1.5, 1.75, 0.9, 0], [1.52, 1.75, 0.9, 0]], [0.6, 0.5, 0.3, 0.45, 0.4]),
};

// 굽힘 축으로 뼈 회전 쿼터니언
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _m = new THREE.Matrix4();
const UPY = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(1, 0, 0);

export class HandRig {
  constructor(model, left = false) {
    this.model = model; this.left = left;
    this.group = new THREE.Group(); // 이 그룹을 공구/카메라 공간에 배치
    this.inner = new THREE.Group(); this.group.add(this.inner);
    if (left) this.inner.scale.x = -1;
    // 뼈 생성 (바인드 자세 회전 = 단위)
    const bones = [];
    const mk = (pos, parent) => { const b = new THREE.Bone(); const pw = parent ? parent.userData.w : new THREE.Vector3(); b.position.copy(pos).sub(pw); b.userData.w = pos.clone(); if (parent) parent.add(b); bones.push(b); return b; };
    const root = mk(FOREARM, null), wrist = mk(WRIST, root);
    for (let i = 0; i < 4; i++) { const c = CH[i]; let p = wrist; for (let k = 0; k < 3; k++) p = mk(c.J[k], p); }
    { const c = CH[4]; let p = wrist; for (let k = 0; k < 3; k++) p = mk(c.J[k], p); }
    this.bones = bones;
    const mesh = (this.mesh = new THREE.SkinnedMesh(model.geo, model.skin));
    mesh.add(root); mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.bind(new THREE.Skeleton(bones));
    this.inner.add(mesh);
    // 손톱 (원위 마디 뼈에 부착), 소매 (팔뚝 뼈)
    CH.forEach((c, i) => { const n = new THREE.Mesh(model.nails[i], model.nailMat); n.receiveShadow = true; n.renderOrder = 11; bones[i < 4 ? BONE.finger(i, 2) : BONE.thumb(2)].add(n); });
    const sl = new THREE.Mesh(model.sleeve, model.sleeveMat); sl.receiveShadow = true; root.add(sl);
    this.inner.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.renderOrder = 10; } });
    // 관절 상태 (감쇠 스프링)
    this.x = Float32Array.from(POSES.relaxed); this.vel = new Float32Array(NDOF); this.target = Float32Array.from(POSES.relaxed);
    this.omega = new Float32Array(NDOF);
    for (let i = 0; i < NDOF; i++) this.omega[i] = i < 16 ? [26, 23, 20, 18][Math.floor(i / 4)] * (i % 4 === 3 ? 0.7 : 1) : i < 21 ? 21 : 9;
    this.t = Math.random() * 10; this.tension = 0; this.apply();
  }
  setPose(arr) { this.target.set(arr); return this; }
  // 손가락 하나만 덮어쓰기 (예: 방아쇠 검지)
  setFinger(i, mcp, pip, dip) { this.target[i * 4] = mcp; this.target[i * 4 + 1] = pip; this.target[i * 4 + 2] = dip; }
  // 손 전체가 갑자기 움직일 때 손가락이 관성으로 출렁임 (ax: 좌우, ay: 상하 속도 변화)
  kick(ax, ay) {
    const loose = 1 - 0.75 * Math.min(1, this.tension);
    for (let f = 0; f < 4; f++) {
      const k = (0.6 + f * 0.18) * loose;
      this.vel[f * 4] += ay * 0.9 * k; this.vel[f * 4 + 1] += ay * 1.2 * k; this.vel[f * 4 + 2] += ay * 0.8 * k; this.vel[f * 4 + 3] += ax * 0.5 * k;
    }
    this.vel[19] += ay * 0.6 * loose; this.vel[20] += ay * 0.6 * loose;
  }
  update(dt) {
    dt = Math.min(dt, 0.05); this.t += dt;
    const idle = 1 - Math.min(1, this.tension);
    // 꼼지락: 몇 초마다 손가락 하나를 살짝 굽혔다 폄 (손톱 두드리기 같은 습관)
    if (idle > 0.5) {
      this.fid = this.fid || { next: 2 + Math.random() * 4, f: 0, t: 1 };
      this.fid.next -= dt; this.fid.t += dt;
      if (this.fid.next <= 0) { this.fid = { next: 3 + Math.random() * 6, f: Math.floor(Math.random() * 5), t: 0 }; }
    }
    const fpulse = this.fid && this.fid.t < 0.9 ? Math.sin(Math.min(1, this.fid.t / 0.9) * Math.PI) * idle : 0;
    for (let i = 0; i < NDOF; i++) {
      const wob = i < 21 ? (Math.sin(this.t * 0.83 + i * 1.7) * 0.6 + Math.sin(this.t * 1.91 + i * 0.37) * 0.4) * 0.022 * idle : 0;
      let fadd = 0;
      if (fpulse && this.fid) { const fi = this.fid.f; if (fi < 4 ? (i >= fi * 4 && i < fi * 4 + 3) : (i === 19 || i === 20)) fadd = fpulse * (i % 4 === 0 ? 0.35 : 0.5); }
      const w = this.omega[i], tgt = this.target[i] + wob + fadd;
      const a = w * w * (tgt - this.x[i]) - 2 * 0.82 * w * this.vel[i];
      this.vel[i] += a * dt; this.x[i] += this.vel[i] * dt;
    }
    this.apply();
  }
  apply() {
    const x = this.x, B = this.bones;
    for (let f = 0; f < 4; f++) {
      const c = CH[f];
      B[BONE.finger(f, 0)].quaternion.setFromAxisAngle(UPY, x[f * 4 + 3]).multiply(_q.setFromAxisAngle(c.flex, x[f * 4]));
      B[BONE.finger(f, 1)].quaternion.setFromAxisAngle(c.flex, x[f * 4 + 1]);
      B[BONE.finger(f, 2)].quaternion.setFromAxisAngle(c.flex, x[f * 4 + 2]);
    }
    const t = CH[4];
    B[BONE.thumb(0)].quaternion.setFromAxisAngle(t.dir, x[18]).multiply(_q.setFromAxisAngle(t.oppAxis, x[17])).multiply(_q2.setFromAxisAngle(t.flex, x[16]));
    B[BONE.thumb(1)].quaternion.setFromAxisAngle(t.flex, x[19]);
    B[BONE.thumb(2)].quaternion.setFromAxisAngle(t.flex, x[20]);
    B[BONE.wrist].quaternion.setFromAxisAngle(AX, x[21]).multiply(_q.setFromAxisAngle(UPY, x[22]));
  }
  // 손목 기준(바인드) 좌표에서 관절 위치 계산 (FK, IK용)
  static fk(ci, ang, out) {
    const c = CH[ci], q = new THREE.Quaternion();
    if (ci < 4) q.setFromAxisAngle(UPY, ang[3]); else q.setFromAxisAngle(c.dir, ang[2]).multiply(_q.setFromAxisAngle(c.oppAxis, ang[1]));
    let p = c.J[0].clone(); out[0] = p.clone();
    const flexIdx = ci < 4 ? [0, 1, 2] : [0, 3, 4];
    for (let k = 0; k < 3; k++) {
      q.multiply(_q.setFromAxisAngle(c.flex, ang[flexIdx[k]]));
      p = p.clone().add(c.dir.clone().multiplyScalar(c.L[k]).applyQuaternion(q)); out[k + 1] = p;
    }
    return out;
  }
  // 손잡이(원통)를 감싸는 자세 계산: center/axis 는 손목 뼈 바인드 좌표, R = 손잡이 반지름
  static gripPose(center, axis, R, { trigger = false, base = POSES.relaxed, thumbWrap = true } = {}) {
    const pose = Float32Array.from(base), a = axis.clone().normalize();
    const dist = (p) => { _v.copy(p).sub(center); return _v.addScaledVector(a, -_v.dot(a)).length(); };
    const solve = (ci, ang, k, idx, maxA, rad) => {
      const out = [];
      for (let th = ang[idx]; th <= maxA; th += 0.015) {
        ang[idx] = th; HandRig.fk(ci, ang, out);
        const mid = out[k].clone().lerp(out[k + 1], 0.6);
        if (dist(out[k + 1]) <= R + rad || dist(mid) <= R + rad) return;
      }
      ang[idx] = maxA * 0.8;
    };
    for (let f = 0; f < 4; f++) {
      if (trigger && f === 0) continue;
      const ang = [0, 0, 0, pose[f * 4 + 3]];
      solve(f, ang, 0, 0, 1.3, CH[f].r[1]); solve(f, ang, 1, 1, 1.85, CH[f].r[2]); solve(f, ang, 2, 2, 1.2, CH[f].r[3]);
      pose[f * 4] = ang[0]; pose[f * 4 + 1] = ang[1]; pose[f * 4 + 2] = ang[2];
    }
    if (trigger) { pose[0] = 0.62; pose[1] = 0.85; pose[2] = 0.35; pose[3] = -0.06; }
    if (thumbWrap) {
      const ang = [0.3, 0.45, 0.2, 0, 0];
      solve(4, ang, 0, 0, 1.0, CH[4].r[1]); solve(4, ang, 1, 3, 1.1, CH[4].r[2]); solve(4, ang, 2, 4, 1.0, CH[4].r[3]);
      pose[16] = ang[0]; pose[17] = ang[1]; pose[18] = ang[2]; pose[19] = ang[3]; pose[20] = ang[4];
    }
    return pose;
  }
}

// 손 쥠 기준틀 (손목 뼈 바인드 좌표): 손잡이 축 = 검지쪽(-X)→소지쪽 대각선, 손바닥 아래
export const GRIP = {
  axis: new THREE.Vector3(0.95, 0, 0.3).normalize(), // 소지 쪽을 향함 (반대 = 엄지/검지 쪽 = 공구의 "위")
  center: (R) => new THREE.Vector3(0.002, -0.0125 - R - 0.001, -0.079),
  palm: new THREE.Vector3(0, 1, 0), // 손잡이 축에서 손바닥 쪽
};
// 손잡이 정렬 회전 (손 그룹 좌표 → 공구 좌표)
function alignQuat(up, palm, wristFlex, wristDev, mirror) {
  const M = mirror ? new THREE.Vector3(-1, 1, 1) : new THREE.Vector3(1, 1, 1);
  const W = new THREE.Quaternion().setFromAxisAngle(AX, wristFlex).multiply(_q.setFromAxisAngle(UPY, wristDev));
  const ga = GRIP.axis.clone().negate().applyQuaternion(W).multiply(M), gp = GRIP.palm.clone().applyQuaternion(W).multiply(M);
  const src = basis(ga, gp), dst = basis(up.clone().normalize(), palm.clone().normalize());
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(dst, src.clone().transpose()));
}
// 손잡이 축 둘레 손바닥 방향 + 손목 각도를 자동 탐색: 팔뚝이 원하는 방향(arm, 공구 좌표)에서 오도록
export function fitGrip(up, arm, mirror = false, { flex = [-0.5, 0.5], dev = [-0.45, 0.3] } = {}) {
  const u = up.clone().normalize(), ref = Math.abs(u.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const p0 = ref.addScaledVector(u, -ref.dot(u)).normalize(), a = arm.clone().normalize(), Z = new THREE.Vector3(0, 0, 1);
  let best = null, bs = -1e9;
  for (let r = 0; r < 72; r++) {
    const palm = p0.clone().applyAxisAngle(u, (r / 72) * Math.PI * 2);
    for (let f = flex[0]; f <= flex[1] + 1e-6; f += 0.1) for (let d = dev[0]; d <= dev[1] + 1e-6; d += 0.075) {
      const fa = Z.clone().applyQuaternion(alignQuat(u, palm, f, d, mirror));
      const sc = fa.dot(a) - 0.12 * (Math.abs(f) + Math.abs(d));
      if (sc > bs) { bs = sc; best = { palm, wf: f, wd: d, score: sc }; }
    }
  }
  return best;
}
// 공구 손잡이(공구 좌표: 중심 c, 위쪽 축 up, 손바닥 방향 palm)에 손을 맞추는 변환 (손 그룹의 로컬 행렬)
export function alignHandToHandle(rig, c, up, palm, R, wristFlex = 0, wristDev = 0, mirror = false) {
  const M = mirror ? new THREE.Vector3(-1, 1, 1) : new THREE.Vector3(1, 1, 1);
  // 손 그룹 좌표에서의 쥠 틀 (손목 회전 포함)
  const W = new THREE.Quaternion().setFromAxisAngle(AX, wristFlex).multiply(_q.setFromAxisAngle(UPY, wristDev));
  const wristPos = WRIST.clone();
  const gc = GRIP.center(R).sub(WRIST).applyQuaternion(W).add(wristPos).multiply(M);
  const ga = GRIP.axis.clone().negate().applyQuaternion(W).multiply(M); // 엄지 쪽 = 공구 위
  const gp = GRIP.palm.clone().applyQuaternion(W).multiply(M);
  const src = basis(ga, gp), dst = basis(up.clone().normalize(), palm.clone().normalize());
  const R3 = new THREE.Matrix4().multiplyMatrices(dst, src.clone().transpose());
  const q = new THREE.Quaternion().setFromRotationMatrix(R3);
  const t = c.clone().sub(gc.clone().applyQuaternion(q));
  rig.group.position.copy(t); rig.group.quaternion.copy(q);
  rig.target[21] = wristFlex; rig.target[22] = wristDev; rig.x[21] = wristFlex; rig.x[22] = wristDev;
}
function basis(a, b) { // a 축 + b(직교화) → 회전 행렬 열
  const x = a.clone().normalize(), y = b.clone().addScaledVector(x, -b.dot(x)).normalize(), z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z);
}
