// ORBITER — 기동 노드
// 궤도 위 특정 시각에 Δv 를 적용했을 때의 결과 궤도를 미리 계산해 보여준다.
// 진행/역행(prograde) 과 반경(radial) 두 축으로 Δv 를 지정한다 (2D 이므로 노멀 축 없음).

import {
  Vec2,
  clamp,
  vLen,
  vNorm,
  wrapPi,
  formatSpeed,
  formatTime,
} from '../core/math.js';
import { G0 } from '../physics/constants.js';
import {
  stateToOrbit,
  applyDeltaVLocal,
  circularVelocity,
  visViva,
  hohmannTransfer,
  closestApproach,
  transferWindow,
} from '../physics/orbit.js';

let _nodeId = 1;

/**
 * 하나의 기동 노드.
 */
export class ManeuverNode {
  /**
   * @param {Orbit} orbit 기준 궤도
   * @param {number} time  실행 시각 (절대 시각, 초)
   * @param {object} dv    { prograde, radial }
   */
  constructor(orbit, time, dv = {}) {
    this.id = `n${_nodeId++}`;
    this.orbit = orbit;
    this.time = time;
    this.prograde = dv.prograde ?? 0;
    this.radial = dv.radial ?? 0;
    this.executed = false;
    this.label = dv.label ?? '기동';
    this.resultOrbit = null;
    this.remainingDeltaV = this.deltaVMagnitude;
    this.recompute();
  }

  get deltaVMagnitude() {
    return Math.hypot(this.prograde, this.radial);
  }

  setDeltaV(prograde, radial) {
    this.prograde = prograde;
    this.radial = radial;
    this.remainingDeltaV = this.deltaVMagnitude;
    this.recompute();
  }

  addDeltaV(dPrograde, dRadial) {
    this.setDeltaV(this.prograde + dPrograde, this.radial + dRadial);
  }

  setTime(t) {
    this.time = t;
    this.recompute();
  }

  shiftTime(dt) {
    this.setTime(this.time + dt);
  }

  /** 결과 궤도 재계산 */
  recompute() {
    try {
      this.resultOrbit = applyDeltaVLocal(
        this.orbit,
        this.time,
        this.prograde,
        this.radial
      );
    } catch (e) {
      this.resultOrbit = null;
    }
    return this.resultOrbit;
  }

  /** 노드 위치 (기준 궤도상) */
  position() {
    return this.orbit.positionAt(this.time);
  }

  /** Δv 벡터를 관성좌표로 변환 */
  worldVector() {
    const { pos, vel } = this.orbit.stateAt(this.time);
    const vhat = vNorm(vel);
    const rhat = vNorm(pos);
    return new Vec2(
      vhat.x * this.prograde + rhat.x * this.radial,
      vhat.y * this.prograde + rhat.y * this.radial
    );
  }

  /** 현재 기체 기준 분사 방향 (실행 중 갱신) */
  worldDirection(vessel) {
    const vhat = vNorm(vessel.vel);
    const rhat = vNorm(vessel.pos);
    const v = new Vec2(
      vhat.x * this.prograde + rhat.x * this.radial,
      vhat.y * this.prograde + rhat.y * this.radial
    );
    return vNorm(v);
  }

  /** 예상 연소 시간 */
  burnTime(vessel) {
    const thrust = vessel.maxThrust(0);
    if (thrust <= 0) return Infinity;
    const isp = 320;
    const ve = isp * G0;
    const m0 = vessel.mass;
    const m1 = m0 * Math.exp(-this.deltaVMagnitude / ve);
    const flow = thrust / ve;
    return (m0 - m1) / flow;
  }

  /** 결과 궤도 요약 */
  summary(bodyRadius = 0) {
    const o = this.resultOrbit;
    if (!o) return null;
    return {
      deltaV: this.deltaVMagnitude,
      prograde: this.prograde,
      radial: this.radial,
      apoapsis: Number.isFinite(o.apoapsis) ? o.apoapsis - bodyRadius : Infinity,
      periapsis: o.periapsis - bodyRadius,
      eccentricity: o.e,
      period: o.period,
      escaping: o.e >= 1,
    };
  }

  toJSON() {
    return {
      time: this.time,
      prograde: this.prograde,
      radial: this.radial,
      label: this.label,
    };
  }
}

/**
 * 기동 노드 목록 관리.
 */
export class ManeuverPlanner {
  constructor() {
    /** @type {ManeuverNode[]} */
    this.nodes = [];
    this.selected = null;
  }

