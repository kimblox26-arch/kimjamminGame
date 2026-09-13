// ORBITER — 오토파일럿
// 상승(중력 선회), 원형화, 자세 유지, 수직 착륙, 기동 노드 실행을 담당한다.
// 각 모드는 "목표 자세 + 목표 스로틀" 을 만들어 Vessel 의 제어 입력에 써 넣는다.

import {
  clamp,
  clamp01,
  lerp,
  wrapPi,
  smoothstep,
  Vec2,
  vLen,
  vNorm,
  vDot,
  PID,
  mapRange,
} from '../core/math.js';
import { G0 } from '../physics/constants.js';
import { circularVelocity, visViva } from '../physics/orbit.js';
import { bus, EVT } from '../core/events.js';

export const AP_MODE = {
  OFF: 'off',
  ASCENT: 'ascent',
  CIRCULARIZE: 'circularize',
  HOLD_ATTITUDE: 'holdAttitude',
  NODE: 'node',
  LAND: 'land',
  HOVER: 'hover',
  RENDEZVOUS: 'rendezvous',
  KILL_ROTATION: 'killRotation',
};

/**
 * 상승 프로파일 — 고도에 따른 목표 비행경로각.
 */
export class AscentProfile {
  constructor(body, opts = {}) {
    this.body = body;
    /** 발사 시점 고도 — 프로파일은 이 고도를 0 으로 본다 */
    this.baseAltitude = opts.baseAltitude ?? 0;
    /** 수직 상승 유지 고도 (발사대 기준) — 너무 오래 수직이면 중력 손실이 커진다 */
    this.verticalUntil = opts.verticalUntil ?? Math.max(body.radius * 0.0008, 400);
    /** 선회 종료 고도 (여기서 목표각이 0도 = 수평) */
    this.turnEnd =
      opts.turnEnd ?? (body.atmo.exists ? body.atmo.height * 0.88 : body.radius * 0.05);
    /** 목표 원점 고도 (절대 고도) */
    this.targetApoapsis =
      opts.targetApoapsis ?? (body.atmo.exists ? body.atmo.height + 10000 : body.radius * 0.06);
    /** 선회 곡선 지수 — 작을수록 빨리 눕는다 */
    this.curve = opts.curve ?? 0.56;
    /** 동쪽(+1) / 서쪽(-1) 발사 */
    this.direction = opts.direction ?? (body.rotationRate >= 0 ? 1 : -1);
    /** 최대 동압 제한 */
    this.maxQ = opts.maxQ ?? 28000;
  }

  /** 고도에 대한 목표 피치(지평선 기준, rad). 90도=수직 */
  targetPitch(altitude) {
    if (altitude < this.verticalUntil) return Math.PI / 2;
    const t = clamp01(
      (altitude - this.verticalUntil) / (this.turnEnd - this.verticalUntil)
    );
    const shaped = Math.pow(t, this.curve);
    return (Math.PI / 2) * (1 - shaped);
  }
}

/**
 * 오토파일럿 본체.
 */
export class Autopilot {
  constructor(vessel) {
    this.vessel = vessel;
    this.mode = AP_MODE.OFF;
    this.enabled = false;
    this.profile = null;
    this.node = null;
    this.targetAltitude = 0;
    this.hoverAltitude = 100;
    this.status = '대기';
    this.log = [];

    this.attitudePid = new PID(3.2, 0.05, 1.5, {
      min: -1,
      max: 1,
      integralLimit: 0.3,
    });
    this.throttlePid = new PID(0.9, 0.15, 0.25, { min: 0, max: 1, integralLimit: 1 });
    this.targetAngle = null;
    this.burnRemaining = 0;
    this.stageAuto = true;
  }

