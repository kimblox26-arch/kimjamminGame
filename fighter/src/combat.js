// SKYBREAKER — 전투 시스템
// 적기 AI(순찰/공격/회피/이탈), 기관포 탄환, 유도 미사일(비례항법 + 플레어 기만), 지상 목표, 대공포.
import * as THREE from 'three';
import { JetModel, ENEMY_DESIGNS, createMissileMesh, glowTexture } from './jet.js';
import { Ribbon } from './fx.js';
import { Sfx } from './sfx.js';
import { Audio } from '../../src/core/audio.js';

const G = 9.81;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

function segSphere(a, b, c, r) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz || 1e-6;
  const t = clamp((acx * abx + acy * aby + acz * abz) / l2, 0, 1);
  const dx = a.x + abx * t - c.x, dy = a.y + aby * t - c.y, dz = a.z + abz * t - c.z;
  return dx * dx + dy * dy + dz * dz < r * r ? t : -1;
}

function rotateToward(dir, target, maxAngle) {
  const d = clamp(dir.dot(target), -1, 1);
  const ang = Math.acos(d);
  if (ang < 1e-5) return dir;
  if (ang <= maxAngle) return dir.copy(target);
  const axis = _v3.crossVectors(dir, target);
  if (axis.lengthSq() < 1e-10) axis.set(0, 1, 0); else axis.normalize();
  return dir.applyAxisAngle(axis, maxAngle).normalize();
}

/* ------------------------------------------------------------------ */
/* 적기                                                                */
/* ------------------------------------------------------------------ */
let enemySerial = 1;
class Enemy {
  constructor(c, design, pos, vel) {
    this.c = c;
    this.kind = 'air';
    this.jet = new JetModel(design);
    this.jet.setMissilesVisible(4);
    c.scene.add(this.jet.root);
    this.pos = pos.clone();
    this.vel = vel.clone();
    this.quat = new THREE.Quaternion();
    this.up = UP.clone();
    this.fwd = vel.clone().normalize();
    const hp = c.mode === 'dogfight' ? 70 + c.wave * 6 : 55;
    this.hp = this.maxHp = hp;
    this.alive = true;
    this.dead = false;
    this.remove = false;
    this.radius = Math.max(7.5, this.jet.L * 0.46);
    this.name = 'BANDIT-' + String(enemySerial++).padStart(2, '0');
    this.hostile = c.mode === 'dogfight';
    this.state = 'patrol';
    this.stateT = 0;
    this.wp = new THREE.Vector3();
    this._newWaypoint();
    this.gunCd = rand(2, 5);
    this.burst = 0;
    this.burstAcc = 0;
    this.msCd = rand(10, 20);
    this.flareCd = 0;
    this.aggr = rand(0.55, 1);
    this.ab = false;
    this.nearCd = 0;
    this.spin = new THREE.Vector3();
    this.deadT = 0;
    this.gLat = 0;
    this.ribbons = [new Ribbon(c.scene, { max: 50, width: 0.35, life: 0.9 }), new Ribbon(c.scene, { max: 50, width: 0.35, life: 0.9 })];
  }

  _newWaypoint() {
    const P = this.c.game.player;
    const base = P ? P.fm.pos : this.pos;
    const a = Math.random() * Math.PI * 2, r = rand(1200, 4200);
    this.wp.set(base.x + Math.cos(a) * r, 0, base.z + Math.sin(a) * r);
    const h = this.c.world.heightAt(this.wp.x, this.wp.z);
    this.wp.y = Math.max(h, 0) + rand(700, 2600);
  }

  setState(s) { this.state = s; this.stateT = 0; }

  onHit(dmg, cause, point) {
    if (!this.alive) return;
    this.hp -= dmg;
    if (point) this.c.fx.sparks(point, _v1.copy(point).sub(this.pos).normalize(), 6, 1.2);
    if (this.hp <= 0) { this.kill(cause); return; }
    if (this.state !== 'evade' && Math.random() < (this.hostile ? 0.25 : 0.6)) this.setState('evade');
  }

  kill(cause) {
    this.alive = false;
    this.dead = true;
    this.deadT = 0;
    this.spin.set(rand(-1.5, 1.5), rand(-0.6, 0.6), rand(-5, 5));
    for (const m of [this.jet.mats.bodyMat, this.jet.mats.surfMat]) { m.color.setScalar(0.28); m.clearcoat = 0; }
    this.c.fxp.airKill(this.pos, this.vel, 1);
    Audio.explosion(this.pos.clone(), 2.2);
    this.c.game.onKill(this, cause);
  }

