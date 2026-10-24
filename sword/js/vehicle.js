// SKY BLADE — 탈것 운전 (승용차·택시·버스·전동차/열차)
//  B (터치: 탑승 버튼): 가까운 차나 열차에 타고 내림
//  차: W/S·조이스틱 위아래 = 가속/브레이크(후진), A/D·조이스틱 좌우 = 조향, Shift·부스트 = 더 빠르게
//      지형·다리 위를 달리고, 건물에 세게 부딪히면 부서짐. 너무 급하게 꺾으면 전복
//  열차: W/S = 가속/감속, 좌우 = 갈림길에서 갈 방향, 부스트 = 최고 속도↑. 곡선에서 너무 빠르면 탈선
import * as THREE from 'three';
import { origin } from './frame.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const VMAX = { car: 42, taxi: 42, bus: 26 };
const _cars = [];

export class Drive {
  constructor(game) {
    this.game = game;
    this.v = null;          // { kind: 'car'|'train', o | T, ... }
    this.lastLook = 0;
  }
  get active() { return !!this.v; }

  // 가까운 탈것에 타기 / 내리기
  toggle() {
    const G = this.game, P = G.player;
    if (this.v) { this.exit(); return; }
    const town = G.life && G.life.town;
    if (!town || P.mode === 'dig' || P.hidden || P.onPlanet) { G.toast && G.toast('근처에 탈것이 없음'); return; }
    const px = P.pos.x + origin.x, py = P.pos.y + origin.y, pz = P.pos.z + origin.z;
    let best = null, bd = 8;
    for (const o of town.cars) {
      if (!o.alive || o.hidden) continue;
      const d = Math.hypot(o.x - px, o.y + 1 - py, o.z - pz);
      if (d < bd) { bd = d; best = { kind: 'car', o }; }
    }
    for (const T of town.trains) {
      if (!T.alive || T.derailed) continue;
      for (const c of town.trainCars(T, _cars)) {
        if (c.tunnel) continue;
        const d = Math.hypot(c.x - px, c.y + 2 - py, c.z - pz);
        if (d < Math.max(bd, 12)) { bd = d; best = { kind: 'train', T }; }
      }
    }
    if (!best) { G.toast && G.toast('근처에 탈것이 없음 (차나 열차 가까이에서 B)'); return; }
    if (best.kind === 'car') {
      const o = best.o;
      if (o.broken || o.st === 'fly') { G.toast && G.toast('부서진 차는 탈 수 없음'); return; }
      o.st = 'player'; o.v = 0;
      this.v = { kind: 'car', o, x: o.x, y: o.y, z: o.z, h: o.h, sp: 0, vy: 0, air: false, roll: 0, sinkT: 0 };
      G.toast && G.toast(`${o.kind === 'bus' ? '버스' : o.kind === 'taxi' ? '택시' : '자동차'} 탑승 — W/S 가속·브레이크, A/D 조향, Shift 부스트, B 내리기`);
    } else {
      const T = best.T;
      T.player = true; T.steer = 0;
      this.v = { kind: 'train', T };
      G.toast && G.toast(`${T.kind === 'sub' ? '전동차' : '열차'} 운전 — W/S 가속·감속, A/D 갈림길 방향, Shift 부스트 (곡선에서 너무 빠르면 탈선!), B 내리기`);
    }
    P.mode = 'drive'; P.trick = null; P.speedLock = 0; P.autopilot = false;
    P.avatar.root.visible = false;
    if (G.rig) { this.rigZoom = G.rig.zoom; G.rig.zoom = this.v.kind === 'train' ? 24 : this.v.o.kind === 'bus' ? 13 : 8.5; }
    G.audio && G.audio.play('clang', 0.3);
  }

  exit(eject = null) {
    const G = this.game, P = G.player, V = this.v;
    if (!V) return;
    this.v = null;
    let x, y, z, h;
    if (V.kind === 'car') {
      const o = V.o;
      if (o.st === 'player') { o.st = o.broken ? 'wreck' : 'stop'; o.t = 0; o.v = 0; }
      x = V.x; y = V.y; z = V.z; h = V.h;
    } else {
      const T = V.T;
      T.player = false;
      x = T.x; z = T.z; h = Math.atan2(T.tx * T.dir, T.tz * T.dir);
      y = (T.hist.length ? T.hist[T.hist.length - 1][1] : G.terrain.heightAt(x, z));
    }
    // 옆으로 내림 (튕겨 나가면 그 속도로)
    const side = V.kind === 'train' ? 3.4 : 2.2;
    const sx = x + Math.cos(h) * side, sz = z - Math.sin(h) * side;
    const gy = Math.max(G.terrain.heightAt(sx, sz), Math.min(y, G.city && G.city.roofAt ? G.city.roofAt(sx, sz) : -Infinity));
    P.pos.set(sx - origin.x, Math.max(gy, y) + 0.2 - origin.y, sz - origin.z);
    P.prevPos.copy(P.pos);
    if (eject) { P.vel.copy(eject); P.mode = 'air'; } else { P.vel.set(0, 0, 0); P.mode = 'air'; }
    P.coyote = 0;
    P.avatar.root.visible = true;
    if (G.rig && this.rigZoom) G.rig.zoom = this.rigZoom;
  }

