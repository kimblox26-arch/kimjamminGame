// 물리 상수 · 케플러 궤도 요소 변환 (SI 단위, 황도 J2000 좌표계: x=춘분점, z=황도 북극)
export const G = 6.6743e-11, C = 299792458, G0 = 9.80665;
export const AU = 1.495978707e11, DAY = 86400, YEAR = 365.25 * DAY, KPC = 3.0857e19;
export const MSUN = 1.98847e30, RSUN = 6.957e8, LSUN = 3.828e26;
export const MEARTH = 5.97237e24, REARTH = 6.371e6, MJUP = 1.89819e27, RJUP = 6.9911e7;
export const D2R = Math.PI / 180, TAU = Math.PI * 2;

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// 행성 자전축 기울기 프레임: (0,0,1) → (0, sin t, cos t)
export function tiltVec(v, t) {
  const c = Math.cos(t), s = Math.sin(t);
  return [v[0], v[1] * c + v[2] * s, -v[1] * s + v[2] * c];
}

export function solveKepler(M, e) {
  M = ((M % TAU) + TAU) % TAU;
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 40; k++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

function basis(i, O, w) {
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  return [
    [cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si],
    [-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si],
  ];
}

// 궤도 요소 → 상태 벡터 (각도는 라디안)
export function elementsToState(mu, a, e, i, O, w, M) {
  const E = solveKepler(M, e), cE = Math.cos(E), sE = Math.sin(E), q = Math.sqrt(1 - e * e);
  const n = Math.sqrt(mu / (a * a * a)), k = 1 - e * cE;
  const x = a * (cE - e), y = a * q * sE, vx = -a * n * sE / k, vy = a * n * q * cE / k;
  const [P, Q] = basis(i, O, w);
  return {
    r: [x * P[0] + y * Q[0], x * P[1] + y * Q[1], x * P[2] + y * Q[2]],
    v: [vx * P[0] + vy * Q[0], vx * P[1] + vy * Q[1], vx * P[2] + vy * Q[2]],
  };
}

// 상태 벡터 → 접촉 궤도 요소
export function stateToElements(mu, r, v) {
  const rm = len(r), v2 = dot(v, v), rv = dot(r, v), h = cross(r, v), hm = len(h) || 1e-30;
  const ev = mul(sub(mul(r, v2 - mu / rm), mul(v, rv)), 1 / mu), e = len(ev);
  const energy = v2 / 2 - mu / rm, a = -mu / (2 * energy);
  const i = Math.acos(Math.max(-1, Math.min(1, h[2] / hm)));
  const nv = [-h[1], h[0], 0], nm = len(nv);
  const O = nm > 1e-12 * hm ? Math.atan2(nv[1], nv[0]) : 0;
  const hn = mul(h, 1 / hm);
  const P = e > 1e-9 ? mul(ev, 1 / e) : (nm > 1e-12 * hm ? mul(nv, 1 / nm) : norm(r));
  const Q = cross(hn, P);
  let w = 0;
  if (e > 1e-9) w = nm > 1e-12 * hm ? Math.atan2(dot(cross(norm(nv), P), hn), dot(norm(nv), P)) : Math.atan2(ev[1], ev[0]);
  const nu = Math.atan2(dot(r, Q), dot(r, P));
  const p = hm * hm / mu;
  return {
    a, e, i, O, w, nu, P, Q, h: hn, p,
    pe: p / (1 + e), ap: e < 1 ? p / (1 - e) : Infinity,
    period: e < 1 ? TAU * Math.sqrt(a * a * a / mu) : Infinity,
  };
}

// 궤도 곡선 점 (초점 기준, 물리 좌표) → Float64Array
export function orbitPoints(el, n, rmax) {
  const out = new Float64Array(n * 3);
  const { e, p, P, Q } = el;
  let n0 = -Math.PI, n1 = Math.PI;
  if (e >= 1) {
    const lim = Math.acos(-1 / e) * 0.999;
    let nr = lim;
    if (rmax) { const c = (p / rmax - 1) / e; if (c > -1 && c < 1) nr = Math.min(lim, Math.acos(c)); }
    n0 = -nr; n1 = nr;
  }
  for (let k = 0; k < n; k++) {
    let nu;
    if (e < 1) { // 이심 이상으로 균일 샘플
      const E = -Math.PI + TAU * k / (n - 1);
      nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
    } else nu = n0 + (n1 - n0) * k / (n - 1);
    const r = p / (1 + e * Math.cos(nu)), x = r * Math.cos(nu), y = r * Math.sin(nu);
    out[k * 3] = x * P[0] + y * Q[0]; out[k * 3 + 1] = x * P[1] + y * Q[1]; out[k * 3 + 2] = x * P[2] + y * Q[2];
  }
  return out;
}

// 결정론적 난수
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(TAU * r());

// 흑체 온도(K) → RGB (0..1)
export function blackbody(T) {
  const t = T / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = x => Math.max(0, Math.min(255, x)) / 255;
  return [c(r), c(g), c(b)];
}
