// 적 병사: 절차적 모델 + IK 로 총 파지 + 인지/추적/교전/엄폐 AI + 부위별 히트박스 + 사망 낙하
import * as THREE from 'three';
import { T } from './textures.js';
import { GUN_BUILDERS } from './guns.js';
import { patchInterior } from './world.js';
import { Audio } from './audio.js';
import { clamp, lerp, damp, rand, gauss, pick, raySphere, solveIK, placeBetween, Spring3 } from './core.js';

let BM = null;
function botMats() {
  if (BM) return BM;
  const std = (o) => patchInterior(new THREE.MeshStandardMaterial(o));
  BM = {
    camo: std({ map: T.camo.map, normalMap: T.camo.normalMap, roughness: 1, roughnessMap: T.camo.roughnessMap }),
    vest: std({ color: 0x4d4c38, normalMap: T.fabric.normalMap, roughness: 0.95 }),
    pouch: std({ color: 0x57553e, normalMap: T.fabric.normalMap, roughness: 0.95 }),
    helmet: std({ color: 0x4a5138, normalMap: T.stipple.normalMap, roughness: 0.8 }),
    knit: std({ color: 0x3b3a30, normalMap: T.fabric.normalMap, roughness: 1 }),
    skin: std({ map: T.skin.map, normalMap: T.skin.normalMap, roughness: 0.65 }),
    lens: std({ color: 0x1a1208, roughness: 0.05, metalness: 1, envMapIntensity: 2 }),
    boot: std({ color: 0x2a241c, normalMap: T.leather.normalMap, roughness: 0.8 }),
    glove: std({ color: 0x22211e, normalMap: T.leather.normalMap, roughness: 0.8 }),
    strap: std({ color: 0x1b1b18, roughness: 0.9 }),
  };
  return BM;
}

// 무기 프로토타입 (지오메트리 공유)
const GUN_PROTO = {};
function botGun(type) {
  if (!GUN_PROTO[type]) GUN_PROTO[type] = GUN_BUILDERS[type]();
  const p = GUN_PROTO[type], g = p.group.clone(true);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; if (o.material.isShaderMaterial || o.material.transparent) o.visible = false; if (!o.material.userData.patched) { patchInterior(o.material); o.material.userData.patched = true; } } });
  const muzzle = new THREE.Object3D(); muzzle.position.copy(p.muzzle.position); g.add(muzzle);
  return { group: g, grip: g.getObjectByName('grip'), fore: g.getObjectByName('fore'), muzzle };
}

function limb(parent, mat, r, len, y0 = 0) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), mat);
  m.position.y = y0 - len / 2; m.castShadow = true; parent.add(m);
  return m;
}

