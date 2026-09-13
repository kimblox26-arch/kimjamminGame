// ORBITER — 2차원 케플러 궤도역학
//
// 좌표계: 천체 중심 관성좌표(BCI). x 오른쪽, y 위, 각도는 반시계 방향.
// 2D 이므로 궤도면이 하나뿐이라 경사각(i)·승교점(Ω)이 사라지고
// 궤도 요소는 { a, e, argPe(근점편각), M0(기준시각 평균근점이각), dir(진행방향) } 로 줄어든다.

import {
  TAU,
  PI,
  wrapPi,
  wrapTau,
  clamp,
  sign,
  Vec2,
  vLen,
  vNorm,
  vRot,
  newton,
  bisect,
} from '../core/math.js';
import { ECC_EPSILON, PARABOLIC_BAND } from './constants.js';

/* ──────────────────────────────────────────────────────────────
 * 케플러 방정식 풀이
 * ────────────────────────────────────────────────────────────── */

/**
 * 타원 궤도 케플러 방정식 M = E - e·sinE 를 E 에 대해 푼다.
 * 고이심률에서도 수렴하도록 초기 추정을 신중히 고른다.
 */
export function solveKeplerElliptic(M, e, tol = 1e-11) {
  M = wrapPi(M);
  if (e < ECC_EPSILON) return M;

  // Danby 초기 추정
  let E = M + (e * Math.sin(M)) / (1 - Math.sin(M + e) + Math.sin(M));
  if (e > 0.8) E = M > 0 ? PI : -PI;

  for (let i = 0; i < 80; i++) {
    const sinE = Math.sin(E);
    const cosE = Math.cos(E);
    const f = E - e * sinE - M;
    if (Math.abs(f) < tol) return E;
    const fp = 1 - e * cosE;
    const fpp = e * sinE;
    const fppp = e * cosE;
    // Halley/Danby 3차 보정
    let d = -f / fp;
    d = -f / (fp + 0.5 * d * fpp);
    d = -f / (fp + 0.5 * d * fpp + (d * d * fppp) / 6);
    E += d;
    if (Math.abs(d) < tol) return E;
  }
  return E;
}

/**
 * 쌍곡선 궤도 케플러 방정식 M = e·sinhH - H 를 H 에 대해 푼다.
 */
export function solveKeplerHyperbolic(M, e, tol = 1e-11) {
  let H;
  if (Math.abs(M) < 6) {
    H = M / (e - 1);
    if (Math.abs(H) > 1) H = sign(M) * Math.log((2 * Math.abs(M)) / e + 1.8);
  } else {
    H = sign(M) * Math.log((2 * Math.abs(M)) / e + 1.8);
  }
  for (let i = 0; i < 100; i++) {
    const sh = Math.sinh(H);
    const ch = Math.cosh(H);
    const f = e * sh - H - M;
    if (Math.abs(f) < tol) return H;
    const fp = e * ch - 1;
    if (Math.abs(fp) < 1e-14) break;
    const d = -f / fp;
    H += clamp(d, -2, 2);
    if (Math.abs(d) < tol) return H;
  }
  return H;
}

/* 이심근점이각 ↔ 진근점이각 ↔ 평균근점이각 변환 */

export function eccentricToTrue(E, e) {
  if (e < 1) {
    const s = Math.sqrt(1 - e * e) * Math.sin(E);
    const c = Math.cos(E) - e;
    return Math.atan2(s, c);
  }
  // 쌍곡선: E 는 H
  const s = Math.sqrt(e * e - 1) * Math.sinh(E);
  const c = e - Math.cosh(E);
  return Math.atan2(s, c);
}

export function trueToEccentric(nu, e) {
  if (e < 1) {
    const s = Math.sqrt(1 - e * e) * Math.sin(nu);
    const c = e + Math.cos(nu);
    return Math.atan2(s, c);
  }
  const denom = 1 + e * Math.cos(nu);
  if (denom <= 0) return NaN; // 점근선 너머 — 도달 불가
  const sinhH = (Math.sqrt(e * e - 1) * Math.sin(nu)) / denom;
  return Math.asinh(sinhH);
}