  add(orbit, time, dv = {}) {
    const node = new ManeuverNode(orbit, time, dv);
    this.nodes.push(node);
    this.nodes.sort((a, b) => a.time - b.time);
    this.selected = node;
    return node;
  }

  remove(node) {
    const i = this.nodes.indexOf(node);
    if (i >= 0) this.nodes.splice(i, 1);
    if (this.selected === node) this.selected = this.nodes[0] ?? null;
  }

  clear() {
    this.nodes.length = 0;
    this.selected = null;
  }

  get next() {
    return this.nodes.find((n) => !n.executed) ?? null;
  }

  /** 모든 노드의 Δv 합 */
  totalDeltaV() {
    return this.nodes.reduce((a, n) => a + n.deltaVMagnitude, 0);
  }

  /** 기준 궤도가 바뀌면 노드들을 갱신 */
  rebase(orbit) {
    for (const n of this.nodes) {
      if (n.executed) continue;
      n.orbit = orbit;
      n.recompute();
    }
  }

  /** 실행 중 남은 Δv 갱신 */
  updateExecution(vessel, dt) {
    const node = this.next;
    if (!node) return;
    if (vessel.currentThrust > 0) {
      const accel = vessel.currentThrust / vessel.mass;
      node.remainingDeltaV = Math.max(0, node.remainingDeltaV - accel * dt);
      if (node.remainingDeltaV <= 0.05) {
        node.executed = true;
      }
    }
  }

  toJSON() {
    return this.nodes.map((n) => n.toJSON());
  }
}

/* ──────────────────────────────────────────────────────────────
 * 기동 계획 도우미
 * ────────────────────────────────────────────────────────────── */

/**
 * 원점에서 원형화하는 노드를 만든다.
 */
export function planCircularizeAtApoapsis(orbit, currentTime) {
  const tAp = orbit.timeOfApoapsis(currentTime);
  if (!Number.isFinite(tAp)) return null;
  const rAp = orbit.apoapsis;
  const vNow = visViva(orbit.mu, rAp, orbit.a);
  const vTarget = circularVelocity(orbit.mu, rAp);
  return {
    time: tAp,
    prograde: vTarget - vNow,
    radial: 0,
    label: '원점 원형화',
  };
}

/**
 * 근점에서 원형화.
 */
export function planCircularizeAtPeriapsis(orbit, currentTime) {
  const tPe = orbit.timeOfPeriapsis(currentTime);
  const rPe = orbit.periapsis;
  const vNow = visViva(orbit.mu, rPe, orbit.a);
  const vTarget = circularVelocity(orbit.mu, rPe);
  return {
    time: tPe,
    prograde: vTarget - vNow,
    radial: 0,
    label: '근점 원형화',
  };
}

/**
 * 원점을 목표 고도로 올리는 노드 (근점에서 분사).
 */
export function planRaiseApoapsis(orbit, targetRadius, currentTime) {
  const tPe = orbit.timeOfPeriapsis(currentTime);
  const rPe = orbit.periapsis;
  const aNew = (rPe + targetRadius) / 2;
  const vNow = visViva(orbit.mu, rPe, orbit.a);
  const vNew = visViva(orbit.mu, rPe, aNew);
  return {
    time: tPe,
    prograde: vNew - vNow,
    radial: 0,
    label: '원점 상승',
  };
}

/**
 * 근점을 목표 고도로 내리는 노드 (원점에서 분사).
 */
export function planLowerPeriapsis(orbit, targetRadius, currentTime) {
  const tAp = orbit.timeOfApoapsis(currentTime);
  if (!Number.isFinite(tAp)) return null;
  const rAp = orbit.apoapsis;
  const aNew = (rAp + targetRadius) / 2;
  const vNow = visViva(orbit.mu, rAp, orbit.a);
  const vNew = visViva(orbit.mu, rAp, aNew);
  return {
    time: tAp,
    prograde: vNew - vNow,
    radial: 0,
    label: '근점 하강',
  };
}

/**
 * 이탈(deorbit) 노드 — 근점을 대기권 안으로 내린다.
 */
export function planDeorbit(orbit, body, currentTime, targetAltitude = null) {
  const targetR =
    body.radius + (targetAltitude ?? (body.atmo.exists ? body.atmo.height * 0.35 : -body.radius * 0.02));
  const plan = planLowerPeriapsis(orbit, Math.max(targetR, body.radius * 0.5), currentTime);
  if (plan) plan.label = '대기권 재진입';
  return plan;
}

