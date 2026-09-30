// 적군: 우드랜드 위장 적 보병 — 경로 이동·엄폐·반응 지연 조준·점사·재장전, 부위별 피격(머리/몸통/팔다리),
// 피격 반응(움찔·비틀), 사망 시 무릎 꺾이며 쓰러짐(강체 회전 + 바닥 충돌), 총 떨어뜨림, 상처·혈흔·피 웅덩이
import * as THREE from 'three';
import { createHuman, SKEL, BI } from './human.js';
import { HumanAnimator, propGun } from './squad.js';
import { Audio } from './audio.js';
import { T } from './textures.js';
import { clamp, lerp, damp, rand, gauss, raySphere } from './core.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const KEYS = ['op1', 'op2', 'op3', 'op4'];
const GUN = { op1: 'ak', op2: 'ak74', op3: 'ak', op4: 'm4' };
const SOUND = { ak: 'ak', ak74: 'ak74', m4: 'm4' };
// 기지 북쪽·서쪽·동문 바깥쪽 진입로 (플레이어 스폰 (0,58) 에서 멀리)
const SPAWNS = [V(-52, 0, -58), V(-18, 0, -62), V(18, 0, -62), V(52, 0, -58), V(60, 0, -28), V(-60, 0, -30), V(64, 0, 2), V(-62, 0, 8)];
const ZONE = ['head', 'chest', 'spine', 'hips', 'leg', 'leg', 'leg', 'leg', 'arm', 'arm'];
const MUL = { head: 3.4, chest: 1.0, spine: 0.95, hips: 0.85, leg: 0.55, arm: 0.5 };

// ── 피 재질 (상처·웅덩이 공용) ──
let BLOOD = null;
function bloodMat() {
  return BLOOD || (BLOOD = new THREE.MeshStandardMaterial({ map: T.blood.map, normalMap: T.blood.normalMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, roughness: 0.25, metalness: 0 }));
}
const WOUND_GEO = new THREE.CircleGeometry(1, 12), POOL_GEO = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);

class Hostile {
  constructor(E, key, pos) {
    this.E = E; this.g = E.g; this.key = key;
    this.h = createHuman(key);
    this.anim = new HumanAnimator(this.h);
    this.gun = propGun(GUN[key]);
    this.g.scene.add(this.h.root, this.gun.group);
    this.pos = pos.clone(); this.vel = V(0, 0, 0); this.yaw = Math.atan2(-pos.x, 58 - pos.z);
    this.st = { grounded: true, canStep: true };
    this.hp = 100; this.alive = true; this.name = this.h.v.name;
    this.path = null; this.pathT = 0; this.pi = 0;
    this.target = null; this.seeT = 0; this.losT = 0; this.vis = false; this.lastSeen = null;
    this.react = 0; this.burst = 0; this.shotT = 0; this.burstT = rand(0.2, 0.6); this.mag = 30; this.reloadT = 0;
    this.coverT = 0; this.cover = null; this.flinchT = 0; this.crouch = false; this.strafe = 0; this.strafeT = 0;
    this.skill = rand(0.75, 1.15);
    this.spheres = Array.from({ length: 10 }, () => ({ c: V(0, 0, 0), r: 0.1 }));
    this.wounds = [];
  }

  eye() { return V(this.pos.x, this.pos.y + (this.crouch ? 1.15 : 1.6), this.pos.z); }

  // 가장 가까운 보이는 목표 (플레이어 / 아군)
  pickTarget() {
    const g = this.g, P = g.player, e = this.eye();
    let best = null, bd = 75;
    const consider = (pt, who) => { const d = pt.distanceTo(e); if (d < bd && g.world.los(e, pt)) { bd = d; best = { p: pt, who }; } };
    if (P.alive) consider(P.eye.clone().add(V(0, -0.25, 0)), 'player');
    for (const f of g.squad.list) consider(f.pos.clone().add(V(0, 1.3, 0)), f);
    return best;
  }