export function eccentricToMean(E, e) {
  if (e < 1) return E - e * Math.sin(E);
  return e * Math.sinh(E) - E;
}

export function meanToEccentric(M, e) {
  return e < 1 ? solveKeplerElliptic(M, e) : solveKeplerHyperbolic(M, e);
}

export function trueToMean(nu, e) {
  const E = trueToEccentric(nu, e);
  if (Number.isNaN(E)) return NaN;
  return eccentricToMean(E, e);
}

export function meanToTrue(M, e) {
  return eccentricToTrue(meanToEccentric(M, e), e);
}

/* ──────────────────────────────────────────────────────────────
 * 궤도 클래스
 * ────────────────────────────────────────────────────────────── */

export class Orbit {
  /**
   * @param {object} el 궤도 요소
   * @param {number} el.mu 중심 천체의 중력변수 (GM)
   * @param {number} el.a  긴반지름 (쌍곡선은 음수)
   * @param {number} el.e  이심률
   * @param {number} el.argPe 근점편각 (rad, +x 기준)
   * @param {number} el.M0 기준시각(epoch)에서의 평균근점이각
   * @param {number} el.epoch 기준시각 (초)
   * @param {number} el.dir +1 순행(반시계) / -1 역행(시계)
   */
  constructor(el = {}) {
    this.mu = el.mu ?? 3.986e14;
    this.a = el.a ?? 7e6;
    this.e = el.e ?? 0;
    this.argPe = el.argPe ?? 0;
    this.M0 = el.M0 ?? 0;
    this.epoch = el.epoch ?? 0;
    this.dir = el.dir ?? 1;
    this._cache = { t: NaN, pos: new Vec2(), vel: new Vec2() };
  }

  clone() {
    return new Orbit({
      mu: this.mu,
      a: this.a,
      e: this.e,
      argPe: this.argPe,
      M0: this.M0,
      epoch: this.epoch,
      dir: this.dir,
    });
  }

  /** 반통경 p = a(1-e²) */
  get semiLatusRectum() {
    return this.a * (1 - this.e * this.e);
  }

  /** 근점 반지름 */
  get periapsis() {
    return this.a * (1 - this.e);
  }

  /** 원점 반지름 (쌍곡선은 무한대) */
  get apoapsis() {
    return this.e < 1 ? this.a * (1 + this.e) : Infinity;
  }

  /** 평균 운동 n (rad/s) */
  get meanMotion() {
    const A = Math.abs(this.a);
    return Math.sqrt(this.mu / (A * A * A));
  }

  /** 공전 주기 (쌍곡선은 무한대) */
  get period() {
    return this.e < 1 ? TAU / this.meanMotion : Infinity;
  }

  /** 비에너지 (J/kg) */
  get specificEnergy() {
    return -this.mu / (2 * this.a);
  }

  /** 비각운동량 (부호 포함) */
  get angularMomentum() {
    return this.dir * Math.sqrt(this.mu * Math.abs(this.semiLatusRectum));
  }

  get isHyperbolic() {
    return this.e >= 1;
  }

  get isClosed() {
    return this.e < 1 && this.a > 0;
  }

  /** 시각 t 의 평균근점이각 */
  meanAnomalyAt(t) {
    const M = this.M0 + this.meanMotion * (t - this.epoch);
    return this.e < 1 ? wrapPi(M) : M;
  }

  /** 시각 t 의 진근점이각 */
  trueAnomalyAt(t) {
    return meanToTrue(this.meanAnomalyAt(t), this.e);
  }

  /** 진근점이각 nu 에서의 반지름 */
  radiusAt(nu) {
    const p = this.semiLatusRectum;
    const d = 1 + this.e * Math.cos(nu);
    if (d <= 1e-12) return Infinity;
    return p / d;
  }

  /** 진근점이각 nu 에서의 위치 벡터 */
  positionAtTrue(nu) {
    const r = this.radiusAt(nu);
    if (!Number.isFinite(r)) return new Vec2(NaN, NaN);
    const theta = this.argPe + this.dir * nu;
    return new Vec2(r * Math.cos(theta), r * Math.sin(theta));
  }

