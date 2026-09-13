// ORBITER — 비행 중 기체(Vessel)
//
// 설계실의 Craft 를 받아 실제로 움직이는 강체로 만든다.
// 좌표계는 현재 SOI 천체 중심 관성계(BCI). 위치/속도는 Vec2, 자세는 스칼라 각도.
//
// 매 물리 스텝마다:
//   1) 질량 특성 갱신  2) 중력  3) 추력  4) 공력  5) 낙하산  6) 지면 접촉
//   7) 회전 적분  8) 열역학  9) 상황 판정  10) SOI 전환

import {
  Vec2,
  clamp,
  clamp01,
  wrapPi,
  wrapTau,
  lerp,
  vLen,
  vNorm,
  vDot,
  PID,
} from '../core/math.js';
import { G0, RESOURCES, SITUATION } from '../physics/constants.js';
import { stateToOrbit } from '../physics/orbit.js';
import {
  computeAero,
  AeroResult,
  parachuteDrag,
  CHUTE_STATE,
  chuteOverstressed,
  updateThermal,
  ablate,
  isOverheated,
} from '../physics/aero.js';
import { rk4 } from '../physics/integrator.js';
import { ResourceNetwork, powerBudget, sunlightFactor } from './resources.js';
import { buildStages } from './staging.js';
import { bus, EVT } from '../core/events.js';

let _vesselId = 1;

/**
 * 비행 중 부품 인스턴스.
 */
export class VesselPart {
  constructor(craftPart) {
    this.uid = craftPart.uid;
    this.defId = craftPart.defId;
    this.def = craftPart.def;
    this.localX = craftPart.x;
    this.localY = craftPart.y;
    this.rot = craftPart.rot;
    this.mirrored = craftPart.mirrored;
    this.stage = craftPart.stage;
    this.parentUid = craftPart.parentUid;

    this.resources = { ...craftPart.resources };
    this.disabledResources = new Set(craftPart.disabledResources);
    for (const k of this.disabledResources) this.resources[k] = 0;

    this.temperature = 290;
    this.maxTemp = this.def.maxTemp ?? 2000;
    this.destroyed = false;
    this.active = true;

    // 상태 플래그
    this.deployed = this.def.solar?.alwaysOn ?? false;
    this.chuteState = this.def.chute ? CHUTE_STATE.STOWED : null;
    this.chuteProgress = 0;
    this.legExtended = false;
    this.legCompression = 0;
    this.legVelocity = 0;
    this.finDeflection = 0;
    this.airbrakeOpen = false;
    this.lightOn = false;
    this.ladderOut = false;

    // 엔진 상태
    this.igniting = 0;
    this.running = false;
    this.throttleActual = 0;
    this.ignitionsLeft = this.def.engine?.ignitions ?? -1;
    this.gimbalAngle = 0;
    this.flameout = false;

    // 열차폐
    if (this.def.heatShield) {
      this.shield = {
        ablator: this.def.heatShield.ablator,
        maxAblator: this.def.heatShield.maxAblator,
        ablationRate: this.def.heatShield.ablationRate,
        effectiveness: 0.08,
      };
    } else {
      this.shield = null;
    }

    this.thermalArea = Math.max(this.def.size.w * this.def.size.h, 0.4);
    this.specificHeat = 900;
    this.emissivity = 0.65;
    this.mass = 0;
    this.updateMass();
  }

  updateMass() {
    let m = this.def.mass;
    for (const k in this.resources) {
      const r = RESOURCES[k];
      if (r) m += this.resources[k] * r.density;
    }
    this.mass = m;
    return m;
  }

  get isEngine() {
    return !!this.def.engine;
  }

  get resourceMass() {
    let m = 0;
    for (const k in this.resources) {
      const r = RESOURCES[k];
      if (r) m += this.resources[k] * r.density;
    }
    return m;
  }

  /** 기압 보간 추력 */
  thrustAt(pressureAtm) {
    const e = this.def.engine;
    if (!e) return 0;
    const t = clamp01(pressureAtm);
    return lerp(e.thrust, e.thrustSL, t);
  }

  ispAt(pressureAtm) {
    const e = this.def.engine;
    if (!e) return 1;
    const t = clamp01(pressureAtm);
    return Math.max(lerp(e.isp, e.ispSL, t), 1);
  }

  toJSON() {
    return {
      uid: this.uid,
      defId: this.defId,
      x: this.localX,
      y: this.localY,
      rot: this.rot,
      mirrored: this.mirrored,
      stage: this.stage,
      resources: this.resources,
      temperature: this.temperature,
      destroyed: this.destroyed,
      chuteState: this.chuteState,
      deployed: this.deployed,
      legExtended: this.legExtended,
      shield: this.shield ? { ablator: this.shield.ablator } : null,
    };
  }
}

/**
 * 비행 기체.
 */
export class Vessel {
  /**
   * @param {Craft} craft
   * @param {object} opts { body, name, difficulty }
   */
  constructor(craft, opts = {}) {
    this.id = `v${_vesselId++}`;
    this.name = opts.name ?? craft.name ?? '무명 기체';
    this.craftName = craft.name;

    /** @type {VesselPart[]} */
    this.parts = craft.parts.map((p) => new VesselPart(p));
    this.rootUid = craft.rootUid;

    this.body = opts.body ?? null;
    this.pos = new Vec2();
    this.vel = new Vec2();
    this.angle = Math.PI / 2; // 위쪽을 향함
    this.angularVelocity = 0;

    /* 제어 상태 */
    this.throttle = 0;
    this.targetThrottle = 0;
    this.control = { pitch: 0, roll: 0, translateX: 0, translateY: 0 };
    this.sas = false;
    this.sasMode = 'off'; // off | hold | prograde | retrograde | radialIn | radialOut | target | surface
    this.rcs = false;
    this.gearDown = false;
    this.lightsOn = false;
    this.brakes = false;

    /* 스테이징 */
    this.stages = buildStages(this.parts);
    this.stageIndex = 0;
    this.stagedParts = new Set();

    /* 파생 값 */
    this.mass = 0;
    this.dryMass = 0;
    this.com = new Vec2();
    this.inertia = 1;
    this.aero = null;
    this.net = new ResourceNetwork(this.parts);

    /* 비행 상태 */
    this.situation = SITUATION.PRELAUNCH;
    this.landed = false;
    this.splashed = false;
    this.destroyed = false;
    this.missionTime = 0;
    this.launchTime = 0;
    this.hasLaunched = false;
    this.clamped = this.parts.some((p) => p.def.clamp);

    /* 계측 */
    this.altitude = 0;
    this.terrainAltitude = 0;
    this.surfaceSpeed = 0;
    this.verticalSpeed = 0;
    this.horizontalSpeed = 0;
    this.orbitalSpeed = 0;
    this.gForce = 0;
    this.maxG = 0;
    this.maxQ = 0;
    this.dynamicPressure = 0;
    this.mach = 0;
    this.aoa = 0;
    this.heatFlux = 0;
    this.hottestPart = null;
    this.hottestFraction = 0;
    this.apoapsis = 0;
    this.periapsis = 0;
    this.orbit = null;
    this.totalDeltaVUsed = 0;
    this.fuelBurned = 0;
    this.distanceTravelled = 0;
    this.prevMach = 0;
    this.sunFactor = 1;
    this.powerNet = 0;
    this.brownout = false;

    /* 내부 */
    this._aeroResult = new AeroResult();
    this._accelTmp = new Vec2();
    this._lastAccel = new Vec2();
    this._pitchPid = new PID(2.4, 0.02, 1.1, { min: -1, max: 1, integralLimit: 0.4 });
    this._difficulty = opts.difficulty ?? {
      fuelMult: 1,
      dragMult: 1,
      heatMult: 1,
      crashMult: 1,
    };
    this._groundContactParts = [];
    this._warnLowFuel = false;
    this._prevSituation = this.situation;

    this.recomputeMass();
    this.updateAeroProperties();
  }

