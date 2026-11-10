// 플레이어: D계급(기본) 또는 SCP 아바타를 조종. 이동/점프/달리기/웅크리기/능력 + 애니메이션
import * as THREE from 'three';
import { buildHumanoid, Pose, applyPose, locomotion } from './rig.js';
import { collideCircle, W, H, CELL } from './map.js';

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

export function buildDClass() {
  const suit = new THREE.MeshStandardMaterial({ map: suitTex(), roughness: 0.85 });
  const skin = new THREE.MeshPhysicalMaterial({ color: 0xc98d6c, roughness: 0.6, sheen: 0.3, sheenColor: new THREE.Color(0xff9c80) });
  const rig = buildHumanoid({
    kind: 'dclass', skin, cloth: suit, cloth2: suit, sleeve: suit, pants: suit,
    shoe: new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.5 }),
    hairMat: new THREE.MeshStandardMaterial({ color: 0x241a14, roughness: 0.95 }),
    hipH: 0.95, thigh: 0.44, shin: 0.43, ankleH: 0.08, spine: 0.2, chest: 0.3, neck: 0.08, headS: [0.093, 0.115, 0.105],
    upper: 0.3, fore: 0.27, palmL: 0.085, fingerL: 0.075, fingerR: 0.0095, shoulderW: 0.195, hipW: 0.095,
    chestR: 0.165, waist: 0.135, depth: 0.66, pelvis: [0.165, 0.11, 0.12], armR: 0.047, legR: 0.078, neckR: 0.052, footL: 0.26,
  });
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.05), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
  tag.position.set(0.07, 0.22, 0.118); rig.bones.chest.add(tag);
  return rig;
}