  update(dt) {
    if (!this.alive) return this.updateDead(dt);
    const g = this.g, w = g.world, P = g.player;
    this.flinchT = Math.max(0, this.flinchT - dt);
    // 목표 탐색 (0.25초마다 시야 확인)
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.25;
      const t = this.pickTarget();
      this.vis = !!t;
      if (t) { this.target = t; this.lastSeen = t.p.clone(); } else if (this.target) this.target = null;
    }
    let desired = V(0, 0, 0), speed = 0, ready = 0, aimPitch = 0, aimYaw = 0, look = this.lastSeen || P.eye;
    const goal = this.lastSeen || P.pos;
    const dGoal = Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z);
    if (this.cover && this.coverT > 0) {
      // 엄폐 이동/대기
      this.coverT -= dt;
      const d = V(this.cover.x - this.pos.x, 0, this.cover.z - this.pos.z);
      if (d.length() > 0.5) { speed = 4.6; desired.copy(d.normalize()).multiplyScalar(speed); }
      else this.crouch = true;
      if (this.coverT <= 0) { this.cover = null; this.crouch = Math.random() < 0.4; }
    } else if (this.vis && this.target) {
      // 교전: 멈추거나 좌우로 조금씩 이동하며 사격
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(1.2, 3); this.strafe = Math.random() < 0.45 ? (Math.random() < 0.5 ? -1 : 1) : 0; if (Math.random() < 0.25) this.crouch = !this.crouch; }
      if (dGoal > 42) { speed = 2.2; desired.set(goal.x - this.pos.x, 0, goal.z - this.pos.z).normalize().multiplyScalar(speed); }
      else if (this.strafe) { const r = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); desired.copy(r).multiplyScalar(this.strafe * 1.4); }
      ready = 1;
    } else {
      // 전진: 마지막 목격 위치 / 플레이어 쪽으로 (18m 앞에서 멈춤)
      this.react = Math.max(0, this.react - dt * 0.5);
      if (dGoal > 16) {
        speed = dGoal > 30 ? 3.8 : 2.6;
        this.pathT -= dt;
        if (this.pathT <= 0 || !this.path) { this.path = w.findPath(this.pos, goal); this.pi = 0; this.pathT = 1.5; }
        if (this.path && this.pi < this.path.length) {
          const wp = this.path[this.pi], d = V(wp.x - this.pos.x, 0, wp.z - this.pos.z);
          if (d.length() < 0.6 && this.pi < this.path.length - 1) this.pi++;
          desired.copy(d.normalize()).multiplyScalar(speed);
        }
      } else if (this.lastSeen && dGoal < 3) this.lastSeen = null;
      this.crouch = false;
    }
    // 서로 간격
    for (const o of this.E.list) if (o !== this && o.alive) { const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d2 = dx * dx + dz * dz; if (d2 < 2.2 && d2 > 1e-5) { const k = (1.5 - Math.sqrt(d2)) * 3; desired.x += dx * k; desired.z += dz * k; } }
    if (this.flinchT > 0) desired.multiplyScalar(0.35);
    if (this.crouch) desired.multiplyScalar(0.5);
    this.vel.x = damp(this.vel.x, desired.x, 7, dt); this.vel.z = damp(this.vel.z, desired.z, 7, dt);
    this.vel.y -= 16 * dt;
    this.st.canStep = true;
    w.move(this.pos, this.vel, dt, 0.31, 1.75, this.st);
    // 방향/조준
    const hv = Math.hypot(this.vel.x, this.vel.z);
    let tyaw = hv > 0.5 && !ready ? Math.atan2(this.vel.x, this.vel.z) : this.yaw;
    if (ready && this.target) {
      const d = this.target.p.clone().sub(this.pos);
      tyaw = Math.atan2(d.x, d.z);
      d.y -= 1.45; aimPitch = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.6);
      look = this.target.p;
    }
    const dy = Math.atan2(Math.sin(tyaw - this.yaw), Math.cos(tyaw - this.yaw));
    this.yaw += clamp(dy, -5 * dt, 5 * dt);
    aimYaw = clamp(dy, -0.8, 0.8);
    this.anim.flinch = Math.max(this.anim.flinch, this.flinchT > 0 ? Math.min(1, this.flinchT * 1.5) : 0);
    this.anim.update(dt, { pos: this.pos, yaw: this.yaw, vel: this.vel, crouch: this.crouch, ready, aimPitch, aimYaw, lookAt: look, gun: this.gun });
    // 사격: 반응 지연 → 점사 (거리·이동·피격 시 정확도 하락, 조준 시간에 따라 향상)
    if (ready && this.target && Math.abs(dy) < 0.25) {
      this.react += dt * this.skill;
      if (this.reloadT > 0) { this.reloadT -= dt; if (this.reloadT <= 0) { this.mag = 30; } }
      else if (this.react > 0.7) {
        this.burstT -= dt;
        if (this.burst > 0) {
          this.shotT -= dt;
          if (this.shotT <= 0) { this.shotT = 60 / 620; this.burst--; this.fire(); }
        } else if (this.burstT <= 0) { this.burst = 2 + Math.floor(Math.random() * 4); this.burstT = rand(0.5, 1.4); }
      }
    } else this.react = Math.max(0, this.react - dt);
    // 발소리
    this.stepAcc = (this.stepAcc || 0) + hv * dt;
    if (this.stepAcc > (hv > 3 ? 1.2 : 0.75) && hv > 0.5) { this.stepAcc = 0; if (this.pos.distanceTo(P.pos) < 30) Audio.play3D(this.st.surf === 'metal' ? 'stepMetal' : this.st.surf === 'dirt' ? 'stepDirt' : 'stepConcrete', this.pos, { vol: hv > 3 ? 0.5 : 0.3, ref: 3, speedDelay: false }); }
  }

  muzzle() { this.gun.group.updateMatrixWorld(true); return this.gun.muzzle.clone().applyMatrix4(this.gun.group.matrixWorld); }

  fire() {
    if (this.mag <= 0) { this.reloadT = rand(2.2, 3); Audio.play3D('magout', this.pos.clone().add(V(0, 1.2, 0)), { vol: 0.5, ref: 3 }); return; }
    this.mag--;
    const g = this.g, m = this.muzzle(), t = this.target.p;
    const dist = m.distanceTo(t), hv = Math.hypot(this.vel.x, this.vel.z);
    // 산포(라디안): 기본 + 이동 + 피격 + 거리, 조준 유지 시간에 따라 감소
    const spread = (0.012 + hv * 0.012 + this.flinchT * 0.05 + (this.crouch ? -0.004 : 0)) / this.skill * (1.6 - Math.min(0.9, this.react * 0.25)) + dist * 0.00012;
    const dir = t.clone().sub(m).normalize();
    dir.x += gauss() * spread; dir.y += gauss() * spread * 0.8; dir.z += gauss() * spread; dir.normalize();
    g.ballistics.fire({ origin: m, dir, speed: 700, dmg: 13, owner: 'enemy', def: { range: [40, 160, 0.6] }, tracer: Math.random() < 0.35, bot: this, from: m });
    Audio.play3D(SOUND[this.gun.type] || 'ak', m, { vol: 1.1, ref: 6 });
    g.fx.flashLight(m, 60, 0.05, 10);
    for (let i = 0; i < 2; i++) g.fx.add.add(m, dir.clone().multiplyScalar(rand(3, 8)).add(V(rand(-1, 1), rand(-1, 1), rand(-1, 1))), { life: rand(0.04, 0.08), size: rand(0.05, 0.12), drag: 4, color: [7, 3.5, 1.2] });
    g.fx.alpha.add(m, dir.clone().multiplyScalar(rand(0.5, 1.5)), { life: rand(0.8, 1.4), size: 0.08, grow: 0.4, drag: 2, grav: -0.1, color: [0.7, 0.7, 0.7], alpha: 0.2, spin: 1 });
    this.anim.pull = 1;
    g.inCombat = 6;
  }

  hitboxes() {
    const B = this.h.bones, S = this.spheres;
    const set = (i, b, r, off) => { S[i].c.setFromMatrixPosition(B[b].matrixWorld); if (off) S[i].c.add(off); S[i].r = r; };
    set(0, 'head', 0.12, V(0, 0.09, 0)); set(1, 'chest', 0.2, V(0, 0.08, 0)); set(2, 'spine', 0.19); set(3, 'hips', 0.17);
    set(4, 'shinL', 0.085); set(5, 'shinR', 0.085); set(6, 'thighL', 0.1, V(0, -0.2, 0)); set(7, 'thighR', 0.1, V(0, -0.2, 0));
    set(8, 'farmL', 0.065); set(9, 'farmR', 0.065);
    return S;
  }

  // 피격: 부위 배수, 상처 부착, 피 분사·뒤쪽 혈흔, 움찔/엄폐 결심
  damage(i, dmg, dir, point, by) {
    const zone = ZONE[i], g = this.g;
    const head = zone === 'head';
    this.hp -= dmg * MUL[zone];
    this.flinchT = Math.max(this.flinchT, head ? 0.6 : 0.45);
    this.anim.flinch = 1;
    this.react *= 0.4;
    this.pos.addScaledVector(V(dir.x, 0, dir.z).normalize(), 0.06);
    this.E.bleed(point, dir, head || this.hp <= 0, this, i);
    if (this.hp <= 0) { this.die(dir, head, by); return { kill: true, head }; }
    // 살아남으면 엄폐로 (체력 낮을수록 확률↑)
    if (!this.cover && Math.random() < 0.35 + (1 - this.hp / 100) * 0.4) this.findCover();
    if (!this.lastSeen && by === 'player') this.lastSeen = g.player.pos.clone();
    return { kill: false, head };
  }

  findCover() {
    const w = this.g.world, tp = this.target ? this.target.p : this.g.player.eye;
    let best = null, bd = 1e9;
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, r = rand(2.5, 9), c = V(this.pos.x + Math.cos(a) * r, 0, this.pos.z + Math.sin(a) * r);
      const cell = w.cellOf(c.x, c.z); if (!w.free(cell[0], cell[1])) continue;
      if (w.los(V(c.x, 1.1, c.z), tp)) continue;
      const d = c.distanceTo(this.pos); if (d < bd) { bd = d; best = c; }
    }
    if (best) { this.cover = best; this.coverT = rand(2.5, 4.5); }
  }

  die(dir, head, by) {
    this.alive = false; this.deathT = 0; this.hp = 0;
    // 쓰러지는 방향: 총알 방향(수평) + 약간 무작위, 머리 맞으면 즉시 힘이 빠짐
    const f = V(dir.x, 0, dir.z).normalize().applyAxisAngle(V(0, 1, 0), rand(-0.5, 0.5));
    this.fallAxis = V(0, 1, 0).cross(f).normalize();   // 이 축으로 회전하면 f 방향으로 넘어짐
    this.theta = head ? 0.12 : 0.05; this.omega = head ? 1.4 : 0.8 + Math.random() * 0.6;
    this.collapse = head ? 0.12 : 0.28;
    this.baseQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, 0));
    // 총 떨어뜨림 (강체)
    this.drop = { v: this.vel.clone().add(V(rand(-0.6, 0.6), rand(0.6, 1.4), rand(-0.6, 0.6))).addScaledVector(f, 1.2), w: V(rand(-4, 4), rand(-4, 4), rand(-6, 6)), rest: false };
    Audio.play3D(Math.random() < 0.5 ? 'hurt' : 'cloth', this.pos.clone().add(V(0, 1.4, 0)), { vol: 0.6, ref: 3 });
    this.E.onKill(this, head, by);
  }

  updateDead(dt) {
    const g = this.g, B = this.h.bones;
    this.deathT += dt;
    if (this.deathT < this.collapse) {
      // 무릎이 꺾이며 주저앉기 시작
      this.anim.update(dt, { pos: this.pos, yaw: this.yaw, vel: V(0, 0, 0), crouch: true, ready: 0, aimPitch: 0.3, aimYaw: 0, lookAt: this.pos.clone().add(V(0, 0, 0)), gun: null });
      this.pos.y -= dt * 0.9;
    }
    if (this.launch) {   // 폭풍에 날려감
      this.launch.y -= 9.8 * dt; this.pos.addScaledVector(this.launch, dt);
      const fl = g.world.floorAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
      if (this.pos.y <= fl.y) { this.pos.y = fl.y; this.launch.multiplyScalar(0.3); this.launch.y = 0; if (this.launch.length() < 0.3) this.launch = null; }
    }
    if (this.deathT < this.collapse) { /* 주저앉는 중 */ } else if (!this.landed) {
      // 강체 막대 넘어짐: θ'' = (3g / 2L) sin θ
      this.omega += 1.5 * 9.8 / 1.1 * Math.sin(this.theta) * dt;
      this.theta += this.omega * dt;
      if (this.theta >= Math.PI / 2 - 0.08) {
        this.theta = Math.PI / 2 - 0.08; this.omega *= -0.18;
        if (Math.abs(this.omega) < 0.25) { this.landed = true; this.E.pool(this); Audio.play3D('land', this.pos, { vol: 0.9, ref: 3, rate: 0.8 }); g.fx.alpha.add(this.pos.clone().add(V(0, 0.1, 0)), V(0, 0.3, 0), { life: 1.2, size: 0.6, grow: 0.8, drag: 2, color: [0.4, 0.37, 0.33], alpha: 0.3, fadeIn: 0.05 }); }
      }
      // 팔다리 힘 빠짐: 다리·몸통은 곧게 펴지고(쓰러지며 무릎이 펴짐) 팔은 벌어짐
      const k = Math.min(1, this.deathT * 2), I = new THREE.Quaternion();
      for (const n of ['thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR', 'spine', 'chest', 'hips']) if (B[n]) B[n].quaternion.slerp(I, 0.09);
      B.hips.position.lerp(SKEL[BI.hips].p, 0.06);
      for (const [n, e] of [['uarmL', [0.9, 0, 0.6]], ['uarmR', [0.9, 0, -0.6]], ['farmL', [0.4, 0, 0]], ['farmR', [0.4, 0, 0]], ['neck', [0.3, 0, 0]]]) if (B[n]) B[n].quaternion.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(...e)), k * 0.08);
      const root = this.h.root;
      root.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(this.fallAxis, this.theta)).multiply(this.baseQ);
      const fl = g.world.floorAt(this.pos.x, this.pos.z, this.pos.y + 0.5);
      this.pos.y = Math.max(fl.y - 0.05, this.pos.y - dt * 0.4);
      root.position.copy(this.pos);
      root.updateMatrixWorld(true);
    }
    // 떨어진 총
    const d = this.drop, G = this.gun.group;
    if (d && !d.rest) {
      d.v.y -= 9.8 * dt; G.position.addScaledVector(d.v, dt);
      G.rotation.x += d.w.x * dt; G.rotation.y += d.w.y * dt; G.rotation.z += d.w.z * dt;
      const fl = g.world.floorAt(G.position.x, G.position.z, G.position.y + 0.3);
      if (G.position.y < fl.y + 0.04 && d.v.y < 0) {
        G.position.y = fl.y + 0.04;
        if (Math.abs(d.v.y) > 1.2) Audio.play3D('magout', G.position, { vol: 0.4, rate: 0.55, ref: 3 });
        d.v.multiplyScalar(0.35); d.v.y = Math.abs(d.v.y) * 0.3; d.w.multiplyScalar(0.4);
        if (d.v.length() < 0.25) { d.rest = true; G.rotation.set(0, G.rotation.y, Math.PI / 2 * Math.sign(G.rotation.z || 1)); }
      }
    }
    // 피 웅덩이 번짐
    if (this.poolMesh) { const s = Math.min(1, (this.deathT - this.poolT0) / 7); this.poolMesh.scale.setScalar(0.08 + 0.6 * Math.sqrt(s)); this.poolMesh.material.opacity = 0.9; }
  }

  remove() {
    const s = this.g.scene;
    s.remove(this.h.root, this.gun.group);
    if (this.poolMesh) s.remove(this.poolMesh);
  }
}

