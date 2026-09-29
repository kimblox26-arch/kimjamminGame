// 플레이어: 이동(걷기/달리기/앉기/점프/기울이기), 시점, 반동 펀치, 체력/피격
import * as THREE from 'three';
import { Audio } from './audio.js';
import { clamp, lerp, damp, DEG, Spring3, raySphere, rand } from './core.js';

const STEP = { concrete: 'stepConcrete', metal: 'stepMetal', dirt: 'stepDirt', wood: 'stepWood', glass: 'stepConcrete' };

export class Player {
  constructor(game) {
    this.g = game;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.st = { grounded: true, surf: 'concrete', canStep: true };
    this.punch = new Spring3(140, 13);   // x=pitch, y=yaw, z=roll (라디안*100)
    this.reset(game.world.playerSpawn);
  }

  reset(p) {
    this.pos.copy(p); this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0; this.lean = 0; this.crouchT = 0; this.crouching = false;
    this.hp = 100; this.alive = true; this.lastHit = 99; this.bobPhase = 0; this.bobAmt = 0; this.sprinting = false;
    this.breath = 1; this.holdBreath = false; this.shake = 0; this.landV = 0;
    this.punch.reset();
  }

  get grounded() { return this.st.grounded; }
  hSpeed() { return Math.hypot(this.vel.x, this.vel.z); }
  stopSprint() { this.sprinting = false; this.sprintBlock = 0.3; }

  applyRecoil(climbDeg, driftDeg) {
    this.pitch += climbDeg * 0.42 * DEG;
    this.yaw -= driftDeg * 0.42 * DEG;
    this.punch.impulse(climbDeg * 9, -driftDeg * 9, (Math.random() - 0.5) * climbDeg * 6);
  }

