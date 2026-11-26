// 좀비 AI: 시각/청각, 배회·조사·추격(달리기)·공격·문 부수기·섭식·계단 이동(내비 그래프), 시민 도주/감염
import * as THREE from 'three';
import { Human } from './human.js';
import { clamp, damp, lerp, pick } from './util.js';
import { slab } from './physics.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
let ZID = 0;

export class Zombie {
  constructor(mgr, x, y, z, o = {}) {
    this.mgr = mgr; this.game = mgr.game; this.id = ZID++;
    this.h = new Human(o.kind || 'zombie', o.variant ?? Math.floor(Math.random() * 10));
    this.h.Z = true; this.mesh = this.h.mesh;
    this.c = { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), r: 0.3, h: 1.7, step: 0.48, onGround: true };
    this.pos = this.c.pos; this.yaw = o.yaw ?? Math.random() * 6.28;
    this.runner = o.runner ?? Math.random() < (this.game.night ? 0.5 : 0.25);
    this.h.st.runner = this.runner;
    this.walkV = 0.6 + Math.random() * 0.5; this.chaseV = this.runner ? 4.8 + Math.random() * 1.3 : 1.3 + Math.random() * 0.6;
    this.hp = o.hp ?? (this.runner ? 80 : 110); this.state = o.state || 'idle'; this.stateT = Math.random() * 3;
    this.goal = null; this.path = []; this.repath = 0; this.senseT = Math.random() * 0.3; this.groanT = 2 + Math.random() * 6;
    this.atkT = 0; this.atkCD = 0; this.stuckT = 0; this.detour = 0; this.detourDir = 1; this.lastSeen = null; this.stagger = 0; this.dead = false; this.deadT = 0;
    this.scripted = !!o.scripted; this.noDespawn = !!o.noDespawn; this.riseT = o.rise ? 2.2 : 0;
    if (o.rise) { this.h.setDead(-1); this.h.deadT = 5; }
    if (this.state === 'eat') this.h.st.mode = 'eat';
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw;
    this.game.scene.add(this.mesh); this.animAcc = 0;
  }
  get eye() { return _a.set(this.pos.x, this.pos.y + 1.6, this.pos.z); }
  hit(dmg, part, dir, kind = 'melee') {
    if (this.dead) return;
    const mul = part === 'head' ? (kind === 'gun' ? 3.2 : 2) : part === 'limb' ? 0.6 : 1;
    this.hp -= dmg * mul;
    // 국소 피격 반응 (몸 기준 좌우/앞뒤)
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), lx = dir.x * fz - dir.z * fx, lz = dir.x * fx + dir.z * fz;
    this.h.impulse(lx * (kind === 'gun' ? 0.6 : 1), -lz * (kind === 'gun' ? 0.6 : 1));
    this.stagger = kind === 'gun' ? 0.25 : 0.55; this.c.vel.x += dir.x * 2; this.c.vel.z += dir.z * 2;
    this.game.fx.blood(this.h.b[part === 'head' ? 'head' : 'chest'].getWorldPosition(new THREE.Vector3()), dir, part === 'head' ? 14 : 8);
    this.game.audio.play(kind === 'gun' ? 'bulletFlesh' : 'meleeFlesh', { pos: this.pos });
    if (this.state !== 'chase') { this.state = 'chase'; this.lastSeen = this.game.player.pos.clone(); }
    if (this.hp <= 0) this.die(dir, part);
    else if (Math.random() < 0.5) this.game.audio.play('zpain', { pos: this.pos, pitch: this.runner ? 1.2 : 1 });
  }
  die(dir, part) {
    this.dead = true; this.state = 'dead'; this.deadT = 0;
    const fz = Math.cos(this.yaw), fx = Math.sin(this.yaw), forward = dir ? (dir.x * fx + dir.z * fz) : -1;
    this.h.setDead(forward > 0 ? 1 : -1);
    this.game.audio.play('bodyfall', { pos: this.pos, delay: 0.6 });
    this.game.emit('zkill', { z: this, part });
  }
  update(dt) {
    const g = this.game, P = g.player, h = this.h, st = h.st;
    if (this.dead) { this.deadT += dt; this.anim(dt); return; }
    if (this.riseT > 0) { // 죽은 자가 일어남
      this.riseT -= dt; const k = clamp(1 - this.riseT / 2.2, 0, 1);
      h.st.mode = 'loco'; h.bones[0].rotation.x = -1.5 * (1 - k * k) + Math.sin(k * 20) * 0.05 * (1 - k); this.anim(dt, true);
      if (this.riseT <= 0) { this.state = 'chase'; this.lastSeen = P.pos.clone(); g.audio.play('zscream', { pos: this.pos }); }
      return;
    }
    const ppos = P.vehicle ? P.vehicle.pos : P.pos, dx = ppos.x - this.pos.x, dz = ppos.z - this.pos.z, dy = ppos.y - this.pos.y, d = Math.hypot(dx, dz);
    // 감각
    this.senseT -= dt;
    if (this.senseT <= 0 && !P.dead && !this.mgr.ignorePlayer && !this.forceTarget) {
      this.senseT = 0.25 + Math.random() * 0.1;
      const night = g.night > 0.5, sightR = (night ? (P.flashOn ? 38 : 13) : 34) * (P.crouch ? 0.6 : 1) * (P.vehicle ? 1.6 : 1) * (P.inShadow ? 0.6 : 1);
      if (d < sightR && Math.abs(dy) < 6) {
        const fwd = Math.sin(this.yaw) * dx + Math.cos(this.yaw) * dz;
        if (d < 3.5 || fwd / d > -0.25 || this.state === 'chase') {
          const e = this.eye; _b.set(ppos.x - e.x, ppos.y + 1.4 - e.y, ppos.z - e.z); const L = _b.length(); _b.divideScalar(L);
          const hit = g.col.ray(e.x, e.y, e.z, _b.x, _b.y, _b.z, L, bx => !bx.glass && !bx.veh);
          if (hit === Infinity) { if (this.state !== 'chase' && this.state !== 'attack') this.alert(); this.state = this.state === 'attack' ? 'attack' : 'chase'; this.lastSeen = ppos.clone(); this.seeT = 0; }
          else if (this.state === 'chase') { this.seeT = (this.seeT || 0) + 0.3; if (this.seeT > 6) { this.state = 'investigate'; this.goal = this.lastSeen; } }
        }
      } else if (this.state === 'chase') { this.seeT = (this.seeT || 0) + 0.3; if (this.seeT > 4 || d > 90) { this.state = 'investigate'; this.goal = this.lastSeen; } }
    }
    // 상태별 목표
    let speed = 0, target = null, reach = 0, agit = 0;
    this.stateT -= dt; this.atkCD -= dt; this.stagger -= dt; this.repath -= dt;
    if (this.forceTarget) { target = this.forceTarget.pos; speed = this.chaseV; reach = 1; agit = 1; this.state = 'scripted'; }
    else switch (this.state) {
      case 'eat': st.mode = 'eat'; agit = 0.3; if (d < 6 && this.stateT < 0) { this.state = 'chase'; this.lastSeen = ppos.clone(); this.alert(); } break;
      case 'idle': if (this.stateT < 0) { this.state = 'wander'; this.stateT = 6 + Math.random() * 8; this.goal = this.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20)); } break;
      case 'wander': target = this.goal; speed = this.walkV; if (this.stateT < 0 || !target || this.pos.distanceTo(target) < 1) { this.state = 'idle'; this.stateT = 3 + Math.random() * 6; } break;
      case 'investigate': target = this.goal; speed = this.walkV * 1.5 + (this.runner ? 1.5 : 0); agit = 0.4; if (!target || Math.hypot(target.x - this.pos.x, target.z - this.pos.z) < 1.5) { this.state = 'idle'; this.stateT = 4 + Math.random() * 4; } break;
      case 'chase': {
        target = this.lastSeen || ppos; speed = this.chaseV; reach = 1; agit = 1;
        if (d < 1.35 && Math.abs(dy) < 1.3 && this.atkCD <= 0 && !P.dead) { this.state = 'attack'; this.atkT = 0; g.audio.play('zattack', { pos: this.pos }); }
        if (!this.lastSeen || this.pos.distanceTo(this.lastSeen) < 1.2) { if (d > 2) { this.state = 'investigate'; this.goal = ppos.clone(); } }
        break;
      }
      case 'attack': {
        reach = 1; agit = 1; this.atkT += dt / 0.85; st.atk = this.atkT; speed = 0;
        this.yaw = turn(this.yaw, Math.atan2(dx, dz), 10 * dt);
        if (this.atkT > 0.5 && !this.dealt) { this.dealt = true; if (d < 1.75 && Math.abs(dy) < 1.4) P.damage(this.runner ? 9 : 13, 'zombie', this); }
        if (this.atkT >= 1) { this.state = 'chase'; this.atkCD = 0.4 + Math.random() * 0.4; st.atk = 0; this.dealt = false; this.lastSeen = ppos.clone(); }
        break;
      }
      case 'bang': {
        agit = 1; reach = 1; this.atkT += dt / 0.9; st.atk = this.atkT % 1;
        if (this.atkT % 1 < dt / 0.9 * 1.01) { const door = this.door; if (door && door.closed) { door.damage(this.runner ? 6 : 9); g.audio.play('doorBang', { pos: door.center }); g.zombies.noise(door.center, 22, 'bang'); } }
        if (!this.door || !this.door.closed) { this.state = 'chase'; st.atk = 0; this.lastSeen = ppos.clone(); }
        break;
      }
    }
    if (this.stagger > 0) speed *= 0.2;
    // 경로(건물 내부: 내비 그래프)
    let goal = target;
    const nav = g.nav;
    if (target && nav && (nav.inside(target) || nav.inside(this.pos)) && (Math.abs(target.y - this.pos.y) > 1.2 || nav.inside(target) !== nav.inside(this.pos))) {
      if (this.repath <= 0 || !this.path.length) { this.path = nav.path(this.pos, target); this.repath = 1.2; }
      while (this.path.length && Math.hypot(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z) < 0.55 && Math.abs(this.path[0].y - this.pos.y) < 1.1) this.path.shift();
      if (this.path.length) goal = this.path[0];
    } else this.path.length = 0;
    // 이동
    const vel = this.c.vel;
    if (goal && speed > 0) {
      let gx = goal.x - this.pos.x, gz = goal.z - this.pos.z; const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
      if (this.detour > 0) { this.detour -= dt; const a = this.detourDir * 1.1, c = Math.cos(a), s = Math.sin(a); [gx, gz] = [gx * c - gz * s, gx * s + gz * c]; }
      // 분리
      for (const o of this.mgr.list) { if (o === this || o.dead) continue; const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z, od = ox * ox + oz * oz; if (od < 0.5 && od > 1e-6 && Math.abs(o.pos.y - this.pos.y) < 1) { const k = (0.5 - od) * 2.2 / Math.sqrt(od); gx += ox * k; gz += oz * k; } }
      const want = Math.atan2(gx, gz);
      this.yaw = turn(this.yaw, want, (this.runner && this.state === 'chase' ? 6 : 3) * dt);
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), align = clamp(fx * gx + fz * gz, 0.2, 1);
      const sv = speed * align * (gl < 0.6 ? gl / 0.6 : 1);
      vel.x = damp(vel.x, fx * sv, 6, dt); vel.z = damp(vel.z, fz * sv, 6, dt);
    } else { vel.x = damp(vel.x, 0, 8, dt); vel.z = damp(vel.z, 0, 8, dt); }
    const ox = this.pos.x, oz = this.pos.z, oy = this.pos.y;
    g.col.move(this.c, dt);
    const moved = Math.hypot(this.pos.x - ox, this.pos.z - oz);
    // 문 앞이면 부수기
    if (this.c.blocked && this.c.hitBox && this.c.hitBox.door && this.c.hitBox.door.closed && (this.state === 'chase' || this.state === 'investigate')) { this.state = 'bang'; this.door = this.c.hitBox.door; this.atkT = 0; }
    if (speed > 0.3 && moved < speed * dt * 0.25) { this.stuckT += dt; if (this.stuckT > 0.6) { this.detour = 0.9; this.detourDir = Math.random() < 0.5 ? 1 : -1; this.stuckT = 0; } } else this.stuckT = 0;
    st.speed = Math.hypot(vel.x, vel.z); st.vy = (this.pos.y - oy) / Math.max(dt, 1e-3); st.reach = damp(st.reach, reach, 3, dt); st.agit = damp(st.agit, agit, 2, dt);
    if (this.state !== 'eat') st.mode = 'loco';
    if (this.state !== 'attack' && this.state !== 'bang') st.atk = 0;
    // 소리
    this.groanT -= dt;
    if (this.groanT < 0 && d < 70) { this.groanT = (this.state === 'chase' ? 1.8 : 5) + Math.random() * 5; g.audio.play(this.state === 'chase' ? (this.runner ? 'zscream' : 'zgrowl') : 'groan', { pos: this.eye.clone(), pitch: 0.85 + (this.id % 7) * 0.05 }); }
    if (st.speed > 0.4 && d < 25) { this.stepAcc = (this.stepAcc || 0) + st.speed * dt; if (this.stepAcc > (this.runner ? 1.2 : 0.65)) { this.stepAcc = 0; g.audio.play('zstep', { pos: this.pos, vol: this.runner ? 0.6 : 0.35, drag: !this.runner }); } }
    this.anim(dt);
  }
  alert() { this.game.audio.play(this.runner ? 'zscream' : 'zgrowl', { pos: this.eye.clone(), pitch: 0.9 + (this.id % 5) * 0.05 }); this.groanT = 2; }
  anim(dt, force) {
    const d = this.pos.distanceTo(this.game.camera.position);
    this.animAcc += dt;
    const every = d > 70 ? 4 : d > 35 ? 2 : 1;
    if (force || (this.mgr.frame + this.id) % every === 0) { this.h.update(this.animAcc); this.animAcc = 0; }
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw;
    this.mesh.castShadow = d < 40;
  }
  hear(p, r) {
    if (this.dead || this.state === 'chase' || this.state === 'attack' || this.state === 'bang') return;
    const d = this.pos.distanceTo(p); if (d > r) return;
    if (this.state === 'eat' && d > r * 0.5) return;
    this.state = 'investigate'; this.goal = p.clone(); this.stateT = 20;
    if (Math.random() < 0.5) this.alert();
  }
  dispose() { this.game.scene.remove(this.mesh); }
}
function turn(a, b, k) { let d = ((b - a + Math.PI) % (Math.PI * 2)); if (d < 0) d += Math.PI * 2; d -= Math.PI; return a + clamp(d, -k, k); }