  // 고정 스텝 (player.step 대신)
  step(dt, input, cam) {
    const V = this.v, G = this.game, P = this.game.player;
    if (!V) { P.mode = 'air'; return; }
    const I = input.state;
    const thr = clamp(I.moveY, -1, 1), steer = clamp(I.moveX, -1, 1), boost = !!I.boost;
    if (V.kind === 'train') this._train(dt, V, thr, steer, boost);
    else this._car(dt, V, thr, steer, boost);
    if (!this.v) return;
    // 카메라는 진행 방향 뒤로 천천히 따라옴 (마우스로 둘러보면 잠시 그대로)
    if (Math.abs(I.lookDX || 0) + Math.abs(I.lookDY || 0) > 0.01) this.lastLook = 1.5;
    this.lastLook -= dt;
    if (this.lastLook <= 0 && G.rig) {
      const h = this.heading;
      let d = h - G.rig.yaw; d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      G.rig.yaw += d * Math.min(1, dt * 2.5);
    }
  }

  _car(dt, V, thr, steer, boost) {
    const G = this.game, P = G.player, T = G.terrain, C = G.city, o = V.o;
    const vmax = (VMAX[o.kind] || 40) * (boost ? 2.2 : 1);
    const acc = (o.kind === 'bus' ? 3.5 : 6.5) * (boost ? 2.2 : 1);
    if (o.broken) thr = 0;
    if (!V.air) {
      if (thr > 0.05) V.sp += (V.sp < -0.5 ? 14 : acc) * thr * dt;
      else if (thr < -0.05) V.sp -= (V.sp > 0.5 ? 14 : acc * 0.6) * -thr * dt;
      else V.sp -= Math.sign(V.sp) * Math.min(Math.abs(V.sp), 1.5 * dt);
      V.sp -= V.sp * Math.abs(V.sp) * 0.0005 * dt;   // 공기 저항
      V.sp = clamp(V.sp, -12, vmax);
      // 조향: 저속에선 덜, 고속에선 각속도 제한
      // 보통은 타이어 접지 한계(옆 가속 약 9 m/s²) 안에서만 꺾이고, 부스트 중 급조향은 한계를 넘어 전복될 수 있음
      const latMax = (o.kind === 'bus' ? 6 : 9) * (boost ? 1.8 : 1);
      const yawRate = -steer * clamp(V.sp / 5, -1, 1) * Math.min(o.kind === 'bus' ? 0.9 : 1.4, latMax / Math.max(1, Math.abs(V.sp)));
      V.h += yawRate * dt;
      // 너무 급하게 꺾으면 전복
      const lat = Math.abs(V.sp * yawRate);
      if (lat > (o.kind === 'bus' ? 7.5 : 12.5) && Math.abs(V.sp) > 25) { this._crash(V, 'roll'); return; }
    }
    const fx = Math.sin(V.h), fz = Math.cos(V.h);
    const nx = V.x + fx * V.sp * dt, nz = V.z + fz * V.sp * dt;
    // 땅·다리 위 높이, 벽 판정
    const gy = T.heightAt(nx, nz);
    const roof = C && C.roofAt ? C.roofAt(nx + fx * 2, nz + fz * 2) : -Infinity;
    if (roof > V.y + 1.6 && roof > gy + 1.6) {
      // 건물 벽
      if (Math.abs(V.sp) > 18) { this._crash(V, 'wall'); return; }
      V.sp = -V.sp * 0.3;
      G.audio && G.audio.play('clang', 0.6);
      G.hooks && G.hooks.shake(0.3);
    } else {
      V.x = nx; V.z = nz;
    }
    const deck = C && C.roofAt ? C.roofAt(V.x, V.z) : -Infinity;
    const surf = deck > gy && deck < V.y + 1.2 ? deck : gy;
    if (V.y > surf + 0.25) {
      V.air = true;
      V.vy -= 9.81 * dt;
      V.y += V.vy * dt;
      if (V.y <= surf) { if (V.vy < -14) this._crash(V, 'land'); V.y = surf; V.vy = 0; V.air = false; }
    } else {
      // 언덕을 넘으면 뜰 수도 있음 (경사가 갑자기 내려가면)
      const slope = (surf - V.y) / Math.max(1e-3, Math.abs(V.sp) * dt);
      V.vy = V.sp > 0 ? clamp(slope, -30, 30) * Math.abs(V.sp) * 0.2 : 0;
      V.y = surf; V.air = false;
    }
    if (!this.v) return;
    // 물: 깊으면 가라앉으며 멈춤
    const wl = T.waterLevelAt(V.x, V.z);
    if (wl > V.y + 0.8) {
      V.sp *= Math.exp(-2.5 * dt);
      V.sinkT += dt;
      if (V.sinkT > 0.05 && V.sinkT - dt <= 0.05) { G.fx && G.fx.splash && G.fx.splash(V.x - origin.x, wl - origin.y, V.z - origin.z, 2); G.toast && G.toast('차가 물에 빠짐! (B 로 탈출)'); }
    } else V.sinkT = 0;
    o.x = V.x; o.y = V.y; o.z = V.z; o.h = V.h; o.v = V.sp;
    o.rx = V.air ? clamp(-V.vy * 0.02, -0.4, 0.4) : 0;
    this.heading = V.sp >= 0 ? V.h : V.h;
    P.pos.set(V.x - origin.x, V.y + (o.kind === 'bus' ? 2.6 : 1.3) - origin.y, V.z - origin.z);
    P.vel.set(fx * V.sp, V.vy, fz * V.sp);
    P.speed = Math.abs(V.sp);
  }