  /** 진근점이각 nu 에서의 속도 벡터 */
  velocityAtTrue(nu) {
    const p = this.semiLatusRectum;
    if (Math.abs(p) < 1e-6) return new Vec2(0, 0);
    const k = Math.sqrt(this.mu / Math.abs(p));
    const theta = this.argPe + this.dir * nu;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const vr = k * this.e * Math.sin(nu);
    const vt = k * (1 + this.e * Math.cos(nu)) * this.dir;
    // r̂ = (ct, st), θ̂ = (-st, ct)
    return new Vec2(vr * ct - vt * st, vr * st + vt * ct);
  }

  /** 시각 t 의 위치 */
  positionAt(t) {
    return this.positionAtTrue(this.trueAnomalyAt(t));
  }

  /** 시각 t 의 속도 */
  velocityAt(t) {
    return this.velocityAtTrue(this.trueAnomalyAt(t));
  }

  /** 시각 t 의 위치+속도 (캐시 사용) */
  stateAt(t) {
    if (this._cache.t === t) {
      return { pos: this._cache.pos.clone(), vel: this._cache.vel.clone() };
    }
    const nu = this.trueAnomalyAt(t);
    const pos = this.positionAtTrue(nu);
    const vel = this.velocityAtTrue(nu);
    this._cache.t = t;
    this._cache.pos.copy(pos);
    this._cache.vel.copy(vel);
    return { pos, vel, nu };
  }

  /** 위치각 theta(관성계 절대각)에 대응하는 진근점이각 */
  trueAnomalyFromTheta(theta) {
    return wrapPi(this.dir * (theta - this.argPe));
  }

  /** 반지름 r 을 지나는 진근점이각 (상승 구간, 없으면 null) */
  trueAnomalyAtRadius(r) {
    const p = this.semiLatusRectum;
    if (this.e < ECC_EPSILON) return Math.abs(r - this.a) < 1 ? 0 : null;
    const c = (p / r - 1) / this.e;
    if (c < -1 || c > 1) return null;
    return Math.acos(clamp(c, -1, 1));
  }

  /** 근점 통과 시각 (t 이후 가장 가까운) */
  timeOfPeriapsis(t = this.epoch) {
    const n = this.meanMotion;
    if (this.e < 1) {
      const M = this.meanAnomalyAt(t);
      let dt = -M / n;
      if (dt < 0) dt += this.period;
      return t + dt;
    }
    const M = this.meanAnomalyAt(t);
    return t - M / n;
  }

  /** 원점 통과 시각 (닫힌 궤도만) */
  timeOfApoapsis(t = this.epoch) {
    if (!this.isClosed) return Infinity;
    const n = this.meanMotion;
    const M = this.meanAnomalyAt(t);
    let dt = (PI - M) / n;
    while (dt < 0) dt += this.period;
    return t + dt;
  }

  /** t 시점부터 진근점이각 nu 에 도달하기까지 걸리는 시간 */
  timeToTrueAnomaly(nu, t) {
    const M = trueToMean(nu, this.e);
    if (Number.isNaN(M)) return Infinity;
    const n = this.meanMotion;
    const now = this.meanAnomalyAt(t);
    if (this.e < 1) {
      let dM = wrapTau(M - now);
      return dM / n;
    }
    const dM = M - now;
    return dM >= 0 ? dM / n : Infinity;
  }

  /** 반지름 r 에 도달하는 시각 (하강/상승 선택) */
  timeToRadius(r, t, descending = false) {
    const nu = this.trueAnomalyAtRadius(r);
    if (nu === null) return Infinity;
    return this.timeToTrueAnomaly(descending ? -nu : nu, t);
  }

