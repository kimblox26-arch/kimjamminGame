// 플레이어 컨트롤러: 지상/공중/비행/영웅착지 상태, 고정 120Hz 물리, 자세(attitude) 계산, 이펙트/사운드 트리거
import * as THREE from 'three';
import { Avatar, RIG } from './avatar.js';
import { Animator, CH } from './animator.js';

export const SOUND_SPEED = 343;
const TAU = Math.PI * 2;
const GRAVITY = 34;
const VMAX = 1500;

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

    this.heading = 0;
    this.headingSpring = new Spring(2.6, 0.9);
    this.pitch = new Spring(3.2, 0.78);
    this.bank = new Spring(2.3, 0.55);
    this.lean = new Spring(3.0, 0.7);
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
      _v3.y = 0.02;
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
  get grounded() { return this.mode === 'ground' || this.mode === 'hero'; }

  // ───────────────────────── 고정 스텝 ─────────────────────────
  step(dt, input, cam) {
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

    if (input.consume('jump')) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const wantFly = input.consume('fly');
    const rollL = input.consume('rollL'), rollR = input.consume('rollR');
    const wantFlip = input.consume('flip');
    this.trickCool = Math.max(0, this.trickCool - dt);
    this.brakeCool = Math.max(0, this.brakeCool - dt);

    this.prevVel.copy(this.vel);
    const prevSpeed = this.speed;

    if (this.mode === 'ground') this.stepGround(dt, fwdFlat, right, mx, my, mag, wantFly, rollL, rollR, wantFlip);
    else if (this.mode === 'air') this.stepAir(dt, fwdFlat, right, mx, my, mag, wantFly, rollL, rollR, wantFlip);
    else if (this.mode === 'fly') this.stepFly(dt, cam, cy, sy, cp, sp, mx, my, mag, I, wantFly, rollL, rollR, wantFlip, prevSpeed);
    else if (this.mode === 'hero') this.stepHero(dt, wantFly);

    // 대시(롤 회피) 감쇠 및 적분
    this.pos.addScaledVector(this.vel, dt).addScaledVector(this.dash, dt);
    this.dash.multiplyScalar(Math.exp(-5.5 * dt));
    this.speed = this.vel.length();
    this.mach = this.speed / SOUND_SPEED;
    if (this.pos.y > 9000) { this.pos.y = 9000; if (this.vel.y > 0) this.vel.y = 0; }

    // 지면 처리
    this.groundCollide(dt);

    // 가속도 (고유 가속도: 자유낙하 중엔 0)
    _v3.subVectors(this.vel, this.prevVel).divideScalar(dt);
    if (this.mode === 'air') _v3.y += GRAVITY;
    _v3.clampLength(0, 400);
    this.accel.lerp(_v3, 1 - Math.exp(-18 * dt));

    // 음속 돌파 / 플라즈마 점화 이벤트
    if (this.mach < 0.85) this.boomArmed = true;
    if (this.boomArmed && this.mach >= 1.0 && this.flying) {
      this.boomArmed = false;
      _v3.copy(this.vel).normalize();
      fx.sonicBoom(this.pos, _v3);
      au.play('sonicBoom', 1);
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

    this.updateTrick(dt);
    this.updateAttitude(dt, cam);
    this.updateAnimation(dt, cam);
    this.snapshot(this.snapCur);
  }

  stepGround(dt, fwd, right, mx, my, mag, wantFly, rollL, rollR, wantFlip) {
    const fx = this.game.fx, au = this.game.audio;
    const dir = _v3.set(0, 0, 0).addScaledVector(fwd, my).addScaledVector(right, mx);
    if (dir.lengthSq() > 1) dir.normalize();
    const top = this.slow ? 3.6 : this.sprint ? 16 : 9.5;
    const tx = dir.x * top, tz = dir.z * top;
    const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
    const dl = Math.hypot(dvx, dvz);
    const acc = (tx * this.vel.x + tz * this.vel.z > 0 || mag > 0.1 ? 60 : 45) * dt;
    if (dl > acc) { this.vel.x += (dvx / dl) * acc; this.vel.z += (dvz / dl) * acc; }
    else { this.vel.x = tx; this.vel.z = tz; }
    this.vel.y = 0;
    if (mag > 0.08) this.turnHeading(Math.atan2(dir.x, dir.z), 13, dt);
    this.coyote = 0.1;
    this.landT = this.landT >= 0 ? this.landT + dt : -1;

    if (wantFly) { this.takeoff(true); return; }
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

  jump(v, strength) {
    this.vel.y = v;
    this.mode = 'air';
    this.coyote = 0;
    this.airFlips = 0;
    _v3.copy(this.pos); _v3.y = 0.02;
    this.game.fx.jump(_v3, strength);
    this.game.audio.play('jump', strength);
    this.anim.kickBody(-0.9, 0);
    this.anim.kickArms(9, 2);
    this.anim.kickLegs(4, 0);
  }

  stepAir(dt, fwd, right, mx, my, mag, wantFly, rollL, rollR, wantFlip) {
    const dir = _v3.set(0, 0, 0).addScaledVector(fwd, my).addScaledVector(right, mx);
    if (dir.lengthSq() > 1) dir.normalize();
    const top = this.slow ? 3.6 : this.sprint ? 16 : 9.5;
    const tx = dir.x * top, tz = dir.z * top;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    // 공중 제어: 입력 방향으로만 가속, 입력 없으면 거의 유지
    if (mag > 0.08) {
      const dvx = tx - this.vel.x, dvz = tz - this.vel.z;
      const dl = Math.hypot(dvx, dvz), acc = 22 * dt;
      if (dl > acc) { this.vel.x += (dvx / dl) * acc; this.vel.z += (dvz / dl) * acc; }
      else { this.vel.x = tx; this.vel.z = tz; }
      this.turnHeading(Math.atan2(dir.x, dir.z), 7, dt);
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
      this.vel.y = Math.max(this.vel.y, 17);
      _v3.copy(this.pos); _v3.y = 0.02;
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
      au.play('brake', 0.35);
      return;
    }
    // 원하는 방향: 카메라 전방(피치 포함) + 좌우 + 상하
    const vert = (I.up ? 1 : 0) - (I.down ? 1 : 0);
    this.vert = vert;
    const dir = _v3.set(sy * cp * my - cy * mx, sp * my + vert, cy * cp * my + sy * mx);
    const dmag = Math.min(1, dir.length());
    const hasInput = dmag > 0.08;
    if (hasInput) dir.divideScalar(dir.length());

    const boosting = I.boost && hasInput && !this.slow;
    let speed = this.speed;
    const onlyVert = hasInput && mag < 0.08;
    const tier = this.slow ? 7.5 : onlyVert ? 14 : 30;

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
      const a = speed < 110 ? 150 : 50 + 0.55 * speed;
      target = Math.min(VMAX, speed + a * dt);
    } else if (hasInput) {
      const t = tier * dmag;
      if (speed < t) target = Math.min(t, speed + (this.slow ? 14 : 45) * dt);
      else target = Math.max(t, speed - (18 + 0.75 * speed) * dt);
    } else {
      target = Math.max(0, speed - (22 + 1.5 * speed) * dt);
    }

    if (speed < 7 || !hasInput) {
      // 저속: 속도 벡터를 목표 벡터로 직접 (자유로운 호버 이동)
      if (hasInput && speed < 7) {
        const ax = dir.x * target - this.vel.x, ay = dir.y * target - this.vel.y, az = dir.z * target - this.vel.z;
        const dl = Math.hypot(ax, ay, az), acc = (this.slow ? 16 : 34) * dt;
        if (dl > acc) { this.vel.x += (ax / dl) * acc; this.vel.y += (ay / dl) * acc; this.vel.z += (az / dl) * acc; }
        else this.vel.set(dir.x * target, dir.y * target, dir.z * target);
      } else if (speed > 1e-4) {
        this.vel.multiplyScalar(target / speed);
      }
    } else {
      // 고속: 방향은 최대 선회율로 회전, 속력은 따로
      const cur = _v1.copy(this.vel).divideScalar(speed);
      const ang = Math.acos(clamp(cur.dot(dir), -1, 1));
      const turn = lerp(5.2, 0.95, smooth(30, 1200, speed)) * (this.slow ? 0.7 : 1);
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
    if (wantFly && this.heroT > 0.3) { this.takeoff(true); return; }
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

  groundCollide(dt) {
    const fx = this.game.fx, au = this.game.audio;
    if (this.mode === 'ground' || this.mode === 'hero') { this.pos.y = RIG.pivotY; return; }
    if (this.mode === 'air') {
      if (this.pos.y <= RIG.pivotY && this.vel.y <= 0) {
        const impact = -this.vel.y;
        this.pos.y = RIG.pivotY;
        this.vel.y = 0;
        this.mode = 'ground';
        this.landT = 0;
        this.landHard = smooth(13, 32, impact);
        const st = clamp(impact / 34, 0.15, 1);
        _v3.copy(this.pos); _v3.y = 0.02;
        fx.land(_v3, st);
        au.play('land', st);
        this.anim.kickBody(-impact * 0.09, impact * 0.04);
        this.anim.kickArms(-impact * 0.12, impact * 0.18);
        if (impact > 28) this.game.hooks.shake(0.25 + 0.4 * this.landHard);
        if (this.trick && this.trick.p < 0.85) this.trick = null;
      }
      return;
    }
    // 비행 중
    const low = this.lowestPoint();
    if (low >= 0) return;
    const speed = this.speed;
    const elev = speed > 0.1 ? Math.asin(clamp(this.vel.y / speed, -1, 1)) : 0;
    if (this.vel.y < -22 || (speed > 45 && elev < -0.35)) {
      // 슈퍼히어로 착지
      const st = clamp(-this.vel.y / 70 + speed / 700, 0.35, 1);
      this.pos.y = RIG.pivotY;
      this.vel.set(0, 0, 0);
      this.dash.set(0, 0, 0);
      this.mode = 'hero';
      this.heroT = 0;
      this.trick = null;
      this.boostAmt = 0;
      this.wasBoosting = false;
      this.pitch.y = Math.min(this.pitch.y, 0.5); this.pitch.v = 0;
      this.bank.y = 0; this.bank.v = 0;
      _v3.copy(this.pos); _v3.y = 0.02;
      fx.heroLanding(_v3, st);
      au.play('heroLand', st);
      this.game.hitStop(0.09, 0.04);
    } else if (speed < 14 && this.pitch.y < 0.9) {
      // 부드러운 착지
      this.pos.y = RIG.pivotY;
      this.vel.y = 0;
      this.mode = 'ground';
      this.landT = 0;
      this.landHard = 0;
      this.boostAmt = 0;
      _v3.copy(this.pos); _v3.y = 0.02;
      fx.land(_v3, 0.25);
      au.play('land', 0.3);
      this.anim.kickBody(-0.6, 0.2);
    } else {
      // 지면 스치기: 밀어올리고 하강 성분 제거
      this.pos.y -= low;
      if (this.vel.y < 0) this.vel.y *= -0.1;
    }
  }

  startTrick(type, dur, sign) {
    const axis = type === 'roll' ? Y : type === 'flip' ? X : Z;
    this.trick = { type, p: 0, dur, axis, sign };
    this.trickCool = 0.12;
    _v3.copy(this.vel);
    if (_v3.lengthSq() < 1) _v3.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    _v3.normalize();
    if (type === 'flip') { this.game.fx.flip(this.pos, _v3); this.game.audio.play('flip', 1); }
    else { this.game.fx.roll(this.pos, _v3, sign); this.game.audio.play('roll', 1); }
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
    if (this.mode === 'fly') {
      const hs = Math.hypot(this.vel.x, this.vel.z);
      const w = smooth(6, 22, speed);
      // 진행 방향을 향함 (거의 수직 이동이면 카메라 방향)
      if (speed > 4 && hs > 0.22 * speed) yawT = Math.atan2(this.vel.x, this.vel.z);
      else if (speed < 6) yawT = cam.yaw;
      else yawT = this.heading;
      const rate = lerp(5, 3.2, w);
      const d = wrapAngle(yawT - this.heading);
      this.heading = wrapAngle(this.heading + d * (1 - Math.exp(-rate * dt)));

      // 저속 기울기 (헬기처럼 진행 방향으로)
      const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
      const fwdV = this.vel.x * sh + this.vel.z * ch;
      const rightV = -this.vel.x * ch + this.vel.z * sh;
      const pitchLow = clamp(fwdV * 0.09, -0.42, 0.8);
      leanT = clamp(rightV * 0.045, -0.45, 0.45) * (1 - w);
      // 고속: 몸축을 속도 방향에 정렬 (수평 = 90°, 수직 상승 = 0°, 다이브 = 180°)
      const elev = speed > 0.5 ? Math.asin(clamp(this.vel.y / speed, -1, 1)) : 0;
      const pitchAl = Math.PI / 2 - elev;
      pitchT = lerp(pitchLow, pitchAl, w);
      // 급제동: 몸을 일으켜 세움
      pitchT -= this.brakeAmt * Math.min(pitchT, 1.15);
      // 선회 뱅크 (구심 가속 기준)
      const latAcc = this.yawRate * hs;
      bankT = -Math.atan(latAcc / 16) * w;
      bankT = clamp(bankT, -1.3, 1.3);
    } else if (this.mode === 'air') {
      pitchT = 0;
    }
    this.yawRate = lerp(this.yawRate, wrapAngle(this.heading - this.prevHeading) / dt, 1 - Math.exp(-10 * dt));
    this.prevHeading = this.heading;

    // 스프링 주파수: 지상에서는 단단하게
    const air = this.mode === 'fly';
    this.pitch.f = air ? 3.2 : 7; this.pitch.z = air ? 0.78 : 0.9;
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
    s.mode = this.mode;
    s.groundSpeed = this.mode === 'ground' ? Math.hypot(this.vel.x, this.vel.z) : 0;
    s.vy = this.vel.y;
    s.sprint = this.sprint; s.slow = this.slow;
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
    c.altitude = Math.max(0, c.pos.y);
    c.time = this.time;
    this.avatar.body.getWorldQuaternion(c.bodyQuat);
    c.boost = this.boostAmt;
    c.trick = this.trick ? 1 : 0;

    const plasma = this.flying ? smooth(1.6, 3.0, this.mach) : 0;
    const vapor = this.flying ? smooth(0.85, 1.0, this.mach) * (1 - smooth(1.15, 1.3, this.mach)) : 0;
    const A = this.audioState;
    A.speed = this.speed; A.mach = this.mach; A.flying = this.flying; A.grounded = this.grounded;
    A.boost = this.boostAmt; A.plasma = plasma; A.vapor = vapor; A.altitude = c.altitude;

    // 공력 가열: 몸이 달아오름 (주황 → 백열)
    this.heat = lerp(this.heat, plasma, 1 - Math.exp(-2.5 * dt));
    const h = this.heat;
    this.avatar.material.emissive.setRGB(1.0 * h * 1.6, 0.38 * h * 1.6, 0.08 * h * 1.6);

    // 블롭 그림자 (지면 근처에서는 실제 그림자가 있으니 서서히 등장)
    const alt = Math.max(0, c.pos.y - 1.0);
    const op = smooth(3, 10, alt) * (1 - smooth(60, 160, alt)) * 0.85;
    this.blob.material.opacity = op;
    this.blob.visible = op > 0.002;
    const sc = 1.6 + alt * 0.035;
    this.blob.scale.set(sc, sc, 1);
    this.blob.position.set(c.pos.x, 0.03, c.pos.z);
  }
}
