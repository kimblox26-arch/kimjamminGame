// ORBITER — 수치 적분기
// 중력장 안에서의 병진 운동을 적분한다.
// 저고도/추력 구간은 정확도를 위해 RK4, 관성비행 구간은
// 에너지 보존이 좋은 심플렉틱 적분을 쓴다.

import { Vec2 } from '../core/math.js';

/**
 * 가속도 함수 시그니처:
 *   accel(pos: Vec2, vel: Vec2, t: number, out: Vec2) => void
 * out 에 가속도를 채워 넣는다 (할당 최소화).
 */

const _k1v = new Vec2();
const _k1a = new Vec2();
const _k2v = new Vec2();
const _k2a = new Vec2();
const _k3v = new Vec2();
const _k3a = new Vec2();
const _k4v = new Vec2();
const _k4a = new Vec2();
const _tmpP = new Vec2();
const _tmpV = new Vec2();

/** 고전 4차 룽게-쿠타 적분 — 인플레이스 */
export function rk4(pos, vel, dt, t, accel) {
  // k1
  _k1v.copy(vel);
  accel(pos, vel, t, _k1a);

  // k2
  _tmpP.copy(pos).addScaled_(_k1v, dt / 2);
  _tmpV.copy(vel).addScaled_(_k1a, dt / 2);
  _k2v.copy(_tmpV);
  accel(_tmpP, _tmpV, t + dt / 2, _k2a);

  // k3
  _tmpP.copy(pos).addScaled_(_k2v, dt / 2);
  _tmpV.copy(vel).addScaled_(_k2a, dt / 2);
  _k3v.copy(_tmpV);
  accel(_tmpP, _tmpV, t + dt / 2, _k3a);

  // k4
  _tmpP.copy(pos).addScaled_(_k3v, dt);
  _tmpV.copy(vel).addScaled_(_k3a, dt);
  _k4v.copy(_tmpV);
  accel(_tmpP, _tmpV, t + dt, _k4a);

  const s = dt / 6;
  pos.x += s * (_k1v.x + 2 * _k2v.x + 2 * _k3v.x + _k4v.x);
  pos.y += s * (_k1v.y + 2 * _k2v.y + 2 * _k3v.y + _k4v.y);
  vel.x += s * (_k1a.x + 2 * _k2a.x + 2 * _k3a.x + _k4a.x);
  vel.y += s * (_k1a.y + 2 * _k2a.y + 2 * _k3a.y + _k4a.y);
}

/** 속도 베를레(리프프로그) — 심플렉틱, 에너지 드리프트가 적다 */
export function velocityVerlet(pos, vel, dt, t, accel, accelCache) {
  const a0 = accelCache || new Vec2();
  if (!accelCache) accel(pos, vel, t, a0);

  pos.x += vel.x * dt + 0.5 * a0.x * dt * dt;
  pos.y += vel.y * dt + 0.5 * a0.y * dt * dt;

  const a1 = new Vec2();
  accel(pos, vel, t + dt, a1);

  vel.x += 0.5 * (a0.x + a1.x) * dt;
  vel.y += 0.5 * (a0.y + a1.y) * dt;

  if (accelCache) accelCache.copy(a1);
  return a1;
}

/** 심플렉틱 오일러 — 가장 저렴, 지면 접촉 처리 등에 사용 */
export function symplecticEuler(pos, vel, dt, t, accel) {
  const a = new Vec2();
  accel(pos, vel, t, a);
  vel.addScaled_(a, dt);
  pos.addScaled_(vel, dt);
}

/** 4차 요시다(Yoshida) 심플렉틱 적분 — 장시간 궤도 전파용 */
const W1 = 1 / (2 - Math.cbrt(2));
const W0 = -Math.cbrt(2) * W1;
const YOSHIDA_C = [W1 / 2, (W0 + W1) / 2, (W0 + W1) / 2, W1 / 2];
const YOSHIDA_D = [W1, W0, W1, 0];

export function yoshida4(pos, vel, dt, t, accel) {
  const a = new Vec2();
  for (let i = 0; i < 4; i++) {
    pos.addScaled_(vel, YOSHIDA_C[i] * dt);
    if (YOSHIDA_D[i] !== 0) {
      accel(pos, vel, t, a);
      vel.addScaled_(a, YOSHIDA_D[i] * dt);
    }
  }
}

/**
 * 적응형 RK4 — 스텝을 반으로 나눈 결과와 비교해 오차를 추정한다.
 * 급격한 가속(엔진 점화/대기권 진입)에서 안정성을 확보한다.
 */
export function adaptiveRk4(pos, vel, dt, t, accel, tolerance = 1e-3) {
  const p1 = pos.clone();
  const v1 = vel.clone();
  rk4(p1, v1, dt, t, accel);

  const p2 = pos.clone();
  const v2 = vel.clone();
  rk4(p2, v2, dt / 2, t, accel);
  rk4(p2, v2, dt / 2, t + dt / 2, accel);

  const err = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const scale = Math.max(1, pos.length() * 1e-6);
  if (err / scale > tolerance) {
    // 오차가 크면 반 스텝을 두 번 더 쪼갠다 (재귀 1단계까지만)
    pos.copy(p2);
    vel.copy(v2);
    return { substeps: 2, error: err };
  }
  pos.copy(p1);
  vel.copy(v1);
  return { substeps: 1, error: err };
}

/**
 * 다중 천체 중력 가속도 계산기.
 * SOI 기반 패치드 코닉이 아니라 실제 n-체 섭동을 원할 때 사용한다.
 */
