// 1인칭 화면에 보이는 내 팔(사진처럼 하얀 팔)과 손에 든 도구
import * as THREE from 'three';
import { buildModel, setBowDraw, flashMat } from './weapons.js';
import { rbox, mat, damp, clamp } from './util.js';

const SKIN = '#ececf0';
const LAY = {
  gun: { pos: [0.36, -0.36, -1.15], s: 0.26 },
  bow: { pos: [-0.22, -0.1, -1.5], s: 0.2 },
};

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(60, 1, 0.02, 30);
    this.scene.add(new THREE.HemisphereLight('#e8f3ff', '#cfcfcf', 1.7));
    const d = new THREE.DirectionalLight('#ffffff', 1.8); d.position.set(0.5, 1, 0.4); this.scene.add(d);
    this.models = {}; this.cur = null; this.id = null;
    this.sx = 0; this.sy = 0; this.kz = 0; this.kr = 0; this.eqT = 1; this.flT = 0; this.arrowT = 0;
  }
  build(id) {
    const g = new THREE.Group(), w = buildModel(id);
    g.add(w); g.userData.w = w;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const arm = (h, d, len = 3.2) => {
      const hand = new THREE.Mesh(rbox(0.6, 0.6, 0.6, 0.16), mat(SKIN)); hand.position.copy(h); g.add(hand);
      const fa = new THREE.Mesh(rbox(0.7, 0.7, len, 0.2), mat(SKIN));
      d.normalize(); fa.position.copy(h).addScaledVector(d, len / 2 + 0.15); fa.quaternion.setFromUnitVectors(V(0, 0, 1), d); g.add(fa);
      return [hand, fa];
    };
    if (id === 'bow') {
      arm(V(0, 0, 0), V(-0.2, -1, 0.55), 4);
      g.userData.rh = arm(V(0, 0, 0.8), V(0.3, -1, 0.3), 1.2);
    } else {
      arm(V(0, -0.18, 0.12), V(0.25, -0.95, 0.6));
      arm(V(-0.34, -0.25, 0.0), V(-0.55, -0.9, 0.55));
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), flashMat);
      fl.position.copy(w.userData.muzzle).add(V(0, 0, -0.3)); fl.visible = false;
      w.add(fl); g.userData.flash = fl;
    }
    this.scene.add(g); g.visible = false;
    return g;
  }
  setWeapon(id) {
    if (id === this.id) return;
    if (this.cur) this.cur.visible = false;
    this.id = id;
    this.cur = id ? this.models[id] || (this.models[id] = this.build(id)) : null;
    if (this.cur) { this.cur.visible = true; this.eqT = 0; }
  }
  kick(r) { this.kz += r * 2.4; this.kr += r * 3.2; }
  flash() { if (this.cur && this.cur.userData.flash) { this.flT = 0.05; this.cur.userData.flash.rotation.z = Math.random() * 3; } }
  release() { this.arrowT = 0.4; }
  update(dt, s) {
    const g = this.cur;
    if (!g) return;
    const L = LAY[this.id], xs = clamp(this.cam.aspect / 1.6, 0.45, 1);
    this.sx = damp(this.sx, clamp(-s.lookX * 0.8, -0.09, 0.09), 9, dt);
    this.sy = damp(this.sy, clamp(s.lookY * 0.8, -0.09, 0.09), 9, dt);
    const bx = Math.sin(s.bob) * 0.03 * s.bobAmp, by = -Math.abs(Math.cos(s.bob)) * 0.025 * s.bobAmp;
    this.kz = damp(this.kz, 0, 14, dt); this.kr = damp(this.kr, 0, 12, dt);
    this.eqT = Math.min(1, this.eqT + dt * 4);
    const eq = 1 - this.eqT;
    g.position.set(L.pos[0] * xs + this.sx + bx, L.pos[1] + this.sy + by - eq * 0.6 - s.dip * 0.06, L.pos[2] + this.kz);
    g.rotation.set(this.kr - this.sy, this.sx * 1.5 + (this.id === 'bow' ? 0.55 : 0), this.id === 'bow' ? 0.3 : 0);
    g.scale.setScalar(L.s);
    this.flT -= dt;
    if (g.userData.flash) g.userData.flash.visible = this.flT > 0;
    if (this.id === 'bow') {
      const w = g.userData.w, d = s.draw;
      setBowDraw(w, d);
      this.arrowT -= dt;
      w.userData.arrow.visible = this.arrowT <= 0;
      const [hand, fa] = g.userData.rh, z = w.userData.tip + d * 1.7;
      hand.position.set(0, 0, z);
      fa.position.set(0, 0, z).addScaledVector(new THREE.Vector3(0.3, -1, 0.3).normalize(), 0.75);
    }
  }
}
