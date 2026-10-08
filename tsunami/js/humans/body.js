// 사람 몸 절차 생성 — 해부학적 프리미티브(둥근원뿔·타원체)의 부드러운 합집합 SDF를
// Surface Nets로 다각형화한 뒤 정점을 SDF 표면에 뉴턴 투영, SDF 기울기 법선·AO, 근접 프리미티브 기반
// 스킨 가중치(관절 부위 2~4 뼈 혼합)를 계산한다. 손·머리카락·모자·치마·휴대폰은 파라메트릭 메시로 덧붙인다.
// 좌표: 바인드 자세, 발바닥 y=0, 정면 +Z, +X = 사람의 왼쪽. 모든 뼈의 바인드 회전은 단위행렬.
import * as THREE from 'three';

export const BONES = ['pelvis', 'spine', 'chest', 'neck', 'head', 'clavL', 'upperArmL', 'foreArmL', 'handL', 'clavR', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
export const BONE_PARENT = [-1, 0, 1, 2, 3, 2, 5, 6, 7, 2, 9, 10, 11, 0, 13, 14, 0, 16, 17];
export const NB = BONES.length;
export const VARIANTS = ['man', 'woman', 'child', 'elderM', 'elderF'];
export const PART = { body: 0, hairCap: 1, hairLong: 2, ponytail: 3, bun: 4, cap: 5, sunhat: 6, helmet: 7, skirt: 8, phone: 9, hand: 10 };
// LOD: 격자 간격(1.75m 기준), 머리 정밀 격자, 손 상세도(2 손가락, 1 벙어리, 0 SDF), 부속 분할, 팽창(가는 팔다리 보존)
export const LODS = [
  { h: 0.0150, hHead: 0.0066, hands: 2, seg: 1.0, inflate: 0 },
  { h: 0.0255, hHead: 0.0105, hands: 1, seg: 0.55, inflate: 0.0015 },
  { h: 0.042, hHead: 0, hands: 0, seg: 0.32, inflate: 0.005 },
  { h: 0.07, hHead: 0, hands: 0, seg: 0.2, inflate: 0.012 },
];

const PEL = 0, SPI = 1, CHE = 2, NEC = 3, HEA = 4;
const sideB = (s) => (s > 0 ? { clav: 5, ua: 6, fa: 7, hand: 8, th: 13, sh: 14, ft: 15 } : { clav: 9, ua: 10, fa: 11, hand: 12, th: 16, sh: 17, ft: 18 });
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  mad: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
  lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
};

/* ───────────────────────── 체형 변수 ───────────────────────── */
const VDEF = { man: [1.75, 0, 0, 0], woman: [1.62, 1, 0, 0], child: [1.22, 0.5, 1, 0], elderM: [1.68, 0, 0, 1], elderF: [1.56, 1, 0, 1] };

function variantParams(name) {
  const [H, f, k, o] = VDEF[name];
  const m3 = (m, w, c) => lerp(lerp(m, w, f), c, k) * H;   // 남·여·아이 비율(키 대비) → m
  const P = { name, H, f, k, o, sc: H / 1.75 };
  P.hh = m3(0.13, 0.134, 0.172);                 // 턱~정수리
  P.chinY = H - P.hh;
  P.ankleY = m3(0.043, 0.043, 0.046);
  P.kneeY = m3(0.285, 0.284, 0.276);
  P.hipY = m3(0.512, 0.51, 0.474);
  P.pelvisY = P.hipY + m3(0.028, 0.03, 0.03);
  P.crotchY = P.hipY - m3(0.04, 0.036, 0.034);
  P.spineY = m3(0.605, 0.61, 0.585);
  P.waistY = m3(0.612, 0.626, 0.596);
  P.chestY = m3(0.695, 0.70, 0.672);
  P.shY = m3(0.806, 0.80, 0.768) - 0.008 * H * o;
  P.neckY = m3(0.836, 0.83, 0.79);
  P.headY = P.chinY + 0.3 * P.hh;
  P.fz = o * 0.02 * H;                           // 노인: 머리·목이 앞으로
  P.headZ = -0.008 * H + P.fz;
  P.shX = m3(0.104, 0.094, 0.092) * (1 - 0.03 * o);
  P.hipX = m3(0.05, 0.054, 0.05);
  P.alpha = 0.3;                                 // 바인드 자세 팔 벌림(rad)
  P.uArm = m3(0.186, 0.183, 0.178);
  P.fArm = m3(0.146, 0.142, 0.138);
  P.handL = m3(0.108, 0.104, 0.11);
  P.footLen = m3(0.152, 0.146, 0.16);
  P.chestW = m3(0.091, 0.083, 0.088) * (1 - 0.03 * o);
  P.chestD = m3(0.063, 0.057, 0.066);
  P.waistW = m3(0.079, 0.068, 0.085) * (1 + 0.08 * o);
  P.waistD = m3(0.055, 0.05, 0.066) * (1 + 0.14 * o);
  P.hipW = m3(0.095, 0.107, 0.088);
  P.hipD = m3(0.06, 0.066, 0.064);
  P.thighR = m3(0.05, 0.055, 0.05) * (1 - 0.06 * o);
  P.kneeR = m3(0.031, 0.031, 0.032);
  P.calfR = m3(0.035, 0.034, 0.034) * (1 - 0.08 * o);
  P.ankleR = m3(0.0185, 0.0175, 0.02);
  P.uArmR = m3(0.027, 0.0238, 0.025) * (1 - 0.06 * o);
  P.elbowR = m3(0.0195, 0.0168, 0.019);
  P.fArmR = m3(0.0225, 0.0192, 0.021);
  P.wristR = m3(0.0145, 0.0126, 0.0155);
  P.neckR = m3(0.0335, 0.0285, 0.033);
  P.muscle = (1 - f) * (1 - k) * (1 - 0.4 * o);
  P.breast = f * (1 - k);
  // 관절(뼈 원점)
  const al = P.alpha, J = {}, E = {};
  J[0] = [0, P.pelvisY, 0];
  J[1] = [0, P.spineY, -0.014 * H];
  J[2] = [0, P.chestY, -0.02 * H];
  J[3] = [0, P.neckY, -0.022 * H + P.fz * 0.5];
  J[4] = [0, P.headY, P.headZ - 0.004 * H];
  for (const s of [1, -1]) {
    const b = sideB(s);
    const u = [s * Math.sin(al), -Math.cos(al), 0];
    J[b.clav] = [s * 0.012 * H, P.shY + 0.014 * H, 0.014 * H];
    J[b.ua] = [s * P.shX, P.shY, -0.008 * H];
    J[b.fa] = V.mad(J[b.ua], u, P.uArm);
    J[b.hand] = V.mad(J[b.fa], u, P.fArm);
    J[b.th] = [s * P.hipX, P.hipY, 0.004 * H];
    J[b.sh] = [s * (P.hipX + 0.002 * H), P.kneeY, 0.006 * H];
    J[b.ft] = [s * (P.hipX + 0.004 * H), P.ankleY, -0.004 * H];
    E[b.clav] = J[b.ua]; E[b.ua] = J[b.fa]; E[b.fa] = J[b.hand]; E[b.hand] = V.mad(J[b.hand], u, P.handL);
    E[b.th] = J[b.sh]; E[b.sh] = J[b.ft]; E[b.ft] = [s * (P.hipX + 0.008 * H), 0.012 * H, 0.118 * H];
  }
  E[0] = J[1]; E[1] = J[2]; E[2] = J[3]; E[3] = J[4]; E[4] = [0, H, P.headZ];
  P.J = J; P.E = E;
  P.hc = [0, P.chinY + 0.5 * P.hh, P.headZ];     // 머리 기준점(턱~정수리 중간)
  P.eyeY = k ? -0.045 : 0.0;                     // 머리 단위 눈높이
  return P;
}

/* ───────────────────────── SDF 프리미티브 ───────────────────────── */
class Prim {
  constructor(type, o) {
    this.type = type;
    this.grp = o.grp; this.bone = o.bone; this.bone2 = o.bone2 ?? -1; this.w2 = o.w2 ?? 0;
    this.fat = o.fat ?? 0.5; this.op = o.op ?? 0;   // 0 합집합, 1 빼기, 2 사후 합집합
    if (type === 0) {
      const a = o.a, b = o.b;
      this.ax = a[0]; this.ay = a[1]; this.az = a[2];
      this.bx = b[0] - a[0]; this.by = b[1] - a[1]; this.bz = b[2] - a[2];
      this.l2 = this.bx * this.bx + this.by * this.by + this.bz * this.bz;
      this.r1 = o.ra; this.r2 = o.rb; this.rr = o.ra - o.rb;
      this.a2 = this.l2 - this.rr * this.rr; this.il2 = 1 / this.l2;
      const r = Math.max(o.ra, o.rb);
      this.min = [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.min(a[2], b[2]) - r];
      this.max = [Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r, Math.max(a[2], b[2]) + r];
    } else {
      const c = o.c, r = o.r;
      this.cx = c[0]; this.cy = c[1]; this.cz = c[2];
      this.rx = r[0]; this.ry = r[1]; this.rz = r[2];
      const ax = o.axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      this.m = [...ax[0], ...ax[1], ...ax[2]];
      const m = Math.max(r[0], r[1], r[2]);
      this.min = [c[0] - m, c[1] - m, c[2] - m];
      this.max = [c[0] + m, c[1] + m, c[2] + m];
    }
  }
  d(x, y, z) {
    if (this.type === 0) {
      const px = x - this.ax, py = y - this.ay, pz = z - this.az;
      const l2 = this.l2, yy = px * this.bx + py * this.by + pz * this.bz, zz = yy - l2;
      const qx = px * l2 - this.bx * yy, qy = py * l2 - this.by * yy, qz = pz * l2 - this.bz * yy;
      const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
      const rr = this.rr, k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * this.a2 * z2 > k) return Math.sqrt(x2 + z2) * this.il2 - this.r2;
      if (Math.sign(yy) * this.a2 * y2 < k) return Math.sqrt(x2 + y2) * this.il2 - this.r1;
      return (Math.sqrt(x2 * this.a2 * this.il2) + yy * rr) * this.il2 - this.r1;
    }
    const px = x - this.cx, py = y - this.cy, pz = z - this.cz, m = this.m;
    const lx = (px * m[0] + py * m[1] + pz * m[2]) / this.rx;
    const ly = (px * m[3] + py * m[4] + pz * m[5]) / this.ry;
    const lz = (px * m[6] + py * m[7] + pz * m[8]) / this.rz;
    const k0 = Math.sqrt(lx * lx + ly * ly + lz * lz);
    const k1 = Math.sqrt((lx / this.rx) ** 2 + (ly / this.ry) ** 2 + (lz / this.rz) ** 2);
    if (k1 < 1e-9) return -Math.min(this.rx, this.ry, this.rz);
    return k0 * (k0 - 1) / k1;
  }
}