export class GravityField {
  constructor() {
    /** @type {{pos:Vec2, mu:number, radius:number}[]} */
    this.sources = [];
    this.softening = 1.0;
  }

  clear() {
    this.sources.length = 0;
  }

  add(pos, mu, radius = 0) {
    this.sources.push({ pos, mu, radius });
  }

  /** out 에 가속도를 누적한다 */
  accelerationAt(p, out) {
    out.x = 0;
    out.y = 0;
    for (const s of this.sources) {
      const dx = s.pos.x - p.x;
      const dy = s.pos.y - p.y;
      const r2 = dx * dx + dy * dy + this.softening;
      const r = Math.sqrt(r2);
      const f = s.mu / (r2 * r);
      out.x += dx * f;
      out.y += dy * f;
    }
    return out;
  }

  /** 위치에서의 중력 퍼텐셜 */
  potentialAt(p) {
    let u = 0;
    for (const s of this.sources) {
      const r = Math.hypot(s.pos.x - p.x, s.pos.y - p.y) + this.softening;
      u -= s.mu / r;
    }
    return u;
  }

  /** 가장 강한 중력을 주는 천체 */
  dominantSource(p) {
    let best = null;
    let bestA = -1;
    for (const s of this.sources) {
      const r2 =
        (s.pos.x - p.x) * (s.pos.x - p.x) + (s.pos.y - p.y) * (s.pos.y - p.y);
      const a = s.mu / Math.max(r2, 1);
      if (a > bestA) {
        bestA = a;
        best = s;
      }
    }
    return best;
  }
}

/**
 * 궤적 예측기 — 현재 상태에서 미래 경로를 미리 계산해 지도에 표시한다.
 * 대기 저항이 있는 구간은 수치적분, 없는 구간은 케플러 해석해로 건너뛴다.
 */
export class TrajectoryPredictor {
  constructor(opts = {}) {
    this.maxPoints = opts.maxPoints ?? 600;
    this.maxTime = opts.maxTime ?? 6 * 3600;
    this.points = [];
    this.events = [];
    this.dirty = true;
  }

  reset() {
    this.points.length = 0;
    this.events.length = 0;
    this.dirty = true;
  }

  /**
   * @param {Vec2} pos0 시작 위치 (천체 중심 기준)
   * @param {Vec2} vel0 시작 속도
   * @param {(p:Vec2,v:Vec2,t:number,out:Vec2)=>void} accel
   * @param {object} opts { dt, stopRadius, soiRadius, t0 }
   */
  integrate(pos0, vel0, accel, opts = {}) {
    const dt = opts.dt ?? 2;
    const t0 = opts.t0 ?? 0;
    const stopRadius = opts.stopRadius ?? 0;
    const soi = opts.soiRadius ?? Infinity;
    const pos = pos0.clone();
    const vel = vel0.clone();
    this.points.length = 0;
    this.events.length = 0;
    let t = t0;
    let prevR = pos.length();
    let rising = null;

    const steps = Math.min(
      this.maxPoints * 4,
      Math.ceil(this.maxTime / dt)
    );
    const sampleEvery = Math.max(1, Math.floor(steps / this.maxPoints));

    for (let i = 0; i < steps; i++) {
      rk4(pos, vel, dt, t, accel);
      t += dt;
      const r = pos.length();

      if (i % sampleEvery === 0) {
        this.points.push({ x: pos.x, y: pos.y, t, r });
      }

      // 정점/근점 이벤트 검출
      const nowRising = r > prevR;
      if (rising !== null && nowRising !== rising) {
        this.events.push({
          type: nowRising ? 'periapsis' : 'apoapsis',
          t,
          x: pos.x,
          y: pos.y,
          r,
        });
      }
      rising = nowRising;
      prevR = r;

      if (r <= stopRadius) {
        this.events.push({ type: 'impact', t, x: pos.x, y: pos.y, r });
        break;
      }
      if (r >= soi) {
        this.events.push({ type: 'soiExit', t, x: pos.x, y: pos.y, r });
        break;
      }
      if (!Number.isFinite(r)) break;
    }
    this.dirty = false;
    return this.points;
  }
}

/**
 * 회전(각) 운동 적분 — 강체의 1자유도 회전.
 */
export function integrateRotation(state, torque, inertia, dt) {
  if (inertia <= 1e-9) return;
  const alpha = torque / inertia;
  state.angularVelocity += alpha * dt;
  state.angle += state.angularVelocity * dt;
}

/**
 * 스프링-댐퍼 (착륙장치 서스펜션 등)
 * @returns 힘 (압축 방향이 양수)
 */
export function springDamper(compression, velocity, stiffness, damping) {
  return -stiffness * compression - damping * velocity;
}

/**
 * 임펄스 기반 충돌 응답 (1점 접촉, 2D).
 * @returns {{impulse:number, normalVel:number}}
 */
export function collisionImpulse(
  relativeVelocity,
  normal,
  invMass,
  invInertia,
  contactR,
  restitution
) {
  const vn = relativeVelocity.x * normal.x + relativeVelocity.y * normal.y;
  if (vn > 0) return { impulse: 0, normalVel: vn };
  const rxn = contactR.x * normal.y - contactR.y * normal.x;
  const denom = invMass + invInertia * rxn * rxn;
  if (denom < 1e-12) return { impulse: 0, normalVel: vn };
  const j = (-(1 + restitution) * vn) / denom;
  return { impulse: j, normalVel: vn };
}
