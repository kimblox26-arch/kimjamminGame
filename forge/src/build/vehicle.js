// 차량 시스템: 바퀴가 달린 구조물 → 레이캐스트 서스펜션 차량. 운전석·엔진·추진기·헤드라이트
import * as THREE from 'three';
import { toV, toQ, rv, clamp, damp } from '../core/util.js';
import { GROUP, groups } from '../physics.js';

const _v = new THREE.Vector3(), _q = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const TOP = { single: 17, motor: 50, v8: 62 }; // 최고속 (m/s)

class Rig {
  constructor(sys, S) {
    this.sys = sys; this.S = S; this.ctrl = null; this.wheels = []; this.steer = 0; this.lightsOn = false; this.driverCol = null;
    this.input = { throttle: 0, steer: 0, hand: false, boost: false };
    const ps = [...S.parts];
    this.seat = ps.find((p) => p.def.mech === 'seat') || null;
    this.engines = ps.filter((p) => p.def.mech === 'engine');
    this.thrusters = ps.filter((p) => p.def.mech === 'thruster');
    this.lights = ps.filter((p) => p.def.mech === 'light');
    const wheelParts = ps.filter((p) => p.def.mech === 'wheel');
    this.power = this.engines.reduce((s, e) => s + e.def.power * 0.85, 0);
    this.vmax = this.engines.reduce((m, e) => Math.max(m, TOP[e.def.kind] || 30), 0);
    this.kind = this.engines.some((e) => e.def.kind === 'v8') ? 'v8' : this.engines.some((e) => e.def.kind === 'motor') ? 'motor' : 'single';
    // 차량 좌표계 (몸체 로컬)
    if (this.seat) { this.F = new THREE.Vector3(0, 0, -1).applyQuaternion(this.seat.lq); this.U = Y.clone().applyQuaternion(this.seat.lq); }
    else {
      this.U = Y.clone().applyQuaternion(toQ(S.body.rotation()).invert());
      const a0 = wheelParts[0] ? X.clone().applyQuaternion(wheelParts[0].lq) : X.clone();
      this.F = new THREE.Vector3().crossVectors(this.U, a0).normalize();
    }
    this.D = this.U.clone().negate();
    this.axle = new THREE.Vector3().crossVectors(this.F, this.U).normalize();
    if (wheelParts.length && !S.anchored) {
      const ph = sys.ph, c = (this.ctrl = ph.world.createVehicleController(S.body));
      const proj = wheelParts.map((w) => w.lp.dot(this.F)), mean = proj.reduce((a, b) => a + b, 0) / proj.length;
      const spread = Math.max(...proj) - Math.min(...proj); this.base = Math.max(spread, 0.8);
      const mass = S.mass + (this.driving ? 75 : 0);
      wheelParts.forEach((w, i) => {
        const d = w.def, rest = d.susp, conn = w.lp.clone().addScaledVector(this.U, rest);
        c.addWheel(rv(conn), rv(this.D), rv(this.axle), rest, d.r);
        const k = 9.81 / (wheelParts.length * rest * 0.42);
        c.setWheelSuspensionStiffness(i, k);
        c.setWheelSuspensionCompression(i, 2 * Math.sqrt(k) * 0.32);
        c.setWheelSuspensionRelaxation(i, 2 * Math.sqrt(k) * 0.45);
        c.setWheelMaxSuspensionTravel(i, rest * 1.6);
        c.setWheelMaxSuspensionForce(i, mass * 9.81 * 6);
        c.setWheelFrictionSlip(i, d.r > 0.4 ? 2.4 : 1.9);
        c.setWheelSideFrictionStiffness(i, 0.9);
        const ql = w.lq.clone().invert();
        this.wheels.push({
          part: w, i, rest, front: spread > 0.2 && proj[i] > mean + spread * 0.2, rear: spread > 0.2 && proj[i] < mean - spread * 0.2,
          spinSign: Math.sign(X.clone().applyQuaternion(w.lq).dot(this.axle)) || 1,
          Dp: this.D.clone().applyQuaternion(ql), Up: this.U.clone().applyQuaternion(ql),
        });
      });
    }
    if (this.driving) this.addDriver();
  }
  // 전방 속도 (m/s, 몸체 로컬 F 기준)
  speed() { return toV(this.S.body.linvel(), _v).dot(this.F.clone().applyQuaternion(toQ(this.S.body.rotation(), _q))); }
  get driving() { return this.seat && this.sys.seat === this.seat; }
  addDriver() {
    if (this.driverCol || !this.seat) return;
    const R = this.sys.ph.R, p = this.seat.lp.clone().addScaledVector(this.U, 0.3);
    const d = R.ColliderDesc.ball(0.2).setTranslation(p.x, p.y, p.z).setMass(75).setCollisionGroups(groups(0x8000, 0));
    this.driverCol = this.sys.ph.world.createCollider(d, this.S.body);
  }
  removeDriver() { if (this.driverCol) { if (this.sys.ph.world.getCollider(this.driverCol.handle)) this.sys.ph.world.removeCollider(this.driverCol, true); this.driverCol = null; } }
  dispose() { this.removeDriver(); if (this.ctrl) { this.sys.ph.world.removeVehicleController(this.ctrl); this.ctrl = null; } this.setLights(false, true); }
  setLights(on, silent) { this.lightsOn = on; for (const l of this.lights) { if (l.lensMat) l.lensMat.emissiveIntensity = on ? 6 : 0.15; } }