function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
function smax(a, b, k) { return -smin(-a, -b, k); }

/** 체형 변수 → 그룹별 프리미티브 집합과 SDF 평가기 */
function buildSDF(P, opt) {
  const H = P.H, hh = P.hh, J = P.J;
  const L = [];
  const cone = (grp, bone, a, b, ra, rb, fat, x) => L.push(new Prim(0, { grp, bone, a, b, ra, rb, fat, ...x }));
  const ell = (grp, bone, c, r, fat, x) => L.push(new Prim(1, { grp, bone, c, r, fat, ...x }));
  const h = (x, y, z) => [P.hc[0] + x * hh, P.hc[1] + y * hh, P.hc[2] + z * hh];
  const mu = P.muscle, br = P.breast, o = P.o, kid = P.k, fem = P.f;
  // ── 몸통(0)
  ell(0, PEL, [0, P.hipY + 0.014 * H, -0.006 * H], [P.hipW, 0.072 * H, P.hipD], 0.8);
  for (const s of [1, -1]) ell(0, PEL, [s * 0.044 * H, P.hipY - 0.006 * H, -0.03 * H - 0.004 * H * fem], [0.05 * H * (1 + 0.1 * fem), 0.06 * H, 0.042 * H * (1 + 0.12 * fem)], 1.0, { bone2: sideB(s).th, w2: 0.3 });
  ell(0, PEL, [0, P.hipY + 0.075 * H, 0.01 * H], [P.waistW * 0.96, 0.06 * H, P.waistD + 0.01 * H * o], 1.0, { bone2: SPI, w2: 0.5 });
  ell(0, SPI, [0, P.waistY + 0.01 * H, -0.004 * H], [P.waistW, 0.07 * H, P.waistD], 1.0);
  ell(0, CHE, [0, P.chestY + 0.04 * H, -0.002 * H], [P.chestW, 0.105 * H, P.chestD], 0.5);
  ell(0, CHE, [0, P.shY - 0.004 * H, 0.002 * H], [P.chestW * 0.9, 0.04 * H, P.chestD * 0.8], 0.4);
  for (const s of [1, -1]) {
    const b = sideB(s), S = J[b.ua];
    const u = V.norm(V.sub(J[b.fa], S)), v = [u[1] * -s * -1 * 0 + Math.cos(P.alpha) * s, Math.sin(P.alpha), 0];
    const axes = [v, u, [0, 0, 1]];
    if (mu > 0.05) ell(0, CHE, [s * 0.042 * H, P.shY - 0.05 * H, P.chestD * 0.6], [0.05 * H, 0.036 * H, 0.028 * H * mu + 0.004 * H], 0.6);
    if (br > 0.05) ell(0, CHE, [s * 0.046 * H, P.shY - 0.09 * H - 0.012 * H * o, P.chestD * 0.62], [0.044 * H, 0.042 * H * (1 + 0.15 * o), 0.04 * H * br], 0.9);
    ell(0, CHE, [s * 0.046 * H, P.shY - 0.045 * H, -P.chestD * 0.6], [0.05 * H, 0.072 * H, 0.03 * H], 0.5);
    cone(0, CHE, [s * 0.02 * H, P.neckY + 0.002 * H, -0.024 * H + P.fz * 0.3], [s * (P.shX - 0.012 * H), P.shY + 0.018 * H, -0.012 * H], 0.028 * H, 0.019 * H, 0.5, { bone2: b.clav, w2: 0.5 });
    ell(0, b.ua, V.add(V.mad(S, u, 0.02 * H), V.mul(v, 0.007 * H)), [0.03 * H * (1 - 0.1 * fem), 0.05 * H, 0.034 * H * (1 - 0.1 * fem)], 0.5, { axes, bone2: b.clav, w2: 0.25 });
  }
  const neckMid = [0, lerp(P.neckY, P.chinY, 0.45), -0.014 * H + P.fz * 0.7];
  cone(0, NEC, [0, P.neckY - 0.03 * H, -0.016 * H + P.fz * 0.3], neckMid, P.neckR * 1.12, P.neckR * 1.02, 0.5, { bone2: CHE, w2: 0.35 });
  cone(0, NEC, neckMid, [0, P.chinY + 0.014 * H, -0.012 * H + P.fz], P.neckR * 1.02, P.neckR, 0.4, { bone2: HEA, w2: 0.3 });
  if (o > 0) ell(0, CHE, [0, P.shY - 0.025 * H, -P.chestD * 0.8 + P.fz * 0.2], [0.07 * H, 0.06 * H, 0.035 * H], 0.3);
  // ── 팔(1·2)
  for (const s of [1, -1]) {
    const g = s > 0 ? 1 : 2, b = sideB(s), S = J[b.ua], El = J[b.fa], W = J[b.hand];
    const u = V.norm(V.sub(El, S)), v = [Math.cos(P.alpha) * s, Math.sin(P.alpha), 0], z = [0, 0, 1];
    const axes = [v, u, z];
    cone(g, b.ua, V.mad(S, u, 0.008 * H), El, P.uArmR * 1.02, P.elbowR * 1.04, 0.6);
    ell(g, b.ua, V.mad(V.lerp(S, El, 0.53), z, 0.007 * H), [0.02 * H * (1 + 0.15 * mu), 0.068 * H, 0.022 * H * (1 + 0.2 * mu)], 0.5, { axes });
    ell(g, b.ua, V.mad(V.lerp(S, El, 0.4), z, -0.009 * H), [0.022 * H, 0.075 * H, 0.021 * H * (1 + 0.1 * mu)], 0.6, { axes });
    ell(g, b.fa, El, [P.elbowR * 1.04, P.elbowR * 1.04, P.elbowR * 1.04], 0.2, { bone2: b.ua, w2: 0.5 });
    cone(g, b.fa, El, W, P.fArmR, P.wristR, 0.3);
    ell(g, b.fa, V.lerp(El, W, 0.27), [P.fArmR * 0.98, 0.06 * H, P.fArmR * 0.84], 0.3, { axes });
    ell(g, b.hand, W, [P.wristR * 0.74, 0.012 * H, P.wristR * 1.16], 0.1, { axes, bone2: b.fa, w2: 0.5 });
    if (opt.sdfHands) {
      const hl = P.handL;
      ell(g, b.hand, V.mad(V.mad(W, u, 0.42 * hl), v, -0.01 * hl), [0.13 * hl, 0.3 * hl, 0.24 * hl], 0.1, { axes });
      ell(g, b.hand, V.mad(V.mad(W, u, 0.78 * hl), v, -0.06 * hl), [0.1 * hl, 0.28 * hl, 0.21 * hl], 0.05, { axes });
      cone(g, b.hand, V.mad(V.mad(W, u, 0.15 * hl), z, 0.15 * hl), V.mad(V.mad(V.mad(W, u, 0.55 * hl), z, 0.24 * hl), v, -0.1 * hl), 0.08 * hl, 0.055 * hl, 0.05);
    }
  }
  // ── 다리(3·4)
  for (const s of [1, -1]) {
    const g = s > 0 ? 3 : 4, b = sideB(s), hip = J[b.th], knee = J[b.sh], ank = J[b.ft];
    const fx = ank[0], y = [0, 1, 0];
    cone(g, b.th, V.mad(hip, y, 0.015 * H), V.mad(knee, y, 0.006 * H), P.thighR, P.kneeR * 1.04, 0.8);
    ell(g, b.th, V.add(hip, [-s * 0.014 * H, -0.07 * H, 0.002 * H]), [0.03 * H, 0.075 * H, 0.034 * H], 0.9);
    ell(g, b.th, V.add(V.lerp(hip, knee, 0.45), [s * 0.004 * H, 0, 0.011 * H]), [0.035 * H, 0.095 * H, 0.033 * H * (1 + 0.1 * mu)], 0.6);
    ell(g, b.th, V.add(V.lerp(hip, knee, 0.38), [0, 0, -0.012 * H]), [0.034 * H, 0.09 * H, 0.031 * H], 0.6);
    ell(g, b.sh, V.add(knee, [0, 0.002 * H, 0.004 * H]), [P.kneeR * 1.02, P.kneeR * 1.2, P.kneeR], 0.2, { bone2: b.th, w2: 0.5 });
    ell(g, b.sh, V.add(knee, [0, 0.006 * H, P.kneeR * 0.85]), [0.012 * H, 0.015 * H, 0.008 * H], 0.1, { bone2: b.th, w2: 0.5 });
    cone(g, b.sh, V.mad(knee, y, -0.01 * H), V.mad(ank, y, 0.012 * H), P.kneeR * 0.92, P.ankleR, 0.3);
    ell(g, b.sh, V.add(V.lerp(knee, ank, 0.3), [-s * 0.003 * H, 0, -0.011 * H]), [P.calfR * 0.88, 0.075 * H, P.calfR * 0.78], 0.5);
    ell(g, b.ft, ank, [P.ankleR * 1.12, P.ankleR, P.ankleR], 0.1, { bone2: b.sh, w2: 0.5 });
    ell(g, b.ft, [fx, 0.022 * H, -0.016 * H], [0.025 * H, 0.026 * H, 0.021 * H], 0.1);
    ell(g, b.ft, [fx + s * 0.002 * H, 0.025 * H, 0.035 * H], [0.029 * H, 0.026 * H, 0.06 * H], 0.1);
    ell(g, b.ft, [fx + s * 0.004 * H, 0.016 * H, 0.09 * H], [0.029 * H, 0.017 * H, 0.036 * H], 0.05);
  }
  // ── 머리(5) — 머리 단위 hh, 기준점 hc
  const jw = lerp(0.255, 0.235, fem) * (1 - 0.06 * kid);
  const fs = kid ? 0.9 : 1;                      // 아이: 얼굴이 작음
  const ey = P.eyeY;
  const hr = (r) => r.map((v) => v * hh);
  ell(5, HEA, h(0, 0.08, -0.07), hr([0.335 + 0.015 * kid, 0.42, 0.43]), 0.1);
  ell(5, HEA, h(0, 0.17, 0.12), hr([0.29, 0.22, 0.26]), 0.1);
  ell(5, HEA, h(0, -0.08 * fs + ey * 0.5, 0.1), hr([0.275 * fs, 0.3 * fs, 0.28]), 0.25);
  for (const s of [1, -1]) {
    cone(5, HEA, h(s * jw, -0.12 * fs, -0.06), h(s * 0.06, -0.43 * fs + ey * 0.3, 0.27 * fs), (0.07) * hh, (0.075) * hh, 0.2);
    ell(5, HEA, h(s * 0.2 * fs, ey, 0.22), hr([0.1, 0.075, 0.1]), 0.1);
    ell(5, HEA, h(s * 0.16 * fs, -0.17 * fs + ey, 0.25), hr([0.095 + 0.02 * kid, 0.1, 0.085 + 0.015 * kid]), 0.4);
    ell(5, HEA, h(s * 0.345, -0.02 + ey * 0.5, -0.04), hr([0.045, 0.14 * (1 + 0.08 * o), 0.09]), 0.0, { axes: [[1, 0, 0], [0, Math.cos(0.25), -Math.sin(0.25)], [0, Math.sin(0.25), Math.cos(0.25)]] });
    ell(5, HEA, h(s * 0.055 * fs, -0.15 * fs + ey, 0.405 * fs), hr([0.045 * fs, 0.035 * fs, 0.04 * fs]), 0.0);
  }
  ell(5, HEA, h(0, -0.42 * fs + ey * 0.3, 0.29 * fs), hr([0.1 * fs, 0.085, 0.08]), 0.2);
  ell(5, HEA, h(0, 0.1 + ey * 0.3, 0.3), hr([0.27, 0.06, 0.085 - 0.02 * fem - 0.02 * kid]), 0.0);
  const nTip = lerp(0.47, 0.455, fem) * fs + 0.012 * o;
  cone(5, HEA, h(0, 0.06 + ey, 0.37 * fs), h(0, -0.13 * fs + ey, nTip), (0.035 * fs) * hh, lerp(0.05, 0.043, fem) * fs * hh, 0.0);
  ell(5, HEA, h(0, -0.235 * fs + ey * 0.6, 0.35 * fs), hr([0.1 * fs, 0.04, 0.04 + 0.006 * fem]), 0.1);
  ell(5, HEA, h(0, -0.29 * fs + ey * 0.5, 0.335 * fs), hr([0.088 * fs, 0.036 + 0.006 * fem, 0.036 + 0.006 * fem]), 0.1);
  for (const s of [1, -1]) {
    ell(5, HEA, h(s * 0.14 * fs, ey + 0.02, 0.4 * fs), hr([0.085 * fs, 0.075, 0.085]), 0, { op: 1 });       // 눈구멍
    ell(5, HEA, h(s * 0.14 * fs, ey, 0.27 * fs), hr([0.075 * fs, 0.075 * fs, 0.075 * fs]), 0, { op: 2 });  // 안구
  }
  // 그룹 구성
  const groups = [];
  const gk = [0.012 * H, 0.006 * H, 0.006 * H, 0.008 * H, 0.008 * H, 0.065 * hh];
  for (let g = 0; g < 6; g++) {
    const prims = L.filter((p) => p.grp === g);
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const p of prims) if (p.op !== 1) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p.min[i]); mx[i] = Math.max(mx[i], p.max[i]); }
    groups.push({ g, k: gk[g], uni: prims.filter((p) => p.op === 0), sub: prims.filter((p) => p.op === 1), post: prims.filter((p) => p.op === 2), mn, mx, clipY: g === 3 || g === 4 });
  }
  const kJoin = [0, 0.006 * H, 0.006 * H, 0.012 * H, 0.012 * H, 0.008 * H];
  const inflate = opt.inflate || 0;
  const cut = opt.cut || null;   // { below: y } → y<below 만, { above: y } → y>above 만
  const groupD = (G, x, y, z) => {
    let d = 1e9;
    for (const p of G.uni) d = smin(d, p.d(x, y, z), G.k);
    for (const p of G.sub) d = smax(d, -p.d(x, y, z), G.k * 1.6);
    for (const p of G.post) d = smin(d, p.d(x, y, z), G.k * 0.35);
    if (G.clipY) d = Math.max(d, -y);
    return d;
  };
  const boxDist = (G, x, y, z) => {
    const dx = Math.max(G.mn[0] - x, x - G.mx[0], 0), dy = Math.max(G.mn[1] - y, y - G.mx[1], 0), dz = Math.max(G.mn[2] - z, z - G.mx[2], 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  const sdf = (x, y, z) => {
    let d = groupD(groups[0], x, y, z);
    for (let g = 1; g < 6; g++) {
      const G = groups[g];
      if (boxDist(G, x, y, z) > d + kJoin[g]) continue;
      d = smin(d, groupD(G, x, y, z), kJoin[g]);
    }
    d -= inflate;
    if (cut) { if (cut.below !== undefined) d = Math.max(d, y - cut.below); if (cut.above !== undefined) d = Math.max(d, cut.above - y); if (cut.box) d = Math.max(d, boxSDF(cut.box, x, y, z)); }
    return d;
  };
  // 머리·목만 (머리카락·모자 레이캐스트)
  const headSdf = (x, y, z) => smin(groupD(groups[0], x, y, z), groupD(groups[5], x, y, z), kJoin[5]) - inflate;
  // 팔을 뺀 몸통·다리·머리 (치마·긴 머리 레이캐스트)
  const trunkSdf = (x, y, z) => {
    let d = groupD(groups[0], x, y, z);
    for (const g of [3, 4, 5]) d = smin(d, groupD(groups[g], x, y, z), kJoin[g]);
    return d - inflate;
  };
  const bmn = [1e9, 1e9, 1e9], bmx = [-1e9, -1e9, -1e9];
  for (const G of groups) for (let i = 0; i < 3; i++) { bmn[i] = Math.min(bmn[i], G.mn[i]); bmx[i] = Math.max(bmx[i], G.mx[i]); }
  return { prims: L, groups, sdf, headSdf, trunkSdf, groupD, bmin: bmn, bmax: bmx };
}

function boxSDF(b, x, y, z) {
  const dx = Math.max(b[0] - x, x - b[3]), dy = Math.max(b[1] - y, y - b[4]), dz = Math.max(b[2] - z, z - b[5]);
  return Math.max(dx, dy, dz);
}

/* ───────────────────────── 격자 샘플링 · Surface Nets ───────────────────────── */
function sampleGrid(sdf, o, n, h) {
  const [nx, ny, nz] = n, F = new Float32Array(nx * ny * nz), st = new Uint8Array(nx * ny * nz);
  const B = 4, bx = (nx - 1) / B, by = (ny - 1) / B, bz = (nz - 1) / B;
  const cnx = bx + 1, cny = by + 1;
  const C = new Float32Array(cnx * cny * (bz + 1));
  for (let k = 0; k <= bz; k++) for (let j = 0; j <= by; j++) for (let i = 0; i <= bx; i++) {
    const v = sdf(o[0] + i * B * h, o[1] + j * B * h, o[2] + k * B * h);
    C[i + cnx * (j + cny * k)] = v;
    F[i * B + nx * (j * B + ny * k * B)] = v; st[i * B + nx * (j * B + ny * k * B)] = 2;
  }
  const thr = B * h * Math.sqrt(3) * 1.2;
  for (let k = 0; k < bz; k++) for (let j = 0; j < by; j++) for (let i = 0; i < bx; i++) {
    const c = (a, b, d) => C[(i + a) + cnx * ((j + b) + cny * (k + d))];
    const c000 = c(0, 0, 0), c100 = c(1, 0, 0), c010 = c(0, 1, 0), c110 = c(1, 1, 0), c001 = c(0, 0, 1), c101 = c(1, 0, 1), c011 = c(0, 1, 1), c111 = c(1, 1, 1);
    const mn = Math.min(c000, c100, c010, c110, c001, c101, c011, c111), mx = Math.max(c000, c100, c010, c110, c001, c101, c011, c111);
    const far = mn > thr || mx < -thr;
    for (let dk = 0; dk <= B; dk++) for (let dj = 0; dj <= B; dj++) for (let di = 0; di <= B; di++) {
      const gi = i * B + di, gj = j * B + dj, gk = k * B + dk, id = gi + nx * (gj + ny * gk);
      if (st[id] === 2) continue;
      if (far) {
        if (st[id]) continue;
        const u = di / B, v = dj / B, w = dk / B;
        F[id] = lerp(lerp(lerp(c000, c100, u), lerp(c010, c110, u), v), lerp(lerp(c001, c101, u), lerp(c011, c111, u), v), w);
        st[id] = 1;
      } else { F[id] = sdf(o[0] + gi * h, o[1] + gj * h, o[2] + gk * h); st[id] = 2; }
    }
  }
  return F;
}

function surfaceNets(F, n, o, h) {
  const [nx, ny, nz] = n, cx = nx - 1, cy = ny - 1, cz = nz - 1;
  const vid = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [], quads = [];
  const sy = nx, sz = nx * ny;
  const off = [0, 1, sy, 1 + sy, sz, 1 + sz, sy + sz, 1 + sy + sz];
  const E = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  const val = new Float32Array(8);
  for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++) {
    const base = x + nx * (y + ny * z);
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = F[base + off[c]]; val[c] = v; if (v < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy2 = 0, sz2 = 0, cnt = 0;
    for (let e = 0; e < 24; e += 2) {
      const a = E[e], b = E[e + 1], va = val[a], vb = val[b];
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      sx += (a & 1) + ((b & 1) - (a & 1)) * t;
      sy2 += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
      sz2 += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
      cnt++;
    }
    vid[x + cx * (y + cy * z)] = pos.length / 3;
    pos.push(o[0] + (x + sx / cnt) * h, o[1] + (y + sy2 / cnt) * h, o[2] + (z + sz2 / cnt) * h);
  }
  const cid = (x, y, z) => vid[x + cx * (y + cy * z)];
  for (let z = 1; z < cz; z++) for (let y = 1; y < cy; y++) for (let x = 1; x < cx; x++) {
    const base = x + nx * (y + ny * z), v0 = F[base] < 0;
    const c = cid(x, y, z);
    if (c < 0) continue;
    // x축 간선
    if (v0 !== (F[base + 1] < 0)) {
      const q = [c, cid(x, y - 1, z), cid(x, y - 1, z - 1), cid(x, y, z - 1)];
      quads.push(...(v0 ? q : [q[0], q[3], q[2], q[1]]));
    }
    if (v0 !== (F[base + sy] < 0)) {
      const q = [c, cid(x, y, z - 1), cid(x - 1, y, z - 1), cid(x - 1, y, z)];
      quads.push(...(v0 ? q : [q[0], q[3], q[2], q[1]]));
    }
    if (v0 !== (F[base + sz] < 0)) {
      const q = [c, cid(x - 1, y, z), cid(x - 1, y - 1, z), cid(x, y - 1, z)];
      quads.push(...(v0 ? q : [q[0], q[3], q[2], q[1]]));
    }
  }
  return { pos, quads };
}

/** SDF → 메시 (정점 투영 · 법선) */
function polygonize(S, sdf, bmin, bmax, h) {
  const pad = 2 * h;
  const o = [bmin[0] - pad, bmin[1] - pad, bmin[2] - pad];
  const n = [0, 1, 2].map((i) => Math.ceil((bmax[i] - bmin[i] + 2 * pad) / h / 4) * 4 + 1);
  const F = sampleGrid(sdf, o, n, h);
  const { pos, quads } = surfaceNets(F, n, o, h);
  const nv = pos.length / 3, P = new Float32Array(pos), N = new Float32Array(nv * 3);
  const e = h * 0.05;
  for (let i = 0; i < nv; i++) {
    let x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z);
      const gx = sdf(x + e, y, z) - d, gy = sdf(x, y + e, z) - d, gz = sdf(x, y, z + e) - d;
      const g2 = (gx * gx + gy * gy + gz * gz) / (e * e);
      if (g2 < 1e-6) break;
      let s = d / g2 / e;
      const step = Math.abs(d / Math.sqrt(g2));
      if (step > h * 0.7) s *= h * 0.7 / step;
      x -= gx * s; y -= gy * s; z -= gz * s;
      if (it === 1 || Math.abs(d) < h * 0.01) { const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1; N[i * 3] = gx / l; N[i * 3 + 1] = gy / l; N[i * 3 + 2] = gz / l; }
    }
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    // 최종 법선 (중심 차분)
    const ex = h * 0.12;
    const gx = sdf(x + ex, y, z) - sdf(x - ex, y, z), gy = sdf(x, y + ex, z) - sdf(x, y - ex, z), gz = sdf(x, y, z + ex) - sdf(x, y, z - ex);
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
    N[i * 3] = gx / l; N[i * 3 + 1] = gy / l; N[i * 3 + 2] = gz / l;
  }
  // 사각형 → 삼각형 (짧은 대각선), 법선 방향 확인
  const idx = [];
  const d2 = (a, b) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  const tri = (a, b, c) => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * fx + fy * fy + fz * fz < 1e-14) return;
    const s = fx * (N[a * 3] + N[b * 3] + N[c * 3]) + fy * (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) + fz * (N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2]);
    if (s >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  for (let q = 0; q < quads.length; q += 4) {
    const a = quads[q], b = quads[q + 1], c = quads[q + 2], d = quads[q + 3];
    if (d2(a, c) <= d2(b, d)) { tri(a, b, c); tri(a, c, d); } else { tri(a, b, d); tri(b, c, d); }
  }
  return { P, N, idx };
}

