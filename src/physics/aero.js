// FREE FREELY - 공기역학 / 대기 모델
// 각 양력면(날개, 수평/수직미익, 카나드)에 대해 국소 유동으로부터 양력·항력을
// 계산하고 작용점에 적용한다. 실속, 유도항력, 압축성, 지면효과, 부력까지 포함.
import * as THREE from 'three';
import { clamp, lerp, fbm2, smoothstep } from '../core/utils.js';

export const SEA_LEVEL_DENSITY = 1.225;
export const SEA_LEVEL_PRESSURE = 101325;
export const WATER_DENSITY = 1025;

const _v = new THREE.Vector3();
const _flow = new THREE.Vector3();
const _lift = new THREE.Vector3();
const _drag = new THREE.Vector3();
const _f = new THREE.Vector3();
const _p = new THREE.Vector3();

/** 국제표준대기(ISA) 근사 — 고도 m → 밀도/압력/온도/음속 */
export function atmosphere(alt) {
  const h = Math.max(-500, alt);
  let T, p;
  if (h < 11000) {
    T = 288.15 - 0.0065 * h;
    p = SEA_LEVEL_PRESSURE * Math.pow(T / 288.15, 5.2561);
  } else if (h < 25000) {
    T = 216.65;
    p = 22632 * Math.exp(-9.80665 * (h - 11000) / (287.05 * T));
  } else if (h < 90000) {
    T = 216.65 + 0.0028 * (h - 25000);
    p = 2488 * Math.pow(T / 216.65, -11.388);
  } else {
    T = 186;
    p = 0.1 * Math.exp(-(h - 90000) / 9000);
  }
  const rho = p / (287.05 * T);
  const a = Math.sqrt(1.4 * 287.05 * T);
  return { temperature: T, pressure: p, density: Math.max(0, rho), speedOfSound: a };
}

/** 우주 경계 판정용 — 대기 존재감 0..1 */
export function atmosphereFactor(alt) {
  return clamp(1 - (alt - 30000) / 70000, 0, 1) * clamp(atmosphere(alt).density / SEA_LEVEL_DENSITY, 0, 1) ** 0.35;
}

/* ------------------------------------------------------------------ */
/* 바람 / 난류 환경                                                     */
/* ------------------------------------------------------------------ */
export class Environment {
  constructor() {
    this.windDir = Math.random() * Math.PI * 2;
    this.windSpeed = 4;
    this.turbulence = 0.4;
    this.gust = new THREE.Vector3();
    this.time = 0;
    this.wind = new THREE.Vector3();
    this.thermalStrength = 2.4;
    this.weather = 'clear';
  }

  configure({ windSpeed, turbulence, weather }) {
    if (windSpeed !== undefined) this.windSpeed = windSpeed;
    if (turbulence !== undefined) this.turbulence = turbulence;
    if (weather) {
      this.weather = weather;
      if (weather === 'storm') { this.turbulence = Math.max(this.turbulence, 1.5); this.windSpeed = Math.max(this.windSpeed, 16); }
    }
  }

  update(dt, pos) {
    this.time += dt;
    const t = this.time;
    // 고도에 따라 풍속 증가 (경계층 + 제트기류)
    const alt = Math.max(0, pos ? pos.y : 0);
    const shear = Math.pow(clamp(alt / 800, 0.15, 1), 0.25);
    const jet = 1 + smoothstep(clamp((alt - 7000) / 5000, 0, 1)) * 2.2;
    const base = this.windSpeed * shear * jet;
    this.windDir += Math.sin(t * 0.037) * 0.0009;
    this.wind.set(Math.cos(this.windDir) * base, 0, Math.sin(this.windDir) * base);

    // 난류: 위치/시간 기반 노이즈
    const x = (pos ? pos.x : 0) * 0.0015, z = (pos ? pos.z : 0) * 0.0015;
    const s = this.turbulence * (3.2 + base * 0.22);
    this.gust.set(
      fbm2(x + t * 0.21, z, 3) * s,
      fbm2(x + 31.7, z - t * 0.17, 3) * s * 0.75,
      fbm2(x, z + t * 0.19 + 11.3, 3) * s
    );
    // 저고도 열상승기류 (활강용)
    if (alt < 2600 && alt > 30) {
      const thermal = Math.max(0, fbm2((pos.x) * 0.0006, (pos.z) * 0.0006, 2) - 0.25);
      this.gust.y += thermal * this.thermalStrength * (1 - alt / 2600) * 4;
    }
    this.wind.add(this.gust);
    return this.wind;
  }