  /* ──────────────────────────────────────────────────────────
   * 질량 특성
   * ────────────────────────────────────────────────────────── */

  recomputeMass() {
    let m = 0;
    let dry = 0;
    let cx = 0;
    let cy = 0;
    for (const p of this.parts) {
      if (p.destroyed) continue;
      p.updateMass();
      m += p.mass;
      dry += p.def.mass;
      cx += p.localX * p.mass;
      cy += p.localY * p.mass;
    }
    this.mass = Math.max(m, 1);
    this.dryMass = dry;
    this.com.set(cx / this.mass, cy / this.mass);

    let I = 0;
    for (const p of this.parts) {
      if (p.destroyed) continue;
      const w = p.def.size.w;
      const h = p.def.size.h;
      const own = (p.mass * (w * w + h * h)) / 12;
      const dx = p.localX - this.com.x;
      const dy = p.localY - this.com.y;
      I += own + p.mass * (dx * dx + dy * dy);
    }
    this.inertia = Math.max(I, 1);
  }

  updateAeroProperties() {
    let cdArea = 0;
    let finArea = 0;
    let noseRadius = 0.5;
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    let cpx = 0;
    let cpy = 0;
    let areaSum = 0;
    let extraDrag = 0;

    for (const p of this.parts) {
      if (p.destroyed) continue;
      const d = p.def.drag;
      let a = 0;
      if (d) {
        cdArea += d.cd * Math.abs(d.area);
        a = Math.abs(d.area) * Math.max(d.cd, 0.02);
      }
      if (p.def.fin) {
        finArea += p.def.fin.area;
        a += p.def.fin.area * 2.2;
      }
      if (p.def.airbrake && p.airbrakeOpen) {
        extraDrag += p.def.airbrake.extraDrag;
        a += p.def.airbrake.extraDrag;
      }
      if (p.def.noseRadius) noseRadius = Math.max(noseRadius, p.def.noseRadius);
      cpx += p.localX * a;
      cpy += p.localY * a;
      areaSum += a;

      const hh = p.def.size.h / 2;
      const hw = p.def.size.w / 2;
      minY = Math.min(minY, p.localY - hh);
      maxY = Math.max(maxY, p.localY + hh);
      minX = Math.min(minX, p.localX - hw);
      maxX = Math.max(maxX, p.localX + hw);
    }

    if (!Number.isFinite(minY)) {
      minY = 0;
      maxY = 1;
      minX = 0;
      maxX = 1;
    }
    const length = Math.max(maxY - minY, 1);
    const width = Math.max(maxX - minX, 0.5);
    const frontalArea = Math.max(width * 0.62, 0.4);
    const cop = areaSum > 0 ? new Vec2(cpx / areaSum, cpy / areaSum) : new Vec2();

    this.bounds = { minX, maxX, minY, maxY, length, width };
    this.aero = {
      area: frontalArea,
      cd: clamp((cdArea + extraDrag) / frontalArea, 0.05, 2.2),
      length,
      finArea,
      finArm: Math.max(Math.abs(cop.y - this.com.y), length * 0.25),
      cpOffset: cop.y - this.com.y,
      noseRadius,
      bodyLift: 0.22,
      rotationalDamping: 0.7,
    };
    this.cop = cop;
  }

  /* ──────────────────────────────────────────────────────────
   * 좌표/계측
   * ────────────────────────────────────────────────────────── */

  /** 부품의 관성좌표 위치 */
  partWorldPos(part) {
    const dx = part.localX - this.com.x;
    const dy = part.localY - this.com.y;
    const c = Math.cos(this.angle - Math.PI / 2);
    const s = Math.sin(this.angle - Math.PI / 2);
    return new Vec2(
      this.pos.x + dx * c - dy * s,
      this.pos.y + dx * s + dy * c
    );
  }

  /** 기체 전방(위쪽) 단위벡터 */
  get forward() {
    return new Vec2(Math.cos(this.angle), Math.sin(this.angle));
  }

  /** 기체 우현 단위벡터 */
  get right() {
    return new Vec2(Math.sin(this.angle), -Math.cos(this.angle));
  }

  /** 천체 중심에서 기체를 향하는 단위벡터(= 로컬 상방) */
  get up() {
    return vNorm(this.pos);
  }

  /** 지표 기준 속도 (자전 제거) */
  surfaceVelocity() {
    if (!this.body) return this.vel.clone();
    const w = this.body.rotationRate;
    return new Vec2(this.vel.x + this.pos.y * w, this.vel.y - this.pos.x * w);
  }

  /** 계측값 갱신 */
  updateInstruments(t) {
    if (!this.body) return;
    const r = vLen(this.pos);
    this.altitude = r - this.body.radius;
    const theta = Math.atan2(this.pos.y, this.pos.x);
    const surfaceR = this.body.terrain.radiusAt(theta - this.body.rotationAt(t));
    this.terrainAltitude = r - surfaceR;
    this.terrainRadius = surfaceR;

    const up = this.up;
    const sv = this.surfaceVelocity();
    this.surfaceSpeed = vLen(sv);
    this.verticalSpeed = vDot(sv, up);
    this.horizontalSpeed = Math.sqrt(
      Math.max(this.surfaceSpeed * this.surfaceSpeed - this.verticalSpeed * this.verticalSpeed, 0)
    );
    this.orbitalSpeed = vLen(this.vel);

    // 궤도 요소
    this.orbit = stateToOrbit(this.pos, this.vel, this.body.mu, t);
    this.apoapsis = this.orbit.apoapsis - this.body.radius;
    this.periapsis = this.orbit.periapsis - this.body.radius;

    // 자세각 (지평선 기준)
    this.pitchAngle = wrapPi(this.angle - Math.atan2(up.y, up.x));
    // 진행방향 기준 각도
    if (this.surfaceSpeed > 1) {
      const vhat = vNorm(sv);
      this.velocityAngle = Math.atan2(vhat.y, vhat.x);
      this.flightPathAngle = Math.asin(
        clamp(this.verticalSpeed / Math.max(this.surfaceSpeed, 1e-6), -1, 1)
      );
    } else {
      this.velocityAngle = this.angle;
      this.flightPathAngle = 0;
    }
  }