/* ───────────────────────── 메시 버퍼 ───────────────────────── */
class Buf {
  constructor() { this.p = []; this.n = []; this.bi = []; this.bw = []; this.zn = []; this.ms = []; this.idx = []; }
  get nv() { return this.p.length / 3; }
  vert(p, n, bones, zone, misc) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]);
    packWeights(bones, this.bi, this.bw);
    this.zn.push(zone[0], zone[1], zone[2], zone[3]); this.ms.push(misc[0], misc[1], misc[2], misc[3]);
    return this.nv - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  /** 지정 범위 정점 법선 재계산 (면적 가중) */
  normals(v0, i0) {
    const p = this.p, n = this.n;
    for (let i = v0 * 3; i < p.length; i++) n[i] = 0;
    for (let t = i0; t < this.idx.length; t += 3) {
      const a = this.idx[t] * 3, b = this.idx[t + 1] * 3, c = this.idx[t + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { n[k] += fx; n[k + 1] += fy; n[k + 2] += fz; }
    }
    for (let i = v0 * 3; i < p.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  }
  /** 격자형 패치 (rows×cols 정점, 닫힌 열이면 wrap) */
  grid(rows, cols, fn, wrap, flip) {
    const base = this.nv;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) fn(r, c);
    const cc = wrap ? cols : cols - 1;
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cc; c++) {
      const a = base + r * cols + c, b = base + r * cols + ((c + 1) % cols), d = a + cols, e = b + cols;
      if (flip) { this.tri(a, d, b); this.tri(b, d, e); } else { this.tri(a, b, d); this.tri(b, e, d); }
    }
    return base;
  }
}