  setMode(mode, opts = {}) {
    this.mode = mode;
    this.enabled = mode !== AP_MODE.OFF;
    this.attitudePid.reset();
    this.throttlePid.reset();
    this.targetAngle = null;

    switch (mode) {
      case AP_MODE.ASCENT:
        this.profile = new AscentProfile(this.vessel.body, {
          baseAltitude: this.vessel.altitude,
          ...opts,
        });
        this.status = '상승 프로파일 실행';
        this.phase = 'liftoff';
        break;
      case AP_MODE.CIRCULARIZE:
        this.targetAltitude = opts.altitude ?? this.vessel.apoapsis;
        this.status = '원형화 대기';
        break;
      case AP_MODE.NODE:
        this.node = opts.node ?? null;
        this.status = '기동 노드 실행 대기';
        break;
      case AP_MODE.LAND:
        this.status = '착륙 시퀀스';
        this.phase = 'deorbit';
        break;
      case AP_MODE.HOVER:
        this.hoverAltitude = opts.altitude ?? this.vessel.terrainAltitude;
        this.status = `호버링 ${Math.round(this.hoverAltitude)} m`;
        break;
      case AP_MODE.KILL_ROTATION:
        this.status = '회전 정지';
        break;
      default:
        this.status = '대기';
        break;
    }
    this.note(`모드: ${this.status}`);
    return this;
  }

  disable() {
    this.setMode(AP_MODE.OFF);
    this.vessel.control.roll = 0;
  }

  note(text) {
    this.log.push({ t: this.vessel.missionTime, text });
    if (this.log.length > 40) this.log.shift();
  }

  /* ──────────────────────────────────────────────────────────
   * 갱신
   * ────────────────────────────────────────────────────────── */

  update(dt) {
    if (!this.enabled || this.vessel.destroyed) return;
    switch (this.mode) {
      case AP_MODE.ASCENT:
        this.updateAscent(dt);
        break;
      case AP_MODE.CIRCULARIZE:
        this.updateCircularize(dt);
        break;
      case AP_MODE.NODE:
        this.updateNode(dt);
        break;
      case AP_MODE.LAND:
        this.updateLanding(dt);
        break;
      case AP_MODE.HOVER:
        this.updateHover(dt);
        break;
      case AP_MODE.KILL_ROTATION:
        this.updateKillRotation(dt);
        break;
      case AP_MODE.HOLD_ATTITUDE:
        if (this.targetAngle !== null) this.steerTo(this.targetAngle, dt);
        break;
      default:
        break;
    }
  }

  /**
   * 목표 관성각으로 기체를 돌린다.
   */
  steerTo(targetAngle, dt, gain = 1) {
    const v = this.vessel;
    const err = wrapPi(targetAngle - v.angle);
    // 각속도를 고려한 예측 제어 (bang-bang 억제)
    const damping = v.angularVelocity * 2.4;
    const cmd = clamp(-(err * 3.0 - damping) * gain, -1, 1);
    v.control.roll = cmd;
    this.attitudeError = err;
    return Math.abs(err);
  }

  /* ── 상승 ─────────────────────────────────────────────── */