  /* ──────────────────────────────────────────────────────────
   * 스테이징
   * ────────────────────────────────────────────────────────── */

  get currentStage() {
    return this.stages[this.stageIndex] ?? null;
  }

  get stagesRemaining() {
    return Math.max(0, this.stages.length - this.stageIndex);
  }

  /** 스테이지 실행 */
  activateStage() {
    if (this.stageIndex >= this.stages.length) return false;
    const stage = this.stages[this.stageIndex];
    this.stageIndex++;

    const detached = [];
    for (const uid of stage.decouple) {
      const part = this.parts.find((p) => p.uid === uid);
      if (!part || part.destroyed) continue;
      detached.push(part);
    }

    for (const uid of stage.ignite) {
      const part = this.parts.find((p) => p.uid === uid);
      if (!part || part.destroyed) continue;
      if (part.ignitionsLeft === 0) continue;
      part.running = true;
      part.igniting = 0.25;
      if (part.ignitionsLeft > 0) part.ignitionsLeft--;
      bus.emit(EVT.ENGINE_IGNITE, { vessel: this, part });
    }

    for (const uid of stage.chutes) {
      const part = this.parts.find((p) => p.uid === uid);
      if (part && part.chuteState === CHUTE_STATE.STOWED) {
        this.deployChute(part);
      }
    }

    if (stage.clamps.length) {
      for (const uid of stage.clamps) {
        const part = this.parts.find((p) => p.uid === uid);
        if (part) {
          part.destroyed = true;
          this.clamped = false;
        }
      }
    }

    if (detached.length) this.detachParts(detached);

    this.recomputeMass();
    this.updateAeroProperties();
    this.net.rebuild();

    bus.emit(EVT.STAGE, {
      vessel: this,
      stage: this.stageIndex,
      detached: detached.length,
    });

    if (!this.hasLaunched && (stage.ignite.length || stage.clamps.length)) {
      this.hasLaunched = true;
      bus.emit(EVT.LAUNCH, { vessel: this });
    }
    return true;
  }

  /** 부품 분리 — 잔해로 만든다 */
  detachParts(parts) {
    const debris = [];
    for (const part of parts) {
      part.destroyed = true;
      const wp = this.partWorldPos(part);
      const outward = vNorm(new Vec2(part.localX - this.com.x, part.localY - this.com.y));
      const force = part.def.decoupler?.force ?? 1200;
      const kick = force / Math.max(part.mass, 20);
      debris.push({
        defId: part.defId,
        def: part.def,
        pos: wp,
        vel: new Vec2(
          this.vel.x + outward.x * kick * 0.05,
          this.vel.y + outward.y * kick * 0.05 - 0.5
        ),
        angle: this.angle,
        angularVelocity: (Math.random() - 0.5) * 1.2,
        mass: part.mass,
        life: 240,
      });
      bus.emit(EVT.PART_DETACHED, { vessel: this, part });
    }
    this.stagedParts.add(this.stageIndex);
    this.lastDebris = debris;
    return debris;
  }

  /* ──────────────────────────────────────────────────────────
   * 액션 그룹
   * ────────────────────────────────────────────────────────── */

  toggleRcs() {
    this.rcs = !this.rcs;
    return this.rcs;
  }

  toggleSas() {
    this.sas = !this.sas;
    if (this.sas && this.sasMode === 'off') this.sasMode = 'hold';
    if (!this.sas) this.sasMode = 'off';
    this._pitchPid.reset();
    return this.sas;
  }

  setSasMode(mode) {
    this.sasMode = mode;
    this.sas = mode !== 'off';
    this._pitchPid.reset();
  }

  toggleGear() {
    this.gearDown = !this.gearDown;
    for (const p of this.parts) {
      if (p.def.leg && !p.destroyed) p.legExtended = this.gearDown;
    }
    return this.gearDown;
  }

  toggleLights() {
    this.lightsOn = !this.lightsOn;
    for (const p of this.parts) {
      if (p.def.light && !p.destroyed) p.lightOn = this.lightsOn;
    }
    return this.lightsOn;
  }

  toggleSolar() {
    let any = false;
    for (const p of this.parts) {
      if (p.def.solar?.deployable && !p.destroyed) {
        p.deployed = !p.deployed;
        any = p.deployed;
      }
    }
    return any;
  }

  toggleBrakes() {
    this.brakes = !this.brakes;
    for (const p of this.parts) {
      if (p.def.airbrake && !p.destroyed) p.airbrakeOpen = this.brakes;
    }
    this.updateAeroProperties();
    return this.brakes;
  }

  /** 모든 낙하산 전개 */
  deployAllChutes() {
    let n = 0;
    for (const p of this.parts) {
      if (p.chuteState === CHUTE_STATE.STOWED && !p.destroyed) {
        this.deployChute(p);
        n++;
      }
    }
    return n;
  }

  deployChute(part) {
    part.chuteState = CHUTE_STATE.DEPLOYING;
    part.chuteProgress = 0;
    bus.emit(EVT.CHUTE_DEPLOY, { vessel: this, part });
  }

  cutChutes() {
    let n = 0;
    for (const p of this.parts) {
      if (p.chuteState && p.chuteState !== CHUTE_STATE.STOWED) {
        p.chuteState = CHUTE_STATE.CUT;
        n++;
      }
    }
    if (n) bus.emit(EVT.CHUTE_CUT, { vessel: this, count: n });
    return n;
  }

  setThrottle(v) {
    this.targetThrottle = clamp01(v);
  }

  adjustThrottle(delta) {
    this.targetThrottle = clamp01(this.targetThrottle + delta);
  }

  /* ──────────────────────────────────────────────────────────
   * 추력
   * ────────────────────────────────────────────────────────── */