function buildSoldier(gunType) {
  const M = botMats();
  const root = new THREE.Group();
  const J = {};
  const grp = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  J.pelvis = grp(root, 0, 0.98, 0);
  const pel = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.14, 4, 10), M.camo); pel.rotation.z = Math.PI / 2; pel.scale.set(1, 1, 1.05); pel.castShadow = true; J.pelvis.add(pel);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.24), M.strap); belt.position.y = 0.08; J.pelvis.add(belt);
  J.spine = grp(J.pelvis, 0, 0.1, 0);
  J.chest = grp(J.spine, 0, 0.18, 0);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.26, 4, 10), M.camo); torso.scale.set(1.18, 1, 0.78); torso.position.y = 0.05; torso.castShadow = true; J.chest.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.3), M.vest); vest.position.set(0, 0.08, 0); vest.castShadow = true; J.chest.add(vest);
  for (const x of [-0.12, 0, 0.12]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.06), M.pouch); p.position.set(x, -0.02, 0.17); p.castShadow = true; J.chest.add(p); }
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.14), M.pouch); pack.position.set(0, 0.1, -0.21); pack.castShadow = true; J.chest.add(pack);
  const radio = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.05), M.strap); radio.position.set(0.14, 0.26, -0.2); J.chest.add(radio);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3), M.strap); ant.position.set(0.14, 0.48, -0.2); J.chest.add(ant);
  for (const sx of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), M.camo); d.position.set(sx * 0.2, 0.24, 0); d.scale.set(1, 0.9, 1); d.castShadow = true; J.chest.add(d);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.32), M.vest); st.position.set(sx * 0.12, 0.28, 0); J.chest.add(st);
    const mp = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.18, 0.045), M.pouch); mp.position.set(sx * 0.11, -0.04, 0.2); mp.rotation.x = 0.05; J.chest.add(mp);
  }
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.12, 10), M.knit); neck.position.y = 0.3; J.chest.add(neck);
  J.neck = grp(J.chest, 0, 0.32, 0.01);
  J.head = grp(J.neck, 0, 0.1, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), M.knit); head.scale.set(0.92, 1.08, 1); head.castShadow = true; J.head.add(head);
  const hel = new THREE.Mesh(new THREE.SphereGeometry(0.128, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), M.helmet); hel.position.set(0, 0.025, -0.005); hel.castShadow = true; J.head.add(hel);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.126, 0.008, 6, 20), M.helmet); rim.rotation.x = Math.PI / 2; rim.position.y = 0.02; J.head.add(rim);
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10, -0.9, 1.8, 1.0, 0.75), M.skin); face.position.set(0, 0.005, 0.018); J.head.add(face);
  const gog = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.042, 0.035), M.lens); gog.position.set(0, 0.03, 0.093); J.head.add(gog);
  const gf = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.02), M.strap); gf.position.set(0, 0.03, 0.08); J.head.add(gf);
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.006, 4, 20), M.strap); strap.rotation.x = Math.PI / 2; strap.position.y = 0.02; J.head.add(strap);
  const nvg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.03), M.strap); nvg.position.set(0, 0.1, 0.11); J.head.add(nvg);
  // 다리
  for (const s of [1, -1]) {
    const k = s > 0 ? 'L' : 'R';
    J['hip' + k] = grp(J.pelvis, s * 0.1, -0.06, 0);
    limb(J['hip' + k], M.camo, 0.085, 0.32, -0.03);
    J['knee' + k] = grp(J['hip' + k], 0, -0.44, 0);
    const kp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.05), M.strap); kp.position.set(0, 0, 0.07); J['knee' + k].add(kp);
    limb(J['knee' + k], M.camo, 0.066, 0.33, -0.02);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.072, 0.07, 10), M.camo); cuff.position.y = -0.36; J['knee' + k].add(cuff);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.27), M.boot); boot.position.set(0, -0.45, 0.05); boot.castShadow = true; J['knee' + k].add(boot);
  }
  // 팔 (IK 로 배치)
  const arm = () => {
    const u = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 1, 4, 8), M.camo);
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 1, 4, 8), M.camo);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.1), M.glove);
    [u, f, h].forEach((m) => { m.castShadow = true; J.chest.add(m); });
    return { u, f, h, S: new THREE.Vector3(), E: new THREE.Vector3(), W: new THREE.Vector3() };
  };
  J.armR = arm(); J.armL = arm();
  const gun = botGun(gunType);
  gun.group.rotation.y = Math.PI;
  gun.group.position.set(-0.1, 0.16, 0.34);
  J.chest.add(gun.group);
  root.traverse((o) => { if (o.isMesh) o.receiveShadow = false; });
  return { root, J, gun };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _up = new THREE.Vector3(0, 1, 0);
const CAPS = [[0, 0, 0], [0, 0, 0]];

class Bot {
  constructor(mgr, pos, gunType, wave) {
    this.mgr = mgr; this.g = mgr.g;
    const s = buildSoldier(gunType);
    Object.assign(this, s);
    this.gunType = gunType;
    this.pos = pos.clone(); this.vel = new THREE.Vector3();
    this.yaw = rand(0, Math.PI * 2); this.pitch = 0;
    this.hp = 100; this.alive = true;
    this.state = 'hunt'; this.path = null; this.pathT = 0; this.pi = 0;
    this.seeT = 0; this.lostT = 99; this.sense = rand(0, 0.2);
    this.last = new THREE.Vector3();
    this.burst = 0; this.fireT = rand(0.5, 1.5); this.mag = 30; this.reloadT = 0;
    this.strafe = 0; this.strafeT = 0; this.crouch = 0; this.wantCrouch = false;
    this.phase = 0; this.flinch = new Spring3(160, 14);
    this.wave = wave;
    this.skill = clamp(0.55 + wave * 0.05, 0.55, 1.0) * mgr.difficulty;
    this.coverT = 0; this.hitT = 99;
    this.spheres = Array.from({ length: 18 }, () => ({ c: new THREE.Vector3(), r: 0.1, zone: 'torso' }));
    this.root.position.copy(this.pos);
    this.g.scene.add(this.root);
    this.stepAcc = 0;
    this.st = { grounded: true, canStep: true };
  }

