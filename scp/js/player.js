// D계급 플레이어: 모델 + 이동/점프/달리기/웅크리기 + 절차적 애니메이션
import * as THREE from 'three';
import { buildHumanoid, Pose, applyPose } from './rig.js';
import { collideCircle } from './map.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function suitTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#d4601c'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4000; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,220,180'},${Math.random() * 0.08})`; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 1); }
  for (let i = 0; i < 256; i += 3) { x.fillStyle = 'rgba(0,0,0,0.05)'; x.fillRect(0, i, 256, 1); x.fillRect(i, 0, 1, 256); }
  for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(60,30,10,0.12)'; x.beginPath(); x.ellipse(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 30, 5 + Math.random() * 15, 0, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2); return t;
}

export class Player {
  constructor(scene, world, audio, spawn) {
    this.world = world; this.audio = audio;
    const suit = new THREE.MeshStandardMaterial({ map: suitTex(), roughness: 0.85 });
    const skin = new THREE.MeshPhysicalMaterial({ color: 0xc98d6c, roughness: 0.6, sheen: 0.3, sheenColor: new THREE.Color(0xff9c80) });
    this.rig = buildHumanoid({
      kind: 'dclass', skin, cloth: suit, cloth2: suit, sleeve: suit, pants: suit,
      shoe: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5 }),
      hairMat: new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.95 }),
      hipH: 0.95, thigh: 0.44, shin: 0.43, ankleH: 0.08, spine: 0.2, chest: 0.3, neck: 0.08, headS: [0.093, 0.115, 0.105],
      upper: 0.3, fore: 0.27, palmL: 0.085, fingerL: 0.075, fingerR: 0.0095, shoulderW: 0.195, hipW: 0.095,
      chestR: 0.165, waist: 0.135, depth: 0.66, pelvis: [0.165, 0.11, 0.12], armR: 0.047, legR: 0.078, neckR: 0.052, footL: 0.26,
    });
    // 가슴 명찰
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.05), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
    tag.position.set(0.07, 0.22, 0.118); this.rig.bones.chest.add(tag);
    this.root = this.rig.root; scene.add(this.root);
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z); this.vel = new THREE.Vector3();
    this.yaw = 0; this.ground = true; this.stamina = 100; this.exhausted = false;
    this.phase = 0; this.crouch = 0; this.air = 0; this.landT = 0; this.t = 0; this.dead = false; this.deathT = 0;
    this.hasCard = false; this.P = new Pose(); this.lastStep = 0;
  }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get tired() { return clamp(1 - this.stamina / 55, 0, 1); }

  update(dt, inp, camYaw, camPitch, fp) {
    this.t += dt;
    if (this.dead) { this.deathT += dt; this.animate(dt, camYaw, camPitch); return; }
    const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw)), right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const wish = fwd.multiplyScalar(inp.f - inp.b).add(right.multiplyScalar(inp.r - inp.l));
    const moving = wish.lengthSq() > 0.01; if (moving) wish.normalize();
    this.crouch += ((inp.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    const running = inp.run && moving && !this.exhausted && this.crouch < 0.5;
    const top = this.crouch > 0.5 ? 1.7 : running ? 6.4 : 3.1;
    // 스태미나
    if (running && this.speed > 4) this.stamina -= dt * 17; else this.stamina += dt * (moving ? 9 : 15);
    this.stamina = clamp(this.stamina, 0, 100);
    if (this.stamina <= 0) this.exhausted = true; if (this.exhausted && this.stamina > 35) this.exhausted = false;
    const acc = this.ground ? 14 : 2.5, k = Math.min(1, dt * acc);
    this.vel.x += (wish.x * top - this.vel.x) * k; this.vel.z += (wish.z * top - this.vel.z) * k;
    if (inp.jump && this.ground && this.stamina > 8 && this.crouch < 0.5) { this.vel.y = 7.0; this.ground = false; this.stamina -= 8; this.audio.step(this.pos, 0.3); }
    inp.jump = false;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    collideCircle(this.pos, 0.32);
    const g = this.world.collideBoxes(this.pos, 0.32, this.pos.y);
    this.vel.y -= 22 * dt; this.pos.y += this.vel.y * dt;
    if (this.pos.y <= g) {
      if (!this.ground && this.vel.y < -4) { this.landT = clamp(-this.vel.y / 12, 0.3, 1); this.audio.land(this.landT * 0.8); }
      this.pos.y = g; this.vel.y = 0; this.ground = true;
    } else if (this.pos.y > g + 0.06) this.ground = false;
    // 몸 방향: 3인칭은 이동 방향, 1인칭은 시선 방향
    const tgt = fp ? camYaw + Math.PI : this.speed > 0.4 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw;
    this.yaw += wrap(tgt - this.yaw) * Math.min(1, dt * (fp ? 20 : 11));
    // 발걸음 박자
    const sp = this.speed, stride = sp > 4 ? 2.5 : this.crouch > 0.5 ? 1.0 : 1.55;
    if (this.ground) this.phase += dt * sp / stride * Math.PI * 2;
    const step = Math.floor(this.phase / Math.PI);
    if (step !== this.lastStep && this.ground && sp > 0.5) { this.audio.step({ x: this.pos.x, y: 0.05, z: this.pos.z }, sp > 4 ? 0.55 : this.crouch > 0.5 ? 0.1 : 0.3); }
    this.lastStep = step;
    this.landT = Math.max(0, this.landT - dt * 3.5);
    this.air += ((this.ground ? 0 : 1) - this.air) * Math.min(1, dt * 12);
    this.animate(dt, camYaw, camPitch);
  }

  animate(dt, camYaw, camPitch) {
    const P = this.P.clear(), φ = this.phase, t = this.t, sp = this.speed, s = Math.sin(φ), c = Math.cos(φ);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    if (this.dead) return this.deathPose(dt);
    const air = this.air, gw = 1 - air, cr = this.crouch * gw;
    const wWalk = clamp(sp / 3.1, 0, 1) * (1 - clamp((sp - 3.1) / 3, 0, 1)) * gw * (1 - cr);
    const wRun = clamp((sp - 3.1) / 3, 0, 1) * gw * (1 - cr);
    const wIdle = (1 - clamp(sp / 1.2, 0, 1)) * gw * (1 - cr);
    // 대기: 숨쉬기, 살짝 흔들림
    if (wIdle > 0.01) {
      const br = Math.sin(t * 1.7);
      P.rot('spine', 0.02 * br, 0, 0.015 * Math.sin(t * 0.5), wIdle).rot('chest', 0.025 * br, 0, 0, wIdle);
      P.rot('armL', 0.04 * br, 0, 0.07, wIdle).rot('armR', 0.04 * br, 0, -0.07, wIdle).rot('foreL', -0.15, 0, 0, wIdle).rot('foreR', -0.15, 0, 0, wIdle);
      P.rot('legL', 0, 0.05, 0.03, wIdle).rot('legR', 0, -0.05, -0.03, wIdle).val('hipY', -0.01 + 0.006 * br, wIdle);
    }
    if (wWalk > 0.01) {
      const w = wWalk;
      P.rot('legL', -0.5 * s, 0, 0.02, w).rot('legR', 0.5 * s, 0, -0.02, w);
      const kl = 0.08 + 0.75 * Math.pow(Math.max(0, c), 1.5), kr = 0.08 + 0.75 * Math.pow(Math.max(0, -c), 1.5);
      P.rot('shinL', kl, 0, 0, w).rot('shinR', kr, 0, 0, w);
      P.rot('footL', 0.5 * s - kl * 0.4 + 0.1, 0, 0, w).rot('footR', -0.5 * s - kr * 0.4 + 0.1, 0, 0, w);
      P.rot('armL', 0.4 * s, 0, 0.08, w).rot('armR', -0.4 * s, 0, -0.08, w);
      P.rot('foreL', -0.25 - 0.25 * Math.max(0, -s), 0, 0, w).rot('foreR', -0.25 - 0.25 * Math.max(0, s), 0, 0, w);
      P.rot('hips', 0, 0.12 * s, 0.04 * c, w).rot('spine', 0.06, -0.06 * s, 0, w).rot('chest', 0, -0.1 * s, -0.03 * c, w).rot('head', -0.04, 0.04 * s, 0, w);
      P.val('hipY', -0.045 * Math.abs(s), w);
    }
    if (wRun > 0.01) {
      const w = wRun, kl = 0.3 + 1.45 * Math.pow(0.5 + 0.5 * Math.cos(φ - 0.5), 2), kr = 0.3 + 1.45 * Math.pow(0.5 - 0.5 * Math.cos(φ - 0.5), 2);
      P.rot('legL', -0.9 * s - 0.25, 0, 0.03, w).rot('legR', 0.9 * s - 0.25, 0, -0.03, w);
      P.rot('shinL', kl, 0, 0, w).rot('shinR', kr, 0, 0, w);
      P.rot('footL', 0.35 * s - 0.2, 0, 0, w).rot('footR', -0.35 * s - 0.2, 0, 0, w);
      P.rot('armL', 0.95 * s, 0, 0.12, w).rot('armR', -0.95 * s, 0, -0.12, w);
      P.rot('foreL', -1.45 - 0.25 * s, 0, 0, w).rot('foreR', -1.45 + 0.25 * s, 0, 0, w);
      P.rot('hips', 0.05, 0.2 * s, 0, w).rot('spine', 0.22, -0.12 * s, 0, w).rot('chest', 0.1, -0.22 * s, 0, w).rot('head', -0.22, 0.1 * s, 0, w);
      P.val('hipY', -0.07 + 0.06 * Math.abs(c), w).val('curlL', 0.9, w).val('curlR', 0.9, w);
    }
    if (cr > 0.01) { // 웅크리기 (+웅크려 걷기)
      const m = clamp(sp / 1.7, 0, 1), w = cr;
      P.rot('legL', -1.15 - 0.35 * s * m, 0, 0.12, w).rot('legR', -1.15 + 0.35 * s * m, 0, -0.12, w);
      P.rot('shinL', 1.95 + 0.25 * Math.max(0, c) * m, 0, 0, w).rot('shinR', 1.95 + 0.25 * Math.max(0, -c) * m, 0, 0, w);
      P.rot('footL', -0.75, 0, 0, w).rot('footR', -0.75, 0, 0, w);
      P.rot('spine', 0.4, 0, 0, w).rot('chest', 0.15, 0, 0, w).rot('head', -0.4, 0, 0, w);
      P.rot('armL', -0.5 + 0.2 * s * m, 0, 0.15, w).rot('armR', -0.5 - 0.2 * s * m, 0, -0.15, w).rot('foreL', -1.1, 0, 0, w).rot('foreR', -1.1, 0, 0, w);
      P.val('hipY', -0.42, w);
    }
    if (air > 0.01) { // 점프/낙하
      const up = this.vel.y > 0 ? 1 : 0, w = air, fl = Math.sin(t * 9) * (1 - up);
      P.rot('legL', -0.95 * up - 0.3, 0, 0.08, w).rot('shinL', 1.3 * up + 0.4, 0, 0, w).rot('legR', -0.2 * up + 0.15, 0, -0.08, w).rot('shinR', 0.5 * up + 0.3, 0, 0, w);
      P.rot('armL', -0.6 * up - 0.3 + 0.2 * fl, 0, 0.6 + 0.4 * (1 - up), w).rot('armR', -0.6 * up - 0.3 - 0.2 * fl, 0, -0.6 - 0.4 * (1 - up), w);
      P.rot('foreL', -0.6, 0, 0, w).rot('foreR', -0.6, 0, 0, w).rot('spine', 0.1 * up - 0.05, 0, 0, w).rot('head', -0.1, 0, 0, w);
    }
    if (this.landT > 0) { const l = this.landT; P.rot('legL', -0.55 * l).rot('legR', -0.55 * l).rot('shinL', 1.0 * l).rot('shinR', 1.0 * l).rot('footL', -0.45 * l).rot('footR', -0.45 * l).rot('spine', 0.3 * l).val('hipY', -0.2 * l); }
    // 시선: 머리/가슴이 카메라 방향을 따라 돈다
    const look = clamp(wrap(camYaw + Math.PI - this.yaw), -1.3, 1.3);
    P.rot('head', -camPitch * 0.45, look * 0.6, 0).rot('chest', 0, look * 0.25, 0).rot('neck', -camPitch * 0.2, look * 0.15, 0);
    P.val('curlL', 0.35).val('curlR', 0.35);
    applyPose(this.rig, P, dt, 16);
  }

  deathPose(dt) {
    const k = clamp(this.deathT / 0.7, 0, 1), e = k * k, P = this.P;
    P.rot('legL', -0.4, 0, 0.3).rot('legR', -0.2, 0, -0.2).rot('shinL', 0.9).rot('shinR', 0.5).rot('armL', -0.5, 0, 1.3).rot('armR', -0.3, 0, -1.1).rot('foreL', -0.5).rot('foreR', -0.8).rot('head', -0.5, 0.6, 0).rot('spine', -0.2);
    P.val('hipY', -0.6 * e).val('curlL', 0.5).val('curlR', 0.6);
    this.root.rotation.x = -1.35 * e;
    applyPose(this.rig, P, dt, 8);
  }
  die() { if (this.dead) return; this.dead = true; this.deathT = 0; this.vel.set(0, 0, 0); this.rig.bones.head.visible = true; }
}