  /** 궤도 그리기용 샘플링 — 관성좌표 점 배열 */
  sample(count = 180, options = {}) {
    const pts = [];
    const maxR = options.maxRadius ?? Infinity;
    if (this.e < 1) {
      for (let i = 0; i <= count; i++) {
        const nu = (i / count) * TAU;
        const p = this.positionAtTrue(nu);
        pts.push(p);
      }
    } else {
      // 쌍곡선: 점근선 안쪽만 샘플링
      const nuMax = Math.acos(clamp(-1 / this.e, -1, 1)) - 1e-3;
      let lo = -nuMax;
      let hi = nuMax;
      if (Number.isFinite(maxR)) {
        const nuR = this.trueAnomalyAtRadius(maxR);
        if (nuR !== null) {
          lo = -nuR;
          hi = nuR;
        }
      }
      for (let i = 0; i <= count; i++) {
        const nu = lo + ((hi - lo) * i) / count;
        pts.push(this.positionAtTrue(nu));
      }
    }
    return pts;
  }

  /** 시간 간격으로 샘플링 — 속도 변화를 반영한 궤적 표시에 유용 */
  sampleByTime(t0, t1, count = 120) {
    const pts = [];
    for (let i = 0; i <= count; i++) {
      const t = t0 + ((t1 - t0) * i) / count;
      pts.push(this.positionAt(t));
    }
    return pts;
  }

  /** 요소를 직렬화 */
  toJSON() {
    return {
      mu: this.mu,
      a: this.a,
      e: this.e,
      argPe: this.argPe,
      M0: this.M0,
      epoch: this.epoch,
      dir: this.dir,
    };
  }

  static fromJSON(o) {
    return new Orbit(o);
  }

  /** 상태벡터로부터 궤도 생성 */
  static fromState(pos, vel, mu, t = 0) {
    return stateToOrbit(pos, vel, mu, t);
  }

  /** 원궤도 생성 */
  static circular(mu, radius, phase = 0, dir = 1, epoch = 0) {
    return new Orbit({
      mu,
      a: radius,
      e: 0,
      argPe: 0,
      M0: phase,
      epoch,
      dir,
    });
  }

  /** 근점/원점 반지름으로 궤도 생성 */
  static fromApsides(mu, rPe, rAp, argPe = 0, dir = 1, M0 = 0, epoch = 0) {
    if (rAp < rPe) [rPe, rAp] = [rAp, rPe];
    const a = (rPe + rAp) / 2;
    const e = a > 0 ? (rAp - rPe) / (rAp + rPe) : 0;
    return new Orbit({ mu, a, e, argPe, M0, epoch, dir });
  }
}

/* ──────────────────────────────────────────────────────────────
 * 상태벡터 ↔ 궤도요소
 * ────────────────────────────────────────────────────────────── */

/**
 * 위치/속도 → 궤도 요소.
 * @param {Vec2} pos 천체 중심 기준 위치
 * @param {Vec2} vel 천체 중심 기준 속도
 * @param {number} mu 중력변수
 * @param {number} t  현재 시각 (epoch 로 기록)
 */
export function stateToOrbit(pos, vel, mu, t = 0) {
  const r = vLen(pos);
  const v2 = vel.x * vel.x + vel.y * vel.y;
  const h = pos.x * vel.y - pos.y * vel.x; // 비각운동량 (스칼라)
  const dir = h >= 0 ? 1 : -1;

  // 이심률 벡터
  const rv = pos.x * vel.x + pos.y * vel.y;
  const k = v2 - mu / r;
  const ex = (k * pos.x - rv * vel.x) / mu;
  const ey = (k * pos.y - rv * vel.y) / mu;
  let e = Math.hypot(ex, ey);

  const energy = v2 / 2 - mu / r;
  let a;
  if (Math.abs(e - 1) < PARABOLIC_BAND) {
    // 포물선 근처는 수치적으로 불안정하므로 살짝 밀어낸다
    e = e < 1 ? 1 - PARABOLIC_BAND : 1 + PARABOLIC_BAND;
    a = -mu / (2 * energy || -1e-12);
  } else {
    a = -mu / (2 * energy);
  }

  let argPe;
  let nu;
  if (e < ECC_EPSILON) {
    // 원궤도 — 근점이 정의되지 않으므로 현재 위치를 근점으로 삼는다
    argPe = Math.atan2(pos.y, pos.x);
    nu = 0;
    e = 0;
  } else {
    argPe = Math.atan2(ey, ex);
    const theta = Math.atan2(pos.y, pos.x);
    nu = wrapPi(dir * (theta - argPe));
    // 반지름 변화 방향으로 부호 검증 (수치오차 보정)
    if (rv < 0 && nu > 0) nu = -nu;
    else if (rv > 0 && nu < 0) nu = -nu;
  }

  const M0 = trueToMean(nu, e);
  return new Orbit({
    mu,
    a,
    e,
    argPe,
    M0: Number.isFinite(M0) ? M0 : 0,
    epoch: t,
    dir,
  });
}