  _crash(V, why) {
    const G = this.game, o = V.o, town = G.life && G.life.town;
    const sp = Math.abs(V.sp);
    const fx = Math.sin(V.h), fz = Math.cos(V.h);
    o.st = 'fly'; o.t = 0;
    o.vx = fx * V.sp * 0.5; o.vz = fz * V.sp * 0.5; o.vy = 4 + sp * 0.12;
    o.wx = (Math.random() - 0.5) * 4; o.wz = why === 'roll' ? (V.sp > 0 ? 5 : -5) : (Math.random() - 0.5) * 6;
    if (town) town._wreck(o, sp > 30 || why === 'wall');
    G.hooks && G.hooks.shake(1);
    G.toast && G.toast(why === 'roll' ? '전복!' : why === 'land' ? '추락!' : '충돌! 차가 부서짐');
    this.exit(new THREE.Vector3(fx * sp * 0.6, 6 + sp * 0.1, fz * sp * 0.6));
  }

  _train(dt, V, thr, steer, boost) {
    const G = this.game, P = G.player, T = V.T, town = G.life && G.life.town;
    if (!T.alive || T.derailed) { this.exit(); return; }
    const vmax = boost ? 95 : 34;
    if (thr > 0.05) T.v += (boost ? 5 : 1.6) * thr * dt;
    else if (thr < -0.05) T.v -= 3.5 * -thr * dt;
    else T.v -= Math.min(T.v, 0.2 * dt);
    T.v = clamp(T.v, 0, vmax);
    T.steer = steer;
    town._trainStep(T, T.v * dt);
    // 탈선: 곡선 원심 가속도가 한계를 넘으면
    const k = town.trainCurv(T);
    const lat = T.v * T.v * Math.abs(k);
    if (lat > 7.5 && T.v > 22) {
      const fx = T.tx * T.dir, fz = T.tz * T.dir;
      town.derail(T);
      G.hooks && G.hooks.shake(1);
      G.toast && G.toast('탈선!');
      this.exit(new THREE.Vector3(fx * T.v * 0.7, 8, fz * T.v * 0.7));
      return;
    }
    const H = T.hist, last = H[H.length - 1];
    const y = last ? last[1] : G.terrain.heightAt(T.x, T.z);
    this.heading = Math.atan2(T.tx * T.dir, T.tz * T.dir);
    P.pos.set(T.x - origin.x, y + 3.2 - origin.y, T.z - origin.z);
    P.vel.set(T.tx * T.dir * T.v, 0, T.tz * T.dir * T.v);
    P.speed = T.v;
    // 앞을 막은 사람·차
    const pa = { x: T.x, y, z: T.z };
    if (T.v > 5) {
      for (const o of town.people) if (o.alive && !o.dead && Math.hypot(o.x - pa.x, o.z - pa.z) < 3 && Math.abs(o.y - y) < 3) { town._fling(o, pa.x - T.tx * T.dir, pa.z - T.tz * T.dir, T.v); town._die(o); }
      for (const o of town.cars) if (o.alive && !o.hidden && o.st !== 'player' && Math.hypot(o.x - pa.x, o.z - pa.z) < 3.5 && Math.abs(o.y - y) < 3) { town._fling(o, pa.x - T.tx * T.dir, pa.z - T.tz * T.dir, T.v * 0.7); town._wreck(o, T.v > 20); }
    }
  }
}
