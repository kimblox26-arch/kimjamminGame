// 플레이어: 사진과 같은 캐릭터, 1인칭 전용. 로블록스와 같은 이동 값(걷기 16, 점프 50, 중력 196.2)
import * as THREE from 'three';
import { G } from './game.js';
import { Avatar, EYE_Y } from './avatar.js';
import { ViewModel } from './viewmodel.js';
import { makeWeapon, fireHitscan, shootArrow } from './weapons.js';
import { Sound } from './audio.js';
import { clamp, damp, lerp, rand, rayCapsule } from './util.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WALK = 16, JUMP = 50, GRAV = 196.2;
const ME = { f0: 125, fmt: 1 };

export class Player {
  constructor(camera) {
    this.cam = camera; this.name = '플레이어';
    this.pos = V(); this.vel = V(); this.knockV = V();
    this.vm = new ViewModel();
    this.body = new Avatar(this);
    this.body.setHeadVisible(false);
    this.body.parts.forEach((m) => (m.userData = { kind: 'self' }));
    this.seatCD = 0;
    this.spawn();
  }
  spawn() {
    this.pos.copy(G.world.spawn); this.vel.set(0, 0, 0); this.knockV.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0; this.carLook = 0;
    this.health = 100; this.alive = true; this.deadT = 0; this.car = null; this.onGround = true;
    this.inv = [makeWeapon('bow'), makeWeapon('gun')];
    this.eq = -1; this.vm.setWeapon(null);
    this.fireCD = 0; this.draw = 0; this.lastShot = -99;
    this.bob = 0; this.bobAmp = 0; this.dip = 0; this.recoil = 0; this.step = 0;
    this.cam.rotation.z = 0;
    if (G.ui.setHotbar) G.ui.setHotbar(this.inv, this.eq);
  }
  eye() { return this.car ? this.cam.position.clone() : V(this.pos.x, this.pos.y + EYE_Y, this.pos.z); }
  weapon() { return this.eq >= 0 ? this.inv[this.eq] : null; }
  get moving() { return Math.hypot(this.vel.x, this.vel.z) > 3; }
  shotRecently() { return G.time - this.lastShot < 2; }
  aimingAt(npc) {
    if (!this.weapon() || this.car || !this.alive) return false;
    const to = npc.chest().sub(this.eye()), d = to.length();
    if (d > 110) return false;
    to.divideScalar(d);
    return this.cam.getWorldDirection(V()).dot(to) > Math.cos(Math.atan2(2.6, d) + 0.015);
  }
  rayHit(o, d) {
    if (!this.alive) return Infinity;
    if (this.car) { const e = this.cam.position; return rayCapsule(o, d, V(e.x, e.y - 2.2, e.z), e, 1.0); }
    return rayCapsule(o, d, V(this.pos.x, this.pos.y + 0.8, this.pos.z), V(this.pos.x, this.pos.y + 4.8, this.pos.z), 1.1);
  }
  hurt(dmg, from, attacker) {
    if (!this.alive) return;
    this.health -= dmg;
    G.ui.damage(dmg);
    Sound.hurt();
    if (this.health <= 0) this.die();
  }
  knock(v) { this.knockV.x += v.x; this.knockV.z += v.z; if (this.onGround) this.vel.y = v.y; this.onGround = false; }
  die() {
    this.alive = false; this.health = 0; this.deadT = 0;
    if (this.car) this.exitCar();
    this.eq = -1; this.vm.setWeapon(null); this.draw = 0;
    G.ui.setHotbar(this.inv, this.eq);
    Sound.voice('death', null, ME);
  }
  give(w) {
    if (this.inv.length >= 9) return false;
    this.inv.push(w);
    G.ui.setHotbar(this.inv, this.eq);
    return true;
  }
  takeWeapon() {
    const w = this.weapon();
    if (!w) return null;
    this.inv.splice(this.eq, 1);
    this.eq = -1; this.draw = 0;
    this.vm.setWeapon(null);
    G.ui.setHotbar(this.inv, this.eq);
    return w;
  }
  // 로블록스 핫바: 같은 칸을 다시 누르면 내려놓기
  equip(i) {
    if (this.car || !this.alive) return;
    if (i === this.eq || i >= this.inv.length) i = -1;
    this.eq = i; this.draw = 0;
    this.vm.setWeapon(i >= 0 ? this.inv[i].def.id : null);
    G.ui.setHotbar(this.inv, this.eq);
  }