  updateAscent(dt) {
    const v = this.vessel;
    const p = this.profile;
    if (!p) return;

    const alt = v.altitude - p.baseAltitude;
    const up = v.up;
    const upAngle = Math.atan2(up.y, up.x);

    // 목표 피치 → 관성각.
    // pitch = 90° 면 천정 방향(수직), 0° 면 자전 방향으로 수평.
    const pitch = p.targetPitch(alt);
    const target = upAngle + p.direction * (Math.PI / 2 - pitch);
    this.steerTo(target, dt);

    // 스로틀 제어 — max Q 제한 + 원점 목표
    let throttle = 1;
    if (v.dynamicPressure > p.maxQ) {
      throttle = clamp(1 - (v.dynamicPressure - p.maxQ) / (p.maxQ * 0.5), 0.35, 1);
      this.phase = 'maxq';
    } else if (v.apoapsis > p.targetApoapsis * 0.9) {
      // 목표 원점에 가까워지면 스로틀을 줄여 오버슈트를 막는다.
      // 0.5 % 안까지 들어오면 곧바로 원형화 단계로 넘긴다 —
      // 그러지 않으면 목표 바로 아래에서 미세 분사를 반복하며 연료를 태운다.
      throttle = clamp(
        mapRange(v.apoapsis, p.targetApoapsis * 0.9, p.targetApoapsis, 1, 0.2),
        0,
        1
      );
      this.phase = 'apoapsis';
      // 이미 원점을 지나 하강 중이라면 더 밀어 올릴 이유가 없다
      const pastApoapsis =
        v.verticalSpeed < 0 && v.apoapsis > v.body.atmo.height;
      if (v.apoapsis >= p.targetApoapsis * 0.99 || pastApoapsis) {
        v.setThrottle(0);
        this.note('목표 원점 도달 — 원형화로 전환');
        this.setMode(AP_MODE.CIRCULARIZE, { altitude: v.apoapsis });
        return;
      }
    } else if (alt < p.verticalUntil) {
      this.phase = 'liftoff';
    } else {
      this.phase = 'gravityTurn';
    }

    v.setThrottle(throttle);

    // 자동 스테이징
    if (this.stageAuto) this.autoStage();

    this.status = {
      liftoff: '수직 상승',
      gravityTurn: '중력 선회',
      maxq: 'max Q 스로틀 제한',
      apoapsis: '원점 조정',
    }[this.phase] ?? '상승';
  }

  /* ── 원형화 ────────────────────────────────────────────── */

  updateCircularize(dt) {
    const v = this.vessel;
    if (!v.orbit) return;

    const orbit = v.orbit;
    const rAp = orbit.apoapsis;
    // 궤도 요소의 기준시각(epoch)은 우주 시간이므로 반드시 같은 시계를 써야 한다
    const now = v.universeTime ?? 0;
    // 원점까지 남은 시간
    const tAp = orbit.timeToTrueAnomaly(Math.PI, now);
    const dvNeeded =
      circularVelocity(v.body.mu, rAp) - visViva(v.body.mu, rAp, orbit.a);

    // 분사 시간 추정
    const thrust = v.maxThrust(0);
    const isp = 320;
    const burnTime =
      thrust > 0
        ? (v.mass * (1 - Math.exp(-dvNeeded / (isp * G0)))) / (thrust / (isp * G0))
        : Infinity;
    this.burnRemaining = burnTime;

    const lead = burnTime / 2;
    // 이미 원점을 지나 떨어지고 있다면 기다릴 것 없이 바로 근점을 끌어올린다.
    const descendingInSpace =
      v.verticalSpeed < 0 && v.altitude > v.body.atmo.height * 0.8;

    if (tAp <= lead + 0.5 || descendingInSpace || v.periapsis > v.body.atmo.height) {
      // 분사 구간 — "지금 높이에서의 원궤도" 를 목표로 잡는다.
      // 수평속도를 원궤도 속도까지 올리고 수직속도를 0 으로 만드는 방향으로 민다.
      const r = vLen(v.pos);
      const vCirc = circularVelocity(v.body.mu, r);
      const up = vNorm(v.pos);
      // 진행 방향의 수평 단위벡터
      const spin = Math.sign(v.pos.x * v.vel.y - v.pos.y * v.vel.x) || 1;
      const tangent = new Vec2(-up.y * spin, up.x * spin);

      const dvH = vCirc - Math.abs(vDot(v.vel, tangent));
      const dvV = -vDot(v.vel, up);
      const need = Math.hypot(dvH, dvV);

      const dirX = tangent.x * dvH + up.x * dvV;
      const dirY = tangent.y * dvH + up.y * dvV;
      if (need > 1e-6) this.steerTo(Math.atan2(dirY, dirX), dt);

      if (need < 2.5 && v.periapsis > v.body.atmo.height) {
        v.setThrottle(0);
        this.note('원형화 완료');
        bus.emit(EVT.TOAST, { text: '궤도 원형화 완료', kind: 'success' });
        this.disable();
        return;
      }
      // 남은 Δv 에 비례해 스로틀을 줄여 오버슈트를 막는다
      v.setThrottle(clamp(need / 30, 0.04, 1));
      this.status = `원형화 분사 (Δv ${need.toFixed(0)} m/s)`;
      if (this.stageAuto) this.autoStage();
    } else {
      // 대기 중에는 진행 방향으로 정렬해 둔다
      this.steerTo(Math.atan2(v.vel.y, v.vel.x), dt);
      v.setThrottle(0);
      this.status = `원점까지 ${Math.max(0, tAp - lead).toFixed(0)}초 대기`;
    }
  }