  windAt() { return this.wind; }
}

/* ------------------------------------------------------------------ */
/* 양력면                                                              */
/* ------------------------------------------------------------------ */
export class AeroSurface {
  constructor(cfg) {
    this.pos = cfg.pos.clone();                       // 본체 좌표 작용점(공력중심)
    this.axisForward = (cfg.axisForward || new THREE.Vector3(0, 0, -1)).clone().normalize();
    this.axisUp = (cfg.axisUp || new THREE.Vector3(0, 1, 0)).clone().normalize();
    this.axisSpan = new THREE.Vector3().crossVectors(this.axisUp, this.axisForward).normalize();
    this.area = cfg.area || 8;
    this.chord = cfg.chord || 1.5;
    this.aspect = cfg.aspect || 6;
    this.efficiency = cfg.efficiency ?? 0.85;
    this.camber = cfg.camber ?? 0.035;                // 유효 영양력각(rad)
    this.stallAngle = cfg.stallAngle ?? 0.28;         // ≈16°
    this.cd0 = cfg.cd0 ?? 0.008;
    this.control = cfg.control || 'none';             // pitch|roll|yaw|flap|none
    this.controlSign = cfg.controlSign ?? 1;
    this.controlEffect = cfg.controlEffect ?? 0.5;    // 조종면 효율
    this.flapEffect = cfg.flapEffect ?? 0;
    this.liftSlope = cfg.liftSlope ?? (2 * Math.PI * this.aspect / (this.aspect + 2));
    this.enabled = true;
    this.deflection = 0;
    // 디버그/HUD 용 마지막 계산값
    this.lastAoA = 0;
    this.lastCL = 0;
    this.lastStall = 0;
    this.lastLift = 0;
    this.groundEffect = cfg.groundEffect ?? true;
  }