  update(dt, inp) {
    const sens = G.settings.sens;
    if (!this.alive) {
      this.deadT += dt;
      this.cam.position.y = damp(this.cam.position.y, this.pos.y + 1, 3, dt);
      this.cam.rotation.z = damp(this.cam.rotation.z, 1.1, 3, dt);
      this.cam.rotation.x = damp(this.cam.rotation.x, -0.3, 2, dt);
      if (this.deadT > 5) this.spawn();
      return;
    }
    // 로블록스 기본 체력 회복
    if (this.health < 100) this.health = Math.min(100, this.health + dt);
    if (inp.slot >= 0) this.equip(inp.slot);
    this.seatCD -= dt;
    if (this.car) { this.updateCar(dt, inp, sens); return; }

    this.yaw -= inp.lookX * sens;
    this.pitch = clamp(this.pitch - inp.lookY * sens, -1.52, 1.52);
    const sp = WALK * (this.draw > 0 ? 0.6 : 1);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const wx = (fx * inp.my + rx * inp.mx) * sp, wz = (fz * inp.my + rz * inp.mx) * sp;
    const k = this.onGround ? 12 : 3;
    this.vel.x = damp(this.vel.x, wx, k, dt); this.vel.z = damp(this.vel.z, wz, k, dt);
    this.knockV.multiplyScalar(Math.exp(-5 * dt));
    if (inp.jump && this.onGround) { this.vel.y = JUMP; this.onGround = false; }
    this.vel.y -= GRAV * dt;
    const wasAir = !this.onGround, vy = this.vel.y;
    this.pos.x += (this.vel.x + this.knockV.x) * dt;
    this.pos.z += (this.vel.z + this.knockV.z) * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= 0) {
      if (wasAir && vy < -35) { this.dip = Math.min(1, -vy / 120); Sound.land(Math.min(0.8, -vy / 150)); }
      this.pos.y = 0; this.vel.y = 0; this.onGround = true;
    } else this.onGround = false;
    G.world.collide(this.pos, 1.0, 5, this.vel);
    // 자동차: 운전석에 닿으면 앉는다 (로블록스 VehicleSeat 와 같은 방식)
    for (const c of G.cars) {
      const rel = this.pos.clone().sub(c.pos), f = c.forward(), r = c.right();
      const lz = rel.dot(f), lx = rel.dot(r), ex = 4.6 - Math.abs(lx), ez = 7.9 - Math.abs(lz);
      if (ex > 0 && ez > 0 && this.pos.y < 6.5) {
        if (!c.driver && this.seatCD <= 0 && Math.abs(lz + 0.9) < 2.6) { this.enterCar(c); return; }
        if (ex < ez) this.pos.addScaledVector(r, Math.sign(lx || 1) * ex); else this.pos.addScaledVector(f, Math.sign(lz || 1) * ez);
      }
    }

    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.bobAmp = damp(this.bobAmp, this.onGround ? clamp(hs / WALK, 0, 1.2) : 0, 10, dt);
    this.bob += dt * hs * 0.5;
    const st = Math.floor(this.bob / Math.PI);
    if (st !== this.step) { this.step = st; if (this.onGround && hs > 4) Sound.step(0.12 + hs * 0.004); }
    this.dip = damp(this.dip, 0, 6, dt);
    this.recoil = damp(this.recoil, 0, 10, dt);
    const c = this.cam;
    c.position.set(this.pos.x, this.pos.y + EYE_Y + Math.abs(Math.sin(this.bob)) * 0.2 * this.bobAmp - 0.1 * this.bobAmp - this.dip * 0.9, this.pos.z);
    c.rotation.set(this.pitch + this.recoil, this.yaw, Math.sin(this.bob) * 0.005 * this.bobAmp);
    if (c.fov !== 70) { c.fov = 70; c.updateProjectionMatrix(); }