/** 궤도요소 → 상태벡터 */
export function orbitToState(orbit, t) {
  return orbit.stateAt(t);
}

/* ──────────────────────────────────────────────────────────────
 * 궤도 해석 헬퍼
 * ────────────────────────────────────────────────────────────── */

/** 비스-비바 방정식: 반지름 r 에서의 속력 */
export function visViva(mu, r, a) {
  const v2 = mu * (2 / r - 1 / a);
  return v2 > 0 ? Math.sqrt(v2) : 0;
}

/** 반지름 r 의 원궤도 속력 */
export const circularVelocity = (mu, r) => Math.sqrt(mu / r);

/** 반지름 r 에서의 탈출속도 */
export const escapeVelocity = (mu, r) => Math.sqrt((2 * mu) / r);

/** 원궤도 주기 */
export const circularPeriod = (mu, r) => TAU * Math.sqrt((r * r * r) / mu);

/** 정지궤도 반지름 (자전주기와 같은 주기의 원궤도) */
export function synchronousRadius(mu, rotPeriod) {
  return Math.cbrt((mu * rotPeriod * rotPeriod) / (TAU * TAU));
}

/** 영향권(SOI) 반지름 — Laplace 근사 */
export function soiRadius(a, mBody, mParent) {
  if (!mParent || !a) return Infinity;
  return a * Math.pow(mBody / mParent, 0.4);
}

/** 호만 전이 Δv (원궤도 r1 → r2) */
export function hohmannTransfer(mu, r1, r2) {
  const aT = (r1 + r2) / 2;
  const v1 = circularVelocity(mu, r1);
  const v2 = circularVelocity(mu, r2);
  const vT1 = visViva(mu, r1, aT);
  const vT2 = visViva(mu, r2, aT);
  const dv1 = vT1 - v1;
  const dv2 = v2 - vT2;
  return {
    dv1,
    dv2,
    total: Math.abs(dv1) + Math.abs(dv2),
    transferTime: PI * Math.sqrt((aT * aT * aT) / mu),
    transferSemiMajor: aT,
  };
}

/** 현재 궤도에서 목표 고도로 원형화하는 데 필요한 Δv */
export function circularizeDv(orbit, atApoapsis = true) {
  const r = atApoapsis ? orbit.apoapsis : orbit.periapsis;
  if (!Number.isFinite(r)) return Infinity;
  const vNow = visViva(orbit.mu, r, orbit.a);
  const vCirc = circularVelocity(orbit.mu, r);
  return vCirc - vNow;
}

/** 원점을 목표 반지름으로 올리는 근점에서의 Δv */
export function raiseApoapsisDv(orbit, targetAp) {
  const rPe = orbit.periapsis;
  if (targetAp < rPe) return 0;
  const aNew = (rPe + targetAp) / 2;
  const vNow = visViva(orbit.mu, rPe, orbit.a);
  const vNew = visViva(orbit.mu, rPe, aNew);
  return vNew - vNow;
}

/** 근점을 목표 반지름으로 내리는 원점에서의 Δv */
export function lowerPeriapsisDv(orbit, targetPe) {
  const rAp = orbit.apoapsis;
  if (!Number.isFinite(rAp)) return 0;
  const aNew = (rAp + targetPe) / 2;
  const vNow = visViva(orbit.mu, rAp, orbit.a);
  const vNew = visViva(orbit.mu, rAp, aNew);
  return vNew - vNow;
}

