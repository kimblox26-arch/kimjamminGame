// SpaceSim — 케플러 궤도 역학
// 상태벡터 ↔ 궤도요소 변환, 케플러 방정식 해법, 궤도 샘플링.

import { TAU, DEG, RAD } from '../core/constants.js';

/** 케플러 방정식 M = E - e sinE 를 뉴턴-랩슨으로 해석 (타원, e < 1) */
export function solveKeplerElliptic(M, e, tol = 1e-12) {
  M = ((M % TAU) + TAU) % TAU;
  if (M > Math.PI) M -= TAU;
  // Danby 초기값
  let E = M + e * Math.sin(M) / (1 - Math.sin(M + e) + Math.sin(M));
  if (!isFinite(E)) E = M;
  for (let i = 0; i < 60; i++) {
    const s = Math.sin(E), c = Math.cos(E);
    const f = E - e * s - M;
    const fp = 1 - e * c;
    const fpp = e * s;
    const fppp = e * c;
    // Halley / 3차 보정
    let d = -f / fp;
    d = -f / (fp + 0.5 * d * fpp);
    d = -f / (fp + 0.5 * d * fpp + d * d * fppp / 6);
    E += d;
    if (Math.abs(d) < tol) break;
  }
  return E;
}

/** 쌍곡선 케플러 방정식 M = e sinh H - H */
export function solveKeplerHyperbolic(M, e, tol = 1e-12) {
  let H = Math.asinh(M / e) || M;
  for (let i = 0; i < 100; i++) {
    const f = e * Math.sinh(H) - H - M;
    const fp = e * Math.cosh(H) - 1;
    const d = -f / fp;
    H += d;
    if (Math.abs(d) < tol) break;
  }
  return H;
}

/** 진근점이각 ← 이심근점이각 */
export function trueFromEccentric(E, e) {
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
}

/**
 * 궤도요소 → 상태벡터 (근사적 2체 문제)
 * @param {number} mu  G(M+m)
 * @param {object} el  { a, e, i, Omega, omega, M0 }  각도는 deg, a는 AU
 * @returns {{r:number[], v:number[]}}
 */
export function stateFromElements(mu, el) {
  const a = el.a;
  const e = el.e ?? 0;
  const i = (el.i ?? 0) * DEG;
  const Om = (el.Omega ?? 0) * DEG;
  const w = (el.omega ?? 0) * DEG;
  const M = (el.M0 ?? 0) * DEG;

  let xp, yp, vxp, vyp;
  if (e < 1) {
    const E = solveKeplerElliptic(M, e);
    const cE = Math.cos(E), sE = Math.sin(E);
    const r = a * (1 - e * cE);
    xp = a * (cE - e);
    yp = a * Math.sqrt(1 - e * e) * sE;
    const n = Math.sqrt(mu / (a * a * a));
    const f = a * a * n / r;
    vxp = -f * sE;
    vyp = f * Math.sqrt(1 - e * e) * cE;
  } else {
    const H = solveKeplerHyperbolic(M, e);
    const cH = Math.cosh(H), sH = Math.sinh(H);
    const aa = -Math.abs(a);
    const r = aa * (1 - e * cH);
    xp = aa * (cH - e);
    yp = -aa * Math.sqrt(e * e - 1) * sH;
    const n = Math.sqrt(mu / Math.abs(aa * aa * aa));
    const f = aa * aa * n / r;
    vxp = -f * sH;
    vyp = f * Math.sqrt(e * e - 1) * cH;
  }

  // 근점편각 → 승교점 → 경사 회전 (3-1-3 오일러)
  const cw = Math.cos(w), sw = Math.sin(w);
  const cO = Math.cos(Om), sO = Math.sin(Om);
  const ci = Math.cos(i), si = Math.sin(i);

  const R = [
    cO * cw - sO * sw * ci, -cO * sw - sO * cw * ci, sO * si,
    sO * cw + cO * sw * ci, -sO * sw + cO * cw * ci, -cO * si,
    sw * si, cw * si, ci,
  ];
  const rot = (x, y) => [R[0] * x + R[1] * y, R[3] * x + R[4] * y, R[6] * x + R[7] * y];
  return { r: rot(xp, yp), v: rot(vxp, vyp) };
}

/**
 * 상태벡터 → 궤도요소
 * @param {number} mu G(M+m)
 * @param {number[]} r 상대 위치 [AU]
 * @param {number[]} v 상대 속도 [AU/day]
 */