export class Player {
  // av: SCP 아바타(creatures.js / SCP096.asAvatar) — 없으면 D계급
  constructor(scene, world, audio, spawn, av = null) {
    this.world = world; this.audio = audio; this.av = av;
    this.rig = av ? av.rig || null : buildDClass();
    this.root = av ? av.root : this.rig.root;
    if (!this.root.parent) scene.add(this.root);
    if (av?.extra) scene.add(av.extra);
    this.ws = av?.walk ?? 3.1; this.rs = av?.run ?? 6.4; this.jv = av?.jump ?? 7; this.r = av?.radius ?? 0.32;
    this.camH = av?.camH ?? 1.62; this.camDist = av?.camDist ?? 3.0;
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z); this.vel = new THREE.Vector3();
    this.yaw = 0; this.ground = true; this.stamina = 100; this.exhausted = false;
    this.phase = 0; this.crouch = 0; this.air = 0; this.landT = 0; this.t = 0; this.dead = false; this.deathT = 0; this.act = -1;
    this.hasCard = false; this.P = new Pose(); this.lastStep = 0;
  }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get tired() { return clamp(1 - this.stamina / 55, 0, 1); }
  get headObj() { return this.av ? this.av.head : this.rig.bones.head; }
  setHeadVisible(v) { if (this.headObj) this.headObj.visible = v; }
  eyePos(v) { if (this.headObj) { this.headObj.getWorldPosition(v); v.y += 0.08; } else v.set(this.pos.x, this.pos.y + this.camH * 0.85, this.pos.z); return v; }
  chestPos(v) { if (this.rig) { this.rig.bones.chest.getWorldPosition(v); v.y += 0.15; } else v.set(this.pos.x, this.pos.y + this.camH * 0.7, this.pos.z); return v; }

  update(dt, inp, camYaw, camPitch, fp) {
    this.t += dt;
    if (this.dead) { this.deathT += dt; this.animate(dt, camYaw, camPitch); return; }
    const av = this.av, fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw)), right = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));
    const wish = fwd.multiplyScalar(inp.f - inp.b).add(right.multiplyScalar(inp.r - inp.l));
    const moving = wish.lengthSq() > 0.01; if (moving) wish.normalize();
    const canCrouch = !av || av.rig;
    this.crouch += ((inp.crouch && canCrouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    const running = inp.run && moving && !this.exhausted && this.crouch < 0.5;
    const top = this.crouch > 0.5 ? 1.7 : running ? this.rs : this.ws;
    // 스태미나 (SCP 는 지치지 않음)
    if (!av) { if (running && this.speed > 4) this.stamina -= dt * 17; else this.stamina += dt * (moving ? 9 : 15); }
    this.stamina = clamp(this.stamina, 0, 100);
    if (this.stamina <= 0) this.exhausted = true; if (this.exhausted && this.stamina > 35) this.exhausted = false;
    const acc = this.ground ? (av?.statue ? 30 : 14) : 2.5, k = Math.min(1, dt * acc);
    this.vel.x += (wish.x * top - this.vel.x) * k; this.vel.z += (wish.z * top - this.vel.z) * k;
    if (inp.jump && this.ground && this.jv > 0 && this.stamina > 8 && this.crouch < 0.5) { this.vel.y = this.jv; this.ground = false; if (!av) this.stamina -= 8; this.audio.step(this.pos, 0.3); }
    inp.jump = false;
    if (inp.ability) { inp.ability = false; if (av && (this.act < 0 || this.act > 2)) { this.act = 0; av.ability ? av.ability(this, this.audio) : this.audio.sfx(av.id, this.pos); } }
    if (this.act >= 0) { this.act += dt; if (this.act > 3) this.act = -1; }
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (av?.phase) { this.pos.x = clamp(this.pos.x, CELL + this.r, (W - 1) * CELL - this.r); this.pos.z = clamp(this.pos.z, CELL + this.r, (H - 1) * CELL - this.r); } // 106: 벽 통과
    else collideCircle(this.pos, this.r);
    const g = av?.phase ? 0 : this.world.collideBoxes(this.pos, this.r, this.pos.y);
    this.vel.y -= 22 * dt; this.pos.y += this.vel.y * dt;
    if (this.pos.y <= g) {
      if (!this.ground && this.vel.y < -4) { this.landT = clamp(-this.vel.y / 12, 0.3, 1); this.audio.land(this.landT * (av?.heavy ? 1.2 : 0.8)); }
      this.pos.y = g; this.vel.y = 0; this.ground = true;
    } else if (this.pos.y > g + 0.06) this.ground = false;
    const tgt = fp ? camYaw + Math.PI : this.speed > 0.4 ? Math.atan2(this.vel.x, this.vel.z) : this.yaw;
    this.yaw += wrap(tgt - this.yaw) * Math.min(1, dt * (fp ? 20 : 11));
    const sp = this.speed, stride = av ? (sp > this.ws * 1.3 ? 2.2 + this.r * 2.5 : 1.0 + this.r * 1.8) : sp > 4 ? 2.5 : this.crouch > 0.5 ? 1.0 : 1.55;
    if (this.ground) this.phase += dt * sp / stride * Math.PI * 2;
    const step = Math.floor(this.phase / Math.PI);
    if (step !== this.lastStep && this.ground && sp > 0.5) {
      const p = { x: this.pos.x, y: 0.05, z: this.pos.z };
      av?.onStep?.(p);
      if (av?.id === '999') this.audio.sfx('squish', p);
      else if (av?.statue) this.audio.sfx('scrape', p);
      else this.audio.step(p, av?.heavy ? 0.8 : sp > 4 ? 0.55 : this.crouch > 0.5 ? 0.1 : 0.3, !!av?.heavy);
    }
    this.lastStep = step;
    this.landT = Math.max(0, this.landT - dt * 3.5);
    this.air += ((this.ground ? 0 : 1) - this.air) * Math.min(1, dt * 12);
    this.animate(dt, camYaw, camPitch);
  }

  animate(dt, camYaw, camPitch) {
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    const s = { pos: this.pos, yaw: this.yaw, speed: this.speed, phase: this.phase, air: this.air, vy: this.vel.y, crouch: this.crouch, landT: this.landT, t: this.t, act: this.act };
    if (this.av) return this.av.animate(dt, s);
    if (this.dead) return this.deathPose(dt);
    const P = this.P.clear();
    locomotion(P, s);
    // 시선: 머리/가슴이 카메라 방향을 따라 돈다
    const look = clamp(wrap(camYaw + Math.PI - this.yaw), -1.3, 1.3);
    P.rot('head', -camPitch * 0.45, look * 0.6, 0).rot('chest', 0, look * 0.25, 0).rot('neck', -camPitch * 0.2, look * 0.15, 0);
    P.val('curlL', 0.35).val('curlR', 0.35);
    applyPose(this.rig, P, dt, 16);
  }

  deathPose(dt) {
    const k = clamp(this.deathT / 0.7, 0, 1), e = k * k, P = this.P.clear();
    P.rot('legL', -0.4, 0, 0.3).rot('legR', -0.2, 0, -0.2).rot('shinL', 0.9).rot('shinR', 0.5).rot('armL', -0.5, 0, 1.3).rot('armR', -0.3, 0, -1.1).rot('foreL', -0.5).rot('foreR', -0.8).rot('head', -0.5, 0.6, 0).rot('spine', -0.2);
    P.val('hipY', -0.6 * e).val('curlL', 0.5).val('curlR', 0.6);
    this.root.rotation.x = -1.35 * e;
    applyPose(this.rig, P, dt, 8);
  }
  die() { if (this.dead || this.av) return; this.dead = true; this.deathT = 0; this.vel.set(0, 0, 0); this.setHeadVisible(true); }
}
