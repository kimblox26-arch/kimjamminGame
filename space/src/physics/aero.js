// ORBITER — 공기역학
// 로켓 몸체의 항력, 핀의 양력/복원 모멘트, 낙하산, 재진입 가열을 계산한다.

import {
  clamp,
  clamp01,
  lerp,
  smoothstep,
  wrapPi,
  Vec2,
  vLen,
  vNorm,
  vDot,
} from '../core/math.js';

/* ──────────────────────────────────────────────────────────────
 * 항력 계수 모델
 * ────────────────────────────────────────────────────────────── */

/**
 * 마하수에 따른 항력계수 배율.
 * 천음속(M≈1) 구간에서 항력이 급증하는 "음속 장벽"을 재현한다.
 */
export function machDragMultiplier(mach) {
  const m = Math.abs(mach);
  if (m < 0.6) return 1.0;
  if (m < 0.9) return lerp(1.0, 1.35, (m - 0.6) / 0.3);
  if (m < 1.1) return lerp(1.35, 2.6, (m - 0.9) / 0.2); // 천음속 피크
  if (m < 1.6) return lerp(2.6, 1.9, (m - 1.1) / 0.5);
  if (m < 3.0) return lerp(1.9, 1.35, (m - 1.6) / 1.4);
  if (m < 6.0) return lerp(1.35, 1.1, (m - 3.0) / 3.0);
  return 1.05;
}

/**
 * 받음각(AoA)에 따른 항력계수 배율.
 * 옆으로 누울수록 단면적이 커져 항력이 크게 늘어난다.
 */
export function aoaDragMultiplier(aoa) {
  const s = Math.abs(Math.sin(aoa));
  return 1 + 5.5 * s * s;
}

/**
 * 받음각에 따른 양력계수 (얇은 날개 이론 + 실속).
 */
export function liftCoefficient(aoa, stallAngle = 0.28, clAlpha = 4.4) {
  const a = wrapPi(aoa);
  const abs = Math.abs(a);
  if (abs <= stallAngle) return clAlpha * a;
  // 실속 후: 완만하게 감소하며 평판 양력으로 수렴
  const peak = clAlpha * stallAngle;
  const t = clamp01((abs - stallAngle) / (Math.PI / 2 - stallAngle));
  const decayed = lerp(peak, peak * 0.42, smoothstep(t));
  const plate = 1.15 * Math.sin(2 * a);
  return Math.sign(a) * lerp(decayed, Math.abs(plate), t * 0.7);
}

/** 유도항력 */
export function inducedDrag(cl, aspectRatio = 3, efficiency = 0.8) {
  return (cl * cl) / (Math.PI * aspectRatio * efficiency);
}

/* ──────────────────────────────────────────────────────────────
 * 공력 계산 결과 구조체
 * ────────────────────────────────────────────────────────────── */

export class AeroResult {
  constructor() {
    this.force = new Vec2(); // 관성좌표 힘 (N)
    this.torque = 0; // 토크 (N·m)
    this.drag = 0; // 항력 크기
    this.lift = 0; // 양력 크기
    this.dynamicPressure = 0;
    this.mach = 0;
    this.aoa = 0;
    this.heatFlux = 0;
    this.airspeed = 0;
  }

  reset() {
    this.force.zero();
    this.torque = 0;
    this.drag = 0;
    this.lift = 0;
    this.dynamicPressure = 0;
    this.mach = 0;
    this.aoa = 0;
    this.heatFlux = 0;
    this.airspeed = 0;
    return this;
  }
}

/* ──────────────────────────────────────────────────────────────
 * 본체 공력
 * ────────────────────────────────────────────────────────────── */

/**
 * 로켓 본체에 작용하는 공력을 계산한다.
 *
 * @param {object} vessel  { pos, vel, angle, angularVelocity, aero:{area, cd, length, cpOffset, finArea, finArm} }
 * @param {Atmosphere} atmo
 * @param {number} altitude 지표 기준 고도 (m)
 * @param {Vec2} surfaceVelocity 지표 기준 속도 (자전·바람 반영)
 * @param {AeroResult} out
 */