/** [[bone, w], ...] → 상위 4개 정규화, 바이트 양자화 */
function packWeights(list, bi, bw) {
  const l = list.filter((e) => e[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
  let s = 0; for (const e of l) s += e[1];
  const q = l.map((e) => Math.round(e[1] / s * 255));
  let qs = q.reduce((a, b) => a + b, 0);
  q[0] += 255 - qs;
  for (let i = 0; i < 4; i++) { bi.push(l[i] ? l[i][0] : 0); bw.push(l[i] ? q[i] : 0); }
}

/* ───────────────────────── 정점 속성 (가중치 · 의복 구역 · AO) ───────────────────────── */
function vertexAttribs(S, P, x, y, z, nx, ny, nz) {
  const H = P.H, kg = 0.0045 * H, kw = 0.0125 * H;
  const acc = new Float64Array(NB);
  const gd = S.groups.map((G) => S.groupD(G, x, y, z));
  const m = Math.min(...gd);
  let fat = 0, fw = 0;
  for (let g = 0; g < 6; g++) {
    const wg = Math.exp(-(gd[g] - m) / kg);
    if (wg < 0.03) continue;
    const G = S.groups[g], ps = G.uni.concat(G.post);
    let mm = 1e9; const ds = ps.map((p) => { const d = p.d(x, y, z); if (d < mm) mm = d; return d; });
    let sum = 0; const ws = ds.map((d) => { const w = Math.exp(-(d - mm) / kw); sum += w; return w; });
    ps.forEach((p, i) => {
      const w = wg * ws[i] / sum;
      acc[p.bone] += w * (1 - p.w2);
      if (p.bone2 >= 0) acc[p.bone2] += w * p.w2;
      fat += w * p.fat; fw += w;
    });
  }
  const bones = [];
  for (let b = 0; b < NB; b++) if (acc[b] > 0.012) bones.push([b, acc[b]]);
  if (!bones.length) bones.push([0, 1]);
  return { bones, fat: fat / (fw || 1) };
}

function zoneOf(P, bones, x, y, z) {
  let tot = 0; for (const e of bones) tot += e[1];
  let arm = 0, leg = 0;
  for (const [b, w] of bones) {
    if ((b >= 6 && b <= 8) || (b >= 10 && b <= 12)) arm += w / tot;
    if (b >= 13) leg += w / tot;
  }
  const s = x >= 0 ? 1 : -1, b = sideB(s), J = P.J;
  const S = J[b.ua], u = V.norm(V.sub(J[b.fa], S));
  const tArm = V.dot(V.sub([x, y, z], S), u) / (P.uArm + P.fArm);
  const hip = J[b.th], ld = V.norm(V.sub(J[b.ft], hip));
  const tLeg = V.dot(V.sub([x, y, z], hip), ld) / V.len(V.sub(J[b.ft], hip));
  return [arm, tArm, leg, tLeg];
}

function aoAt(sdf, H, x, y, z, nx, ny, nz) {
  const st = 0.016 * H;
  let occ = 0, w = 1;
  for (let i = 1; i <= 5; i++) {
    const t = st * i;
    occ += (t - sdf(x + nx * t, y + ny * t, z + nz * t)) * w;
    w *= 0.55;
  }
  return clamp(1 - occ / (st * 2.2), 0.25, 1);
}

function addSurface(buf, S, P, mesh, part) {
  const { P: pos, N, idx } = mesh;
  const base = buf.nv;
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2], nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
    const { bones, fat } = vertexAttribs(S, P, x, y, z, nx, ny, nz);
    const zn = zoneOf(P, bones, x, y, z);
    const ao = aoAt(S.sdf, P.H, x, y, z, nx, ny, nz);
    buf.vert([x, y, z], [nx, ny, nz], bones, zn, [fat, part, ao, 0]);
  }
  for (const i of idx) buf.idx.push(base + i);
}