  /* ── 기동 노드 ─────────────────────────────────────────── */

  updateNode(dt) {
    const v = this.vessel;
    const node = this.node;
    if (!node) {
      this.disable();
      return;
    }

    const remaining = node.remainingDeltaV ?? node.deltaVMagnitude;
    const dir = node.worldDirection(v);
    const targetAngle = Math.atan2(dir.y, dir.x);
    this.steerTo(targetAngle, dt);

    const thrust = v.maxThrust(0);
    const burnTime =
      thrust > 0 ? (remaining * v.mass) / Math.max(thrust, 1) : Infinity;
    const timeToNode = node.time - v.universeTime;

    if (timeToNode <= burnTime / 2) {
      const aligned = Math.abs(this.attitudeError ?? 1) < 0.12;
      if (!aligned && remaining > 5) {
        v.setThrottle(0);
        this.status = '자세 정렬 중';
        return;
      }
      // 남은 Δv 에 따라 스로틀을 줄여 오버슈트 방지
      const throttle = clamp(remaining / 25, 0.05, 1);
      v.setThrottle(throttle);
      this.status = `노드 분사 — 남은 Δv ${remaining.toFixed(1)} m/s`;
      if (this.stageAuto) this.autoStage();
      if (remaining < 0.15) {
        v.setThrottle(0);
        this.note('기동 노드 완료');
        bus.emit(EVT.TOAST, { text: '기동 완료', kind: 'success' });
        node.executed = true;
        this.disable();
      }
    } else {
      v.setThrottle(0);
      this.status = `노드까지 ${Math.max(0, timeToNode - burnTime / 2).toFixed(0)}초`;
    }
  }

  /* ── 수직 착륙 ─────────────────────────────────────────── */