  update(dt) {
    const c = this.c, P = c.game.player;
    if (this.dead) return this._updateWreck(dt);
    this.stateT += dt;
    this.gunCd -= dt; this.msCd -= dt; this.flareCd -= dt; this.nearCd -= dt;
    const fwd = this.fwd;
    const pAlive = P && P.alive;
    const toP = _v1.set(0, 0, 0);
    let dist = 1e9;
    if (pAlive) { toP.copy(P.fm.pos).sub(this.pos); dist = toP.length(); }
    const dirToP = dist < 1e8 ? _v2.copy(toP).divideScalar(dist) : _v2.copy(fwd);
    const angToP = Math.acos(clamp(fwd.dot(dirToP), -1, 1));
    const desired = new THREE.Vector3();
    let tSpeed = 215, maxG = 7;

    // 위협 감지 (플레이어 미사일 추적 중)
    const threat = c.missiles.find((m) => m.target === this && m.owner === 'player' && m.pos.distanceTo(this.pos) < 2600);
    if (threat && this.state !== 'evade') this.setState('evade');
    if (threat && this.flareCd <= 0 && Math.random() < (this.hostile ? 0.55 : 0.35)) {
      c.dropFlares(this, 4);
      this.flareCd = rand(3, 6);
    }

    switch (this.state) {
      case 'patrol': {
        desired.copy(this.wp).sub(this.pos).normalize();
        if (this.pos.distanceTo(this.wp) < 500) this._newWaypoint();
        if (pAlive && this.hostile && dist < 5200 && Math.random() < dt * 0.6 * this.aggr) this.setState('attack');
        if (pAlive && !this.hostile && dist < 1400 && Math.random() < dt * 0.5) this.setState('evade');
        if (this.stateT > 25) this._newWaypoint(), this.stateT = 0;
        break;
      }
      case 'attack': {
        if (!pAlive) { this.setState('patrol'); break; }
        const lead = _v3.copy(P.fm.pos).addScaledVector(P.fm.vel, clamp(dist / 950, 0, 1.6));
        desired.copy(lead).sub(this.pos).normalize();
        tSpeed = dist > 2500 ? 300 : 255;
        maxG = 7.5;
        if (dist < 260) this.setState('extend');
        // 기관포
        if (dist < 1150 && angToP < 0.1 && this.gunCd <= 0) { this.burst = rand(0.6, 1.1); this.gunCd = rand(2.2, 4.2); }
        // 미사일
        if (dist > 1300 && dist < 4800 && angToP < 0.42 && this.msCd <= 0 && c.countEnemyMissiles() < 2) {
          c.launchMissile('enemy', this, P);
          this.msCd = rand(16, 26);
        }
        if (this.stateT > 22) this.setState('extend');
        break;
      }
      case 'extend': {
        desired.copy(fwd).addScaledVector(dirToP, -0.6).normalize();
        desired.y = Math.max(desired.y, 0.05);
        desired.normalize();
        tSpeed = 310;
        if (this.stateT > rand(3, 5)) this.setState(this.hostile ? 'attack' : 'patrol');
        break;
      }
      case 'evade': {
        if (!this._evadeDir || this.stateT < dt * 1.5) {
          const side = Math.random() < 0.5 ? 1 : -1;
          const ref = threat ? _v3.copy(threat.pos).sub(this.pos).normalize() : dirToP;
          this._evadeDir = new THREE.Vector3().crossVectors(ref, UP).multiplyScalar(side).normalize();
          this._evadeDir.y = rand(-0.35, 0.45);
          this._evadeDir.normalize();
        }
        desired.copy(this._evadeDir);
        desired.x += Math.sin(this.stateT * 2.7) * 0.25;
        desired.normalize();
        tSpeed = 300; maxG = 9;
        if (this.stateT > rand(3.5, 5.5) && !threat) this.setState(this.hostile ? 'attack' : 'patrol');
        break;
      }
      default: break;
    }

    // 지면 회피
    const h = c.world.surfaceAt(this.pos.x, this.pos.z).height;
    const ahead = _v3.copy(this.pos).addScaledVector(this.vel, 3.5);
    const hA = c.world.surfaceAt(ahead.x, ahead.z).height;
    if (this.pos.y - h < 380 || ahead.y - hA < 300) {
      desired.y = Math.max(desired.y, 0.6);
      desired.normalize();
    }
    if (this.pos.y > 7000) desired.y = Math.min(desired.y, -0.2);

    // 운동 (리프트 벡터 기반 기동)
    const dVel = desired.multiplyScalar(tSpeed);
    const acc = dVel.sub(this.vel).multiplyScalar(1.5);
    const cap = maxG * G;
    if (acc.lengthSq() > cap * cap) acc.setLength(cap);
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.ab = tSpeed > 280;
    const nf = _v3.copy(this.vel).normalize();
    const upT = acc.clone().add(new THREE.Vector3(0, G, 0));
    upT.addScaledVector(nf, -upT.dot(nf));
    this.gLat = upT.length() / G;
    if (upT.lengthSq() < 1e-3) upT.copy(UP);
    upT.normalize();
    this.up.lerp(upT, 1 - Math.exp(-dt * 4.5));
    this.up.addScaledVector(nf, -this.up.dot(nf)).normalize();
    const pitchCmd = clamp((this.gLat - 1) / 6, -1, 1);
    const rollCmd = clamp(_v1.crossVectors(this.fwd, this.up).dot(upT) * 2, -1, 1);
    this.fwd.copy(nf);
    const right = _v1.crossVectors(nf, this.up).normalize();
    _m4.makeBasis(right, this.up, _v2.copy(nf).negate());
    this.quat.setFromRotationMatrix(_m4);

    // 기관포 사격
    if (this.burst > 0 && pAlive) {
      this.burst -= dt;
      this.burstAcc += dt * 22;
      while (this.burstAcc >= 1) {
        this.burstAcc -= 1;
        const muzzle = this.jet.root.localToWorld(this.jet.gunPort.clone());
        const aim = _v2.copy(P.fm.pos).addScaledVector(P.fm.vel, dist / 900).sub(muzzle).normalize();
        aim.lerp(nf, 0.55).normalize();
        aim.x += rand(-1, 1) * 0.012; aim.y += rand(-1, 1) * 0.012; aim.z += rand(-1, 1) * 0.012;
        c.spawnBullet(muzzle, aim.normalize().multiplyScalar(900).add(this.vel), 'enemy', 3.2, 0xff5a3a, 1.8, 1);
      }
      if (Math.random() < dt * 8) Audio.gunShot(this.pos.clone());
    }

    // 근접 통과
    if (pAlive && dist < 90 && this.nearCd <= 0) {
      this.nearCd = 4;
      Sfx.flyby(this.pos.clone());
      c.game.bonus('근접 통과!', 25);
      c.game.addShake(0.35);
    }

    // 피해 연출
    const dmg = 1 - this.hp / this.maxHp;
    if (dmg > 0.3) c.fxp.burning(this.pos.clone().addScaledVector(nf, 3), this.vel, (dmg - 0.25) * 1.2, dt);

    this._sync(dt, { throttle: 0.85, ab: this.ab, pitch: pitchCmd, roll: rollCmd });
  }