  /**
   * @param body RigidBody
   * @param ctrl {pitch, roll, yaw, flap, trim}
   * @param env {density, wind:THREE.Vector3, groundHeight, mach}
   */
  apply(body, ctrl, env) {
    if (!this.enabled || this.area <= 0) return;
    body.localToWorld(this.pos, _p);
    body.pointVelocity(_p, _v);
    if (env.wind) _v.sub(env.wind);
    if (_v.lengthSq() < 0.04) { this.lastLift = 0; this.lastStall = 0; this.lastCL = 0; return; }
    body.worldToLocalDir(_v, _flow);        // 본체 좌표계 유동(기체가 공기를 가르는 속도)

    const vF = _flow.dot(this.axisForward);
    const vU = _flow.dot(this.axisUp);
    const vS = _flow.dot(this.axisSpan);
    const speed2 = vF * vF + vU * vU;
    const speed = Math.sqrt(speed2);
    if (speed < 1.0) { this.lastLift = 0; this.lastStall = 0; this.lastCL = 0; return; }

    // 조종 입력 → 조종면 편각
    let defl = 0;
    if (this.control === 'pitch') defl = (ctrl.pitch + (ctrl.trim || 0)) * this.controlSign;
    else if (this.control === 'roll') defl = ctrl.roll * this.controlSign;
    else if (this.control === 'yaw') defl = ctrl.yaw * this.controlSign;
    this.deflection = defl;
    const flapCamber = (ctrl.flap || 0) * this.flapEffect;

    const alpha = Math.atan2(-vU, Math.abs(vF) < 0.001 ? 0.001 : vF) * (vF < 0 ? -1 : 1);
    const alphaEff = alpha + this.camber + defl * this.controlEffect + flapCamber;

    // 실속 혼합: 부착유동(선형) ↔ 박리유동(평판)
    const stallStart = this.stallAngle * (1 + (ctrl.flap || 0) * 0.15);
    const over = Math.abs(alphaEff) - stallStart;
    const stallBlend = clamp(over / 0.22, 0, 1);
    this.lastStall = stallBlend;

    const clAttached = this.liftSlope * alphaEff;
    const clSeparated = 1.05 * Math.sin(2 * clamp(alphaEff, -1.55, 1.55));
    let CL = lerp(clAttached, clSeparated, stallBlend);

    // 압축성 보정 (Prandtl-Glauert + 초음속 감쇠)
    const mach = env.mach !== undefined ? env.mach : speed / 340;
    if (mach < 0.85) CL /= Math.sqrt(Math.max(0.25, 1 - mach * mach));
    else if (mach < 1.15) CL *= lerp(1.25, 0.85, (mach - 0.85) / 0.3);
    else CL *= 0.85 / Math.sqrt(Math.max(0.2, mach * mach - 1)) + 0.3;

    // 지면효과 (활주로 근처 양력 증가)
    if (this.groundEffect && env.groundHeight !== undefined) {
      const h = clamp(env.groundHeight / (this.chord * 3.2), 0, 1);
      CL *= lerp(1.22, 1.0, h);
    }

    // 항력: 형상 + 유도 + 박리 + 조종면 + 파압
    const cdInduced = (CL * CL) / (Math.PI * this.aspect * this.efficiency);
    const cdSep = stallBlend * 1.1 * Math.abs(Math.sin(alphaEff));
    const cdCtrl = Math.abs(defl) * 0.012 + (ctrl.flap || 0) * this.flapEffect * 0.06;
    let CD = this.cd0 + cdInduced + cdSep + cdCtrl;
    if (mach > 0.82) CD += smoothstep((mach - 0.82) / 0.25) * 0.06;   // 항력 발산
    // 스팬 방향 유동 손실
    CD += Math.abs(vS) / (speed + Math.abs(vS) + 1) * 0.02;

    const q = 0.5 * env.density * speed2 * this.area;
    // 양력 방향: 유동에 수직, 스팬에 수직
    _drag.copy(this.axisForward).multiplyScalar(vF).addScaledVector(this.axisUp, vU).normalize();
    _lift.crossVectors(_drag, this.axisSpan).normalize();
    if (_lift.dot(this.axisUp) < 0) _lift.negate();

    _f.set(0, 0, 0)
      .addScaledVector(_lift, q * CL)
      .addScaledVector(_drag, -q * CD);

    this.lastAoA = alpha;
    this.lastCL = CL;
    this.lastLift = q * CL;

    body.addLocalForceAtLocalPoint(_f, this.pos);
  }
}

/* ------------------------------------------------------------------ */
/* 동체(비양력체) 저항 및 안정성                                         */
/* ------------------------------------------------------------------ */
export class BodyDrag {
  constructor(cfg = {}) {
    this.areaX = cfg.areaX ?? 6;      // 측면
    this.areaY = cfg.areaY ?? 8;      // 상하
    this.areaZ = cfg.areaZ ?? 2.2;    // 전면
    this.cd = cfg.cd ?? 0.42;
    this.pos = (cfg.pos || new THREE.Vector3()).clone();
    this.spinDamp = cfg.spinDamp ?? 0.9;
  }
  apply(body, env, extraDrag = 0) {
    body.localToWorld(this.pos, _p);
    body.pointVelocity(_p, _v);
    if (env.wind) _v.sub(env.wind);
    body.worldToLocalDir(_v, _flow);
    const q = 0.5 * env.density;
    const cd = this.cd + extraDrag;
    _f.set(
      -Math.sign(_flow.x) * q * _flow.x * _flow.x * this.areaX * cd,
      -Math.sign(_flow.y) * q * _flow.y * _flow.y * this.areaY * cd,
      -Math.sign(_flow.z) * q * _flow.z * _flow.z * this.areaZ * cd
    );
    body.addLocalForceAtLocalPoint(_f, this.pos);

    // 공력 회전 감쇠 (실제 감쇠 도함수 근사)
    body.worldToLocalDir(body.angularVelocity, _v);
    const dq = q * (env.density > 0.02 ? 1 : 0.15);
    const spd = Math.max(1, _flow.length());
    _v.multiplyScalar(-this.spinDamp * dq * spd * 2.0);
    _v.x *= this.areaY + this.areaZ;
    _v.y *= this.areaX + this.areaZ;
    _v.z *= this.areaX + this.areaY;
    body.addLocalTorque(_v);
  }
}