  update(dt, input) {
    const g = this.g, S = g.settings, W = g.weapons;
    this.lastHit += dt;
    if (!this.alive) { this.deathCam(dt); return; }
    // ── 시점 ──
    const adsK = W ? lerp(1, S.adsSens * (W.def.scope ? 0.35 : 0.85), W.ads) : 1;
    const sens = 0.0022 * S.sens * adsK;
    this.yaw -= input.dx * sens;
    this.pitch = clamp(this.pitch - input.dy * sens * (S.invertY ? -1 : 1), -1.5, 1.5);
    // 숨 참기 (조준 중 Shift)
    const aiming = W && W.ads > 0.5;
    this.holdBreath = aiming && input.key('ShiftLeft') && this.breath > 0;
    if (this.holdBreath) { if (!this._hb) Audio.play('breath', { vol: 0.25, rate: 1.4 }); this.breath -= dt / 5; }
    else { if (this._hb) Audio.play('breath', { vol: 0.35 }); this.breath = Math.min(1, this.breath + dt / 6); }
    this._hb = this.holdBreath;
    // ── 이동 입력 ──
    const f = (input.key('KeyW') ? 1 : 0) - (input.key('KeyS') ? 1 : 0);
    const r = (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0);
    if (input.pressed('KeyC')) this.crouching = !this.crouching;
    const crouchHeld = false;
    let wantCrouch = this.crouching || crouchHeld;
    this.sprintBlock = Math.max(0, (this.sprintBlock || 0) - dt);
    this.sprinting = input.key('ShiftLeft') && f > 0 && !aiming && this.sprintBlock <= 0 && this.st.grounded && !(W && W.busy() && /reload|rS/.test(W.anim?.name || ''));
    if (this.sprinting && wantCrouch) { this.crouching = false; wantCrouch = crouchHeld; }
    // 서기 공간 확인
    if (!wantCrouch && this.crouchT > 0.1 && g.world.overlaps(this.pos.x, this.pos.y + 0.05, this.pos.z, 0.3, 1.75, null)) wantCrouch = true;
    this.crouchT = damp(this.crouchT, wantCrouch ? 1 : 0, 10, dt);
    const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), rt = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fw.multiplyScalar(f).add(rt.multiplyScalar(r));
    if (wish.lengthSq() > 1) wish.normalize();
    let speed = this.sprinting ? 6.3 : 4.1;
    speed *= lerp(1, 0.48, this.crouchT);
    if (W) speed *= lerp(1, 0.55, W.ads) * (1 - (W.def.weight - 1) * 0.08);
    const accel = this.st.grounded ? 11 : 1.8;
    this.vel.x = damp(this.vel.x, wish.x * speed, accel, dt);
    this.vel.z = damp(this.vel.z, wish.z * speed, accel, dt);
    // 점프
    if (input.pressed('Space') && this.st.grounded && this.crouchT < 0.5) { this.vel.y = 5.0; Audio.play(STEP[this.st.surf] || 'stepConcrete', { vol: 0.5 }); }
    this.vel.y -= 16 * dt;
    const wasG = this.st.grounded, vy = this.vel.y;
    this.st.canStep = this.st.grounded;
    const h = lerp(1.8, 1.2, this.crouchT);
    g.world.move(this.pos, this.vel, dt, 0.3, h, this.st);
    if (this.pos.y < -10) this.pos.copy(g.world.playerSpawn);
    // 착지
    if (!wasG && this.st.grounded && vy < -3) {
      const k = clamp((-vy - 3) / 8, 0.15, 1);
      W?.land.impulse(0, -k * 6, 0);
      this.punch.impulse(k * 30, 0, 0);
      Audio.play('land', { vol: 0.4 + k * 0.6 });
      Audio.play(STEP[this.st.surf] || 'stepConcrete', { vol: 0.7 });
      if (vy < -13) this.damage((-vy - 13) * 9, null, 'fall');
    }
    if (wasG && !this.st.grounded && this.vel.y > 0) W?.land.impulse(0, 3, 0);
    // ── 걷기 흔들림 + 발소리 ──
    const hs = this.hSpeed();
    if (this.st.grounded && hs > 0.4) {
      const prev = Math.floor(this.bobPhase / Math.PI);
      this.bobPhase += hs * dt * (this.sprinting ? 1.7 : 2.0);
      if (Math.floor(this.bobPhase / Math.PI) !== prev) Audio.play(STEP[this.st.surf] || 'stepConcrete', { vol: (this.sprinting ? 0.55 : 0.32) * lerp(1, 0.4, this.crouchT), rate: rand(0.9, 1.1) });
    }
    this.bobAmt = damp(this.bobAmt, this.st.grounded ? clamp(hs / 4.1, 0, 1.6) : 0, 8, dt);
    // ── 기울이기 (Q/E) ──
    const leanIn = (input.key('KeyE') ? 1 : 0) - (input.key('KeyQ') ? 1 : 0);
    let tl = this.sprinting ? 0 : leanIn;
    if (tl) {
      const side = new THREE.Vector3(Math.cos(this.yaw) * tl, 0, -Math.sin(this.yaw) * tl);
      const o = new THREE.Vector3(this.pos.x, this.pos.y + h - 0.15, this.pos.z);
      const hit = g.world.raycast(o, side, 0.75);
      if (hit) tl *= clamp((hit.t - 0.25) / 0.45, 0, 1);
    }
    this.lean = damp(this.lean, tl, 9, dt);
    // 체력 회복
    if (this.lastHit > 5 && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 14);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    this.updateCamera(dt, h);
  }

  updateCamera(dt, h) {
    const cam = this.g.camera, g = this.g;
    const eyeH = h - 0.14;
    const bob = this.bobAmt * (1 - (g.weapons?.ads || 0) * 0.8);
    const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.eye.set(this.pos.x, this.pos.y + eyeH, this.pos.z)
      .addScaledVector(side, this.lean * 0.42 + Math.sin(this.bobPhase) * 0.025 * bob);
    this.eye.y += -Math.abs(Math.cos(this.bobPhase)) * 0.035 * bob - Math.abs(this.lean) * 0.06;
    const p = this.punch.update(dt);
    const sh = this.shake * this.shake, t = performance.now() / 1000;
    const shx = (Math.sin(t * 43) + Math.sin(t * 71)) * 0.5 * sh * 0.05, shy = (Math.sin(t * 37 + 1) + Math.sin(t * 59)) * 0.5 * sh * 0.05;
    cam.position.copy(this.eye);
    // 숨결에 따른 조준 흔들림 (저격 조준 시)
    let sway = 0, swayY = 0;
    const W = g.weapons;
    if (W && W.def.scope && W.ads > 0.5 && !this.holdBreath) { sway = Math.sin(t * 0.9) * 0.0025 + Math.sin(t * 2.3) * 0.001; swayY = Math.sin(t * 1.4) * 0.002; }
    cam.rotation.set(this.pitch + p.x * 0.01 + shx + swayY, this.yaw + p.y * 0.01 + shy + sway, -this.lean * 0.2 + p.z * 0.01 + Math.sin(this.bobPhase) * 0.004 * bob, 'YXZ');
  }

  deathCam(dt) {
    const cam = this.g.camera;
    this.deathT = (this.deathT || 0) + dt;
    const k = Math.min(1, this.deathT / 1.2);
    cam.position.set(this.pos.x, lerp(this.eye.y, this.pos.y + 0.25, k * k), this.pos.z);
    cam.rotation.set(lerp(this.pitch, 0.25, k), this.yaw, lerp(0, 1.2, k * k), 'YXZ');
  }

  damage(amount, from, kind = 'gun') {
    if (!this.alive || this.g.mode === 'training' && kind !== 'fall') return;
    this.hp -= amount; this.lastHit = 0;
    this.g.hud?.damage(from, this, amount);
    this.punch.impulse((Math.random() - 0.3) * 60, (Math.random() - 0.5) * 50, (Math.random() - 0.5) * 60);
    Audio.play('hurt', { vol: 0.7 });
    if (this.hp < 35) Audio.play('heart', { vol: 0.6 });
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.deathT = 0; this.g.onPlayerDeath(); }
  }

  raycast(o, d, maxT) {
    if (!this.alive) return null;
    const c1 = this.eye, c2 = new THREE.Vector3(this.pos.x, this.eye.y - 0.45, this.pos.z), c3 = new THREE.Vector3(this.pos.x, this.pos.y + 0.5, this.pos.z);
    let best = maxT, hit = null;
    for (const [c, r] of [[c1, 0.14], [c2, 0.27], [c3, 0.22]]) {
      const t = raySphere(o, d, c, r, best);
      if (t >= 0 && t < best) { best = t; hit = { t, point: o.clone().addScaledVector(d, t) }; }
    }
    return hit;
  }
}