  _sync(dt, ctl) {
    const j = this.jet.root;
    j.position.copy(this.pos);
    j.quaternion.copy(this.quat);
    this.jet.animate(dt, ctl);
    // 날개끝 와류
    const vapor = clamp((this.gLat - 3.2) / 3, 0, 1) * (this.dead ? 0 : 1);
    const right = _v1.set(1, 0, 0).applyQuaternion(this.quat);
    for (let i = 0; i < 2; i++) {
      const tip = _v2.copy(this.jet.wingtipLocal[i]).applyQuaternion(this.quat).add(this.pos);
      if (vapor > 0.02) this.ribbons[i].push(tip, right, vapor * 0.55);
      this.ribbons[i].update(dt);
    }
  }

  _updateWreck(dt) {
    const c = this.c;
    this.deadT += dt;
    this.vel.y -= G * dt;
    this.vel.multiplyScalar(Math.exp(-dt * 0.15));
    this.pos.addScaledVector(this.vel, dt);
    _q.setFromEuler(new THREE.Euler(this.spin.x * dt, this.spin.y * dt, this.spin.z * dt));
    this.quat.multiply(_q);
    c.fxp.burning(this.pos, this.vel, 1.6, dt);
    const s = c.world.surfaceAt(this.pos.x, this.pos.z);
    if (this.pos.y < s.height + 2 || this.deadT > 9) {
      const p = this.pos.clone();
      p.y = Math.max(p.y, s.height);
      if (s.type === 'water') { c.fx.waterImpact(p, 60, 2.2); Audio.splash(p, 2); }
      else { c.fxp.groundBlast(p, false); Audio.explosion(p, 1.6); }
      this.remove = true;
    }
    this._sync(dt, { throttle: 0, ab: false });
  }