/* ───────────────────────── 손 (명시적) ───────────────────────── */
// 관 메시: 중심선 점·반지름(가로 rx, 세로 ry)·기준 법선, 끝 돔
function tube(buf, pts, rads, side, segs, attrs, capEnd, capStart) {
  const n = pts.length, rings = [];
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const t = V.norm(V.sub(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]));
    let nn = prevN ? V.norm(V.sub(prevN, V.mul(t, V.dot(prevN, t)))) : V.norm(V.sub(side, V.mul(t, V.dot(side, t))));
    prevN = nn;
    rings.push({ c: pts[i], t, n: nn, b: V.cross(t, nn), rx: rads[i][0], ry: rads[i][1] });
  }
  const ringVerts = (R, scale = 1, shift = 0) => {
    const base = buf.nv;
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const p = V.mad(V.mad(V.mad(R.c, R.n, ca * R.rx * scale), R.b, sa * R.ry * scale), R.t, shift);
      buf.vert(p, [0, 1, 0], attrs.bones(p), attrs.zone(p), attrs.misc(p, ca, sa));
    }
    return base;
  };
  const bases = rings.map((R) => ringVerts(R));
  const link = (b0, b1) => { for (let k = 0; k < segs; k++) { const k1 = (k + 1) % segs; buf.tri(b0 + k, b0 + k1, b1 + k); buf.tri(b0 + k1, b1 + k1, b1 + k); } };
  for (let i = 0; i < n - 1; i++) link(bases[i], bases[i + 1]);
  const dome = (R, dir, last) => {
    let prev = last;
    const steps = 3;
    for (let j = 1; j < steps; j++) {
      const a = (j / steps) * Math.PI / 2;
      const b = ringVerts(R, Math.cos(a), dir * Math.sin(a) * Math.min(R.rx, R.ry) * 1.05);
      if (dir > 0) link(prev, b); else link(b, prev);
      prev = b;
    }
    const tip = V.mad(R.c, R.t, dir * Math.min(R.rx, R.ry) * 1.05);
    const ti = buf.vert(tip, [0, 1, 0], attrs.bones(tip), attrs.zone(tip), attrs.misc(tip, 0, 0, 1));
    for (let k = 0; k < segs; k++) { const k1 = (k + 1) % segs; if (dir > 0) buf.tri(prev + k, prev + k1, ti); else buf.tri(prev + k1, prev + k, ti); }
  };
  if (capEnd) dome(rings[n - 1], 1, bases[n - 1]);
  if (capStart) dome(rings[0], -1, bases[0]);
}

function buildHand(buf, P, s, detail) {
  const b = sideB(s), W = P.J[b.hand], hl = P.handL;
  const u = V.norm(V.sub(P.E[b.hand], W));              // 손 방향(아래)
  const pal = [-Math.cos(P.alpha) * s, -Math.sin(P.alpha), 0]; // 손바닥 방향(몸 안쪽)
  const fwd = [0, 0, 1];                                  // 엄지 쪽
  const at = (a, bb, c) => V.add(W, V.add(V.mul(u, a * hl), V.add(V.mul(pal, bb * hl), V.mul(fwd, c * hl))));
  const armLen = P.uArm + P.fArm;
  const attrs = (nail) => ({
    bones: (p) => { const a = V.dot(V.sub(p, W), u) / hl; const w = smooth(-0.06, 0.06, a); return [[b.hand, w], [b.fa, 1 - w]]; },
    zone: (p) => [1, 1 + V.dot(V.sub(p, W), u) / armLen, 0, 0],
    misc: (p, ca, sa, tip) => [0.05, PART.hand, 1, nail ? nail(p, ca, sa, tip) : 0],
  });
  const v0 = buf.nv, i0 = buf.idx.length;
  // 손바닥: 초타원 단면 스윕
  const palmLen = 0.53, segs = detail === 2 ? 14 : 10;
  const pRows = detail === 2 ? 7 : 5;
  const A = attrs(null);
  const ringPts = [];
  for (let r = 0; r <= pRows; r++) {
    const t = r / pRows, a = lerp(-0.1, palmLen + (detail === 1 ? 0.0 : -0.02), t);
    const wdt = lerp(0.3, 0.42, smooth(0, 0.6, t)) * (1 - 0.12 * smooth(0.85, 1, t));
    const thk = lerp(0.15, 0.115, t);
    ringPts.push({ a, wdt, thk, ctr: lerp(0.0, 0.01, t) });
  }
  const pb = buf.nv;
  for (const R of ringPts) {
    for (let k = 0; k < segs; k++) {
      const ang = (k / segs) * Math.PI * 2, ca = Math.cos(ang), sa = Math.sin(ang);
      const e = 2.6, cx = Math.sign(ca) * Math.abs(ca) ** (2 / e), sx = Math.sign(sa) * Math.abs(sa) ** (2 / e);
      const p = at(R.a, cx * R.thk / 2 + 0.01, sx * R.wdt / 2 + R.ctr);
      buf.vert(p, [0, 1, 0], A.bones(p), A.zone(p), A.misc(p, ca, sa));
    }
  }
  for (let r = 0; r < pRows; r++) for (let k = 0; k < segs; k++) {
    const a = pb + r * segs + k, bq = pb + r * segs + (k + 1) % segs, c = a + segs, d = bq + segs;
    if (s > 0) { buf.tri(a, c, bq); buf.tri(bq, c, d); } else { buf.tri(a, bq, c); buf.tri(bq, d, c); }
  }
  // 손가락 끝면 닫기(손가락 안쪽에 묻힘) — 손가락 없는 벙어리 장갑은 둥근 끝
  const last = pb + pRows * segs;
  const endC = at(ringPts[pRows].a + (detail === 1 ? 0.06 : 0.02), 0.01, ringPts[pRows].ctr);
  const ec = buf.vert(endC, [0, 1, 0], A.bones(endC), A.zone(endC), A.misc(endC, 0, 0));
  for (let k = 0; k < segs; k++) { const a = last + k, bq = last + (k + 1) % segs; if (s > 0) buf.tri(a, ec, bq); else buf.tri(a, bq, ec); }
  const nailFn = (p, ca, sa, tip) => 0;
  if (detail === 2) {
    const fingers = [[0.115, 0.4, 0.05, 0.06, 0.2], [0.04, 0.45, 0.053, 0.0, 0.25], [-0.035, 0.42, 0.049, -0.05, 0.3], [-0.105, 0.33, 0.043, -0.12, 0.38]];
    for (const [c0, len, rad, spl, curl] of fingers) {
      const ph = [0.5, 0.29, 0.21].map((r) => r * len);
      let p = at(palmLen - 0.06, 0.0, c0), dir = V.norm(V.add(u, V.mul(fwd, spl)));
      const pts = [p], rads = [[rad * 1.05 * hl, rad * 0.95 * hl]];
      p = V.mad(p, dir, 0.06 * hl); pts.push(p); rads.push([rad * hl, rad * 0.9 * hl]);
      const curls = [curl * 0.7, curl * 1.4, curl * 0.8];
      for (let j = 0; j < 3; j++) {
        dir = V.norm(V.add(V.mul(dir, Math.cos(curls[j])), V.mul(pal, Math.sin(curls[j]))));
        const steps = 2;
        for (let q = 1; q <= steps; q++) {
          p = V.mad(p, dir, ph[j] / steps);
          pts.push(p);
          const rr = rad * lerp(1, 0.82, (j + q / steps) / 3) * hl;
          rads.push([rr, rr * 0.88]);
        }
      }
      const tipP = p;
      const fa = attrs((q) => { const d = V.len(V.sub(q, tipP)) / hl; const dors = -V.dot(V.sub(q, tipP), pal) / hl; return d < 0.07 && dors > -0.005 ? 1 : 0; });
      tube(buf, pts, rads, V.mul(pal, -1), 8, fa, true, false);
    }
  }
  // 엄지
  const tc = detail === 2 ? 0.0 : 0.0;
  let p = at(0.1, 0.03, 0.11 + tc), dir = V.norm(V.add(V.add(V.mul(u, 0.62), V.mul(fwd, 0.55)), V.mul(pal, 0.4)));
  const pts = [p], rads = [[0.085 * hl, 0.075 * hl]];
  const segL = [0.2, 0.17, 0.15], cu = [0.1, 0.35, 0.3];
  for (let j = 0; j < 3; j++) {
    dir = V.norm(V.add(V.mul(dir, Math.cos(cu[j])), V.mul(pal, Math.sin(cu[j]))));
    p = V.mad(p, dir, segL[j] * hl); pts.push(p);
    const rr = lerp(0.08, 0.055, (j + 1) / 3) * hl; rads.push([rr, rr * 0.9]);
  }
  const tipT = p;
  tube(buf, pts, rads, V.mul(pal, -1), detail === 2 ? 8 : 6, attrs((q) => (V.len(V.sub(q, tipT)) / hl < 0.07 && -V.dot(V.sub(q, tipT), pal) > 0 ? 1 : 0)), true, false);
  buf.normals(v0, i0);
}

