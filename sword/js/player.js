// 플레이어 컨트롤러: 지상/공중/비행/영웅착지 상태, 고정 120Hz 물리, 자세(attitude) 계산, 이펙트/사운드 트리거
import * as THREE from 'three';
import { Avatar, RIG } from './avatar.js';
import { Animator, CH } from './animator.js';
import { origin, onRebase, airDensity, ATMO_TOP, flatToPlanet, planetToFlat, localToPlanetQuat, MOON, SUN, EARTH, R_EARTH, C_LIGHT, BODIES, BODY, EARTH_BREAK_V } from './frame.js';

export const SOUND_SPEED = 343;
const STUD = 0.4;
const WALK = 12 * STUD, SPRINT = 26 * STUD, SNEAK = 7 * STUD;
const STAMINA_MAX = 100, STAMINA_DRAIN = 10, STAMINA_REGEN = 20, EXHAUST_DELAY = 3, EXHAUST_RECOVER = 20;
const TAU = Math.PI * 2;
const GRAVITY = 34;
const MASS = 80;                       // 충돌 에너지 계산용 (kg)
const V_SPACE_MAX = 3e12;              // 우주 최고 속도 (광속의 만 배, 비현실적·의도적: 해왕성까지 수 초)
const V_EARTH_BREAK = EARTH_BREAK_V;   // 이 속도 이상으로 지면 충돌 → 지구 폭발 (광속의 약 33배)
// 목표 천체 순서 (T 키)
export const TARGETS = ['earth', 'moon', 'sun', 'mercury', 'venus', 'mars', 'jupiter', 'io', 'europa', 'ganymede', 'callisto', 'saturn', 'titan', 'uranus', 'neptune', 'pluto'];
// 대기 중 최고 속도: 해면 12 km/s, 공기가 옅을수록 빨라짐
const airVmax = (dens) => Math.min(60000, 12000 / Math.max(0.08, Math.sqrt(dens)));

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function smooth(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
// 회전용 이징: 시작/끝 각속도 0, 가운데 최대
const easeRot = (p) => p - Math.sin(TAU * p) / TAU;

// 2차 스프링 (스칼라)
class Spring {
  constructor(f, z, v = 0) { this.f = f; this.z = z; this.y = v; this.v = 0; }
  step(x, dt) {
    const w = TAU * this.f;
    const k1 = this.z / (Math.PI * this.f), k2 = 1 / (w * w);
    const k2s = Math.max(k2, dt * dt / 2 + dt * k1 / 2, dt * k1);
    this.y += dt * this.v;
    this.v += dt * (x - this.y - k1 * this.v) / k2s;
    return this.y;
  }
}

// 재사용 임시 객체
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _P0 = new THREE.Vector3(), _P1 = new THREE.Vector3(), _Vp = new THREE.Vector3(), _F = new THREE.Vector3();
const _N = new THREE.Vector3(), _g = new THREE.Vector3();
function fmtSpeed(v) {
  if (v < 1000) return Math.round(v * 3.6) + ' km/h';
  if (v < 0.01 * C_LIGHT) return (v / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' km/s';
  return (v / C_LIGHT).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' × 광속';
}
const _hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, id: -1 };
// 선분 P0→P1 과 구(C, r) 의 첫 교차 t (0..1), 없으면 -1
function segSphere(P0, P1, C, r) {
  const dx = P1.x - P0.x, dy = P1.y - P0.y, dz = P1.z - P0.z;
  const fx = P0.x - C.x, fy = P0.y - C.y, fz = P0.z - C.z;
  const a = dx * dx + dy * dy + dz * dz, b = 2 * (fx * dx + fy * dy + fz * dz), c = fx * fx + fy * fy + fz * fz - r * r;
  if (c < 0) return 0;
  if (a < 1e-12) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const UP = Y;

export class Player {
  constructor(scene, game) {
    this.game = game;  // { fx, audio, hooks:{shake,flash,fovKick,shockwave}, hitStop(dur, scale) }
    this.avatar = new Avatar();
    this.anim = new Animator(this.avatar);
    scene.add(this.avatar.root);

    // 물리 상태 (pos = 몸 무게중심 피벗)
    this.pos = new THREE.Vector3(0, RIG.pivotY, 0);
    this.vel = new THREE.Vector3();
    this.dash = new THREE.Vector3();
    this.prevVel = new THREE.Vector3();
    this.accel = new THREE.Vector3();
    this.mode = 'ground';
    this.time = 0;
    this.prevPos = new THREE.Vector3().copy(this.pos);
    this.inSpace = false;
    this.dens = 1;
    this.agl = 0;           // 지표(지형/물/옥상)로부터 높이
    this.surfKind = 'ground';
    this.waterY = -Infinity;   // 발밑 수면 (렌더 y), 없으면 -Infinity
    this.submerged = false;
    this.hidden = false;    // 지구 폭발 등으로 사라진 상태
    this.cbrtE = 0;
    // 플로팅 원점: 저장해 둔 렌더 좌표 이동
    onRebase((dx, dy, dz) => {
      for (const v of [this.pos, this.prevPos, this.renderPos, this.snapPrev.pos, this.snapCur.pos]) { v.x -= dx; v.y -= dy; v.z -= dz; }
    });

    this.heading = 0;
    this.headingSpring = new Spring(2.6, 0.9);
    // 자세 스프링: 임계 감쇠에 가깝게 (출렁이며 좌우로 휘청이지 않게)
    this.pitch = new Spring(3.2, 0.95);
    this.bank = new Spring(2.6, 1.0);
    this.lean = new Spring(3.0, 1.0);
    this.prevHeading = 0;
    this.yawRate = 0;

    this.speed = 0;
    this.mach = 0;
    this.boostAmt = 0;
    this.wasBoosting = false;
    this.brakeAmt = 0;
    this.brakeCool = 0;
    this.boomArmed = true;
    this.plasmaArmed = true;
    this.vert = 0;
    this.slow = false;
    this.sprint = false;

    this.jumpBuffer = 0;
    this.coyote = 0;
    this.landT = -1;
    this.landHard = 0;
    this.heroT = 0;
    this.groundY = 0;
    this.moonGone = false;
    this.gone = new Set();     // 파괴된 천체
    this.speedLock = 0;        // 속도 고정 (m/s, 0 = 해제)
    this.autopilot = false;    // 목표 천체로 자동 항법
    this.targetIdx = 0;        // TARGETS 인덱스
    this.coasting = false;     // 우주 관성 비행 (중력만 작용)
    this.stamina = STAMINA_MAX;
    this.exhausted = false;
    this.exhaustT = 0;
    this.sprinting = false;
    this.tired = 0;
    this.sprintAmt = 0;
    this.launchT = 0;
    this.launchPoseT = 9;   // 이륙 후 경과 시간 (주먹 뻗기 자세)
    this.turnLean = 0;

    this.trick = null;       // { type, p, dur, axis: Vector3(local), sign }
    this.trickObj = { type: '', p: 0 };
    this.trickCool = 0;
    this.airFlips = 0;

    this.attitude = new THREE.Quaternion();
    this.prevAtt = new THREE.Quaternion();
    this.angB = new THREE.Vector3();
    this.accelB = new THREE.Vector3();
    this.attPitch = 0;

    // 렌더 보간용 스냅샷
    this.snapPrev = this.makeSnap();
    this.snapCur = this.makeSnap();
    this.renderPos = new THREE.Vector3().copy(this.pos);
    this.renderQuat = new THREE.Quaternion();

    // 발밑 그림자 (고도 감각용 원형 블롭)
    this.blob = this.makeBlob();
    scene.add(this.blob);

    // FX/오디오에 넘기는 상태 (매 프레임 재사용)
    this.ctx = {
      pos: new THREE.Vector3(), vel: this.vel, speed: 0, mach: 0, flying: false, grounded: true,
      altitude: 0, time: 0, bodyQuat: new THREE.Quaternion(), boost: 0, trick: 0, limbs: this.avatar.limbs,
    };
    this.audioState = { speed: 0, mach: 0, flying: false, grounded: true, boost: 0, plasma: 0, vapor: 0, altitude: 0 };
    this.heat = 0;

    this.anim.onStep = (side, strength) => {
      const foot = side ? this.avatar.limbs.footL : this.avatar.limbs.footR;
      foot.getWorldPosition(_v3);
      _v3.y = this.groundY + 0.02;
      this.game.fx.step(_v3, strength);
      this.game.audio.play('step', strength * 0.6);
    };

    this.animState = {
      t: 0, dt: 0, mode: 'ground', groundSpeed: 0, vy: 0, sprint: false, slow: false,
      flySpeed: 0, mach: 0, boost: 0, brake: 0, vert: 0, attPitch: 0, bank: 0,
      accelB: this.accelB, angB: this.angB, trick: null, heroT: 0, landT: -1, landHard: 0,
      lookYaw: 0, lookPitch: 0,
    };
    this.composeAttitude(0, 0);
    this.snapshot(this.snapCur);
    this.copySnap(this.snapPrev, this.snapCur);
  }

  makeSnap() {
    return {
      pos: new THREE.Vector3(), bodyPos: new THREE.Vector3(), bodyQuat: new THREE.Quaternion(),
      joints: [0, 1, 2, 3, 4].map(() => new THREE.Quaternion()),
    };
  }
  snapshot(s) {
    const av = this.avatar;
    s.pos.copy(this.pos);
    s.bodyPos.copy(av.body.position);
    s.bodyQuat.copy(av.body.quaternion);
    for (let i = 0; i < 5; i++) s.joints[i].copy(av.joints[i].quaternion);
  }
  copySnap(d, s) {
    d.pos.copy(s.pos); d.bodyPos.copy(s.bodyPos); d.bodyQuat.copy(s.bodyQuat);
    for (let i = 0; i < 5; i++) d.joints[i].copy(s.joints[i]);
  }

  makeBlob() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = 1;
    return m;
  }

  get flying() { return this.mode === 'fly'; }
  get grounded() { return this.mode === 'ground' || this.mode === 'hero' || this.mode === 'launch'; }

  // ───────────────────────── 고정 스텝 ─────────────────────────
  step(dt, input, cam) {
    this.cam = cam;
    this.copySnap(this.snapPrev, this.snapCur);
    this.time += dt;
    const I = input.state;
    const fx = this.game.fx, au = this.game.audio;

    // 카메라 기준 방향
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const fwdFlat = _v1.set(sy, 0, cy);
    const right = _v2.set(-cy, 0, sy);
    const mx = I.moveX, my = I.moveY;
    const mag = Math.min(1, Math.hypot(mx, my));
    this.slow = I.slow;
    this.sprint = I.boost;
    this.updateStamina(dt, mag);

    // 착지 동작/이륙 준비 중에는 입력을 소비하지 않고 남겨 둠 → 끝나는 즉시 실행
    const busy = this.mode === 'launch' || (this.mode === 'hero' && this.heroT < 0.6);
    if (!busy && input.consume('jump')) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const wantFly = this.mode !== 'launch' && !(this.mode === 'hero' && this.heroT <= 0.3) && input.consume('fly');
    const rollL = !busy && input.consume('rollL'), rollR = !busy && input.consume('rollR');
    const wantFlip = !busy && input.consume('flip');
    if (input.consume('lock')) {
      this.speedLock = this.speedLock > 0 ? 0 : Math.max(this.speed, this.inSpace ? 3000 : 30);
      this.game.toast && this.game.toast(this.speedLock > 0 ? `속도 고정: ${fmtSpeed(this.speedLock)}` : '속도 고정 해제');
    }
    if (input.consume('target')) {
      do { this.targetIdx = (this.targetIdx + 1) % TARGETS.length; } while (this.gone.has(TARGETS[this.targetIdx]) && this.gone.size < TARGETS.length);
      this.game.toast && this.game.toast(`목표: ${BODY[TARGETS[this.targetIdx]].name}`);
    }
    if (this.autopilot && (this.mode === 'ground' || this.mode === 'hero')) this.autopilot = false;   // 착지하면 해제
    if (input.consume('auto')) {
      this.autopilot = !this.autopilot;
      if (this.autopilot && this.mode !== 'fly') this.mode === 'ground' ? this.startLaunch() : this.takeoff(false);
      this.game.toast && this.game.toast(this.autopilot ? `자동 항법: ${BODY[TARGETS[this.targetIdx]].name} 방향` : '자동 항법 해제');
    }
    this.trickCool = Math.max(0, this.trickCool - dt);
    this.brakeCool = Math.max(0, this.brakeCool - dt);
    // 검: 공격/스킬 입력과 상태 (자세는 updateAnimation 에서)
    if (this.blade) this.blade.step(dt, input, cam);

    this.prevVel.copy(this.vel);
    const prevSpeed = this.speed;

    if (this.mode === 'ground') this.stepGround(dt, fwdFlat, right, mx, my, mag, wantFly, rollL, rollR, wantFlip);
    else if (this.mode === 'air') this.stepAir(dt, fwdFlat, right, mx, my, mag, wantFly, rollL, rollR, wantFlip);
    else if (this.mode === 'fly') this.stepFly(dt, cam, cy, sy, cp, sp, mx, my, mag, I, wantFly, rollL, rollR, wantFlip, prevSpeed);
    else if (this.mode === 'hero') this.stepHero(dt, wantFly);
    else if (this.mode === 'launch') this.stepLaunch(dt);
    else if (this.mode === 'swim') this.stepSwim(dt, fwdFlat, right, mx, my, mag, I, wantFly);
    this.launchPoseT += dt;

    if (this.hidden) { this.vel.set(0, 0, 0); this.snapshot(this.snapCur); return; }
    // 적분: 대기권 위에서는 행성 좌표로 적분해 실제 3D 궤적(지구 중심 기준)을 따름
    this.prevPos.copy(this.pos);
    if (this.mode === 'fly' && this.pos.y + origin.y > ATMO_TOP) this.integratePlanet(dt);
    else this.pos.addScaledVector(this.vel, dt);
    this.pos.addScaledVector(this.dash, dt);
    this.dash.multiplyScalar(Math.exp(-5.5 * dt));
    this.speed = this.vel.length();
    const absY = this.pos.y + origin.y;
    this.inSpace = absY > ATMO_TOP;
    this.dens = airDensity(absY);
    // 마하는 공기가 있을 때만 의미가 있음
    // 유효 마하: 공기가 옅으면 같은 속도라도 충격파/가열이 약함 (진공에서는 0)
    this.mach = this.speed / SOUND_SPEED * clamp(Math.sqrt(this.dens) * 8, 0, 1);

    // 건물 / 지면 처리
    this.buildingCollide(dt);
    if (this.hidden) { this.snapshot(this.snapCur); return; }
    this.groundCollide(dt);
    if (this.hidden) { this.snapshot(this.snapCur); return; }

    // 가속도 (고유 가속도: 자유낙하 중엔 0)
    _v3.subVectors(this.vel, this.prevVel).divideScalar(dt);
    if (this.mode === 'air') _v3.y += GRAVITY;
    _v3.clampLength(0, 400);
    this.accel.lerp(_v3, 1 - Math.exp(-18 * dt));

    // 음속 돌파 / 플라즈마 점화 이벤트
    if (this.mach < 0.85) this.boomArmed = true;
    if (this.boomArmed && this.mach >= 1.0 && this.flying && this.dens > 0.01) {
      this.boomArmed = false;
      _v3.copy(this.vel).normalize();
      fx.sonicBoom(this.pos, _v3, clamp(this.dens, 0.15, 1));
      au.play('sonicBoom', clamp(this.dens * 1.2, 0.2, 1));
      this.game.hitStop(0.06, 0.08);
      this.anim.kickArms(-6, 4); this.anim.kickLegs(-5, 3);
    }
    if (this.mach < 1.4) this.plasmaArmed = true;
    if (this.plasmaArmed && this.mach >= 1.6 && this.flying) {
      this.plasmaArmed = false;
      _v3.copy(this.vel).normalize();
      fx.boostBurst(this.pos, _v3);
      au.play('boost', 1);
      this.game.hooks.shake(0.5);
    }

    if (cam.firstPerson && this.mode === 'air') this.turnHeading(cam.yaw, 18, dt);
    this.updateTrick(dt);
    this.updateAttitude(dt, cam);
    this.updateAnimation(dt, cam);
    this.snapshot(this.snapCur);
  }

  stepGround(dt, fwd, right, mx, my, mag, wantFly, rollL, rollR, wantFlip) {
    const fx = this.game.fx, au = this.game.audio;
    const dir = _v3.set(0, 0, 0).addScaledVector(fwd, my).addScaledVector(right, mx);
    if (dir.lengthSq() > 1) dir.normalize();
    const top = this.slow ? SNEAK : this.sprinting ? SPRINT : WALK;
    const tx = dir.x * top, tz = dir.z * top;
    const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const acc = (mag > 0.1 ? (tx * this.vel.x + tz * this.vel.z >= 0 ? 24 : 34) : 30) * dt;
    if (dl > acc) { this.vel.x += (dvx / dl) * acc; this.vel.z += (dvz / dl) * acc; }
    else { this.vel.x = tx; this.vel.z = tz; }
    this.vel.y = 0;
    // 1인칭: 몸이 시선 방향을 향함 (옆 이동 = 게걸음). 3인칭: 이동 방향으로 돎
    const B = this.blade;
    if (B && B.busy) this.turnHeading(Math.atan2(B.aimDir.x, B.aimDir.z), 20, dt);   // 공격 중엔 조준 쪽을 봄
    else if (this.cam && this.cam.firstPerson) this.turnHeading(this.cam.yaw, 18, dt);
    else if (mag > 0.08) this.turnHeading(Math.atan2(dir.x, dir.z), 12, dt);
    this.coyote = 0.1;
    this.landT = this.landT >= 0 ? this.landT + dt : -1;

    if (wantFly) { this.startLaunch(); return; }
    if (this.jumpBuffer > 0) { this.jumpBuffer = 0; this.jump(12.2, 1); return; }
    if (wantFlip) { this.jump(13.2, 0.8); this.startTrick('flip', 0.72, 1); return; }
    if (rollL || rollR) {
      const s = rollR ? 1 : -1;
      this.jump(10.8, 0.6);
      _v3.set(-Math.cos(this.heading), 0, Math.sin(this.heading)).multiplyScalar(s * 7);
      this.dash.add(_v3);
      this.startTrick('cart', 0.6, s);
    }
  }

  // 포세이큰식 스태미나: 지상에서 Shift 질주 시 소모, 바닥나면 3초간 탈진(질주 불가, 회복 정지)
  updateStamina(dt, mag) {
    const onFoot = this.mode === 'ground' || this.mode === 'air';
    this.sprinting = onFoot && this.sprint && mag > 0.1 && !this.exhausted && !this.slow && this.stamina > 0;
    if (this.sprinting && this.mode === 'ground') {
      this.stamina -= STAMINA_DRAIN * dt;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
        this.exhaustT = EXHAUST_DELAY;
        this.sprinting = false;
      }
    } else if (this.exhaustT > 0) {
      this.exhaustT -= dt;
    } else {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt);
      if (this.exhausted && this.stamina >= EXHAUST_RECOVER) this.exhausted = false;
    }
    this.tired = lerp(this.tired, this.exhausted ? 1 : 0, 1 - Math.exp(-(this.exhausted ? 5 : 1.6) * dt));
    this.sprintAmt = lerp(this.sprintAmt, this.sprinting && this.mode === 'ground' ? 1 : 0, 1 - Math.exp(-6 * dt));
  }

  // 이륙 예비 동작: 0.13초 웅크렸다가 발사
  startLaunch() {
    this.mode = 'launch';
    this.launchT = 0;
    _v3.copy(this.pos); _v3.y = this.groundY + 0.02;
    this.game.fx.step(_v3, 0.8);
    this.anim.kickBody(-0.8, 0.6);
  }

  stepLaunch(dt) {
    this.launchT += dt;
    const k = Math.exp(-14 * dt);
    this.vel.x *= k; this.vel.z *= k; this.vel.y = 0;
    if (this.launchT >= 0.13) this.takeoff(true);
  }

  jump(v, strength) {
    this.vel.y = v;
    this.mode = 'air';
    this.coyote = 0;
    this.airFlips = 0;
    _v3.copy(this.pos); _v3.y = this.groundY + 0.02;
    this.game.fx.jump(_v3, strength);
    this.game.audio.play('jump', strength);
    this.anim.kickBody(-0.9, 0);
    this.anim.kickArms(9, 2);
    this.anim.kickLegs(4, 0);
  }

  stepAir(dt, fwd, right, mx, my, mag, wantFly, rollL, rollR, wantFlip) {
    const dir = _v3.set(0, 0, 0).addScaledVector(fwd, my).addScaledVector(right, mx);
    if (dir.lengthSq() > 1) dir.normalize();
    const top = this.slow ? SNEAK : this.sprinting ? SPRINT : WALK;
    const tx = dir.x * top, tz = dir.z * top;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    // 공중 제어: 입력 방향으로만 가속, 입력 없으면 거의 유지
    if (mag > 0.08) {
      const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
      const dl = Math.hypot(dvx, dvz), acc = 13 * dt;
      if (dl > acc) { this.vel.x += (dvx / dl) * acc; this.vel.z += (dvz / dl) * acc; }
      else { this.vel.x = tx; this.vel.z = tz; }
      if (!(this.cam && this.cam.firstPerson)) this.turnHeading(Math.atan2(dir.x, dir.z), 7, dt);
    } else if (hs > 0.01) {
      const k = Math.exp(-0.6 * dt);
      this.vel.x *= k; this.vel.z *= k;
    }
    this.vel.y = Math.max(this.vel.y - GRAVITY * dt, -75);
    this.coyote -= dt;

    if (this.jumpBuffer > 0 && this.coyote > 0) { this.jumpBuffer = 0; this.jump(12.2, 1); return; }
    // 공중에서 점프/비행 키 → 비행 시작
    if (wantFly || this.jumpBuffer > 0) { this.jumpBuffer = 0; this.takeoff(false); return; }
    if (wantFlip && !this.trick && this.airFlips < 2) {
      this.airFlips++;
      this.vel.y = Math.max(this.vel.y, 5);
      this.startTrick('flip', 0.66, 1);
    }
    if ((rollL || rollR) && !this.trick && this.airFlips < 2) {
      this.airFlips++;
      const s = rollR ? 1 : -1;
      _v3.set(-Math.cos(this.heading), 0, Math.sin(this.heading)).multiplyScalar(s * 7);
      this.dash.add(_v3);
      this.startTrick('cart', 0.62, s);
    }
  }

  takeoff(fromGround) {
    const fx = this.game.fx, au = this.game.audio;
    this.mode = 'fly';
    this.boomArmed = this.mach < 0.85;
    if (fromGround) {
      this.vel.y = Math.max(this.vel.y, 19);
      this.launchPoseT = 0;
      _v3.copy(this.pos); _v3.y = this.groundY + 0.02;
      fx.takeoff(_v3, 1);
      au.play('takeoff', 1);
      this.anim.kickBody(-1.6, 0);
      this.anim.kickArms(-10, -3);
      this.anim.kickLegs(-6, 0);
    } else {
      this.vel.y = Math.max(this.vel.y + 9, 6);
      fx.dash(this.pos, UP);
      au.play('takeoff', 0.55);
      this.anim.kickArms(-7, 3);
      this.anim.kickLegs(-5, 2);
    }
  }

  stepFly(dt, cam, cy, sy, cp, sp, mx, my, mag, I, wantFly, rollL, rollR, wantFlip, prevSpeed) {
    const fx = this.game.fx, au = this.game.audio;
    this.jumpBuffer = 0;
    if (wantFly) {
      // 비행 해제 → 자유낙하
      this.mode = 'air';
      this.coyote = 0;
      this.airFlips = 0;
      this.boostAmt = 0; this.wasBoosting = false; this.brakeAmt = 0;
      au.play('brake', 0.35);
      return;
    }
    // 원하는 방향: 카메라 전방(피치 포함) + 좌우 + 상하
    const vert = (I.up ? 1 : 0) - (I.down ? 1 : 0);
    this.vert = vert;
    const dir = _v3.set(sy * cp * my - cy * mx, sp * my + vert, cy * cp * my + sy * mx);
    if (this.autopilot) this.targetDirLocal(dir);
    const dmag = this.autopilot ? 1 : Math.min(1, dir.length());
    const hasInput = this.autopilot || dmag > 0.08;
    if (hasInput) dir.divideScalar(dir.length() || 1);

    const boosting = I.boost && hasInput && !this.slow;
    // 우주 관성 비행: 입력도 속도 고정도 없으면 추진 없이 중력만 (뉴턴 역학)
    this.coasting = this.inSpace && !hasInput && !this.speedLock && !this.slow;
    let speed = this.speed;
    const onlyVert = hasInput && mag < 0.08;
    const space = this.inSpace;
    const vcap = space ? V_SPACE_MAX : airVmax(this.dens);
    const tier = space ? (this.slow ? 300 : 3000) : this.slow ? 7.5 : onlyVert ? 14 : 30;

    if (boosting && !this.wasBoosting) {
      fx.boostBurst(this.pos, dir);
      au.play('boost', clamp(1 - speed / 600, 0.35, 1));
      this.anim.kickArms(-8, 3);
      this.anim.kickLegs(-6, 0);
      this.anim.kickBody(0, -2.5);
    }
    this.wasBoosting = boosting;
    this.boostAmt = lerp(this.boostAmt, boosting ? 1 : 0, 1 - Math.exp(-6 * dt));

    // 속력 제어
    let target;
    if (boosting) {
      // 지수 가속: 대기 중 약 0.55초마다 두 배, 우주에서는 약 0.28초마다 두 배
      const a = space ? 400 + 2.5 * speed : speed < 110 ? 160 : 80 + 1.25 * speed;
      target = speed > vcap ? speed : Math.min(vcap, speed + a * dt);
    } else if (this.autopilot) {
      // 자동 항법 순항: 남은 거리에 비례한 속도 → 어디서든 수십 초 안에 도착하고 표면 앞에서 부드럽게 감속
      // (방향이 덜 맞았으면 먼저 돌고 나서 가속. 부수고 싶으면 Shift 로 부스트)
      const al = speed > 1 ? Math.max(0, _v1.copy(this.vel).divideScalar(speed).dot(dir)) : 1;
      const want = Math.min(vcap, Math.max(30, (this.targetDist || 0) * 0.8)) * al * al * al * al;
      target = want < speed ? want : speed + (want - speed) * (1 - Math.exp(-1.5 * dt));
    } else if (hasInput) {
      const t = tier * dmag;
      if (speed < t) target = Math.min(t, speed + (space ? 2000 : this.slow ? 14 : 45) * dt);
      else target = Math.max(t, speed - (space ? 1.2 * speed : 18 + 0.75 * speed) * dt);
    } else {
      target = space ? speed : Math.max(0, speed - (22 + 1.5 * speed) * dt);
    }
    // 속도 고정: 부스트하는 동안만 바뀌고, 놓으면 그 속도로 다시 고정
    if (this.speedLock > 0) {
      if (boosting) this.speedLock = target;
      else target = this.speedLock;
    }
    // 우주에서 Z (느리게) = 역추진 제동
    if (space && this.slow && !hasInput) target = speed * Math.exp(-3 * dt);
    // 대기 저항: 부스트 없이 한계 속도를 넘으면 공기가 진할수록 빠르게 감속 (재진입). 속도 고정 중에도 공기 저항은 받음
    if (!boosting && !space && target > vcap) { target = vcap + (target - vcap) * Math.exp(-3 * this.dens * dt); if (this.speedLock > 0) this.speedLock = target; }
    if (this.coasting) target = speed;

    if (this.coasting) {
      // 관성 비행: 속도 벡터는 그대로 (중력은 integratePlanet 에서)
    } else if (speed < 7 || !hasInput) {
      // 저속: 속도 벡터를 목표 벡터로 직접 (자유로운 호버 이동)
      if (hasInput && speed < 7) {
        const ax = dir.x * target - this.vel.x, ay = dir.y * target - this.vel.y, az = dir.z * target - this.vel.z;
        const dl = Math.hypot(ax, ay, az), acc = (this.slow ? 12 : 24) * dt;
        if (dl > acc) { this.vel.x += (ax / dl) * acc; this.vel.y += (ay / dl) * acc; this.vel.z += (az / dl) * acc; }
        else this.vel.set(dir.x * target, dir.y * target, dir.z * target);
      } else if (speed > 1e-4) {
        this.vel.multiplyScalar(target / speed);
      }
    } else {
      // 고속: 방향은 최대 선회율로 회전, 속력은 따로
      const cur = _v1.copy(this.vel).divideScalar(speed);
      const ang = Math.acos(clamp(cur.dot(dir), -1, 1));
      // 선회율: 원하는 방향으로 곧게 (크게 휘어 도는 호를 그리지 않게). 아주 빠를 때만 조금 무거워짐
      const turn = this.autopilot ? 4 : (space ? 3.5 : lerp(9, 2.4, smooth(60, 2000, speed))) * (this.slow ? 0.8 : 1);
      if (ang > 1e-4) {
        const axis = _v2.crossVectors(cur, dir);
        if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0); else axis.normalize();
        cur.applyAxisAngle(axis, Math.min(ang, turn * dt));
      }
      this.vel.copy(cur).multiplyScalar(target);
    }

    // 급제동 판정 (입력 없음/반대 입력 + 큰 감속)
    const decel = (prevSpeed - this.vel.length()) / dt;
    const vertFrac = speed > 0.1 ? Math.abs(this.vel.y) / speed : 0;
    const braking = (!hasInput ? 1 : 0) * smooth(10, 45, decel) * smooth(6, 22, speed) * (1 - smooth(0.6, 0.95, vertFrac));
    this.brakeAmt = lerp(this.brakeAmt, braking, 1 - Math.exp(-8 * dt));
    if (braking > 0.5 && speed > 35 && this.brakeCool <= 0) {
      this.brakeCool = 1.2;
      _v3.copy(this.vel).normalize();
      fx.brake(this.pos, _v3, clamp(speed / 300, 0.3, 1));
      au.play('brake', clamp(speed / 300, 0.3, 1));
      this.anim.kickArms(8, 6);
      this.anim.kickLegs(7, 2);
    }

    // 트릭
    const w = smooth(6, 22, speed);
    if ((rollL || rollR) && !this.trick && this.trickCool <= 0) {
      const s = rollR ? 1 : -1;
      _v3.set(-Math.cos(this.heading), 0, Math.sin(this.heading));
      if (w > 0.5) {
        this.startTrick('roll', speed > 300 ? 0.46 : 0.52, s);
        this.dash.addScaledVector(_v3, s * (speed > 120 ? 6 : 13));
      } else {
        this.startTrick('cart', 0.62, s);
        this.dash.addScaledVector(_v3, s * 9);
      }
    }
    if (wantFlip && !this.trick && this.trickCool <= 0) this.startTrick('flip', speed > 300 ? 0.62 : 0.74, 1);
  }

  stepHero(dt, wantFly) {
    this.heroT += dt;
    this.vel.set(0, 0, 0);
    if (wantFly && this.heroT > 0.3) { this.startLaunch(); return; }
    if (this.heroT > 1.05) {
      this.mode = 'ground';
      this.landT = -1;
    }
    if (this.jumpBuffer > 0 && this.heroT > 0.6) { this.jumpBuffer = 0; this.mode = 'ground'; this.jump(12.2, 1); }
  }

  turnHeading(target, rate, dt) {
    const d = wrapAngle(target - this.heading);
    this.heading = wrapAngle(this.heading + d * (1 - Math.exp(-rate * dt)));
  }

  // 몸 OBB 기준 가장 낮은 점의 높이 (y)
  lowestPoint() {
    _m.makeRotationFromQuaternion(this.attitude);
    const e = _m.elements;
    // 반폭: 팔 포함 0.62, 키 방향 1.08(머리~발), 두께 0.3, 중심 +0.04
    const ext = Math.abs(e[1]) * 0.62 + Math.abs(e[5]) * 1.06 + Math.abs(e[9]) * 0.3;
    const cy = e[5] * 0.04;
    return this.pos.y + cy - ext;
  }

  // 렌더 좌표 (rx, rz) 아래 밟을 수 있는 표면 높이 (렌더 y): 지형 / 물 / 건물 옥상 중 가장 높은 것
  surfaceAt(rx, rz) {
    const ax = rx + origin.x, az = rz + origin.z;
    const T = this.game.terrain, Ci = this.game.city;
    let h = T ? T.heightAt(ax, az) : 0, kind = 'ground';
    if (Ci) { const r = Ci.roofAt(ax, az); if (r > h) { h = r; kind = 'roof'; } }
    // 물은 밟을 수 없음: 수면 높이만 따로 (없으면 -Infinity)
    const w = T ? T.waterLevelAt(ax, az) : -Infinity;
    this.waterY = w > h ? w - origin.y : -Infinity;
    this.surfKind = kind;
    return h - origin.y;
  }

  // ───────── 물 ─────────
  // 수면 충돌: 속도가 클수록 큰 물보라 + 수면 파문, 몸은 물속으로 파고듦 (물의 저항으로 급감속)
  enterWater(wy) {
    const fx = this.game.fx, au = this.game.audio;
    const sp = this.vel.length();
    const s = sp / 35;
    const ax = this.pos.x + origin.x, az = this.pos.z + origin.z;
    _v3.copy(this.vel).setY(0);
    const hs = _v3.length();
    if (hs > 1e-3) _v3.divideScalar(hs);
    if (s > 0.15 && fx.splash) fx.splash(this.pos.x, wy, this.pos.z, Math.min(6, s), hs > 1 ? _v3 : null);
    if (this.game.water) this.game.water.ripple(ax, az, Math.min(25, 0.2 + s * 0.7), 8 + Math.min(70, s * 5));
    au.play('splash', clamp(0.25 + s * 0.3, 0.2, 1));
    if (s > 3) { this.game.hooks.shake(clamp(0.2 + s * 0.05, 0, 1)); this.game.hitStop(0.05, 0.15); }
    if (sp > 900 && fx.impact) {
      // 초고속: 수증기 폭발 (물이 순간 증발)
      _v3.set(this.pos.x, wy, this.pos.z);
      fx.impact(_v3, 0.5 * MASS * sp * sp * 0.25, _N.set(0, 1, 0));
    }
    this.mode = 'swim';
    this.trick = null; this.boostAmt = 0; this.wasBoosting = false; this.brakeAmt = 0;
    this.autopilot = false;
    this.vel.clampLength(0, 90);
    this.anim.kickArms(-8, 6); this.anim.kickLegs(-6, 3);
  }

  stepSwim(dt, fwd, right, mx, my, mag, I, wantFly) {
    const wy = this.waterY;
    if (!(wy > -1e8)) { this.mode = 'air'; this.coyote = 0; return; }
    const fx = this.game.fx;
    // 물의 저항: 빠를수록 크게 (항력 ∝ v²) → 뛰어들면 몇 m 파고들다 멈춤
    const sp = this.vel.length();
    this.vel.multiplyScalar(Math.exp(-(1.1 + 0.07 * sp) * dt));
    // 수평 헤엄
    const dir = _v3.set(0, 0, 0).addScaledVector(fwd, my).addScaledVector(right, mx);
    if (dir.lengthSq() > 1) dir.normalize();
    const top = (this.sprint ? 4.2 : 2.6) * (this.slow ? 0.5 : 1);
    const k = 1 - Math.exp(-2.5 * dt);
    if (mag > 0.08) {
      this.vel.x += (dir.x * top - this.vel.x) * k; this.vel.z += (dir.z * top - this.vel.z) * k;
      this.turnHeading(Math.atan2(dir.x, dir.z), 6, dt);
    }
    // 수직: 위/아래 키로 헤엄, 아니면 부력으로 가슴까지 잠겨 뜸
    const floatY = wy - 0.45;
    let ay;
    if (this.pos.y > wy + 0.25) ay = -9.81;                       // 물 밖 → 중력
    else if (I.up) ay = (2.6 - this.vel.y) * 4;
    else if (I.down) ay = (-2.4 - this.vel.y) * 4;
    else ay = (floatY - this.pos.y) * 3.0 - this.vel.y * 2.2;
    this.vel.y += ay * dt;
    // 수면에서 점프 → 물 밖으로, F → 날아오름
    if (this.jumpBuffer > 0 && this.pos.y > floatY - 0.7) {
      this.jumpBuffer = 0;
      this.vel.y = 10.5; this.mode = 'air'; this.coyote = 0; this.airFlips = 0;
      if (fx.splash) fx.splash(this.pos.x, wy, this.pos.z, 0.35);
      this.game.audio.play('splash', 0.4);
      return;
    }
    if (wantFly) {
      this.takeoff(false);
      this.vel.y = Math.max(this.vel.y, 10);
      if (fx.splash) fx.splash(this.pos.x, wy, this.pos.z, 0.8);
      if (this.game.water) this.game.water.ripple(this.pos.x + origin.x, this.pos.z + origin.z, 0.6, 9);
      this.game.audio.play('splash', 0.7);
    }
  }

  swimCollide(g, wy) {
    // 바닥
    if (this.pos.y < g + 0.55) { this.pos.y = g + 0.55; if (this.vel.y < 0) this.vel.y = 0; }
    if (!(wy > g + 0.2)) { this.mode = this.agl < 0.6 ? 'ground' : 'air'; this.coyote = 0.1; return; }
    // 얕은 곳: 걸어서 나옴
    if (wy - g < 1.15 && this.pos.y <= g + RIG.pivotY + 0.35) {
      this.mode = 'ground'; this.pos.y = g + RIG.pivotY; this.vel.y = 0; this.landT = -1;
    }
  }

  groundCollide(dt) {
    const fx = this.game.fx, au = this.game.audio;
    const g = this.surfaceAt(this.pos.x, this.pos.z);
    this.groundY = g;
    this.agl = this.pos.y - RIG.pivotY - g;
    const wy = this.waterY;
    this.submerged = this.pos.y + 0.7 < wy;
    if (this.mode === 'swim') { this.swimCollide(g, wy); return; }
    // 물에 들어감: 공중/비행으로 수면 아래로, 또는 걸어서 깊은 곳으로
    if (wy > g + 0.3 && this.mode !== 'launch' && this.mode !== 'hero') {
      const deep = wy - g;
      if ((this.mode === 'ground' && deep > 1.35) || (this.mode !== 'ground' && this.pos.y - 0.4 < wy)) { this.enterWater(wy); return; }
    }
    if (this.mode === 'ground' || this.mode === 'hero' || this.mode === 'launch') {
      // 발보다 1.2 m 넘게 높은 곳(벽/옥상)으로는 걸어 올라가지 못함
      if (this.agl < -1.2) {
        this.pos.x = this.prevPos.x; this.pos.z = this.prevPos.z;
        this.vel.x = 0; this.vel.z = 0;
        const g2 = this.surfaceAt(this.pos.x, this.pos.z);
        this.groundY = g2;
        this.agl = this.pos.y - RIG.pivotY - g2;
        this.pos.y = g2 + RIG.pivotY;
        return;
      }
      // 옥상 끝이나 절벽에서 걸어 나가면 낙하, 아니면 지면을 따라감 (경사/계단은 부드럽게)
      if (this.mode === 'ground' && this.agl > 0.8) { this.mode = 'air'; this.coyote = 0.1; this.vel.y = 0; return; }
      const want = g + RIG.pivotY;
      this.pos.y = this.agl < -0.6 ? want : lerp(this.pos.y, want, 1 - Math.exp(-30 * dt));
      return;
    }
    if (this.mode === 'air') {
      if (this.pos.y <= g + RIG.pivotY && this.vel.y <= 0) {
        const impact = -this.vel.y;
        const hs = Math.hypot(this.vel.x, this.vel.z);
        if (hs > 20 || impact > 45) { this.pos.y = g + RIG.pivotY; this.impactGround(this.vel.length(), clamp(impact / 70 + hs / 700, 0.35, 1)); return; }
        if (hs > 16) { const k = 16 / hs; this.vel.x *= k; this.vel.z *= k; }
        this.handOffTrick();
        this.pos.y = g + RIG.pivotY;
        this.vel.y = 0;
        this.mode = 'ground';
        this.landT = 0;
        this.landHard = smooth(13, 32, impact);
        const st = clamp(impact / 34, 0.15, 1);
        _v3.copy(this.pos); _v3.y = g + 0.02;
        fx.land(_v3, st);
        au.play('land', st);
        this.anim.kickBody(-impact * 0.09, impact * 0.04);
        this.anim.kickArms(-impact * 0.12, impact * 0.18);
        if (impact > 28) this.game.hooks.shake(0.25 + 0.4 * this.landHard);
      }
      return;
    }
    // 비행 중: 한 스텝에 지면을 크게 뚫고 지나갔으면 (초고속) 진입 지점으로 되돌림
    let low = this.lowestPoint();
    if (low >= g) return;
    if (this.prevPos.y - this.pos.y > 30) {
      const t = clamp((this.prevPos.y - (g + RIG.pivotY)) / (this.prevPos.y - this.pos.y), 0, 1);
      this.pos.lerpVectors(this.prevPos, this.pos, t);
      const g2 = this.surfaceAt(this.pos.x, this.pos.z);
      this.groundY = g2;
      this.pos.y = Math.max(this.pos.y, g2 + 0.3);
      low = g2 - 1;
    }
    const speed = this.speed;
    const elev = speed > 0.1 ? Math.asin(clamp(this.vel.y / speed, -1, 1)) : 0;
    if (this.vel.y < -22 || (speed > 45 && elev < -0.35)) {
      this.pos.y = this.groundY + RIG.pivotY;
      this.impactGround(speed, clamp(-this.vel.y / 70 + speed / 700, 0.35, 1));
    } else if (speed < 14 && this.pitch.y < 0.9) {
      // 부드러운 착지
      this.pos.y = this.groundY + RIG.pivotY;
      this.vel.y = 0;
      this.mode = 'ground';
      this.landT = 0;
      this.landHard = 0;
      this.boostAmt = 0;
      _v3.copy(this.pos); _v3.y = this.groundY + 0.02;
      fx.land(_v3, 0.25);
      au.play('land', 0.3);
      this.anim.kickBody(-0.6, 0.2);
    } else {
      // 지면 스치기: 밀어올리고 하강 성분 제거
      this.pos.y += this.groundY - low;
      if (this.vel.y < 0) this.vel.y *= -0.1;
    }
  }

  // 지면 충돌: 속도(에너지)에 따라 영웅 착지 → 크레이터 → 도시 파괴 → 지구 폭발
  impactGround(speed, st) {
    const E = 0.5 * MASS * speed * speed;
    _N.set(0, 1, 0);
    if (speed >= V_EARTH_BREAK && !this.gone.has('earth')) {
      _v2.copy(this.vel).normalize();
      this.game.planetImpact('earth', this, _v2);
      return;
    }
    this.heroLand(st, E, _N);
  }

  // 슈퍼히어로 착지 (비행 중 급강하 또는 고속 낙하). E = 충돌 에너지 (J), n = 표면 법선
  heroLand(st, E = 0, n = null) {
    const g = this.groundY !== undefined ? this.groundY : 0;
    this.pos.y = g + RIG.pivotY;
    this.vel.set(0, 0, 0);
    this.dash.set(0, 0, 0);
    this.mode = 'hero';
    this.heroT = 0;
    this.trick = null;
    this.boostAmt = 0;
    this.wasBoosting = false;
    this.brakeAmt = 0;
    this.pitch.y = Math.min(this.pitch.y, 0.5); this.pitch.v = 0;
    this.bank.y = 0; this.bank.v = 0;
    this.lean.y = 0; this.lean.v = 0;
    _v3.copy(this.pos); _v3.y = g + 0.02;
    const fx = this.game.fx;
    if (E > 0 && fx.impact) {
      fx.impact(_v3, E, n || _v1.set(0, 1, 0));
      // 큰 충돌은 주변 건물을 날려버림 (폭발 반경 ≈ 0.25·E^(1/3))
      const r = 0.25 * Math.cbrt(E);
      if (r > 25) this.smash(_v3.x, _v3.y, _v3.z, Math.min(r * 0.7, 24000));   // 상한: 도시 전체 규모
    } else fx.heroLanding(_v3, st);
    this.game.audio.play('heroLand', clamp(st + Math.log10(Math.max(1, E)) / 30, 0, 1));
    this.game.hitStop(0.09 + 0.08 * smooth(1e7, 1e12, E), 0.04);
  }

  // 반경 r 안의 건물 파괴 + 잔해 (렌더 좌표)
  smash(x, y, z, r) {
    const Ci = this.game.city;
    if (!Ci) return;
    const boxes = Ci.destroy(x + origin.x, y + origin.y, z + origin.z, r);
    if (boxes && boxes.length && this.game.fx.debrisBoxes) this.game.fx.debrisBoxes(boxes);
  }

  // 우주: 행성 좌표에서 직선 이동 → 평면 좌표로 환산 (지역 축 회전에 맞춰 속도도 다시 표현)
  integratePlanet(dt) {
    const ax = this.pos.x + origin.x, ay = this.pos.y + origin.y, az = this.pos.z + origin.z;
    flatToPlanet(ax, ay, az, _P0);
    localToPlanetQuat(ax, az, _q1);
    _Vp.copy(this.vel).applyQuaternion(_q1);
    // 관성 비행 중에는 뉴턴 중력 (지구·달·태양 + 가까운 행성)
    if (this.coasting) {
      for (const b of BODIES) {
        if (this.gone.has(b.id)) continue;
        _g.subVectors(b.pos, _P0);
        const r2 = _g.lengthSq();
        if (b.id !== 'earth' && b.id !== 'sun' && b.id !== 'moon' && r2 > 1e4 * b.radius * b.radius) continue;
        const r = Math.sqrt(r2);
        _Vp.addScaledVector(_g, (b.GM / (r2 * r)) * dt);
      }
    }
    _P1.copy(_P0).addScaledVector(_Vp, dt);
    // 대기권 진입 (선분-구): 한 스텝에 지구를 통째로 지나치지 않도록 대기 상단에서 멈추고 평면 좌표로 넘김
    if (!this.gone.has('earth')) {
      const RA = R_EARTH + ATMO_TOP - 1;
      if (_P0.lengthSq() > RA * RA) {
        const t = segSphere(_P0, _P1, EARTH.pos, RA);
        if (t > 0) _P1.lerpVectors(_P0, _P1, t);
      }
    }
    // 천체 충돌 (선분-구)
    if (this.celestialHit(_P0, _P1)) return;
    planetToFlat(_P1.x, _P1.y, _P1.z, _F);
    localToPlanetQuat(_F.x, _F.z, _q2);
    this.vel.copy(_Vp).applyQuaternion(_q2.invert());
    this.pos.set(_F.x - origin.x, _F.y - origin.y, _F.z - origin.z);
  }

  // 지구 밖 천체와의 충돌 (선분-구): 파괴 속도 이상이면 폭발, 해는 초신성, 아니면 표면에서 멈춤
  celestialHit(P0, P1) {
    const C = this.game.cosmic;
    const sp = this.speed;
    for (const b of BODIES) {
      if (b.id === 'earth' || this.gone.has(b.id)) continue;
      const t = segSphere(P0, P1, b.pos, b.radius + 3);
      if (t < 0) continue;
      // 표면에 서 있다가 떠나는 중이면 무시
      _v3.subVectors(P0, b.pos);
      if (_v3.length() <= b.radius + 4 && _v3.dot(_v2.subVectors(P1, P0)) >= 0) continue;
      if (b.id === 'sun') {
        if (C && !C.active) { this.gone.add('sun'); this.game.planetImpact('sun', this, _Vp); }
        return true;
      }
      if (sp >= b.breakV) {
        this.gone.add(b.id);
        if (b.id === TARGETS[this.targetIdx]) this.autopilot = false;
        if (b.id === 'moon') this.moonGone = true;
        _v3.copy(_Vp).normalize();
        this.game.planetImpact(b.id, this, _v3);
        return false;
      }
      // 표면에서 멈춤 (충돌 에너지만큼 흔들림)
      P1.lerpVectors(P0, P1, t);
      planetToFlat(P1.x, P1.y, P1.z, _F);
      this.pos.set(_F.x - origin.x, _F.y - origin.y, _F.z - origin.z);
      this.vel.set(0, 0, 0);
      this.speedLock = 0; this.autopilot = false;
      this.game.hooks.shake(clamp(0.2 + Math.log10(1 + sp) / 10, 0, 1));
      this.game.toast && this.game.toast(sp < 400 ? `${b.name} 표면에 도착` : `${b.name}에 충돌 (파괴하려면 초속 ${fmtSpeed(b.breakV)} 이상)`);
      return true;
    }
    return false;
  }

  // 목표 천체 중심 방향 (지역 좌표 단위 벡터)
  targetDirLocal(out) {
    const b = BODY[TARGETS[this.targetIdx]];
    const ax = this.pos.x + origin.x, ay = this.pos.y + origin.y, az = this.pos.z + origin.z;
    flatToPlanet(ax, ay, az, _P0);
    out.subVectors(b.pos, _P0);
    this.targetDist = out.length() - b.radius;
    localToPlanetQuat(ax, az, _q1);
    return out.applyQuaternion(_q1.invert()).normalize();
  }

  // 건물 충돌: 빠르면 뚫고 지나가며 파괴, 느리면 튕기거나 미끄러짐
  buildingCollide(dt) {
    const Ci = this.game.city;
    if (!Ci || this.mode === 'hero' || this.mode === 'launch') return;
    const ox = origin.x, oy = origin.y, oz = origin.z;
    if (!Ci.segmentHit(this.prevPos.x + ox, this.prevPos.y + oy, this.prevPos.z + oz, this.pos.x + ox, this.pos.y + oy, this.pos.z + oz, _hit)) return;
    const n = _v1.set(_hit.nx, _hit.ny, _hit.nz);
    if (n.y > 0.7) return;   // 옥상 위는 지면 처리에서
    const hx = _hit.x - ox, hy = _hit.y - oy, hz = _hit.z - oz;
    const speed = this.speed;
    const vn = -this.vel.dot(n);
    if (this.mode === 'fly' && speed > 110 && vn > 40) {
      // 관통: 맞은 높이에 구멍이 나고, 큰 건물은 윗부분이 날아가는 쪽으로 기울며 무너짐 (작은 건물은 산산조각)
      const E = 0.5 * MASS * speed * speed;
      const W = this.game.wreck, id = _hit.id;
      _v3.set(hx, hy, hz);
      const fx = this.game.fx;
      if (speed > 2500) {
        // 초고속: 충격파가 주변까지 날려버림
        fx.impact ? fx.impact(_v3, E * 0.35, n) : fx.heroLanding(_v3, 1);
        this.smash(hx, hy, hz, Math.max(18, 0.16 * Math.cbrt(E)));
      } else if (W) {
        _v2.copy(this.vel).normalize();
        const k = clamp(speed / 400, 0.5, 4);
        if (Ci.bh[id] > 22 && Ci.isDynamicable(id) && _hit.y - Ci.by[id] > 6) {
          _v1.copy(_v2).multiplyScalar(4 + 5 * k).setY(Math.max(0, _v2.y) * 4);
          _N.set(_v2.z, 0, -_v2.x).multiplyScalar(0.18 * k);
          W.cut(id, _hit.y - 3, _v1, _N);
        } else W.blast(id, _hit.x, _hit.y, _hit.z, _v2.x, _v2.y, _v2.z, k);
        if (fx.sparks) fx.sparks(_v3, _v2, 50, 0.9, Math.min(80, speed * 0.2), 2.0, 1.7, 1.3, 0.08);
        if (fx.dustCloud) fx.dustCloud(hx, hy, hz, 10 + 4 * k, 4);
        fx.land(_v3, 1);
        n.set(_hit.nx, _hit.ny, _hit.nz);
      }
      this.vel.multiplyScalar(speed > 2000 ? 0.97 : 0.85);
      this.game.hooks.shake(clamp(0.3 + speed / 3000, 0, 1));
      this.game.audio.play('heroLand', clamp(speed / 1500, 0.3, 1));
      this.game.hitStop(0.05, 0.1);
      return;
    }
    // 벽: 밀어내고 법선 방향 속도 제거 (빠르면 튕김)
    this.pos.set(hx + n.x * 0.5, this.pos.y, hz + n.z * 0.5);
    if (vn > 0) this.vel.addScaledVector(n, vn * (vn > 12 && this.mode === 'fly' ? 1.4 : 1));
    if (vn > 12) {
      _v3.set(hx, hy, hz);
      this.game.fx.land(_v3, clamp(vn / 40, 0.2, 1));
      this.game.audio.play('land', clamp(vn / 40, 0.2, 1));
      this.game.hooks.shake(clamp(vn / 60, 0.1, 0.6));
      this.anim.kickArms(-vn * 0.1, vn * 0.15);
    }
  }

  // 트릭 도중 착지: 남은 회전을 자세 스프링으로 넘겨 한 틱에 꺾이지 않게
  handOffTrick() {
    const tr = this.trick;
    if (!tr) return;
    const a = wrapAngle(tr.sign * TAU * easeRot(clamp(tr.p, 0, 1)));
    if (tr.type === 'flip') this.pitch.y += a;
    else if (tr.type === 'roll') this.bank.y += a;
    else this.lean.y += a;
    this.trick = null;
  }

  startTrick(type, dur, sign) {
    const axis = type === 'roll' ? Y : type === 'flip' ? X : Z;
    this.trick = { type, p: 0, dur, axis, sign };
    this.trickCool = 0.12;
    _v3.copy(this.vel);
    if (_v3.lengthSq() < 1) _v3.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _v3.normalize();
    if (type === 'flip') { this.game.fx.flip(this.pos, _v3); this.game.audio.play('flip', 1); }
    else { this.game.fx.roll(this.pos, _v3, sign); this.game.audio.play('roll', 1, sign); }
    // 예비 동작: 반대 방향으로 살짝 감았다가 회전
    if (type === 'roll') this.bank.v -= sign * 2.2;
    if (type === 'cart') this.lean.v -= sign * 1.5;
  }

  updateTrick(dt) {
    const tr = this.trick;
    if (!tr) return;
    tr.p += dt / tr.dur;
    if (tr.p >= 1) {
      // 끝난 뒤 관성으로 살짝 더 돌았다가 복귀 (follow-through)
      if (tr.type === 'roll') this.bank.v += tr.sign * 3.2;
      if (tr.type === 'flip') this.pitch.v += 2.4;
      if (tr.type === 'cart') this.lean.v += tr.sign * 2.2;
      this.trick = null;
    }
  }

  updateAttitude(dt, cam) {
    const speed = this.speed;
    let yawT = this.heading, pitchT = 0, bankT = 0, leanT = 0;
    if (this.mode === 'fly' || this.mode === 'swim') {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const w = smooth(6, 22, speed);
      // 진행 방향을 향함 (거의 수직 이동이면 카메라 방향)
      if (speed > 4 && hs > 0.22 * speed) yawT = Math.atan2(this.vel.x, this.vel.z);
      else if (speed < 6) yawT = cam.yaw;
      else yawT = this.heading;
      const rate = lerp(12, 9, w);   // 몸이 진행 방향을 곧바로 따라감 (옆으로 미끄러지듯 보이지 않게)
      const d = wrapAngle(yawT - this.heading);
      this.heading = wrapAngle(this.heading + d * (1 - Math.exp(-rate * dt)));

      // 저속 기울기 (헬기처럼 진행 방향으로)
      const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
      const fwdV = this.vel.x * sh + this.vel.z * ch;
      const rightV = -this.vel.x * ch + this.vel.z * sh;
      const pitchLow = clamp(fwdV * 0.09, -0.42, 0.8);
      leanT = clamp(rightV * 0.02, -0.15, 0.15) * (1 - w);
      // 고속: 몸축을 속도 방향에 정렬 (수평 = 90°, 수직 상승 = 0°, 다이브 = 180°)
      const elev = speed > 0.5 ? Math.asin(clamp(this.vel.y / speed, -1, 1)) : 0;
      const pitchAl = Math.PI / 2 - elev;
      pitchT = lerp(pitchLow, pitchAl, w);
      // 급제동: 몸을 일으켜 세움
      pitchT -= this.brakeAmt * Math.min(pitchT, 1.15);
      // 수영: 앞으로 헤엄칠 땐 몸이 수평으로 눕고, 멈추면 선 채로 떠 있음
      if (this.mode === 'swim') { pitchT = lerp(0.12, 1.3, smooth(0.6, 2.4, hs)) - (this.vel.y > 1 ? 0.5 : 0); leanT = 0; }
      // 선회 뱅크 (구심 가속 기준): 실제 비행처럼 살짝만
      const latAcc = this.yawRate * hs;
      bankT = -Math.atan(latAcc / 60) * w;
      bankT = clamp(bankT, -0.35, 0.35);
    } else if (this.mode === 'air') {
      pitchT = 0;
    }
    this.yawRate = lerp(this.yawRate, wrapAngle(this.heading - this.prevHeading) / dt, 1 - Math.exp(-10 * dt));
    this.prevHeading = this.heading;
    // 지상에서 돌 때 몸을 안쪽으로 기울임 (도 단위)
    const gsp = this.mode === 'ground' ? Math.hypot(this.vel.x, this.vel.z) : 0;
    this.turnLean = lerp(this.turnLean, clamp(-this.yawRate * gsp * 0.4, -6, 6), 1 - Math.exp(-8 * dt));

    // 스프링 주파수: 지상에서는 단단하게
    const air = this.mode === 'fly';
    this.pitch.f = air ? 3.6 : 7; this.pitch.z = air ? 0.95 : 0.95;
    this.bank.f = air ? 2.3 : 6;
    this.lean.f = air ? 3.0 : 6;
    const pitch = this.pitch.step(pitchT, dt);
    const bank = this.bank.step(bankT, dt);
    const lean = this.lean.step(leanT, dt);
    this.attPitch = pitch;
    this.composeAttitude(pitch, bank, lean);

    // 몸 좌표계 각속도
    _q1.copy(this.prevAtt).invert().multiply(this.attitude);
    if (_q1.w < 0) { _q1.x = -_q1.x; _q1.y = -_q1.y; _q1.z = -_q1.z; _q1.w = -_q1.w; }
    const sinH = Math.sqrt(_q1.x * _q1.x + _q1.y * _q1.y + _q1.z * _q1.z);
    const ang = 2 * Math.atan2(sinH, _q1.w);
    if (sinH > 1e-6) _v3.set(_q1.x / sinH, _q1.y / sinH, _q1.z / sinH).multiplyScalar(ang / dt);
    else _v3.set(0, 0, 0);
    this.angB.lerp(_v3, 1 - Math.exp(-25 * dt));
    this.prevAtt.copy(this.attitude);

    // 몸 좌표계 가속도
    _q2.copy(this.attitude).invert();
    this.accelB.copy(this.accel).applyQuaternion(_q2);
  }

  composeAttitude(pitch, bank, lean = 0) {
    const q = this.attitude;
    q.setFromAxisAngle(Y, this.heading);
    q.multiply(_q2.setFromAxisAngle(Z, lean));
    q.multiply(_q2.setFromAxisAngle(X, pitch));
    q.multiply(_q2.setFromAxisAngle(Y, bank));
    const tr = this.trick;
    if (tr) q.multiply(_q2.setFromAxisAngle(tr.axis, tr.sign * TAU * easeRot(clamp(tr.p, 0, 1))));
  }

  updateAnimation(dt, cam) {
    const s = this.animState;
    s.t = this.time; s.dt = dt;
    s.mode = this.mode === 'swim' ? 'fly' : this.mode;
    s.groundSpeed = this.mode === 'ground' ? Math.hypot(this.vel.x, this.vel.z) : 0;
    s.vy = this.vel.y;
    s.sprint = this.sprinting; s.slow = this.slow;
    s.tired = this.tired;
    s.flySpeed = this.speed;
    s.mach = this.mach;
    s.boost = this.boostAmt;
    s.brake = this.brakeAmt;
    s.vert = this.mode === 'fly' ? this.vert : 0;
    s.attPitch = this.attPitch;
    s.bank = this.bank.y;
    if (this.trick) { this.trickObj.type = this.trick.type; this.trickObj.p = this.trick.p; s.trick = this.trickObj; }
    else s.trick = null;
    s.heroT = this.heroT;
    s.landT = this.landT;
    s.landHard = this.landHard;
    s.launchT = this.launchT;
    s.launchPose = this.mode === 'fly' ? (1 - smooth(0.3, 0.75, this.launchPoseT)) * smooth(-2, 4, this.vel.y) : 0;
    s.turnLean = this.turnLean;
    // 고개: 카메라가 보는 방향 (몸 기준)
    s.lookYaw = wrapAngle(cam.yaw - this.heading);
    if (Math.abs(s.lookYaw) > 2.2) s.lookYaw = 0;
    s.lookPitch = -cam.pitch;
    this.anim.update(dt, s);

    // 몸 변환 = 자세 * 애니메이션 추가 회전, 위치 오프셋은 수평(헤딩) 좌표계
    const av = this.avatar;
    _q1.setFromEuler(this.anim.bodyRot);
    av.body.quaternion.copy(this.attitude).multiply(_q1);
    av.body.position.copy(this.anim.bodyPos).applyAxisAngle(Y, this.heading);
    if (this.blade) this.blade.pose(av);
  }

  // ───────────────────────── 렌더 보간 ─────────────────────────
  interpolate(alpha) {
    const a = this.snapPrev, b = this.snapCur, av = this.avatar;
    this.renderPos.lerpVectors(a.pos, b.pos, alpha);
    av.root.position.copy(this.renderPos);
    av.body.position.lerpVectors(a.bodyPos, b.bodyPos, alpha);
    av.body.quaternion.slerpQuaternions(a.bodyQuat, b.bodyQuat, alpha);
    for (let i = 0; i < 5; i++) av.joints[i].quaternion.slerpQuaternions(a.joints[i], b.joints[i], alpha);
    av.root.updateMatrixWorld(true);
    this.renderQuat.copy(av.body.quaternion);
  }

  // 렌더 프레임마다: FX/오디오 상태, 그림자 블롭, 발열
  updateVisual(dt) {
    const c = this.ctx;
    this.avatar.body.getWorldPosition(c.pos);
    c.speed = this.speed;
    c.mach = this.mach;
    c.flying = this.flying;
    c.grounded = this.grounded;
    c.altitude = Math.max(0, this.agl + 1.0);
    c.absAltitude = this.pos.y + origin.y;
    c.airDensity = this.dens;
    c.vacuum = this.inSpace;
    c.groundY = this.groundY;
    // 목표 천체까지 거리 (HUD)
    this.targetDirLocal(_v3);
    this.targetDistNow = this.targetDist;
    c.time = this.time;
    this.avatar.body.getWorldQuaternion(c.bodyQuat);
    c.boost = this.boostAmt;
    c.trick = this.trick ? 1 : 0;

    const plasma = this.flying ? smooth(1.6, 3.0, this.mach) : 0;
    const vapor = this.flying ? smooth(0.85, 1.0, this.mach) * (1 - smooth(1.15, 1.3, this.mach)) : 0;
    const A = this.audioState;
    // 진공에서는 바람 소리가 없음: 공기 밀도로 체감 풍속을 줄임
    A.speed = Math.min(4000, this.speed * clamp(Math.sqrt(this.dens) * 4, 0, 1)); A.mach = this.mach; A.flying = this.flying; A.grounded = this.grounded;
    A.boost = this.boostAmt; A.plasma = plasma; A.vapor = vapor; A.altitude = c.altitude;

    // 공력 가열: 몸이 달아오름 (주황 → 백열)
    this.heat = lerp(this.heat, plasma, 1 - Math.exp(-2.5 * dt));
    const h = this.heat;
    this.avatar.material.emissive.setRGB(1.0 * h * 1.6, 0.38 * h * 1.6, 0.08 * h * 1.6);

    // 블롭 그림자 (지면 근처에서는 실제 그림자가 있으니 서서히 등장)
    const alt = Math.max(0, this.agl);
    const op = smooth(3, 10, alt) * (1 - smooth(60, 160, alt)) * 0.85;
    this.blob.material.opacity = op;
    this.blob.visible = op > 0.002;
    const sc = 1.6 + alt * 0.035;
    this.blob.scale.set(sc, sc, 1);
    this.blob.position.set(c.pos.x, this.groundY + 0.03, c.pos.z);
  }
}