  /**
   * 모든 엔진의 추력 합과 토크를 계산해 힘/토크에 더한다.
   * @returns {{thrust:number, massFlow:number, anyRunning:boolean}}
   */
  applyThrust(force, torqueRef, pressureAtm, dt) {
    let totalThrust = 0;
    let totalFlow = 0;
    let anyRunning = false;
    const fwd = this.forward;
    const gimbalCmd = clamp(this.control.roll, -1, 1);

    for (const part of this.parts) {
      if (part.destroyed || !part.isEngine || !part.running) continue;
      const e = part.def.engine;

      // 스로틀 (고체는 항상 100%)
      const throttleable = e.throttleable !== false;
      const wanted = throttleable ? this.throttle : 1;
      part.throttleActual += (wanted - part.throttleActual) * Math.min(1, dt * 8);
      const thr = part.throttleActual;
      if (thr < 0.005) continue;

      const maxThrust = part.thrustAt(pressureAtm);
      const isp = part.ispAt(pressureAtm);
      const wantedThrust = maxThrust * thr;
      const massFlow = wantedThrust / (isp * G0);

      // 추진제 소비
      let result;
      const mult = this._difficulty.fuelMult ?? 1;
      if (e.propellant === 'lfox') {
        result = this.net.drawBipropellant(massFlow * mult, dt, { stage: 0 });
      } else if (e.propellant === 'sf') {
        result = this.net.drawMonopropellant('sf', massFlow * mult, dt, {
          fromParts: [part],
        });
      } else {
        result = this.net.drawMonopropellant(e.propellant, massFlow * mult, dt);
      }

      // 이온 엔진은 전기도 먹는다
      if (e.ecPerSecond) {
        const { brownout } = this.net.drawElectric(e.ecPerSecond * thr * dt);
        if (brownout) {
          part.flameout = true;
          continue;
        }
      }

      const ratio = massFlow * dt > 0 ? result.consumed / (massFlow * dt * mult) : 0;
      if (result.starved && ratio < 0.02) {
        if (!part.flameout) {
          part.flameout = true;
          part.running = e.propellant === 'sf' ? false : part.running;
          bus.emit(EVT.ENGINE_FLAMEOUT, { vessel: this, part });
        }
        continue;
      }
      part.flameout = false;
      anyRunning = true;

      const actualThrust = wantedThrust * clamp01(ratio);
      this.fuelBurned += result.consumed;
      totalThrust += actualThrust;
      totalFlow += massFlow;

      // 짐벌
      let dir = fwd;
      if (e.gimbal > 0) {
        const target = (-gimbalCmd * e.gimbal * Math.PI) / 180;
        part.gimbalAngle += (target - part.gimbalAngle) * Math.min(1, dt * 10);
        const ga = part.gimbalAngle;
        dir = new Vec2(
          Math.cos(this.angle + ga),
          Math.sin(this.angle + ga)
        );
      } else {
        part.gimbalAngle *= Math.max(0, 1 - dt * 6);
      }

      force.x += dir.x * actualThrust;
      force.y += dir.y * actualThrust;

      // 무게중심에서 벗어난 엔진은 토크를 만든다
      const dx = part.localX - this.com.x;
      const dy = part.localY - this.com.y;
      const c = Math.cos(this.angle - Math.PI / 2);
      const s = Math.sin(this.angle - Math.PI / 2);
      const rx = dx * c - dy * s;
      const ry = dx * s + dy * c;
      torqueRef.value += rx * dir.y * actualThrust - ry * dir.x * actualThrust;

      part.igniting = Math.max(0, part.igniting - dt);
    }

    this.currentThrust = totalThrust;
    this.currentMassFlow = totalFlow;
    return { thrust: totalThrust, massFlow: totalFlow, anyRunning };
  }

  /** RCS 추력기 */
  applyRcs(force, torqueRef, dt) {
    if (!this.rcs) return 0;
    const blocks = this.parts.filter((p) => !p.destroyed && p.def.rcs);
    if (!blocks.length) return 0;

    const tx = this.control.translateX;
    const ty = this.control.translateY;
    const rot = this.control.roll;
    if (Math.abs(tx) < 0.01 && Math.abs(ty) < 0.01 && Math.abs(rot) < 0.01)
      return 0;

    let used = 0;
    const fwd = this.forward;
    const right = this.right;

    for (const part of blocks) {
      const rcs = part.def.rcs;
      const dx = part.localX - this.com.x;
      const dy = part.localY - this.com.y;

      // 회전: CoM 기준 위치에 따라 좌우 추력기가 반대로 분사
      let thrustFrac = 0;
      let dir = new Vec2();

      if (Math.abs(rot) > 0.01) {
        const sideSign = dx >= 0 ? 1 : -1;
        const vertSign = dy >= 0 ? 1 : -1;
        const mag = Math.abs(rot);
        if (Math.abs(dy) > Math.abs(dx)) {
          dir = new Vec2(right.x * -vertSign * Math.sign(rot), right.y * -vertSign * Math.sign(rot));
        } else {
          dir = new Vec2(fwd.x * sideSign * Math.sign(rot), fwd.y * sideSign * Math.sign(rot));
        }
        thrustFrac = mag;
      }

      // 병진
      if (Math.abs(tx) > 0.01 || Math.abs(ty) > 0.01) {
        const tdir = new Vec2(
          right.x * tx + fwd.x * ty,
          right.y * tx + fwd.y * ty
        );
        const l = vLen(tdir);
        if (l > 1e-6) {
          dir = new Vec2(dir.x + tdir.x / l, dir.y + tdir.y / l);
          thrustFrac = Math.max(thrustFrac, Math.hypot(tx, ty));
        }
      }

      const dl = vLen(dir);
      if (dl < 1e-6 || thrustFrac < 0.01) continue;
      dir.x /= dl;
      dir.y /= dl;

      const thrust = rcs.thrust * clamp01(thrustFrac);
      const flow = thrust / (rcs.isp * G0);
      const r = this.net.drawMonopropellant('mono', flow, dt);
      if (r.consumed <= 0) continue;
      const eff = thrust * clamp01(r.consumed / Math.max(flow * dt, 1e-9));

      force.x += dir.x * eff;
      force.y += dir.y * eff;

      const c = Math.cos(this.angle - Math.PI / 2);
      const s = Math.sin(this.angle - Math.PI / 2);
      const rx = dx * c - dy * s;
      const ry = dx * s + dy * c;
      torqueRef.value += rx * dir.y * eff - ry * dir.x * eff;
      used += r.consumed;
    }
    return used;
  }

  /** 반작용 휠 */
  applyReactionWheels(torqueRef, dt) {
    let maxTorque = 0;
    let ecDraw = 0;
    for (const p of this.parts) {
      if (p.destroyed) continue;
      if (p.def.torque) {
        maxTorque += p.def.torque;
        ecDraw += p.def.ecPerSecond ?? 0.1;
      }
    }
    if (maxTorque <= 0) return 0;

    let cmd = this.control.roll;
    if (this.sas && Math.abs(cmd) < 0.02) {
      cmd = this.computeSasCommand(dt);
    }
    if (Math.abs(cmd) < 0.005) {
      // 각속도 감쇠 (SAS 가 켜져 있을 때만)
      if (this.sas) cmd = clamp(-this.angularVelocity * 4, -1, 1);
      else return 0;
    }

    const { drawn } = this.net.drawElectric(ecDraw * Math.abs(cmd) * dt);
    const power = ecDraw > 0 ? clamp01(drawn / (ecDraw * Math.abs(cmd) * dt + 1e-9)) : 1;
    const torque = -cmd * maxTorque * power;
    torqueRef.value += torque;
    this.wheelTorque = torque;
    return torque;
  }