export class Enemies {
  constructor(game) {
    this.g = game; this.list = []; this.wave = 0; this.breakT = 6; this.toSpawn = 0; this.spawnT = 0; this.active = false;
    this.bloodGround = null;
  }
  get alive() { return this.list.filter((e) => e.alive).length; }

  start() { this.clear(); this.active = true; this.wave = 0; this.breakT = 8; }
  stop() { this.active = false; this.clear(); }
  clear() { for (const e of this.list) e.remove(); this.list = []; this.toSpawn = 0; }

  update(dt) {
    if (!this.active) return;
    const g = this.g;
    // 웨이브: 모두 쓰러지면 휴식 후 다음 웨이브 (인원 증가)
    if (this.toSpawn <= 0 && this.alive === 0) {
      this.breakT -= dt;
      if (this.breakT <= 0) {
        this.wave++; this.toSpawn = Math.min(3 + this.wave, 10); this.spawnT = 0;
        g.hud.message(`적 병력 접근 — 제 ${this.wave} 파`, 2.6, 'big warn');
        Audio.play('select', { vol: 0.6 });
      }
    }
    if (this.toSpawn > 0 && this.alive < 7) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) { this.spawnT = rand(0.8, 2.2); this.spawn(); this.toSpawn--; }
    }
    for (const e of this.list) e.update(dt);
    // 시체는 45초 뒤 정리 (최대 12구)
    const dead = this.list.filter((e) => !e.alive);
    for (const e of dead) if (e.deathT > 45 || dead.length > 12 && e === dead[0]) { e.remove(); this.list.splice(this.list.indexOf(e), 1); }
    this.g.inCombat = Math.max(0, (this.g.inCombat || 0) - dt);
  }

  spawn() {
    const g = this.g, P = g.player, w = g.world;
    // 플레이어에서 35m 이상, 가능하면 시야 밖 입구
    const cands = SPAWNS.filter((s) => s.distanceTo(P.pos) > 35).sort(() => Math.random() - 0.5);
    let sp = cands.find((s) => !w.los(V(s.x, 1.6, s.z), P.eye)) || cands[0] || SPAWNS[0];
    const c = w.nearestFree(...w.cellOf(sp.x + rand(-3, 3), sp.z + rand(-3, 3)));
    const pos = V(c[0] - 70 + 0.5, 0, c[1] - 70 + 0.5);
    pos.y = w.floorAt(pos.x, pos.z, 5).y;
    const key = KEYS[Math.floor(Math.random() * KEYS.length)];
    const e = new Hostile(this, key, pos);
    e.lastSeen = P.pos.clone();
    this.list.push(e);
  }

  // 폭발: 거리 감쇠 피해, 사망 시 폭풍 방향으로 날아가 쓰러짐
  blast(p, R, dmg, by) {
    for (const e of this.list) {
      if (!e.alive) continue;
      const c = e.pos.clone().add(V(0, 1.0, 0)), d = c.distanceTo(p);
      if (d > R || !this.g.world.los(p.clone().add(V(0, 0.3, 0)), c)) continue;
      const k = Math.pow(1 - d / R, 1.3), dir = c.clone().sub(p).normalize();
      e.damage(1, dmg * k, dir, c, by);
      if (!e.alive) { e.omega += 2.5 + k * 4; e.launch = dir.setY(Math.max(0.35, dir.y)).multiplyScalar(3 + k * 7); }
      else { e.flinchT = 1.2; e.findCover(); }
    }
  }

  nearestVisible(from, maxD) {
    let best = null, bd = maxD;
    for (const e of this.list) {
      if (!e.alive) continue;
      const p = e.pos.clone().add(V(0, 1.3, 0)), d = p.distanceTo(from);
      if (d < bd && this.g.world.los(from, p)) { bd = d; best = e; }
    }
    return best;
  }

  raycast(o, d, maxT) {
    let best = maxT, res = null; const a = V(0, 0, 0);
    for (const e of this.list) {
      if (!e.alive) continue;
      a.set(e.pos.x, e.pos.y + 1.0, e.pos.z);
      if (raySphere(o, d, a, 1.2, best + 1.2) < 0 && a.distanceTo(o) > 1.2) continue;
      const S = e.hitboxes();
      for (let i = 0; i < S.length; i++) { const t = raySphere(o, d, S[i].c, S[i].r, best); if (t >= 0 && t < best) { best = t; res = { t, enemy: e, zone: i, c: S[i].c.clone() }; } }
    }
    if (res) { res.point = o.clone().addScaledVector(d, res.t); res.n = res.point.clone().sub(res.c).normalize(); }
    return res;
  }

  // 명중 처리 (탄도 → 적)
  hit(hit, dir, b) {
    const g = this.g, e = hit.enemy, by = b.owner;
    const dist = b.dist + hit.t, r = b.def?.range || [60, 200, 0.7];
    const falloff = dist < r[0] ? 1 : lerp(1, r[2], clamp((dist - r[0]) / (r[1] - r[0]), 0, 1));
    const res = e.damage(hit.zone, b.dmg * falloff * (by === 'player' ? g.dmgMul || 1 : 0.8), dir, hit.point, by);
    Audio.play3D(res.head ? 'headshot' : 'hitFlesh', hit.point, { vol: 0.9, ref: 3 });
    if (by === 'player') {
      g.stats.hits++;
      g.hud.hitmarker(res.kill, res.head);
      Audio.play(res.kill ? 'kill' : 'hitmark', { vol: res.kill ? 0.5 : 0.35, bus: 'ui' });
    }
  }

  onKill(e, head, by) {
    const g = this.g;
    if (by === 'player') {
      g.stats.kills++; if (head) g.stats.heads++;
      const pts = 100 + (head ? 50 : 0);
      g.addPoints(pts, head ? '헤드샷 처치' : '처치');
      g.hud.kill(e.name, g.weapons.cur.def.name, head);
    } else if (by && by !== 'enemy') {
      g.addPoints(25, '분대 처치 지원');
      g.hud.kill(e.name, '분대', false, true);
    }
  }

  // 피: 입사 분사 + 관통 반대편 분무 + 뒤쪽 벽/바닥 혈흔 + 몸에 상처
  bleed(p, dir, big, e, zone) {
    const g = this.g, fx = g.fx;
    fx.blood(p, dir, big);
    for (let i = 0; i < (big ? 10 : 5); i++) fx.alpha.add(p.clone().addScaledVector(dir, 0.1), dir.clone().multiplyScalar(rand(1.5, 4)).add(V(rand(-0.6, 0.6), rand(-0.3, 0.6), rand(-0.6, 0.6))), { life: rand(0.25, 0.6), size: rand(0.04, 0.1), grow: 0.8, drag: 4, grav: 2, color: [0.32, 0.015, 0.02], alpha: 0.8, spin: 1 });
    // 핏방울 (중력으로 떨어져 바닥에 튐)
    for (let i = 0; i < (big ? 12 : 6); i++) fx.dots.add(p, dir.clone().multiplyScalar(rand(1, 3.5)).add(V(rand(-0.8, 0.8), rand(0, 1.2), rand(-0.8, 0.8))), { life: rand(0.4, 0.9), size: rand(0.01, 0.022), grav: 9.8, drag: 0.6, color: [0.28, 0.01, 0.015] });
    const wh = g.world.raycast(p, dir, 3.5);
    if (wh) fx.decals.blood.add(wh.point, wh.n, rand(0.35, big ? 0.9 : 0.6));
    const fl = g.world.floorAt(p.x + dir.x * 0.6, p.z + dir.z * 0.6, p.y);
    fx.decals.blood.add(V(p.x + dir.x * rand(0.3, 1.2), fl.y + 0.01, p.z + dir.z * rand(0.3, 1.2)), V(0, 1, 0), rand(0.15, 0.4));
    // 상처 (뼈에 부착)
    const bone = e.h.bones[['head', 'chest', 'spine', 'hips', 'shinL', 'shinR', 'thighL', 'thighR', 'farmL', 'farmR'][zone]];
    if (bone && e.wounds.length < 8) {
      const m = new THREE.Mesh(WOUND_GEO, bloodMat()); m.scale.setScalar(rand(0.022, 0.035));
      bone.updateMatrixWorld(true);
      const n = p.clone().sub(e.hitboxes()[zone].c).normalize();
      m.position.copy(bone.worldToLocal(p.clone().addScaledVector(n, 0.004)));
      const q = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
      m.quaternion.setFromUnitVectors(V(0, 0, 1), n.applyQuaternion(q));
      bone.add(m); e.wounds.push(m);
    }
  }

  pool(e) {
    const g = this.g, m = new THREE.Mesh(POOL_GEO, bloodMat().clone());
    const chest = e.h.bones.chest.getWorldPosition(V(0, 0, 0)), fl = g.world.floorAt(chest.x, chest.z, chest.y + 0.3);
    m.position.set(chest.x, fl.y + 0.006, chest.z); m.rotation.y = Math.random() * 6.28; m.scale.setScalar(0.08);
    m.receiveShadow = true; m.renderOrder = 1;
    g.scene.add(m); e.poolMesh = m; e.poolT0 = e.deathT;
  }
}