/* ───────────────────────── 머리카락 · 모자 (머리 SDF 레이캐스트) ───────────────────────── */
function rayHit(sdf, o, d, maxT) {
  let t = 0, prev = sdf(o[0], o[1], o[2]);
  if (prev > 0) return 0;
  const st = maxT / 60;
  while (t < maxT) {
    const t2 = t + st, v = sdf(o[0] + d[0] * t2, o[1] + d[1] * t2, o[2] + d[2] * t2);
    if (v > 0) {
      let a = t, b = t2;
      for (let i = 0; i < 18; i++) { const m = (a + b) / 2; if (sdf(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m) > 0) b = m; else a = m; }
      return (a + b) / 2;
    }
    t = t2;
  }
  return maxT;
}
function gradN(sdf, p, e) {
  const gx = sdf(p[0] + e, p[1], p[2]) - sdf(p[0] - e, p[1], p[2]), gy = sdf(p[0], p[1] + e, p[2]) - sdf(p[0], p[1] - e, p[2]), gz = sdf(p[0], p[1], p[2] + e) - sdf(p[0], p[1], p[2] - e);
  return V.norm([gx, gy, gz]);
}
const sph = (th, ph) => [Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)];
// 방위각 → 경계 극각 (앞 0, 옆 ±π/2, 뒤 π)
function edgeFn(keys) {
  return (ph) => {
    let a = Math.abs(((ph + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
    for (let i = 0; i < keys.length - 1; i++) if (a <= keys[i + 1][0]) return lerp(keys[i][1], keys[i + 1][1], smooth(keys[i][0], keys[i + 1][0], a));
    return keys[keys.length - 1][1];
  };
}

/** 두피를 따라 덮는 껍질(머리카락 캡 · 모자 돔): 두께 함수, 가장자리 0 → 두피와 매끈하게 이어짐 */
function scalpShell(buf, S, P, o) {
  const hh = P.hh, c = V.add(P.hc, [0, 0.06 * hh, -0.05 * hh]);
  const nph = Math.max(8, Math.round(o.nph)), nth = Math.max(3, Math.round(o.nth));
  const v0 = buf.nv, i0 = buf.idx.length;
  const pts = [];
  const vtx = (th, ph, s) => {
    const d = sph(th, ph);
    const t = rayHit(S.headSdf, c, d, hh * 1.2);
    const sp = V.mad(c, d, t);
    const n = gradN(S.headSdf, sp, hh * 0.02);
    const nn = V.norm(V.add(V.mul(n, 0.7), V.mul(d, 0.3)));
    return V.mad(sp, nn, o.thick(s, ph, th) + (o.base || 0));
  };
  const attr = { bones: () => [[HEA, 1]], zone: () => [0, 0, 0, 0] };
  // 극점 + 고리
  const pole = vtx(0.001, 0, 0);
  const pi = buf.vert(pole, [0, 1, 0], attr.bones(), attr.zone(), [0, o.part, 1, o.flag ? o.flag(0, 0) : 0]);
  const rows = [];
  for (let i = 1; i <= nth; i++) {
    const row = [];
    for (let j = 0; j < nph; j++) {
      const ph = (j / nph) * Math.PI * 2, s = i / nth, th = o.edge(ph) * s;
      const p = vtx(th, ph, s);
      row.push(buf.vert(p, [0, 1, 0], attr.bones(), attr.zone(), [0, o.part, 1, o.flag ? o.flag(s, ph) : 0]));
    }
    rows.push(row);
  }
  for (let j = 0; j < nph; j++) buf.tri(pi, rows[0][j], rows[0][(j + 1) % nph]);
  for (let i = 0; i < nth - 1; i++) for (let j = 0; j < nph; j++) {
    const a = rows[i][j], b = rows[i][(j + 1) % nph], d = rows[i + 1][j], e = rows[i + 1][(j + 1) % nph];
    buf.tri(a, d, b); buf.tri(b, d, e);
  }
  // 두께가 있는 모자: 안쪽 면 + 테두리
  if (o.inner) {
    const inner = [];
    for (let j = 0; j < nph; j++) {
      const ph = (j / nph) * Math.PI * 2, th = o.edge(ph);
      inner.push(buf.vert(vtx(th, ph, 1.0001 - 0.0001), [0, 1, 0], attr.bones(), attr.zone(), [0, o.part, 0.6, o.flag ? o.flag(1, ph) : 0]));
    }
    const last = rows[nth - 1];
    for (let j = 0; j < nph; j++) {
      const a = last[j], b = last[(j + 1) % nph], d = inner[j], e = inner[(j + 1) % nph];
      buf.tri(a, d, b); buf.tri(b, d, e);
    }
  }
  buf.normals(v0, i0);
  const edgeRing = (k) => rows[nth - 1].map((vi) => [buf.p[vi * 3], buf.p[vi * 3 + 1], buf.p[vi * 3 + 2]]);
  return { c, rows, edgeRing };
}

/** 얇은 판(챙): 바깥 고리 점 배열 → 두께 있는 고리판 */
function brim(buf, inner, outer, thick, part, flag, bones) {
  const v0 = buf.nv, i0 = buf.idx.length, n = inner.length;
  const at = (p, up) => V.add(p, [0, up, 0]);
  const B = () => bones;
  const rows = [inner.map((p) => at(p, thick)), outer.map((p) => at(p, thick * 0.5)), outer.map((p) => at(p, -thick * 0.5)), inner.map((p) => at(p, -thick))];
  const ids = rows.map((r, ri) => r.map((p, j) => buf.vert(p, [0, 1, 0], B(), [0, 0, 0, 0], [0, part, ri === 3 ? 0.7 : 1, flag(j / n, ri)])));
  for (let r = 0; r < 3; r++) for (let j = 0; j < n; j++) {
    const a = ids[r][j], b = ids[r][(j + 1) % n], d = ids[r + 1][j], e = ids[r + 1][(j + 1) % n];
    buf.tri(a, d, b); buf.tri(b, d, e);
  }
  buf.normals(v0, i0);
}

function buildHair(buf, S, P, lod) {
  const hh = P.hh, sg = LODS[lod].seg, kid = P.k;
  const T = 0.055 * hh;
  // 1) 짧은 머리 캡
  const capEdge = edgeFn([[0, 0.95], [0.6, 1.2], [1.25, 1.62], [1.6, 1.52], [2.0, 1.95], [Math.PI, 2.2]]);
  scalpShell(buf, S, P, {
    part: PART.hairCap, nph: 44 * sg, nth: 14 * sg, edge: capEdge,
    thick: (s, ph, th) => T * (1 + 0.5 * Math.cos(th) - 0.2 * kid) * (1 - smooth(0.68, 1, s)) + 0.003 * hh,
    flag: (s) => s,
  });
  // 2) 긴 머리: 머리 뒤·옆으로 늘어지는 판
  {
    const v0 = buf.nv, i0 = buf.idx.length;
    const ax = [0, 0, P.hc[2] - 0.08 * hh];
    const yTop = P.hc[1] + 0.25 * hh, yEnd = P.shY - lerp(0.02, 0.06, P.f) * P.H;
    const nph = Math.round(30 * sg) + 4, nv = Math.round(16 * sg) + 4;
    const ph0 = 0.95, ph1 = Math.PI * 2 - 0.95;
    const outer = [], innerR = [];
    for (let j = 0; j < nph; j++) {
      const ph = lerp(ph0, ph1, j / (nph - 1));
      const d = [Math.sin(ph), 0, Math.cos(ph)];
      let rPrev = 0;
      const ring = [];
      for (let i = 0; i < nv; i++) {
        const t = i / (nv - 1);
        const y = lerp(yTop, yEnd + (Math.sin(ph * 7) * 0.02 - Math.abs(Math.cos(ph)) * 0.04) * P.H * 0.6, t);
        const o = [ax[0], y, ax[2]];
        // 바깥에서 안으로 들어오며 몸 표면 찾기
        let r = 0.45 * P.H * 0.5, st = 0.004 * P.H;
        while (r > 0.0 && S.trunkSdf(o[0] + d[0] * r, y, o[2] + d[2] * r) > 0) r -= st;
        const bodyR = Math.max(r, 0.02);
        let hr = Math.max(bodyR + 0.012 * hh, rPrev - (yTop - y > 0.2 * hh ? 0.004 : 0.02) * hh);
        if (i === 0) hr = bodyR + 0.03 * hh;
        rPrev = hr;
        const thick = lerp(0.07, 0.025, t) * hh;
        ring.push([V.mad(o, d, hr + thick), V.mad(o, d, hr), y]);
      }
      outer.push(ring);
    }
    const yNeck = P.chinY, yBase = P.neckY;
    const bones = (y) => {
      if (y > yNeck) return [[HEA, 1]];
      const t = smooth(yNeck, yBase - 0.03 * P.H, y);
      return t < 0.5 ? [[HEA, 1 - t], [NEC, t]] : [[NEC, 1 - t * 0.6], [CHE, t * 0.6]];
    };
    const ids = outer.map((ring) => ring.map(([po, pi, y]) => [
      buf.vert(po, [0, 1, 0], bones(y), [0, 0, 0, 0], [0, PART.hairLong, 1, 0.5]),
      buf.vert(pi, [0, 1, 0], bones(y), [0, 0, 0, 0], [0, PART.hairLong, 0.5, 0.5]),
    ]));
    for (let j = 0; j < nph - 1; j++) for (let i = 0; i < nv - 1; i++) {
      const a = ids[j][i], b = ids[j + 1][i], c = ids[j][i + 1], d = ids[j + 1][i + 1];
      buf.tri(a[0], c[0], b[0]); buf.tri(b[0], c[0], d[0]);
      buf.tri(a[1], b[1], c[1]); buf.tri(b[1], d[1], c[1]);
    }
    for (let j = 0; j < nph - 1; j++) { const a = ids[j][nv - 1], b = ids[j + 1][nv - 1]; buf.tri(a[0], a[1], b[0]); buf.tri(b[0], a[1], b[1]); }
    for (const j of [0, nph - 1]) for (let i = 0; i < nv - 1; i++) {
      const a = ids[j][i], c = ids[j][i + 1];
      if (j === 0) { buf.tri(a[0], a[1], c[0]); buf.tri(c[0], a[1], c[1]); } else { buf.tri(a[0], c[0], a[1]); buf.tri(c[0], c[1], a[1]); }
    }
    buf.normals(v0, i0);
  }
  // 3) 포니테일
  {
    const v0 = buf.nv, i0 = buf.idx.length;
    const c = V.add(P.hc, [0, 0.06 * hh, -0.05 * hh]);
    const d0 = sph(1.75, Math.PI);
    const p0 = V.mad(c, d0, rayHit(S.headSdf, c, d0, hh * 1.2) + 0.03 * hh);
    const pts = [p0, V.add(p0, [0, -0.05, -0.12].map((v) => v * hh)), V.add(p0, [0, -0.35, -0.2].map((v) => v * hh)), V.add(p0, [0, -0.7, -0.17].map((v) => v * hh)), V.add(p0, [0, -1.0, -0.1].map((v) => v * hh))];
    const rads = [[0.08, 0.07], [0.12, 0.1], [0.11, 0.09], [0.08, 0.07], [0.03, 0.03]].map((r) => [r[0] * hh, r[1] * hh]);
    const A = { bones: (p) => { const t = clamp((p0[1] - p[1]) / hh, 0, 1); return [[HEA, 1 - 0.4 * t], [NEC, 0.4 * t]]; }, zone: () => [0, 0, 0, 0], misc: () => [0, PART.ponytail, 1, 0.8] };
    tube(buf, pts, rads, [1, 0, 0], Math.max(6, Math.round(12 * sg)), A, true, true);
    buf.normals(v0, i0);
  }
  // 4) 올림머리(번)
  {
    const v0 = buf.nv, i0 = buf.idx.length;
    const c = V.add(P.hc, [0, 0.06 * hh, -0.05 * hh]);
    const d0 = sph(0.9, Math.PI);
    const ctr = V.mad(c, d0, rayHit(S.headSdf, c, d0, hh * 1.2) + 0.09 * hh);
    const nph = Math.max(6, Math.round(14 * sg)), nth = Math.max(4, Math.round(8 * sg));
    const r = [0.15 * hh, 0.13 * hh, 0.14 * hh];
    const A = [[HEA, 1]];
    buf.grid(nth + 1, nph, (i, j) => {
      const th = (i / nth) * Math.PI, ph = (j / nph) * Math.PI * 2;
      const d = sph(th, ph);
      const p = [ctr[0] + d[0] * r[0], ctr[1] + d[1] * r[1], ctr[2] + d[2] * r[2]];
      buf.vert(p, d, A, [0, 0, 0, 0], [0, PART.bun, 1, 0.9]);
    }, true, true);
    buf.normals(v0, i0);
  }
}

function buildHats(buf, S, P, lod) {
  const hh = P.hh, sg = LODS[lod].seg;
  const hairT = 0.09 * hh;
  // 야구모자
  {
    const edge = edgeFn([[0, 1.18], [1.3, 1.5], [Math.PI, 1.62]]);
    const sh = scalpShell(buf, S, P, { part: PART.cap, nph: 36 * sg, nth: 9 * sg, edge, thick: (s, ph, th) => hairT * (0.9 + 0.25 * Math.cos(th)), base: 0.012 * hh, inner: true, flag: (s) => (s < 0.06 ? 1 : 0) });
    // 챙: 앞쪽 가장자리에서 앞으로
    const ring = sh.edgeRing();
    const nph = ring.length, inner = [], outer = [];
    for (let j = 0; j < nph; j++) {
      const ph = (j / nph) * Math.PI * 2;
      if (Math.cos(ph) < 0.35) continue;
      const k = (Math.cos(ph) - 0.35) / 0.65;
      inner.push(ring[j]);
      const dir = V.norm([Math.sin(ph) * 0.8, -0.12, Math.cos(ph)]);
      outer.push(V.mad(ring[j], dir, (0.32 * Math.sqrt(k) + 0.02) * hh));
    }
    const order = inner.map((p, i) => [Math.atan2(p[0], p[2] - P.hc[2]), i]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    const ii = order.map((i) => inner[i]), oo = order.map((i) => outer[i]);
    // 열린 고리판 → 끝단 닫기 대신 내부를 바깥쪽 끝점과 합침
    oo[0] = ii[0]; oo[oo.length - 1] = ii[ii.length - 1];
    brimOpen(buf, ii, oo, 0.012 * hh, PART.cap, () => 2, [[HEA, 1]]);
  }
  // 챙 넓은 밀짚모자
  {
    const edge = edgeFn([[0, 1.32], [Math.PI, 1.38]]);
    const sh = scalpShell(buf, S, P, { part: PART.sunhat, nph: 36 * sg, nth: 8 * sg, edge, thick: (s, ph, th) => hairT * (1.0 + 0.6 * Math.cos(th) ** 2), base: 0.012 * hh, inner: true, flag: (s) => (s > 0.78 ? 1 : 0) });
    const ring = sh.edgeRing();
    const outer = ring.map((p, j) => {
      const ph = (j / ring.length) * Math.PI * 2;
      const dir = [Math.sin(ph), 0, Math.cos(ph)];
      return V.add(V.mad(p, dir, 0.42 * hh), [0, -0.1 * hh, 0]);
    });
    brim(buf, ring, outer, 0.01 * hh, PART.sunhat, () => 0, [[HEA, 1]]);
  }
  // 안전모
  {
    const edge = edgeFn([[0, 1.28], [1.4, 1.45], [Math.PI, 1.5]]);
    const sh = scalpShell(buf, S, P, { part: PART.helmet, nph: 36 * sg, nth: 9 * sg, edge, thick: (s, ph, th) => hairT * (1.1 + 0.9 * Math.cos(th) ** 2) + 0.06 * hh * Math.exp(-((Math.sin(th) * Math.sin(ph)) ** 2) / 0.004) * Math.cos(th) * 0.6, base: 0.02 * hh, inner: true, flag: () => 0 });
    const ring = sh.edgeRing();
    const outer = ring.map((p, j) => {
      const ph = (j / ring.length) * Math.PI * 2;
      const dir = [Math.sin(ph), 0, Math.cos(ph)];
      return V.add(V.mad(p, dir, (0.08 + 0.12 * Math.max(0, Math.cos(ph)) ** 3) * hh), [0, -0.02 * hh, 0]);
    });
    brim(buf, ring, outer, 0.014 * hh, PART.helmet, () => 0, [[HEA, 1]]);
  }
}

function brimOpen(buf, inner, outer, thick, part, flag, bones) {
  const v0 = buf.nv, i0 = buf.idx.length, n = inner.length;
  const at = (p, up) => V.add(p, [0, up, 0]);
  const rows = [inner.map((p) => at(p, thick * 0.5)), outer.map((p) => at(p, thick * 0.3)), outer.map((p) => at(p, -thick * 0.3)), inner.map((p) => at(p, -thick * 0.5))];
  const ids = rows.map((r, ri) => r.map((p, j) => buf.vert(p, [0, 1, 0], bones, [0, 0, 0, 0], [0, part, ri >= 2 ? 0.75 : 1, flag(j / n, ri)])));
  for (let r = 0; r < 3; r++) for (let j = 0; j < n - 1; j++) {
    const a = ids[r][j], b = ids[r][j + 1], d = ids[r + 1][j], e = ids[r + 1][j + 1];
    buf.tri(a, b, d); buf.tri(b, e, d);
  }
  buf.normals(v0, i0);
}

/* ───────────────────────── 치마 ───────────────────────── */
function buildSkirt(buf, S, P, lod) {
  const H = P.H, sg = LODS[lod].seg;
  const v0 = buf.nv, i0 = buf.idx.length;
  const yTop = P.waistY - 0.01 * H, yHem = P.kneeY + 0.02 * H;
  const nph = Math.max(10, Math.round(40 * sg)), nv = Math.max(4, Math.round(14 * sg));
  const radial = [];
  for (let j = 0; j < nph; j++) {
    const ph = (j / nph) * Math.PI * 2, d = [Math.sin(ph), 0, Math.cos(ph)];
    let rMax = 0, yMax = yTop;
    const col = [];
    for (let i = 0; i < nv; i++) {
      const t = i / (nv - 1), y = lerp(yTop, yHem, t);
      let r = 0.3 * H, st = 0.003 * H;
      while (r > 0.0 && S.trunkSdf(d[0] * r, y, d[2] * r - 0.004 * H) > 0) r -= st;
      r = Math.max(r, 0.02) + 0.008 * H;
      if (r > rMax) { rMax = r; yMax = y; }
      const hang = rMax + (yMax - y) * Math.tan(0.16);
      col.push(Math.max(r, hang));
    }
    radial.push(col);
  }
  const ids = [];
  const thick = 0.004 * H;
  for (let j = 0; j < nph; j++) {
    const ph = (j / nph) * Math.PI * 2, d = [Math.sin(ph), 0, Math.cos(ph)];
    const side = clamp(0.5 + d[0] * 0.9, 0, 1);  // +X(왼쪽) 쪽이면 왼다리
    const col = [];
    for (let i = 0; i < nv; i++) {
      const y = lerp(yTop, yHem, i / (nv - 1)), r = radial[j][i];
      const wt = smooth(P.hipY + 0.02 * H, yHem, y) * 0.85;
      const bones = [[PEL, 1 - wt], [13, wt * side], [16, wt * (1 - side)]];
      if (y > P.hipY + 0.05 * H) bones[0] = [PEL, 0.7], bones.push([SPI, 0.3]);
      const po = [d[0] * r, y, d[2] * r - 0.004 * H], pi = [d[0] * (r - thick), y, d[2] * (r - thick) - 0.004 * H];
      col.push([buf.vert(po, d, bones, [0, 0, 0, 0], [0.3, PART.skirt, 1, 0]), buf.vert(pi, d, bones, [0, 0, 0, 0], [0.3, PART.skirt, 0.5, 0])]);
    }
    ids.push(col);
  }
  for (let j = 0; j < nph; j++) {
    const j1 = (j + 1) % nph;
    for (let i = 0; i < nv - 1; i++) {
      const a = ids[j][i], b = ids[j1][i], c = ids[j][i + 1], d = ids[j1][i + 1];
      buf.tri(a[0], c[0], b[0]); buf.tri(b[0], c[0], d[0]);
      buf.tri(a[1], b[1], c[1]); buf.tri(b[1], d[1], c[1]);
    }
    const a = ids[j][nv - 1], b = ids[j1][nv - 1];
    buf.tri(a[0], a[1], b[0]); buf.tri(b[0], a[1], b[1]);
  }
  buf.normals(v0, i0);
}

/* ───────────────────────── 휴대폰 (오른손) ───────────────────────── */
function buildPhone(buf, P) {
  const s = -1, b = sideB(s), W = P.J[b.hand], hl = P.handL;
  const u = V.norm(V.sub(P.E[b.hand], W));
  const pal = [-Math.cos(P.alpha) * s, -Math.sin(P.alpha), 0];
  const fwd = V.norm(V.cross(u, pal));
  const c = V.add(W, V.add(V.mul(u, 0.62 * hl), V.mul(pal, 0.2 * hl)));
  const hx = 0.036, hy = 0.074, hz = 0.0045;   // 실제 크기(m)
  const v0 = buf.nv, i0 = buf.idx.length;
  const corners = [];
  for (const sz of [-1, 1]) for (const sy of [-1, 1]) for (const sx of [-1, 1]) corners.push(V.add(c, V.add(V.mul(fwd, sx * hx), V.add(V.mul(u, sy * hy), V.mul(pal, sz * hz)))));
  const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  for (const f of faces) {
    const ids = f.map((k) => buf.vert(corners[k], [0, 1, 0], [[b.hand, 1]], [0, 0, 0, 0], [0, PART.phone, 1, 0]));
    const pa = corners[f[0]], pb = corners[f[1]], pc = corners[f[2]];
    const nrm = V.norm(V.cross(V.sub(pb, pa), V.sub(pc, pa)));
    const cc = V.mul(V.add(V.add(corners[f[0]], corners[f[1]]), V.add(corners[f[2]], corners[f[3]])), 0.25);
    const out = V.dot(nrm, V.sub(cc, c)) > 0;
    if (out) { buf.tri(ids[0], ids[1], ids[2]); buf.tri(ids[0], ids[2], ids[3]); } else { buf.tri(ids[0], ids[2], ids[1]); buf.tri(ids[0], ids[3], ids[2]); }
    // 화면 쪽 표시 (손바닥 반대편이 화면)
    const scr = V.dot(V.norm(V.sub(cc, c)), pal) > 0.9 ? 1 : 0;
    for (const id of ids) buf.ms[id * 4 + 3] = scr;
  }
  buf.normals(v0, i0);
}

/* ───────────────────────── 조립 ───────────────────────── */
const cache = new Map();
const infoCache = new Map();

/** 변형별 골격·치수 정보 (bind 자세, 사람 단위계 m) */
export function variantInfo(name) {
  if (infoCache.has(name)) return infoCache.get(name);
  const P = variantParams(name), H = P.H;
  const joints = new Float32Array(NB * 3), ends = new Float32Array(NB * 3), lengths = new Float32Array(NB), radii = new Float32Array(NB);
  for (let b = 0; b < NB; b++) {
    joints.set(P.J[b], b * 3); ends.set(P.E[b], b * 3);
    lengths[b] = V.len(V.sub(P.E[b], P.J[b]));
  }
  const R = { 0: P.hipW * 0.85, 1: P.waistW * 0.9, 2: P.chestW * 0.85, 3: P.neckR, 4: P.hh * 0.36 };
  for (const s of [1, -1]) { const b = sideB(s); R[b.clav] = 0.03 * H; R[b.ua] = P.uArmR; R[b.fa] = P.fArmR * 0.9; R[b.hand] = 0.022 * H; R[b.th] = P.thighR * 0.85; R[b.sh] = P.calfR * 0.9; R[b.ft] = 0.025 * H; }
  for (let b = 0; b < NB; b++) radii[b] = R[b];
  const hh = P.hh;
  const info = {
    name, H, P, joints, ends, lengths, radii,
    // 셰이더용 랜드마크
    land: {
      hipY: P.hipY, crotchY: P.crotchY, waistY: P.waistY, shY: P.shY, neckY: P.neckY, chinY: P.chinY, kneeY: P.kneeY, ankleY: P.ankleY,
      bustY: P.shY - 0.09 * H, shX: P.shX, hipW: P.hipW, chestD: P.chestD, sex: P.f, kid: P.k,
    },
    head: { c: P.hc.slice(), hh, eyeY: P.eyeY },
  };
  infoCache.set(name, info);
  return info;
}

/** 변형 × LOD 지오메트리 (지연 생성 · 캐시) */
export function buildGeometry(name, lod) {
  const key = name + lod;
  if (cache.has(key)) return cache.get(key);
  const t0 = performance.now();
  const info = variantInfo(name), P = info.P, L = LODS[lod], H = P.H;
  const h = L.h * P.sc;
  const S = buildSDF(P, { sdfHands: L.hands === 0, inflate: L.inflate * P.sc });
  const buf = new Buf();
  if (L.hHead) {
    // 몸(목 위 절단) + 정밀 머리(목 아래 절단) — 겹치는 목 구간에서 같은 SDF 표면을 공유
    const yb = P.chinY - 0.012 * H, ya = P.chinY - 0.032 * H;
    const Sb = buildSDF(P, { sdfHands: false, inflate: 0, cut: { below: yb } });
    const body = polygonize(Sb, Sb.sdf, S.bmin, [S.bmax[0], yb + 2 * h, S.bmax[2]], h);
    addSurface(buf, S, P, body, PART.body);
    const hw = 0.62 * P.hh;
    const box = [-hw, ya - 0.01, P.hc[2] - 0.75 * P.hh, hw, H + 0.01, P.hc[2] + 0.75 * P.hh];
    const Sh = buildSDF(P, { sdfHands: false, inflate: 0, cut: { above: ya, box } });
    const head = polygonize(Sh, Sh.sdf, [box[0], ya - 0.004, box[2]], [box[3], box[4], box[5]], L.hHead * P.sc);
    addSurface(buf, S, P, head, PART.body);
  } else {
    addSurface(buf, S, P, polygonize(S, S.sdf, S.bmin, S.bmax, h), PART.body);
  }
  if (L.hands) for (const s of [1, -1]) buildHand(buf, P, s, L.hands);
  buildHair(buf, S, P, lod);
  buildHats(buf, S, P, lod);
  buildSkirt(buf, S, P, lod);
  buildPhone(buf, P);
  // 부속 정점 AO 보정
  const g = new THREE.BufferGeometry();
  const nv = buf.nv;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf.p), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(buf.n), 3));
  g.setAttribute('aBoneIdx', new THREE.BufferAttribute(new Uint8Array(buf.bi), 4));
  g.setAttribute('aBoneW', new THREE.BufferAttribute(new Uint8Array(buf.bw), 4, true));
  g.setAttribute('aZone', new THREE.BufferAttribute(new Float32Array(buf.zn), 4));
  g.setAttribute('aMisc', new THREE.BufferAttribute(new Float32Array(buf.ms), 4));
  g.setIndex(nv > 65535 ? new THREE.BufferAttribute(new Uint32Array(buf.idx), 1) : new THREE.BufferAttribute(new Uint16Array(buf.idx), 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, H / 2, 0), H);
  g.userData = { variant: name, lod, tris: buf.idx.length / 3, verts: nv, ms: performance.now() - t0 };
  cache.set(key, g);
  return g;
}