  /** 공력 조종면 (핀) */
  applyControlSurfaces(torqueRef, q, dt) {
    if (q < 1) return 0;
    let total = 0;
    let cmd = this.control.roll;
    if (this.sas && Math.abs(cmd) < 0.02) cmd = this.computeSasCommand(dt) * 0.7;

    for (const p of this.parts) {
      if (p.destroyed || !p.def.fin?.controllable) continue;
      const fin = p.def.fin;
      const maxDef = ((fin.maxDeflect ?? 20) * Math.PI) / 180;
      const target = -cmd * maxDef;
      p.finDeflection += (target - p.finDeflection) * Math.min(1, dt * 9);
      const arm = p.localY - this.com.y;
      const lift = q * fin.area * 2.2 * Math.sin(p.finDeflection) * (fin.authority ?? 1);
      const torque = lift * arm;
      torqueRef.value += torque;
      total += Math.abs(torque);
    }
    return total;
  }

  /** SAS 목표 각도에 대한 제어 명령 계산 */
  computeSasCommand(dt) {
    let targetAngle = this.angle;
    const sv = this.surfaceVelocity();
    const up = this.up;

    switch (this.sasMode) {
      case 'hold':
        if (this._sasHoldAngle === undefined) this._sasHoldAngle = this.angle;
        targetAngle = this._sasHoldAngle;
        break;
      case 'prograde':
        targetAngle =
          vLen(this.vel) > 1 ? Math.atan2(this.vel.y, this.vel.x) : this.angle;
        break;
      case 'retrograde':
        targetAngle =
          vLen(this.vel) > 1
            ? Math.atan2(-this.vel.y, -this.vel.x)
            : this.angle;
        break;
      case 'surfacePrograde':
        targetAngle = vLen(sv) > 1 ? Math.atan2(sv.y, sv.x) : this.angle;
        break;
      case 'surfaceRetrograde':
        targetAngle = vLen(sv) > 1 ? Math.atan2(-sv.y, -sv.x) : this.angle;
        break;
      case 'radialOut':
        targetAngle = Math.atan2(up.y, up.x);
        break;
      case 'radialIn':
        targetAngle = Math.atan2(-up.y, -up.x);
        break;
      case 'normal':
        targetAngle = Math.atan2(up.y, up.x) + Math.PI / 2;
        break;
      case 'target':
        if (this.target) {
          const d = new Vec2(
            this.target.pos.x - this.pos.x,
            this.target.pos.y - this.pos.y
          );
          targetAngle = Math.atan2(d.y, d.x);
        }
        break;
      default:
        return 0;
    }

    if (this.sasMode !== 'hold') this._sasHoldAngle = undefined;
    const err = wrapPi(targetAngle - this.angle);
    // 각속도를 미분항으로 사용 (진동 억제)
    const cmd = -(err * 2.6 - this.angularVelocity * 2.2);
    return clamp(cmd, -1, 1);
  }

  /* ──────────────────────────────────────────────────────────
   * 낙하산 / 열
   * ────────────────────────────────────────────────────────── */

  updateChutes(dt, atmo, altitude, surfaceVel, force) {
    let anyDeployed = false;
    for (const part of this.parts) {
      if (part.destroyed || !part.def.chute) continue;
      const cfg = part.def.chute;

      if (part.chuteState === CHUTE_STATE.DEPLOYING) {
        // 고도 조건을 만족하면 완전 전개
        if (altitude < (cfg.deployAltitude ?? 1000)) {
          part.chuteState = CHUTE_STATE.DEPLOYED;
          part.chuteProgress = 0;
        }
      }
      if (part.chuteState === CHUTE_STATE.DEPLOYED) {
        part.chuteProgress = clamp01(
          part.chuteProgress + dt / (cfg.deployTime ?? 3)
        );
      }
      if (
        part.chuteState === CHUTE_STATE.DEPLOYING ||
        part.chuteState === CHUTE_STATE.DEPLOYED
      ) {
        anyDeployed = true;
        const res = parachuteDrag(
          {
            state: part.chuteState,
            deployProgress: part.chuteProgress,
            area: cfg.area,
            drag: cfg.drag,
            semiDeployArea: cfg.semiDeployArea,
            maxQ: cfg.maxQ,
          },
          atmo,
          altitude,
          surfaceVel
        );
        force.x += res.force.x;
        force.y += res.force.y;
        if (chuteOverstressed({ state: part.chuteState, maxQ: cfg.maxQ }, res.q)) {
          part.chuteState = CHUTE_STATE.DESTROYED;
          bus.emit(EVT.TOAST, {
            text: `${part.def.name} 이(가) 과도한 동압으로 찢어졌습니다!`,
            kind: 'danger',
          });
        }
      }
    }
    this.chutesDeployed = anyDeployed;
  }

  updateThermal(dt, heatFlux, ambient) {
    const mult = this._difficulty.heatMult ?? 1;
    if (mult <= 0) return;
    let hottest = null;
    let hottestFrac = 0;

    for (const part of this.parts) {
      if (part.destroyed) continue;
      // 앞쪽(진행방향)에 있는 부품이 더 많이 가열된다
      let exposure = 1;
      if (this.surfaceSpeed > 50) {
        const sv = this.surfaceVelocity();
        const vhat = vNorm(sv);
        const dx = part.localX - this.com.x;
        const dy = part.localY - this.com.y;
        const c = Math.cos(this.angle - Math.PI / 2);
        const s = Math.sin(this.angle - Math.PI / 2);
        const wx = dx * c - dy * s;
        const wy = dx * s + dy * c;
        const facing = -(wx * vhat.x + wy * vhat.y);
        exposure = clamp(0.25 + facing * 0.35, 0.1, 1.6);
      }

      if (part.shield) {
        ablate(part.shield, heatFlux * exposure, dt);
      }
      updateThermal(part, heatFlux * exposure, dt, ambient, {
        heatMult: mult,
      });

      const frac = clamp01((part.temperature - 300) / Math.max(part.maxTemp - 300, 1));
      if (frac > hottestFrac) {
        hottestFrac = frac;
        hottest = part;
      }

      if (isOverheated(part)) {
        this.destroyPart(part, '과열');
      }
    }
    this.hottestPart = hottest;
    this.hottestFraction = hottestFrac;
    if (hottestFrac > 0.85) {
      bus.emit(EVT.OVERHEAT, { vessel: this, part: hottest, fraction: hottestFrac });
    }
  }