/** 치올콥스키 로켓 방정식 */
export const tsiolkovsky = (isp, g0, m0, m1) =>
  m1 > 0 && m0 > m1 ? isp * g0 * Math.log(m0 / m1) : 0;

/** Δv 로부터 필요한 추진제 질량 */
export const propellantForDv = (dv, isp, g0, m0) =>
  m0 * (1 - Math.exp(-dv / (isp * g0)));

/** 두 궤도의 위상 각도 차 (동기화/랑데부 계산용) */
export function phaseAngle(orbitA, orbitB, t) {
  const pa = orbitA.positionAt(t);
  const pb = orbitB.positionAt(t);
  return wrapPi(Math.atan2(pb.y, pb.x) - Math.atan2(pa.y, pa.x));
}

/** 호만 전이 발사창까지 남은 시간 */
export function transferWindow(orbitA, orbitB, t) {
  const r1 = orbitA.a;
  const r2 = orbitB.a;
  const mu = orbitA.mu;
  const tTransfer = PI * Math.sqrt(Math.pow((r1 + r2) / 2, 3) / mu);
  const nB = orbitB.meanMotion * orbitB.dir;
  const nA = orbitA.meanMotion * orbitA.dir;
  // 도착 시 목표가 있어야 할 위상
  const required = wrapPi(PI - nB * tTransfer);
  const current = phaseAngle(orbitA, orbitB, t);
  const relRate = nB - nA;
  if (Math.abs(relRate) < 1e-12) return Infinity;
  let dt = wrapPi(required - current) / relRate;
  const synodic = Math.abs(TAU / relRate);
  while (dt < 0) dt += synodic;
  return dt;
}

/** 회합 주기 */
export function synodicPeriod(pA, pB) {
  if (!Number.isFinite(pA) || !Number.isFinite(pB)) return Infinity;
  const diff = Math.abs(1 / pA - 1 / pB);
  return diff < 1e-14 ? Infinity : 1 / diff;
}

/**
 * 궤도 위에서 주어진 반지름(SOI 경계 등)을 통과하는 시각을 찾는다.
 * @returns {number|null} t 이후 첫 교차 시각
 */
export function findRadiusCrossing(orbit, radius, t0, tMax) {
  const f = (t) => vLen(orbit.positionAt(t)) - radius;
  const f0 = f(t0);
  const steps = 240;
  const dt = (tMax - t0) / steps;
  let prevT = t0;
  let prevF = f0;
  for (let i = 1; i <= steps; i++) {
    const t = t0 + dt * i;
    const fv = f(t);
    if (prevF * fv <= 0 && Number.isFinite(fv)) {
      const root = bisect(f, prevT, t, 1e-3, 80);
      if (root !== null) return root;
    }
    prevT = t;
    prevF = fv;
  }
  return null;
}

/**
 * 두 궤도의 최근접 거리를 탐색한다 (랑데부 보조).
 * @returns {{t:number, distance:number}}
 */
export function closestApproach(orbitA, orbitB, t0, tMax, samples = 400) {
  let bestT = t0;
  let bestD = Infinity;
  const dt = (tMax - t0) / samples;
  for (let i = 0; i <= samples; i++) {
    const t = t0 + dt * i;
    const pa = orbitA.positionAt(t);
    const pb = orbitB.positionAt(t);
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (d < bestD) {
      bestD = d;
      bestT = t;
    }
  }
  // 국소 정밀화
  const lo = Math.max(t0, bestT - dt);
  const hi = Math.min(tMax, bestT + dt);
  const f = (t) => {
    const pa = orbitA.positionAt(t);
    const pb = orbitB.positionAt(t);
    return Math.hypot(pb.x - pa.x, pb.y - pa.y);
  };
  let a = lo;
  let b = hi;
  const gr = (Math.sqrt(5) - 1) / 2;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 60 && b - a > 1e-3; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - gr * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + gr * (b - a);
      fd = f(d);
    }
  }
  const tBest = (a + b) / 2;
  return { t: tBest, distance: f(tBest) };
}