  step(dt) {
    const S = this.S, b = S.body, inp = this.driving ? this.input : { throttle: 0, steer: 0, hand: !this.engines.length ? false : true, boost: false };
    if (S.anchored) return;
    const mass = b.mass();
    if (this.ctrl) {
      const c = this.ctrl, n = this.wheels.length, v = this.speed();
      let force = 0, brake = 0;
      const Ftrac = mass * 9.81 * 1.05;
      if (this.power > 0 && this.driving) {
        const fmax = Math.min(this.power / Math.max(Math.abs(v), 2.5), Ftrac);
        if (inp.throttle > 0) { if (v < -0.8) brake = 1; else force = fmax * clamp(1 - Math.pow(Math.max(v, 0) / this.vmax, 3), 0, 1); }
        else if (inp.throttle < 0) { if (v > 0.8) brake = 1; else force = -fmax * 0.6 * clamp(1 - Math.pow(Math.max(-v, 0) / (this.vmax * 0.3), 2), 0, 1); }
      } else if (this.driving && inp.throttle < 0 && Math.abs(v) > 0.3) brake = 1;
      const sm = Math.min(0.6, (this.base * 10) / Math.max(v * v, 1)); // 속도 감응 조향 (횡가속 ≈ 1g 한계)
      this.steer = damp(this.steer, inp.steer * sm, 6, dt);
      const brakeImp = (mass * 9.81 * 0.95 / n) * dt;
      for (const w of this.wheels) {
        c.setWheelEngineForce(w.i, force / n);
        c.setWheelSteering(w.i, w.front ? this.steer : 0);
        let br = brake ? brakeImp : force === 0 ? brakeImp * 0.02 : 0;
        if (inp.hand && (w.rear || !this.wheels.some((q) => q.rear))) br = brakeImp * 1.6;
        c.setWheelBrake(w.i, br);
      }
      c.updateVehicle(dt, undefined, groups(0xffff, GROUP.PART | GROUP.WORLD));
      // 공기 저항 (0.5·ρ·CdA·v²)
      const lv = toV(b.linvel()), sp = lv.length();
      if (sp > 1) { const cda = 0.45 + Math.cbrt(mass) * 0.05; b.applyImpulse(rv(lv.multiplyScalar((-0.5 * 1.2 * cda * sp * dt))), true); }
    }
    if (this.driving && inp.boost) {
      const bq = toQ(b.rotation()), bp = toV(b.translation());
      for (const t of this.thrusters) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(t.lq).applyQuaternion(bq).multiplyScalar(t.def.thrust * dt);
        const at = t.lp.clone().applyQuaternion(bq).add(bp);
        b.applyImpulseAtPoint(rv(dir), rv(at), true);
      }
    }
  }
  visuals() {
    if (!this.ctrl) { for (const w of this.wheels) { w.part.pivot.position.set(0, 0, 0); } return; }
    const c = this.ctrl;
    for (const w of this.wheels) {
      const sl = c.wheelSuspensionLength(w.i) ?? w.rest;
      w.part.pivot.position.copy(w.Dp).multiplyScalar(sl - w.rest);
      w.part.pivot.quaternion.setFromAxisAngle(w.Up, c.wheelSteering(w.i) || 0);
      w.part.spin.rotation.x = (c.wheelRotation(w.i) || 0) * w.spinSign;
    }
  }
}