  destroyPart(part, reason = '파괴') {
    if (part.destroyed) return;
    part.destroyed = true;
    part.running = false;
    bus.emit(EVT.PART_DESTROYED, { vessel: this, part, reason });
    this.recomputeMass();
    this.updateAeroProperties();
    this.net.rebuild();

    // 조종부가 모두 파괴되면 기체 상실
    const hasControl = this.parts.some(
      (p) => !p.destroyed && (p.def.crew > 0 || p.def.probe)
    );
    if (!hasControl && !this.destroyed) {
      this.controlLost = true;
    }
    if (this.parts.every((p) => p.destroyed)) {
      this.destroy(reason);
    }
  }

  destroy(reason = '파괴') {
    if (this.destroyed) return;
    this.destroyed = true;
    this.situation = SITUATION.DESTROYED;
    this.destroyReason = reason;
    bus.emit(EVT.DESTROYED, { vessel: this, reason });
  }

  /* ──────────────────────────────────────────────────────────
   * 지면 접촉
   * ────────────────────────────────────────────────────────── */

  /**
   * 지면과의 충돌/접촉 처리.
   * 다리가 있으면 서스펜션으로, 없으면 강체 충돌로 처리한다.
   */
  handleGroundContact(dt, t, force, torqueRef) {
    if (!this.body) return;
    const r = vLen(this.pos);
    const up = this.up;
    const theta = Math.atan2(this.pos.y, this.pos.x);
    const surfaceR = this.terrainRadius ?? this.body.terrain.radiusAt(theta);
    const ocean = this.body.terrain.oceanRadius;
    const isWater = ocean !== null && surfaceR < ocean;
    const groundR = isWater ? ocean : surfaceR;

    // 기체 최하단까지의 거리
    let lowest = 0;
    let lowestPart = null;
    for (const p of this.parts) {
      if (p.destroyed) continue;
      const dx = p.localX - this.com.x;
      const dy = p.localY - this.com.y;
      const c = Math.cos(this.angle - Math.PI / 2);
      const s = Math.sin(this.angle - Math.PI / 2);
      const wx = dx * c - dy * s;
      const wy = dx * s + dy * c;
      let along = wx * up.x + wy * up.y - p.def.size.h / 2;
      if (p.def.leg && p.legExtended) along -= p.def.leg.length * 0.8;
      if (along < lowest) {
        lowest = along;
        lowestPart = p;
      }
    }

    const clearance = r + lowest - groundR;
    this.groundClearance = clearance;
    this.overWater = isWater;

    if (clearance > 0.02) {
      if (this.landed || this.splashed) {
        this.landed = false;
        this.splashed = false;
      }
      for (const p of this.parts) {
        if (p.def.leg) {
          p.legCompression = Math.max(0, p.legCompression - dt * 2);
        }
      }
      return;
    }

    const sv = this.surfaceVelocity();
    const vn = vDot(sv, up);
    const impactSpeed = vLen(sv);

    // 충돌 파괴 판정
    const tol = this._difficulty.crashMult ?? 1;
    if (!this.landed && !this.splashed) {
      const hasLegs = this.parts.some(
        (p) => !p.destroyed && p.def.leg && p.legExtended
      );
      const baseTol = lowestPart ? lowestPart.def.crashTolerance : 8;
      const effTol = (hasLegs ? baseTol * 1.8 : baseTol) * tol;
      if (impactSpeed > effTol) {
        if (isWater && impactSpeed < effTol * 1.6) {
          // 착수는 조금 더 관대
        } else {
          this.crash(impactSpeed, isWater);
          return;
        }
      }
    }

    // 위치 보정
    const penetration = -clearance;
    this.pos.x += up.x * penetration;
    this.pos.y += up.y * penetration;

    // 다리 서스펜션
    let springForce = 0;
    for (const p of this.parts) {
      if (p.destroyed || !p.def.leg || !p.legExtended) continue;
      const leg = p.def.leg;
      p.legCompression = clamp(
        p.legCompression + penetration * 0.5,
        0,
        leg.maxCompression
      );
      const f = leg.stiffness * p.legCompression - leg.damping * vn;
      springForce += Math.max(0, f);
    }

    // 법선 방향 반발
    const restitution = isWater ? 0.05 : 0.12;
    if (vn < 0) {
      const bounce = -vn * (1 + restitution);
      this.vel.x += up.x * bounce;
      this.vel.y += up.y * bounce;
    }
    if (springForce > 0) {
      force.x += up.x * springForce;
      force.y += up.y * springForce;
    }

    // 마찰 — 수평 속도 감쇠
    const tangent = new Vec2(-up.y, up.x);
    const vt = vDot(sv, tangent);
    const friction = isWater ? 2.2 : this.gearDown ? 1.4 : 3.2;
    const dv = -vt * Math.min(1, friction * dt);
    this.vel.x += tangent.x * dv;
    this.vel.y += tangent.y * dv;

    // 자세 정렬 — 지면 법선 방향으로 천천히 복원
    const slope = this.body.terrain.slopeAt(theta - this.body.rotationAt(t));
    const targetAngle = Math.atan2(up.y, up.x) + slope;
    const angErr = wrapPi(targetAngle - this.angle);
    const hasLegs = this.parts.some((p) => !p.destroyed && p.def.leg && p.legExtended);
    const align = hasLegs ? 6 : 2.5;
    torqueRef.value += angErr * this.inertia * align - this.angularVelocity * this.inertia * 3;
    this.angularVelocity *= Math.max(0, 1 - dt * 4);

    // 상태 갱신
    const wasLanded = this.landed || this.splashed;
    if (Math.abs(vn) < 2 && Math.abs(vt) < 3) {
      if (isWater) {
        this.splashed = true;
        this.landed = false;
        this.situation = SITUATION.SPLASHED;
      } else {
        this.landed = true;
        this.splashed = false;
        this.situation = SITUATION.LANDED;
      }
      if (!wasLanded) {
        this.landingSpeed = impactSpeed;
        this.landedSlope = slope;
        this.landedTheta = theta - this.body.rotationAt(t);
        bus.emit(isWater ? EVT.SPLASHDOWN : EVT.LANDED, {
          vessel: this,
          body: this.body,
          speed: impactSpeed,
          slope,
        });
      }
    }
  }

  crash(speed, water = false) {
    this.crashSpeed = speed;
    bus.emit(EVT.CRASH, {
      vessel: this,
      body: this.body,
      speed,
      water,
      pos: this.pos.clone(),
    });
    for (const p of this.parts) p.destroyed = true;
    this.destroy(water ? '착수 충격' : '지면 충돌');
  }

  /* ──────────────────────────────────────────────────────────
   * 메인 갱신
   * ────────────────────────────────────────────────────────── */