  /**
   * 서프사이드 역추진 착륙.
   * 1) 역행 정렬 → 2) 수평속도 제거 → 3) 감속 연소 → 4) 최종 강하
   */
  updateLanding(dt) {
    const v = this.vessel;
    if (v.landed || v.splashed) {
      v.setThrottle(0);
      this.note('착륙 완료');
      this.disable();
      return;
    }

    const up = v.up;
    const sv = v.surfaceVelocity();
    const speed = vLen(sv);
    const alt = v.terrainAltitude;
    const g = v.body.gravityMagnitudeAt(vLen(v.pos));
    const thrust = v.maxThrust(v.body.atmo.pressureAt(v.altitude));
    const maxDecel = thrust / v.mass - g;

    // 정지에 필요한 거리 (여유 20%)
    const vDown = -v.verticalSpeed;
    const stopDistance =
      maxDecel > 0.1 ? (vDown * vDown) / (2 * maxDecel) : Infinity;
    this.stopDistance = stopDistance;

    // 목표 자세: 지표 기준 역행
    let targetAngle;
    if (speed > 2) {
      targetAngle = Math.atan2(-sv.y, -sv.x);
      // 아주 낮은 고도에서는 수직 자세를 우선한다
      if (alt < 120) {
        const upAngle = Math.atan2(up.y, up.x);
        const blend = clamp01(alt / 120);
        targetAngle = upAngle + wrapPi(targetAngle - upAngle) * blend;
      }
    } else {
      targetAngle = Math.atan2(up.y, up.x);
    }
    this.steerTo(targetAngle, dt);

    // 다리 전개
    if (alt < 400 && !v.gearDown) v.toggleGear();

    // 아직 궤도에 머물러 있으면 먼저 역행 분사로 궤도를 떨어뜨려야 한다.
    // (이 단계가 없으면 영원히 자유낙하만 기다리게 된다)
    const deorbitTargetPe = v.body.atmo.exists
      ? v.body.atmo.height * 0.3
      : -v.body.radius * 0.05;
    const needDeorbit = v.periapsis > deorbitTargetPe && alt > 3000;

    // 실제로 지면까지 남은 거리(다리 길이까지 고려)
    const clearance = Number.isFinite(v.groundClearance)
      ? Math.max(v.groundClearance, 0)
      : alt;

    // 스로틀 결정
    let throttle = 0;
    if (clearance < 60) {
      this.phase = 'touchdown';
      // 호버에 필요한 스로틀을 먼저 깔고(피드포워드), 목표 강하율과의
      // 오차만큼만 더하거나 뺀다. 이러지 않으면 튕겨 오르며 진동한다.
      const hover = thrust > 1 ? clamp01((v.mass * g) / thrust) : 1;
      const targetVs = -clamp(0.8 + clearance * 0.12, 0.8, 8);
      const err = v.verticalSpeed - targetVs; // 음수면 너무 빨리 내려가는 중
      throttle = clamp01(hover - err * 0.35);
      if (v.landed || v.splashed) throttle = 0;
    } else if (stopDistance > alt * 0.82) {
      this.phase = 'suicideBurn';
      throttle = 1;
    } else if (stopDistance > alt * 0.6) {
      this.phase = 'suicideBurn';
      throttle = clamp01((stopDistance / (alt * 0.82)) * 1.2);
    } else if (needDeorbit) {
      this.phase = 'deorbit';
      throttle = 1;
    } else if (speed > 40 && alt < Math.max(12000, v.body.radius * 0.06)) {
      this.phase = 'braking';
      throttle = clamp01((speed - 40) / 200);
    } else {
      this.phase = 'coast';
      throttle = 0;
    }

    // 지형 여유 확보 — 너무 빨리 떨어지면 무조건 점화
    if (vDown > 90 && alt < 3000) throttle = 1;

    v.setThrottle(throttle);
    this.status = {
      deorbit: '역추진 대기',
      braking: '수평속도 제거',
      suicideBurn: '감속 연소',
      touchdown: '최종 강하',
      coast: '자유 낙하',
    }[this.phase] ?? '착륙';
  }

  /* ── 호버링 ────────────────────────────────────────────── */

  updateHover(dt) {
    const v = this.vessel;
    const up = v.up;
    this.steerTo(Math.atan2(up.y, up.x), dt);

    const err = this.hoverAltitude - v.terrainAltitude;
    const targetVs = clamp(err * 0.25, -18, 18);
    const vsErr = targetVs - v.verticalSpeed;
    const g = v.body.gravityMagnitudeAt(vLen(v.pos));
    const hoverThrottle =
      v.maxThrust(v.body.atmo.pressureAt(v.altitude)) > 0
        ? (v.mass * g) / v.maxThrust(v.body.atmo.pressureAt(v.altitude))
        : 1;
    const throttle = clamp01(hoverThrottle + vsErr * 0.08);
    v.setThrottle(throttle);
    this.status = `호버 ${Math.round(v.terrainAltitude)} / ${Math.round(
      this.hoverAltitude
    )} m`;
  }

  /* ── 회전 정지 ─────────────────────────────────────────── */

  updateKillRotation(dt) {
    const v = this.vessel;
    v.control.roll = clamp(v.angularVelocity * 5, -1, 1);
    if (Math.abs(v.angularVelocity) < 0.004) {
      v.control.roll = 0;
      this.note('회전 정지 완료');
      this.disable();
    }
    this.status = `각속도 ${(v.angularVelocity * 57.3).toFixed(2)}°/s`;
  }

  /* ── 보조 ──────────────────────────────────────────────── */