/**
 * 궤도에 Δv 를 적용해 새 궤도를 만든다.
 * @param {Orbit} orbit
 * @param {number} t 적용 시각
 * @param {Vec2} dv 관성좌표 Δv
 */
export function applyDeltaV(orbit, t, dv) {
  const { pos, vel } = orbit.stateAt(t);
  vel.x += dv.x;
  vel.y += dv.y;
  return stateToOrbit(pos, vel, orbit.mu, t);
}

/**
 * 진행방향/반경방향 성분으로 Δv 를 적용한다.
 * @param {number} prograde  진행방향(+) / 역행(-)
 * @param {number} radial    바깥쪽(+) / 안쪽(-)
 */
export function applyDeltaVLocal(orbit, t, prograde, radial) {
  const { pos, vel } = orbit.stateAt(t);
  const vhat = vNorm(vel);
  const rhat = vNorm(pos);
  const dv = new Vec2(
    vhat.x * prograde + rhat.x * radial,
    vhat.y * prograde + rhat.y * radial
  );
  vel.x += dv.x;
  vel.y += dv.y;
  return stateToOrbit(pos, vel, orbit.mu, t);
}

/** 궤도의 고도(지표 기준) 정보 */
export function orbitAltitudes(orbit, bodyRadius) {
  return {
    periapsis: orbit.periapsis - bodyRadius,
    apoapsis: Number.isFinite(orbit.apoapsis)
      ? orbit.apoapsis - bodyRadius
      : Infinity,
  };
}

/** 궤도가 천체와 충돌하는가 */
export function orbitImpacts(orbit, bodyRadius) {
  return orbit.periapsis <= bodyRadius;
}

/**
 * 충돌 시각 추정 — 근점이 지표 아래인 궤도에서 지면에 닿는 시각.
 */
export function impactTime(orbit, bodyRadius, t) {
  if (!orbitImpacts(orbit, bodyRadius)) return null;
  const nu = orbit.trueAnomalyAtRadius(bodyRadius);
  if (nu === null) return null;
  const dtDesc = orbit.timeToTrueAnomaly(-nu, t);
  return Number.isFinite(dtDesc) ? t + dtDesc : null;
}

/**
 * 지구 저궤도식 "중력 손실" 근사 — 발사 Δv 예산 계산용.
 */
export function launchDvEstimate(body) {
  const vOrbit = circularVelocity(body.mu, body.radius + body.atmo.height * 1.2);
  const gravityLoss = Math.sqrt(body.surfaceGravity * body.atmo.height) * 0.9;
  const dragLoss = body.atmo.seaPressure * 220;
  const rotationBonus = (TAU * body.radius) / body.rotPeriod;
  return Math.max(
    0,
    vOrbit + gravityLoss + dragLoss - rotationBonus * 0.9
  );
}

/** 특정 시각 궤도의 비행경로각 (속도와 수평면 사이 각) */
export function flightPathAngle(orbit, t) {
  const { pos, vel } = orbit.stateAt(t);
  const rhat = vNorm(pos);
  const speed = vLen(vel);
  if (speed < 1e-9) return 0;
  const vr = vel.x * rhat.x + vel.y * rhat.y;
  return Math.asin(clamp(vr / speed, -1, 1));
}

/** 궤도상의 임의 지점에서의 속력 */
export function speedAtRadius(orbit, r) {
  return visViva(orbit.mu, r, orbit.a);
}

/** 두 상태벡터 사이의 Lambert 유사 해 — 단순 반복(원형 근사) */
export function estimateInterceptDv(orbit, targetPos, t, tof) {
  const { pos } = orbit.stateAt(t);
  const dx = targetPos.x - pos.x;
  const dy = targetPos.y - pos.y;
  const needed = new Vec2(dx / tof, dy / tof);
  const { vel } = orbit.stateAt(t);
  return new Vec2(needed.x - vel.x, needed.y - vel.y);
}