  /**
   * @param {number} dt 물리 스텝
   * @param {number} t  절대 시각
   * @param {SolarSystem} system
   */
  update(dt, t, system) {
    if (this.destroyed || !this.body) return;

    this.missionTime += dt;
    this.updateInstruments(t);

    // 스로틀 램프
    this.throttle += (this.targetThrottle - this.throttle) * Math.min(1, dt * 6);
    if (Math.abs(this.throttle - this.targetThrottle) < 0.002)
      this.throttle = this.targetThrottle;

    const atmo = this.body.atmo;
    const alt = this.altitude;
    const pressureAtm = atmo.exists ? atmo.pressureAt(alt) : 0;
    const surfaceVel = this.surfaceVelocity();

    const force = new Vec2();
    const torqueRef = { value: 0 };

    /* 1. 중력 */
    const g = this.body.gravityAt(this.pos, new Vec2());
    force.x += g.x * this.mass;
    force.y += g.y * this.mass;

    /* 2. 추력 */
    const thrustInfo = this.applyThrust(force, torqueRef, pressureAtm, dt);

    /* 3. RCS */
    this.applyRcs(force, torqueRef, dt);

    /* 4. 공력 */
    if (atmo.exists && alt < atmo.height) {
      computeAero(
        {
          pos: this.pos,
          vel: this.vel,
          angle: this.angle,
          angularVelocity: this.angularVelocity,
          aero: this.aero,
        },
        atmo,
        alt,
        surfaceVel,
        this._aeroResult
      );
      const dragMult = this._difficulty.dragMult ?? 1;
      force.x += this._aeroResult.force.x * dragMult;
      force.y += this._aeroResult.force.y * dragMult;
      torqueRef.value += this._aeroResult.torque * dragMult;

      this.dynamicPressure = this._aeroResult.dynamicPressure;
      this.mach = this._aeroResult.mach;
      this.aoa = this._aeroResult.aoa;
      this.heatFlux = this._aeroResult.heatFlux;
      if (this.dynamicPressure > this.maxQ) {
        this.maxQ = this.dynamicPressure;
        if (this.maxQ > 15000 && !this._maxQAnnounced) {
          this._maxQAnnounced = true;
          bus.emit(EVT.MAXQ, { vessel: this, q: this.maxQ });
        }
      }
      this.applyControlSurfaces(torqueRef, this.dynamicPressure, dt);
      this.updateChutes(dt, atmo, alt, surfaceVel, force);
    } else {
      this.dynamicPressure = 0;
      this.mach = 0;
      this.heatFlux = 0;
      this.aoa = 0;
      this.chutesDeployed = false;
    }

    /* 5. 반작용 휠 */
    this.applyReactionWheels(torqueRef, dt);

    /* 6. 조종 입력에 의한 직접 회전 (대기권 밖 미세 조정) */
    if (!this.sas && Math.abs(this.control.roll) > 0.01) {
      // 휠/RCS 가 없으면 아주 약한 관성 회전만 허용
      const hasAuthority =
        this.parts.some((p) => !p.destroyed && (p.def.torque || p.def.rcs));
      if (!hasAuthority) {
        torqueRef.value -= this.control.roll * this.inertia * 0.02;
      }
    }

    /* 7. 발사 클램프 */
    if (this.clamped) {
      const netUp = vDot(force, this.up);
      if (netUp > 0 && thrustInfo.thrust > this.mass * 9.8) {
        // 추력이 충분하면 클램프가 자동 해제되지 않는다 — 수동 스테이징 필요
      }
      force.zero();
      torqueRef.value = 0;
      this.vel.zero();
      this.angularVelocity = 0;
    }

    /* 8. 지면 */
    this.handleGroundContact(dt, t, force, torqueRef);
    if (this.destroyed) return;

    /* 9. 적분 */
    const ax = force.x / this.mass;
    const ay = force.y / this.mass;
    const accel = new Vec2(ax, ay);

    // G-force (중력 제외한 가속도)
    const nonGravAx = ax - g.x;
    const nonGravAy = ay - g.y;
    this.gForce = Math.hypot(nonGravAx, nonGravAy) / 9.80665;
    if (this.gForce > this.maxG) this.maxG = this.gForce;
    if (this.gForce > 22 && !this.landed) {
      this.destroy('과도한 G하중으로 기체 붕괴');
      return;
    }

    const prevPos = this.pos.clone();
    // 심플렉틱 적분 — 중력이 지배적인 구간에서 에너지 보존이 좋다
    this.vel.x += ax * dt;
    this.vel.y += ay * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this._lastAccel.set(ax, ay);

    this.distanceTravelled += Math.hypot(
      this.pos.x - prevPos.x,
      this.pos.y - prevPos.y
    );

    /* 10. 회전 적분 */
    const alpha = torqueRef.value / this.inertia;
    this.angularVelocity += alpha * dt;
    this.angularVelocity = clamp(this.angularVelocity, -8, 8);
    this.angle = wrapTau(this.angle + this.angularVelocity * dt);

    /* 11. 열 */
    if (this.heatFlux > 0 || this.hottestFraction > 0.01) {
      const ambient = atmo.exists ? atmo.temperatureAt(alt) : 4;
      this.updateThermal(dt, this.heatFlux, ambient);
      if (this.heatFlux > 60000) {
        bus.emit(EVT.REENTRY, { vessel: this, flux: this.heatFlux });
      }
    }

    /* 12. 전력 */
    this.updatePower(dt, t, system);

    /* 13. 질량 갱신 */
    this.recomputeMass();

    /* 14. 상황 판정 */
    this.updateSituation();

    /* 15. SOI 전환 */
    const next = system.checkSOITransition(this.body, this.pos, t);
    if (next) this.changeSOI(next, system, t);

    /* 16. 경고 */
    this.checkWarnings();

    this.prevMach = this.mach;
  }

  updatePower(dt, t, system) {
    const budget = powerBudget(this.parts, this.sunFactor);
    if (system && this.body) {
      const star = system.star;
      const abs = system.toAbsolute(this.body, this.pos, t);
      const starPos = star.absolutePositionAt(t);
      const bodyPos = this.body.absolutePositionAt(t);
      this.sunFactor = sunlightFactor(abs, starPos, this.body, bodyPos);
    }
    const net = budget.production * this.sunFactor - budget.consumption;
    this.powerNet = net;
    if (net > 0) this.net.chargeElectric(net * dt);
    else {
      const { brownout } = this.net.drawElectric(-net * dt);
      this.brownout = brownout;
    }
    this.electricCharge = this.net.total('ec');
    this.electricCapacity = this.net.capacity('ec');
  }