// 시민 (인트로 도주 등)
export class Civilian {
  constructor(game, x, y, z, idx, path) {
    this.game = game; this.h = new Human('civ', idx); this.mesh = this.h.mesh;
    this.c = { pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), r: 0.3, h: 1.7, step: 0.45, onGround: true };
    this.pos = this.c.pos; this.path = path || []; this.yaw = 0; this.dead = false; this.speed = 5.2; this.h.st.fear = 1; this.deadT = 0; this.screamT = 0;
    game.scene.add(this.mesh); this.mesh.position.copy(this.pos);
  }
  update(dt) {
    const h = this.h;
    if (this.dead) { this.deadT += dt; h.update(dt); this.mesh.position.copy(this.pos); if (this.turnAt && this.deadT > this.turnAt) { this.turnAt = 0; this.game.zombies.spawn(this.pos.x, this.pos.y, this.pos.z, { kind: 'civ', variant: this.idx, rise: true, yaw: this.yaw, noDespawn: true }); this.dispose(); this.gone = true; } return; }
    const goal = this.path[0];
    if (goal) {
      const dx = goal.x - this.pos.x, dz = goal.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.8) this.path.shift();
      this.yaw = turn(this.yaw, Math.atan2(dx, dz), 8 * dt);
      this.c.vel.x = Math.sin(this.yaw) * this.speed; this.c.vel.z = Math.cos(this.yaw) * this.speed;
    } else { this.c.vel.x = damp(this.c.vel.x, 0, 5, dt); this.c.vel.z = damp(this.c.vel.z, 0, 5, dt); }
    this.game.col.move(this.c, dt);
    h.st.speed = Math.hypot(this.c.vel.x, this.c.vel.z); h.update(dt);
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw;
    this.screamT -= dt; if (this.screamT < 0) { this.screamT = 1.5 + Math.random() * 2; this.game.audio.play('scream', { pos: this.pos.clone().setY(this.pos.y + 1.6), female: this.h.v.fem }); }
  }
  kill(turnAfter = 0) {
    this.dead = true; this.h.setDead(1); this.c.vel.set(0, 0, 0);
    this.game.audio.play('scream', { pos: this.pos.clone().setY(this.pos.y + 1.2), female: this.h.v.fem, long: true });
    this.game.audio.play('bodyfall', { pos: this.pos, delay: 0.5 }); this.game.fx.blood(this.pos.clone().setY(this.pos.y + 1), new THREE.Vector3(0, 1, 0), 20);
    if (turnAfter) { this.turnAt = turnAfter; }
  }
  dispose() { this.game.scene.remove(this.mesh); }
}