export function computeAero(vessel, atmo, altitude, surfaceVelocity, out) {
  out.reset();
  if (!atmo || !atmo.exists || altitude >= atmo.height) return out;

  const rho = atmo.densityAt(altitude);
  if (rho <= 1e-9) return out;

  const speed = vLen(surfaceVelocity);
  out.airspeed = speed;
  if (speed < 0.05) return out;

  const q = 0.5 * rho * speed * speed;
  out.dynamicPressure = q;
  out.mach = atmo.machAt(altitude, speed);

  // 기체 전방 벡터 (angle 은 로켓 상단이 향하는 방향)
  const fwd = new Vec2(Math.cos(vessel.angle), Math.sin(vessel.angle));
  const vhat = vNorm(surfaceVelocity);
  const cosA = clamp(vDot(fwd, vhat), -1, 1);
  const aoa = Math.acos(cosA);
  // 부호: 속도벡터가 기체 좌/우 어느 쪽인가
  const side = fwd.x * vhat.y - fwd.y * vhat.x;
  out.aoa = side >= 0 ? aoa : -aoa;

  const aero = vessel.aero;
  const baseArea = aero.area ?? 1.5;
  const cd0 = aero.cd ?? 0.28;

  // 항력
  const cd = cd0 * machDragMultiplier(out.mach) * aoaDragMultiplier(out.aoa);
  const dragMag = q * baseArea * cd;
  out.drag = dragMag;
  out.force.x -= vhat.x * dragMag;
  out.force.y -= vhat.y * dragMag;

  // 본체 양력 (원통 몸체의 미소 양력)
  const bodyCl = 0.9 * Math.sin(2 * out.aoa) * (aero.bodyLift ?? 0.25);
  const liftMag = q * baseArea * bodyCl;
  // 양력은 속도에 수직
  const lhat = new Vec2(-vhat.y, vhat.x);
  out.lift = liftMag;
  out.force.x += lhat.x * liftMag;
  out.force.y += lhat.y * liftMag;

  // 압력중심이 무게중심 뒤/앞인 정도에 따른 복원(또는 발산) 모멘트
  const cpOffset = aero.cpOffset ?? -0.4; // 음수면 CoM 뒤 → 안정
  const bodyLength = aero.length ?? 6;
  const restoring =
    -q * baseArea * Math.sin(out.aoa) * cpOffset * bodyLength * 0.5;
  out.torque += restoring;

  // 핀(그리드핀/안정날개)의 추가 안정성.
  // 무게중심 뒤쪽 날개는 받음각을 줄이는 방향(= 본체 복원 모멘트와 같은 부호)으로 작용한다.
  if (aero.finArea > 0) {
    const finCl = liftCoefficient(out.aoa, 0.32, 5.0);
    const finLift = q * aero.finArea * finCl;
    const arm = aero.finArm ?? bodyLength * 0.45;
    out.torque += finLift * arm;
    out.force.x += lhat.x * finLift * 0.35;
    out.force.y += lhat.y * finLift * 0.35;
  }

  // 각속도 감쇠 (공력 댐핑)
  const damp = aero.rotationalDamping ?? 0.5;
  out.torque -= vessel.angularVelocity * q * baseArea * bodyLength * damp * 0.02;

  // 가열률
  out.heatFlux = atmo.heatFluxAt(altitude, speed, aero.noseRadius ?? 1.0);

  return out;
}

/* ──────────────────────────────────────────────────────────────
 * 낙하산
 * ────────────────────────────────────────────────────────────── */

export const CHUTE_STATE = {
  STOWED: 'stowed',
  DEPLOYING: 'deploying', // 반개
  DEPLOYED: 'deployed', // 완전 전개
  CUT: 'cut',
  DESTROYED: 'destroyed',
};

/**
 * 낙하산 항력 계산.
 * @param {object} chute { state, deployProgress, area, drag, semiDeployArea }
 */
export function parachuteDrag(chute, atmo, altitude, surfaceVelocity) {
  const out = { force: new Vec2(), area: 0, q: 0 };
  if (
    chute.state === CHUTE_STATE.STOWED ||
    chute.state === CHUTE_STATE.CUT ||
    chute.state === CHUTE_STATE.DESTROYED
  ) {
    return out;
  }
  if (!atmo || !atmo.exists) return out;
  const rho = atmo.densityAt(altitude);
  if (rho <= 1e-9) return out;
  const speed = vLen(surfaceVelocity);
  if (speed < 0.01) return out;

  const q = 0.5 * rho * speed * speed;
  const full = chute.area ?? 40;
  const semi = chute.semiDeployArea ?? full * 0.12;
  const area =
    chute.state === CHUTE_STATE.DEPLOYED
      ? lerp(semi, full, smoothstep(chute.deployProgress))
      : semi;

  const cd = chute.drag ?? 1.4;
  const mag = q * area * cd;
  const vhat = vNorm(surfaceVelocity);
  out.force.x = -vhat.x * mag;
  out.force.y = -vhat.y * mag;
  out.area = area;
  out.q = q;
  return out;
}