  dispose() {
    this.jet.dispose();
    for (const r of this.ribbons) r.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* 미사일                                                               */
/* ------------------------------------------------------------------ */
class Missile {
  constructor(c, owner, shooter, pos, dir, inheritVel, target) {
    this.c = c;
    this.owner = owner;            // 'player' | 'enemy' | 'sam'
    this.shooter = shooter;
    this.pos = pos.clone();
    this.dir = dir.clone().normalize();
    this.speed = Math.max(120, inheritVel.dot(this.dir)) + 25;
    this.vel = this.dir.clone().multiplyScalar(this.speed);
    this.target = target;
    this.life = 0;
    this.motor = owner === 'player' ? 3.6 : 3.0;
    this.maxSpeed = owner === 'player' ? 980 : 800;
    this.turnG = owner === 'player' ? 38 : 24;
    this.alive = true;
    this.tested = new Set();
    this.mesh = createMissileMesh();
    this.mesh.scale.setScalar(1.2);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    glow.position.z = 1.8;
    glow.scale.setScalar(4);
    this.glow = glow;
    this.mesh.add(glow);
    c.scene.add(this.mesh);
    this.closest = 1e9;
  }

  update(dt) {
    const c = this.c;
    this.life += dt;
    if (this.motor > 0) {
      this.motor -= dt;
      this.speed = Math.min(this.maxSpeed, this.speed + 300 * dt);
    } else {
      this.speed *= Math.exp(-dt * 0.12);
      this.glow.visible = false;
    }
    const T = this.target;
    if (T && this.life > 0.18) {
      if (!T.alive) this.target = null;
      else {
        const los = _v1.copy(T.pos).sub(this.pos);
        const dist = los.length();
        this.closest = Math.min(this.closest, dist);
        const ang = Math.acos(clamp(this.dir.dot(_v2.copy(los).divideScalar(dist)), -1, 1));
        if (ang > 1.15 && dist > 60) {
          this.target = null;
          if (this.owner !== 'player' && T === c.game.playerTarget) c.game.bonus('미사일 회피!', 50);
        } else {
          const tGo = dist / Math.max(250, this.speed);
          const aim = _v2.copy(T.pos).addScaledVector(T.vel || _v3.set(0, 0, 0), tGo * 0.95).sub(this.pos).normalize();
          rotateToward(this.dir, aim, (this.turnG * G / Math.max(this.speed, 150)) * dt);
          if (dist < (T.kind === 'ground' ? 20 : 15) || (dist < 40 && this.speed * dt > dist * 0.8)) { this.detonate(T); return; }
        }
      }
      // 플레어 기만
      if (this.target && this.target.kind !== 'flare') {
        for (const f of c.flares) {
          if (!f.alive || this.tested.has(f) || f.ownerRef !== this.target) continue;
          if (f.pos.distanceTo(this.pos) > 2200) continue;
          this.tested.add(f);
          const chance = this.owner === 'player' ? 0.18 : 0.32;
          if (Math.random() < chance) { this.target = f; break; }
        }
      }
    }
    this.vel.copy(this.dir).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.setFromUnitVectors(_v1.set(0, 0, -1), this.dir);
    if (this.glow.visible) this.glow.scale.setScalar(3.5 + Math.random() * 2);
    c.fxp.missileTrail(this.pos, this.dir, dt, this.motor > 0);
    const s = c.world.surfaceAt(this.pos.x, this.pos.z);
    if (this.pos.y < s.height + 1) { this.detonate(null, s); return; }
    if (this.life > 15) this.detonate(null);
  }

  detonate(target, surf) {
    if (!this.alive) return;
    this.alive = false;
    const c = this.c;
    const p = this.pos.clone();
    if (surf && surf.type === 'water') { c.fx.waterImpact(p, 50, 1.4); Audio.splash(p, 1.2); }
    else {
      c.fx.explosion(p, 0.9, { debris: false });
      c.fxp.glow(p, 26, 0.25);
      Audio.explosion(p, 0.8);
    }
    c.applySplash(p, this.owner, target);
    this.dispose();
  }

  dispose() {
    this.alive = false;
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.glow.material.dispose();
  }
}

/* ------------------------------------------------------------------ */
/* 지상 목표                                                            */
/* ------------------------------------------------------------------ */
const GMATS = {
  tank: new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.45, metalness: 0.5 }),
  band: new THREE.MeshStandardMaterial({ color: 0xb33a2a, roughness: 0.6 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x5d6745, roughness: 0.8 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2c3034, roughness: 0.7, metalness: 0.4 }),
  hangar: new THREE.MeshStandardMaterial({ color: 0x7c8187, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 }),
  charred: new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 1 }),
};

function makeGround(type) {
  const g = new THREE.Group();
  if (type === 'fuel') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 13, 28), GMATS.tank);
    t.position.y = 6.5;
    const d = new THREE.Mesh(new THREE.SphereGeometry(9, 28, 8, 0, Math.PI * 2, 0, Math.PI / 5), GMATS.tank);
    d.position.y = 13 - 9 * Math.cos(Math.PI / 5);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(9.05, 9.05, 1.4, 28), GMATS.band);
    b.position.y = 10;
    g.add(t, d, b);
  } else if (type === 'sam') {
    const base = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 4.5), GMATS.olive);
    base.position.y = 1.1;
    g.add(base);
    for (let i = 0; i < 4; i++) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 6.5, 10), GMATS.olive);
      tube.rotation.z = -0.8;
      tube.position.set(0.5, 3.6, -1.4 + i * 0.95);
      g.add(tube);
    }
  } else if (type === 'radar') {
    const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.6, 12, 8), GMATS.dark);
    tw.position.y = 6;
    const dish = new THREE.Mesh(new THREE.SphereGeometry(6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 4), GMATS.tank);
    dish.rotation.x = Math.PI / 2;
    const piv = new THREE.Group();
    piv.position.y = 13;
    piv.add(dish);
    g.add(tw, piv);
    g.userData.spin = piv;
  } else {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 34, 24, 1, true, 0, Math.PI), GMATS.hangar);
    h.rotation.z = Math.PI / 2;
    h.rotation.y = Math.PI / 2;
    const pad = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 44), GMATS.concrete);
    pad.position.y = 0.3;
    g.add(h, pad);
  }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

const GROUND_INFO = {
  fuel: { name: '연료 저장고', hp: 60, r: 11, pts: 150, big: true },
  sam: { name: 'SAM 발사대', hp: 45, r: 7, pts: 120 },
  radar: { name: '레이더 기지', hp: 55, r: 8, pts: 100 },
  hangar: { name: '격납고', hp: 90, r: 16, pts: 80 },
};