export class ZombieManager {
  constructor(game) { this.game = game; this.list = []; this.civs = []; this.max = 30; this.autoSpawn = false; this.spawnT = 0; this.frame = 0; }
  spawn(x, y, z, o) { const zz = new Zombie(this, x, y, z, o); this.list.push(zz); return zz; }
  civ(x, y, z, idx, path) { const c = new Civilian(this.game, x, y, z, idx, path); c.idx = idx; this.civs.push(c); return c; }
  noise(p, r) { for (const z of this.list) z.hear(p, r); }
  update(dt) {
    this.frame++;
    const g = this.game, P = g.player, pp = P.vehicle ? P.vehicle.pos : P.pos;
    for (const z of this.list) z.update(dt);
    for (const c of this.civs) c.update(dt);
    this.civs = this.civs.filter(c => !c.gone);
    // 제거: 오래된 시체 / 너무 먼 좀비
    this.list = this.list.filter(z => {
      const far = z.pos.distanceTo(pp);
      if ((z.dead && z.deadT > 90) || (!z.noDespawn && !z.scripted && far > 170 && z.state !== 'chase')) { z.dispose(); return false; }
      return true;
    });
    // 주변 개체 수 유지
    if (!this.autoSpawn) return;
    this.spawnT -= dt; if (this.spawnT > 0) return; this.spawnT = 0.6;
    const alive = this.list.filter(z => !z.dead).length, u = g.world.urbanAt(pp.x, pp.z);
    const want = Math.round(this.max * (0.25 + u * 0.9) * (g.night > 0.5 ? 1.35 : 1));
    if (alive >= want) return;
    const pts = g.world.spawnPointsNear(pp.x, pp.z, 45, 115); if (!pts.length) return;
    const fwd = P.forward();
    for (let tries = 0; tries < 6; tries++) {
      const s = pick(Math.random, pts), dx = s[0] - pp.x, dz = s[1] - pp.z, d = Math.hypot(dx, dz);
      if ((dx * fwd.x + dz * fwd.z) / d > 0.3 && d < 80) continue;
      const y = g.col.groundAt(s[0], s[1], 1e4, 0, 0.2);
      if (y < -0.3) continue;
      const eat = Math.random() < 0.12;
      const z = this.spawn(s[0], y, s[1], { state: eat ? 'eat' : 'idle' });
      if (eat && g.world.corpseG) { const m = new THREE.Mesh(g.world.corpseG[0], g.world.mats.corpse); m.position.set(s[0] + Math.sin(z.yaw) * 0.9, y + 0.05, s[1] + Math.cos(z.yaw) * 0.9); m.rotation.y = z.yaw + 1.2; g.scene.add(m); z.corpse = m; const old = z.dispose.bind(z); z.dispose = () => { old(); g.scene.remove(m); }; }
      if (Math.random() < 0.3) { for (let k = 0; k < 2 + Math.random() * 3; k++) this.spawn(s[0] + (Math.random() - 0.5) * 6, y, s[1] + (Math.random() - 0.5) * 6, { state: 'idle' }); }
      break;
    }
  }
  // 광선 사격 판정
  raycast(o, dir, maxD) {
    let best = null, bd = maxD;
    for (const z of this.list) {
      if (z.dead && z.deadT > 1.5) continue;
      _a.subVectors(z.pos, o); const t = _a.dot(dir); if (t < 0 || t > bd + 1) continue;
      if (_a.lengthSq() - t * t > 4) continue;
      for (const s of z.h.spheres()) {
        _b.subVectors(s.c, o); const tc = _b.dot(dir); if (tc < 0) continue;
        const d2 = _b.lengthSq() - tc * tc; if (d2 > s.r * s.r) continue;
        const th = tc - Math.sqrt(s.r * s.r - d2);
        if (th < bd) { bd = th; best = { z, part: s.part, t: th }; }
      }
    }
    return best;
  }
  melee(o, dir, range, arc) {
    const hits = [];
    for (const z of this.list) {
      if (z.dead) continue;
      _a.set(z.pos.x - o.x, 0, z.pos.z - o.z); const d = _a.length(); if (d > range + 0.35 || Math.abs(z.pos.y + 1 - o.y) > 1.6) continue;
      _a.divideScalar(d || 1); const dot = _a.x * dir.x + _a.z * dir.z; if (dot < Math.cos(arc)) continue;
      const head = o.y + dir.y * d > z.pos.y + 1.45; hits.push({ z, d, part: head ? 'head' : 'body' });
    }
    return hits.sort((a, b) => a.d - b.d);
  }
  runOver(pos, f, speed, veh) {
    for (const z of this.list) {
      if (z.dead) continue; const dx = z.pos.x - pos.x, dz = z.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d > 2.6 || Math.abs(z.pos.y - pos.y) > 1.5) continue;
      if ((dx * f.x + dz * f.z) * Math.sign(speed) < 0.4) continue;
      z.hp = 0; z.die(f.clone().multiplyScalar(Math.sign(speed)), 'body'); z.c.vel.copy(f).multiplyScalar(speed * 0.6);
      this.game.audio.play('carHit', { pos: z.pos }); this.game.fx.blood(z.pos.clone().setY(z.pos.y + 1), f, 25); veh.hp -= 2; this.game.player.shake(0.4);
    }
  }
  clear() { this.list.forEach(z => z.dispose()); this.list = []; this.civs.forEach(c => c.dispose()); this.civs = []; }
}