  eye() { return _a.set(this.pos.x, this.pos.y + lerp(1.62, 1.1, this.crouch), this.pos.z); }

  update(dt) {
    if (!this.alive) { this.updateDead(dt); return; }
    const g = this.g, P = g.player, w = g.world;
    const peace = g.mode === 'training';
    // ── 인지 ──
    this.sense -= dt;
    const pe = P.eye, me = this.eye().clone();
    const toP = _b.copy(pe).sub(me), dist = toP.length();
    if (this.sense <= 0) {
      this.sense = 0.18;
      const fwd = _c.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const inFov = toP.clone().normalize().dot(fwd) > Math.cos(1.25) || this.alerted;
      const vis = P.alive && dist < 95 && inFov && w.los(me, pe);
      this.canSee = vis && !peace;
      if (vis) { this.last.copy(P.pos); this.alerted = true; }
    }
    if (this.canSee) { this.seeT += dt; this.lostT = 0; } else { this.seeT = Math.max(0, this.seeT - dt * 2); this.lostT += dt; }
    this.hitT += dt;
    // ── 상태 결정 ──
    let moveTarget = null, speed = 0;
    if (peace) {
      if (!this.path || this.pi >= this.path.length) { const t = new THREE.Vector3(rand(-60, 60), 0, rand(-60, 60)); this.path = w.findPath(this.pos, t); this.pi = 0; }
      speed = 1.6;
    } else if (this.state === 'cover') {
      this.coverT -= dt;
      if (this.coverSpot && this.pos.distanceTo(this.coverSpot) > 0.8) { moveTarget = this.coverSpot; speed = 4.2; }
      else { this.wantCrouch = true; if (this.coverT <= 0) { this.state = 'hunt'; this.wantCrouch = false; } }
    } else if (this.canSee && dist < 80) {
      this.state = 'engage';
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(0.8, 2.2); this.strafe = pick([-1, 0, 1, 1, -1]); this.wantCrouch = dist > 14 && Math.random() < 0.35; }
      if (this.hp < 55 && this.hitT < 1 && Math.random() < 0.02) this.findCover();
      if (dist > 45) { moveTarget = P.pos; speed = 2.2; }
    } else {
      this.state = 'hunt';
      if (this.lostT > 0.6 || !this.canSee) { moveTarget = this.alerted ? this.last : P.pos; speed = this.lostT > 6 ? 2.4 : 4.0; this.wantCrouch = false; }
    }
    // ── 경로 추종 ──
    this.pathT -= dt;
    let desired = _c.set(0, 0, 0);
    if (moveTarget && (this.pathT <= 0 || !this.path)) {
      this.pathT = rand(1.2, 2.0);
      this.path = w.findPath(this.pos, moveTarget); this.pi = 0;
    }
    if ((moveTarget || peace) && this.path && this.pi < this.path.length) {
      const wp = this.path[this.pi];
      const d = _a.set(wp.x - this.pos.x, 0, wp.z - this.pos.z);
      if (d.length() < 0.6) this.pi++;
      else desired.copy(d.normalize()).multiplyScalar(speed);
      if (!peace && moveTarget && this.pos.distanceTo(moveTarget) < 2.5 && !this.canSee) { this.alerted = false; this.path = null; }
    }
    if (this.state === 'engage' && this.strafe) {
      const side = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(this.strafe * 1.9);
      desired.add(side);
    }
    if (this.crouch > 0.5) desired.multiplyScalar(0.45);
    // 봇 간 분리
    for (const o of this.mgr.list) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, dd = dx * dx + dz * dz;
      if (dd < 1.0 && dd > 1e-4) { const k = (1 - Math.sqrt(dd)) * 3; desired.x += dx * k; desired.z += dz * k; }
    }
    this.vel.x = damp(this.vel.x, desired.x, 8, dt); this.vel.z = damp(this.vel.z, desired.z, 8, dt);
    this.vel.y -= 16 * dt;
    this.st.canStep = true;
    w.move(this.pos, this.vel, dt, 0.3, 1.75, this.st);
    this.crouch = damp(this.crouch, this.wantCrouch ? 1 : 0, 6, dt);
    // ── 방향 ──
    let tgtYaw = this.yaw, tgtPitch = 0;
    if (this.state === 'engage' || (this.canSee && !peace)) {
      tgtYaw = Math.atan2(pe.x - this.pos.x, pe.z - this.pos.z);
      tgtPitch = Math.atan2(pe.y - 0.35 - me.y, Math.hypot(pe.x - this.pos.x, pe.z - this.pos.z));
    } else if (this.vel.lengthSq() > 0.3) tgtYaw = Math.atan2(this.vel.x, this.vel.z);
    let dy = tgtYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += clamp(dy, -6 * dt, 6 * dt);
    this.pitch = damp(this.pitch, tgtPitch, 8, dt);
    // ── 사격 ──
    if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) this.mag = 30; }
    else if (this.state === 'engage' && this.canSee && Math.abs(dy) < 0.25 && P.alive) {
      const react = lerp(0.9, 0.35, this.skill);
      this.fireT -= dt;
      if (this.seeT > react && this.fireT <= 0) {
        if (this.burst <= 0) this.burst = (rand(2, 5) + (dist < 15 ? 3 : 0)) | 0;
        this.shoot(dist);
        this.burst--;
        this.fireT = this.burst > 0 ? 0.1 + rand(0, 0.03) : rand(0.45, 1.3) * lerp(1.3, 0.8, this.skill);
        if (this.mag <= 0) { this.reloadT = 2.6; Audio.play3D('magout', this.pos, { vol: 0.5, ref: 3 }); setTimeout(() => Audio.play3D('magin', this.pos, { vol: 0.5, ref: 3 }), 1800); }
      }
    }
    this.animate(dt);
  }

  shoot(dist) {
    const g = this.g, P = g.player;
    this.mag--;
    this.root.updateMatrixWorld(true);
    const mz = this.gun.muzzle.getWorldPosition(new THREE.Vector3());
    const tgt = P.eye.clone(); tgt.y -= P.crouching ? 0.2 : rand(0.15, 0.55);
    const dir = tgt.sub(mz).normalize();
    let err = 0.036 * (1 + dist / 35) * lerp(1.6, 0.7, this.skill);
    if (P.hSpeed() > 3) err *= 1.5;
    if (this.seeT < 1.2) err *= 1.6;
    if (g.suppressLevel > 0.5) err *= 1;
    const r = new THREE.Vector3(gauss(), gauss(), gauss()).multiplyScalar(err);
    dir.add(r).normalize();
    const dmg = lerp(10, 17, clamp(this.wave / 10, 0, 1)) * g.dmgScale;
    g.ballistics.fire({ origin: mz, dir, speed: 715, dmg, owner: 'bot', bot: this, tracer: Math.random() < 0.35, from: null, def: { range: [60, 200, 0.7] } });
    Audio.play3D(this.gunType === 'ak' ? 'ak' : 'm4', mz, { vol: 1.6, ref: 8 });
    g.fx.flashLight(mz, 35, 0.05, 10);
    g.fx.muzzle(mz, dir, { id: 'bot' });
    this.flinch.impulse(-1.5, 0, 0);
  }

  findCover() {
    const w = this.g.world, pe = this.g.player.eye;
    let best = null, bd = 1e9;
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(2, 11);
      const x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
      const [cx, cz] = w.cellOf(x, z);
      if (!w.free(cx, cz)) continue;
      const p = new THREE.Vector3(cx - 70 + 0.5, 1.0, cz - 70 + 0.5);
      if (w.los(p, pe)) continue;
      const d = p.distanceTo(this.pos);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) { best.y = 0; this.coverSpot = best; this.state = 'cover'; this.coverT = rand(2, 4); this.path = null; this.pathT = 0; }
  }

  damage(dmg, zone, dir, point) {
    if (!this.alive) return false;
    this.hp -= dmg; this.hitT = 0;
    this.alerted = true; this.last.copy(this.g.player.pos);
    this.flinch.impulse(zone === 'head' ? -6 : -3, gauss() * 3, gauss() * 4);
    if (this.state !== 'cover' && this.hp > 0 && this.hp < 60 && Math.random() < 0.5) this.findCover();
    if (this.hp <= 0) { this.die(dir, zone); return true; }
    return false;
  }

  die(dir, zone) {
    this.alive = false; this.deadT = 0;
    this.fallDir = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    if (this.fallDir.lengthSq() < 0.5) this.fallDir.set(0, 0, 1);
    this.fallAng = 0; this.fallW = zone === 'head' ? 1.5 : 0.6;
    // 벽이 뒤에 있으면 기대어 쓰러짐
    const hit = this.g.world.raycast(new THREE.Vector3(this.pos.x, 1.0, this.pos.z), this.fallDir, 1.8);
    this.maxAng = hit ? Math.asin(clamp(hit.t / 1.75, 0.2, 1)) : Math.PI / 2 - 0.04;
    this.crumple = Math.random() < 0.4;
    // 무기 떨어뜨림
    const gg = this.gun.group;
    gg.updateMatrixWorld(true);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    gg.matrixWorld.decompose(p, q, s);
    this.J.chest.remove(gg); gg.position.copy(p); gg.quaternion.copy(q);
    this.g.scene.add(gg);
    this.dropGun = { v: this.fallDir.clone().multiplyScalar(1.2).add(new THREE.Vector3(0, 1, 0)), w: new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(-3, 3)), rest: false };
    this.yawQ = new THREE.Quaternion().setFromAxisAngle(_up, this.yaw);
  }

  updateDead(dt) {
    this.deadT += dt;
    // 진자 낙하
    if (this.fallAng < this.maxAng) {
      this.fallW += (9.8 / 1.1) * Math.sin(Math.max(0.05, this.fallAng)) * dt * (this.crumple ? 0.6 : 1);
      this.fallAng += this.fallW * dt;
      if (this.fallAng >= this.maxAng) { this.fallAng = this.maxAng; this.fallW *= -0.15; if (this.maxAng > 1.2) Audio.play3D('land', this.pos, { vol: 0.8, ref: 4 }); }
    } else if (this.fallW < 0) { this.fallAng += this.fallW * dt; this.fallW += 6 * dt; if (this.fallAng >= this.maxAng) this.fallW = 0; }
    const axis = new THREE.Vector3().crossVectors(_up, this.fallDir).normalize();
    const k = clamp(this.deadT / 0.7, 0, 1);
    this.root.quaternion.setFromAxisAngle(axis, this.fallAng * (this.crumple ? 0.95 : 1)).multiply(this.yawQ);
    this.root.position.copy(this.pos);
    const J = this.J;
    if (this.crumple) { J.pelvis.position.y = lerp(0.98, 0.55, k); }
    J.kneeL.rotation.x = lerp(J.kneeL.rotation.x, this.crumple ? 1.4 : 0.35, k); J.kneeR.rotation.x = lerp(J.kneeR.rotation.x, this.crumple ? 1.2 : 0.2, k);
    J.hipL.rotation.x = lerp(J.hipL.rotation.x, this.crumple ? -0.9 : -0.2, k);
    J.neck.rotation.x = lerp(0, 0.5, k); J.spine.rotation.x = lerp(0, this.crumple ? 0.5 : -0.2, k);
    // 팔 늘어뜨림
    for (const [a, sx] of [[J.armR, -1], [J.armL, 1]]) {
      const S = new THREE.Vector3(sx * 0.21, 0.24, 0), E = new THREE.Vector3(sx * 0.3, 0.0, 0.05 + k * 0.1), W = new THREE.Vector3(sx * 0.32, -0.25, 0.12 + k * 0.1);
      placeBetween(a.u, S, E, 1); a.u.scale.y = 1 / 3.5; placeBetween(a.f, E, W, 1); a.f.scale.y = 1 / 3.8;
      a.h.position.copy(W);
    }
    // 떨어진 총
    const gg = this.gun.group, dg = this.dropGun;
    if (dg && !dg.rest) {
      dg.v.y -= 9.8 * dt; gg.position.addScaledVector(dg.v, dt);
      gg.rotation.x += dg.w.x * dt; gg.rotation.z += dg.w.z * dt;
      const f = this.g.world.floorAt(gg.position.x, gg.position.z, gg.position.y + 0.3);
      if (gg.position.y < f.y + 0.04) { gg.position.y = f.y + 0.04; dg.v.multiplyScalar(-0.2); dg.w.multiplyScalar(0.3); if (dg.v.length() < 0.3) { dg.rest = true; gg.rotation.set(0, gg.rotation.y, Math.PI / 2); Audio.play3D('hitMetal', gg.position, { vol: 0.3, ref: 3 }); } }
    }
    if (this.deadT > 25) { this.root.position.y -= dt * 0.2; if (this.deadT > 30) this.remove(); }
  }

  remove() { this.g.scene.remove(this.root); this.g.scene.remove(this.gun.group); this.removed = true; }

  animate(dt) {
    const J = this.J, sp = Math.hypot(this.vel.x, this.vel.z);
    this.root.position.copy(this.pos);
    this.root.rotation.set(0, this.yaw, 0);
    this.phase += sp * dt * 2.6;
    const amp = clamp(sp / 3.5, 0, 1) * (1 - this.crouch * 0.6);
    // 이동 방향 (로컬)
    const lx = Math.cos(this.yaw) * this.vel.x - Math.sin(this.yaw) * this.vel.z, lz = Math.sin(this.yaw) * this.vel.x + Math.cos(this.yaw) * this.vel.z;
    const fwdK = sp > 0.1 ? lz / sp : 1, sideK = sp > 0.1 ? lx / sp : 0;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const cr = this.crouch;
    J.pelvis.position.y = lerp(0.98, 0.62, cr) + Math.abs(c) * 0.035 * amp;
    J.hipL.rotation.x = lerp(-s * 0.55 * amp * fwdK, -1.15, cr); J.hipR.rotation.x = lerp(s * 0.55 * amp * fwdK, -1.0, cr);
    J.hipL.rotation.z = -s * 0.3 * amp * sideK; J.hipR.rotation.z = s * 0.3 * amp * sideK;
    J.kneeL.rotation.x = lerp(Math.max(0, -c) * 0.9 * amp + 0.05, 1.9, cr); J.kneeR.rotation.x = lerp(Math.max(0, c) * 0.9 * amp + 0.05, 1.5, cr);
    const f = this.flinch.update(dt);
    J.spine.rotation.set(0.08 * amp + f.x * 0.05 + cr * 0.25, f.y * 0.05, f.z * 0.05);
    J.chest.rotation.set(-this.pitch * 0.85 - cr * 0.2, s * 0.08 * amp, 0);
    J.neck.rotation.x = -this.pitch * 0.15;
    // 발걸음
    this.stepAcc += sp * dt;
    if (this.stepAcc > 0.9 && sp > 1) {
      this.stepAcc = 0;
      const d = this.pos.distanceTo(this.g.player.pos);
      if (d < 22) Audio.play3D('stepConcrete', this.pos, { vol: sp > 3 ? 0.55 : 0.3, ref: 3, speedDelay: false });
    }
    // 팔 IK (가슴 로컬 공간)
    this.root.updateMatrixWorld(true);
    _m.copy(J.chest.matrixWorld).invert();
    for (const [a, anc, sx] of [[this.J.armR, this.gun.grip, -1], [this.J.armL, this.gun.fore, 1]]) {
      a.W.setFromMatrixPosition(anc.matrixWorld).applyMatrix4(_m);
      a.S.set(sx * 0.2, 0.24, 0);
      solveIK(a.S, a.W, 0.3, 0.28, _b.set(sx * 0.8, -1, -0.3).normalize(), a.E);
      placeBetween(a.u, a.S, a.E, 1); a.u.scale.y = a.S.distanceTo(a.E) / 1.12;
      placeBetween(a.f, a.E, a.W, 1); a.f.scale.y = a.E.distanceTo(a.W) / 1.1;
      a.h.position.copy(a.W); a.h.quaternion.copy(a.f.quaternion);
    }
  }

  // 월드 히트박스 갱신
  updateHitboxes() {
    const J = this.J, S = this.spheres;
    let i = 0;
    const put = (obj, r, zone, off) => { const s = S[i++]; obj.getWorldPosition(s.c); if (off) s.c.add(off); s.r = r; s.zone = zone; };
    const at = (v, r, zone) => { const s = S[i++]; s.c.copy(v); s.r = r; s.zone = zone; };
    put(J.head, 0.12, 'head');
    J.chest.localToWorld(_a.set(0, 0.12, 0)); at(_a, 0.21, 'torso');
    J.chest.localToWorld(_a.set(0, -0.08, 0)); at(_a, 0.2, 'torso');
    put(J.pelvis, 0.18, 'torso');
    for (const k of ['L', 'R']) {
      J['hip' + k].localToWorld(_a.set(0, -0.12, 0)); at(_a, 0.1, 'leg');
      J['hip' + k].localToWorld(_a.set(0, -0.32, 0)); at(_a, 0.09, 'leg');
      J['knee' + k].localToWorld(_a.set(0, -0.15, 0)); at(_a, 0.08, 'leg');
      J['knee' + k].localToWorld(_a.set(0, -0.36, 0)); at(_a, 0.075, 'leg');
    }
    for (const a of [J.armR, J.armL]) { a.u.getWorldPosition(_a); at(_a, 0.07, 'arm'); a.f.getWorldPosition(_a); at(_a, 0.06, 'arm'); }
    this.nS = i;
  }
}