    this.updateWeapon(dt, inp);
    this.vm.update(dt, { lookX: inp.lookX * sens, lookY: inp.lookY * sens, bob: this.bob, bobAmp: this.bobAmp, dip: this.dip, draw: this.draw });
  }

  // 도구 사용: 총은 누를 때 한 발, 활은 누르고 있으면 당기고 놓으면 쏜다
  updateWeapon(dt, inp) {
    this.fireCD -= dt;
    const w = this.weapon();
    if (!w) return;
    const d = w.def;
    if (d.type === 'gun') {
      if (inp.firePressed && this.fireCD <= 0) this.shoot(w);
    } else {
      if (inp.fire && this.fireCD <= 0) { if (this.draw === 0) Sound.draw(); this.draw = Math.min(1, this.draw + dt / d.draw); }
      else if (this.draw > 0) { if (this.draw > 0.12) this.shootBow(w); this.draw = 0; }
    }
  }
  shoot(w) {
    const d = w.def;
    this.fireCD = d.rate; this.lastShot = G.time;
    this.cam.updateMatrixWorld();
    fireHitscan(this.cam.position.clone(), this.cam.getWorldDirection(V()), w, this);
    Sound.gun(null);
    this.pitch += 0.015; this.recoil += 0.035;
    this.vm.kick(0.035); this.vm.flash();
    G.emit({ type: 'shot', pos: this.pos.clone(), source: this });
  }
  shootBow(w) {
    const d = w.def, t = this.draw;
    this.cam.updateMatrixWorld();
    const dir = this.cam.getWorldDirection(V()), origin = this.cam.localToWorld(V(0, -0.15, -1.2));
    shootArrow(origin, dir, lerp(d.minSpd, d.maxSpd, t), lerp(d.minDmg, d.maxDmg, t * t), this);
    Sound.bow(null);
    this.fireCD = d.rate; this.lastShot = G.time;
    this.vm.release();
    G.emit({ type: 'shot', pos: this.pos.clone(), source: this, quiet: true });
  }

  enterCar(c) {
    this.car = c; c.driver = this;
    this.eq = -1; this.draw = 0; this.vm.setWeapon(null); G.ui.setHotbar(this.inv, this.eq);
    this.body.root.position.set(1.5, 0.84, -0.9); this.body.root.rotation.set(0, 0, 0);
    c.group.add(this.body.root);
    this.carLook = 0; this.pitch = -0.05;
    Sound.engineOn();
    G.ui.setCar(true);
  }
  // 로블록스처럼 점프하면 내린다
  exitCar() {
    const c = this.car;
    if (!c) return;
    c.driver = null; this.car = null;
    c.group.remove(this.body.root);
    const left = V(Math.cos(c.heading), 0, -Math.sin(c.heading));
    this.pos.copy(c.pos).addScaledVector(left, 5.5).setY(0);
    this.vel.set(0, JUMP * 0.6, 0); this.onGround = false;
    this.yaw = c.heading + Math.PI + this.carLook;
    this.seatCD = 1.5;
    Sound.engineOff();
    G.ui.setCar(false);
  }
  updateCar(dt, inp, sens) {
    const c = this.car;
    this.carLook = clamp(this.carLook - inp.lookX * sens, -2.3, 2.3);
    this.pitch = clamp(this.pitch - inp.lookY * sens, -1.2, 1.0);
    this.pos.copy(c.pos);
    this.body.update(dt, { mode: 'drive', steer: c.steer });
    c.group.updateMatrixWorld();
    this.cam.position.copy(c.group.localToWorld(V(1.5, 0.84 + EYE_Y, -0.6)));
    this.cam.rotation.set(this.pitch, c.heading + Math.PI + this.carLook, 0);
    Sound.engine(Math.abs(c.speed) / 95, inp.my);
    if (inp.jumpPressed) this.exitCar();
  }
}