/** 낙하산이 찢어지는 조건 */
export function chuteOverstressed(chute, q, maxQ = 42000) {
  return chute.state !== CHUTE_STATE.STOWED && q > (chute.maxQ ?? maxQ);
}

/** 낙하산 전개 후 종단속도 추정 */
export function terminalVelocity(mass, gravity, rho, area, cd = 1.4) {
  if (rho <= 0 || area <= 0) return Infinity;
  return Math.sqrt((2 * mass * gravity) / (rho * area * cd));
}

/* ──────────────────────────────────────────────────────────────
 * 열역학
 * ────────────────────────────────────────────────────────────── */

/**
 * 파트 온도 갱신.
 * 입사 열유속 − 복사 방출 − 열용량 기반 확산.
 */
export function updateThermal(part, heatFlux, dt, ambientTemp = 4, opts = {}) {
  const area = part.thermalArea ?? 2;
  const mass = Math.max(part.mass ?? 100, 1);
  const cp = part.specificHeat ?? 900; // J/(kg·K)
  const emissivity = part.emissivity ?? 0.6;
  const shieldFactor = part.heatShield ? part.heatShield.effectiveness : 1;

  const absorbed = heatFlux * area * shieldFactor * (opts.heatMult ?? 1);
  const T = part.temperature ?? ambientTemp;
  const radiated = 5.670374419e-8 * emissivity * area * (Math.pow(T, 4) - Math.pow(ambientTemp, 4));
  const conducted = (opts.conduction ?? 0) * (opts.neighborTemp ?? T - T);

  const dT = ((absorbed - radiated + conducted) * dt) / (mass * cp);
  part.temperature = Math.max(ambientTemp, T + dT);
  return part.temperature;
}

/** 열차폐막 소모 */
export function ablate(shield, heatFlux, dt) {
  if (!shield || shield.ablator <= 0) return 0;
  const rate = (heatFlux / 1e6) * (shield.ablationRate ?? 1.2) * dt;
  const used = Math.min(shield.ablator, rate);
  shield.ablator -= used;
  shield.effectiveness = clamp01(
    0.08 + 0.92 * (shield.ablator / Math.max(shield.maxAblator, 1e-6))
  );
  return used;
}

/** 과열 파괴 판정 */
export function isOverheated(part) {
  return (part.temperature ?? 0) > (part.maxTemp ?? 2000);
}

/** 과열 정도 (0..1) — HUD 게이지용 */
export function heatFraction(part) {
  const max = part.maxTemp ?? 2000;
  return clamp01(((part.temperature ?? 0) - 300) / Math.max(max - 300, 1));
}

/* ──────────────────────────────────────────────────────────────
 * 대기권 재진입 보조 계산
 * ────────────────────────────────────────────────────────────── */

/**
 * 재진입 회랑(corridor) 판정 — 진입각이 너무 얕으면 튕기고,
 * 너무 가파르면 과열/과G 로 파괴된다.
 */
export function reentryAssessment(flightPathAngleDeg, speed, atmo) {
  const shallow = -1.2;
  const steep = -8.5;
  if (flightPathAngleDeg > shallow) {
    return { status: 'skip', label: '진입각이 얕음 — 대기권에서 튕겨나갈 수 있음' };
  }
  if (flightPathAngleDeg < steep) {
    return { status: 'steep', label: '진입각이 가파름 — 과열/고G 위험' };
  }
  return { status: 'nominal', label: '정상 재진입 회랑' };
}

/** 최대 동압(max Q) 추정 고도 */
export function estimateMaxQAltitude(atmo, verticalSpeed) {
  if (!atmo.exists) return 0;
  // ρ(h)·v(h)² 의 최댓값 — 단순 근사식
  return atmo.scaleHeight * Math.log(Math.max(verticalSpeed, 1) / 55 + 1);
}

/** 공력 안정성 지표 (양수 = 안정) */
export function staticMargin(cpOffset, bodyLength) {
  return -cpOffset / Math.max(bodyLength, 1e-3);
}

/** 항력에 의한 감속도 (m/s²) */
export function dragDeceleration(dragForce, mass) {
  return mass > 0 ? dragForce / mass : 0;
}

/** 소닉붐 발생 여부 */
export function sonicBoom(mach, prevMach) {
  return prevMach < 1 && mach >= 1;
}