/* ------------------------------------------------------------------ */
/* 부력 (열기구 / 수상 착수)                                            */
/* ------------------------------------------------------------------ */
/** 열기구: 내부 공기 온도로 부력 계산 */
export function balloonBuoyancy(body, envelope, env) {
  // envelope: {volume, pos, temperature, ambient}
  const atm = atmosphere(body.position.y);
  const rhoOut = atm.density;
  const tOut = atm.temperature;
  const tIn = Math.max(tOut, envelope.temperature);
  const rhoIn = rhoOut * (tOut / tIn);
  const lift = (rhoOut - rhoIn) * envelope.volume * 9.80665;
  _f.set(0, lift, 0);
  body.localToWorld(envelope.pos, _p);
  body.addForceAtPoint(_f, _p);
  // 부피가 큰 만큼 공기 저항도 큼 → 바람에 따라 표류
  body.pointVelocity(_p, _v);
  if (env.wind) _v.sub(env.wind);
  const sp = _v.length();
  if (sp > 0.01) {
    const cd = 0.55 * 0.5 * rhoOut * sp * sp * Math.pow(envelope.volume, 2 / 3) * 0.45;
    _f.copy(_v).normalize().multiplyScalar(-cd);
    body.addForceAtPoint(_f, _p);
  }
  return lift;
}

/** 수면 아래 잠긴 구체들에 부력/항력 적용 → 착수, 침몰, 수상활주 */
export function waterForces(body, colliders, waterHeightFn, time, out) {
  let submergedVolume = 0;
  let deepest = 0;
  // 부력은 강성이 매우 커서 그대로 적용하면 수치적으로 발산한다.
  // 총 부력을 중량의 몇 배 이내로 제한하고 수직 감쇠를 넣어 안정화한다.
  const weight = body.mass * 9.80665;
  const maxPerSphere = (weight * 2.2) / Math.max(1, colliders.length);
  for (const c of colliders) {
    body.localToWorld(c.pos, _p);
    const wh = waterHeightFn(_p.x, _p.z, time);
    const depth = wh - (_p.y - c.radius);
    if (depth <= 0) continue;
    const r = c.radius;
    const h = clamp(depth, 0, r * 2);
    // 구의 부분 부피
    const vol = Math.PI * h * h * (3 * r - h) / 3;
    submergedVolume += vol;
    deepest = Math.max(deepest, depth);
    const buoy = Math.min(WATER_DENSITY * vol * 9.80665, maxPerSphere);
    // 수직 감쇠 (파도/부력 진동 억제)
    body.pointVelocity(_p, _v);
    const damping = -_v.y * body.mass * 0.35 / Math.max(1, colliders.length);
    _f.set(0, buoy + clamp(damping, -maxPerSphere, maxPerSphere), 0);
    body.addForceAtPoint(_f, _p);
    // 수중 항력 (공기보다 800배)
    body.pointVelocity(_p, _v);
    const sp = _v.length();
    if (sp > 0.02) {
      const area = Math.PI * r * r * clamp(h / (2 * r), 0, 1);
      const dragMag = 0.5 * WATER_DENSITY * sp * sp * area * 0.9;
      _f.copy(_v).normalize().multiplyScalar(-Math.min(dragMag, body.mass * sp * 12));
      body.addForceAtPoint(_f, _p);
    }
  }
  if (out) { out.volume = submergedVolume; out.depth = deepest; }
  return submergedVolume;
}