  updateSituation() {
    if (this.destroyed) {
      this.situation = SITUATION.DESTROYED;
      return;
    }
    if (this.landed) {
      this.situation = SITUATION.LANDED;
    } else if (this.splashed) {
      this.situation = SITUATION.SPLASHED;
    } else if (this.docked) {
      this.situation = SITUATION.DOCKED;
    } else if (this.orbit) {
      const atmoTop = this.body.atmo.height;
      if (this.orbit.e >= 1) {
        this.situation = SITUATION.ESCAPING;
      } else if (this.periapsis > atmoTop) {
        this.situation = SITUATION.ORBITING;
      } else if (this.apoapsis > atmoTop && this.altitude > atmoTop * 0.3) {
        this.situation = SITUATION.SUBORBITAL;
      } else {
        this.situation = SITUATION.FLYING;
      }
    }
    if (this.situation !== this._prevSituation) {
      if (
        this.situation === SITUATION.ORBITING &&
        this._prevSituation !== SITUATION.ORBITING
      ) {
        bus.emit(EVT.ORBIT_ACHIEVED, { vessel: this, body: this.body });
      }
      this._prevSituation = this.situation;
    }
  }

  changeSOI(newBody, system, t) {
    const converted = system.transferFrame(
      this.body,
      newBody,
      this.pos,
      this.vel,
      t
    );
    const oldBody = this.body;
    this.body = newBody;
    this.pos.copy(converted.pos);
    this.vel.copy(converted.vel);
    this._maxQAnnounced = false;
    bus.emit(EVT.SOI_CHANGE, { vessel: this, from: oldBody, to: newBody });
  }

  checkWarnings() {
    const lf = this.net.fraction('lf');
    const cap = this.net.capacity('lf');
    if (cap > 0) {
      if (lf < 0.1 && !this._warnLowFuel) {
        this._warnLowFuel = true;
        bus.emit(EVT.FUEL_LOW, { vessel: this, fraction: lf });
      } else if (lf > 0.2) {
        this._warnLowFuel = false;
      }
    }
  }

  /* ──────────────────────────────────────────────────────────
   * 정보 조회
   * ────────────────────────────────────────────────────────── */

  /** 현재 사용 가능한 Δv */
  availableDeltaV(pressureAtm = 0) {
    const engines = this.parts.filter(
      (p) => !p.destroyed && p.isEngine && p.running
    );
    if (!engines.length) {
      // 아직 점화하지 않은 다음 스테이지 엔진으로 추정
      const nextStage = this.stages[this.stageIndex];
      if (!nextStage) return 0;
      const cand = nextStage.ignite
        .map((uid) => this.parts.find((p) => p.uid === uid))
        .filter((p) => p && !p.destroyed);
      if (!cand.length) return 0;
      return this._deltaVFor(cand, pressureAtm);
    }
    return this._deltaVFor(engines, pressureAtm);
  }

  _deltaVFor(engines, pressureAtm) {
    let thrust = 0;
    let flow = 0;
    for (const e of engines) {
      const t = e.thrustAt(pressureAtm);
      thrust += t;
      flow += t / (e.ispAt(pressureAtm) * G0);
    }
    if (flow <= 0) return 0;
    const isp = thrust / (flow * G0);
    const prop = engines[0].def.engine.propellant;
    const propMass = this.net.stagePropellantMass(0, prop);
    const m0 = this.mass;
    const m1 = Math.max(m0 - propMass, 1);
    return m0 > m1 ? isp * G0 * Math.log(m0 / m1) : 0;
  }

  /** 현재 추중비 */
  twr(pressureAtm = 0) {
    let thrust = 0;
    for (const p of this.parts) {
      if (p.destroyed || !p.isEngine || !p.running) continue;
      thrust += p.thrustAt(pressureAtm) * p.throttleActual;
    }
    const g = this.body ? this.body.gravityMagnitudeAt(vLen(this.pos)) : 9.81;
    return thrust / (this.mass * g);
  }

  /** 최대 추력 (현재 스테이지) */
  maxThrust(pressureAtm = 0) {
    let thrust = 0;
    for (const p of this.parts) {
      if (p.destroyed || !p.isEngine || !p.running) continue;
      thrust += p.thrustAt(pressureAtm);
    }
    return thrust;
  }

  /** 활성 엔진 수 */
  get activeEngines() {
    return this.parts.filter((p) => !p.destroyed && p.isEngine && p.running)
      .length;
  }

  /** 승무원 수 */
  get crewCount() {
    let n = 0;
    for (const p of this.parts) if (!p.destroyed) n += p.def.crew ?? 0;
    return n;
  }

  /** 남은 부품 수 */
  get partCount() {
    return this.parts.filter((p) => !p.destroyed).length;
  }

  /** 저장용 스냅샷 */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      craftName: this.craftName,
      bodyId: this.body?.id,
      pos: [this.pos.x, this.pos.y],
      vel: [this.vel.x, this.vel.y],
      angle: this.angle,
      angularVelocity: this.angularVelocity,
      throttle: this.targetThrottle,
      stageIndex: this.stageIndex,
      missionTime: this.missionTime,
      situation: this.situation,
      sas: this.sas,
      sasMode: this.sasMode,
      rcs: this.rcs,
      gearDown: this.gearDown,
      parts: this.parts.map((p) => p.toJSON()),
      records: {
        maxG: this.maxG,
        maxQ: this.maxQ,
        fuelBurned: this.fuelBurned,
        distanceTravelled: this.distanceTravelled,
      },
    };
  }

  /** 저장 상태 복원 */
  restore(data, system) {
    this.body = system.get(data.bodyId) ?? this.body;
    this.pos.set(data.pos[0], data.pos[1]);
    this.vel.set(data.vel[0], data.vel[1]);
    this.angle = data.angle;
    this.angularVelocity = data.angularVelocity;
    this.targetThrottle = data.throttle;
    this.throttle = data.throttle;
    this.stageIndex = data.stageIndex;
    this.missionTime = data.missionTime;
    this.situation = data.situation;
    this.sas = data.sas;
    this.sasMode = data.sasMode;
    this.rcs = data.rcs;
    this.gearDown = data.gearDown;

    for (const pd of data.parts ?? []) {
      const part = this.parts.find((p) => p.uid === pd.uid);
      if (!part) continue;
      part.resources = { ...pd.resources };
      part.temperature = pd.temperature;
      part.destroyed = pd.destroyed;
      part.chuteState = pd.chuteState;
      part.deployed = pd.deployed;
      part.legExtended = pd.legExtended;
      if (part.shield && pd.shield) part.shield.ablator = pd.shield.ablator;
    }
    if (data.records) {
      this.maxG = data.records.maxG ?? 0;
      this.maxQ = data.records.maxQ ?? 0;
      this.fuelBurned = data.records.fuelBurned ?? 0;
      this.distanceTravelled = data.records.distanceTravelled ?? 0;
    }
    this.recomputeMass();
    this.updateAeroProperties();
    this.net.rebuild();
  }
}