export class VehicleSystem {
  constructor({ ph, mgr, sfx, fx, scene }) {
    this.ph = ph; this.mgr = mgr; this.sfx = sfx; this.fx = fx; this.scene = scene; this.rigs = new Set(); this.seat = null;
    mgr.onRig = (S) => this.rebuild(S);
    // 헤드라이트용 스포트라이트 풀 (조명 수 고정 → 셰이더 재컴파일 방지)
    this.spots = [];
    for (let i = 0; i < 4; i++) {
      const L = new THREE.SpotLight(0xfff2dd, 0, 70, 0.42, 0.55, 1.6); L.castShadow = false; scene.add(L, L.target); this.spots.push(L);
    }
    this.engineSnd = null; this.thrSnd = null;
  }
  rebuild(S) {
    if (S.rig) { S.rig.dispose(); this.rigs.delete(S.rig); S.rig = null; }
    if (!this.mgr.structs.has(S)) return;
    if (![...S.parts].some((p) => p.def.mech)) return;
    const r = new Rig(this, S); S.rig = r; this.rigs.add(r);
    if (this.seat && this.seat.s === S) r.addDriver();
  }
  rigOfSeat() { return this.seat?.s?.rig || null; }
  enter(seat) { this.seat = seat; const r = seat.s.rig; r?.addDriver(); if (r?.engines.length) this.sfx.play('ignite', { pos: seat.worldPos() }); }
  exit() { const r = this.rigOfSeat(); r?.removeDriver(); if (r) { r.input = { throttle: 0, steer: 0, hand: false, boost: false }; } this.seat = null; }
  step(dt) { for (const r of this.rigs) if (this.mgr.structs.has(r.S)) r.step(dt); }
  update(dt, input) {
    const r = this.rigOfSeat();
    if (this.seat && !this.seat.s) this.seat = null;
    if (r) {
      r.input.throttle = input.axis('KeyS', 'KeyW') + (input.touch.active ? -input.touch.my : 0);
      r.input.steer = input.axis('KeyD', 'KeyA') + (input.touch.active ? -input.touch.mx : 0);
      r.input.hand = input.down('Space'); r.input.boost = input.down('ShiftLeft') || input.down('ShiftRight');
      if (input.pressed('KeyL')) { r.setLights(!r.lightsOn); this.sfx.play('click'); }
      if (input.pressed('KeyH')) this.sfx.play('horn', { pos: this.seat.worldPos() });
    }
    for (const rig of this.rigs) rig.visuals();
    // 스포트라이트 배정
    let si = 0;
    for (const rig of this.rigs) if (rig.lightsOn) for (const l of rig.lights) {
      if (si >= this.spots.length) break;
      const L = this.spots[si++]; l.mesh.updateWorldMatrix(true, false);
      L.position.copy(l.toWorld(_v.set(0, 0, 0.08))); L.target.position.copy(l.toWorld(_v.set(0, -0.6, 10))); L.intensity = 220;
    }
    for (; si < this.spots.length; si++) this.spots[si].intensity = 0;
    // 엔진 / 추진기 사운드
    if (r && r.engines.length) {
      if (!this.engineSnd) this.engineSnd = this.sfx.loop('engine');
      const v = Math.abs(r.speed()), f = clamp(v / r.vmax, 0, 1), thr = Math.abs(r.input.throttle);
      let freq;
      if (r.kind === 'motor') freq = 60 + f * 900;
      else {
        const g = Math.min(4, Math.floor(f * 5)), fr = f * 5 - g, rpm = v < 0.5 ? 900 + thr * 2600 : 1400 + 4600 * (0.3 + 0.7 * fr) * (0.85 + thr * 0.15);
        freq = r.kind === 'v8' ? rpm / 15 : rpm / 120;
      }
      this.engineSnd?.set(r.kind === 'motor' ? 0.12 + thr * 0.15 : 0.35 + thr * 0.35, freq, thr);
    } else if (this.engineSnd) { this.engineSnd.stop(); this.engineSnd = null; }
    const boosting = r && r.input.boost && r.thrusters.length;
    if (boosting) { if (!this.thrSnd) this.thrSnd = this.sfx.loop('thruster'); this.thrSnd?.set(0.9 * Math.min(1, r.thrusters.length * 0.6)); }
    else if (this.thrSnd) { this.thrSnd.stop(); this.thrSnd = null; }
    if (boosting) for (const t of r.thrusters) this.fx.thrusterFlame(t, dt);
  }
  speedKmh() { const r = this.rigOfSeat(); if (!r) return 0; return Math.abs(r.ctrl ? r.speed() : toV(r.S.body.linvel()).length()) * 3.6; }
}
