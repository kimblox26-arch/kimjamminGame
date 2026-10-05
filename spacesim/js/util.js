// SpaceSim — 공용 수학/단위 유틸리티
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const G_AU = 4 * Math.PI * Math.PI;      // AU³ / (M☉ · yr²)
export const AU_KM = 149597870.7;
export const AUYR_KMS = AU_KM / (365.25 * 86400); // 1 AU/yr → km/s (≈4.74)
export const MSUN_MEARTH = 332946.0487;
export const MSUN_MJUP = 1047.348644;
export const RSUN_KM = 695700;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gauss(r) {
  const u = Math.max(r(), 1e-12), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

export const isMobile = (() => {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
})();

// 흑체 복사 색 (Tanner Helland 근사) → 선형 RGB
export function blackbody(T, out = new THREE.Color()) {
  const t = clamp(T, 1000, 40000) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 1;
    g = clamp(0.39008157876 * Math.log(t) - 0.63184144378, 0, 1);
    b = t <= 19 ? 0 : clamp(0.54320678911 * Math.log(t - 10) - 1.19625408914, 0, 1);
  } else {
    r = clamp(1.29293618606 * Math.pow(t - 60, -0.1332047592), 0, 1);
    g = clamp(1.12989086089 * Math.pow(t - 60, -0.0755148492), 0, 1);
    b = 1;
  }
  return out.setRGB(r, g, b, THREE.SRGBColorSpace);
}

// 주계열성 근사: 질량(M☉) → 온도(K)
export const massToTemp = (m) => clamp(5772 * Math.pow(m, m < 1 ? 0.62 : 0.5), 2600, 42000);

// 황도 좌표(x, y, z=북) → 장면 좌표(y-up)
export const ecl = (x, y, z) => [x, z, -y];

// 케플러 궤도 요소 → 상태 벡터 (황도 좌표계, 라디안)
export function keplerToState(a, e, inc, node, argp, M, mu) {
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 50; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  const cE = Math.cos(E), sE = Math.sin(E), sq = Math.sqrt(1 - e * e);
  const xv = a * (cE - e), yv = a * sq * sE;
  const n = Math.sqrt(mu / (a * a * a)), den = 1 - e * cE;
  const vxv = (-a * n * sE) / den, vyv = (a * n * sq * cE) / den;
  const cO = Math.cos(node), sO = Math.sin(node), cw = Math.cos(argp), sw = Math.sin(argp);
  const ci = Math.cos(inc), si = Math.sin(inc);
  const R11 = cO * cw - sO * sw * ci, R12 = -cO * sw - sO * cw * ci;
  const R21 = sO * cw + cO * sw * ci, R22 = -sO * sw + cO * cw * ci;
  const R31 = sw * si, R32 = cw * si;
  return {
    p: [R11 * xv + R12 * yv, R21 * xv + R22 * yv, R31 * xv + R32 * yv],
    v: [R11 * vxv + R12 * vyv, R21 * vxv + R22 * vyv, R31 * vxv + R32 * vyv],
  };
}

// 상대 상태 벡터(장면 좌표) → 접촉 궤도 요소
const _h = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3();
export function orbitalElements(r, v, mu) {
  const rl = r.length(), v2 = v.lengthSq();
  _h.crossVectors(r, v);
  const h = _h.length();
  _e.crossVectors(v, _h).divideScalar(mu).addScaledVector(r, -1 / rl);
  const e = _e.length();
  const energy = v2 / 2 - mu / rl;
  const a = -mu / (2 * energy);
  const inc = h > 0 ? Math.acos(clamp(_h.y / h, -1, 1)) : 0;
  const period = a > 0 ? TAU * Math.sqrt((a * a * a) / mu) : Infinity;
  return { a, e, inc, period, h, hVec: _h.clone(), eVec: _e.clone(), p: (h * h) / mu, energy };
}

// 궤도 타원 점 생성 (주천체 기준 상대 좌표)
export function ellipsePoints(el, out, count, scale = 1) {
  const P = new THREE.Vector3(), Q = new THREE.Vector3(), hn = el.hVec.clone().normalize();
  if (el.e > 1e-6) P.copy(el.eVec).normalize();
  else P.set(1, 0, 0).addScaledVector(hn, -hn.x).normalize();
  Q.crossVectors(hn, P);
  for (let k = 0; k < count; k++) {
    const nu = (k / count) * TAU;
    const rr = (el.p / (1 + el.e * Math.cos(nu))) * scale;
    _t.copy(P).multiplyScalar(Math.cos(nu) * rr).addScaledVector(Q, Math.sin(nu) * rr);
    out[k * 3] = _t.x; out[k * 3 + 1] = _t.y; out[k * 3 + 2] = _t.z;
  }
}

export function fmtNum(x, d = 3) {
  if (!isFinite(x)) return '∞';
  const ax = Math.abs(x);
  if (ax !== 0 && (ax < 1e-3 || ax >= 1e6)) {
    const ex = Math.floor(Math.log10(ax));
    return `${(x / 10 ** ex).toFixed(2)}×10${sup(ex)}`;
  }
  return x.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = (n) => String(n).split('').map((c) => SUP[c] ?? c).join('');

export function fmtDuration(yr) {
  const d = yr * 365.25;
  if (d < 1) return `${(d * 24).toFixed(1)}시간`;
  if (d < 60) return `${d.toFixed(1)}일`;
  if (yr < 2) return `${(yr * 12).toFixed(1)}개월`;
  if (yr < 1e4) return `${yr.toFixed(yr < 20 ? 2 : 1)}년`;
  if (yr < 1e6) return `${(yr / 1e3).toFixed(1)}천 년`;
  if (yr < 1e8) return `${(yr / 1e6).toFixed(2)}백만 년`;
  return `${(yr / 1e8).toFixed(2)}억 년`;
}

export function fmtMass(mSun) {
  const me = mSun * MSUN_MEARTH;
  if (me < 0.05) return `${fmtNum(me * 81.3, 3)} M☾`;
  if (me < 50) return `${fmtNum(me, 3)} M⊕`;
  if (mSun < 0.05) return `${fmtNum(mSun * MSUN_MJUP, 3)} M♃`;
  return `${fmtNum(mSun, 4)} M☉`;
}