export class Bots {
  constructor(game) { this.g = game; this.list = []; this.difficulty = 1; }

  spawn(wave) {
    const g = this.g, P = g.player;
    const cand = g.world.spawns.filter((s) => s.distanceTo(P.pos) > 30).sort(() => Math.random() - 0.5);
    const sp = cand.find((s) => !g.world.los(new THREE.Vector3(s.x, 1.6, s.z), P.eye)) || cand[0] || g.world.spawns[0];
    const p = sp.clone().add(new THREE.Vector3(rand(-2, 2), 0, rand(-2, 2)));
    const b = new Bot(this, p, Math.random() < 0.65 ? 'ak' : 'm4', wave);
    b.alerted = g.mode !== 'training'; b.last.copy(P.pos).add(new THREE.Vector3(rand(-8, 8), 0, rand(-8, 8)));
    this.list.push(b);
    return b;
  }

  alive() { return this.list.filter((b) => b.alive).length; }

  update(dt) {
    for (const b of this.list) b.update(dt);
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].removed) this.list.splice(i, 1);
    const dead = this.list.filter((b) => !b.alive);
    if (dead.length > 10) dead[0].remove();
  }

  alert(pos, radius) {
    for (const b of this.list) if (b.alive && b.pos.distanceTo(pos) < radius) { b.alerted = true; b.last.copy(this.g.player.pos); }
  }

  raycast(o, d, maxT) {
    let best = maxT, res = null;
    for (const b of this.list) {
      if (!b.alive) continue;
      _c.set(b.pos.x, b.pos.y + 1.0, b.pos.z);
      const t0 = raySphere(o, d, _c, 1.25, best + 1.25);
      if (t0 < 0 && _c.distanceTo(o) > 1.25) continue;
      b.updateHitboxes();
      for (let i = 0; i < b.nS; i++) {
        const s = b.spheres[i];
        const t = raySphere(o, d, s.c, s.r, best);
        if (t >= 0 && t < best) { best = t; res = { t, bot: b, zone: s.zone, center: s.c.clone() }; }
      }
    }
    if (res) { res.point = o.clone().addScaledVector(d, res.t); res.n = res.point.clone().sub(res.center).normalize(); }
    return res;
  }

  clear() { for (const b of this.list) b.remove(); this.list = []; }
}