/**
 * 위성/천체로의 호만 전이 노드.
 * @param {Orbit} orbit 현재 궤도 (부모 천체 기준)
 * @param {CelestialBody} target 목표 천체 (같은 부모를 공유)
 */
export function planTransferTo(orbit, target, currentTime) {
  const targetOrbit = target.orbit;
  if (!targetOrbit) return null;
  const mu = orbit.mu;
  const r1 = orbit.a;
  const r2 = targetOrbit.a;
  const h = hohmannTransfer(mu, r1, r2);

  // 발사창까지 대기
  const dt = transferWindow(orbit, targetOrbit, currentTime);
  const burnTime = Number.isFinite(dt) ? currentTime + dt : currentTime + 60;

  return {
    time: burnTime,
    prograde: h.dv1,
    radial: 0,
    label: `${target.name} 전이`,
    info: {
      arrivalDv: h.dv2,
      travelTime: h.transferTime,
      totalDv: h.total,
    },
  };
}

/**
 * 랑데부 미세 조정 — 목표와의 최근접 거리를 줄이는 Δv 추정.
 */
export function planRendezvousCorrection(orbit, targetOrbit, currentTime, horizon = 3600) {
  const ca = closestApproach(orbit, targetOrbit, currentTime, currentTime + horizon);
  if (!Number.isFinite(ca.distance)) return null;

  // 최근접 시점에서 속도를 맞추는 Δv
  const a = orbit.stateAt(ca.t);
  const b = targetOrbit.stateAt(ca.t);
  const dvx = b.vel.x - a.vel.x;
  const dvy = b.vel.y - a.vel.y;
  const vhat = vNorm(a.vel);
  const rhat = vNorm(a.pos);
  const prograde = dvx * vhat.x + dvy * vhat.y;
  const radial = dvx * rhat.x + dvy * rhat.y;

  return {
    time: ca.t,
    prograde,
    radial,
    label: '랑데부 속도 정합',
    info: { closestDistance: ca.distance, atTime: ca.t },
  };
}

/**
 * 두 기체 사이 상대 운동 정보 (도킹 HUD 용).
 */
export function relativeMotion(vessel, target) {
  const dx = target.pos.x - vessel.pos.x;
  const dy = target.pos.y - vessel.pos.y;
  const dvx = target.vel.x - vessel.vel.x;
  const dvy = target.vel.y - vessel.vel.y;
  const dist = Math.hypot(dx, dy);
  const relSpeed = Math.hypot(dvx, dvy);
  // 접근 속도 (양수 = 가까워짐)
  const closing = dist > 1e-6 ? -(dx * dvx + dy * dvy) / dist : 0;
  return {
    distance: dist,
    relativeSpeed: relSpeed,
    closingSpeed: closing,
    bearing: Math.atan2(dy, dx),
    timeToClosest: closing > 0.01 ? dist / closing : Infinity,
  };
}

/**
 * Δv 예산 표 — UI 표시용 문자열 생성.
 */
export function formatManeuver(node, bodyRadius = 0) {
  const s = node.summary(bodyRadius);
  if (!s) return '계산 불가';
  const lines = [
    `Δv ${formatSpeed(s.deltaV)}`,
    `진행 ${s.prograde >= 0 ? '+' : ''}${s.prograde.toFixed(1)} m/s`,
  ];
  if (Math.abs(s.radial) > 0.05) {
    lines.push(`반경 ${s.radial >= 0 ? '+' : ''}${s.radial.toFixed(1)} m/s`);
  }
  if (s.escaping) {
    lines.push('결과: 탈출 궤도');
  } else {
    lines.push(
      `결과 Ap ${(s.apoapsis / 1000).toFixed(1)} km / Pe ${(
        s.periapsis / 1000
      ).toFixed(1)} km`
    );
  }
  return lines.join('\n');
}

/**
 * 노드까지 남은 시간 문자열.
 */
export function timeToNode(node, currentTime) {
  const dt = node.time - currentTime;
  if (dt < 0) return '지남';
  return formatTime(dt, true);
}

/**
 * 자동 궤도 설계 — 목표 고도의 원궤도까지 필요한 노드 2개를 만든다.
 */
export function planOrbitInsertion(orbit, body, targetAltitude, currentTime) {
  const targetR = body.radius + targetAltitude;
  const plans = [];
  if (orbit.apoapsis < targetR) {
    const p1 = planRaiseApoapsis(orbit, targetR, currentTime);
    if (p1) plans.push(p1);
  }
  const p2 = planCircularizeAtApoapsis(orbit, currentTime);
  if (p2) plans.push(p2);
  return plans;
}