export function elementsFromState(mu, r, v) {
  const rx = r[0], ry = r[1], rz = r[2];
  const vx = v[0], vy = v[1], vz = v[2];
  const R = Math.hypot(rx, ry, rz);
  const V2 = vx * vx + vy * vy + vz * vz;

  // 각운동량
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const h = Math.hypot(hx, hy, hz);

  // 이심률 벡터
  const rv = rx * vx + ry * vy + rz * vz;
  const ex = (V2 - mu / R) * rx / mu - rv * vx / mu;
  const ey = (V2 - mu / R) * ry / mu - rv * vy / mu;
  const ez = (V2 - mu / R) * rz / mu - rv * vz / mu;
  const e = Math.hypot(ex, ey, ez);

  const energy = V2 / 2 - mu / R;
  const a = Math.abs(energy) < 1e-18 ? Infinity : -mu / (2 * energy);
  const inc = Math.acos(Math.min(1, Math.max(-1, hz / h)));

  // 승교점 벡터 n = ẑ × h
  const nx = -hy, ny = hx;
  const n = Math.hypot(nx, ny);
  let Om = n > 1e-12 ? Math.atan2(ny, nx) : 0;
  if (Om < 0) Om += TAU;

  let w = 0;
  if (n > 1e-12 && e > 1e-12) {
    w = Math.acos(Math.min(1, Math.max(-1, (nx * ex + ny * ey) / (n * e))));
    if (ez < 0) w = TAU - w;
  } else if (e > 1e-12) {
    w = Math.atan2(ey, ex);
  }

  let nu = 0;
  if (e > 1e-12) {
    nu = Math.acos(Math.min(1, Math.max(-1, (ex * rx + ey * ry + ez * rz) / (e * R))));
    if (rv < 0) nu = TAU - nu;
  } else {
    nu = Math.atan2(ry * hx - rx * hy, R * hz) || Math.atan2(ry, rx);
  }

  let M = 0, E = 0;
  if (e < 1) {
    E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
    M = E - e * Math.sin(E);
    if (M < 0) M += TAU;
  } else {
    const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
    M = e * Math.sinh(H) - H;
  }

  const period = e < 1 && isFinite(a) ? TAU * Math.sqrt(a * a * a / mu) : Infinity;

  return {
    a, e,
    i: inc * RAD,
    Omega: Om * RAD,
    omega: ((w % TAU) + TAU) % TAU * RAD,
    nu: ((nu % TAU) + TAU) % TAU * RAD,
    M: M * RAD,
    period,
    periapsis: a * (1 - e),
    apoapsis: e < 1 ? a * (1 + e) : Infinity,
    energy, h,
    r: R,
    v: Math.sqrt(V2),
    vEscape: Math.sqrt(2 * mu / R),
  };
}

/** 궤도 전체를 N개 점으로 샘플링 (타원/쌍곡선 모두) */
export function sampleOrbit(mu, r, v, segments = 256) {
  const el = elementsFromState(mu, r, v);
  const pts = [];
  if (!isFinite(el.a) || el.a === 0) return pts;

  if (el.e < 1) {
    for (let k = 0; k <= segments; k++) {
      const E = (k / segments) * TAU;
      pts.push(...perifocalToInertial(el, el.a * (Math.cos(E) - el.e),
        el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E)));
    }
  } else {
    const Hmax = Math.acosh(Math.min(50, 1 + 8 / Math.max(0.05, el.e - 1)));
    const aa = -Math.abs(el.a);
    for (let k = 0; k <= segments; k++) {
      const H = -Hmax + (2 * Hmax * k) / segments;
      pts.push(...perifocalToInertial(el, aa * (Math.cosh(H) - el.e),
        -aa * Math.sqrt(el.e * el.e - 1) * Math.sinh(H)));
    }
  }
  return pts;
}

function perifocalToInertial(el, xp, yp) {
  const i = el.i * DEG, Om = el.Omega * DEG, w = el.omega * DEG;
  const cw = Math.cos(w), sw = Math.sin(w);
  const cO = Math.cos(Om), sO = Math.sin(Om);
  const ci = Math.cos(i), si = Math.sin(i);
  return [
    (cO * cw - sO * sw * ci) * xp + (-cO * sw - sO * cw * ci) * yp,
    (sO * cw + cO * sw * ci) * xp + (-sO * sw + cO * cw * ci) * yp,
    (sw * si) * xp + (cw * si) * yp,
  ];
}

/** 힐 반경 — 위성이 안정적으로 머무를 수 있는 거리 */
export function hillRadius(a, e, m, M) {
  return a * (1 - e) * Math.cbrt(m / (3 * (M + m)));
}

/** 로슈 한계 (유체 위성 기준) */
export function rocheLimit(Rprimary, densPrimary, densSat) {
  return 2.44 * Rprimary * Math.cbrt(densPrimary / densSat);
}

/** 원형 궤도 속도 */
export const circularSpeed = (mu, r) => Math.sqrt(mu / r);

/** 비스비바 방정식 */
export const visViva = (mu, r, a) => Math.sqrt(mu * (2 / r - 1 / a));