  /** 현재 스테이지가 소진되면 다음 스테이지를 점화한다 */
  autoStage() {
    const v = this.vessel;
    const running = v.parts.filter((p) => !p.destroyed && p.isEngine && p.running);
    if (running.length && !running.every((p) => p.flameout)) return false;
    if (v.stageIndex >= v.stages.length) return false;
    // 낙하산 스테이지는 자동으로 넘기지 않는다
    const next = v.stages[v.stageIndex];
    if (next.chutes.length && !next.ignite.length) return false;
    v.activateStage();
    this.note(`자동 스테이징 → ${v.stageIndex}`);
    return true;
  }

  /** 현재 상태 요약 */
  describe() {
    return {
      mode: this.mode,
      status: this.status,
      phase: this.phase ?? null,
      attitudeError: this.attitudeError
        ? (this.attitudeError * 57.2958).toFixed(1) + '°'
        : '—',
      burnRemaining: this.burnRemaining,
    };
  }
}

/**
 * 착륙 예측 — 현재 궤적이 지면에 닿는 지점과 시각.
 */
export function predictLanding(vessel, system, maxTime = 1200, dt = 1.0) {
  const body = vessel.body;
  const pos = vessel.pos.clone();
  const vel = vessel.vel.clone();
  const atmo = body.atmo;
  let t = 0;
  const accel = new Vec2();

  while (t < maxTime) {
    const r = vLen(pos);
    const theta = Math.atan2(pos.y, pos.x);
    const surfaceR = body.terrain.radiusAt(theta);
    if (r <= surfaceR) {
      return { hit: true, time: t, pos: pos.clone(), theta, radius: r };
    }
    // 중력
    const f = -body.mu / (r * r * r);
    accel.set(pos.x * f, pos.y * f);
    // 항력 (대략)
    const alt = r - body.radius;
    if (atmo.exists && alt < atmo.height) {
      const rho = atmo.densityAt(alt);
      const sv = new Vec2(
        vel.x + pos.y * body.rotationRate,
        vel.y - pos.x * body.rotationRate
      );
      const s = vLen(sv);
      if (s > 1) {
        const area = vessel.aero.area;
        const cd = vessel.aero.cd;
        const drag = 0.5 * rho * s * s * area * cd;
        accel.x -= (sv.x / s) * (drag / vessel.mass);
        accel.y -= (sv.y / s) * (drag / vessel.mass);
      }
    }
    vel.x += accel.x * dt;
    vel.y += accel.y * dt;
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    t += dt;
    if (r > body.soi) return { hit: false, escaped: true, time: t };
  }
  return { hit: false, time: maxTime };
}

/**
 * 자살 연소 시작 고도 계산.
 */
export function suicideBurnAltitude(vessel) {
  const g = vessel.body.gravityMagnitudeAt(vLen(vessel.pos));
  const thrust = vessel.maxThrust(vessel.body.atmo.pressureAt(vessel.altitude));
  const decel = thrust / vessel.mass - g;
  if (decel <= 0) return Infinity;
  const v = Math.abs(vessel.verticalSpeed);
  return (v * v) / (2 * decel);
}

/**
 * 착륙 가능성 평가 — HUD 경고용.
 */
export function landingAssessment(vessel) {
  const alt = vessel.terrainAltitude;
  const burnAlt = suicideBurnAltitude(vessel);
  const vs = vessel.verticalSpeed;
  if (vs > -1) return { status: 'ok', label: '강하 중 아님' };
  if (!Number.isFinite(burnAlt)) {
    return { status: 'danger', label: '추력 부족 — 감속 불가' };
  }
  const margin = alt - burnAlt;
  if (margin < 0) return { status: 'danger', label: '감속 시점을 놓쳤습니다' };
  if (margin < alt * 0.15) return { status: 'warn', label: '지금 감속을 시작하세요' };
  return {
    status: 'ok',
    label: `감속 시작까지 ${Math.round(margin)} m`,
    margin,
  };
}
