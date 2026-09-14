// 고요(GOYO) — 1인칭 플레이어 컨트롤러
import * as THREE from 'three';
import { clamp, clamp01, lerp, smoothstep, TAU } from '../core/utils.js';
import { damp } from './util.js';
import { heightAt, normalAt, surfaceAt, slopeAt, SURFACE, WATER_LEVEL, LAKE, WORLD_LIMIT } from './terrain.js';

const EYE_STAND = 1.68;
const EYE_CROUCH = 1.05;
const EYE_SIT = 0.82;

/** 장애물(나무·바위) 격자 — 통과하지 못하게 막는다 */
export class ObstacleGrid {
  constructor(cell = 10) {
    this.cell = cell;
    this.map = new Map();
  }
  _key(cx, cz) { return cx * 100003 + cz; }
  add(x, z, r) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const k = this._key(cx, cz);
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    arr.push({ x, z, r });
  }
  /** 반경 r 원을 밀어낸다 — 밀린 만큼 [dx, dz] 반환 */
  resolve(pos, radius) {
    const cx = Math.floor(pos.x / this.cell), cz = Math.floor(pos.z / this.cell);
    let hit = false;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        const arr = this.map.get(this._key(cx + i, cz + j));
        if (!arr) continue;
        for (const o of arr) {
          const dx = pos.x - o.x, dz = pos.z - o.z;
          const d = Math.hypot(dx, dz);
          const min = o.r + radius;
          if (d < min && d > 1e-4) {
            const push = (min - d);
            pos.x += (dx / d) * push;
            pos.z += (dz / d) * push;
            hit = true;
          }
        }
      }
    }
    return hit;
  }
}

export class Player {
  constructor(camera, opts = {}) {
    this.camera = camera;
    this.obstacles = opts.obstacles || new ObstacleGrid();
    this.sensitivity = opts.sensitivity ?? 1;
    this.invertY = false;

    this.pos = new THREE.Vector3(0, 0, 26);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;              // 처음엔 초원 안쪽을 본다
    this.pitch = -0.05;

    this.onGround = true;
    this.crouching = false;
    this.sitting = false;
    this.sprinting = false;
    this.stamina = 1;
    this.exertion = 0;
    this.speed = 0;
    this.bobPhase = 0;
    this.stepSide = 1;
    this.eye = EYE_STAND;
    this.fovBase = opts.fov ?? 68;
    this.waterDepth = 0;
    this.surface = SURFACE.GRASS;
    this.stealth = 1;
    this.boundaryWarn = 0;
    this.landImpact = 0;
    this.calm = 0.35;

    this.keys = new Set();
    this.moveInput = new THREE.Vector2();
    this.lookInput = new THREE.Vector2();
    this._onStep = opts.onStep || (() => {});
    this._onLand = opts.onLand || (() => {});
    this._onJump = opts.onJump || (() => {});

    this._tmp = new THREE.Vector3();
    this._headTarget = new THREE.Vector3();
  }

  /* ------------------------------ 입력 ------------------------------ */
  bind(canvas) {
    this.canvas = canvas;
    const kd = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.jump();
      if (e.code === 'KeyR') this.toggleSit();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.sitting = false;
    };
    const ku = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', () => this.keys.clear());

    // 포인터 잠금 직후 브라우저가 큰 movement 값을 한 번 흘리는 일이 있어
    // 짧은 유예 시간과 상한을 둔다 (시점이 갑자기 하늘로 튀는 것을 막는다)
    this._lockAt = 0;
    document.addEventListener('pointerlockchange', () => { this._lockAt = performance.now(); });
    const mm = (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (performance.now() - this._lockAt < 180) return;
      this.lookInput.x += clamp(e.movementX, -160, 160);
      this.lookInput.y += clamp(e.movementY, -160, 160);
    };
    document.addEventListener('mousemove', mm);