/* ------------------------------------------------------------------ */
/* 전투 매니저                                                          */
/* ------------------------------------------------------------------ */
export class Combat {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.fx = game.fx;
    this.fxp = game.fxp;
    this.world = game.world;
    this.enemies = [];
    this.missiles = [];
    this.flares = [];
    this.bullets = [];
    this.ground = [];
    this.mode = 'free';
    this.wave = 0;
    this.waveTimer = 0;
    this.respawnTimer = 0;
    this.lock = { target: null, progress: 0, locked: false };
    this.gunTarget = null;
    this.flakCd = 3;
    this.samCd = 12;

    // 예광탄
    this.maxBullets = 700;
    const geo = new THREE.BoxGeometry(0.2, 0.2, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.tracers = new THREE.InstancedMesh(geo, mat, this.maxBullets);
    this.tracers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxBullets * 3), 3);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    this.tracers.renderOrder = 13;
    this.scene.add(this.tracers);
    this._col = new THREE.Color();

    // 플레어 스프라이트
    this.flareMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfff0c8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    this.flareMat.color.multiplyScalar(3);
    this._buildGround();
  }

  /* ------------------------------ 지상 목표 ------------------------------ */
  _buildGround() {
    const w = this.world;
    const sites = [];
    const R = (() => { let s = 42; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    for (let tries = 0; tries < 900 && sites.length < 5; tries++) {
      const x = (R() - 0.5) * 16000, z = (R() - 0.5) * 16000;
      if (Math.abs(x) < 1800 && Math.abs(z) < 700) continue;
      const h = w.heightAt(x, z);
      if (h < 30 || h > 700) continue;
      let flat = true;
      for (const [dx, dz] of [[90, 0], [-90, 0], [0, 90], [0, -90], [60, 60], [-60, -60]]) {
        if (Math.abs(w.heightAt(x + dx, z + dz) - h) > 14 || w.surfaceAt(x + dx, z + dz).type === 'water') { flat = false; break; }
      }
      if (!flat) continue;
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < 3200)) continue;
      sites.push({ x, z });
    }
    const layout = [['fuel', 0, 0], ['fuel', 26, 4], ['fuel', 12, 26], ['sam', -70, 40], ['sam', 60, -60], ['radar', -40, -50], ['hangar', 90, 50]];
    sites.forEach((s, si) => {
      for (const [type, dx, dz] of layout) {
        const x = s.x + dx, z = s.z + dz;
        const y = w.heightAt(x, z);
        const mesh = makeGround(type);
        mesh.position.set(x, y - 0.3, z);
        mesh.rotation.y = R() * Math.PI * 2;
        this.scene.add(mesh);
        const info = GROUND_INFO[type];
        this.ground.push({
          kind: 'ground', type, name: info.name, site: si, mesh, pos: new THREE.Vector3(x, y + info.r * 0.6, z), vel: new THREE.Vector3(),
          radius: info.r, hp: info.hp, maxHp: info.hp, alive: true, pts: info.pts, big: !!info.big, respawn: 0, hostile: type === 'sam',
          onHit: null,
        });
      }
    });
    for (const t of this.ground) t.onHit = (dmg, cause, point) => this._hitGround(t, dmg, cause, point);
  }

  _hitGround(t, dmg, cause, point) {
    if (!t.alive) return;
    t.hp -= dmg;
    if (point) this.fx.sparks(point, UP, 5, 1);
    if (t.hp <= 0) {
      t.alive = false;
      t.respawn = 90;
      t.mesh.traverse((o) => { if (o.isMesh) { o.userData.mat = o.material; o.material = GMATS.charred; } });
      t.mesh.scale.set(1.1, 0.3, 1.1);
      this.fxp.groundBlast(t.pos.clone().setY(t.mesh.position.y + 2), t.big);
      Audio.explosion(t.pos.clone(), t.big ? 3 : 1.8);
      this.game.onKill(t, cause);
    }
  }

  /* ------------------------------ 모드/웨이브 ------------------------------ */
  start(mode) {
    this.clear();
    this.mode = mode;
    this.wave = 0;
    this.waveTimer = 2.5;
    this.respawnTimer = 1.5;
    this.flakCd = 4;
    this.samCd = 15;
  }

  clear() {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    for (const m of this.missiles) m.dispose();
    this.missiles.length = 0;
    for (const f of this.flares) if (f.sprite.parent) f.sprite.parent.remove(f.sprite);
    this.flares.length = 0;
    this.bullets.length = 0;
    this.tracers.count = 0;
    this.lock = { target: null, progress: 0, locked: false };
    Sfx.lockTone('off');
    Sfx.rwr(false);
    for (const t of this.ground) if (!t.alive) this._restoreGround(t);
  }

  _restoreGround(t) {
    t.alive = true;
    t.hp = t.maxHp;
    t.mesh.scale.set(1, 1, 1);
    t.mesh.traverse((o) => { if (o.isMesh && o.userData.mat) o.material = o.userData.mat; });
  }

  _spawnEnemy() {
    const P = this.game.player;
    const base = P.fm.pos;
    const hdg = Math.atan2(P.fm.forward.x, -P.fm.forward.z) + rand(-1.3, 1.3);
    const dist = rand(2800, 5200);
    const pos = new THREE.Vector3(base.x + Math.sin(hdg) * dist, 0, base.z - Math.cos(hdg) * dist);
    const h = Math.max(0, this.world.heightAt(pos.x, pos.z));
    pos.y = clamp(base.y + rand(-300, 700), h + 700, 6500);
    const toward = base.clone().sub(pos).setY(0).normalize();
    const side = new THREE.Vector3(-toward.z, 0, toward.x).multiplyScalar(rand(-0.8, 0.8));
    const vel = toward.add(side).normalize().multiplyScalar(220);
    const design = ENEMY_DESIGNS[Math.floor(Math.random() * ENEMY_DESIGNS.length)];
    const e = new Enemy(this, design, pos, vel);
    this.enemies.push(e);
    return e;
  }

  countEnemyMissiles() { return this.missiles.filter((m) => m.owner !== 'player').length; }

  _updateWaves(dt) {
    const alive = this.enemies.filter((e) => e.alive).length;
    if (this.mode === 'free') {
      if (alive < 4) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) { this._spawnEnemy(); this.respawnTimer = 5; }
      }
    } else if (alive === 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.wave++;
        const n = Math.min(2 + this.wave, 9);
        for (let i = 0; i < n; i++) this._spawnEnemy();
        this.game.banner(`WAVE ${this.wave}`, `적기 ${n}기 접근 중`, 'wave');
        this.waveTimer = 5;
      }
    }
    // 지상 목표 재생성
    for (const t of this.ground) {
      if (!t.alive) { t.respawn -= dt; if (t.respawn <= 0 && t.pos.distanceTo(this.game.player.fm.pos) > 3000) this._restoreGround(t); }
    }
  }

  /* ------------------------------ 무장 ------------------------------ */
  spawnBullet(pos, vel, owner, dmg, color, life = 1.6, size = 1) {
    if (this.bullets.length >= this.maxBullets) this.bullets.shift();
    this.bullets.push({ pos: pos.clone(), prev: pos.clone(), vel: vel.clone(), owner, dmg, color, life, size });
  }

  firePlayerGun(dt, firing) {
    const P = this.game.player;
    const gun = P.jet.stats.gun;
    if (firing && P.ammo > 0 && P.alive) {
      P.gunAcc += dt * gun.rof;
      P.gunIdle = 0;
      const fm = P.fm;
      const muzzle = P.jet.root.localToWorld(P.jet.gunPort.clone());
      const conv = _v2.copy(fm.pos).addScaledVector(fm.forward, 650).sub(muzzle).normalize();
      while (P.gunAcc >= 1 && P.ammo > 0) {
        P.gunAcc -= 1;
        P.ammo--;
        const d = _v1.copy(conv);
        d.x += rand(-1, 1) * gun.spread; d.y += rand(-1, 1) * gun.spread; d.z += rand(-1, 1) * gun.spread;
        d.normalize();
        const v = d.multiplyScalar(gun.speed).add(fm.vel);
        this.spawnBullet(muzzle.clone().addScaledVector(fm.vel, Math.random() * dt), v, 'player', gun.dmg, gun.color, 1.7, gun.size);
      }
      Sfx.gun(true, gun.rof, gun.dmg > 15);
      this.game.addShake(0.05 * gun.size);
      P.firing = true;
    } else {
      if (P.firing) Sfx.gun(false);
      P.firing = false;
      P.gunAcc = 0;
      P.gunIdle += dt;
      if (P.gunIdle > 1.2) P.ammo = Math.min(gun.ammo, P.ammo + gun.ammo * 0.45 * dt);
    }
  }

  firePlayerMissile() {
    const P = this.game.player;
    if (!P.alive || P.missiles < 1 || P.msCd > 0) return false;
    const target = this.lock.locked ? this.lock.target : null;
    this.launchMissile('player', P, target);
    P.missiles--;
    P.msCd = 0.35;
    P.jet.setMissilesVisible(Math.floor(P.missiles));
    this.lock.progress = 0; this.lock.locked = false;
    return true;
  }

  launchMissile(owner, shooter, target) {
    let pos, dir, vel;
    if (owner === 'player') {
      const P = shooter;
      const slot = P.jet.missileSlot(Math.floor(P.missiles) - 1);
      pos = P.jet.root.localToWorld(slot.clone()).addScaledVector(P.fm.up, -0.8);
      dir = P.fm.forward.clone();
      vel = P.fm.vel;
      Sfx.missileLaunch();
      this.game.addShake(0.3);
    } else if (owner === 'sam') {
      pos = shooter.pos.clone().add(new THREE.Vector3(0, 6, 0));
      dir = new THREE.Vector3(0, 1, 0).lerp(_v1.copy(target.fm.pos).sub(pos).normalize(), 0.5).normalize();
      vel = dir.clone().multiplyScalar(60);
      Audio.explosion(pos.clone(), 0.4);
    } else {
      pos = shooter.pos.clone().addScaledVector(shooter.up, -1.5);
      dir = shooter.fwd.clone();
      vel = shooter.vel;
    }
    const tgt = target && target.fm ? this.game.playerTarget : target;
    const m = new Missile(this, owner === 'sam' ? 'sam' : owner, shooter, pos, dir, vel, tgt);
    this.missiles.push(m);
    if (owner !== 'player') this.game.onMissileIncoming();
    return m;
  }

  dropFlares(owner, n = 6) {
    const isP = owner === this.game.player;
    const pos = isP ? owner.fm.pos : owner.pos;
    const vel = isP ? owner.fm.vel : owner.vel;
    const up = isP ? owner.fm.up : owner.up;
    const ref = isP ? this.game.playerTarget : owner;
    for (let i = 0; i < n; i++) {
      this.fxp.timeline.push({ t: i * 0.07, fn: () => {
        const side = (i % 2 ? 1 : -1);
        const right = _v1.crossVectors(vel, up).normalize();
        const v = vel.clone().multiplyScalar(0.55).addScaledVector(up, -18).addScaledVector(right, side * rand(15, 30));
        const sp = new THREE.Sprite(this.flareMat);
        sp.scale.setScalar(5);
        this.scene.add(sp);
        this.flares.push({ kind: 'flare', pos: pos.clone(), vel: v, life: 3.2, alive: true, sprite: sp, ownerRef: ref });
      } });
    }
    if (isP) Sfx.flare();
  }

  /** 폭발 피해 (직격 + 범위) */
  applySplash(p, owner, direct) {
    const P = this.game.player;
    if (owner === 'player') {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = e.pos.distanceTo(p);
        if (e === direct || d < 22) e.onHit(e === direct ? 200 : 120 * (1 - d / 22) + 20, 'missile', null);
      }
      for (const t of this.ground) {
        if (!t.alive) continue;
        const d = t.pos.distanceTo(p);
        if (t === direct || d < t.radius + 30) t.onHit(t === direct ? 200 : 90, 'missile', null);
      }
    } else if (P.alive) {
      const d = P.fm.pos.distanceTo(p);
      if (direct === this.game.playerTarget || d < 28) this.game.damagePlayer(direct === this.game.playerTarget ? 48 : 40 * (1 - d / 28), 'missile', p);
    }
  }

  /* ------------------------------ 락온 ------------------------------ */
  _updateLock(dt) {
    const P = this.game.player;
    const L = this.lock;
    let best = null, bestScore = 1e9;
    let gunBest = null, gunScore = 1e9;
    if (P.alive) {
      const f = P.fm.forward;
      const consider = (t, range) => {
        const to = _v1.copy(t.pos).sub(P.fm.pos);
        const d = to.length();
        if (d > range) return;
        const ang = Math.acos(clamp(f.dot(to.divideScalar(d)), -1, 1));
        if (ang < 0.42 && P.missiles >= 1) {
          const sc = ang * 3 + d / 6000;
          if (sc < bestScore) { bestScore = sc; best = t; }
        }
        if (t.kind === 'air' && d < 1600 && ang < 0.6) {
          const sc = ang + d / 3000;
          if (sc < gunScore) { gunScore = sc; gunBest = t; }
        }
      };
      for (const e of this.enemies) if (e.alive) consider(e, 7000);
      for (const t of this.ground) if (t.alive) consider(t, 5500);
    }
    if (best !== L.target) { L.target = best; L.progress = 0; L.locked = false; }
    if (best) {
      L.progress = Math.min(1, L.progress + dt / 1.0);
      if (!L.locked && L.progress >= 1) { L.locked = true; }
    }
    this.gunTarget = gunBest;
    Sfx.lockTone(best ? (L.locked ? 'lock' : 'seek') : 'off');
  }

  /* ------------------------------ 갱신 ------------------------------ */
  update(dt) {
    const P = this.game.player;
    this._updateWaves(dt);
    for (const e of this.enemies) e.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.remove || (e.alive && e.pos.distanceTo(P.fm.pos) > 16000)) { e.dispose(); this.enemies.splice(i, 1); }
    }
    for (const m of this.missiles) if (m.alive) m.update(dt);
    this.missiles = this.missiles.filter((m) => m.alive);

    // 플레어
    for (const f of this.flares) {
      f.life -= dt;
      f.vel.y -= G * 0.35 * dt;
      f.vel.multiplyScalar(Math.exp(-dt * 0.9));
      f.pos.addScaledVector(f.vel, dt);
      f.sprite.position.copy(f.pos);
      f.sprite.scale.setScalar(4 + Math.random() * 3);
      if (Math.random() < 0.7) this.fxp.flareSpark(f.pos);
      if (f.life <= 0) { f.alive = false; if (f.sprite.parent) f.sprite.parent.remove(f.sprite); }
    }
    this.flares = this.flares.filter((f) => f.alive);

    this._updateBullets(dt);
    this._updateLock(dt);
    this._updateDefenses(dt);

    // 레이더 회전
    for (const t of this.ground) if (t.alive && t.mesh.userData.spin) t.mesh.userData.spin.rotation.y += dt * 1.4;

    // 미사일 경보
    const incoming = this.missiles.some((m) => m.owner !== 'player' && m.target === this.game.playerTarget && m.pos.distanceTo(P.fm.pos) < 7000);
    this.incoming = incoming;
    Sfx.rwr(incoming && P.alive);
  }

  _updateDefenses(dt) {
    if (this.mode !== 'dogfight') return;
    const P = this.game.player;
    if (!P.alive) return;
    this.flakCd -= dt;
    this.samCd -= dt;
    let near = null, nd = 1e9;
    for (const t of this.ground) {
      if (!t.alive || t.type !== 'sam') continue;
      const d = t.pos.distanceTo(P.fm.pos);
      if (d < nd) { nd = d; near = t; }
    }
    if (!near) return;
    if (nd < 3200 && this.flakCd <= 0) {
      this.flakCd = rand(0.5, 1.1);
      const p = P.fm.pos.clone().addScaledVector(P.fm.vel, rand(0.2, 0.8)).add(new THREE.Vector3(rand(-70, 70), rand(-40, 60), rand(-70, 70)));
      this.fx.explosion(p, 0.45, { debris: false });
      for (let i = 0; i < 10; i++) this.fx.smoke.spawn({ x: p.x, y: p.y, z: p.z, vx: rand(-6, 6), vy: rand(-6, 6), vz: rand(-6, 6), size: rand(5, 9), sizeRate: 16, color: { r: 0.05, g: 0.05, b: 0.05 }, colorTo: { r: 0.18, g: 0.18, b: 0.18 }, life: rand(2, 4), drag: 0.8, opacity: 0.85 });
      Audio.explosion(p, 0.35);
      const d = p.distanceTo(P.fm.pos);
      if (d < 26) this.game.damagePlayer(6 * (1 - d / 26) + 2, 'flak', p);
      else this.game.addShake(0.15);
    }
    if (nd < 5500 && nd > 900 && this.samCd <= 0 && this.countEnemyMissiles() < 2) {
      this.samCd = rand(18, 30);
      this.launchMissile('sam', near, P);
      this.game.banner('SAM 발사 감지', '플레어(X) 또는 급선회로 회피', 'warn');
    }
  }

  _updateBullets(dt) {
    const P = this.game.player;
    const list = this.bullets;
    let k = 0;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      b.life -= dt;
      b.prev.copy(b.pos);
      b.vel.y -= G * 0.6 * dt;
      b.pos.addScaledVector(b.vel, dt);
      let hit = false;
      if (b.owner === 'player') {
        for (const e of this.enemies) {
          if (!e.alive) continue;
          if (segSphere(b.prev, b.pos, e.pos, e.radius) >= 0) {
            e.onHit(b.dmg, 'gun', b.pos.clone());
            this.game.onHitMarker(!e.alive);
            hit = true; break;
          }
        }
        if (!hit) for (const t of this.ground) {
          if (!t.alive) continue;
          if (segSphere(b.prev, b.pos, t.pos, t.radius) >= 0) {
            t.onHit(b.dmg, 'gun', b.pos.clone());
            this.game.onHitMarker(!t.alive);
            hit = true; break;
          }
        }
      } else if (P.alive && segSphere(b.prev, b.pos, P.fm.pos, 6.5) >= 0) {
        this.game.damagePlayer(b.dmg, 'gun', b.pos.clone());
        hit = true;
      }
      if (!hit && (b.pos.y < 3000 || b.life < 1)) {
        const s = this.world.surfaceAt(b.pos.x, b.pos.z);
        if (b.pos.y < s.height) {
          const p = b.pos.clone(); p.y = s.height;
          if (s.type === 'water') { if (Math.random() < 0.5) this.fx.waterImpact(p, 6, 0.18); }
          else { this.fx.sparks(p, UP, 3, 0.5); if (Math.random() < 0.4) this.fx.dust(p, 0.5); }
          hit = true;
        }
      }
      if (hit || b.life <= 0) continue;
      list[k++] = b;
    }
    list.length = k;
    // 렌더
    const T = this.tracers;
    const n = Math.min(list.length, this.maxBullets);
    for (let i = 0; i < n; i++) {
      const b = list[i];
      const sp = b.vel.length();
      _v1.copy(b.vel).divideScalar(sp);
      _q.setFromUnitVectors(Z, _v1);
      _s.set(b.size, b.size, Math.min(sp * 0.018, 22));
      _m4.compose(b.pos, _q, _s);
      T.setMatrixAt(i, _m4);
      this._col.setHex(b.color).multiplyScalar(3);
      T.setColorAt(i, this._col);
    }
    T.count = n;
    T.instanceMatrix.needsUpdate = true;
    if (T.instanceColor) T.instanceColor.needsUpdate = true;
  }
}
