// 자동차: 운전, 건물 충돌, NPC 들이받기, 쓰러진 몸 밀어내기
import * as THREE from 'three';
import { G } from './game.js';
import { rbox, mat, clamp, damp, rand } from './util.js';
import { Sound } from './audio.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const HW = 3.6, HL = 6.9;
let bloodMat = null;

export class Car {
  constructor(x, z, heading, color) {
    this.pos = V(x, 0, z); this.heading = heading; this.speed = 0; this.steer = 0; this.driver = null;
    this.vel = V(); this.spin = 0; this.blood = 0; this.crashCD = 0;
    const g = (this.group = new THREE.Group());
    const body = mat(color), dark = mat('#2a2c30'), grey = mat('#a3a8af'), seat = mat('#3a3d42');
    const glass = new THREE.MeshLambertMaterial({ color: '#a8d8ff', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    const add = (geo, m, x, y, z, hit = true, rx = 0) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(x, y, z); me.rotation.x = rx; me.castShadow = true; me.receiveShadow = true;
      me.userData = { kind: 'car', car: this };
      g.add(me);
      if (hit) G.hitList.push(me);
      return me;
    };
    add(rbox(7, 1.5, 13.6, 0.4), body, 0, 1.5, 0);
    add(rbox(7, 1.3, 4.3, 0.35), body, 0, 2.85, 4.65);
    add(rbox(7, 1.3, 2.7, 0.35), body, 0, 2.85, -5.45);
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.35, 1.3, 6.6), body, s * 3.32, 2.85, -0.8);
      add(new THREE.BoxGeometry(0.32, 3.1, 0.32), body, s * 3.2, 4.9, 2.2, true, -0.25);
      add(new THREE.BoxGeometry(0.32, 3.0, 0.32), body, s * 3.2, 4.95, -3.9);
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(6, 2.9), glass); sw.position.set(s * 3.33, 4.95, -0.85); sw.rotation.y = Math.PI / 2; g.add(sw);
      add(new THREE.BoxGeometry(1.3, 0.55, 0.2), mat('#fffbe0'), s * 2.4, 2.9, 6.8, false);
      add(new THREE.BoxGeometry(1.3, 0.5, 0.2), mat('#e53935'), s * 2.4, 2.9, -6.8, false);
    }
    add(rbox(6.8, 0.35, 6.1, 0.15), body, 0, 6.55, -0.85);
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 3.2), glass); ws.position.set(0, 4.95, 2.25); ws.rotation.x = -0.25; g.add(ws);
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.9), glass); rw.position.set(0, 4.95, -3.95); g.add(rw);
    add(rbox(7.3, 0.6, 0.6, 0.2), grey, 0, 1.05, 6.85); add(rbox(7.3, 0.6, 0.6, 0.2), grey, 0, 1.05, -6.85);
    add(new THREE.BoxGeometry(6.4, 0.9, 1.1), dark, 0, 3.85, 2.05, false);
    for (const s of [-1.5, 1.5]) { add(rbox(2.2, 0.7, 2.2, 0.2), seat, s, 2.55, -0.9, false); add(rbox(2.2, 2.6, 0.5, 0.2), seat, s, 4.0, -2.15, false, -0.12); }
    const sw = (this.wheelPivot = new THREE.Group());
    sw.position.set(1.5, 4.4, 1.35); sw.rotation.x = -0.45; g.add(sw);
    this.sWheel = new THREE.Group(); sw.add(this.sWheel);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 8, 24), dark); this.sWheel.add(ring);
    for (const r of [0, 2.1, -2.1]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.08), dark); sp.position.set(Math.sin(r) * 0.3, Math.cos(r) * 0.3, 0); sp.rotation.z = -r; this.sWheel.add(sp); }
    const wg = new THREE.CylinderGeometry(1.35, 1.35, 1.1, 18); wg.rotateZ(Math.PI / 2);
    const hg = new THREE.CylinderGeometry(0.6, 0.6, 1.15, 10); hg.rotateZ(Math.PI / 2);
    this.wheels = [];
    for (const [sx, sz, front] of [[3.25, 4.5, 1], [-3.25, 4.5, 1], [3.25, -4.5, 0], [-3.25, -4.5, 0]]) {
      const piv = new THREE.Group(); piv.position.set(sx, 1.35, sz); g.add(piv);
      const w = new THREE.Mesh(wg, mat('#1f2023')); w.castShadow = true; piv.add(w);
      const hb = new THREE.Mesh(hg, grey); w.add(hb);
      const sp = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.25, 1.0), grey); w.add(sp);
      this.wheels.push({ piv, w, front });
    }
    g.position.copy(this.pos); g.rotation.y = heading;
    G.scene.add(g);
  }
  forward() { return V(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  right() { return V(-Math.cos(this.heading), 0, Math.sin(this.heading)); }

  addBlood() {
    if (!G.settings.gore || this.blood > 12) return;
    if (!bloodMat) bloodMat = new THREE.MeshLambertMaterial({ color: '#8b0909', map: G.gore.sm.material.map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const s = rand(1, 2.2), m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), bloodMat);
    if (Math.random() < 0.6) m.position.set(rand(-3, 3), rand(1.2, 3.3), 6.86);
    else { m.position.set(rand(-3, 3), 3.52, rand(3.5, 6.5)); m.rotation.x = -Math.PI / 2; }
    m.rotation.z = rand(0, 6);
    this.group.add(m); this.blood++;
  }

  update(dt) {
    const inp = this.driver === G.player ? G.input : null;
    let thr = 0, st = 0;
    if (inp) { thr = inp.my; st = -inp.mx; }
    this.steer = damp(this.steer, st, 6, dt);
    if (thr > 0) this.speed += (this.speed < 0 ? 90 : 36) * thr * dt;
    else if (thr < 0) this.speed += (this.speed > 0 ? 90 : 26) * thr * dt;
    else this.speed = damp(this.speed, 0, 0.5, dt);
    this.speed = clamp(this.speed - this.speed * 0.06 * dt, -25, 95);
    const maxSt = 0.6 / (1 + Math.abs(this.speed) / 45);
    this.heading += (this.speed * Math.tan(this.steer * maxSt) / 8.8) * dt;
    const f = this.forward(), r = this.right();
    this.vel.copy(f).multiplyScalar(this.speed);
    this.pos.addScaledVector(this.vel, dt);
    this.crashCD -= dt;
    this.collide(f);

    if (Math.abs(this.speed) > 1) {
      for (const n of [...G.npcs]) {
        if (n.removed) continue;
        const rel = n.pos.clone().sub(this.pos), lz = rel.dot(f), lx = rel.dot(r);
        if (Math.abs(lx) < HW + 1 && Math.abs(lz) < HL + 1 && !n.avatar.rag) {
          if (n.alive && Math.abs(this.speed) > 7 && n.carCD <= 0.5) {
            n.carHit(this, this.vel.clone().addScaledVector(r, Math.sign(lx) * Math.abs(this.speed) * 0.25));
            this.speed *= 0.9;
            if (Math.abs(this.speed) > 15) this.addBlood();
          } else if (n.alive) {
            const pen = HW + 1.05 - Math.abs(lx);
            n.pos.addScaledVector(r, Math.sign(lx || 1) * pen);
            if (n.sayCD <= 0) n.say('bump', 1);
          }
        }
        const R = n.avatar.rag;
        if (R) {
          let touched = false;
          for (let i = 0; i < R.p.length; i++) {
            const p = R.p[i], q = p.clone().sub(this.pos), pz = q.dot(f), px = q.dot(r);
            if (p.y > 3.2 || Math.abs(px) > HW || Math.abs(pz) > HL) continue;
            const ex = HW - Math.abs(px), ez = HL - Math.abs(pz);
            if (ex < ez) p.addScaledVector(r, Math.sign(px || 1) * (ex + 0.05)); else p.addScaledVector(f, Math.sign(pz || 1) * (ez + 0.05));
            R.o[i].copy(p).addScaledVector(this.vel, -1 / 60).y -= 0.02;
            touched = true;
          }
          if (touched) {
            R.sleep = false; R.still = 0;
            if (Math.abs(this.speed) > 6 && Math.random() < dt * 6) { G.gore.spray(R.p[0], V(0, 1, 0), 3, 6); Sound.crack(R.p[0]); }
          }
        }
      }
    }
    const g = this.group;
    g.position.copy(this.pos);
    g.rotation.set(0, this.heading, 0);
    g.rotateZ(-this.steer * this.speed * 0.0012);
    this.spin += (this.speed * dt) / 1.35;
    for (const w of this.wheels) { w.w.rotation.x = this.spin; if (w.front) w.piv.rotation.y = this.steer * maxSt; }
    this.sWheel.rotation.z = -this.steer * 2.2;
  }

  collide(f) {
    for (const lz of [-4.7, 0, 4.7]) {
      const c = this.pos.clone().addScaledVector(f, lz), before = c.clone();
      if (G.world.collide(c, 3.5, 6, null, 0.9)) {
        this.pos.add(c.sub(before));
        const imp = Math.abs(this.speed);
        if (imp > 8 && this.crashCD <= 0) { Sound.crash(before, Math.min(1.2, imp / 50)); this.crashCD = 0.4; }
        this.speed *= lz !== 0 && Math.sign(lz) === Math.sign(this.speed) ? -0.25 : 0.8;
      }
    }
    for (const o of G.cars) {
      if (o === this) continue;
      const d = this.pos.clone().sub(o.pos).setY(0), L = d.length();
      if (L < 7.5 && L > 1e-3) {
        const push = d.multiplyScalar((7.5 - L) / L);
        this.pos.addScaledVector(push, 0.6); o.pos.addScaledVector(push, -0.4);
        o.speed += this.speed * 0.3;
        if (Math.abs(this.speed) > 8 && this.crashCD <= 0) { Sound.crash(o.pos, Math.min(1.2, Math.abs(this.speed) / 50)); this.crashCD = 0.4; }
        this.speed *= -0.3;
      }
    }
  }
}