    // 터치 — 왼쪽 절반은 이동, 오른쪽 절반은 시점
    this.touch = { move: null, look: null, moveOrigin: new THREE.Vector2() };
    const tstart = (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < window.innerWidth * 0.5 && this.touch.move === null) {
          this.touch.move = t.identifier;
          this.touch.moveOrigin.set(t.clientX, t.clientY);
        } else if (this.touch.look === null) {
          this.touch.look = t.identifier;
          this.touch.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
    };
    const tmove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.move) {
          const dx = (t.clientX - this.touch.moveOrigin.x) / 70;
          const dy = (t.clientY - this.touch.moveOrigin.y) / 70;
          this.moveInput.set(clamp(dx, -1, 1), clamp(-dy, -1, 1));
        } else if (t.identifier === this.touch.look) {
          this.lookInput.x += (t.clientX - this.touch.lookLast.x) * 1.4;
          this.lookInput.y += (t.clientY - this.touch.lookLast.y) * 1.4;
          this.touch.lookLast = { x: t.clientX, y: t.clientY };
        }
      }
      e.preventDefault();
    };
    const tend = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.touch.move) { this.touch.move = null; this.moveInput.set(0, 0); }
        if (t.identifier === this.touch.look) this.touch.look = null;
      }
    };
    canvas.addEventListener('touchstart', tstart, { passive: false });
    canvas.addEventListener('touchmove', tmove, { passive: false });
    canvas.addEventListener('touchend', tend);
    canvas.addEventListener('touchcancel', tend);
  }

  jump() {
    if (this.sitting) { this.sitting = false; return; }
    if (!this.onGround || this.stamina < 0.12 || this.waterDepth > 0.6) return;
    this.vel.y = 4.5;
    this.onGround = false;
    this.stamina = Math.max(0, this.stamina - 0.09);
    this._onJump();
  }

  toggleSit() {
    if (!this.onGround) return;
    this.sitting = !this.sitting;
    if (this.sitting) { this.vel.x = 0; this.vel.z = 0; }
  }

  /* ------------------------------ 갱신 ------------------------------ */
  update(dt) {
    const k = this.keys;

    // 시점
    const s = 0.0022 * this.sensitivity;
    this.yaw -= this.lookInput.x * s;
    this.pitch -= this.lookInput.y * s * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this.yaw = (this.yaw + TAU * 2) % TAU;
    this.lookInput.set(0, 0);

    // 이동 입력
    let ix = 0, iz = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) iz += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) iz -= 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
    if (this.touch && this.touch.move !== null) { ix += this.moveInput.x; iz += this.moveInput.y; }
    const inLen = Math.hypot(ix, iz);
    if (inLen > 1) { ix /= inLen; iz /= inLen; }
    if (inLen > 0.02) this.sitting = false;

    this.crouching = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
    const wantSprint = (k.has('ShiftLeft') || k.has('ShiftRight')) && inLen > 0.2 && !this.crouching;
    this.sprinting = wantSprint && this.stamina > 0.06;

    // 속도 설정
    const baseSpeed = this.crouching ? 1.35 : this.sprinting ? 5.6 : 2.5;
    const waterSlow = 1 - clamp01(this.waterDepth / 1.2) * 0.55;
    const slope = slopeAt(this.pos.x, this.pos.z);
    const slopeSlow = 1 - clamp01((slope - 0.25) / 0.45) * 0.45;
    const target = this.sitting ? 0 : baseSpeed * waterSlow * slopeSlow;

    // 카메라 기준 이동 방향
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    const fx = -sinY, fz = -cosY;       // 전방
    const rx = cosY, rz = -sinY;        // 우측
    const wishX = fx * iz + rx * ix;
    const wishZ = fz * iz + rz * ix;

    const accel = this.onGround ? (this.sprinting ? 14 : 11) : 3.5;
    this.vel.x = damp(this.vel.x, wishX * target, accel, dt);
    this.vel.z = damp(this.vel.z, wishZ * target, accel, dt);

    // 중력 / 점프
    this.vel.y -= 17.5 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    // 나무·바위 충돌
    this.obstacles.resolve(this.pos, 0.34);

    // 세계 경계 — 벽 대신 부드럽게 되돌린다
    const dc = Math.hypot(this.pos.x, this.pos.z);
    if (dc > WORLD_LIMIT) {
      const over = dc - WORLD_LIMIT;
      const nx = this.pos.x / dc, nz = this.pos.z / dc;
      const push = Math.min(over, 8) * dt * 2.4;
      this.pos.x -= nx * push * 2;
      this.pos.z -= nz * push * 2;
      this.boundaryWarn = 1;
    } else {
      this.boundaryWarn = damp(this.boundaryWarn, 0, 1.5, dt);
    }

    // 지면
    const ground = heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      if (!this.onGround) {
        const impact = clamp01(-this.vel.y / 9);
        this.landImpact = impact;
        this._onLand(impact, this.surface);
      }
      this.pos.y = ground;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > ground + 0.02) {
      this.onGround = false;
    }

    // 급경사에서는 미끄러진다
    if (this.onGround && slope > 0.62) {
      const n = normalAt(this.pos.x, this.pos.z, 1.0);
      this.pos.x += n.x * (slope - 0.6) * 9 * dt;
      this.pos.z += n.z * (slope - 0.6) * 9 * dt;
    }

    // 물
    this.waterDepth = Math.max(0, WATER_LEVEL - ground);
    if (this.waterDepth > 1.15) {
      // 깊은 물로는 들어가지 않는다 — 물가로 되돌린다
      const dx = this.pos.x - LAKE.x, dz = this.pos.z - LAKE.z;
      const d = Math.hypot(dx, dz) || 1;
      this.pos.x += (dx / d) * 2.4 * dt * (this.waterDepth);
      this.pos.z += (dz / d) * 2.4 * dt * (this.waterDepth);
    }

    this.surface = this.waterDepth > 0.06 ? SURFACE.WATER : surfaceAt(this.pos.x, this.pos.z, ground, slope);

    // 실제 속도
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speed = hSpeed;

    // 체력(숨) — 달리면 줄고 걸으면 찬다
    if (this.sprinting && hSpeed > 1) this.stamina = Math.max(0, this.stamina - dt * 0.14);
    else this.stamina = Math.min(1, this.stamina + dt * (this.sitting ? 0.24 : this.crouching ? 0.16 : hSpeed > 0.5 ? 0.07 : 0.12));
    const load = clamp01(hSpeed / 5.6) * (this.sprinting ? 1 : 0.45) + (1 - this.stamina) * 0.55;
    this.exertion = damp(this.exertion, clamp01(load), this.sprinting ? 1.6 : 0.5, dt);

    // 얼마나 조용히 움직이는가 — 동물 접근 가능 여부
    const noise = clamp01(hSpeed / 5.6) * (this.crouching ? 0.35 : 1);
    this.stealth = clamp01(1 - noise * 0.95) * (this.crouching ? 1 : 0.86);

    // 머리 흔들림 + 발소리
    if (this.onGround && hSpeed > 0.35) {
      const stride = this.sprinting ? 3.0 : this.crouching ? 4.2 : 3.55;
      const prev = this.bobPhase;
      this.bobPhase += hSpeed * dt * stride;
      if (Math.floor(this.bobPhase / Math.PI) !== Math.floor(prev / Math.PI)) {
        this.stepSide *= -1;
        const intensity = clamp01(0.45 + hSpeed / 5.6 * 0.75) * (this.crouching ? 0.5 : 1);
        this._onStep(this.surface, intensity, this.sprinting, this.stepSide);
      }
    } else {
      this.bobPhase = damp(this.bobPhase, Math.round(this.bobPhase / Math.PI) * Math.PI, 6, dt);
    }

    // 눈높이
    const eyeTarget = this.sitting ? EYE_SIT : this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eye = damp(this.eye, eyeTarget, 9, dt);
    this.landImpact = damp(this.landImpact, 0, 5, dt);

    this._applyCamera(dt, hSpeed);
  }

  _applyCamera(dt, hSpeed) {
    const cam = this.camera;
    const bobAmt = clamp01(hSpeed / 5.6);
    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * bobAmt;
    const bobX = Math.sin(this.bobPhase) * 0.035 * bobAmt;
    // 숨결에 따른 아주 작은 흔들림 — 멈춰 있어도 살아 있는 느낌
    const breathe = Math.sin(performance.now() * 0.0009 * (1 + this.exertion * 2)) * (0.012 + this.exertion * 0.02);

    this._headTarget.set(
      this.pos.x + bobX * Math.cos(this.yaw),
      this.pos.y + this.eye + bobY + breathe - this.landImpact * 0.35,
      this.pos.z - bobX * Math.sin(this.yaw)
    );
    cam.position.lerp(this._headTarget, 1 - Math.exp(-26 * dt));

    const rollTarget = -this.vel.x * Math.cos(this.yaw) * 0.004 + this.vel.z * Math.sin(this.yaw) * 0.004;
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw;
    cam.rotation.x = this.pitch + Math.sin(this.bobPhase * 2 + 1) * 0.006 * bobAmt - this.landImpact * 0.06;
    cam.rotation.z = damp(cam.rotation.z, rollTarget + Math.sin(this.bobPhase) * 0.004 * bobAmt, 6, dt);

    const fov = this.fovBase + clamp01(hSpeed / 5.6) * (this.sprinting ? 7 : 2.5);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = damp(cam.fov, fov, 5, dt);
      cam.updateProjectionMatrix();
    }
  }

  /** 힐링 지표 — 조용히 머물고 자연 가까이 있을수록 오른다 */
  updateCalm(dt, ctx) {
    let gain = 0.0008;
    if (this.sitting) gain += 0.006;
    if (this.speed < 0.4) gain += 0.0015;
    if (ctx.animalsNear > 0) gain += 0.003 * Math.min(ctx.animalsNear, 3);
    if (ctx.waterDist < 18) gain += 0.0015;
    if (ctx.goldenHour) gain += 0.0025;
    if (this.sprinting) gain -= 0.004;
    this.calm = clamp01(this.calm + gain * dt);
    return this.calm;
  }

  get position() { return this.pos; }
}
